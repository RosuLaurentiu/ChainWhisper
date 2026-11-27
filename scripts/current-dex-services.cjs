'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile, fork } = require('node:child_process');
const { promisify } = require('node:util');
const names = ['keeper', 'prices', 'matching', 'c1'];
const completed = { keeper: 'APP_HOST_PUBLIC_CHECKED', prices: 'CURRENT_DEX_PRICES_WINDOW_COMPLETE',
  matching: 'MATCH_WINDOW_COMPLETE', c1: 'CURRENT_C1_OPERATOR_RETURNED' };
const app = path.resolve(__dirname, '..');
const contractRoot = 'ChainWhisper Contracts V2/validation';
const peerCandidate = contractRoot + '/candidates/limit-fill-history-shared-receipt-2026-10-13';
const peerSources = ['app-async-service/runtime/service.cjs', 'reference-history/service.cjs', 'matching-service/runtime.cjs'];
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
// CW-116: the C1 window build is read-only and must finish within 90 s of the head it starts from, and within
// its read bound. Slow RPC answers on 2026-11-18 made it pass the 90 s and the failed C1 run stopped all four
// services for 49 hours. A run that stops on one of these two guards and made only build reads has sent nothing:
// its window is skipped and C1 starts again after a wait that grows with each consecutive skip (1 to 10 minutes).
// The other services continue. A cause that does not clear must stay visible: after 10 consecutive skips C1 alone
// is held, and a read bound reached by count (600 reads, not time) stops the group as before.
// Every other C1 failure stops the group or holds C1 as before.
const c1WindowBounds = Object.freeze(['C1_CURRENT_HEAD_AGE', 'C1_CURRENT_READ_BOUND']);
const c1BuildReads = Object.freeze(['eth_chainId', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_getBalance', 'eth_getTransactionCount',
  'eth_getCode', 'eth_call', 'eth_getStorageAt']);
const c1WindowRetry = Object.freeze({ waitMs: 60_000, maximumSkips: 10 });
// MAX_READS of the pinned C1 runtime. At this count the read bound is a fixed property of the build, not slow RPC.
const c1BuildMaximumReads = 600;
// CW-121: the C1 mode "tier-passes-v2" stops with a Commit stop signal when it cannot estimate a Commit, or returns
// with a policy halt. A run that stops at a clean, accounted boundary with no pending or hashless send holds C1 alone.
// User swaps (keeper), prices and matching continue. The record keeps the public cause. Any other case stops the group.
const c1CommitClasses = Object.freeze(['capacity', 'revert-empty', 'revert-data', 'unknown']);
const c1HaltName = /^[A-Z][A-Z0-9_]{2,63}$/;
const publicText = value => typeof value === 'string' ? value.slice(0, 200) : null;
const publicValue = value => typeof value === 'string' ? value.slice(0, 200) :
  value === null || typeof value === 'boolean' || Number.isSafeInteger(value) ? value : null;
// Copy only the listed public fields. Strings are cut to 200 characters; nested values are not copied.
const publicCommitStop = stop => ({ pair: publicValue(stop.pair), commitKind: publicText(stop.commitKind), commitClass: stop.commitClass,
  rpcCode: Number.isSafeInteger(stop.rpcCode) ? stop.rpcCode : null,
  revertSelector: typeof stop.revertSelector === 'string' && /^0x[0-9a-fA-F]{8}$/.test(stop.revertSelector) ? stop.revertSelector : null,
  contractError: publicText(stop.contractError),
  staleProof: stop.staleProof !== null && typeof stop.staleProof === 'object' && !Array.isArray(stop.staleProof) ?
    Object.fromEntries(Object.entries(stop.staleProof).slice(0, 32).map(([key, value]) => [key.slice(0, 200), publicValue(value)])) : publicValue(stop.staleProof ?? null),
  failedPublicChecks: Array.isArray(stop.failedPublicChecks) ? stop.failedPublicChecks.slice(0, 64).map(publicValue) : null });
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
const replacementGraph = '1a73e0205ca448e4eed5cdbbd4bb850dd87a0b08d183da20e44631fd4dd71fe7';
const convergenceGraph = '279683c14c86a24d98f481fa3460db96a6df4649a54e8641e32cae2c4aeeeb21';
const wideFirstGraph = '9e6c03ac69178445605dc78a70e088b596684181d73b218a6a3a89e942b3af21';
const sizingGraph = '5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239';
const convergenceGraphs = [convergenceGraph,wideFirstGraph,sizingGraph];
function rehearsalWorkerFile(graph) {
  assert([replacementGraph, ...convergenceGraphs].includes(graph), 'DEX_SERVICES_C1_STAGE_GRAPH');
  return convergenceGraphs.includes(graph) ? 'current-dex-c1-convergence.cjs' : 'current-dex-c1.cjs';
}
const replacementBindingDigest = 'a1c0f2c1017906ac8bbe1d447282aacccbc2e8738b2afac0316020d6352a9f99';
const wideFirstBindingDigest = '6f6c3efd3b6915343f9281348a1dc313cee7fe99727fac50144ec44c364e5d5f';
function standingGraph(binding) {
  if(binding===require('./current-dex-service-fees.cjs').build13StandingBinding)return sizingGraph;
  assert(binding===replacementBindingDigest||binding===wideFirstBindingDigest,'DEX_SERVICES_STANDING_SCOPE');
  return binding===wideFirstBindingDigest?wideFirstGraph:replacementGraph;
}
assert([undefined,serverGraph,replacementGraph,wideFirstGraph,sizingGraph].includes(process.env.CW_LOW_RPC_TRIAL), 'DEX_CURRENT_GRAPH_REQUIRED');
const serverMaximumMs = 24 * 60 * 60 * 1000;
const serverMaximumFeeWei = '2000000000000000000';
const standingMaximumFeeWei = null;
// Retain the historical gas top-up reservation in cumulative accounting.
const standingFundingFeeReserveWei = '1500000000000';
const serverServices = Object.freeze(Object.fromEntries(names.map(name => [name,
  Object.freeze({ ...operatingServices[name], maximumRuns: operatingServices[name].maximumRuns * 48 })])));
const standingServices = Object.freeze(Object.fromEntries(names.map(name => [name,
  Object.freeze({ ...operatingServices[name], maximumRuns: null })])));

// CW-151: group.json keeps the last `retainedRuns` runs of each service. A run leaves `runs` only
// after the next run of the same service starts, so it is final. `evictedRuns` keeps exact totals
// of the removed runs, including the first watchdog issue in run order. Run numbers stay monotonic.
const retainedRuns = 50;
const groupSendMethod = 'eth_sendRawTransaction';
const evictedRunTotals = () => ({ runs: 0, sends: 0, missingTraffic: 0, accountingErrors: 0, openTraffic: 0,
  firstIssue: null, settledFeeWei: '0', committedFeeWei: '0', statuses: {} });
