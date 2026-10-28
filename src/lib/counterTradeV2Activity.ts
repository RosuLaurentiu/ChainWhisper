import { Interface, getAddress, toBeHex, zeroPadValue } from '@coti-io/coti-ethers';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import type { CounterTradeV2Deployment, CounterTradeV2ParentDeployment } from './counterTradeV2';
import { assertAttestedTradeHistoryV2Deployment, readCanonicalTradeV2RawLogRange, readTradeHistoryV2CanonicalBlock,
  readTradeHistoryV2LatestBlockNumber, TradeHistoryV2RangeLimitError, TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS,
  TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS, type TradeHistoryV2ReadCapability, type CanonicalTradeV2RawLogRange } from './tradeHistoryV2Chain';
import type { TradeHistoryV2RawLog } from './tradeHistoryV2Events';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent, type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { decryptPrivateUint256Output } from './privateUint256';

const ABI = new Interface(COUNTER_TRADE_V2_ABI), PUBLIC = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const PRIVATE = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
export type CounterTradeV2ActivityOrder = Readonly<{ chainId: string; escrow: string; id: string; maker: string; taker: string; offerToken: string; requestToken: string;
  privatePair: boolean; expiresAt: string; status: number; offer?: string; request?: string }>;
export type CounterTradeV2ActivityRow = CounterTradeV2ActivityOrder & Readonly<{ key: string; transactionHash: string; blockNumber: string;
  role: 'maker' | 'taker'; payment?: string; received?: string; refund?: string }>;
export type CounterTradeV2ActivitySnapshot = Readonly<{ orders: readonly CounterTradeV2ActivityOrder[]; history: readonly CounterTradeV2ActivityRow[];
  complete: boolean; throughBlock?: string; safeHead: string }>;
