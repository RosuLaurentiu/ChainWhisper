'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const entry = path.join(__dirname, 'current-dex-keeper.cjs');
const runtime = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service/runtime');
const { GRAPH } = require(path.join(runtime, '../public-binding.cjs'));
const hostFile = path.resolve(runtime, `../app-host-${GRAPH.slice(0, 8)}-23abde1d22019d52852d6845c9444326dde1d99e/HOST.json`);
function mockHost(t) {
  const host = JSON.stringify({ operator: '0x23abde1d22019d52852d6845c9444326dde1d99e',
    startBlock: { number: '1', hash: '0x' + '11'.repeat(32) } });
  const read = fs.readFileSync, stat = fs.lstatSync, exists = fs.existsSync;
  t.mock.method(fs, 'existsSync', function(file) { return String(file) === hostFile || exists.call(this,file); });
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    return String(file) === hostFile ? host : read.call(this, file, ...args);
  });
  t.mock.method(fs, 'lstatSync', function(file, ...args) {
    return String(file) === hostFile ? { isFile: () => true, isSymbolicLink: () => false,
      nlink: 1, size: Buffer.byteLength(host) } : stat.call(this, file, ...args);
  });
}

test('keeper reads only the selected graph host namespace', async t => {
  mockHost(t);
  const exists = fs.existsSync;
  t.mock.method(fs, 'existsSync', function(file) {
    if (path.basename(String(file)) === 'HOST.json') assert.equal(String(file), hostFile);
    return exists.call(this, file);
  });
  const cli = require(path.join(runtime, 'app-host-cli.cjs'));
  t.mock.method(cli, 'runCli', async () => ({ status: 'test-no-network-or-send' }));
  assert.equal((await require(entry).main(['--once'])).status, 'test-no-network-or-send');
});

test('App keeper command exists and uses the qualified host without reading credentials for status', async t => {
  assert(fs.existsSync(entry), 'The App keeper start command is missing');
  const cli = require(path.join(runtime, 'app-host-cli.cjs'));
  t.mock.method(require(path.join(runtime, 'service.cjs')), 'assertQualifiedProfile', () => true);
  const reads = [];
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    reads.push(String(file));
    return original.call(this, file, ...args);
  });
  const result = await require(entry).main(['--check']);
  assert.equal(result.status, 'APP_HOST_CONFIGURED_ENTRY_READY');
  assert.equal(result.noNetwork, true);
  assert.equal(result.noCredentials, true);
  assert(!reads.some(file => file.endsWith('.env.coti-testnet.local')));
  assert.equal(cli.KEY_NAME, 'CHAINWHISPER_DEX_OPERATOR_PRIVATE_KEY');
});

test('App keeper command passes saved public identity and only the lazy operator key to the existing host', async t => {
  mockHost(t);
  assert(fs.existsSync(entry), 'The App keeper start command is missing');
  const app = require(entry);
  const cli = require(path.join(runtime, 'app-host-cli.cjs'));
  const previousKey = process.env[cli.KEY_NAME];
  delete process.env[cli.KEY_NAME];
  t.after(() => {
    if (previousKey === undefined) delete process.env[cli.KEY_NAME];
    else process.env[cli.KEY_NAME] = previousKey;
  });
  const original = fs.readFileSync;
  let privateReads = 0;
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    if (String(file).endsWith('.env.coti-testnet.local')) {
      privateReads++;
      return 'CHAINWHISPER_TEST_DEX_MALLORY_PRIVATE_KEY="operator-only"\nCHAINWHISPER_TEST_DEX_BOB_PRIVATE_KEY="must-not-pass"\nCHAINWHISPER_TEST_DEX_BOB_AES_KEY="must-not-pass"\n';
    }
    return original.call(this, file, ...args);
  });
  t.mock.method(cli, 'runCli', async (args, options) => {
    assert.equal(args[0], '--once');
    assert.equal(args[1], '0x23abde1d22019d52852d6845c9444326dde1d99e');
    assert.match(args[2], /^(0|[1-9][0-9]*)$/);
    assert.match(args[3], /^0x[0-9a-f]{64}$/);
    assert.equal(privateReads, 0);
    assert.deepEqual(Object.keys(options), ['readKey']);
    assert.equal(options.readKey(), 'operator-only');
    assert.equal(privateReads, 1);
    return { status: 'test-no-send' };
  });
  assert.equal((await app.main(['--once'])).status, 'test-no-send');
});