function recordRun(state, name, record, limit = retainedRuns) {
  assert(Number.isSafeInteger(limit) && limit > 0, 'DEX_SERVICES_RUN_HISTORY');
  const runs = state.runs[name], evicted = state.evictedRuns[name];
  runs.push(record);
  while (runs.length > limit) {
    const row = runs.shift(), t = row?.traffic;
    // Same order as the watchdog: traffic shape, then accounting, then the send count.
    const shaped = Boolean(t && t.methods && typeof t.methods === 'object');
    const count = shaped ? t.methods[groupSendMethod] ?? 0 : undefined;
    const counted = Number.isSafeInteger(count) && count >= 0;
    const issue = !shaped ? 'WATCHDOG_TRAFFIC_MISSING' : row.accountingError ? 'WATCHDOG_RUN_ACCOUNTING' :
      !counted ? 'WATCHDOG_TRAFFIC_MISSING' : null;
    evicted.runs++;
    if (counted) evicted.sends += count;
    if (!counted) evicted.missingTraffic++;
    if (row?.accountingError) evicted.accountingErrors++;
    evicted.firstIssue ??= issue;
    if (t?.physicalPending !== 0 || t?.unresolvedOccupancy !== 0) evicted.openTraffic++;
    evicted.settledFeeWei = String(BigInt(evicted.settledFeeWei) + BigInt(row?.actualFeeWei ?? '0'));
    evicted.committedFeeWei = String(BigInt(evicted.committedFeeWei) + BigInt(row?.actualFeeWei ?? row?.feeLimitWei ?? '0'));
    const status = String(row?.status);
    evicted.statuses[status] = (evicted.statuses[status] ?? 0) + 1;
  }
}

// CW-151: RPC counter changes write group.json at most once per interval; the 250 ms stop poll
// writes the rest. Status changes call save() and write at once. Writes replace the file by rename.
const stateWriteIntervalMs = 1000;
function createStateWriter(file, render, { intervalMs = stateWriteIntervalMs, now = Date.now, write } = {}) {
  const replace = write ?? (text => { const temp = file + '.tmp'; fs.writeFileSync(temp, text); fs.renameSync(temp, file); });
  let dirty = false, closed = false, writtenAt = -Infinity;
  // After close only counter changes stop; a late status save still writes.
  const save = () => { dirty = false; writtenAt = now(); replace(render()); };
  return {
    save,
    changed() { if (closed) return; dirty = true; if (now() - writtenAt >= intervalMs) save(); },
    flush() { if (dirty && now() - writtenAt >= intervalMs) save(); },
    close() { if (dirty) save(); closed = true; }
  };
}

function readServerPeriod(directory, now = Date.now(), manifestFile = path.resolve(app, '../runtime-public.json'), selector = process.env.CW_LOW_RPC_TRIAL) {
  const file = path.join(directory, 'period-policy.json');
  for (const target of [file, manifestFile]) {
    const stat = fs.lstatSync(target);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 2 * 1024 * 1024, 'DEX_SERVER_POLICY_FILE');
  }
  const policy = JSON.parse(fs.readFileSync(file, 'utf8')), manifest = fs.readFileSync(manifestFile);
  const standing = policy.mode === 'standing';
  const cutover = policy.c1StandingSha256 !== undefined;
  const rehearsal = !cutover && (policy.c1RehearsalSha256 !== undefined || policy.replacementBindingSha256 !== undefined);
  const graph = cutover ? standingGraph(policy.replacementBindingSha256) : serverGraph;
  assert.deepEqual(Object.keys(policy).sort(), ['schema','graph','maximumMs','maximumNewFeeWei','startedAt','expiresAt','runtimeManifestSha256','approvalSha256',
    ...(standing ? ['mode','priorSpentFeeWei'] : []), ...(rehearsal ? ['c1RehearsalSha256','replacementBindingSha256'] : []),
    ...(cutover ? ['c1StandingSha256','replacementBindingSha256'] : [])].sort(), 'DEX_SERVER_POLICY_FIELDS');
  assert(policy.schema === 'CURRENT_DEX_SERVER_PERIOD_V1' && policy.graph === graph && selector === graph, 'DEX_SERVER_POLICY_IDENTITY');
  assert(policy.maximumMs === (standing ? null : serverMaximumMs) && policy.maximumNewFeeWei === (standing ? standingMaximumFeeWei : serverMaximumFeeWei), 'DEX_SERVER_POLICY_LIMITS');
  assert(Number.isSafeInteger(policy.startedAt) && policy.startedAt <= now && (standing ? policy.expiresAt === null :
    Number.isSafeInteger(policy.expiresAt) && policy.expiresAt > now && policy.expiresAt - policy.startedAt === serverMaximumMs), 'DEX_SERVER_POLICY_TIME');
  if (standing) assert(typeof policy.priorSpentFeeWei === 'string' && /^(0|[1-9][0-9]*)$/.test(policy.priorSpentFeeWei), 'DEX_SERVER_POLICY_PRIOR_FEES');
  if (rehearsal) assert([policy.c1RehearsalSha256,policy.replacementBindingSha256].every(value=>/^[a-f0-9]{64}$/.test(value)),
    'DEX_SERVICES_REPLACEMENT_SCOPE');
  if (cutover) assert(standing && /^[a-f0-9]{64}$/.test(policy.c1StandingSha256), 'DEX_SERVICES_STANDING_SCOPE');
  assert(/^[a-f0-9]{64}$/.test(policy.approvalSha256) && createHash('sha256').update(manifest).digest('hex') === policy.runtimeManifestSha256 &&
    JSON.parse(manifest).graph === graph, 'DEX_SERVER_POLICY_SOURCE');
  return Object.freeze(policy);
}

function serviceSourcePins(replacementC1, peerRoot) {
  const candidate = path.join(peerRoot, peerCandidate);
  const [keeper, prices, matching] = peerSources.map(name => require(path.join(candidate, name)));
  return {
    keeper: keeper.sourcePins(),
    prices: prices.pins(),
    matching: matching.pins(),
    c1: replacementC1 ? replacementC1.bundle.sources : require(path.join(candidate, 'c1-service/runtime.cjs')).sources()
  };
}

