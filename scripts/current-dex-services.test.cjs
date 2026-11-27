'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { fork, spawnSync } = require('node:child_process');
const { main, createRpcAdmission, readServerPeriod, rehearsalWorkerFile } = require('./current-dex-services.cjs');
const { createPacing, createManagedAdmission, createC1BroadcastFence, c1DispatchDenied } = require('./current-dex-rpc-pacing.cjs');
const { FetchRequest } = require('ethers');
const { install } = require('./current-dex-service-stop.cjs');
const reports = path.resolve(__dirname, '../reports');
test('a staged rehearsal selects only the worker for its exact approved graph', () => {
  assert.equal(rehearsalWorkerFile('279683c14c86a24d98f481fa3460db96a6df4649a54e8641e32cae2c4aeeeb21'),
    'current-dex-c1-convergence.cjs');
  assert.equal(rehearsalWorkerFile('9e6c03ac69178445605dc78a70e088b596684181d73b218a6a3a89e942b3af21'),
    'current-dex-c1-convergence.cjs');
  assert.equal(rehearsalWorkerFile('1a73e0205ca448e4eed5cdbbd4bb850dd87a0b08d183da20e44631fd4dd71fe7'),
    'current-dex-c1.cjs');
  assert.throws(() => rehearsalWorkerFile('279683c1'), /DEX_SERVICES_C1_STAGE_GRAPH/);
});
test('replacement preflight checks all four real workers without start authority', async () => {
  const result = await main(['--check-replacement','6f6c3efd3b6915343f9281348a1dc313cee7fe99727fac50144ec44c364e5d5f']);
  assert.equal(result.status, 'DEX_SERVICES_REPLACEMENT_CHECKED');
  assert.equal(result.graph.slice(0, 8), '9e6c03ac');
  assert.equal(result.markets, 6);
  assert.equal(result.c1WindowCommitmentWei, '323200000000000000');
  assert.equal(result.sharedOwnerReserveWei, '16000000000000000');
  assert.equal(result.keeper, 'APP_HOST_CONFIGURED_ENTRY_READY');
  assert.equal(result.prices, 'CURRENT_PRICE_SERVICE_OFFLINE_CHECKED');
  assert.equal(result.matching, 'CURRENT_MATCHING_BINDING_CHECKED');
  assert.equal(result.c1, 'WINDOW_B_C1_RUNTIME_INPUTS_CHECKED');
  assert(result.noNetwork && result.noCredentials && result.noSend);
  assert.equal(result.readyToStart, false);
  await assert.rejects(main(['--check-replacement', reports]), /DEX_SERVICES_USAGE/);
});
const completed = { keeper: 'APP_HOST_PUBLIC_CHECKED', prices: 'CURRENT_DEX_PRICES_WINDOW_COMPLETE', matching: 'MATCH_WINDOW_COMPLETE', c1: 'CURRENT_C1_OPERATOR_RETURNED' };
const rpcRequest = (id, timeout) => {
  const request = new FetchRequest('https://testnet.coti.io/rpc');
  request.body = JSON.stringify({ jsonrpc: '2.0', id, method: 'eth_blockNumber', params: ['PRIVATE_TEST_PAYLOAD'] });
  if (timeout) request.timeout = timeout;
  return request;
};
const rpcResponse = (request, statusCode = 200) => ({ statusCode, statusMessage: 'test', headers: {},
  body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(new TextDecoder().decode(request.body)).id, result: '0x1' })) });
const rpcSignal = { checkSignal() {} };
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function rpcGroup(t, transport, checkSource = () => {}, options = {}) {
  const peers = [], stops = [], messages = [];
  const group = createRpcAdmission({ onStop: reason => {
    stops.push(reason);
    for (const peer of peers) peer.target.emit('message', { type: 'CHAINWHISPER_SERVICE_STOP' });
  }, ...(options.refusal ? { refusal: options.refusal } : {}) });
  for (const name of ['keeper', 'prices', 'matching', 'c1']) {
    const child = new EventEmitter(), target = new EventEmitter(), grants = [];
    const peer = { name, child, target, grants, holdGrant: false };
    child.connected = target.connected = true;
    child.send = (message, callback) => {
      messages.push(message);
      if (peer.holdGrant && message.type === 'CHAINWHISPER_RPC_GRANT') grants.push(message);
      else target.emit('message', message);
      callback?.(null);
    };
    target.send = (message, callback) => { messages.push(message); child.emit('message', message); callback?.(null); };
    group.bind(name, child);
    peer.pacing = createPacing(request => transport(name, request), name === 'c1' ? 334 : 500,
      () => checkSource(name), createManagedAdmission(name, target), false,
      { ...(options.retry?{retry:options.retry}:{}), ...(name==='c1'?{authorizeBroadcast:options.authorizeC1Broadcast}:{}) });
    peers.push(peer);
  }
  t.after(() => { group.stop('TEST_COMPLETE'); peers.forEach(peer => peer.target.emit('message', { type: 'CHAINWHISPER_SERVICE_STOP' })); });
  return { group, peers, stops, messages };
}

test('a queued C1 broadcast loses approval before physical transport without stopping peers',async t=>{
  const fence=createC1BroadcastFence(),seen=[];
  let failAfterStart=false;
  const f=rpcGroup(t,async(name,request)=>{
    seen.push(name);
    if(name==='c1'&&failAfterStart)throw Error('DEX_RPC_C1_BROADCAST_HELD');
    return rpcResponse(request);
  },undefined,
    {authorizeC1Broadcast:fence.authorize});
  const c1=f.peers.find(peer=>peer.name==='c1'),raw='0xabcdef';
  const request=(id,bytes=raw)=>{
    const send=rpcRequest(id,1000);
    send.body=JSON.stringify({jsonrpc:'2.0',id,method:'eth_sendRawTransaction',params:[bytes]});
    return send;
  };
  let approved=true,calls=0;
  c1.holdGrant=true;
  const waiting=fence.submit(raw,()=>c1.pacing.getUrl(request(1),rpcSignal),()=>{calls++;return approved;});
  await flush();
  assert.equal(c1.grants.length,1);
  assert.equal(calls,0);
  approved=false;
  c1.target.emit('message',c1.grants.shift());
  await assert.rejects(waiting,error=>{
    assert.match(error.message,/DEX_RPC_C1_BROADCAST_HELD/);
    assert.equal(c1DispatchDenied(Error(error.message),raw),false);
    assert.equal(c1DispatchDenied(error,'0x0102'),false);
    assert.equal(c1DispatchDenied(error,raw),true);
    assert.equal(c1DispatchDenied(error,raw),false);
    return true;
  });
  assert.equal(calls,1);
  assert.deepEqual(seen,[]);
  assert.equal(f.group.stats().reserved,0);
  assert.equal(f.group.stats().perService.c1.cancelled,1);
  assert.equal(f.group.stats().perService.c1.physicalStarts,0);
  assert.deepEqual(f.stops,[]);

  c1.holdGrant=false;
  approved=true;
  await assert.rejects(fence.submit(raw,()=>c1.pacing.getUrl(request(2,'0x0102'),rpcSignal),()=>true),error=>{
    assert.match(error.message,/C1_BROADCAST_HELD/);
    assert.equal(c1DispatchDenied(error,raw),false);
    return true;
  });
  await assert.rejects(c1.pacing.getUrl(request(3),rpcSignal),/C1_BROADCAST_HELD/);
  await fence.submit(raw,()=>c1.pacing.getUrl(request(4),rpcSignal),()=>approved);
  await assert.rejects(c1.pacing.getUrl(request(5),rpcSignal),/C1_BROADCAST_HELD/);
  for(const peer of f.peers.filter(row=>row!==c1))await peer.pacing.getUrl(rpcRequest(6),rpcSignal);
  assert.deepEqual(seen,['c1','keeper','prices','matching']);
  assert.equal(f.group.stats().perService.c1.physicalStarts,1);
  failAfterStart=true;
  const attempted='0x4567';
  await assert.rejects(fence.submit(attempted,()=>c1.pacing.getUrl(request(7,attempted),rpcSignal),()=>true),error=>{
    assert.match(error.message,/DEX_RPC_C1_BROADCAST_HELD/);
    assert.equal(c1DispatchDenied(error,attempted),false);
    return true;
  });
  assert.equal(f.group.stats().perService.c1.physicalStarts,2);
  assert.equal(c1.pacing.stats().retries.total,0);
});

test('shared demand is FIFO with one aggregate slot; synthetic children retain standalone spacing', async t => {
  const starts = []; let active = 0, peak = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const fixture = rpcGroup(t, async (name, request) => {
    starts.push({ name, at: performance.now() }); peak = Math.max(peak, ++active);
    if (starts.length === 1) await held;
    active--; return rpcResponse(request);
  });
  const batch = rpcRequest(1), payload = JSON.parse(new TextDecoder().decode(batch.body));
  batch.body = JSON.stringify([payload, { ...payload, id: 5 }]);
  const jobs = [fixture.peers[0].pacing.getUrl(batch, rpcSignal)];
  await flush();
  for (let index = 1; index < 4; index++) {
    const request = rpcRequest(index + 1);
    if (index === 3) {
      const item = JSON.parse(new TextDecoder().decode(request.body));
      request.body = JSON.stringify([item, { ...item, id: 6 }]);
    }
    jobs.push(fixture.peers[index].pacing.getUrl(request, rpcSignal));
  }
  await flush();
  assert.equal(starts.length, 1); assert.equal(fixture.group.stats().queued, 3);
  assert.equal(fixture.group.stats().physicalInFlight, 1);
  release(); await Promise.all(jobs);
  assert.deepEqual(starts.slice(0, 4).map(row => row.name), ['keeper', 'prices', 'matching', 'c1']);
  for (const name of ['keeper', 'c1']) {
    const ownStarts = starts.filter(row => row.name === name);
    assert.equal(ownStarts.length, 2);
    assert(ownStarts[1].at - ownStarts[0].at >= (name === 'c1' ? 333 : 499));
  }
  assert(starts.some((row, index) => index > 0 && row.name !== starts[index - 1].name && row.at - starts[index - 1].at < 499));
  assert.equal(peak, 1);
  const stats = fixture.group.stats();
  assert.equal(stats.grants, 6); assert.equal(stats.physicalStarts, 6); assert.equal(stats.responses, 6);
  assert.equal(stats.occupiedSlots, 0); assert.equal(stats.physicalSettled, 6); assert.equal(stats.intervalMs, 0);
  assert.deepEqual(Object.fromEntries(fixture.peers.map(peer => [peer.name, peer.pacing.stats().localIntervalMs])),
    { keeper: 500, prices: 500, matching: 500, c1: 334 });
  assert.deepEqual(stats.perServiceIntervalMs, { keeper: 0, prices: 0, matching: 0, c1: 0 });
  assert.equal(JSON.stringify(fixture.messages).includes('PRIVATE_TEST_PAYLOAD'), false);
});

test('a synthetic prices IPC target cannot remove local spacing', async t => {
  const starts = [];
  const fixture = rpcGroup(t, async (name, request) => {
    starts.push(name);
    return rpcResponse(request);
  });
  const prices = fixture.peers[1].pacing;
  await prices.getUrl(rpcRequest(1), rpcSignal);
  await assert.rejects(prices.getUrl(rpcRequest(2, 20), rpcSignal), /DEX_RPC_QUEUE_TIMEOUT/);
  assert.deepEqual(starts, ['prices']);
  assert.equal(prices.stats().requests, 1);
  assert.equal(prices.stats().localIntervalMs, 500);
  assert.equal(fixture.group.stats().occupiedSlots, 0);
});

test('queued expiry and cancellation never send and release only known-unused grants', async t => {
  let sent = 0, release, activeCancel, queuedCancel;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const fixture = rpcGroup(t, async (_name, request) => { sent++; if (sent === 1) await held; return rpcResponse(request); });
  const first = fixture.peers[0].pacing.getUrl(rpcRequest(1), {checkSignal(){},addListener(fn){activeCancel=fn;}}); await flush();
  await assert.rejects(fixture.peers[1].pacing.getUrl(rpcRequest(2, 25), rpcSignal), /DEX_RPC_QUEUE_TIMEOUT/);
  assert.equal(sent, 1); assert.equal(fixture.group.stats().expired, 1); assert.equal(fixture.group.stats().stopped, null);
  let cancelled = false;
  const cancel = fixture.peers[2].pacing.getUrl(rpcRequest(3), { checkSignal() { if (cancelled) throw Error('cancelled'); },addListener(fn){queuedCancel=fn;} });
  await flush(); cancelled = true; queuedCancel(); activeCancel();
  await assert.rejects(cancel, /DEX_RPC_CANCELLED/);
  assert.equal(fixture.group.stats().occupiedSlots,1);assert.equal(fixture.group.stats().physicalInFlight,1);
  assert.equal(fixture.group.stats().cancelled,1);assert.equal(fixture.group.stats().expired,1);
  release(); await first;
  assert.equal(sent, 1); assert.equal(fixture.group.stats().cancelled, 1);
  assert.equal(fixture.group.stats().occupiedSlots, 0); assert.equal(fixture.group.stats().physicalStarts, 1);
});

test('an expired reserved grant is not a physical start and a late grant cannot bypass expiry', async t => {
  let sent = 0;
  const fixture = rpcGroup(t, async (_name, request) => { sent++; return rpcResponse(request); });
  const peer = fixture.peers[0]; peer.holdGrant = true;
  await assert.rejects(peer.pacing.getUrl(rpcRequest(1, 25), rpcSignal), /DEX_RPC_QUEUE_TIMEOUT/);
  await flush();
  assert.equal(fixture.group.stats().grants, 1); assert.equal(fixture.group.stats().physicalStarts, 0);
  assert.equal(fixture.group.stats().occupiedSlots, 0);
  peer.target.emit('message', peer.grants[0]); await flush();
  await fixture.peers[1].pacing.getUrl(rpcRequest(2), rpcSignal);
  assert.equal(sent, 1); assert.equal(fixture.group.stats().grants, 2);
});

for (const [reason, expected] of [['keeper:FAILED', 'DEX_RPC_GROUP_STOP'], ['OPERATOR_STOP', 'DEX_RPC_GROUP_STOP'], ['DEX_RPC_HTTP_403', 'DEX_RPC_HTTP_403']]) {
  test(`queued worker retains a valid rejection code when group stops for ${reason}`, async t => {
    let release, sent = 0;
    const held = new Promise(resolve => { release = resolve; });
    const fixture = rpcGroup(t, async (_name, request) => { sent++; await held; return rpcResponse(request); });
    const first = fixture.peers[0].pacing.getUrl(rpcRequest(1), rpcSignal);
    await flush();
    const waiting = fixture.peers[1].pacing.getUrl(rpcRequest(2), rpcSignal);
    await flush();
    assert.equal(fixture.group.stats().queued, 1);
    fixture.group.stop(reason);
    try { await assert.rejects(waiting, error => error.message === expected); }
    finally { release(); await first; }
    assert.equal(sent, 1);
    assert.equal(fixture.peers[1].pacing.stats().lastFailure.code, expected);
    const stats = fixture.group.stats();
    assert.equal(stats.stopped, reason);
    assert.equal(stats.physicalStarts, 1); assert.equal(stats.physicalSettled, 1);
    assert.equal(stats.stoppedBeforeStart, 1); assert.equal(stats.unresolvedOccupancy, 0);
  });
}

for (const status of [403, 429, 503]) test(`managed HTTP${status} stops siblings immediately and is a completed refusal, not unresolved work`, async t => {
  let sent = 0;
  // CW-102: with retries disabled a refusal still stops at once; the CW-102 tests cover the retry.
  const fixture = rpcGroup(t, async (_name, request) => { sent++; return rpcResponse(request, status); }, () => {},
    { retry: { delaysMs: [], maximumRetryAfterMs: 0 } });
  const results = await Promise.allSettled(fixture.peers.map((peer, index) => peer.pacing.getUrl(rpcRequest(index), rpcSignal)));
  assert(results.every(result => result.status === 'rejected')); assert.equal(sent, 1);
  const stats = fixture.group.stats();
  assert.equal(stats.stopped, `DEX_RPC_HTTP_${status}`); assert.equal(stats.physicalStarts, 1);
  assert.equal(stats.responses, 1); assert.equal(stats.physicalSettled, 1);
  assert.equal(stats.occupiedSlots, 0); assert.equal(stats.unresolvedOccupancy, 0);
  assert.equal(stats.statuses[status], 1);
});

test('an unfulfilled physical timeout retains unresolved occupancy after rejection and after a late response', async t => {
  let release, sent = 0;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const fixture = rpcGroup(t, async (_name, request) => { sent++; await held; return rpcResponse(request); });
  const first = fixture.peers[0].pacing.getUrl(rpcRequest(1, 30), rpcSignal);
  const waiting = fixture.peers[1].pacing.getUrl(rpcRequest(2), rpcSignal);
  const result = await Promise.allSettled([first, waiting]);
  assert(result.every(row => row.status === 'rejected')); assert.equal(sent, 1);
  assert.equal(fixture.group.stats().stopped, 'DEX_RPC_RESPONSE_TIMEOUT');
  assert.equal(fixture.group.stats().occupiedSlots, 1); assert.equal(fixture.group.stats().physicalInFlight, 1);
  assert.equal(fixture.group.stats().unresolvedOccupancy, 1);
  release(); await flush();
  assert.equal(fixture.group.stats().physicalInFlight, 0); assert.equal(fixture.group.stats().physicalSettled, 1);
  assert.equal(fixture.group.stats().responses, 1); assert.equal(fixture.group.stats().occupiedSlots, 1);
  await assert.rejects(fixture.peers[2].pacing.getUrl(rpcRequest(3), rpcSignal)); assert.equal(sent, 1);
});

test('a pre-send source failure stops the group without turning an unused reservation into a start', async t => {
  let checks = 0, sent = 0;
  const fixture = rpcGroup(t, async (_name, request) => { sent++; return rpcResponse(request); },
    name => { if (name === 'keeper' && ++checks === 2) throw Error('DEX_RPC_SOURCE_DRIFT'); });
  const results = await Promise.allSettled(fixture.peers.slice(0, 2).map((peer, index) => peer.pacing.getUrl(rpcRequest(index), rpcSignal)));
  assert(results.every(result => result.status === 'rejected')); assert.equal(sent, 0);
  assert.equal(fixture.group.stats().stopped, 'DEX_RPC_SOURCE_DRIFT');
  assert.equal(fixture.group.stats().grants, 1); assert.equal(fixture.group.stats().physicalStarts, 0);
  assert.equal(fixture.group.stats().occupiedSlots, 0);
  assert.equal(fixture.group.stats().stoppedBeforeStart, 2);
});

test('an ambiguous transport rejection keeps its occupied slot and stops sibling admissions', async t => {
  let sent = 0;
  // CW-102: with retries disabled; a retried read is covered by the CW-102 tests.
  const fixture = rpcGroup(t, async () => { sent++; throw Error('synthetic transport failure'); }, () => {},
    { retry: { delaysMs: [], maximumRetryAfterMs: 0 } });
  const results = await Promise.allSettled(fixture.peers.map((peer, index) => peer.pacing.getUrl(rpcRequest(index), rpcSignal)));
  assert(results.every(result => result.status === 'rejected')); assert.equal(sent, 1);
  const stats = fixture.group.stats();
  assert.equal(stats.stopped, 'DEX_RPC_TRANSPORT_STOP'); assert.equal(stats.responses, 0);
  assert.equal(stats.physicalSettled, 1); assert.equal(stats.physicalInFlight, 0);
  assert.equal(stats.unresolvedOccupancy, 1); assert.equal(stats.occupiedSlots, 1);
});

for (const kind of ['identity', 'duplicate']) test(`the supervisor refuses a ${kind} admission violation`, async t => {
  const fixture = rpcGroup(t, async (_name, request) => rpcResponse(request));
  const peer = fixture.peers[0];
  peer.child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: kind === 'identity' ? 'prices' : 'keeper', id: 1, queueMs: 1000 });
  if (kind === 'duplicate') peer.child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: 'keeper', id: 2, queueMs: 1000 });
  assert.equal(fixture.group.stats().stopped, 'DEX_RPC_IPC_PROTOCOL');
  assert.equal(fixture.group.stats().physicalStarts, 0);
  assert.equal(fixture.group.stats().grants, kind === 'identity' ? 0 : 1);
});

for (const phase of ['reserved', 'started']) test(`child loss while ${phase} retains unknown occupancy and never grants a replacement`, async t => {
  let sent = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const fixture = rpcGroup(t, async (_name, request) => { sent++; await held; return rpcResponse(request); });
  const peer = fixture.peers[0]; peer.holdGrant = phase === 'reserved';
  const first = peer.pacing.getUrl(rpcRequest(1, 40), rpcSignal);
  const waiting = fixture.peers[1].pacing.getUrl(rpcRequest(2), rpcSignal);
  const settled = Promise.allSettled([first, waiting]); await flush();
  peer.child.connected = peer.target.connected = false;
  peer.child.emit('disconnect'); peer.target.emit('disconnect');
  await settled;
  const stats = fixture.group.stats();
  assert.equal(stats.occupiedSlots, 1); assert.equal(stats.unresolvedOccupancy, 1); assert.equal(stats.unknownInFlight, 1);
  assert.equal(stats.grants, 1); assert.equal(sent, phase === 'reserved' ? 0 : 1);
  assert.throws(() => fixture.group.bind('keeper', new EventEmitter()), /DEX_RPC_CHILD_IDENTITY/);
  release(); await flush();
  assert.equal(fixture.group.stats().occupiedSlots, 1);
});

function folder(t, parent=reports, prefix='service-group-test-') {
  const directory = path.join(parent, prefix + require('node:crypto').randomBytes(8).toString('hex'));
  fs.mkdirSync(directory);
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(parent));
    assert(path.basename(directory).startsWith(prefix));
    fs.rmSync(directory, { recursive: true });
  });
  return directory;
}
function children(overrides = {}) {
  const calls = [];
  const spawn = (entry, args, options) => {
    const name = /^current-dex-(.*)\.cjs$/.exec(path.basename(entry))[1];
    const child = new EventEmitter();
    Object.assign(child, { connected: true, pid: 1000 + calls.length, messages: [], send(message, callback) { this.messages.push(message); callback(); } });
    calls.push({ name, child, entry, args, options });
    queueMicrotask(() => {
      fs.writeSync(options.stdio[1], JSON.stringify({ status: overrides[name] ?? completed[name] }) + '\n');
      fs.writeSync(options.stdio[1], JSON.stringify({ status: 'DEX_RPC_PACING_SUMMARY', service: name, stopped: null, requests: 0 }) + '\n');
      child.connected = false; child.emit('close', 0, null);
    });
    return child;
  };
  return { calls, spawn };
}

