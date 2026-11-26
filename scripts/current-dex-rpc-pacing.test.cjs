'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const { FetchRequest, JsonRpcProvider } = require('ethers');
const { createPacing } = require('./current-dex-rpc-pacing.cjs');
const URL = 'https://testnet.coti.io/rpc';
const body = value => new TextEncoder().encode(JSON.stringify(value));
function request(payload) { const r = new FetchRequest(URL); r.body = JSON.stringify(payload); return r; }
const call = id => ({ jsonrpc: '2.0', id, method: 'eth_blockNumber', params: [] });
const ok = r => ({ statusCode: 200, statusMessage: 'OK', headers: {}, body: body({ jsonrpc: '2.0', id: JSON.parse(new TextDecoder().decode(r.body)).id, result: '0x1' }) });
const signal = { checkSignal() {} };
test('the rehearsal supervisor and claim can import pacing without installing a worker', () => {
  const entry = require.resolve('./current-dex-c1-rehearsal.cjs');
  const pacing = require.resolve('./current-dex-rpc-pacing.cjs');
  for (const mode of ['--claim','--supervise','--supervise-standing','--rehearse','--stand','--invalid']) {
    const code = `process.argv[1]=${JSON.stringify(entry)};process.argv[2]=${JSON.stringify(mode)};` +
      `require('node:assert/strict').equal(require(${JSON.stringify(pacing)}).stats(),null);`;
    const result = spawnSync(process.execPath,['-e',code],{encoding:'utf8',timeout:10000});
    if (['--stand','--rehearse'].includes(mode)) assert.match(result.stderr,/DEX_RPC_CHILD_IDENTITY/);
    else if (mode === '--invalid') assert.match(result.stderr,/DEX_RPC_ENTRY/);
    else assert.equal(result.status,0,result.stderr);
  }
});
test('queued signal cancellation returns before active transport settles and does not release its slot',async()=>{
 let release,listener;const held=new Promise(resolve=>{release=resolve;}),seen=[];
 const paced=createPacing(async r=>{seen.push(JSON.parse(new TextDecoder().decode(r.body)).id);await held;return ok(r);},0);
 const first=paced.getUrl(request(call(1)),signal);await new Promise(resolve=>setImmediate(resolve));
 let cancelled=false;const queued=paced.getUrl(request(call(2)),{checkSignal(){if(cancelled)throw Error('cancelled');},addListener(fn){listener=fn;}});
 const outcome=queued.then(()=> 'sent',e=>e.message);cancelled=true;listener?.();
 try{assert.equal(await Promise.race([outcome,new Promise(resolve=>setTimeout(()=>resolve('still queued'),30))]),'DEX_RPC_CANCELLED');
 assert.deepEqual(seen,[1]);assert.equal(paced.stats().physicalPending,1);
 }finally{release();await first;await outcome;}
 assert.deepEqual(seen,[1]);assert.equal(paced.stats().cancelled,1);
});

const batchOk = r => ({statusCode:200,statusMessage:'OK',headers:{},body:body(
 JSON.parse(new TextDecoder().decode(r.body)).map(item=>({jsonrpc:'2.0',id:item.id,result:'0x1'})).reverse())});

test('scalar requests retain their original nullable ID and response validation in both pacing modes',async()=>{
 for(const readBatches of [false,true]){
  const paced=createPacing(async()=>({statusCode:200,body:body({jsonrpc:'2.0',id:null})}),500,()=>{},null,readBatches);
  const reply=await paced.getUrl(request(call(null)),signal);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(reply.body)),{jsonrpc:'2.0',id:null});
  assert.equal(paced.stats().requests,1);assert.equal(paced.stats().rpcCalls,1);
 }
});

