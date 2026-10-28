import { Interface, keccak256 } from '@coti-io/coti-ethers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCurrentCheapDexSubmissionAdapter, currentCheapDexGasCaps, type CurrentTransport } from './currentDexSubmission';
import { resolveCurrentCheapDexCandidate, currentCheapDexQuoteProtocol, currentCheapDexStages, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CURRENT_CHEAP_DEX_QUOTE_ABI, CURRENT_SLIPPAGE_DEX_QUOTE_ABI, encodeCurrentDexQuoteRequest, type CurrentCheapDexProfile } from './currentDexOperation';
import { CURRENT_DEX_ACCEPT_ABI, CURRENT_SLIPPAGE_DEX_ACCEPT_ABI } from './currentDexQuoteReview';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY, CURRENT_DEX_OPERATION_LOOKUPS_KEY, readCurrentDexOperationLookups,
  blockCurrentDexOperationVerification, type CurrentDexPendingAttempt } from './currentDexPendingAttempt';
import { verifyCurrentDexCanonicalInclusion } from './currentDexCanonicalInclusion';
import { issueCurrentDexSubmissionCapability } from '../features/wallet/currentDexSubmissionCapability';

const wiring = vi.hoisted(() => ({ issue: vi.fn(), graph: vi.fn(), operation: vi.fn() }));
vi.mock('../features/wallet/ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: wiring.issue }));
vi.mock('./dexV2Chain', async original => ({ ...await original<typeof import('./dexV2Chain')>(), readCurrentSharedPoolDexGraph: wiring.graph, readCurrentDexOperation: wiring.operation }));
afterEach(() => vi.unstubAllGlobals());
type Tx = Parameters<NonNullable<CurrentTransport['verifyCanonicalInclusion']>>[0];
type Receipt = Parameters<NonNullable<CurrentTransport['verifyCanonicalInclusion']>>[1];
const owner = `0x${'22'.repeat(20)}`, txHash = `0x${'33'.repeat(32)}`, blockHash = `0x${'44'.repeat(32)}`, context = `0x${'55'.repeat(32)}`;
const wide = { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: `0x${'11'.repeat(65)}` }, small = { ciphertext: 1n, signature: wide.signature };
function fixture(profile: CurrentCheapDexProfile = 'fast-pool', phase: 'quote' | 'accept' | 'cancel' | 'recover' = 'quote', candidate: CurrentCheapDexCandidateKey = 'cheap-native', status = 1) {
  const c = resolveCurrentCheapDexCandidate(candidate), protocol = currentCheapDexQuoteProtocol(c), stages = currentCheapDexStages(c);
  const quote = new Interface(protocol ? CURRENT_SLIPPAGE_DEX_QUOTE_ABI : CURRENT_CHEAP_DEX_QUOTE_ABI), accept = new Interface(protocol ? CURRENT_SLIPPAGE_DEX_ACCEPT_ABI : CURRENT_DEX_ACCEPT_ABI);
  const actions = new Interface(['function cancelSwap(uint256)', 'function recoverSwap(uint256)']);
  const data = phase === 'quote' ? encodeCurrentDexQuoteRequest({ profile, quoteProtocol: protocol, toleranceBps: protocol ? 50 : undefined,
    inputToken: c.tokens[0][0], outputToken: c.tokens[1][0], destination: owner, deadline: 200n, maximumInput: wide, minimumInput: wide, minimumOutput: wide, minimumRateNumerator: small, minimumRateDenominator: small })
    : phase === 'accept' ? accept.encodeFunctionData(profile === 'fast-pool' ? protocol ? 'acceptFastPool' : 'acceptFastPoolV1' : 'acceptPrivateSwapV1', [7n, context]) : actions.encodeFunctionData(phase === 'cancel' ? 'cancelSwap' : 'recoverSwap', [7n]);
  const caps = currentCheapDexGasCaps(c), gasLimit = phase === 'quote' || phase === 'accept' ? caps[profile][phase] : caps['cheap-async'][phase];
  const tx: Tx = { hash: txHash, chainId: 7082400n, from: owner, to: c.core, value: 0n, data, nonce: 4, gasLimit, blockNumber: 10, blockHash };
  const event = phase === 'quote' && profile === 'fast-pool' ? quote.encodeEventLog(quote.getEvent('FastPoolQuoteIssued')!, [7n, context, 200n])
    : quote.encodeEventLog(quote.getEvent('CheapAsyncAdvanced')!, [7n, phase === 'quote' ? 1 : phase === 'accept' ? stages.funded : stages.released, phase === 'quote' ? `0x${'00'.repeat(32)}` : context]);
  const receipt: Receipt = { hash: txHash, status, from: owner, to: c.core, blockNumber: 10, blockHash,
    logs: status && !(phase === 'accept' && profile === 'fast-pool') ? [{ address: c.core, ...event }] : [] };
  const operation = { profile, phase: profile === 'fast-pool' ? phase === 'accept' ? 'consumed-unverified' : 'expired-unrecovered' : 'preparing',
    contextHash: profile === 'cheap-async' && phase === 'quote' ? `0x${'00'.repeat(32)}` : context, deadline: 200n,
    stage: phase === 'quote' ? 1 : phase === 'accept' ? stages.funded : stages.released, ready: false };
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  vi.stubGlobal('window', { sessionStorage: storage });
  const attempt: CurrentDexPendingAttempt = { version: 1, chainId: '7082400', owner, core: c.core, graph: `0x${c.graph}`, phase,
    callHash: keccak256(data), nonce: 4, txHash, ...(phase === 'cancel' || phase === 'recover' ? { operationId: '7' } : {}) };
  storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify(attempt));
  let active = true, canonicalHash = blockHash;
  const guard = vi.fn(async () => { if (!active) throw new Error('Session revoked'); });
  const rpc = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'eth_getBlockByNumber') return { number: '0xa', hash: canonicalHash, timestamp: '0x64', gasLimit: '0x7270e00', transactions: [tx.hash] };
    if (method === 'eth_getTransactionByHash') return { ...tx, input: tx.data, chainId: `0x${tx.chainId.toString(16)}`, value: `0x${tx.value.toString(16)}`,
      nonce: `0x${tx.nonce!.toString(16)}`, gas: `0x${tx.gasLimit!.toString(16)}`, blockNumber: '0xa', transactionIndex: '0x0' };
    if (method === 'eth_getTransactionReceipt') return { ...receipt, transactionHash: receipt.hash, status: `0x${receipt.status}`, blockNumber: '0xa', transactionIndex: '0x0' };
    throw new Error('Unexpected RPC');
  });
  const transport = { assertCurrent: guard, readHead: vi.fn(async () => ({ number: 10n, hash: blockHash, timestamp: 100n, gasLimit: 120_000_000n })),
    readNonce: vi.fn(async () => 4), readBlockHash: vi.fn(async () => canonicalHash), readTransaction: vi.fn(async (): Promise<Tx | null> => tx),
    waitForReceipt: vi.fn(async (): Promise<Receipt | null> => receipt), estimateGas: vi.fn(), send: vi.fn(),
    verifyCanonicalInclusion: vi.fn((transaction: Tx, observed: Receipt) => verifyCurrentDexCanonicalInclusion({ rpc, assertCurrent: guard }, transaction, observed)) };
  const readOperation = vi.fn(async () => ({ operation })), readReceipt = vi.fn(), reviewAcceptance = vi.fn(), requireFunding = vi.fn(), signer = {};
  const recreate = (ownerAddress = owner, selectedCandidate = candidate) => createCurrentCheapDexSubmissionAdapter({ candidate: selectedCandidate,
    signer: {}, ownerAddress, chainId: 7082400n, transport, attest: vi.fn(async () => {}),
    readOperation: readOperation as never, readReceipt, reviewAcceptance, requireFunding, now: () => 999n });
  const adapter = createCurrentCheapDexSubmissionAdapter({ candidate, signer, ownerAddress: owner, chainId: 7082400n, transport,
    attest: vi.fn(async () => {}), readOperation: readOperation as never, readReceipt, reviewAcceptance, requireFunding, now: () => 999n });
  const save = (patch: Partial<CurrentDexPendingAttempt>) => storage.setItem(CURRENT_DEX_PENDING_ATTEMPT_KEY, JSON.stringify({ ...attempt, ...patch }));
  const noSend = () => { expect(transport.send).not.toHaveBeenCalled(); expect(transport.estimateGas).not.toHaveBeenCalled(); expect(transport.readNonce).not.toHaveBeenCalled(); expect(readReceipt).not.toHaveBeenCalled(); expect(reviewAcceptance).not.toHaveBeenCalled(); expect(requireFunding).not.toHaveBeenCalled(); };
  return { c, tx, receipt, operation, attempt, values, storage, transport, rpc, readOperation, adapter, recreate, save, noSend,
    revoke: () => { active = false; }, reorg: () => { canonicalHash = context; } };
}
describe('native receipt-only pending recovery', () => {
  it.each([['fast-pool', 'quote'], ['cheap-async', 'quote']] as const)('reconciles exact b2aa %s %s without App-wallet or private authority', async (profile, phase) => {
    const f = fixture(profile, phase, 'cheap-exit');
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', phase,
      operationId: 7n, privateAccountingVerified: false, readyToSign: false });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(true);
    expect(f.values.has(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(false);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); f.noSend();
    f.noSend();
  });
  it.each([['fast-pool', 'accept'], ['cheap-async', 'accept'], ['cheap-async', 'cancel'], ['cheap-async', 'recover']] as const)('retains exact b2aa %s %s until owner private accounting is checked', async (profile, phase) => {
    const f = fixture(profile, phase, 'cheap-exit');
    const saved = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({
      status: 'manual-reconciliation-required', phase, transactionHash: txHash,
      reason: 'Owner private receipt and token checks are required; the saved action remains pending.',
      privateAccountingVerified: false, readyToSign: false
    });
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);
    expect(f.values.has(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(false);
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2);
    expect(f.readOperation).toHaveBeenCalledTimes(1);
    f.noSend();
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved);
    f.noSend();
  });
  it.each(['missing-index', 'cap', 'reorg', 'blocked'] as const)('retains b2aa recovery metadata on %s', async fault => {
    const f = fixture('cheap-async', 'recover', 'cheap-exit');
    if (fault === 'missing-index') f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('canonical index unavailable'));
    if (fault === 'cap') Object.assign(f.tx, { gasLimit: 25_000_000n });
    if (fault === 'reorg') f.reorg();
    if (fault === 'blocked') {
      f.save({ verificationBlocked: true });
      await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required' });
    } else await expect(f.adapter.recoverPendingCurrentCheapAttempt()).rejects.toThrow();
    expect(f.values.size).toBe(1); f.noSend();
  });
  it.each([['fast-pool', 'quote'], ['cheap-async', 'quote'], ['fast-pool', 'accept'], ['cheap-async', 'accept'], ['cheap-async', 'cancel'], ['cheap-async', 'recover']] as const)('reconciles d06 %s %s metadata while the real App hold stays active', async (profile, phase) => {
    const f = fixture(profile, phase, 'cheap-d06');
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', phase, operationId: 7n,
      privateAccountingVerified: false, readyToSign: false });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.values.has(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(profile === 'cheap-async' && phase === 'accept');
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); f.noSend();
  });
  it.each(['missing-index', 'cap', 'reorg', 'blocked'] as const)('retains d06 recovery record on %s', async fault => {
    const f = fixture('cheap-async', 'recover', 'cheap-d06');
    if (fault === 'missing-index') f.transport.verifyCanonicalInclusion.mockRejectedValue(new Error('canonical index unavailable'));
    if (fault === 'cap') Object.assign(f.tx, { gasLimit: 25_000_000n });
    if (fault === 'reorg') f.reorg();
    if (fault === 'blocked') { f.save({ verificationBlocked: true }); await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required' }); }
    else await expect(f.adapter.recoverPendingCurrentCheapAttempt()).rejects.toThrow();
    expect(f.values.size).toBe(1); f.noSend();
  });
  it.each([['fast-pool', 'quote'], ['cheap-async', 'quote'], ['fast-pool', 'accept'], ['cheap-async', 'accept'], ['cheap-async', 'cancel']] as const)('recovers exact %s %s metadata despite expired new-send head', async (profile, phase) => {
    const f = fixture(profile, phase); await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', phase, operationId: 7n, privateAccountingVerified: false, readyToSign: false });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(f.values.has(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(profile === 'cheap-async' && phase === 'accept');
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); f.noSend();
    await expect(f.adapter.checkCurrentCheapCandidate()).rejects.toThrow('block, gas headroom or deadline');
  });
  it.each(['quote', 'accept', 'cancel'] as const)('reconciles terminal status0 %s only with empty events and repeated full inclusion', async phase => {
    const f = fixture(phase === 'cancel' ? 'cheap-async' : 'fast-pool', phase, 'cheap-native', 0);
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-reverted', privateAccountingVerified: false, readyToSign: false });
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); expect(f.readOperation).not.toHaveBeenCalled(); expect(f.values.size).toBe(0); f.noSend();
  });
  it.each(['cheap-two-pool', 'cheap-reference'] as const)('keeps other staged %s recovery held', async candidate => {
    const f = fixture('fast-pool', 'quote', candidate); await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required' }); expect(f.values.size).toBe(1); f.noSend();
  });
  it('reconciles accepted native funded recovery without send permission', async () => {
    const f = fixture('cheap-async', 'recover'); await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', privateAccountingVerified:false, readyToSign:false }); expect(f.values.size).toBe(0); expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); f.noSend();
  });
  it.each(['quote', 'accept', 'cancel', 'recover'] as const)('retains exact archived %s cap/protocol recovery without new inclusion requirement', async phase => {
    const f = fixture(phase === 'quote' || phase === 'accept' ? 'fast-pool' : 'cheap-async', phase, 'cheap-archived');
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined' }); expect(f.transport.verifyCanonicalInclusion).not.toHaveBeenCalled(); expect(f.values.size).toBe(0); f.noSend();
  });
  it.each(['chainId', 'from', 'to', 'nonce', 'data', 'value', 'gasLimit', 'hash'] as const)('retains native record on wrong transaction %s', async field => {
    const f = fixture(); const changed = { ...f.tx, [field]: ['from', 'to'].includes(field) ? owner : field === 'data' ? '0x1234' : field === 'hash' ? context : field === 'nonce' ? 9 : 1n };
    if (field === 'from') changed.from = f.c.core;
    f.transport.readTransaction.mockResolvedValue(changed); const saved = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY);
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).rejects.toThrow(); expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved); f.noSend();
  });
  it.each(['scope', 'private-block', 'private-block-status0', 'hashless', 'missing-receipt', 'bad-hash', 'missing-inclusion', 'events-status0', 'lease', 'terminal-status'] as const)('retains pending lock on %s', async fault => {
    const f = fixture();
    if (fault === 'scope') f.save({ core: owner });
    if (fault.startsWith('private-block')) { f.save({ verificationBlocked: true }); if (fault.endsWith('status0')) Object.assign(f.receipt, { status: 0, logs: [] }); }
    if (fault === 'hashless') f.save({ txHash: null });
    if (fault === 'missing-receipt') f.transport.waitForReceipt.mockResolvedValue(null);
    if (fault === 'missing-inclusion') Object.assign(f.transport, { verifyCanonicalInclusion: undefined });
    if (fault === 'events-status0') Object.assign(f.receipt, { status: 0 });
    if (fault === 'lease') f.revoke();
    if (fault === 'terminal-status') Object.assign(f.receipt, { status: null });
    const saved = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY), result = f.adapter.recoverPendingCurrentCheapAttempt(fault === 'bad-hash' ? 'invalid' : undefined);
    if (fault.startsWith('private-block') || fault === 'hashless') await expect(result).resolves.toMatchObject({ status: 'manual-reconciliation-required' });
    else if (fault === 'missing-receipt') await expect(result).resolves.toMatchObject({ status: 'awaiting-chain-confirmation' }); else await expect(result).rejects.toThrow();
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved); f.noSend();
  });
  it('recovers a known hash from hashless metadata without issuing private authority', async () => {
    const f = fixture(); f.save({ txHash: null }); await expect(f.adapter.recoverPendingCurrentCheapAttempt(txHash)).resolves.toMatchObject({ status: 'observed-mined', privateAccountingVerified: false }); expect(f.values.size).toBe(0); f.noSend();
  });
  it('reconciles an explicit repriced native hash only for the exact saved nonce/calldata/cap', async () => {
    const f = fixture('fast-pool', 'accept'), knownHash = `0x${'aa'.repeat(32)}`;
    Object.assign(f.tx, { hash: knownHash }); Object.assign(f.receipt, { hash: knownHash });
    await expect(f.adapter.recoverPendingCurrentCheapAttempt(knownHash)).resolves.toMatchObject({ status: 'observed-mined', transactionHash: knownHash, privateAccountingVerified: false });
    expect(f.values.size).toBe(0); f.noSend();
  });
  it('allows receipt-only recovery with no transaction-fit or fresh-send resource permission', async () => {
    const f = fixture(); f.transport.readHead.mockResolvedValue({ number: 10n, hash: blockHash, timestamp: 0n, gasLimit: 0n });
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', privateAccountingVerified: false, readyToSign: false }); f.noSend();
  });
  it('does not clear status0 when its receipt changes during repeated canonical verification', async () => {
    const f = fixture('fast-pool', 'quote', 'cheap-native', 0); let reads = 0;
    f.transport.waitForReceipt.mockImplementation(async () => ++reads === 3 ? { ...f.receipt, status: 1 } : f.receipt);
    const saved = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY); await expect(f.adapter.recoverPendingCurrentCheapAttempt()).rejects.toThrow();
    expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved); f.noSend();
  });
  it.each(['status-and-logs', 'logs', 'block'] as const)('uses canonical status1 snapshot when the first receipt mutates %s during recheck', async mutation => {
    const f = fixture(), canonicalReceipt = structuredClone(f.receipt), rawRead = f.rpc.getMockImplementation()!;
    let receiptReads = 0;
    f.transport.waitForReceipt.mockImplementation(async () => ++receiptReads === 1 ? f.receipt : structuredClone(canonicalReceipt));
    f.rpc.mockImplementation(async method => method === 'eth_getTransactionReceipt'
      ? { ...canonicalReceipt, transactionHash: canonicalReceipt.hash, status: '0x1', blockNumber: '0xa', transactionIndex: '0x0' }
      : rawRead(method));
    const verify = f.transport.verifyCanonicalInclusion.getMockImplementation()!;
    f.transport.verifyCanonicalInclusion.mockImplementation(async (transaction, observed) => {
      await verify(transaction, observed);
      if (mutation === 'status-and-logs') Object.assign(f.receipt, { status: 0, logs: [] });
      if (mutation === 'logs') (f.receipt.logs as unknown[]).splice(0);
      if (mutation === 'block') Object.assign(f.receipt, { blockNumber: 11, blockHash: context });
    });
    await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined',
      operationId: 7n, privateAccountingVerified: false, readyToSign: false });
    expect(f.readOperation).toHaveBeenCalledWith('fast-pool', 7n, { number: 10n, hash: blockHash });
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(2); expect(f.values.size).toBe(0); f.noSend();
  });
  it.each(['reorg', 'status', 'logs', 'gas'] as const)('keeps record when %s changes after public operation read', async fault => {
    const f = fixture(); f.readOperation.mockImplementationOnce(async () => { if (fault === 'reorg') f.reorg(); if (fault === 'status') Object.assign(f.receipt, { status: 0 }); if (fault === 'logs') Object.assign(f.receipt, { logs: [] }); if (fault === 'gas') Object.assign(f.tx, { gasLimit: 1n }); return { operation: f.operation }; });
    const saved = f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY); await expect(f.adapter.recoverPendingCurrentCheapAttempt()).rejects.toThrow(); expect(f.values.get(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(saved); f.noSend();
  });
  it('uses actual wallet issuer and raw canonical helper for native metadata recovery without signing', async () => {
    const f = fixture('cheap-async', 'accept'), signer = { sendTransaction: vi.fn(), estimateGas: vi.fn(), getNonce: vi.fn() };
    wiring.issue.mockImplementation(async args => args.bindCapability({ assertCurrent: f.transport.assertCurrent, assertSnapshotCurrent: vi.fn(), chainId: 7082400n, ownerAddress: owner,
      signer, readProvider: { send: f.rpc, getTransaction: f.transport.readTransaction, getTransactionReceipt: f.transport.waitForReceipt } }));
    wiring.graph.mockResolvedValue({ graph: f.c.graph, packageSha256: f.c.packageSha256, core: f.c.core }); wiring.operation.mockResolvedValue({ operation: f.operation });
    const capability = await issueCurrentDexSubmissionCapability({ admission: null, candidate: 'cheap-native' } as never);
    await expect(capability.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined', privateAccountingVerified: false, readyToSign: false });
    expect(f.values.has(CURRENT_DEX_PENDING_ATTEMPT_KEY)).toBe(false);
    expect(readCurrentDexOperationLookups(f.storage)).toHaveLength(1);
    expect(signer.sendTransaction).not.toHaveBeenCalled(); expect(signer.estimateGas).not.toHaveBeenCalled(); expect(signer.getNonce).not.toHaveBeenCalled();
  });
  it('retains async public lookup across repeated checks and terminal stages without private authority', async () => {
    const f = fixture('cheap-async', 'accept', 'cheap-d06');
    await f.adapter.recoverPendingCurrentCheapAttempt();
    const saved = f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    for (const [stage, phase] of [[6, 'settling'], [7, 'settled'], [8, 'released']] as const) {
      Object.assign(f.operation, { stage, phase });
      await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'observed-mined',
        operationId: 7n, operation: { stage, phase }, readyToSign: false, privateAccountingVerified: false });
      expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(saved);
    }
    expect(f.transport.verifyCanonicalInclusion).toHaveBeenCalledTimes(8); f.noSend();
  });
  it('does not bind an old funded operation to another owner or candidate after reload', async () => {
    const f = fixture('cheap-async', 'accept', 'cheap-d06');
    await f.adapter.recoverPendingCurrentCheapAttempt();
    const saved = f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    await expect(f.recreate(f.c.core).recoverPendingCurrentCheapAttempt()).resolves.toBeNull();
    await expect(f.recreate(owner, 'cheap-native').recoverPendingCurrentCheapAttempt()).resolves.toBeNull();
    await expect(f.recreate().recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ operationId: 7n, privateAccountingVerified: false });
    expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(saved); f.noSend();
  });
  it.each(['origin', 'deadline', 'context', 'blocked', 'pending'] as const)('retains original async lookup on %s', async fault => {
    const f = fixture('cheap-async', 'accept', 'cheap-d06');
    await f.adapter.recoverPendingCurrentCheapAttempt();
    if (fault === 'origin') { Object.assign(f.tx, { blockNumber: 11 }); Object.assign(f.receipt, { blockNumber: 11 }); }
    if (fault === 'deadline') Object.assign(f.operation, { deadline: 201n });
    if (fault === 'context') Object.assign(f.operation, { contextHash: blockHash });
    if (fault === 'blocked') blockCurrentDexOperationVerification(f.storage, readCurrentDexOperationLookups(f.storage)[0]);
    if (fault === 'pending') f.transport.waitForReceipt.mockResolvedValue(null);
    const saved = f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY);
    if (fault === 'blocked') await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'manual-reconciliation-required', transactionHash: txHash, verificationBlocked: true });
    else if (fault === 'pending') await expect(f.adapter.recoverPendingCurrentCheapAttempt()).resolves.toMatchObject({ status: 'awaiting-chain-confirmation', transactionHash: txHash });
    else await expect(f.adapter.recoverPendingCurrentCheapAttempt()).rejects.toThrow();
    expect(f.values.get(CURRENT_DEX_OPERATION_LOOKUPS_KEY)).toBe(saved); f.noSend();
  });
});