function operatingChildren(onSpawn, onStop = row => row.close()) {
  const calls = [];
  const spawn = (entry, args, options) => {
    const name = args[0] === '--stand' ? 'c1' : /^current-dex-(.*)\.cjs$/.exec(path.basename(entry))[1];
    const child = new EventEmitter();
    const row = { name, child, args, options, run: calls.filter(call => call.name === name).length + 1,
      grants: [], started: [], closed: false,
      close(code = 0) {
        if (row.closed) return;
        row.closed = true; row.closedAt = performance.now(); child.connected = false; child.emit('disconnect'); child.emit('close', code, null);
      },
      async complete({ result = {}, stderr = null, requests = 0, traffic = {}, clean = true, close = true, code = 0, retried = 0 } = {}) {
        // CW-102: each retried read is one settled physical attempt followed by a new admission.
        for (let id = 1; id <= retried; id++) {
          await new Promise(resolve => {
            row.grants.push(resolve);
            child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: name, id, queueMs: 2000, read: true });
          });
          child.emit('message', { type: 'CHAINWHISPER_RPC_STARTED', service: name, id });
          child.emit('message', { type: 'CHAINWHISPER_RPC_RETRY', service: name, id, code: 'DEX_RPC_HTTP_503', statusCode: 503, waitMs: 0 });
        }
        for (let id = retried + 1; id <= retried + requests; id++) {
          await new Promise(resolve => {
            row.grants.push(resolve);
            child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: name, id, queueMs: 2000 });
          });
          row.started.push(performance.now());
          child.emit('message', { type: 'CHAINWHISPER_RPC_STARTED', service: name, id });
          child.emit('message', { type: 'CHAINWHISPER_RPC_RESPONSE', service: name, id, statusCode: 200 });
        }
        if (stderr) fs.writeSync(options.stdio[2], JSON.stringify(stderr) + '\n');
        else fs.writeSync(options.stdio[1], JSON.stringify({ status: completed[name], ...result }) + '\n');
        fs.writeSync(options.stdio[1], JSON.stringify({ status: 'DEX_RPC_PACING_SUMMARY', service: name,
          stopped: null, requests: requests + retried, physicalSettled: requests + retried, physicalPending: 0, unresolvedOccupancy: 0,
          statuses: requests ? { 200: requests } : {}, ...(retried ? { retries: { total: retried } } : {}), ...traffic }) + '\n');
        if (clean) child.emit('message', { type: 'CHAINWHISPER_RPC_IDLE_EXIT', service: name, id: requests + retried + 1 });
        if (close) row.close(code);
      }
    };
    Object.assign(child, { connected: true, pid: 3000 + calls.length,
      send(message, callback) {
        callback?.(null);
        if (message.type === 'CHAINWHISPER_RPC_GRANT') row.grants.shift()?.();
        if (message.type === 'CHAINWHISPER_C1_REHEARSAL') row.rehearsalAdmission = message;
        if (message.type === 'CHAINWHISPER_C1_STANDING') row.standingAdmission = message;
        if (message.type === 'CHAINWHISPER_SERVICE_STOP') queueMicrotask(() => onStop(row));
      }
    });
    calls.push(row); queueMicrotask(() => onSpawn?.(row)); return child;
  };
  return { calls, spawn };
}

function serverPeriod(t,standing=false,runParent=reports,prefix,installedManifest,graph=require('./current-dex-service-watchdog.cjs').CONFIG.graph) {
  const directory=folder(t,runParent,prefix),manifest=installedManifest??path.join(folder(t),'runtime-public.json');
  if(!installedManifest)fs.writeFileSync(manifest,JSON.stringify({graph}));
  const policy={schema:'CURRENT_DEX_SERVER_PERIOD_V1',graph,
    maximumMs:86400000,maximumNewFeeWei:'2000000000000000000',startedAt:Date.now(),expiresAt:Date.now()+86400000,
    runtimeManifestSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'),approvalSha256:'a'.repeat(64)};
  policy.expiresAt=policy.startedAt+policy.maximumMs;
  if(standing)Object.assign(policy,{mode:'standing',maximumMs:null,expiresAt:null,maximumNewFeeWei:null,priorSpentFeeWei:'796447789500000000'});
  const file=path.join(directory,'period-policy.json'),write=()=>fs.writeFileSync(file,JSON.stringify(policy));write();
  return {directory,policy,write,read:(dir,now=Date.now())=>readServerPeriod(dir,now,manifest,graph)};
}
function rehearsalPeriod(t,runParent=reports,installedManifest){
  const {CONFIG,reconcileRehearsalStop}=require('./current-dex-service-watchdog.cjs');
  const f=serverPeriod(t,true,runParent,'server-beta-rehearsal-test-',installedManifest,CONFIG.graph);
  const base=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates');
  const {pins}=require(path.join(base,'c1-band-sizing-2026-11-21/candidate.cjs'));
  const binding={graph:pins.graph,manifest:pins.manifest};
  const operator=CONFIG.actors.c1.address;
  const {createHash,randomBytes}=require('node:crypto'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const priorRun='server-beta-c1-check-'+randomBytes(8).toString('hex'),priorDirectory=path.join(runParent,priorRun);
  fs.mkdirSync(priorDirectory);
  const priorFile=path.join(priorDirectory,'group.json'),stopFile=path.join(priorDirectory,'stop-request.json');
  t.after(()=>{fs.unlinkSync(priorFile);fs.unlinkSync(stopFile);fs.rmdirSync(priorDirectory);});
  const priorRuntimeManifestSha256=CONFIG.runtimeManifestSha256;
  const sends={keeper:1,prices:0,matching:0,c1:1};
  const carry=f.policy.priorSpentFeeWei,finishedAt=new Date(Date.now()-1000).toISOString();
  const baselineCarry=String(BigInt(carry)-3n);
  const priorApproval=JSON.stringify({schema:'CHAINWHISPER_BETA_SERVICE_APPROVAL_V1',approvedByOwner:true,
    runName:priorRun,graph:f.policy.graph,mode:'standing',runtimeManifestSha256:priorRuntimeManifestSha256,
    priorSpentFeeWei:baselineCarry,gasPriceWei:'50000000',maximumNewFeeWei:null,expiresAt:null,noNewFunding:true});
  const priorApprovalSha256=sha(priorApproval);
  f.policy.approvalSha256=priorApprovalSha256;f.write();
  const prior=JSON.stringify({status:'STOPPED',stopReason:'OPERATOR_STOP',noAutomaticRestart:true,
    period:{graph:f.policy.graph,mode:'standing',runtimeManifestSha256:priorRuntimeManifestSha256,approvalSha256:priorApprovalSha256,
      priorSpentFeeWei:baselineCarry},settledFeeWei:carry,
    finishedAt,rpc:{physicalInFlight:0,unknownInFlight:0,unresolvedOccupancy:0},
    runs:Object.fromEntries(Object.entries(sends).map(([name,count])=>
      [name,[{status:'PASSED',traffic:{physicalPending:0,unresolvedOccupancy:0,methods:{eth_sendRawTransaction:count}}}]]))});
  fs.writeFileSync(priorFile,prior);fs.writeFileSync(stopFile,'');
  const graph=binding.graph,replacementBindingSha256='a5'.repeat(32),issuedAt=Math.floor(Date.now()/1000);
  const senderDirectory=fs.realpathSync.native(folder(t));
  if(process.platform==='linux')fs.chmodSync(senderDirectory,0o700);
  const senderStat=fs.statSync(senderDirectory,{bigint:true});
  const senderLock={directory:senderDirectory,device:String(senderStat.dev),inode:String(senderStat.ino)};
  const manifest={binding,replacementBindingSha256,operator,pairs:{2:{}},
    policy:{coverage:'tier-passes-v2',now:issuedAt,totalWei:'323200000000000000'}};
  const body={manifest,sources:{'operator/runtime':'cc'.repeat(32)},senderLock},bundle={...body,hash:sha(JSON.stringify(body))};
  const approval={schema:'CHAINWHISPER_C1_REHEARSAL_APPROVAL_V1',approvedByOwner:true,graph,chainId:'7082400',
    operator,signer:'systemd-c1',runName:path.basename(f.directory),bindingSha256:replacementBindingSha256,
    periodApprovalSha256:f.policy.approvalSha256,runtimeManifestSha256:f.policy.runtimeManifestSha256,
    maximumCommittedWei:manifest.policy.totalWei,bundleHash:bundle.hash,priorRun,priorGroupSha256:sha(prior),priorRuntimeManifestSha256,
    stagedRuntimeManifestSha256:'ed'.repeat(32),
    stagedRuntimeRoot:path.join(reports,'c1-local-unused-stage'),senderLock,
    issuedAt,expiresAt:issuedAt+1800};
  const approvalFile=path.join(f.directory,'c1-rehearsal-approval.json'),bundleFile=path.join(f.directory,'c1-rehearsal-bundle.json');
  const writeApproval=()=>{
    const bytes=JSON.stringify(approval);
    fs.writeFileSync(approvalFile,bytes);
    Object.assign(f.policy,{replacementBindingSha256,c1RehearsalSha256:sha(bytes)});f.write();
  };
  const journals=Object.fromEntries(CONFIG.services.map(name=>[name,
    {service:name,journals:[{path:`j/${name}.jsonl`,sha256:sha(name)}]}]));
  const reconciliation=reconcileRehearsalStop({priorRun,nextRun:approval.runName,priorGroupSha256:sha(prior),priorApprovalSha256}, {
    now:()=>Date.parse(finishedAt),
    readBytes:file=>file===CONFIG.approvalFile?priorApproval:fs.readFileSync(priorFile),
    exists:file=>file===`${CONFIG.runParent}/${priorRun}/stop-request.json`&&fs.existsSync(stopFile),
    pinned:()=>({}),unitState:()=>({MainPID:'0',ActiveState:'inactive',Restart:'no'}),
    readState:()=>({schema:'CW101_WATCHDOG_STATE_V1',restarts:[],baselines:{[priorRun]:{
      nonces:Object.fromEntries(CONFIG.services.map(name=>[name,'0'])),feesAfter:journals,carry:baselineCarry}}}),
    facts:()=>({locks:[],c1:{pendingHash:null,hashless:false,activePair:null,halt:null,renewalPending:false,queuedPairs:[]},
      price:{pending:null,stopped:true,pendingRecordMarket:null},accounting:journals,feeError:null,
      deltas:{keeper:'1',prices:'0',matching:'0',c1:'2'}})
  });
  const reconciliationFile=path.join(f.directory,'STOPPED_SERVICES_RECONCILED.json');
  const writeReconciliation=()=>{
    const bytes=JSON.stringify(reconciliation);
    fs.writeFileSync(reconciliationFile,bytes);
    approval.priorReconciliationSha256=sha(bytes);
    writeApproval();
  };
  writeReconciliation();fs.writeFileSync(bundleFile,JSON.stringify(bundle));
  return {...f,approval,approvalFile,bundle,bundleFile,priorFile,graph,replacementBindingSha256,writeApproval,
    reconciliation,reconciliationFile,writeReconciliation};
}
test('asynchronous baseline accounting stops before any child is spawned', async t => {
  const f=serverPeriod(t,true), signals=new EventEmitter(), fixture=operatingChildren();
  let release; const held=new Promise(resolve=>{release=resolve;});
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:()=>held,feeDelta:()=> '0'});
  await flush();
  try { assert.equal(fixture.calls.length,0); }
  finally { signals.emit('SIGINT');release({feeWei:'0'});await running; }
  assert.equal(fixture.calls.length,0);
});

test('concurrent accounting baselines reserve each service fee exactly once', async t => {
  const f=serverPeriod(t,true), signals=new EventEmitter(), fixture=operatingChildren(), releases=new Map(), calls=new Map();
  const feeSnapshot=name=>{calls.set(name,(calls.get(name)||0)+1);return calls.get(name)===1?new Promise(resolve=>releases.set(name,()=>resolve({service:name,feeWei:'0'}))):{service:name,feeWei:'0'};};
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot,feeDelta:()=> '0'});
  await flush();
  try {
    for(const release of [...releases.values()].reverse())release();await flush();
    assert.equal(fixture.calls.length,4);
    const g=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));
    const expected=Object.values(g.runs).flat().reduce((n,row)=>n+BigInt(row.feeLimitWei),BigInt(f.policy.priorSpentFeeWei)+1500000000000n);
    assert.equal(BigInt(g.feeCommitmentWei),expected);
  } finally { signals.emit('SIGINT');for(const release of releases.values())release();await running; }
});

test('closing accounting yields to keeper RPC and prevents premature C1 replacement', {timeout:10000}, async t => {
  const f=serverPeriod(t,true),signals=new EventEmitter(),calls=new Map();let release,keeperCompleted=false;
  const held=new Promise(resolve=>{release=resolve;});
  const fixture=operatingChildren(row=>{if(row.name==='c1'&&row.run===1)void row.complete();},row=>{if(row.name==='keeper'&&keeperCompleted)row.close();else void row.complete();});
  const feeSnapshot=name=>{calls.set(name,(calls.get(name)||0)+1);return name==='c1'&&calls.get(name)===2?held:{service:name,feeWei:'0'};};
  const feeDelta=(before,after)=>{assert.equal(before.service,after.service);return '0';};
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot,feeDelta});
  await flush();
  try {
    assert.equal(calls.get('c1'),2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'group.json'))).stopReason,undefined);
    const keeper=fixture.calls.find(row=>row.name==='keeper');
    await keeper.complete({requests:1,close:false});keeperCompleted=true;
    // CW-151: RPC counters reach group.json within about one second, not on every message.
    const g=await groupWhen(f,group=>group.rpc.perService.keeper.responses===1);
    assert.equal(g.rpc.perService.keeper.responses,1);assert.equal(g.stopReason,undefined);
    assert.equal(fixture.calls.filter(row=>row.name==='c1').length,1);
    assert.equal(g.runs.c1[0].actualFeeWei,undefined);
  } finally { signals.emit('SIGINT');release({service:'c1',feeWei:'0'});await running; }
  const final=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));
  assert.equal(final.runs.c1[0].actualFeeWei,'0');assert.equal(fixture.calls.filter(row=>row.name==='c1').length,1);
});

test('standing policy requires an explicit mode and exact null deadline fields',t=>{
 const f=serverPeriod(t,true);assert.equal(f.read(f.directory).mode,'standing');
 for(const patch of [{mode:undefined},{mode:'period'},{mode:'unlimited'},{maximumMs:86400000},{expiresAt:Date.now()+86400000},{maximumNewFeeWei:'2000000000000000001'},{startedAt:Date.now()+1000},{priorSpentFeeWei:undefined},{priorSpentFeeWei:'-1'},{priorSpentFeeWei:'01'},{priorSpentFeeWei:0},{maximumNewFeeWei:'3000000000000000000'}]){
  const before={...f.policy};Object.assign(f.policy,patch);f.write();assert.throws(()=>f.read(f.directory));Object.assign(f.policy,before);f.write();
 }
 f.policy.priorSpentFeeWei='4000000000000000000';f.write();
 assert.equal(f.read(f.directory).priorSpentFeeWei,'4000000000000000000');
 assert.equal(f.read(f.directory,Date.now()+2*86400000).expiresAt,null);
});

test('standing service renews beyond 24 hours and the old 48-run keeper limit without scheduling an overall timer',async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();let clock=0;
 let initial;
 const timeouts=[],schedule=setTimeout;t.mock.method(global,'setTimeout',(callback,delay,...args)=>{timeouts.push(delay);return schedule(callback,delay,...args);});
 t.mock.method(performance,'now',()=>clock);
 const fixture=operatingChildren(row=>{
  if(row.name!=='keeper')return;
  if(row.run===1)clock=2*86400000;
  if(row.run===61)signals.emit('SIGINT');else void row.complete();
 });
 const result=await main(['--serve',f.directory],{spawn:(...args)=>{initial??=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));return fixture.spawn(...args);},signals,readPeriod:f.read,feeSnapshot:name=>({service:name,feeWei:'0'}),feeDelta:()=> '100000000000000000'});
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(result.maximumNewWorkMs,null);assert.equal(result.runs.keeper.length,50);
 // CW-151: 61 keeper runs keep the last 50, exact totals of the first 11 and monotonic run numbers.
 assert.deepEqual(result.runs.keeper.map(row=>row.run),Array.from({length:50},(_,index)=>index+12));
 assert.equal(path.basename(result.runs.keeper.at(-1).stdout),'keeper.run-61.stdout.log');
 // The fixture summaries carry no method counts, so the watchdog would hold these runs as missing traffic, as in a full history.
 assert.deepEqual(result.evictedRuns.keeper,{runs:11,sends:0,missingTraffic:11,accountingErrors:0,openTraffic:0,firstIssue:'WATCHDOG_TRAFFIC_MISSING',
  settledFeeWei:'1100000000000000000',committedFeeWei:'1100000000000000000',statuses:{RETURNED:11}});
 assert.equal(result.retainedRunsPerService,50);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.directory,'group.json'),'utf8')),JSON.parse(JSON.stringify(result)),'the final state is written');
 assert(Object.values(result.operatingPolicy.services).every(policy=>policy.maximumRuns===null));
 assert.equal(result.operatingPolicy.maximumFeeCommitmentWei,null);
 assert.equal(BigInt(result.settledFeeWei),BigInt(f.policy.priorSpentFeeWei)+6000000000000000000n);
 assert.equal(result.operatingPolicy.oneOffFundingFeeReserveWei,'1500000000000');
 assert.equal(initial.feeCommitmentWei,String(BigInt(f.policy.priorSpentFeeWei)+1500000000000n));
 assert.equal(initial.settledFeeWei,f.policy.priorSpentFeeWei);
 assert.equal(BigInt(result.feeCommitmentWei),Object.values(result.runs).flat().reduce((total,row)=>total+BigInt(row.actualFeeWei??row.feeLimitWei),BigInt(f.policy.priorSpentFeeWei)+1500000000000n+
  Object.values(result.evictedRuns).reduce((total,row)=>total+BigInt(row.committedFeeWei),0n)));
 assert(BigInt(result.feeCommitmentWei)>3000000000000000000n);
 assert.deepEqual(timeouts,[]);
});

test('standing C1 waits for expiry and accounts recovery before replacement without stopping keeper',async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const fixture=operatingChildren(row=>{
  if(row.name!=='c1')return;
  if(row.run<=2)void row.complete({result:{result:row.run===1?{mode:'EXISTING_EXPIRY_WAIT',noSign:true,noSend:true}:{mode:'EXISTING_EXPIRY_ONLY',result:{status:'CONFIRMED',action:6}},state:{pendingHash:null,hashless:false,halt:null,activePair:row.run===1?'1':null}}});
  else signals.emit('SIGINT');
 });
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name,feeWei:'0'}),feeDelta:()=> '0'});
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(result.runs.c1.length,3);assert.equal(result.runs.keeper.length,1);
 for(const row of result.runs.c1.slice(0,2)){assert.equal(row.status,'RETURNED');assert.equal(row.actualFeeWei,'0');assert.equal(row.traffic.requests,0);}
 assert.equal(result.runs.c1[0].result.state.activePair,'1');assert.equal(result.runs.c1[1].result.state.activePair,null);
});

test('standing C1 continues a clean saved catch-up batch without stopping the keeper',async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const fixture=operatingChildren(row=>{
  if(row.name!=='c1')return;
  if(row.run===1)void row.complete({result:{result:{mode:'FINITE_C1',results:[],catchUp:{polls:256,scanned:2048,triggers:0,complete:false}}}});
  else signals.emit('SIGINT');
 });
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name,feeWei:'0'}),feeDelta:()=> '0'});
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(result.runs.c1.length,2);assert.equal(result.runs.c1[0].status,'RETURNED');assert.equal(result.runs.c1[0].actualFeeWei,'0');
 assert.equal(result.runs.keeper.length,1);assert.equal(fixture.calls.filter(row=>row.name==='c1').length,2);
});

for(const fault of ['none','accounting','pending','transport','pending-send','pending-journal','fee-overrun'])test(`C1 estimate rejection isolates only with safe boundary: ${fault}`,async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();const fixture=operatingChildren(row=>{
  if(row.name==='c1')void row.complete({code:1,requests:1,result:{status:'CURRENT_C1_STOP',...(fault==='pending-send'?{state:{pendingHash:'0xtest'}}:{})},traffic:{...(fault==='pending'?{physicalPending:1}:{}),...(fault==='transport'?{stopped:'DEX_RPC_TRANSPORT_STOP'}:{}),lastFailure:{code:'DEX_RPC_ERROR_RESPONSE',method:'eth_estimateGas',phase:'rpc-response',status:200,rpcCode:3}}});
 });
 let c1Snapshots=0;
 const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>{if(name==='c1'&&++c1Snapshots===2&&fault==='pending-journal')throw Error('DEX_SERVICE_FEES_UNRESOLVED');return{service:name};},feeDelta:(_,b)=>{if(fault==='accounting'&&b.service==='c1')throw Error('UNCERTAIN_ACCOUNTING');return fault==='fee-overrun'&&b.service==='c1'?'79200000000000001':'10';}});
 try{
  await flush();
  if(fault==='none'){
   const g=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));assert.equal(g.services.c1.status,'HELD');assert.equal(g.services.c1.actualFeeWei,'10');assert.equal(g.stopReason,undefined);
   assert(fixture.calls.filter(r=>r.name!=='c1').every(r=>!r.closed));
   await fixture.calls.find(r=>r.name==='keeper').complete();await flush();assert.equal(fixture.calls.filter(r=>r.name==='keeper').length,2);assert.equal(fixture.calls.filter(r=>r.name==='c1').length,1);
  }else{const result=await running;assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'c1:FAILED');}
 }finally{signals.emit('SIGINT');await running;}
});

for(const fault of ['none','rpc','source','accounting','pending-journal','transport'])test(`C1 nonce stderr failure isolates only a settled accounted local admission: ${fault}`,async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();let snapshots=0;
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr:{status:'CURRENT_C1_STOP',guard:fault==='source'?'C1_CURRENT_SOURCE_DRIFT':'C1_CURRENT_PENDING_NONCE',code:'ERR_ASSERTION'},traffic:{...(fault==='rpc'?{lastFailure:{code:'DEX_RPC_ERROR_RESPONSE',method:'eth_getTransactionCount',status:200,rpcCode:-32000}}:{}),...(fault==='transport'?{stopped:'DEX_RPC_TRANSPORT_STOP'}:{})}});});
 const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>{if(name==='c1'&&++snapshots===2&&fault==='pending-journal')throw Error('DEX_SERVICE_FEES_UNRESOLVED');return{service:name};},feeDelta:(_,b)=>{if(b.service==='c1'&&fault==='accounting')throw Error('UNCERTAIN_ACCOUNTING');return '0';}});
 try{
  await flush();
  if(fault==='none'){
   const g=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));assert.equal(g.services.c1.status,'HELD');assert.equal(g.services.c1.holdReason,'C1_CURRENT_PENDING_NONCE');assert(!g.stopReason);
   assert(fixture.calls.filter(row=>row.name!=='c1').every(row=>!row.closed));
   await fixture.calls.find(row=>row.name==='keeper').complete();await flush();assert.equal(fixture.calls.filter(row=>row.name==='keeper').length,2);assert.equal(fixture.calls.filter(row=>row.name==='c1').length,1);
  }else{assert.equal((await running).stopReason,'c1:FAILED');}
 }finally{signals.emit('SIGINT');await running;}
});