test('keeper read batches retain up to sixteen logical calls in one physical slot',async()=>{
 let active=0,peak=0,leases=0;const starts=[];
 const admission={acquire:async()=>{assert.equal(active,0);leases++;return{};},assertCurrent(){},started(){return true;},response(){},fail(){}};
 const paced=createPacing(async r=>{peak=Math.max(peak,++active);starts.push(performance.now());
  assert.equal(JSON.parse(new TextDecoder().decode(r.body)).length,16);
  await new Promise(resolve=>setTimeout(resolve,10));active--;return batchOk(r);
 },500,()=>{},admission,true);
 const replies=await Promise.all([0,16].map(offset=>paced.getUrl(request(Array.from({length:16},(_,i)=>call(offset+i))),signal)));
 assert.equal(peak,1);assert.equal(leases,2);assert(starts[1]-starts[0]>=499);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(replies[0].body)).map(row=>row.id),Array.from({length:16},(_,i)=>15-i));
 const stats=paced.stats();assert.equal(stats.requests,2);assert.equal(stats.grants,2);
 assert.equal(stats.physicalSettled,2);assert.equal(stats.rpcCalls,32);assert.equal(stats.methods.eth_blockNumber,32);
 assert.equal(stats.statuses[200],2);
});

test('keeper read batch request limits and IDs fail closed before physical dispatch',async()=>{
 for(const payload of [Array.from({length:17},(_,i)=>call(i)),[call(1),call(1)],
  [call(null),call(2)],[call({private:'invalid'}),call(2)],[]]){
  let sent=0;const paced=createPacing(async r=>{sent++;return batchOk(r);},500,()=>{},null,true);
  await assert.rejects(paced.getUrl(request(payload),signal),/DEX_RPC_PAYLOAD/);
  await assert.rejects(paced.getUrl(request(call(99)),signal),/DEX_RPC_PAYLOAD/);
  assert.equal(sent,0);assert.equal(paced.stats().stopped,'DEX_RPC_PAYLOAD');
 }
});

test('keeper rejects malformed batch responses permanently',async()=>{
 for(const replies of [[{jsonrpc:'2.0',id:1,result:0}],
  [{jsonrpc:'2.0',id:1,result:0},{jsonrpc:'2.0',id:1,result:0}],
  [{jsonrpc:'2.0',id:1,result:0},{jsonrpc:'2.0',id:3,result:0}],
  {jsonrpc:'2.0',id:1,result:0},[{jsonrpc:'2.0',id:1},{jsonrpc:'2.0',id:2,result:0}]]){
  let sent=0;const paced=createPacing(async()=>{sent++;return{statusCode:200,body:body(replies)};},500,()=>{},null,true);
  await assert.rejects(paced.getUrl(request([call(1),call(2)]),signal),/DEX_RPC_RESPONSE/);
  await assert.rejects(paced.getUrl(request(call(3)),signal),/DEX_RPC_RESPONSE/);assert.equal(sent,1);
 }
});

test('keeper mixed batches retain singleton broadcasts and stop without retry',async()=>{
 const methods=[];const paced=createPacing(async r=>{
  const item=JSON.parse(new TextDecoder().decode(r.body));assert(!Array.isArray(item));methods.push(item.method);
  if(item.method==='eth_sendRawTransaction')throw Error('uncertain broadcast');return ok(r);
 },500,()=>{},null,true);
 await assert.rejects(paced.getUrl(request([call(1),{...call(2),method:'eth_sendRawTransaction'},call(3)]),signal));
 assert.deepEqual(methods,['eth_blockNumber','eth_sendRawTransaction']);assert.equal(paced.stats().rpcCalls,2);
});

test('keeper batch HTTP failure and pre-dispatch cancellation retain the stop and queue rules',async()=>{
 let sent=0;const paced=createPacing(async()=>{sent++;return{statusCode:403,body:body({})};},500,()=>{},null,true);
 await assert.rejects(paced.getUrl(request([call(1),call(2)]),signal),/DEX_RPC_HTTP_403/);
 await assert.rejects(paced.getUrl(request(call(3)),signal),/DEX_RPC_HTTP_403/);assert.equal(sent,1);
 const cancelled=createPacing(async r=>{sent++;return batchOk(r);},500,()=>{},null,true);
 await assert.rejects(cancelled.getUrl(request([call(1),call(2)]),{checkSignal(){throw Error('cancelled');}}),/DEX_RPC_CANCELLED/);
 assert.equal(sent,1);assert.equal(cancelled.stats().cancelled,1);assert.equal(cancelled.stats().requests,0);
 const queued=createPacing(async r=>{sent++;return batchOk(r);},500,()=>{},null,true);
 await queued.getUrl(request([call(1),call(2)]),signal);
 const expired=request([call(3),call(4)]);expired.timeout=20;
 await assert.rejects(queued.getUrl(expired,signal),/DEX_RPC_QUEUE_TIMEOUT/);
 assert.equal(sent,2);assert.equal(queued.stats().requests,1);assert.equal(queued.stats().rpcCalls,2);
});

