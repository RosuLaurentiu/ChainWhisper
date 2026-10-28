import type { ChatMessage } from './appShared';
import type { DirectChatV2HistoryScope } from './directChatV2History';
import {
  countDirectChatV2UnreadMessages,
  type DirectChatV2ReadCursorAnchor,
  type DirectChatV2ReadCursorScope
} from './directChatV2ReadCursor';
import {
  createDirectChatV2ReadCursorStore,
  type DirectChatV2ReadCursorCanonicalContext,
  type DirectChatV2ReadCursorStore
} from './directChatV2ReadCursorStore';
import {
  applyDirectChatV2SyncMutation,
  syncDirectChatV2HistoryPage,
  type DirectChatV2SyncMutation
} from './directChatV2SyncCoordinator';
import {
  buildDirectChatV2HistoryMemoryScopeKey,
  createDirectChatV2HistoryMemoryState,
  getDirectChatV2HistoryMemoryRevision,
  reduceDirectChatV2HistoryMemorySync,
  selectDirectChatV2MemoryBackedCheckpoint,
  type DirectChatV2HistoryMemoryState
} from './directChatV2HistoryMemory';
import {
  assertDirectChatV2SessionController,
  type DirectChatV2SessionController
} from './directChatV2Session';
import {
  createDirectChatV2IncomingDiscovery,
  type DirectChatV2IncomingDiscoveryResult,
  type DirectChatV2IncomingDiscoveryStorage
} from './directChatV2IncomingDiscovery';

const MAX_PAGES_PER_BATCH = 4;

export type DirectChatV2HistoryBatch = Readonly<{
  appliedEntries: number;
  unavailableEntries: number;
  hasMore: boolean;
  reorged: boolean;
  apply: (messagesByContact: Record<string, ChatMessage[]>) => Record<string, ChatMessage[]>;
}>;

export type DirectChatV2HistoryRuntime = Readonly<{
  sync: (
    peer: string,
    messagesByContact: Record<string, ChatMessage[]>,
    shouldContinue?: () => boolean
  ) => Promise<DirectChatV2HistoryBatch>;
  watch: (
    peer: string,
    onHint: () => void | Promise<void>
  ) => Promise<(() => Promise<void>) | null>;
  watchIncoming: (
    onHint: (peer: string) => void | Promise<void>
  ) => Promise<() => Promise<void>>;
  discoverIncoming: (
    shouldContinue?: () => boolean
  ) => Promise<DirectChatV2IncomingDiscoveryResult>;
  getUnreadCount: (
    peer: string,
    messagesByContact: Record<string, ChatMessage[]>
  ) => Promise<number>;
  markVisible: (
    peer: string,
    visibleMessage: ChatMessage,
    messagesByContact: Record<string, ChatMessage[]>
  ) => Promise<number>;
  watchUnread: (
    peer: string,
    getMessagesByContact: () => Record<string, ChatMessage[]>,
    onUnreadCount: (unreadCount: number) => void | Promise<void>,
    onError?: (error: unknown) => void
  ) => Promise<(() => Promise<void>) | null>;
  close: () => void;
}>;

const applyMutations = (
  messagesByContact: Record<string, ChatMessage[]>,
  mutations: readonly DirectChatV2SyncMutation[],
  replayScope?: DirectChatV2HistoryScope
): Record<string, ChatMessage[]> => mutations.reduce(
  (current, mutation) => applyDirectChatV2SyncMutation(current, mutation),
  replayScope
    ? clearFinalizedProjectionForReplay(messagesByContact, replayScope)
    : messagesByContact
);

const clearFinalizedProjectionForReplay = (
  previous: Record<string, ChatMessage[]>,
  scope: DirectChatV2HistoryScope
): Record<string, ChatMessage[]> => {
  let changed = false;
  const next: Record<string, ChatMessage[]> = {};
  for (const [contact, messages] of Object.entries(previous)) {
    const retained = messages.filter((message) => {
      const identity = message.directV2;
      const remove = Boolean(
        identity?.protocol === 'direct-v2' &&
        identity.finality === 'finalized' &&
        identity.chainId === scope.chainId.toString() &&
        identity.contractAddress.toLowerCase() === scope.contractAddress.toLowerCase() &&
        identity.conversationId.toLowerCase() === scope.conversationId.toLowerCase()
      );
      if (remove) changed = true;
      return !remove;
    });
    if (retained.length > 0 || messages.length === 0) next[contact] = retained;
  }
  return changed ? next : previous;
};

