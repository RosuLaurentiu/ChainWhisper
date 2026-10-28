import { AbiCoder, Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import { describe, expect, it, vi } from 'vitest';
import { issueCurrentDexPoolFundingCapability, assertCurrentPoolFundingPrepared } from './currentDexPoolFundingCapability';
import { ARCHIVED_CHEAP_DEX_CANDIDATE, ARCHIVED_CHEAP_DEX_CANDIDATE as candidate, resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
const ARCHIVED_CHEAP_POOL_TOKENS=[...candidate.tokens].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1);
// These source-fit tests isolate authentic input/preview brands. Actual storage,
// event and provenance checks use the unmocked reader in its companion tests.
vi.mock('../../lib/currentDexNativePoolSnapshotReader',()=>({createCurrentOwnerPoolSnapshotReader:()=>({
  wallets:async()=>[{balance:1000n*10n**18n,allowance:0n},{balance:1000n*10n**18n,allowance:0n}],
  state:async()=>structuredClone(m.nativeState)
})}));
import { CURRENT_POOL_FUNDING_ABI, PREPARED_POOL_FUNDING_ABI } from '../../lib/currentDexPoolFunding';
import { assertCurrentNativePoolProfile, issueCurrentNativePoolSourceFit, assertCurrentNativePoolSourceFit,
  CURRENT_NATIVE_POOL_PROFILE, CURRENT_NATIVE_POOL_SOURCE } from '../../lib/currentDexNativePoolPolicy';
import { createCurrentAttemptBoundary } from '../../lib/currentDexSubmission';
import { createCurrentTokenFundingAdapter,currentTokenFundingAbi } from '../../lib/currentDexTokenFunding';
import { admitCurrentNativePoolPreview,currentNativePoolSession } from '../../lib/currentDexNativePoolPolicy';
import { CURRENT_DEX_PENDING_ATTEMPT_KEY } from '../../lib/currentDexPendingAttempt';
import { currentNativeSigningBudget } from '../../lib/currentDexNativeSwapPolicy';
import { CurrentPoolProofMismatch, isKnownCurrentPoolProofMismatch } from '../../lib/currentDexPoolProofError';
import type { PreparedPoolStoredState } from '../../lib/currentDexPreparedPoolSnapshot';
vi.mock('../../lib/currentDexPreparedPoolSnapshot', async original => ({
  ...await original<typeof import('../../lib/currentDexPreparedPoolSnapshot')>(),
  // Isolated capability integration. Keep the real financial transition checker;
  // RPC/storage/canonical producer proof remains in the 35 reader tests.
  createPreparedOwnerPoolSnapshotReader: (...args: unknown[]) => m.preparedFactory(...args)
}));

const m = vi.hoisted(() => ({ issue: vi.fn(), graph: vi.fn(), registry: vi.fn(), small: vi.fn(), wide: vi.fn(), decrypt: vi.fn(), resign: vi.fn(), nativeState:{} as Record<string,unknown>,
  preparedFactory: vi.fn(), preparedReadState: vi.fn(), preparedReadWallets: vi.fn(), preparedIssue: vi.fn(), preparedState: {} as Record<string, unknown>,
  preparedWallets: [] as { token: string; balance: bigint; allowance: bigint }[] }));
vi.mock('./ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: m.issue }));
vi.mock('../../lib/dexV2Chain', async original => ({ ...await original<typeof import('../../lib/dexV2Chain')>(), readCurrentSharedPoolDexGraph: m.graph, readPreparedDexMarketRegistry: m.registry }));
vi.mock('../../lib/privateUint256', () => ({ encryptPrivateUint128Input: m.small, encryptPrivateUint256Input: m.wide,
  decryptPrivateUint256Output: m.decrypt, resignPrivateInput: m.resign }));
const abi = new Interface(CURRENT_POOL_FUNDING_ABI), owner = `0x${'22'.repeat(20)}`, hash = toBeHex(33n, 32), context = toBeHex(44n, 32);
const signature = `0x${'11'.repeat(65)}`;
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer V)[] ? Mutable<V>[] : T[K] extends object ? Mutable<T[K]> : T[K] };
describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s owner Pool top-up preparation', candidateKey => {
  const c = resolvePreparedDexScope(candidateKey).candidate;
  it.each(c.pairs.map((_, i) => i))('binds canonical pair %s, exact inputs and genuine approval brand', async index => {
    const f = await topUpFixture(index, candidateKey), { prepared, preview, funding } = await f.prepare();
    expect(preview).toMatchObject({ positionId: 43n, ownerContext: context });
    assertCurrentPoolFundingPrepared(prepared, f.signer); assertCurrentPoolFundingPrepared(funding, f.signer);
    expect(() => assertCurrentPoolFundingPrepared({ ...funding }, f.signer)).toThrow('not prepared');
    expect(m.wide.mock.calls.map(call => call[1])).toEqual([10n, 20n]);
    expect(m.small.mock.calls.map(call => call[1])).toEqual([1n, 200n]);
    const selector = new Interface(PREPARED_POOL_FUNDING_ABI).getFunction('managePoolPosition')!.selector;
    expect(m.resign.mock.calls.every(call => call[3] === selector)).toBe(true);
    const decoded = new Interface(PREPARED_POOL_FUNDING_ABI).decodeFunctionData('managePoolPosition', funding.data);
    expect([...decoded].slice(0, 3)).toEqual([43n, context, 0n]);
    const expectedSlot = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [43n, 18n]));
    expect(f.provider.send).toHaveBeenCalledWith('eth_getStorageAt', [c.core, expectedSlot,
      { blockHash: hash, requireCanonical: true }]);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('reads full state once per top-up current check and rejects protected-state drift', async () => {
    const f = await topUpFixture(0, candidateKey), prepared = (await f.cap.preparePoolTopUp(f.request))!;
    f.current.mockClear(); f.readState.mockClear(); f.readWallets.mockClear();
    await prepared.assertCurrent();
    expect(f.current).toHaveBeenCalledOnce(); expect(f.readState).toHaveBeenCalledOnce(); expect(f.readWallets).toHaveBeenCalledOnce();
    f.before.core[8] = toBeHex(1n, 32);
    await expect(prepared.assertCurrent()).rejects.toThrow('stale');
    expect(f.current).toHaveBeenCalledTimes(2); expect(f.readState).toHaveBeenCalledTimes(2); expect(f.readWallets).toHaveBeenCalledOnce();
  });
  it.each(['candidate', 'pair', 'context', 'producer', 'inactive', 'budget', 'tolerance', 'confirmation'] as const)('rejects invalid top-up %s before encryption', async fault => {
    const f = await topUpFixture(0, candidateKey);
    if (fault === 'candidate') f.request.graph.expectedGraph = 'wrong';
    if (fault === 'pair') f.request.pair = c.pairs[1].tokens;
    if (fault === 'context') f.request.ownerContext = toBeHex(9n, 32);
    if (fault === 'producer') f.canonical.mockResolvedValue(null as never);
    if (fault === 'inactive') f.producer.status = 2n;
    if (fault === 'budget') f.request.intent = { ...f.request.intent, budgets: [0n, 20n] } as never;
    if (fault === 'tolerance') f.request.intent = { ...f.request.intent, tolerance: [201n, 200n] } as never;
    if (fault === 'confirmation') f.request.confirmPrivateInputs.mockResolvedValue(false);
    if (fault === 'confirmation') await expect(f.cap.preparePoolTopUp(f.request)).resolves.toBeNull();
    else await expect(f.cap.preparePoolTopUp(f.request)).rejects.toThrow();
    expect(m.small).not.toHaveBeenCalled(); expect(m.wide).not.toHaveBeenCalled();
  });
  it.each(['operation', 'owned-shares', 'event-id', 'canonical-call', 'stale', 'revoked'] as const)('rejects top-up preview %s', async fault => {
    const f = await topUpFixture(0, candidateKey), prepared = (await f.cap.preparePoolTopUp(f.request))!; f.previewProof(prepared.data);
    if (fault === 'operation') f.values[0] = 0n;
    if (fault === 'owned-shares') f.values[6] = 16n;
    if (fault === 'event-id') f.canonical.mockResolvedValue({ data: prepared.data, block: { number: 11n, hash }, logs: [
      { address: c.core, ...abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!, [44n, context,
        Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) }] });
    if (fault === 'canonical-call') f.canonical.mockResolvedValue({ data: '0x', block: { number: 11n, hash }, logs: [] });
    if (fault === 'stale') f.before.core[8] = toBeHex(1n, 32);
    if (fault === 'revoked') f.revoke();
    await expect(prepared.readPreview(hash)).rejects.toThrow(); expect(m.resign).not.toHaveBeenCalled();
  });
  it.each(['selected-allowance', 'other-allowance', 'balance', 'other-balance'] as const)('rejects changed top-up wallet %s before funding', async fault => {
    const f = await topUpFixture(0, candidateKey), { funding } = await f.prepare(); f.approve();
    const wallet = f.wallets.find(wallet => fault.startsWith('other') ? !f.pair.tokens.includes(wallet.token as never) : f.pair.tokens.includes(wallet.token as never))!;
    if (fault.includes('allowance')) wallet.allowance += 1n; else wallet.balance -= 1n;
    await expect(funding.assertBeforeFunding()).rejects.toThrow('wallet');
  });
  it('stops an unfunded top-up and permits only known allowance cleanup', async () => {
    const f = await topUpFixture(0, candidateKey), { funding } = await f.prepare(); f.approve();
    await expect(funding.abandonUnfunded(async () => true)).resolves.toMatchObject({ status: 'unfunded-cleanup-required', cleanupRequired: [true, true] });
    await expect(funding.assertBeforeFunding()).rejects.toThrow('stopped');
    await expect(funding.assertApprovalCurrent()).rejects.toThrow('stopped');
    f.wallets.forEach(wallet => { if (f.pair.tokens.includes(wallet.token as never)) wallet.allowance = 0n; });
    await expect(funding.assertUnfundedCleanupCurrent()).resolves.toBeUndefined();
  });
  it.each(c.pairs.map((_, i) => i))('checks full manage state for pair %s and retains separate snapshot acceptance', async index => {
    const f = await topUpFixture(index, candidateKey), { funding } = await f.prepare(); f.approve(); await funding.assertBeforeFunding(); f.mineManage(funding.data);
    const result = (await funding.readFunding(hash))!;
    expect(result).toMatchObject({ positionId: 43n, privateAccountingVerified: false, status: 'manage-verified-snapshot-required' });
    expect(f.issue.mock.calls.some(call => call[1] === 'top-up')).toBe(false);
    f.snapshotNow();
    await expect(result.verifySnapshot(toBeHex(99n, 32))).resolves.toMatchObject({ privateAccountingVerified: true, status: 'owner-action-verified' });
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['state', 'companion', 'debit', 'other-wallet', 'unadmitted'] as const)('rejects top-up manage %s', async fault => {
    const f = await topUpFixture(0, candidateKey), { funding } = await f.prepare(); f.approve();
    if (fault !== 'unadmitted') await funding.assertBeforeFunding();
    f.mineManage(funding.data);
    if (fault === 'state') f.managed.core[9] = toBeHex(1n, 32);
    if (fault === 'companion') f.managed.market.companions[0].runtimeHash = toBeHex(1n, 32);
    if (fault === 'debit') m.decrypt.mockReturnValue(1n);
    if (fault === 'other-wallet') f.wallets.find(wallet => !f.pair.tokens.includes(wallet.token as never))!.balance -= 1n;
    await expect(funding.readFunding(hash)).rejects.toThrow();
  });
  it('rejects a snapshot with unproved private shares', async () => {
    const f = await topUpFixture(0, candidateKey), { funding } = await f.prepare(); f.approve(); await funding.assertBeforeFunding(); f.mineManage(funding.data);
    const result = (await funding.readFunding(hash))!; f.snapshotNow();
    const issue = f.issue.getMockImplementation()!;
    f.issue.mockImplementationOnce(async (id, kind, transactionHash) => ({ ...await issue(id, kind, transactionHash),
      amounts: { ...f.producer.amounts, shares: 16n }, block: f.snapshot.block }));
    await expect(result.verifySnapshot(toBeHex(99n, 32))).rejects.toThrow('snapshot accounting');
  });
  it('keeps canonical preview recovery available after management changes financial state', async () => {
    const f = await topUpFixture(0, candidateKey), { funding } = await f.prepare(), previewProof = await f.canonical(hash);
    f.approve(); await funding.assertBeforeFunding(); f.mineManage(funding.data);
    const managementProof = await f.canonical(hash), managementHash = toBeHex(88n, 32);
    f.canonical.mockImplementation(async value => value === hash ? previewProof : managementProof);
    await expect(funding.assertCurrent()).resolves.toBeUndefined();
    await expect(funding.assertBeforeFunding()).rejects.toThrow('stale');
    await expect(funding.readFunding(managementHash)).resolves.toMatchObject({ privateAccountingVerified: false });
  });
  it('rejects a preview block change after decryption', async () => {
    const f = await topUpFixture(0, candidateKey), prepared = (await f.cap.preparePoolTopUp(f.request))!; f.previewProof(prepared.data);
    const proof = await f.canonical(hash);
    f.canonical.mockResolvedValueOnce(proof).mockResolvedValueOnce({ ...proof, block: { ...proof.block, hash: toBeHex(999n, 32) } });
    await expect(prepared.readPreview(hash)).rejects.toThrow('changed after decryption');
  });
  it.each([4, 5, 6])('requires same-block snapshot index %s to follow management index 5', async index => {
    const f = await topUpFixture(0, candidateKey), { funding } = await f.prepare(); f.approve(); await funding.assertBeforeFunding(); f.mineManage(funding.data);
    const result = (await funding.readFunding(hash))!;
    f.snapshot.block = { number: 11n, hash }; f.snapshotNow();
    f.provider.getTransactionReceipt.mockImplementation(async value => ({ hash: value, blockHash: hash, index: value === hash ? 5 : index }));
    if (index > 5) await expect(result.verifySnapshot(toBeHex(99n, 32))).resolves.toMatchObject({ privateAccountingVerified: true });
    else await expect(result.verifySnapshot(toBeHex(99n, 32))).rejects.toThrow('follow management');
  });
  it('rejects a snapshot block change after financial checks', async () => {
    const f = await topUpFixture(0, candidateKey), { funding } = await f.prepare(); f.approve(); await funding.assertBeforeFunding(); f.mineManage(funding.data);
    const result = (await funding.readFunding(hash))!; f.snapshotNow();
    const implementation = f.canonical.getMockImplementation()!; let snapshotReads = 0;
    f.canonical.mockImplementation(async value => { const proof = await implementation(value);
      return value === toBeHex(99n, 32) && ++snapshotReads > 1 ? { ...proof, block: { ...proof.block, hash: toBeHex(999n, 32) } } : proof; });
    await expect(result.verifySnapshot(toBeHex(99n, 32))).rejects.toThrow('snapshot receipt changed');
  });
});
async function topUpFixture(pairIndex = 0, candidateKey: 'cheap-prepared' | 'cheap-exit' | 'cheap-history' = 'cheap-prepared') {
  const f = await fixture(candidateKey), c = resolvePreparedDexScope(candidateKey).candidate, pair = c.pairs[pairIndex];
  const w = (value: bigint | number) => toBeHex(value, 32), empty = (n: number) => Array.from({ length: n }, () => w(0));
  const before: Mutable<PreparedPoolStoredState> = { graph: c.graph, marketId: pair.marketId, positionId: 43n, block: { number: 10n, hash },
    market: { marketId: pair.marketId, canonicalId: BigInt(pair.canonicalId), registryRevision: 7n, marketRevision: 1n, enabled: true,
      token0: pair.tokens[0], token1: pair.tokens[1], engine: pair.engine, poolTerms: pair.poolTerms,
      companions: pair.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash })) },
    claim: empty(64), anchors: [], core: empty(149), markets: {}, claims: {}, c1: {}, ledgers: {}, escrows: {}, custody: {},
    nftOwners: {}, nftMinted: {}, ownerNftBalance: 1n, engines: {}, directories: {}, fixedSources: {}, counter: 43n, operation: 7n };
  before.core[11] = w(43); before.core[12] = w(7);
  c.pairs.forEach((p, k) => {
    const raw = empty(71); raw[0] = c.releaseId; raw[1] = p.marketId; raw[2] = w(BigInt(p.tokens[0])); raw[3] = w(BigInt(p.tokens[1]));
    before.markets[p.marketId] = raw; before.engines[p.marketId] = empty(46); before.c1[p.marketId] = empty(49); before.directories[p.marketId] = [];
    for (let i = 0; i < 7; i++) {
      const id = String(k * 7 + i + 1), a = empty(64); a[0] = w(1); a[4] = w(2); a[62] = w(i);
      raw[18 + i] = w(BigInt(id)); before.claims[id] = { marketId: p.marketId, words: a }; before.nftOwners[id] = w(0); before.nftMinted[id] = w(0);
      if (k === pairIndex) before.anchors.push(a);
    }
  });
  const claim = before.claim; claim[0] = w(1); claim[4] = w(3); claim[5] = w(1); claim[6] = w(1); claim[7] = w(1); claim[59] = w(1); claim[13] = context;
  before.claims['43'] = { marketId: pair.marketId, words: claim }; before.nftOwners['43'] = w(BigInt(owner)); before.nftMinted['43'] = w(1);
  c.tokens.forEach(([token]) => { before.ledgers[token] = empty(12); before.escrows[token] = empty(2); before.custody[token] = empty(4); });
  const wallets = c.tokens.map(([token]) => ({ token, balance: 100n, allowance: pair.tokens.includes(token as never) ? 0n : 7n }));
  const beforeAmounts = { amount0: 20n, amount1: 40n, shares: 10n, totalShares: 100n, classId: 0n };
  const managed = structuredClone(before); managed.block = { number: 11n, hash }; managed.claim[4] = w(4); managed.claim[13] = w(78);
  managed.claim[60] = w(101); managed.claim[61] = w(102);
  managed.anchors.forEach(a => { a[4] = w(3); [8, 9, 10, 11].forEach((i, j) => { a[i] = w(100 + j); a[[14, 15, 18, 19][j]] = a[i]; }); });
  for (const i of [11, 12, 13, 14, ...Array.from({ length: 14 }, (_, j) => j + 25)]) managed.markets[pair.marketId][i] = w(1000 + i);
  for (let i = 14; i < 54; i++) managed.claim[i] = w(200 + i);
  for (const token of pair.tokens) { managed.ledgers[token][9] = w(501); managed.ledgers[token][10] = w(502); managed.custody[token] = [w(601), w(602), w(603), w(604)]; }
  const snapshot = structuredClone(managed); snapshot.block = { number: 12n, hash };
  for (let i = 14; i < 54; i++) snapshot.claim[i] = w(i + 300);
  const snapshotAmounts = { ...beforeAmounts, amount0: 30n, amount1: 60n, shares: 15n, totalShares: 105n };
  let state: PreparedPoolStoredState = before;
  const producer = { positionId: 43n, transactionHash: hash, status: 1n, context, amounts: beforeAmounts, block: before.block };
  const canonical = vi.fn(async (_transactionHash?: string) => ({ data: '0x', block: { number: 11n, hash }, logs: [] as { address: string; topics: string[]; data: string }[] }));
  const readState = vi.fn(async () => structuredClone(state)), readWallets = vi.fn(async () => structuredClone(wallets));
  const financial = (value: PreparedPoolStoredState) => JSON.stringify({ ...value, block: null }, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  let retained = structuredClone(state);
  const current = vi.fn(async (value: typeof producer) => {
    if (financial(await readState()) !== financial(retained)) throw new CurrentPoolProofMismatch('Prepared Pool producer is stale; sign a new snapshot.');
    return value;
  });
  const issue = vi.fn(async (_id, kind, transactionHash) => {
    retained = structuredClone(state);
    return { ...producer, kind, transactionHash,
      amounts: kind === 'snapshot' && state === snapshot ? snapshotAmounts : beforeAmounts, block: state.block };
  });
  m.preparedFactory.mockReturnValue({ state: readState, wallets: readWallets, canonical, current, issue });
  f.provider.send.mockImplementation(async (method: string) => method === 'eth_getStorageAt' ? pair.marketId :
    method === 'eth_getBlockByNumber' ? { number: '0xc', hash } : undefined);
  f.values.splice(0, 10, 1n, 10n, 20n, 0n, 0n, 5n, 15n, 1n, 200n, 0n);
  const request = { graph: f.request.graph, positionId: 43n, ownerContext: context, producerHash: hash, pair: pair.tokens,
    intent: { budgets: [10n, 20n] as const, tolerance: [1n, 200n] as const }, confirmPrivateInputs: vi.fn(async () => true) };
  const previewProof = (data: string) => canonical.mockResolvedValue({ data, block: { number: 11n, hash }, logs: [
    { address: c.core, ...abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!, [43n, context, Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) }] });
  const prepare = async () => { const prepared = (await f.cap.preparePoolTopUp(request))!; previewProof(prepared.data);
    const preview = (await prepared.readPreview(hash))!, funding = (await preview.prepareFunding(async () => true))!; return { prepared, preview, funding }; };
  const approve = () => { wallets.forEach(wallet => { const i = pair.tokens.findIndex(token => token === wallet.token); if (i >= 0) wallet.allowance = [10n, 20n][i]; }); };
  const mineManage = (data: string) => {
    state = managed; wallets.forEach(wallet => { const i = pair.tokens.findIndex(token => token === wallet.token); if (i >= 0) { wallet.balance -= [10n, 20n][i]; wallet.allowance = 0n; } });
    // Distinct decrypted owner-event test envelopes; preview uses fields 0..9.
    m.decrypt.mockImplementation((_, value) => value.ciphertextHigh >= 20n ? [10n, 20n][Number(value.ciphertextHigh - 20n)] : f.values[Number(value.ciphertextHigh)]);
    canonical.mockResolvedValue({ data, block: managed.block, logs: pair.tokens.map((token, i) => ({ address: token,
      ...tokenAbi.encodeEventLog(tokenAbi.getEvent('Transfer')!, [owner, c.core, [BigInt(20 + i), 99n], [99n, 88n]]) })) });
  };
  return { ...f, request, pair, before, managed, snapshot, wallets, producer, canonical, current, issue, readState, readWallets, previewProof, prepare, approve, mineManage,
    snapshotNow: () => { state = snapshot; const managementProof = canonical.getMockImplementation()!;
      canonical.mockImplementation(async (transactionHash?: string) => transactionHash === toBeHex(99n, 32) ? {
        data: new Interface(['function poolSnapshot(uint256 id)']).encodeFunctionData('poolSnapshot', [43n]), block: snapshot.block, logs: []
      } : managementProof()); }, changeState: (next: PreparedPoolStoredState) => { state = next; } };
}
const claimAbi = new Interface(['event SharedClaimCreated(uint256 indexed positionId)']);
const nftAbi = new Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const tokenAbi = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
async function fixture(candidateKey:CurrentCheapDexCandidateKey='cheap-archived') {
  const candidate=resolveCurrentCheapDexCandidate(candidateKey);
  vi.clearAllMocks();
  const words=(n:number)=>Array.from({length:n},()=>toBeHex(0n,32));
  m.nativeState={counter:19n,operation:9n,market:words(71),core:words(50),engine:words(46),anchors:Array.from({length:7},()=>words(64)),
    ledgers:[words(12),words(12)],escrows:[words(2),words(2)],claim:words(64),protectedClaim:words(64),protectedOwner:owner,protectedStatus:1n,existingClaims:{19:words(64)},limitDirectory:words(8)};
  let active = true;
  const guard = () => { if (!active) throw new Error('Session revoked'); };
  const signer = { sendTransaction: vi.fn() };
  const provider = { send: vi.fn(async(method:string)=>method==='eth_getBlockByNumber'?{number:'0xb',hash}:method==='eth_getStorageAt'?toBeHex(candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? 51n : 19n,32):undefined), getTransaction: vi.fn(), getTransactionReceipt: vi.fn() };
  m.preparedFactory.mockImplementation(({ marketId }: { marketId: string }) => {
    const c = resolvePreparedDexScope(candidateKey).candidate, pair = c.pairs.find(p => p.marketId === marketId)!;
    const market = { marketId, canonicalId: BigInt(pair.canonicalId), registryRevision: 7n, marketRevision: 1n, enabled: true,
      token0: pair.tokens[0], token1: pair.tokens[1], engine: pair.engine, poolTerms: pair.poolTerms,
      companions: pair.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash })) };
    const selected = words(71), anchors = Array.from({ length: 7 }, (_, i) => {
      const raw = words(64); raw[4] = toBeHex(1n, 32); selected[18 + i] = toBeHex(BigInt(i + 1), 32); return raw;
    });
    const claims = Object.fromEntries(anchors.map((raw, i) => [String(i + 1), { marketId, words: raw }]));
    claims['16'] = { marketId: c.pairs.find(p => p.marketId !== marketId)!.marketId, words: words(64) };
    const core = words(149); core[11] = toBeHex(51n, 32); core[12] = toBeHex(9n, 32);
    const tokenRecords = (length: number) => Object.fromEntries(c.tokens.map(([token]) => [token, words(length)]));
    m.preparedState = { graph: c.graph, marketId, positionId: 52n, block: { number: 11n, hash }, market, claim: words(64), anchors, core,
      markets: Object.fromEntries(c.pairs.map(p => [p.marketId, p.marketId === marketId ? selected : words(71)])), claims,
      c1: Object.fromEntries(c.pairs.map(p => [p.marketId, words(49)])), ledgers: tokenRecords(12), escrows: tokenRecords(2), custody: tokenRecords(4),
      nftOwners: { '16': toBeHex(BigInt(owner), 32), '52': toBeHex(0n, 32) }, nftMinted: { '16': toBeHex(1n, 32), '52': toBeHex(0n, 32) },
      ownerNftBalance: 7n, engines: Object.fromEntries(c.pairs.map(p => [p.marketId, words(46)])), directories: {},
      fixedSources: { '50': { marketId, sourceId: 43n, core: words(36), engine: words(39), terms: [words(5)], ownerState: words(58) },
        '51': { marketId, sourceId: 44n, core: words(36), engine: words(39), terms: [words(5)], ownerState: words(58) } }, counter: 51n, operation: 9n };
    m.preparedWallets = c.tokens.map(([token]) => ({ token, balance: 1000n, allowance: pair.tokens.some(t => t === token) ? 0n : 7n }));
    m.preparedReadState.mockImplementation(async () => structuredClone(m.preparedState));
    m.preparedReadWallets.mockImplementation(async () => structuredClone(m.preparedWallets));
    m.preparedIssue.mockImplementation(async () => ({ transactionHash: hash, amounts: { shares: 100n, classId: 1n } }));
    return { state: m.preparedReadState, wallets: m.preparedReadWallets, issue: m.preparedIssue };
  });
  m.issue.mockImplementation(async args => { expect(args.requirePrivacy).toBe(true); return args.bindCapability({ signer,
    readProvider: provider, ownerAddress: owner, chainId: BigInt(candidate.chainId), assertCurrent: async () => guard(), assertSnapshotCurrent: guard }); });
  m.graph.mockImplementation(async ({ blockNumber, blockHash }) => ({ graph: candidate.graph, packageSha256: candidate.packageSha256,
    chainId: BigInt(candidate.chainId), genesisHash: candidate.genesisHash, core: candidate.core, block: { number: blockNumber, hash: blockHash },
    operationReadIdentity: { runtimeHash: candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2], releaseId: candidate.releaseId } }));
  m.registry.mockImplementation(async ({ blockNumber, blockHash }) => ({ graph: candidate.graph, packageSha256: candidate.packageSha256,
    chainId: BigInt(candidate.chainId), core: candidate.core, releaseId: candidate.releaseId, block: { number: blockNumber, hash: blockHash },
    markets: candidateKey === 'cheap-prepared' || candidateKey === 'cheap-exit' || candidateKey === 'cheap-history' ? resolvePreparedDexScope(candidateKey).candidate.pairs.map(pair => ({ marketId: pair.marketId, canonicalId: BigInt(pair.canonicalId),
      registryRevision: 1n, marketRevision: 1n, enabled: true, token0: pair.tokens[0], token1: pair.tokens[1], engine: pair.engine, poolTerms: pair.poolTerms })) : [] }));
  m.small.mockImplementation(async (_, value) => ({ ciphertext: value + 1n, signature }));
  m.wide.mockImplementation(async (_, value) => ({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: value }, signature }));
  m.resign.mockImplementation(async (_, ciphertext) => ({ ciphertext, signature: `0x${'22'.repeat(65)}` }));
  const values = [0n, 100n, 50n, 20n, 0n, 100n, 100n, 0n, 1n, 1n];
  m.decrypt.mockImplementation((_, value) => values[Number(value.ciphertextHigh)]);
  const request = { graph: { expectedGraph: candidate.graph, expectedPackageSha256: candidate.packageSha256, blockNumber: 10n, blockHash: hash },
    pair: undefined as readonly [string, string] | undefined,
    intent: { classId: 1n, budgets: [120n, 50n] as readonly [bigint, bigint], terms: [1n, 2n, 1n, 0n, 1003n, 1000n, 667n, 669n, 0n, 1n] as const },
    confirmPrivateInputs: vi.fn(async () => true) };
  const cap = await issueCurrentDexPoolFundingCapability({candidate:candidateKey} as never);
  const mine = (data: string) => {
    const tx = { hash, chainId: BigInt(candidate.chainId), from: owner, to: candidate.core, value: 0n, data,
      nonce: 7, blockNumber: 11, blockHash: hash };
    const event = { address: candidate.core as string, ...abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!, [0n, context,
      Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]) };
    const receipt = { hash, from: owner, to: candidate.core, status: 1, blockNumber: 11, blockHash: hash,
      logs: [event] as { address: string; topics: string[]; data: string }[] };
    provider.getTransaction.mockResolvedValue(tx); provider.getTransactionReceipt.mockResolvedValue(receipt);
    return { tx, receipt, event };
  };
  return { cap, request, mine, signer, provider, values, revoke: () => { active = false; } };
}
describe('current owner Pool funding preparation', () => {
  it('binds budgets and unequal private debits to canonical Pool tokens, not app token order', async () => {
    expect(ARCHIVED_CHEAP_POOL_TOKENS.map(([address]) => address)).toEqual([
      '0x96d97450d36eb65804ce2f84d0fe6c9ef52f264a', '0xbbafdc398697154e1de68780eafb0c586371cff2'
    ]);
    const f = await fixture(), prepared = (await f.cap.preparePoolCreation(f.request))!;
    expect(m.wide.mock.calls.map(call => call[1])).toEqual([120n, 50n]);
    f.mine(prepared.data);
    const preview = (await prepared.readPreview(hash))!, funding = (await preview.prepareFunding(async () => true))!;
    const { receipt } = f.mine(funding.data);
    const nft = candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
    receipt.logs = [
      { address: candidate.core, ...claimAbi.encodeEventLog(claimAbi.getEvent('SharedClaimCreated')!, [8n]) },
      { address: nft, ...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!, ['0x0000000000000000000000000000000000000000', owner, 8n]) },
      ...candidate.tokens.map(([address], i) => ({ address,
        ...tokenAbi.encodeEventLog(tokenAbi.getEvent('Transfer')!, [owner, candidate.core, [BigInt(i + 1), 99n], [99n, 88n]]) }))
    ];
    // A receipt with app-order amounts must fail even when the total is correct.
    await expect(funding.readFunding(hash)).rejects.toThrow('debit');
  });
  it.each(['valid', 'missing', 'status', 'data', 'owner', 'block', 'reorg', 'claim', 'mint', 'mint-owner', 'mint-id',
    'debit0', 'debit1', 'debit-duplicate', 'debit-foreign', 'debit-encoding', 'revoked'])('checks %s canonical funding and exact private debits', async fault => {
    const f = await fixture(), prepared = (await f.cap.preparePoolCreation(f.request))!;
    f.mine(prepared.data);
    const preview = (await prepared.readPreview(hash))!, funding = (await preview.prepareFunding(async () => true))!;
    const { tx, receipt } = f.mine(funding.data);
    const nft = candidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
    const claim = { address: candidate.core as string, ...claimAbi.encodeEventLog(claimAbi.getEvent('SharedClaimCreated')!, [8n]) };
    const mint = { address: nft as string, ...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!, ['0x0000000000000000000000000000000000000000',
      fault === 'mint-owner' ? candidate.core : owner, fault === 'mint-id' ? 9n : 8n]) };
    const debits = ARCHIVED_CHEAP_POOL_TOKENS.map(([address], i) => ({ address: address as string,
      ...tokenAbi.encodeEventLog(tokenAbi.getEvent('Transfer')!, [owner, candidate.core, [BigInt(i + 1), 99n], [99n, 88n]]) }));
    receipt.logs = [claim, mint, ...debits];
    if (fault === 'missing') f.provider.getTransactionReceipt.mockResolvedValue(null);
    if (fault === 'status') receipt.status = 0;
    if (fault === 'data') tx.data += '00';
    if (fault === 'owner') tx.from = candidate.core;
    if (fault === 'block') tx.blockNumber = 12;
    if (fault === 'reorg') f.provider.send.mockResolvedValueOnce({ number: '0xb', hash: context });
    if (fault === 'claim') receipt.logs = receipt.logs.filter(log => log !== claim);
    if (fault === 'mint') receipt.logs = receipt.logs.filter(log => log !== mint);
    if (fault === 'debit0') f.values[1] = 101n;
    if (fault === 'debit1') f.values[2] = 51n;
    if (fault === 'debit-duplicate') receipt.logs.push(debits[0]);
    if (fault === 'debit-foreign') debits[0].address = owner;
    if (fault === 'debit-encoding') debits[0].data += '00';
    if (fault === 'revoked') f.revoke();
    if (fault === 'missing') await expect(funding.readFunding(hash)).resolves.toBeNull();
    else if (fault === 'valid') {
      await expect(funding.readFunding(hash)).resolves.toMatchObject({ positionId: 8n, amounts: { used0: 100n, used1: 50n }, readyToSign: false });
      // Read only the owner's event ciphertext, never Core's receiver ciphertext.
      expect(m.decrypt.mock.calls.slice(-2).map(call => call[1].ciphertextHigh)).toEqual([1n, 2n]);
    } else await expect(funding.readFunding(hash)).rejects.toThrow();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each([0n, 1n])('authenticates %s private preview, retains ciphertexts and re-signs funding only after review', async mode => {
    const f = await fixture(), prepared = (await f.cap.preparePoolCreation(f.request))!;
    f.values[0] = mode; if (mode === 1n) f.values[6] = 300n;
    f.mine(prepared.data);
    expect(() => assertCurrentPoolFundingPrepared(prepared, f.signer)).not.toThrow();
    expect(() => assertCurrentPoolFundingPrepared({ ...prepared }, f.signer)).toThrow('session');
    expect(() => assertCurrentPoolFundingPrepared(prepared, {})).toThrow('session');
    expect(m.small).toHaveBeenCalledTimes(11); expect(m.wide).toHaveBeenCalledTimes(2);
    const preview = (await prepared.readPreview(hash))!;
    expect(preview.amounts).toMatchObject({ operation: mode === 0n ? 'initialize' : 'add', used0: 100n, used1: 50n, unused0: 20n, unused1: 0n });
    expect(m.resign).not.toHaveBeenCalled();
    const confirm = vi.fn(async () => true), funding = (await preview.prepareFunding(confirm))!;
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ ...preview.amounts, principal: owner }));
    expect(m.resign).toHaveBeenCalledTimes(13);
    for (const call of m.resign.mock.calls) expect(call.slice(2)).toEqual([candidate.core, abi.getFunction('createPoolPosition')!.selector]);
    expect(abi.decodeFunctionData('createPoolPosition', funding.data)[0]).toBe(context);
    expect(funding.readyToSign).toBe(false); expect(funding).not.toHaveProperty('signer');
    expect(() => assertCurrentPoolFundingPrepared(funding, f.signer)).not.toThrow();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['graph', 'class', 'budget', 'terms', 'witness', 'spread', 'tolerance', 'decline', 'revoke'])('blocks %s before private prompts', async fault => {
    const f = await fixture();
    if (fault === 'graph') m.graph.mockRejectedValueOnce(new Error('Changed graph'));
    if (fault === 'class') f.request.intent.classId = 7n;
    if (fault === 'budget') f.request.intent.budgets = [0n, 50n];
    if (fault === 'terms') f.request.intent.terms = [...f.request.intent.terms.slice(0, 9), 1n << 128n] as never;
    if (fault === 'witness') f.request.intent.terms = [1n, 2n, 0n, 0n, ...f.request.intent.terms.slice(4)] as never;
    if (fault === 'spread') f.request.intent.classId = 2n;
    if (fault === 'tolerance') f.request.intent.terms = [...f.request.intent.terms.slice(0, 8), 2n, 1n] as never;
    f.request.confirmPrivateInputs.mockImplementation(async () => { if (fault === 'revoke') f.revoke(); return fault !== 'decline'; });
    if (fault === 'decline') await expect(f.cap.preparePoolCreation(f.request)).resolves.toBeNull();
    else await expect(f.cap.preparePoolCreation(f.request)).rejects.toThrow();
    expect(m.small).not.toHaveBeenCalled(); expect(m.wide).not.toHaveBeenCalled();
  });
  it.each(['missing', 'status', 'owner', 'chain', 'data', 'value', 'nonce', 'block', 'reorg', 'foreign', 'duplicate', 'budget', 'class', 'revoked'])('rejects %s preview provenance or amounts', async fault => {
    const f = await fixture(), prepared = (await f.cap.preparePoolCreation(f.request))!, { tx, receipt, event } = f.mine(prepared.data);
    if (fault === 'missing') f.provider.getTransactionReceipt.mockResolvedValue(null);
    if (fault === 'status') receipt.status = 0;
    if (fault === 'owner') tx.from = candidate.core;
    if (fault === 'chain') tx.chainId = 1n;
    if (fault === 'data') tx.data += '00';
    if (fault === 'value') tx.value = 1n;
    if (fault === 'nonce') tx.nonce = -1;
    if (fault === 'block') tx.blockNumber = 12;
    if (fault === 'reorg') m.graph.mockRejectedValueOnce(new Error('Block changed'));
    if (fault === 'foreign') event.address = owner;
    if (fault === 'duplicate') receipt.logs.push(event);
    if (fault === 'budget') f.values[3] = 21n;
    if (fault === 'class') f.values[9] = 2n;
    if (fault === 'revoked') f.revoke();
    if (fault === 'missing') await expect(prepared.readPreview(hash)).resolves.toBeNull();
    else await expect(prepared.readPreview(hash)).rejects.toThrow();
    expect(m.resign).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['decline', 'revoke', 'reorg', 'context', 'prompt-revoke'])('does not produce funding after %s', async fault => {
    const f = await fixture(), prepared = (await f.cap.preparePoolCreation(f.request))!;
    const mined = f.mine(prepared.data), preview = (await prepared.readPreview(hash))!;
    const confirm = async () => {
      if (fault === 'revoke') f.revoke();
      if (fault === 'reorg') f.provider.send.mockResolvedValueOnce({ number: '0xb', hash: context });
      if (fault === 'context') mined.event.data = abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!, [0n, toBeHex(99n, 32),
        Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]).data;
      if (fault === 'prompt-revoke') m.resign.mockImplementationOnce(async (_, ciphertext) => { f.revoke(); return { ciphertext, signature }; });
      return fault !== 'decline';
    };
    if (fault === 'decline') await expect(preview.prepareFunding(confirm)).resolves.toBeNull();
    else await expect(preview.prepareFunding(confirm)).rejects.toThrow();
    expect(m.resign).toHaveBeenCalledTimes(fault === 'prompt-revoke' ? 1 : 0);
  });
});


describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s prepared multi-market Pool funding preparation', candidateKey => {
  const preparedAbi = new Interface(PREPARED_POOL_FUNDING_ABI);
  it.each([0, 1, 2, 3, 4, 5])('binds market %i to exactly two canonical tokens and the prepared selectors', async index => {
    const f = await fixture(candidateKey), c = resolvePreparedDexScope(candidateKey).candidate;
    const pair = c.pairs[index]; f.request.pair = [pair.tokens[1], pair.tokens[0]];
    const p = (await f.cap.preparePoolCreation(f.request))!;
    expect(p).toMatchObject({ graph: c.graph, packageSha256: c.packageSha256, to: c.core, readyToSign: false });
    expect(m.preparedFactory).toHaveBeenCalledWith(expect.objectContaining({ candidate: c, marketId: pair.marketId, owner }));
    expect(p.intent).toMatchObject({ marketId: pair.marketId, poolTokens: pair.tokens });
    expect(f.request.confirmPrivateInputs).toHaveBeenCalledWith(expect.objectContaining({ marketId: pair.marketId, poolTokens: pair.tokens }));
    expect(preparedAbi.decodeFunctionData('previewPoolFunding', p.data).slice(0, 2)).toEqual([pair.marketId, 0n]);
    expect([...m.small.mock.calls, ...m.wide.mock.calls].every(call => call[2] === c.core &&
      call[3] === preparedAbi.getFunction('previewPoolFunding')!.selector)).toBe(true);
    f.mine(p.data); const result = (await p.readPreview(hash))!;
    const funding = (await result.prepareFunding(async () => true))!;
    expect(preparedAbi.decodeFunctionData('createPoolPosition', funding.data).slice(0, 2)).toEqual([pair.marketId, context]);
    expect(m.resign.mock.calls.every(call => call[2] === c.core && call[3] === preparedAbi.getFunction('createPoolPosition')!.selector)).toBe(true);
    expect(funding.intent.poolTokens).toEqual(pair.tokens);
    expect(Object.isFrozen(funding.intent.poolTokens)).toBe(true);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['missing', 'same', 'foreign', 'three', 'disabled', 'market', 'tokens', 'engine', 'terms', 'canonical-id', 'block', 'graph', 'owner-revoked'])(
    'rejects %s pair or registry drift before private prompts', async fault => {
      const f = await fixture(candidateKey), c = resolvePreparedDexScope(candidateKey).candidate;
      const pair = c.pairs[4]; f.request.pair = [pair.tokens[0], pair.tokens[1]];
      if (fault === 'missing') f.request.pair = undefined;
      if (fault === 'same') f.request.pair = [pair.tokens[0], pair.tokens[0]];
      if (fault === 'foreign') f.request.pair = [owner, pair.tokens[1]];
      if (fault === 'three') f.request.pair = [...pair.tokens, c.tokens[0][0]] as never;
      const base = m.registry.getMockImplementation()!;
      m.registry.mockImplementation(async args => {
        const result = await base(args), market = result.markets[4];
        if (fault === 'disabled') market.enabled = false;
        if (fault === 'market') market.marketId = hash;
        if (fault === 'tokens') market.token0 = c.tokens[0][0];
        if (fault === 'engine') market.engine = owner;
        if (fault === 'terms') market.poolTerms = owner;
        if (fault === 'canonical-id') market.canonicalId += 1n;
        if (fault === 'block') result.block.hash = context;
        if (fault === 'graph') result.graph = 'changed';
        return result;
      });
      if (fault === 'owner-revoked') f.revoke();
      await expect(f.cap.preparePoolCreation(f.request)).rejects.toThrow();
      expect(m.small).not.toHaveBeenCalled(); expect(m.wide).not.toHaveBeenCalled();
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    });
  it('captures pair and terms before confirmation and rejects canonical block drift after review', async () => {
    const f = await fixture(candidateKey), c = resolvePreparedDexScope(candidateKey).candidate;
    const pair = c.pairs[2]; f.request.pair = [pair.tokens[0], pair.tokens[1]];
    f.request.confirmPrivateInputs.mockImplementation(async () => { f.request.pair = [c.pairs[5].tokens[0], c.pairs[5].tokens[1]]; return true; });
    const p = (await f.cap.preparePoolCreation(f.request))!;
    expect(p.intent.poolTokens).toEqual(pair.tokens);
    f.mine(p.data); const result = (await p.readPreview(hash))!;
    f.provider.send.mockResolvedValueOnce({ number: '0xb', hash: context });
    await expect(result.prepareFunding(async () => true)).rejects.toThrow('no longer canonical');
    expect(m.resign).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
});

describe('authenticated Pool preview after historical state pruning', () => {
  it('reuses its attested block while rechecking canonical receipts and current funds', async () => {
    const f = await fixture('cheap-history'), c = resolvePreparedDexScope('cheap-history').candidate;
    f.request.pair = c.pairs[0].tokens;
    const prepared = (await f.cap.preparePoolCreation(f.request))!;
    f.mine(prepared.data);
    const preview = (await prepared.readPreview(hash))!;
    const graphReads = m.graph.mock.calls.length, marketReads = m.registry.mock.calls.length;
    m.graph.mockRejectedValue(new Error('missing trie node'));
    m.registry.mockRejectedValue(new Error('missing trie node'));
    const funding = (await preview.prepareFunding(async () => true))!;
    m.preparedWallets.forEach(wallet => {
      const index = funding.intent.poolTokens.indexOf(wallet.token);
      if (index >= 0) wallet.allowance = index === 0 ? funding.amounts.used0 : funding.amounts.used1;
    });
    await funding.assertBeforeFunding();
    expect(m.graph).toHaveBeenCalledTimes(graphReads);
    expect(m.registry).toHaveBeenCalledTimes(marketReads);
    expect(f.provider.send).toHaveBeenCalledWith('eth_getBlockByNumber', ['0xb', false]);
    expect(m.preparedReadState).toHaveBeenCalledTimes(2);
    expect(m.preparedReadWallets).toHaveBeenCalledTimes(2);
    expect(f.provider.getTransactionReceipt).toHaveBeenCalledTimes(3);
    m.preparedWallets[0].balance -= 1n;
    await expect(funding.assertBeforeFunding()).rejects.toThrow('unchanged private balances');
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });

  it.each(['missing', 'hash', 'height', 'revoked'] as const)('rejects %s canonical header after initial attestation', async fault => {
    const f = await fixture('cheap-history'), c = resolvePreparedDexScope('cheap-history').candidate;
    f.request.pair = c.pairs[0].tokens;
    const prepared = (await f.cap.preparePoolCreation(f.request))!;
    f.mine(prepared.data);
    const preview = (await prepared.readPreview(hash))!;
    f.provider.send.mockImplementation(async () => {
      if (fault === 'revoked') f.revoke();
      return fault === 'missing' ? undefined : { number: fault === 'height' ? '0xc' : '0xb', hash: fault === 'hash' ? context : hash };
    });
    await expect(preview.prepareFunding(async () => true)).rejects.toThrow();
    expect(m.resign).not.toHaveBeenCalled();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });

  it('requires a new attestation when the receipt moves to another block', async () => {
    const f = await fixture('cheap-history'), c = resolvePreparedDexScope('cheap-history').candidate;
    f.request.pair = c.pairs[0].tokens;
    const prepared = (await f.cap.preparePoolCreation(f.request))!;
    const { tx, receipt } = f.mine(prepared.data);
    const preview = (await prepared.readPreview(hash))!;
    tx.blockHash = receipt.blockHash = context;
    m.graph.mockRejectedValueOnce(new Error('Replacement block not attested'));
    await expect(preview.prepareFunding(async () => true)).rejects.toThrow('Replacement block not attested');
    expect(m.resign).not.toHaveBeenCalled();
  });
});

// The capability uses the real compiled-layout financial checker here. The
// maintained reader, crypto and registry are isolated mocks; unmocked reader
// authentication/storage is covered by currentDexPreparedPoolSnapshot.test.ts.
describe.each(['cheap-prepared', 'cheap-exit', 'cheap-history'] as const)('%s prepared Pool funding financial integration (isolated reader)', candidateKey => {
  type MutableState = { -readonly [K in keyof PreparedPoolStoredState]: PreparedPoolStoredState[K] extends readonly string[] ? string[] :
    K extends 'anchors' ? string[][] : K extends 'claims' ? Record<string, { marketId: string; words: string[] }> :
    K extends 'markets' | 'c1' | 'ledgers' | 'escrows' | 'custody' | 'engines' | 'directories' ? Record<string, string[]> :
    K extends 'nftOwners' | 'nftMinted' ? Record<string, string> : PreparedPoolStoredState[K] };
  const financialFixture = async (index = 0) => {
    const f = await fixture(candidateKey), c = resolvePreparedDexScope(candidateKey).candidate, pair = c.pairs[index];
    f.request.pair = [pair.tokens[1], pair.tokens[0]];
    const previewCall = (await f.cap.preparePoolCreation(f.request))!; f.mine(previewCall.data);
    const preview = (await previewCall.readPreview(hash))!, funding = (await preview.prepareFunding(async () => true))!;
    const state = m.preparedState as unknown as MutableState;
    const used = (token: string) => token === pair.tokens[0] ? 100n : token === pair.tokens[1] ? 50n : 0n;
    const approve = () => m.preparedWallets.forEach(wallet => { if (used(wallet.token)) wallet.allowance = used(wallet.token); });
    const complete = () => {
      state.counter = 52n; state.core[11] = toBeHex(52n, 32); state.ownerNftBalance++;
      state.claim[0] = toBeHex(1n, 32); state.claim[59] = toBeHex(1n, 32);
      for (const i of [4, 5, 6, 7]) state.claim[i] = toBeHex(1n, 32);
      state.claims['52'] = { marketId: pair.marketId, words: state.claim };
      state.nftOwners['52'] = toBeHex(BigInt(owner), 32); state.nftMinted['52'] = toBeHex(1n, 32);
      state.anchors.forEach(anchor => { anchor[4] = toBeHex(2n, 32); });
      state.markets[pair.marketId][11] = toBeHex(2n, 32);
      for (const token of pair.tokens) {
        state.ledgers[token][9] = toBeHex(2n, 32); state.custody[token][0] = toBeHex(2n, 32);
      }
      m.preparedWallets.forEach(wallet => { wallet.balance -= used(wallet.token); if (used(wallet.token)) wallet.allowance = 0n; });
      const mined = f.mine(funding.data), nft = c.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
      mined.receipt.logs = [
        { address: c.core, ...claimAbi.encodeEventLog(claimAbi.getEvent('SharedClaimCreated')!, [52n]) },
        { address: nft, ...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!, [`0x${'00'.repeat(20)}`, owner, 52n]) },
        ...pair.tokens.map((token, i) => ({ address: token, ...tokenAbi.encodeEventLog(tokenAbi.getEvent('Transfer')!,
          [owner, c.core, [BigInt(i + 1), 0n], [999n, 0n]]) }))
      ];
      return mined;
    };
    return { ...f, c, pair, funding, state, used, approve, complete };
  };
  it.each([0, 1, 2, 3, 4, 5])('checks market%i against four wallets and exactly two selected approvals', async index => {
    const f = await financialFixture(index);
    expect(m.preparedReadState).toHaveBeenCalledWith(52n, { number: 11n, hash });
    expect(m.preparedReadWallets).toHaveBeenCalledWith({ number: 11n, hash });
    expect(m.preparedWallets).toHaveLength(4);
    await expect(f.funding.assertBeforeFunding()).rejects.toThrow('exact selected-token allowances');
    f.approve(); await expect(f.funding.assertBeforeFunding()).resolves.toBeUndefined();
    const untouched = m.preparedWallets.filter(wallet => !f.used(wallet.token));
    expect(untouched).toHaveLength(2); expect(untouched.map(wallet => wallet.allowance)).toEqual([7n, 7n]);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['selected0', 'selected1', 'unrelated-allowance', 'unrelated-balance', 'missing-wallet', 'protected-claim', 'limit-inventory'] as const)(
    'rejects %s drift before funding', async fault => {
      const f = await financialFixture(4); f.approve();
      if (fault === 'selected0' || fault === 'selected1') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[fault === 'selected0' ? 0 : 1])!.allowance++;
      if (fault === 'unrelated-allowance') m.preparedWallets.find(wallet => !f.used(wallet.token))!.allowance++;
      if (fault === 'unrelated-balance') m.preparedWallets.find(wallet => !f.used(wallet.token))!.balance--;
      if (fault === 'missing-wallet') m.preparedWallets.pop();
      if (fault === 'protected-claim') f.state.claims['16'].words[60] = toBeHex(1n, 32);
      if (fault === 'limit-inventory') (f.state.fixedSources['50'].engine as string[])[16] = toBeHex(1n, 32);
      await expect(f.funding.assertBeforeFunding()).rejects.toThrow();
    });
  it.each(['zero', 'selected0-only', 'both-exact'] as const)('allows %s unfunded cleanup without financial drift', async allowances => {
    const f = await financialFixture(3);
    if (allowances !== 'zero') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[0])!.allowance = 100n;
    if (allowances === 'both-exact') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[1])!.allowance = 50n;
    await expect(f.funding.assertUnfundedCleanupCurrent()).resolves.toBeUndefined();
    expect(m.preparedIssue).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['selected-allowance', 'unrelated-allowance', 'balance', 'counter', 'escrow', 'missing-wallet'] as const)('rejects %s unfunded cleanup drift', async fault => {
    const f = await financialFixture(1);
    if (fault === 'selected-allowance') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[0])!.allowance = 101n;
    if (fault === 'unrelated-allowance') m.preparedWallets.find(wallet => !f.used(wallet.token))!.allowance = 0n;
    if (fault === 'balance') m.preparedWallets[0].balance--;
    if (fault === 'counter') f.state.counter++;
    if (fault === 'escrow') f.state.escrows[f.pair.tokens[0]][0] = toBeHex(1n, 32);
    if (fault === 'missing-wallet') m.preparedWallets.pop();
    await expect(f.funding.assertUnfundedCleanupCurrent()).rejects.toThrow();
  });
  it.each(['zero', 'one', 'both'] as const)('stops %s approvals and retains zero-cleanup authority', async approvals => {
    const f = await financialFixture(5);
    if (approvals === 'one') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[0])!.allowance = 100n;
    if (approvals === 'both') f.approve();
    const required = [approvals !== 'zero', approvals === 'both'];
    const confirm = vi.fn(async (review: { allowances: readonly [bigint, bigint] }) => {
      expect(review.allowances).toEqual([required[0] ? 100n : 0n, required[1] ? 50n : 0n]);
      expect(Object.isFrozen(review.allowances)).toBe(true); return true;
    });
    m.preparedReadState.mockClear(); m.preparedReadWallets.mockClear();
    await expect(f.funding.abandonUnfunded(confirm)).resolves.toEqual({
      status: approvals === 'zero' ? 'unfunded-allowances-cleared' : 'unfunded-cleanup-required', cleanupRequired: required });
    expect(m.preparedReadState).toHaveBeenCalledTimes(2);
    expect(m.preparedReadWallets).toHaveBeenCalledTimes(2);
    await expect(f.funding.assertBeforeFunding()).rejects.toThrow('stopped');
    await expect(f.funding.assertApprovalCurrent()).rejects.toThrow('Normal approval cannot restart');
    await expect(f.funding.assertUnfundedCleanupCurrent()).resolves.toBeUndefined();
    m.preparedWallets.forEach(wallet => { if (f.used(wallet.token)) wallet.allowance = 0n; });
    await expect(f.funding.assertUnfundedCleanupCurrent()).resolves.toBeUndefined();
    expect(confirm).toHaveBeenCalledOnce(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('declining stop preserves funding and approval authority', async () => {
    const f = await financialFixture(); f.approve();
    await expect(f.funding.abandonUnfunded(async () => false)).resolves.toBeNull();
    await expect(f.funding.assertBeforeFunding()).resolves.toBeUndefined();
    await expect(f.funding.assertApprovalCurrent()).resolves.toBeUndefined();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['allowance', 'protected-state', 'missing-wallet', 'lease'] as const)('rejects %s drift during stop confirmation', async fault => {
    const f = await financialFixture(); f.approve();
    const wallet = m.preparedWallets.find(value => value.token === f.pair.tokens[0])!;
    await expect(f.funding.abandonUnfunded(async () => {
      if (fault === 'allowance') wallet.allowance = 0n;
      if (fault === 'protected-state') f.state.claims['16'].words[60] = toBeHex(1n, 32);
      if (fault === 'missing-wallet') m.preparedWallets.pop();
      if (fault === 'lease') f.revoke();
      return true;
    })).rejects.toThrow(fault === 'allowance' ? 'approvals changed during stop confirmation' : undefined);
    if (fault === 'allowance') { wallet.allowance = 100n; await expect(f.funding.assertBeforeFunding()).resolves.toBeUndefined(); }
    if (fault === 'protected-state') { f.state.claims['16'].words[60] = toBeHex(0n, 32); await expect(f.funding.assertBeforeFunding()).resolves.toBeUndefined(); }
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3, 4, 5])('accepts market%i only after real financial transition checks and exact debits', async index => {
    const f = await financialFixture(index); f.approve(); const mined = f.complete();
    const receiptReads = f.provider.getTransactionReceipt.mock.calls.length;
    await expect(f.funding.readFunding(hash)).resolves.toMatchObject({ positionId: 52n, producerHash: hash,
      amounts: { used0: 100n, used1: 50n }, readyToSign: false });
    expect(m.preparedIssue).toHaveBeenCalledWith(52n, 'fund', hash, f.funding.data);
    // The isolated producer performs no RPC: the capability reads and rereads.
    expect(f.provider.getTransactionReceipt.mock.calls.length - receiptReads).toBe(2);
    expect(mined.receipt.status).toBe(1); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['debit0', 'debit1', 'unrelated-balance', 'unrelated-allowance', 'selected-allowance', 'shares', 'class', 'protected-claim', 'limit-inventory', 'operation', 'missing-wallet', 'receipt-reread'] as const)(
    'rejects %s funding accounting corruption', async fault => {
      const f = await financialFixture(2); f.approve(); const mined = f.complete();
      if (fault === 'debit0' || fault === 'debit1') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[fault === 'debit0' ? 0 : 1])!.balance--;
      if (fault === 'unrelated-balance') m.preparedWallets.find(wallet => !f.used(wallet.token))!.balance--;
      if (fault === 'unrelated-allowance') m.preparedWallets.find(wallet => !f.used(wallet.token))!.allowance++;
      if (fault === 'selected-allowance') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[1])!.allowance = 1n;
      if (fault === 'shares' || fault === 'class') m.preparedIssue.mockResolvedValue({ transactionHash: hash, amounts: { shares: fault === 'shares' ? 101n : 100n, classId: fault === 'class' ? 2n : 1n } });
      if (fault === 'protected-claim') f.state.claims['16'].words[60] = toBeHex(1n, 32);
      if (fault === 'limit-inventory') (f.state.fixedSources['50'].engine as string[])[16] = toBeHex(1n, 32);
      if (fault === 'operation') f.state.operation++;
      if (fault === 'missing-wallet') m.preparedWallets.pop();
      if (fault === 'receipt-reread') f.provider.getTransactionReceipt.mockResolvedValueOnce(mined.receipt).mockResolvedValue({ ...mined.receipt, logs: [...mined.receipt.logs, mined.receipt.logs[2]] });
      await expect(f.funding.readFunding(hash)).rejects.toThrow();
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    });
});