// CW-116: on 2026-11-18 slow RPC answers made the read-only C1 window build pass its 90 s head age; the group stopped for 49 hours.
const c1WindowStop=(guard,extra={})=>({status:'CURRENT_C1_STOP',guard,code:'ERR_ASSERTION',locations:['runtime.cjs:151:2'],noAutomaticRetry:true,reconcileSavedJournalBeforeRetry:true,...extra});
const c1BuildTraffic={rpcCalls:3,methods:{eth_chainId:1,eth_getBlockByNumber:1,eth_getCode:1}};
for(const guard of ['C1_CURRENT_HEAD_AGE','C1_CURRENT_READ_BOUND'])test(`a C1 window build stopped by ${guard} skips that window and starts the next one`,async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const fixture=operatingChildren(row=>{
  if(row.name!=='c1')return;
  if(row.run===1)void row.complete({code:1,requests:3,stderr:c1WindowStop(guard),traffic:c1BuildTraffic});
  else if(row.run===2)void row.complete();
  else signals.emit('SIGINT');
 });
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0',c1WindowRetryWaitMs:1});
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(result.runs.c1.length,3);
 const [skipped,returned]=result.runs.c1;
 assert.equal(skipped.status,'SKIPPED');assert.equal(skipped.skipReason,guard);assert.equal(skipped.consecutiveSkips,1);assert.equal(skipped.actualFeeWei,'0');assert.equal(skipped.code,1);
 assert.equal(skipped.noAutomaticRestart,undefined);assert.equal(returned.status,'RETURNED');
 // The other services never stopped for it, and the skipped window holds no fee commitment.
 for(const name of ['keeper','prices','matching'])assert.equal(result.runs[name].length,1);
 assert.equal(BigInt(result.settledFeeWei),BigInt(f.policy.priorSpentFeeWei));
});

for(const fault of ['send','estimate','no-methods','rpc','transport','accounting','nonzero-fee','pending-journal','other-guard','no-code','state','pending','request-count','read-count','no-read-count'])test(`a C1 window stop is skipped only at a proven read-only boundary: ${fault}`,async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();let snapshots=0;
 const methods=fault==='send'?{eth_getCode:1,eth_sendRawTransaction:1}:fault==='estimate'?{eth_getCode:1,eth_estimateGas:1}:c1BuildTraffic.methods;
 // A read bound reached by count (600 reads) is a fixed property of the build; only the time bound is slow RPC.
 const stderr=c1WindowStop(fault==='other-guard'?'C1_CURRENT_REORG':/read-count/.test(fault)?'C1_CURRENT_READ_BOUND':'C1_CURRENT_HEAD_AGE',{...(fault==='no-code'?{code:null}:{}),...(fault==='state'?{state:{pendingHash:'0xtest'}}:{})});
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr,traffic:{...(fault==='no-methods'?{}:{methods}),...(fault==='read-count'?{rpcCalls:600}:fault==='no-read-count'?{}:{rpcCalls:3}),...(fault==='request-count'?{requests:2}:{}),
  ...(fault==='rpc'?{lastFailure:{code:'DEX_RPC_ERROR_RESPONSE',method:'eth_call',status:200,rpcCode:-32000}}:{}),...(fault==='transport'?{stopped:'DEX_RPC_TRANSPORT_STOP'}:{}),...(fault==='pending'?{physicalPending:1}:{})}});});
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,c1WindowRetryWaitMs:1,
  feeSnapshot:name=>{if(name==='c1'&&++snapshots===2&&fault==='pending-journal')throw Error('DEX_SERVICE_FEES_UNRESOLVED');return{service:name};},
  feeDelta:(_,b)=>{if(b.service==='c1'&&fault==='accounting')throw Error('UNCERTAIN_ACCOUNTING');return b.service==='c1'&&fault==='nonzero-fee'?'1':'0';}});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'c1:FAILED');assert.equal(result.runs.c1.length,1);assert.equal(result.runs.c1[0].status,'FAILED');
});

test('consecutive skipped C1 windows wait longer each time and a returned window resets the count',{timeout:10000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter(),spawned=[];
 const fixture=operatingChildren(row=>{
  if(row.name!=='c1')return;spawned.push(performance.now());
  if(row.run<=3||row.run===5)void row.complete({code:1,requests:1,stderr:c1WindowStop('C1_CURRENT_HEAD_AGE'),traffic:c1BuildTraffic});
  else if(row.run===4)void row.complete();
  else signals.emit('SIGINT');
 });
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0',c1WindowRetryWaitMs:40});
 assert.deepEqual(result.runs.c1.map(row=>row.status),['SKIPPED','SKIPPED','SKIPPED','RETURNED','SKIPPED','FAILED']);
 assert.deepEqual(result.runs.c1.map(row=>row.consecutiveSkips),[1,2,3,undefined,1,undefined]);
 assert.deepEqual(result.runs.c1.map(row=>row.retryAfterMs),[40,80,120,undefined,40,undefined]);
 const closed=fixture.calls.filter(row=>row.name==='c1').map(row=>row.closedAt),gaps=[1,2,3,4,5].map(i=>spawned[i]-closed[i-1]);
 // Each next start comes no earlier than its recorded wait (the fixture's own start overhead adds to every gap).
 assert(gaps[0]>=38&&gaps[1]>=78&&gaps[2]>=118&&gaps[4]>=38,JSON.stringify(gaps));
});

test('an operator stop during the wait after a skipped C1 window ends the group without another C1 start',{timeout:5000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr:c1WindowStop('C1_CURRENT_HEAD_AGE'),traffic:c1BuildTraffic});});
 const started=performance.now(),running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0',c1WindowRetryWaitMs:60000});
 let group;for(let waited=0;waited<3000;waited+=20){group=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));if(group.services.c1?.status==='SKIPPED')break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(group.services.c1.status,'SKIPPED');assert.equal(group.stopReason,undefined);
 assert(fixture.calls.filter(row=>row.name!=='c1').every(row=>!row.closed));
 signals.emit('SIGINT');const result=await running;
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(fixture.calls.filter(row=>row.name==='c1').length,1);assert(performance.now()-started<3000);
});

test('after 10 consecutive skipped windows C1 alone is held and the other services continue',{timeout:10000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr:c1WindowStop('C1_CURRENT_HEAD_AGE'),traffic:c1BuildTraffic});});
 const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0',c1WindowRetryWaitMs:1});
 try{
  let group;for(let waited=0;waited<8000;waited+=20){group=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));if(group.services.c1?.status==='HELD')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.deepEqual(group.runs.c1.map(row=>row.status),[...Array(10).fill('SKIPPED'),'HELD']);
  assert.deepEqual(group.runs.c1.map(row=>row.consecutiveSkips),[1,2,3,4,5,6,7,8,9,10,10]);assert.equal(group.runs.c1[9].retryAfterMs,10);
  const held=group.runs.c1[10];assert.equal(held.holdReason,'C1_WINDOW_SKIP_LIMIT');assert.equal(held.skipReason,'C1_CURRENT_HEAD_AGE');assert.equal(held.noAutomaticRestart,true);assert.equal(held.actualFeeWei,'0');
  assert.equal(group.stopReason,undefined);assert(fixture.calls.filter(row=>row.name!=='c1').every(row=>!row.closed));
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(fixture.calls.filter(row=>row.name==='c1').length,11);
 }finally{signals.emit('SIGINT');await running;}
});

test('a C1 window stop that arrives while the group already stops is not a skipped window',async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const fixture=operatingChildren(row=>{if(row.name==='c1'){signals.emit('SIGINT');void row.complete({code:1,requests:1,stderr:c1WindowStop('C1_CURRENT_HEAD_AGE'),traffic:c1BuildTraffic});}});
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0',c1WindowRetryWaitMs:1});
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(result.runs.c1.length,1);assert.equal(result.runs.c1[0].status,'FAILED');
});

test('the wait after a skipped C1 window can be shortened for tests but never lengthened',{timeout:5000},async t=>{
 const f=serverPeriod(t,true);
 for(const c1WindowRetryWaitMs of [60001,0,-1,NaN])await assert.rejects(main(['--serve',f.directory],{spawn:operatingChildren().spawn,signals:new EventEmitter(),readPeriod:f.read,
  feeSnapshot:name=>({service:name}),feeDelta:()=>'0',c1WindowRetryWaitMs}),/DEX_C1_WINDOW_RETRY/);
 assert(!fs.existsSync(path.join(f.directory,'group.json')));
});

test('outside the served group a C1 window stop still stops the finite group',async t=>{
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr:c1WindowStop('C1_CURRENT_HEAD_AGE'),traffic:c1BuildTraffic});});
 const result=await main(['--operate',folder(t)],{spawn:fixture.spawn,signals:new EventEmitter()});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'c1:FAILED');assert.equal(fixture.calls.filter(row=>row.name==='c1').length,1);
});

// CW-121: the C1 mode "tier-passes-v2" stops on a Commit that it cannot estimate (a thrown stop signal) or on a policy halt.
// Each one holds C1 alone with its cause in the run record. User swaps (keeper) and the other services continue.
const c1CommitStop=(extra={})=>({pair:'3',commitKind:'pool-limit',commitClass:'capacity',rpcCode:-32000,revertSelector:null,contractError:null,staleProof:null,failedPublicChecks:[],...extra});
const c1CommitStopSignal=(commitStop=c1CommitStop(),extra={})=>({status:'CURRENT_C1_STOP',guard:'CURRENT_C1_PREFLIGHT_REJECTED',code:'CALL_EXCEPTION',publicPreflight:{action:2,pair:'3'},commitStop,locations:['runtime.cjs:208:1'],noAutomaticRetry:true,reconcileSavedJournalBeforeRetry:true,...extra});
const c1EstimateFailure={lastFailure:{code:'DEX_RPC_ERROR_RESPONSE',method:'eth_estimateGas',phase:'rpc-response',status:200,rpcCode:-32000}};
const groupOf=f=>JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));
const groupWhen=async(f,ready)=>{let group;for(let waited=0;waited<3000;waited+=10){group=groupOf(f);if(ready(group))break;await new Promise(resolve=>setTimeout(resolve,10));}return group;};

const replacementStandingGraph='1a73e0205ca448e4eed5cdbbd4bb850dd87a0b08d183da20e44631fd4dd71fe7';
const wideStandingGraph='9e6c03ac69178445605dc78a70e088b596684181d73b218a6a3a89e942b3af21';
const {build13Graph,build13StandingBinding,build13PeerBinding,build13PriceAdmission}=require('./current-dex-service-fees.cjs');
const standingSelected=[replacementStandingGraph,wideStandingGraph,build13Graph].includes(process.env.CW_LOW_RPC_TRIAL);
function standingFixture(t){
  const graph=process.env.CW_LOW_RPC_TRIAL,binding=graph===build13Graph?build13StandingBinding:graph===wideStandingGraph?
    '6f6c3efd3b6915343f9281348a1dc313cee7fe99727fac50144ec44c364e5d5f':
    'a1c0f2c1017906ac8bbe1d447282aacccbc2e8738b2afac0316020d6352a9f99';
  const f=serverPeriod(t,true,reports,undefined,undefined,graph),signals=new EventEmitter();
  Object.assign(f.policy,{c1StandingSha256:'1'.repeat(64),replacementBindingSha256:binding});
  f.write();
  const scope={approvalSha256:f.policy.c1StandingSha256,standingInitialOperatorNonce:'7',
    firstBundle:{sources:{test:'bound'},manifest:{binding:{graph},replacementBindingSha256:binding,
      policy:{totalWei:'323200000000000000'}}}};
  const workerEntry=fs.realpathSync.native(require.resolve('./current-dex-c1-rehearsal.cjs'));
  const runtimeRoot=path.resolve(__dirname,'../..');
  const snapshot=(name,options)=>({service:name,runtimeRoot,graph,...options});
  return {f,signals,workerEntry,scope,binding,graph,snapshot};
}

test('standing supervisor settles replacement peers and renews C1 until a clean C1 hold',
  {skip:!standingSelected},async t=>{
  const {f,signals,workerEntry,scope,binding,graph,snapshot}=standingFixture(t);
  await assert.rejects(main(['--serve',f.directory],{readPeriod:f.read,spawn:()=>assert.fail('missing standing authority')}),
    /DEX_SERVICES_STANDING_WORKER_HELD/);
  await assert.rejects(main(['--serve',f.directory],{readPeriod:f.read,readStandingScope:()=>scope,
    standingWorkerEntry:require.resolve('./current-dex-c1.cjs'),spawn:()=>assert.fail('wrong standing entry')}),
    /DEX_SERVICES_STANDING_WORKER_HELD/);
  f.policy.c1RehearsalSha256='2'.repeat(64);
  f.write();
  assert.throws(()=>f.read(f.directory),/DEX_SERVER_POLICY_FIELDS/);
  delete f.policy.c1RehearsalSha256;
  f.write();
  const fixture=operatingChildren(row=>{
    if(row.name!=='c1')return;
    assert.deepEqual(row.args,['--stand',f.directory]);
    assert.equal(row.standingAdmission.approvalSha256,scope.approvalSha256);
    assert.equal(row.options.env.CW_LOW_RPC_TRIAL,undefined);
    if(row.run===1)void row.complete({result:{window:1,continuationReady:true,state:{actualFeeWei:'0'}}});
    else void row.complete({code:1,stderr:c1CommitStopSignal()});
  });
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    readStandingScope:()=>scope,standingWorkerEntry:workerEntry,
    feeSnapshot:(name,options)=>{
      assert.equal(options.replacementBindingSha256,graph===build13Graph&&name!=='c1'?build13PeerBinding:binding);
      assert.equal(options.standingInitialOperatorNonce,name==='c1'?'7':undefined);
      return snapshot(name,options);
    },
    feeDelta:(_before,after)=>after.service==='c1'?'0':'1'});
  try{
    const group=await groupWhen(f,g=>g.services.c1?.status==='HELD'||g.stopReason);
    assert.equal(group.stopReason,undefined);
    assert.equal(group.services.c1.holdReason,'C1_COMMIT_STOP_SIGNAL');
    assert.equal(group.runs.c1.length,2);
    assert.deepEqual(group.runs.c1.map(row=>row.actualFeeWei),['0','0']);
    assert.deepEqual(Object.keys(group.standingBaseline).sort(),['c1','keeper','matching','prices']);
    for(const name of ['keeper','prices','matching']){
      const first=fixture.calls.find(row=>row.name===name);
      assert.equal(first.closed,false);
      const explicit=[wideStandingGraph,build13Graph].includes(graph),peer=graph===build13Graph?build13PeerBinding:binding;
      assert.equal(first.options.env.CW_LOW_RPC_TRIAL,explicit?undefined:graph);
      assert.equal(first.options.env.CHAINWHISPER_KEEPER_BINDING_SHA256,explicit&&name==='keeper'?peer:undefined);
      assert.equal(first.options.env.CHAINWHISPER_MATCHING_BINDING_SHA256,explicit&&name==='matching'?peer:undefined);
      assert.equal(first.options.env.CHAINWHISPER_PRICE_BINDING_SHA256,name==='prices'?peer:undefined);
      assert.equal(first.options.env.CHAINWHISPER_PRICE_PAYER_ADMISSION_SHA256,
        graph===build13Graph&&name==='prices'?build13PriceAdmission:undefined);
      await first.complete();
      await groupWhen(f,()=>fixture.calls.filter(row=>row.name===name).length===2);
      assert.equal(fixture.calls.filter(row=>row.name===name).length,2);
    }
  }finally{signals.emit('SIGINT');await running;}
});

for(const phase of ['baseline','settlement'])test(`standing C1 alone holds when its ${phase} cannot be reconciled`,
  {skip:!standingSelected},async t=>{
  const {f,signals,workerEntry,scope,snapshot}=standingFixture(t);
  const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete();});
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    readStandingScope:()=>scope,standingWorkerEntry:workerEntry,
    feeSnapshot:(name,options)=>{
      if(name==='c1'&&phase==='baseline')throw Error('DEX_SERVICE_FEES_UNRESOLVED');
      return snapshot(name,options);
    },
    feeDelta:(_before,after)=>{
      if(after.service==='c1')throw Error('DEX_SERVICE_FEES_PREFIX_CHANGED');
      return '0';
    }});
  try{
    const group=await groupWhen(f,g=>g.services.c1?.status==='HELD'||g.stopReason);
    assert.equal(group.stopReason,undefined);
    assert.equal(group.services.c1.holdReason,phase==='baseline'?'C1_STANDING_BASELINE_UNSETTLED':'C1_STANDING_ACCOUNTING_UNSETTLED');
    assert.equal(group.services.c1.unsettledFeeLimitWei,'323200000000000000');
    assert.equal(group.services.c1.actualFeeWei,undefined);
    assert.equal(group.services.c1.noAutomaticRestart,true);
    assert.equal(fixture.calls.filter(row=>row.name==='c1').length,phase==='baseline'?0:1);
    for(const name of ['keeper','prices','matching']){
      await fixture.calls.find(row=>row.name===name).complete({requests:1});
      await groupWhen(f,()=>fixture.calls.filter(row=>row.name===name).length===2);
      assert.equal(fixture.calls.filter(row=>row.name===name).length,2);
    }
    assert.equal(groupOf(f).stopReason,undefined);
  }finally{signals.emit('SIGINT');await running;}
});
const assertOnlyC1Held=async(f,fixture,fixtureC1Calls=1)=>{
 assert(fixture.calls.filter(row=>row.name!=='c1').every(row=>!row.closed));
 await fixture.calls.find(row=>row.name==='keeper').complete();await groupWhen(f,()=>fixture.calls.filter(row=>row.name==='keeper').length===2);
 assert.equal(fixture.calls.filter(row=>row.name==='keeper').length,2);assert.equal(fixture.calls.filter(row=>row.name==='c1').length,fixtureC1Calls);assert.equal(groupOf(f).stopReason,undefined);
};
test('standing C1 exit before its first RPC leaves the peers running after zero fees reconcile',
  {skip:!standingSelected},async t=>{
  const {f,signals,workerEntry,scope,snapshot}=standingFixture(t);
  const fixture=operatingChildren(row=>{if(row.name==='c1')row.close(1);});
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    readStandingScope:()=>scope,standingWorkerEntry:workerEntry,feeSnapshot:snapshot,feeDelta:()=>'0'});
  try {
    const group=await groupWhen(f,g=>g.services.c1?.status==='HELD'||g.stopReason);
    assert.equal(group.services.c1.holdReason,'C1_WORKER_EXIT_BEFORE_RPC');
    assert.equal(group.services.c1.actualFeeWei,'0');
    await assertOnlyC1Held(f,fixture);
  } finally {signals.emit('SIGINT');await running;}
});
for(const pending of [false,true])test(`standing full Limit-page mismatch ${pending?'preserves the pending-send stop':'holds C1 and renews its peers'}`,
  {skip:!standingSelected},async t=>{
  const {f,signals,workerEntry,scope,snapshot}=standingFixture(t);
  const fixture=operatingChildren(row=>{
    if(row.name==='c1')void row.complete({code:1,requests:1,stderr:{status:'CURRENT_C1_STOP',code:'ERR_ASSERTION',
      guard:'C1_QUOTE_PAGE_ENGINE',...(pending?{pendingHash:'0x'+'1'.repeat(64)}:{})}});
  });
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    readStandingScope:()=>scope,standingWorkerEntry:workerEntry,feeSnapshot:snapshot,feeDelta:()=>'0'});
  try{
    const group=await groupWhen(f,g=>g.services.c1?.status==='HELD'||g.stopReason);
    if(pending){
      assert.equal(group.stopReason,'c1:FAILED');
      assert.equal(group.runs.c1[0].status,'FAILED');
      return;
    }
    assert.equal(group.services.c1.holdReason,'C1_QUOTE_PAGE_ENGINE');
    assert.equal(group.services.c1.noAutomaticRestart,true);
    assert.equal(group.services.c1.actualFeeWei,'0');
    for(const name of ['keeper','prices','matching']){
      await fixture.calls.find(row=>row.name===name).complete({requests:1});
      await groupWhen(f,()=>fixture.calls.filter(row=>row.name===name).length===2);
      assert.equal(fixture.calls.filter(row=>row.name===name).length,2);
    }
    assert.equal(groupOf(f).stopReason,undefined);
    assert.equal(fixture.calls.filter(row=>row.name==='c1').length,1);
  }finally{signals.emit('SIGINT');await running;}
});
for(const commitClass of ['capacity','revert-empty','revert-data','unknown'])test(`a C1 Commit stop signal of class ${commitClass} holds C1 alone and keeps its public cause`,{timeout:5000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const commitStop=c1CommitStop({commitClass,commitKind:'pool-pair',rpcCode:commitClass==='revert-empty'?3:null,revertSelector:commitClass==='revert-data'?'0x12345678':null,contractError:'X'.repeat(300),
  staleProof:{why:'no-failed-check',pageOrders:51},failedPublicChecks:['quote-block','Y'.repeat(250)],rpcMessage:'private detail',operator:'0xddbfe89f9decad1b99406be4af8bb613065144be'});
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr:c1CommitStopSignal(commitStop),traffic:c1EstimateFailure});});
 const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:(_,b)=>b.service==='c1'?'7':'0'});
 try{
  const g=await groupWhen(f,group=>group.services.c1?.status==='HELD'||group.stopReason);const held=g.services.c1;
  assert.equal(held.status,'HELD');assert.equal(held.holdReason,'C1_COMMIT_STOP_SIGNAL');assert.equal(held.noAutomaticRestart,true);assert.equal(held.actualFeeWei,'7');assert.equal(held.code,1);
  // Only the listed public fields are copied, and each string is cut to 200 characters.
  assert.deepEqual(held.commitStop,{pair:'3',commitKind:'pool-pair',commitClass,rpcCode:commitClass==='revert-empty'?3:null,revertSelector:commitClass==='revert-data'?'0x12345678':null,
   contractError:'X'.repeat(200),staleProof:{why:'no-failed-check',pageOrders:51},failedPublicChecks:['quote-block','Y'.repeat(200)]});
  assert.equal(g.stopReason,undefined);
  await assertOnlyC1Held(f,fixture);
 }finally{signals.emit('SIGINT');await running;}
});

