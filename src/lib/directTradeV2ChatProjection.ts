import { getAddress } from '@coti-io/coti-ethers';
import type { ChatMessage, DirectTradeV2ChatIdentity, TradeMessageAction } from './appShared/core';
import {
  buildTradeOfferMessagePayload,
  buildTradeResponseMessagePayload
} from './appShared/tradeMessages';
import {
  assertCanonicalTradeHistoryV2LogRange,
  type CanonicalTradeHistoryV2LogRange
} from './tradeHistoryV2Chain';
import type {
  ParsedDirectTradeV2Opened,
  ParsedDirectTradeV2Status
} from './tradeHistoryV2Events';

export type DirectTradeV2ChatEntry = Readonly<{
  viewer: string;
  contact: string;
  message: ChatMessage;
}>;

const safeNumber = (value: string, label: string): number => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} is not canonical decimal.`);
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the app's safe range.`);
  return Number(parsed);
};

const otherParticipant = (
  maker: string,
  taker: string,
  viewer: string
): string | undefined => {
  if (maker === viewer) return taker;
  if (taker === viewer) return maker;
  return undefined;
};

const identity = ({
  eventKind,
  chainId,
  contractAddress,
  tradeId,
  relatedTradeId,
  log
}: {
  eventKind: DirectTradeV2ChatIdentity['eventKind'];
  chainId: string;
  contractAddress: string;
  tradeId: string;
  relatedTradeId: string;
  log: ParsedDirectTradeV2Opened['log'];
}): DirectTradeV2ChatIdentity => Object.freeze({
  protocol: 'direct-trade-v2',
  eventKind,
  chainId,
  contractAddress,
  tradeId,
  relatedTradeId,
  transactionHash: log.transactionHash,
  blockNumber: log.blockNumber,
  blockHash: log.blockHash,
  logIndex: log.logIndex,
  finality: 'finalized'
});

const messageId = (
  chainId: string,
  contractAddress: string,
  log: ParsedDirectTradeV2Opened['log']
): string => [
  'direct-trade-v2',
  chainId,
  contractAddress,
  log.blockHash,
  log.transactionHash,
  log.logIndex.toString()
].join(':');

const statusAction = (nextStatus: string): TradeMessageAction | undefined => {
  switch (nextStatus) {
    case '2':
      return 'accepted';
    case '3':
      return 'cancelled';
    case '4':
      return 'declined';
    case '5':
      return 'expired';
    case '6':
      return 'superseded';
    case '7':
      return 'replaced';
    default:
      return undefined;
  }
};

const projectOpened = (
  event: ParsedDirectTradeV2Opened,
  viewer: string
): DirectTradeV2ChatEntry | undefined => {
  const contact = otherParticipant(event.maker, event.taker, viewer);
  if (!contact) return undefined;
  const tradeId = safeNumber(event.orderId, 'Direct trade ID');
  const parentTradeId = safeNumber(event.parentTradeId, 'Direct trade parent ID');
  const createdAt = safeNumber(event.createdAt, 'Direct trade creation time');
  const expiresAt = safeNumber(event.expiresAt, 'Direct trade expiry');
  const blockNumber = safeNumber(event.log.blockNumber, 'Direct trade block number');
  const directTradeV2 = identity({
    eventKind: 'opened',
    chainId: event.chainId,
    contractAddress: event.contractAddress,
    tradeId: event.orderId,
    relatedTradeId: event.parentTradeId,
    log: event.log
  });
  return Object.freeze({
    viewer,
    contact,
    message: Object.freeze({
      id: messageId(event.chainId, event.contractAddress, event.log),
      direction: event.maker === viewer ? 'outgoing' : 'incoming',
      text: buildTradeOfferMessagePayload({
        version: 2,
        tradeId,
        escrowContract: event.contractAddress,
        maker: event.maker,
        taker: event.taker,
        createdAt,
        expiresAt,
        ...(parentTradeId > 0 ? { parentTradeId } : {})
      }),
      senderAddress: event.maker,
      isSystem: true,
      timestamp: createdAt,
      blockNumber,
      logIndex: event.log.logIndex,
      txHash: event.log.transactionHash,
      deliveryState: 'sent',
      directTradeV2
    })
  });
};

const projectStatus = (
  event: ParsedDirectTradeV2Status,
  viewer: string
): DirectTradeV2ChatEntry | undefined => {
  const contact = otherParticipant(event.maker, event.taker, viewer);
  const action = statusAction(event.nextStatus);
  if (!contact || !action) return undefined;
  const tradeId = safeNumber(event.orderId, 'Direct trade ID');
  const relatedTradeId = safeNumber(event.relatedOrderId, 'Direct related trade ID');
  const changedAt = safeNumber(event.changedAt, 'Direct trade status time');
  const blockNumber = safeNumber(event.log.blockNumber, 'Direct trade status block number');
  const directTradeV2 = identity({
    eventKind: 'status',
    chainId: event.chainId,
    contractAddress: event.contractAddress,
    tradeId: event.orderId,
    relatedTradeId: event.relatedOrderId,
    log: event.log
  });
  return Object.freeze({
    viewer,
    contact,
    message: Object.freeze({
      id: messageId(event.chainId, event.contractAddress, event.log),
      direction: event.actor === viewer ? 'outgoing' : 'incoming',
      text: buildTradeResponseMessagePayload({
        version: 2,
        tradeId,
        escrowContract: event.contractAddress,
        action,
        actor: event.actor,
        createdAt: changedAt,
        ...(relatedTradeId > 0 ? { relatedTradeId } : {})
      }),
      senderAddress: event.actor,
      isSystem: true,
      timestamp: changedAt,
      blockNumber,
      logIndex: event.log.logIndex,
      txHash: event.log.transactionHash,
      deliveryState: 'sent',
      directTradeV2
    })
  });
};

/**
 * Projects one provider-owned, finality-attested Direct OTC range into the same trade-card payloads
 * used by chat. Nothing is sent through the chat contract: escrow events are the canonical source.
 */
export const projectCanonicalDirectTradeV2ChatEntries = ({
  page,
  viewerAddress
}: {
  page: CanonicalTradeHistoryV2LogRange;
  viewerAddress: string;
}): readonly DirectTradeV2ChatEntry[] => {
  assertCanonicalTradeHistoryV2LogRange(page);
  if (page.scope.protocol !== 'direct-v2') {
    throw new Error('Only a canonical Direct OTC V2 range can produce chat cards.');
  }
  const viewer = getAddress(viewerAddress.trim()).toLowerCase();
  const entries: DirectTradeV2ChatEntry[] = [];
  for (const event of page.events) {
    const entry = event.kind === 'direct-opened'
      ? projectOpened(event, viewer)
      : event.kind === 'direct-status'
        ? projectStatus(event, viewer)
        : undefined;
    if (entry) entries.push(entry);
  }
  return Object.freeze(entries);
};
