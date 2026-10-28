import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { createLinkTradeV2ActivityReader, mergeLinkTradeV2ActivitySnapshots, type LinkTradeV2ActivitySnapshot } from './linkTradeV2Activity';
import type { TradeHistoryV2RawLog } from './tradeHistoryV2Events';
import { TradeHistoryV2RangeLimitError } from './tradeHistoryV2Chain';
const m = vi.hoisted(() => ({ latest: vi.fn(), block: vi.fn(), range: vi.fn(), view: vi.fn(), binding: vi.fn(), current: vi.fn(), decrypt: vi.fn() }));
vi.mock('./tradeHistoryV2Chain', () => {
  class TradeHistoryV2RangeLimitError extends Error {}
  return { TradeHistoryV2RangeLimitError, TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS: 2_048n,
    TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS: 100_000n,
    assertAttestedTradeHistoryV2Deployment: vi.fn(), readTradeHistoryV2LatestBlockNumber: m.latest,
    readTradeHistoryV2CanonicalBlock: m.block, readCanonicalTradeV2RawLogRange: m.range, readAttestedTradeHistoryV2View: m.view };
});
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding, assertOwnerTradeV2CapabilityCurrent: m.current }));
vi.mock('./privateUint256', () => ({ decryptPrivateUint256Output: m.decrypt }));
const addr = (b: string) => `0x${b.repeat(20)}`, hash = (n: number) => toBeHex(n + 1, 32);
const owner = addr('11'), other = addr('22'), escrow = addr('33'), offer = addr('44'), request = addr('55');
const id = '9007199254740993', foreign = '9007199254740995', ABI = new Interface(LINK_TRADE_V2_ABI);
it('merges current and retained Link activity without merging equal contract-local IDs or complete coverage', () => {
  const snapshot = (target: string, block: string, complete: boolean): LinkTradeV2ActivitySnapshot => ({
    orders: [{ maker: owner, offerToken: offer, requestToken: request, privatePair: true, expiresAt: '0', status: 'Open', enabled: true,
      reference: { chainId: '7082400', escrow: target, id: '1', revision: '1', credentialEpoch: '1' } }],
    history: [{ maker: owner, offerToken: offer, requestToken: request, privatePair: true, expiresAt: '0', key: target + ':event',
      chainId: '7082400', escrow: target, orderId: '1', transactionHash: hash(7), blockNumber: block, kind: 'created', role: 'maker' }],
    complete, throughBlock: block, safeHead: '50', phase: 'scan'
  });
  const combined = mergeLinkTradeV2ActivitySnapshots([snapshot(addr('11'), '40', true), snapshot(addr('22'), '30', false)]);
  expect(combined.orders).toHaveLength(2); expect(combined.history).toHaveLength(2);
  expect(combined.history.map(row => row.escrow)).toEqual([addr('11'), addr('22')]);
  expect(combined.complete).toBe(false); expect(combined.throughBlock).toBe('30');
});
const TOKEN = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const PRIVATE = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const log = (name: string, values: unknown[], block: number, index = 0): TradeHistoryV2RawLog => ({ address: escrow,
  ...ABI.encodeEventLog(ABI.getEvent(name)!, values), blockNumber: toBeHex(block), blockHash: hash(block), transactionHash: hash(block + 100),
  transactionIndex: '0x0', logIndex: toBeHex(index), removed: false });
