'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FetchRequest, JsonRpcProvider } = require('ethers');
const { createPacing } = require('./current-dex-rpc-pacing.cjs');
const URL = 'https://testnet.coti.io/rpc';
const body = value => new TextEncoder().encode(JSON.stringify(value));
function request(payload) { const r = new FetchRequest(URL); r.body = JSON.stringify(payload); return r; }
const call = id => ({ jsonrpc: '2.0', id, method: 'eth_blockNumber', params: [] });
const ok = r => ({ statusCode: 200, statusMessage: 'OK', headers: {}, body: body({ jsonrpc: '2.0', id: JSON.parse(new TextDecoder().decode(r.body)).id, result: '0x1' }) });
const signal = { checkSignal() {} };

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

for (const statusCode of [403, 429, 503]) test(`HTTP${statusCode} closes the queue without retry or sending later calls`, async () => {
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
  await assert.rejects(paced.getUrl(expired, signal), /DEX_RPC_TIMEOUT/);
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
    sent++; return sent === 1 ? ok(r) : { statusCode: 403, statusMessage: 'blocked', headers: {}, body: body({}) };
  });
  const pacing = require('./current-dex-rpc-pacing.cjs'); pacing.install('keeper');
  const first = new FetchRequest(URL), second = new contracts.FetchRequest(URL);
  first.body = JSON.stringify(call(1)); second.body = JSON.stringify(call(2));
  assert.equal((await first.send()).statusCode, 200);
  await assert.rejects(second.send(), /DEX_RPC_HTTP_403/);
  const later = new contracts.FetchRequest(URL); later.body = JSON.stringify(call(3));
  await assert.rejects(later.send(), /DEX_RPC_HTTP_403/);
  assert.equal(sent, 2); assert.equal(pacing.stats().requests, 2);
});
