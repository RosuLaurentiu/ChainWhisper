import type { SyncGroupOptions } from './appShared/core';

type GroupCursorRangeArgs = {
  deep?: boolean;
  initialLookbackBlocks: number;
  latestBlock: number;
  lastActivityBlock?: number;
  prefetch?: boolean;
  prefetchLookbackBlocks?: number;
  previousSyncedBlock?: number;
  wideLoad?: boolean;
};

export type GroupCursorRange = {
  advanceToBlock: number;
  fromBlock: number;
  shouldQuery: boolean;
  toBlock: number;
};

export type GroupEventLogLike = {
  args?: Record<string, unknown>;
  blockNumber?: number;
  index?: number;
  transactionHash?: string;
};

export type GroupRemovalEvent = {
  blockNumber: number;
  logIndex: number;
  marker: string;
};

export type GroupMessageLoadPhase = 'initial' | 'history';

export type TrackedGroupMessageLoad = {
  groupId: number;
  phase: GroupMessageLoadPhase;
};

export type GroupActivityLike = {
  id?: number;
  lastBlock?: number;
  lastTimestamp?: number;
};

export type GroupPrefetchPlan = {
  cacheKey: string;
  options: SyncGroupOptions;
};

export type ActiveGroupBackfillPlan = {
  cacheKey: string;
  deepOptions?: SyncGroupOptions;
  fastOptions: SyncGroupOptions;
};

const toPositiveInteger = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

const normalizeWalletKey = (walletAddress: string): string => walletAddress.trim().toLowerCase();

const isGroupSyncReady = ({
  chainId,
  hasAesReady,
  requiredChainId,
  walletAddress,
  walletAddressValid = true
}: {
  chainId: number | null;
  hasAesReady: boolean;
  requiredChainId: number;
  walletAddress: string;
  walletAddressValid?: boolean;
}): boolean =>
  normalizeWalletKey(walletAddress).length > 0 &&
  walletAddressValid &&
  hasAesReady &&
  chainId === requiredChainId;

export const resolveGroupIdFromEvent = (value: unknown): number => {
  const direct = toPositiveInteger(value);
  if (direct > 0) {
    return direct;
  }

  if (value && typeof value === 'object') {
    const maybeArgs = (value as { args?: Record<string, unknown> }).args;
    return toPositiveInteger(maybeArgs?.groupId);
  }

  return 0;
};

export const collectGroupIdsFromLogs = (logs: GroupEventLogLike[]): number[] => {
  const groupIds = new Set<number>();
  for (const log of logs) {
    const groupId = resolveGroupIdFromEvent(log);
    if (groupId > 0) {
      groupIds.add(groupId);
    }
  }

  return Array.from(groupIds);
};

export const collectLatestGroupRemovalEvents = (
  memberRemovedLogs: GroupEventLogLike[]
): { groupIds: number[]; eventByGroupId: Map<number, GroupRemovalEvent> } => {
  const groupIds = new Set<number>();
  const eventByGroupId = new Map<number, GroupRemovalEvent>();

  for (const log of memberRemovedLogs) {
    const groupId = resolveGroupIdFromEvent(log);
    const blockNumber = toPositiveInteger(log.blockNumber);
    const logIndex = toPositiveInteger(log.index);
    const transactionHash = String(log.transactionHash ?? '').trim().toLowerCase();
    if (groupId <= 0) {
      continue;
    }

    groupIds.add(groupId);
    const nextEvent = {
      blockNumber,
      logIndex,
      marker: `${blockNumber}:${logIndex}:${transactionHash}`
    };
    const existingEvent = eventByGroupId.get(groupId);
    if (
      !existingEvent ||
      nextEvent.blockNumber > existingEvent.blockNumber ||
      (nextEvent.blockNumber === existingEvent.blockNumber && nextEvent.logIndex > existingEvent.logIndex)
    ) {
      eventByGroupId.set(groupId, nextEvent);
    }
  }

  return {
    groupIds: Array.from(groupIds),
    eventByGroupId
  };
};

export const resolveRealtimeGroupSyncOptions = (
  eventGroupId: unknown,
  activeGroupId: number | null
): SyncGroupOptions => {
  const parsedEventGroupId = resolveGroupIdFromEvent(eventGroupId);
  if (activeGroupId !== null && (parsedEventGroupId <= 0 || parsedEventGroupId === activeGroupId)) {
    return { activeMessagesOnly: true };
  }

  return { overviewOnly: true };
};

export const mergeGroupSyncOptions = (
  options?: SyncGroupOptions,
  pending?: SyncGroupOptions | null
): SyncGroupOptions => {
  const mergedDeep = Boolean(options?.deep || pending?.deep);
  const hasFullDeepRequest = Boolean(
    (options?.deep && !options?.activeMessagesOnly) ||
      (pending?.deep && !pending?.activeMessagesOnly)
  );
  const mergedActiveMessagesOnly = !hasFullDeepRequest && Boolean(options?.activeMessagesOnly || pending?.activeMessagesOnly);
  const nextPrefetchGroupId = toPositiveInteger(options?.prefetchGroupId);
  const pendingPrefetchGroupId = toPositiveInteger(pending?.prefetchGroupId);
  const mergedPrefetchGroupId =
    !mergedDeep && !mergedActiveMessagesOnly
      ? nextPrefetchGroupId > 0
        ? nextPrefetchGroupId
        : pendingPrefetchGroupId > 0
          ? pendingPrefetchGroupId
          : undefined
      : undefined;

  return {
    deep: mergedDeep,
    background: Boolean((options?.background ?? true) && (pending?.background ?? true)),
    overviewOnly: mergedActiveMessagesOnly
      ? false
      : pending
        ? Boolean(options?.overviewOnly && pending.overviewOnly)
        : Boolean(options?.overviewOnly),
    activeMessagesOnly: mergedActiveMessagesOnly,
    wideLoad: Boolean(options?.wideLoad || pending?.wideLoad),
    prefetchGroupId: mergedPrefetchGroupId
  };
};

