import { describe, expect, it, vi } from 'vitest';
import { Interface } from '@coti-io/coti-ethers';
import { currentDexAsyncTerminalResumeHashes, readCurrentDexActivityDiscoveryPage, readCurrentDexAsyncTerminalPage } from './currentDexActivityDiscovery';
import { CURRENT_CHEAP_DEX_QUOTE_ABI } from './currentDexOperation';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as historyCandidate } from './dexV2Deployment';
import type { CurrentDexActivityRow } from './currentDexActivityReceipt';

const owner = '0x1111111111111111111111111111111111111111';
const core = '0x52d5d2acc60ada57a7316de996221766bafffe27';
const tx = (hash: string, from = owner, to = core, blockNumber = '10') => ({ hash, from, to, blockNumber });
const response = (result: unknown, status = '1', message = 'OK') => ({
  ok: true, json: async () => ({ status, message, result })
}) as Response;
const nftHash = `0x${'a'.repeat(64)}`;
const txHash = `0x${'b'.repeat(64)}`;

const quoteHash = `0x${'c'.repeat(64)}`;
const terminalHash = `0x${'d'.repeat(64)}`;
const terminalAbi = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI);
const asyncQuote = (overrides: Partial<CurrentDexActivityRow> = {}): CurrentDexActivityRow => ({
  core: historyCandidate.core, hash: quoteHash, blockNumber: 1, blockHash: `0x${'1'.repeat(64)}`,
  timestamp: 1000n, action: 'Multi-source Quote', status: 'Confirmed', kind: 'async-quote', operationId: 53n,
  inputToken: '0x2222222222222222222222222222222222222222', outputToken: '0x3333333333333333333333333333333333333333',
  movements: [], amountsState: 'none', readyToSign: false, nativeAdmission: false, ...overrides
});
const terminalLog = (operationId = 53n, stage = 7, blockNumber = 5000, address: string = historyCandidate.core,
  removed = false) => {
  const encoded = terminalAbi.encodeEventLog(terminalAbi.getEvent('CheapAsyncAdvanced')!, [operationId, stage, `0x${'2'.repeat(64)}`]);
  return { address, topics: encoded.topics, data: encoded.data, blockNumber, transactionHash: terminalHash, removed };
};

