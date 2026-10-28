import { Interface, getAddress, zeroPadValue, toBeHex } from '@coti-io/coti-ethers';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import type { LinkTradeV2Deployment } from './linkTradeV2';
import type { LinkTradeV2Reference } from './linkTradeV2Terms';
import { readCanonicalTradeV2RawLogRange, readAttestedTradeHistoryV2View, readTradeHistoryV2CanonicalBlock,
  readTradeHistoryV2LatestBlockNumber, assertAttestedTradeHistoryV2Deployment, type TradeHistoryV2ReadCapability,
  TradeHistoryV2RangeLimitError, TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS, TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS,
  type CanonicalTradeV2RawLogRange } from './tradeHistoryV2Chain';
import type { TradeHistoryV2RawLog } from './tradeHistoryV2Events';
import { getOwnerTradeV2CapabilityBinding, assertOwnerTradeV2CapabilityCurrent, type OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { decryptPrivateUint256Output } from './privateUint256';

const ABI = new Interface(LINK_TRADE_V2_ABI);
const PUBLIC_TRANSFER = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const PRIVATE_TRANSFER = new Interface(['event Transfer(address indexed from,address indexed to,(uint256 ciphertextHigh,uint256 ciphertextLow) senderValue,(uint256 ciphertextHigh,uint256 ciphertextLow) receiverValue)']);
const OWNER_EVENTS = ['LinkOpened', 'LinkFilled', 'PrivateLinkReceipt'];
const ORDER_EVENTS = ['LinkFilled', 'LinkClosed', 'LinkCredentialChanged', 'CounterParentSettled'];
type Meta = Readonly<{ maker: string; offerToken: string; requestToken: string; privatePair: boolean; expiresAt: string }>;
export type LinkTradeV2ActivityOrder = Meta & Readonly<{ reference: LinkTradeV2Reference; status: 'Open' | 'Cancelled' | 'Expired'; enabled: boolean }>;
export type LinkTradeV2ActivityRow = Meta & Readonly<{ key: string; chainId: string; escrow: string; orderId: string; transactionHash: string; blockNumber: string;
  kind: 'created' | 'filled' | 'cancelled' | 'expired' | 'link-updated' | 'counter-settled'; role: 'maker' | 'filler';
  offer?: string; payment?: string; refund?: string }>;
export type LinkTradeV2ActivitySnapshot = Readonly<{ orders: readonly LinkTradeV2ActivityOrder[]; history: readonly LinkTradeV2ActivityRow[];
  complete: boolean; throughBlock?: string; safeHead: string; phase: 'scan' | 'orders' | 'details' }>;
export const mergeLinkTradeV2ActivitySnapshots = (snapshots: readonly LinkTradeV2ActivitySnapshot[]): LinkTradeV2ActivitySnapshot => {
  const minimum = (values: readonly string[]) => values.reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
  const through = snapshots.map(snapshot => snapshot.throughBlock).filter((value): value is string => value !== undefined);
  const history = snapshots.flatMap(snapshot => snapshot.history).sort((a, b) => {
    if (BigInt(a.blockNumber) !== BigInt(b.blockNumber)) return BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1;
    const leftParts = a.key.split(':'), rightParts = b.key.split(':');
    const left = leftParts[leftParts.length - 1], right = rightParts[rightParts.length - 1];
    return /^0x[0-9a-f]+$/i.test(left) && /^0x[0-9a-f]+$/i.test(right) ? BigInt(left) > BigInt(right) ? -1 : BigInt(left) < BigInt(right) ? 1 : 0 : 0;
  });
  return Object.freeze({ orders: Object.freeze(snapshots.flatMap(snapshot => snapshot.orders)), history: Object.freeze(history),
    complete: snapshots.length > 0 && snapshots.every(snapshot => snapshot.complete),
    throughBlock: through.length === snapshots.length && through.length ? minimum(through) : undefined,
    safeHead: snapshots.length ? minimum(snapshots.map(snapshot => snapshot.safeHead)) : '0',
    phase: snapshots.find(snapshot => !snapshot.complete)?.phase ?? 'scan' });
};
const physical = (log: TradeHistoryV2RawLog) => `${log.blockHash}:${log.transactionHash}:${log.logIndex}`;
const chronological = (a: TradeHistoryV2RawLog, b: TradeHistoryV2RawLog) => {
  for (const key of ['blockNumber', 'transactionIndex', 'logIndex'] as const) {
    if (BigInt(a[key]) !== BigInt(b[key])) return BigInt(a[key]) < BigInt(b[key]) ? -1 : 1;
  }
  return 0;
};
const decode = (log: TradeHistoryV2RawLog) => {
  const event = ABI.parseLog({ topics: [...log.topics], data: log.data });
  if (!event || ![...OWNER_EVENTS, ...ORDER_EVENTS].includes(event.name)) throw new Error('Unsupported Link activity event.');
  const encoded = ABI.encodeEventLog(ABI.getEvent(event.name)!, [...event.args]);
  if (encoded.data !== log.data || encoded.topics.join(',') !== log.topics.join(',')) throw new Error('Noncanonical Link activity event.');
  return event;
};
type RawPage = CanonicalTradeV2RawLogRange<'link-v2'>;
/** In-memory projection only. Reconnect/new devices rebuild from admitted chain events, not local receipts. */
export const createLinkTradeV2ActivityReader = ({ capability, deployment, ownerAddress, pageRangeBlocks = TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS }: {
  capability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment; ownerAddress: string; pageRangeBlocks?: bigint;
}) => {
  assertAttestedTradeHistoryV2Deployment(deployment, 'link-v2');
  if (typeof pageRangeBlocks !== 'bigint' || pageRangeBlocks <= 0n || pageRangeBlocks > TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS) {
    throw new Error('Link activity page range is invalid.');
  }
  let pageBlocks = pageRangeBlocks, fellBack = false;
  const owner = getAddress(ownerAddress).toLowerCase();
  let alive = true, head = '0', cursor: { number: string; hash: string } | undefined;
  let events = new Map<string, TradeHistoryV2RawLog>(), receipts: Record<string, readonly TradeHistoryV2RawLog[]> = {}, metadata = new Map<string, Meta>();
  let pending: { page: RawPage; events: Map<string, TradeHistoryV2RawLog>; receipts: typeof receipts; metadata: Map<string, Meta>;
    orders: string[]; orderOffset: number; details: string[]; detailOffset: number } | undefined;
  const project = (binding: ReturnType<typeof getOwnerTradeV2CapabilityBinding>): LinkTradeV2ActivitySnapshot => {
    const ordered = [...events.values()].sort(chronological), parsed = ordered.map(log => ({ log, event: decode(log) }));
    const orders = new Map<string, LinkTradeV2ActivityOrder>(), history: LinkTradeV2ActivityRow[] = [];
    for (const { log, event } of parsed) {
      const args = event.args, id = args.id.toString(), meta = metadata.get(id);
      if (!meta) throw new Error('Link activity token identity is unavailable.');
      if (event.name === 'LinkOpened') {
        if (args.maker.toLowerCase() !== owner) continue;
        orders.set(id, Object.freeze({ ...meta, reference: { chainId: deployment.chainId, escrow: deployment.contractAddress, id, revision: '1', credentialEpoch: '1' }, status: 'Open', enabled: true }));
      } else if (event.name === 'PrivateLinkReceipt') continue;
      const current = orders.get(id);
      if (current && event.name !== 'LinkOpened') {
        const status = event.name === 'LinkClosed' ? args.status === 2n ? 'Cancelled' : args.status === 3n ? 'Expired' : undefined : current.status;
        if (!status) throw new Error('Invalid Link activity closed status.');
        orders.set(id, Object.freeze({ ...current, status, enabled: event.name === 'LinkCredentialChanged' ? Boolean(args.enabled) : event.name === 'LinkClosed' ? false : current.enabled,
          reference: Object.freeze({ ...current.reference, revision: args.revision?.toString() ?? current.reference.revision,
            credentialEpoch: args.epoch?.toString() ?? current.reference.credentialEpoch }) }));
      }
      const role = meta.maker === owner ? 'maker' as const : 'filler' as const;
      if (event.name === 'LinkFilled' && args.filler.toLowerCase() !== owner && role !== 'maker') continue;
      let offer: string | undefined, payment: string | undefined, refund: string | undefined;
      if (event.name === 'LinkOpened' && !meta.privatePair) offer = args.publicBudget.toString();
      if (event.name === 'LinkFilled') {
        if (!meta.privatePair) [offer, payment, refund] = [args.publicOffer, args.publicPayment, args.publicRefund].map(v => v.toString());
        else {
          if (args.publicOffer !== 0n || args.publicPayment !== 0n || args.publicRefund !== 0n) throw new Error('Private Link activity exposes public amounts.');
          const own = parsed.filter(v => v.log.transactionHash === log.transactionHash && v.event.name === 'PrivateLinkReceipt' &&
            v.event.args.id === args.id && v.event.args.revision === args.revision && v.event.args.recipient.toLowerCase() === owner);
          if (own.length > 1) throw new Error('Duplicate recipient Link activity receipt.');
          if (own.length === 1) [offer, payment, refund] = [own[0].event.args.offer, own[0].event.args.payment, own[0].event.args.refund]
            .map(value => decryptPrivateUint256Output(binding.signer, value.userCiphertext).toString());
        }
      } else if (event.name === 'LinkClosed' && role === 'maker') {
        const token = meta.privatePair ? PRIVATE_TRANSFER : PUBLIC_TRANSFER;
        const transfers = (receipts[log.transactionHash] ?? []).filter(v => v.address === meta.offerToken && v.topics[0] === token.getEvent('Transfer')!.topicHash)
          .map(v => {
            const event = token.decodeEventLog('Transfer', v.data, [...v.topics]), encoded = token.encodeEventLog(token.getEvent('Transfer')!, [...event]);
            if (encoded.data !== v.data || encoded.topics.join(',') !== v.topics.join(',')) throw new Error('Noncanonical Link refund transfer.');
            return event;
          }).filter(v => v.from.toLowerCase() === deployment.contractAddress && v.to.toLowerCase() === owner);
        if (transfers.length === 1) refund = (meta.privatePair ? decryptPrivateUint256Output(binding.signer, transfers[0].receiverValue) : BigInt(transfers[0].value)).toString();
      }
      const kind = event.name === 'LinkOpened' ? 'created' : event.name === 'LinkFilled' ? 'filled' : event.name === 'LinkCredentialChanged' ? 'link-updated'
        : event.name === 'CounterParentSettled' ? 'counter-settled' : args.status === 3n ? 'expired' : 'cancelled';
      history.push(Object.freeze({ ...meta, key: physical(log), chainId: deployment.chainId, escrow: deployment.contractAddress,
        orderId: id, transactionHash: log.transactionHash, blockNumber: BigInt(log.blockNumber).toString(), kind, role, offer, payment, refund }));
    }
    return Object.freeze({ orders: Object.freeze([...orders.values()].reverse()), history: Object.freeze(history.reverse()),
      complete: !pending && cursor !== undefined && BigInt(cursor.number) >= BigInt(head), throughBlock: cursor?.number, safeHead: head,
      phase: pending ? pending.orderOffset < pending.orders.length ? 'orders' : 'details' : 'scan' });
  };
  const merge = (page: RawPage) => {
    if (!pending || page.range.fromBlock !== pending.page.range.fromBlock || page.range.toBlock !== pending.page.range.toBlock ||
        page.range.fromBlockHash !== pending.page.range.fromBlockHash || page.range.toBlockHash !== pending.page.range.toBlockHash) {
      pending = undefined; throw new Error('Link activity pages changed during discovery.');
    }
    for (const log of page.logs) {
      decode(log);
      const previous = pending.events.get(physical(log));
      if (previous && JSON.stringify(previous) !== JSON.stringify(log)) throw new Error('Link activity event changed.');
      pending.events.set(physical(log), log);
    }
    Object.assign(pending.receipts, page.receiptLogs);
  };
  return Object.freeze({
    sync: async (ownerCapability: OwnerTradeV2MetaMaskCapability): Promise<LinkTradeV2ActivitySnapshot> => {
      const binding = getOwnerTradeV2CapabilityBinding(ownerCapability);
      const current = async () => {
        await assertOwnerTradeV2CapabilityCurrent(binding);
        if (!alive || binding.ownerAddress.toLowerCase() !== owner || binding.chainId.toString() !== deployment.chainId) throw new Error('Link activity wallet session changed.');
      };
      let attemptedSpan = pending ? BigInt(pending.page.range.toBlock) - BigInt(pending.page.range.fromBlock) + 1n : 0n;
      try {
      await current();
      if (cursor) {
        const block = await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(cursor.number) });
        if (!block || block.hash !== cursor.hash) { cursor = undefined; pending = undefined; events.clear(); metadata.clear(); receipts = {}; }
      }
      if (pending) {
        const block = await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(pending.page.range.toBlock) });
        if (!block || block.hash !== pending.page.range.toBlockHash) pending = undefined;
      }
      if (!pending) {
        const latest = BigInt(await readTradeHistoryV2LatestBlockNumber(capability)), lag = BigInt(deployment.finalityLagBlocks);
        if (latest < lag) throw new Error('Link activity finality head is unavailable.');
        head = (latest - lag).toString();
        if (cursor && BigInt(cursor.number) > BigInt(head)) { cursor = undefined; events.clear(); metadata.clear(); receipts = {}; }
        const fromBlock = cursor ? BigInt(cursor.number) + 1n : BigInt(deployment.deploymentBlock);
        if (fromBlock > BigInt(head)) return project(binding);
        const toBlock = fromBlock + pageBlocks - 1n < BigInt(head) ? fromBlock + pageBlocks - 1n : BigInt(head);
        attemptedSpan = toBlock - fromBlock + 1n;
        const page = await readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock, toBlock,
          topics: [OWNER_EVENTS.map(name => ABI.getEvent(name)!.topicHash), null, zeroPadValue(owner, 32)], participantRange: true });
        await current();
        pending = { page, events: new Map(events), metadata: new Map(metadata), receipts: { ...receipts }, orders: [], orderOffset: 0, details: [], detailOffset: 0 };
        merge(page);
        for (const log of pending.events.values()) {
          const event = decode(log);
          if (event.name === 'LinkOpened' && event.args.maker.toLowerCase() === owner) {
            if (event.args.privatePair && (event.args.publicBudget !== 0n || event.args.publicPrice.offer !== 0n || event.args.publicPrice.request !== 0n)) throw new Error('Private Link discovery exposes public amounts.');
            const id = event.args.id.toString(); pending.orders.push(id);
            pending.metadata.set(id, Object.freeze({ maker: owner, offerToken: event.args.offerToken.toLowerCase(), requestToken: event.args.requestToken.toLowerCase(), privatePair: Boolean(event.args.privatePair), expiresAt: event.args.expiresAt.toString() }));
          }
        }
      }
      if (pending.orderOffset < pending.orders.length) {
        const ids = pending.orders.slice(pending.orderOffset, pending.orderOffset + 64);
        const page = await readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock: BigInt(pending.page.range.fromBlock), toBlock: BigInt(pending.page.range.toBlock),
          topics: [ORDER_EVENTS.map(name => ABI.getEvent(name)!.topicHash), ids.map(id => toBeHex(BigInt(id), 32))], participantRange: true });
        await current();
        merge(page); pending.orderOffset += ids.length;
        if (pending.orderOffset < pending.orders.length) { await current(); return project(binding); }
      }
      if (!pending.details.length) pending.details = [...new Set([...pending.events.values()].map(log => decode(log).args.id.toString()))].filter(id => !pending!.metadata.has(id));
      for (const id of pending.details.slice(pending.detailOffset, pending.detailOffset + 8)) {
        const raw = await readAttestedTradeHistoryV2View({ capability, deployment, data: ABI.encodeFunctionData('getOrderView', [id]) });
        await current();
        const result = ABI.decodeFunctionResult('getOrderView', raw), view = result[0], order = view.order;
        if (ABI.encodeFunctionResult('getOrderView', result).toLowerCase() !== raw.toLowerCase() || BigInt(order.maker) === 0n ||
            order.offerToken === order.requestToken || order.privatePair && (view.publicPrice.offer !== 0n || view.publicPrice.request !== 0n || view.publicBudget !== 0n || view.publicRemaining !== 0n)) throw new Error('Link history identity is invalid.');
        pending.metadata.set(id, Object.freeze({ maker: order.maker.toLowerCase(), offerToken: order.offerToken.toLowerCase(), requestToken: order.requestToken.toLowerCase(), privatePair: Boolean(order.privatePair), expiresAt: order.expiresAt.toString() }));
        pending.detailOffset++;
      }
      await current();
      if (pending.detailOffset < pending.details.length) return project(binding);
      const last = await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(pending.page.range.toBlock) });
      if (!last || last.hash !== pending.page.range.toBlockHash) { pending = undefined; throw new Error('Link activity was reorganized before commit.'); }
      await current();
      const previous = { events, metadata, receipts, cursor };
      events = pending.events; metadata = pending.metadata; receipts = pending.receipts; cursor = last; pending = undefined;
      try { return project(binding); }
      catch (error) {
        // An invalid amount/event must not advance the saved history checkpoint.
        ({ events, metadata, receipts, cursor } = previous);
        throw error;
      }
      } catch (error) {
        if (!(error instanceof TradeHistoryV2RangeLimitError) || fellBack || attemptedSpan <= TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS) throw error;
        pending = undefined;
        pageBlocks = TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS;
        fellBack = true;
        await current();
        return Object.freeze({ ...project(binding), complete: false });
      }
    },
    close: () => { alive = false; events.clear(); metadata.clear(); receipts = {}; pending = undefined; cursor = undefined; }
  });
};
