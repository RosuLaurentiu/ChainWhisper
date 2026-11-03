import type { GroupMessageEntry } from './appShared/core';
import type { GroupChatV2ReadContext } from './groupChatV2Chain';
import { normalizeGroupChatV2HistoryEvents } from './groupChatV2History';
import {
  assertGroupChatV2SessionController,
  observeGroupChatV2Read,
  type GroupChatV2ReadObserver,
  type GroupChatV2ReadPhase,
  type GroupChatV2SessionController
} from './groupChatV2Session';

export type GroupChatV2HistoryCheckpoint = Readonly<{
  groupId: bigint;
  nextBlock: bigint;
  lastMessageId: bigint;
  boundaryBlockNumber: bigint;
  boundaryBlockHash: string;
}>;

export type GroupChatV2HistorySyncResult = Readonly<{
  groupId: bigint;
  entries: readonly GroupMessageEntry[];
  checkpoint: GroupChatV2HistoryCheckpoint | null;
  resetConversation: boolean;
  safeHead: bigint;
  hasOlder: boolean;
}>;

export type GroupChatV2HistoryRuntime = Readonly<{
  sync: (groupId: bigint, accept?: (result: GroupChatV2HistorySyncResult) => boolean,
    shouldContinue?: () => boolean) => Promise<GroupChatV2HistorySyncResult>;
  loadOlder: (groupId: bigint, accept?: (result: GroupChatV2HistorySyncResult) => boolean,
    shouldContinue?: () => boolean) => Promise<GroupChatV2HistorySyncResult>;
  checkpoint: (groupId: bigint) => GroupChatV2HistoryCheckpoint | null;
  clearGroup: (groupId: bigint) => void;
  close: () => void;
}>;

const MAX_BLOCK_SPAN = 2_048n;

