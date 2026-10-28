import type { ChatMessage } from './appShared';
import {
  GROUP_CHAT_V2_READ_CURSOR_SCHEMA,
  advanceGroupChatV2ReadCursor,
  buildGroupChatV2ReadCursorKey,
  createGroupChatV2ReadCursor,
  mergeGroupChatV2ReadCursors,
  parseGroupChatV2ReadCursor,
  type GroupChatV2ReadCursor,
  type GroupChatV2ReadCursorAnchor,
  type GroupChatV2ReadCursorScope
} from './groupChatV2ReadCursor';

const CHANNEL = 'chainwhisper-group-chat-v2-read-cursor-channel-v1';
const NOTICE_SCHEMA = 'chainwhisper-group-chat-v2-read-cursor-notice-v1';

type CanonicalContext = Readonly<{
  getCanonicalMessageCount: () => Promise<bigint>;
  readCanonicalAnchor: (
    messageId: bigint,
    blockNumber: bigint
  ) => Promise<GroupChatV2ReadCursorAnchor | null>;
}>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type BroadcastLike = {
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void;
  removeEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void;
  close: () => void;
};
type ExclusiveRunner = <T>(key: string, operation: () => Promise<T>) => Promise<T>;

export type GroupChatV2ReadCursorStore = Readonly<{
  coordination: 'cross-context-atomic' | 'best-effort';
  loadCanonical: (scope: GroupChatV2ReadCursorScope, context: CanonicalContext) => Promise<GroupChatV2ReadCursor>;
  mergeCanonical: (
    scope: GroupChatV2ReadCursorScope,
    candidates: readonly GroupChatV2ReadCursor[],
    context: CanonicalContext
  ) => Promise<GroupChatV2ReadCursor>;
  advanceVisible: (
    scope: GroupChatV2ReadCursorScope,
    visibleMessage: Pick<ChatMessage, 'direction' | 'groupV2'>,
    context: CanonicalContext
  ) => Promise<GroupChatV2ReadCursor>;
  reset: (scope: GroupChatV2ReadCursorScope) => Promise<GroupChatV2ReadCursor>;
  subscribe: (
    scope: GroupChatV2ReadCursorScope,
    context: CanonicalContext,
    onCursor: (cursor: GroupChatV2ReadCursor) => void,
    onError?: (error: unknown) => void
  ) => () => void;
  close: () => void;
}>;

const defaultExclusiveRunner = (): ExclusiveRunner | undefined => {
  const locks = (globalThis.navigator as Navigator & {
    locks?: {
      request: <T>(
        name: string,
        options: { mode: 'exclusive' },
        callback: () => T | PromiseLike<T>
      ) => Promise<T>;
    };
  } | undefined)?.locks;
  if (!locks) return undefined;
  return <T>(key: string, operation: () => Promise<T>) => locks.request<T>(
    `chainwhisper-group-chat-v2-cursor:${key}`,
    { mode: 'exclusive' },
    async () => await operation()
  );
};

