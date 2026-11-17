'use strict';
// CW-101: automatic restart decision for the hosted DEX service group. All I/O is injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { CONFIG, classifyStop, checkGroupTraffic, restartDecision, feeCarry, buildApproval, seedState, tick, selfCheck } = require('./current-dex-service-watchdog.cjs');

const MIN = 60000, T0 = Date.parse('2026-11-18T10:00:00.000Z');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const traffic = (methods = {}, extra = {}) => ({ methods: { eth_call: 5, ...methods }, physicalPending: 0, unresolvedOccupancy: 0, ...extra });
const run = (t, status = 'RETURNED', feeLimitWei = '300') => ({ status, traffic: t, feeLimitWei });
const oldApproval = { schema: 'CHAINWHISPER_BETA_SERVICE_APPROVAL_V1', approvedByOwner: true, graph: CONFIG.graph, runtimeManifestSha256: CONFIG.runtimeManifestSha256,
  mode: 'standing', issuedAt: '2026-11-18T07:59:00.000Z', expiresAt: null, gasPriceWei: '50000000', maximumNewFeeWei: null, runName: 'server-beta-run-a',
  operatingMs: null, maximumEquivalentGroups: null, startBefore: '2026-11-18T08:01:00.000Z', priorSpentFeeWei: '1000', noNewFunding: true, restartApprovalSha256: 'x' };
const approvalText = JSON.stringify(oldApproval);
// Realistic: the supervisor settled only the passed prices run (60); FAILED runs' fees are in journals only.
function stoppedGroup(overrides = {}) {
  return {
    status: 'STOPPED', stopReason: 'DEX_RPC_TRANSPORT_STOP', startedAt: '2026-11-18T08:00:00.000Z', finishedAt: '2026-11-18T09:50:00.000Z',
    settledFeeWei: '1060', period: { graph: CONFIG.graph, runtimeManifestSha256: CONFIG.runtimeManifestSha256, priorSpentFeeWei: '1000', approvalSha256: sha(approvalText) },
    rpc: { physicalInFlight: 0, unknownInFlight: 1, unresolvedOccupancy: 1, statuses: { 200: 99 } },
    runs: {
      keeper: [run(traffic({}, { unresolvedOccupancy: 1, lastFailure: { code: 'DEX_RPC_TRANSPORT_STOP', method: 'eth_chainId', methods: ['eth_chainId'], phase: 'transport', status: null } }), 'FAILED', '880')],
      prices: [run(traffic({ eth_sendRawTransaction: 2 })), run(traffic({ eth_sendRawTransaction: 1 }), 'FAILED')],
      matching: [run(traffic(), 'FAILED', '66')],
      c1: [run(traffic({ eth_sendRawTransaction: 4 }), 'FAILED', '79')]
    },
    ...overrides
  };
}
const baseline = { nonces: { keeper: '10', prices: '20', matching: '30', c1: '40' }, feesAfter: { keeper: 'k0', prices: 'p0', matching: 'm0', c1: 'c0' }, carry: '1000' };
const groupPath = CONFIG.runParent + '/server-beta-run-a/group.json';
const cleanFacts = () => ({ locks: [], c1: { pendingHash: null, hashless: false, activePair: null, queuedPairs: [], halt: null, renewalPending: false, window: 84 },
  price: { pending: null, stopped: true, pendingRecordMarket: null }, accounting: Object.fromEntries(['keeper', 'prices', 'matching', 'c1'].map(n => [n, { service: n, journals: [{ path: 'j/' + n + '.jsonl', sha256: 'sha-' + n }] }])),
  deltas: { keeper: '0', prices: '100', matching: '0', c1: '70' }, feeError: null,
  binding: { genesis: 'genesis', core: 'core', tokens: ['t1', 't2'], codeHashes: { core: 'hash:core', t1: 'hash:t1', t2: 'hash:t2' } } });