for(const rule of ['estimate-only','both'])test(`a C1 estimate revert with ${rule==='both'?'a Commit stop signal holds C1 for the stop signal':'no Commit stop signal keeps its old hold reason'}`,{timeout:5000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const stderr=rule==='both'?c1CommitStopSignal(c1CommitStop({commitClass:'revert-empty',rpcCode:3})):{status:'CURRENT_C1_STOP',guard:'CURRENT_C1_PREFLIGHT_REJECTED',code:'CALL_EXCEPTION'};
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr,traffic:{lastFailure:{...c1EstimateFailure.lastFailure,rpcCode:3}}});});
 const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0'});
 try{
  const held=(await groupWhen(f,group=>group.services.c1?.status==='HELD'||group.stopReason)).services.c1;
  assert.equal(held.status,'HELD');assert.equal(held.noAutomaticRestart,true);
  if(rule==='both'){assert.equal(held.holdReason,'C1_COMMIT_STOP_SIGNAL');assert.equal(held.commitStop.commitClass,'revert-empty');assert.equal(held.commitStop.rpcCode,3);}
  else{assert.equal(held.holdReason,'C1_ESTIMATE_REVERT');assert.equal(held.commitStop,undefined);}
  await assertOnlyC1Held(f,fixture);
 }finally{signals.emit('SIGINT');await running;}
});

for(const fault of ['transient-class','no-class','not-object','pending-hash','state-pending-hash','hashless','pending','halt','state-halt','other-guard','exit-0','signal','transport','dirty-traffic','request-count','accounting','fee-overrun','pending-journal'])test(`a C1 Commit stop signal holds C1 only at a safe boundary: ${fault}`,{timeout:5000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();let snapshots=0;
 const commitStop=fault==='transient-class'?c1CommitStop({commitClass:'transient'}):fault==='no-class'?c1CommitStop({commitClass:undefined}):fault==='not-object'?'capacity':c1CommitStop();
 const stderr=c1CommitStopSignal(commitStop,{...(fault==='pending-hash'?{pendingHash:'0xtest'}:{}),...(fault==='state-pending-hash'?{state:{pendingHash:'0xtest'}}:{}),...(fault==='hashless'?{hashless:true}:{}),
  ...(fault==='pending'?{pending:{pair:'3'}}:{}),...(fault==='halt'?{halt:'C1_REVERT_CAUSE_UNPROVED'}:{}),...(fault==='state-halt'?{state:{halt:'C1_REVERT_CAUSE_UNPROVED'}}:{}),...(fault==='other-guard'?{guard:'CURRENT_C1_REJECTED'}:{})});
 const fixture=operatingChildren(row=>{
  if(row.name!=='c1')return;
  if(fault==='signal'){void row.complete({code:1,requests:1,stderr,traffic:c1EstimateFailure,close:false}).then(()=>{row.closed=true;row.child.connected=false;row.child.emit('disconnect');row.child.emit('close',1,'SIGTERM');});return;}
  void row.complete({code:fault==='exit-0'?0:1,requests:1,stderr,traffic:{...c1EstimateFailure,...(fault==='transport'?{stopped:'DEX_RPC_TRANSPORT_STOP'}:{}),...(fault==='dirty-traffic'?{physicalPending:1}:{}),...(fault==='request-count'?{requests:2}:{})}});
 });
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
  feeSnapshot:name=>{if(name==='c1'&&++snapshots===2&&fault==='pending-journal')throw Error('DEX_SERVICE_FEES_UNRESOLVED');return{service:name};},
  feeDelta:(_,b)=>{if(b.service==='c1'&&fault==='accounting')throw Error('UNCERTAIN_ACCOUNTING');return b.service==='c1'&&fault==='fee-overrun'?'79200000000000001':'0';}});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'c1:FAILED');assert.equal(result.runs.c1.length,1);
 const run=result.runs.c1[0];assert.equal(run.status,'FAILED');assert.equal(run.holdReason,undefined);assert.equal(run.commitStop,undefined);
 if(['accounting','fee-overrun','pending-journal'].includes(fault))assert.equal(run.accountingError,'DEX_SERVER_ACCOUNTING');
});

test('outside the served group a C1 Commit stop signal still stops the finite group',async t=>{
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:1,requests:1,stderr:c1CommitStopSignal(),traffic:c1EstimateFailure});});
 const result=await main(['--operate',folder(t)],{spawn:fixture.spawn,signals:new EventEmitter()});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'c1:FAILED');assert.equal(result.runs.c1[0].status,'FAILED');assert.equal(result.runs.c1[0].holdReason,undefined);
});

test('a Commit stop signal from another service still stops the group',async t=>{
 const f=serverPeriod(t,true);
 const fixture=operatingChildren(row=>{if(row.name==='keeper')void row.complete({code:1,requests:1,result:c1CommitStopSignal(),traffic:c1EstimateFailure});});
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0'});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'keeper:FAILED');assert.equal(result.runs.keeper[0].status,'FAILED');
});

for(const where of ['state','result','unbroadcast'])test(`a C1 policy halt in ${where} holds C1 alone and keeps the halt reason`,{timeout:5000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const halt=where==='unbroadcast'?'C1_COMMIT_UNBROADCAST':'C1_REVERT_CAUSE_UNPROVED';
 const runResult=where==='result'?{halt,pendingHash:null,hashless:false}:{state:{pendingHash:null,hashless:false,halt,parkedPairs:['3']}};
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({requests:2,result:runResult});});
 // A reverted send costs gas: the halt fee can be above zero, at or below the fee limit of the run.
 const c1FeeOptions=[];
 const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
  feeSnapshot:(name,options)=>{if(name==='c1')c1FeeOptions.push(options);return{service:name};},
  feeDelta:(_,b)=>b.service==='c1'?'79200000000000000':'0'});
 try{
  const g=await groupWhen(f,group=>group.services.c1?.status==='HELD'||group.stopReason);const held=g.services.c1;
  assert.equal(held.status,'HELD');assert.equal(held.holdReason,'C1_POLICY_HALT');assert.equal(held.haltReason,halt);assert.equal(held.noAutomaticRestart,true);
  assert.equal(held.code,0);assert.equal(held.actualFeeWei,'79200000000000000');assert.equal(held.commitStop,undefined);assert.equal(g.stopReason,undefined);
  assert.deepEqual(c1FeeOptions,[undefined,{c1Halt:halt}]);
  await assertOnlyC1Held(f,fixture);
 }finally{signals.emit('SIGINT');await running;}
});

for (const drift of [false, true]) test(`replacement C1 halt settlement checks its graph and capture${drift ? ' and rejects drift' : ''}`,
  {timeout: 7000}, async t => {
  const f = rehearsalPeriod(t), signals = new EventEmitter(), halt = 'C1_COMMIT_UNBROADCAST';
  const {graph,replacementBindingSha256}=f;
  const c1Options = [];
  const fixture = operatingChildren(row => {
    if (row.name === 'c1') void row.complete({requests: 1, result: {state: {pendingHash: null, hashless: false, halt}}});
  });
  const running = main(['--serve', f.directory], {
    spawn: fixture.spawn, signals, readPeriod: f.read,
    feeSnapshot(name, options) {
      if (name !== 'c1') {
        assert.equal(options, undefined);
        return {service: name};
      }
      c1Options.push(options);
      return {service: name, graph, replacementBindingSha256: drift && options.c1Halt ? 'ff'.repeat(32) : replacementBindingSha256};
    },
    feeDelta: () => '0'
  });
  try {
    const g = await groupWhen(f, group => group.services.c1?.status === 'HELD' || group.stopReason);
      assert.equal(g.services.c1.status, 'HELD');
      assert.equal(g.services.c1.haltReason, drift ? undefined : halt);
      assert.equal(g.services.c1.feeLimitWei, '323200000000000000');
      assert.equal(g.services.c1.actualFeeWei, drift ? undefined : '0');
      if(drift){
        assert.equal(g.services.c1.holdReason,'C1_REHEARSAL_UNSETTLED');
        assert.equal(g.services.c1.unsettledFeeLimitWei,'323200000000000000');
        assert.equal(g.services.c1.accountingError,'DEX_SERVER_ACCOUNTING');
      }
      const c1=fixture.calls.find(row=>row.name==='c1');
      assert.deepEqual(c1.args,['--rehearse',f.directory]);
      assert.deepEqual(c1.rehearsalAdmission,{type:'CHAINWHISPER_C1_REHEARSAL',pid:c1.child.pid,approvalSha256:f.policy.c1RehearsalSha256});
      await assertOnlyC1Held(f, fixture);
      for (const name of ['keeper','prices', 'matching']) {
        assert.deepEqual(fixture.calls.find(row=>row.name===name).args,['--start']);
        await fixture.calls.find(row => row.name === name).complete();
        await groupWhen(f, () => fixture.calls.filter(row => row.name === name).length === 2);
        assert.equal(fixture.calls.filter(row => row.name === name).length, 2);
      }
      assert.equal(groupOf(f).stopReason, undefined);
    assert.deepEqual(c1Options, [{replacementBindingSha256}, {replacementBindingSha256, c1Halt: halt}]);
  } finally {
    signals.emit('SIGINT');
    await running;
  }
});

test('the real supervisor rejects a replacement digest without a rehearsal approval digest', async t => {
  const f = serverPeriod(t, true);
  f.policy.replacementBindingSha256='a5'.repeat(32);f.write();
  await assert.rejects(main(['--serve', f.directory], {
    signals: new EventEmitter(),
    readPeriod:f.read,
    feeSnapshot: () => assert.fail('replacement period reached the installed worker accounting')
  }), /DEX_SERVER_POLICY_FIELDS/);
  assert.equal(fs.existsSync(path.join(f.directory, 'group.json')), false);
});

test('the replacement rehearsal requires the installed group and its exact reconciled fee carry', async t => {
  const f=rehearsalPeriod(t),worker=require('./current-dex-c1.cjs');
  const read=()=>worker.rehearsal(f.directory,f.read(f.directory));
  assert.equal(read().priorSpentFeeWei,f.policy.priorSpentFeeWei);
  f.approval.market='1';f.writeApproval();
  assert.throws(read,/C1_REHEARSAL_MARKET_SCOPE/);
  delete f.approval.market;f.writeApproval();
  const senderLock=f.approval.senderLock;
  f.approval.senderLock={...senderLock,inode:'0'};f.writeApproval();
  assert.throws(read,/C1_SENDER_LOCK_DIRECTORY/);
  const otherDirectory=fs.realpathSync.native(folder(t));
  if(process.platform==='linux')fs.chmodSync(otherDirectory,0o700);
  const other=fs.statSync(otherDirectory,{bigint:true});
  f.approval.senderLock={directory:otherDirectory,device:String(other.dev),inode:String(other.ino)};f.writeApproval();
  assert.throws(read,/C1_REHEARSAL_SENDER_LOCK/);
  f.approval.senderLock=senderLock;f.writeApproval();
  const carry=f.policy.priorSpentFeeWei;
  f.policy.priorSpentFeeWei=String(BigInt(carry)+1n);
  f.write();
  await assert.rejects(main(['--serve',f.directory],{readPeriod:f.read,
    spawn:()=>assert.fail('service launched with a different fee carry')}),/C1_REHEARSAL_PRIOR_FEES/);
  assert.equal(fs.existsSync(path.join(f.directory,'group.json')),false);
  f.policy.priorSpentFeeWei=carry;
  f.write();
  fs.appendFileSync(f.reconciliationFile,'\n');
  assert.throws(read,/C1_REHEARSAL_RECONCILIATION_DIGEST/);
  f.reconciliation.locks=1;
  f.writeReconciliation();
  assert.throws(read,/C1_REHEARSAL_RECONCILIATION_STATE/);
  f.reconciliation.locks=0;
  const nextRun=f.reconciliation.nextRun;
  f.reconciliation.nextRun='server-beta-another-rehearsal';
  f.writeReconciliation();
  assert.throws(read,/C1_REHEARSAL_RECONCILIATION_STATE/);
  f.reconciliation.nextRun=nextRun;
  const priorApprovalSha256=f.reconciliation.approvalSha256;
  f.reconciliation.approvalSha256='7c'.repeat(32);
  f.writeReconciliation();
  assert.throws(read,/C1_REHEARSAL_RECONCILIATION_STATE/);
  f.reconciliation.approvalSha256=priorApprovalSha256;
  f.reconciliation.deltas.c1='3';
  f.writeReconciliation();
  assert.throws(read,/WATCHDOG_FEE_CARRY/);
  f.reconciliation.deltas.c1='2';
  f.approval.priorRuntimeManifestSha256='ef'.repeat(32);
  f.writeReconciliation();
  assert.throws(read,/C1_REHEARSAL_PRIOR_GROUP/);
});

test('the default C1 launch holds even when the local rehearsal records match',async t=>{
  const f=rehearsalPeriod(t);
  await assert.rejects(main(['--serve',f.directory],{signals:new EventEmitter(),readPeriod:f.read}),/DEX_SERVICES_REPLACEMENT_WORKER_HELD/);
  await assert.rejects(require('./current-dex-c1.cjs').main(['--rehearse',f.directory]),/C1_REHEARSAL_WORKER_HELD/);
  assert.equal(fs.existsSync(path.join(f.directory,'group.json')),false);
});

for(const wide of [false,true])test('standing C1 requires its managed parent and rechecks authority before work, wide='+wide,async()=>{
  const worker=require('./current-dex-c1.cjs'),directory=path.join(reports,'standing-worker-test');
  await assert.rejects(worker.main(['--stand',directory]),/C1_STANDING_WORKER_HELD/);
  const peer=new EventEmitter();
  peer.connected=true;peer.pid=42;
  peer.env={CHAINWHISPER_RPC_MANAGED_SERVICE:'c1',CREDENTIALS_DIRECTORY:reports};
  const graph=wide?wideStandingGraph:replacementStandingGraph;
  const operator='0xddbfe89f9decad1b99406be4af8bb613065144be',approvalSha256='1'.repeat(64);
  const bindingSha256=wide?'6f6c3efd3b6915343f9281348a1dc313cee7fe99727fac50144ec44c364e5d5f':'2'.repeat(64);
  const maximumCommittedWei='323200000000000000',initialBundleHash='3'.repeat(64),standingInitialOperatorNonce='7';
  const firstBundle={hash:initialBundleHash,manifest:{binding:{graph},chainId:'7082400',operator,
    replacementBindingSha256:bindingSha256,policy:{totalWei:maximumCommittedWei}}};
  const scope={approvalSha256,firstBundle,standingInitialOperatorNonce};
  const invoke=options=>worker.runStanding(directory,{peer,readScope:()=>scope,verifyLaunch:()=>true,
    bindBroadcast:()=>()=>assert.fail('no broadcast'),...options});
  const bad=invoke({operate:()=>assert.fail('wrong parent is held')});
  peer.emit('message',{type:'CHAINWHISPER_C1_STANDING',pid:peer.pid+1,approvalSha256});
  await assert.rejects(bad,/C1_STANDING_PARENT/);
  const good=invoke({operate:async(selected,{assertAuthorized})=>{
    assert.deepEqual(selected,firstBundle);
    const request={graph,operator,approvalSha256,bindingSha256,maximumCommittedWei,initialBundleHash,standingInitialOperatorNonce};
    assert.equal(assertAuthorized(request,'select'),true);
    scope.standingInitialOperatorNonce='8';
    assert.throws(()=>assertAuthorized(request,'sign'),/C1_STANDING_SCOPE_DRIFT/);
    scope.standingInitialOperatorNonce='7';
    peer.emit('message',{type:'CHAINWHISPER_SERVICE_STOP'});
    assert.throws(()=>assertAuthorized(request,'send'),/C1_STANDING_PARENT/);
    return {checked:true};
  }});
  peer.emit('message',{type:'CHAINWHISPER_C1_STANDING',pid:peer.pid,approvalSha256});
  assert.deepEqual(await good,{checked:true});
  assert.equal(peer.listenerCount('message'),0);
});

test('the C1 rehearsal verifier reads the controller run directory without loading the replacement runtime',t=>{
  const runParent=path.join(reports,'server-beta-runs'),created=!fs.existsSync(runParent);
  if(created)fs.mkdirSync(runParent);
  const f=rehearsalPeriod(t,runParent);
  if(created)t.after(()=>fs.rmdirSync(runParent));
  const worker=require('./current-dex-c1.cjs');
  const Module=require('node:module'),load=Module._load;
  const adapter=require.resolve('../../ChainWhisper Contracts V2/validation/candidates/c1-shared-integration-2026-10-05/durable-adapter.cjs');
  const loadCheck=t.mock.method(Module,'_load',function(request,parent,isMain){
    if(request.endsWith('durable-adapter.cjs'))
      assert.notEqual(Module._resolveFilename(request,parent,isMain),adapter,'reading public approval metadata must not load the transaction adapter');
    return load.call(this,request,parent,isMain);
  });
  try { assert.equal(worker.rehearsal(f.directory,f.read(f.directory)).graph,f.graph); }
  finally { loadCheck.mock.restore(); }
  const cli=spawnSync(process.execPath,[require.resolve('./current-dex-c1.cjs'),'--rehearse',f.directory],{
    encoding:'utf8',timeout:10000,
    env:{SystemRoot:process.env.SystemRoot,NODE_OPTIONS:process.env.NODE_OPTIONS,CW_LOW_RPC_TRIAL:f.policy.graph}
  });
  assert.equal(cli.status,1,cli.error?.code);
  assert.equal(cli.stdout,'');
  assert.equal(JSON.parse(cli.stderr).guard,'C1_REHEARSAL_WORKER_HELD');
});

const peerArchive=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates/c1-band-sizing-2026-11-21/peer-state-package-1');
function installedPeerFixture(t){
  const parent=fs.mkdtempSync(path.join(reports,'service-peer-test-'));
  try{
    const root=path.join(parent,'runtime');
    const {CONFIG}=require('./current-dex-service-watchdog.cjs');
    const bytes=fs.readFileSync(path.join(peerArchive,'runtime-public.json'));
    assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),CONFIG.runtimeManifestSha256);
    const {files}=JSON.parse(bytes);
    assert.equal(Object.keys(files).length,CONFIG.runtimeFiles);
    for(const name of Object.keys(files)){
      const target=path.join(root,name);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(peerArchive,name),target);
    }
    const manifest=path.join(root,'runtime-public.json'),runParent=path.join(root,'APP/reports/server-beta-runs');
    fs.writeFileSync(manifest,bytes);
    fs.mkdirSync(runParent,{recursive:true});
    return {root,manifest,rehearsal:rehearsalPeriod(t,runParent,manifest)};
  }finally{
    t.after(()=>{
      assert.equal(path.dirname(fs.realpathSync.native(parent)),fs.realpathSync.native(reports));
      fs.rmSync(parent,{recursive:true});
    });
  }
}

