import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CounterTradeV2Activity from '../features/trading/components/CounterTradeV2Activity';
import type { TradeCustomTokenInfo } from './appHelpers';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import { createCounterTradeV2ActivityReader, mergeCounterTradeV2ActivitySnapshots, type CounterTradeV2ActivitySnapshot } from './counterTradeV2Activity';
import type { TradeHistoryV2RawLog } from './tradeHistoryV2Events';
import { TradeHistoryV2RangeLimitError } from './tradeHistoryV2Chain';
const m = vi.hoisted(() => ({ latest: vi.fn(), block: vi.fn(), range: vi.fn(), participant: vi.fn(), view: vi.fn(), binding: vi.fn(), current: vi.fn(), decrypt: vi.fn() }));
vi.mock('./tradeHistoryV2Chain', () => {
  class TradeHistoryV2RangeLimitError extends Error {}
  return { TradeHistoryV2RangeLimitError, TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS: 2_048n,
    TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS: 100_000n,
    assertAttestedTradeHistoryV2Deployment: vi.fn(), readTradeHistoryV2LatestBlockNumber: m.latest,
    readTradeHistoryV2CanonicalBlock: m.block, readCanonicalTradeV2RawLogRange: m.range,
    readCanonicalCounterTradeV2ParticipantRange: m.participant, readAttestedTradeHistoryV2View: m.view };
});
vi.mock('./ownerTradeV2Capability', () => ({ getOwnerTradeV2CapabilityBinding: m.binding, assertOwnerTradeV2CapabilityCurrent: m.current }));
vi.mock('./privateUint256', () => ({ decryptPrivateUint256Output: m.decrypt }));
const address = (b: string) => `0x${b.repeat(20)}`, hash = (n: number) => toBeHex(n, 32);
const owner = address('11'), other = address('22'), escrow = address('33'), parent = address('44'), a = address('55'), b = address('66');
const id = '9007199254740993', incoming = '9007199254740994', ABI = new Interface(COUNTER_TRADE_V2_ABI);
const PUBLIC = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const PRIVATE = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const log = (name: string, values: unknown[], block: number, index = 0): TradeHistoryV2RawLog => ({ address: escrow, ...ABI.encodeEventLog(ABI.getEvent(name)!, values),
  blockNumber: toBeHex(block), blockHash: hash(block), transactionHash: hash(block + 100), transactionIndex: '0x0', logIndex: toBeHex(index), removed: false });