export const createDirectChatV2HistoryRuntime = ({
  confirmationDepth,
  isCurrent,
  ownerAddress,
  session,
  cursorStore,
  incomingDiscoveryStorage
}: {
  confirmationDepth: bigint;
  isCurrent: () => boolean;
  ownerAddress: string;
  session: DirectChatV2SessionController;
  cursorStore?: DirectChatV2ReadCursorStore;
  incomingDiscoveryStorage?: DirectChatV2IncomingDiscoveryStorage | null;
}): DirectChatV2HistoryRuntime => {
  assertDirectChatV2SessionController(session);
  if (confirmationDepth <= 0n || confirmationDepth > 4_096n) {
    throw new Error('Direct-chat V2 history finality depth is invalid.');
  }
  if (typeof isCurrent !== 'function' || !isCurrent()) {
    throw new Error('Direct-chat V2 history requires a current owner session.');
  }
  const selectedCursorStore = cursorStore ?? createDirectChatV2ReadCursorStore();

  let closed = false;
  let syncTail: Promise<void> = Promise.resolve();
  let memoryState: DirectChatV2HistoryMemoryState = createDirectChatV2HistoryMemoryState();
  const pendingProjectionResets = new Map<string, object>();
  let incomingDiscovery: ReturnType<typeof createDirectChatV2IncomingDiscovery> | null = null;
  const activeWatchers = new Set<() => Promise<void>>();
  const current = (external?: () => boolean): boolean =>
    !closed && isCurrent() && (external ? external() : true);
  const assertCurrent = (external?: () => boolean): void => {
    if (!current(external)) {
      throw new Error('Direct-chat V2 history scope changed while synchronizing.');
    }
  };

  const readCursorContext = async (
    access: NonNullable<Awaited<ReturnType<DirectChatV2SessionController['history']>>>
  ): Promise<{
    context: DirectChatV2ReadCursorCanonicalContext;
    scope: DirectChatV2ReadCursorScope;
  }> => {
    const cursorScope = {
      chainId: access.scope.chainId,
      contractAddress: access.scope.contractAddress,
      walletAddress: ownerAddress,
      conversationId: access.scope.conversationId
    } satisfies DirectChatV2ReadCursorScope;
    const latestBlock = await access.dependencies.getLatestBlockNumber(access.scope.chainId);
    assertCurrent();
    const safeHead = latestBlock >= confirmationDepth ? latestBlock - confirmationDepth : 0n;
    const canonicalMessageCount = safeHead < access.scope.conversationStartBlock
      ? 0n
      : await access.dependencies.readConversationMessageCountAtBlock({
          scope: access.scope,
          blockNumber: safeHead
        });
    assertCurrent();
    const readCanonicalMessageAnchor = async (
      messageId: bigint
    ): Promise<DirectChatV2ReadCursorAnchor | null> => {
      let projected: ChatMessage['directV2'] | undefined;
      for (const messages of Object.values(memoryState.messagesByContact)) {
        projected = messages.find((message) => (
          message.directV2?.protocol === 'direct-v2' &&
          message.directV2.finality === 'finalized' &&
          message.directV2.chainId === access.scope.chainId.toString() &&
          message.directV2.contractAddress.toLowerCase() === access.scope.contractAddress.toLowerCase() &&
          message.directV2.conversationId.toLowerCase() === access.scope.conversationId.toLowerCase() &&
          message.directV2.messageId === messageId.toString()
        ))?.directV2;
        if (projected) break;
      }
      if (!projected) return null;
      const blockNumber = BigInt(projected.blockNumber);
      const [block, events] = await Promise.all([
        access.dependencies.readCanonicalBlock(access.scope.chainId, blockNumber),
        access.dependencies.readMessagePage({
          scope: access.scope,
          fromBlock: blockNumber,
          toBlock: blockNumber
        })
      ]);
      assertCurrent();
      const event = events.find((candidate) => candidate.messageId === messageId);
      if (
        !block ||
        !event ||
        event.blockNumber !== blockNumber ||
        event.blockHash.toLowerCase() !== block.hash.toLowerCase() ||
        projected.blockHash.toLowerCase() !== block.hash.toLowerCase()
      ) {
        return null;
      }
      return {
        messageId,
        blockNumber,
        blockHash: block.hash
      };
    };
    return {
      scope: cursorScope,
      context: { canonicalMessageCount, readCanonicalMessageAnchor }
    };
  };

  const conversationMessages = (
    messagesByContact: Record<string, ChatMessage[]>,
    scope: DirectChatV2ReadCursorScope
  ): ChatMessage[] => {
    const matches: ChatMessage[] = [];
    for (const messages of Object.values(messagesByContact)) {
      for (const message of messages) {
        const identity = message.directV2;
        if (
          identity?.protocol === 'direct-v2' &&
          identity.chainId === scope.chainId.toString() &&
          identity.contractAddress.toLowerCase() === scope.contractAddress.toLowerCase() &&
          identity.conversationId.toLowerCase() === scope.conversationId.toLowerCase()
        ) {
          matches.push(message);
        }
      }
    }
    return matches;
  };

  const runSync = async (
    peer: string,
    messagesByContact: Record<string, ChatMessage[]>,
    shouldContinue?: () => boolean
  ): Promise<DirectChatV2HistoryBatch> => {
    assertCurrent(shouldContinue);
        const access = await session.history(peer);
        assertCurrent(shouldContinue);
        if (!access) {
          return Object.freeze({
            appliedEntries: 0,
            unavailableEntries: 0,
            hasMore: false,
            reorged: false,
            apply: (currentMessages: Record<string, ChatMessage[]>) => currentMessages
          });
        }
        const scopeKey = buildDirectChatV2HistoryMemoryScopeKey({
          scope: access.scope,
          walletAddress: ownerAddress
        });
        let workingState: DirectChatV2HistoryMemoryState = {
          ...memoryState,
          messagesByContact
        };
        let checkpoint = pendingProjectionResets.has(scopeKey) ? undefined : selectDirectChatV2MemoryBackedCheckpoint({
          checkpoint: workingState.checkpointsByScope[scopeKey],
          messagesByContact,
          scope: access.scope,
          walletAddress: ownerAddress
        });
        const mutations: DirectChatV2SyncMutation[] = [];
        let replayScope: DirectChatV2HistoryScope | undefined;
        if (!checkpoint) {
          const checkpointsByScope = { ...workingState.checkpointsByScope };
          delete checkpointsByScope[scopeKey];
          workingState = { ...workingState, checkpointsByScope };
          const replayBase = clearFinalizedProjectionForReplay(
            workingState.messagesByContact,
            access.scope
          );
          if (replayBase !== workingState.messagesByContact || pendingProjectionResets.has(scopeKey)) {
            workingState = { ...workingState, messagesByContact: replayBase };
            replayScope = access.scope;
          }
        }
        let hasMore = false;
        let reorged = false;
        let appliedEntries = 0;
        let unavailableEntries = 0;

        for (let page = 0; page < MAX_PAGES_PER_BATCH; page += 1) {
          const expectedRevision = getDirectChatV2HistoryMemoryRevision({
            state: workingState,
            scope: access.scope,
            walletAddress: ownerAddress
          });
          const result = await syncDirectChatV2HistoryPage({
            config: { enabled: true, confirmationDepth },
            scope: access.scope,
            viewerAddress: ownerAddress,
            accountRole: 'owner',
            previousMessages: workingState.messagesByContact,
            checkpoint,
            dependencies: access.dependencies,
            shouldContinue: () => current(shouldContinue)
          });
          assertCurrent(shouldContinue);
          workingState = reduceDirectChatV2HistoryMemorySync({
            previous: workingState,
            result,
            scope: access.scope,
            walletAddress: ownerAddress,
            expectedRevision
          });
          if (result.mutation) mutations.push(result.mutation);
          checkpoint = workingState.checkpointsByScope[scopeKey];
          hasMore = result.hasMore;
          reorged = reorged || result.reorged;
          appliedEntries += result.appliedEntries;
          unavailableEntries += result.unavailableEntries;
          if (!hasMore) break;
        }

        assertCurrent(shouldContinue);
        if (reorged) {
          await selectedCursorStore.reset({
            chainId: access.scope.chainId,
            contractAddress: access.scope.contractAddress,
            walletAddress: ownerAddress,
            conversationId: access.scope.conversationId
          });
          assertCurrent(shouldContinue);
        }
        memoryState = workingState;
        // A returned reset is not consumed until the App applies its projection.
        const resetToken = replayScope || reorged ? Object.freeze({}) : undefined;
        if (resetToken) pendingProjectionResets.set(scopeKey, resetToken);
        const frozenMutations = Object.freeze([...mutations]);
        return Object.freeze({
          appliedEntries,
          unavailableEntries,
          hasMore,
          reorged,
          apply: (currentMessages: Record<string, ChatMessage[]>) => {
            assertCurrent();
            const applied = applyMutations(currentMessages, frozenMutations, replayScope);
            if (resetToken && pendingProjectionResets.get(scopeKey) === resetToken) pendingProjectionResets.delete(scopeKey);
            return applied;
          }
        });
  };

  const runtime: DirectChatV2HistoryRuntime = Object.freeze({
    sync: (peer, messagesByContact, shouldContinue) => {
      const pending = syncTail.then(
        () => runSync(peer, messagesByContact, shouldContinue),
        () => runSync(peer, messagesByContact, shouldContinue)
      );
      syncTail = pending.then(() => undefined, () => undefined);
      return pending;
    },
    watch: async (peer, onHint) => {
      assertCurrent();
      const stop = await session.watch(peer, async () => {
        if (!current()) return;
        await onHint();
      });
      if (!current()) {
        await stop?.().catch(() => undefined);
      }
      assertCurrent();
      if (!stop) return null;
      let watching = true;
      const closeWatcher = async () => {
        if (!watching) return;
        watching = false;
        activeWatchers.delete(closeWatcher);
        await stop();
      };
      activeWatchers.add(closeWatcher);
      return closeWatcher;
    },
    watchIncoming: async (onHint) => {
      assertCurrent();
      const stop = await session.watchIncoming(async (peer) => {
        if (!current()) return;
        await onHint(peer);
      });
      if (!current()) {
        await stop().catch(() => undefined);
      }
      assertCurrent();
      let watching = true;
      const closeWatcher = async () => {
        if (!watching) return;
        watching = false;
        activeWatchers.delete(closeWatcher);
        await stop();
      };
      activeWatchers.add(closeWatcher);
      return closeWatcher;
    },
    discoverIncoming: async (shouldContinue) => {
      assertCurrent(shouldContinue);
      if (!incomingDiscovery) {
        const access = await session.incomingHistory();
        assertCurrent(shouldContinue);
        incomingDiscovery = createDirectChatV2IncomingDiscovery({
          confirmationDepth,
          dependencies: access.dependencies,
          isCurrent,
          scope: access.scope,
          storage: incomingDiscoveryStorage
        });
      }
      return incomingDiscovery.scan(shouldContinue);
    },
    getUnreadCount: async (peer, messagesByContact) => {
      assertCurrent();
      const access = await session.history(peer);
      assertCurrent();
      if (!access) return 0;
      memoryState = { ...memoryState, messagesByContact };
      const { context, scope } = await readCursorContext(access);
      const cursor = await selectedCursorStore.loadCanonical({ scope, ...context });
      assertCurrent();
      return countDirectChatV2UnreadMessages({
        cursor,
        scope,
        messages: conversationMessages(messagesByContact, scope)
      });
    },
    markVisible: async (peer, visibleMessage, messagesByContact) => {
      assertCurrent();
      const access = await session.history(peer);
      assertCurrent();
      if (!access) return 0;
      memoryState = { ...memoryState, messagesByContact };
      const { context, scope } = await readCursorContext(access);
      const cursor = await selectedCursorStore.advanceVisibleAndPersist({
        scope,
        visibleMessage,
        ...context
      });
      assertCurrent();
      return countDirectChatV2UnreadMessages({
        cursor,
        scope,
        messages: conversationMessages(messagesByContact, scope)
      });
    },
    watchUnread: async (peer, getMessagesByContact, onUnreadCount, onError) => {
      assertCurrent();
      const access = await session.history(peer);
      assertCurrent();
      if (!access) return null;
      const { scope } = await readCursorContext(access);
      const stop = selectedCursorStore.subscribe({
        scope,
        getCanonicalMessageCount: async () => (
          await readCursorContext(access)
        ).context.canonicalMessageCount,
        readCanonicalMessageAnchor: async (messageId) => (
          await readCursorContext(access)
        ).context.readCanonicalMessageAnchor(messageId),
        onCursor: (cursor) => {
          if (!current()) return;
          const messagesByContact = getMessagesByContact();
          memoryState = { ...memoryState, messagesByContact };
          const unreadCount = countDirectChatV2UnreadMessages({
            cursor,
            scope,
            messages: conversationMessages(messagesByContact, scope)
          });
          void Promise.resolve(onUnreadCount(unreadCount)).catch((error) => onError?.(error));
        },
        onError
      });
      let watching = true;
      const closeWatcher = async () => {
        if (!watching) return;
        watching = false;
        activeWatchers.delete(closeWatcher);
        stop();
      };
      activeWatchers.add(closeWatcher);
      return closeWatcher;
    },
    close: () => {
      if (closed) return;
      closed = true;
      for (const stop of activeWatchers) void stop().catch(() => undefined);
      activeWatchers.clear();
      selectedCursorStore.close();
      incomingDiscovery?.close();
      incomingDiscovery = null;
      memoryState = createDirectChatV2HistoryMemoryState();
      pendingProjectionResets.clear();
    }
  });
  return runtime;
};
