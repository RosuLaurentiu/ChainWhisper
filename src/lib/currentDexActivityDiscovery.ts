import { Interface, toBeHex } from '@coti-io/coti-ethers';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { CURRENT_SHARED_TOKEN_DISTRIBUTION } from './currentSharedDexTokenDistribution';
import { CURRENT_CHEAP_DEX_QUOTE_ABI } from './currentDexOperation';
import type { CurrentDexActivityRow } from './currentDexActivityReceipt';

export type CurrentDexActivityCursor = Readonly<{ transactions: number | null; nfts: number | null;
  limitFills?: Readonly<Record<string, bigint | null>>;
  asyncTerminals?: Readonly<Record<string, number>> }>;
export type CurrentDexActivityCandidate = 'cheap-exit' | 'cheap-history';
export type CurrentDexActivityDiscoveryPage = Readonly<{
  hashes: readonly string[];
  nextCursor: CurrentDexActivityCursor;
  complete: boolean;
}>;

const PAGE_SIZE = 100;
const HASH = /^0x[0-9a-f]{64}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const parseRow = (value: unknown): Readonly<{ hash: string; from: string; to: string | null; blockNumber: bigint }> => {
  if (!isRecord(value) || typeof value.hash !== 'string' || !HASH.test(value.hash) ||
    typeof value.from !== 'string' || !ADDRESS.test(value.from) ||
    !(value.to === null || value.to === '' || (typeof value.to === 'string' && ADDRESS.test(value.to))) ||
    typeof value.blockNumber !== 'string' || !DECIMAL.test(value.blockNumber)) {
    throw new Error('Invalid DEX activity explorer row.');
  }
  return Object.freeze({ hash: value.hash.toLowerCase(), from: value.from.toLowerCase(),
    to: typeof value.to === 'string' && value.to ? value.to.toLowerCase() : null,
    blockNumber: BigInt(value.blockNumber) });
};

const readPage = async ({ action, owner, page, headNumber, assertCurrent, fetcher, contractAddress }: {
  action: 'txlist' | 'tokennfttx'; owner: string; page: number; headNumber: bigint;
  assertCurrent: () => void | Promise<void>; fetcher: typeof fetch; contractAddress?: string;
}): Promise<readonly unknown[]> => {
  const url = new URL('/api', COTI_TESTNET_NETWORK.blockExplorerUrl);
  url.search = new URLSearchParams({ module: 'account', action, address: owner, startblock: '0',
    endblock: headNumber.toString(), page: String(page), offset: String(PAGE_SIZE), sort: 'desc',
    ...(contractAddress ? { contractaddress: contractAddress } : {}) }).toString();
  await assertCurrent();
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  await assertCurrent();
  if (!response.ok) throw new Error('DEX activity explorer request failed.');
  const body: unknown = await response.json();
  await assertCurrent();
  if (!isRecord(body) || typeof body.status !== 'string' || typeof body.message !== 'string')
    throw new Error('Invalid DEX activity explorer response.');
  if (body.status === '0' && Array.isArray(body.result) && body.result.length === 0 &&
    /no (?:transactions|records|token transfers) found/i.test(body.message)) return [];
  if (body.status !== '1' || !Array.isArray(body.result)) throw new Error('DEX activity explorer returned an error.');
  return body.result;
};

const validateCursor = (value: number | null): void => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid DEX activity cursor.');
};