for(const useArchive of [false,true]) test('the staged C1 fork uses one package for its worker and fee reader while the installed peers continue'+
  (useArchive?' from the repaired peer package':''),{timeout:25000,
  skip:useArchive&&!fs.existsSync(path.join(peerArchive,'runtime-public.json'))?'installed archive unavailable':false}, async t=>{
  const installed=useArchive?installedPeerFixture(t):null,f=installed?.rehearsal??rehearsalPeriod(t);
  const signals=new EventEmitter(),peers=operatingChildren(),stagedC1Root=fs.realpathSync.native(folder(t));
  const invocationId='9c'.repeat(16),previousInvocation=process.env.INVOCATION_ID;
  process.env.INVOCATION_ID=invocationId;
  t.after(()=>{if(previousInvocation===undefined)delete process.env.INVOCATION_ID;else process.env.INVOCATION_ID=previousInvocation;});
  const {createHash}=require('node:crypto'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const guard=path.resolve(__dirname,'../../ChainWhisper Contracts V2/validation/candidates/c1-tier-schedule-2026-11-21/adoption/no-socket-guard.cjs');
  const stop=path.join(__dirname,'current-dex-service-stop.cjs');
  const entry='APP/scripts/current-dex-c1-rehearsal.cjs',fees='APP/scripts/current-dex-service-fees.cjs';
  const source={
    [entry]:`const assert=require('node:assert/strict');
    assert.equal(process.env.CW_LOW_RPC_TRIAL,undefined);
    assert.equal(process.env.CHAINWHISPER_RUNTIME_ROOT,${JSON.stringify(stagedC1Root)});
    assert.equal(process.env.CHAINWHISPER_RPC_MANAGED_SERVICE,'c1');
    assert.equal(process.env.INVOCATION_ID,${JSON.stringify(invocationId)});
    assert.equal(process.cwd(),${JSON.stringify(path.join(stagedC1Root,'APP'))});
    assert(require('node:net').Socket.prototype.connect.localTestGuard);
    const pacing=require('./current-dex-rpc-pacing.cjs');
    assert.equal(pacing.stats().service,'c1');
    assert.equal(typeof pacing.bindC1Broadcast(),'function');
    const timeout=setTimeout(()=>assert.fail('parent approval IPC missing'),5000);
    process.once('message',message=>{
      clearTimeout(timeout);
      assert.equal(message.type,'CHAINWHISPER_C1_REHEARSAL');
      assert.equal(message.pid,process.pid);
      const approval=require('node:fs').readFileSync(require('node:path').join(process.argv[3],'c1-rehearsal-approval.json'));
      assert.equal(message.approvalSha256,require('node:crypto').createHash('sha256').update(approval).digest('hex'));
      console.error(JSON.stringify({status:'CURRENT_C1_STOP',guard:'C1_LOCAL_STAGED_DENIAL'}));
      process.exitCode=1;
      process.channel.unref();
    });`,
    [fees]:`exports.calls=[];exports.snapshotAsync=async(service,options)=>{
      exports.calls.push(options);
      return {service,graph:${JSON.stringify(f.graph)},runtimeRoot:options.runtimeRoot,
        replacementBindingSha256:options.replacementBindingSha256,feeWei:'0',journals:[]};
    };exports.deltaAsync=async()=>{throw Error('a denied rehearsal must stay held');};`,
    'APP/scripts/current-dex-rpc-pacing.cjs':fs.readFileSync(path.join(__dirname,'current-dex-rpc-pacing.cjs')),
    'APP/scripts/current-dex-service-stop.cjs':`require(${JSON.stringify(guard)});require(${JSON.stringify(stop)});`,
    'APP/scripts/current-dex-c1.cjs':fs.readFileSync(path.join(__dirname,'current-dex-c1.cjs')),
    'ChainWhisper Contracts V2/validation/node_modules/ethers/index.js':`module.exports=require(${JSON.stringify(require.resolve('ethers'))});`
  };
  const files={};
  for(const [name,bytes] of Object.entries(source)){
    const file=path.join(stagedC1Root,name);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,bytes);
    files[name]=sha(bytes);
  }
  const manifest=JSON.stringify({schema:'CHAINWHISPER_BETA_PUBLIC_RUNTIME_V1',graph:f.graph,chainId:'7082400',
    noPrivateKeysOrSignedInputs:true,files});
  fs.writeFileSync(path.join(stagedC1Root,'runtime-public.json'),manifest);
  f.approval.stagedRuntimeManifestSha256=sha(manifest);
  f.approval.stagedRuntimeRoot=stagedC1Root;f.writeApproval();
  const options={stagedC1Root,...(installed?{installedPeerRoot:installed.root}:{readPeriod:f.read}),signals,spawn(entry,args,options){
    assert.equal(path.dirname(entry),installed?path.join(installed.root,'APP','scripts'):__dirname);
    assert.notEqual(path.basename(entry),'current-dex-c1.cjs','C1 routed to the installed entry');
    assert.equal(options.env.CW_LOW_RPC_TRIAL,installed?f.policy.graph:process.env.CW_LOW_RPC_TRIAL);
    if(installed){
      assert.equal(options.env.CHAINWHISPER_RUNTIME_ROOT,installed.root);
      assert.equal(options.cwd,path.join(installed.root,'APP'));
      assert.equal(options.env.NODE_OPTIONS,undefined);
      assert.equal(options.env.NODE_PATH,path.join(installed.root,'ChainWhisper Contracts V2/validation/node_modules'));
    }
    assert(options.execArgv.filter(value=>value!=='--require').every(file=>path.dirname(file)===path.dirname(entry)));
    return peers.spawn(entry,args,options);
  },feeSnapshot(name){assert.notEqual(name,'c1','C1 routed to the installed ledger');return {service:name};},feeDelta:()=>'0'};
  if(installed){
    await assert.rejects(main(['--serve',f.directory],{...options,spawn:undefined}),/DEX_SERVICES_INSTALLED_PEERS/);
    assert(!fs.existsSync(path.join(f.directory,'group.json')));
    if(process.platform!=='win32'){
      await assert.rejects(main(['--serve',f.directory],options),/DEX_SERVICES_INSTALLED_PEERS/);
      assert.equal(peers.calls.length,0);
      return;
    }
    const previous=process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS='--require missing-rehearsal-preload.cjs';
    t.after(()=>{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;});
  }
  if(process.platform==='linux'){
    for(let directory=stagedC1Root;;directory=path.dirname(directory)){
      const stat=fs.lstatSync(directory);
      if(stat.uid!==0||(stat.mode&0o022)!==0){
        await assert.rejects(main(['--serve',f.directory],options),/DEX_SERVICES_C1_STAGE_SOURCE|DEX_SERVICES_INSTALLED_PEERS/);
        assert.equal(peers.calls.length,0);
        return;
      }
      if(directory===path.dirname(directory))break;
    }
  }
  await assert.rejects(main(['--serve',f.directory],options),/DEX_SERVICES_C1_STATE_DIRECTORY/);
  fs.mkdirSync(path.join(stagedC1Root,'APP/reports','c1-state-'+f.graph.slice(0,8)),{recursive:true,mode:0o700});
  if(installed){
    const keeper=path.join(installed.root,'APP/scripts/current-dex-keeper.cjs'),keeperBytes=fs.readFileSync(keeper);
    fs.appendFileSync(keeper,'\n');
    await assert.rejects(main(['--serve',f.directory],options),/DEX_SERVICES_INSTALLED_PEERS/);
    assert.equal(peers.calls.length,0);
    fs.writeFileSync(keeper,keeperBytes);
  }
  f.approval.stagedRuntimeRoot=path.join(stagedC1Root,'another-stage');f.writeApproval();
  await assert.rejects(main(['--serve',f.directory],options),/DEX_SERVICES_C1_STAGE_SOURCE/);
  f.approval.stagedRuntimeRoot=stagedC1Root;f.writeApproval();
  fs.appendFileSync(path.join(stagedC1Root,entry),'\n');
  const stopUnexpectedStart=setTimeout(()=>signals.emit('SIGINT'),500);
  try{
    await assert.rejects(main(['--serve',f.directory],options),/DEX_SERVICES_C1_STAGE_SOURCE/);
  }finally{clearTimeout(stopUnexpectedStart);}
  assert.equal(peers.calls.length,0);
  fs.writeFileSync(path.join(stagedC1Root,entry),source[entry]);
  const running=main(['--serve',f.directory],options);
  try {
    const g=await groupWhen(f,group=>group.services.c1?.status==='HELD'||group.stopReason);
    assert.equal(g.stopReason,undefined);
    assert.equal(g.services.c1.result.guard,'C1_LOCAL_STAGED_DENIAL');
    assert.equal(g.services.c1.traffic.requests,0);
    assert.equal(g.services.c1.unsettledFeeLimitWei,'323200000000000000');
    if(installed){
      assert.equal(g.sourcePins[installed.manifest],f.policy.runtimeManifestSha256);
      assert(g.sourcePins[path.join(installed.root,fees)]);
    }
    assert.deepEqual(require(path.join(stagedC1Root,fees)).calls,[{runtimeRoot:stagedC1Root,replacementBindingSha256:f.replacementBindingSha256}]);
    await assertOnlyC1Held(f,peers,0);
    for(const name of ['prices','matching']){
      await peers.calls.find(row=>row.name===name).complete();
      await groupWhen(f,()=>peers.calls.filter(row=>row.name===name).length===2);
      assert.equal(peers.calls.filter(row=>row.name===name).length,2);
    }
    assert.equal(groupOf(f).runs.c1.length,1);
  } finally {signals.emit('SIGINT');await running;}
});

test('replacement C1 holds before fork when its baseline is unresolved',async t=>{
  const f=rehearsalPeriod(t),signals=new EventEmitter(),fixture=operatingChildren();
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    feeSnapshot:name=>{if(name==='c1')throw Error('DEX_SERVICE_FEES_UNRESOLVED');return {service:name};},
    feeDelta:()=> '0'});
  try{
    const g=await groupWhen(f,group=>group.services.c1?.status==='HELD'||group.stopReason);
    assert.equal(g.services.c1.holdReason,'C1_REHEARSAL_BASELINE_UNSETTLED');
    assert.equal(g.services.c1.unsettledFeeLimitWei,'323200000000000000');
    assert.equal(fixture.calls.some(row=>row.name==='c1'),false);
    for(const name of ['keeper','matching','prices'])assert(fixture.calls.some(row=>row.name===name&&!row.closed));
    assert.equal(g.stopReason,undefined);
  }finally{signals.emit('SIGINT');await running;}
});

test('the replacement handoff disconnect before RPC admission holds C1 alone', async t=>{
  const f=rehearsalPeriod(t),signals=new EventEmitter();
  const peers=operatingChildren(row=>{if(row.name==='c1')row.close(1);});
  let handoffFailed=false;
  const spawn=(entry,args,options)=>{
    const child=peers.spawn(entry,args,options);
    if(path.basename(entry)==='current-dex-c1.cjs'){
      const send=child.send.bind(child);
      child.send=(message,callback)=>{
        if(message.type==='CHAINWHISPER_C1_REHEARSAL'){handoffFailed=true;callback(Error('fixture handoff disconnect'));}
        else send(message,callback);
      };
    }
    return child;
  };
  const running=main(['--serve',f.directory],{signals,readPeriod:f.read,spawn,
    feeSnapshot:name=>({service:name,graph:f.graph,replacementBindingSha256:f.replacementBindingSha256}),feeDelta:()=>'0'});
  try{
    const g=await groupWhen(f,group=>group.services.c1?.status==='HELD'||group.stopReason);
    assert.equal(handoffFailed,true);
    assert.equal(g.stopReason,undefined);
    assert.equal(g.services.c1.handoffError,'C1_REHEARSAL_HANDOFF');
    assert.equal(g.rpc.perService.c1.requested,0);
    assert.equal(g.rpc.perService.c1.grants,0);
    await assertOnlyC1Held(f,peers);
  }finally{signals.emit('SIGINT');await running;}
});

test('replacement C1 holds a signed unresolved send and keeps its full reserve', async t=>{
  const f=rehearsalPeriod(t),signals=new EventEmitter(),hash='0x'+'ee'.repeat(32);
  const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({requests:1,result:{state:{pendingHash:hash}}});});
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    feeSnapshot:(name,options)=>name==='c1'?{service:name,graph:f.graph,replacementBindingSha256:options.replacementBindingSha256}:{service:name},
    feeDelta:(_before,after)=>{
      assert.notEqual(after.service,'c1','an unresolved send reached settlement');
      return '0';
    }});
  try{
    const g=await groupWhen(f,group=>group.services.c1?.status==='HELD'||group.stopReason);
    assert.equal(g.services.c1.result.state.pendingHash,hash);
    assert.equal(g.services.c1.unsettledFeeLimitWei,'323200000000000000');
    assert.equal(g.services.c1.actualFeeWei,undefined);
    await assertOnlyC1Held(f,fixture);
  }finally{signals.emit('SIGINT');await running;}
});

for(const outcome of ['three windows','early return','unsettled fees'])test(`the approved C1 rehearsal sequence handles ${outcome} without restarting peers`,async t=>{
  const f=rehearsalPeriod(t),signals=new EventEmitter();
  f.approval.sequence={maximumWindows:3,totalCommittedWei:String(3n*BigInt(f.approval.maximumCommittedWei))};
  f.writeApproval();
  const settled=[];
  const fixture=operatingChildren(row=>{
    if(row.name!=='c1')return;
    assert.equal(row.rehearsalAdmission.approvalSha256,f.policy.c1RehearsalSha256);
    assert.equal(row.rehearsalAdmission.windowOrdinal??1,row.run);
    assert.equal(settled.length,row.run-1);
    const feeWei=outcome==='unsettled fees'?'2':'1';
    void row.complete({result:{window:row.run,state:{pendingHash:null,hashless:false,halt:null,actualFeeWei:feeWei},
      continuationReady:outcome!=='early return'}});
  });
  const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    feeSnapshot:name=>({service:name,graph:f.graph,replacementBindingSha256:f.replacementBindingSha256}),
    feeDelta:(_,after)=>{if(after.service==='c1')settled.push('1');return '1';}});
  try{
    const count=outcome==='three windows'?3:1, status=outcome==='unsettled fees'?'HELD':'RETURNED';
    const group=await groupWhen(f,group=>group.runs.c1.length===count&&group.services.c1?.status===status||group.stopReason);
    assert.equal(group.runs.c1.length,count);
    assert.equal(group.services.c1.status,status);
    assert.equal(group.stopReason,undefined);
    assert.deepEqual(group.runs.c1.map(row=>row.actualFeeWei),Array(count).fill(status==='HELD'?undefined:'1'));
    assert.deepEqual(Object.keys(group.rehearsalBaseline).sort(),['c1','keeper','matching','prices']);
    assert.equal(group.rehearsalBaseline.c1.replacementBindingSha256,f.replacementBindingSha256);
    for(const name of ['keeper','prices','matching']){
      const peers=fixture.calls.filter(row=>row.name===name);
      assert.equal(peers.length,1);
      assert.equal(peers[0].closed,false);
      await peers[0].complete();
      await groupWhen(f,()=>fixture.calls.filter(row=>row.name===name).length===2);
      assert.equal(fixture.calls.filter(row=>row.name===name).length,2);
      assert.equal(groupOf(f).stopReason,undefined);
    }
  }finally{signals.emit('SIGINT');await running;}
});

for(const windowOrdinal of [1,2,3])test(`the C1 worker checks the owner record, predecessor journal and parent handoff for window ${windowOrdinal}`, async t=>{
  const f=rehearsalPeriod(t),worker=require('./current-dex-c1.cjs'),peer=new EventEmitter();
  const runtime=require('../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs');
  peer.connected=true;peer.pid=3003;peer.env={CHAINWHISPER_RPC_MANAGED_SERVICE:'c1',CREDENTIALS_DIRECTORY:path.join(f.directory,'credentials')};
  const base=f.approval;
  const continuation={windowOrdinal,continuationSha256:'cd'.repeat(32),expectedOperatorNonce:'39',
    cumulativeCommitmentWei:String(BigInt(base.maximumCommittedWei)*BigInt(windowOrdinal))};
  if(windowOrdinal>1)base.continuation=continuation;
  base.market='2';f.writeApproval();
  const request={...base,approvalSha256:f.policy.c1RehearsalSha256,...base.continuation};
  let pendingHash=null,queuedPairs=[],runtimeManifestSha256=base.priorRuntimeManifestSha256;
  const readPredecessor=()=>({graph:f.policy.graph,runName:base.priorRun,runtimeManifestSha256,
    groupSha256:base.priorGroupSha256,priorSpentFeeWei:f.policy.priorSpentFeeWei,
    state:{status:'CURRENT_C1_SAVED_STATE',pendingHash,hashless:false,activePair:null,queuedPairs,halt:null,renewalPending:false,
      noNetwork:true,noCredentials:true,noSend:true}});
  t.mock.method(runtime,'inspect',()=>assert.fail('replacement runtime read the predecessor journal'));
  t.mock.method(runtime,'loadOperator',()=>assert.fail('local worker opened credentials'));
  let launches=0,broadcastBindings=0,allowLaunch=false;
  const execute=async (bundle,options)=>{
    launches++;
    assert.deepEqual(bundle,f.bundle);
    assert.deepEqual(options.senderLock,f.approval.senderLock);
    assert.equal(options.continuationSha256,base.continuation?.continuationSha256);
    assert.equal(options.assertAuthorized(request,'sign'),true);
    for(const kind of ['sign','send']){
      assert.equal(options.assertAuthorized(request,kind,{pair:'2',action:1}),true);
      assert.equal(options.assertAuthorized(request,kind,{pair:'2',action:6}),true);
      assert.throws(()=>options.assertAuthorized(request,kind,{pair:'3',action:1}),/C1_REHEARSAL_MARKET_SCOPE/);
    }
    assert.throws(()=>options.assertAuthorized(request,'send'),/C1_REHEARSAL_MARKET_SCOPE/);
    if(windowOrdinal===1){
      assert.throws(()=>options.assertAuthorized({...request,...continuation},'sign'),/C1_REHEARSAL_REQUEST/);
    }else{
      for(const key of Object.keys(continuation)){
        const wrong={...request};
        delete wrong[key];
        assert.throws(()=>options.assertAuthorized(wrong,'sign'),/C1_REHEARSAL_REQUEST/);
        assert.throws(()=>options.assertAuthorized({...request,[key]:'0'},'send'),/C1_REHEARSAL_REQUEST/);
      }
    }
    pendingHash='0x'+'04'.repeat(32);
    try{
      assert.throws(()=>options.assertAuthorized(request,'send'),/C1_REHEARSAL_PREDECESSOR_UNRESOLVED/);
    }finally{pendingHash=null;}
    assert.throws(()=>options.assertAuthorized({...request,bindingSha256:'00'.repeat(32)},'send'),/C1_REHEARSAL_REQUEST/);
    const previous=fs.readFileSync(f.priorFile);
    try{
      fs.appendFileSync(f.priorFile,'\n');
      assert.throws(()=>options.assertAuthorized(request,'send'),/C1_REHEARSAL_PRIOR_GROUP/);
    }finally{fs.writeFileSync(f.priorFile,previous);}
    peer.emit('message',{type:'CHAINWHISPER_SERVICE_STOP'});
    assert.throws(()=>options.assertAuthorized(request,'read'),/C1_REHEARSAL_PARENT/);
    return {status:'LOCAL_REHEARSAL_ROUTED'};
  };
  const run=async (patch={},beforeHandoff=()=>{})=>{
    const result=worker.runRehearsal(f.directory,{peer,readPeriod:f.read,execute,verifyLaunch:()=>allowLaunch,readPredecessor,
      bindBroadcast:()=>{broadcastBindings++;return()=>assert.fail('local worker sent a transaction');}});
    beforeHandoff();
    peer.emit('message',{type:'CHAINWHISPER_C1_REHEARSAL',pid:peer.pid,approvalSha256:f.policy.c1RehearsalSha256,...patch});
    return result;
  };
  await assert.rejects(run(),/C1_REHEARSAL_LAUNCH_HELD/);
  allowLaunch=true;
  await assert.rejects(run({approvalSha256:'00'.repeat(32)}),/C1_REHEARSAL_PARENT/);
  await assert.rejects(run({},()=>{allowLaunch=false;}),/C1_REHEARSAL_LAUNCH_HELD/);
  allowLaunch=true;
  pendingHash=undefined;
  await assert.rejects(run(),/C1_REHEARSAL_PREDECESSOR_UNRESOLVED/);
  pendingHash='0x'+'f1'.repeat(32);
  await assert.rejects(run(),/C1_REHEARSAL_PREDECESSOR_UNRESOLVED/);
  pendingHash=null;
  queuedPairs=['2'];
  await assert.rejects(run(),/C1_REHEARSAL_PREDECESSOR_UNRESOLVED/);
  queuedPairs=[];
  runtimeManifestSha256='0f'.repeat(32);
  await assert.rejects(run(),/C1_REHEARSAL_PREDECESSOR_SOURCE/);
  runtimeManifestSha256=base.priorRuntimeManifestSha256;
  const original=fs.readFileSync(f.approvalFile);
  fs.appendFileSync(f.approvalFile,'\n');
  await assert.rejects(run(),/C1_REHEARSAL_APPROVAL_DIGEST/);
  fs.writeFileSync(f.approvalFile,original);
  assert.equal(launches,0);
  assert.equal(broadcastBindings,0);
  if(windowOrdinal>1){
    base.continuation={...continuation,cumulativeCommitmentWei:base.maximumCommittedWei};
    f.writeApproval();
    await assert.rejects(run(),/C1_REHEARSAL_CONTINUATION_SCOPE/);
    base.continuation=continuation;f.writeApproval();
  }
  assert.deepEqual(await run(),{status:'LOCAL_REHEARSAL_ROUTED'});
  assert.equal(launches,1);
  assert.equal(broadcastBindings,1);
});

test('a successor worker publishes and signs only the next window in its approved sequence',async t=>{
  const f=rehearsalPeriod(t),worker=require('./current-dex-c1.cjs'),peer=new EventEmitter();
  const runtime=require('../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/c1-service/runtime.cjs');
  peer.connected=true;peer.pid=3003;peer.env={CHAINWHISPER_RPC_MANAGED_SERVICE:'c1',CREDENTIALS_DIRECTORY:path.join(f.directory,'credentials')};
  const base=f.approval;
  base.market='2';
  base.sequence={maximumWindows:2,totalCommittedWei:String(2n*BigInt(base.maximumCommittedWei))};
  f.writeApproval();
  const continuation={windowOrdinal:2,continuationSha256:'cd'.repeat(32),expectedOperatorNonce:'39',
    cumulativeCommitmentWei:base.sequence.totalCommittedWei};
  const next={...f.bundle,hash:'ad'.repeat(32),manifest:{...f.bundle.manifest,
    policy:{...f.bundle.manifest.policy,now:base.issuedAt+1}}};
  const request={...base,...continuation,bundleHash:next.hash,issuedAt:next.manifest.policy.now,approvalSha256:f.policy.c1RehearsalSha256};
  const publication={...request,window:2};
  let published=0,executed=0;
  t.mock.method(runtime,'advanceReplacement',async (first,{windowOrdinal,totalReservedWei,assertAuthorized})=>{
    published++;
    assert.deepEqual(first,f.bundle);
    assert.equal(windowOrdinal,2);
    assert.equal(totalReservedWei,base.sequence.totalCommittedWei);
    assert.equal(assertAuthorized(publication,'publish'),true);
    assert.throws(()=>assertAuthorized({...publication,window:3},'publish'),/C1_REHEARSAL_SEQUENCE_SCOPE/);
    assert.throws(()=>assertAuthorized({...publication,cumulativeCommitmentWei:base.maximumCommittedWei},'publish'),
      /C1_REHEARSAL_SEQUENCE_SCOPE/);
    return {bundle:next,...continuation};
  });
  const options={peer,readPeriod:f.read,bindBroadcast:()=>()=>assert.fail('local fixture sent a transaction'),verifyLaunch:()=>true,
    readPredecessor:()=>({graph:f.policy.graph,runName:base.priorRun,runtimeManifestSha256:base.priorRuntimeManifestSha256,
      groupSha256:base.priorGroupSha256,priorSpentFeeWei:f.policy.priorSpentFeeWei,
      state:{status:'CURRENT_C1_NOT_STARTED',noNetwork:true,noCredentials:true,noSend:true}}),
    execute:async (bundle,grant)=>{
      executed++;
      assert.deepEqual(bundle,next);
      assert.equal(grant.continuationSha256,continuation.continuationSha256);
      assert.equal(grant.assertAuthorized(request,'sign'),true);
      assert.equal(grant.assertAuthorized(request,'send',{pair:'2',action:6}),true);
      assert.throws(()=>grant.assertAuthorized(request,'send',{pair:'1',action:2}),/C1_REHEARSAL_MARKET_SCOPE/);
      assert.throws(()=>grant.assertAuthorized({...request,bundleHash:f.bundle.hash},'send'),/C1_REHEARSAL_REQUEST/);
      return 'routed';
    }};
  const start=ordinal=>{
    const pending=worker.runRehearsal(f.directory,options);
    peer.emit('message',{type:'CHAINWHISPER_C1_REHEARSAL',pid:peer.pid,approvalSha256:f.policy.c1RehearsalSha256,windowOrdinal:ordinal});
    return pending;
  };
  await assert.rejects(start(3),/C1_REHEARSAL_SEQUENCE_SCOPE/);
  assert.equal(published,0);
  assert.equal(executed,0);
  assert.equal(await start(2),'routed');
  assert.equal(published,1);
  assert.equal(executed,1);
});