export const resolveTrackedGroupMessageLoad = ({
  activeGroupId,
  activeGroupMessageCount,
  options
}: {
  activeGroupId: number | null;
  activeGroupMessageCount: number;
  options?: SyncGroupOptions;
}): TrackedGroupMessageLoad | null => {
  const selectedGroupId = toPositiveInteger(activeGroupId);
  if (
    selectedGroupId <= 0 ||
    toPositiveInteger(options?.prefetchGroupId) > 0 ||
    (options?.overviewOnly && !options?.activeMessagesOnly)
  ) {
    return null;
  }

  if (!options?.activeMessagesOnly && !options?.deep) {
    return null;
  }

  return {
    groupId: selectedGroupId,
    phase: options?.deep || activeGroupMessageCount > 0 ? 'history' : 'initial'
  };
};

export const trackedGroupMessageLoadsMatch = (
  current: TrackedGroupMessageLoad | null,
  next: TrackedGroupMessageLoad | null
): boolean => Boolean(current && next && current.groupId === next.groupId);

export const resolveGroupPrefetchPlan = ({
  chainId,
  groups,
  hasAesReady,
  prefetchedKeys,
  requestedGroupId,
  requiredChainId,
  walletAddress
}: {
  chainId: number | null;
  groups: GroupActivityLike[];
  hasAesReady: boolean;
  prefetchedKeys: Record<string, boolean>;
  requestedGroupId: number;
  requiredChainId: number;
  walletAddress: string;
}): GroupPrefetchPlan | null => {
  const groupId = toPositiveInteger(requestedGroupId);
  if (
    groupId <= 0 ||
    !isGroupSyncReady({
      chainId,
      hasAesReady,
      requiredChainId,
      walletAddress
    })
  ) {
    return null;
  }

  const group = groups.find((entry) => toPositiveInteger(entry.id) === groupId);
  const lastBlock = toPositiveInteger(group?.lastBlock);
  const lastTimestamp = toPositiveInteger(group?.lastTimestamp);
  const groupVersion = lastBlock > 0 ? lastBlock : lastTimestamp > 0 ? lastTimestamp : 0;
  const cacheKey = `${normalizeWalletKey(walletAddress)}:${groupId}:${groupVersion}`;
  if (prefetchedKeys[cacheKey]) {
    return null;
  }

  return {
    cacheKey,
    options: {
      background: true,
      prefetchGroupId: groupId,
      wideLoad: true
    }
  };
};

export const resolveActiveGroupBackfillPlan = ({
  activeGroupId,
  chainId,
  completedBackfillKeys,
  hasAesReady,
  requiredChainId,
  walletAddress,
  walletAddressValid
}: {
  activeGroupId: number | null;
  chainId: number | null;
  completedBackfillKeys: Record<string, boolean>;
  hasAesReady: boolean;
  requiredChainId: number;
  walletAddress: string;
  walletAddressValid: boolean;
}): ActiveGroupBackfillPlan | null => {
  const groupId = toPositiveInteger(activeGroupId);
  if (
    groupId <= 0 ||
    !isGroupSyncReady({
      chainId,
      hasAesReady,
      requiredChainId,
      walletAddress,
      walletAddressValid
    })
  ) {
    return null;
  }

  const cacheKey = `${normalizeWalletKey(walletAddress)}:${groupId}`;
  const isFirstOpen = !completedBackfillKeys[cacheKey];

  return {
    cacheKey,
    fastOptions: {
      background: true,
      activeMessagesOnly: true,
      wideLoad: isFirstOpen
    },
    deepOptions: isFirstOpen
      ? {
        background: true,
        activeMessagesOnly: true,
        deep: true
      }
      : undefined
  };
};

export const resolveGroupCursorRange = ({
  deep,
  initialLookbackBlocks,
  latestBlock,
  lastActivityBlock,
  prefetch,
  prefetchLookbackBlocks = initialLookbackBlocks,
  previousSyncedBlock,
  wideLoad
}: GroupCursorRangeArgs): GroupCursorRange => {
  const safeLatestBlock = Math.max(0, Math.floor(latestBlock));
  const safeLastActivityBlock = toPositiveInteger(lastActivityBlock);
  const hasPreviousCursor = typeof previousSyncedBlock === 'number' && Number.isFinite(previousSyncedBlock);
  const hasNewActivity =
    Boolean(deep) ||
    Boolean(wideLoad) ||
    !hasPreviousCursor ||
    safeLastActivityBlock <= 0 ||
    safeLastActivityBlock > previousSyncedBlock;

  const toBlock = prefetch && safeLastActivityBlock > 0
    ? Math.min(safeLastActivityBlock, safeLatestBlock)
    : safeLatestBlock;

  if (!hasNewActivity) {
    return {
      advanceToBlock: safeLatestBlock,
      fromBlock: safeLatestBlock + 1,
      shouldQuery: false,
      toBlock
    };
  }

  const fromBlock = deep
    ? 0
    : wideLoad && safeLastActivityBlock > 0
      ? Math.max(0, safeLastActivityBlock - initialLookbackBlocks)
      : hasPreviousCursor
        ? previousSyncedBlock + 1
        : prefetch && safeLastActivityBlock > 0
          ? Math.max(0, safeLastActivityBlock - prefetchLookbackBlocks)
          : Math.max(0, safeLatestBlock - initialLookbackBlocks);

  return {
    advanceToBlock: toBlock,
    fromBlock,
    shouldQuery: fromBlock <= toBlock,
    toBlock
  };
};