function checkRuntimeFiles(root, {graph, manifestSha256, guard, writableState}) {
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const canonical = file => {
    const stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink() && fs.realpathSync.native(file) === file &&
      (process.platform !== 'linux' || stat.uid === 0 && (stat.mode & 0o022) === 0), guard);
    return stat;
  };
  assert(canonical(root).isDirectory(), guard);
  if (process.platform === 'linux') {
    for (let directory = path.dirname(root); ; directory = path.dirname(directory)) {
      assert(canonical(directory).isDirectory(), guard);
      if (directory === path.dirname(directory)) break;
    }
  }
  const manifestFile = path.join(root, 'runtime-public.json'), stat = canonical(manifestFile);
  assert(stat.isFile() && stat.nlink === 1 && stat.size <= 2 * 1024 * 1024, guard);
  const bytes = fs.readFileSync(manifestFile);
  assert.equal(digest(bytes), manifestSha256, guard);
  const manifest = JSON.parse(bytes);
  assert(manifest.schema === 'CHAINWHISPER_BETA_PUBLIC_RUNTIME_V1' && manifest.graph === graph &&
    manifest.chainId === '7082400' && manifest.noPrivateKeysOrSignedInputs === true && manifest.files &&
    typeof manifest.files === 'object' && !Array.isArray(manifest.files), guard);
  const files = Object.entries(manifest.files);
  assert(files.length > 0 && files.length <= 2000, guard);
  const directories = new Set([root]);
  for (const [name, expected] of files) {
    assert(!/[:\\]/.test(name) && !path.isAbsolute(name) &&
      name.split('/').every(part => part && part !== '.' && part !== '..' && !/^\.env(?:\.|$)/i.test(part)) &&
      !/(^|\/)(?:journal\.jsonl|HOST\.json)$/i.test(name) && /^[a-f0-9]{64}$/.test(expected), guard);
    const file = path.join(root, name);
    if (writableState) assert(file !== writableState && !file.startsWith(writableState + path.sep), guard);
    for (let directory = path.dirname(file); !directories.has(directory); directory = path.dirname(directory)) {
      assert(canonical(directory).isDirectory(), guard);
      directories.add(directory);
    }
    const source = canonical(file);
    assert(source.isFile() && source.nlink === 1 && digest(fs.readFileSync(file)) === expected, guard);
  }
  const pinsFor = names => {
    assert(names.every(name => Object.hasOwn(manifest.files, name)), guard);
    return {[manifestFile]: manifestSha256, ...Object.fromEntries(names.map(name => [path.join(root, name), manifest.files[name]]))};
  };
  return {canonical, pinsFor, count: files.length};
}

function openStagedC1(root, scope, peerRoot) {
  const guard = 'DEX_SERVICES_C1_STAGE_SOURCE';
  assert(scope && typeof root === 'string' && path.isAbsolute(root) && root !== peerRoot &&
    root === scope.approval.stagedRuntimeRoot, guard);
  const reports = path.join(root, 'APP', 'reports');
  const base = path.join(reports, `c1-state-${scope.graph.slice(0,8)}`);
  const verified = checkRuntimeFiles(root, {graph: scope.graph, manifestSha256: scope.approval.stagedRuntimeManifestSha256, guard, writableState: base});
  assert(fs.existsSync(base), 'DEX_SERVICES_C1_STATE_DIRECTORY');
  assert(verified.canonical(reports).isDirectory(), 'DEX_SERVICES_C1_STATE_DIRECTORY');
  const store = fs.lstatSync(base);
  assert(store.isDirectory() && !store.isSymbolicLink() && fs.realpathSync.native(base) === base &&
    (process.platform !== 'linux' || store.uid === process.getuid() && (store.mode & 0o777) === 0o700),
    'DEX_SERVICES_C1_STATE_DIRECTORY');
  const stageFiles = ['current-dex-c1-rehearsal.cjs', 'current-dex-service-fees.cjs',
    'current-dex-rpc-pacing.cjs', 'current-dex-service-stop.cjs', rehearsalWorkerFile(scope.graph)].map(name => 'APP/scripts/' + name);
  const pins = verified.pinsFor(stageFiles);
  const [entry, ledgerFile, pacing, stopBridge] = stageFiles.map(name => path.join(root, name));
  const ledger = require(ledgerFile);
  assert(typeof ledger.snapshotAsync === 'function' && typeof ledger.deltaAsync === 'function', guard);
  return { root, entry, ledger, pacing, stopBridge, pins };
}

function checkInstalledPeerRuntime(root) {
  const guard = 'DEX_SERVICES_INSTALLED_PEERS';
  const {CONFIG} = require('./current-dex-service-watchdog.cjs');
  const manifestSha256 = CONFIG.runtimeManifestSha256;
  const verified = checkRuntimeFiles(root, {graph: CONFIG.graph, manifestSha256, guard});
  assert.equal(verified.count, CONFIG.runtimeFiles, guard);
  if (root === CONFIG.runtimeRoot) {
    const dependencies = path.join(root, contractRoot, 'node_modules');
    assert(process.env.NODE_PATH === dependencies && !process.env.NODE_OPTIONS && verified.canonical(dependencies).isDirectory(), guard);
    const {createRequire} = require('node:module');
    for (const entry of [path.join(root, 'APP/scripts/package.json'), ...peerSources.map(name => path.join(root, peerCandidate, name))]) {
      const resolve = createRequire(entry).resolve;
      for (const name of ['ethers', '@coti-io/coti-sdk-typescript']) {
        const file = resolve(name);
        assert(file.startsWith(dependencies + path.sep) && verified.canonical(file).isFile(), guard);
        verified.pinsFor([path.relative(root, file).replaceAll('\\', '/')]);
      }
    }
  }
  return verified;
}