export const currentDexAsyncTerminalResumeHashes = (cursor: Readonly<Record<string, number>> | undefined,
  headNumber: bigint): readonly string[] => {
  if (typeof headNumber !== 'bigint' || headNumber < 0n || headNumber > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Invalid DEX activity head.');
  if (cursor === undefined) return [];
  if (!isRecord(cursor) || Object.entries(cursor).some(([hash, block]) => !HASH.test(hash) || hash !== hash.toLowerCase() ||
      BigInt(hash) === 0n || !Number.isSafeInteger(block) || (block as number) < 0 || BigInt(block as number) > headNumber))
    throw new Error('Invalid DEX activity terminal cursor.');
  return Object.freeze(Object.keys(cursor).slice(0, PAGE_SIZE));
};

// Cursor entries contain only public Quote hashes and block numbers; receipt decoding stays owner-bound.
export const readCurrentDexAsyncTerminalPage = async ({ candidate, quotes, headNumber, cursor, readLogs, assertCurrent }: {
  candidate: CurrentDexActivityCandidate; quotes: readonly CurrentDexActivityRow[]; headNumber: bigint;
  cursor?: Readonly<Record<string, number>>;
  readLogs: (filter: { address: string; fromBlock: number; toBlock: number; topics: string[] }) => Promise<readonly {
    address: string; topics: readonly string[]; data: string; blockNumber: number; transactionHash: string; removed: boolean;
  }[]>;
  assertCurrent: () => void | Promise<void>;
}) => {
  await assertCurrent();
  currentDexAsyncTerminalResumeHashes(cursor, headNumber);
  if (!['cheap-exit', 'cheap-history'].includes(candidate)) throw new Error('DEX activity candidate is unavailable.');
  const core = resolvePreparedDexScope(candidate).candidate.core, head = Number(headNumber);
  const nextCursor: Record<string, number> = { ...cursor }, byHash = new Map<string, CurrentDexActivityRow>();
  for (const quote of quotes) {
    if (quote.kind !== 'async-quote' || quote.status === 'Failed' || quote.core.toLowerCase() !== core.toLowerCase() ||
        !HASH.test(quote.hash) || BigInt(quote.hash) === 0n || !Number.isSafeInteger(quote.blockNumber) ||
        quote.blockNumber < 0 || quote.blockNumber > head || typeof quote.operationId !== 'bigint' ||
        quote.operationId <= 0n || quote.operationId >= 1n << 256n) throw new Error('Invalid DEX activity Quote witness.');
    const hash = quote.hash.toLowerCase();
    if (byHash.has(hash)) throw new Error('Duplicate DEX activity Quote witness.');
    byHash.set(hash, quote);
    if (nextCursor[hash] === undefined) nextCursor[hash] = quote.blockNumber;
    if (nextCursor[hash] < quote.blockNumber) throw new Error('Invalid DEX activity terminal cursor.');
  }
  const events = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI), topic = events.getEvent('CheapAsyncAdvanced')!.topicHash;
  const terminals: { hash: string; quote: CurrentDexActivityRow }[] = [];
  for (const hash of Object.keys(nextCursor).slice(0, PAGE_SIZE)) {
    const quote = byHash.get(hash), startBlock = nextCursor[hash];
    delete nextCursor[hash];
    if (!quote) { nextCursor[hash] = startBlock; continue; }
    const end = Math.min(head, startBlock + 4095);
    let terminalHash: string | undefined;
    for (let start = startBlock; start <= end && !terminalHash; start += 256) {
      const toBlock = Math.min(start + 255, end);
      await assertCurrent();
      const logs = await readLogs({ address: core, fromBlock: start, toBlock,
        topics: [topic, toBeHex(quote.operationId!, 32)] });
      await assertCurrent();
      if (logs.length > 64) throw new Error('History operation event limit exceeded.');
      for (const log of logs) {
        if (log.removed || log.address.toLowerCase() !== core.toLowerCase() || !HASH.test(log.transactionHash) ||
            BigInt(log.transactionHash) === 0n || !Number.isSafeInteger(log.blockNumber) ||
            log.blockNumber < start || log.blockNumber > toBlock) throw new Error('History operation event changed.');
        const event = events.parseLog({ topics: [...log.topics], data: log.data });
        if (!event || event.name !== 'CheapAsyncAdvanced' || event.args.quoteId !== quote.operationId ||
            event.args.stage > 8n) throw new Error('History operation event changed.');
        const encoded = events.encodeEventLog(event.fragment, event.args);
        if (encoded.data.toLowerCase() !== log.data.toLowerCase() || encoded.topics.length !== log.topics.length ||
            encoded.topics.some((t, i) => t.toLowerCase() !== log.topics[i].toLowerCase())) throw new Error('History operation event encoding changed.');
        if (event.args.stage === 7n || event.args.stage === 8n) {
          if (terminalHash) throw new Error('History terminal event is ambiguous.');
          terminalHash = log.transactionHash.toLowerCase();
        }
      }
    }
    if (terminalHash) terminals.push({ hash: terminalHash, quote });
    else if (end < head) nextCursor[hash] = end + 1;
  }
  await assertCurrent();
  return Object.freeze({ terminals: Object.freeze(terminals), nextCursor: Object.freeze(nextCursor),
    complete: Object.keys(nextCursor).length === 0 });
};