test('App keeper command stops before operator key access when native qualification is held', async t => {
  mockHost(t);
  const app = require(entry);
  const normal = require(path.join(runtime, 'service.cjs'));
  t.mock.method(normal, 'assertQualifiedProfile', () => { throw Error('NORMAL_KEEPER_GAS_DOMAIN_HELD'); });
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    assert(!String(file).endsWith('.env.coti-testnet.local'));
    return original.call(this, file, ...args);
  });
  await assert.rejects(app.main(['--start']), /NORMAL_KEEPER_GAS_DOMAIN_HELD/);
});

test('App keeper command rejects unsupported actions before reading private configuration', async t => {
  assert(fs.existsSync(entry), 'The App keeper start command is missing');
  const app = require(entry);
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    assert(!String(file).endsWith('.env.coti-testnet.local'));
    return original.call(this, file, ...args);
  });
  for (const args of [[], ['--retry'], ['--start', 'another-operator']]) {
    await assert.rejects(app.main(args), /CURRENT_DEX_KEEPER_USAGE/);
  }
});

test('keeper stop preserves safe RPC context after the host replaces the error', t => {
  const pacing = require('./current-dex-rpc-pacing.cjs'), app = require(entry);
  const lastFailure = { code: 'DEX_RPC_HTTP_403', method: 'eth_getStorageAt', methods: ['eth_getStorageAt'],
    phase: 'http-response', status: 403, providerIds: { cfRay: '0123456789abcdef-FRA' } };
  t.mock.method(pacing, 'stats', () => ({ service: 'keeper', lastFailure }));
  const result = app.stopResult(Object.assign(new Error('APP_HOST_RPC_REJECTED'), { payload: 'PRIVATE_INPUT' }));
  assert.deepEqual(result.rpcFailure, { service: 'keeper', ...lastFailure });
  assert.equal(result.guard, 'APP_HOST_RPC_REJECTED'); assert.equal(result.noAutomaticRetry, true);
  assert(!JSON.stringify(result).includes('PRIVATE_INPUT'));
});

test('first current host starts from the sealed current capture without an old-host fallback',async t=>{
 const app=require(entry),cli=require(path.join(runtime,'app-host-cli.cjs'));
 const b=require(path.join(runtime,'../public-binding.cjs')),capture=JSON.parse(fs.readFileSync(b.captureFile));
 const head=capture.reads.find(row=>row.method==='eth_getBlockByNumber'&&row.params[0]==='latest').result;
 const exists=fs.existsSync,read=fs.readFileSync;
 t.mock.method(fs,'existsSync',file=>[hostFile,path.dirname(hostFile)].includes(String(file))?false:exists(file));
 t.mock.method(fs,'readFileSync',(file,...args)=>{
  assert(!String(file).endsWith('.env.coti-testnet.local'));assert(!String(file).endsWith('HOST.json'));return read(file,...args);
 });
 t.mock.method(cli,'runCli',async args=>{assert.deepEqual(args,['--start','0x23abde1d22019d52852d6845c9444326dde1d99e',String(BigInt(head.number)),head.hash]);return{status:'test-no-start'};});
 assert.equal((await app.main(['--start'])).status,'test-no-start');
});

test('a current host directory with missing state requires recovery before any host invocation',async t=>{
 const app=require(entry),cli=require(path.join(runtime,'app-host-cli.cjs')),exists=fs.existsSync;
 t.mock.method(fs,'existsSync',file=>String(file)===hostFile?false:String(file)===path.dirname(hostFile)?true:exists(file));
 t.mock.method(cli,'runCli',()=>assert.fail('NO_HOST_START'));
 await assert.rejects(app.main(['--start']),/CURRENT_DEX_KEEPER_HOST_RECOVERY_REQUIRED/);
});
