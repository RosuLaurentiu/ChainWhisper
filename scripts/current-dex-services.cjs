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
const serviceIntervals = { keeper: 0, prices: 0, matching: 0, c1: 0 };
// Sustained back-to-back reads reached about 44 starts per second for five minutes
// on 2026-11-15 and the endpoint answered HTTP 403. Bursts stay unspaced.
const aggregateStartLimit = Object.freeze({ burstStarts: 600, startsPerSecond: 20 });
// CW-102: a 403 refuses the whole client, so it cools down every read of all four services.
// After the listed cool-downs, a further 403 inside the window stops the group as before. The two cool-downs
// (8 min in all) stay below the 10 min keeper-accounting and 15 min price-process bounds of the services.
// A retried read's wait (429 Retry-After included) is bounded by the child's retry policy.
const refusalCoolDown = Object.freeze({ cooldownMs: Object.freeze([3 * 60_000, 5 * 60_000]), windowMs: 2 * 60 * 60_000 });
const maximumRetryWaitMs = 300_000;
// A response timeout is never retried: ethers leaves the timed-out request open (CW-102 review H1).
const retryCodes = /^DEX_RPC_(TRANSPORT_STOP|HTTP_(403|429|5[0-9]{2}))$/;
const operatingServices = {
  keeper: { maximumRuns: 1, feeLimitWei: '880000000000000000' },
  prices: { maximumRuns: 2, feeLimitWei: '306000000000000000' },
  matching: { maximumRuns: 4, feeLimitWei: '66000000000000000' },
  c1: { maximumRuns: 1, feeLimitWei: '79200000000000000' }
};
for (const policy of Object.values(operatingServices)) Object.freeze(policy);
Object.freeze(operatingServices);
const maximumOperatingFeeWei = '1835200000000000000';
const serverGraph = '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e';
assert(process.env.CW_LOW_RPC_TRIAL === undefined || process.env.CW_LOW_RPC_TRIAL === serverGraph, 'DEX_CURRENT_GRAPH_REQUIRED');
const serverMaximumMs = 24 * 60 * 60 * 1000;
const serverMaximumFeeWei = '2000000000000000000';
const standingMaximumFeeWei = null;
// Retain the historical gas top-up reservation in cumulative accounting.
const standingFundingFeeReserveWei = '1500000000000';
const serverServices = Object.freeze(Object.fromEntries(names.map(name => [name,
  Object.freeze({ ...operatingServices[name], maximumRuns: operatingServices[name].maximumRuns * 48 })])));
const standingServices = Object.freeze(Object.fromEntries(names.map(name => [name,
  Object.freeze({ ...operatingServices[name], maximumRuns: null })])));

function readServerPeriod(directory, now = Date.now(), manifestFile = path.resolve(app, '../runtime-public.json')) {
  const file = path.join(directory, 'period-policy.json');
  for (const target of [file, manifestFile]) {
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 2 * 1024 * 1024, 'DEX_SERVER_POLICY_FILE');
  }
  const policy = JSON.parse(fs.readFileSync(file, 'utf8')), manifest = fs.readFileSync(manifestFile);
  const standing = policy.mode === 'standing';
  assert.deepEqual(Object.keys(policy).sort(), ['schema','graph','maximumMs','maximumNewFeeWei','startedAt','expiresAt','runtimeManifestSha256','approvalSha256',...(standing ? ['mode','priorSpentFeeWei'] : [])].sort(), 'DEX_SERVER_POLICY_FIELDS');
  assert(policy.schema === 'CURRENT_DEX_SERVER_PERIOD_V1' && policy.graph === serverGraph && process.env.CW_LOW_RPC_TRIAL === serverGraph, 'DEX_SERVER_POLICY_IDENTITY');
  assert(policy.maximumMs === (standing ? null : serverMaximumMs) && policy.maximumNewFeeWei === (standing ? standingMaximumFeeWei : serverMaximumFeeWei), 'DEX_SERVER_POLICY_LIMITS');
  assert(Number.isSafeInteger(policy.startedAt) && policy.startedAt <= now && (standing ? policy.expiresAt === null :
    Number.isSafeInteger(policy.expiresAt) && policy.expiresAt > now && policy.expiresAt - policy.startedAt === serverMaximumMs), 'DEX_SERVER_POLICY_TIME');
  if (standing) assert(typeof policy.priorSpentFeeWei === 'string' && /^(0|[1-9][0-9]*)$/.test(policy.priorSpentFeeWei), 'DEX_SERVER_POLICY_PRIOR_FEES');
  assert(/^[a-f0-9]{64}$/.test(policy.approvalSha256) && createHash('sha256').update(manifest).digest('hex') === policy.runtimeManifestSha256 &&
    JSON.parse(manifest).graph === serverGraph, 'DEX_SERVER_POLICY_SOURCE');
  return Object.freeze(policy);
}

