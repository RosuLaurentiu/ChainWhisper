'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');
const { main } = require('./current-dex-services.cjs');
const { install } = require('./current-dex-service-stop.cjs');
const reports = path.resolve(__dirname, '../reports');
const completed = { keeper: 'APP_HOST_PUBLIC_CHECKED', prices: 'CURRENT_DEX_PRICES_WINDOW_COMPLETE', matching: 'MATCH_WINDOW_COMPLETE', c1: 'CURRENT_C1_OPERATOR_RETURNED' };

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
      fs.writeSync(options.stdio[1], JSON.stringify({ status: 'DEX_RPC_PACING_SUMMARY', service: name, stopped: null }) + '\n');
      child.connected = false; child.emit('close', 0, null);
    });
    return child;
  };
  return { calls, spawn };
}

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
