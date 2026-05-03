import type { SyncConversationOptions } from './appShared/core';

type BlockNumberLike = number | undefined;

export type DirectSyncRange = {
  fromBlock: number;
  shouldQuery: boolean;
  toBlock: number;
};

export type DirectOlderHistoryRange = DirectSyncRange & {
  hasReachedStart: boolean;
};

type MessageBlockLike = {
  blockNumber?: number;
};

const toSafeBlockNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const toOptionalBlockNumber = (value: unknown): BlockNumberLike => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
};

const mergeOptionalMin = (left: unknown, right: unknown): BlockNumberLike => {
  const leftBlock = toOptionalBlockNumber(left);
  const rightBlock = toOptionalBlockNumber(right);
  if (typeof leftBlock === 'number' && typeof rightBlock === 'number') {
    return Math.min(leftBlock, rightBlock);
  }
  return typeof leftBlock === 'number' ? leftBlock : rightBlock;
};

const mergeOptionalMax = (left: unknown, right: unknown): BlockNumberLike => {
  const leftBlock = toOptionalBlockNumber(left);
  const rightBlock = toOptionalBlockNumber(right);
  if (typeof leftBlock === 'number' && typeof rightBlock === 'number') {
    return Math.max(leftBlock, rightBlock);
  }
  return typeof leftBlock === 'number' ? leftBlock : rightBlock;
};

export const mergeDirectSyncOptions = (
  options?: SyncConversationOptions,
  pending?: SyncConversationOptions | null
): SyncConversationOptions => {
  const mergedDeep = Boolean(options?.deep || pending?.deep);
  const mergedContactsOnly = mergedDeep ? false : Boolean(options?.contactsOnly || pending?.contactsOnly);
  const mergedActiveContactOnly =
    !mergedDeep && !mergedContactsOnly && Boolean(options?.activeContactOnly || pending?.activeContactOnly);
  const mergedPreviewPerContact = mergedContactsOnly
    ? Boolean(options?.previewPerContact || pending?.previewPerContact)
    : false;
  const lookbackBlocks = mergedDeep
    ? undefined
    : mergeOptionalMax(options?.lookbackBlocks, pending?.lookbackBlocks);
  const fromBlock = mergedDeep ? undefined : mergeOptionalMin(options?.fromBlock, pending?.fromBlock);
  const toBlock = mergeOptionalMax(options?.toBlock, pending?.toBlock);

  return {
    ...pending,
    ...options,
    deep: mergedDeep,
    contactsOnly: mergedContactsOnly,
    activeContactOnly: mergedActiveContactOnly,
    previewPerContact: mergedPreviewPerContact,
    updateHead: Boolean(options?.updateHead || pending?.updateHead || mergedDeep),
    ...(typeof lookbackBlocks === 'number' ? { lookbackBlocks } : {}),
    background: Boolean((options?.background ?? true) && (pending?.background ?? true)),
    ...(typeof fromBlock === 'number' ? { fromBlock } : {}),
    ...(typeof toBlock === 'number' ? { toBlock } : {})
  };
};

export const resolveDirectSyncRange = ({
  initialLookbackBlocks,
  latestBlock,
  lastSyncedBlock,
  options
}: {
  initialLookbackBlocks: number;
  latestBlock: number;
  lastSyncedBlock?: number;
  options?: SyncConversationOptions;
}): DirectSyncRange => {
  const safeLatestBlock = toSafeBlockNumber(latestBlock);
  const toBlock =
    typeof options?.toBlock === 'number'
      ? Math.min(toSafeBlockNumber(options.toBlock), safeLatestBlock)
      : safeLatestBlock;
  const fromBlock =
    typeof options?.fromBlock === 'number'
      ? toSafeBlockNumber(options.fromBlock)
      : options?.deep
        ? 0
        : typeof options?.lookbackBlocks === 'number'
          ? Math.max(0, toBlock - toSafeBlockNumber(options.lookbackBlocks))
          : typeof lastSyncedBlock === 'number'
            ? toSafeBlockNumber(lastSyncedBlock) + 1
            : Math.max(0, toBlock - toSafeBlockNumber(initialLookbackBlocks));

  return {
    fromBlock,
    shouldQuery: fromBlock <= toBlock,
    toBlock
  };
};

export const resolveKnownEarliestMessageBlock = (messages: MessageBlockLike[] = []): BlockNumberLike => {
  let earliestBlock: BlockNumberLike;
  for (const message of messages) {
    const blockNumber = toOptionalBlockNumber(message.blockNumber);
    if (typeof blockNumber !== 'number') {
      continue;
    }

    if (typeof earliestBlock !== 'number' || blockNumber < earliestBlock) {
      earliestBlock = blockNumber;
    }
  }

  return earliestBlock;
};

export const resolveOlderDirectHistoryRange = ({
  conversationFirstBlock,
  conversationLastBlock,
  historyWindowBlocks,
  knownEarliestBlock,
  knownMessages,
  latestBlock
}: {
  conversationFirstBlock: number;
  conversationLastBlock: number;
  historyWindowBlocks: number;
  knownEarliestBlock?: number;
  knownMessages?: MessageBlockLike[];
  latestBlock: number;
}): DirectOlderHistoryRange => {
  const firstBlock = toSafeBlockNumber(conversationFirstBlock);
  const lastBlock = Math.min(toSafeBlockNumber(latestBlock), toSafeBlockNumber(conversationLastBlock));
  if (lastBlock < firstBlock) {
    return {
      fromBlock: firstBlock,
      hasReachedStart: true,
      shouldQuery: false,
      toBlock: lastBlock
    };
  }

  const knownEarliest =
    toOptionalBlockNumber(knownEarliestBlock) ?? resolveKnownEarliestMessageBlock(knownMessages);
  const upperExclusive = typeof knownEarliest === 'number' ? knownEarliest : lastBlock + 1;
  const toBlock = upperExclusive - 1;
  if (toBlock < firstBlock) {
    return {
      fromBlock: firstBlock,
      hasReachedStart: true,
      shouldQuery: false,
      toBlock
    };
  }

  const historyWindow = Math.max(1, toSafeBlockNumber(historyWindowBlocks));
  const fromBlock = Math.max(firstBlock, toBlock - historyWindow + 1);

  return {
    fromBlock,
    hasReachedStart: fromBlock <= firstBlock,
    shouldQuery: true,
    toBlock
  };
};
