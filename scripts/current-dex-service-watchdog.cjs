'use strict';
// CW-101: restart the hosted four-service DEX group after an RPC stop, only when an automatic
// reconcile passes. Owner request 2026-11-17: "make the service group restart itself after an RPC stop".
// It replaces the manual restart step of CW-084/CW-100 (RESTART_AFTER_TRANSPORT.cjs) with the same guards:
// no unknown send, nonces equal recorded sends with nothing pending, exact fee journals, clean saved states,
// no lock, unchanged installed files, reserves above floors, bounded fresh admission, one start.
// It never resends, never raises a bound and never restarts after an operator, service, accounting or
// source stop. The owner stop switch is the DISABLED file; a stop-request.json in the run also holds.
// CW-102 exception: one owner-approved restart of the exact operator-stopped run after the read-retry
// install (INSTALL_APPROVAL.json), through the same reconcile, admission and single-start guards.
//
// Privilege split: the root process (`--tick`) loads no runtime code. It reads JSON, calls the RPC with
// fetch, writes the approval and starts the unit. Everything that loads runtime code (fee journals, C1 and
// price saved states, locks, the public binding, keccak) runs in a child as the service user (`--facts`).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');

const root = '/opt/chainwhisper-beta-9c2c', stateDir = '/var/lib/server-dashboard/chainwhisper-beta-watchdog';
const base = root + '/ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/';
const priceBase = root + '/ChainWhisper Contracts V2/validation/candidates/shared-core-exit-preview-native-2026-10-07/reference-history/service-v8';
const CONFIG = Object.freeze({
  graph: '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e',
  // CW-102 read retry. The previous manifest is accepted only for the one approved install restart.
  runtimeManifestSha256: '8dc239e69f29000c95660b1ceb38c4c549e22f484c172a305a6ffdc51a058f48', previousRuntimeManifestSha256: '5f793459a7141eaf13e54939469a7555eb2a2e813ceaf60005e8273c4af1b9df',
  runtimeFiles: 680, runtimeRoot: root, stateDir, unit: 'chainwhisper-beta.service', serviceUser: 'serverdash',
  approvalFile: '/etc/server-dashboard/chainwhisper-beta.approval.json',
  ownerApprovalFile: stateDir + '/OWNER_APPROVAL.json', disableFile: stateDir + '/DISABLED', installApprovalFile: stateDir + '/INSTALL_APPROVAL.json',
  runParent: root + '/APP/reports/server-beta-runs',
  pinnedFiles: Object.freeze({
    [root + '/runtime-public.json']: '8dc239e69f29000c95660b1ceb38c4c549e22f484c172a305a6ffdc51a058f48',
    '/opt/server-dashboard/modules/chainwhisper-beta/readiness.js': 'f261317074e26e06ad5afaf0a98abf935972a9dc957e7d22187a3e74d24b7540',
    '/opt/server-dashboard/modules/chainwhisper-beta/launch.js': '1affa76c2246249bfd290674687ed87fc4ea84225608bd343fb4fe31f6d67536',
    '/etc/systemd/system/chainwhisper-beta.service': '10c6d0bc05270aa3aea3e6f5219e4e76e5c387c202f8265836d82c6dca8a67d2',
    '/etc/systemd/system/chainwhisper-beta.service.d/prices-only.conf': 'c3c2c500c93616b756b0ebcbbf074cc286404f5e7511159b6784405095ebdb2f'
  }),
  dropInDirectory: '/etc/systemd/system/chainwhisper-beta.service.d', dropIns: Object.freeze(['prices-only.conf']),
  credentialLinks: Object.freeze({ [root + '/Testing/wallets/.env.coti-testnet.local']: '/run/credentials/chainwhisper-beta.service/chainwhisper-beta.env',
    [root + '/ChainWhisper Contracts/.env.spb07d.local']: '/run/credentials/chainwhisper-beta.service/chainwhisper-beta.env' }),
  services: Object.freeze(['keeper', 'prices', 'matching', 'c1']),
  actors: Object.freeze({
    keeper: Object.freeze({ address: '0x23abde1d22019d52852d6845c9444326dde1d99e', reserveFloorWei: '890000000000000000' }),
    prices: Object.freeze({ address: '0xc737b5850e15d03ed09bfadc8a33062f6073a850', reserveFloorWei: '316000000000000000' }),
    matching: Object.freeze({ address: '0xdc9f6af38d2cab7b298bbcd807e521ef71ef5d91', reserveFloorWei: '76000000000000000' }),
    c1: Object.freeze({ address: '0xddbfe89f9decad1b99406be4af8bb613065144be', reserveFloorWei: '89200000000000000' })
  }),
  // Stop codes the supervisor writes for one failed physical request. 403/429 are a provider refusal.
  rpcStops: Object.freeze({ DEX_RPC_TRANSPORT_STOP: 'transport', DEX_RPC_RESPONSE_TIMEOUT: 'transport', DEX_RPC_HTTP_500: 'transport',
    DEX_RPC_HTTP_502: 'transport', DEX_RPC_HTTP_503: 'transport', DEX_RPC_HTTP_504: 'transport', DEX_RPC_HTTP_403: 'rate', DEX_RPC_HTTP_429: 'rate' }),
  // Wait after the stop, by the number of automatic restarts in the last 24 hours.
  backoffMs: Object.freeze({ transport: Object.freeze([2, 10, 30, 60, 60, 60].map(m => m * 60000)), rate: Object.freeze([15, 30, 60, 120, 120, 120].map(m => m * 60000)),
    install: Object.freeze([0, 0, 0, 0, 0, 0]) }),
  maximumRestartsPerDay: 6, maximumAdmissionReads: 24, admissionMs: 120000, maximumGasPriceWei: 50000000n, startWindowMs: 120000,
  // A short-lived problem waits and retries; after this many tries for one stopped run it becomes a HOLD.
  transientGuards: Object.freeze(['WATCHDOG_RPC_UNAVAILABLE', 'WATCHDOG_ADMISSION_BOUND', 'WATCHDOG_HEAD_AGE', 'WATCHDOG_FEE_PRICE', 'WATCHDOG_ERROR']),
  maximumTransientTries: 10, transientWaitMs: 120000,
  lockNames: Object.freeze(['runner.lock', 'host.lock', 'service.lock', 'public-work.lock']),
  chainId: 7082400n, sendMethod: 'eth_sendRawTransaction'
});