test('RPC refusal retains only safe method, phase, status and provider identifiers',async()=>{
 const ids={cfRay:'0123456789abcdef-FRA',requestId:'12345678-1234-1234-1234-123456789abc'};
 const paced=createPacing(async()=>({statusCode:403,headers:{'CF-Ray':ids.cfRay,'x-request-id':ids.requestId,
  authorization:'PRIVATE_KEY','set-cookie':'PRIVATE_SESSION','x-correlation-id':'PRIVATE_INPUT'},body:body({secret:'PRIVATE_PAYLOAD'})}),500,()=>{},null,true);
 await assert.rejects(paced.getUrl(request([call(1),call(2)]),signal),/DEX_RPC_HTTP_403/);
 assert.deepEqual(paced.stats().lastFailure,{code:'DEX_RPC_HTTP_403',method:'eth_blockNumber',methods:['eth_blockNumber'],phase:'http-response',status:403,providerIds:ids});
 const output=JSON.stringify(paced.stats());assert(!output.includes('PRIVATE_'));
 await assert.rejects(paced.getUrl(request(call(3)),signal),/DEX_RPC_HTTP_403/);
 assert.equal(paced.stats().requests,1);
});

test('RPC error metadata excludes messages, payloads and unrecognized method values',async()=>{
 const item={...call(1),method:'PRIVATE_METHOD_VALUE'};
 const paced=createPacing(async()=>({statusCode:200,headers:{'x-request-id':'PRIVATE_KEY'},
  body:body({jsonrpc:'2.0',id:1,error:{code:-32000,message:'PRIVATE_MESSAGE',data:'PRIVATE_INPUT'}})}));
 await paced.getUrl(request(item),signal);
 assert.deepEqual(paced.stats().lastFailure,{code:'DEX_RPC_ERROR_RESPONSE',method:'other',methods:['other'],
  phase:'rpc-response',status:200,providerIds:{},rpcCode:-32000});
 assert(!JSON.stringify(paced.stats()).includes('PRIVATE_'));
});

test('terminal refusal replaces a handled RPC error and remains unchanged after stop',async()=>{
 let sent=0;
 const paced=createPacing(async()=>++sent===1?{statusCode:200,headers:{},
  body:body({jsonrpc:'2.0',id:1,error:{code:-32000,message:'handled estimate error'}})}:
  {statusCode:403,headers:{'cf-ray':'0123456789abcdef-FRA'},body:body({})});
 await paced.getUrl(request({...call(1),method:'eth_estimateGas'}),signal);
 assert.equal(paced.stats().lastFailure.code,'DEX_RPC_ERROR_RESPONSE');
 await assert.rejects(paced.getUrl(request(call(2)),signal),/DEX_RPC_HTTP_403/);
 const stopped=paced.stats().lastFailure;
 assert.equal(stopped.status,403);assert.equal(stopped.phase,'http-response');
 await assert.rejects(paced.getUrl(request({...call(3),method:'eth_call'}),signal),/DEX_RPC_HTTP_403/);
 assert.deepEqual(paced.stats().lastFailure,stopped);assert.equal(sent,2);
});

test('independent standalone queues do not enforce an aggregate managed-service limit', async () => {
  let active = 0, peak = 0;
  const transport = async r => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--; return ok(r);
  };
  const queues = [createPacing(transport), createPacing(transport)];
  await Promise.all(queues.map((queue, id) => queue.getUrl(request(call(id)), signal)));
  assert.equal(peak, 2);
});