describe('readCurrentDexActivityDiscoveryPage', () => {
  it('marks only an explorer transport failure as a retryable source error', async () => {
    const read = (fetcher: typeof fetch, assertCurrent: () => void = () => {}) => readCurrentDexActivityDiscoveryPage({
      owner, candidate: 'cheap-history', headNumber: 20n, cursor: { transactions: 2, nfts: null }, fetcher, assertCurrent });
    for (const failure of [vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      vi.fn().mockResolvedValue({ ok: false, status: 408 }),
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')),
      vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new TypeError('Failed to fetch body'); } })]) {
      await expect(read(failure)).rejects.toMatchObject({ name: 'CurrentDexActivitySourceError' });
      expect(failure).toHaveBeenCalledOnce();
    }
    for (const failure of [vi.fn().mockResolvedValue({ ok: false, status: 403 }),
      vi.fn().mockResolvedValue(response([], '0', 'Invalid API key')),
      vi.fn().mockResolvedValue(response([tx(txHash, 'bad-owner')])),
      vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }),
      vi.fn().mockRejectedValue(new Error('unknown error'))]) {
      await expect(read(failure)).rejects.not.toMatchObject({ name: 'CurrentDexActivitySourceError' });
    }
    let active = true;
    const fetcher = vi.fn(async () => { active = false; throw new TypeError('Failed to fetch'); });
    await expect(read(fetcher, () => { if (!active) throw new Error('privacy changed'); })).rejects.toThrow('privacy changed');
  });
  it('uses the new Core and NFT without selecting old Core transactions', async () => {
    const nft = historyCandidate.companions.find(([role]) => role === 'ChainWhisperDexPositionNFT')![1];
    const fetcher = vi.fn().mockResolvedValueOnce(response([tx(txHash, owner, historyCandidate.core), tx(nftHash)]))
      .mockResolvedValueOnce(response([]));
    const page = await readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-history', headNumber: 20n,
      cursor: { transactions: 1, nfts: 1 }, fetcher, assertCurrent: () => undefined });
    expect(page.hashes).toEqual([txHash]);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('contractaddress')).toBe(nft);
  });
  it('reads the owner transaction and position NFT pages, then returns one deduplicated hash list', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([tx(txHash)]))
      .mockResolvedValueOnce(response([tx(txHash, '0x2222222222222222222222222222222222222222', owner),
        tx(nftHash, '0x2222222222222222222222222222222222222222', owner)]));

    const page = await readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: 1 }, fetcher, assertCurrent: () => undefined });

    expect(page).toEqual({ hashes: [txHash, nftHash], nextCursor: { transactions: null, nfts: null }, complete: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const urls = fetcher.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.every(url => url.origin === 'https://testnet.cotiscan.io' && url.pathname === '/api')).toBe(true);
    expect(urls.map(url => url.searchParams.get('action'))).toEqual(['txlist', 'tokennfttx']);
  });

  it('advances only full pages and rejects blocks above the captured head', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => tx(`0x${i.toString(16).padStart(64, '0')}`, owner, core, i === 0 ? '21' : '20'));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(rows))
      .mockResolvedValueOnce(response([] , '0', 'No transactions found'));
    const page = await readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 4, nfts: 2 }, fetcher, assertCurrent: () => undefined });
    expect(page.hashes).toHaveLength(4);
    expect(page.nextCursor).toEqual({ transactions: 5, nfts: null });
    expect(page.complete).toBe(false);
  });

  it('bounds each recent page to five raw hints per source and reaches all older hints without draining', async () => {
    const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
    const unrelated = '0x2222222222222222222222222222222222222222';
    const transactions = [tx(hash(1)), tx(hash(2)), tx(hash(3), owner, unrelated), tx(hash(4)), tx(hash(5)),
      tx(hash(6)), tx(hash(7)), tx(hash(8)), tx(hash(9)), tx(hash(10)), tx(hash(11))];
    const nfts = [tx(hash(1), unrelated, owner), tx(hash(12), unrelated, owner), tx(hash(12), unrelated, owner),
      tx(hash(13), unrelated, owner), tx(hash(14), unrelated, owner), tx(hash(15), unrelated, owner)];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input)), offset = Number(url.searchParams.get('offset'));
      expect(offset).toBe(5); expect(url.searchParams.get('sort')).toBe('desc');
      expect(url.searchParams.get('endblock')).toBe('20');
      const rows = url.searchParams.get('action') === 'txlist' ? transactions : nfts;
      const start = (Number(url.searchParams.get('page')) - 1) * offset;
      return response(rows.slice(start, start + offset));
    });
    const read = (cursor: Parameters<typeof readCurrentDexActivityDiscoveryPage>[0]['cursor']) =>
      readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n, cursor, fetcher, assertCurrent: () => undefined });
    const first = await read({ transactions: 1, nfts: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.hashes.length).toBeLessThanOrEqual(10);
    expect(first.hashes).toEqual([hash(1),hash(2),hash(4),hash(5),hash(12),hash(13),hash(14)]);
    expect(first.nextCursor).toEqual({ transactions: 2, nfts: 2 });
    const second = await read(first.nextCursor);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(second.nextCursor).toEqual({ transactions: 3, nfts: null });
    const third = await read(second.nextCursor);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(third).toMatchObject({ complete: true, nextCursor: { transactions: null, nfts: null } });
    expect(new Set([...first.hashes,...second.hashes,...third.hashes])).toEqual(
      new Set([1,2,4,5,6,7,8,9,10,11,12,13,14,15].map(hash)));
  });

  it('rejects an oversized explorer page without truncating it or advancing a cursor', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(Array.from({ length: 6 }, (_, index) =>
      tx(`0x${(index + 1).toString(16).padStart(64, '0')}`))));
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: null }, fetcher, assertCurrent: () => undefined })).rejects.toThrow('page exceeded its limit');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects an explorer API error instead of treating it as empty history', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([], '0', 'Invalid API key'));
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: null }, fetcher, assertCurrent: () => undefined }))
      .rejects.toThrow(/explorer/i);
  });

  it('accepts the explorer empty NFT-transfer response', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([], '0', 'No token transfers found'));
    const page = await readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: null, nfts: 1 }, fetcher, assertCurrent: () => undefined });
    expect(page).toEqual({ hashes: [], nextCursor: { transactions: null, nfts: null }, complete: true });
  });

  it('stops when the wallet lease is revoked and rejects invalid cursors', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([]));
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: null }, fetcher, assertCurrent: () => { throw new Error('lease revoked'); } }))
      .rejects.toThrow('lease revoked');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 0, nfts: null }, fetcher, assertCurrent: () => undefined }))
      .rejects.toThrow(/cursor/i);
  });

  it('rejects malformed explorer rows and conflicting block numbers within a feed', async () => {
    const malformed = vi.fn().mockResolvedValue(response([tx(txHash, 'not-an-address')]));
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: null }, fetcher: malformed, assertCurrent: () => undefined }))
      .rejects.toThrow(/row/i);
    const conflicting = vi.fn().mockResolvedValue(response([tx(txHash), tx(txHash, owner,
      core, '11')]));
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: null }, fetcher: conflicting, assertCurrent: () => undefined }))
      .rejects.toThrow(/block number/i);
  });

  it('ignores contract creations and rows that do not involve the owner, but rejects malformed non-empty destinations', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([
      { ...tx(txHash), to: '' },
      { ...tx(nftHash), to: null },
      tx(`0x${'c'.repeat(64)}`, '0x2222222222222222222222222222222222222222', core)
    ]));
    const page = await readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: null }, fetcher, assertCurrent: () => undefined });
    expect(page.hashes).toEqual([]);
    const malformed = vi.fn().mockResolvedValue(response([{ ...tx(txHash), to: 'not-an-address' }]));
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: null }, fetcher: malformed, assertCurrent: () => undefined }))
      .rejects.toThrow(/row/i);
  });

  it('rejects cross-feed duplicates with different block numbers', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([tx(txHash)]))
      .mockResolvedValueOnce(response([tx(txHash, '0x2222222222222222222222222222222222222222', owner, '11')]));
    await expect(readCurrentDexActivityDiscoveryPage({ owner, candidate: 'cheap-exit', headNumber: 20n,
      cursor: { transactions: 1, nfts: 1 }, fetcher, assertCurrent: () => undefined }))
      .rejects.toThrow(/block number/i);
  });
});

