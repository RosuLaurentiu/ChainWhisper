'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const servicePath = path.resolve(__dirname,
  '../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/reference-history/service.cjs');
const service = require(servicePath);
const app = require('./current-dex-prices.cjs');
assert.equal(typeof service.selectSession, 'function', 'service must expose session selection');

test('price check uses the fixed offline service session only', async t => {
  const reads = [];
  const originalRead = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    reads.push(String(file));
    return originalRead.call(this, file, ...args);
  });
  t.mock.method(service, 'selectSession', () => assert.fail('check must not select a session'));
  const result = await app.main(['--check']);
  assert.equal(result.status, 'CURRENT_PRICE_SERVICE_OFFLINE_CHECKED');
  assert.equal(result.sessionName, 'service-session-7b67-4');
  assert.equal(result.noNetwork, true);
  assert.equal(result.noCredentials, true);
  assert.equal(result.noSend, true);
  assert(!reads.some(file => file.endsWith('.env.coti-testnet.local')));
});

const payer = '0x' + '12'.repeat(20);
const fee = 100000n * BigInt(service.controller.LIMITS.feeWei);
const epochFee = fee * 12n;

function windowService(t, change = () => {}) {
  const calls = [], source = { fixed: 'source' };
  let epoch = -1, stopped = false;
  t.mock.method(service, 'pins', () => ({ ...source }));
  t.mock.method(service, 'selectSession', () => 'service-session-7b67-' + (epoch + 6));
  t.mock.method(service, 'main', async (mode, name) => {
    calls.push([mode, name]);
    let result;
    if (mode === '--check') result = {
      sourceDigest: service.controller.hash(source), identity: { actors: { owner: payer } },
      limits: service.controller.LIMITS,
    };
    if (mode === '--prepare') {
      epoch++; stopped = false;
      result = { payer: { address: payer, nonce: String(10 + epoch * 12),
        balanceWei: String(1000000000000000000n - epochFee * BigInt(epoch)) } };
    }
    if (mode === '--run') result = { status: 'SERVICE_COMPLETE' };
    if (mode === '--stop') { stopped = true; result = { status: 'SERVICE_STOPPED' }; }
    if (mode === '--inspect') result = { state: { stopped, pending: null, attempts: 12,
      verified: Array.from({ length: 12 }, (_, i) => ({ kind: 'refresh',
        transaction: '0x' + (epoch * 12 + i + 1).toString(16).padStart(64, '0'), gasUsed: '100000' })) } };
    await change({ mode, epoch, result, source });
    return result;
  });
  return calls;
}