for(const fault of ['pending-hash','state-pending-hash','hashless','state-hashless','state-pending','bad-name','not-string','exit-1','transport','dirty-traffic','accounting','fee-overrun','pending-journal'])test(`a C1 policy halt holds C1 only at a safe boundary: ${fault}`,{timeout:5000},async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();let snapshots=0;
 const halt=fault==='bad-name'?'c1 revert cause unproved':fault==='not-string'?{reason:'C1_REVERT_CAUSE_UNPROVED'}:'C1_REVERT_CAUSE_UNPROVED';
 const runResult={...(fault==='pending-hash'?{pendingHash:'0xtest'}:{}),...(fault==='hashless'?{hashless:true}:{}),
  state:{pendingHash:fault==='state-pending-hash'?'0xtest':null,hashless:fault==='state-hashless',...(fault==='state-pending'?{pending:{pair:'3'}}:{}),halt}};
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({code:fault==='exit-1'?1:0,requests:1,result:runResult,
  traffic:{...(fault==='transport'?{stopped:'DEX_RPC_TRANSPORT_STOP'}:{}),...(fault==='dirty-traffic'?{physicalPending:1}:{})}});});
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
  feeSnapshot:name=>{if(name==='c1'&&++snapshots===2&&fault==='pending-journal')throw Error('DEX_SERVICE_FEES_UNRESOLVED');return{service:name};},
  feeDelta:(_,b)=>{if(b.service==='c1'&&fault==='accounting')throw Error('UNCERTAIN_ACCOUNTING');return b.service==='c1'&&fault==='fee-overrun'?'79200000000000001':'0';}});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'c1:FAILED');assert.equal(result.runs.c1.length,1);
 const run=result.runs.c1[0];assert.equal(run.status,'FAILED');assert.equal(run.holdReason,undefined);assert.equal(run.haltReason,undefined);
 if(['accounting','fee-overrun','pending-journal'].includes(fault))assert.equal(run.accountingError,'DEX_SERVER_ACCOUNTING');
});

test('outside the served group a C1 policy halt still stops the finite group',async t=>{
 const fixture=operatingChildren(row=>{if(row.name==='c1')void row.complete({result:{state:{pendingHash:null,hashless:false,halt:'C1_REVERT_CAUSE_UNPROVED'}}});});
 const result=await main(['--operate',folder(t)],{spawn:fixture.spawn,signals:new EventEmitter()});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'c1:FAILED');assert.equal(result.runs.c1[0].status,'FAILED');assert.equal(result.runs.c1[0].holdReason,undefined);
});

test('a policy halt from another service still stops the group',async t=>{
 const f=serverPeriod(t,true);
 const fixture=operatingChildren(row=>{if(row.name==='matching')void row.complete({result:{state:{pendingHash:null,hashless:false,halt:'C1_REVERT_CAUSE_UNPROVED'}}});});
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0'});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'matching:FAILED');assert.equal(result.runs.matching[0].status,'FAILED');
});

test('a returned C1 run with parked pairs, refused Commits and suspended markets returns and the group continues',async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();
 const state={pendingHash:null,hashless:false,halt:null,parkedPairs:['3'],commitNotAdmitted:[{pair:'5',commitKind:'pool-limit',commitClass:'capacity'}],suspendedMarkets:['7']};
 const fixture=operatingChildren(row=>{
  if(row.name!=='c1')return;
  if(row.run===1)void row.complete({requests:1,result:{state}});
  else signals.emit('SIGINT');
 });
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=>'0'});
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(result.runs.c1.length,2);
 const returned=result.runs.c1[0];assert.equal(returned.status,'RETURNED');assert.equal(returned.holdReason,undefined);assert.equal(returned.actualFeeWei,'0');
 assert.deepEqual(returned.result.state,state);
 for(const name of ['keeper','prices','matching'])assert.equal(result.runs[name].length,1);
});

for(const fault of ['none','rpc','accounting','nonzero-fee','pending-journal','pending-send','transport','credentials','wrong-guard'])test(`matching reserve holds only matching at a proven no-send boundary: ${fault}`,async t=>{
 const f=serverPeriod(t,true),signals=new EventEmitter();let snapshots=0;
 const fixture=operatingChildren(row=>{if(row.name==='matching')void row.complete({requests:1,result:{status:'MATCH_WINDOW_FEE_HELD',guard:fault==='wrong-guard'?'OTHER':'MATCH_WINDOW_RESERVE',noSend:true,noCredentials:fault!=='credentials',verified:0,attempts:0,actualFeeWei:'0',maximumCommittedWei:'0',pendingHash:fault==='pending-send'?'0xtest':null,hashless:false},traffic:{...(fault==='rpc'?{lastFailure:{code:'DEX_RPC_ERROR_RESPONSE',method:'eth_getProof',status:200,rpcCode:-32000}}:{}),...(fault==='transport'?{stopped:'DEX_RPC_TRANSPORT_STOP'}:{})}});});
 const running=main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>{if(name==='matching'&&++snapshots===2&&fault==='pending-journal')throw Error('DEX_SERVICE_FEES_UNRESOLVED');return{service:name};},feeDelta:(_,b)=>{if(b.service==='matching'&&fault==='accounting')throw Error('UNCERTAIN_ACCOUNTING');return b.service==='matching'&&fault==='nonzero-fee'?'1':'0';}});
 try{
  await flush();
  if(fault==='none'){
   const g=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));assert.equal(g.services.matching.status,'HELD');assert.equal(g.services.matching.holdReason,'MATCH_WINDOW_RESERVE');assert.equal(g.services.matching.actualFeeWei,'0');assert(!g.stopReason);
   assert(fixture.calls.filter(row=>row.name!=='matching').every(row=>!row.closed));
   for(const name of ['keeper','c1']){await fixture.calls.find(row=>row.name===name).complete();await flush();assert.equal(fixture.calls.filter(row=>row.name===name).length,2);}
   assert.equal(fixture.calls.filter(row=>row.name==='matching').length,1);
  }else assert.equal((await running).stopReason,'matching:FAILED');
 }finally{signals.emit('SIGINT');await running;}
});

for(const reason of ['failed','accounting','fee-overrun'])test(`standing service still stops on ${reason}`,async t=>{
 const f=serverPeriod(t,true),fixture=operatingChildren(row=>{void row.complete({result:reason==='failed'&&row.name==='keeper'?{status:'APP_HOST_STOPPED'}:{}});});
 const fees={keeper:'880000000000000000',prices:'306000000000000000',matching:'66000000000000000',c1:'79200000000000000'};
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:(_,b)=>reason==='fee-overrun'?String(BigInt(fees[b.service])+1n):reason==='accounting'?undefined:'0'});
 assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'keeper:FAILED');
 assert.equal(result.runs.keeper.length,1);
 assert(BigInt(result.settledFeeWei)>=BigInt(f.policy.priorSpentFeeWei));
 assert.equal(BigInt(result.settledFeeWei),Object.values(result.runs).flat().reduce((total,row)=>total+BigInt(row.actualFeeWei??'0'),BigInt(f.policy.priorSpentFeeWei)));
 assert.equal(result.operatingPolicy.maximumFeeCommitmentWei,null);
 assert.equal(result.operatingPolicy.oneOffFundingFeeReserveWei,'1500000000000');
 assert.equal(BigInt(result.feeCommitmentWei),Object.values(result.runs).flat().reduce((total,row)=>total+BigInt(row.actualFeeWei??row.feeLimitWei),BigInt(f.policy.priorSpentFeeWei)+1500000000000n));
});

test('server period rejects a larger fee/time budget, changed source or expired lease',t=>{
  const f=serverPeriod(t);assert.equal(f.read(f.directory).maximumNewFeeWei,'2000000000000000000');
  for(const patch of [{maximumNewFeeWei:'2000000000000000001'},{maximumMs:86400001},{expiresAt:1},{graph:'wrong'},{runtimeManifestSha256:'b'.repeat(64)}]){
    const before={...f.policy};Object.assign(f.policy,patch);f.write();assert.throws(()=>f.read(f.directory));Object.assign(f.policy,before);f.write();
  }
});

test('server period renews only clean runs and releases only verified fee commitments',async t=>{
  const f=serverPeriod(t),fees={keeper:0n,prices:0n,matching:0n,c1:0n};
  const fixture=operatingChildren(row=>{fees[row.name]++;void row.complete();});
  const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,
    feeSnapshot:name=>({service:name,feeWei:String(fees[name])}),feeDelta:(a,b)=>String(BigInt(b.feeWei)-BigInt(a.feeWei))});
  assert.equal(result.status,'COMPLETE');assert.equal(fixture.calls.length,384);
  assert.equal(result.settledFeeWei,'384');assert.equal(result.feeCommitmentWei,'384');
  assert.equal(result.operatingPolicy.maximumFeeCommitmentWei,'2000000000000000000');
});

for(const bad of ['pending','hashless','dirty-traffic','fee-over-cap','negative-fee','missing-fee'])test(`server period never renews ${bad}`,async t=>{
  const f=serverPeriod(t);const fixture=operatingChildren(row=>{void row.complete({result:row.name==='keeper'?{pendingHash:bad==='pending'?'0x1':null,hashless:bad==='hashless'}:{},traffic:bad==='dirty-traffic'&&row.name==='keeper'?{physicalPending:1}:{}});});
  const delta=bad==='fee-over-cap'?'880000000000000001':bad==='negative-fee'?'-1':bad==='missing-fee'?undefined:'0';
  const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,
    feeSnapshot:name=>({service:name,feeWei:'0'}),feeDelta:()=>delta});
  assert.equal(result.status,'STOPPED');assert.equal(fixture.calls.filter(r=>r.name==='keeper').length,1);
});

test('server period stops before a new full commitment exceeds its cumulative fee ceiling',async t=>{
  const f=serverPeriod(t);const fixture=operatingChildren(row=>{void row.complete();});
  const fee={keeper:'880000000000000000',prices:'306000000000000000',matching:'66000000000000000',c1:'79200000000000000'};
  const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,
    feeSnapshot:name=>({service:name}),feeDelta:(_,b)=>fee[b.service]});
  assert.equal(result.status,'STOPPED');assert.equal(result.stopReason,'BUDGET_BOUND');
  assert(BigInt(result.feeCommitmentWei)<=2000000000000000000n);
});

test('server period cannot start after a slow fee snapshot consumes its remaining time',async t=>{
  const f=serverPeriod(t),fixture=operatingChildren(row=>{void row.complete();});let clock=0;
  t.mock.method(performance,'now',()=>clock);
  await assert.rejects(main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,
    feeSnapshot:name=>{clock=86401000;return{service:name,feeWei:'0'};},feeDelta:()=>'0'}),/DEX_SERVER_PERIOD_EXPIRED/);
  assert.equal(fixture.calls.length,0);
});

for(const clean of [true,false])test(`server period ${clean?'renews':'holds'} a time-bounded price child only with clean accounting and traffic`,async t=>{
  const f=serverPeriod(t),signals=new EventEmitter();
  const fixture=operatingChildren(row=>{
    if(row.name==='prices'&&row.run===1)void row.complete({result:{status:'CURRENT_DEX_PRICES_WINDOW_STOPPED',reason:'TIME_BOUND'},traffic:clean?{}:{stopped:'DEX_RPC_HTTP_403'}});
    else if(row.name==='prices')signals.emit('SIGINT');
  });
  const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,
    feeSnapshot:name=>({service:name,feeWei:'0'}),feeDelta:()=>'0'});
  assert.equal(result.status,'STOPPED');
  assert.equal(fixture.calls.filter(r=>r.name==='prices').length,clean?2:1);
  assert.equal(result.runs.prices[0].status,clean?'RETURNED':'FAILED');
});
for(const status of ['MATCH_WINDOW_IDLE_EMPTY_MARKETS','MATCH_WINDOW_IDLE_PUBLIC_WORK','MATCH_WINDOW_PUBLIC_CHANGED_STOPPED','MATCH_WINDOW_PUBLIC_EMPTY_STOPPED','MATCH_WINDOW_STOPPED'])for(const clean of [true,false])test(`server period ${clean?'renews':'holds'} ${status} with verified fees and clean traffic`,async t=>{
 const f=serverPeriod(t),signals=new EventEmitter();
 const fixture=operatingChildren(row=>{
  if(row.name==='matching'&&row.run===1)void row.complete({result:{status,...(status==='MATCH_WINDOW_STOPPED'?{reason:'TIME_BOUND'}:{}),noSend:true,noCredentials:true,maximumCommittedWei:'0',actualFeeWei:'0'},traffic:clean?{}:{stopped:'DEX_RPC_HTTP_403'}});
  else if(row.name==='matching')signals.emit('SIGINT');
 });
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals,readPeriod:f.read,feeSnapshot:name=>({service:name,feeWei:'0'}),feeDelta:()=>'0'});
 assert.equal(result.status,'STOPPED');assert.equal(fixture.calls.filter(r=>r.name==='matching').length,clean?2:1);
 assert.equal(result.runs.matching[0].status,clean?'RETURNED':'FAILED');if(clean)assert.equal(result.runs.matching[0].actualFeeWei,'0');
});

for(const reason of ['OPERATOR_STOP','TIME_BOUND'])test('a matching operator stop or pending time boundary cannot renew: '+reason,async t=>{
 const f=serverPeriod(t,true),fixture=operatingChildren(row=>{if(row.name==='matching')void row.complete({result:{status:'MATCH_WINDOW_STOPPED',reason,...(reason==='TIME_BOUND'?{pendingHash:'0xunknown'}:{})}});});
 const result=await main(['--serve',f.directory],{spawn:fixture.spawn,signals:new EventEmitter(),readPeriod:f.read,feeSnapshot:name=>({service:name}),feeDelta:()=> '0'});
 assert.equal(result.stopReason,'matching:FAILED');assert.equal(result.runs.matching.length,1);
});

for (const pending of [false, true]) test(`an operator stop settles clean worker fees with C1 pending=${pending}`, async t => {
  const f = serverPeriod(t, true), signals = new EventEmitter();
  const fixture = operatingChildren(() => {
    if (fixture.calls.length === 4) signals.emit('SIGINT');
  }, row => {
    const results = {
      prices: {status: 'CURRENT_DEX_PRICES_WINDOW_STOPPED', reason: 'OPERATOR_STOP'},
      matching: {status: 'MATCH_WINDOW_STOPPED', reason: 'OPERATOR_STOP'},
      c1: {result: {mode: 'FINITE_C1', status: 'C1_OPERATOR_STOPPED'}, state: {pendingHash: pending ? '0xunknown' : null}}
    };
    void row.complete({result: results[row.name]});
  });
  const result = await main(['--serve', f.directory], {
    spawn: fixture.spawn, signals, readPeriod: f.read,
    feeSnapshot: name => ({service: name}), feeDelta: () => '10'
  });
  assert.equal(result.stopReason, 'OPERATOR_STOP');
  for (const name of ['keeper', 'prices', 'matching', 'c1']) {
    assert.equal(result.runs[name].length, 1);
    const withheld = name === 'c1' && pending;
    assert.equal(result.runs[name][0].status, withheld ? 'FAILED' : 'RETURNED');
    assert.equal(result.runs[name][0].actualFeeWei, withheld ? undefined : '10');
  }
  assert.equal(result.settledFeeWei, String(BigInt(f.policy.priorSpentFeeWei) + (pending ? 30n : 40n)));
});

test('operate parks matching at its allowance while keeper RPC remains admitted', { timeout: 5000 }, async t => {
  const fixture = operatingChildren(row => { if (row.name === 'matching') void row.complete({ requests: 1 }); });
  const signals = new EventEmitter(), directory = folder(t);
  const running = main(['--operate', directory], { spawn: fixture.spawn, signals });
  let result;
  try {
    await flush();
    const parked = JSON.parse(fs.readFileSync(path.join(directory, 'group.json'), 'utf8'));
    assert.equal(parked.status, 'RUNNING'); assert.equal(parked.stopReason, undefined);
    const keeper = fixture.calls.find(row => row.name === 'keeper');
    assert.equal(keeper.closed, false);
    await keeper.complete({ requests: 1 }); await flush();
    assert.equal(fixture.calls.filter(row => row.name === 'keeper').length, 1);
    assert(fixture.calls.filter(row => ['prices', 'c1'].includes(row.name)).every(row => !row.closed));
  } finally { signals.emit('SIGINT'); result = await running; }
  assert.equal(result.status, 'STOPPED'); assert.equal(result.stopReason, 'OPERATOR_STOP');
  assert.equal(result.maximumNewWorkMs, 30 * 60 * 1000);
  assert.equal(result.operatingPolicy.maximumFeeCommitmentWei, '1835200000000000000');
  assert.deepEqual(Object.fromEntries(Object.entries(result.operatingPolicy.services).map(([name, row]) => [name, row.maximumRuns])),
    { keeper: 1, prices: 2, matching: 4, c1: 1 });
  assert.equal(result.feeCommitmentWei, '1529200000000000000');
  const matching = fixture.calls.filter(row => row.name === 'matching');
  assert.equal(matching.length, 4); assert(fixture.calls.every(row => row.closed));
  assert.equal(result.runs.matching.length, 4);
  assert.equal(result.rpc.perService.matching.physicalStarts, 4);
  assert.equal(result.rpc.perService.matching.physicalSettled, 4);
  for (const [index, row] of matching.entries()) {
    assert.deepEqual(row.args, ['--start']);
    assert.equal(result.runs.matching[index].status, 'RETURNED');
    assert.equal(result.runs.matching[index].feeLimitWei, '66000000000000000');
    assert.equal(result.runs.matching[index].traffic.requests, 1);
    assert.equal(path.basename(result.runs.matching[index].stdout), index ? `matching.run-${index + 1}.stdout.log` : 'matching.stdout.log');
    if (index) assert(row.started[0] >= matching[index - 1].closedAt);
  }
});

for(const mode of ['--start','--operate'])for(const defect of [null,'pending','traffic'])test(`${mode} accepts only a clean price deadline: ${defect??'clean'}`,async t=>{
  const fixture=operatingChildren(row=>{void row.complete(row.name==='prices'?{
    result:{status:'CURRENT_DEX_PRICES_WINDOW_STOPPED',reason:'TIME_BOUND',...(defect==='pending'?{pendingHash:'0xunknown'}:{})},
    traffic:defect==='traffic'?{physicalPending:1}:{}
  }:{});});
  const result=await main([mode,folder(t)],{spawn:fixture.spawn,signals:new EventEmitter()});
  assert.equal(result.status,defect?'STOPPED':'COMPLETE');
  const priceRuns=fixture.calls.filter(row=>row.name==='prices').length;
  assert.equal(priceRuns,!defect&&mode==='--operate'?2:1);
});

test('operate completes when all roles return within their exact run and fee caps', async t => {
  const fixture = operatingChildren(row => { void row.complete(); });
  const result = await main(['--operate', folder(t)], { spawn: fixture.spawn, signals: new EventEmitter() });
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.stopReason, undefined);
  assert.equal(result.feeCommitmentWei, result.operatingPolicy.maximumFeeCommitmentWei);
  assert.equal(fixture.calls.length, 8); assert(fixture.calls.every(row => row.closed));
  for (const [name, policy] of Object.entries(result.operatingPolicy.services)) {
    assert.equal(fixture.calls.filter(row => row.name === name).length, policy.maximumRuns);
    assert(result.runs[name].every(row => row.status === 'RETURNED'));
  }
});

test('a caller cannot enlarge a later operating window through a returned policy', async t => {
  const first = operatingChildren(row => { void row.complete(); });
  const previous = await main(['--operate', folder(t)], { spawn: first.spawn, signals: new EventEmitter() });
  assert.throws(() => { previous.operatingPolicy.services.matching.maximumRuns = 100; }, TypeError);
  assert.throws(() => { previous.operatingPolicy.services.keeper.feeLimitWei = '0'; }, TypeError);
  assert.throws(() => { previous.operatingPolicy.services.matching = { maximumRuns: 100, feeLimitWei: '0' }; }, TypeError);
  const next = operatingChildren(row => { void row.complete(); });
  const result = await main(['--operate', folder(t)], { spawn: next.spawn, signals: new EventEmitter() });
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.stopReason, undefined);
  assert.equal(next.calls.filter(row => row.name === 'matching').length, 4);
  assert.equal(result.feeCommitmentWei, '1835200000000000000');
});

test('operate rejects changed financial runtime source before a replacement can start', async t => {
  const runtime = path.resolve(__dirname,
    '../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/matching-service/runtime.cjs');
  const read = fs.readFileSync;
  let changed = false;
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    if (changed && path.resolve(file) === runtime) return Buffer.from('synthetic changed runtime source');
    return read.call(this, file, ...args);
  });
  const fixture = operatingChildren(row => {
    if (row.name === 'matching') void row.complete({ close: false }).then(() => { changed = true; row.close(); });
  });
  const directory = folder(t);
  await assert.rejects(main(['--operate', directory], { spawn: fixture.spawn, signals: new EventEmitter() }),
    /DEX_SERVICES_SOURCE_DRIFT/);
  const group = JSON.parse(read(path.join(directory, 'group.json'), 'utf8'));
  assert.equal(group.status, 'STOPPED'); assert.equal(group.stopReason, 'DEX_SERVICES_SOURCE_DRIFT');
  assert.equal(fixture.calls.filter(row => row.name === 'matching').length, 1);
  assert(fixture.calls.every(row => row.closed));
});

for (const kind of ['failed', 'pending', 'hashless', 'halt', 'top-halt', 'dirty-traffic', 'unclean-exit', 'HTTP403', 'unknown']) {
  test(`operate never renews a ${kind} run`, async t => {
    const fixture = operatingChildren(row => {
      if (row.name !== 'matching') return;
      if (kind === 'HTTP403' || kind === 'unknown') {
        row.child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: row.name, id: 1, queueMs: 1000 });
        row.child.emit('message', { type: 'CHAINWHISPER_RPC_STARTED', service: row.name, id: 1 });
        if (kind === 'HTTP403') row.child.emit('message', { type: 'CHAINWHISPER_RPC_STOP', service: row.name,
          id: 1, code: 'DEX_RPC_HTTP_403', settled: true, statusCode: 403 });
        else row.child.emit('disconnect');
        return;
      }
      const result = kind === 'failed' ? { status: 'MATCH_STOP' } : kind === 'pending' ? { state: { pendingHash: '0xtest' } } :
        kind === 'hashless' ? { hashless: true } : kind === 'halt' ? { state: { halt: 'HALT' } } : kind === 'top-halt' ? { halt: 'HALT' } : {};
      void row.complete({ result, clean: kind !== 'unclean-exit',
        traffic: kind === 'dirty-traffic' ? { physicalPending: 1 } : {} });
    });
    const result = await main(['--operate', folder(t)], { spawn: fixture.spawn, signals: new EventEmitter() });
    assert.equal(result.status, 'STOPPED'); assert.equal(fixture.calls.length, 4);
    assert.equal(result.runs.matching.length, 1);
    if (kind === 'HTTP403') assert.equal(result.stopReason, 'DEX_RPC_HTTP_403');
    if (kind === 'unknown') assert.equal(result.rpc.unknownInFlight, 1);
  });
}