const fixture = (privatePair = true, bookParent: boolean | 'standard' = false) => {
  const book = address('77');
  let fork = 0;
  const open = (id: string, maker: string, taker: string, block: number, index = 0) => log('CounterOpened', [id, maker, taker, hash(77), 0n, 1n,
    maker === owner ? a : b, maker === owner ? b : a, privatePair, privatePair ? 0n : 4n, privatePair ? 0n : 5n, 0n], block, index);
  const events = [open(id, owner, other, 12), open(incoming, other, owner, 14), log('CounterClosed', [id, 3n, owner], 20), log('CounterClosed', [incoming, 2n, owner], 22)];
  const receipts: Record<string, TradeHistoryV2RawLog[]> = {};
  for (const e of events) receipts[e.transactionHash] = [e];
  const ut = (v: bigint, own: boolean) => [[0n, 1n], [0n, own ? v : 1000n + v]];
  if (privatePair) for (const [key, block] of [[id, 12], [incoming, 14]] as const) for (const [recipient, index] of [[owner, 1], [other, 2]] as const)
    receipts[hash(block + 100)].push(log('CounterPrivateTerms', [key, recipient, ut(4n, recipient === owner), ut(5n, recipient === owner)], block, index));
  const transfer = (token: string, from: string, to: string, amount: bigint, block: number, index: number) => ({ ...log('CounterClosed', [id, 3n, owner], block, index), address: token,
    ...(privatePair ? PRIVATE : PUBLIC).encodeEventLog((privatePair ? PRIVATE : PUBLIC).getEvent('Transfer')!, privatePair ? [from, to,
      [0n, from === owner ? amount : 1000n + amount], [0n, to === owner ? amount : 1000n + amount]] : [from, to, amount]) });
  receipts[hash(120)].push(transfer(a, escrow, owner, 4n, 20, 1));
  receipts[hash(122)].push(transfer(a, bookParent ? book : parent, owner, 7n, 22, 1), transfer(a, owner, other, 5n, 22, 2), transfer(b, escrow, owner, 4n, 22, 3));
  m.latest.mockResolvedValue('40'); m.block.mockImplementation(async ({ blockNumber }) => ({ number: blockNumber.toString(), hash: hash(Number(blockNumber) + fork) }));
  m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer: {} });
  m.decrypt.mockImplementation((_signer, v) => { const amount = BigInt(v.ciphertextLow); if (amount >= 1000n) throw new Error('Other recipient.'); return amount; });
  m.range.mockImplementation(async ({ fromBlock, toBlock, topics }) => {
    const logs = events.filter(v => BigInt(v.blockNumber) >= fromBlock && BigInt(v.blockNumber) <= toBlock && topics.every((t: unknown, i: number) => t === null ||
      (Array.isArray(t) ? t.includes(v.topics[i]) : t === v.topics[i])));
    return { scope: { protocol: 'counter-v2', chainId: '7082400', contractAddress: escrow, deploymentBlock: '10' },
      range: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), fromBlockHash: hash(Number(fromBlock) + fork), toBlockHash: hash(Number(toBlock) + fork) },
      safeHead: { number: '38', hash: hash(38 + fork) }, checkedBlocks: [], logs,
      receiptLogs: Object.fromEntries(logs.map(v => [v.transactionHash, receipts[v.transactionHash] ?? [v]])) };
  });
  m.participant.mockImplementation(async (input) => {
    const opened = ABI.getEvent('CounterOpened')!.topicHash, ownerTopic = toBeHex(BigInt(input.ownerAddress), 32);
    const maker = await m.range({ ...input, topics: [opened, null, ownerTopic] });
    const taker = await m.range({ ...input, topics: [opened, null, null, ownerTopic] });
    return { ...maker, logs: [...maker.logs, ...taker.logs], receiptLogs: { ...maker.receiptLogs, ...taker.receiptLogs } };
  });
  m.view.mockImplementation(async ({ data, from }) => {
    const call = ABI.parseTransaction({ data })!, key = call.args[0].toString();
    const source = events.map(log => ABI.parseLog({ topics: [...log.topics], data: log.data })!).find(event => event.name === 'CounterOpened' && event.args.id.toString() === key)!.args;
    if (call.name === 'getTermsForAccount') {
      expect(from).toBe(owner);
      return ABI.encodeFunctionResult('getTermsForAccount', [[true, ut(4n, true), ut(5n, true)]]);
    }
    return ABI.encodeFunctionResult('getCounter', [[source.maker, source.taker, source.offerToken, source.requestToken, hash(91), hash(92), source.rootKey,
      source.parentProposal, source.expiresAt, source.depth, 3n, source.privatePair, false], [source.publicOffer, source.publicRequest], 3n]);
  });
  const input = { capability: {} as never, deployment: { chainId: '7082400', contractAddress: escrow, deploymentBlock: '10', finalityLagBlocks: '2' } as never,
    parentDeployment: { protocol: 'link-v2', chainId: '7082400', contractAddress: parent } as never,
    ...(bookParent ? { parentDeployments: [{ protocol: bookParent === 'standard' ? 'standard-v2' : 'private-v2', chainId: '7082400', contractAddress: book } as never] } : {}), ownerAddress: owner };
  const create = (options: { pageRangeBlocks?: bigint } = {}) => createCounterTradeV2ActivityReader({ ...input, ...options } as never);
  return { input, reader: create(), create, events, receipts, open, transfer, fork: () => { fork++; } };
};
beforeEach(() => vi.resetAllMocks());
describe('Counter participant discovery/history over the reused canonical boundary; chain/decryption modelled', () => {
  it.each([false, true])('joins Counter reader amounts to displayed history with token decimals, private=%s', async privatePair => {
    const result = await fixture(privatePair).reader.sync({} as never);
    const kind = privatePair ? 'private-erc20' : 'erc20';
    const tokenInfoByKey: Record<string, TradeCustomTokenInfo> = Object.fromEntries(([[a, 'TOKEN_A', 2], [b, 'TOKEN_B', 3]] as const).map(([address, symbol, decimals]) =>
      [`${kind}:${address}`, { kind, address, symbol, decimals, balanceWei: null, loading: false }]));
    const props: ComponentProps<typeof CounterTradeV2Activity> = {
      activity: { snapshot: result, busy: false, error: '', refresh: async () => {}, loadOlder: async () => {} },
      runtime: { ownerAddress: owner } as never, lifecycle: 'history', activeFilter: 'all', tokenInfoByKey,
      ensureTokenInfo: async () => {}, search: '', pairFilter: 'all', typeFilter: 'all', sortMode: 'newest',
      confirmFunding: async () => {}, runWalletFlow: async operation => operation(), onBusyChange: () => {}, actionInProgress: false,
    };
    const html = renderToStaticMarkup(createElement(CounterTradeV2Activity, props));
    expect(html).toContain('Received 0.004 TOKEN_B · Paid 0.05 TOKEN_A · Returned 0.07 TOKEN_A');
    expect(html).toContain('Returned 0.04 TOKEN_A');
    expect(html).not.toContain('Amount unavailable');
    for (const metadata of [{}, Object.fromEntries(Object.entries(tokenInfoByKey).map(([key, token]) => [key, { ...token, error: 'Metadata unavailable.' }]))]) {
      const unavailable = renderToStaticMarkup(createElement(CounterTradeV2Activity, { ...props, tokenInfoByKey: metadata }));
      expect(unavailable).toContain('Received Amount unavailable · Paid Amount unavailable · Returned Amount unavailable');
      expect(unavailable).toContain('Returned Amount unavailable');
      expect(unavailable).not.toMatch(/(?:Received|Paid|Returned) 0(?:[ .<])/);
    }
  });
  it('tags every order and history event with its attested deployment identity', async () => {
    const result = await fixture(false).reader.sync({} as never);
    for (const row of [...result.orders, ...result.history]) expect(row).toMatchObject({ chainId: '7082400', escrow });
    expect(result.history.find(row => row.blockNumber === '12')?.key).toBe(`${hash(12)}:${hash(112)}:0x00`);
  });
  it('rebuilds the Standard parent counter activity and exact public refund after reconnecting', async () => {
    const f = fixture(false, 'standard'), result = await f.reader.sync({} as never);
    expect(result.history.find(v => v.id === incoming && v.status === 2)).toMatchObject({ payment: '5', received: '4', refund: '7' });
    expect(await f.create().sync({} as never)).toEqual(result);
    expect(m.decrypt).not.toHaveBeenCalled();
  });
  it('includes the exact owner refund from an admitted Book parent', async () => {
    const f = fixture(true, true), result = await f.reader.sync({} as never);
    expect(result.history.find(v => v.id === incoming && v.status === 2)).toMatchObject({ payment: '5', received: '4', refund: '7' });
  });
  it.each([false, true])('discovers both participant roles and actual payments/refunds without IDs or local history, private=%s', async privatePair => {
    const f = fixture(privatePair), result = await f.reader.sync({} as never);
    expect(result).toMatchObject({ complete: true, throughBlock: '38' });
    expect(result.orders).toMatchObject([{ id: incoming, status: 2 }, { id, status: 3 }]);
    expect(result.history.find(v => v.id === incoming && v.status === 2)).toMatchObject({ role: 'taker', payment: '5', received: '4', refund: '7' });
    expect(result.history.find(v => v.id === id && v.status === 3)).toMatchObject({ role: 'maker', refund: '4' });
    expect(m.range.mock.calls[0][0].topics).toEqual([[ABI.getEvent('CounterOpened')!.topicHash, ABI.getEvent('CounterClosed')!.topicHash]]);
    expect(await f.create().sync({} as never)).toEqual(result);
  });
  it('keeps 2048-block recent-first pages without an order quota or per-order closure query', async () => {
    const f = fixture(false); f.events.splice(0);
    for (let i = 1; i <= 65; i++) f.events.push(f.open(String(i), owner, other, 12, i));
    expect((await f.reader.sync({} as never)).orders).toHaveLength(65);
    expect(m.range).toHaveBeenCalledOnce();
    const paged = fixture(false); m.latest.mockResolvedValue('5000');
    expect(await paged.reader.sync({} as never)).toMatchObject({ fromBlock: '2951', throughBlock: '4998', complete: false });
    expect(await paged.reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '903', throughBlock: '4998', complete: false });
    expect((await paged.reader.sync({} as never, 'older')).complete).toBe(true);
  });
  it('covers an empty 85000-block gap with one 100000-block page for both participant roles', async () => {
    const f = fixture(false); f.events.splice(0); m.latest.mockResolvedValue('85010');
    const reader = f.create({ pageRangeBlocks: 100_000n });
    const result = await reader.sync({} as never);
    expect(result).toMatchObject({ complete: true, throughBlock: '85008', safeHead: '85008', orders: [], history: [] });
    expect(m.range.mock.calls.map(([input]) => [input.fromBlock, input.toBlock])).toEqual([[10n, 85008n]]);
  });
  it.each([false, true])('shows recent closure of an old counter with exact amounts before loading its creation, private=%s', async privatePair => {
    const f = fixture(privatePair), reader = f.create({ pageRangeBlocks: 20n });
    const recent = await reader.sync({} as never);
    expect(recent).toMatchObject({ fromBlock: '19', throughBlock: '38', complete: false });
    expect(recent.history).toHaveLength(2);
    expect(recent.history.find(row => row.id === id)).toMatchObject({ status: 3, refund: '4' });
    expect(recent.history.find(row => row.id === incoming)).toMatchObject({ status: 2, payment: '5', received: '4', refund: '7' });
    const all = await reader.sync({} as never, 'older');
    expect(all).toMatchObject({ fromBlock: '10', throughBlock: '38', complete: true });
    expect(all.history).toHaveLength(4); expect(new Set(all.history.map(row => row.key)).size).toBe(4);
    expect(await reader.sync({} as never)).toEqual(all);
  });
  it('decrypts cached old-counter terms again with the current privacy capability', async () => {
    const f = fixture(true), reader = f.create({ pageRangeBlocks: 20n });
    // Isolate participant terms: these canonical closure receipts have no usable token transfers.
    for (const block of [20, 22]) f.receipts[hash(block + 100)] = f.receipts[hash(block + 100)].filter(log => log.address === escrow);
    const firstSigner = {}, replacementSigner = {};
    m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer: firstSigner });
    const committed = await reader.sync({} as never);
    expect(committed.history).toHaveLength(2);
    expect(committed.orders.every(order => order.offer === '4' && order.request === '5')).toBe(true);
    m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n, signer: replacementSigner });
    m.decrypt.mockImplementation(() => { throw new Error('Replacement privacy capability cannot decrypt.'); });
    await expect(reader.sync({} as never)).rejects.toThrow('Replacement privacy capability cannot decrypt.');
    expect(m.decrypt).toHaveBeenLastCalledWith(replacementSigner, expect.anything());
    m.decrypt.mockImplementation((signer, value) => { expect(signer).toBe(replacementSigner); return BigInt(value.ciphertextLow); });
    expect(await reader.sync({} as never)).toEqual(committed);
    expect(m.range).toHaveBeenCalledOnce();
    expect(m.view).toHaveBeenCalledTimes(4);
  });
  it('shrinks a dense default window without an automatic retry', async () => {
    const f = fixture(false); m.latest.mockResolvedValue('5000');
    m.range.mockRejectedValueOnce(new TradeHistoryV2RangeLimitError());
    expect(await f.reader.sync({} as never)).toMatchObject({ complete: false, fromBlock: undefined });
    expect(m.range).toHaveBeenCalledOnce();
    expect(await f.reader.sync({} as never)).toMatchObject({ fromBlock: '3975', throughBlock: '4998', complete: false });
  });
  it('finishes older pages at the retained safe head when newer blocks arrive', async () => {
    const f = fixture(false), reader = f.create({ pageRangeBlocks: 20n });
    await reader.sync({} as never); m.latest.mockResolvedValue('5000');
    expect(await reader.sync({} as never, 'older')).toMatchObject({ complete: true, fromBlock: '10', throughBlock: '38', safeHead: '38' });
    expect(m.range.mock.calls.map(([page]) => [page.fromBlock, page.toBlock])).toEqual([[19n, 38n], [10n, 18n]]);
  });
  it('excludes unrelated global closures without reading their private participant terms', async () => {
    const f = fixture(true), reader = f.create({ pageRangeBlocks: 20n });
    f.events.push(f.open('3', address('77'), address('88'), 15), log('CounterClosed', [3, 3n, address('77')], 30));
    const result = await reader.sync({} as never);
    expect(result.history).toHaveLength(2); expect(result.history.some(row => row.id === '3')).toBe(false);
    const privateReads = m.view.mock.calls.map(([input]) => ABI.parseTransaction({ data: input.data })!)
      .filter(call => call.name === 'getTermsForAccount').map(call => call.args[0].toString());
    expect(privateReads.sort()).toEqual([id, incoming].sort());
  });
  it('extends a short latest refresh and retains a long refresh gap until older pages fill it', async () => {
    const f = fixture(false), reader = f.create({ pageRangeBlocks: 20n });
    await reader.sync({} as never); m.latest.mockResolvedValue('46');
    expect(await reader.sync({} as never)).toMatchObject({ fromBlock: '19', throughBlock: '44', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '10', throughBlock: '44', complete: true });
    f.events.push(f.open('3', owner, other, 50), log('CounterClosed', [3, 3n, owner], 60));
    f.receipts[hash(160)] = [f.events[f.events.length - 1], f.transfer(a, escrow, owner, 4n, 60, 1)];
    m.latest.mockResolvedValue('100');
    expect(await reader.sync({} as never)).toMatchObject({ fromBlock: '79', throughBlock: '98', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '59', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '39', complete: false });
    expect(await reader.sync({} as never, 'older')).toMatchObject({ fromBlock: '19', complete: false });
    const all = await reader.sync({} as never, 'older');
    expect(all).toMatchObject({ fromBlock: '10', throughBlock: '98', complete: true });
    expect(all.history).toHaveLength(6); expect(new Set(all.history.map(row => row.key)).size).toBe(6);
    expect(all.history.find(row => row.id === '3' && row.status === 3)?.refund).toBe('4');
  });
  it('falls back after an oversized range while keeping committed rows and cursor', async () => {
    const f = fixture(false), reader = f.create({ pageRangeBlocks: 100_000n });
    const committed = await reader.sync({} as never);
    expect(committed.complete).toBe(true);
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
    expect(calls.map(input => [input.fromBlock, input.toBlock])).toEqual([[39n, 85008n]]);
    expect(fallback).toMatchObject({ complete: false, throughBlock: '38', safeHead: '85008' });
    expect(fallback.orders).toEqual(committed.orders);
    expect(fallback.history).toEqual(committed.history);
    const next = await reader.sync({} as never);
    expect(calls[1]).toMatchObject({ fromBlock: 82961n, toBlock: 85008n });
    expect(next).toMatchObject({ fromBlock: '82961', throughBlock: '85008', complete: false });
    expect(next.orders).toEqual(committed.orders);
    expect(next.history).toEqual(committed.history);
  });
  it('keeps the committed snapshot and retries the same uncommitted page if the event filter fails', async () => {
    const f = fixture(false);
    const committed = await f.reader.sync({} as never);
    f.events.push(f.open('3', owner, other, 50));
    m.latest.mockResolvedValue('80');
    const original = m.range.getMockImplementation()!;
    m.range.mockRejectedValueOnce(new Error('Participant filter failed.'));
    await expect(f.reader.sync({} as never)).rejects.toThrow('Participant filter failed.');
    m.range.mockImplementation(original);
    m.range.mockClear();
    const recovered = await f.reader.sync({} as never);
    expect(recovered).toMatchObject({ complete: true, throughBlock: '78' });
    expect(recovered.orders).toHaveLength(3);
    expect(recovered.history.filter(row => row.id !== '3')).toEqual(committed.history);
    expect(m.range.mock.calls[0][0]).toMatchObject({ fromBlock: 39n, toBlock: 78n });
  });
  it('removes orphan activity and rebuilds after the committed block changes', async () => {
    const f = fixture(); await f.reader.sync({} as never);
    f.events.splice(f.events.findIndex(v => v.topics[0] === ABI.getEvent('CounterClosed')!.topicHash && BigInt(v.blockNumber) === 20n), 1); f.fork();
    const next = await f.reader.sync({} as never); expect(next.orders.find(v => v.id === id)?.status).toBe(1);
    expect(next.history.some(v => v.id === id && v.status === 3)).toBe(false);
  });
  it('rejects a shared page if the final activity commit block changes and replays it on retry', async () => {
    const f = fixture(false);
    m.block.mockResolvedValueOnce({ number: '38', hash: hash(999) });
    await expect(f.reader.sync({} as never)).rejects.toThrow('reorganized before commit');
    const recovered = await f.reader.sync({} as never);
    expect(recovered).toMatchObject({ complete: true, throughBlock: '38' });
    expect(recovered.history).toHaveLength(4);
    expect(m.range.mock.calls.map(([input]) => input.fromBlock)).toEqual([10n, 10n]);
  });
  it('does not commit an invalid payment page and permits an explicit clean retry', async () => {
    const f = fixture(); const original = f.receipts[hash(122)][2]; f.receipts[hash(122)][2] = f.transfer(a, owner, other, 6n, 22, 2);
    await expect(f.reader.sync({} as never)).rejects.toThrow(/settlement/);
    f.receipts[hash(122)][2] = original;
    const result = await f.reader.sync({} as never); expect(result.history).toHaveLength(4); expect(result.throughBlock).toBe('38');
  });
  it('keeps missing private terms unavailable and never decrypts another recipient', async () => {
    const f = fixture(); f.receipts[hash(112)] = f.receipts[hash(112)].filter(v => v.topics[0] !== ABI.getEvent('CounterPrivateTerms')!.topicHash || ABI.parseLog({ topics: [...v.topics], data: v.data })!.args.recipient.toLowerCase() !== owner);
    const row = (await f.reader.sync({} as never)).orders.find(v => v.id === id)!; expect(row.offer).toBeUndefined(); expect(row.request).toBeUndefined();
    expect(m.decrypt.mock.results.every(v => v.type === 'return')).toBe(true);
  });
  it('rejects a different selected owner and a closed reader before fetching events', async () => {
    const f = fixture(); m.binding.mockReturnValue({ ownerAddress: other, chainId: 7082400n });
    await expect(f.reader.sync({} as never)).rejects.toThrow(/session/); expect(m.range).not.toHaveBeenCalled();
    m.binding.mockReturnValue({ ownerAddress: owner, chainId: 7082400n }); f.reader.close(); await expect(f.reader.sync({} as never)).rejects.toThrow(/session/);
  });
});

