import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import { issueCurrentDexPoolPositionCapability, assertCurrentPoolPositionPrepared } from './currentDexPoolPositionCapability';
import { STAGED_PREPARED_DEX_CANDIDATE as c } from '../../lib/dexV2Deployment';
import { currentPoolPositionAbi as abi, currentPoolNftAbi as nft } from '../../lib/currentDexPoolPosition';
import type { PreparedPoolStoredState } from '../../lib/currentDexPreparedPoolSnapshot';

// The financial/snapshot checkers are real. Chain access and owner encryption are
// isolated inputs here; the unmocked reader suite supplies its separate boundary.
const mocks = vi.hoisted(() => ({ issue: vi.fn(), graph: vi.fn(), reader: vi.fn(), wide: vi.fn(), decrypt: vi.fn() }));
vi.mock('./ownerCotiMetaMaskCapability', () => ({ issueOwnerCotiMetaMaskCapability: mocks.issue }));
vi.mock('../../lib/dexV2Chain', async original => ({ ...await original<typeof import('../../lib/dexV2Chain')>(), readCurrentSharedPoolDexGraph: mocks.graph }));
vi.mock('../../lib/currentDexPreparedPoolSnapshot', async original => ({ ...await original<typeof import('../../lib/currentDexPreparedPoolSnapshot')>(), createPreparedOwnerPoolSnapshotReader: mocks.reader }));
vi.mock('../../lib/privateUint256', () => ({ encryptPrivateUint256Input: mocks.wide, decryptPrivateUint256Output: mocks.decrypt, encryptPrivateUint128Input: vi.fn() }));
const word = (n: bigint | number) => toBeHex(n, 32), empty = (n: number) => Array.from({ length: n }, () => word(0));
const owner = toBeHex(123n, 20), id = 43n, sourceHash = word(700), closeHash = word(701), snapshotHash = word(702);
const transfers = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer V)[] ? Mutable<V>[] : T[K] extends object ? Mutable<T[K]> : T[K] };