class Hold extends Error { constructor(guard, detail) { super(guard); this.guard = guard; this.detail = detail; } }
const hold = (condition, guard, detail) => { if (!condition) throw new Hold(guard, detail); };
const uint = value => { hold(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'WATCHDOG_NUMBER', value); return BigInt(value); };
const quantity = (value, guard) => { hold(typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value), guard, value); return BigInt(value); };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function classifyStop(group) {
  if (!group || group.status !== 'STOPPED' || !Number.isFinite(Date.parse(group.finishedAt))) return { kind: 'hold', guard: 'WATCHDOG_GROUP_NOT_STOPPED' };
  const rpcClass = CONFIG.rpcStops[group.stopReason];
  return rpcClass ? { kind: 'rpc', rpcClass } : { kind: 'hold', guard: 'WATCHDOG_STOP_NOT_RPC' };
}

// CW-102: the owner-approved install restart. Only the exact operator-stopped run on the previous
// manifest, with an approval bound to this watchdog and both manifests. Anything else is null.
function installRestart(io, group, runName) {
  if (!io.exists(CONFIG.installApprovalFile)) return null;
  let bytes, a;
  try { bytes = io.readBytes(CONFIG.installApprovalFile); a = JSON.parse(bytes); } catch { return null; }
  const valid = a?.task === 'CW-102' && a.approvedByOwner === true && a.fromRun === runName && a.watchdogSha256 === io.selfSha() &&
    a.previousRuntimeManifestSha256 === CONFIG.previousRuntimeManifestSha256 && a.runtimeManifestSha256 === CONFIG.runtimeManifestSha256 &&
    group?.status === 'STOPPED' && group.stopReason === 'OPERATOR_STOP' && group.period?.runtimeManifestSha256 === CONFIG.previousRuntimeManifestSha256;
  return valid ? { sha: sha256(bytes) } : null;
}

// The supervisor keeps one request in flight for the whole group. After an RPC stop at most the
// originating request is unresolved; it must be a read. Any missing evidence counts as an unknown send.
function checkGroupTraffic(group) {
  const rpc = group.rpc ?? {};
  hold(rpc.physicalInFlight === 0, 'WATCHDOG_IN_FLIGHT');
  const status = /^DEX_RPC_HTTP_([0-9]{3})$/.exec(group.stopReason)?.[1];
  const statuses = rpc.statuses ?? {};
  for (const [code, count] of Object.entries(statuses)) hold(code === '200' || (code === status && count === 1), 'WATCHDOG_RPC_STATUSES', statuses);
  const sends = {}; let unresolved = 0, failedFeeLimitWei = 0n;
  for (const name of CONFIG.services) {
    const runs = group.runs?.[name];
    hold(Array.isArray(runs) && runs.length > 0, 'WATCHDOG_TRAFFIC_MISSING', name);
    sends[name] = 0;
    for (const row of runs) {
      const t = row?.traffic;
      hold(t && t.methods && typeof t.methods === 'object', 'WATCHDOG_TRAFFIC_MISSING', name);
      hold(!row.accountingError, 'WATCHDOG_RUN_ACCOUNTING', name);
      const count = t.methods[CONFIG.sendMethod] ?? 0;
      hold(Number.isSafeInteger(count) && count >= 0, 'WATCHDOG_TRAFFIC_MISSING', name);
      sends[name] += count;
    }
    const lastRun = runs.at(-1), last = lastRun.traffic;
    hold(lastRun.status !== 'HELD' && lastRun.noAutomaticRestart !== true, 'WATCHDOG_RUN_HELD', name);
    hold(!lastRun.result?.halt && !lastRun.result?.pendingHash && !lastRun.result?.hashless && !lastRun.result?.pending, 'WATCHDOG_RUN_RESULT', name);
    hold(last.physicalPending === 0, 'WATCHDOG_IN_FLIGHT', name);
    // The supervisor settles fees only for passed or held runs; a stopped run's spend is bounded by its limit.
    if (lastRun.status === 'FAILED') failedFeeLimitWei += uint(lastRun.feeLimitWei);
    if (last.unresolvedOccupancy) {
      unresolved += last.unresolvedOccupancy;
      const failure = last.lastFailure ?? {};
      const methods = [failure.method, ...(Array.isArray(failure.methods) ? failure.methods : [])].filter(Boolean);
      hold(methods.length > 0 && typeof failure.phase === 'string', 'WATCHDOG_UNRESOLVED_SEND', name);
      hold(!methods.includes(CONFIG.sendMethod), 'WATCHDOG_UNRESOLVED_SEND', name);
    }
  }
  hold(unresolved <= 1, 'WATCHDOG_UNRESOLVED_COUNT', unresolved);
  hold(Number.isSafeInteger(rpc.unknownInFlight ?? 0) && (rpc.unknownInFlight ?? 0) <= unresolved, 'WATCHDOG_UNKNOWN_IN_FLIGHT', rpc.unknownInFlight);
  return { sends, failedFeeLimitWei };
}

