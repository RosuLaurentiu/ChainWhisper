import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, keccak256, toBeHex } from '@coti-io/coti-ethers';
import linkArtifact from '../../tests/fixtures/full-candidate-ChainWhisperLinkOTCEscrowV2.json';
import counterArtifact from '../../tests/fixtures/full-candidate-ChainWhisperCounterOTCEscrowV2.json';
import disclosureArtifact from '../../tests/fixtures/full-candidate-ChainWhisperP2PDisclosure.json';
import { TRADE_BALANCE_DISCLOSURE_V2_ABI } from './tradeBalanceDisclosureV2Abi';
import { PRIVATE_BOOK_V2_ACTION_ABI } from './privateBookV2Actions';
import { DIRECT_TRADE_V2_ACTION_ABI } from './directTradeV2Actions';
import { readTradeBalanceDisclosureV2, executeTradeBalanceDisclosureV2, reconcileTradeBalanceDisclosureV2, readTradeBalanceDisclosureV2Pending, readTradeBalanceDisclosureV2Recipients } from './tradeBalanceDisclosureV2';
import { createLinkTradeV2CreationJournal } from './linkTradeV2CreationJournal';
import type { LinkTradeV2CreationStore, LinkTradeV2CreationStoredRow } from './linkTradeV2CreationStore';
const m = vi.hoisted(() => ({ binding: vi.fn(), current: vi.fn(), view: vi.fn(), wait: vi.fn(), decrypt: vi.fn(), latest: vi.fn(), block: vi.fn(), range: vi.fn() }));
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding, assertOwnerTradeV2CapabilityCurrent: m.current,
  assertOwnerTradeV2CapabilitySnapshotCurrent: m.current, waitForOwnerTradeV2Receipt: m.wait, bindOwnerTradeV2MetaMaskCapability: vi.fn() }));
vi.mock('./tradeHistoryV2Chain', () => ({ assertAttestedTradeHistoryV2Deployment: vi.fn(), readAttestedTradeHistoryV2View: m.view,
  readTradeHistoryV2LatestBlockNumber: m.latest, readTradeHistoryV2CanonicalBlock: m.block, readCanonicalTradeV2RawLogRange: m.range }));
vi.mock('./privateUint256', () => ({ decryptPrivateUint256Output: m.decrypt }));
const address = (b: string) => `0x${b.repeat(20)}`, hash = (n: number) => toBeHex(n, 32), maker = address('11'), peer = address('22'), outsider = address('33');
const escrow = address('44'), offer = address('55'), request = address('66'), code = '0x6001';
const ABI = new Interface(TRADE_BALANCE_DISCLOSURE_V2_ABI), LINK = new Interface(linkArtifact.abi), COUNTER = new Interface(counterArtifact.abi),
  BOOK = new Interface(PRIVATE_BOOK_V2_ACTION_ABI), DIRECT = new Interface(DIRECT_TRADE_V2_ACTION_ABI);