const ut = (value: bigint) => [[0n, 1n], [0n, value]];
const fixture = (privatePair = true) => {
  let fork = 0;
  const events = [log('LinkOpened', [id, owner, privatePair, offer, request, privatePair ? 0n : 100n, privatePair ? [0n, 0n] : [2n, 3n], hash(88), 0n], 12),
    log('LinkFilled', [id, other, 2n, privatePair ? 0n : 4n, privatePair ? 0n : 6n, privatePair ? 0n : 4n], 20, 2),
    log('LinkCredentialChanged', [id, 3n, 2n, false], 24), log('LinkClosed', [id, 2n, 4n], 26),
    log('LinkFilled', [foreign, owner, 2n, privatePair ? 0n : 4n, privatePair ? 0n : 6n, privatePair ? 0n : 4n], 22, 2)];
  if (privatePair) events.push(log('PrivateLinkReceipt', [id, owner, 2n, ut(4n), ut(6n), ut(0n)], 20),
    log('PrivateLinkReceipt', [id, other, 2n, ut(1004n), ut(1006n), ut(1004n)], 20, 1),
    log('PrivateLinkReceipt', [foreign, owner, 2n, ut(4n), ut(6n), ut(4n)], 22));
  const transfer = (privatePair ? PRIVATE : TOKEN).encodeEventLog((privatePair ? PRIVATE : TOKEN).getEvent('Transfer')!, privatePair ? [escrow, owner, [0n, 1007n], [0n, 7n]] : [escrow, owner, 7n]);
  const receiptLogs: Record<string, readonly TradeHistoryV2RawLog[]> = { [hash(126)]: [{ ...log('LinkClosed', [id, 2n, 4n], 26), address: offer, ...transfer }] };
  m.latest.mockResolvedValue('40'); m.block.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber.toString(), hash: hash(Number(blockNumber) + fork) }));
  m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer: {} });
  m.decrypt.mockImplementation((_signer, value) => { const v = BigInt(value.ciphertextLow); if (v >= 1000n) throw new Error('Another recipient.'); return v; });
  m.range.mockImplementation(async ({ fromBlock, toBlock, topics }) => ({ scope: { protocol: 'link-v2', chainId: '7082400', contractAddress: escrow, deploymentBlock: '10' },
    range: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), fromBlockHash: hash(Number(fromBlock) + fork), toBlockHash: hash(Number(toBlock) + fork) },
    safeHead: { number: '38', hash: hash(38 + fork) }, checkedBlocks: [], receiptLogs,
    logs: events.filter(v => BigInt(v.blockNumber) >= fromBlock && BigInt(v.blockNumber) <= toBlock && topics.every((t: unknown, i: number) => t === null ||
      (Array.isArray(t) ? t.includes(v.topics[i]) : t === v.topics[i]))) }));
  m.view.mockImplementation(async () => ABI.encodeFunctionResult('getOrderView', [[
    [other, offer, request, hash(88), hash(88), hash(88), 0n, 4n, 1n, 1n, privatePair, true], 1n,
    privatePair ? [0n, 0n] : [2n, 3n], privatePair ? 0n : 100n, privatePair ? 0n : 90n, '0x01', hash(88) ]]));
  const input = { capability: {} as never, deployment: { chainId: '7082400', contractAddress: escrow, deploymentBlock: '10', finalityLagBlocks: '2' } as never, ownerAddress: owner };
  const create = () => createLinkTradeV2ActivityReader(input);
  return { input, reader: create(), create, events, receiptLogs, fork: () => { fork++; } };
};
beforeEach(() => vi.resetAllMocks());
describe('Link activity projection over the shared canonical boundary; chain and owner decryption mocked', () => {
  it.each([false, true])('discovers owner orders and all participant lifecycle/fills with full-width IDs, private=%s', async privatePair => {
    const f = fixture(privatePair), result = await f.reader.sync({} as never);
    expect(result.complete).toBe(true); expect(result.throughBlock).toBe('38');
    expect(result.orders).toMatchObject([{ reference: { id, revision: '4', credentialEpoch: '2' }, status: 'Cancelled', enabled: false }]);
    expect(result.history.map(r => r.kind).sort()).toEqual(['cancelled', 'created', 'filled', 'filled', 'link-updated']);
    expect(result.history.find(r => r.kind === 'cancelled')?.refund).toBe('7');
    expect(result.history.find(r => r.kind === 'filled' && r.role === 'filler')).toMatchObject({ orderId: foreign, offer: '4', payment: '6', refund: '4' });
    expect(result.history.find(r => r.kind === 'filled' && r.role === 'maker')).toMatchObject({ orderId: id, offer: '4', payment: '6' });
    expect(m.view).toHaveBeenCalledOnce(); if (privatePair) expect(m.decrypt).toHaveBeenCalledTimes(7);
    expect(m.range.mock.calls[0][0].topics[2]).toBe(toBeHex(BigInt(owner), 32));
  });
  it('rebuilds the same results in a new reader with no journal, ID input or browser storage', async () => {
    const f = fixture(), first = await f.reader.sync({} as never); f.reader.close();
    expect(await f.create().sync({} as never)).toEqual(first);
    await expect(f.reader.sync({} as never)).rejects.toThrow(/session/);
  });
  it('pages bounded block ranges and reports incomplete coverage until the saved head is reached', async () => {
    const f = fixture(false); m.latest.mockResolvedValue('5000');
    const first = await f.reader.sync({} as never); expect(first).toMatchObject({ complete: false, throughBlock: '2057', safeHead: '4998' });
    const second = await f.reader.sync({} as never); expect(second.throughBlock).toBe('4105');
    const last = await f.reader.sync({} as never); expect(last).toMatchObject({ complete: true, throughBlock: '4998' });
    expect(last.history).toEqual(first.history); expect(m.view).toHaveBeenCalledOnce();
  });
  it('uses one explicit 100000-block range for an 85000-block empty gap and waits for verification', async () => {
    const f = fixture(false); f.events.splice(0); m.latest.mockResolvedValue('85010');
    const reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 100_000n } as never);
    const defaultRange = m.range.getMockImplementation()!;
    let captured: { fromBlock: bigint; toBlock: bigint } | undefined, release!: () => void;
    let entered!: () => void;
    const rangeEntered = new Promise<void>(resolve => { entered = resolve; });
    m.range.mockImplementationOnce(async (input: { fromBlock: bigint; toBlock: bigint }) => {
      captured = input; entered();
      return await new Promise(resolve => { release = () => { void defaultRange(input).then(resolve); }; });
    });
    let settled = false;
    const sync = reader.sync({} as never).then(result => { settled = true; return result; });
    try {
      await rangeEntered;
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally { release(); }
    const result = await sync;
    expect(captured).toMatchObject({ fromBlock: 10n, toBlock: 85008n });
    expect(m.range).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ complete: true, throughBlock: '85008', safeHead: '85008' });
    expect(result.orders).toEqual([]);
    expect(result.history).toEqual([]);
  });
  it('falls back after a wide typed range limit, preserves committed activity, and rejects a typed limit on a short range', async () => {
    const f = fixture(false), reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 100_000n } as never);
    const committed = await reader.sync({} as never);
    expect(committed.complete).toBe(true);
    m.latest.mockResolvedValue('85010');
    const calls: { fromBlock: bigint; toBlock: bigint }[] = [];
    const defaultRange = m.range.getMockImplementation()!;
    m.range.mockImplementation(async (input: { fromBlock: bigint; toBlock: bigint }) => {
      calls.push(input);
      if (input.toBlock - input.fromBlock + 1n > 2048n) throw new TradeHistoryV2RangeLimitError();
      return defaultRange(input);
    });
    const fallback = await reader.sync({} as never);
    expect(calls[0]).toMatchObject({ fromBlock: 39n, toBlock: 85008n });
    expect(fallback).toMatchObject({ complete: false, throughBlock: '38', safeHead: '85008' });
    expect(fallback.orders).toEqual(committed.orders);
    expect(fallback.history).toEqual(committed.history);
    const next = await reader.sync({} as never);
    expect(calls[1]).toMatchObject({ fromBlock: 39n, toBlock: 2086n });
    expect(next.throughBlock).toBe('2086');
    expect(next.history).toEqual(committed.history);

    const short = fixture(false), shortReader = createLinkTradeV2ActivityReader({ ...short.input, pageRangeBlocks: 100_000n } as never);
    m.range.mockClear();
    m.range.mockRejectedValueOnce(new TradeHistoryV2RangeLimitError());
    await expect(shortReader.sync({} as never)).rejects.toThrow(TradeHistoryV2RangeLimitError);
    expect(m.range).toHaveBeenCalledOnce();
  });
  it('does not retry a generic RPC failure from an explicit wide range', async () => {
    const f = fixture(false); m.latest.mockResolvedValue('85010');
    const reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 100_000n } as never);
    m.range.mockRejectedValueOnce(new Error('RPC unavailable.'));
    await expect(reader.sync({} as never)).rejects.toThrow('RPC unavailable.');
    expect(m.range).toHaveBeenCalledOnce();
    expect(m.range.mock.calls[0][0]).toMatchObject({ fromBlock: 10n, toBlock: 85008n });
  });
  it('checks the owner lease before publishing the previous snapshot after a wide range limit', async () => {
    const f = fixture(false); m.latest.mockResolvedValue('85010');
    const reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 100_000n } as never);
    m.current.mockImplementationOnce(async () => undefined).mockImplementationOnce(async () => { throw new Error('Owner lease revoked.'); });
    m.range.mockRejectedValueOnce(new TradeHistoryV2RangeLimitError());
    await expect(reader.sync({} as never)).rejects.toThrow('Owner lease revoked.');
    expect(m.range).toHaveBeenCalledOnce();
  });
  it('discards a staged LinkOpened event when the wide order-detail query reaches the log cap', async () => {
    const f = fixture(false), reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 100_000n } as never);
    const committed = await reader.sync({} as never);
    const newId = '991';
    f.events.push(log('LinkOpened', [newId, owner, false, offer, request, 100n, [2n, 3n], hash(89), 0n], 50));
    m.latest.mockResolvedValue('85010');
    const calls: { fromBlock: bigint; toBlock: bigint; topics: unknown[] }[] = [];
    const defaultRange = m.range.getMockImplementation()!;
    m.range.mockImplementation(async (input: { fromBlock: bigint; toBlock: bigint; topics: unknown[] }) => {
      calls.push(input);
      if (input.toBlock - input.fromBlock + 1n > 2048n && input.topics.length === 2) {
        throw new TradeHistoryV2RangeLimitError();
      }
      return defaultRange(input);
    });

    const fallback = await reader.sync({} as never);
    expect(calls.slice(0, 2).map(input => [input.fromBlock, input.toBlock, input.topics.length]))
      .toEqual([[39n, 85008n, 3], [39n, 85008n, 2]]);
    expect(fallback).toMatchObject({ complete: false, throughBlock: '38', safeHead: '85008' });
    expect(fallback.orders).toEqual(committed.orders);
    expect(fallback.history).toEqual(committed.history);
    expect(fallback.orders.some(order => order.reference.id === newId)).toBe(false);
    expect(fallback.history.some(row => row.orderId === newId)).toBe(false);

    const next = await reader.sync({} as never);
    expect(calls[2]).toMatchObject({ fromBlock: 39n, toBlock: 2086n });
    expect(next.throughBlock).toBe('2086');
    expect(next.orders.some(order => order.reference.id === newId)).toBe(true);
    expect(next.history.some(row => row.orderId === newId && row.kind === 'created')).toBe(true);
  });
  it('removes orphan lifecycle rows when its committed checkpoint changes', async () => {
    const f = fixture(false); expect((await f.reader.sync({} as never)).orders[0].status).toBe('Cancelled');
    f.events.splice(f.events.findIndex(v => ABI.parseLog({ topics: [...v.topics], data: v.data })!.name === 'LinkClosed'), 1); f.fork();
    const next = await f.reader.sync({} as never); expect(next.orders[0].status).toBe('Open');
    expect(next.history.some(r => r.kind === 'cancelled')).toBe(false); expect(m.range.mock.calls[2][0].fromBlock).toBe(10n);
  });
  it('bounds each order-ID query to 64 without imposing a wallet order quota', async () => {
    const f = fixture(false); f.events.splice(0);
    for (let i = 1; i <= 65; i++) f.events.push(log('LinkOpened', [i, owner, false, offer, request, 100n, [2n, 3n], hash(i), 0n], 12, i));
    const partial = await f.reader.sync({} as never); expect(partial).toMatchObject({ complete: false, phase: 'orders', orders: [] });
    const final = await f.reader.sync({} as never); expect(final.orders).toHaveLength(65); expect(final.complete).toBe(true);
    expect(m.range.mock.calls.filter(([v]) => v.topics.length === 2).map(([v]) => v.topics[1].length)).toEqual([64, 1]);
  });
  it('labels a missing private recipient receipt as unavailable rather than zero', async () => {
    const f = fixture(); f.events.splice(f.events.findIndex(v => ABI.parseLog({ topics: [...v.topics], data: v.data })?.name === 'PrivateLinkReceipt' && BigInt(v.blockNumber) === 22n), 1);
    const result = await f.reader.sync({} as never);
    expect(result.history.find(r => r.orderId === foreign)?.offer).toBeUndefined();
  });
  it('loads at most eight new token identities per step and keeps incomplete pages uncommitted', async () => {
    const f = fixture(false); f.events.splice(0);
    for (let i = 1; i <= 9; i++) f.events.push(log('LinkFilled', [100 + i, owner, 2n, 4n, 6n, 4n], 12 + i));
    const partial = await f.reader.sync({} as never);
    expect(partial).toMatchObject({ complete: false, phase: 'details', history: [] }); expect(m.view).toHaveBeenCalledTimes(8);
    const complete = await f.reader.sync({} as never);
    expect(complete.complete).toBe(true); expect(complete.history).toHaveLength(9); expect(m.view).toHaveBeenCalledTimes(9);
  });
  it('stops after one RPC failure, and rejects a foreign or closed wallet session before reading', async () => {
    const f = fixture(); m.range.mockRejectedValueOnce(new Error('403'));
    await expect(f.reader.sync({} as never)).rejects.toThrow('403'); expect(m.range).toHaveBeenCalledOnce();
    m.range.mockClear(); m.binding.mockReturnValue({ ownerAddress: other, chainId: 7082400n, signer: {} });
    await expect(f.reader.sync({} as never)).rejects.toThrow(/session/); expect(m.range).not.toHaveBeenCalled();
  });
  it('rejects a noncanonical refund without committing the page, then reads a corrected source', async () => {
    const f = fixture(false), receipt = f.receiptLogs[hash(126)];
    f.receiptLogs[hash(126)] = [{ ...receipt[0], data: receipt[0].data + '00'.repeat(32) }];
    await expect(f.reader.sync({} as never)).rejects.toThrow(/Noncanonical Link refund/);
    f.receiptLogs[hash(126)] = receipt;
    expect((await f.reader.sync({} as never)).history.find(row => row.kind === 'cancelled')?.refund).toBe('7');
    expect(m.range.mock.calls[2][0].fromBlock).toBe(10n);
  });
});