function restartDecision({ restarts, rpcClass, finishedAt, now }) {
  const recent = restarts.filter(row => now - Date.parse(row.at) < 24 * 3600000).length;
  if (recent >= CONFIG.maximumRestartsPerDay) return { due: false, hold: 'WATCHDOG_DAILY_CAP', recent };
  const table = CONFIG.backoffMs[rpcClass];
  const waitUntil = finishedAt + table[Math.min(recent, table.length - 1)];
  return now >= waitUntil ? { due: true, attempt: recent + 1 } : { due: false, waitUntil };
}

// Carry = exact verified journal fees. The group record may lag by the fees of runs stopped mid-way.
function feeCarry({ baselineCarry, deltas, settledFeeWei, failedFeeLimitWei }) {
  let carry = uint(baselineCarry);
  for (const name of CONFIG.services) carry += uint(deltas[name]);
  const settled = uint(settledFeeWei), unsettled = carry - settled;
  hold(settled >= uint(baselineCarry) && unsettled >= 0n && unsettled <= failedFeeLimitWei, 'WATCHDOG_FEE_CARRY',
    { carry: String(carry), settled: String(settled), failedFeeLimitWei: String(failedFeeLimitWei) });
  return String(carry);
}

function buildApproval(old, { runName, now, carry, fromRun, stopReason, attempt, ownerApprovalSha256 }) {
  const { restartApprovalSha256, autoRestart, ...terms } = old;
  void restartApprovalSha256; void autoRestart;
  return { ...terms, issuedAt: new Date(now).toISOString(), startBefore: new Date(now + CONFIG.startWindowMs).toISOString(), runName,
    priorSpentFeeWei: carry, autoRestart: { fromRun, stopReason, attempt, ownerApprovalSha256 } };
}

// First baseline, from the reviewed manual restart records of the running group.
function seedState({ start, admission, fees, approval }) {
  hold(start.status === 'CW100_TRANSPORT_RESTART_START_REQUESTED' && start.runName === approval.runName, 'WATCHDOG_SEED_RUN');
  hold(fees.priorSpentNextWei === approval.priorSpentFeeWei && admission.priorSpentFeeWei === approval.priorSpentFeeWei, 'WATCHDOG_SEED_CARRY');
  const nonces = {};
  for (const name of CONFIG.services) {
    const actor = admission.actors?.[name];
    hold(actor && actor.address === CONFIG.actors[name].address && actor.nonce === actor.pending && /^(0|[1-9][0-9]*)$/.test(actor.nonce), 'WATCHDOG_SEED_ACTOR', name);
    hold(fees.after?.[name]?.service === name, 'WATCHDOG_SEED_FEES', name);
    nonces[name] = actor.nonce;
  }
  return { schema: 'CW101_WATCHDOG_STATE_V1', baselines: { [approval.runName]: { nonces, feesAfter: fees.after, carry: approval.priorSpentFeeWei, seededFrom: 'CW-100 manual restart' } },
    decisions: {}, restarts: [], transient: {} };
}

const day = now => new Date(now).toISOString().slice(0, 10).replaceAll('-', '');
// Journal files named by the fee snapshots; the fast recheck hashes them again before the start.
const journalList = accounting => Object.values(accounting).flatMap(a => (a.journals ?? []).map(j => ({ path: j.path, sha256: j.sha256 }))).sort((a, b) => a.path.localeCompare(b.path));
const comparable = value => JSON.stringify({ locks: value.locks, c1: value.c1, price: value.price, journals: value.journals });

