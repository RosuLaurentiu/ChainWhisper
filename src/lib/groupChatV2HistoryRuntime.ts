import type { GroupMessageEntry } from './appShared/core';
import { normalizeGroupChatV2HistoryEvents } from './groupChatV2History';
import {
  assertGroupChatV2SessionController,
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
}>;

export type GroupChatV2HistoryRuntime = Readonly<{
  sync: (groupId: bigint, accept?: (result: GroupChatV2HistorySyncResult) => boolean) => Promise<GroupChatV2HistorySyncResult>;
  checkpoint: (groupId: bigint) => GroupChatV2HistoryCheckpoint | null;
  clearGroup: (groupId: bigint) => void;
  close: () => void;
}>;

const MAX_BLOCK_SPAN = 2_048n;

export const createGroupChatV2HistoryRuntime = ({
  confirmationDepth,
  isCurrent,
  ownerAddress,
  session
}: {
  confirmationDepth: bigint;
  isCurrent: () => boolean;
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
  const pendingProjectionResets = new Set<string>();
  const scopeKey = (groupId: bigint): string => [
    session.ownerAddress.toLowerCase(),
    session.manifest.chainId.toString(),
    session.manifest.contractAddress.toLowerCase(),
    groupId.toString()
  ].join(':');
  const assertCurrent = (): void => {
    if (!current || !isCurrent()) throw new Error('Group Chat V2 history scope is no longer current.');
  };

  const runSync = async (groupId: bigint, accept?: (result: GroupChatV2HistorySyncResult) => boolean): Promise<GroupChatV2HistorySyncResult> => {
    assertCurrent();
    if (groupId <= 0n) throw new Error('Group Chat V2 history requires a non-zero group ID.');
    const key = scopeKey(groupId);
    const deliver = (result: GroupChatV2HistorySyncResult): GroupChatV2HistorySyncResult => {
      assertCurrent();
      // A view change must not consume a page or reset that the App did not apply.
      if (!accept || accept(result) === true) {
        assertCurrent();
        if (result.checkpoint) checkpoints.set(key, result.checkpoint);
        pendingProjectionResets.delete(key);
      }
      return result;
    };
    const group = await session.inspect(groupId);
    const latestBlock = await session.latestBlock();
    assertCurrent();
    const safeHead = latestBlock > confirmationDepth ? latestBlock - confirmationDepth : 0n;
    let checkpoint = checkpoints.get(key) ?? null;
    let resetConversation = pendingProjectionResets.has(key);
    if (checkpoint) {
      if (checkpoint.boundaryBlockNumber > safeHead) {
        resetConversation = true;
      } else {
        const canonicalBoundary = await session.canonicalBlock(checkpoint.boundaryBlockNumber);
        assertCurrent();
        resetConversation = canonicalBoundary.blockHash !== checkpoint.boundaryBlockHash;
      }
      if (resetConversation) {
        checkpoints.delete(key);
        pendingProjectionResets.add(key);
        session.clearEpochKeys();
        checkpoint = null;
      }
    }
    if (safeHead < group.createdBlock) {
      return deliver(Object.freeze({ groupId, entries: [], checkpoint, resetConversation, safeHead }));
    }

    let initialHistoryBlock = group.createdBlock;
    if (group.messageCount > 0n) {
      if (
        group.firstMessageBlock < group.createdBlock ||
        group.firstMessageBlock > group.lastMessageBlock
      ) {
        throw new Error('Group Chat V2 message-block anchors are inconsistent.');
      }
      // firstMessageBlock is maintained by the verified Group V2 contract and
      // is immutable after the first post. Starting there avoids replaying
      // thousands of provably empty blocks after a reload while the historical
      // messageCount check below still proves that no message was omitted.
      initialHistoryBlock = group.firstMessageBlock;
    } else if (group.firstMessageBlock !== 0n || group.lastMessageBlock !== 0n) {
      throw new Error('Group Chat V2 empty history has non-zero message-block anchors.');
    }
    const fromBlock = checkpoint?.nextBlock ?? initialHistoryBlock;
    if (fromBlock > safeHead) {
      return deliver(Object.freeze({
        groupId,
        entries: [],
        checkpoint,
        resetConversation,
        safeHead
      }));
    }
    const toBlock = fromBlock + MAX_BLOCK_SPAN - 1n < safeHead
      ? fromBlock + MAX_BLOCK_SPAN - 1n
      : safeHead;
    const beforeBoundary = await session.canonicalBlock(toBlock);
    const [events, membershipRanges] = await Promise.all([
      session.historyPage(groupId, fromBlock, toBlock),
      session.membershipRanges(groupId, ownerAddress)
    ]);
    const isEventReadable = (membershipRevision: bigint): boolean => membershipRanges.some((range) =>
      range.joinedRevision <= membershipRevision &&
      (range.leftRevision === 0n || membershipRevision < range.leftRevision)
    );
    const canonicalBlocks = new Map<bigint, Awaited<ReturnType<typeof session.canonicalBlock>>>();
    await Promise.all([...new Set(events.map((event) => event.blockNumber))].map(async (blockNumber) => {
      canonicalBlocks.set(blockNumber, await session.canonicalBlock(blockNumber));
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
    const normalized = await normalizeGroupChatV2HistoryEvents({
      events,
      expectedPreviousMessageId: checkpoint?.lastMessageId ?? 0n,
      viewerAddress: ownerAddress,
      resolveEpochKey: ({ groupId: eventGroupId, epoch, membershipRevision }) =>
        session.readEpochKey(eventGroupId, epoch).then((epochKey) => {
          if (epochKey.membershipRevision !== membershipRevision) {
            throw new Error('Group epoch membership authorization changed during history sync.');
          }
          return epochKey;
        }),
      finality: 'finalized',
      timestampByBlock,
      isEventReadable: (event) => isEventReadable(event.membershipRevision),
      shouldContinue: () => current && isCurrent()
    });
    const historicalCount = await session.messageCountAtBlock(groupId, toBlock);
    if (historicalCount !== normalized.lastMessageId) {
      throw new Error(
        `Group Chat V2 history completeness expected ${historicalCount} messages but reconstructed ${normalized.lastMessageId}.`
      );
    }
    const afterBoundary = await session.canonicalBlock(toBlock);
    assertCurrent();
    if (beforeBoundary.blockHash !== afterBoundary.blockHash) {
      throw new Error('Group Chat V2 history boundary changed during synchronization.');
    }
    const nextCheckpoint = Object.freeze({
      groupId,
      nextBlock: toBlock + 1n,
      lastMessageId: normalized.lastMessageId,
      boundaryBlockNumber: toBlock,
      boundaryBlockHash: afterBoundary.blockHash
    });
    return deliver(Object.freeze({
      groupId,
      entries: normalized.entries,
      checkpoint: nextCheckpoint,
      resetConversation,
      safeHead
    }));
  };

  return Object.freeze({
    sync: (groupId: bigint, accept?: (result: GroupChatV2HistorySyncResult) => boolean) => {
      const pending = syncTail.then(
        () => runSync(groupId, accept),
        () => runSync(groupId, accept)
      );
      syncTail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    checkpoint: (groupId: bigint) => checkpoints.get(scopeKey(groupId)) ?? null,
    clearGroup: (groupId: bigint) => {
      checkpoints.delete(scopeKey(groupId));
      session.clearEpochKeys();
    },
    close: () => {
      if (!current) return;
      current = false;
      checkpoints.clear();
      pendingProjectionResets.clear();
      session.clearEpochKeys();
    }
  });
};