test('queue wait does not consume the finite physical response timeout', async () => {
  const admission = { acquire: async () => { await new Promise(resolve => setTimeout(resolve, 40)); return {}; },
    assertCurrent() {}, started() { return true; }, response() {}, fail() {} };
  const paced = createPacing(async r => {
    assert.equal(r.timeout, 80); await new Promise(resolve => setTimeout(resolve, 60)); return ok(r);
  }, 500, () => {}, admission);
  const first = request(call(1)); first.timeout = 80;
  const result = paced.getUrl(first, signal);
  first.timeout = 1000;
  await result;
});

test('managed admission fails closed when its IPC channel is unavailable', () => {
  const { createManagedAdmission } = require('./current-dex-rpc-pacing.cjs');
  assert.throws(() => createManagedAdmission('keeper', { connected: false }), /DEX_RPC_IPC_UNAVAILABLE/);
});

test('zero spacing retains one occupied slot and FIFO ordering without a fixed sleep', async () => {
  let release, active = 0, peak = 0;
  const order = [], first = new Promise(resolve => { release = resolve; });
  const paced = createPacing(async r => {
    const id = JSON.parse(new TextDecoder().decode(r.body)).id;
    order.push(id); peak = Math.max(peak, ++active);
    if (id === 1) await first;
    active--; return ok(r);
  }, 0);
  const pending = [1, 2, 3].map(id => paced.getUrl(request(call(id)), signal));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, [1]); release();
  await Promise.all(pending);
  assert.deepEqual(order, [1, 2, 3]); assert.equal(peak, 1);
  assert.equal(paced.stats().intervalMs, 0);
  assert.equal(paced.stats().localIntervalMs, 0);
  assert.equal(paced.stats().physicalPending, 0);
});

test('unregistered admission does not remove configured spacing and unsupported rates are rejected', async () => {
  const admission = { service: 'prices', acquire: async () => ({}), assertCurrent() {},
    started() { return true; }, response() {}, fail() {} };
  for (const gap of [-1, 1, NaN, Infinity]) assert.throws(() => createPacing(ok, gap), /DEX_RPC_RATE/);
  let sent = 0;
  const paced = createPacing(async r => { sent++; return ok(r); }, 500, () => {}, admission);
  await paced.getUrl(request(call(1)), signal);
  const later = request(call(2)); later.timeout = 20;
  await assert.rejects(paced.getUrl(later, signal), /DEX_RPC_QUEUE_TIMEOUT/);
  assert.equal(sent, 1); assert.equal(paced.stats().localIntervalMs, 500);
});

test('concurrent and batched reads use one HTTP request per RPC with at least 500ms between starts', async () => {
  const starts = []; let active = 0, peak = 0;
  const paced = createPacing(async r => {
    starts.push(performance.now()); peak = Math.max(peak, ++active);
    assert.equal(Array.isArray(JSON.parse(new TextDecoder().decode(r.body))), false);
    await new Promise(resolve => setTimeout(resolve, 20)); active--; return ok(r);
  });
  const values = await Promise.all([paced.getUrl(request([call(1), call(2)]), signal), paced.getUrl(request(call(3)), signal)]);
  assert.equal(peak, 1); assert.equal(starts.length, 3);
  for (let i = 1; i < starts.length; i++) assert(starts[i] - starts[i - 1] >= 499);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(values[0].body)).map(v => v.id), [1, 2]);
  assert.equal(paced.stats().requests, 3);
});

// CW-102: a standalone 403 still stops at once; 429 and 5xx reads are retried (see the CW-102 tests below).
for (const statusCode of [403]) test(`HTTP${statusCode} closes the queue without retry or sending later calls`, async () => {
  let sent = 0;
  const paced = createPacing(async () => { sent++; return { statusCode, statusMessage: 'blocked', headers: {}, body: body({}) }; });
  const results = await Promise.allSettled([1, 2, 3].map(n => paced.getUrl(request(call(n)), signal)));
  assert(results.every(r => r.status === 'rejected')); assert.equal(sent, 1);
  await assert.rejects(paced.getUrl(request(call(4)), signal)); assert.equal(sent, 1);
  assert.equal(paced.stats().stopped, `DEX_RPC_HTTP_${statusCode}`);
});