async function tick(io) {
  if (io.disabled()) return { status: 'WATCHDOG_DISABLED' };
  const unit = io.unitState();
  if (unit.MainPID !== '0' || !['failed', 'inactive'].includes(unit.ActiveState)) return { status: 'WATCHDOG_RUNNING', unit };
  const state = io.readState(), approvalBytes = io.readBytes(CONFIG.approvalFile), approval = JSON.parse(approvalBytes), approvalSha = sha256(approvalBytes);
  const runName = approval.runName;
  if (state.decisions[runName]) return { status: 'WATCHDOG_ALREADY_DECIDED', runName, decision: state.decisions[runName].decision };
  const transient = state.transient?.[runName] ?? { tries: 0, until: 0 };
  if (io.now() < transient.until) return { status: 'WATCHDOG_TRANSIENT_WAIT', runName, until: new Date(transient.until).toISOString() };
  const save = next => { io.writeState(next); };
  const decide = (decision, extra, { restart, baseline } = {}) => {
    const at = new Date(io.now()).toISOString(), row = { at, runName, decision, ...extra };
    const current = io.readState(), restarts = restart ? [...current.restarts, { at, fromRun: runName, ...restart }] : current.restarts;
    const keep = new Set([...restarts.slice(-2).map(r => r.runName), runName, ...(baseline ? [baseline.runName] : [])]);
    const baselines = Object.fromEntries(Object.entries({ ...current.baselines, ...(baseline ? { [baseline.runName]: baseline.value } : {}) }).filter(([name]) => keep.has(name)));
    const { [runName]: _cleared, ...otherTransient } = current.transient ?? {}; void _cleared;
    save({ ...current, decisions: { ...current.decisions, [runName]: row }, restarts, baselines, transient: otherTransient });
    io.record(row); return row;
  };
  let approvalWritten = false, startRequested = false;
  try {
    let groupBytes, group;
    try { groupBytes = io.readBytes(CONFIG.runParent + '/' + runName + '/group.json'); group = JSON.parse(groupBytes); } catch { throw new Hold('WATCHDOG_GROUP_MISSING'); }
    const groupSha = sha256(groupBytes);
    const install = installRestart(io, group, runName);
    hold(install || !io.exists(CONFIG.runParent + '/' + runName + '/stop-request.json'), 'WATCHDOG_OPERATOR_STOP_REQUEST');
    const stop = install ? { kind: 'rpc', rpcClass: 'install' } : classifyStop(group);
    const groupManifest = install ? CONFIG.previousRuntimeManifestSha256 : CONFIG.runtimeManifestSha256;
    hold(stop.kind === 'rpc', stop.guard, group?.stopReason);
    const timing = restartDecision({ restarts: state.restarts, rpcClass: stop.rpcClass, finishedAt: Date.parse(group.finishedAt), now: io.now() });
    hold(!timing.hold, timing.hold);
    if (!timing.due) return { status: 'WATCHDOG_WAIT', runName, waitUntil: new Date(timing.waitUntil).toISOString() };

    // Offline reconcile: approvals, installed files, traffic, then the service-user facts.
    const ownerBytes = io.readBytes(CONFIG.ownerApprovalFile), owner = JSON.parse(ownerBytes);
    hold(['CW-101', 'CW-102'].includes(owner.task) && owner.approvedByOwner === true && owner.watchdogSha256 === io.selfSha(), 'WATCHDOG_OWNER_APPROVAL');
    const baseline = state.baselines[runName];
    hold(baseline && baseline.nonces && baseline.feesAfter && typeof baseline.carry === 'string', 'WATCHDOG_BASELINE_MISSING');
    hold(approval.schema === 'CHAINWHISPER_BETA_SERVICE_APPROVAL_V1' && approval.approvedByOwner === true && approval.mode === 'standing' &&
      approval.graph === CONFIG.graph && approval.runtimeManifestSha256 === groupManifest && approval.gasPriceWei === '50000000' &&
      approval.maximumNewFeeWei === null && approval.expiresAt === null && approval.noNewFunding === true, 'WATCHDOG_APPROVAL_TERMS');
    hold(group.period?.graph === CONFIG.graph && group.period.runtimeManifestSha256 === groupManifest, 'WATCHDOG_APPROVAL_RUN');
    hold(group.period.approvalSha256 === approvalSha, 'WATCHDOG_APPROVAL_DRIFT');
    hold(group.period.priorSpentFeeWei === baseline.carry && approval.priorSpentFeeWei === baseline.carry, 'WATCHDOG_BASELINE_CARRY');
    const drift = io.pinned();
    hold(Object.keys(drift).length === 0, 'WATCHDOG_PINNED_FILE', drift);
    const { sends, failedFeeLimitWei } = checkGroupTraffic(group);
    const facts = io.facts({ feesAfter: baseline.feesAfter });
    hold(facts.locks.length === 0, 'WATCHDOG_STALE_LOCK', facts.locks);
    const c1 = facts.c1;
    hold(c1 && !c1.pendingHash && !c1.hashless && !c1.activePair && !c1.halt && !c1.renewalPending && Array.isArray(c1.queuedPairs) && c1.queuedPairs.length === 0, 'WATCHDOG_C1_UNRESOLVED');
    hold(facts.price && facts.price.pending === null && facts.price.stopped === true && facts.price.pendingRecordMarket === null, 'WATCHDOG_PRICE_UNRESOLVED');
    // A fee snapshot fails on any unresolved keeper, price, matching or C1 journal.
    hold(!facts.feeError, 'WATCHDOG_FEE_JOURNAL', facts.feeError);
    const carry = feeCarry({ baselineCarry: baseline.carry, deltas: facts.deltas, settledFeeWei: group.settledFeeWei, failedFeeLimitWei });
    const newRun = install ? `server-beta-${day(io.now())}-cw102-install` : `server-beta-${day(io.now())}-auto-${state.restarts.length + 1}`;
    hold(!io.exists(CONFIG.runParent + '/' + newRun), 'WATCHDOG_RUN_EXISTS', newRun);

    // Fresh bounded admission. A failed or malformed read here is transient: wait for a later tick.
    let reads = 0; const started = io.now();
    const rpc = async (method, params) => {
      hold(reads < CONFIG.maximumAdmissionReads && io.now() - started < CONFIG.admissionMs, 'WATCHDOG_ADMISSION_BOUND');
      reads++;
      try { return await io.rpc(method, params); } catch { throw new Hold('WATCHDOG_RPC_UNAVAILABLE', method); }
    };
    const binding = facts.binding;
    hold(quantity(await rpc('eth_chainId', []), 'WATCHDOG_RPC_UNAVAILABLE') === CONFIG.chainId, 'WATCHDOG_CHAIN');
    hold((await rpc('eth_getBlockByNumber', ['0x0', false]))?.hash === binding.genesis, 'WATCHDOG_GENESIS');
    const head = await rpc('eth_getBlockByNumber', ['latest', false]);
    hold(head && typeof head.hash === 'string' && typeof head.number === 'string', 'WATCHDOG_RPC_UNAVAILABLE', 'head');
    const fee = quantity(await rpc('eth_gasPrice', []), 'WATCHDOG_RPC_UNAVAILABLE');
    hold(fee > 0n && fee <= CONFIG.maximumGasPriceWei && quantity(head.baseFeePerGas, 'WATCHDOG_RPC_UNAVAILABLE') <= CONFIG.maximumGasPriceWei, 'WATCHDOG_FEE_PRICE', String(fee));
    hold(Math.abs(io.now() / 1000 - Number(quantity(head.timestamp, 'WATCHDOG_RPC_UNAVAILABLE'))) < 90, 'WATCHDOG_HEAD_AGE');
    const targets = [binding.core, ...binding.tokens], codes = [];
    for (const address of targets) codes.push(await rpc('eth_getCode', [address, { blockHash: head.hash, requireCanonical: true }]));
    const hashes = io.keccak(codes);
    targets.forEach((address, i) => hold(hashes[i] === binding.codeHashes[address.toLowerCase()], 'WATCHDOG_CODE', address));
    const actors = {};
    for (const name of CONFIG.services) {
      const { address, reserveFloorWei } = CONFIG.actors[name];
      const nonce = quantity(await rpc('eth_getTransactionCount', [address, head.number]), 'WATCHDOG_RPC_UNAVAILABLE');
      const pending = quantity(await rpc('eth_getTransactionCount', [address, 'pending']), 'WATCHDOG_RPC_UNAVAILABLE');
      const balance = quantity(await rpc('eth_getBalance', [address, head.number]), 'WATCHDOG_RPC_UNAVAILABLE');
      hold(pending === nonce, 'WATCHDOG_PENDING', name);
      hold(nonce === uint(baseline.nonces[name]) + BigInt(sends[name]), 'WATCHDOG_NONCE', { name, nonce: String(nonce), baseline: baseline.nonces[name], sends: sends[name] });
      hold(balance >= BigInt(reserveFloorWei), 'WATCHDOG_RESERVE', name);
      actors[name] = { nonce: String(nonce), balanceWei: String(balance) };
    }
    hold((await rpc('eth_getBlockByNumber', [head.number, false]))?.hash === head.hash, 'WATCHDOG_HEAD_REORG');

    // Final recheck of every offline input just before the start.
    const unitNow = io.unitState();
    hold(unitNow.MainPID === '0' && ['failed', 'inactive'].includes(unitNow.ActiveState), 'WATCHDOG_UNIT_CHANGED');
    hold(sha256(io.readBytes(CONFIG.approvalFile)) === approvalSha, 'WATCHDOG_APPROVAL_DRIFT');
    hold(sha256(io.readBytes(CONFIG.runParent + '/' + runName + '/group.json')) === groupSha, 'WATCHDOG_GROUP_CHANGED');
    hold((install || !io.exists(CONFIG.runParent + '/' + runName + '/stop-request.json')) && !io.disabled(), 'WATCHDOG_OPERATOR_STOP_REQUEST');
    if (install) hold(installRestart(io, group, runName)?.sha === install.sha, 'WATCHDOG_INSTALL_APPROVAL_DRIFT');
    hold(Object.keys(io.pinned()).length === 0, 'WATCHDOG_PINNED_FILE');
    const journals = journalList(facts.accounting);
    hold(comparable(io.recheck({ journals })) === comparable({ ...facts, journals }), 'WATCHDOG_FACTS_CHANGED');
    hold(io.now() - started < CONFIG.admissionMs, 'WATCHDOG_ADMISSION_BOUND');

    // One start: save the old approval, write the new one, readiness, intent, start.
    const next = buildApproval(approval, { runName: newRun, now: io.now(), carry, fromRun: runName, stopReason: group.stopReason,
      attempt: timing.attempt, ownerApprovalSha256: sha256(ownerBytes) });
    // The install restart is the only change of manifest; readiness checks it against the installed files.
    if (install) { next.runtimeManifestSha256 = CONFIG.runtimeManifestSha256; next.autoRestart.installApprovalSha256 = install.sha; }
    io.saveApprovalBefore(runName, approvalBytes);
    io.writeApproval(next); approvalWritten = true;
    const ready = io.readiness();
    hold(ready.verifiedFiles === CONFIG.runtimeFiles && ready.operatingApprovalValid === true && ready.graph === CONFIG.graph &&
      ready.runtimeManifestSha256 === CONFIG.runtimeManifestSha256 && ready.runName === newRun && ready.priorSpentFeeWei === carry &&
      JSON.stringify(ready.issues) === JSON.stringify(['Private credentials are checked only inside the service credential namespace.']), 'WATCHDOG_READINESS', ready.issues);
    hold(io.now() < Date.parse(next.startBefore), 'WATCHDOG_START_STALE');
    const details = { newRun, stopReason: group.stopReason, rpcClass: stop.rpcClass, attempt: timing.attempt, carry, sends, deltas: facts.deltas, actors, reads, gasPriceWei: String(fee), head: head.hash };
    const newBaseline = { runName: newRun, value: { nonces: Object.fromEntries(Object.entries(actors).map(([k, v]) => [k, v.nonce])), feesAfter: facts.accounting, carry } };
    // Intent first: if the start call fails after a real start, the run is already decided and has its baseline.
    decide('STARTING', details, { restart: { runName: newRun, stopReason: group.stopReason }, baseline: newBaseline });
    startRequested = true;
    try { io.startUnit(); } catch (error) {
      const row = { at: new Date(io.now()).toISOString(), runName, decision: 'START_UNCERTAIN', newRun, message: String(error?.message ?? error).slice(0, 160) };
      io.record(row); return { status: 'WATCHDOG_START_UNCERTAIN', ...row };
    }
    const done = { at: new Date(io.now()).toISOString(), runName, decision: 'RESTARTED', ...details };
    const current = io.readState(); save({ ...current, decisions: { ...current.decisions, [runName]: done } }); io.record(done);
    return { status: 'WATCHDOG_RESTART_STARTED', ...done };
  } catch (error) {
    if (startRequested) throw error;
    const guard = error instanceof Hold ? error.guard : 'WATCHDOG_ERROR';
    if (CONFIG.transientGuards.includes(guard) && transient.tries + 1 < CONFIG.maximumTransientTries) {
      const current = io.readState(), tries = transient.tries + 1;
      save({ ...current, transient: { ...(current.transient ?? {}), [runName]: { tries, until: io.now() + CONFIG.transientWaitMs * Math.min(tries, 5), guard } } });
      return { status: 'WATCHDOG_TRANSIENT', runName, guard, tries };
    }
    const detail = error instanceof Hold ? error.detail ?? null : String(error?.message ?? error).slice(0, 160);
    const row = decide('HOLD', { guard: CONFIG.transientGuards.includes(guard) ? 'WATCHDOG_REPEATED_' + guard.replace('WATCHDOG_', '') : guard, detail, approvalWritten });
    return { status: 'WATCHDOG_HOLD', ...row };
  }
}

