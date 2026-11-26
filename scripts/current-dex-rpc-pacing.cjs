'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const endpoint = 'https://testnet.coti.io/rpc';
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const decode = value => JSON.parse(new TextDecoder().decode(value));
const c1BroadcastHeld = 'DEX_RPC_C1_BROADCAST_HELD';
const c1Denials = new WeakMap(), c1BeforeTransport = new WeakSet(), c1Unbroadcast = new WeakMap();
const c1BytesDigest = raw => createHash('sha256').update(raw.toLowerCase()).digest('hex');
const managedServices = new WeakMap();
// The platform default is the supported managed response ceiling, not each service's timeout.
const managedResponseCeilingMs = new (require('ethers').FetchRequest)(endpoint).timeout;
const readMethods = new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getLogs',
  'eth_getTransactionByHash','eth_getTransactionReceipt','eth_call','eth_getCode','eth_gasPrice',
  'eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_getProof']);
const safeMethod = name => readMethods.has(name) || name === 'eth_sendRawTransaction' ? name : 'other';
// CW-102: one failed read must not stop the group. Reads only, at most three retries, each through the
// same admission. A broadcast, a batch with a broadcast and any unknown method are never retried.
// A caller may only shorten or remove delays (tests); it cannot add attempts.
const readRetry = Object.freeze({ delaysMs: Object.freeze([1000, 4000, 16000]), maximumRetryAfterMs: 300_000 });
// The endpoint keeps an idle connection for more than 200 s (CW-102 host probe); Node drops it after 5 s,
// so a service with a 5 s cycle opened a new TLS connection almost every cycle.
const keepAliveIdleMs = 60_000;
const safeText = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
// Only the error class: a Node/ethers code and syscall. Never a message, payload or address.
function transportCause(error) {
  for (let item = error, depth = 0; item && typeof item === 'object' && depth < 3; item = item.cause ?? item.error, depth++) {
    const code = safeText(item.code, /^[A-Z][A-Z0-9_]{1,47}$/);
    if (code) return { code, syscall: safeText(item.syscall, /^[a-z]{1,24}$/) };
  }
  return { code: null, syscall: null };
}
// Review H1: ethers' getUrl rejects on its own timeout but leaves the request open, so a TIMEOUT,
// CANCELLED or unknown error may still be in flight. Retry only errors after which Node has destroyed the
// socket or never connected. A response timeout is never retried.
const settledTransportCodes = /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND|ERR_SSL_[A-Z0-9_]+|ERR_TLS_[A-Z0-9_]+)$/;
function retryAfterMs(headers) {
  const entry = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'retry-after');
  const value = typeof entry?.[1] === 'string' ? entry[1].trim() : '';
  if (/^[0-9]{1,9}$/.test(value)) return Number(value) * 1000;
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}
function checkRetryPolicy(retry) {
  assert(Array.isArray(retry?.delaysMs) && retry.delaysMs.length <= readRetry.delaysMs.length &&
    retry.delaysMs.every((delay, index) => Number.isFinite(delay) && delay >= 0 && delay <= readRetry.delaysMs[index]) &&
    Number.isFinite(retry.maximumRetryAfterMs) && retry.maximumRetryAfterMs >= 0 &&
    retry.maximumRetryAfterMs <= readRetry.maximumRetryAfterMs, 'DEX_RPC_RETRY_POLICY');
  return Object.freeze({ delaysMs: Object.freeze([...retry.delaysMs]), maximumRetryAfterMs: retry.maximumRetryAfterMs });
}
function safeProviderIds(headers) {
  const ids = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value !== 'string') continue;
    if (name.toLowerCase() === 'cf-ray' && /^[0-9a-f]{16}(?:-[a-z]{3})?$/i.test(value)) ids.cfRay = value;
    if (['x-request-id', 'x-correlation-id'].includes(name.toLowerCase()) && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
      ids[name.toLowerCase() === 'x-request-id' ? 'requestId' : 'correlationId'] = value;
    }
  }
  return ids;
}
function rpcItems(payload) {
  const items = Array.isArray(payload) ? payload : [payload], ids = new Set();
  assert(items.length > 0, 'DEX_RPC_PAYLOAD');
  for (const item of items) {
    assert(item?.jsonrpc === '2.0' && typeof item.method === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.method) &&
      (typeof item.id === 'string' || Number.isSafeInteger(item.id)) && !ids.has(item.id), 'DEX_RPC_PAYLOAD');
    ids.add(item.id);
  }
  return items;
}