export const readCurrentDexActivityDiscoveryPage = async ({ owner, candidate, headNumber, cursor, fetcher = fetch,
  assertCurrent }: {
  owner: string; candidate: CurrentDexActivityCandidate; headNumber: bigint; cursor: CurrentDexActivityCursor;
  fetcher?: typeof fetch; assertCurrent: () => void | Promise<void>;
}): Promise<CurrentDexActivityDiscoveryPage> => {
  if (!['cheap-exit', 'cheap-history'].includes(candidate)) throw new Error('DEX activity candidate is unavailable.');
  if (typeof owner !== 'string' || !ADDRESS.test(owner) || BigInt(owner) === 0n || typeof headNumber !== 'bigint' || headNumber < 0n)
    throw new Error('Invalid DEX activity owner or head.');
  if (!cursor || typeof cursor !== 'object') throw new Error('Invalid DEX activity cursor.');
  validateCursor(cursor.transactions);
  validateCursor(cursor.nfts);
  const ownerAddress = owner.toLowerCase();
  const prepared = resolvePreparedDexScope(candidate).candidate;
  const nftAddress = prepared.companions.find(([name]) => name === 'ChainWhisperDexPositionNFT')?.[1];
  if (!nftAddress || !ADDRESS.test(nftAddress)) throw new Error('DEX position NFT address is unavailable.');
  const targets = new Set([prepared.core, nftAddress, ...prepared.tokenMetadata.map(token => token.address),
    CURRENT_SHARED_TOKEN_DISTRIBUTION.vault.address].map(address => address.toLowerCase()));
  const [transactions, nfts] = await Promise.all([
    cursor.transactions === null ? null : readPage({ action: 'txlist', owner: ownerAddress,
      page: cursor.transactions, headNumber, assertCurrent, fetcher }),
    cursor.nfts === null ? null : readPage({ action: 'tokennfttx', owner: ownerAddress,
      page: cursor.nfts, headNumber, assertCurrent, fetcher, contractAddress: nftAddress })
  ]);
  const hashes: string[] = [];
  const known = new Set<string>();
  const hashBlocks = new Map<string, bigint>();
  const collect = (rows: readonly unknown[] | null, origin: 'transactions' | 'nfts') => {
    if (!rows) return cursor[origin] === null ? null : cursor[origin];
    if (rows.length > PAGE_SIZE) throw new Error('DEX activity explorer page exceeded its limit.');
    for (const raw of rows) {
      const row = parseRow(raw);
      if (row.blockNumber > headNumber) continue;
      if (origin === 'transactions' && row.to === null) continue;
      if (origin === 'transactions' && row.from !== ownerAddress && row.to !== ownerAddress) continue;
      if (origin === 'nfts' && row.from !== ownerAddress && row.to !== ownerAddress) continue;
      const priorBlock = hashBlocks.get(row.hash);
      if (priorBlock !== undefined && priorBlock !== row.blockNumber)
        throw new Error('Conflicting DEX activity explorer block number.');
      hashBlocks.set(row.hash, row.blockNumber);
      if (origin === 'nfts' && row.to === null) throw new Error('Invalid DEX activity explorer NFT row.');
      const related = origin === 'transactions'
        ? targets.has(row.from) || (row.to !== null && targets.has(row.to))
        : row.from === ownerAddress || row.to === ownerAddress;
      if (!related) continue;
      if (!known.has(row.hash)) { known.add(row.hash); hashes.push(row.hash); }
    }
    return rows.length === PAGE_SIZE ? (cursor[origin] as number) + 1 : null;
  };
  const nextCursor = Object.freeze({ transactions: collect(transactions, 'transactions'), nfts: collect(nfts, 'nfts') });
  return Object.freeze({ hashes: Object.freeze(hashes), nextCursor,
    complete: nextCursor.transactions === null && nextCursor.nfts === null });
};