test('operate waits for actual close before renewal, and stop during renewal awaits all children', { timeout: 4000 }, async t => {
  const directory = folder(t), signals = new EventEmitter();
  let first, second, complete;
  const ready = new Promise(resolve => { complete = resolve; });
  const fixture = operatingChildren(row => {
    if (row.name !== 'matching') return;
    if (row.run === 1) { first = row; void row.complete({ close: false }).then(complete); }
    else { second = row; complete(); }
  }, () => {});
  const running = main(['--operate', directory], { spawn: fixture.spawn, signals });
  try {
    await ready; await flush();
    assert.equal(fixture.calls.length, 4);
    const renewed = new Promise(resolve => { complete = resolve; });
    first.close(); await renewed;
    assert(second); assert(first.closed);
    let returned = false; void running.then(() => { returned = true; });
    const requested = await main(['--stop', directory]);
    assert.equal(requested.status, 'DEX_SERVICES_STOP_REQUESTED');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(returned, false);
    fixture.calls.forEach(row => row.close());
    const result = await running;
    assert.equal(result.stopReason, 'OPERATOR_STOP'); assert.equal(fixture.calls.length, 5);
  } finally { signals.emit('SIGINT'); fixture.calls.forEach(row => row.close()); await running; }
});

test('one process per existing entry, with pacing and stop preloads', async t => {
  const directory = folder(t), fixture = children();
  const result = await main(['--once', directory], { spawn: fixture.spawn, signals: new EventEmitter() });
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.maximumNewWorkMs, 15 * 60 * 1000);
  assert.equal(result.ownerWalletActions, 0);
  assert.equal(new Set(fixture.calls.map(x => x.child.pid)).size, 4);
  for (const row of fixture.calls) {
    assert.deepEqual(row.args, ['--once']);
    assert.equal(row.options.windowsHide, true);
    assert.equal(row.options.stdio[3], 'ipc');
    assert.equal(row.options.env.CHAINWHISPER_RPC_MANAGED_SERVICE, row.name);
    assert.deepEqual(row.options.execArgv, ['--require', path.join(__dirname, 'current-dex-rpc-pacing.cjs'), '--require', path.join(__dirname, 'current-dex-service-stop.cjs')]);
  }
  await assert.rejects(main(['--once', directory], { spawn: fixture.spawn }), /ALREADY_STARTED/);
  assert.equal(fixture.calls.length, 4);
});

test('a stopped result is not success even if its CLI exits zero; stop siblings once', async t => {
  const fixture = children({ keeper: 'APP_HOST_STOPPED' });
  const result = await main(['--once', folder(t)], { spawn: fixture.spawn, signals: new EventEmitter() });
  assert.equal(result.status, 'STOPPED');
  assert.equal(fixture.calls.length, 4);
  assert.equal(result.services.keeper.status, 'FAILED');
  for (const row of fixture.calls.slice(1)) assert.deepEqual(row.child.messages, [{ type: 'CHAINWHISPER_SERVICE_STOP' }]);
});

test('normal mode passes --start to all existing CLIs without restarting them', async t => {
  const fixture = children();
  const result = await main(['--start', folder(t)], { spawn: fixture.spawn, signals: new EventEmitter() });
  assert.equal(result.status, 'COMPLETE');
  assert.equal(result.mode, '--start');
  assert.equal(fixture.calls.length, 4);
  assert.equal(result.maximumNewWorkMs, 30 * 60 * 1000);
  for (const row of fixture.calls) assert.deepEqual(row.args, ['--start']);
});

test('supported stop command handles large history and keeps the parent alive until every child returns', { timeout: 3000 }, async t => {
  const directory = folder(t), signals = new EventEmitter(), calls = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.connected = true; child.pid = 2000 + calls.length;
    child.send = (message, callback) => {
      assert.equal(message.type, 'CHAINWHISPER_SERVICE_STOP'); callback?.(null);
      queueMicrotask(() => { child.connected = false; child.emit('close', 0, null); });
    };
    calls.push(child); return child;
  };
  const running = main(['--start', directory], { spawn, signals });
  try {
    const file = path.join(directory, 'group.json');
    const group = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...group, retainedHistory: 'x'.repeat(1048576) }));
    const requested = await main(['--stop', directory]);
    assert.equal(requested.status, 'DEX_SERVICES_STOP_REQUESTED');
    const result = await running;
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.stopReason, 'OPERATOR_STOP');
    assert.equal(calls.length, 4);
    assert(calls.every(child => !child.connected));
    assert.equal((await main(['--stop', directory])).status, 'DEX_SERVICES_STOP_REQUESTED');
    assert.equal(calls.length, 4);
  } finally { signals.emit('SIGINT'); await running; }
});

test('stop requests preserve diagnostic history without reading it or starting work', async t => {
  const directory = folder(t), file = path.join(directory, 'group.json');
  const body = JSON.stringify({ status: 'COMPLETE', retainedHistory: 'x'.repeat(1048576) });
  fs.writeFileSync(file, body);
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(target, ...args) {
    assert.notEqual(path.resolve(target), file, 'stop must not read diagnostic history');
    return read.call(this, target, ...args);
  });
  const spawn = () => assert.fail('stop must not start work');
  await Promise.all([main(['--stop', directory], { spawn }), main(['--stop', directory], { spawn })]);
  assert.equal(read(file, 'utf8'), body);
  assert.equal(fs.statSync(path.join(directory, 'stop-request.json')).size, 0);
});

test('stop requests retain report-path and unsafe group-file rejection', async t => {
  await assert.rejects(main(['--stop', __dirname]), /DEX_SERVICES_REPORT_PATH/);
  const directory = folder(t), file = path.join(directory, 'group.json');
  fs.writeFileSync(file, '{}');
  const stat = fs.lstatSync;
  for (const unsafe of [{ file: false, link: false, nlink: 1 }, { file: true, link: true, nlink: 1 }, { file: true, link: false, nlink: 2 }]) {
    const mock = t.mock.method(fs, 'lstatSync', function(target, ...args) {
      return path.resolve(target) === file ? { isFile: () => unsafe.file, isSymbolicLink: () => unsafe.link, nlink: unsafe.nlink } : stat.call(this, target, ...args);
    });
    await assert.rejects(main(['--stop', directory]), /DEX_SERVICES_GROUP_FILE/);
    assert.equal(fs.existsSync(path.join(directory, 'stop-request.json')), false);
    mock.mock.restore();
  }
});

test('spawn exception stops already launched children without restart', async t => {
  const fixture = children();
  let starts = 0;
  await assert.rejects(main(['--once', folder(t)], { signals: new EventEmitter(), spawn(...args) {
    if (++starts === 2) throw Object.assign(Error('spawn failed'), { code: 'EACCES' });
    return fixture.spawn(...args);
  } }), /spawn failed/);
  assert.equal(starts, 2);
  assert.deepEqual(fixture.calls[0].child.messages, [{ type: 'CHAINWHISPER_SERVICE_STOP' }]);
});

test('stop request before handler registration is retained; unrelated IPC is ignored', async () => {
  const target = new EventEmitter();
  let unref = 0, stopped = 0;
  target.connected = true; target.channel = { unref() { unref++; } };
  install(target);
  target.emit('message', { type: 'UNRELATED' });
  target.emit('message', { type: 'CHAINWHISPER_SERVICE_STOP' });
  target.on('SIGINT', () => { stopped++; });
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(stopped, 1); assert.equal(unref, 1);
});

test('late request and parent disconnect invoke the existing SIGINT handler', () => {
  for (const event of ['message', 'disconnect']) {
    const target = new EventEmitter(); let stopped = 0;
    target.connected = true; install(target);
    target.on('SIGINT', () => { stopped++; });
    target.emit(event, { type: 'CHAINWHISPER_SERVICE_STOP' });
    assert.equal(stopped, 1);
  }
});