function harness(change = {}) {
  const writes = [], calls = [];
  const h = {
    now: T0, unit: { ActiveState: 'failed', MainPID: '0', Restart: 'no' }, approvalText, group: stoppedGroup(),
    owner: { task: 'CW-101', approvedByOwner: true, watchdogSha256: 'watchdog-sha' }, facts: cleanFacts(), factsSecond: null, factCalls: 0,
    chain: { keeper: ['10', '10', '9'], prices: ['23', '23', '9'], matching: ['30', '30', '9'], c1: ['44', '44', '9'] }, gasPrice: 50000000n, rpcThrow: null,
    readiness: null, state: { schema: 'CW101_WATCHDOG_STATE_V1', baselines: { 'server-beta-run-a': structuredClone(baseline) }, decisions: {}, restarts: [], transient: {} },
    writes, calls, existing: new Set(), ...change
  };
  const io = {
    now: () => h.now,
    disabled: () => Boolean(h.disabled),
    unitState: () => (h.unitAfterFirst && h.unitReads++ > 0 ? h.unitAfterFirst : h.unit),
    readBytes: file => {
      if (file === CONFIG.approvalFile) return h.approvalReads !== undefined && h.approvalReads++ > 0 ? h.approvalLater : h.approvalText;
      if (file === CONFIG.ownerApprovalFile) return JSON.stringify(h.owner);
      if (file === CONFIG.installApprovalFile) return JSON.stringify(h.install);
      if (file === groupPath) { if (!h.group) throw Object.assign(Error('missing'), { code: 'ENOENT' }); return h.groupReads !== undefined && h.groupReads++ > 0 ? JSON.stringify(h.groupLater) : JSON.stringify(h.group); }
      throw Error('unexpected read ' + file);
    },
    exists: file => h.existing.has(file),
    selfSha: () => 'watchdog-sha',
    pinned: () => h.pinnedDrift ? { [CONFIG.runtimeRoot + '/runtime-public.json']: 'changed' } : {},
    facts: input => { assert.deepEqual(input, { feesAfter: h.state.baselines['server-beta-run-a']?.feesAfter }); h.factCalls++; return structuredClone(h.factCalls > 1 && h.factsSecond ? h.factsSecond : h.facts); },
    recheck: input => { h.rechecks = (h.rechecks ?? 0) + 1; const f = h.recheckFacts ?? h.facts; return structuredClone({ locks: f.locks, c1: f.c1, price: f.price, journals: input.journals.map(j => ({ ...j, sha256: h.journalChange?.[j.path] ?? j.sha256 })) }); },
    keccak: codes => codes.map(code => 'hash:' + code.replace('code:', '')),
    rpc: async (method, params) => {
      calls.push(method); if (h.rpcThrow) throw Error(h.rpcThrow);
      if (method === 'eth_chainId') return h.badChain ?? '0x6c11a0';
      if (method === 'eth_gasPrice') return '0x' + h.gasPrice.toString(16);
      if (method === 'eth_getBlockByNumber') return params[0] === '0x0' ? { hash: h.genesis ?? 'genesis' } : { number: '0x10', hash: 'head', timestamp: '0x' + Math.floor((h.headTime ?? h.now) / 1000).toString(16), baseFeePerGas: '0x7' };
      if (method === 'eth_getCode') return 'code:' + (h.codeSwap?.[params[0]] ?? params[0]);
      const actor = Object.entries(CONFIG.actors).find(([, a]) => a.address === params[0]);
      const [latest, pending, balance] = h.chain[actor[0]];
      if (method === 'eth_getTransactionCount') return '0x' + BigInt(params[1] === 'pending' ? pending : latest).toString(16);
      if (method === 'eth_getBalance') return '0x' + (BigInt(CONFIG.actors[actor[0]].reserveFloorWei) + BigInt(balance)).toString(16);
      throw Error('unexpected rpc ' + method);
    },
    saveApprovalBefore: (runName, bytes) => { writes.push(['approval-before', runName, bytes]); },
    writeApproval: value => { writes.push(['approval', value]); },
    readiness: () => h.readiness ?? { verifiedFiles: CONFIG.runtimeFiles, operatingApprovalValid: true, graph: CONFIG.graph, runtimeManifestSha256: CONFIG.runtimeManifestSha256,
      runName: writes.findLast(w => w[0] === 'approval')?.[1].runName, priorSpentFeeWei: writes.findLast(w => w[0] === 'approval')?.[1].priorSpentFeeWei, issues: ['Private credentials are checked only inside the service credential namespace.'] },
    startUnit: () => { if (h.startThrows) throw Error('systemctl timeout'); writes.push(['start']); },
    readState: () => structuredClone(h.state),
    writeState: value => { h.state = structuredClone(value); writes.push(['state']); },
    record: value => { writes.push(['record', value]); }
  };
  return { h, io };
}
const started = h => h.writes.some(w => w[0] === 'start');

test('classifyStop admits only RPC stop codes', () => {
  assert.deepEqual(classifyStop(stoppedGroup()), { kind: 'rpc', rpcClass: 'transport' });
  assert.deepEqual(classifyStop(stoppedGroup({ stopReason: 'DEX_RPC_HTTP_403' })), { kind: 'rpc', rpcClass: 'rate' });
  assert.deepEqual(classifyStop(stoppedGroup({ stopReason: 'DEX_RPC_HTTP_429' })), { kind: 'rpc', rpcClass: 'rate' });
  assert.deepEqual(classifyStop(stoppedGroup({ stopReason: 'DEX_RPC_RESPONSE_TIMEOUT' })), { kind: 'rpc', rpcClass: 'transport' });
  for (const reason of ['OPERATOR_STOP', 'prices:FAILED', 'c1:FAILED', 'DEX_SERVICES_START_FAILED', 'DEX_SERVER_ACCOUNTING', 'DEX_RPC_SOURCE_DRIFT', 'BUDGET_BOUND', 'DEX_RPC_KEEPER_LOST', 'DEX_RPC_IPC_PROTOCOL'])
    assert.equal(classifyStop(stoppedGroup({ stopReason: reason })).kind, 'hold', reason);
  assert.equal(classifyStop({ ...stoppedGroup(), status: 'RUNNING' }).kind, 'hold');
});