describe('Counter snapshots from current and retained deployments', () => {
  const snapshot = (contract = escrow, chainId = '7082400'): CounterTradeV2ActivitySnapshot => {
    const order = { chainId, escrow: contract, id, maker: owner, taker: other, offerToken: a, requestToken: b,
      privatePair: false, expiresAt: '0', status: 1 };
    return { orders: [order], history: [{ ...order, key: `${hash(12)}:${hash(112)}:0x0`,
      transactionHash: hash(112), blockNumber: '12', role: 'maker' }], complete: true, throughBlock: '38', safeHead: '38' };
  };
  it('preserves equal numeric IDs and physical logs in separate escrow and chain scopes', () => {
    const current = snapshot(), retained = snapshot(parent), otherChain = snapshot(escrow, '2632500');
    const result = mergeCounterTradeV2ActivitySnapshots([current, retained, otherChain]);
    expect(result.orders.map(row => [row.chainId, row.escrow, row.id])).toEqual([
      ['7082400', escrow, id], ['7082400', parent, id], ['2632500', escrow, id]]);
    expect(result.history).toHaveLength(3);
    expect(new Set(result.history.map(row => `${row.chainId}:${row.escrow}:${row.key}`)).size).toBe(3);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.orders)).toBe(true);
    expect(Object.isFrozen(result.history)).toBe(true); expect(result.orders.every(Object.isFrozen)).toBe(true);
    expect(result.history.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(current.orders[0])).toBe(false);
  });
  it('reports the minimum committed coverage and never hides an unfinished retained scan', () => {
    const current = snapshot(), retained = { ...snapshot(parent), throughBlock: '20', safeHead: '30', complete: false };
    expect(mergeCounterTradeV2ActivitySnapshots([current, retained])).toMatchObject({ complete: false, throughBlock: '20', safeHead: '30' });
    expect(mergeCounterTradeV2ActivitySnapshots([current, { ...retained, throughBlock: undefined }]).throughBlock).toBeUndefined();
    expect(mergeCounterTradeV2ActivitySnapshots([current, snapshot(parent)]).complete).toBe(true);
    expect(mergeCounterTradeV2ActivitySnapshots([])).toEqual({ orders: [], history: [], complete: false, throughBlock: undefined, safeHead: '0' });
  });
  it('deduplicates identical scoped rows and rejects conflicting order or physical-log data', () => {
    const current = snapshot();
    const result = mergeCounterTradeV2ActivitySnapshots([current, snapshot()]);
    expect(result.orders).toHaveLength(1); expect(result.history).toHaveLength(1);
    expect(() => mergeCounterTradeV2ActivitySnapshots([current, { ...snapshot(), orders: [{ ...current.orders[0], status: 3 }] }])).toThrow(/order.*conflict/i);
    expect(() => mergeCounterTradeV2ActivitySnapshots([current, { ...snapshot(), history: [{ ...current.history[0], refund: '4' }] }])).toThrow(/event.*conflict/i);
  });
  it('sorts merged events newest first, with log index as the same-block tie breaker', () => {
    const current = snapshot(), retained = snapshot(parent);
    const later = { ...retained.history[0], key: `${retained.history[0].key.slice(0, -3)}0x2`, blockNumber: '12' };
    const newest = { ...retained.history[0], key: `${retained.history[0].key.slice(0, -3)}0x1`, blockNumber: '20' };
    const result = mergeCounterTradeV2ActivitySnapshots([current, { ...retained, history: [later, newest] }]);
    expect(result.history.map(row => [row.blockNumber, row.key.slice(-3)])).toEqual([['20', '0x1'], ['12', '0x2'], ['12', '0x0']]);
    expect(current.history[0].blockNumber).toBe('12');
  });
});