function createManagedAdmission(service, target = process) {
  assert(['keeper', 'prices', 'matching', 'c1'].includes(service), 'DEX_RPC_SERVICE');
  assert(target.connected && typeof target.send === 'function', 'DEX_RPC_IPC_UNAVAILABLE');
  let pending = null, sequence = 0, stopped = null;
  const waiters = new Set();
  const clear = row => { clearTimeout(row.timer); if (pending === row) pending = null; };
  const stop = code => {
    stopped ??= code;
    if (pending?.phase === 'queued') { const row = pending; clear(row); row.reject(Error(stopped)); }
    for (const wake of [...waiters]) wake();
  };
  const send = message => {
    try {
      assert(target.connected, 'DEX_RPC_IPC_UNAVAILABLE');
      target.send({ ...message, service }, error => { if (error) stop('DEX_RPC_IPC_UNAVAILABLE'); });
      return true;
    } catch { stop('DEX_RPC_IPC_UNAVAILABLE'); return false; }
  };
  target.on('message', message => {
    if (message?.type === 'CHAINWHISPER_SERVICE_STOP') { stop('DEX_RPC_GROUP_STOP'); return; }
    if (!String(message?.type ?? '').startsWith('CHAINWHISPER_RPC_')) return;
    if (message.service !== service) { stop('DEX_RPC_IPC_PROTOCOL'); return; }
    const row = pending;
    if (message.type === 'CHAINWHISPER_RPC_GRANT') {
      if (!row || row.id !== message.id) {
        if (Number.isSafeInteger(message.id) && message.id > 0 && message.id <= sequence) {
          send({ type: 'CHAINWHISPER_RPC_CANCEL', id: message.id, expired: true }); return;
        }
        stop('DEX_RPC_IPC_PROTOCOL'); return;
      }
      if (row.phase !== 'queued') { stop('DEX_RPC_IPC_PROTOCOL'); return; }
      row.phase = 'reserved'; row.resolve(row);
    } else if (message.type === 'CHAINWHISPER_RPC_REJECT') {
      if (!row || row.id !== message.id) return;
      clear(row); row.reject(Error(/^DEX_RPC_[A-Z0-9_]+$/.test(message.code) ? message.code : 'DEX_RPC_IPC_PROTOCOL'));
    } else stop('DEX_RPC_IPC_PROTOCOL');
  });
  target.on('disconnect', () => stop('DEX_RPC_IPC_UNAVAILABLE'));
  target.once('beforeExit', () => {
    if (!pending && !stopped) send({ type: 'CHAINWHISPER_RPC_IDLE_EXIT', id: sequence + 1 });
  });
  const admission = {
    get stopped() { return stopped; },
    acquire(expires, onCancel, read = false, broadcast = false) {
      assert(!stopped && target.connected && !pending, stopped ?? 'DEX_RPC_IPC_UNAVAILABLE');
      const queueMs = expires - performance.now();
      assert(queueMs > 0, 'DEX_RPC_QUEUE_TIMEOUT');
      return new Promise((resolve, reject) => {
        const row = { id: ++sequence, phase: 'queued', resolve, reject, timer: null };
        pending = row;
        const cancel = (expired = true) => {
          if (pending !== row || row.phase === 'started' || row.phase === 'unresolved') return;
          clear(row); send({ type: 'CHAINWHISPER_RPC_CANCEL', id: row.id, expired });
          reject(Error(expired ? 'DEX_RPC_QUEUE_TIMEOUT' : 'DEX_RPC_CANCELLED'));
        };
        row.timer = setTimeout(cancel, Math.ceil(queueMs));
        onCancel?.(cancel);
        // The supervisor holds reads during a refusal cool-down and refuses a retry of a non-read.
        send({ type: 'CHAINWHISPER_RPC_REQUEST', id: row.id, queueMs, read: read === true, send: broadcast === true });
      });
    },
    // A settled read attempt that the child retries later through a new admission.
    retry(row, { code, statusCode, waitMs }) {
      assert(pending === row && row.phase === 'started', 'DEX_RPC_IPC_PROTOCOL');
      clear(row);
      assert(send({ type: 'CHAINWHISPER_RPC_RETRY', id: row.id, code, waitMs,
        ...(statusCode === undefined ? {} : { statusCode }) }), 'DEX_RPC_IPC_UNAVAILABLE');
    },
    // Retry backoff; a group stop ends it at once so the child can exit.
    pause(ms) {
      return new Promise(resolve => {
        if (stopped) { resolve(); return; }
        const wake = () => { clearTimeout(timer); waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, ms); waiters.add(wake);
      });
    },
    assertCurrent(row) {
      assert(!stopped && target.connected && pending === row && row.phase === 'reserved', stopped ?? 'DEX_RPC_IPC_UNAVAILABLE');
    },
    started(row) {
      clearTimeout(row.timer); row.phase = 'started';
      return send({ type: 'CHAINWHISPER_RPC_STARTED', id: row.id });
    },
    cancel(row, expired = false) {
      if (pending !== row) return;
      assert(row.phase !== 'started' && row.phase !== 'unresolved', 'DEX_RPC_IPC_PROTOCOL');
      clear(row); send({ type: 'CHAINWHISPER_RPC_CANCEL', id: row.id, expired });
    },
    response(row, statusCode) {
      clear(row); send({ type: 'CHAINWHISPER_RPC_RESPONSE', id: row.id, statusCode });
    },
    fail(row, code, settled, statusCode, unused = false) {
      if (row) {
        clearTimeout(row.timer);
        if (unused || statusCode !== undefined) clear(row); else row.phase = 'unresolved';
      }
      send({ type: 'CHAINWHISPER_RPC_STOP', id: row?.id ?? ++sequence, code, settled, unused,
        ...(statusCode === undefined ? {} : { statusCode }) });
      stopped ??= code;
    },
    settled(row, statusCode) {
      send({ type: 'CHAINWHISPER_RPC_SETTLED', id: row.id,
        ...(statusCode === undefined ? {} : { statusCode }) });
    }
  };
  if (target === process && process.env.CHAINWHISPER_RPC_MANAGED_SERVICE === service) managedServices.set(admission, service);
  return admission;
}