describe('selected native Pool funding issuer',()=>{
  it('binds actual preparation, private preview and funding result to selected Core/NFT/canonical tokens',async()=>{
    const f=await fixture('cheap-native'),c=resolveCurrentCheapDexCandidate('cheap-native'),p=(await f.cap.preparePoolCreation(f.request))!;
    expect(p).toMatchObject({to:c.core,graph:c.graph,packageSha256:c.packageSha256,readyToSign:false});expect(m.graph).toHaveBeenCalledWith(expect.objectContaining({candidate:'cheap-native'}));
    expect([...m.small.mock.calls,...m.wide.mock.calls].every(x=>x[2]===c.core)).toBe(true);assertCurrentPoolFundingPrepared(p,f.signer);
    f.mine(p.data);const preview=(await p.readPreview(hash))!,funding=(await preview.prepareFunding(async()=>true))!,{receipt}=f.mine(funding.data),tokens=[...c.tokens].sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1);
    receipt.logs=[{address:c.core,...claimAbi.encodeEventLog(claimAbi.getEvent('SharedClaimCreated')!,[8n])},{address:c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1],...nftAbi.encodeEventLog(nftAbi.getEvent('Transfer')!,[`0x${'00'.repeat(20)}`,owner,8n])},
      ...tokens.map(([address],i)=>({address,...tokenAbi.encodeEventLog(tokenAbi.getEvent('Transfer')!,[owner,c.core,[BigInt(i+1),0n],[999n,0n]])}))];
    await expect(funding.readFunding(hash)).rejects.toThrow('no admitted native Pool session');expect(m.resign.mock.calls.every(x=>x[2]===c.core)).toBe(true);expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('rejects a wrong candidate input before encrypting',async()=>{const f=await fixture('cheap-native');f.request.graph.expectedGraph=ARCHIVED_CHEAP_DEX_CANDIDATE.graph;await expect(f.cap.preparePoolCreation(f.request)).rejects.toThrow('Wrong Pool');expect(m.small).not.toHaveBeenCalled();expect(m.wide).not.toHaveBeenCalled();});
  it('revokes selected candidate private preparation with its owner lease',async()=>{const f=await fixture('cheap-native');f.revoke();await expect(f.cap.preparePoolCreation(f.request)).rejects.toThrow('revoked');});
});