function serviceSourcePins() {
  const candidate = path.resolve(app, '../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13');
  return {
    keeper: require(path.join(candidate, 'app-async-service/runtime/service.cjs')).sourcePins(),
    prices: require(path.join(candidate, 'reference-history/service.cjs')).pins(),
    matching: require(path.join(candidate, 'matching-service/runtime.cjs')).pins(),
    c1: require(path.join(candidate, 'c1-service/runtime.cjs')).sources()
  };
}

function createRpcAdmission({ onStop, onChange = () => {}, checkSource = () => {}, startLimit = aggregateStartLimit, refusal = refusalCoolDown }) {
  // A caller may tighten the limit; it cannot exceed the reviewed default.
  assert(Number.isSafeInteger(startLimit?.burstStarts) && startLimit.burstStarts > 0 && startLimit.burstStarts <= aggregateStartLimit.burstStarts &&
    Number.isFinite(startLimit.startsPerSecond) && startLimit.startsPerSecond > 0 && startLimit.startsPerSecond <= aggregateStartLimit.startsPerSecond, 'DEX_RPC_START_LIMIT');
  const { burstStarts, startsPerSecond } = startLimit;
  // Tests may shorten the cool-downs; nobody can lengthen them, add cool-downs or change the window.
  assert(Array.isArray(refusal?.cooldownMs) && refusal.cooldownMs.length > 0 && refusal.cooldownMs.length <= refusalCoolDown.cooldownMs.length &&
    refusal.cooldownMs.every((ms, index) => Number.isFinite(ms) && ms > 0 && ms <= refusalCoolDown.cooldownMs[index]), 'DEX_RPC_REFUSAL_POLICY');
  const cooldownMs = Object.freeze([...refusal.cooldownMs]), windowMs = refusalCoolDown.windowMs;
  let coolUntil = 0, refusalCoolDowns = 0, refusals = [];
  let allowance = burstStarts, refilledAt = performance.now(), delayedGrants = 0, delayedRow = null;
  const peers = new Map(), queue = [];
  // `statuses` counts final responses only; a retried attempt counts in `retried` and `retryCodes`.
  const counts = () => ({ requested: 0, grants: 0, physicalStarts: 0, physicalSettled: 0,
    responses: 0, cancelled: 0, expired: 0, stoppedBeforeStart: 0, statuses: {}, retried: 0, retryCodes: {} });
  const total = counts(), perService = Object.fromEntries(names.map(name => [name, counts()]));
  let active = null, stopped = null, timer, lastStart = null, minimumGapMs = null;
  const increment = (name, field) => { total[field]++; perService[name][field]++; };
  const send = (peer, message) => {
    try {
      assert(peer.child.connected && typeof peer.child.send === 'function', 'DEX_RPC_IPC_UNAVAILABLE');
      peer.child.send({ ...message, service: peer.name }, error => { if (error) lost(peer); });
    } catch { lost(peer); }
  };
  const snapshot = () => ({ intervalMs: 0, perServiceIntervalMs: { ...serviceIntervals },
    policy: 'Managed services use one shared FIFO slot without local spacing; sustained aggregate starts are bounded; no provider rate claim', maximumOccupiedSlots: 1, stopped,
    aggregateStartLimit: { burstStarts, startsPerSecond }, delayedGrants,
    ...total, statuses: { ...total.statuses }, retryCodes: { ...total.retryCodes }, perService: Object.fromEntries(names.map(name =>
      [name, { ...perService[name], statuses: { ...perService[name].statuses }, retryCodes: { ...perService[name].retryCodes } }])),
    refusalCoolDown: { cooldownMs: [...cooldownMs], windowMs }, refusalCoolDowns,
    coolingMs: Math.max(0, Math.ceil(coolUntil - performance.now())),
    minimumGapMs, queued: queue.length, occupiedSlots: active ? 1 : 0,
    reserved: active?.phase === 'reserved' ? 1 : 0,
    physicalInFlight: active?.physicalState === 'pending' ? 1 : 0,
    unknownInFlight: active?.physicalState === 'unknown' ? 1 : 0,
    unresolvedOccupancy: active?.phase === 'unresolved' ? 1 : 0,
    active: active ? { service: active.peer.name, id: active.id, phase: active.phase, physicalState: active.physicalState } : null });
  const halt = reason => {
    if (stopped) return;
    stopped = reason;
    clearTimeout(timer);
    for (const row of queue.splice(0)) {
      increment(row.peer.name, 'stoppedBeforeStart');
      row.peer.pending = null;
      send(row.peer, { type: 'CHAINWHISPER_RPC_REJECT', id: row.id, code: /^DEX_RPC_[A-Z0-9_]+$/.test(stopped) ? stopped : 'DEX_RPC_GROUP_STOP' });
    }
    onChange();
  };
  const fail = reason => { const notify = !stopped; halt(reason); onChange(); if (notify) onStop(reason); };
  function lost(peer) {
    if (peer.pending === active && active) {
      active.phase = 'unresolved'; active.physicalState = 'unknown';
    } else if (peer.pending) {
      const index = queue.indexOf(peer.pending);
      if (index >= 0) queue.splice(index, 1);
      increment(peer.name, 'stoppedBeforeStart');
      peer.pending = null;
    }
    fail(`DEX_RPC_${peer.name.toUpperCase()}_LOST`);
  }
  const drain = () => {
    clearTimeout(timer);
    if (stopped) return;
    const now = performance.now();
    for (let index = queue.length - 1; index >= 0; index--) {
      const row = queue[index];
      if (row.expires > now) continue;
      queue.splice(index, 1); row.peer.pending = null; increment(row.peer.name, 'expired');
      send(row.peer, { type: 'CHAINWHISPER_RPC_REJECT', id: row.id, code: 'DEX_RPC_QUEUE_TIMEOUT' });
    }
    if (stopped) return;
    let startDelay = Infinity;
    if (!active && queue.length) {
      allowance = Math.min(burstStarts, allowance + (now - refilledAt) * startsPerSecond / 1000); refilledAt = now;
      // During a refusal cool-down only a marked broadcast may start; every other request keeps its FIFO order.
      const coolingMs = coolUntil - now, index = coolingMs > 0 ? queue.findIndex(row => row.send) : 0;
      if (index < 0) startDelay = coolingMs;
      else if (allowance >= 1) {
        allowance -= 1;
        [active] = queue.splice(index, 1); active.phase = 'reserved'; increment(active.peer.name, 'grants');
        send(active.peer, { type: 'CHAINWHISPER_RPC_GRANT', id: active.id });
      } else {
        // Hold the FIFO head until one start is earned. Queue deadlines still apply.
        if (delayedRow !== queue[index]) { delayedRow = queue[index]; delayedGrants++; }
        startDelay = (1 - allowance) * 1000 / startsPerSecond;
      }
    }
    onChange();
    if (stopped || !queue.length) return;
    const expiry = Math.min(...queue.map(row => row.expires)) - performance.now();
    timer = setTimeout(drain, Math.max(1, Math.ceil(Math.min(expiry, startDelay))));
  };
  const response = (row, statusCode) => {
    assert(Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599, 'DEX_RPC_IPC_PROTOCOL');
    increment(row.peer.name, 'responses');
    total.statuses[statusCode] = (total.statuses[statusCode] ?? 0) + 1;
    const statuses = perService[row.peer.name].statuses;
    statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
  };
  const handle = (peer, message) => {
    if (!String(message?.type ?? '').startsWith('CHAINWHISPER_RPC_')) return;
    try {
      assert(message.service === peer.name && Number.isSafeInteger(message.id) && message.id > 0, 'DEX_RPC_IPC_PROTOCOL');
      const row = peer.pending;
      if (message.type === 'CHAINWHISPER_RPC_IDLE_EXIT') {
        assert(!row && message.id > peer.lastId, 'DEX_RPC_IPC_PROTOCOL'); peer.cleanExit = true; return;
      }
      if (message.type === 'CHAINWHISPER_RPC_REQUEST') {
        assert(!stopped && !row && !peer.cleanExit && message.id > peer.lastId, 'DEX_RPC_IPC_PROTOCOL');
        assert(Number.isFinite(message.queueMs) && message.queueMs > 0 && message.queueMs <= 2_147_483_647, 'DEX_RPC_IPC_PROTOCOL');
        checkSource(); peer.lastId = message.id;
        peer.pending = { peer, id: message.id, expires: performance.now() + message.queueMs,
          phase: 'queued', physicalState: 'not-started', read: message.read === true, send: message.send === true && message.read !== true };
        queue.push(peer.pending); increment(peer.name, 'requested'); drain(); return;
      }
      if (message.type === 'CHAINWHISPER_RPC_CANCEL') {
        if (!row && message.id <= peer.lastId) return;
        assert(row?.id === message.id && ['queued', 'reserved'].includes(row.phase), 'DEX_RPC_IPC_PROTOCOL');
        if (row === active) active = null; else queue.splice(queue.indexOf(row), 1);
        peer.pending = null; increment(peer.name, message.expired ? 'expired' : 'cancelled'); drain(); return;
      }
      if (message.type === 'CHAINWHISPER_RPC_STOP') {
        assert(/^DEX_RPC_[A-Z0-9_]+$/.test(message.code), 'DEX_RPC_IPC_PROTOCOL');
        if (row === active && active) {
          if (message.settled && active.physicalState === 'pending') {
            active.physicalState = 'settled'; increment(peer.name, 'physicalSettled');
          }
          if (message.unused) {
            assert(active.phase === 'reserved', 'DEX_RPC_IPC_PROTOCOL');
            increment(peer.name, 'stoppedBeforeStart'); peer.pending = null; active = null;
          } else if (message.statusCode !== undefined) { response(active, message.statusCode); peer.pending = null; active = null; }
          else active.phase = 'unresolved';
        }
        fail(message.code); return;
      }
      assert(row && row === active && row.id === message.id, 'DEX_RPC_IPC_PROTOCOL');
      if (message.type === 'CHAINWHISPER_RPC_STARTED') {
        assert(row.phase === 'reserved', 'DEX_RPC_IPC_PROTOCOL');
        const now = performance.now();
        if (lastStart !== null) minimumGapMs = Math.min(minimumGapMs ?? Infinity, now - lastStart);
        lastStart = now;
        row.phase = stopped ? 'unresolved' : 'started'; row.physicalState = 'pending'; increment(peer.name, 'physicalStarts');
      } else if (message.type === 'CHAINWHISPER_RPC_RESPONSE') {
        assert(['started', 'unresolved'].includes(row.phase) && row.physicalState === 'pending', 'DEX_RPC_IPC_PROTOCOL');
        response(row, message.statusCode); increment(peer.name, 'physicalSettled');
        peer.pending = null; active = null;
      } else if (message.type === 'CHAINWHISPER_RPC_SETTLED') {
        assert(stopped && row.phase === 'unresolved' && row.physicalState === 'pending', 'DEX_RPC_IPC_PROTOCOL');
        row.physicalState = 'settled'; increment(peer.name, 'physicalSettled');
        if (message.statusCode !== undefined) response(row, message.statusCode);
      } else if (message.type === 'CHAINWHISPER_RPC_RETRY') {
        // CW-102: a settled read attempt that the child repeats through a new admission. Never a send.
        const status = /^DEX_RPC_HTTP_([0-9]{3})$/.exec(message.code)?.[1];
        assert(row.read === true && row.phase === 'started' && row.physicalState === 'pending' && retryCodes.test(message.code ?? '') &&
          (status ? message.statusCode === Number(status) : message.statusCode === undefined) &&
          Number.isFinite(message.waitMs) && message.waitMs >= 0 && message.waitMs <= maximumRetryWaitMs, 'DEX_RPC_IPC_PROTOCOL');
        row.physicalState = 'settled'; increment(peer.name, 'physicalSettled');
        const now = performance.now();
        if (status === '403' && !stopped) {
          refusals = refusals.filter(at => now - at < windowMs); refusals.push(now);
          if (refusals.length > cooldownMs.length) {
            // The refusal repeated past the bound: this 403 is the final response and stops the group.
            response(row, 403); peer.pending = null; active = null; fail('DEX_RPC_HTTP_403'); return;
          }
          refusalCoolDowns++; coolUntil = Math.max(coolUntil, now + cooldownMs[refusals.length - 1]);
        } else if (status === '429') coolUntil = Math.max(coolUntil, now + message.waitMs);
        increment(peer.name, 'retried');
        total.retryCodes[message.code] = (total.retryCodes[message.code] ?? 0) + 1;
        perService[peer.name].retryCodes[message.code] = (perService[peer.name].retryCodes[message.code] ?? 0) + 1;
        peer.pending = null; active = null;
      } else throw Error('DEX_RPC_IPC_PROTOCOL');
      drain(); onChange();
    } catch (error) {
      if (active?.peer === peer) { active.phase = 'unresolved'; active.physicalState = 'unknown'; }
      const reason = String(error?.message ?? '').split(/\r?\n/, 1)[0];
      fail(reason === 'DEX_SERVICES_SOURCE_DRIFT' ? reason : 'DEX_RPC_IPC_PROTOCOL');
    }
  };
  return {
    bind(name, child) {
      assert(names.includes(name) && ![...peers.values()].some(peer => peer.name === name) && !peers.has(child), 'DEX_RPC_CHILD_IDENTITY');
      const peer = { name, child, pending: null, lastId: 0 }; peers.set(child, peer);
      child.on('message', message => { if (peers.has(child)) handle(peer, message); });
      child.once('disconnect', () => { if (peers.has(child) && (!peer.cleanExit || peer.pending)) lost(peer); });
      child.once('error', () => { if (peers.has(child)) lost(peer); });
      child.once('close', () => { peer.closed = true; if (peer.pending) lost(peer); });
    },
    retire(name, child) {
      const peer = peers.get(child);
      assert(peer?.name === name && peer.closed && !child.connected && peer.cleanExit && !peer.pending &&
        active?.peer !== peer && !stopped, 'DEX_RPC_CHILD_NOT_RETIRED');
      peers.delete(child);
    },
    stop: halt,
    stats: snapshot
  };
}

