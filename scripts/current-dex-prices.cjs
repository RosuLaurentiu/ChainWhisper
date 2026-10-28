'use strict';

const path = require('node:path');
const assert = require('node:assert/strict');
const service = require(path.resolve(__dirname,
  '../../ChainWhisper Contracts V2/validation/candidates/limit-fill-history-shared-receipt-2026-10-13/reference-history/service.cjs'));
const WINDOW = Object.freeze({ epochs: 12, newWorkMs: 30 * 60 * 1000 });

async function runWindow(once) {
  const epochs = once ? 1 : WINDOW.epochs, caps = service.controller.LIMITS;
  const limits = { epochs, newWorkMs: WINDOW.newWorkMs,
    maximumCommittedWei: String(BigInt(caps.commitWei) * BigInt(epochs)), reserveWei: caps.reserveWei };
  const source = service.pins(), admission = await service.main('--check', 'service-session-7b67-4');
  assert.equal(admission.sourceDigest, service.controller.hash(source), 'CURRENT_DEX_PRICES_SOURCE');
  assert.deepEqual(admission.limits, caps, 'CURRENT_DEX_PRICES_LIMITS');
  const deadline = Date.now() + limits.newWorkMs, sessions = [], transactions = new Set();
  let reason = null, expected = null, actualFee = 0n;
  const requestStop = () => { reason ??= 'OPERATOR_STOP'; };
  const checkSource = () => assert.deepEqual(service.pins(), source, 'CURRENT_DEX_PRICES_SOURCE');
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  // Request a graceful stop; the inner runner completes its active action first.
  const timer = setTimeout(() => { reason = 'TIME_BOUND'; process.emit('SIGINT'); }, limits.newWorkMs);
  try {
    for (let epoch = 0; epoch < epochs; epoch++) {
      if (Date.now() >= deadline) reason ??= 'TIME_BOUND';
      if (reason) break;
      checkSource();
      const sessionName = service.selectSession('new');
      const prepared = await service.main('--prepare', sessionName);
      try {
        checkSource();
        const payer = prepared.payer;
        assert(payer && /^0x[0-9a-f]{40}$/i.test(payer.address) &&
          payer.address.toLowerCase() === admission.identity.actors.owner.toLowerCase(), 'CURRENT_DEX_PRICES_PAYER');
        assert(/^\d+$/.test(payer.nonce) && /^\d+$/.test(payer.balanceWei), 'CURRENT_DEX_PRICES_PAYER');
        if (expected) {
          assert.equal(payer.nonce, expected.nonce, 'CURRENT_DEX_PRICES_NONCE');
          assert.equal(payer.balanceWei, expected.balanceWei, 'CURRENT_DEX_PRICES_EXACT_FEE');
        }
        const remaining = BigInt(epochs - epoch) * BigInt(caps.commitWei);
        assert(BigInt(payer.balanceWei) >= remaining + BigInt(caps.reserveWei), 'CURRENT_DEX_PRICES_RESERVE');
      } catch (error) {
        await service.main('--stop', sessionName);
        throw error;
      }
      if (Date.now() >= deadline) reason ??= 'TIME_BOUND';
      if (reason) { await service.main('--stop', sessionName); break; }

      const result = await service.main('--run', sessionName);
      assert(['SERVICE_COMPLETE', 'SERVICE_STOPPED'].includes(result?.status), 'CURRENT_DEX_PRICES_RUN_RESULT');
      let { state } = await service.main('--inspect', sessionName);
      assert(!state.pending, 'CURRENT_DEX_PRICES_PENDING');
      assert.equal(state.attempts, state.verified.length, 'CURRENT_DEX_PRICES_PROOF');
      if (result.status === 'SERVICE_STOPPED' || state.stopped) reason ??= 'OPERATOR_STOP';
      if (!state.stopped) {
        await service.main('--stop', sessionName);
        ({ state } = await service.main('--inspect', sessionName));
      }
      assert(state.stopped && !state.pending, 'CURRENT_DEX_PRICES_CLOSED');
      assert.equal(state.attempts, state.verified.length, 'CURRENT_DEX_PRICES_PROOF');
      assert(state.attempts <= caps.sends && (reason || state.attempts > 0), 'CURRENT_DEX_PRICES_PROOF');
      let spent = 0n;
      for (const row of state.verified) {
        assert(['refresh', 'record'].includes(row.kind), 'CURRENT_DEX_PRICES_PROOF');
        const gas = BigInt(row.gasUsed), maximum = BigInt(row.kind === 'record' ? caps.recordGas : caps.refreshGas);
        assert(gas > 0n && gas <= maximum, 'CURRENT_DEX_PRICES_GAS');
        assert(/^0x[0-9a-f]{64}$/i.test(row.transaction) && !transactions.has(row.transaction.toLowerCase()), 'CURRENT_DEX_PRICES_TRANSACTION');
        transactions.add(row.transaction.toLowerCase());
        spent += gas * BigInt(caps.feeWei);
      }
      actualFee += spent;
      assert(spent <= BigInt(caps.commitWei) && actualFee <= BigInt(limits.maximumCommittedWei), 'CURRENT_DEX_PRICES_BUDGET');
      expected = { nonce: String(BigInt(prepared.payer.nonce) + BigInt(state.verified.length)),
        balanceWei: String(BigInt(prepared.payer.balanceWei) - spent) };
      sessions.push({ sessionName, transactions: state.verified.length, actualFeeWei: String(spent) });
    }
    return { status: reason ? 'CURRENT_DEX_PRICES_WINDOW_STOPPED' : 'CURRENT_DEX_PRICES_WINDOW_COMPLETE',
      reason: reason ?? 'EPOCH_BOUND', sessions, transactions: transactions.size, actualFeeWei: String(actualFee), limits };
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', requestStop);
    process.removeListener('SIGTERM', requestStop);
  }
}

async function main(args) {
  if (!Array.isArray(args) || args.length !== 1 ||
      !['--check', '--start', '--once', '--reconcile', '--stop'].includes(args[0])) {
    throw new Error('CURRENT_DEX_PRICES_USAGE');
  }

  if (args[0] === '--check') return { ...await service.main('--check', 'service-session-7b67-4'),
    window: { ...WINDOW, maximumCommittedWei: String(BigInt(service.controller.LIMITS.commitWei) * BigInt(WINDOW.epochs)),
      reserveWei: service.controller.LIMITS.reserveWei } };

  if (args[0] === '--reconcile' || args[0] === '--stop') {
    const sessionName = service.selectSession(args[0] === '--reconcile' ? 'pending' : 'latest');
    return { ...(await service.main(args[0], sessionName)), sessionName };
  }

  return runWindow(args[0] === '--once');
}

module.exports = { main };
if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
  .catch(error => {
    const first = String(error?.message ?? '').split(/\r?\n/, 1)[0];
    const guard = /^(?:PRICE|SERVICE|CURRENT_DEX_PRICES)_[A-Z0-9_]+$/.test(first)
      ? first : 'CURRENT_DEX_PRICES_REJECTED';
    console.error(JSON.stringify({ status: 'CURRENT_DEX_PRICES_STOP', guard, noAutomaticRetry: true }));
    process.exitCode = 1;
  });