// Read-only installation check: no RPC, no approval write, no start, no state write.
function selfCheck(io) {
  const state = io.readState(), owner = JSON.parse(io.readBytes(CONFIG.ownerApprovalFile)), approval = JSON.parse(io.readBytes(CONFIG.approvalFile));
  return { status: 'WATCHDOG_SELF_CHECKED', unit: io.unitState(), disabled: io.disabled(), ownerBound: ['CW-101', 'CW-102'].includes(owner.task) && owner.approvedByOwner === true && owner.watchdogSha256 === io.selfSha(),
    installApprovalPresent: io.exists(CONFIG.installApprovalFile),
    runName: approval.runName, baselinePresent: Boolean(state.baselines[approval.runName]), decided: state.decisions[approval.runName]?.decision ?? null,
    restartsLast24h: state.restarts.filter(row => io.now() - Date.parse(row.at) < 24 * 3600000).length, pinnedDrift: io.pinned(), noRpc: true, noWrite: true, noStart: true };
}

// ---- Service-user child: everything that loads runtime code. ----
function findLocks() {
  const found = [], dirs = [base + 'app-async-service', base + 'matching-service', base + 'c1-service', priceBase];
  const walk = (dir, depth) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth > 0 && entry.name !== 'node_modules') walk(full, depth - 1);
      else if (!entry.isDirectory() && CONFIG.lockNames.includes(entry.name)) found.push(full);
    }
  };
  for (const dir of dirs) walk(dir, 3);
  return found.sort();
}
function childStates() {
  const c1 = require(base + 'c1-service/runtime.cjs').inspect();
  const sessions = fs.readdirSync(priceBase).filter(name => /^service-session-9c2cb-[1-9][0-9]*$/.test(name)).sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
  let price = null;
  if (sessions.length) {
    try { price = JSON.parse(cp.execFileSync(process.execPath, ['service.cjs', '--inspect', sessions.at(-1)], { cwd: base + 'reference-history', encoding: 'utf8', timeout: 60000, env: process.env })).state ?? null; }
    catch { price = null; }
  }
  return { locks: findLocks(), c1: { pendingHash: c1.pendingHash ?? null, hashless: c1.hashless ?? null, activePair: c1.activePair ?? null, queuedPairs: c1.queuedPairs ?? null,
    halt: c1.halt ?? null, renewalPending: c1.renewalPending ?? null, window: c1.window ?? null },
    price: price && { pending: price.pending ?? null, stopped: price.stopped ?? null, pendingRecordMarket: price.pendingRecordMarket ?? null } };
}
function childRecheck({ journals }) {
  return { ...childStates(), journals: journals.map(({ path: rel }) => {
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + '/') || rel.includes('..')) return { path: rel, sha256: 'outside-root' };
    try { return { path: rel, sha256: sha256(fs.readFileSync(file)) }; } catch { return { path: rel, sha256: 'missing' }; }
  }) };
}
async function childFacts({ feesAfter }) {
  const fees = require(root + '/APP/scripts/current-dex-service-fees.cjs');
  const states = childStates();
  const accounting = {}, deltas = {}; let feeError = null;
  for (const name of CONFIG.services) {
    try { accounting[name] = await fees.snapshotAsync(name); deltas[name] = await fees.deltaAsync(feesAfter[name], accounting[name]); }
    catch (error) { feeError = name + ':' + String(error?.message ?? error).slice(0, 80); break; }
  }
  const pub = require(base + 'app-async-service/public-binding.cjs').loadPublicBinding();
  const targets = [pub.identity.core, ...pub.pkg.tokenAddresses];
  return { ...states, accounting, deltas, feeError,
    binding: { genesis: pub.genesis, core: pub.identity.core, tokens: pub.pkg.tokenAddresses, codeHashes: Object.fromEntries(targets.map(a => [a.toLowerCase(), pub.codeHashes.get(a.toLowerCase())])) } };
}
function childKeccak({ codes }) {
  const { keccak256 } = require(root + '/ChainWhisper Contracts V2/validation/node_modules/ethers');
  return codes.map(code => (typeof code === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(code) ? keccak256(code) : null));
}