test('checkGroupTraffic counts sends, accepts one unresolved read and sums FAILED fee limits', () => {
  assert.deepEqual(checkGroupTraffic(stoppedGroup()), { sends: { keeper: 0, prices: 3, matching: 0, c1: 4 }, failedFeeLimitWei: 1325n });
});

test('checkGroupTraffic holds on missing or unsafe evidence', () => {
  const cases = [
    ['WATCHDOG_UNRESOLVED_SEND', g => { g.runs.keeper[0].traffic.lastFailure = { method: 'eth_sendRawTransaction', methods: ['eth_sendRawTransaction'], phase: 'transport' }; }],
    ['WATCHDOG_UNRESOLVED_SEND', g => { g.runs.keeper[0].traffic.lastFailure = {}; }],
    ['WATCHDOG_TRAFFIC_MISSING', g => { g.runs.matching[0].traffic = undefined; }],
    ['WATCHDOG_TRAFFIC_MISSING', g => { g.runs.c1 = []; }],
    ['WATCHDOG_IN_FLIGHT', g => { g.rpc.physicalInFlight = 1; }],
    ['WATCHDOG_IN_FLIGHT', g => { g.runs.prices[1].traffic.physicalPending = 1; }],
    ['WATCHDOG_UNRESOLVED_COUNT', g => { g.runs.c1[0].traffic.unresolvedOccupancy = 1; g.runs.c1[0].traffic.lastFailure = { method: 'eth_call', methods: ['eth_call'], phase: 'transport' }; }],
    ['WATCHDOG_UNKNOWN_IN_FLIGHT', g => { g.rpc.unknownInFlight = 2; }],
    ['WATCHDOG_RPC_STATUSES', g => { g.rpc.statuses = { 200: 99, 500: 1 }; }],
    ['WATCHDOG_RUN_ACCOUNTING', g => { g.runs.prices[0].accountingError = 'DEX_SERVER_ACCOUNTING'; }],
    ['WATCHDOG_RUN_HELD', g => { g.runs.c1[0].status = 'HELD'; }],
    ['WATCHDOG_RUN_RESULT', g => { g.runs.matching[0].result = { pendingHash: '0xabc' }; }]
  ];
  for (const [guard, mutate] of cases) { const g = stoppedGroup(); mutate(g); assert.throws(() => checkGroupTraffic(g), { guard }, guard); }
  const rate = stoppedGroup({ stopReason: 'DEX_RPC_HTTP_403' }); rate.rpc.statuses = { 200: 99, 403: 1 };
  assert.doesNotThrow(() => checkGroupTraffic(rate));
});

test('feeCarry takes exact journal fees and bounds the unsettled part by FAILED run limits', () => {
  assert.equal(feeCarry({ baselineCarry: '1000', deltas: { keeper: '0', prices: '100', matching: '0', c1: '70' }, settledFeeWei: '1060', failedFeeLimitWei: 1325n }), '1170');
  assert.throws(() => feeCarry({ baselineCarry: '1000', deltas: { keeper: '0', prices: '100', matching: '0', c1: '70' }, settledFeeWei: '1200', failedFeeLimitWei: 1325n }), { guard: 'WATCHDOG_FEE_CARRY' });
  assert.throws(() => feeCarry({ baselineCarry: '1000', deltas: { keeper: '0', prices: '100', matching: '0', c1: '70' }, settledFeeWei: '1060', failedFeeLimitWei: 100n }), { guard: 'WATCHDOG_FEE_CARRY' });
  assert.throws(() => feeCarry({ baselineCarry: '1000', deltas: { keeper: '0', prices: '0', matching: '0', c1: '0' }, settledFeeWei: '990', failedFeeLimitWei: 1325n }), { guard: 'WATCHDOG_FEE_CARRY' });
});