export const createGroupChatV2HistoryRuntime = ({
  confirmationDepth,
  isCurrent,
  onReadPhase,
  ownerAddress,
  session
}: {
  confirmationDepth: bigint;
  isCurrent: () => boolean;
  onReadPhase?: GroupChatV2ReadObserver;
  ownerAddress: string;
  session: GroupChatV2SessionController;
}): GroupChatV2HistoryRuntime => {
  assertGroupChatV2SessionController(session);
  if (confirmationDepth <= 0n || confirmationDepth > 4_096n) {
    throw new Error('Group Chat V2 history finality depth is invalid.');
  }
  let current = true;
  let syncTail: Promise<void> = Promise.resolve();
  const checkpoints = new Map<string, GroupChatV2HistoryCheckpoint>();
  const oldestPages = new Map<string, Readonly<{ fromBlock: bigint; previousMessageId: bigint;
    boundaryBlockHash: string }>>();
  const pendingProjectionResets = new Set<string>();
  const scopeKey = (groupId: bigint): string => [
    session.ownerAddress.toLowerCase(),
    session.manifest.chainId.toString(),
    session.manifest.contractAddress.toLowerCase(),
    groupId.toString()
  ].join(':');
  const assertCurrent = (shouldContinue?: () => boolean): void => {
    if (!current || !isCurrent() || shouldContinue?.() === false) {
      throw new Error('Group Chat V2 history scope is no longer current.');
    }
  };

  const runSync = async (groupId: bigint, accept?: (result: GroupChatV2HistorySyncResult) => boolean,
    shouldContinue?: () => boolean, older = false): Promise<GroupChatV2HistorySyncResult> => {
    assertCurrent(shouldContinue);
    const read = <T>(phase: GroupChatV2ReadPhase, operation: () => Promise<T>): Promise<T> =>
      observeGroupChatV2Read(phase, onReadPhase, async () => {
        assertCurrent(shouldContinue);
        const result = await operation();
        assertCurrent(shouldContinue);
        return result;
      });
    if (groupId <= 0n) throw new Error('Group Chat V2 history requires a non-zero group ID.');
    const readContext: GroupChatV2ReadContext = Object.freeze({ purpose: 'selected-history', groupId });
    const key = scopeKey(groupId);
    let oldest = oldestPages.get(key) ?? null;
    const deliver = (result: GroupChatV2HistorySyncResult): GroupChatV2HistorySyncResult => {
      assertCurrent(shouldContinue);
      // A view change must not consume a page or reset that the App did not apply.
      if (!accept || accept(result) === true) {
        assertCurrent(shouldContinue);
        if (result.checkpoint) checkpoints.set(key, result.checkpoint);
        if (oldest) oldestPages.set(key, oldest);
        pendingProjectionResets.delete(key);
      }
      return result;
    };
    const group = await read('history-state', () => session.inspect(groupId, readContext));
    const latestBlock = await read('history-head', () => session.latestBlock(readContext));
    const safeHead = latestBlock > confirmationDepth ? latestBlock - confirmationDepth : 0n;
    const beforeSafeHead = safeHead >= group.createdBlock ? await read('history-fence', () => session.canonicalBlock(safeHead, readContext)) : null;
    let checkpoint = checkpoints.get(key) ?? null;
    let resetConversation = pendingProjectionResets.has(key);
    if (checkpoint) {
      if (checkpoint.boundaryBlockNumber > safeHead) {
        resetConversation = true;
      } else {
        const canonicalBoundary = await read('history-fence', () => session.canonicalBlock(checkpoint!.boundaryBlockNumber, readContext));
        resetConversation = canonicalBoundary.blockHash !== checkpoint.boundaryBlockHash;
      }
      if (resetConversation) {
        checkpoints.delete(key);
        oldestPages.delete(key);
        oldest = null;
        pendingProjectionResets.add(key);
        session.clearEpochKeys();
        checkpoint = null;
      }
    }
    if (!beforeSafeHead) {
      return deliver(Object.freeze({ groupId, entries: [], checkpoint, resetConversation, safeHead, hasOlder: false }));
    }

    let initialHistoryBlock = group.createdBlock;
    if (group.messageCount > 0n) {
      if (
        group.firstMessageBlock < group.createdBlock ||
        group.firstMessageBlock > group.lastMessageBlock
      ) {
        throw new Error('Group Chat V2 message-block anchors are inconsistent.');
      }
      // The immutable first-message anchor bounds older pages; historical
      // counters prove each recent suffix without replaying the whole group.
      initialHistoryBlock = group.firstMessageBlock;
    } else if (group.firstMessageBlock !== 0n || group.lastMessageBlock !== 0n) {
      throw new Error('Group Chat V2 empty history has non-zero message-block anchors.');
    }
    const finalizedCount = await read('history-count', () => session.messageCountAtBlock(groupId, safeHead, readContext));
    if (oldest?.boundaryBlockHash) {
      const boundary = await read('history-fence', () => session.canonicalBlock(oldest!.fromBlock - 1n, readContext));
      if (boundary.blockHash !== oldest.boundaryBlockHash) {
        checkpoints.delete(key);
        oldestPages.delete(key);
        pendingProjectionResets.add(key);
        session.clearEpochKeys();
        checkpoint = null;
        oldest = null;
        resetConversation = true;
      }
    }
    const readOlder = older && oldest !== null && oldest.previousMessageId > 0n;
    if (!readOlder && (checkpoint?.lastMessageId ?? 0n) === finalizedCount) {
      const afterSafeHead = await read('history-fence', () => session.canonicalBlock(safeHead, readContext));
      if (beforeSafeHead.blockHash !== afterSafeHead.blockHash) {
        throw new Error('Group Chat V2 history safe head changed during synchronization.');
      }
      return deliver(Object.freeze({
        groupId,
        entries: [],
        checkpoint: Object.freeze({
          groupId,
          nextBlock: safeHead + 1n,
          lastMessageId: finalizedCount,
          boundaryBlockNumber: safeHead,
          boundaryBlockHash: afterSafeHead.blockHash
        }),
        resetConversation,
        safeHead,
        hasOlder: (oldest?.previousMessageId ?? 0n) > 0n
      }));
    }
    const recentEnd = group.lastMessageBlock < safeHead ? group.lastMessageBlock : safeHead;
    if (!older && checkpoint && recentEnd - checkpoint.nextBlock + 1n > MAX_BLOCK_SPAN) {
      // A long absence starts a new recent window; the skipped middle stays in older history.
      checkpoints.delete(key);
      oldestPages.delete(key);
      pendingProjectionResets.add(key);
      checkpoint = null;
      oldest = null;
      resetConversation = true;
    }
    let toBlock = readOlder ? oldest!.fromBlock - 1n : checkpoint
      ? (checkpoint.nextBlock + MAX_BLOCK_SPAN - 1n < safeHead ? checkpoint.nextBlock + MAX_BLOCK_SPAN - 1n : safeHead)
      : recentEnd;
    if (!readOlder && !checkpoint && initialHistoryBlock + MAX_BLOCK_SPAN - 1n >= recentEnd) {
      toBlock = initialHistoryBlock + MAX_BLOCK_SPAN - 1n < safeHead
        ? initialHistoryBlock + MAX_BLOCK_SPAN - 1n : safeHead;
    }
    const windowStart = toBlock - MAX_BLOCK_SPAN + 1n;
    const fromBlock = readOlder || !checkpoint
      ? (windowStart > initialHistoryBlock ? windowStart : initialHistoryBlock)
      : checkpoint.nextBlock;
    if (fromBlock > safeHead) {
      return deliver(Object.freeze({
        groupId,
        entries: [],
        checkpoint,
        resetConversation,
        safeHead,
        hasOlder: (oldest?.previousMessageId ?? 0n) > 0n
      }));
    }
    const beforeStart = fromBlock > initialHistoryBlock
      ? await read('history-fence', () => session.canonicalBlock(fromBlock - 1n, readContext)) : null;
    const previousMessageId = readOlder || !checkpoint
      ? beforeStart ? await read('history-count', () => session.messageCountAtBlock(groupId, fromBlock - 1n, readContext)) : 0n
      : checkpoint.lastMessageId;
    if (previousMessageId > finalizedCount) throw new Error('Group Chat V2 history baseline exceeds the finalized count.');
    const beforeBoundary = toBlock === safeHead ? beforeSafeHead : await read('history-fence', () => session.canonicalBlock(toBlock, readContext));
    const [events, membershipRanges] = await Promise.all([
      read('history-page', () => session.historyPage(groupId, fromBlock, toBlock, readContext)),
      read('history-membership', () => session.membershipRanges(groupId, ownerAddress, readContext))
    ]);
    const isEventReadable = (membershipRevision: bigint): boolean => membershipRanges.some((range) =>
      range.joinedRevision <= membershipRevision &&
      (range.leftRevision === 0n || membershipRevision < range.leftRevision)
    );
    const canonicalBlocks = new Map<bigint, Awaited<ReturnType<typeof session.canonicalBlock>>>();
    await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
      canonicalBlocks.set(blockNumber, await read('history-fence', () => session.canonicalBlock(blockNumber, readContext)));
    }));
    for (const event of events) {
      if (canonicalBlocks.get(event.blockNumber)?.blockHash !== event.blockHash) {
        throw new Error('Group Chat V2 history page contains an orphaned message log.');
      }
    }
    const timestampByBlock = new Map<number, number>();
    for (const [blockNumber, block] of canonicalBlocks) {
      const numeric = Number(blockNumber);
      if (!Number.isSafeInteger(numeric)) throw new Error('Group message block exceeds the UI range.');
      timestampByBlock.set(numeric, block.timestamp);
    }
    const normalized = await read('history-page', () => normalizeGroupChatV2HistoryEvents({
      events,
      expectedPreviousMessageId: previousMessageId,
      viewerAddress: ownerAddress,
      resolveEpochKey: ({ groupId: eventGroupId, epoch, membershipRevision }) =>
        read('history-keys', () => session.readEpochKey(eventGroupId, epoch, readContext)).then((epochKey) => {
          if (epochKey.membershipRevision !== membershipRevision) {
            throw new Error('Group epoch membership authorization changed during history sync.');
          }
          return epochKey;
        }),
      finality: 'finalized',
      timestampByBlock,
      isEventReadable: (event) => isEventReadable(event.membershipRevision),
      shouldContinue: () => current && isCurrent() && shouldContinue?.() !== false
    }));
    const complete = !readOlder && normalized.lastMessageId === finalizedCount;
    const historicalCount = readOlder ? oldest!.previousMessageId : normalized.lastMessageId >= finalizedCount || toBlock === safeHead
      ? finalizedCount : await read('history-count', () => session.messageCountAtBlock(groupId, toBlock, readContext));
    if (historicalCount !== normalized.lastMessageId) {
      throw new Error(
        `Group Chat V2 history completeness expected ${historicalCount} messages but reconstructed ${normalized.lastMessageId}.`
      );
    }
    const afterBoundary = await read('history-fence', () => session.canonicalBlock(toBlock, readContext));
    if (beforeBoundary.blockHash !== afterBoundary.blockHash) {
      throw new Error('Group Chat V2 history boundary changed during synchronization.');
    }
    const afterSafeHead = toBlock === safeHead ? afterBoundary : await read('history-fence', () => session.canonicalBlock(safeHead, readContext));
    if (beforeSafeHead.blockHash !== afterSafeHead.blockHash) {
      throw new Error('Group Chat V2 history safe head changed during synchronization.');
    }
    if (beforeStart) {
      const afterStart = await read('history-fence', () => session.canonicalBlock(fromBlock - 1n, readContext));
      if (beforeStart.blockHash !== afterStart.blockHash) {
        throw new Error('Group Chat V2 history start boundary changed during synchronization.');
      }
    }
    if (!oldest || readOlder) oldest = Object.freeze({ fromBlock, previousMessageId,
      boundaryBlockHash: beforeStart?.blockHash ?? '' });
    const nextCheckpoint = readOlder ? checkpoint : Object.freeze({
      groupId,
      nextBlock: (complete ? safeHead : toBlock) + 1n,
      lastMessageId: normalized.lastMessageId,
      boundaryBlockNumber: complete ? safeHead : toBlock,
      boundaryBlockHash: complete ? afterSafeHead.blockHash : afterBoundary.blockHash
    });
    return deliver(Object.freeze({
      groupId,
      entries: normalized.entries,
      checkpoint: nextCheckpoint,
      resetConversation,
      safeHead,
      hasOlder: oldest.previousMessageId > 0n
    }));
  };

  return Object.freeze({
    sync: (groupId: bigint, accept?: (result: GroupChatV2HistorySyncResult) => boolean, shouldContinue?: () => boolean) => {
      const pending = syncTail.then(
        () => runSync(groupId, accept, shouldContinue),
        () => runSync(groupId, accept, shouldContinue)
      );
      syncTail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    loadOlder: (groupId, accept, shouldContinue) => {
      const pending = syncTail.then(() => runSync(groupId, accept, shouldContinue, true),
        () => runSync(groupId, accept, shouldContinue, true));
      syncTail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    checkpoint: (groupId: bigint) => checkpoints.get(scopeKey(groupId)) ?? null,
    clearGroup: (groupId: bigint) => {
      checkpoints.delete(scopeKey(groupId));
      oldestPages.delete(scopeKey(groupId));
      session.clearEpochKeys();
    },
    close: () => {
      if (!current) return;
      current = false;
      checkpoints.clear();
      oldestPages.clear();
      pendingProjectionResets.clear();
      session.clearEpochKeys();
    }
  });
};