const fixture = (kind: boolean | 'private-v2' | 'direct-v2' = false) => {
  const counter = kind === true, book = kind === 'private-v2', direct = kind === 'direct-v2';
  let actor = maker, revision = 1n, status = 1n, amount = 80n, nonce = 0, unknown = false, wrongRecipient = false;
  const grants = new Map<string, { generation: bigint; allowed: boolean }>(), snapshots = new Map<string, unknown[]>(), rows = new Map<string, LinkTradeV2CreationStoredRow>();
  const transactions = new Map(), receipts = new Map();
  const key = (id: string, who: string) => `${id}:${who}`;
  const store: LinkTradeV2CreationStore = {
    claim: async row => { if ([...rows.values()].some(v => v.activeOwner === row.activeOwner)) throw new Error('Another trade is pending.'); rows.set(row.id, structuredClone(row)); },
    read: async id => structuredClone(rows.get(id) ?? null), active: async who => structuredClone([...rows.values()].find(v => v.activeOwner === who) ?? null),
    latest: async who => structuredClone([...rows.values()].filter(v => v.ownerKey === who).slice(-1)[0] ?? null),
    replace: async (row, rev) => { if (rows.get(row.id)?.revision !== rev) throw new Error('Journal changed.'); rows.set(row.id, structuredClone(row)); }
  };
  const ut = (value: bigint) => [[0n, 999n], [0n, value]];
  m.view.mockImplementation(async ({ data, from, deployment }) => {
    expect(from).toBe(actor); expect(deployment.contractAddress).toBe(escrow);
    const protocol = counter ? COUNTER : book ? BOOK : direct ? DIRECT : LINK, base = protocol.parseTransaction({ data });
    if (base?.name === (counter ? 'getCounter' : direct ? 'getTradeView' : 'getOrderView')) return counter ? COUNTER.encodeFunctionResult('getCounter', [
      [maker, peer, offer, request, hash(5), hash(6), hash(7), 0n, 0n, 1n, status, true, status === 1n], [0n, 0n], status])
      : book ? BOOK.encodeFunctionResult('getOrderView', [[[maker, status, 0n, [2n, offer, 0n], [2n, request, 0n], [1n, 2n], [false, 0n, 0n], 1n, 0n, revision, 0n, 1n, status === 1n, hash(5), hash(6)], status, hash(7), 0n, 0n]])
        : direct ? DIRECT.encodeFunctionResult('getTradeView', [[[maker, peer, status, 1n, [2n, offer], [2n, request], 1n, 0n, 0n, 1n, 0n, status === 1n, hash(5), hash(6)], [0n, 0n], status, 0n, 0n, 0n]])
          : LINK.encodeFunctionResult('getOrderView', [[[maker, offer, request, hash(5), hash(6), hash(7), 0n, revision, 1n, status, true, true], status, [0n, 0n], 0n, 0n, '0x01', hash(8)]]);
    const call = ABI.parseTransaction({ data })!, id = call.args.id.toString(), grant = grants.get(key(id, call.name === 'getTradeBalanceAccess' ? call.args.recipient.toLowerCase() : actor)) ?? { generation: 0n, allowed: false };
    if (call.name === 'getTradeBalanceAccess') return ABI.encodeFunctionResult(call.name, [grant]);
    const snapshot = snapshots.get(key(id, actor));
    if (actor !== maker && !grant.allowed || !snapshot || snapshot[1] !== (counter || direct ? 1n : revision) || snapshot[2] !== grant.generation || snapshot[3] !== status) throw new Error('Snapshot unavailable or stale.');
    return ABI.encodeFunctionResult(call.name, [snapshot]);
  });
  m.decrypt.mockImplementation((_signer, ct) => { const value = BigInt(ct.ciphertextLow); if (value === 999n) throw new Error('Foreign ciphertext.'); return value; });
  const provider = { getNetwork: vi.fn(async () => ({ chainId: 7082400n })), getFeeData: vi.fn(async () => ({ gasPrice: 2n })), getBalance: vi.fn(async () => 1000000n),
    getTransactionCount: vi.fn(async () => nonce), estimateGas: vi.fn(async () => 100n),
    getBlock: vi.fn(async (n: string | number) => ({ number: n === 'latest' ? 10 : Number(n), hash: hash(999), timestamp: 1, gasLimit: 10000n, transactions: [...transactions.keys()] })),
    getTransaction: vi.fn(async h => transactions.get(h)), getTransactionReceipt: vi.fn(async h => receipts.get(h) ?? null) };
  const signer = { getUserOnboardInfo: () => ({ aesKey: '01'.repeat(16) }), sendTransaction: vi.fn(async (call: Record<string, unknown>) => {
    expect(call.to).toBe(escrow); expect(call.value).toBe(0n);
    const parsed = ABI.parseTransaction({ data: call.data as string })!, id = parsed.args.id.toString();
    const h = hash(++nonce), blockNumber = nonce + 10, tx = { ...call, from: actor, hash: h, chainId: 7082400n };
    let encoded;
    if (parsed.name === 'setTradeBalanceAccess') {
      const recipient = parsed.args.recipient.toLowerCase(), value = grants.get(key(id, recipient)) ?? { generation: 0n, allowed: false };
      value.generation++; value.allowed = parsed.args.allowed; grants.set(key(id, recipient), value); snapshots.delete(key(id, recipient));
      encoded = ABI.encodeEventLog(ABI.getEvent('TradeBalanceConsent')!, [id, wrongRecipient ? outsider : recipient, value.allowed, value.generation]);
    } else {
      const grant = grants.get(key(id, actor)) ?? { generation: 0n, allowed: false };
      const snapshot = [true, counter || direct ? 1n : revision, grant.generation, status, ut(amount)]; snapshots.set(key(id, actor), snapshot);
      encoded = ABI.encodeEventLog(ABI.getEvent('TradeBalanceSnapshot')!, [id, actor, counter || direct ? 1n : revision, grant.generation, status, ut(amount)]);
    }
    transactions.set(h, tx); receipts.set(h, { hash: h, from: actor, to: escrow, status: 1, blockNumber, blockHash: hash(999), gasUsed: 80n, gasPrice: 2n,
      logs: [{ address: escrow, ...encoded, transactionHash: h, blockHash: hash(999), blockNumber, index: 0, removed: false }] }); return tx;
  }) };
  const protocol = counter ? 'counter-v2' as const : book ? 'private-v2' as const : direct ? 'direct-v2' as const : 'link-v2' as const;
  const capability = {} as never, deployment = { protocol, chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: keccak256(code), deploymentBlock: '10', finalityLagBlocks: '2' } as never;
  const input = () => ({ capability, deployment, readCapability: {} as never,
    admission: { protocol, chainId: '7082400', contractAddress: escrow, runtimeBytecodeHash: keccak256(code), mode: 'active' as const, variants: ['private-pair'] as const },
    journal: createLinkTradeV2CreationJournal({ capability, deployment, store, ...(book || direct ? { purpose: 'disclosure' as const } : {}) }).forDisclosure() });
  m.binding.mockImplementation(() => ({ chainId: 7082400n, ownerAddress: actor, signer, readProvider: provider }));
  m.wait.mockImplementation(async (_binding, h) => { if (unknown) throw new Error('RPC unavailable.'); return receipts.get(h); });
  m.latest.mockResolvedValue('40'); m.block.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber.toString(), hash: hash(Number(blockNumber)) }));
  m.range.mockImplementation(async ({ fromBlock, toBlock }) => ({ range: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), toBlockHash: hash(Number(toBlock)) },
    logs: [...receipts.values()].flatMap(r => r.logs).filter(v => v.topics[0] === ABI.getEvent('TradeBalanceConsent')!.topicHash && BigInt(v.blockNumber) >= fromBlock && BigInt(v.blockNumber) <= toBlock).map(v => ({ ...v, logIndex: '0x0' })) }));
  return { input, signer, provider, rows, grants, snapshots, tradeJournal: () => createLinkTradeV2CreationJournal({ capability, deployment, store }), changeActor: (who: string) => { actor = who; }, partial: () => { revision++; amount = 30n; },
    close: () => { status = 3n; amount = 0n; }, unknown: () => { unknown = true; }, restore: () => { unknown = false; }, wrongRecipient: () => { wrongRecipient = true; } };
};
beforeEach(() => vi.resetAllMocks());
describe('private trade balance consent; selected ABI, real sender/encrypted journal, modelled RPC and native decryption', () => {
  it.each(['private-v2', 'direct-v2'] as const)('reuses consent, snapshots, revoke and uncertain recovery for %s without wallet balances', async protocol => {
    const f = fixture(protocol); f.changeActor(peer);
    expect(await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).toMatchObject({ availability: 'off' });
    f.changeActor(maker); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true });
    f.changeActor(peer); f.unknown();
    await expect(executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'snapshot' })).rejects.toThrow(/RPC unavailable/);
    f.restore(); await reconcileTradeBalanceDisclosureV2(f.input());
    expect(await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).toMatchObject({ availability: 'current', balance: '80', variant: 'private-pair' });
    f.changeActor(maker); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: false });
    f.changeActor(peer); const revoked = await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' });
    expect(revoked.availability).toBe('off'); expect(revoked).not.toHaveProperty('balance');
  });
  it('holds an unqualified disclosure before any capability, state read or signing', async () => {
    const f = fixture('private-v2'), input = f.input();
    await expect(executeTradeBalanceDisclosureV2({ ...input, admission: undefined, orderId: '1', kind: 'snapshot' })).rejects.toThrow(/unavailable/);
    expect(m.view).not.toHaveBeenCalled(); expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('matches the selected Link/Counter functions and linked-library event ABI', () => {
    for (const f of ABI.fragments) {
      if (f.type === 'event') expect(new Interface(disclosureArtifact.abi).getEvent(f.format('sighash'))!.format('full')).toBe(f.format('full'));
      else for (const source of [LINK, COUNTER]) expect(source.getFunction(f.format('sighash'))!.format('full')).toBe(f.format('full'));
    }
  });
  it.each([false, true])('keeps access off, grants one recipient, refreshes, updates and revokes without wallet-token balance reads, counter=%s', async counter => {
    const f = fixture(counter); f.changeActor(peer);
    expect(await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).toMatchObject({ availability: 'off', grant: { allowed: false, generation: '0' } });
    await expect(executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'snapshot' })).rejects.toThrow(/permission/);
    f.changeActor(maker); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true });
    f.changeActor(peer); expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).balance).toBeUndefined();
    await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'snapshot' });
    expect(await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).toMatchObject({ availability: 'current', balance: '80' });
    f.changeActor(maker); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true });
    f.changeActor(peer); expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).balance).toBeUndefined();
    f.changeActor(maker); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: false });
    f.changeActor(peer); m.view.mockClear(); expect(await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).toMatchObject({ availability: 'off' });
    expect(m.view.mock.calls.some(([r]) => ABI.parseTransaction({ data: r.data })?.name === 'getTradeBalanceSnapshot')).toBe(false);
    expect(f.signer.sendTransaction).toHaveBeenCalledTimes(4);
    expect([...f.rows.values()].every(r => !r.sealed.includes('balance'))).toBe(true);
  });
  it('keeps separate trades/recipients isolated and clears a Link snapshot after its revision changes', async () => {
    const f = fixture(); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true }); f.changeActor(peer);
    await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'snapshot' }); f.partial();
    expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).balance).toBeUndefined();
    expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '2' })).availability).toBe('off');
    f.changeActor(outsider); expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).availability).toBe('off');
  });
  it('lets the maker refresh its own escrow without consent, including an exact closed zero', async () => {
    const f = fixture(true); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'snapshot' });
    expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).balance).toBe('80'); f.close();
    expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).balance).toBeUndefined();
    await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'snapshot' });
    expect((await readTradeBalanceDisclosureV2({ ...f.input(), orderId: '1' })).balance).toBe('0');
  });
  it('restricts Counter grants to the fixed taker and rejects self/non-maker grants before sending', async () => {
    const f = fixture(true);
    for (const recipient of [maker, outsider]) await expect(executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient, allowed: true })).rejects.toThrow();
    f.changeActor(peer); await expect(executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true })).rejects.toThrow();
    expect(f.signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('retains fees/hash for an unknown send and reconciles without another transaction', async () => {
    const f = fixture(); const input = f.input(); f.unknown();
    await expect(executeTradeBalanceDisclosureV2({ ...input, orderId: '1', kind: 'grant', recipient: peer, allowed: true })).rejects.toThrow(/RPC/);
    expect(await readTradeBalanceDisclosureV2Pending(input)).toMatchObject({ active: true, last: { state: 'submitted', transactionHash: hash(1) } });
    await expect(executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true })).rejects.toThrow(/pending/);
    f.restore(); expect(await reconcileTradeBalanceDisclosureV2(input)).toMatchObject({ generation: '1', recipient: peer });
    expect(f.signer.sendTransaction).toHaveBeenCalledOnce(); expect(await input.journal.read()).toMatchObject({ active: false, feeWei: '160' });
  });
  it('holds a wrong-recipient receipt and keeps exact fees', async () => {
    const f = fixture(); const input = f.input(); f.wrongRecipient();
    await expect(executeTradeBalanceDisclosureV2({ ...input, orderId: '1', kind: 'grant', recipient: peer, allowed: true })).rejects.toThrow(/receipt/);
    expect(await input.journal.read()).toMatchObject({ active: true, feeWei: '160' });
  });
  it('preserves the prior trade recovery and one wallet lock across consent records', async () => {
    const f = fixture(), trade = f.tradeJournal();
    await trade.assertNoPending(); await trade.onRecovery({ context: { chainId: '7082400', escrow, maker, makerNonce: hash(7), credentialEpoch: '1' },
      secret: hash(8), terms: { offerToken: offer, requestToken: request, privatePair: true, priceOffer: '1', priceRequest: '2', expiresAt: '0' }, offerBudget: '100', beforeBalance: '1000', offerCodeHash: hash(5) });
    const call = { step: 'create' as const, nonce: 0, chainId: '7082400', owner: maker, to: escrow, state: 'sending' as const, dataHash: hash(5), gasLimit: '100', gasPrice: '2' };
    await trade.onPending(call); await trade.onPending({ ...call, state: 'submitted', transactionHash: hash(44) });
    await trade.onPending({ ...call, state: 'confirmed', transactionHash: hash(44), gasUsed: '80', feeWei: '160', blockNumber: '10', blockHash: hash(999) });
    const original = await trade.read(); f.unknown();
    await expect(executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true })).rejects.toThrow();
    await expect(f.tradeJournal().assertNoPending()).rejects.toThrow(/pending/);
    f.restore(); await reconcileTradeBalanceDisclosureV2(f.input());
    expect(await f.tradeJournal().read()).toEqual(original);
  });
  it('rebuilds recipient choices from canonical consent events with bounded pages', async () => {
    const f = fixture(); await executeTradeBalanceDisclosureV2({ ...f.input(), orderId: '1', kind: 'grant', recipient: peer, allowed: true });
    expect(await readTradeBalanceDisclosureV2Recipients({ ...f.input(), orderId: '1' })).toMatchObject({ recipients: [peer], complete: true });
    m.latest.mockResolvedValue('5000');
    expect(await readTradeBalanceDisclosureV2Recipients({ ...f.input(), orderId: '1' })).toMatchObject({ complete: false, cursor: { number: '2057' } });
  });
});