function createPacing(getUrl, gapMs = 500, checkSource = () => {}, admission = null, readBatches = false, options = {}) {
  assert([0, 500, 334].includes(gapMs), 'DEX_RPC_RATE');
  assert.equal(typeof readBatches, 'boolean', 'DEX_RPC_BATCH_POLICY');
  const retry = checkRetryPolicy(options.retry ?? readRetry);
  const connections = typeof options.connections === 'function' ? options.connections : null;
  const authorizeBroadcast = options.authorizeBroadcast;
  assert(authorizeBroadcast===undefined||typeof authorizeBroadcast==='function','DEX_RPC_WRITE_POLICY');
  const managed = managedServices.has(admission);
  if (managed) gapMs = 0;
  let outstanding = 0;
  let tail = Promise.resolve(), last = null, stopped = null, requests = 0, minimumGapMs = null, lastFailure = null;
  let grants = 0, physicalSettled = 0, physicalPending = 0, unresolved = 0, expired = 0, cancelled = 0, rpcCalls = 0;
  const methods = {}, statuses = {}, started = performance.now();
  // Retried attempts. `statuses` still counts every physical response; `lastFailure` only a final failure.
  const retries = { total: 0, byCode: {}, last: null };
  const code = error => {
    const name = String(error?.message ?? '').split(/\r?\n/, 1)[0];
    return /^DEX_RPC_[A-Z0-9_]+$/.test(name) ? name : 'DEX_RPC_TRANSPORT_STOP';
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const retryMarker = Symbol('retry');
  function send(request, signal, item, expires, responseTimeoutMs, allRead, attempt = 0) {
    // Four clients, one outstanding admission each: three peers can precede this
    // client; each earlier local work item can add itself and three peer turns.
    if (managed && allRead && responseTimeoutMs > 0 && responseTimeoutMs <= managedResponseCeilingMs)
      expires += (3 + 4 * outstanding) * managedResponseCeilingMs;
    assert(expires - performance.now() <= 2_147_483_647, 'DEX_RPC_TIMEOUT_POLICY');
    outstanding++;
    let entered = false, finished = false, queueExpired = false, queueReason = 'DEX_RPC_QUEUE_TIMEOUT', queueCounted = false, queueTimer, cancelAdmission;
    let rejectQueue;
    const queueDeadline = new Promise((_, reject) => { rejectQueue = reject; });
    const cancelQueue = isExpiry => {
      if (entered || finished || queueExpired) return;
      queueExpired = true; queueReason = isExpiry ? 'DEX_RPC_QUEUE_TIMEOUT' : 'DEX_RPC_CANCELLED';
      if (isExpiry) { expired++; queueCounted = true; }
      cancelAdmission?.(isExpiry);
      rejectQueue(Error(queueReason));
    };
    queueTimer = setTimeout(() => cancelQueue(true), Math.max(1, Math.ceil(expires - performance.now())));
    const work = tail.then(async () => {
      let lease = null, invoked = false, settled = false, statusCode, responseTimer, response, phase = 'queued', methodNames = [];
      let transportError = null, transportFailed = false, startedAt = null, failedAt = null, connectionsBefore = null;
      const details = () => ({ method: methodNames.length === 1 ? methodNames[0] : methodNames.length ? 'batch' : null,
        methods: [...methodNames], phase, status: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null,
        providerIds: safeProviderIds(response?.headers) });
      // CW-102: the error class of a failed transport, so a host record names its cause.
      const cause = () => transportFailed ? { cause: { ...transportCause(transportError),
        newConnection: connections && connectionsBefore !== null && !methodNames.includes('eth_sendRawTransaction') ? connections() > connectionsBefore : null,
        transportMs: Math.round((failedAt ?? performance.now()) - startedAt) } } : {};
      try {
        if (stopped) throw Error(stopped);
        // A group stop during a retry backoff ends the request before any local spacing wait.
        if (admission?.stopped) throw Error(admission.stopped);
        if (queueExpired) throw Error(queueReason);
        checkSource();
        const check = () => {
          if (queueExpired) throw Error(queueReason);
          if (performance.now() >= expires) throw Error('DEX_RPC_QUEUE_TIMEOUT');
          try { signal.checkSignal(); } catch { throw Error('DEX_RPC_CANCELLED'); }
        };
        check();
        assert(request.url === endpoint, 'DEX_RPC_ENDPOINT');
        const items = Array.isArray(item) ? rpcItems(item) : [item];
        if (Array.isArray(item)) assert(items.length <= 16 && items.every(value => readMethods.has(value.method)), 'DEX_RPC_PAYLOAD');
        else assert(item?.jsonrpc === '2.0' && typeof item.method === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.method) && item.id !== undefined, 'DEX_RPC_PAYLOAD');
        methodNames = [...new Set(items.map(value => safeMethod(value.method)))];
        assert(Number.isFinite(responseTimeoutMs) && responseTimeoutMs > 0 && responseTimeoutMs <= (managed ? managedResponseCeilingMs : 2_147_483_647), 'DEX_RPC_TIMEOUT_POLICY');
        // Only a request made entirely of listed reads may be retried. Never a broadcast.
        const readOnly = items.every(value => readMethods.has(value.method)), broadcast = items.some(value => value.method === 'eth_sendRawTransaction');
        const attemptOnce = async () => {
          while (last !== null && performance.now() - last < gapMs) {
            const delay = Math.ceil(gapMs - (performance.now() - last));
            if (performance.now() + delay >= expires) throw Error('DEX_RPC_QUEUE_TIMEOUT');
            await sleep(delay);
          }
          check();
          if (admission) { lease = await admission.acquire(expires, cancel => { cancelAdmission = cancel; }, readOnly, broadcast); grants++; }
          checkSource(); check();
          assert(request.url === endpoint, 'DEX_RPC_ENDPOINT');
          if (admission) admission.assertCurrent(lease);
          const single = request.clone(); single.body = JSON.stringify(item);
          // Admission expiry does not consume the physical request's finite response budget.
          single.timeout = responseTimeoutMs;
          if (broadcast && authorizeBroadcast) {
            try {
              const {params}=items[0];
              assert(Array.isArray(params)&&params.length===1&&authorizeBroadcast(params[0])===true,c1BroadcastHeld);
            } catch (error) {
              const ticket=c1Denials.get(error);
              if(ticket){
                c1Denials.delete(error);
                c1BeforeTransport.add(ticket);
              }
              throw Error(c1BroadcastHeld);
            }
            check();
            admission?.assertCurrent(lease);
          }
          const now = performance.now();
          if (last !== null) minimumGapMs = Math.min(minimumGapMs ?? Infinity, now - last);
          last = now; requests++; rpcCalls += items.length;
          for (const value of items) { const method = safeMethod(value.method); methods[method] = (methods[method] ?? 0) + 1; }
          entered = true; invoked = true; physicalPending++; clearTimeout(queueTimer);
          const deadline = new Promise((_, reject) => {
            responseTimer = setTimeout(() => reject(Error('DEX_RPC_RESPONSE_TIMEOUT')), single.timeout);
          });
          phase = 'transport'; startedAt = performance.now(); connectionsBefore = connections?.() ?? null;
          let transport;
          try { transport = Promise.resolve(getUrl(single, signal)); } catch (error) { transport = Promise.reject(error); }
          const row = lease;
          const completed = transport.then(response => {
            settled = true; physicalPending--; physicalSettled++; statusCode = response.statusCode;
            statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
            if (unresolved && row) admission.settled(row, statusCode);
            return response;
          }, error => {
            settled = true; physicalPending--; physicalSettled++;
            transportFailed = true; transportError = error; failedAt = performance.now();
            if (unresolved && row) admission.settled(row);
            throw error;
          });
          const physical = Promise.race([completed, deadline]);
          // Keep observing a request even if IPC fails immediately after its physical start.
          physical.catch(() => {});
          // Report after invocation, so a delayed child cannot create an early aggregate timestamp.
          if (admission) assert(admission.started(lease), 'DEX_RPC_IPC_UNAVAILABLE');
          response = await physical; phase = 'http-response';
          // Stop before ethers can retry a refusal or follow a redirect. Never rotate RPCs.
          assert(response.statusCode === 200, `DEX_RPC_HTTP_${response.statusCode}`);
          phase = 'rpc-response';
          const value = decode(response.body);
          if (Array.isArray(item)) {
            const replies = value, ids = new Set(items.map(value => value.id));
            assert(Array.isArray(replies) && replies.length === items.length, 'DEX_RPC_RESPONSE');
            for (const reply of replies) {
              assert(reply?.jsonrpc === '2.0' && ids.delete(reply.id) &&
                Object.hasOwn(reply, 'result') !== Object.hasOwn(reply, 'error'), 'DEX_RPC_RESPONSE');
              if (Object.hasOwn(reply, 'error')) assert(Number.isInteger(reply.error?.code) && typeof reply.error.message === 'string', 'DEX_RPC_RESPONSE');
            }
          } else assert(value?.jsonrpc === '2.0' && value.id === item.id, 'DEX_RPC_RESPONSE');
          const failed = (Array.isArray(item) ? value : [value]).find(reply => Number.isSafeInteger(reply?.error?.code));
          if (failed) {
            const method = safeMethod(items.find(request => request.id === failed.id)?.method);
            lastFailure = { code: 'DEX_RPC_ERROR_RESPONSE', ...details(), ...(method ? { method, methods: [method] } : {}), rpcCode: failed.error.code };
          }
          admission?.response(lease, statusCode);
          return response;
        };
        // The wait before the next attempt, or null when this failure must stop as before.
        const retryWait = reason => {
          if (stopped || !readOnly || !invoked || attempt >= retry.delaysMs.length) return null;
          if (admission && (!lease || typeof admission.retry !== 'function' || admission.stopped)) return null;
          let after = 0;
          if (reason === 'DEX_RPC_TRANSPORT_STOP') {
            if (!transportFailed || phase !== 'transport' || !settledTransportCodes.test(transportCause(transportError).code ?? '')) return null;
          } else {
            const status = Number(/^DEX_RPC_HTTP_([0-9]{3})$/.exec(reason)?.[1]);
            if (status !== statusCode || phase !== 'http-response') return null;
            // A 403 is a refusal of the whole client: only the supervisor can cool down all four services.
            if (status === 403 ? !admission : status !== 429 && (status < 500 || status > 599)) return null;
            after = retryAfterMs(response?.headers);
          }
          if (after > retry.maximumRetryAfterMs) return null;
          return Math.max(retry.delaysMs[attempt], after);
        };
        try { return await attemptOnce(); } catch (error) {
          const reason = code(error), waitMs = retryWait(reason);
          if (waitMs === null) throw error;
          retries.total++; retries.byCode[reason] = (retries.byCode[reason] ?? 0) + 1;
          retries.last = { code: reason, ...details(), ...cause(), attempt: attempt + 1, waitMs };
          if (admission) admission.retry(lease, { code: reason, statusCode, waitMs });
          return { [retryMarker]: waitMs };
        }
      } catch (error) {
        const reason = code(error);
        if (!stopped) lastFailure = { code: reason, ...details(), ...cause() };
        if (!invoked && ['DEX_RPC_QUEUE_TIMEOUT', 'DEX_RPC_CANCELLED', c1BroadcastHeld].includes(reason)) {
          if (reason === 'DEX_RPC_QUEUE_TIMEOUT' && !queueCounted) { expired++; queueCounted = true; }
          if (reason !== 'DEX_RPC_QUEUE_TIMEOUT') cancelled++;
          if (lease) admission.cancel(lease, reason === 'DEX_RPC_QUEUE_TIMEOUT');
          throw Error(reason);
        }
        stopped ??= reason;
        if (invoked && statusCode === undefined) unresolved = 1;
        admission?.fail(lease, stopped, settled, statusCode, Boolean(lease && !invoked));
        throw Error(stopped);
      } finally { finished = true; outstanding--; clearTimeout(queueTimer); clearTimeout(responseTimer); }
    });
    tail = work.catch(() => {});
    try { signal.addListener?.(() => cancelQueue(false)); } catch { cancelQueue(false); }
    // The settled attempt has left the FIFO; later requests of this service run during the backoff.
    return Promise.race([work, queueDeadline]).then(async value => {
      if (value?.[retryMarker] === undefined) return value;
      await (admission?.pause ? admission.pause(value[retryMarker]) : sleep(value[retryMarker]));
      return send(request, signal, item, performance.now() + responseTimeoutMs, responseTimeoutMs, allRead, attempt + 1);
    });
  }
  return {
    async getUrl(request, signal) {
      const responseTimeoutMs = request.timeout;
      const expires = performance.now() + responseTimeoutMs;
      const payload = decode(request.body);
      const allRead = (Array.isArray(payload) ? payload : [payload]).every(item => readMethods.has(item?.method));
      if (readBatches && Array.isArray(payload) && payload.every(item => readMethods.has(item?.method))) {
        try {
          const items = rpcItems(payload);
          assert(items.length <= 16, 'DEX_RPC_PAYLOAD');
        } catch (error) {
          stopped ??= code(error); admission?.fail(null, stopped, false, undefined, true); throw Error(stopped);
        }
        return send(request, signal, payload, expires, responseTimeoutMs, allRead);
      }
      if (!Array.isArray(payload)) return send(request, signal, payload, expires, responseTimeoutMs, allRead);
      assert(payload.length > 0, 'DEX_RPC_PAYLOAD');
      const replies = await Promise.all(payload.map(item => send(request, signal, item, expires, responseTimeoutMs, allRead)));
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: encode(replies.map(r => decode(r.body))) };
    },
    stats: () => ({ requests, rpcCalls, grants, physicalSettled, physicalPending, unresolvedOccupancy: unresolved,
      ...(lastFailure ? { lastFailure: structuredClone(lastFailure) } : {}),
      expired, cancelled, methods: { ...methods }, statuses: { ...statuses }, minimumGapMs,
      intervalMs: gapMs, localIntervalMs: gapMs, managed: Boolean(admission),
      maximumInFlight: 1, elapsedMs: Math.round(performance.now() - started), stopped,
      retries: structuredClone(retries), readRetry: { delaysMs: [...retry.delaysMs], maximumRetryAfterMs: retry.maximumRetryAfterMs },
      connections: connections?.() ?? null })
  };
}