test('direct provider methods and broadcasts use the same gate; uncertain broadcast is not resent', async () => {
  const methods = [];
  const paced = createPacing(async r => {
    const item = JSON.parse(new TextDecoder().decode(r.body)); methods.push(item.method);
    if (item.method === 'eth_sendRawTransaction') throw Error('connection reset');
    return ok(r);
  });
  const r = new FetchRequest(URL); r.getUrlFunc = paced.getUrl;
  const provider = new JsonRpcProvider(r, { chainId: 7082400, name: 'coti-testnet' }, { staticNetwork: true, batchMaxCount: 16, batchStallTime: 0 });
  try {
    assert.equal(await provider.getBlockNumber(), 1);
    await assert.rejects(provider.send('eth_sendRawTransaction', ['0xfake-test-only']));
    await assert.rejects(provider.send('eth_gasPrice', []));
    assert.deepEqual(methods, ['eth_blockNumber', 'eth_sendRawTransaction']);
  } finally { provider.destroy(); }
});

test('queued timeout never sends that request', async () => {
  let sent = 0; const paced = createPacing(async r => { sent++; return ok(r); });
  await paced.getUrl(request(call(1)), signal);
  const expired = request(call(2)); expired.timeout = 20;
  await assert.rejects(paced.getUrl(expired, signal), /DEX_RPC_QUEUE_TIMEOUT/);
  assert.equal(sent, 1);
});

test('cancelled request is never sent', async () => {
  let sent = 0; const paced = createPacing(async r => { sent++; return ok(r); });
  await assert.rejects(paced.getUrl(request(call(1)), { checkSignal() { throw Error('cancelled'); } }));
  assert.equal(sent, 0);
});

test('endpoint changes fail before any network call', async () => {
  let sent = 0; const paced = createPacing(async r => { sent++; return ok(r); });
  const r = request(call(1)); r.url = 'https://frankfurt.fullnode.testnet.coti.io/rpc';
  await assert.rejects(paced.getUrl(r, signal), /DEX_RPC_ENDPOINT/); assert.equal(sent, 0);
});

test('source drift stops before HTTP and remains distinct from a network error', async () => {
  let sent = 0;
  const paced = createPacing(async r => { sent++; return ok(r); }, 500,
    () => assert.equal('changed', 'pinned', 'DEX_RPC_SOURCE_DRIFT'));
  await assert.rejects(paced.getUrl(request(call(1)), signal), /DEX_RPC_SOURCE_DRIFT/);
  assert.equal(sent, 0); assert.equal(paced.stats().stopped, 'DEX_RPC_SOURCE_DRIFT');
});

