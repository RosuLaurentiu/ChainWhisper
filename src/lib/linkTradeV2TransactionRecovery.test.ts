import { describe, expect, it, vi } from 'vitest';
import { keccak256 } from '@coti-io/coti-ethers';
import { findLinkTradeV2Transaction } from './linkTradeV2TransactionRecovery';
import type { LinkTradeV2CreationRecord } from './linkTradeV2CreationFlow';

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const owner = `0x${'11'.repeat(20)}`, escrow = `0x${'22'.repeat(20)}`;
const fixture = () => {
  const record: { -readonly [K in keyof LinkTradeV2CreationRecord]: LinkTradeV2CreationRecord[K] } = { step: 'create', state: 'sending', chainId: '7082400', owner, to: escrow,
    nonce: 7, dataHash: keccak256('0x1234'), gasLimit: '125', gasPrice: '2', admission: { number: '10', hash: hash(10) } };
  const tx = { hash: hash(100), from: owner, to: escrow, nonce: 7, chainId: 7082400n, data: '0x1234', value: 0n,
    gasLimit: 125n, gasPrice: 2n, maxFeePerGas: null };
  const receipt = { hash: tx.hash, gasPrice: 2n, status: 1 };
  let minedAt = 12;
  const provider = {
    getTransactionReceipt: vi.fn(async (h: string) => h === tx.hash ? receipt : null),
    getTransaction: vi.fn(async () => tx), getTransactionCount: vi.fn(async () => 8),
    getBlock: vi.fn(async (n: number | string, _full = false) => {
      const number = n === 'latest' ? 40 : Number(n), transactions = number === minedAt ? [tx.hash] : [];
      return { number, hash: hash(number), parentHash: hash(number - 1), transactions, prefetchedTransactions: transactions.map(() => tx) };
    })
  };
  const journal = { advanceSearch: vi.fn(async (_nonce: number, search: NonNullable<LinkTradeV2CreationRecord['search']>) => { record.search = search; }) };
  const find = (transactionHash?: string) => findLinkTradeV2Transaction(provider as never, record, journal, transactionHash);
  return { record, tx, receipt, provider, journal, find, at: (n: number) => { minedAt = n; } };
};
describe('finite Link transaction recovery; read-only RPC mocks', () => {
  it('finds a lost hash by exact owner and nonce without changing the reserved call', async () => {
    const f = fixture(), found = await f.find();
    expect(found?.record).toMatchObject({ state: 'submitted', transactionHash: f.tx.hash,
      nonce: 7, dataHash: f.record.dataHash, gasPrice: '2', mined: { transactionHash: f.tx.hash, gasPrice: '2' } });
    expect(f.provider.getBlock.mock.calls.filter(([, full]) => full)).toHaveLength(3);
    expect(f.journal.advanceSearch).not.toHaveBeenCalled();
  });
  it('saves at most 16 scanned blocks and resumes at the next block', async () => {
    const f = fixture(); f.at(30);
    expect(await f.find()).toBeNull();
    expect(f.provider.getBlock.mock.calls.filter(([, full]) => full)).toHaveLength(16);
    expect(f.record.search).toEqual({ throughBlock: '25', blockHash: hash(25), headBlock: '40' });
    f.provider.getBlock.mockClear();
    expect((await f.find())?.record.transactionHash).toBe(f.tx.hash);
    expect(f.provider.getBlock.mock.calls.filter(([, full]) => full).map(([n]) => n)).toEqual([26, 27, 28, 29, 30]);
  });
  it('recovers the exact saved native value and holds a different original value', async () => {
    const f = fixture(); f.record.value = '3'; f.tx.value = 3n;
    const found = await f.find();
    expect(found?.record.mined).toMatchObject({ value: '3', transactionHash: f.tx.hash });
    expect(found?.record.mined?.outcome).toBeUndefined();
    const changed = fixture(); changed.record.value = '3'; changed.record.transactionHash = changed.tx.hash;
    await expect(changed.find()).rejects.toThrow(/original transaction/);
    const cancelled = fixture(); cancelled.record.value = '3'; cancelled.tx.to = owner; cancelled.tx.data = '0x';
    expect((await cancelled.find())?.record.mined?.outcome).toBe('cancelled');
  });
  it('does not scan, poll or release when the reserved nonce is not mined', async () => {
    const f = fixture(); f.provider.getTransactionCount.mockResolvedValue(7);
    expect(await f.find()).toBeNull(); expect(f.provider.getBlock).not.toHaveBeenCalled();
    expect(f.journal.advanceSearch).not.toHaveBeenCalled();
  });
  it('records a same-call speedup separately from original hash, gas and fees', async () => {
    const f = fixture(); f.record.state = 'submitted'; f.record.transactionHash = hash(90); f.tx.gasPrice = 4n; f.receipt.gasPrice = 4n;
    const found = await f.find();
    expect(found?.record).toMatchObject({ transactionHash: hash(90), gasPrice: '2', mined: { transactionHash: f.tx.hash, gasPrice: '4' } });
    expect(found?.record.mined?.outcome).toBeUndefined();
  });
  it.each(['cancelled', 'replaced', 'reverted'])('distinguishes a canonical %s call without claiming business success', async outcome => {
    const f = fixture();
    if (outcome === 'reverted') f.receipt.status = 0;
    else { f.tx.to = outcome === 'cancelled' ? owner : escrow; f.tx.data = '0x'; }
    expect((await f.find())?.record.mined?.outcome).toBe(outcome);
  });
  it('accepts an exceptional wallet hash for a legacy request, but rejects wrong owner, nonce or chain', async () => {
    const f = fixture(); delete f.record.admission;
    expect((await f.find(f.tx.hash))?.record.transactionHash).toBe(f.tx.hash);
    for (const field of ['owner', 'nonce', 'chain']) {
      const g = fixture();
      if (field === 'owner') g.tx.from = escrow;
      if (field === 'nonce') g.tx.nonce++;
      if (field === 'chain') g.tx.chainId = 1n;
      await expect(g.find(g.tx.hash)).rejects.toThrow(/wallet, chain and nonce/);
      expect(g.journal.advanceSearch).not.toHaveBeenCalled();
    }
  });
  it('holds a missing legacy anchor, changed anchor or cursor, broken ancestry and unavailable full blocks', async () => {
    for (const fault of ['legacy', 'anchor', 'cursor', 'ancestry', 'full']) {
      const f = fixture();
      if (fault === 'legacy') delete f.record.admission;
      if (fault === 'anchor') f.record.admission = { number: '10', hash: hash(999) };
      if (fault === 'cursor') f.record.search = { throughBlock: '11', blockHash: hash(999), headBlock: '40' };
      if (fault === 'ancestry' || fault === 'full') {
        const read = f.provider.getBlock.getMockImplementation()!;
        f.provider.getBlock.mockImplementation(async (n, full) => {
          const block = await read(n, full);
          return fault === 'ancestry' && n === 11 ? { ...block, parentHash: hash(999) }
            : fault === 'full' && n === 12 ? { ...block, prefetchedTransactions: [] } : block;
        });
      }
      await expect(f.find()).rejects.toThrow(); expect(f.journal.advanceSearch).not.toHaveBeenCalled();
    }
  });
  it('stops on one RPC failure and does not save partial search progress', async () => {
    const f = fixture(); f.provider.getBlock.mockRejectedValueOnce(new Error('403'));
    await expect(f.find()).rejects.toThrow('403'); expect(f.provider.getBlock).toHaveBeenCalledOnce();
    expect(f.journal.advanceSearch).not.toHaveBeenCalled();
  });
  it('rejects changed mined metadata and a changed call under the original hash', async () => {
    const f = fixture(); f.record.transactionHash = f.tx.hash; f.tx.data = '0x';
    await expect(f.find()).rejects.toThrow(/original transaction/);
    const g = fixture(), found = await g.find(); g.record.mined = found!.record.mined;
    g.tx.gasPrice = 3n; g.receipt.gasPrice = 3n;
    await expect(g.find()).rejects.toThrow(/Saved recovery transaction changed/);
  });
});