test('normal window renews only closed verified epochs within its aggregate bound', async t => {
  const calls = windowService(t), before = process.listenerCount('SIGINT');
  const result = await app.main(['--start']);
  assert.equal(result.status, 'CURRENT_DEX_PRICES_WINDOW_COMPLETE');
  assert.equal(result.sessions.length, 12);
  assert.equal(result.transactions, 144);
  assert.equal(result.actualFeeWei, String(epochFee * 12n));
  assert.equal(result.limits.maximumCommittedWei, '306000000000000000');
  assert.equal(result.limits.newWorkMs, 1800000);
  assert.equal(calls.filter(x => x[0] === '--stop').length, 12);
  for (let i = 1; i < calls.length; i += 5) {
    assert.deepEqual(calls.slice(i, i + 5).map(x => x[0]), ['--prepare', '--run', '--inspect', '--stop', '--inspect']);
  }
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('once uses the same guarded path with one epoch and its smaller upfront commitment', async t => {
  windowService(t, ({ mode, result }) => {
    if (mode === '--prepare') result.payer.balanceWei = '35500000000000000';
  });
  const result = await app.main(['--once']);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.actualFeeWei, String(epochFee));
  assert.equal(result.limits.maximumCommittedWei, '25500000000000000');
});

test('normal window requires the whole declared reserve before any send', async t => {
  const calls = windowService(t, ({ mode, result }) => {
    if (mode === '--prepare') result.payer.balanceWei = '315999999999999999';
  });
  await assert.rejects(app.main(['--start']), /CURRENT_DEX_PRICES_RESERVE/);
  assert(!calls.some(x => x[0] === '--run'));
  assert.equal(calls.at(-1)[0], '--stop');
});

for (const field of ['address', 'nonce', 'balanceWei']) {
  test('window rejects changed payer ' + field + ' before the next send', async t => {
    const calls = windowService(t, ({ mode, epoch, result }) => {
      if (mode === '--prepare' && epoch === 1) result.payer[field] = field === 'address' ? '0x' + '34'.repeat(20) : '99';
    });
    await assert.rejects(app.main(['--start']), /CURRENT_DEX_PRICES_(PAYER|NONCE|EXACT_FEE)/);
    assert.equal(calls.filter(x => x[0] === '--run').length, 1);
    assert.equal(calls.at(-1)[0], '--stop');
  });
}

test('source changes after a verified epoch stop renewal', async t => {
  const calls = windowService(t, ({ mode, source }) => { if (mode === '--run') source.fixed = 'changed'; });
  await assert.rejects(app.main(['--start']), /CURRENT_DEX_PRICES_SOURCE/);
  assert.equal(calls.filter(x => x[0] === '--prepare').length, 1);
});

test('source changes during preparation close the unused epoch without sending', async t => {
  const calls = windowService(t, ({ mode, source }) => { if (mode === '--prepare') source.fixed = 'changed'; });
  await assert.rejects(app.main(['--start']), /CURRENT_DEX_PRICES_SOURCE/);
  assert(!calls.some(x => x[0] === '--run'));
  assert.equal(calls.at(-1)[0], '--stop');
});

test('stop during preparation closes the unused epoch and removes signal listeners', async t => {
  const before = process.listenerCount('SIGTERM');
  const calls = windowService(t, ({ mode }) => { if (mode === '--prepare') process.emit('SIGTERM'); });
  const result = await app.main(['--start']);
  assert.equal(result.status, 'CURRENT_DEX_PRICES_WINDOW_STOPPED');
  assert(!calls.some(x => x[0] === '--run'));
  assert.equal(calls.at(-1)[0], '--stop');
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('deadline requests a graceful stop during the current epoch without renewal', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const calls = windowService(t, ({ mode, result }) => {
    if (mode === '--run') { t.mock.timers.tick(1800000); result.status = 'SERVICE_STOPPED'; }
    if (mode === '--inspect') result.state.stopped = true;
  });
  const result = await app.main(['--start']);
  assert.equal(result.status, 'CURRENT_DEX_PRICES_WINDOW_STOPPED');
  assert.equal(result.reason, 'TIME_BOUND');
  assert.equal(calls.filter(x => x[0] === '--run').length, 1);
});

test('external epoch stop is terminal for the window', async t => {
  const calls = windowService(t, ({ mode, result }) => {
    if (mode === '--run') result.status = 'SERVICE_STOPPED';
    if (mode === '--inspect') result.state.stopped = true;
  });
  assert.equal((await app.main(['--start'])).status, 'CURRENT_DEX_PRICES_WINDOW_STOPPED');
  assert.equal(calls.filter(x => x[0] === '--prepare').length, 1);
});

for (const defect of ['pending', 'missing-proof', 'gas-cap', 'duplicate']) {
  test('window does not renew after ' + defect, async t => {
    const calls = windowService(t, ({ mode, result }) => {
      if (mode !== '--inspect') return;
      if (defect === 'pending') result.state.pending = { action: 12 };
      if (defect === 'missing-proof') result.state.verified.pop();
      if (defect === 'gas-cap') result.state.verified[0].gasUsed = '40000001';
      if (defect === 'duplicate') result.state.verified[1].transaction = result.state.verified[0].transaction;
    });
    await assert.rejects(app.main(['--start']), /CURRENT_DEX_PRICES_(PENDING|PROOF|GAS|TRANSACTION)/);
    assert.equal(calls.filter(x => x[0] === '--prepare').length, 1);
  });
}

test('unknown run results are rejected without stop, retry or renewal', async t => {
  const calls = windowService(t, ({ mode, result }) => { if (mode === '--run') result.status = 'SERVICE_PENDING'; });
  await assert.rejects(app.main(['--start']), /CURRENT_DEX_PRICES_RUN_RESULT/);
  assert.equal(calls.filter(x => x[0] === '--prepare').length, 1);
  assert(!calls.some(x => x[0] === '--stop'));
});

test('reconcile selects pending and does not run a new epoch', async t => {
  const calls = [];
  t.mock.method(service, 'selectSession', mode => {
    calls.push(['selectSession', mode]);
    return 'service-session-pending';
  });
  t.mock.method(service, 'main', async (...args) => {
    calls.push(args);
    return { status: 'SERVICE_RECONCILED' };
  });
  assert.deepEqual(await app.main(['--reconcile']), { status: 'SERVICE_RECONCILED', sessionName: 'service-session-pending' });
  assert.deepEqual(calls, [['selectSession', 'pending'], ['--reconcile', 'service-session-pending']]);
});

test('stop selects the latest session and only closes it', async t => {
  const calls = [];
  t.mock.method(service, 'selectSession', mode => {
    calls.push(['selectSession', mode]);
    return 'service-session-latest';
  });
  t.mock.method(service, 'main', async (...args) => {
    calls.push(args);
    return { status: 'SERVICE_STOPPED' };
  });
  assert.deepEqual(await app.main(['--stop']), { status: 'SERVICE_STOPPED', sessionName: 'service-session-latest' });
  assert.deepEqual(calls, [['selectSession', 'latest'], ['--stop', 'service-session-latest']]);
});

test('invalid input is rejected before session selection or service calls', async t => {
  t.mock.method(service, 'selectSession', () => assert.fail('invalid input must not select a session'));
  t.mock.method(service, 'main', () => assert.fail('invalid input must not call the service'));
  for (const args of [[], ['--retry'], ['--start', 'manual-name'], ['--check', '--start']]) {
    await assert.rejects(app.main(args), /CURRENT_DEX_PRICES_USAGE/);
  }
});

test('prepare or run failure propagates without retry or replacement', async t => {
  const calls = windowService(t, ({ mode }) => { if (mode === '--prepare') throw new Error('SERVICE_PREPARE_HELD'); });
  await assert.rejects(app.main(['--start']), /SERVICE_PREPARE_HELD/);
  assert.equal(calls.filter(x => x[0] === '--prepare').length, 1);
  assert(!calls.some(x => x[0] === '--run' || x[0] === '--stop'));
});

test('run failure does not stop or retry the session', async t => {
  const calls = windowService(t, ({ mode }) => { if (mode === '--run') throw new Error('PRICE_RUN_HELD'); });
  await assert.rejects(app.main(['--start']), /PRICE_RUN_HELD/);
  assert.equal(calls.filter(x => x[0] === '--run').length, 1);
  assert(!calls.some(x => x[0] === '--stop'));
});

test('package scripts expose the normal price commands', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.scripts['check:prices'], 'node scripts/current-dex-prices.cjs --check');
  for (const [name, mode] of [['dev', 'start'], ['once', 'once'], ['reconcile', 'reconcile'], ['stop', 'stop']]) {
    assert.equal(pkg.scripts[name + ':prices'], 'node --require ./scripts/current-dex-rpc-pacing.cjs scripts/current-dex-prices.cjs --' + mode);
  }
});
