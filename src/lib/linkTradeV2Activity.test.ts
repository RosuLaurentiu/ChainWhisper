import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LinkTradeV2Activity from '../features/trading/components/LinkTradeV2Activity';
import type { TradeCustomTokenInfo } from './appHelpers';
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
  m.view.mockImplementation(async ({ data }) => {
    const key = ABI.decodeFunctionData('getOrderView', data)[0].toString();
    const own = events.some(log => { const event = ABI.parseLog({ topics: [...log.topics], data: log.data })!; return event.name === 'LinkOpened' && event.args.id.toString() === key; });
    return ABI.encodeFunctionResult('getOrderView', [[
      [own ? owner : other, offer, request, hash(88), hash(88), hash(88), 0n, 4n, 2n, own ? 2n : 1n, privatePair, !own], own ? 2n : 1n,
      privatePair ? [0n, 0n] : [2n, 3n], privatePair ? 0n : 100n, privatePair ? 0n : 90n, '0x01', hash(88) ]]);
  });
  const input = { capability: {} as never, deployment: { chainId: '7082400', contractAddress: escrow, deploymentBlock: '10', finalityLagBlocks: '2' } as never, ownerAddress: owner };
  const create = () => createLinkTradeV2ActivityReader(input);
  return { input, reader: create(), create, events, receiptLogs, fork: () => { fork++; } };
};
beforeEach(() => vi.resetAllMocks());
describe('Link activity projection over the shared canonical boundary; chain and owner decryption mocked', () => {
  it.each([false, true])('shows one parent refund for paired LinkClosed and CounterParentSettled, private=%s', async privatePair => {
    const f = fixture(privatePair);
    const closedIndex = f.events.findIndex(event => event.transactionHash === hash(126));
    f.events[closedIndex] = log('LinkClosed', [id, 2n, 4n], 26, 1);
    f.events.push(log('CounterParentSettled', [id, 1n], 26, 2));
    const result = await f.reader.sync({} as never);
    expect(result.orders).toMatchObject([{ status: 'Cancelled', enabled: false }]);
    expect(result.history.filter(row => row.transactionHash === hash(126))).toMatchObject([
      { kind: 'counter-settled', refund: undefined }, { kind: 'cancelled', refund: '7' }
    ]);
    const kind = privatePair ? 'private-erc20' : 'erc20';
    const tokenInfoByKey: Record<string, TradeCustomTokenInfo> = Object.fromEntries(([[offer, 'OFFER', 2], [request, 'PAY', 3]] as const).map(([address, symbol, decimals]) =>
      [`${kind}:${address}`, { kind, address, symbol, decimals, balanceWei: null, loading: false }]));
    const props: ComponentProps<typeof LinkTradeV2Activity> = {
      activity: { snapshot: result, busy: false, error: '', refresh: async () => {}, loadOlder: async () => {} },
      runtime: { ownerAddress: owner } as never, lifecycle: 'history', activeFilter: 'all', tokenInfoByKey,
      ensureTokenInfo: async () => {}, search: '', pairFilter: 'all', typeFilter: 'all', sortMode: 'newest',
      confirmFunding: async () => {}, runWalletFlow: async operation => operation(), onBusyChange: () => {}
    };
    const html = renderToStaticMarkup(createElement(LinkTradeV2Activity, props));
    expect(html).toContain('counter settled');
    expect(html.match(/Refunded 0\.07 OFFER/g)).toHaveLength(1);
  });
  it.each([false, true])('joins Link reader amounts to displayed history with token decimals, private=%s', async privatePair => {
    const result = await fixture(privatePair).reader.sync({} as never);
    const kind = privatePair ? 'private-erc20' : 'erc20';
    const tokenInfoByKey: Record<string, TradeCustomTokenInfo> = Object.fromEntries(([[offer, 'OFFER', 2], [request, 'PAY', 3]] as const).map(([address, symbol, decimals]) =>
      [`${kind}:${address}`, { kind, address, symbol, decimals, balanceWei: null, loading: false }]));
    const props: ComponentProps<typeof LinkTradeV2Activity> = {
      activity: { snapshot: result, busy: false, error: '', refresh: async () => {}, loadOlder: async () => {} },
      runtime: { ownerAddress: owner } as never, lifecycle: 'history', activeFilter: 'all', tokenInfoByKey,
      ensureTokenInfo: async () => {}, search: '', pairFilter: 'all', typeFilter: 'all', sortMode: 'newest',
      confirmFunding: async () => {}, runWalletFlow: async operation => operation(), onBusyChange: () => {},
    };
    const html = renderToStaticMarkup(createElement(LinkTradeV2Activity, props));
    expect(html).toContain('Sold 0.04 OFFER · Received 0.006 PAY');
    expect(html).toContain('Received 0.04 OFFER · Paid 0.006 PAY · Refunded 0.004 PAY');
    expect(html).toContain('Refunded 0.07 OFFER');
    expect(html).not.toContain('Amount unavailable');
    for (const metadata of [{}, Object.fromEntries(Object.entries(tokenInfoByKey).map(([key, token]) => [key, { ...token, error: 'Metadata unavailable.' }]))]) {
      const unavailable = renderToStaticMarkup(createElement(LinkTradeV2Activity, { ...props, tokenInfoByKey: metadata }));
      expect(unavailable).toContain('Sold Amount unavailable · Received Amount unavailable');
      expect(unavailable).toContain('Received Amount unavailable · Paid Amount unavailable · Refunded Amount unavailable');
      expect(unavailable).toContain('Refunded Amount unavailable');
      expect(unavailable).not.toMatch(/(?:Sold|Received|Paid|Refunded) 0(?:[ .<])/);
    }
  });
  it.each([false, true])('discovers owner orders and all participant lifecycle/fills with full-width IDs, private=%s', async privatePair => {
    const f = fixture(privatePair), result = await f.reader.sync({} as never);
    expect(result.complete).toBe(true); expect(result.throughBlock).toBe('38');
    expect(result.orders).toMatchObject([{ reference: { id, revision: '4', credentialEpoch: '2' }, status: 'Cancelled', enabled: false }]);
    expect(result.history.map(r => r.kind).sort()).toEqual(['cancelled', 'created', 'filled', 'filled', 'link-updated']);
    expect(result.history.find(r => r.kind === 'cancelled')?.refund).toBe('7');
    expect(result.history.find(r => r.kind === 'filled' && r.role === 'filler')).toMatchObject({ orderId: foreign, offer: '4', payment: '6', refund: '4' });
    expect(result.history.find(r => r.kind === 'filled' && r.role === 'maker')).toMatchObject({ orderId: id, offer: '4', payment: '6' });
    expect(m.view).toHaveBeenCalledOnce(); if (privatePair) expect(m.decrypt).toHaveBeenCalledTimes(7);
    expect(m.range.mock.calls[0][0].topics).toHaveLength(1);
  });
  it('rebuilds the same results in a new reader with no journal, ID input or browser storage', async () => {
    const f = fixture(), first = await f.reader.sync({} as never); f.reader.close();
    expect(await f.create().sync({} as never)).toEqual(first);
    await expect(f.reader.sync({} as never)).rejects.toThrow(/session/);
  });
  it('loads the newest bounded window first, keeps refresh separate, and pages older to deployment', async () => {
    const f = fixture(false); m.latest.mockResolvedValue('5000');
    const first = await f.reader.sync({} as never); expect(first).toMatchObject({ complete: false, fromBlock: '2951', throughBlock: '4998', safeHead: '4998' });
    expect(first.history).toEqual([]);
    expect(await f.reader.sync({} as never)).toEqual(first); expect(m.range).toHaveBeenCalledOnce();
    const second = await f.reader.sync({} as never, 'older'); expect(second.fromBlock).toBe('903');
    const last = await f.reader.sync({} as never, 'older'); expect(last).toMatchObject({ complete: true, fromBlock: '10', throughBlock: '4998' });
    expect(last.history).toHaveLength(5); expect(m.view).toHaveBeenCalledOnce();
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
  it('shrinks capped windows without retrying, preserves committed activity, and rejects a one-block log cap', async () => {
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
    expect(calls[1]).toMatchObject({ fromBlock: 82961n, toBlock: 85008n });
    expect(next).toMatchObject({ fromBlock: '82961', throughBlock: '85008', complete: false });
    expect(next.history).toEqual(committed.history);

    const short = fixture(false), shortReader = createLinkTradeV2ActivityReader({ ...short.input, pageRangeBlocks: 1n } as never);
    m.range.mockClear();
    m.range.mockRejectedValueOnce(new TradeHistoryV2RangeLimitError());
    await expect(shortReader.sync({} as never)).rejects.toThrow(TradeHistoryV2RangeLimitError);
    expect(m.range).toHaveBeenCalledOnce();
  });
  it.each([false, true])('shows recent lifecycle events of old orders before their creation page, private=%s', async privatePair => {
    const f = fixture(privatePair), reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 20n } as never);
    const recent = await reader.sync({} as never);
    expect(recent).toMatchObject({ complete: false, fromBlock: '19', throughBlock: '38' });
    expect(recent.history.map(row => row.kind)).toEqual(['cancelled', 'link-updated', 'filled', 'filled']);
    expect(recent.history.find(row => row.kind === 'cancelled')).toMatchObject({ orderId: id, refund: '7' });
    expect(recent.history.find(row => row.role === 'filler')).toMatchObject({ orderId: foreign, offer: '4', payment: '6', refund: '4' });
    expect(recent.orders).toMatchObject([{ reference: { id, revision: '4', credentialEpoch: '2' }, status: 'Cancelled', enabled: false }]);
    const all = await reader.sync({} as never, 'older');
    expect(all).toMatchObject({ complete: true, fromBlock: '10', throughBlock: '38' });
    expect(all.history).toHaveLength(5);
    expect(new Set(all.history.map(row => row.key)).size).toBe(5);
    expect(await reader.sync({} as never)).toEqual(all);
  });
  it('shrinks a dense default window only after the caller requests another page', async () => {
    const f = fixture(false); m.latest.mockResolvedValue('5000');
    m.range.mockRejectedValueOnce(new TradeHistoryV2RangeLimitError());
    expect(await f.reader.sync({} as never)).toMatchObject({ complete: false, fromBlock: undefined });
    expect(m.range).toHaveBeenCalledOnce();
    expect(await f.reader.sync({} as never)).toMatchObject({ fromBlock: '3975', throughBlock: '4998', complete: false });
    expect(m.range.mock.calls[1][0]).toMatchObject({ fromBlock: 3975n, toBlock: 4998n });
  });
  it('finishes older coverage at its retained upper snapshot while the native head advances', async () => {
    const f = fixture(false), reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 20n } as never);
    await reader.sync({} as never);
    m.latest.mockResolvedValue('5000');
    const all = await reader.sync({} as never, 'older');
    expect(all).toMatchObject({ complete: true, fromBlock: '10', throughBlock: '38', safeHead: '38' });
    expect(m.range.mock.calls.map(([page]) => [page.fromBlock, page.toBlock])).toEqual([[19n, 38n], [10n, 18n]]);
  });
  it('excludes global lifecycle events for an unrelated maker and filler', async () => {
    const f = fixture(false);
    f.events.push(log('LinkFilled', [124, other, 2n, 4n, 6n, 0n], 30), log('LinkClosed', [124, 2n, 3n], 31));
    const result = await f.reader.sync({} as never);
    expect(result.history).toHaveLength(5);
    expect(result.history.some(row => row.orderId === '124')).toBe(false);
  });
  it('keeps short latest refreshes contiguous and fills a long refresh gap before claiming complete', async () => {
    const f = fixture(false), reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 20n } as never);
    await reader.sync({} as never); m.latest.mockResolvedValue('46');
    expect(await reader.sync({} as never)).toMatchObject({ fromBlock: '19', throughBlock: '44', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '10', throughBlock: '44', complete: true });
    f.events.push(log('LinkOpened', [123, owner, false, offer, request, 100n, [2n, 3n], hash(123), 0n], 50), log('LinkClosed', [123, 2n, 2n], 60));
    const transfer = TOKEN.encodeEventLog(TOKEN.getEvent('Transfer')!, [escrow, owner, 100n]);
    f.receiptLogs[hash(160)] = [{ ...log('LinkClosed', [123, 2n, 2n], 60, 1), address: offer, ...transfer }];
    m.latest.mockResolvedValue('100');
    expect(await reader.sync({} as never)).toMatchObject({ fromBlock: '79', throughBlock: '98', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '59', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '39', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '19', complete: false });
    const all = await reader.sync({} as never, 'older');
    expect(all).toMatchObject({ fromBlock: '10', throughBlock: '98', complete: true });
    expect(all.history).toHaveLength(7); expect(new Set(all.history.map(row => row.key)).size).toBe(7);
    expect(all.history.find(row => row.orderId === '123' && row.kind === 'cancelled')?.refund).toBe('100');
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
  it('does not commit a wide page when its event query reaches the log cap', async () => {
    const f = fixture(false), reader = createLinkTradeV2ActivityReader({ ...f.input, pageRangeBlocks: 100_000n } as never);
    const committed = await reader.sync({} as never);
    const newId = '991';
    f.events.push(log('LinkOpened', [newId, owner, false, offer, request, 100n, [2n, 3n], hash(89), 0n], 50));
    m.latest.mockResolvedValue('85010');
    const calls: { fromBlock: bigint; toBlock: bigint; topics: unknown[] }[] = [];
    const defaultRange = m.range.getMockImplementation()!;
    m.range.mockImplementation(async (input: { fromBlock: bigint; toBlock: bigint; topics: unknown[] }) => {
      calls.push(input);
      if (input.toBlock - input.fromBlock + 1n > 2048n) {
        throw new TradeHistoryV2RangeLimitError();
      }
      return defaultRange(input);
    });

    const fallback = await reader.sync({} as never);
    expect(calls.slice(0, 2).map(input => [input.fromBlock, input.toBlock, input.topics.length]))
      .toEqual([[39n, 85008n, 1]]);
    expect(fallback).toMatchObject({ complete: false, throughBlock: '38', safeHead: '85008' });
    expect(fallback.orders).toEqual(committed.orders);
    expect(fallback.history).toEqual(committed.history);
    expect(fallback.orders.some(order => order.reference.id === newId)).toBe(false);
    expect(fallback.history.some(row => row.orderId === newId)).toBe(false);

    const next = await reader.sync({} as never);
    expect(calls[1]).toMatchObject({ fromBlock: 82961n, toBlock: 85008n });
    expect(next.throughBlock).toBe('85008');
    expect(next.orders.some(order => order.reference.id === newId)).toBe(false);
    expect(next.history.some(row => row.orderId === newId)).toBe(false);
  });
  it('removes orphan lifecycle rows when its committed checkpoint changes', async () => {
    const f = fixture(false); expect((await f.reader.sync({} as never)).orders[0].status).toBe('Cancelled');
    f.events.splice(f.events.findIndex(v => ABI.parseLog({ topics: [...v.topics], data: v.data })!.name === 'LinkClosed'), 1); f.fork();
    const next = await f.reader.sync({} as never); expect(next.orders[0].status).toBe('Open');
    expect(next.history.some(r => r.kind === 'cancelled')).toBe(false); expect(m.range.mock.calls[1][0].fromBlock).toBe(10n);
  });
  it('does not impose an order quota or query each opened order again', async () => {
    const f = fixture(false); f.events.splice(0);
    for (let i = 1; i <= 65; i++) f.events.push(log('LinkOpened', [i, owner, false, offer, request, 100n, [2n, 3n], hash(i), 0n], 12, i));
    const final = await f.reader.sync({} as never); expect(final.orders).toHaveLength(65); expect(final.complete).toBe(true);
    expect(m.range).toHaveBeenCalledOnce();
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
    expect(m.range.mock.calls[1][0].fromBlock).toBe(10n);
  });
});