function createC1BroadcastFence(){
  let pending;
  const digest=raw=>{
    assert(typeof raw==='string'&&/^0x(?:[a-f0-9]{2})+$/i.test(raw),c1BroadcastHeld);
    return c1BytesDigest(raw);
  };
  return {
    async submit(raw, send, check){
      assert(!pending&&typeof send==='function'&&typeof check==='function',c1BroadcastHeld);
      const ticket={hash:digest(raw),check,used:false,authorized:false};
      pending=ticket;
      try{
        const result=await send();
        assert(ticket.authorized,c1BroadcastHeld);
        return result;
      }catch(error){
        if(!c1BeforeTransport.has(ticket))throw error;
        const refusal=Error(c1BroadcastHeld);
        c1Unbroadcast.set(refusal,ticket.hash);
        throw refusal;
      }finally{pending=null;}
    },
    authorize(raw){
      assert(pending&&!pending.used&&pending.hash===digest(raw),c1BroadcastHeld);
      pending.used=true;
      try{
        pending.authorized=pending.check()===true;
        if(pending.authorized)return true;
      }catch{/* Publish a one-shot pre-transport mark for the exact ticket only. */}
      const refusal=Error(c1BroadcastHeld);
      c1Denials.set(refusal,pending);
      throw refusal;
    }
  };
}