const sourceId = (): string => typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `group-cursor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export const createGroupChatV2ReadCursorStore = ({
  storage = typeof window === 'undefined' ? undefined : window.localStorage,
  broadcastFactory = typeof BroadcastChannel === 'undefined'
    ? undefined
    : (name: string) => new BroadcastChannel(name),
  runExclusive = defaultExclusiveRunner(),
  instanceId = sourceId()
}: {
  storage?: StorageLike;
  broadcastFactory?: (name: string) => BroadcastLike;
  runExclusive?: ExclusiveRunner;
  instanceId?: string;
} = {}): GroupChatV2ReadCursorStore => {
  const memory = new Map<string, GroupChatV2ReadCursor>();
  const tails = new Map<string, Promise<void>>();
  let port: BroadcastLike | undefined;
  let closed = false;

  const exclusive: ExclusiveRunner = runExclusive ?? (async <T>(key: string, operation: () => Promise<T>) => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => next);
    tails.set(key, tail);
    await previous;
    try { return await operation(); } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  });

  const requireOpen = (): void => {
    if (closed) throw new Error('Group Chat V2 read-cursor store is closed.');
  };
  const channel = (): BroadcastLike | undefined => {
    if (!broadcastFactory || closed) return undefined;
    try { return port ??= broadcastFactory(CHANNEL); } catch { return undefined; }
  };
  const readCandidates = (
    selectedScope: GroupChatV2ReadCursorScope,
    extra: readonly GroupChatV2ReadCursor[] = []
  ): GroupChatV2ReadCursor[] => {
    const key = buildGroupChatV2ReadCursorKey(selectedScope);
    const candidates = [...extra];
    const cached = memory.get(key);
    if (cached) candidates.push(cached);
    try {
      const raw = storage?.getItem(key);
      if (raw) candidates.push(parseGroupChatV2ReadCursor(JSON.parse(raw), selectedScope));
    } catch {}
    return candidates;
  };
  const persist = (selectedScope: GroupChatV2ReadCursorScope, cursor: GroupChatV2ReadCursor): void => {
    const key = buildGroupChatV2ReadCursorKey(selectedScope);
    memory.set(key, cursor);
    try { storage?.setItem(key, JSON.stringify(cursor)); } catch {}
  };
  const loadCanonical = async (
    selectedScope: GroupChatV2ReadCursorScope,
    context: CanonicalContext,
    extra: readonly GroupChatV2ReadCursor[] = []
  ): Promise<GroupChatV2ReadCursor> => {
    requireOpen();
    const key = buildGroupChatV2ReadCursorKey(selectedScope);
    return exclusive(key, async () => {
      const canonicalMessageCount = await context.getCanonicalMessageCount();
      const merged = await mergeGroupChatV2ReadCursors({
        scope: selectedScope,
        cursors: readCandidates(selectedScope, extra),
        canonicalMessageCount,
        readCanonicalAnchor: context.readCanonicalAnchor
      });
      persist(selectedScope, merged);
      return merged;
    });
  };

  const store: GroupChatV2ReadCursorStore = {
    coordination: runExclusive ? 'cross-context-atomic' : 'best-effort',
    loadCanonical: (selectedScope, context) => loadCanonical(selectedScope, context),
    mergeCanonical: (selectedScope, candidates, context) =>
      loadCanonical(selectedScope, context, candidates),
    advanceVisible: async (selectedScope, visibleMessage, context) => {
      requireOpen();
      const key = buildGroupChatV2ReadCursorKey(selectedScope);
      const cursor = await exclusive(key, async () => {
        const canonicalMessageCount = await context.getCanonicalMessageCount();
        const current = await mergeGroupChatV2ReadCursors({
          scope: selectedScope,
          cursors: readCandidates(selectedScope),
          canonicalMessageCount,
          readCanonicalAnchor: context.readCanonicalAnchor
        });
        const candidate = advanceGroupChatV2ReadCursor({ cursor: current, scope: selectedScope, visibleMessage });
        const merged = await mergeGroupChatV2ReadCursors({
          scope: selectedScope,
          cursors: [current, candidate],
          canonicalMessageCount,
          readCanonicalAnchor: context.readCanonicalAnchor
        });
        persist(selectedScope, merged);
        return merged;
      });
      channel()?.postMessage({
        schema: NOTICE_SCHEMA,
        sourceId: instanceId,
        scopeKey: key,
        cursor
      });
      return cursor;
    },
    reset: async (selectedScope) => {
      requireOpen();
      const key = buildGroupChatV2ReadCursorKey(selectedScope);
      const cursor = await exclusive(key, async () => {
        const candidates = readCandidates(selectedScope);
        const generation = candidates.reduce((maximum, candidate) => Math.max(
          maximum,
          parseGroupChatV2ReadCursor(candidate, selectedScope).generation
        ), 0) + 1;
        const reset = createGroupChatV2ReadCursor(selectedScope, generation);
        persist(selectedScope, reset);
        return reset;
      });
      channel()?.postMessage({ schema: NOTICE_SCHEMA, sourceId: instanceId, scopeKey: key, cursor });
      return cursor;
    },
    subscribe: (selectedScope, context, onCursor, onError) => {
      requireOpen();
      const selectedPort = channel();
      if (!selectedPort) return () => {};
      const key = buildGroupChatV2ReadCursorKey(selectedScope);
      const listener = (event: MessageEvent<unknown>) => {
        const record = event.data && typeof event.data === 'object'
          ? event.data as Record<string, unknown>
          : null;
        if (
          !record ||
          record.schema !== NOTICE_SCHEMA ||
          record.sourceId === instanceId ||
          record.scopeKey !== key
        ) return;
        let candidate: GroupChatV2ReadCursor;
        try { candidate = parseGroupChatV2ReadCursor(record.cursor, selectedScope); }
        catch { return; }
        void loadCanonical(selectedScope, context, [candidate]).then(onCursor).catch(onError);
      };
      selectedPort.addEventListener('message', listener);
      return () => selectedPort.removeEventListener('message', listener);
    },
    close: () => {
      if (closed) return;
      closed = true;
      try { port?.close(); } catch {}
      port = undefined;
      memory.clear();
      tails.clear();
    }
  };
  return Object.freeze(store);
};

export const isGroupChatV2ReadCursorStorageKey = (value: string): boolean =>
  value.startsWith(`${GROUP_CHAT_V2_READ_CURSOR_SCHEMA}:`);