test('restartDecision applies backoff by class and a daily cap', () => {
  const finished = Date.parse('2026-11-18T09:50:00.000Z');
  assert.equal(restartDecision({ restarts: [], rpcClass: 'transport', finishedAt: finished, now: finished + CONFIG.backoffMs.transport[0] - 1 }).due, false);
  assert.equal(restartDecision({ restarts: [], rpcClass: 'transport', finishedAt: finished, now: finished + CONFIG.backoffMs.transport[0] }).due, true);
  assert.equal(restartDecision({ restarts: [], rpcClass: 'rate', finishedAt: finished, now: finished + CONFIG.backoffMs.transport[0] }).due, false);
  const two = [{ at: new Date(finished - 60 * MIN).toISOString() }, { at: new Date(finished - 30 * MIN).toISOString() }];
  const d = restartDecision({ restarts: two, rpcClass: 'transport', finishedAt: finished, now: finished + CONFIG.backoffMs.transport[1] });
  assert.equal(d.due, false); assert.equal(d.waitUntil, finished + CONFIG.backoffMs.transport[2]);
  const full = Array.from({ length: CONFIG.maximumRestartsPerDay }, (_, i) => ({ at: new Date(finished - (i + 1) * MIN).toISOString() }));
  assert.equal(restartDecision({ restarts: full, rpcClass: 'transport', finishedAt: finished, now: finished + 10 * 60 * MIN }).hold, 'WATCHDOG_DAILY_CAP');
  const old = Array.from({ length: CONFIG.maximumRestartsPerDay }, () => ({ at: new Date(finished - 25 * 60 * MIN).toISOString() }));
  assert.equal(restartDecision({ restarts: old, rpcClass: 'transport', finishedAt: finished, now: finished + CONFIG.backoffMs.transport[0] }).due, true);
});

test('buildApproval keeps the standing terms and replaces only run, time and carry', () => {
  const a = buildApproval(oldApproval, { runName: 'server-beta-20261118-auto-1', now: T0, carry: '1170', fromRun: 'server-beta-run-a', stopReason: 'DEX_RPC_TRANSPORT_STOP', attempt: 1, ownerApprovalSha256: 'owner-sha' });
  assert.equal(a.runName, 'server-beta-20261118-auto-1'); assert.equal(a.priorSpentFeeWei, '1170');
  assert.equal(a.issuedAt, new Date(T0).toISOString()); assert.equal(Date.parse(a.startBefore) - T0, 120000);
  for (const key of ['schema', 'approvedByOwner', 'graph', 'runtimeManifestSha256', 'mode', 'expiresAt', 'gasPriceWei', 'maximumNewFeeWei', 'operatingMs', 'maximumEquivalentGroups', 'noNewFunding'])
    assert.deepEqual(a[key], oldApproval[key], key);
  assert.equal(a.restartApprovalSha256, undefined);
  assert.deepEqual(a.autoRestart, { fromRun: 'server-beta-run-a', stopReason: 'DEX_RPC_TRANSPORT_STOP', attempt: 1, ownerApprovalSha256: 'owner-sha' });
  assert.match(a.runName, /^server-beta-[a-z0-9-]+$/);
});

test('seedState binds the first baseline to the manual restart records', () => {
  const approval = { ...oldApproval, runName: 'server-beta-20261117-cw100-9c2c-transport', priorSpentFeeWei: '6089282145800000000' };
  const actors = Object.fromEntries(Object.entries(CONFIG.actors).map(([n, a], i) => [n, { address: a.address, nonce: String(i + 1), pending: String(i + 1) }]));
  const fees = { priorSpentNextWei: approval.priorSpentFeeWei, after: Object.fromEntries(CONFIG.services.map(n => [n, { service: n }])) };
  const start = { status: 'CW100_TRANSPORT_RESTART_START_REQUESTED', runName: approval.runName };
  const s = seedState({ start, admission: { actors, priorSpentFeeWei: approval.priorSpentFeeWei }, fees, approval });
  assert.deepEqual(s.baselines[approval.runName].nonces, { keeper: '1', prices: '2', matching: '3', c1: '4' });
  assert.equal(s.baselines[approval.runName].carry, approval.priorSpentFeeWei);
  assert.throws(() => seedState({ start: { ...start, runName: 'other' }, admission: { actors, priorSpentFeeWei: approval.priorSpentFeeWei }, fees, approval }), { guard: 'WATCHDOG_SEED_RUN' });
  assert.throws(() => seedState({ start, admission: { actors: { ...actors, c1: { ...actors.c1, pending: '9' } }, priorSpentFeeWei: approval.priorSpentFeeWei }, fees, approval }), { guard: 'WATCHDOG_SEED_ACTOR' });
});