function installedPeerPins(root, period, scope, scripts) {
  const {CONFIG} = require('./current-dex-service-watchdog.cjs');
  assert(scope && period.graph === CONFIG.graph && period.runtimeManifestSha256 === CONFIG.runtimeManifestSha256 &&
    scope.approval.priorRuntimeManifestSha256 === CONFIG.runtimeManifestSha256, 'DEX_SERVICES_INSTALLED_PEERS');
  return checkInstalledPeerRuntime(root).pinsFor([...scripts.map(file => path.relative(root, file).replaceAll('\\', '/')),
    ...peerSources.map(name => peerCandidate + '/' + name)]);
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
    if (peer.holdBeforeAdmission && peer.lastId === 0 && !peer.pending && active?.peer !== peer) {
      peer.cleanExit = true;
      peer.admissionHeld = true;
      return;
    }
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
    bind(name, child, holdBeforeAdmission = false) {
      assert(names.includes(name) && ![...peers.values()].some(peer => peer.name === name) && !peers.has(child), 'DEX_RPC_CHILD_IDENTITY');
      const peer = { name, child, pending: null, lastId: 0, holdBeforeAdmission }; peers.set(child, peer);
      child.on('message', message => { if (peers.has(child) && !peer.admissionHeld) handle(peer, message); });
      child.once('disconnect', () => { if (peers.has(child) && (!peer.cleanExit || peer.pending)) lost(peer); });
      child.once('error', () => { if (peers.has(child)) lost(peer); });
      child.once('close', () => { peer.closed = true; if (peer.pending) lost(peer); });
    },
    handoffFailed(child) {
      const peer = peers.get(child);
      if (peer) lost(peer);
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

async function checkReplacementWorkers(binding = replacementBindingDigest) {
  const {widePeerBindingEnv,build13PeerBinding,build13StandingBinding,build13PriceAdmission} = require('./current-dex-service-fees.cjs');
  const sizingStanding = binding === build13StandingBinding;
  const sizing = sizingStanding||binding === build13PeerBinding, wide = binding === wideFirstBindingDigest;
  const workerBinding = sizing ? build13PeerBinding : binding;
  const explicit = sizing || wide, graph = sizing ? sizingGraph : wide ? wideFirstGraph : replacementGraph;
  const child = promisify(execFile);
  const socketGuard = path.join(path.dirname(app),contractRoot,'candidates/c1-tier-schedule-2026-11-21/adoption/no-socket-guard.cjs');
  const results = await Promise.all(names.map(async name => {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP,
      NODE_PATH: path.join(path.dirname(app),contractRoot,'node_modules') };
    if (name !== 'c1' && explicit) env[widePeerBindingEnv[name]] = workerBinding;
    if (name !== 'c1' && !explicit) env.CW_LOW_RPC_TRIAL = graph;
    if (name === 'prices') env.CHAINWHISPER_PRICE_BINDING_SHA256 = workerBinding;
    if (name === 'prices' && sizing) env.CHAINWHISPER_PRICE_PAYER_ADMISSION_SHA256 = build13PriceAdmission;
    let result;
    try {
      const args = name === 'c1' ? ['--check-replacement',...(explicit ? [workerBinding] : [])] : ['--check'];
      const { stdout } = await child(process.execPath, ['--require',socketGuard,
        path.join(__dirname, `current-dex-${name}.cjs`), ...args],
        { cwd: app, env, windowsHide: true, timeout: 20000, maxBuffer: 65536 });
      result = JSON.parse(stdout);
    } catch (error) {
      const failure = new Error('DEX_SERVICES_REPLACEMENT_WORKER_CHECK_' + name.toUpperCase());
      try {
        const {guard} = JSON.parse(String(error.stderr));
        if (/^[A-Z][A-Z0-9_]{2,79}$/.test(guard)) failure.workerGuard = guard;
      } catch { /* The entry may exit before it has a structured guard. */ }
      throw failure;
    }
    assert(result.noNetwork === true && result.noCredentials === true && result.noSend === true,
      'DEX_SERVICES_REPLACEMENT_CHECK_BOUNDARY');
    return result;
  }));
  const [keeper, prices, matching, c1] = results;
  assert(keeper.status === 'APP_HOST_CONFIGURED_ENTRY_READY' && keeper.qualified === true && keeper.noSign === true,
    'DEX_SERVICES_REPLACEMENT_KEEPER_HELD');
  assert(keeper.graph === graph && prices.identity.graph === graph &&
    matching.graph === graph && c1.graph === graph &&
    [keeper.core,prices.identity.core,matching.core].every(core => core.toLowerCase() === c1.core),
    'DEX_SERVICES_REPLACEMENT_CHECK_GRAPH');
  assert(prices.deployments.length === 6 && matching.markets === 6 && c1.marketCount === 6 &&
    c1.committedWei === '323200000000000000' && c1.readyToSign === false &&
    (sizing || prices.window.reserveWei === c1.ownerRecoveryFloorWei), 'DEX_SERVICES_REPLACEMENT_CHECK_SCOPE');
  if(sizing)assert(c1.standingSupported===false&&c1.completedRehearsalJobs===43&&
    c1.standingBindingSha256===build13StandingBinding&&Array.isArray(c1.standingInputMarkets)&&c1.standingInputMarkets.length===6&&
    new Set([prices.identity.actors.owner,matching.payer,c1.operator].map(address=>address.toLowerCase())).size===3,
    'DEX_SERVICES_BUILD13_PAYER_SCOPE');
  return { status: 'DEX_SERVICES_REPLACEMENT_CHECKED', graph, core: c1.core,
    bindingSha256: binding, keeper: keeper.status, prices: prices.status, matching: matching.status,
    c1: c1.status, markets: c1.marketCount, c1WindowCommitmentWei: c1.committedWei,
    ...(sizing?{c1RehearsalMarkets:c1.rehearsalMarkets,standingInputMarkets:c1.standingInputMarkets,
      standingBindingSha256:c1.standingBindingSha256,standingQuoteFit:c1.standingQuoteFit,standingSupported:sizingStanding,pricePayer:prices.identity.actors.owner,
      pricePayerReserveWei:prices.window.reserveWei}:{sharedOwnerReserveWei:c1.ownerRecoveryFloorWei}),
    noNetwork: true, noCredentials: true, noSend: true, readyToStart: false };
}

async function main(args, { spawn = fork, signals = process, readPeriod, feeSnapshot, feeDelta,
  stagedC1Root, stagedRehearsalScope, installedPeerRoot, readStandingScope, standingWorkerEntry, c1WindowRetryWaitMs = c1WindowRetry.waitMs } = {}) {
  if (args.length === 1 && args[0] === '--check-replacement') return checkReplacementWorkers();
  if (args.length === 2 && args[0] === '--check-replacement') {
    const {build13PeerBinding,build13StandingBinding}=require('./current-dex-service-fees.cjs');
    assert([wideFirstBindingDigest,build13PeerBinding,build13StandingBinding].includes(args[1]),'DEX_SERVICES_USAGE');
    return checkReplacementWorkers(args[1]);
  }
  assert(args.length === 2 && ['--once', '--start', '--operate', '--serve', '--stop'].includes(args[0]), 'DEX_SERVICES_USAGE');
  // Tests may shorten the wait after a skipped C1 window; nobody can lengthen it.
  assert(Number.isFinite(c1WindowRetryWaitMs) && c1WindowRetryWaitMs > 0 && c1WindowRetryWaitMs <= c1WindowRetry.waitMs, 'DEX_C1_WINDOW_RETRY');
  const serving = args[0] === '--serve', operating = args[0] === '--operate' || serving;
  const separatePeers = installedPeerRoot !== undefined;
  if (separatePeers) {
    const {CONFIG} = require('./current-dex-service-watchdog.cjs');
    assert(serving && readPeriod === undefined && stagedC1Root !== undefined &&
      typeof installedPeerRoot === 'string' && path.isAbsolute(installedPeerRoot) &&
      fs.realpathSync.native(installedPeerRoot) === installedPeerRoot &&
      (installedPeerRoot === CONFIG.runtimeRoot || process.platform === 'win32' && spawn !== fork), 'DEX_SERVICES_INSTALLED_PEERS');
  }
  const peerRoot = installedPeerRoot ?? path.dirname(app), peerApp = path.join(peerRoot, 'APP'), peerScripts = path.join(peerApp, 'scripts');
  const peerReports = path.join(peerApp, 'reports');
  const pacing = path.join(peerScripts, 'current-dex-rpc-pacing.cjs'), stopBridge = path.join(peerScripts, 'current-dex-service-stop.cjs');
  const ledgerFile = path.join(peerScripts, 'current-dex-service-fees.cjs');
  const directory = fs.realpathSync(path.resolve(args[1]));
  const relative = path.relative(peerReports, directory);
  assert(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep), 'DEX_SERVICES_REPORT_PATH');
  if (separatePeers) assert(path.dirname(directory) === path.join(peerReports, 'server-beta-runs') &&
    /^server-beta-[a-z0-9-]{1,120}$/.test(path.basename(directory)), 'DEX_SERVICES_REPORT_PATH');
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
  const period = serving ? (readPeriod ? readPeriod(directory) :
    readServerPeriod(directory, Date.now(), path.join(peerRoot, 'runtime-public.json'), separatePeers ? serverGraph : undefined)) : null;
  const standing = serving && period.mode === 'standing';
  const cutover = serving && period.c1StandingSha256 !== undefined;
  const activeGraph = cutover ? standingGraph(period.replacementBindingSha256) : serverGraph;
  const sizingStanding = cutover && activeGraph===sizingGraph;
  const explicitStanding = cutover && (activeGraph===wideFirstGraph||sizingStanding);
  const replacement = serving && !cutover && (period.c1RehearsalSha256 !== undefined || period.replacementBindingSha256 !== undefined);
  if(serving)assert(period.graph===activeGraph,'DEX_SERVER_POLICY_IDENTITY');
  if([replacementGraph,wideFirstGraph,sizingGraph].includes(process.env.CW_LOW_RPC_TRIAL))
    assert(cutover,'DEX_SERVICES_STANDING_WORKER_HELD');
  if(cutover)assert(standing&&!separatePeers&&stagedC1Root===undefined&&process.env.CW_LOW_RPC_TRIAL===activeGraph&&
    typeof readStandingScope==='function'&&typeof standingWorkerEntry==='string'&&path.isAbsolute(standingWorkerEntry)&&
    standingWorkerEntry===path.join(peerScripts,'current-dex-c1-rehearsal.cjs')&&
    fs.realpathSync.native(standingWorkerEntry)===standingWorkerEntry,'DEX_SERVICES_STANDING_WORKER_HELD');
  const standingScope=cutover?structuredClone(readStandingScope(directory)):null;
  if(standingScope)assert(standingScope.approvalSha256===period.c1StandingSha256&&
    standingScope.firstBundle?.manifest?.binding?.graph===activeGraph&&
    standingScope.firstBundle.manifest.replacementBindingSha256===period.replacementBindingSha256&&
    standingScope.firstBundle.manifest.policy.totalWei==='323200000000000000'&&
    typeof standingScope.standingInitialOperatorNonce==='string'&&/^(0|[1-9][0-9]*)$/.test(standingScope.standingInitialOperatorNonce),
    'DEX_SERVICES_STANDING_SCOPE');
  if(replacement)assert(separatePeers||spawn!==fork,'DEX_SERVICES_REPLACEMENT_WORKER_HELD');
  if (stagedRehearsalScope) assert(replacement && separatePeers &&
    stagedRehearsalScope.approvalSha256 === period.c1RehearsalSha256, 'DEX_SERVICES_C1_STAGE_SOURCE');
  const replacementC1 = replacement ? stagedRehearsalScope ??
    require('./current-dex-c1.cjs').rehearsal(directory,period,Date.now(),peerReports) : null;
  const peerEntries = Object.fromEntries(names.filter(name => !separatePeers || name !== 'c1')
    .map(name => [name, name==='c1'&&cutover?standingWorkerEntry:path.join(peerScripts, `current-dex-${name}.cjs`)]));
  const checkedPeers = separatePeers ? installedPeerPins(peerRoot,period,replacementC1,[pacing,stopBridge,ledgerFile,...Object.values(peerEntries)]) : null;
  const stagedC1 = stagedC1Root === undefined ? null : openStagedC1(stagedC1Root, replacementC1, peerRoot);
  const operatorOnly=stagedRehearsalScope?.approval.operatorOnly===true;
  if(operatorOnly)assert(stagedC1&&(
    stagedRehearsalScope.graph===wideFirstGraph&&['1','2'].includes(stagedRehearsalScope.approval.market)||
    stagedRehearsalScope.graph===sizingGraph&&stagedRehearsalScope.approval.market==='2'
  ),'DEX_SERVICES_OPERATOR_ONLY_SCOPE');
  const standingPins=cutover&&spawn===fork?checkRuntimeFiles(peerRoot,{graph:activeGraph,
    manifestSha256:period.runtimeManifestSha256,guard:'DEX_SERVICES_STANDING_SOURCE',
    writableState:path.join(peerReports,'c1-state-'+activeGraph.slice(0,8))}).pinsFor(
    [__filename,pacing,stopBridge,ledgerFile,...Object.values(peerEntries)]
      .map(file=>path.relative(peerRoot,file).replaceAll('\\','/'))):null;
  const newWorkMs = standing ? null : serving ? period.expiresAt - Date.now() : args[0] === '--start' || operating ? 30 * 60 * 1000 : maximumNewWorkMs;
  const basePolicy = standing ? standingServices : serving ? serverServices : operatingServices;
  const policy = replacementC1 ? {...basePolicy, c1: {...basePolicy.c1,
    maximumRuns: replacementC1.approval.sequence?.maximumWindows ?? 1, feeLimitWei: replacementC1.feeLimitWei}} :
    cutover ? {...basePolicy,c1:{...basePolicy.c1,feeLimitWei:standingScope.firstBundle.manifest.policy.totalWei}} : basePolicy;
  const maximumFeeWei = standing ? standingMaximumFeeWei : serving ? serverMaximumFeeWei : maximumOperatingFeeWei;
  if (serving) {
    const ledger = require(ledgerFile);
    feeSnapshot ??= ledger.snapshotAsync; feeDelta ??= ledger.deltaAsync;
  }
  const readFees = async (name, c1Halt) => {
    const local = c1Halt === undefined ? undefined : {c1Halt};
    if(cutover){
      const replacementBindingSha256=sizingStanding&&name!=='c1'?
        require(ledgerFile).build13PeerBinding:period.replacementBindingSha256;
      const operatorScope=name==='c1'?{standingInitialOperatorNonce:standingScope.standingInitialOperatorNonce}:{};
      const snapshot=await feeSnapshot(name,{...local,replacementBindingSha256,...operatorScope});
      assert(snapshot?.runtimeRoot===peerRoot&&snapshot.service===name&&snapshot.graph===activeGraph&&
        snapshot.replacementBindingSha256===replacementBindingSha256&&
        snapshot.standingInitialOperatorNonce===operatorScope.standingInitialOperatorNonce,'DEX_SERVICES_STANDING_ACCOUNTING');
      return snapshot;
    }
    if (name !== 'c1' || !replacementC1) return local ? feeSnapshot(name, local) : feeSnapshot(name);
    const replacementBindingSha256 = replacementC1.replacementBindingSha256;
    const snapshot = stagedC1 ?
      await stagedC1.ledger.snapshotAsync(name, {...local, replacementBindingSha256, runtimeRoot: stagedC1.root}) :
      await feeSnapshot(name, {...local, replacementBindingSha256});
    assert(snapshot?.service === 'c1' && snapshot.graph === replacementC1.graph &&
      snapshot.replacementBindingSha256 === replacementBindingSha256 &&
      (!stagedC1 || snapshot.runtimeRoot === stagedC1.root), 'DEX_SERVICES_REPLACEMENT_ACCOUNTING');
    return snapshot;
  };
  const files = [__filename, pacing, stopBridge, ...Object.values(peerEntries)];
  if (serving) files.push(ledgerFile, path.join(directory, 'period-policy.json'));
  if (replacementC1) files.push(path.join(__dirname, 'current-dex-service-watchdog.cjs'));
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const pins = Object.fromEntries(files.map(file => [file, hash(file)]));
  if (checkedPeers) Object.assign(pins, checkedPeers);
  if (stagedC1) Object.assign(pins, stagedC1.pins);
  if (standingPins) Object.assign(pins, standingPins);
  const selectedC1=standingScope?{bundle:standingScope.firstBundle}:replacementC1;
  // The standing parent checks the sealed, root-owned package before
  // spawning. Each peer checks its own source closure with its graph binding.
  const servicePins = explicitStanding ? {runtimeManifestSha256:period.runtimeManifestSha256,
    replacementBindingSha256:period.replacementBindingSha256,c1:selectedC1.bundle.sources} :
    operating ? serviceSourcePins(selectedC1,peerRoot) : null;
  const state = { status: 'STARTING', mode: args[0], startedAt: new Date().toISOString(), maximumNewWorkMs: newWorkMs, sourcePins: pins,
    ownerWalletActions: 0, noAutomaticRestart: true, services: {} };
  if (operating) Object.assign(state, {
    operatingPolicy: { services: policy, maximumFeeCommitmentWei: maximumFeeWei,
      ...(standing ? { oneOffFundingFeeReserveWei: standingFundingFeeReserveWei } : {}) },
    serviceSourcePins: servicePins, runs: Object.fromEntries(names.map(name => [name, []])), retainedRunsPerService: retainedRuns,
    evictedRuns: Object.fromEntries(names.map(name => [name, evictedRunTotals()])), feeCommitmentWei: '0'
  });
  if (serving) Object.assign(state, { period, settledFeeWei: standing ? period.priorSpentFeeWei : '0' });
  if (replacementC1) state.rehearsalBaseline = {};
  if(operatorOnly)state.operatorOnly=true;
  if (cutover) state.standingBaseline = {};
  if (standing) state.feeCommitmentWei = String(BigInt(period.priorSpentFeeWei) + BigInt(standingFundingFeeReserveWei));
  const deadline = standing ? null : performance.now() + newWorkMs;
  const children = new Set(), jobs = [];
  let admission;
  let stopped = null, c1Skips = 0;
  // A wait that a group stop ends within 250 ms.
  const pause = ms => new Promise(resolve => {
    const end = performance.now() + ms;
    const tick = () => { const left = end - performance.now(); if (stopped || left <= 0) resolve(); else setTimeout(tick, Math.min(250, Math.ceil(left))); };
    tick();
  });
  const writer = createStateWriter(file, () => { if (admission) state.rpc = admission.stats(); return JSON.stringify(state, null, 2) + '\n'; });
  const save = writer.save;
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
  admission = createRpcAdmission({ onStop: stop, onChange: writer.changed, checkSource });
  const interrupted = () => stop('OPERATOR_STOP');
  signals.on('SIGINT', interrupted); signals.on('SIGTERM', interrupted);
  const timer = standing ? null : setTimeout(() => stop('TIME_BOUND'), newWorkMs);
  const stopPoll = setInterval(() => { if (fs.existsSync(stopFile)) stop('OPERATOR_STOP'); writer.flush(); }, 250);
  save();
  const runService = async name => {
    try {
    do {
      if (stopped) return;
      checkSource();
      if (operating&&!explicitStanding) assert.deepEqual(serviceSourcePins(selectedC1,peerRoot), servicePins, 'DEX_SERVICES_SOURCE_DRIFT');
      if(cutover)assert.deepEqual(readStandingScope(directory),standingScope,'DEX_SERVICES_STANDING_SCOPE_DRIFT');
      if (fs.existsSync(stopFile)) stop('OPERATOR_STOP');
      if (deadline !== null && performance.now() >= deadline) stop('TIME_BOUND');
      if (stopped) return;
      let baseline;
      try{baseline=serving?await readFees(name):null;}
      catch(error){
        if(name!=='c1'||(!replacementC1&&!cutover)||stopped||error.message==='DEX_SERVICES_SOURCE_DRIFT')throw error;
        const feeLimitWei=policy.c1.feeLimitWei;
        const record={status:'HELD',holdReason:cutover?'C1_STANDING_BASELINE_UNSETTLED':'C1_REHEARSAL_BASELINE_UNSETTLED',feeLimitWei,
          unsettledFeeLimitWei:feeLimitWei,accountingError:'DEX_SERVER_ACCOUNTING',noAutomaticRestart:true};
        state.services.c1=record;
        recordRun(state, 'c1', record);
        state.feeCommitmentWei=String(BigInt(state.feeCommitmentWei)+BigInt(feeLimitWei));
        save();return;
      }
      if (serving) checkSource();
      if (fs.existsSync(stopFile)) stop('OPERATOR_STOP');
      if (stopped) return;
      const run = operating ? state.evictedRuns[name].runs + state.runs[name].length + 1 : 1;
      if (replacementC1 && run === 1) state.rehearsalBaseline[name] = baseline;
      if (cutover && run === 1) state.standingBaseline[name] = baseline;
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
      const rehearsalWorker = name === 'c1' && replacementC1;
      const standingWorker = name === 'c1' && standingScope;
      const stage = rehearsalWorker && stagedC1;
      const output = fs.openSync(stdout, 'wx');
      let errors, child;
      try {
        errors = fs.openSync(stderr, 'wx');
        const managedEnv = {
          PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CREDENTIALS_DIRECTORY: process.env.CREDENTIALS_DIRECTORY,
          TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP,
          CHAINWHISPER_RPC_MANAGED_SERVICE: name
        };
        const env = stage ? {...managedEnv, CHAINWHISPER_RUNTIME_ROOT: stage.root, INVOCATION_ID: process.env.INVOCATION_ID,
          NODE_PATH: path.join(stage.root, contractRoot, 'node_modules')
        } : separatePeers ? {...managedEnv, NODE_ENV: 'production', CW_LOW_RPC_TRIAL: period.graph,
          CHAINWHISPER_RUNTIME_ROOT: peerRoot, NODE_PATH: path.join(peerRoot,contractRoot,'node_modules')
        } : cutover ? {...managedEnv,NODE_ENV:'production',INVOCATION_ID:process.env.INVOCATION_ID,
          CHAINWHISPER_RUNTIME_ROOT:peerRoot,NODE_PATH:path.join(peerRoot,contractRoot,'node_modules'),
          ...(explicitStanding&&name!=='c1'?{[require(ledgerFile).widePeerBindingEnv[name]]:
            sizingStanding?require(ledgerFile).build13PeerBinding:period.replacementBindingSha256}:{}),
          ...(!explicitStanding&&!standingWorker?{CW_LOW_RPC_TRIAL:activeGraph}:{}),
          ...(!explicitStanding&&name==='prices'?{CHAINWHISPER_PRICE_BINDING_SHA256:period.replacementBindingSha256}:{}),
          ...(sizingStanding&&name==='prices'?{CHAINWHISPER_PRICE_PAYER_ADMISSION_SHA256:require(ledgerFile).build13PriceAdmission}:{})
        } : { ...process.env, CHAINWHISPER_RPC_MANAGED_SERVICE: name };
        child = (stage ? fork : spawn)(stage ? stage.entry : peerEntries[name],
          rehearsalWorker ? ['--rehearse',directory] : standingWorker ? ['--stand',directory] : [operating ? '--start' : args[0]], {
          cwd: stage ? path.join(stage.root, 'APP') : peerApp, windowsHide: true,
          execArgv: stage ? ['--require', stage.stopBridge, '--require', stage.pacing] :
            ['--require', pacing, '--require', stopBridge],
          env,
          stdio: ['ignore', output, errors, 'ipc']
        });
      } catch (error) { fs.closeSync(output); if (errors !== undefined) fs.closeSync(errors); throw error; }
      const record = { status: 'STARTED', pid: child.pid, stdout, stderr };
      if (operating) {
        record.run = run; record.feeLimitWei = policy[name].feeLimitWei;
        recordRun(state, name, record);
        state.feeCommitmentWei = nextFeeCommitmentWei;
      }
      children.add(child); state.services[name] = record; save();
      admission.bind(name, child, Boolean(rehearsalWorker||standingWorker));
      if(rehearsalWorker||standingWorker){
        const handoffFailed=()=>{record.handoffError=standingWorker?'C1_STANDING_HANDOFF':'C1_REHEARSAL_HANDOFF';admission.handoffFailed(child);};
        const windowOrdinal=rehearsalWorker?.approval.continuation?.windowOrdinal??run;
        try{child.send({type:standingWorker?'CHAINWHISPER_C1_STANDING':'CHAINWHISPER_C1_REHEARSAL',pid:child.pid,
          approvalSha256:(standingWorker||rehearsalWorker).approvalSha256,
          ...(rehearsalWorker&&windowOrdinal>1?{windowOrdinal}:{})},
          error=>{if(error)handoffFailed();});}
        catch{handoffFailed();}
      }
      const passed = await new Promise(resolve => {
        child.once('error', error => { record.errorCode = error.code ?? 'SPAWN_FAILED'; if(!rehearsalWorker)stop(`${name}:SPAWN_FAILED`); });
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
          const operatorStop = serving && stopped === 'OPERATOR_STOP';
          const cleanBoundary = result?.reason === 'TIME_BOUND' || operatorStop && result?.reason === 'OPERATOR_STOP';
          const cleanPriceBoundary = cleanTraffic && name === 'prices' && result?.status === 'CURRENT_DEX_PRICES_WINDOW_STOPPED' && cleanBoundary;
          const cleanMatchingBoundary = name === 'matching' && (serving && result?.status === 'MATCH_WINDOW_STOPPED' && cleanBoundary || ['MATCH_WINDOW_PUBLIC_EMPTY_STOPPED','MATCH_WINDOW_PUBLIC_CHANGED_STOPPED'].includes(result?.status) ||
            ['MATCH_WINDOW_IDLE_EMPTY_MARKETS','MATCH_WINDOW_IDLE_PUBLIC_WORK'].includes(result?.status) && result.noSend === true && result.noCredentials === true && result.maximumCommittedWei === '0' && result.actualFeeWei === '0');
          const cleanC1OperatorStop = operatorStop && name === 'c1' && result?.status === completed.c1 &&
            result.result?.mode === 'FINITE_C1' && result.result.status === 'C1_OPERATOR_STOPPED';
          let passed = code === 0 && signal === null && traffic?.service === name && traffic.stopped === null &&
            traffic.requests === requests && (!operating || (cleanTraffic && !result?.halt && !result?.pending && !result?.state?.pending)) &&
            (result?.status === completed[name] || cleanPriceBoundary || cleanMatchingBoundary) && !result.pendingHash && !result.hashless &&
            !result.state?.pendingHash && !result.state?.hashless && !result.state?.halt && (!result.result?.status || cleanC1OperatorStop);
          const failure = traffic?.lastFailure;
          const localC1Admission = result?.status === 'CURRENT_C1_STOP' && result.code === 'ERR_ASSERTION' && !failure &&
            (result.guard === 'C1_CURRENT_PENDING_NONCE' || standingWorker &&
              ['C1_QUOTE_PAGE_CORE','C1_QUOTE_PAGE_ENGINE'].includes(result.guard));
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
          // CW-116: read-only window build past its head age or read bound. Fees must be exactly zero.
          let skipC1 = serving && name === 'c1' && code === 1 && signal === null && !stopped &&
            traffic?.service === name && traffic.stopped === null && traffic.requests === requests && cleanTraffic && !failure &&
            result?.status === 'CURRENT_C1_STOP' && result.code === 'ERR_ASSERTION' &&
            (c1WindowBounds.includes(result.guard) || (standingWorker && period.graph === sizingGraph && result.guard === 'HEAD_AGE')) &&
            (result.guard !== 'C1_CURRENT_READ_BOUND' || Number.isSafeInteger(traffic.rpcCalls) && traffic.rpcCalls < c1BuildMaximumReads) &&
            !result.pendingHash && !result.hashless && !result.pending && !result.halt && !result.state &&
            traffic.methods !== null && typeof traffic.methods === 'object' && Object.keys(traffic.methods).every(method => c1BuildReads.includes(method));
          // CW-121: clean C1 boundary with no pending, hashless or unknown send. The fees are settled as for the other holds.
          const c1CleanStop = serving && name === 'c1' && signal === null && !stopped &&
            traffic?.service === name && traffic.stopped === null && traffic.requests === requests && cleanTraffic &&
            !result?.pendingHash && !result?.hashless && !result?.pending &&
            !result?.state?.pending && !result?.state?.pendingHash && !result?.state?.hashless;
          let holdC1CommitStop = c1CleanStop && code === 1 && result?.status === 'CURRENT_C1_STOP' && result.guard === 'CURRENT_C1_PREFLIGHT_REJECTED' &&
            !result.halt && !result.state?.halt && result.commitStop !== null && typeof result.commitStop === 'object' &&
            !Array.isArray(result.commitStop) && c1CommitClasses.includes(result.commitStop.commitClass);
          const haltReason = result?.halt || result?.state?.halt;
          let holdC1Halt = c1CleanStop && code === 0 && result?.status === completed.c1 && typeof haltReason === 'string' && c1HaltName.test(haltReason) &&
            [result.halt, result.state?.halt].every(halt => !halt || halt === haltReason);
          const beforeRpc = standingWorker && !stopped && code === 1 && signal === null && !traffic && !result &&
            requests === 0 && counters.requested === before.requested && counters.grants === before.grants;
          if (beforeRpc) holdC1 = true;
          if ((passed || holdC1 || holdMatching || skipC1 || holdC1CommitStop || holdC1Halt) && serving) {
            try {
              checkPins();
              const after = await readFees(name, holdC1Halt ? haltReason : undefined);
              checkPins();
              const actual = await (stage ? stage.ledger.deltaAsync : feeDelta)(baseline, after);
              checkPins();
              assert(typeof actual === 'string' && /^(0|[1-9][0-9]*)$/.test(actual) && BigInt(actual) <= BigInt(record.feeLimitWei), 'DEX_SERVER_ACCOUNTING');
              if(passed&&rehearsalWorker&&rehearsalWorker.approval.sequence)
                assert(result.window===run&&result.state?.actualFeeWei===actual,'DEX_SERVER_ACCOUNTING');
              if((passed||holdC1Halt)&&convergenceGraphs.includes(rehearsalWorker?.graph)){
                assert.equal(result.window,rehearsalWorker.approval.continuation?.windowOrdinal??1,'DEX_SERVER_ACCOUNTING');
                assert.equal(result.state?.actualFeeWei,actual,'DEX_SERVER_ACCOUNTING');
              }
              if (holdMatching || skipC1 || beforeRpc) assert.equal(actual, '0', 'DEX_SERVER_ACCOUNTING');
              record.actualFeeWei = actual;
              state.settledFeeWei = String(BigInt(state.settledFeeWei) + BigInt(actual));
              state.feeCommitmentWei = String(BigInt(state.feeCommitmentWei) - BigInt(record.feeLimitWei) + BigInt(actual));
            } catch (error) {
              passed = false; holdC1 = false; holdMatching = false; skipC1 = false; holdC1CommitStop = false; holdC1Halt = false;
              record.accountingError = 'DEX_SERVER_ACCOUNTING';
              if (error.message === 'DEX_SERVICES_SOURCE_DRIFT') stop('DEX_SERVICES_SOURCE_DRIFT');
            }
          }
          // The fees of this run are settled at zero; past the limit C1 alone is held and the cause stays visible.
          const skipLimit = skipC1 && c1Skips >= c1WindowRetry.maximumSkips;
          if (skipLimit) { skipC1 = false; holdC1 = true; }
          if (name === 'c1') c1Skips = skipC1 ? c1Skips + 1 : passed ? 0 : c1Skips;
          // When the old estimate-revert rule also matches, the Commit stop signal is the reason.
          if (holdC1CommitStop || holdC1Halt) holdC1 = true;
          const unsettledRehearsal = rehearsalWorker && !stopped && !passed && !holdC1 && !skipC1;
          const unsettledStanding = standingWorker && !stopped && c1CleanStop && record.accountingError === 'DEX_SERVER_ACCOUNTING';
          if (unsettledRehearsal || unsettledStanding) {
            holdC1 = true;
            record.unsettledFeeLimitWei = record.feeLimitWei;
          }
          Object.assign(record, { status: holdC1 || holdMatching ? 'HELD' : skipC1 ? 'SKIPPED' : passed ? 'RETURNED' : 'FAILED', code, signal, traffic, result });
          if (holdC1 || holdMatching) {
            record.holdReason = unsettledStanding ? 'C1_STANDING_ACCOUNTING_UNSETTLED' : unsettledRehearsal ? 'C1_REHEARSAL_UNSETTLED' : skipLimit ? 'C1_WINDOW_SKIP_LIMIT' : holdC1CommitStop ? 'C1_COMMIT_STOP_SIGNAL' : holdC1Halt ? 'C1_POLICY_HALT' :
              beforeRpc ? 'C1_WORKER_EXIT_BEFORE_RPC' : holdMatching || localC1Admission ? result.guard : 'C1_ESTIMATE_REVERT';
            if (skipLimit) Object.assign(record, { skipReason: result.guard, consecutiveSkips: c1Skips });
            if (holdC1CommitStop) record.commitStop = publicCommitStop(result.commitStop);
            if (holdC1Halt) record.haltReason = haltReason;
            record.noAutomaticRestart = true; save();
          }
          else if (skipC1) {
            Object.assign(record, { skipReason: result.guard, consecutiveSkips: c1Skips, retryAfterMs: c1WindowRetryWaitMs * c1Skips });
            save();
          }
          else if (!passed) stop(`${name}:FAILED`); else save();
          resolve(passed || skipC1);
        });
      });
      if (record.status === 'HELD' && !stopped) { admission.retire(name, child); return; }
      if (!operating || !passed || stopped) return;
      admission.retire(name, child);
      if (fs.existsSync(stopFile)) stop('OPERATOR_STOP');
      if (deadline !== null && performance.now() >= deadline) stop('TIME_BOUND');
      if (stopped) return;
      if (run === policy[name].maximumRuns) return;
      if (rehearsalWorker && (record.status !== 'RETURNED' || record.result?.continuationReady !== true)) return;
      if (record.status === 'SKIPPED') await pause(record.retryAfterMs);
    } while (!stopped);
    } catch (error) {
      const reason = String(error.message).split(/\r?\n/, 1)[0];
      stop(reason === 'DEX_SERVICES_SOURCE_DRIFT' ? reason : error.code ?? 'DEX_SERVICES_START_FAILED');
      return error;
    }
  };
  try {
    for (const name of operatorOnly?['c1']:names) {
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
    clearTimeout(timer); clearInterval(stopPoll); writer.close(); signals.removeListener('SIGINT', interrupted); signals.removeListener('SIGTERM', interrupted);
  }
}

module.exports = { main, maximumNewWorkMs, createRpcAdmission, createStateWriter, recordRun, evictedRunTotals, retainedRuns, readServerPeriod, checkRuntimeFiles, checkInstalledPeerRuntime, refusalCoolDown, rehearsalWorkerFile };
if (require.main === module) main(process.argv.slice(2)).then(result => {
  console.log(JSON.stringify(result)); if (!['COMPLETE', 'DEX_SERVICES_STOP_REQUESTED', 'DEX_SERVICES_REPLACEMENT_CHECKED'].includes(result.status)) process.exitCode = 1;
}).catch(error => {
  const guard = /^DEX_SERVICES_REPLACEMENT_[A-Z_]+$/.test(error?.message) ? error.message : undefined;
  console.error(JSON.stringify({ status: 'DEX_SERVICES_STOP', guard, workerGuard:error.workerGuard, noAutomaticRestart: true })); process.exitCode = 1;
});