// ---- Root host I/O. ----
function hostIo() {
  const system = args => cp.execFileSync('systemctl', args, { encoding: 'utf8', timeout: 30000 });
  const childEnv = { PATH: '/usr/bin:/bin', NODE_ENV: 'production', HOME: '/nonexistent', CW_LOW_RPC_TRIAL: CONFIG.graph, CHAINWHISPER_RUNTIME_ROOT: root,
    NODE_PATH: root + '/ChainWhisper Contracts V2/validation/node_modules' };
  const child = (mode, input) => JSON.parse(cp.execFileSync('/usr/sbin/runuser', ['-u', CONFIG.serviceUser, '--', process.execPath, __filename, mode],
    { input: JSON.stringify(input), env: childEnv, cwd: '/', encoding: 'utf8', timeout: 600000, maxBuffer: 512 * 1024 * 1024 }));
  const stateFile = stateDir + '/state.json';
  const plain = file => { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw new Hold('WATCHDOG_FILE_KIND', file); return s; };
  const shaFile = file => sha256(fs.readFileSync(file));
  return {
    now: () => Date.now(),
    disabled: () => fs.existsSync(CONFIG.disableFile),
    unitState: () => Object.fromEntries(system(['show', CONFIG.unit, '-p', 'MainPID', '-p', 'Restart', '-p', 'ActiveState']).trim().split(/\r?\n/).map(line => line.split('='))),
    readBytes: file => fs.readFileSync(file, 'utf8'),
    exists: file => fs.existsSync(file),
    selfSha: () => shaFile(__filename),
    pinned: () => {
      const drift = {};
      for (const [file, hash] of Object.entries(CONFIG.pinnedFiles)) { let actual; try { actual = shaFile(file); } catch { actual = 'missing'; } if (actual !== hash) drift[file] = actual; }
      try { const list = fs.readdirSync(CONFIG.dropInDirectory).sort(); if (JSON.stringify(list) !== JSON.stringify(CONFIG.dropIns)) drift[CONFIG.dropInDirectory] = list; } catch { drift[CONFIG.dropInDirectory] = 'missing'; }
      for (const [link, target] of Object.entries(CONFIG.credentialLinks)) { let actual; try { actual = fs.readlinkSync(link); } catch { actual = 'missing'; } if (actual !== target) drift[link] = actual; }
      const props = Object.fromEntries(system(['show', CONFIG.unit, '-p', 'WorkingDirectory', '-p', 'Restart', '-p', 'User']).trim().split(/\r?\n/).map(line => line.split('=')));
      if (props.WorkingDirectory !== root || props.Restart !== 'no' || props.User !== CONFIG.serviceUser) drift.unit = props;
      return drift;
    },
    facts: input => child('--facts', input),
    recheck: input => child('--recheck', input),
    keccak: codes => child('--keccak', { codes }),
    rpc: async (method, params) => {
      const id = Math.floor(Math.random() * 1e9);
      const r = await fetch('https://testnet.coti.io/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(15000) });
      if (r.status !== 200) throw Error('HTTP ' + r.status);
      const j = await r.json(); if (j.jsonrpc !== '2.0' || j.id !== id || j.error || !Object.hasOwn(j, 'result')) throw Error('RPC result');
      return j.result;
    },
    saveApprovalBefore: (runName, bytes) => fs.writeFileSync(path.join(stateDir, 'records', `${new Date().toISOString().replaceAll(':', '')}-${runName}-APPROVAL_BEFORE.json`), bytes, { flag: 'wx', mode: 0o600 }),
    // In place, like the reviewed manual procedures: keeps owner, group, mode and any ACL of the installed file.
    writeApproval: value => { plain(CONFIG.approvalFile); fs.writeFileSync(CONFIG.approvalFile, JSON.stringify(value, null, 2) + '\n'); },
    readiness: () => require('/opt/server-dashboard/modules/chainwhisper-beta/readiness.js').inspect({ runtimeRoot: root, approvalFile: CONFIG.approvalFile, credentialsDirectory: '' }),
    startUnit: () => system(['start', CONFIG.unit]),
    readState: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')),
    writeState: value => { const tmp = stateFile + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, stateFile); },
    record: value => { const { deltas, actors, ...row } = value; fs.writeFileSync(path.join(stateDir, 'records', `${value.at.replaceAll(':', '')}-${value.runName}-${value.decision}.json`), JSON.stringify({ ...row, deltas, actors }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  };
}

module.exports = { CONFIG, Hold, classifyStop, checkGroupTraffic, restartDecision, feeCarry, buildApproval, seedState, installRestart, tick, selfCheck, hostIo, findLocks };
if (require.main === module) {
  const mode = process.argv[2];
  const readInput = () => JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  if (['--facts', '--recheck', '--keccak'].includes(mode)) {
    if (process.getuid?.() === 0) { console.error(JSON.stringify({ status: 'WATCHDOG_CHILD_ROOT_REFUSED' })); process.exit(1); }
    Promise.resolve(mode === '--facts' ? childFacts(readInput()) : mode === '--recheck' ? childRecheck(readInput()) : childKeccak(readInput()))
      .then(out => process.stdout.write(JSON.stringify(out))).catch(error => { console.error(String(error?.message ?? error).slice(0, 200)); process.exitCode = 1; });
    return;
  }
  if (!['--tick', '--self-check', '--seed'].includes(mode)) { console.error('usage: current-dex-service-watchdog.cjs --tick | --self-check | --seed <manual-restart-report-dir>'); process.exit(2); }
  if (process.getuid?.() !== 0) { console.error(JSON.stringify({ status: 'WATCHDOG_ROOT_REQUIRED' })); process.exit(1); }
  if (mode === '--self-check') { console.log(JSON.stringify(selfCheck(hostIo()))); return; }
  if (mode === '--seed') {
    const dir = process.argv[3], read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const value = seedState({ start: read('RESTART_START.json'), admission: read('RESTART_ADMISSION.json'), fees: read('RESTART_FEES.json'), approval: JSON.parse(fs.readFileSync(CONFIG.approvalFile, 'utf8')) });
    fs.writeFileSync(stateDir + '/state.json', JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'WATCHDOG_SEEDED', runName: Object.keys(value.baselines)[0], nonces: Object.values(value.baselines)[0].nonces }));
    return;
  }
  tick(hostIo()).then(result => { console.log(JSON.stringify(result)); })
    .catch(error => { console.error(JSON.stringify({ status: 'WATCHDOG_ERROR', message: String(error?.message ?? error).slice(0, 200), noAutomaticRetryOfStart: true })); process.exitCode = 1; });
}