test('real child stops through IPC without a platform kill', { timeout: 5000 }, async t => {
  const directory = folder(t), script = path.join(directory, 'child.cjs');
  fs.writeFileSync(script, "process.once('SIGINT',()=>{process.send('stopped',()=>process.exit(0));});process.send('ready');setInterval(()=>{},1000);\n");
  const child = fork(script, [], { windowsHide: true, execArgv: ['--require', path.join(__dirname, 'current-dex-service-stop.cjs')], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const messages = [];
  child.on('message', message => { messages.push(message); if (message === 'ready') child.send({ type: 'CHAINWHISPER_SERVICE_STOP' }); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0); assert.deepEqual(messages, ['ready', 'stopped']);
});

test('managed read queue covers two in-budget physical requests but queued broadcast keeps its deadline', { timeout: 5000 }, async t => {
 const directory=folder(t),script=path.join(directory,'managed-read-budget.cjs');
 fs.writeFileSync(script,`
 const assert=require('node:assert/strict');
 const {createPacing,createManagedAdmission}=require(${JSON.stringify(path.join(__dirname,'current-dex-rpc-pacing.cjs'))});
 const {FetchRequest}=require(${JSON.stringify(require.resolve('ethers'))});
 const seen=[];const paced=createPacing(async r=>{const v=JSON.parse(new TextDecoder().decode(r.body));seen.push(v.id);
   assert.equal(r.timeout,150);await new Promise(resolve=>setTimeout(resolve,90));
   return {statusCode:200,body:new TextEncoder().encode(JSON.stringify({jsonrpc:'2.0',id:v.id,result:'0x1'}))};
 },500,()=>{},createManagedAdmission('matching'));
 const make=(id,method,timeout)=>{const r=new FetchRequest('https://testnet.coti.io/rpc');r.body=JSON.stringify({jsonrpc:'2.0',id,method,params:[]});r.timeout=timeout;return r;};
 const mixed=make(5,'eth_blockNumber',30);mixed.body=JSON.stringify([{jsonrpc:'2.0',id:5,method:'eth_blockNumber',params:[]},{jsonrpc:'2.0',id:6,method:'eth_sendRawTransaction',params:[]}]);
 Promise.allSettled([1,2,3].map(id=>paced.getUrl(make(id,'eth_blockNumber',150),{checkSignal(){}})).concat(
   paced.getUrl(make(4,'eth_sendRawTransaction',30),{checkSignal(){}}),paced.getUrl(mixed,{checkSignal(){}})))
 .then(results=>process.send({type:'TEST_DONE',seen,results:results.map(r=>r.status==='fulfilled'?'OK':r.reason.message),stats:paced.stats()}));
 `);
 const child=fork(script,[],{windowsHide:true,env:{...process.env,CHAINWHISPER_RPC_MANAGED_SERVICE:'matching'},execArgv:['--require',path.join(__dirname,'current-dex-service-stop.cjs')],stdio:['ignore','ignore','ignore','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill();});const stops=[],messages=[];
 const group=createRpcAdmission({onStop:reason=>stops.push(reason)});group.bind('matching',child);child.on('message',m=>messages.push(m));
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(code,0);assert.deepEqual(stops,[]);const done=messages.find(m=>m.type==='TEST_DONE');assert(done);
 assert.deepEqual(done.results,['OK','OK','OK','DEX_RPC_QUEUE_TIMEOUT','DEX_RPC_QUEUE_TIMEOUT']);assert.deepEqual(done.seen,[1,2,3]);
 assert.equal(done.stats.physicalSettled,3);assert.equal(done.stats.localIntervalMs,0);assert.equal(group.stats().occupiedSlots,0);group.stop('TEST_COMPLETE');
});

for (const service of ['keeper','prices','matching','c1']) test(`a supervised ${service} process uses zero local spacing and exits cleanly through real IPC`, { timeout: 5000 }, async t => {
  const directory = folder(t), script = path.join(directory, 'managed-child.cjs');
  fs.writeFileSync(script, `
    const { createPacing, createManagedAdmission } = require(${JSON.stringify(path.join(__dirname, 'current-dex-rpc-pacing.cjs'))});
    const { FetchRequest } = require(${JSON.stringify(require.resolve('ethers'))});
    const paced = createPacing(async request => ({ statusCode: 200, statusMessage: 'OK', headers: {},
      body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0',
        id: JSON.parse(new TextDecoder().decode(request.body)).id, result: '0x1' })) }),
      500, () => {}, createManagedAdmission(${JSON.stringify(service)}));
    const request = new FetchRequest('https://testnet.coti.io/rpc');
    request.body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
    request.timeout = 200;
    const second = request.clone(); second.body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] });
    Promise.all([paced.getUrl(request, { checkSignal() {} }), paced.getUrl(second, { checkSignal() {} })])
      .then(() => process.send({ type: 'TEST_DONE', stats: paced.stats() })).catch(() => { process.exitCode = 1; });
  `);
  const child = fork(script, [], { windowsHide: true,
    env: { ...process.env, CHAINWHISPER_RPC_MANAGED_SERVICE: service },
    execArgv: ['--require', path.join(__dirname, 'current-dex-service-stop.cjs')],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const stops = [], messages = [];
  const group = createRpcAdmission({ onStop: reason => stops.push(reason) });
  group.bind(service, child);
  child.on('message', message => messages.push(message));
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0); assert.deepEqual(stops, []);
  assert(messages.some(message => message.type === 'TEST_DONE'));
  assert.equal(messages.find(message => message.type === 'TEST_DONE').stats.localIntervalMs, 0);
  assert(messages.some(message => message.type === 'CHAINWHISPER_RPC_IDLE_EXIT'));
  assert.equal(group.stats().physicalStarts, 2); assert.equal(group.stats().physicalSettled, 2);
  assert.equal(group.stats().occupiedSlots, 0); group.stop('TEST_COMPLETE');
});

// CW-084: the 2026-11-15 group stopped with HTTP 403 after about 44 starts per second for five minutes.
function sustainedDemand(t, total, options = {}) {
  const child = new EventEmitter(), stops = [], grants = [];
  child.connected = true;
  const group = createRpcAdmission({ onStop: reason => stops.push(reason), ...options });
  t.after(() => group.stop('TEST_COMPLETE'));
  const finished = new Promise(resolve => {
    const request = id => child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: 'c1', id, queueMs: 5000 });
    child.send = (message, callback) => {
      callback?.(null);
      if (message.type !== 'CHAINWHISPER_RPC_GRANT') return;
      grants.push(performance.now());
      setImmediate(() => {
        child.emit('message', { type: 'CHAINWHISPER_RPC_STARTED', service: 'c1', id: message.id });
        child.emit('message', { type: 'CHAINWHISPER_RPC_RESPONSE', service: 'c1', id: message.id, statusCode: 200 });
        if (message.id < total) request(message.id + 1); else resolve();
      });
    };
    group.bind('c1', child); request(1);
  });
  return { group, stops, grants, finished };
}

test('sustained aggregate demand is granted at the bounded rate after its burst', { timeout: 5000 }, async t => {
  const fixture = sustainedDemand(t, 15, { startLimit: { burstStarts: 5, startsPerSecond: 20 } });
  await fixture.finished;
  const { grants } = fixture, stats = fixture.group.stats();
  assert.deepEqual(fixture.stops, []); assert.equal(stats.physicalStarts, 15); assert.equal(stats.responses, 15);
  // Ten starts after the burst need about 500 ms at 20 per second.
  assert(grants[14] - grants[0] >= 440, `sustained starts were not bounded: ${Math.round(grants[14] - grants[0])} ms`);
  assert(grants[4] - grants[0] < 100, 'the permitted burst was delayed');
  // No interval may hold more than the burst plus the earned starts.
  for (let index = 5; index < 15; index++) assert(grants[index] - grants[0] >= (index - 5) * 50 - 5, 'a sustained start came early');
  assert.deepEqual(stats.aggregateStartLimit, { burstStarts: 5, startsPerSecond: 20 });
  assert(stats.delayedGrants >= 9); assert.equal(stats.expired, 0); assert.equal(stats.occupiedSlots, 0);
});

test('the default aggregate start limit leaves ordinary bursts undelayed and cannot be weakened', { timeout: 5000 }, async t => {
  const fixture = sustainedDemand(t, 200);
  await fixture.finished;
  const stats = fixture.group.stats();
  assert.deepEqual(stats.aggregateStartLimit, { burstStarts: 600, startsPerSecond: 20 });
  assert.equal(stats.delayedGrants, 0); assert.equal(stats.physicalStarts, 200); assert.deepEqual(fixture.stops, []);
  for (const startLimit of [{ burstStarts: 601, startsPerSecond: 20 }, { burstStarts: 600, startsPerSecond: 21 },
    { burstStarts: 0, startsPerSecond: 20 }, { burstStarts: 5.5, startsPerSecond: 20 }, { burstStarts: 5 }])
    assert.throws(() => createRpcAdmission({ onStop() {}, startLimit }), /DEX_RPC_START_LIMIT/);
});

test('a supervised c1 process reading blocks without local spacing is held to the aggregate start limit', { timeout: 10000 }, async t => {
  const directory = folder(t), script = path.join(directory, 'managed-c1-blocks.cjs');
  fs.writeFileSync(script, `
    const { createPacing, createManagedAdmission } = require(${JSON.stringify(path.join(__dirname, 'current-dex-rpc-pacing.cjs'))});
    const { FetchRequest } = require(${JSON.stringify(require.resolve('ethers'))});
    const paced = createPacing(async request => ({ statusCode: 200, statusMessage: 'OK', headers: {},
      body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0',
        id: JSON.parse(new TextDecoder().decode(request.body)).id, result: { number: '0x1' } })) }),
      334, () => {}, createManagedAdmission('c1'));
    (async () => {
      for (let id = 1; id <= 15; id++) {
        const request = new FetchRequest('https://testnet.coti.io/rpc');
        request.body = JSON.stringify({ jsonrpc: '2.0', id, method: 'eth_getBlockByNumber', params: ['0x' + id.toString(16), false] });
        request.timeout = 5000;
        await paced.getUrl(request, { checkSignal() {} });
      }
      process.send({ type: 'TEST_DONE', stats: paced.stats() });
    })().catch(() => { process.exitCode = 1; });
  `);
  const child = fork(script, [], { windowsHide: true,
    env: { ...process.env, CHAINWHISPER_RPC_MANAGED_SERVICE: 'c1' },
    execArgv: ['--require', path.join(__dirname, 'current-dex-service-stop.cjs')],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const stops = [], messages = [], starts = [];
  const group = createRpcAdmission({ onStop: reason => stops.push(reason), startLimit: { burstStarts: 5, startsPerSecond: 20 } });
  group.bind('c1', child);
  child.on('message', message => { messages.push(message); if (message.type === 'CHAINWHISPER_RPC_STARTED') starts.push(performance.now()); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0); assert.deepEqual(stops, []);
  const done = messages.find(message => message.type === 'TEST_DONE'); assert(done);
  // The reproduced condition: the managed C1 client itself applies no spacing.
  assert.equal(done.stats.localIntervalMs, 0); assert.equal(done.stats.methods.eth_getBlockByNumber, 15);
  assert.equal(starts.length, 15);
  assert(starts[14] - starts[0] >= 440, `C1 block reads were not bounded: ${Math.round(starts[14] - starts[0])} ms`);
  const stats = group.stats();
  assert(stats.delayedGrants >= 9); assert.equal(stats.physicalStarts, 15); assert.equal(stats.physicalSettled, 15);
  assert.deepEqual(stats.statuses, { 200: 15 }); assert.equal(stats.expired, 0); assert.equal(stats.occupiedSlots, 0);
  group.stop('TEST_COMPLETE');
});

test('a start held by the aggregate limit still expires at its queue deadline and is never granted', { timeout: 5000 }, async t => {
  const child = new EventEmitter(), stops = [], sent = [];
  child.connected = true; child.send = (message, callback) => { sent.push({ ...message, at: performance.now() }); callback?.(null); };
  const group = createRpcAdmission({ onStop: reason => stops.push(reason), startLimit: { burstStarts: 1, startsPerSecond: 0.5 } });
  t.after(() => group.stop('TEST_COMPLETE'));
  group.bind('c1', child);
  child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: 'c1', id: 1, queueMs: 5000 });
  child.emit('message', { type: 'CHAINWHISPER_RPC_STARTED', service: 'c1', id: 1 });
  child.emit('message', { type: 'CHAINWHISPER_RPC_RESPONSE', service: 'c1', id: 1, statusCode: 200 });
  const requested = performance.now();
  child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: 'c1', id: 2, queueMs: 120 });
  assert.equal(group.stats().queued, 1); assert.equal(group.stats().occupiedSlots, 0);
  await new Promise(resolve => setTimeout(resolve, 400));
  const rejected = sent.find(message => message.type === 'CHAINWHISPER_RPC_REJECT');
  assert.equal(rejected?.id, 2); assert.equal(rejected.code, 'DEX_RPC_QUEUE_TIMEOUT'); assert(rejected.at - requested >= 115);
  assert.deepEqual(sent.filter(message => message.type === 'CHAINWHISPER_RPC_GRANT').map(message => message.id), [1]);
  const stats = group.stats();
  assert.equal(stats.expired, 1); assert.equal(stats.grants, 1); assert.equal(stats.queued, 0); assert.equal(stats.delayedGrants, 1);
  assert.deepEqual(stops, []);
});

test('a group stop rejects a start held by the aggregate limit and grants nothing later', { timeout: 5000 }, async () => {
  const child = new EventEmitter(), stops = [], sent = [];
  child.connected = true; child.send = (message, callback) => { sent.push(message); callback?.(null); };
  const group = createRpcAdmission({ onStop: reason => stops.push(reason), startLimit: { burstStarts: 1, startsPerSecond: 10 } });
  group.bind('c1', child);
  child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: 'c1', id: 1, queueMs: 5000 });
  child.emit('message', { type: 'CHAINWHISPER_RPC_STARTED', service: 'c1', id: 1 });
  child.emit('message', { type: 'CHAINWHISPER_RPC_RESPONSE', service: 'c1', id: 1, statusCode: 200 });
  child.emit('message', { type: 'CHAINWHISPER_RPC_REQUEST', service: 'c1', id: 2, queueMs: 5000 });
  assert.equal(group.stats().queued, 1);
  group.stop('DEX_RPC_HTTP_403');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(sent.filter(message => message.type === 'CHAINWHISPER_RPC_GRANT').map(message => message.id), [1]);
  assert.deepEqual(sent.filter(message => message.type === 'CHAINWHISPER_RPC_REJECT').map(message => [message.id, message.code]), [[2, 'DEX_RPC_HTTP_403']]);
  const stats = group.stats();
  assert.equal(stats.stopped, 'DEX_RPC_HTTP_403'); assert.equal(stats.stoppedBeforeStart, 1); assert.equal(stats.queued, 0); assert.equal(stats.grants, 1);
});

// CW-102: one failed read or one 403 must not stop the group; a send is never retried.
const fastRetry = { delaysMs: [10, 40, 160], maximumRetryAfterMs: 300000 };
const shortRefusal = { cooldownMs: [150, 300] };
const transportFailure = () => Object.assign(Error('synthetic reset'), { code: 'ECONNRESET', syscall: 'read' });

for (const kind of ['HTTP 503', 'transport']) test(`a managed read ${kind} failure is retried once and siblings keep running`, async t => {
  let sent = 0;
  const fixture = rpcGroup(t, async (_name, request) => {
    if (++sent === 1) { if (kind === 'transport') throw transportFailure(); return rpcResponse(request, 503); }
    return rpcResponse(request);
  }, () => {}, { retry: fastRetry, refusal: shortRefusal });
  const results = await Promise.all(fixture.peers.map((peer, index) => peer.pacing.getUrl(rpcRequest(index), rpcSignal)));
  assert(results.every(result => result.statusCode === 200)); assert.equal(sent, 5); assert.deepEqual(fixture.stops, []);
  const stats = fixture.group.stats();
  assert.equal(stats.stopped, null); assert.deepEqual(stats.statuses, { 200: 4 });
  assert.equal(stats.physicalStarts, 5); assert.equal(stats.physicalSettled, 5); assert.equal(stats.responses, 4);
  assert.equal(stats.retried, 1); assert.deepEqual(stats.retryCodes, { [kind === 'transport' ? 'DEX_RPC_TRANSPORT_STOP' : 'DEX_RPC_HTTP_503']: 1 });
  assert.equal(stats.perService.keeper.retried, 1); assert.equal(stats.occupiedSlots, 0); assert.equal(stats.unknownInFlight, 0);
  assert.equal(fixture.peers[0].pacing.stats().retries.total, 1); assert.equal(fixture.peers[0].pacing.stats().lastFailure, undefined);
});

test('a managed read that fails four times stops the group with one final status', async t => {
  let sent = 0;
  const fixture = rpcGroup(t, async (_name, request) => { sent++; return rpcResponse(request, 502); }, () => {}, { retry: fastRetry, refusal: shortRefusal });
  await assert.rejects(fixture.peers[0].pacing.getUrl(rpcRequest(1), rpcSignal), /DEX_RPC_HTTP_502/);
  assert.equal(sent, 4); assert.deepEqual(fixture.stops, ['DEX_RPC_HTTP_502']);
  const stats = fixture.group.stats();
  assert.deepEqual(stats.statuses, { 502: 1 }); assert.equal(stats.retried, 3); assert.equal(stats.unresolvedOccupancy, 0);
  assert.equal(stats.physicalInFlight, 0); assert.equal(stats.unknownInFlight, 0);
});

test('one 403 cools down every read in the group and the refused read then succeeds', { timeout: 5000 }, async t => {
  let sent = 0, refusedAt = null; const starts = [];
  const fixture = rpcGroup(t, async (name, request) => {
    starts.push({ name, at: performance.now() });
    if (++sent === 1) { refusedAt = performance.now(); return rpcResponse(request, 403); }
    return rpcResponse(request);
  }, () => {}, { retry: fastRetry, refusal: shortRefusal });
  const first = fixture.peers[0].pacing.getUrl(rpcRequest(1), rpcSignal);
  await new Promise(resolve => setTimeout(resolve, 20));
  const others = fixture.peers.slice(1).map((peer, index) => peer.pacing.getUrl(rpcRequest(index + 2), rpcSignal));
  const results = await Promise.all([first, ...others]);
  assert(results.every(result => result.statusCode === 200)); assert.deepEqual(fixture.stops, []);
  for (const start of starts.slice(1)) assert(start.at - refusedAt >= 145, `a read started during the cool-down: ${Math.round(start.at - refusedAt)} ms`);
  const stats = fixture.group.stats();
  assert.deepEqual(stats.statuses, { 200: 4 }); assert.equal(stats.retried, 1); assert.deepEqual(stats.retryCodes, { DEX_RPC_HTTP_403: 1 });
  assert.equal(stats.refusalCoolDowns, 1); assert.equal(stats.stopped, null);
});

test('a 403 repeated past the cool-down bound stops the group with one final 403', { timeout: 5000 }, async t => {
  let sent = 0;
  const fixture = rpcGroup(t, async (_name, request) => { sent++; return rpcResponse(request, 403); }, () => {}, { retry: fastRetry, refusal: { cooldownMs: [30, 60] } });
  await assert.rejects(fixture.peers[0].pacing.getUrl(rpcRequest(1), rpcSignal));
  assert.equal(sent, 3); assert.deepEqual(fixture.stops, ['DEX_RPC_HTTP_403']);
  const stats = fixture.group.stats();
  assert.equal(stats.stopped, 'DEX_RPC_HTTP_403'); assert.deepEqual(stats.statuses, { 403: 1 }); assert.equal(stats.retried, 2);
  assert.equal(stats.refusalCoolDowns, 2); assert.equal(stats.unresolvedOccupancy, 0); assert.equal(stats.physicalInFlight, 0); assert.equal(stats.unknownInFlight, 0);
  assert.equal(stats.occupiedSlots, 0);
});

function rawGroup(t, options = {}) {
  const stops = [], sent = [], group = createRpcAdmission({ onStop: reason => stops.push(reason), refusal: shortRefusal, ...options });
  t.after(() => group.stop('TEST_COMPLETE'));
  const peers = Object.fromEntries(['keeper', 'prices', 'matching', 'c1'].map(name => {
    const child = new EventEmitter(); child.connected = true;
    child.send = (message, callback) => { sent.push({ ...message, at: performance.now() }); callback?.(null); };
    group.bind(name, child);
    return [name, (type, fields = {}) => child.emit('message', { type: `CHAINWHISPER_RPC_${type}`, service: name, ...fields })];
  }));
  const grants = name => sent.filter(message => message.type === 'CHAINWHISPER_RPC_GRANT' && message.service === name).map(message => message.id);
  return { group, stops, sent, peers, grants };
}

test('a marked send is granted during a read cool-down; reads and unmarked requests wait for its end', { timeout: 5000 }, async t => {
  const { group, stops, peers, grants } = rawGroup(t);
  peers.keeper('REQUEST', { id: 1, queueMs: 5000, read: true }); peers.keeper('STARTED', { id: 1 });
  peers.keeper('RETRY', { id: 1, code: 'DEX_RPC_HTTP_403', statusCode: 403, waitMs: 10 });
  peers.c1('REQUEST', { id: 1, queueMs: 5000, read: true });
  peers.matching('REQUEST', { id: 1, queueMs: 5000, read: false });
  peers.prices('REQUEST', { id: 1, queueMs: 5000, read: false, send: true });
  assert.deepEqual(grants('prices'), [1]); assert.deepEqual(grants('c1'), []); assert.deepEqual(grants('matching'), []);
  peers.prices('STARTED', { id: 1 }); peers.prices('RESPONSE', { id: 1, statusCode: 200 });
  assert.deepEqual(grants('c1'), []); assert(group.stats().coolingMs > 0);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(grants('c1'), [1]); assert.deepEqual(stops, []);
  peers.c1('STARTED', { id: 1 }); peers.c1('RESPONSE', { id: 1, statusCode: 200 });
  assert.deepEqual(grants('matching'), [1]);
});

for (const [kind, message, setup] of [
  ['a send', { id: 1, code: 'DEX_RPC_HTTP_503', statusCode: 503, waitMs: 10 }, { read: false, started: true }],
  ['a request without the read flag', { id: 1, code: 'DEX_RPC_TRANSPORT_STOP', waitMs: 10 }, { started: true }],
  ['an attempt that has not started', { id: 1, code: 'DEX_RPC_HTTP_503', statusCode: 503, waitMs: 10 }, { read: true, started: false }],
  ['a status that does not match its code', { id: 1, code: 'DEX_RPC_HTTP_503', statusCode: 502, waitMs: 10 }, { read: true, started: true }],
  ['a non-retryable status', { id: 1, code: 'DEX_RPC_HTTP_404', statusCode: 404, waitMs: 10 }, { read: true, started: true }],
  ['a wait above the bound', { id: 1, code: 'DEX_RPC_HTTP_429', statusCode: 429, waitMs: 300001 }, { read: true, started: true }],
  ['a response timeout', { id: 1, code: 'DEX_RPC_RESPONSE_TIMEOUT', waitMs: 10 }, { read: true, started: true }]
]) test(`the supervisor refuses a retry for ${kind}`, t => {
  const { group, stops, peers } = rawGroup(t);
  peers.matching('REQUEST', { id: 1, queueMs: 5000, ...(setup.read === undefined ? {} : { read: setup.read }) });
  if (setup.started) peers.matching('STARTED', { id: 1 });
  peers.matching('RETRY', message);
  assert.deepEqual(stops, ['DEX_RPC_IPC_PROTOCOL']); assert.equal(group.stats().retried, 0);
});

test('a 429 holds every read in the group for its wait', { timeout: 5000 }, async t => {
  const { stops, peers, grants, sent } = rawGroup(t);
  peers.keeper('REQUEST', { id: 1, queueMs: 5000, read: true }); peers.keeper('STARTED', { id: 1 });
  const at = performance.now();
  peers.keeper('RETRY', { id: 1, code: 'DEX_RPC_HTTP_429', statusCode: 429, waitMs: 120 });
  peers.c1('REQUEST', { id: 1, queueMs: 5000, read: true });
  assert.deepEqual(grants('c1'), []);
  await new Promise(resolve => setTimeout(resolve, 200));
  const grant = sent.find(message => message.type === 'CHAINWHISPER_RPC_GRANT' && message.service === 'c1');
  assert(grant && grant.at - at >= 115); assert.deepEqual(stops, []);
});

test('a group stop during a retry backoff ends the wait without a later request', { timeout: 5000 }, async t => {
  let sent = 0;
  const fixture = rpcGroup(t, async (_name, request) => { sent++; return rpcResponse(request, 503); }, () => {},
    { retry: { delaysMs: [1000], maximumRetryAfterMs: 0 }, refusal: shortRefusal });
  const pending = fixture.peers[0].pacing.getUrl(rpcRequest(1), rpcSignal);
  await new Promise(resolve => setTimeout(resolve, 30));
  const stoppedAt = performance.now();
  fixture.peers[0].target.emit('message', { type: 'CHAINWHISPER_SERVICE_STOP' });
  await assert.rejects(pending, /DEX_RPC_GROUP_STOP/);
  assert(performance.now() - stoppedAt < 200); assert.equal(sent, 1);
  assert.equal(fixture.peers[0].pacing.stats().unresolvedOccupancy, 0);
});

test('the refusal cool-down can be shortened for tests but never lengthened or given more cool-downs', () => {
  for (const refusal of [{ cooldownMs: [180001] }, { cooldownMs: [1, 1, 1] }, { cooldownMs: [0] }, { cooldownMs: [] }, { cooldownMs: 'x' }])
    assert.throws(() => createRpcAdmission({ onStop() {}, refusal }), /DEX_RPC_REFUSAL_POLICY/);
  const group = createRpcAdmission({ onStop() {} });
  assert.deepEqual(group.stats().refusalCoolDown, { cooldownMs: [180000, 300000], windowMs: 7200000 });
  group.stop('TEST_COMPLETE');
});

test('a run whose read was retried returns clean and renews', async t => {
  const fixture = operatingChildren(row => { void row.complete({ requests: 1, retried: row.name === 'keeper' && row.run === 1 ? 1 : 0 }); });
  const result = await main(['--operate', folder(t)], { spawn: fixture.spawn, signals: new EventEmitter() });
  assert.equal(result.status, 'COMPLETE');
  assert(result.runs.keeper.every(row => row.status === 'RETURNED'));
  assert.equal(result.rpc.retried, 1); assert.equal(result.rpc.statuses[200], fixture.calls.length);
});

test('a run whose child summary hides a retry does not return clean', async t => {
  const fixture = operatingChildren(row => { void row.complete({ requests: 1, retried: row.name === 'keeper' ? 1 : 0, traffic: row.name === 'keeper' ? { retries: { total: 0 } } : {} }); });
  const result = await main(['--operate', folder(t)], { spawn: fixture.spawn, signals: new EventEmitter() });
  assert.equal(result.status, 'STOPPED'); assert.equal(result.stopReason, 'keeper:FAILED');
});

test('a supervised c1 process retries a 503 read through real IPC without stopping the group', { timeout: 10000 }, async t => {
  const directory = folder(t), script = path.join(directory, 'managed-c1-retry.cjs');
  fs.writeFileSync(script, `
    const { createPacing, createManagedAdmission } = require(${JSON.stringify(path.join(__dirname, 'current-dex-rpc-pacing.cjs'))});
    const { FetchRequest } = require(${JSON.stringify(require.resolve('ethers'))});
    let sent = 0;
    const paced = createPacing(async request => ({ statusCode: ++sent === 1 ? 503 : 200, statusMessage: 'x', headers: {},
      body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(new TextDecoder().decode(request.body)).id, result: '0x1' })) }),
      334, () => {}, createManagedAdmission('c1'), false, { retry: { delaysMs: [10], maximumRetryAfterMs: 0 } });
    (async () => {
      for (let id = 1; id <= 2; id++) {
        const request = new FetchRequest('https://testnet.coti.io/rpc');
        request.body = JSON.stringify({ jsonrpc: '2.0', id, method: 'eth_getBlockByNumber', params: ['0x1', false] });
        request.timeout = 5000;
        await paced.getUrl(request, { checkSignal() {} });
      }
      process.send({ type: 'TEST_DONE', stats: paced.stats() });
    })().catch(() => { process.exitCode = 1; });
  `);
  const child = fork(script, [], { windowsHide: true, env: { ...process.env, CHAINWHISPER_RPC_MANAGED_SERVICE: 'c1' },
    execArgv: ['--require', path.join(__dirname, 'current-dex-service-stop.cjs')], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const stops = [], messages = [];
  const group = createRpcAdmission({ onStop: reason => stops.push(reason) });
  group.bind('c1', child); child.on('message', message => messages.push(message));
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(code, 0); assert.deepEqual(stops, []);
  const done = messages.find(message => message.type === 'TEST_DONE'); assert(done);
  assert.equal(done.stats.retries.total, 1); assert.equal(done.stats.requests, 3); assert.equal(done.stats.localIntervalMs, 0);
  assert(messages.some(message => message.type === 'CHAINWHISPER_RPC_REQUEST' && message.read === true));
  const stats = group.stats();
  assert.equal(stats.retried, 1); assert.deepEqual(stats.statuses, { 200: 2 }); assert.equal(stats.physicalStarts, 3);
  assert.equal(stats.physicalSettled, 3); assert.equal(stats.occupiedSlots, 0); group.stop('TEST_COMPLETE');
});

// CW-151: bounded group state writes and run history.
const { createStateWriter, recordRun, evictedRunTotals, retainedRuns } = require('./current-dex-services.cjs');
test('CW-151: RPC counter changes write the group state at most once per second; saves and close write at once', () => {
  let clock = 0, value = 0; const writes = [];
  const writer = createStateWriter('unused', () => String(value), { now: () => clock, write: text => writes.push(text) });
  writer.save(); assert.deepEqual(writes, ['0']);
  for (let index = 1; index <= 200; index++) { value = index; clock = index * 4; writer.changed(); }
  assert.equal(writes.length, 1, '200 counter changes within 800 ms write nothing more');
  writer.flush(); assert.equal(writes.length, 1);
  clock = 1000; writer.flush(); assert.deepEqual(writes, ['0', '200'], 'the stop poll writes the latest state once');
  clock = 2500; writer.flush(); assert.equal(writes.length, 2, 'no write without a change');
  value = 201; writer.changed(); assert.deepEqual(writes.at(-1), '201', 'a change after a quiet second writes at once');
  value = 202; clock = 2600; writer.changed(); assert.equal(writes.length, 3);
  value = 203; writer.save(); assert.deepEqual(writes.at(-1), '203', 'a status save writes at once inside the interval');
  clock = 3700; writer.flush(); assert.equal(writes.length, 4, 'the status save cleared the pending change');
  value = 204; clock = 3800; writer.save(); assert.equal(writes.length, 5);
  value = 205; clock = 3900; writer.changed(); assert.equal(writes.length, 5);
  writer.close(); assert.deepEqual(writes.at(-1), '205', 'close writes the pending change');
  value = 206; clock = 9000; writer.changed(); writer.flush(); assert.equal(writes.length, 6, 'no counter write after close');
  writer.save(); assert.deepEqual(writes.at(-1), '206', 'a late status save still writes');
});

test('CW-151: the default group state write replaces the whole file by rename', t => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cw151-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const file = path.join(directory, 'group.json'); let value = { status: 'STARTING' };
  const writer = createStateWriter(file, () => JSON.stringify(value) + '\n');
  writer.save(); value = { status: 'RUNNING', pad: 'x'.repeat(10000) }; writer.save(); value = { status: 'STOPPED' }; writer.save();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { status: 'STOPPED' });
  assert.deepEqual(fs.readdirSync(directory), ['group.json']);
});

const cw151Row = (index, extra = {}) => ({ run: index, status: index % 7 ? 'RETURNED' : 'FAILED', feeLimitWei: '100',
  ...(index % 7 ? { actualFeeWei: String(index) } : {}),
  traffic: { methods: { eth_call: 1, ...(index % 3 ? {} : { eth_sendRawTransaction: 2 }) }, physicalPending: 0, unresolvedOccupancy: 0 }, ...extra });
test('CW-151: group runs stay bounded with exact totals of the evicted runs and monotonic run numbers', () => {
  assert.equal(retainedRuns, 50);
  const state = { runs: { keeper: [] }, evictedRuns: { keeper: evictedRunTotals() } }, all = [];
  for (let index = 1; index <= 130; index++) {
    assert.equal(state.evictedRuns.keeper.runs + state.runs.keeper.length + 1, index, 'next run number');
    const row = cw151Row(index); all.push(row); recordRun(state, 'keeper', row);
    assert(state.runs.keeper.length <= 50);
  }
  assert.deepEqual(state.runs.keeper.map(row => row.run), all.slice(80).map(row => row.run));
  const gone = all.slice(0, 80);
  assert.deepEqual(state.evictedRuns.keeper, { runs: 80, missingTraffic: 0, accountingErrors: 0, openTraffic: 0, firstIssue: null,
    sends: gone.reduce((total, row) => total + (row.traffic.methods.eth_sendRawTransaction ?? 0), 0),
    settledFeeWei: String(gone.reduce((total, row) => total + BigInt(row.actualFeeWei ?? 0), 0n)),
    committedFeeWei: String(gone.reduce((total, row) => total + BigInt(row.actualFeeWei ?? row.feeLimitWei), 0n)),
    statuses: { RETURNED: gone.filter(row => row.status === 'RETURNED').length, FAILED: gone.filter(row => row.status === 'FAILED').length } });
  const issues = { runs: { c1: [] }, evictedRuns: { c1: evictedRunTotals() } };
  recordRun(issues, 'c1', cw151Row(1, { accountingError: 'DEX_SERVER_ACCOUNTING' }), 1);
  recordRun(issues, 'c1', { status: 'HELD', feeLimitWei: '5' }, 1);
  recordRun(issues, 'c1', cw151Row(3, { traffic: { methods: { eth_sendRawTransaction: -1 }, physicalPending: 1, unresolvedOccupancy: 0 } }), 1);
  recordRun(issues, 'c1', cw151Row(4), 1);
  assert.deepEqual(issues.evictedRuns.c1, { runs: 3, sends: 0, missingTraffic: 2, accountingErrors: 1, openTraffic: 2,
    firstIssue: 'WATCHDOG_RUN_ACCOUNTING', settledFeeWei: '4', committedFeeWei: '9', statuses: { RETURNED: 2, HELD: 1 } });
  assert.throws(() => recordRun(issues, 'c1', cw151Row(5), 0), /DEX_SERVICES_RUN_HISTORY/);
});

test('CW-151: the watchdog decides the same on a bounded group as on its full run history', () => {
  const { CONFIG, checkGroupTraffic, allRunsSettled } = require('./current-dex-service-watchdog.cjs');
  const full = mutate => {
    const runs = Object.fromEntries(CONFIG.services.map(name => [name, Array.from({ length: 120 }, (_, index) => ({ status: 'RETURNED',
      feeLimitWei: '10', actualFeeWei: '1', traffic: { methods: { eth_call: 3, eth_sendRawTransaction: index % 4 ? 0 : 1 },
        physicalPending: 0, unresolvedOccupancy: 0 } }))]));
    mutate(runs);
    return { status: 'STOPPED', stopReason: 'OPERATOR_STOP', rpc: { physicalInFlight: 0, unknownInFlight: 0, unresolvedOccupancy: 0, statuses: { 200: 9 } }, runs };
  };
  const bounded = group => {
    const state = { ...group, runs: {}, evictedRuns: {} };
    for (const name of CONFIG.services) {
      state.runs[name] = []; state.evictedRuns[name] = evictedRunTotals();
      for (const row of group.runs[name]) recordRun(state, name, structuredClone(row));
    }
    return JSON.parse(JSON.stringify(state));
  };
  const decide = group => { try { return { traffic: checkGroupTraffic(group), settled: allRunsSettled(group) }; } catch (error) { return { guard: error.guard ?? error.message }; } };
  const cases = {
    clean: () => {},
    'old accounting error': runs => { runs.prices[3].accountingError = 'DEX_SERVER_ACCOUNTING'; },
    'old missing traffic': runs => { runs.c1[5].traffic = undefined; },
    'old accounting error before old missing traffic': runs => { runs.prices[2].accountingError = 'X'; runs.prices[10].traffic = undefined; },
    'old missing traffic before old accounting error': runs => { runs.prices[2].traffic = null; runs.prices[10].accountingError = 'X'; },
    'old unsafe send count': runs => { runs.matching[1].traffic.methods.eth_sendRawTransaction = -1; },
    'old accounting error with an unsafe send count': runs => { runs.matching[1].accountingError = 'X'; runs.matching[1].traffic.methods.eth_sendRawTransaction = -1; },
    'old held record without traffic': runs => { runs.c1[0] = { status: 'HELD', feeLimitWei: '10', accountingError: 'DEX_SERVER_ACCOUNTING', noAutomaticRestart: true }; },
    'old open traffic': runs => { runs.keeper[7].traffic.physicalPending = 1; },
    'old unresolved occupancy': runs => { runs.c1[0].traffic.unresolvedOccupancy = 1; },
    'retained accounting error': runs => { runs.c1[119].accountingError = 'X'; },
    'old accounting error before retained missing traffic': runs => { runs.keeper[0].accountingError = 'X'; runs.keeper[100].traffic = undefined; },
    'last run held': runs => { runs.matching[119].status = 'HELD'; }
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const group = full(mutate), small = bounded(group);
    assert(CONFIG.services.every(name => small.runs[name].length === 50 && small.evictedRuns[name].runs === 70), label);
    assert.deepEqual(decide(small), decide(group), label);
  }
  const clean = decide(bounded(full(() => {})));
  assert.deepEqual(clean.traffic.sends, { keeper: 30, prices: 30, matching: 30, c1: 30 }); assert.equal(clean.settled, true);
});