async function fixture(pairIndex = 0) {
  vi.clearAllMocks(); const pair = c.pairs[pairIndex];
  const before: Mutable<PreparedPoolStoredState> = { graph: c.graph, marketId: pair.marketId, positionId: id,
    block: { number: 100n, hash: word(100) }, market: { marketId: pair.marketId, canonicalId: BigInt(pair.canonicalId), registryRevision: 7n,
      marketRevision: 1n, enabled: true, token0: pair.tokens[0], token1: pair.tokens[1], engine: pair.engine, poolTerms: pair.poolTerms,
      companions: pair.companions.map(([role, address, runtimeHash]) => ({ role, address, runtimeHash })) },
    claim: empty(64), anchors: [], core: empty(149), markets: {}, claims: {}, c1: {}, ledgers: {}, escrows: {}, custody: {},
    nftOwners: {}, nftMinted: {}, ownerNftBalance: 1n, engines: {}, directories: {}, fixedSources: {}, counter: id, operation: 7n };
  before.core[11] = word(id); before.core[12] = word(7);
  c.pairs.forEach((p, k) => {
    const raw = empty(71); raw[0] = c.releaseId; raw[1] = p.marketId; raw[2] = word(BigInt(p.tokens[0])); raw[3] = word(BigInt(p.tokens[1]));
    before.markets[p.marketId] = raw; before.engines[p.marketId] = empty(46); before.c1[p.marketId] = empty(49); before.directories[p.marketId] = [];
    for (let i = 0; i < 7; i++) {
      const anchorId = k * 7 + i + 1, a = empty(64); a[0] = word(1); a[4] = word(2); a[62] = word(i);
      raw[18 + i] = word(anchorId); before.claims[String(anchorId)] = { marketId: p.marketId, words: a };
      before.nftOwners[String(anchorId)] = word(0); before.nftMinted[String(anchorId)] = word(0); if (k === pairIndex) before.anchors.push(a);
    }
  });
  Object.assign(before.claim, { 0: word(1), 4: word(3), 5: word(1), 6: word(1), 7: word(1), 13: word(77), 59: word(1) });
  before.claims[String(id)] = { marketId: pair.marketId, words: before.claim }; before.nftOwners[String(id)] = word(BigInt(owner)); before.nftMinted[String(id)] = word(1);
  c.tokens.forEach(([token]) => { before.ledgers[token] = empty(12); before.escrows[token] = empty(2); before.custody[token] = empty(4); });
  const amounts = { amount0: 20n, amount1: 40n, shares: 10n, totalShares: 100n, classId: 0n };
  const wallets = c.tokens.map(([token]) => ({ token, balance: 100n, allowance: 0n }));
  const managed = structuredClone(before); managed.block = { number: 101n, hash: word(101) };
  Object.assign(managed.claim, { 0: word(4), 4: word(4), 6: word(2), 12: word(BigInt(owner)), 13: word(78),
    22: word(101), 23: word(102), 60: word(101), 61: word(102) });
  managed.nftOwners[String(id)] = word(0); managed.ownerNftBalance = 0n;
  managed.anchors.forEach(a => { a[4] = word(3); [8, 9, 10, 11].forEach((i, j) => { a[i] = word(100 + j); a[[14, 15, 18, 19][j]] = a[i]; }); });
  const snapshot = structuredClone(managed); snapshot.block = { number: 102n, hash: word(102) };
  for (let i = 14; i < 54; i++) if ((i - 14) % 4 >= 2) snapshot.claim[i] = word(i + 300);
  const paidWallets = wallets.map(v => ({ ...v, balance: v.balance + (v.token === pair.tokens[0] ? 20n : v.token === pair.tokens[1] ? 40n : 0n) }));
  const nftAddress = c.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
  const logs: { address: string; topics: string[]; data: string }[] = pair.tokens.map((token, i) => ({ address: token, ...transfers.encodeEventLog(transfers.getEvent('Transfer')!, [c.core, owner, [999n, 0n], [1n, i ? 40n : 20n]]) }));
  logs.push({ address: nftAddress, ...nft.encodeEventLog(nft.getEvent('Transfer')!, [owner, toBeHex(0n, 20), id]) });
  let state = before, active = true, closeData = '0x';
  const proofs = new Map([[sourceHash, { block: before.block, data: abi.encodeFunctionData('poolSnapshot', [id]), logs: [] as typeof logs }],
    [closeHash, { block: managed.block, get data() { return closeData; }, logs }],
    [snapshotHash, { block: snapshot.block, data: abi.encodeFunctionData('poolSnapshot', [id]), logs: [] as typeof logs }]]);
  const reader = { state: vi.fn(async () => structuredClone(state)), wallets: vi.fn(async () => structuredClone(state === before ? wallets : paidWallets)),
    canonical: vi.fn(async (hash: string) => { const value = proofs.get(hash); return value ? structuredClone(value) : null; }),
    issue: vi.fn(async (_id: bigint, kind: string, hash: string) => ({ kind, positionId: id, marketId: pair.marketId,
      block: state.block, transactionHash: hash, status: BigInt(state.claim[0]), context: state.claim[13], revisions: state.claim.slice(4, 8).map(BigInt),
      amounts: { ...amounts, shares: state === before ? 10n : 0n } })), current: vi.fn(async p => p) };
  const signer = { getUserOnboardInfo: () => ({ aesKey: 'synthetic' }) }, guard = async () => { if (!active) throw new Error('Revoked session'); };
  const provider = { send: vi.fn(async (method: string, params: unknown[]) => {
    if (method === 'eth_getBlockByNumber') return { number: toBeHex(state.block.number), hash: state.block.hash };
    if (method === 'eth_getStorageAt') return pair.marketId;
    const call = params[0] as { data: string; to: string }, parsed = abi.parseTransaction({ data: call.data });
    if (parsed?.name === 'poolPublicState') return abi.encodeFunctionResult('poolPublicState', [{ status: BigInt(state.claim[0]), sourceId: 0n,
      bucket0Id: 0n, bucket1Id: 0n, positionRevision: BigInt(state.claim[4]), ownershipRevision: BigInt(state.claim[5]),
      lifecycleRevision: BigInt(state.claim[6]), termsRevision: 1n, context: state.claim[13] }]);
    return nft.encodeFunctionResult('ownerOf', [owner]);
  }), getTransactionReceipt: vi.fn(async (hash: string) => ({ hash, blockHash: proofs.get(hash)!.block.hash, index: hash === closeHash ? 0 : 1 })) };
  mocks.reader.mockReturnValue(reader); mocks.graph.mockImplementation(async ({ blockNumber, blockHash }) => ({ graph: c.graph, packageSha256: c.packageSha256,
    chainId: BigInt(c.chainId), core: c.core, genesisHash: c.genesisHash, block: { number: blockNumber, hash: blockHash } }));
  mocks.wide.mockImplementation(async (_, value) => ({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: value }, signature: `0x${'44'.repeat(65)}` }));
  mocks.decrypt.mockImplementation((_, value) => value.ciphertextLow);
  mocks.issue.mockImplementation(async args => args.bindCapability({ signer, readProvider: provider, ownerAddress: owner, chainId: BigInt(c.chainId), assertCurrent: guard, assertSnapshotCurrent: () => {} }));
  const issue = () => issueCurrentDexPoolPositionCapability({ candidate: 'cheap-prepared' } as never), cap = await issue();
  const request = { positionId: id, action: 'close' as const, expectedContext: before.claim[13], producerHash: sourceHash,
    minimums: [20n, 40n] as const, confirm: vi.fn(async () => true) };
  const prepare = async () => { const p = (await cap.prepareAction(request))!; closeData = p.data; return p; };
  return { cap, issue, prepare, request, signer, reader, provider, before, managed, snapshot, wallets, paidWallets, logs, proofs,
    setState: (s: typeof before) => { state = s; }, revoke: () => { active = false; } };
}

