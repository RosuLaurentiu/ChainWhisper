'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fork } = require('node:child_process');
const names = ['keeper', 'prices', 'matching', 'c1'];
const completed = { keeper: 'APP_HOST_PUBLIC_CHECKED', prices: 'CURRENT_DEX_PRICES_WINDOW_COMPLETE',
  matching: 'MATCH_WINDOW_COMPLETE', c1: 'CURRENT_C1_OPERATOR_RETURNED' };
const app = path.resolve(__dirname, '..');
const pacing = path.join(__dirname, 'current-dex-rpc-pacing.cjs');
const stopBridge = path.join(__dirname, 'current-dex-service-stop.cjs');
const maximumNewWorkMs = 15 * 60 * 1000;

async function main(args, { spawn = fork, signals = process } = {}) {
  assert(args.length === 2 && ['--once', '--start'].includes(args[0]), 'DEX_SERVICES_USAGE');
  const newWorkMs = args[0] === '--start' ? 30 * 60 * 1000 : maximumNewWorkMs;
  const directory = fs.realpathSync(path.resolve(args[1]));
  const relative = path.relative(path.join(app, 'reports'), directory);
  assert(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep), 'DEX_SERVICES_REPORT_PATH');
  const file = path.join(directory, 'group.json');
  assert(!fs.existsSync(file), 'DEX_SERVICES_ALREADY_STARTED');
  const files = [__filename, pacing, stopBridge, ...names.map(name => path.join(__dirname, `current-dex-${name}.cjs`))];
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const pins = Object.fromEntries(files.map(file => [file, hash(file)]));
  const state = { status: 'STARTING', mode: args[0], startedAt: new Date().toISOString(), maximumNewWorkMs: newWorkMs, sourcePins: pins,
    ownerWalletActions: 0, noAutomaticRestart: true, services: {} };
  const children = new Set(), jobs = [];
  let stopped = null;
  const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  const stop = reason => {
    if (stopped) return;
    stopped ??= reason; state.status = 'STOP_REQUESTED'; state.stopReason = stopped; save();
    for (const child of children) if (child.connected) child.send({ type: 'CHAINWHISPER_SERVICE_STOP' }, () => {});
  };
  const interrupted = () => stop('OPERATOR_STOP');
  signals.on('SIGINT', interrupted); signals.on('SIGTERM', interrupted);
  const timer = setTimeout(() => stop('TIME_BOUND'), newWorkMs);
  save();
  try {
    for (const name of names) {
      if (stopped) break;
      for (const [file, digest] of Object.entries(pins)) assert.equal(hash(file), digest, 'DEX_SERVICES_SOURCE_DRIFT');
      const stdout = path.join(directory, `${name}.stdout.log`), stderr = path.join(directory, `${name}.stderr.log`);
      const output = fs.openSync(stdout, 'wx');
      let errors, child;
      try {
        errors = fs.openSync(stderr, 'wx');
        child = spawn(path.join(__dirname, `current-dex-${name}.cjs`), [args[0]], {
          cwd: app, windowsHide: true, execArgv: ['--require', pacing, '--require', stopBridge],
          stdio: ['ignore', output, errors, 'ipc']
        });
      } catch (error) { fs.closeSync(output); if (errors !== undefined) fs.closeSync(errors); throw error; }
      children.add(child); state.services[name] = { status: 'STARTED', pid: child.pid, stdout, stderr }; save();
      jobs.push(new Promise(resolve => {
        child.once('error', error => { state.services[name].errorCode = error.code ?? 'SPAWN_FAILED'; stop(`${name}:SPAWN_FAILED`); });
        child.once('close', (code, signal) => {
          children.delete(child); fs.closeSync(output); fs.closeSync(errors);
          const rows = fs.readFileSync(stdout, 'utf8').split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
          const traffic = rows.findLast(row => row.status === 'DEX_RPC_PACING_SUMMARY');
          const result = rows.findLast(row => row.status && row.status !== 'DEX_RPC_PACING_SUMMARY');
          const passed = code === 0 && signal === null && traffic?.service === name && traffic.stopped === null &&
            result?.status === completed[name] && !result.pendingHash && !result.hashless &&
            !result.state?.pendingHash && !result.state?.hashless && !result.state?.halt && !result.result?.status;
          Object.assign(state.services[name], { status: passed ? 'RETURNED' : 'FAILED', code, signal, traffic, result });
          if (!passed) stop(`${name}:FAILED`); else save();
          resolve();
        });
      }));
    }
    if (!stopped) { state.status = 'RUNNING'; save(); }
    await Promise.all(jobs);
    state.status = stopped ? 'STOPPED' : 'COMPLETE'; state.finishedAt = new Date().toISOString(); save();
    return state;
  } catch (error) {
    stop(error.code ?? 'DEX_SERVICES_START_FAILED'); await Promise.all(jobs); throw error;
  } finally {
    clearTimeout(timer); signals.removeListener('SIGINT', interrupted); signals.removeListener('SIGTERM', interrupted);
  }
}

module.exports = { main, maximumNewWorkMs };
if (require.main === module) main(process.argv.slice(2)).then(result => {
  console.log(JSON.stringify(result)); if (result.status !== 'COMPLETE') process.exitCode = 1;
}).catch(() => { console.error(JSON.stringify({ status: 'DEX_SERVICES_STOP', noAutomaticRestart: true })); process.exitCode = 1; });