async function main(args, { spawn = fork, signals = process, readPeriod = readServerPeriod, feeSnapshot, feeDelta } = {}) {
  assert(args.length === 2 && ['--once', '--start', '--operate', '--serve', '--stop'].includes(args[0]), 'DEX_SERVICES_USAGE');
  const serving = args[0] === '--serve', operating = args[0] === '--operate' || serving;
  const directory = fs.realpathSync(path.resolve(args[1]));
  const relative = path.relative(path.join(app, 'reports'), directory);
  assert(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep), 'DEX_SERVICES_REPORT_PATH');
  const file = path.join(directory, 'group.json');
  const stopFile = path.join(directory, 'stop-request.json');
  if (args[0] === '--stop') {
    const stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'DEX_SERVICES_GROUP_FILE');
    // Stop delivery must not depend on the size or write state of diagnostic history.
    try { fs.writeFileSync(stopFile, '', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return { status: 'DEX_SERVICES_STOP_REQUESTED', directory, noAutomaticRestart: true };
  }
  assert(!fs.existsSync(file), 'DEX_SERVICES_ALREADY_STARTED');
  assert(!fs.existsSync(stopFile), 'DEX_SERVICES_OLD_STOP_REQUEST');
  const period = serving ? readPeriod(directory) : null;
  const standing = serving && period.mode === 'standing';
  const newWorkMs = standing ? null : serving ? period.expiresAt - Date.now() : args[0] === '--start' || operating ? 30 * 60 * 1000 : maximumNewWorkMs;
  const policy = standing ? standingServices : serving ? serverServices : operatingServices;
  const maximumFeeWei = standing ? standingMaximumFeeWei : serving ? serverMaximumFeeWei : maximumOperatingFeeWei;
  if (serving) {
    const ledger = require('./current-dex-service-fees.cjs');
    feeSnapshot ??= ledger.snapshotAsync; feeDelta ??= ledger.deltaAsync;
  }
  const files = [__filename, pacing, stopBridge, ...names.map(name => path.join(__dirname, `current-dex-${name}.cjs`))];
  if (serving) files.push(path.join(__dirname, 'current-dex-service-fees.cjs'), path.join(directory, 'period-policy.json'));
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const pins = Object.fromEntries(files.map(file => [file, hash(file)]));
  const servicePins = operating ? serviceSourcePins() : null;
  const state = { status: 'STARTING', mode: args[0], startedAt: new Date().toISOString(), maximumNewWorkMs: newWorkMs, sourcePins: pins,
    ownerWalletActions: 0, noAutomaticRestart: true, services: {} };
  if (operating) Object.assign(state, {
    operatingPolicy: { services: policy, maximumFeeCommitmentWei: maximumFeeWei,
      ...(standing ? { oneOffFundingFeeReserveWei: standingFundingFeeReserveWei } : {}) },
    serviceSourcePins: servicePins, runs: Object.fromEntries(names.map(name => [name, []])), feeCommitmentWei: '0'
  });
  if (serving) Object.assign(state, { period, settledFeeWei: standing ? period.priorSpentFeeWei : '0' });
  if (standing) state.feeCommitmentWei = String(BigInt(period.priorSpentFeeWei) + BigInt(standingFundingFeeReserveWei));
  const deadline = standing ? null : performance.now() + newWorkMs;
  const children = new Set(), jobs = [];
  let admission;
  let stopped = null;
  const save = () => { if (admission) state.rpc = admission.stats(); fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n'); };
  const stop = reason => {
    if (stopped) return;
    stopped ??= reason; admission?.stop(reason); state.status = 'STOP_REQUESTED'; state.stopReason = stopped; save();
    for (const child of children) if (child.connected) child.send({ type: 'CHAINWHISPER_SERVICE_STOP' }, () => {});
  };
  const checkPins = () => {
    for (const [file, digest] of Object.entries(pins)) assert.equal(hash(file), digest, 'DEX_SERVICES_SOURCE_DRIFT');
  };
  const checkSource = () => {
    checkPins();
    if (serving && deadline !== null && performance.now() >= deadline) { stop('TIME_BOUND'); throw Error('DEX_SERVER_PERIOD_EXPIRED'); }
  };
  admission = createRpcAdmission({ onStop: stop, onChange: save, checkSource });
  const interrupted = () => stop('OPERATOR_STOP');
  signals.on('SIGINT', interrupted); signals.on('SIGTERM', interrupted);
  const timer = standing ? null : setTimeout(() => stop('TIME_BOUND'), newWorkMs);
  const stopPoll = setInterval(() => { if (fs.existsSync(stopFile)) stop('OPERATOR_STOP'); }, 250);
  save();
  const runService = async name => {
    try {
    do {
      if (stopped) return;
      checkSource();
      if (operating) assert.deepEqual(serviceSourcePins(), servicePins, 'DEX_SERVICES_SOURCE_DRIFT');
      if (fs.existsSync(stopFile)) stop('OPERATOR_STOP');
      if (deadline !== null && performance.now() >= deadline) stop('TIME_BOUND');
      if (stopped) return;
      const baseline = serving ? await feeSnapshot(name) : null;
      if (serving) checkSource();
      if (fs.existsSync(stopFile)) stop('OPERATOR_STOP');
      if (stopped) return;
      const run = operating ? state.runs[name].length + 1 : 1;
      let nextFeeCommitmentWei;
      if (operating) {
        assert(Number.isSafeInteger(run) && run > 0 && (policy[name].maximumRuns === null || run <= policy[name].maximumRuns), 'DEX_SERVICES_OPERATING_RUN_BOUND');
        nextFeeCommitmentWei = String(BigInt(state.feeCommitmentWei) + BigInt(policy[name].feeLimitWei));
        if (serving && maximumFeeWei !== null && BigInt(nextFeeCommitmentWei) > BigInt(maximumFeeWei)) { stop('BUDGET_BOUND'); return; }
        assert(maximumFeeWei === null || BigInt(nextFeeCommitmentWei) <= BigInt(maximumFeeWei), 'DEX_SERVICES_OPERATING_FEE_BOUND');
      }
      const logName = run === 1 ? name : `${name}.run-${run}`;
      const stdout = path.join(directory, `${logName}.stdout.log`), stderr = path.join(directory, `${logName}.stderr.log`);
      const before = admission.stats().perService[name];
      const output = fs.openSync(stdout, 'wx');
      let errors, child;
      try {
        errors = fs.openSync(stderr, 'wx');
        child = spawn(path.join(__dirname, `current-dex-${name}.cjs`), [operating ? '--start' : args[0]], {
          cwd: app, windowsHide: true, execArgv: ['--require', pacing, '--require', stopBridge],
          env: { ...process.env, CHAINWHISPER_RPC_MANAGED_SERVICE: name },
          stdio: ['ignore', output, errors, 'ipc']
        });
      } catch (error) { fs.closeSync(output); if (errors !== undefined) fs.closeSync(errors); throw error; }
      const record = { status: 'STARTED', pid: child.pid, stdout, stderr };
      if (operating) {
        record.run = run; record.feeLimitWei = policy[name].feeLimitWei;
        state.runs[name].push(record);
        state.feeCommitmentWei = nextFeeCommitmentWei;
      }
      children.add(child); state.services[name] = record; save();
      admission.bind(name, child);
      const passed = await new Promise(resolve => {
        child.once('error', error => { record.errorCode = error.code ?? 'SPAWN_FAILED'; stop(`${name}:SPAWN_FAILED`); });
        child.once('close', async (code, signal) => {
          children.delete(child); fs.closeSync(output); fs.closeSync(errors);
          const rows = fs.readFileSync(stdout, 'utf8').split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
          const traffic = rows.findLast(row => row.status === 'DEX_RPC_PACING_SUMMARY');
          const errorRows = fs.readFileSync(stderr, 'utf8').split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
          const result = errorRows.findLast(row => name === 'c1' && row.status === 'CURRENT_C1_STOP') ?? rows.findLast(row => row.status && row.status !== 'DEX_RPC_PACING_SUMMARY');
          const counters = admission.stats().perService[name];
          const requests = counters.physicalStarts - before.physicalStarts, retried = counters.retried - before.retried;
          // CW-102: a retried attempt is settled but has no final response; the child must report the same count.
          const cleanTraffic = traffic?.physicalPending === 0 && traffic.unresolvedOccupancy === 0 &&
            traffic.physicalSettled === requests && counters.physicalSettled - before.physicalSettled === requests &&
            counters.responses - before.responses + retried === requests &&
            (counters.statuses[200] ?? 0) - (before.statuses[200] ?? 0) === requests - retried &&
            (traffic.retries?.total ?? 0) === retried;
          const cleanPriceBoundary = cleanTraffic && name === 'prices' && result?.status === 'CURRENT_DEX_PRICES_WINDOW_STOPPED' && result.reason === 'TIME_BOUND';
          const cleanMatchingBoundary = name === 'matching' && (serving && result?.status === 'MATCH_WINDOW_STOPPED' && result.reason === 'TIME_BOUND' || ['MATCH_WINDOW_PUBLIC_EMPTY_STOPPED','MATCH_WINDOW_PUBLIC_CHANGED_STOPPED'].includes(result?.status) ||
            ['MATCH_WINDOW_IDLE_EMPTY_MARKETS','MATCH_WINDOW_IDLE_PUBLIC_WORK'].includes(result?.status) && result.noSend === true && result.noCredentials === true && result.maximumCommittedWei === '0' && result.actualFeeWei === '0');
          let passed = code === 0 && signal === null && traffic?.service === name && traffic.stopped === null &&
            traffic.requests === requests && (!operating || (cleanTraffic && !result?.halt && !result?.pending && !result?.state?.pending)) &&
            (result?.status === completed[name] || cleanPriceBoundary || cleanMatchingBoundary) && !result.pendingHash && !result.hashless &&
            !result.state?.pendingHash && !result.state?.hashless && !result.state?.halt && !result.result?.status;
          const failure = traffic?.lastFailure;
          const localC1Admission = result?.status === 'CURRENT_C1_STOP' && result.guard === 'C1_CURRENT_PENDING_NONCE' && result.code === 'ERR_ASSERTION' && !failure;
          let holdC1 = serving && name === 'c1' && code === 1 && signal === null && !stopped &&
            traffic?.service === name && traffic.stopped === null && traffic.requests === requests && cleanTraffic &&
            !result?.pendingHash && !result?.hashless && !result?.pending && !result?.halt &&
            !result?.state?.pending && !result?.state?.pendingHash && !result?.state?.hashless && !result?.state?.halt &&
            (localC1Admission || failure?.code === 'DEX_RPC_ERROR_RESPONSE' && failure.method === 'eth_estimateGas' &&
            failure.phase === 'rpc-response' && failure.status === 200 && failure.rpcCode === 3);
          let holdMatching = serving && name === 'matching' && code === 0 && signal === null && !stopped &&
            traffic?.service === name && traffic.stopped === null && traffic.requests === requests && cleanTraffic && !failure &&
            result?.status === 'MATCH_WINDOW_FEE_HELD' && result.guard === 'MATCH_WINDOW_RESERVE' &&
            result.noSend === true && result.noCredentials === true && result.verified === 0 && result.attempts === 0 &&
            result.maximumCommittedWei === '0' && result.actualFeeWei === '0' &&
            result.pendingHash === null && result.hashless === false && !result.pending && !result.halt && !result.state;
          if ((passed || holdC1 || holdMatching) && serving) {
            try {
              checkPins();
              const after = await feeSnapshot(name);
              checkPins();
              const actual = await feeDelta(baseline, after);
              checkPins();
              assert(typeof actual === 'string' && /^(0|[1-9][0-9]*)$/.test(actual) && BigInt(actual) <= BigInt(record.feeLimitWei), 'DEX_SERVER_ACCOUNTING');
              if (holdMatching) assert.equal(actual, '0', 'DEX_SERVER_ACCOUNTING');
              record.actualFeeWei = actual;
              state.settledFeeWei = String(BigInt(state.settledFeeWei) + BigInt(actual));
              state.feeCommitmentWei = String(BigInt(state.feeCommitmentWei) - BigInt(record.feeLimitWei) + BigInt(actual));
            } catch (error) {
              passed = false; holdC1 = false; holdMatching = false; record.accountingError = 'DEX_SERVER_ACCOUNTING';
              if (error.message === 'DEX_SERVICES_SOURCE_DRIFT') stop('DEX_SERVICES_SOURCE_DRIFT');
            }
          }
          Object.assign(record, { status: holdC1 || holdMatching ? 'HELD' : passed ? 'RETURNED' : 'FAILED', code, signal, traffic, result });
          if (holdC1 || holdMatching) { record.holdReason = holdMatching || localC1Admission ? result.guard : 'C1_ESTIMATE_REVERT'; record.noAutomaticRestart = true; save(); }
          else if (!passed) stop(`${name}:FAILED`); else save();
          resolve(passed);
        });
      });
      if (record.status === 'HELD' && !stopped) { admission.retire(name, child); return; }
      if (!operating || !passed || stopped) return;
      admission.retire(name, child);
      if (fs.existsSync(stopFile)) stop('OPERATOR_STOP');
      if (deadline !== null && performance.now() >= deadline) stop('TIME_BOUND');
      if (stopped) return;
      if (run === policy[name].maximumRuns) return;
    } while (!stopped);
    } catch (error) {
      const reason = String(error.message).split(/\r?\n/, 1)[0];
      stop(reason === 'DEX_SERVICES_SOURCE_DRIFT' ? reason : error.code ?? 'DEX_SERVICES_START_FAILED');
      return error;
    }
  };
  try {
    for (const name of names) {
      if (stopped) break;
      jobs.push(runService(name));
    }
    if (!stopped) { state.status = 'RUNNING'; save(); }
    const results = await Promise.all(jobs);
    const error = results.find(result => result instanceof Error);
    if (error) throw error;
    state.status = stopped ? 'STOPPED' : 'COMPLETE'; state.finishedAt = new Date().toISOString(); save();
    return state;
  } catch (error) {
    stop(error.code ?? 'DEX_SERVICES_START_FAILED'); await Promise.all(jobs);
    state.status = 'STOPPED'; state.finishedAt = new Date().toISOString(); save(); throw error;
  } finally {
    clearTimeout(timer); clearInterval(stopPoll); signals.removeListener('SIGINT', interrupted); signals.removeListener('SIGTERM', interrupted);
  }
}

module.exports = { main, maximumNewWorkMs, createRpcAdmission, readServerPeriod, refusalCoolDown };
if (require.main === module) main(process.argv.slice(2)).then(result => {
  console.log(JSON.stringify(result)); if (!['COMPLETE', 'DEX_SERVICES_STOP_REQUESTED'].includes(result.status)) process.exitCode = 1;
}).catch(() => { console.error(JSON.stringify({ status: 'DEX_SERVICES_STOP', noAutomaticRestart: true })); process.exitCode = 1; });
