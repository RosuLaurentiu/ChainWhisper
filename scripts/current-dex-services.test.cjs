'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');
const { main, createRpcAdmission, readServerPeriod } = require('./current-dex-services.cjs');
const { createPacing, createManagedAdmission } = require('./current-dex-rpc-pacing.cjs');
const { FetchRequest } = require('ethers');
const { install } = require('./current-dex-service-stop.cjs');
const reports = path.resolve(__dirname, '../reports');
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
function rpcGroup(t, transport, checkSource = () => {}) {
  const peers = [], stops = [], messages = [];
  const group = createRpcAdmission({ onStop: reason => {
    stops.push(reason);
    for (const peer of peers) peer.target.emit('message', { type: 'CHAINWHISPER_SERVICE_STOP' });
  } });
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
      () => checkSource(name), createManagedAdmission(name, target));
    peers.push(peer);
  }
  t.after(() => { group.stop('TEST_COMPLETE'); peers.forEach(peer => peer.target.emit('message', { type: 'CHAINWHISPER_SERVICE_STOP' })); });
  return { group, peers, stops, messages };
}

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
  const fixture = rpcGroup(t, async (_name, request) => { sent++; return rpcResponse(request, status); });
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
  const fixture = rpcGroup(t, async () => { sent++; throw Error('synthetic transport failure'); });
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

function folder(t) {
  const directory = fs.mkdtempSync(path.join(reports, 'service-group-test-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(reports));
    assert(path.basename(directory).startsWith('service-group-test-'));
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
    const name = /^current-dex-(.*)\.cjs$/.exec(path.basename(entry))[1];
    const child = new EventEmitter();
    const row = { name, child, args, run: calls.filter(call => call.name === name).length + 1,
      grants: [], started: [], closed: false,
      close(code = 0) {
        if (row.closed) return;
        row.closed = true; row.closedAt = performance.now(); child.connected = false; child.emit('disconnect'); child.emit('close', code, null);
      },
      async complete({ result = {}, stderr = null, requests = 0, traffic = {}, clean = true, close = true, code = 0 } = {}) {
        for (let id = 1; id <= requests; id++) {
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
          stopped: null, requests, physicalSettled: requests, physicalPending: 0, unresolvedOccupancy: 0,
          statuses: requests ? { 200: requests } : {}, ...traffic }) + '\n');
        if (clean) child.emit('message', { type: 'CHAINWHISPER_RPC_IDLE_EXIT', service: name, id: requests + 1 });
        if (close) row.close(code);
      }
    };
    Object.assign(child, { connected: true, pid: 3000 + calls.length,
      send(message, callback) {
        callback?.(null);
        if (message.type === 'CHAINWHISPER_RPC_GRANT') row.grants.shift()?.();
        if (message.type === 'CHAINWHISPER_SERVICE_STOP') queueMicrotask(() => onStop(row));
      }
    });
    calls.push(row); queueMicrotask(() => onSpawn?.(row)); return child;
  };
  return { calls, spawn };
}

function serverPeriod(t,standing=false) {
  const directory=folder(t),runtime=folder(t),manifest=path.join(runtime,'runtime-public.json');
  fs.writeFileSync(manifest,JSON.stringify({graph:process.env.CW_LOW_RPC_TRIAL}));
  const policy={schema:'CURRENT_DEX_SERVER_PERIOD_V1',graph:process.env.CW_LOW_RPC_TRIAL,
    maximumMs:86400000,maximumNewFeeWei:'2000000000000000000',startedAt:Date.now(),expiresAt:Date.now()+86400000,
    runtimeManifestSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'),approvalSha256:'a'.repeat(64)};
  policy.expiresAt=policy.startedAt+policy.maximumMs;
  if(standing)Object.assign(policy,{mode:'standing',maximumMs:null,expiresAt:null,maximumNewFeeWei:null,priorSpentFeeWei:'796447789500000000'});
  const file=path.join(directory,'period-policy.json'),write=()=>fs.writeFileSync(file,JSON.stringify(policy));write();
  return {directory,policy,write,read:(dir,now=Date.now())=>readServerPeriod(dir,now,manifest)};
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
    const g=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));
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
  if(row.run===49)signals.emit('SIGINT');else void row.complete();
 });
 const result=await main(['--serve',f.directory],{spawn:(...args)=>{initial??=JSON.parse(fs.readFileSync(path.join(f.directory,'group.json')));return fixture.spawn(...args);},signals,readPeriod:f.read,feeSnapshot:name=>({service:name,feeWei:'0'}),feeDelta:()=> '100000000000000000'});
 assert.equal(result.stopReason,'OPERATOR_STOP');assert.equal(result.maximumNewWorkMs,null);assert.equal(result.runs.keeper.length,49);
 assert(Object.values(result.operatingPolicy.services).every(policy=>policy.maximumRuns===null));
 assert.equal(result.operatingPolicy.maximumFeeCommitmentWei,null);
 assert.equal(BigInt(result.settledFeeWei),BigInt(f.policy.priorSpentFeeWei)+4800000000000000000n);
 assert.equal(result.operatingPolicy.oneOffFundingFeeReserveWei,'1500000000000');
 assert.equal(initial.feeCommitmentWei,String(BigInt(f.policy.priorSpentFeeWei)+1500000000000n));
 assert.equal(initial.settledFeeWei,f.policy.priorSpentFeeWei);
 assert.equal(BigInt(result.feeCommitmentWei),Object.values(result.runs).flat().reduce((total,row)=>total+BigInt(row.actualFeeWei??row.feeLimitWei),BigInt(f.policy.priorSpentFeeWei)+1500000000000n));
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
