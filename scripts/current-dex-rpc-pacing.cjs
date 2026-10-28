'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const endpoint = 'https://testnet.coti.io/rpc';
const encode = value => new TextEncoder().encode(JSON.stringify(value));
const decode = value => JSON.parse(new TextDecoder().decode(value));

function createPacing(getUrl, gapMs = 500, checkSource = () => {}) {
  assert([500, 334].includes(gapMs), 'DEX_RPC_RATE');
  let tail = Promise.resolve(), last = null, stopped = null, requests = 0, minimumGapMs = null;
  const methods = {}, statuses = {}, started = performance.now();
  async function send(request, signal, item, expires) {
    const work = tail.then(async () => {
      if (stopped) throw Error(stopped);
      try {
        checkSource(); signal.checkSignal();
        assert(request.url === endpoint, 'DEX_RPC_ENDPOINT');
        assert(item?.jsonrpc === '2.0' && typeof item.method === 'string' && item.id !== undefined, 'DEX_RPC_PAYLOAD');
        while (last !== null && performance.now() - last < gapMs) {
          const delay = Math.ceil(gapMs - (performance.now() - last));
          assert(performance.now() + delay < expires, 'DEX_RPC_TIMEOUT');
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        checkSource(); signal.checkSignal();
        assert(performance.now() < expires, 'DEX_RPC_TIMEOUT');
        const single = request.clone(); single.body = JSON.stringify(item);
        single.timeout = Math.max(1, Math.floor(expires - performance.now()));
        const now = performance.now();
        if (last !== null) minimumGapMs = Math.min(minimumGapMs ?? Infinity, now - last);
        last = now; requests++; methods[item.method] = (methods[item.method] ?? 0) + 1;
        const response = await getUrl(single, signal);
        statuses[response.statusCode] = (statuses[response.statusCode] ?? 0) + 1;
        // Throw before ethers can retry429 or follow a redirect. Never rotate RPCs.
        assert(response.statusCode === 200, `DEX_RPC_HTTP_${response.statusCode}`);
        const value = decode(response.body);
        assert(value?.jsonrpc === '2.0' && value.id === item.id, 'DEX_RPC_RESPONSE');
        return response;
      } catch (error) {
        const name = String(error?.message ?? '').split(/\r?\n/, 1)[0];
        stopped = /^DEX_RPC_[A-Z0-9_]+$/.test(name) ? name : 'DEX_RPC_TRANSPORT_STOP';
        throw Error(stopped);
      }
    });
    tail = work.catch(() => {});
    return work;
  }
  return {
    async getUrl(request, signal) {
      const expires = performance.now() + request.timeout;
      const payload = decode(request.body);
      if (!Array.isArray(payload)) return send(request, signal, payload, expires);
      assert(payload.length > 0, 'DEX_RPC_PAYLOAD');
      // Keeper providers batch reads. Pace each RPC, not just each HTTP envelope.
      const replies = await Promise.all(payload.map(item => send(request, signal, item, expires)));
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: encode(replies.map(r => decode(r.body))) };
    },
    stats: () => ({ requests, methods: { ...methods }, statuses: { ...statuses }, minimumGapMs,
      intervalMs: gapMs, maximumInFlight: 1, elapsedMs: Math.round(performance.now() - started), stopped })
  };
}

// shortcut: caps are per process; test services alone until combined capacity is measured.
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
  const pacing = createPacing(FetchRequest.createGetUrlFunc(), service === 'c1' ? 334 : 500, check);
  // Process-wide: includes separate provider instances, polling and broadcasts.
  for (const cls of classes) cls.registerGetUrl(pacing.getUrl);
  active = { service, pacing };
}
const stats = () => active ? { service: active.service, ...active.pacing.stats() } : null;
module.exports = { createPacing, install, stats };

// Node --require keeps historical, source-bound service entries unchanged.
const selected = /^current-dex-(keeper|prices|matching|c1)\.cjs$/.exec(path.basename(process.argv[1] ?? ''));
if (selected && !['--check', '--inspect'].includes(process.argv[2])) {
  assert.equal(path.resolve(process.argv[1]), path.join(__dirname, `current-dex-${selected[1]}.cjs`), 'DEX_RPC_ENTRY');
  install(selected[1]);
  process.once('exit', () => console.log(JSON.stringify({ status: 'DEX_RPC_PACING_SUMMARY', ...stats() })));
}
