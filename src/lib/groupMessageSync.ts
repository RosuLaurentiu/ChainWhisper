import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  extractUserCiphertext,
  FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK,
  formatGroupMembershipEventText,
  INITIAL_SYNC_LOOKBACK_BLOCKS,
  isWalletAddress,
  sortMessagesChronologically,
  toSafeNumber,
  type ChatMessage,
  type GroupMessageEntry,
  type SyncGroupOptions
} from './appShared';
import { resolveGroupCursorRange } from './groupSyncPlan';

type GroupLog = {
  transactionHash: string;
  blockNumber: number;
  index: number;
  args?: Record<string, unknown>;
};

type GroupContractLike = {
  filters: {
    GroupMessageDelivered: (groupId: number, from: null, to: string) => unknown;
    GroupMessageSubmitted: (groupId: number, from: string) => unknown;
    GroupMemberAdded: (groupId: number, account: null) => unknown;
    GroupMemberRemoved: (groupId: number, account: null) => unknown;
    GroupMemberLeft: (groupId: number, account: null) => unknown;
  };
  lastMessageBlockForGroup: (groupId: number) => Promise<unknown>;
  queryFilter: (filter: unknown, fromBlock: number, toBlock: number) => Promise<GroupLog[]>;
};

export type GroupMessageSyncContract = GroupContractLike;

type ReadProviderLike = {
  getBlock: (blockNumber: number) => Promise<{ timestamp?: unknown } | null>;
};

type ParsedGroupMessagePayload = {
  cleanText: string;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
  embeddedContactName?: unknown;
  embeddedConversationState?: unknown;
  embeddedReaction?: {
    targetTxHash?: string;
    targetBlockNumber?: number;
    targetLogIndex?: number;
    emoji?: string;
  };
};

type ParseEncryptedChatMessagePayload = (
  signer: Wallet | JsonRpcSigner,
  cacheKey: string,
  ciphertext: unknown
) => Promise<ParsedGroupMessagePayload>;

type ActiveGroupMessageFastOptions = {
  includeMembershipEvents?: boolean;
  knownLastBlock?: number;
  prefetch?: boolean;
  wideLoad?: boolean;
};

type SyncActiveGroupMessagesArgs = {
  blockTimestampCacheRef: MutableRefObject<Map<number, number>>;
  cacheKey: string;
  contract: GroupContractLike;
  groupId: number;
  groupMemberLastSyncedBlockRef: MutableRefObject<Record<string, number>>;
  groupMessageLastSyncedBlockRef: MutableRefObject<Record<string, number>>;
  isCurrentWalletKey: () => boolean;
  latestBlock: number;
  messagesByGroupRef: MutableRefObject<Record<string, ChatMessage[]>>;
  options?: SyncGroupOptions;
  parseEncryptedChatMessagePayload: ParseEncryptedChatMessagePayload;
  pendingForcedBottomAnchorThreadKeyRef: MutableRefObject<string | null>;
  readProvider: ReadProviderLike;
  requestedWalletAddress: string;
  setMessagesByGroup: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  signer: Wallet | JsonRpcSigner;
  stickToBottomRef: MutableRefObject<boolean>;
  walletKey: string;
  fastOptions?: ActiveGroupMessageFastOptions;
};

