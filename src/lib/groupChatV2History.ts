import { getAddress } from '@coti-io/coti-ethers';
import type {
  DirectChatV2MessageFinality,
  GroupMessageEntry,
  WalletAccountRole
} from './appShared/core';
import { parseChatMessagePayload } from './appShared/parsers';
import {
  buildGroupChatV2MessageKey,
  decryptGroupChatV2EventMessage,
  type GroupChatV2EpochKey,
  type GroupChatV2MessageEvent
} from './groupChatV2Chain';
import { decodeGroupChatV2Payload, type GroupChatV2Payload } from './groupChatV2Payload';

export const GROUP_CHAT_V2_UNAVAILABLE_MESSAGE_TEXT = '(Encrypted group message unavailable)';

export type GroupChatV2EpochKeyReference = Readonly<{
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  epoch: bigint;
  membershipRevision: bigint;
}>;

export type GroupChatV2EpochKeyResolver = (
  reference: GroupChatV2EpochKeyReference
) => Promise<GroupChatV2EpochKey>;

const safeNumber = (value: bigint, label: string): number => {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new Error(`${label} is not safely representable by the UI.`);
  }
  return converted;
};

const inspect = (event: GroupChatV2MessageEvent, viewerAddress: string) => {
  if (event.removed) throw new Error('Removed group V2 logs cannot enter canonical history.');
  const viewer = getAddress(viewerAddress.trim());
  const expectedKey = buildGroupChatV2MessageKey({
    chainId: event.chainId,
    contractAddress: event.contractAddress,
    groupId: event.groupId,
    messageId: event.messageId
  });
  if (event.key !== expectedKey) {
    throw new Error('Group V2 message has a non-canonical stable identity.');
  }
  return {
    viewer,
    expectedKey,
    direction: viewer.toLowerCase() === event.sender.toLowerCase()
      ? 'outgoing' as const
      : 'incoming' as const
  };
};

const entry = ({
  event,
  payload,
  viewerAddress,
  accountRole,
  finality,
  timestamp,
  contentState
}: {
  event: GroupChatV2MessageEvent;
  payload: GroupChatV2Payload;
  viewerAddress: string;
  accountRole?: WalletAccountRole;
  finality: DirectChatV2MessageFinality;
  timestamp?: number;
  contentState: 'available' | 'unavailable';
}): GroupMessageEntry => {
  const checked = inspect(event, viewerAddress);
  const parsed = parseChatMessagePayload(payload.body);
  const stableReply = payload.replyToMessageId === undefined
    ? undefined
    : buildGroupChatV2MessageKey({
        chainId: event.chainId,
        contractAddress: event.contractAddress,
        groupId: event.groupId,
        messageId: payload.replyToMessageId
      });
  if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp < 0)) {
    throw new Error('Group V2 message timestamp is invalid.');
  }
  return {
    id: checked.expectedKey,
    groupId: safeNumber(event.groupId, 'Group ID'),
    direction: checked.direction,
    text: parsed.cleanText,
    senderAddress: event.sender,
    accountAddress: checked.viewer,
    accountRole,
    replyToMessageId: stableReply ?? parsed.replyToMessageId,
    replyToMessageAnchor: payload.replyToMessageAnchor,
    replyToText: payload.replyPreview ?? parsed.replyToText,
    replyToTxHash: parsed.replyToTxHash,
    replyToBlockNumber: parsed.replyToBlockNumber,
    replyToLogIndex: parsed.replyToLogIndex,
    tradeReference: parsed.tradeReference,
    txHash: event.transactionHash,
    blockNumber: safeNumber(event.blockNumber, 'Group message block'),
    logIndex: event.logIndex,
    timestamp,
    groupV2: {
      protocol: 'group-v2',
      contentState,
      chainId: event.chainId.toString(),
      contractAddress: event.contractAddress,
      groupId: event.groupId.toString(),
      messageId: event.messageId.toString(),
      epoch: event.epoch.toString(),
      membershipRevision: event.membershipRevision.toString(),
      senderSequence: event.senderSequence.toString(),
      nonce: event.nonce,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber.toString(),
      blockHash: event.blockHash,
      logIndex: event.logIndex,
      finality
    }
  };
};