test('both installed ethers copies and new providers share the entry-point stop latch', async t => {
  const { createRequire } = require('node:module');
  const path = require('node:path');
  const contracts = createRequire(path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation/package.json'))('ethers');
  let sent = 0;
  t.mock.method(contracts.FetchRequest, 'createGetUrlFunc', () => async r => {
    sent++; return sent === 1 ? batchOk(r) : { statusCode: 403, statusMessage: 'blocked', headers: {}, body: body({}) };
  });
  const pacing = require('./current-dex-rpc-pacing.cjs'); pacing.install('keeper');
  const first = new FetchRequest(URL), second = new contracts.FetchRequest(URL);
  first.body = JSON.stringify([call(1),call(4)]); second.body = JSON.stringify(call(2));
  assert.equal((await first.send()).statusCode, 200);
  await assert.rejects(second.send(), /DEX_RPC_HTTP_403/);
  const later = new contracts.FetchRequest(URL); later.body = JSON.stringify(call(3));
  await assert.rejects(later.send(), /DEX_RPC_HTTP_403/);
  assert.equal(sent, 2); assert.equal(pacing.stats().requests, 2);
  assert.equal(pacing.stats().rpcCalls, 3);
  assert.equal(pacing.stats().intervalMs, 0);
  assert.equal(pacing.stats().localIntervalMs, 0);
});

// CW-102: one failed read must not stop the group; a broadcast is never retried.
const fastRetry = { delaysMs: [10, 40, 160], maximumRetryAfterMs: 300000 };
const reply = (r, statusCode, headers = {}) => statusCode === 200 ? ok(r) : { statusCode, statusMessage: 'x', headers, body: body({}) };
const transportError = () => Object.assign(Error('PRIVATE_MESSAGE read ECONNRESET'), { code: 'ECONNRESET', syscall: 'read', address: '10.0.0.1' });

for (const [kind, fail] of [['transport error', () => { throw transportError(); }], ['HTTP 503', r => reply(r, 503)],
  ['HTTP 429', r => reply(r, 429)], ['HTTP 500', r => reply(r, 500)], ['HTTP 504', r => reply(r, 504)]]) {
  test(`a read ${kind} is retried once after the first backoff and returns the later response`, async () => {
    let sent = 0; const starts = [];
    const paced = createPacing(async r => { starts.push(performance.now()); return ++sent === 1 ? fail(r) : ok(r); }, 0, () => {}, null, false, { retry: fastRetry });
    const result = await paced.getUrl(request(call(1)), signal);
    assert.equal(result.statusCode, 200); assert.equal(sent, 2); assert(starts[1] - starts[0] >= 9);
    const stats = paced.stats();
    assert.equal(stats.stopped, null); assert.equal(stats.lastFailure, undefined);
    assert.equal(stats.requests, 2); assert.equal(stats.physicalSettled, 2); assert.equal(stats.unresolvedOccupancy, 0);
    assert.equal(stats.retries.total, 1); assert.equal(Object.values(stats.retries.byCode)[0], 1);
    assert.equal(stats.retries.last.method, 'eth_blockNumber'); assert.equal(stats.retries.last.attempt, 1);
    assert(!JSON.stringify(stats).includes('PRIVATE_') && !JSON.stringify(stats).includes('10.0.0.1'));
    assert.equal((await paced.getUrl(request(call(2)), signal)).statusCode, 200); assert.equal(sent, 3);
  });
}

test('a read retry waits at least the Retry-After time and a longer Retry-After stops without retry', async () => {
  let sent = 0; const starts = [];
  const paced = createPacing(async r => { starts.push(performance.now()); return ++sent === 1 ? reply(r, 429, { 'Retry-After': '1' }) : ok(r); }, 0, () => {}, null, false, { retry: fastRetry });
  await paced.getUrl(request(call(1)), signal);
  assert(starts[1] - starts[0] >= 990, `Retry-After was not honoured: ${Math.round(starts[1] - starts[0])} ms`);
  assert(paced.stats().retries.last.waitMs >= 1000);
  let refused = 0;
  const long = createPacing(async r => { refused++; return reply(r, 503, { 'retry-after': '301' }); }, 0, () => {}, null, false, { retry: fastRetry });
  await assert.rejects(long.getUrl(request(call(1)), signal), /DEX_RPC_HTTP_503/);
  assert.equal(refused, 1); assert.equal(long.stats().stopped, 'DEX_RPC_HTTP_503'); assert.equal(long.stats().retries.total, 0);
});

test('a read that keeps failing is tried four times with growing backoff and then stops as before', async () => {
  let sent = 0; const starts = [];
  const paced = createPacing(async r => { starts.push(performance.now()); sent++; return reply(r, 503); }, 0, () => {}, null, false, { retry: fastRetry });
  await assert.rejects(paced.getUrl(request(call(1)), signal), /DEX_RPC_HTTP_503/);
  assert.equal(sent, 4);
  for (const [index, delay] of fastRetry.delaysMs.entries()) assert(starts[index + 1] - starts[index] >= delay - 1);
  const stats = paced.stats();
  assert.equal(stats.stopped, 'DEX_RPC_HTTP_503'); assert.equal(stats.retries.total, 3); assert.equal(stats.lastFailure.status, 503);
  await assert.rejects(paced.getUrl(request(call(2)), signal), /DEX_RPC_HTTP_503/); assert.equal(sent, 4);
});

for (const [kind, fail] of [['transport error', () => { throw transportError(); }], ['HTTP 503', r => reply(r, 503)], ['HTTP 429', r => reply(r, 429)]]) {
  test(`a broadcast ${kind} is never retried and stops the queue`, async () => {
    const methods = [];
    const paced = createPacing(async r => { const item = JSON.parse(new TextDecoder().decode(r.body)); methods.push(item.method); return fail(r); },
      0, () => {}, null, true, { retry: fastRetry });
    await assert.rejects(paced.getUrl(request({ ...call(1), method: 'eth_sendRawTransaction', params: ['0xfake-test-only'] }), signal));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(methods, ['eth_sendRawTransaction']); assert.equal(paced.stats().retries.total, 0);
    assert.notEqual(paced.stats().stopped, null);
  });
}

test('an unknown method, a bad JSON body and a standalone 403 are not retried', async () => {
  for (const [item, response, expected] of [[{ ...call(1), method: 'eth_newMethod' }, r => reply(r, 503), /DEX_RPC_HTTP_503/],
    [call(1), () => ({ statusCode: 200, headers: {}, body: new TextEncoder().encode('not json') }), /DEX_RPC_TRANSPORT_STOP/],
    [call(1), r => reply(r, 403), /DEX_RPC_HTTP_403/]]) {
    let sent = 0;
    const paced = createPacing(async r => { sent++; return response(r); }, 0, () => {}, null, false, { retry: fastRetry });
    await assert.rejects(paced.getUrl(request(item), signal), expected);
    assert.equal(sent, 1); assert.equal(paced.stats().retries.total, 0);
  }
});

// Review H1: ethers leaves a timed-out request open, so a timeout is never retried.
test('a timed-out read is not retried even when its attempt settles later', async () => {
  let sent = 0;
  const paced = createPacing(async r => { sent++; await new Promise(resolve => setTimeout(resolve, 45)); return ok(r); }, 0, () => {}, null, false, { retry: fastRetry });
  const first = request(call(1)); first.timeout = 30;
  await assert.rejects(paced.getUrl(first, signal), /DEX_RPC_RESPONSE_TIMEOUT/);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(sent, 1); assert.equal(paced.stats().retries.total, 0); assert.equal(paced.stats().stopped, 'DEX_RPC_RESPONSE_TIMEOUT');
});

for (const [kind, error] of [['an ethers TIMEOUT', () => Object.assign(Error('request timeout'), { code: 'TIMEOUT' })],
  ['an ethers CANCELLED', () => Object.assign(Error('request cancelled'), { code: 'CANCELLED' })], ['an error without a code', () => Error('unknown')]])
  test(`a transport failure from ${kind} may still be in flight and is not retried`, async () => {
    let sent = 0;
    const paced = createPacing(async () => { sent++; throw error(); }, 0, () => {}, null, false, { retry: fastRetry });
    await assert.rejects(paced.getUrl(request(call(1)), signal), /DEX_RPC_TRANSPORT_STOP/);
    assert.equal(sent, 1); assert.equal(paced.stats().retries.total, 0); assert.equal(paced.stats().unresolvedOccupancy, 1);
  });

// Review M2: the backoff does not hold the service's FIFO.
test('a later broadcast of the same service starts during a read retry backoff', async () => {
  const order = [];
  const paced = createPacing(async r => {
    const item = JSON.parse(new TextDecoder().decode(r.body)); order.push(item.method);
    return item.method === 'eth_blockNumber' && order.length === 1 ? reply(r, 503) : ok(r);
  }, 0, () => {}, null, false, { retry: { delaysMs: [100], maximumRetryAfterMs: 0 } });
  const read = paced.getUrl(request(call(1)), signal);
  await new Promise(resolve => setTimeout(resolve, 20));
  const broadcast = await paced.getUrl(request({ ...call(2), method: 'eth_sendRawTransaction', params: ['0xfake-test-only'] }), signal);
  assert.equal(broadcast.statusCode, 200); assert.deepEqual(order, ['eth_blockNumber', 'eth_sendRawTransaction']);
  assert.equal((await read).statusCode, 200); assert.deepEqual(order, ['eth_blockNumber', 'eth_sendRawTransaction', 'eth_blockNumber']);
});

test('a timed-out read whose first attempt does not settle stops unresolved and is not retried', async () => {
  let sent = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const paced = createPacing(async r => { sent++; await held; return ok(r); }, 0, () => {}, null, false, { retry: fastRetry });
  const first = request(call(1)); first.timeout = 20;
  try {
    await assert.rejects(paced.getUrl(first, signal), /DEX_RPC_RESPONSE_TIMEOUT/);
    assert.equal(sent, 1); assert.equal(paced.stats().unresolvedOccupancy, 1); assert.equal(paced.stats().retries.total, 0);
  } finally { release(); }
});

test('a transport stop records only the error class, the new-connection flag and the transport time', async () => {
  let connections = 0;
  const paced = createPacing(async () => { connections++; throw transportError(); }, 0, () => {}, null, false,
    { retry: { delaysMs: [], maximumRetryAfterMs: 0 }, connections: () => connections });
  await assert.rejects(paced.getUrl(request(call(1)), signal), /DEX_RPC_TRANSPORT_STOP/);
  const failure = paced.stats().lastFailure;
  assert.equal(failure.code, 'DEX_RPC_TRANSPORT_STOP'); assert.equal(failure.phase, 'transport');
  assert.equal(failure.cause.code, 'ECONNRESET'); assert.equal(failure.cause.syscall, 'read');
  assert.equal(failure.cause.newConnection, true); assert(Number.isInteger(failure.cause.transportMs));
  assert(!JSON.stringify(paced.stats()).includes('PRIVATE_') && !JSON.stringify(paced.stats()).includes('10.0.0.1'));
  const timeout = createPacing(async () => { throw Object.assign(Error('request timeout'), { code: 'TIMEOUT' }); }, 0, () => {}, null, false,
    { retry: { delaysMs: [], maximumRetryAfterMs: 0 }, connections: () => 0 });
  await assert.rejects(timeout.getUrl(request(call(1)), signal));
  assert.equal(timeout.stats().lastFailure.cause.code, 'TIMEOUT'); assert.equal(timeout.stats().lastFailure.cause.newConnection, false);
});

test('each read retry passes through a new admission and reports the settled attempt; a send asks as a non-read', async () => {
  const events = [];
  const admission = { acquire: async (_expires, _cancel, read, broadcast) => { events.push(['acquire', read, broadcast]); return { id: events.length }; },
    assertCurrent() {}, started() { events.push(['started']); return true; }, response() { events.push(['response']); }, fail() { events.push(['fail']); },
    retry(_row, detail) { events.push(['retry', detail.code, detail.statusCode, detail.waitMs]); }, pause: ms => new Promise(resolve => setTimeout(resolve, ms)) };
  let sent = 0;
  const paced = createPacing(async r => ++sent === 1 ? reply(r, 502) : ok(r), 0, () => {}, admission, false, { retry: fastRetry });
  await paced.getUrl(request(call(1)), signal);
  assert.deepEqual(events, [['acquire', true, false], ['started'], ['retry', 'DEX_RPC_HTTP_502', 502, 10], ['acquire', true, false], ['started'], ['response']]);
  assert.equal(paced.stats().grants, 2);
  const before = events.length;
  await paced.getUrl(request({ ...call(2), method: 'eth_sendRawTransaction' }), signal);
  assert.deepEqual(events[before], ['acquire', false, true]);
});

test('the retry policy can be shortened for tests but never lengthened or given more attempts', () => {
  for (const retry of [{ delaysMs: [1000, 4000, 16000, 16000], maximumRetryAfterMs: 0 }, { delaysMs: [1001], maximumRetryAfterMs: 0 },
    { delaysMs: [-1], maximumRetryAfterMs: 0 }, { delaysMs: [], maximumRetryAfterMs: 300001 }, { delaysMs: 'x', maximumRetryAfterMs: 0 }])
    assert.throws(() => createPacing(ok, 0, () => {}, null, false, { retry }), /DEX_RPC_RETRY_POLICY/);
});

test('installed services use one keep-alive agent that keeps idle connections for 60 s and counts new connections', () => {
  const { createAgent, keepAliveIdleMs } = require('./current-dex-rpc-pacing.cjs');
  const { agent, connections } = createAgent();
  assert.equal(keepAliveIdleMs, 60000); assert.equal(agent.keepAlive, true); assert.equal(agent.options.timeout, 60000);
  assert.equal(connections(), 0);
  const socket = agent.createConnection({ host: '127.0.0.1', port: 9, servername: 'localhost' });
  socket.on('error', () => {}); socket.destroy();
  assert.equal(connections(), 1);
});