test('tick restarts a clean RPC stop after the backoff', async () => {
  const { h, io } = harness();
  const result = await tick(io);
  assert.equal(result.status, 'WATCHDOG_RESTART_STARTED', JSON.stringify(result));
  const approval = h.writes.find(w => w[0] === 'approval')[1];
  assert.equal(approval.priorSpentFeeWei, '1170'); assert.equal(approval.runName, 'server-beta-20261118-auto-1');
  const order = ['approval-before', 'approval', 'state', 'start'].map(kind => h.writes.findIndex(w => w[0] === kind));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'old approval saved, new approval, intent, then start');
  assert.equal(h.writes.find(w => w[0] === 'approval-before')[2], approvalText);
  assert.deepEqual(h.state.baselines['server-beta-20261118-auto-1'].nonces, { keeper: '10', prices: '23', matching: '30', c1: '44' });
  assert.equal(h.state.baselines['server-beta-20261118-auto-1'].carry, '1170');
  assert.equal(h.state.decisions['server-beta-run-a'].decision, 'RESTARTED');
  assert.equal(h.state.restarts.length, 1); assert.equal(h.factCalls, 1); assert.equal(h.rechecks, 1);
  assert.ok(h.calls.length <= CONFIG.maximumAdmissionReads);
});

test('a second restart uses the baseline written by the first', async () => {
  const first = harness(); await tick(first.io);
  const newRun = 'server-beta-20261118-auto-1', next = first.h.writes.find(w => w[0] === 'approval')[1];
  const nextText = JSON.stringify(next);
  const group = stoppedGroup({ finishedAt: '2026-11-18T11:00:00.000Z', settledFeeWei: '1170', period: { graph: CONFIG.graph, runtimeManifestSha256: CONFIG.runtimeManifestSha256, priorSpentFeeWei: '1170', approvalSha256: sha(nextText) } });
  group.runs.prices = [run(traffic())]; group.runs.c1 = [run(traffic({ eth_sendRawTransaction: 1 }), 'FAILED', '79')];
  const facts = cleanFacts(); facts.deltas = { keeper: '0', prices: '0', matching: '0', c1: '5' };
  const second = harness({ now: Date.parse('2026-11-18T11:00:00.000Z') + CONFIG.backoffMs.transport[1], state: first.h.state, approvalText: nextText, group, facts,
    chain: { keeper: ['10', '10', '9'], prices: ['23', '23', '9'], matching: ['30', '30', '9'], c1: ['45', '45', '9'] } });
  second.io.readBytes = (orig => file => (file === CONFIG.runParent + '/' + newRun + '/group.json' ? JSON.stringify(group) : orig(file)))(second.io.readBytes);
  second.io.facts = () => structuredClone(facts);
  second.io.recheck = input => ({ locks: facts.locks, c1: facts.c1, price: facts.price, journals: input.journals });
  const result = await tick(second.io);
  assert.equal(result.status, 'WATCHDOG_RESTART_STARTED', JSON.stringify(result));
  assert.equal(result.newRun, 'server-beta-20261118-auto-2'); assert.equal(result.carry, '1175');
  assert.equal(second.h.state.restarts.length, 2);
});

test('tick waits during the backoff and does not start', async () => {
  const { h, io } = harness({ now: Date.parse('2026-11-18T09:51:00.000Z') });
  assert.equal((await tick(io)).status, 'WATCHDOG_WAIT');
  assert.ok(!started(h) && !h.writes.some(w => w[0] === 'approval')); assert.equal(h.calls.length, 0); assert.equal(h.factCalls, 0);
});

test('tick does nothing while the unit runs, when disabled, or after a decision', async () => {
  for (const change of [{ unit: { ActiveState: 'active', MainPID: '5', Restart: 'no' } }, { unit: { ActiveState: 'activating', MainPID: '0', Restart: 'no' } }, { disabled: true }]) {
    const { h, io } = harness(change);
    assert.ok(['WATCHDOG_RUNNING', 'WATCHDOG_DISABLED'].includes((await tick(io)).status)); assert.equal(h.writes.length, 0);
  }
  const { h, io } = harness();
  h.state.decisions['server-beta-run-a'] = { decision: 'HOLD', guard: 'X' };
  assert.equal((await tick(io)).status, 'WATCHDOG_ALREADY_DECIDED'); assert.equal(h.writes.length, 0);
});

