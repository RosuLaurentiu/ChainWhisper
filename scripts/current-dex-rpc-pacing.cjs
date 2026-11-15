'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const endpoint = 'https://testnet.coti.io/rpc';
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const decode = value => JSON.parse(new TextDecoder().decode(value));
const managedServices = new WeakMap();
// The platform default is the supported managed response ceiling, not each service's timeout.
const managedResponseCeilingMs = new (require('ethers').FetchRequest)(endpoint).timeout;
const readMethods = new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getLogs',
  'eth_getTransactionByHash','eth_getTransactionReceipt','eth_call','eth_getCode','eth_gasPrice',
  'eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_getProof']);
const safeMethod = name => readMethods.has(name) || name === 'eth_sendRawTransaction' ? name : 'other';
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
  const clear = row => { clearTimeout(row.timer); if (pending === row) pending = null; };
  const stop = code => {
    stopped ??= code;
    if (pending?.phase === 'queued') { const row = pending; clear(row); row.reject(Error(stopped)); }
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
    acquire(expires, onCancel) {
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
        send({ type: 'CHAINWHISPER_RPC_REQUEST', id: row.id, queueMs });
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

function createPacing(getUrl, gapMs = 500, checkSource = () => {}, admission = null, readBatches = false) {
  assert([0, 500, 334].includes(gapMs), 'DEX_RPC_RATE');
  assert.equal(typeof readBatches, 'boolean', 'DEX_RPC_BATCH_POLICY');
  const managed = managedServices.has(admission);
  if (managed) gapMs = 0;
  let outstanding = 0;
  let tail = Promise.resolve(), last = null, stopped = null, requests = 0, minimumGapMs = null, lastFailure = null;
  let grants = 0, physicalSettled = 0, physicalPending = 0, unresolved = 0, expired = 0, cancelled = 0, rpcCalls = 0;
  const methods = {}, statuses = {}, started = performance.now();
  const code = error => {
    const name = String(error?.message ?? '').split(/\r?\n/, 1)[0];
    return /^DEX_RPC_[A-Z0-9_]+$/.test(name) ? name : 'DEX_RPC_TRANSPORT_STOP';
  };
  function send(request, signal, item, expires, responseTimeoutMs, allRead) {
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
      const details = () => ({ method: methodNames.length === 1 ? methodNames[0] : methodNames.length ? 'batch' : null,
        methods: [...methodNames], phase, status: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null,
        providerIds: safeProviderIds(response?.headers) });
      try {
        if (stopped) throw Error(stopped);
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
        while (last !== null && performance.now() - last < gapMs) {
          const delay = Math.ceil(gapMs - (performance.now() - last));
          if (performance.now() + delay >= expires) throw Error('DEX_RPC_QUEUE_TIMEOUT');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        check();
        if (admission) { lease = await admission.acquire(expires, cancel => { cancelAdmission = cancel; }); grants++; }
        checkSource(); check();
        assert(request.url === endpoint, 'DEX_RPC_ENDPOINT');
        if (admission) admission.assertCurrent(lease);
        const single = request.clone(); single.body = JSON.stringify(item);
        // Admission expiry does not consume the physical request's finite response budget.
        single.timeout = responseTimeoutMs;
        const now = performance.now();
        if (last !== null) minimumGapMs = Math.min(minimumGapMs ?? Infinity, now - last);
        last = now; requests++; rpcCalls += items.length;
        for (const value of items) { const method = safeMethod(value.method); methods[method] = (methods[method] ?? 0) + 1; }
        entered = true; invoked = true; physicalPending++; clearTimeout(queueTimer);
        const deadline = new Promise((_, reject) => {
          responseTimer = setTimeout(() => reject(Error('DEX_RPC_RESPONSE_TIMEOUT')), single.timeout);
        });
        phase = 'transport';
        let transport;
        try { transport = Promise.resolve(getUrl(single, signal)); } catch (error) { transport = Promise.reject(error); }
        const completed = transport.then(response => {
          settled = true; physicalPending--; physicalSettled++; statusCode = response.statusCode;
          statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
          if (unresolved && lease) admission.settled(lease, statusCode);
          return response;
        }, error => {
          settled = true; physicalPending--; physicalSettled++;
          if (unresolved && lease) admission.settled(lease);
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
      } catch (error) {
        const reason = code(error);
        if (!stopped) lastFailure = { code: reason, ...details() };
        if (!invoked && ['DEX_RPC_QUEUE_TIMEOUT', 'DEX_RPC_CANCELLED'].includes(reason)) {
          if (reason === 'DEX_RPC_QUEUE_TIMEOUT' && !queueCounted) { expired++; queueCounted = true; }
          if (reason === 'DEX_RPC_CANCELLED') cancelled++;
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
    return Promise.race([work, queueDeadline]);
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
      maximumInFlight: 1, elapsedMs: Math.round(performance.now() - started), stopped })
  };
}

let active;
function install(service) {
  assert(['keeper', 'prices', 'matching', 'c1'].includes(service), 'DEX_RPC_SERVICE');
  if (active) { assert.equal(active.service, service, 'DEX_RPC_ONE_SERVICE_PER_PROCESS'); return; }
  const entry = path.join(__dirname, `current-dex-${service}.cjs`);
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const pins = [__filename, entry].map(file => [file, hash(file)]);
  const check = () => pins.forEach(([file, digest]) => assert.equal(hash(file), digest, 'DEX_RPC_SOURCE_DRIFT'));
  const contractsRequire = createRequire(path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation/package.json'));
  const classes = new Set([require('ethers').FetchRequest, contractsRequire('ethers').FetchRequest]);
  const FetchRequest = contractsRequire('ethers').FetchRequest;
  const managed = process.env.CHAINWHISPER_RPC_MANAGED_SERVICE;
  assert(!process.connected || managed === service, 'DEX_RPC_CHILD_IDENTITY');
  assert(!managed || managed === service, 'DEX_RPC_CHILD_IDENTITY');
  const admission = managed ? createManagedAdmission(service) : null;
  const pacing = createPacing(FetchRequest.createGetUrlFunc(), service === 'keeper' ? 0 : service === 'c1' ? 334 : 500, check, admission, service === 'keeper');
  // Process-wide: includes separate provider instances, polling and broadcasts.
  for (const cls of classes) cls.registerGetUrl(pacing.getUrl);
  active = { service, pacing };
}
const stats = () => active ? { service: active.service, ...active.pacing.stats() } : null;
module.exports = { createPacing, createManagedAdmission, install, stats };

// Node --require keeps historical, source-bound service entries unchanged.
const selected = /^current-dex-(keeper|prices|matching|c1)\.cjs$/.exec(path.basename(process.argv[1] ?? ''));
if (selected && !['--check', '--inspect'].includes(process.argv[2])) {
  assert.equal(path.resolve(process.argv[1]), path.join(__dirname, `current-dex-${selected[1]}.cjs`), 'DEX_RPC_ENTRY');
  install(selected[1]);
  process.once('exit', () => console.log(JSON.stringify({ status: 'DEX_RPC_PACING_SUMMARY', ...stats() })));
}
