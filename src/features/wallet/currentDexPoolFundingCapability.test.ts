import { AbiCoder, Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import { resolvePreparedDexScope } from '../../lib/currentDexPreparedScope';
import { describe, expect, it, vi } from 'vitest';
import { issueCurrentDexPoolFundingCapability, assertCurrentPoolFundingPrepared } from './currentDexPoolFundingCapability';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../lib/dexV2Deployment';
import { CURRENT_POOL_FUNDING_ABI, PREPARED_POOL_FUNDING_ABI } from '../../lib/currentDexPoolFunding';
import * as poolInputs from '../../lib/currentDexPoolFunding';
import { CurrentPoolProofMismatch } from '../../lib/currentDexPoolProofError';
import type { PreparedPoolStoredState } from '../../lib/currentDexPreparedPoolSnapshot';
vi.mock('../../lib/currentDexPreparedPoolSnapshot', async original => ({
  ...await original<typeof import('../../lib/currentDexPreparedPoolSnapshot')>(),
  // Isolated capability integration. Keep the real financial transition checker;
  // RPC/storage/canonical producer proof remains in the 35 reader tests.
  createPreparedOwnerPoolSnapshotReader: (...args: unknown[]) => m.preparedFactory(...args)
}));

const m = vi.hoisted(() => ({ issue: vi.fn(), graph: vi.fn(), registry: vi.fn(), small: vi.fn(), wide: vi.fn(), decrypt: vi.fn(), resign: vi.fn(),
  preparedFactory: vi.fn(), preparedReadState: vi.fn(), preparedReadWallets: vi.fn(), preparedIssue: vi.fn(), preparedState: {} as Record<string, unknown>,
  preparedWallets: [] as { token: string; balance: bigint; allowance: bigint }[] }));
vi.mock('./ownerCotiMetaMaskCapability', () => ({ hasCurrentDexBrowserSigner:()=>false, issueOwnerCotiMetaMaskCapability: m.issue }));
vi.mock('../../lib/dexV2Chain', async original => ({ ...await original<typeof import('../../lib/dexV2Chain')>(), readCurrentSharedPoolDexGraph: m.graph, readPreparedDexMarketRegistry: m.registry }));
vi.mock('../../lib/privateUint256', () => ({ encryptPrivateUint128Input: m.small, encryptPrivateUint256Input: m.wide,
  decryptPrivateUint256Output: m.decrypt, resignPrivateInput: m.resign }));
const abi = new Interface(CURRENT_POOL_FUNDING_ABI), owner = `0x${'22'.repeat(20)}`, hash = toBeHex(33n, 32), context = toBeHex(44n, 32);
const signature = `0x${'11'.repeat(65)}`;
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer V)[] ? Mutable<V>[] : T[K] extends object ? Mutable<T[K]> : T[K] };

