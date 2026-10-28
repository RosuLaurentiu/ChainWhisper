import type { ChatMessage } from './appShared';
import {
  DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
  advanceDirectChatV2ReadCursorToVisibleMessage,
  buildDirectChatV2ReadCursorStorageKey,
  createDirectChatV2ReadCursor,
  mergeDirectChatV2ReadCursors,
  parseDirectChatV2ReadCursor,
  serializeDirectChatV2ReadCursor,
  type DirectChatV2ReadCursor,
  type DirectChatV2ReadCursorAnchor,
  type DirectChatV2ReadCursorScope
} from './directChatV2ReadCursor';

export const DIRECT_CHAT_V2_READ_CURSOR_CHANNEL =
  'chainwhisper-direct-chat-v2-read-cursor-channel-v1' as const;
export const DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA =
  'chainwhisper-direct-chat-v2-read-cursor-notice-v1' as const;

// localStorage and BroadcastChannel are same-origin UX synchronization hints,
// not authentication boundaries. Every cursor is revalidated against the exact
// canonical MessagePosted anchor before it is returned to unread UI state.

export type DirectChatV2ReadCursorStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export type DirectChatV2ReadCursorBroadcastPort = {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ) => void;
  removeEventListener: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ) => void;
  close: () => void;
};

export type DirectChatV2ReadCursorExclusiveRunner = <T>(
  scopeKey: string,
  operation: () => Promise<T>
) => Promise<T>;

export type DirectChatV2ReadCursorDurability = 'durable' | 'memory-only';

export type DirectChatV2ReadCursorCanonicalContext = {
  canonicalMessageCount: bigint;
  readCanonicalMessageAnchor: (
    messageId: bigint
  ) => Promise<DirectChatV2ReadCursorAnchor | null>;
};

export type DirectChatV2ReadCursorStore = {
  readonly coordination: 'cross-context-atomic' | 'best-effort';
  readonly durability: DirectChatV2ReadCursorDurability;
  loadCanonical: (input: {
    scope: DirectChatV2ReadCursorScope;
  } & DirectChatV2ReadCursorCanonicalContext) => Promise<DirectChatV2ReadCursor>;
  mergeAndPersist: (input: {
    scope: DirectChatV2ReadCursorScope;
    candidates?: readonly DirectChatV2ReadCursor[];
  } & DirectChatV2ReadCursorCanonicalContext) => Promise<DirectChatV2ReadCursor>;
  advanceVisibleAndPersist: (input: {
    scope: DirectChatV2ReadCursorScope;
    visibleMessage: ChatMessage;
  } & DirectChatV2ReadCursorCanonicalContext) => Promise<DirectChatV2ReadCursor>;
  reset: (scope: DirectChatV2ReadCursorScope) => Promise<DirectChatV2ReadCursor>;
  subscribe: (input: {
    scope: DirectChatV2ReadCursorScope;
    getCanonicalMessageCount: () => Promise<bigint>;
    readCanonicalMessageAnchor: DirectChatV2ReadCursorCanonicalContext['readCanonicalMessageAnchor'];
    onCursor: (cursor: DirectChatV2ReadCursor) => void;
    onError?: (error: unknown) => void;
  }) => () => void;
  close: () => void;
};

type DirectChatV2ReadCursorNotice = {
  schema: typeof DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA;
  sourceId: string;
  scopeKey: string;
  kind: 'cursor' | 'reset-intent' | 'reset';
  cursor?: DirectChatV2ReadCursor;
};