describe('explicit native Pool source fit with actual issuer brands', () => {
  async function profileFixture() {
    const f = await fixture('cheap-native'), candidate = resolveCurrentCheapDexCandidate('cheap-native'), unit = 10n ** 18n;
    f.request.intent.classId = 0n;
    f.request.intent.budgets = [100n * unit, 100n * unit];
    f.request.intent.terms = [1n, 2n, 1n, 0n, 1001n, 1000n, 1n, 1n, 1n, 200n] as never;
    // Live proportional debits need not match the measured local 100/50 fixture.
    f.values.splice(0, 10, 1n, 80n * unit, 60n * unit, 20n * unit, 40n * unit, 90n, 90n, 1n, 200n, 0n);
    const preview = (await f.cap.preparePoolCreation(f.request))!;
    const mined = f.mine(preview.data), result = (await preview.readPreview(hash))!;
    const funding = (await result.prepareFunding(async () => true))!;
    let clock = 100n;
    const fit = () => issueCurrentNativePoolSourceFit(candidate, funding, f.signer, CURRENT_NATIVE_POOL_PROFILE, () => clock, 1000n);
    const check = (value = fit()) => assertCurrentNativePoolSourceFit(value, 'pool-fund', funding.data, 100_000_000n,
      candidate, owner, candidate.core, BigInt(candidate.chainId));
    return { ...f, candidate, preview, result, funding, mined, fit, check, advance: () => { clock = 1000n; } };
  }
  const approvalAdapter=async()=>{
    const f=await profileFixture();admitCurrentNativePoolPreview(f.candidate,f.preview,f.signer,CURRENT_NATIVE_POOL_PROFILE);
    currentNativePoolSession(f.signer)!.previewResult=f.result;
    const allowances=[0n,0n],storage=new Map<string,string>();vi.stubGlobal('window',{sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
    const head={number:11n,hash,timestamp:100n,gasLimit:120_000_000n},guard=async()=>f.preview.assertCurrent();
    let nativeBalance=10n**18n,adapterClock=100n;
    const transport={assertCurrent:guard,readHead:async()=>head,readNonce:async()=>7,estimateGas:vi.fn(async()=>1n),send:vi.fn(),
      readNativeResources:async()=>({head,owner,chainId:BigInt(f.candidate.chainId),latestNonce:7,pendingNonce:7,gasPrice:50_000_000n,baseFeePerGas:1n,balance:nativeBalance,code:'0x'})};
    const make=()=>createCurrentTokenFundingAdapter({signer:f.signer,ownerAddress:owner,chainId:BigInt(f.candidate.chainId),candidate:'cheap-native',
      transport:transport as never,attest:async()=>{},assertResources:guard,now:()=>adapterClock,
      encrypt:async amount=>({ciphertext:{ciphertextHigh:0n,ciphertextLow:amount},signature}),decrypt:v=>BigInt(v.ciphertextLow),
      readState:async(tokenIndex,block)=>({tokenIndex,token:f.candidate.tokens[tokenIndex][0],owner,block,balance:1000n*10n**18n,
        allowance:allowances[tokenIndex],claimed:true,faucetAmount:10000n*10n**18n,decimals:18n,publicAmounts:false,encryptionAddress:owner})});
    return{...f,cap:make(),make,allowances,storage,transport,setClock:(v:bigint)=>{adapterClock=v;head.timestamp=v;},reduceBalance:()=>{nativeBalance=20_000_000_000_000_000n;}};
  };
  const startedAbandon=async()=>{
    const f=await approvalAdapter(),session=currentNativePoolSession(f.signer)!;
    currentNativeSigningBudget(f.signer,owner,()=>100n).commit('pool-preview',session.scope,100_000_000n);
    await f.cap.preparePoolApproval(f.funding,0,async()=>false);return {...f,session};
  };
  const sentCleanupFixture=async(cleanup=true)=>{
    const f=await startedAbandon();if(cleanup){f.allowances[1]=f.funding.amounts.used0;f.allowances[0]=f.funding.amounts.used1;}
    const budget=currentNativeSigningBudget(f.signer,owner,()=>100n);if(cleanup){budget.commit('token-funding','token-funding:approve:a',5_000_000n,f.session.scope);budget.commit('token-funding','token-funding:approve:b',5_000_000n,f.session.scope);
    await f.cap.abandonCurrentNativePoolFunding(async()=>true);}
    let tx:unknown=null,receipt:unknown=null;
    const approvalAbi=new Interface(['event Approval(address indexed owner,address indexed spender,(uint256 ciphertextHigh,uint256 ciphertextLow) ownerValue,(uint256 ciphertextHigh,uint256 ciphertextLow) spenderValue)']);
    Object.assign(f.transport,{readBlockHash:async()=>hash,readTransaction:async()=>tx,waitForReceipt:async()=>receipt,verifyCanonicalInclusion:async()=>{}});
    f.transport.send.mockImplementation(async(request:{to:string;data:string})=>{
      const index=f.candidate.tokens.findIndex(([address])=>address.toLowerCase()===request.to.toLowerCase()),amount=BigInt(currentTokenFundingAbi.decodeFunctionData('approve',request.data)[1].ciphertext.ciphertextLow);f.allowances[index]=amount;
      tx={...request,hash,blockNumber:11,blockHash:hash};receipt={hash,status:1,from:owner,to:request.to,blockNumber:11,blockHash:hash,
        logs:[{address:request.to,...approvalAbi.encodeEventLog(approvalAbi.getEvent('Approval')!,[owner,f.candidate.core,[0n,amount],[0n,amount]])}]};return {...request,hash};
    });
    return {...f,setReceipt:(r:unknown)=>{receipt=r;},getReceipt:()=>receipt};
  };
  it('original private final-clear proof survives same-lease remount and completes both-zero scope',async()=>{
    const f=await sentCleanupFixture();const first=(await f.cap.preparePoolUnfundedCleanup(0,async()=>true))!;
    await f.cap.submitCurrentTokenFunding(first);expect((await f.make().recoverCurrentNativePoolTokenResult())?.fundingOutcome).toBe('verified');
    expect((await f.make().readCurrentNativePoolResume())!.completed).toBe(false);
    const second=(await f.cap.preparePoolUnfundedCleanup(1,async()=>true))!;await f.cap.submitCurrentTokenFunding(second);
    const recovered=await f.make().recoverCurrentNativePoolTokenResult();expect(recovered?.fundingOutcome).toBe('verified');
    const resumed=(await f.make().readCurrentNativePoolResume())!;expect(resumed.completed).toBe(true);expect(resumed.approvals).toEqual([false,false]);
    expect(f.storage.size).toBe(0);expect(f.transport.send).toHaveBeenCalledTimes(2);expect(await f.make().recoverCurrentNativePoolTokenResult()).toBeNull();vi.unstubAllGlobals();
  });
  it('original failed approval proof after remount locks normal funding and retains exact zero flags',async()=>{
    const f=await sentCleanupFixture(false),prepared=(await f.cap.preparePoolApproval(f.funding,0,async()=>true))!;
    await f.cap.submitCurrentTokenFunding(prepared);f.allowances[1]=0n;f.setReceipt({...f.getReceipt() as object,status:0,logs:[]});
    expect((await f.make().recoverCurrentNativePoolTokenResult())?.fundingOutcome).toBe('reverted');
    const resume=(await f.make().readCurrentNativePoolResume())!;expect(resume.unfundedFailed).toBe(true);expect(resume.approvals).toEqual([false,false]);
    expect(resume.completed).toBe(false);await expect(f.cap.preparePoolApproval(f.funding,1,async()=>true)).rejects.toThrow();vi.unstubAllGlobals();
  });
  it('canonical failed zero-clear preserves the original failure branch and exact allowance without an extra grant',async()=>{
    const f=await sentCleanupFixture(),prepared=(await f.cap.preparePoolUnfundedCleanup(0,async()=>true))!;await f.cap.submitCurrentTokenFunding(prepared);
    f.allowances[1]=f.funding.amounts.used0;f.setReceipt({...f.getReceipt() as object,status:0,logs:[]});
    expect((await f.make().recoverCurrentNativePoolTokenResult())?.fundingOutcome).toBe('reverted');
    const resumed=(await f.make().readCurrentNativePoolResume())!;expect(resumed.completed).toBe(false);expect(resumed.unfundedFailed).toBe(true);expect(resumed.approvals).toEqual([true,true]);
    expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot().signingStarts).toBe(4);vi.unstubAllGlobals();
  });
  it('expired unsigned fund stops irreversibly and admits exact reversed zero clears without historical preview reads',async()=>{
    const f=await startedAbandon();f.allowances[1]=f.funding.amounts.used0;f.allowances[0]=f.funding.amounts.used1;f.setClock(1001n);
    f.provider.getTransactionReceipt.mockRejectedValue(new Error('pruned preview'));
    expect((await f.cap.readCurrentNativePoolResume())!.unfundedAbandonEligible).toBe(true);
    const result=await f.cap.abandonCurrentNativePoolFunding(async review=>{expect(review.allowances).toEqual([f.funding.amounts.used0,f.funding.amounts.used1]);return true;});
    expect(result?.cleanupRequired).toEqual([true,true]);expect(f.session.unfundedAbandoned).toBe(true);
    expect((await f.cap.preparePoolUnfundedCleanup(0,async()=>true))!.amount).toBe(0n);
    await expect(f.cap.preparePoolApproval(f.funding,0,async()=>true)).rejects.toThrow();expect(f.transport.send).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
  it('actual issued funding cleanup permits only unrelated source-bound Fast state drift',async()=>{
    const f=await startedAbandon();f.allowances[1]=f.funding.amounts.used0;
    m.nativeState.operation=10n;(m.nativeState.core as string[])[12]=toBeHex(10n,32);
    (m.nativeState.anchors as string[][])[0][8]=toBeHex(12n,32);(m.nativeState.ledgers as string[][])[0][0]=toBeHex(11n,32);
    await expect(f.funding.assertBeforeFunding()).rejects.toThrow('dependencies');
    await expect(f.funding.assertUnfundedCleanupCurrent()).resolves.toBeUndefined();
    await expect(f.cap.abandonCurrentNativePoolFunding(async()=>true)).resolves.toMatchObject({status:'unfunded-abandoned'});
    (m.nativeState.escrows as string[][])[0][0]=toBeHex(1n,32);
    await expect(f.cap.preparePoolUnfundedCleanup(0,async()=>true)).rejects.toThrow('selected escrow');vi.unstubAllGlobals();
  });
  it('declined stop and readonly eligibility do not mutate original financial authority',async()=>{
    const f=await startedAbandon(),before=currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot();
    expect((await f.cap.readCurrentNativePoolResume())!.unfundedAbandonEligible).toBe(true);
    expect(await f.cap.abandonCurrentNativePoolFunding(async()=>false)).toBeNull();expect(f.session.unfundedFailed).toBe(false);
    expect(currentNativeSigningBudget(f.signer,owner,()=>100n).snapshot()).toEqual(before);vi.unstubAllGlobals();
  });
  it('zero allowances complete without a send and remain observable on same-lease resume',async()=>{
    const f=await startedAbandon(),result=await f.cap.abandonCurrentNativePoolFunding(async()=>true);
    expect(result?.status).toBe('unfunded-allowances-cleared');expect((await f.cap.readCurrentNativePoolResume())!.completed).toBe(true);
    expect(()=>f.cap.preparePoolUnfundedCleanup(0,async()=>true)).toThrow();expect(f.transport.send).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
  it.each(['fund-start','expiry','allowance','lease','known-pending','unknown-pending','candidate','rpc','resource'])('abandon rejects %s without locking normal authority',async fault=>{
    const f=await startedAbandon();
    if(fault==='fund-start'){const budget=currentNativeSigningBudget(f.signer,owner,()=>100n);budget.commit('token-funding','token-funding:approve:a',5_000_000n,f.session.scope);budget.commit('token-funding','token-funding:approve:b',5_000_000n,f.session.scope);budget.commit('pool-fund','fund',100_000_000n,f.session.scope);}
    if(fault==='known-pending'||fault==='unknown-pending')f.storage.set(CURRENT_DEX_PENDING_ATTEMPT_KEY,JSON.stringify({version:1,chainId:String(f.candidate.chainId),owner:owner.toLowerCase(),core:f.candidate.core.toLowerCase(),graph:f.candidate.graph.toLowerCase(),phase:'pool-fund',callHash:hash,nonce:7,txHash:fault==='known-pending'?hash:null}));
    if(fault==='candidate')f.session.candidate={...f.candidate,packageSha256:hash};
    if(fault==='rpc')f.transport.readNativeResources=async()=>{throw new Error('RPC unavailable');};
    if(fault==='resource') {const original=f.transport.readNativeResources;f.transport.readNativeResources=async()=>({...await original(),balance:1n});}
    if(fault==='expiry')f.setClock(1900n);if(fault==='allowance')f.allowances[0]=1n;if(fault==='lease')f.revoke();
    await expect(f.cap.abandonCurrentNativePoolFunding(async()=>true)).rejects.toThrow();expect(f.session.unfundedFailed).toBe(false);expect(f.transport.send).not.toHaveBeenCalled();vi.unstubAllGlobals();
  });
  it('authentic unequal preview approves reversed package targets and resumes original preparations without regrant',async()=>{
    const f=await approvalAdapter();const a=(await f.cap.preparePoolApproval(f.funding,0,async()=>true))!,b=(await f.cap.preparePoolApproval(f.funding,1,async()=>true))!;
    expect([a.before.tokenIndex,b.before.tokenIndex]).toEqual([1,0]);expect([a.amount,b.amount]).toEqual([80n*10n**18n,60n*10n**18n]);
    f.allowances[1]=a.amount;let resume=(await f.cap.readCurrentNativePoolResume())!;expect(resume.funding).toBe(f.funding);expect(resume.previewResult).toBe(f.result);expect(resume.approvals).toEqual([true,false]);
    f.allowances[0]=b.amount;resume=(await f.cap.readCurrentNativePoolResume())!;expect(resume.approvals).toEqual([true,true]);
    f.allowances[1]+=1n;await expect(f.cap.readCurrentNativePoolResume()).rejects.toThrow('exact used');f.revoke();await expect(f.cap.readCurrentNativePoolResume()).rejects.toThrow('revoked');vi.unstubAllGlobals();
  });
  it('copied funding brands and wrong package-index allowance cannot grant an approval or resume authority',async()=>{
    const f=await approvalAdapter();await expect(f.cap.preparePoolApproval({...f.funding},0,async()=>true)).rejects.toThrow();
    await f.cap.preparePoolApproval(f.funding,0,async()=>true);f.allowances[1]=f.funding.amounts.used1;
    await expect(f.cap.readCurrentNativePoolResume()).rejects.toThrow('exact used');vi.unstubAllGlobals();
  });
  it('failed-unfunded resume skips old preview reads and keeps exact cleanup object/allowances',async()=>{
    const f=await approvalAdapter();await f.cap.preparePoolApproval(f.funding,0,async()=>true);currentNativePoolSession(f.signer)!.unfundedFailed=true;
    f.allowances[1]=f.funding.amounts.used0;f.provider.getTransactionReceipt.mockRejectedValue(new Error('historical state unavailable'));
    const resume=(await f.cap.readCurrentNativePoolResume())!;expect(resume.unfundedFailed).toBe(true);expect(resume.funding).toBe(f.funding);
    const cleanup=await f.cap.preparePoolUnfundedCleanup(0,async()=>true);expect(cleanup?.amount).toBe(0n);vi.unstubAllGlobals();
  });
  it('preview-linked approval rejects loss of future lifecycle resources before any signature',async()=>{
    const f=await approvalAdapter(),session=currentNativePoolSession(f.signer)!;
    currentNativeSigningBudget(f.signer,owner,()=>100n).commit('pool-preview',session.scope,100_000_000n);
    const a=(await f.cap.preparePoolApproval(f.funding,0,async()=>true))!;f.reduceBalance();
    await expect(f.cap.submitCurrentTokenFunding(a)).rejects.toThrow('remaining lifecycle reserve');
    expect(f.transport.send).not.toHaveBeenCalled();expect(f.storage.size).toBe(0);vi.unstubAllGlobals();
  });
  it('binds exact source, actual brand, new add preview, variable used amounts and immutable context', async () => {
    const f = await profileFixture();
    assertCurrentNativePoolProfile(f.candidate, f.preview, f.signer, CURRENT_NATIVE_POOL_PROFILE);
    expect(f.funding.previewData).toBe(f.preview.data);
    expect(f.fit().evidence).toBe(CURRENT_NATIVE_POOL_SOURCE);
    await expect(f.check()).resolves.toBeUndefined();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('distinguishes transient private reads from a proved changed preview and supports a read-only retry', async () => {
    const f = await profileFixture(), fit = f.fit();
    f.provider.getTransactionReceipt.mockRejectedValueOnce(new Error('Temporary private-read RPC outage'));
    let observed: unknown;
    try { await f.check(fit); } catch (error) { observed = error; }
    expect(isKnownCurrentPoolProofMismatch(observed)).toBe(false);
    await expect(f.check(fit)).resolves.toBeUndefined();
    f.values[2] += 1n;
    await expect(f.check(fit)).rejects.toBeInstanceOf(CurrentPoolProofMismatch);
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['class', 'budget', 'terms'])('rejects a genuinely issued preview outside the exact %s profile', async fault => {
    const f = await fixture('cheap-native'), candidate = resolveCurrentCheapDexCandidate('cheap-native');
    f.request.intent.classId = 0n; f.request.intent.budgets = [100n * 10n ** 18n, 100n * 10n ** 18n];
    f.request.intent.terms = [1n, 2n, 1n, 0n, 1001n, 1000n, 1n, 1n, 1n, 200n] as never;
    if (fault === 'class') { f.request.intent.classId = 1n; f.request.intent.terms = [1n, 2n, 1n, 0n, 1003n, 1000n, 667n, 669n, 1n, 200n] as never; }
    if (fault === 'budget') f.request.intent.budgets = [99n * 10n ** 18n, 100n * 10n ** 18n];
    if (fault === 'terms') f.request.intent.terms = [1n, 3n, 1n, 0n, 1001n, 1000n, 1n, 1n, 1n, 200n] as never;
    const preview = (await f.cap.preparePoolCreation(f.request))!;
    assertCurrentPoolFundingPrepared(preview, f.signer);
    expect(() => assertCurrentNativePoolProfile(candidate, preview, f.signer, CURRENT_NATIVE_POOL_PROFILE)).toThrow('profile');
  });
  it.each(['copy', 'signer', 'candidate', 'class', 'budget', 'terms', 'initialize', 'shares', 'conservation', 'context', 'expired', 'revoked'])('rejects %s profile drift without authority', async fault => {
    const f = await profileFixture(), fit = f.fit();
    if (fault === 'copy') { await expect(f.check({ ...fit })).rejects.toThrow(); return; }
    if (fault === 'signer') { expect(() => assertCurrentNativePoolProfile(f.candidate, f.funding, {}, CURRENT_NATIVE_POOL_PROFILE)).toThrow(); return; }
    if (fault === 'candidate') { const changed = { ...f.candidate, releaseId: hash }; expect(() => assertCurrentNativePoolProfile(changed, f.funding, f.signer, CURRENT_NATIVE_POOL_PROFILE)).toThrow(); return; }
    if (fault === 'class' || fault === 'budget' || fault === 'terms') {
      const altered = { ...f.funding, intent: { ...f.funding.intent, ...(fault === 'class' ? { classId: 1n } : fault === 'budget' ? { budgets: [1n, 1n] } : { terms: [1n] }) } };
      expect(() => assertCurrentNativePoolProfile(f.candidate, altered as never, f.signer, CURRENT_NATIVE_POOL_PROFILE)).toThrow(); return;
    }
    if (fault === 'initialize') f.values[0] = 0n;
    if (fault === 'shares') f.values[6] = 91n;
    if (fault === 'conservation') f.values[3] += 1n;
    if (fault === 'context') f.mined.event.data = abi.encodeEventLog(abi.getEvent('PoolFundingPreviewed')!, [0n, toBeHex(99n, 32), Array.from({ length: 10 }, (_, i) => [BigInt(i), BigInt(i + 1)])]).data;
    if (fault === 'expired') f.advance();
    if (fault === 'revoked') f.revoke();
    await expect(f.check(fit)).rejects.toThrow();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('selects the source fit before estimation and keeps unselected native estimates strict', async () => {
    const f = await profileFixture(), native = f.candidate, values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const head = { number: 11n, hash, timestamp: 100n, gasLimit: 120_000_000n };
    const transport = { assertCurrent: async () => {}, readHead: async () => head, readNonce: async () => 7,
      readNativeResources: async () => ({ owner, chainId: BigInt(native.chainId), head, latestNonce: 7, pendingNonce: 7,
        gasPrice: 50_000_000n, baseFeePerGas: 1n, balance: 10n ** 18n, code: '0x' }), estimateGas: vi.fn(async () => { throw new Error('estimate failed'); }),
      send: vi.fn(async r => ({ ...r, hash })), readBlockHash: async () => hash,
      readTransaction: async () => null, waitForReceipt: async () => null };
    const boundary = createCurrentAttemptBoundary({ storage, c: native, core: native.core, owner, chainId: BigInt(native.chainId), transport,
      attest: async () => {}, now: () => 100n, historical: false });
    const call = { chainId: BigInt(native.chainId), from: owner, to: native.core, value: 0n as const, data: f.funding.data };
    // Boundary fit checks only: the App adapter admission gate remains held.
    await expect(boundary.sendCurrent('pool-fund', call, undefined, async () => {}, () => {}, undefined, 100_000_000n)).rejects.toThrow('estimate failed');
    expect(transport.send).not.toHaveBeenCalled(); expect(values.size).toBe(0);
    await expect(boundary.sendCurrent('pool-fund', call, undefined, async () => {}, () => {}, undefined, 100_000_000n,
      undefined, async () => {}, f.fit())).resolves.toMatchObject({ transactionHash: hash });
    expect(transport.estimateGas).toHaveBeenCalledOnce(); expect(transport.send).toHaveBeenCalledOnce();
  });
});