describe('readCurrentDexAsyncTerminalPage', () => {
  it('finds a late terminal across bounded pages and resumes at the exact next block', async () => {
    const ranges: { fromBlock: number; toBlock: number }[] = [];
    const readLogs = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: number; toBlock: number }) => {
      ranges.push({ fromBlock, toBlock });
      return fromBlock <= 5000 && 5000 <= toBlock ? [terminalLog()] : [];
    });
    const first = await readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 6000n,
      readLogs, assertCurrent: () => undefined });

    expect(first).toMatchObject({ terminals: [], nextCursor: { [quoteHash]: 4097 }, complete: false });
    expect(Math.max(...ranges.map(range => range.toBlock - range.fromBlock + 1))).toBeLessThanOrEqual(256);
    expect(Math.max(...ranges.map(range => range.toBlock))).toBe(4096);

    ranges.length = 0;
    const second = await readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 6000n,
      cursor: first.nextCursor, readLogs, assertCurrent: () => undefined });
    expect(second.terminals).toEqual([{ hash: terminalHash, quote: asyncQuote() }]);
    expect(second.complete).toBe(true);
    expect(Math.min(...ranges.map(range => range.fromBlock))).toBe(4097);
    expect(Math.max(...ranges.map(range => range.toBlock - range.fromBlock + 1))).toBeLessThanOrEqual(256);
  });

  it('marks a pending operation complete after scanning the captured head without inventing a terminal', async () => {
    const readLogs = vi.fn().mockResolvedValue([]);
    const page = await readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 10n,
      readLogs, assertCurrent: () => undefined });
    expect(page).toEqual({ terminals: [], nextCursor: {}, complete: true });
    expect(readLogs).toHaveBeenCalledTimes(1);
    expect(readLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 1, toBlock: 10 }));
  });

  it.each([
    { label: 'wrong Core', log: terminalLog(53n, 7, 2, owner) },
    { label: 'wrong operation', log: terminalLog(54n, 7, 2) },
    { label: 'removed log', log: terminalLog(53n, 7, 2, historyCandidate.core, true) },
    { label: 'out-of-range log', log: terminalLog(53n, 7, 11) },
    { label: 'malformed log', log: { ...terminalLog(53n, 7, 2), data: '0x12' } }
  ])('rejects a $label event', async ({ log }) => {
    const readLogs = vi.fn().mockResolvedValue([log]);
    await expect(readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 10n,
      readLogs, assertCurrent: () => undefined })).rejects.toThrow();
  });

  it('does not treat a public nonterminal stage as a completed operation', async () => {
    const readLogs = vi.fn().mockResolvedValue([terminalLog(53n, 6, 2)]);
    const page = await readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 2n,
      readLogs, assertCurrent: () => undefined });
    expect(page).toEqual({ terminals: [], nextCursor: {}, complete: true });
  });

  it.each([
    { label: 'another candidate', candidate: 'cheap-exit' as const, quote: asyncQuote() },
    { label: 'wrong Core', candidate: 'cheap-history' as const, quote: asyncQuote({ core: owner }) },
    { label: 'malformed Quote hash', candidate: 'cheap-history' as const, quote: asyncQuote({ hash: '0x12' }) },
    { label: 'non-async Quote', candidate: 'cheap-history' as const, quote: asyncQuote({ kind: 'fast-quote' }) },
    { label: 'zero operation ID', candidate: 'cheap-history' as const, quote: asyncQuote({ operationId: 0n }) },
    { label: 'Quote above the captured head', candidate: 'cheap-history' as const, quote: asyncQuote({ blockNumber: 11 }) }
  ])('rejects a $label witness before reading logs', async ({ candidate, quote }) => {
    const readLogs = vi.fn().mockResolvedValue([]);
    await expect(readCurrentDexAsyncTerminalPage({ candidate, quotes: [quote], headNumber: 10n,
      readLogs, assertCurrent: () => undefined })).rejects.toThrow();
    expect(readLogs).not.toHaveBeenCalled();
  });

  it('rejects a cursor outside its quote scan and stops when the wallet lease is revoked', async () => {
    const readLogs = vi.fn().mockResolvedValue([]);
    await expect(readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 10n,
      cursor: { [quoteHash]: 0 }, readLogs, assertCurrent: () => undefined })).rejects.toThrow(/cursor/i);
    expect(readLogs).not.toHaveBeenCalled();
    await expect(readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 10n,
      readLogs, assertCurrent: () => { throw new Error('lease revoked'); } })).rejects.toThrow('lease revoked');
    expect(readLogs).not.toHaveBeenCalled();
  });

  it('retains cursor entries when their Quote witness is not in this page', async () => {
    const missingQuoteHash = `0x${'e'.repeat(64)}`;
    const readLogs = vi.fn().mockResolvedValue([]);
    const page = await readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [asyncQuote()], headNumber: 10n,
      cursor: { [missingQuoteHash]: 4 }, readLogs, assertCurrent: () => undefined });
    expect(page).toEqual({ terminals: [], nextCursor: { [missingQuoteHash]: 4 }, complete: false });
  });

  it('rotates an unscanned quote ahead of unfinished scans and keeps its cursor', async () => {
    const quotes = Array.from({ length: 101 }, (_, i) => asyncQuote({ hash: `0x${(i + 1).toString(16).padStart(64, '0')}` }));
    const readLogs = vi.fn().mockResolvedValue([]);
    const page = await readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes, headNumber: 6000n,
      readLogs, assertCurrent: () => undefined });
    const resumed = currentDexAsyncTerminalResumeHashes(page.nextCursor, 6000n);
    expect(page.complete).toBe(false);
    expect(Object.keys(page.nextCursor)).toHaveLength(101);
    expect(Object.values(page.nextCursor)).toContain(1);
    expect(resumed).toHaveLength(100);
    expect(resumed[0]).toBe(quotes[100].hash);
  });

  it('moves missing Quote witnesses behind available work without reading logs for them', async () => {
    const missingHashes = Array.from({ length: 100 }, (_, i) => `0x${(i + 1000).toString(16).padStart(64, '0')}`);
    const availableQuote = asyncQuote({ hash: `0x${'f'.repeat(64)}` });
    const cursor = Object.fromEntries([...missingHashes, availableQuote.hash].map(hash => [hash, 1]));
    const readLogs = vi.fn().mockResolvedValue([]);
    const page = await readCurrentDexAsyncTerminalPage({ candidate: 'cheap-history', quotes: [availableQuote], headNumber: 10n,
      cursor, readLogs, assertCurrent: () => undefined });
    expect(Object.keys(page.nextCursor)).toHaveLength(101);
    expect(currentDexAsyncTerminalResumeHashes(page.nextCursor, 10n)[0]).toBe(availableQuote.hash);
    expect(page.nextCursor[availableQuote.hash]).toBe(1);
    expect(readLogs).not.toHaveBeenCalled();
  });
});