const assertKeyScope = (
  key: GroupChatV2EpochKey,
  event: GroupChatV2MessageEvent
): void => {
  if (
    key.chainId !== event.chainId ||
    key.contractAddress.toLowerCase() !== event.contractAddress.toLowerCase() ||
    key.groupId !== event.groupId ||
    key.epoch !== event.epoch ||
    key.membershipRevision !== event.membershipRevision
  ) {
    throw new Error('Resolved group epoch key belongs to another authorization scope.');
  }
};

export const normalizeGroupChatV2HistoryEvents = async ({
  events,
  expectedPreviousMessageId,
  viewerAddress,
  accountRole,
  resolveEpochKey,
  finality,
  timestampByBlock,
  shouldContinue,
  isEventReadable = () => true
}: {
  events: readonly GroupChatV2MessageEvent[];
  expectedPreviousMessageId: bigint;
  viewerAddress: string;
  accountRole?: WalletAccountRole;
  resolveEpochKey: GroupChatV2EpochKeyResolver;
  finality: DirectChatV2MessageFinality;
  timestampByBlock?: ReadonlyMap<number, number>;
  shouldContinue?: () => boolean;
  isEventReadable?: (event: GroupChatV2MessageEvent) => boolean;
}): Promise<Readonly<{
  entries: GroupMessageEntry[];
  previousMessageId: bigint;
  lastMessageId: bigint;
  nextMessageId: bigint;
}>> => {
  if (expectedPreviousMessageId < 0n) throw new Error('Previous group message ID is invalid.');
  const sorted = [...events].sort((left, right) => left.blockNumber === right.blockNumber
    ? left.logIndex - right.logIndex
    : left.blockNumber < right.blockNumber ? -1 : 1);
  const seen = new Set<string>();
  const keys = new Map<string, Promise<GroupChatV2EpochKey>>();
  const keyFor = (event: GroupChatV2MessageEvent): Promise<GroupChatV2EpochKey> => {
    const cacheKey = [
      event.chainId.toString(),
      event.contractAddress.toLowerCase(),
      event.groupId.toString(),
      event.epoch.toString(),
      event.membershipRevision.toString()
    ].join(':');
    const cached = keys.get(cacheKey);
    if (cached) return cached;
    const pending = resolveEpochKey({
      chainId: event.chainId,
      contractAddress: event.contractAddress,
      groupId: event.groupId,
      epoch: event.epoch,
      membershipRevision: event.membershipRevision
    });
    keys.set(cacheKey, pending);
    return pending;
  };

  // Authorization/key failures abort the page; corrupt participant-authored content does not.
  for (const event of sorted) {
    if (shouldContinue?.() === false) throw new Error('Group V2 history scope changed during synchronization.');
    if (isEventReadable(event)) assertKeyScope(await keyFor(event), event);
  }

  let lastMessageId = expectedPreviousMessageId;
  const entries: GroupMessageEntry[] = [];
  for (const event of sorted) {
    if (shouldContinue?.() === false) throw new Error('Group V2 history scope changed during synchronization.');
    if (seen.has(event.key)) throw new Error('Group V2 history contains a duplicate stable message ID.');
    seen.add(event.key);
    if (event.messageId !== lastMessageId + 1n) {
      throw new Error(`Group V2 history expected message ${lastMessageId + 1n} but received ${event.messageId}.`);
    }
    lastMessageId = event.messageId;
    // Message IDs are global to the group, including periods when this wallet
    // was not a member. Preserve continuity/checkpoint completeness without
    // requesting or exposing an epoch key the wallet was never authorized to read.
    if (!isEventReadable(event)) continue;
    const blockNumber = safeNumber(event.blockNumber, 'Group message block');
    const timestamp = timestampByBlock?.get(blockNumber);
    const key = await keyFor(event);
    try {
      const encoded = await decryptGroupChatV2EventMessage({ event, key });
      const payload = decodeGroupChatV2Payload(encoded);
      entries.push(entry({
        event,
        payload,
        viewerAddress,
        accountRole,
        finality,
        timestamp,
        contentState: 'available'
      }));
    } catch {
      entries.push(entry({
        event,
        payload: { version: 1, body: GROUP_CHAT_V2_UNAVAILABLE_MESSAGE_TEXT },
        viewerAddress,
        accountRole,
        finality,
        timestamp,
        contentState: 'unavailable'
      }));
    }
  }
  return Object.freeze({
    entries,
    previousMessageId: expectedPreviousMessageId,
    lastMessageId,
    nextMessageId: lastMessageId + 1n
  });
};