describe('packed Pool preparation with isolated candidate selection', () => {
  it('requests eight creation signatures and re-signs the same eight ciphertexts', async () => {
    const profile = vi.spyOn(poolInputs, 'usesPackedPoolInputs').mockReturnValue(true);
    try {
      const f = await fixture('cheap-history'), pair = resolvePreparedDexScope('cheap-history').candidate.pairs[0];
      f.request.pair = pair.tokens;
      const prepared = (await f.cap.preparePoolCreation(f.request))!;
      expect(m.small.mock.calls.map(c => c[1])).toEqual([1n]);
      expect(m.wide.mock.calls.map(c => c[1])).toEqual([120n, 50n,
        ...[0, 2, 4, 6, 8].map(i => poolInputs.packPoolInputPair(f.request.intent.terms[i], f.request.intent.terms[i + 1]))]);
      f.mine(prepared.data);
      const preview = (await prepared.readPreview(hash))!;
      await preview.prepareFunding(async () => true);
      expect(m.resign).toHaveBeenCalledTimes(8);
      expect(m.resign.mock.calls.map(c => c[1])).toEqual([2n, ...m.wide.mock.calls.map(c => ({ ciphertextHigh: 1n, ciphertextLow: c[1] }))]);
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    } finally { profile.mockRestore(); }
  });
  it('requests three top-up inputs and retains them for funding', async () => {
    const profile = vi.spyOn(poolInputs, 'usesPackedPoolInputs').mockReturnValue(true);
    try {
      const f = await topUpFixture(0, 'cheap-history'); await f.prepare();
      expect(m.small).not.toHaveBeenCalled();
      expect(m.wide.mock.calls.map(c => c[1])).toEqual([10n, 20n, poolInputs.packPoolInputPair(1n, 200n)]);
      expect(m.resign).toHaveBeenCalledTimes(3);
      expect(m.resign.mock.calls.map(c => c[1])).toEqual(m.wide.mock.calls.map(c => ({ ciphertextHigh: 1n, ciphertextLow: c[1] })));
      expect(f.signer.sendTransaction).not.toHaveBeenCalled();
    } finally { profile.mockRestore(); }
  });
});
describe.each(['cheap-history'] as const)('%s owner Pool top-up preparation', candidateKey => {
  const c = resolvePreparedDexScope(candidateKey).candidate;
  it.each(c.pairs.map((_, i) => i))('binds canonical pair %s, exact inputs and genuine approval brand', async index => {
    const f = await topUpFixture(index, candidateKey), { prepared, preview, funding } = await f.prepare();
    expect(preview).toMatchObject({ positionId: 43n, ownerContext: context });
    assertCurrentPoolFundingPrepared(prepared, f.signer); assertCurrentPoolFundingPrepared(funding, f.signer);
    expect(() => assertCurrentPoolFundingPrepared({ ...funding }, f.signer)).toThrow('not prepared');
    // The selected 'cheap-history' candidate uses the packed Pool input graph: one (1<<128|200) tolerance input.
    if (poolInputs.usesPackedPoolInputs(resolveCurrentCheapDexCandidate(candidateKey))) {
      expect(m.wide.mock.calls.map(call => call[1])).toEqual([10n, 20n, (1n << 128n) | 200n]);
      expect(m.small).not.toHaveBeenCalled();
    } else {
      expect(m.wide.mock.calls.map(call => call[1])).toEqual([10n, 20n]);
      expect(m.small.mock.calls.map(call => call[1])).toEqual([1n, 200n]);
    }
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
    if (fault.includes('allowance')) wallet.allowance += fault === 'selected-allowance' ? -1n : 1n; else wallet.balance -= 1n;
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
    assertCurrentPoolFundingPrepared(result,f.signer);
    expect(()=>assertCurrentPoolFundingPrepared({...result},f.signer)).toThrow('not prepared');
    expect(()=>assertCurrentPoolFundingPrepared(result,{})).toThrow('not prepared');
    expect(result).toMatchObject({chainId:BigInt(c.chainId),from:owner,to:c.core,graph:c.graph,packageSha256:c.packageSha256});
    await expect(result.assertCurrent()).resolves.toBeUndefined();
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
  it('rejects a changed funding receipt before admitting its snapshot handoff',async()=>{
    const f=await topUpFixture(0,candidateKey),{funding}=await f.prepare();f.approve();await funding.assertBeforeFunding();f.mineManage(funding.data);
    const result=(await funding.readFunding(hash))!,original=f.canonical.getMockImplementation()!;
    f.canonical.mockImplementation(async value=>{const proof=await original(value);return {...proof,block:{...proof.block,hash:toBeHex(998n,32)}};});
    await expect(result.assertCurrent()).rejects.toThrow('management receipt changed');expect(f.signer.sendTransaction).not.toHaveBeenCalled();
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
async function topUpFixture(pairIndex = 0, candidateKey: 'cheap-history' = 'cheap-history') {
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
  m.preparedFactory.mockReturnValue({ selectedState: readState, wallets: readWallets, canonical, current, issue });
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
async function fixture(candidateKey:CurrentCheapDexCandidateKey='cheap-history') {
  const candidate=resolveCurrentCheapDexCandidate(candidateKey);
  vi.clearAllMocks();
  const words=(n:number)=>Array.from({length:n},()=>toBeHex(0n,32));
  let active = true;
  const guard = () => { if (!active) throw new Error('Session revoked'); };
  const signer = { sendTransaction: vi.fn() };
  const provider = { send: vi.fn(async(method:string)=>method==='eth_getBlockByNumber'?{number:'0xb',hash}:method==='eth_getStorageAt'?toBeHex(51n,32):undefined), getTransaction: vi.fn(), getTransactionReceipt: vi.fn() };
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
    return { selectedState: m.preparedReadState, wallets: m.preparedReadWallets, issue: m.preparedIssue };
  });
  m.issue.mockImplementation(async args => { expect(args.requirePrivacy).toBe(true); return args.bindCapability({ signer,
    readProvider: provider, ownerAddress: owner, chainId: BigInt(candidate.chainId), assertCurrent: async () => guard(), assertSnapshotCurrent: guard }); });
  m.graph.mockImplementation(async ({ blockNumber, blockHash }) => ({ graph: candidate.graph, packageSha256: candidate.packageSha256,
    chainId: BigInt(candidate.chainId), genesisHash: candidate.genesisHash, core: candidate.core, block: { number: blockNumber, hash: blockHash },
    operationReadIdentity: { runtimeHash: candidate.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2], releaseId: candidate.releaseId } }));
  m.registry.mockImplementation(async ({ blockNumber, blockHash }) => ({ graph: candidate.graph, packageSha256: candidate.packageSha256,
    chainId: BigInt(candidate.chainId), core: candidate.core, releaseId: candidate.releaseId, block: { number: blockNumber, hash: blockHash },
    markets: resolvePreparedDexScope(candidateKey).candidate.pairs.map(pair => ({ marketId: pair.marketId, canonicalId: BigInt(pair.canonicalId),
      registryRevision: 1n, marketRevision: 1n, enabled: true, token0: pair.tokens[0], token1: pair.tokens[1], engine: pair.engine, poolTerms: pair.poolTerms })) }));
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
describe.each(['cheap-history'] as const)('%s prepared multi-market Pool funding preparation', candidateKey => {
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
describe.each(['cheap-history'] as const)('%s prepared Pool funding financial integration (isolated reader)', candidateKey => {
  type MutableState = { -readonly [K in keyof PreparedPoolStoredState]: PreparedPoolStoredState[K] extends readonly string[] ? string[] :
    K extends 'anchors' ? string[][] : K extends 'claims' ? Record<string, { marketId: string; words: string[] }> :
    K extends 'markets' | 'c1' | 'ledgers' | 'escrows' | 'custody' | 'engines' | 'directories' ? Record<string, string[]> :
    K extends 'nftOwners' | 'nftMinted' ? Record<string, string> : PreparedPoolStoredState[K] };
  const financialFixture = async (index = 0, selected = false) => {
    const f = await fixture(candidateKey), c = resolvePreparedDexScope(candidateKey).candidate, pair = c.pairs[index];
    if(selected){
      const factory=m.preparedFactory.getMockImplementation()!;
      m.preparedFactory.mockImplementation(input=>{
        const reader=factory(input),s=m.preparedState as unknown as MutableState,w=(n:bigint|number)=>toBeHex(n,32),
          raw=s.markets[pair.marketId],nft=c.companions.find(([role])=>role==='ChainWhisperDexPositionNFT')![1];
        [raw[0],raw[1],raw[2],raw[3],raw[4],raw[5]]=[c.releaseId,pair.marketId,w(BigInt(pair.tokens[0])),w(BigInt(pair.tokens[1])),w(BigInt(nft)),w(BigInt(pair.poolTerms))];
        s.anchors.forEach((a,i)=>{a[0]=w(1);a[62]=w(i);});
        Object.assign(s,{scope:'selected-pool-accounting',candidateKey,packageSha256:c.packageSha256,coreAddress:c.core,owner,
          positionMarket:w(0),sourceIdForPosition:w(0),everPoolFunded:w(0),markets:{[pair.marketId]:raw},
          claims:Object.fromEntries(s.anchors.map((words,i)=>[String(i+1),{marketId:pair.marketId,words}])),
          nftOwners:{'52':w(0)},nftMinted:{'52':w(0)}});
        for(const field of ['c1','engines','directories','fixedSources'])delete m.preparedState[field];
        return reader;
      });
    }
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
      if(selected)Object.assign(state,{positionMarket:pair.marketId,everPoolFunded:toBeHex(1n,32)});
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
  it.each(['same-market','incoming-nft','later-snapshot'] as const)('verifies own selected funding with %s interference without assigning aggregate values',async interference=>{
    const f=await financialFixture(2,true);f.approve();await f.funding.assertBeforeFunding();f.complete();
    if(interference==='incoming-nft')f.state.ownerNftBalance++;
    if(interference==='same-market'){
      f.state.anchors.forEach(anchor=>{anchor[4]=toBeHex(3n,32);for(const i of [8,9,10,11,14,15,18,19])anchor[i]=toBeHex(99n,32);});
      for(let i=25;i<39;i++)f.state.markets[f.pair.marketId][i]=toBeHex(99n,32);
    }
    if(interference==='later-snapshot')m.preparedIssue.mockResolvedValue({transactionHash:hash,amountsTransactionHash:toBeHex(99n,32),
      amounts:{amount0:75n,amount1:40n,totalShares:900n,shares:100n,classId:1n}});
    await expect(f.funding.readFunding(hash)).resolves.toMatchObject({positionId:52n,readyToSign:false,aggregateState:'not-attributed',
      ownerAmountsTransactionHash:interference==='later-snapshot'?toBeHex(99n,32):hash,amounts:{used0:100n,used1:50n,mintedShares:100n}});
  });
  it.each([0,1,2,3,4,5,6])('keeps anchor%s exact before selected funding signature',async index=>{
    const f=await financialFixture(2,true);f.approve();f.state.anchors[index][4]=toBeHex(2n,32);
    await expect(f.funding.assertBeforeFunding()).rejects.toThrow();expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['debit','payout','shares','class','revision','owner','market','source','status','context','runtime','canonical'] as const)(
    'keeps own selected funding %s strict',async fault=>{
      const f=await financialFixture(2,true);f.approve();await f.funding.assertBeforeFunding();const mined=f.complete();
      if(fault==='debit')m.preparedWallets.find(wallet=>wallet.token===f.pair.tokens[0])!.balance--;
      if(fault==='payout')mined.receipt.logs.push({address:f.pair.tokens[0],...tokenAbi.encodeEventLog(tokenAbi.getEvent('Transfer')!,[f.c.core,owner,[999n,0n],[1n,0n]])});
      if(fault==='shares'||fault==='class')m.preparedIssue.mockResolvedValue({transactionHash:hash,
        amounts:{shares:fault==='shares'?101n:100n,classId:fault==='class'?2n:1n}});
      if(fault==='revision')f.state.claim[4]=toBeHex(2n,32);
      if(fault==='owner')f.state.nftOwners['52']=toBeHex(BigInt(f.c.core),32);
      if(fault==='market')Object.assign(f.state,{positionMarket:f.c.pairs[0].marketId});
      if(fault==='source')Object.assign(f.state,{sourceIdForPosition:toBeHex(1n,32)});
      if(fault==='status')f.state.claim[0]=toBeHex(2n,32);
      if(fault==='context')f.state.anchors[0][13]=toBeHex(99n,32);
      if(fault==='runtime')f.state.core[50]=toBeHex(99n,32);
      if(fault==='canonical')f.provider.getTransactionReceipt.mockResolvedValueOnce(mined.receipt).mockResolvedValue({...mined.receipt,blockHash:toBeHex(99n,32)});
      await expect(f.funding.readFunding(hash)).rejects.toThrow();
    });
  it.each([0, 1, 2, 3, 4, 5])('checks market%i against four wallets and exactly two selected approvals', async index => {
    const f = await financialFixture(index);
    expect(m.preparedReadState).toHaveBeenCalledWith(null, { number: 11n, hash });
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
      if (fault === 'selected0' || fault === 'selected1') m.preparedWallets.find(wallet => wallet.token === f.pair.tokens[fault === 'selected0' ? 0 : 1])!.allowance--;
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
  it.each(['unrelated-allowance', 'balance', 'counter', 'escrow', 'missing-wallet'] as const)('rejects %s unfunded cleanup drift', async fault => {
    const f = await financialFixture(1);
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
    const f = await financialFixture(index); f.approve(); await f.funding.assertBeforeFunding(); const mined = f.complete();
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
      const f = await financialFixture(2); f.approve(); await f.funding.assertBeforeFunding(); const mined = f.complete();
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