// CW-102: one keep-alive agent per service process. It counts new connections for the traffic record.
function createAgent() {
  let created = 0;
  class CountingAgent extends https.Agent {
    createConnection(...args) { created++; return super.createConnection(...args); }
  }
  return { agent: new CountingAgent({ keepAlive: true, keepAliveMsecs: 1000, timeout: keepAliveIdleMs }), connections: () => created };
}

let active, managedC1Queue;
function install(service, rehearsal = false) {
  assert(['keeper', 'prices', 'matching', 'c1'].includes(service), 'DEX_RPC_SERVICE');
  if (rehearsal) assert(service === 'c1' && process.connected && process.env.CHAINWHISPER_RPC_MANAGED_SERVICE === 'c1',
    'DEX_RPC_CHILD_IDENTITY');
  if (active) { assert.equal(active.service, service, 'DEX_RPC_ONE_SERVICE_PER_PROCESS'); return; }
  const entry = path.join(__dirname, `current-dex-${service}.cjs`);
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sources = [__filename, entry];
  if (rehearsal) sources.push(path.join(__dirname, 'current-dex-c1-rehearsal.cjs'));
  const pins = sources.map(file => [file, hash(file)]);
  const check = () => pins.forEach(([file, digest]) => assert.equal(hash(file), digest, 'DEX_RPC_SOURCE_DRIFT'));
  const contractsRequire = createRequire(path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation/package.json'));
  const classes = new Set([require('ethers').FetchRequest, contractsRequire('ethers').FetchRequest]);
  const FetchRequest = contractsRequire('ethers').FetchRequest;
  const managed = process.env.CHAINWHISPER_RPC_MANAGED_SERVICE;
  assert(!process.connected || managed === service, 'DEX_RPC_CHILD_IDENTITY');
  assert(!managed || managed === service, 'DEX_RPC_CHILD_IDENTITY');
  const admission = managed ? createManagedAdmission(service) : null;
  const { agent, connections } = createAgent();
  const readUrl = FetchRequest.createGetUrlFunc({ agent }), sendUrl = FetchRequest.createGetUrlFunc();
  // Review L4: a broadcast never reuses a long-idle socket; it keeps the previous default agent.
  const getUrl = (request, signal) => (decode(request.body)?.method === 'eth_sendRawTransaction' ? sendUrl : readUrl)(request, signal);
  let c1Fence;
  const pacing = createPacing(getUrl, service === 'keeper' ? 0 : service === 'c1' ? 334 : 500, check, admission,
    service === 'keeper', { connections, ...(service==='c1'?{authorizeBroadcast:raw=>!c1Fence||c1Fence.authorize(raw)}:{}) });
  // Process-wide: includes separate provider instances, polling and broadcasts.
  for (const cls of classes) cls.registerGetUrl(pacing.getUrl);
  active = { service, pacing, bindC1Broadcast:()=>{
    assert(service==='c1'&&managed==='c1'&&process.connected&&!c1Fence,'DEX_RPC_C1_MANAGED_REQUIRED');
    c1Fence=createC1BroadcastFence();
    return c1Fence.submit;
  }};
}
const stats = () => active ? { service: active.service, ...active.pacing.stats() } : null;
function bindC1Broadcast(){
  assert(active&&!managedC1Queue,'DEX_RPC_C1_MANAGED_REQUIRED');
  managedC1Queue=active.bindC1Broadcast();
  return managedC1Queue;
}
const isManagedC1Broadcast=queue=>managedC1Queue!==undefined&&queue===managedC1Queue;
function c1DispatchDenied(error,raw){
  const hash=c1Unbroadcast.get(error);
  if(hash===undefined||typeof raw!=='string'||hash!==c1BytesDigest(raw))return false;
  c1Unbroadcast.delete(error);
  return true;
}
module.exports = { createPacing, createManagedAdmission, createAgent, createC1BroadcastFence, bindC1Broadcast,
  isManagedC1Broadcast, c1DispatchDenied, install, stats, readRetry, keepAliveIdleMs };

// Node --require keeps historical, source-bound service entries unchanged.
const selected = /^current-dex-(keeper|prices|matching|c1|c1-rehearsal)\.cjs$/.exec(path.basename(process.argv[1] ?? ''));
if (selected && !['--check', '--inspect'].includes(process.argv[2])) {
  assert.equal(path.resolve(process.argv[1]), path.join(__dirname, `current-dex-${selected[1]}.cjs`), 'DEX_RPC_ENTRY');
  const rehearsal = selected[1] === 'c1-rehearsal';
  const bootstrap = rehearsal && ['--claim','--supervise','--supervise-standing'].includes(process.argv[2]);
  if (!bootstrap) {
    if (rehearsal) assert(['--rehearse','--stand'].includes(process.argv[2]), 'DEX_RPC_ENTRY');
    install(rehearsal ? 'c1' : selected[1], rehearsal);
    process.once('exit', () => console.log(JSON.stringify({ status: 'DEX_RPC_PACING_SUMMARY', ...stats() })));
  }
}