export const mergeGroupMessageEntries = (
  existing: ChatMessage[],
  entries: GroupMessageEntry[]
): ChatMessage[] => {
  const confirmedOutgoingTxHashes = new Set(
    entries
      .filter((entry) => entry.direction === 'outgoing')
      .map((entry) => entry.txHash.toLowerCase())
  );
  const prunedExisting = existing.filter((message) => {
    if (!message.id.startsWith('local-group-')) {
      return true;
    }
    if (!message.txHash) {
      return true;
    }
    return !confirmedOutgoingTxHashes.has(message.txHash.toLowerCase());
  });

  const nextMessages = [...prunedExisting];
  const existingIds = new Set(nextMessages.map((message) => message.id));
  for (const entry of entries) {
    if (existingIds.has(entry.id)) {
      continue;
    }

    existingIds.add(entry.id);
    nextMessages.push({
      id: entry.id,
      direction: entry.direction,
      text: entry.text,
      senderAddress: entry.senderAddress,
      isSystem: entry.isSystem,
      replyToMessageId: entry.replyToMessageId,
      replyToText: entry.replyToText,
      replyToTxHash: entry.replyToTxHash,
      replyToBlockNumber: entry.replyToBlockNumber,
      replyToLogIndex: entry.replyToLogIndex,
      reactionToTxHash: entry.reactionToTxHash,
      reactionToBlockNumber: entry.reactionToBlockNumber,
      reactionToLogIndex: entry.reactionToLogIndex,
      reactionEmoji: entry.reactionEmoji,
      timestamp: entry.timestamp,
      blockNumber: entry.blockNumber,
      logIndex: entry.logIndex,
      txHash: entry.txHash
    });
  }

  return sortMessagesChronologically(nextMessages);
};

const buildLatestIncomingByGroup = (
  groupId: number,
  entries: GroupMessageEntry[]
): Map<string, number> => {
  const latestIncomingByGroup = new Map<string, number>();
  const latestIncomingFromEntries = entries.reduce((max, entry) => {
    if (entry.direction !== 'incoming' || typeof entry.timestamp !== 'number') {
      return max;
    }
    const ts = Number(entry.timestamp);
    return ts > max ? ts : max;
  }, 0);
  if (latestIncomingFromEntries > 0) {
    latestIncomingByGroup.set(String(groupId), latestIncomingFromEntries);
  }
  return latestIncomingByGroup;
};