/** Combines independently committed deployment scans without widening their coverage. */
export const mergeCounterTradeV2ActivitySnapshots = (snapshots: readonly CounterTradeV2ActivitySnapshot[]): CounterTradeV2ActivitySnapshot => {
  const minimum = (values: readonly string[]) => values.reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
  const through = snapshots.map(snapshot => snapshot.throughBlock).filter((value): value is string => value !== undefined);
  const unique = <T extends CounterTradeV2ActivityOrder>(rows: readonly T[], identity: (row: T) => string, kind: string): T[] => {
    const result = new Map<string, T>();
    for (const row of rows) {
      const normalized = Object.freeze({ ...row, chainId: BigInt(row.chainId).toString(), escrow: getAddress(row.escrow).toLowerCase() }) as T;
      const key = `${normalized.chainId}:${normalized.escrow}:${identity(normalized)}`, previous = result.get(key);
      if (previous && [...new Set([...Object.keys(previous), ...Object.keys(normalized)])].some(field =>
        previous[field as keyof T] !== normalized[field as keyof T])) throw new Error(`Counter activity ${kind} conflict.`);
      if (!previous) result.set(key, normalized);
    }
    return [...result.values()];
  };
  const orders = unique(snapshots.flatMap(snapshot => snapshot.orders), row => row.id, 'order');
  const history = unique(snapshots.flatMap(snapshot => snapshot.history), row => row.key, 'event').sort((a, b) => {
    if (BigInt(a.blockNumber) !== BigInt(b.blockNumber)) return BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1;
    const leftParts = a.key.split(':'), rightParts = b.key.split(':');
    const left = leftParts[leftParts.length - 1], right = rightParts[rightParts.length - 1];
    return /^0x[0-9a-f]+$/i.test(left) && /^0x[0-9a-f]+$/i.test(right) ? BigInt(left) > BigInt(right) ? -1 : BigInt(left) < BigInt(right) ? 1 : 0 : 0;
  });
  return Object.freeze({ orders: Object.freeze(orders), history: Object.freeze(history),
    complete: snapshots.length > 0 && snapshots.every(snapshot => snapshot.complete),
    throughBlock: through.length === snapshots.length && through.length ? minimum(through) : undefined,
    safeHead: snapshots.length ? minimum(snapshots.map(snapshot => snapshot.safeHead)) : '0' });
};
const physical = (log: TradeHistoryV2RawLog) => `${log.blockHash}:${log.transactionHash}:${log.logIndex}`;
const parse = (abi: Interface, name: string, log: TradeHistoryV2RawLog) => {
  const args = abi.decodeEventLog(name, log.data, [...log.topics]), encoded = abi.encodeEventLog(abi.getEvent(name)!, [...args]);
  if (encoded.data !== log.data || encoded.topics.join(',') !== log.topics.join(',')) throw new Error('Noncanonical counter activity event.');
  return args;
};
const ordered = (a: TradeHistoryV2RawLog, b: TradeHistoryV2RawLog) => {
  for (const field of ['blockNumber', 'transactionIndex', 'logIndex'] as const) if (BigInt(a[field]) !== BigInt(b[field])) return BigInt(a[field]) < BigInt(b[field]) ? -1 : 1;
  return 0;
};
type Page = CanonicalTradeV2RawLogRange<'counter-v2'>;
/** Rebuilds participant activity from bounded canonical events, with no local history or wallet-balance index. */
export const createCounterTradeV2ActivityReader = ({ capability, deployment, parentDeployment, parentDeployments = [], ownerAddress, pageRangeBlocks = TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS }: {
  capability: TradeHistoryV2ReadCapability; deployment: CounterTradeV2Deployment; parentDeployment: CounterTradeV2ParentDeployment;
  parentDeployments?: readonly CounterTradeV2ParentDeployment[]; ownerAddress: string; pageRangeBlocks?: bigint;
}) => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'counter-v2');
  if (typeof pageRangeBlocks !== 'bigint' || pageRangeBlocks <= 0n || pageRangeBlocks > TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS) {
    throw new Error('Counter activity page range is invalid.');
  }
  let pageBlocks = pageRangeBlocks, fellBack = false;
  const parents = [parentDeployment, ...parentDeployments];
  parents.forEach(parent => {
    if (!['link-v2', 'private-v2', 'standard-v2'].includes(parent.protocol)) throw new Error('Counter activity parent protocol is unavailable.');
    assertAttestedTradeHistoryV2Deployment(parent, parent.protocol);
    if (deployment.chainId !== parent.chainId) throw new Error('Counter activity parent chain differs.');
  });
  const refundSources = new Set([deployment.contractAddress, ...parents.map(parent => parent.contractAddress)].map(address => address.toLowerCase()));
  const owner = getAddress(ownerAddress).toLowerCase(), escrow = getAddress(deployment.contractAddress).toLowerCase(), chainId = BigInt(deployment.chainId).toString();
  const opened = ABI.getEvent('CounterOpened')!.topicHash, closed = ABI.getEvent('CounterClosed')!.topicHash, terms = ABI.getEvent('CounterPrivateTerms')!.topicHash;
  let alive = true, head = '0', cursor: { number: string; hash: string } | undefined;
  let events = new Map<string, TradeHistoryV2RawLog>(), receipts: Record<string, readonly TradeHistoryV2RawLog[]> = {};
  let pending: { page: Page; events: typeof events; receipts: typeof receipts; stage: 'taker' | 'closed'; ids: string[]; offset: number } | undefined;
  const project = (binding: ReturnType<typeof getOwnerTradeV2CapabilityBinding>, data = events, logsByHash = receipts,
    progress?: { throughBlock: string; complete: boolean }): CounterTradeV2ActivitySnapshot => {
    const orders = new Map<string, CounterTradeV2ActivityOrder>(), history: CounterTradeV2ActivityRow[] = [];
    for (const log of [...data.values()].sort(ordered)) {
      const name = log.topics[0] === opened ? 'CounterOpened' : 'CounterClosed', e = parse(ABI, name, log), id = e.id.toString();
      const receipt = logsByHash[log.transactionHash] ?? [];
      if (name === 'CounterOpened') {
        const maker = e.maker.toLowerCase(), taker = e.taker.toLowerCase();
        if (![maker, taker].includes(owner)) throw new Error('Counter discovery returned a foreign participant.');
        if (e.id === 0n || maker === taker || BigInt(maker) === 0n || BigInt(taker) === 0n || e.offerToken === e.requestToken ||
            BigInt(e.rootKey) === 0n || e.depth < 1n || e.depth > 16n || (e.parentProposal === 0n) !== (e.depth === 1n)) throw new Error('Invalid counter discovery identity.');
        let offer: string | undefined, request: string | undefined;
        if (e.privatePair) {
          if (e.publicOffer !== 0n || e.publicRequest !== 0n) throw new Error('Private counter activity exposes public amounts.');
          const own = receipt.filter(r => r.address === escrow && r.topics[0] === terms).map(r => parse(ABI, 'CounterPrivateTerms', r))
            .filter(t => t.id === e.id && t.recipient.toLowerCase() === owner);
          if (own.length > 1) throw new Error('Duplicate private counter participant terms.');
          if (own.length === 1) [offer, request] = [own[0].offer, own[0].request].map(v => decryptPrivateUint256Output(binding.signer, v.userCiphertext).toString());
        } else [offer, request] = [e.publicOffer, e.publicRequest].map(v => v.toString());
        if ([offer, request].some(v => v !== undefined && (BigInt(v) <= 0n || BigInt(v) >= (1n << 128n)))) throw new Error('Counter activity amount is invalid.');
        if (orders.has(id)) throw new Error('Duplicate counter creation identity.');
        orders.set(id, Object.freeze({ chainId, escrow, id, maker, taker, offerToken: e.offerToken.toLowerCase(), requestToken: e.requestToken.toLowerCase(), privatePair: e.privatePair as boolean,
          expiresAt: e.expiresAt.toString(), status: 1, offer, request }));
      } else {
        const order = orders.get(id);
        if (!order || order.status !== 1 || e.status < 2n || e.status > 6n) throw new Error('Counter activity closure is invalid.');
        orders.set(id, Object.freeze({ ...order, status: Number(e.status) }));
      }
      const order = orders.get(id)!, role = order.maker === owner ? 'maker' as const : 'taker' as const;
      const tokenAbi = order.privatePair ? PRIVATE : PUBLIC;
      const transfers = (address: string) => receipt.filter(r => r.address === address && r.topics[0] === tokenAbi.getEvent('Transfer')!.topicHash)
        .map(r => ({ log: r, args: parse(tokenAbi, 'Transfer', r) }));
      const value = (e: ReturnType<typeof parse>, receive = true) => order.privatePair
        ? decryptPrivateUint256Output(binding.signer, e[receive ? 'receiverValue' : 'senderValue']) : BigInt(e.value);
      let payment: string | undefined, received: string | undefined, refund: string | undefined;
      if (name === 'CounterClosed' && e.status === 2n) {
        const payments = transfers(order.requestToken).filter(v => v.args.from.toLowerCase() === order.taker && v.args.to.toLowerCase() === order.maker);
        if (payments.length === 1) payment = value(payments[0].args, role === 'maker').toString();
        if (role === 'taker') {
          const offers = transfers(order.offerToken).filter(v => v.args.from.toLowerCase() === escrow && v.args.to.toLowerCase() === owner);
          if (offers.length === 1) received = value(offers[0].args).toString();
          const selections = receipt.filter(v => v.address === escrow && v.topics[0] === closed).map(v => parse(ABI, 'CounterClosed', v)).filter(v => v.status === 2n);
          if (selections.length === 1) refund = transfers(order.requestToken).filter(v => refundSources.has(v.args.from.toLowerCase()) && v.args.to.toLowerCase() === owner)
            .reduce((sum, v) => sum + value(v.args), 0n).toString();
        }
        if (payment !== undefined && order.request !== undefined && payment !== order.request || received !== undefined && order.offer !== undefined && received !== order.offer) throw new Error('Counter activity settlement differs from participant terms.');
      } else if (name === 'CounterClosed' && role === 'maker') {
        const next = receipt.filter(v => v.address === escrow && v.topics[0] === closed && BigInt(v.logIndex) > BigInt(log.logIndex)).sort(ordered)[0];
        const returned = transfers(order.offerToken).filter(v => BigInt(v.log.logIndex) > BigInt(log.logIndex) && (!next || BigInt(v.log.logIndex) < BigInt(next.logIndex)) &&
          v.args.from.toLowerCase() === escrow && v.args.to.toLowerCase() === owner);
        if (returned.length === 1) refund = value(returned[0].args).toString();
        if (refund !== undefined && order.offer !== undefined && refund !== order.offer) throw new Error('Counter activity refund differs from the funded offer.');
      }
      history.push(Object.freeze({ ...order, key: physical(log), transactionHash: log.transactionHash, blockNumber: BigInt(log.blockNumber).toString(), role, payment, received, refund }));
    }
    return Object.freeze({ orders: Object.freeze([...orders.values()].reverse()), history: Object.freeze(history.reverse()),
      complete: progress?.complete ?? Boolean(!pending && cursor && BigInt(cursor.number) >= BigInt(head)), throughBlock: progress?.throughBlock ?? cursor?.number, safeHead: head });
  };
  const merge = (page: Page) => {
    if (!pending || JSON.stringify(page.range) !== JSON.stringify(pending.page.range)) throw new Error('Counter discovery page changed.');
    for (const log of page.logs) {
      if (![opened, closed].includes(log.topics[0])) throw new Error('Unexpected counter activity topic.');
      const previous = pending.events.get(physical(log));
      if (previous && JSON.stringify(previous) !== JSON.stringify(log)) throw new Error('Counter activity event changed.');
      pending.events.set(physical(log), log);
    }
    for (const [hash, logs] of Object.entries(page.receiptLogs)) {
      if (pending.receipts[hash] && JSON.stringify(pending.receipts[hash]) !== JSON.stringify(logs)) throw new Error('Counter receipt changed during discovery.');
      pending.receipts[hash] = logs;
    }
  };
  return Object.freeze({ sync: async (ownerCapability: OwnerTradeV2MetaMaskCapability) => {
    const binding = getOwnerTradeV2CapabilityBinding(ownerCapability);
    const current = async () => { await assertOwnerTradeV2CapabilityCurrent(binding);
      if (!alive || binding.ownerAddress.toLowerCase() !== owner || binding.chainId.toString() !== deployment.chainId) throw new Error('Counter activity wallet session changed.'); };
    let attemptedSpan = pending ? BigInt(pending.page.range.toBlock) - BigInt(pending.page.range.fromBlock) + 1n : 0n;
    try {
    await current();
    if (cursor && (await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(cursor.number) }))?.hash !== cursor.hash) { events.clear(); receipts = {}; cursor = undefined; pending = undefined; }
    if (pending && (await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(pending.page.range.toBlock) }))?.hash !== pending.page.range.toBlockHash) pending = undefined;
    if (!pending) {
      const latest = BigInt(await readTradeHistoryV2LatestBlockNumber(capability)), lag = BigInt(deployment.finalityLagBlocks);
      if (latest < lag) throw new Error('Counter finality head is unavailable.'); head = (latest - lag).toString();
      if (cursor && BigInt(cursor.number) > BigInt(head)) { events.clear(); receipts = {}; cursor = undefined; }
      const fromBlock = cursor ? BigInt(cursor.number) + 1n : BigInt(deployment.deploymentBlock);
      if (fromBlock > BigInt(head)) return project(binding);
      const toBlock = fromBlock + pageBlocks - 1n < BigInt(head) ? fromBlock + pageBlocks - 1n : BigInt(head);
      attemptedSpan = toBlock - fromBlock + 1n;
      const page = await readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock, toBlock, topics: [opened, null, zeroPadValue(owner, 32)], participantRange: true });
      await current(); pending = { page, events: new Map(events), receipts: { ...receipts }, stage: 'taker', ids: [], offset: 0 }; merge(page);
    }
    const range = { fromBlock: BigInt(pending.page.range.fromBlock), toBlock: BigInt(pending.page.range.toBlock) };
    if (pending.stage === 'taker') {
      merge(await readCanonicalTradeV2RawLogRange({ capability, deployment, ...range, topics: [opened, null, null, zeroPadValue(owner, 32)], participantRange: true }));
      await current(); pending.stage = 'closed';
      pending.ids = [...pending.events.values()].filter(v => v.topics[0] === opened).map(v => parse(ABI, 'CounterOpened', v).id.toString());
    }
    if (pending.offset < pending.ids.length) {
      const ids = pending.ids.slice(pending.offset, pending.offset + 64);
      merge(await readCanonicalTradeV2RawLogRange({ capability, deployment, ...range, topics: [closed, ids.map(v => toBeHex(BigInt(v), 32))], participantRange: true }));
      await current(); pending.offset += ids.length;
      if (pending.offset < pending.ids.length) return project(binding);
    }
    const last = await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(pending.page.range.toBlock) });
    if (!last || last.hash !== pending.page.range.toBlockHash) { pending = undefined; throw new Error('Counter activity was reorganized before commit.'); }
    await current();
    let result: CounterTradeV2ActivitySnapshot;
    try { result = project(binding, pending.events, pending.receipts, { throughBlock: last.number, complete: BigInt(last.number) >= BigInt(head) }); }
    catch (error) { pending = undefined; throw error; }
    events = pending.events; receipts = pending.receipts; cursor = last; pending = undefined; return result;
    } catch (error) {
      if (!(error instanceof TradeHistoryV2RangeLimitError) || fellBack || attemptedSpan <= TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS) throw error;
      pending = undefined;
      pageBlocks = TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS;
      fellBack = true;
      await current();
      return Object.freeze({ ...project(binding), complete: false });
    }
  }, close: () => { alive = false; events.clear(); receipts = {}; pending = undefined; cursor = undefined; } });
};