const createSourceId = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch {}
  return `cursor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const getDefaultStorage = (): DirectChatV2ReadCursorStorage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const getDefaultBroadcastFactory = ():
  | ((name: string) => DirectChatV2ReadCursorBroadcastPort)
  | undefined => {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  return (name) => new BroadcastChannel(name);
};

const getDefaultExclusiveRunner = (): DirectChatV2ReadCursorExclusiveRunner | undefined => {
  const lockManager = (globalThis.navigator as Navigator & {
    locks?: {
      request: <T>(
        name: string,
        options: { mode: 'exclusive' },
        operation: () => T | PromiseLike<T>
      ) => Promise<T>;
    };
  } | undefined)?.locks;
  if (!lockManager || typeof lockManager.request !== 'function') return undefined;
  const runner: DirectChatV2ReadCursorExclusiveRunner = async <T>(
    scopeKey: string,
    operation: () => Promise<T>
  ): Promise<T> => await lockManager.request<T>(
    `chainwhisper-direct-chat-v2-read-cursor-lock-v1:${scopeKey}`,
    { mode: 'exclusive' },
    operation
  );
  return runner;
};

const parseNotice = (
  value: unknown,
  expectedScopeKey: string,
  expectedScope: DirectChatV2ReadCursorScope
): DirectChatV2ReadCursorNotice | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.schema !== DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA ||
    typeof record.sourceId !== 'string' ||
    !record.sourceId ||
    record.scopeKey !== expectedScopeKey ||
    (record.kind !== 'cursor' && record.kind !== 'reset-intent' && record.kind !== 'reset')
  ) {
    return undefined;
  }
  if (record.kind === 'reset' || record.kind === 'reset-intent') {
    return {
      schema: DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA,
      sourceId: record.sourceId,
      scopeKey: expectedScopeKey,
      kind: record.kind
    };
  }
  try {
    return {
      schema: DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA,
      sourceId: record.sourceId,
      scopeKey: expectedScopeKey,
      kind: 'cursor',
      cursor: parseDirectChatV2ReadCursor(record.cursor, expectedScope)
    };
  } catch {
    return undefined;
  }
};

const parseResetNoticeScopeKey = (
  value: unknown,
  ownSourceId: string
): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const scopeKeyPrefix = `${DIRECT_CHAT_V2_READ_CURSOR_SCHEMA}:`;
  if (
    record.schema !== DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA ||
    (record.kind !== 'reset' && record.kind !== 'reset-intent') ||
    typeof record.sourceId !== 'string' ||
    !record.sourceId ||
    record.sourceId === ownSourceId ||
    typeof record.scopeKey !== 'string' ||
    !record.scopeKey.startsWith(scopeKeyPrefix)
  ) {
    return undefined;
  }
  return record.scopeKey;
};

export const createDirectChatV2ReadCursorStore = ({
  storage,
  broadcastFactory,
  runExclusive,
  sourceId = createSourceId()
}: {
  storage?: DirectChatV2ReadCursorStorage | null;
  broadcastFactory?: ((name: string) => DirectChatV2ReadCursorBroadcastPort) | null;
  runExclusive?: DirectChatV2ReadCursorExclusiveRunner | null;
  sourceId?: string;
} = {}): DirectChatV2ReadCursorStore => {
  const selectedStorage = storage === undefined ? getDefaultStorage() : storage ?? undefined;
  const selectedBroadcastFactory = broadcastFactory === undefined
    ? getDefaultBroadcastFactory()
    : broadcastFactory ?? undefined;
  const selectedExclusiveRunner = runExclusive === undefined
    ? getDefaultExclusiveRunner()
    : runExclusive ?? undefined;
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId) {
    throw new Error('Direct-chat V2 cursor source ID is required.');
  }

  const memory = new Map<string, DirectChatV2ReadCursor>();
  const resetGenerationByScope = new Map<string, number>();
  const operationTailByScope = new Map<string, Promise<void>>();
  let durableStorageAvailable = Boolean(selectedStorage);
  let broadcastPort: DirectChatV2ReadCursorBroadcastPort | undefined;
  let internalResetListener: ((event: MessageEvent<unknown>) => void) | undefined;
  let closed = false;

  const getBroadcastPort = (): DirectChatV2ReadCursorBroadcastPort | undefined => {
    if (closed || !selectedBroadcastFactory) return undefined;
    if (broadcastPort) return broadcastPort;
    try {
      broadcastPort = selectedBroadcastFactory(DIRECT_CHAT_V2_READ_CURSOR_CHANNEL);
      return broadcastPort;
    } catch {
      return undefined;
    }
  };

  const ensureBroadcastPort = (): DirectChatV2ReadCursorBroadcastPort | undefined => {
    const port = getBroadcastPort();
    if (!port || internalResetListener) return port;
    internalResetListener = (event) => {
      const scopeKey = parseResetNoticeScopeKey(event.data, normalizedSourceId);
      if (!scopeKey) return;
      resetGenerationByScope.set(scopeKey, (resetGenerationByScope.get(scopeKey) ?? 0) + 1);
    };
    port.addEventListener('message', internalResetListener);
    return port;
  };

  const loadUnchecked = (scope: DirectChatV2ReadCursorScope): DirectChatV2ReadCursor => {
    const empty = createDirectChatV2ReadCursor(scope);
    const storageKey = buildDirectChatV2ReadCursorStorageKey(scope);
    if (!selectedStorage || !durableStorageAvailable) return memory.get(storageKey) ?? empty;

    let raw: string | null;
    try {
      raw = selectedStorage.getItem(storageKey);
    } catch {
      durableStorageAvailable = false;
      return memory.get(storageKey) ?? empty;
    }
    if (raw === null) {
      memory.delete(storageKey);
      return empty;
    }
    try {
      const cursor = parseDirectChatV2ReadCursor(JSON.parse(raw), scope);
      memory.set(storageKey, cursor);
      return cursor;
    } catch {
      try {
        selectedStorage.removeItem(storageKey);
      } catch {
        durableStorageAvailable = false;
      }
      memory.delete(storageKey);
      return empty;
    }
  };

  const enqueueScopeOperation = <T>(
    scopeKey: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    const previousTail = operationTailByScope.get(scopeKey) ?? Promise.resolve();
    const pending = previousTail.catch(() => undefined).then(operation);
    const nextTail = pending.then(() => undefined, () => undefined);
    operationTailByScope.set(scopeKey, nextTail);
    void nextTail.finally(() => {
      if (operationTailByScope.get(scopeKey) === nextTail) {
        operationTailByScope.delete(scopeKey);
      }
    });
    return pending;
  };

  const runScopeOperation = <T>(
    scopeKey: string,
    operation: () => Promise<T>
  ): Promise<T> => enqueueScopeOperation(
    scopeKey,
    () => selectedExclusiveRunner
      ? selectedExclusiveRunner(scopeKey, operation)
      : operation()
  );

  const persist = (
    scope: DirectChatV2ReadCursorScope,
    cursorInput: DirectChatV2ReadCursor,
    { broadcast, reset }: { broadcast: boolean; reset: boolean }
  ): DirectChatV2ReadCursor => {
    const cursor = parseDirectChatV2ReadCursor(cursorInput, scope);
    const storageKey = buildDirectChatV2ReadCursorStorageKey(scope);
    if (cursor.lastReadMessageId === '0' && cursor.generation === 0) {
      memory.delete(storageKey);
      try {
        if (durableStorageAvailable) selectedStorage?.removeItem(storageKey);
      } catch {
        durableStorageAvailable = false;
      }
    } else {
      memory.set(storageKey, cursor);
      try {
        if (durableStorageAvailable) {
          selectedStorage?.setItem(storageKey, serializeDirectChatV2ReadCursor(cursor));
        }
      } catch {
        durableStorageAvailable = false;
      }
    }

    if (broadcast) {
      try {
        ensureBroadcastPort()?.postMessage({
          schema: DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA,
          sourceId: normalizedSourceId,
          scopeKey: storageKey,
          kind: reset ? 'reset' : 'cursor',
          ...(reset ? {} : { cursor })
        } satisfies DirectChatV2ReadCursorNotice);
      } catch {}
    }
    return cursor;
  };

  const mergeAndPersistInternal = async ({
    scope,
    candidates = [],
    canonicalMessageCount,
    readCanonicalMessageAnchor,
    broadcast
  }: {
    scope: DirectChatV2ReadCursorScope;
    candidates?: readonly DirectChatV2ReadCursor[];
    canonicalMessageCount: bigint;
    readCanonicalMessageAnchor: DirectChatV2ReadCursorCanonicalContext['readCanonicalMessageAnchor'];
    broadcast: boolean;
  }): Promise<DirectChatV2ReadCursor> => {
    if (closed) throw new Error('Direct-chat V2 cursor store is closed.');
    ensureBroadcastPort();
    const scopeKey = buildDirectChatV2ReadCursorStorageKey(scope);
    const resetGeneration = resetGenerationByScope.get(scopeKey) ?? 0;
    const capturedScope = Object.freeze({ ...scope });
    const capturedCandidates = candidates.map((candidate) =>
      parseDirectChatV2ReadCursor(candidate, capturedScope)
    );

    return runScopeOperation(scopeKey, async () => {
      if (closed) throw new Error('Direct-chat V2 cursor store is closed.');
      const initialCursor = loadUnchecked(capturedScope);
      const loadResetBoundary = (): DirectChatV2ReadCursor => {
        const durableCursor = loadUnchecked(capturedScope);
        const resetDelta = Math.max(
          0,
          (resetGenerationByScope.get(scopeKey) ?? 0) - resetGeneration
        );
        return createDirectChatV2ReadCursor(
          capturedScope,
          Math.max(durableCursor.generation, initialCursor.generation + resetDelta)
        );
      };
      if ((resetGenerationByScope.get(scopeKey) ?? 0) !== resetGeneration) {
        return loadResetBoundary();
      }
      const merged = await mergeDirectChatV2ReadCursors({
        scope: capturedScope,
        cursors: [initialCursor, ...capturedCandidates],
        canonicalMessageCount,
        readCanonicalMessageAnchor
      });
      if (closed) throw new Error('Direct-chat V2 cursor store closed while a merge was running.');
      if ((resetGenerationByScope.get(scopeKey) ?? 0) !== resetGeneration) {
        return loadResetBoundary();
      }
      return persist(capturedScope, merged, { broadcast, reset: false });
    });
  };

  const store: DirectChatV2ReadCursorStore = {
    coordination: selectedExclusiveRunner ? 'cross-context-atomic' : 'best-effort',
    // Storage failures permanently degrade this store instance to memory-only.
    // Keep this separate from coordination: a Web Lock can serialize writes but
    // cannot make a failed localStorage write survive a page reload.
    get durability() {
      return durableStorageAvailable ? 'durable' : 'memory-only';
    },
    loadCanonical: (input) => mergeAndPersistInternal({ ...input, broadcast: false }),
    mergeAndPersist: (input) => mergeAndPersistInternal({ ...input, broadcast: true }),
    advanceVisibleAndPersist: async ({
      scope,
      visibleMessage,
      canonicalMessageCount,
      readCanonicalMessageAnchor
    }) => {
      const current = loadUnchecked(scope);
      const candidate = advanceDirectChatV2ReadCursorToVisibleMessage({
        cursor: current,
        scope,
        visibleMessage
      });
      return mergeAndPersistInternal({
        scope,
        candidates: [candidate],
        canonicalMessageCount,
        readCanonicalMessageAnchor,
        broadcast: true
      });
    },
    reset: async (scope) => {
      if (closed) throw new Error('Direct-chat V2 cursor store is closed.');
      ensureBroadcastPort();
      const scopeKey = buildDirectChatV2ReadCursorStorageKey(scope);
      resetGenerationByScope.set(scopeKey, (resetGenerationByScope.get(scopeKey) ?? 0) + 1);
      // Announce reset intent before waiting for another tab's Web Lock so its
      // already-running merge is invalidated immediately. The reset notice is
      // only a revalidation hint; the completed reset is broadcast again by
      // persist() after durable state is cleared.
      try {
        ensureBroadcastPort()?.postMessage({
          schema: DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA,
          sourceId: normalizedSourceId,
          scopeKey,
          kind: 'reset-intent'
        } satisfies DirectChatV2ReadCursorNotice);
      } catch {}
      return runScopeOperation(scopeKey, async () => {
        if (closed) throw new Error('Direct-chat V2 cursor store is closed.');
        const current = loadUnchecked(scope);
        return persist(scope, createDirectChatV2ReadCursor(scope, current.generation + 1), {
          broadcast: true,
          reset: true
        });
      });
    },
    subscribe: ({
      scope,
      getCanonicalMessageCount,
      readCanonicalMessageAnchor,
      onCursor,
      onError
    }) => {
      if (closed) throw new Error('Direct-chat V2 cursor store is closed.');
      const scopeKey = buildDirectChatV2ReadCursorStorageKey(scope);
      const port = ensureBroadcastPort();
      if (!port) return () => {};
      let active = true;
      const handleMessage = (event: MessageEvent<unknown>) => {
        const notice = parseNotice(event.data, scopeKey, scope);
        if (!active || !notice || notice.sourceId === normalizedSourceId) return;
        if (notice.kind === 'reset-intent') return;
        if (notice.kind === 'reset') {
          void (async () => {
            try {
              const canonicalMessageCount = await getCanonicalMessageCount();
              if (!active) return;
              const cursor = await mergeAndPersistInternal({
                scope,
                canonicalMessageCount,
                readCanonicalMessageAnchor,
                broadcast: false
              });
              if (active) onCursor(cursor);
            } catch (error) {
              if (active) onError?.(error);
            }
          })();
          return;
        }
        void (async () => {
          try {
            const canonicalMessageCount = await getCanonicalMessageCount();
            if (!active) return;
            const merged = await mergeAndPersistInternal({
              scope,
              candidates: notice.cursor ? [notice.cursor] : [],
              canonicalMessageCount,
              readCanonicalMessageAnchor,
              broadcast: false
            });
            if (active) onCursor(merged);
          } catch (error) {
            if (active) onError?.(error);
          }
        })();
      };
      port.addEventListener('message', handleMessage);
      return () => {
        active = false;
        port.removeEventListener('message', handleMessage);
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      try {
        if (broadcastPort && internalResetListener) {
          broadcastPort.removeEventListener('message', internalResetListener);
        }
        broadcastPort?.close();
      } catch {}
      broadcastPort = undefined;
      internalResetListener = undefined;
      memory.clear();
      resetGenerationByScope.clear();
      operationTailByScope.clear();
    }
  };

  return Object.freeze(store);
};
