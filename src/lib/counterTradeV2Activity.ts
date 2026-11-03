import { Interface, getAddress } from '@coti-io/coti-ethers';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import type { CounterTradeV2Deployment, CounterTradeV2ParentDeployment } from './counterTradeV2';
import { assertAttestedTradeHistoryV2Deployment, readCanonicalTradeV2RawLogRange, readAttestedTradeHistoryV2View, readTradeHistoryV2CanonicalBlock,
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
  complete: boolean; fromBlock?: string; throughBlock?: string; safeHead: string }>;
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
  let pageBlocks = pageRangeBlocks;
  const parents = [parentDeployment, ...parentDeployments];
  parents.forEach(parent => {
    if (!['link-v2', 'private-v2', 'standard-v2'].includes(parent.protocol)) throw new Error('Counter activity parent protocol is unavailable.');
    assertAttestedTradeHistoryV2Deployment(parent, parent.protocol);
    if (deployment.chainId !== parent.chainId) throw new Error('Counter activity parent chain differs.');
  });
  const refundSources = new Set([deployment.contractAddress, ...parents.map(parent => parent.contractAddress)].map(address => address.toLowerCase()));
  const owner = getAddress(ownerAddress).toLowerCase(), escrow = getAddress(deployment.contractAddress).toLowerCase(), chainId = BigInt(deployment.chainId).toString();
  const opened = ABI.getEvent('CounterOpened')!.topicHash, closed = ABI.getEvent('CounterClosed')!.topicHash, terms = ABI.getEvent('CounterPrivateTerms')!.topicHash;
  let alive = true, head = '0', cursor: { number: string; hash: string } | undefined, from: string | undefined;
  let events = new Map<string, TradeHistoryV2RawLog>(), receipts: Record<string, readonly TradeHistoryV2RawLog[]> = {};
  let identities = new Map<string, CounterTradeV2ActivityOrder & Readonly<{ encryptedTerms?: string }>>();
  let pending: { page: Page; events: typeof events; receipts: typeof receipts; identities: typeof identities; ids: string[]; offset: number; mode: 'latest' | 'older' } | undefined;
  const project = (binding: ReturnType<typeof getOwnerTradeV2CapabilityBinding>, data = events, logsByHash = receipts,
    progress?: { fromBlock: string; throughBlock: string; complete: boolean }, known = identities): CounterTradeV2ActivitySnapshot => {
    const openings = new Set([...data.values()].filter(log => log.topics[0] === opened).map(log => parse(ABI, 'CounterOpened', log).id.toString()));
    const foreign = new Set([...data.values()].filter(log => log.topics[0] === opened).filter(log => {
      const event = parse(ABI, 'CounterOpened', log); return ![event.maker.toLowerCase(), event.taker.toLowerCase()].includes(owner);
    }).map(log => parse(ABI, 'CounterOpened', log).id.toString()));
    const orders = new Map<string, CounterTradeV2ActivityOrder>(), history: CounterTradeV2ActivityRow[] = [];
    for (const [id, identity] of known) {
      if (openings.has(id) || ![identity.maker, identity.taker].includes(owner)) continue;
      const { encryptedTerms, ...order } = identity;
      let { offer, request } = order;
      if (order.privatePair && encryptedTerms !== undefined) {
        const [terms] = ABI.decodeFunctionResult('getTermsForAccount', encryptedTerms);
        [offer, request] = [terms.offer, terms.request].map(value => decryptPrivateUint256Output(binding.signer, value.userCiphertext).toString());
        if ([offer, request].some(value => value !== undefined && (BigInt(value) <= 0n || BigInt(value) >= (1n << 128n)))) throw new Error('Counter activity amount is invalid.');
      }
      orders.set(id, Object.freeze({ ...order, offer, request }));
    }
    for (const log of [...data.values()].sort(ordered)) {
      const name = log.topics[0] === opened ? 'CounterOpened' : 'CounterClosed', e = parse(ABI, name, log), id = e.id.toString();
      const receipt = logsByHash[log.transactionHash] ?? [];
      if (name === 'CounterOpened') {
        const maker = e.maker.toLowerCase(), taker = e.taker.toLowerCase();
        if (![maker, taker].includes(owner)) continue;
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
        if (!order && (foreign.has(id) || known.has(id) && ![known.get(id)!.maker, known.get(id)!.taker].includes(owner))) continue;
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
      complete: progress?.complete ?? Boolean(!pending && from === deployment.deploymentBlock && cursor && BigInt(cursor.number) >= BigInt(head)),
      fromBlock: progress?.fromBlock ?? from, throughBlock: progress?.throughBlock ?? cursor?.number, safeHead: head });
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
  return Object.freeze({ sync: async (ownerCapability: OwnerTradeV2MetaMaskCapability, mode: 'latest' | 'older' = 'latest') => {
    const binding = getOwnerTradeV2CapabilityBinding(ownerCapability);
    const current = async () => { await assertOwnerTradeV2CapabilityCurrent(binding);
      if (!alive || binding.ownerAddress.toLowerCase() !== owner || binding.chainId.toString() !== deployment.chainId) throw new Error('Counter activity wallet session changed.'); };
    let attemptedSpan = pending ? BigInt(pending.page.range.toBlock) - BigInt(pending.page.range.fromBlock) + 1n : 0n;
    try {
    await current();
    if (cursor && (await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(cursor.number) }))?.hash !== cursor.hash) { events.clear(); identities.clear(); receipts = {}; cursor = undefined; from = undefined; pending = undefined; }
    if (pending && (await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(pending.page.range.toBlock) }))?.hash !== pending.page.range.toBlockHash) pending = undefined;
    if (pending?.mode === 'older' && mode === 'latest') pending = undefined;
    if (!pending) {
      const latest = BigInt(await readTradeHistoryV2LatestBlockNumber(capability)), lag = BigInt(deployment.finalityLagBlocks);
      if (latest < lag) throw new Error('Counter finality head is unavailable.');
      const safeHead = latest - lag;
      if (cursor && BigInt(cursor.number) > safeHead) { events.clear(); identities.clear(); receipts = {}; cursor = undefined; from = undefined; }
      head = mode === 'older' && cursor ? cursor.number : safeHead.toString();
      const deploymentBlock = BigInt(deployment.deploymentBlock);
      if (mode === 'older' && from === deployment.deploymentBlock || mode === 'latest' && cursor?.number === head) return project(binding);
      const toBlock = mode === 'older' && from ? BigInt(from) - 1n : BigInt(head);
      if (toBlock < deploymentBlock) return project(binding);
      const start = mode === 'latest' && cursor && BigInt(head) - BigInt(cursor.number) < pageBlocks ? BigInt(cursor.number) + 1n : toBlock - pageBlocks + 1n;
      const fromBlock = start < deploymentBlock ? deploymentBlock : start;
      attemptedSpan = toBlock - fromBlock + 1n;
      const page = await readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock, toBlock, topics: [[opened, closed]], participantRange: true });
      await current(); pending = { page, events: new Map(events), identities: new Map(identities), receipts: { ...receipts }, ids: [], offset: 0, mode }; merge(page);
      const openings = new Set([...pending.events.values()].filter(v => v.topics[0] === opened).map(v => parse(ABI, 'CounterOpened', v).id.toString()));
      pending.ids = [...new Set(page.logs.filter(v => v.topics[0] === closed).map(v => parse(ABI, 'CounterClosed', v).id.toString()))]
        .filter(id => !openings.has(id) && !pending!.identities.has(id));
    }
    for (const id of pending.ids.slice(pending.offset, pending.offset + 8)) {
      const read = async (name: 'getCounter' | 'getTermsForAccount') => {
        const raw = await readAttestedTradeHistoryV2View({ capability, deployment, data: ABI.encodeFunctionData(name, [id]),
          ...(name === 'getTermsForAccount' ? { from: owner } : {}) });
        await current();
        const result = ABI.decodeFunctionResult(name, raw);
        if (ABI.encodeFunctionResult(name, result).toLowerCase() !== raw.toLowerCase()) throw new Error('Noncanonical Counter history identity.');
        return result;
      };
      const [proposal, amounts] = await read('getCounter');
      const maker = proposal.maker.toLowerCase(), taker = proposal.taker.toLowerCase();
      if (maker === taker || BigInt(maker) === 0n || BigInt(taker) === 0n || proposal.offerToken === proposal.requestToken ||
          BigInt(proposal.rootKey) === 0n || proposal.depth < 1n || proposal.depth > 16n || (proposal.parentProposal === 0n) !== (proposal.depth === 1n) ||
          proposal.status < 1n || proposal.status > 6n || proposal.privatePair && (amounts.offer !== 0n || amounts.request !== 0n)) throw new Error('Counter history identity is invalid.');
      let offer: string | undefined, request: string | undefined, encryptedTerms: string | undefined;
      if ([maker, taker].includes(owner)) {
        if (proposal.privatePair) {
          const result = await read('getTermsForAccount');
          if (!result[0].initialized) throw new Error('Counter participant terms are unavailable.');
          encryptedTerms = ABI.encodeFunctionResult('getTermsForAccount', result);
        } else [offer, request] = [amounts.offer, amounts.request].map(value => value.toString());
        if ([offer, request].some(value => value !== undefined && (BigInt(value) <= 0n || BigInt(value) >= (1n << 128n)))) throw new Error('Counter activity amount is invalid.');
      }
      pending.identities.set(id, Object.freeze({ chainId, escrow, id, maker, taker, offerToken: proposal.offerToken.toLowerCase(), requestToken: proposal.requestToken.toLowerCase(),
        privatePair: proposal.privatePair as boolean, expiresAt: proposal.expiresAt.toString(), status: 1, offer, request, encryptedTerms }));
      pending.offset++;
    }
    if (pending.offset < pending.ids.length) return project(binding);
    const last = await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(pending.page.range.toBlock) });
    if (!last || last.hash !== pending.page.range.toBlockHash) { pending = undefined; throw new Error('Counter activity was reorganized before commit.'); }
    if (cursor && (await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(cursor.number) }))?.hash !== cursor.hash) { pending = undefined; throw new Error('Counter activity was reorganized before commit.'); }
    await current();
    let result: CounterTradeV2ActivitySnapshot;
    const pageFrom = pending.page.range.fromBlock;
    const nextFrom = from && cursor && BigInt(pageFrom) <= BigInt(cursor.number) + 1n && BigInt(last.number) >= BigInt(from) - 1n
      ? BigInt(pageFrom) < BigInt(from) ? pageFrom : from : pageFrom;
    const nextCursor = !cursor || BigInt(last.number) > BigInt(cursor.number) ? last : cursor;
    try { result = project(binding, pending.events, pending.receipts, { fromBlock: nextFrom, throughBlock: nextCursor.number,
      complete: nextFrom === deployment.deploymentBlock && BigInt(nextCursor.number) >= BigInt(head) }, pending.identities); }
    catch (error) { pending = undefined; throw error; }
    events = pending.events; identities = pending.identities; receipts = pending.receipts; cursor = nextCursor; from = nextFrom; pending = undefined; return result;
    } catch (error) {
      if (!(error instanceof TradeHistoryV2RangeLimitError) || attemptedSpan <= 1n) throw error;
      pending = undefined;
      pageBlocks = attemptedSpan > TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS ? TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS : attemptedSpan / 2n;
      await current();
      return Object.freeze({ ...project(binding), complete: false });
    }
  }, close: () => { alive = false; events.clear(); identities.clear(); receipts = {}; pending = undefined; cursor = undefined; from = undefined; } });
};