const holdCases = [
  ['operator stop', { group: stoppedGroup({ stopReason: 'OPERATOR_STOP' }) }, 'WATCHDOG_STOP_NOT_RPC'],
  ['service failure', { group: stoppedGroup({ stopReason: 'c1:FAILED' }) }, 'WATCHDOG_STOP_NOT_RPC'],
  ['stop request after an RPC stop', {}, 'WATCHDOG_OPERATOR_STOP_REQUEST', h => { h.existing.add(CONFIG.runParent + '/server-beta-run-a/stop-request.json'); }],
  ['no group record', { group: null }, 'WATCHDOG_GROUP_MISSING'],
  ['daily cap', {}, 'WATCHDOG_DAILY_CAP', h => { h.state.restarts = Array.from({ length: CONFIG.maximumRestartsPerDay }, (_, i) => ({ at: new Date(T0 - (i + 1) * MIN).toISOString(), runName: 'r' + i })); }],
  ['unchecked baseline', {}, 'WATCHDOG_BASELINE_MISSING', h => { delete h.state.baselines['server-beta-run-a']; }],
  ['owner approval bound to other code', { owner: { task: 'CW-101', approvedByOwner: true, watchdogSha256: 'other' } }, 'WATCHDOG_OWNER_APPROVAL'],
  ['group from another graph', {}, 'WATCHDOG_APPROVAL_RUN', h => { h.group.period.graph = 'other'; }],
  ['group approval hash differs', {}, 'WATCHDOG_APPROVAL_DRIFT', h => { h.group.period.approvalSha256 = 'other'; }],
  ['group carry differs from baseline', {}, 'WATCHDOG_BASELINE_CARRY', h => { h.group.period.priorSpentFeeWei = '999'; }],
  ['installed file drift', { pinnedDrift: true }, 'WATCHDOG_PINNED_FILE'],
  ['stale lock', {}, 'WATCHDOG_STALE_LOCK', h => { h.facts.locks = ['/x/service.lock']; }],
  ['C1 pending hash', {}, 'WATCHDOG_C1_UNRESOLVED', h => { h.facts.c1.pendingHash = '0xabc'; }],
  ['price session pending', {}, 'WATCHDOG_PRICE_UNRESOLVED', h => { h.facts.price.pending = { action: 1 }; }],
  ['price session unreadable', {}, 'WATCHDOG_PRICE_UNRESOLVED', h => { h.facts.price = null; }],
  ['unresolved fee journal', {}, 'WATCHDOG_FEE_JOURNAL', h => { h.facts.feeError = 'keeper:DEX_SERVICE_FEES_UNRESOLVED'; }],
  ['unsettled fees above FAILED limits', {}, 'WATCHDOG_FEE_CARRY', h => { h.facts.deltas.c1 = '5000'; }],
  ['chain id', { badChain: '0x1' }, 'WATCHDOG_CHAIN'],
  ['genesis', { genesis: 'other' }, 'WATCHDOG_GENESIS'],
  ['code hash', { codeSwap: { t2: 'evil' } }, 'WATCHDOG_CODE'],
  ['nonce above recorded sends', {}, 'WATCHDOG_NONCE', h => { h.chain.c1 = ['45', '45', '9']; }],
  ['pending transaction', {}, 'WATCHDOG_PENDING', h => { h.chain.prices = ['23', '24', '9']; }],
  ['balance below reserve', {}, 'WATCHDOG_RESERVE', h => { h.chain.matching = ['30', '30', '-1']; }],
  ['unit started meanwhile', { unitAfterFirst: { ActiveState: 'active', MainPID: '7', Restart: 'no' }, unitReads: 0 }, 'WATCHDOG_UNIT_CHANGED'],
  ['approval replaced meanwhile', { approvalReads: 0, approvalLater: JSON.stringify({ ...oldApproval, runName: 'manual' }) }, 'WATCHDOG_APPROVAL_DRIFT'],
  ['group record changed meanwhile', { groupReads: 0, groupLater: { changed: true } }, 'WATCHDOG_GROUP_CHANGED'],
  ['journal changed meanwhile', { journalChange: { 'j/c1.jsonl': 'other' } }, 'WATCHDOG_FACTS_CHANGED'],
  ['lock appeared meanwhile', {}, 'WATCHDOG_FACTS_CHANGED', h => { h.recheckFacts = { ...cleanFacts(), locks: ['/x/runner.lock'] }; }],
  ['readiness rejects', { readiness: { verifiedFiles: 1, operatingApprovalValid: false, issues: ['bad'] } }, 'WATCHDOG_READINESS'],
  ['unresolved send', {}, 'WATCHDOG_UNRESOLVED_SEND', h => { h.group.runs.keeper[0].traffic.lastFailure.methods = ['eth_sendRawTransaction']; }],
  ['held run', {}, 'WATCHDOG_RUN_HELD', h => { h.group.runs.matching[0].status = 'HELD'; }],
  ['next run already exists', {}, 'WATCHDOG_RUN_EXISTS', h => { h.existing.add(CONFIG.runParent + '/server-beta-20261118-auto-1'); }]
];
for (const [name, change, guard, mutate] of holdCases) {
  test(`tick holds and records: ${name}`, async () => {
    const { h, io } = harness(change); mutate?.(h);
    const result = await tick(io);
    assert.equal(result.status, 'WATCHDOG_HOLD', JSON.stringify(result)); assert.equal(result.guard, guard);
    assert.ok(!started(h), 'no start');
    if (guard !== 'WATCHDOG_READINESS') assert.ok(!h.writes.some(w => w[0] === 'approval'), 'no approval write');
    assert.equal(h.state.decisions['server-beta-run-a'].decision, 'HOLD');
    assert.ok(h.writes.some(w => w[0] === 'record' && w[1].guard === guard));
  });
}

