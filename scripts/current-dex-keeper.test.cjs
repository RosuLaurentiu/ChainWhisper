'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const entry = path.join(__dirname, 'current-dex-keeper.cjs');
const runtime = path.resolve(__dirname, '../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/app-async-service/runtime');

test('App keeper command exists and uses the qualified host without reading credentials for status', async t => {
  assert(fs.existsSync(entry), 'The App keeper start command is missing');
  const cli = require(path.join(runtime, 'app-host-cli.cjs'));
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