export const syncActiveGroupMessagesFast = async ({
  blockTimestampCacheRef,
  cacheKey,
  contract,
  fastOptions,
  groupId,
  groupMemberLastSyncedBlockRef,
  groupMessageLastSyncedBlockRef,
  isCurrentWalletKey,
  latestBlock,
  messagesByGroupRef,
  options,
  parseEncryptedChatMessagePayload,
  pendingForcedBottomAnchorThreadKeyRef,
  readProvider,
  requestedWalletAddress,
  setMessagesByGroup,
  signer,
  stickToBottomRef,
  walletKey
}: SyncActiveGroupMessagesArgs): Promise<Map<string, number>> => {
  const latestIncomingByGroup = new Map<string, number>();
  const groupMessageSyncKey = `${walletKey}:${groupId}`;
  const groupMemberSyncKey = `${walletKey}:${groupId}`;
  const previousGroupMessageBlock = groupMessageLastSyncedBlockRef.current[groupMessageSyncKey];
  const previousGroupMemberBlock = groupMemberLastSyncedBlockRef.current[groupMemberSyncKey];
  const knownLastBlock = toSafeNumber(fastOptions?.knownLastBlock);
  const activeGroupLastMessageBlock =
    knownLastBlock > 0
      ? knownLastBlock
      : toSafeNumber(await contract.lastMessageBlockForGroup(groupId).catch(() => null));
  if (!isCurrentWalletKey()) {
    return latestIncomingByGroup;
  }

  const messageRange = resolveGroupCursorRange({
    deep: options?.deep,
    initialLookbackBlocks: INITIAL_SYNC_LOOKBACK_BLOCKS,
    latestBlock,
    lastActivityBlock: activeGroupLastMessageBlock,
    prefetch: fastOptions?.prefetch,
    prefetchLookbackBlocks: FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK,
    previousSyncedBlock: previousGroupMessageBlock,
    wideLoad: fastOptions?.wideLoad
  });
  const memberRange = fastOptions?.includeMembershipEvents
    ? resolveGroupCursorRange({
      deep: options?.deep,
      initialLookbackBlocks: INITIAL_SYNC_LOOKBACK_BLOCKS,
      latestBlock,
      lastActivityBlock: knownLastBlock > 0 ? knownLastBlock : activeGroupLastMessageBlock,
      previousSyncedBlock: previousGroupMemberBlock,
      wideLoad: fastOptions?.wideLoad
    })
    : null;

  if (!messageRange.shouldQuery) {
    groupMessageLastSyncedBlockRef.current[groupMessageSyncKey] = messageRange.advanceToBlock;
  }
  if (memberRange && !memberRange.shouldQuery) {
    groupMemberLastSyncedBlockRef.current[groupMemberSyncKey] = memberRange.advanceToBlock;
  }
  if (!messageRange.shouldQuery && (!memberRange || !memberRange.shouldQuery)) {
    return latestIncomingByGroup;
  }

  const [
    incomingLogs,
    outgoingLogs,
    memberAddedLogs,
    memberRemovedLogs,
    memberLeftLogs
  ] = await Promise.all([
    messageRange.shouldQuery
      ? contract.queryFilter(
        contract.filters.GroupMessageDelivered(groupId, null, requestedWalletAddress),
        messageRange.fromBlock,
        messageRange.toBlock
      )
      : Promise.resolve([]),
    messageRange.shouldQuery
      ? contract.queryFilter(
        contract.filters.GroupMessageSubmitted(groupId, requestedWalletAddress),
        messageRange.fromBlock,
        messageRange.toBlock
      )
      : Promise.resolve([]),
    memberRange?.shouldQuery
      ? contract.queryFilter(contract.filters.GroupMemberAdded(groupId, null), memberRange.fromBlock, memberRange.toBlock)
      : Promise.resolve([]),
    memberRange?.shouldQuery
      ? contract.queryFilter(contract.filters.GroupMemberRemoved(groupId, null), memberRange.fromBlock, memberRange.toBlock)
      : Promise.resolve([]),
    memberRange?.shouldQuery
      ? contract.queryFilter(contract.filters.GroupMemberLeft(groupId, null), memberRange.fromBlock, memberRange.toBlock)
      : Promise.resolve([])
  ]);
  if (!isCurrentWalletKey()) {
    return latestIncomingByGroup;
  }

  const blockNumbers = new Set<number>();
  for (const log of incomingLogs) {
    blockNumbers.add(log.blockNumber);
  }
  for (const log of outgoingLogs) {
    blockNumbers.add(log.blockNumber);
  }
  for (const log of memberAddedLogs) {
    blockNumbers.add(log.blockNumber);
  }
  for (const log of memberRemovedLogs) {
    blockNumbers.add(log.blockNumber);
  }
  for (const log of memberLeftLogs) {
    blockNumbers.add(log.blockNumber);
  }

  const blockTimestampMap = new Map<number, number>();
  const blockTimestampCache = blockTimestampCacheRef.current;
  await Promise.all(
    Array.from(blockNumbers).map(async (blockNumber) => {
      const cachedTimestamp = blockTimestampCache.get(blockNumber);
      if (typeof cachedTimestamp === 'number') {
        blockTimestampMap.set(blockNumber, cachedTimestamp);
        return;
      }

      const block = await readProvider.getBlock(blockNumber);
      if (block?.timestamp) {
        const timestamp = Number(block.timestamp);
        blockTimestampMap.set(blockNumber, timestamp);
        blockTimestampCache.set(blockNumber, timestamp);
      }
    })
  );
  if (!isCurrentWalletKey()) {
    return latestIncomingByGroup;
  }

  const entries: GroupMessageEntry[] = [];
  const appendMessageEntry = async (
    log: GroupLog,
    direction: 'incoming' | 'outgoing',
    senderAddress: string,
    ciphertextSource: unknown,
    idSuffix: string
  ): Promise<void> => {
    const userCiphertext = extractUserCiphertext(ciphertextSource);
    let messageText = '(Unable to decrypt message)';
    let replyToMessageId: string | undefined;
    let replyToText: string | undefined;
    let replyToTxHash: string | undefined;
    let replyToBlockNumber: number | undefined;
    let replyToLogIndex: number | undefined;
    let reactionToTxHash: string | undefined;
    let reactionToBlockNumber: number | undefined;
    let reactionToLogIndex: number | undefined;
    let reactionEmoji: string | undefined;
    if (userCiphertext && userCiphertext.value.length > 0) {
      try {
        const parsedMessage = await parseEncryptedChatMessagePayload(signer, cacheKey, userCiphertext);
        messageText = parsedMessage.cleanText;
        replyToMessageId = parsedMessage.replyToMessageId;
        replyToText = parsedMessage.replyToText;
        replyToTxHash = parsedMessage.replyToTxHash;
        replyToBlockNumber = parsedMessage.replyToBlockNumber;
        replyToLogIndex = parsedMessage.replyToLogIndex;
        reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
        reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
        reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
        reactionEmoji = parsedMessage.embeddedReaction?.emoji;
        if (
          messageText.trim().length === 0 &&
          (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
        ) {
          return;
        }
      } catch {
        messageText = '(Unable to decrypt message)';
      }
    }

    entries.push({
      id: `${log.transactionHash}-${log.index}-${idSuffix}`,
      groupId,
      direction,
      text: messageText,
      senderAddress,
      replyToMessageId,
      replyToText,
      replyToTxHash,
      replyToBlockNumber,
      replyToLogIndex,
      reactionToTxHash,
      reactionToBlockNumber,
      reactionToLogIndex,
      reactionEmoji,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      timestamp: blockTimestampMap.get(log.blockNumber)
    });
  };

  for (const log of incomingLogs) {
    const from = String(log.args?.from ?? '').trim();
    if (!isWalletAddress(from)) {
      continue;
    }
    await appendMessageEntry(log, 'incoming', from, log.args?.messageForRecipient, 'group-in');
  }

  for (const log of outgoingLogs) {
    await appendMessageEntry(log, 'outgoing', requestedWalletAddress, log.args?.messageForSender, 'group-out');
  }

  for (const log of memberAddedLogs) {
    const account = String(log.args?.account ?? '').trim();
    entries.push({
      id: `${log.transactionHash}-${log.index}-group-member-added`,
      groupId,
      direction: 'incoming',
      text: formatGroupMembershipEventText('added', account),
      senderAddress: account,
      isSystem: true,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      timestamp: blockTimestampMap.get(log.blockNumber)
    });
  }

  for (const log of memberRemovedLogs) {
    const account = String(log.args?.account ?? '').trim();
    entries.push({
      id: `${log.transactionHash}-${log.index}-group-member-removed`,
      groupId,
      direction: 'incoming',
      text: formatGroupMembershipEventText('removed', account),
      senderAddress: account,
      isSystem: true,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      timestamp: blockTimestampMap.get(log.blockNumber)
    });
  }

  for (const log of memberLeftLogs) {
    const account = String(log.args?.account ?? '').trim();
    entries.push({
      id: `${log.transactionHash}-${log.index}-group-member-left`,
      groupId,
      direction: 'incoming',
      text: formatGroupMembershipEventText('left', account),
      senderAddress: account,
      isSystem: true,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      timestamp: blockTimestampMap.get(log.blockNumber)
    });
  }

  entries.sort((left, right) => {
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber - right.blockNumber;
    }
    return left.logIndex - right.logIndex;
  });

  const nextLatestIncomingByGroup = buildLatestIncomingByGroup(groupId, entries);

  if (entries.length > 0) {
    const activeGroupKey = String(groupId);
    const existingGroupMessages = messagesByGroupRef.current[activeGroupKey] ?? [];
    if (!fastOptions?.prefetch && (stickToBottomRef.current || existingGroupMessages.length === 0)) {
      pendingForcedBottomAnchorThreadKeyRef.current = `group:${groupId}`;
    }

    setMessagesByGroup((previous) => ({
      ...previous,
      [activeGroupKey]: mergeGroupMessageEntries(previous[activeGroupKey] ?? [], entries)
    }));
  }

  if (messageRange.shouldQuery) {
    groupMessageLastSyncedBlockRef.current[groupMessageSyncKey] = messageRange.toBlock;
  }
  if (memberRange?.shouldQuery) {
    groupMemberLastSyncedBlockRef.current[groupMemberSyncKey] = memberRange.toBlock;
  }
  return nextLatestIncomingByGroup;
};