test('admission RPC failures and malformed reads wait, then hold after the try limit', async () => {
  for (const change of [{ rpcThrow: 'fetch failed' }, { badChain: undefined, headTime: T0 - 10 * MIN }, { gasPrice: 60000000n }]) {
    const { h, io } = harness(change);
    const result = await tick(io);
    assert.equal(result.status, 'WATCHDOG_TRANSIENT', JSON.stringify(result));
    assert.ok(!started(h) && !h.writes.some(w => w[0] === 'approval')); assert.equal(h.state.decisions['server-beta-run-a'], undefined);
    assert.equal((await tick(io)).status, 'WATCHDOG_TRANSIENT_WAIT');
  }
  const { h, io } = harness({ rpcThrow: 'fetch failed' });
  for (let i = 0; i < CONFIG.maximumTransientTries - 1; i++) { assert.equal((await tick(io)).status, 'WATCHDOG_TRANSIENT'); h.now += 11 * MIN; }
  const last = await tick(io);
  assert.equal(last.status, 'WATCHDOG_HOLD'); assert.equal(last.guard, 'WATCHDOG_REPEATED_RPC_UNAVAILABLE');
});

test('an unexpected fact error is transient, then a hold', async () => {
  const { h, io } = harness();
  io.facts = () => { throw Error('child failed'); };
  for (let i = 0; i < CONFIG.maximumTransientTries - 1; i++) { assert.equal((await tick(io)).status, 'WATCHDOG_TRANSIENT'); h.now += 11 * MIN; }
  assert.equal((await tick(io)).guard, 'WATCHDOG_REPEATED_ERROR'); assert.ok(!started(h));
});

test('a failed start call leaves the run decided with its baseline and is not retried', async () => {
  const { h, io } = harness({ startThrows: true });
  const result = await tick(io);
  assert.equal(result.status, 'WATCHDOG_START_UNCERTAIN');
  assert.equal(h.state.decisions['server-beta-run-a'].decision, 'STARTING');
  assert.ok(h.state.baselines['server-beta-20261118-auto-1']); assert.equal(h.state.restarts.length, 1);
  assert.equal((await tick(io)).status, 'WATCHDOG_ALREADY_DECIDED');
});

test('a rate stop uses the longer backoff', async () => {
  const group = stoppedGroup({ stopReason: 'DEX_RPC_HTTP_403' });
  group.runs.keeper[0].traffic = traffic(); group.rpc.unknownInFlight = 0; group.rpc.statuses = { 200: 99, 403: 1 };
  group.runs.c1[0].traffic.lastFailure = { code: 'DEX_RPC_HTTP_403', method: 'eth_getBlockByNumber', methods: ['eth_getBlockByNumber'], phase: 'http-response', status: 403 };
  const early = harness({ group: structuredClone(group), now: Date.parse('2026-11-18T09:50:00.000Z') + CONFIG.backoffMs.transport[0] });
  assert.equal((await tick(early.io)).status, 'WATCHDOG_WAIT');
  const late = harness({ group: structuredClone(group), now: Date.parse('2026-11-18T09:50:00.000Z') + CONFIG.backoffMs.rate[0] });
  assert.equal((await tick(late.io)).status, 'WATCHDOG_RESTART_STARTED');
});

test('selfCheck reads only and reports the binding', () => {
  const { h, io } = harness();
  const out = selfCheck(io);
  assert.equal(out.status, 'WATCHDOG_SELF_CHECKED'); assert.equal(out.ownerBound, true); assert.equal(out.baselinePresent, true);
  assert.deepEqual(out.pinnedDrift, {}); assert.equal(h.writes.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.factCalls, 0);
});

// CW-102: one owner-approved restart after the read-retry install. The stopped group ran on the previous manifest.
const installApproval = { task: 'CW-102', approvedByOwner: true, fromRun: 'server-beta-run-a', watchdogSha256: 'watchdog-sha',
  previousRuntimeManifestSha256: CONFIG.previousRuntimeManifestSha256, runtimeManifestSha256: CONFIG.runtimeManifestSha256 };
function installHarness(change = {}) {
  const previous = { ...oldApproval, runtimeManifestSha256: CONFIG.previousRuntimeManifestSha256 }, text = JSON.stringify(previous);
  const group = stoppedGroup({ stopReason: 'OPERATOR_STOP', period: { graph: CONFIG.graph, runtimeManifestSha256: CONFIG.previousRuntimeManifestSha256, priorSpentFeeWei: '1000', approvalSha256: sha(text) },
    rpc: { physicalInFlight: 0, unknownInFlight: 0, unresolvedOccupancy: 0, statuses: { 200: 99 } } });
  group.runs.keeper[0].traffic = traffic();
  const fixture = harness({ approvalText: text, group, install: structuredClone(installApproval),
    existing: new Set([CONFIG.installApprovalFile, CONFIG.runParent + '/server-beta-run-a/stop-request.json']), ...change });
  return fixture;
}