describe('prepared close-to-snapshot capability', () => {
  it.each([0, 1, 2, 3, 4, 5])('checks exact payout and separate snapshot on pair %i', async index => {
    const f = await fixture(index), p = await f.prepare(); assertCurrentPoolPositionPrepared(p, f.signer);
    expect(mocks.wide.mock.calls.map(call => call.slice(1, 4))).toEqual([20n, 40n].map(value => [value, c.core, abi.getFunction('managePoolPosition')!.selector]));
    f.setState(f.managed); expect(await p.readResult(closeHash)).toMatchObject({ status: 'closed-proof-required', privateAccountingVerified: false, payouts: [20n, 40n] });
    const next = await f.issue(), paid = (await next.prepareSnapshot({ positionId: id, confirm: async () => true }))!;
    f.setState(f.snapshot); expect(await paid.readResult(snapshotHash)).toMatchObject({ status: 'closed-proof-verified', privateAccountingVerified: true, snapshot: { amounts: { shares: 0n, amount0: 20n, amount1: 40n } } });
  });
  it.each(['cancel', 'stale', 'minimum', 'unsupported'])('rejects %s before input signing', async fault => {
    const f = await fixture(); if (fault === 'cancel') f.request.confirm.mockResolvedValue(false);
    if (fault === 'stale') f.request.expectedContext = word(999);
    const request = fault === 'minimum' ? { ...f.request, minimums: [21n, 40n] as const } : fault === 'unsupported' ? { ...f.request, action: 'withdraw' as const } : f.request;
    if (fault === 'cancel') expect(await f.cap.prepareAction(request)).toBeNull(); else await expect(f.cap.prepareAction(request)).rejects.toThrow();
    expect(mocks.wide).not.toHaveBeenCalled();
  });
  it.each(['balance', 'allowance', 'claim', 'revoked'])('rejects %s changes before send', async fault => {
    const f = await fixture(), p = await f.prepare(); if (fault === 'balance') f.wallets[3].balance++;
    if (fault === 'allowance') f.wallets[2].allowance++; if (fault === 'claim') f.before.claim[13] = word(999); if (fault === 'revoked') f.revoke();
    await expect(p.assertBeforeSend()).rejects.toThrow();
  });
  it.each(['payout', 'duplicate', 'wallet', 'other-market', 'call', 'receipt'])('rejects %s close proof', async fault => {
    const f = await fixture(), p = await f.prepare(); f.setState(f.managed);
    if (fault === 'payout') f.logs[0] = { ...f.logs[0], ...transfers.encodeEventLog(transfers.getEvent('Transfer')!, [c.core, owner, [999n, 0n], [1n, 21n]]) };
    if (fault === 'duplicate') f.logs.push(f.logs[0]); if (fault === 'wallet') f.paidWallets[3].balance++;
    if (fault === 'other-market') f.managed.markets[c.pairs[1].marketId][11] = word(999);
    if (fault === 'call') f.proofs.set(closeHash, { ...f.proofs.get(closeHash)!, data: '0x12345678' });
    if (fault === 'receipt') f.reader.canonical.mockResolvedValueOnce(f.proofs.get(closeHash)!).mockResolvedValueOnce(null);
    await expect(p.readResult(closeHash)).rejects.toThrow();
  });
  it.each(['shares', 'total', 'payout', 'wallet', 'protected', 'manage-reorg', 'order'])('rejects %s final snapshot proof', async fault => {
    const f = await fixture(), p = await f.prepare(); f.setState(f.managed); await p.readResult(closeHash);
    const paid = (await (await f.issue()).prepareSnapshot({ positionId: id, confirm: async () => true }))!; f.setState(f.snapshot);
    if (['shares', 'total', 'payout'].includes(fault)) f.reader.issue.mockImplementationOnce(async (...args) => {
      const result = await f.reader.issue.getMockImplementation()!(...args); result.amounts[fault === 'shares' ? 'shares' : fault === 'total' ? 'totalShares' : 'amount0']++; return result;
    });
    if (fault === 'wallet') f.paidWallets[0].balance++; if (fault === 'protected') f.snapshot.core[10] = word(999);
    if (fault === 'manage-reorg') f.proofs.set(closeHash, { ...f.proofs.get(closeHash)!, data: '0x12345678' });
    if (fault === 'order') { f.snapshot.block.number = 101n; f.snapshot.block.hash = word(101); f.provider.getTransactionReceipt.mockImplementation(async hash => ({ hash, blockHash: word(101), index: hash === closeHash ? 1 : 0 })); }
    await expect(paid.readResult(snapshotHash)).rejects.toThrow();
  });
});