test('the rebind pins the new runtime manifest and keeps the previous one only for the install restart', () => {
  assert.equal(CONFIG.runtimeManifestSha256, '8dc239e69f29000c95660b1ceb38c4c549e22f484c172a305a6ffdc51a058f48');
  assert.equal(CONFIG.previousRuntimeManifestSha256, '5f793459a7141eaf13e54939469a7555eb2a2e813ceaf60005e8273c4af1b9df');
  assert.equal(CONFIG.pinnedFiles[CONFIG.runtimeRoot + '/runtime-public.json'], CONFIG.runtimeManifestSha256);
});

test('tick restarts once after an owner-approved install with the new manifest in the new approval', async () => {
  const { h, io } = installHarness();
  const result = await tick(io);
  assert.equal(result.status, 'WATCHDOG_RESTART_STARTED', JSON.stringify(result));
  const approval = h.writes.find(w => w[0] === 'approval')[1];
  assert.equal(approval.runtimeManifestSha256, CONFIG.runtimeManifestSha256); assert.equal(approval.runName, 'server-beta-20261118-cw102-install');
  assert.equal(approval.autoRestart.installApprovalSha256, sha(JSON.stringify(installApproval))); assert.equal(approval.priorSpentFeeWei, '1170');
  assert(started(h)); assert.equal(h.state.decisions['server-beta-run-a'].decision, 'RESTARTED');
  const again = await tick(io); assert.equal(again.status, 'WATCHDOG_ALREADY_DECIDED');
});

for (const [name, change, guard] of [
  ['another run', h => { h.install.fromRun = 'server-beta-run-b'; }, 'WATCHDOG_OPERATOR_STOP_REQUEST'],
  ['another watchdog', h => { h.install.watchdogSha256 = 'other'; }, 'WATCHDOG_OPERATOR_STOP_REQUEST'],
  ['another manifest', h => { h.install.runtimeManifestSha256 = 'f'.repeat(64); }, 'WATCHDOG_OPERATOR_STOP_REQUEST'],
  ['no owner approval', h => { h.install.approvedByOwner = false; }, 'WATCHDOG_OPERATOR_STOP_REQUEST'],
  ['a missing approval file', h => { h.existing.delete(CONFIG.installApprovalFile); }, 'WATCHDOG_OPERATOR_STOP_REQUEST'],
  ['a service failure stop', h => { h.group.stopReason = 'c1:FAILED'; }, 'WATCHDOG_OPERATOR_STOP_REQUEST'],
  ['a group on the new manifest', h => { h.group.period.runtimeManifestSha256 = CONFIG.runtimeManifestSha256; }, 'WATCHDOG_OPERATOR_STOP_REQUEST'],
  ['an unresolved request', h => { h.group.rpc.physicalInFlight = 1; }, 'WATCHDOG_IN_FLIGHT'],
  ['a nonce that does not match the recorded sends', h => { h.chain.c1 = ['45', '45', '9']; }, 'WATCHDOG_NONCE']
]) test(`the install restart holds for ${name}`, async () => {
  const { h, io } = installHarness(); change(h);
  const result = await tick(io);
  assert.equal(result.status, 'WATCHDOG_HOLD', JSON.stringify(result)); assert.equal(result.guard, guard); assert(!started(h));
});

test('the install approval changing before the start holds', async () => {
  const { h, io } = installHarness();
  let reads = 0; const readBytes = io.readBytes;
  io.readBytes = file => file === CONFIG.installApprovalFile && reads++ > 0 ? JSON.stringify({ ...installApproval, note: 'changed' }) : readBytes(file);
  const result = await tick(io);
  assert.equal(result.status, 'WATCHDOG_HOLD'); assert.equal(result.guard, 'WATCHDOG_INSTALL_APPROVAL_DRIFT'); assert(!started(h));
});

test('a normal RPC stop of a group on the previous manifest holds without an install approval', async () => {
  const { h, io } = installHarness();
  h.group.stopReason = 'DEX_RPC_TRANSPORT_STOP'; h.existing = new Set();
  const result = await tick(io);
  assert.equal(result.status, 'WATCHDOG_HOLD'); assert.equal(result.guard, 'WATCHDOG_APPROVAL_TERMS'); assert(!started(h));
});

test('the owner approval of the rebound watchdog may name CW-102', async () => {
  const { h, io } = harness({ owner: { task: 'CW-102', approvedByOwner: true, watchdogSha256: 'watchdog-sha' } });
  const result = await tick(io); assert.equal(result.status, 'WATCHDOG_RESTART_STARTED', JSON.stringify(result)); assert(started(h));
});
