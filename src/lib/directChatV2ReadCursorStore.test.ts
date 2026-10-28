import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './appShared';
import {
  buildDirectChatV2ReadCursorStorageKey,
  createDirectChatV2ReadCursor,
  type DirectChatV2ReadCursorScope
} from './directChatV2ReadCursor';
import {
  DIRECT_CHAT_V2_READ_CURSOR_CHANNEL,
  DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA,
  createDirectChatV2ReadCursorStore,
  type DirectChatV2ReadCursorBroadcastPort,
  type DirectChatV2ReadCursorExclusiveRunner,
  type DirectChatV2ReadCursorStore,
  type DirectChatV2ReadCursorStorage
} from './directChatV2ReadCursorStore';

const CONTRACT = '0x1000000000000000000000000000000000000001';
const WALLET = '0x2000000000000000000000000000000000000002';
const OTHER_WALLET = '0x3000000000000000000000000000000000000003';
const CONVERSATION = `0x${'44'.repeat(32)}`;
const OTHER_CONVERSATION = `0x${'45'.repeat(32)}`;
const BLOCK_HASH = `0x${'77'.repeat(32)}`;
const SCOPE: DirectChatV2ReadCursorScope = {
  chainId: 7_082_400n,
  contractAddress: CONTRACT,
  walletAddress: WALLET,
  conversationId: CONVERSATION
};

class MemoryStorage implements DirectChatV2ReadCursorStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class BroadcastHub {
  readonly messages: unknown[] = [];
  private readonly ports = new Set<HubPort>();

  create = (name: string): DirectChatV2ReadCursorBroadcastPort => {
    expect(name).toBe(DIRECT_CHAT_V2_READ_CURSOR_CHANNEL);
    const port = new HubPort(this);
    this.ports.add(port);
    return port;
  };

  post(sender: HubPort, message: unknown): void {
    this.messages.push(message);
    for (const port of this.ports) {
      if (port !== sender) port.deliver(message);
    }
  }

  close(port: HubPort): void {
    this.ports.delete(port);
  }
}

class HubPort implements DirectChatV2ReadCursorBroadcastPort {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  constructor(private readonly hub: BroadcastHub) {}

  postMessage(message: unknown): void {
    this.hub.post(this, message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }

  deliver(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<unknown>);
  }

  close(): void {
    this.listeners.clear();
    this.hub.close(this);
  }
}

class ExclusiveRunnerFixture {
  private readonly tails = new Map<string, Promise<void>>();

  run: DirectChatV2ReadCursorExclusiveRunner = <T>(
    scopeKey: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    const previous = this.tails.get(scopeKey) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    const tail = pending.then(() => undefined, () => undefined);
    this.tails.set(scopeKey, tail);
    void tail.finally(() => {
      if (this.tails.get(scopeKey) === tail) this.tails.delete(scopeKey);
    });
    return pending;
  };
}

const cursorAt = (messageId: bigint, blockHash = BLOCK_HASH) =>
  createDirectChatV2ReadCursor(SCOPE, {
    messageId,
    blockNumber: 100n + messageId,
    blockHash
  });

const finalizedMessage = (messageId: bigint): ChatMessage => ({
  id: `direct-v2:${messageId}`,
  direction: 'incoming',
  text: 'never persisted',
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: SCOPE.chainId.toString(),
    contractAddress: CONTRACT,
    conversationId: CONVERSATION,
    messageId: messageId.toString(),
    epoch: '1',
    senderSequence: messageId.toString(),
    nonce: `0x${'88'.repeat(12)}`,
    transactionHash: `0x${'66'.repeat(32)}`,
    blockNumber: (100n + messageId).toString(),
    blockHash: BLOCK_HASH,
    logIndex: 0,
    finality: 'finalized'
  }
});

const canonicalAnchor = async (messageId: bigint) => ({
  messageId,
  blockNumber: 100n + messageId,
  blockHash: BLOCK_HASH
});
const loadCanonical = (
  store: DirectChatV2ReadCursorStore,
  scope: DirectChatV2ReadCursorScope = SCOPE,
  canonicalMessageCount = 100n,
  readCanonicalMessageAnchor = canonicalAnchor
) => store.loadCanonical({
  scope,
  canonicalMessageCount,
  readCanonicalMessageAnchor
});
const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('directChatV2ReadCursorStore', () => {
  it('durably stores only the scoped cursor and reloads it without message or key material', async () => {
    const storage = new MemoryStorage();
    const first = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      sourceId: 'first'
    });
    expect(first.durability).toBe('durable');
    const saved = await first.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(4n)],
      canonicalMessageCount: 4n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    expect(saved.lastReadMessageId).toBe('4');

    const raw = [...storage.values.values()].join('\n');
    expect(raw).not.toContain('never persisted');
    expect(raw).not.toContain('ciphertext');
    expect(raw).not.toContain('plaintext');
    expect(raw).not.toContain('nonce');
    expect(raw).not.toContain('seed');
    expect(raw).not.toContain('epoch');

    const second = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      sourceId: 'second'
    });
    expect('load' in second).toBe(false);
    expect(await loadCanonical(second, SCOPE, 4n)).toEqual(saved);
    expect(second.durability).toBe('durable');
  });

  it('isolates storage by chain, contract, wallet, and conversation and rejects foreign candidates', async () => {
    const storage = new MemoryStorage();
    const store = createDirectChatV2ReadCursorStore({ storage, broadcastFactory: null });
    await store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(2n)],
      canonicalMessageCount: 2n,
      readCanonicalMessageAnchor: canonicalAnchor
    });

    const scopes = [
      { ...SCOPE, chainId: 1n },
      { ...SCOPE, contractAddress: '0x9000000000000000000000000000000000000009' },
      { ...SCOPE, walletAddress: OTHER_WALLET },
      { ...SCOPE, conversationId: OTHER_CONVERSATION }
    ];
    for (const scope of scopes) {
      expect((await loadCanonical(store, scope, 0n)).lastReadMessageId).toBe('0');
    }

    await expect(store.mergeAndPersist({
      scope: SCOPE,
      candidates: [createDirectChatV2ReadCursor(
        { ...SCOPE, walletAddress: OTHER_WALLET },
        { messageId: 3n, blockNumber: 103n, blockHash: BLOCK_HASH }
      )],
      canonicalMessageCount: 3n,
      readCanonicalMessageAnchor: canonicalAnchor
    })).rejects.toThrow('different wallet or conversation');
  });

  it('canonical-merges before persisting and conservatively clears a stale or out-of-range cursor', async () => {
    const storage = new MemoryStorage();
    const store = createDirectChatV2ReadCursorStore({ storage, broadcastFactory: null });
    const staleHash = `0x${'99'.repeat(32)}`;

    expect((await store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(8n, staleHash), cursorAt(3n)],
      canonicalMessageCount: 6n,
      readCanonicalMessageAnchor: (messageId) =>
        messageId > 6n ? Promise.resolve(null) : canonicalAnchor(messageId)
    })).lastReadMessageId).toBe('3');

    expect((await store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(8n, staleHash)],
      canonicalMessageCount: 2n,
      readCanonicalMessageAnchor: (messageId) =>
        messageId > 2n ? Promise.resolve(null) : canonicalAnchor(messageId)
    })).lastReadMessageId).toBe('0');
    expect(storage.values.size).toBe(0);
  });

  it('advances from a finalized visible message and automatically converges another tab after canonical validation', async () => {
    const storage = new MemoryStorage();
    const hub = new BroadcastHub();
    const alice = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: hub.create,
      sourceId: 'alice-tab'
    });
    const bob = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: hub.create,
      sourceId: 'bob-tab'
    });
    const observed: string[] = [];
    let resolveObserved: (() => void) | undefined;
    const observedCursor = new Promise<void>((resolve) => {
      resolveObserved = resolve;
    });
    const unsubscribe = bob.subscribe({
      scope: SCOPE,
      getCanonicalMessageCount: async () => 5n,
      readCanonicalMessageAnchor: canonicalAnchor,
      onCursor: (cursor) => {
        observed.push(cursor.lastReadMessageId);
        resolveObserved?.();
      }
    });

    await alice.advanceVisibleAndPersist({
      scope: SCOPE,
      visibleMessage: finalizedMessage(5n),
      canonicalMessageCount: 5n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    await observedCursor;

    expect(observed).toEqual(['5']);
    expect((await loadCanonical(bob, SCOPE, 5n)).lastReadMessageId).toBe('5');
    expect(JSON.stringify(hub.messages)).not.toContain('never persisted');
    expect(JSON.stringify(hub.messages)).not.toContain('ciphertext');
    expect(JSON.stringify(hub.messages)).not.toContain('nonce');
    unsubscribe();
  });

  it('broadcasts an explicit reorg reset, ignores other scopes, and stops after unsubscribe', async () => {
    const storage = new MemoryStorage();
    const hub = new BroadcastHub();
    const sender = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: hub.create,
      sourceId: 'sender'
    });
    const receiver = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: hub.create,
      sourceId: 'receiver'
    });
    const observed = vi.fn();
    let resolveReset: (() => void) | undefined;
    const resetObserved = new Promise<void>((resolve) => {
      resolveReset = resolve;
    });
    const unsubscribe = receiver.subscribe({
      scope: SCOPE,
      getCanonicalMessageCount: async () => 10n,
      readCanonicalMessageAnchor: canonicalAnchor,
      onCursor: (cursor) => {
        observed(cursor);
        if (cursor.lastReadMessageId === '0') resolveReset?.();
      }
    });

    await sender.mergeAndPersist({
      scope: { ...SCOPE, conversationId: OTHER_CONVERSATION },
      candidates: [createDirectChatV2ReadCursor(
        { ...SCOPE, conversationId: OTHER_CONVERSATION },
        { messageId: 2n, blockNumber: 102n, blockHash: BLOCK_HASH }
      )],
      canonicalMessageCount: 2n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    await flushAsync();
    expect(observed).not.toHaveBeenCalled();

    const reset = sender.reset(SCOPE);
    await Promise.all([reset, resetObserved]);
    expect(observed).toHaveBeenCalledOnce();
    expect(observed.mock.calls[0][0].lastReadMessageId).toBe('0');
    expect(observed.mock.calls[0][0].generation).toBe(1);
    expect(await loadCanonical(receiver, SCOPE, 10n)).toMatchObject({
      generation: 1,
      lastReadMessageId: '0'
    });

    unsubscribe();
    await sender.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(4n)],
      canonicalMessageCount: 4n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    await flushAsync();
    expect(observed).toHaveBeenCalledOnce();
  });

  it('treats an untrusted reset notice as a canonical-revalidation hint instead of proof', async () => {
    const storage = new MemoryStorage();
    const hub = new BroadcastHub();
    const receiver = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: hub.create,
      sourceId: 'trusted-receiver'
    });
    await receiver.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(4n)],
      canonicalMessageCount: 4n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    let resolveObserved: (() => void) | undefined;
    const observedCursor = new Promise<void>((resolve) => {
      resolveObserved = resolve;
    });
    const observed = vi.fn();
    const unsubscribe = receiver.subscribe({
      scope: SCOPE,
      getCanonicalMessageCount: async () => 4n,
      readCanonicalMessageAnchor: canonicalAnchor,
      onCursor: (cursor) => {
        observed(cursor);
        resolveObserved?.();
      }
    });
    const untrustedPort = hub.create(DIRECT_CHAT_V2_READ_CURSOR_CHANNEL);

    untrustedPort.postMessage({
      schema: DIRECT_CHAT_V2_READ_CURSOR_NOTICE_SCHEMA,
      sourceId: 'untrusted-tab',
      scopeKey: buildDirectChatV2ReadCursorStorageKey(SCOPE),
      kind: 'reset'
    });
    await observedCursor;

    expect(observed).toHaveBeenCalledOnce();
    expect(observed.mock.calls[0][0].lastReadMessageId).toBe('4');
    expect((await loadCanonical(receiver, SCOPE, 4n)).lastReadMessageId).toBe('4');
    unsubscribe();
    untrustedPort.close();
  });

  it('does not let an async canonical merge re-persist a cursor after a reorg reset', async () => {
    const storage = new MemoryStorage();
    const store = createDirectChatV2ReadCursorStore({ storage, broadcastFactory: null });
    let releaseHash: ((hash: string) => void) | undefined;
    const hashPending = new Promise<string>((resolve) => {
      releaseHash = resolve;
    });
    const pendingMerge = store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(6n)],
      canonicalMessageCount: 6n,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 100n + messageId,
        blockHash: await hashPending
      })
    });
    await Promise.resolve();

    const reset = store.reset(SCOPE);
    releaseHash?.(BLOCK_HASH);
    const [resolved] = await Promise.all([pendingMerge, reset]);

    expect(resolved.lastReadMessageId).toBe('0');
    expect(resolved.generation).toBe(1);
    expect(await loadCanonical(store, SCOPE, 6n)).toMatchObject({
      generation: 1,
      lastReadMessageId: '0'
    });
    expect(storage.values.size).toBe(1);
  });

  it('observes a cross-tab reset while merging even when the scope has no UI subscriber', async () => {
    const storage = new MemoryStorage();
    const hub = new BroadcastHub();
    const sender = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: hub.create,
      sourceId: 'reset-sender'
    });
    const receiver = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: hub.create,
      sourceId: 'pending-receiver'
    });
    let releaseHash: ((hash: string) => void) | undefined;
    const hashPending = new Promise<string>((resolve) => {
      releaseHash = resolve;
    });
    const pendingMerge = receiver.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(6n)],
      canonicalMessageCount: 6n,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 100n + messageId,
        blockHash: await hashPending
      })
    });
    await Promise.resolve();

    const reset = sender.reset(SCOPE);
    releaseHash?.(BLOCK_HASH);

    const [merged] = await Promise.all([pendingMerge, reset]);
    expect(merged.lastReadMessageId).toBe('0');
    expect(merged.generation).toBe(1);
    expect(await loadCanonical(receiver, SCOPE, 6n)).toMatchObject({
      generation: 1,
      lastReadMessageId: '0'
    });
    expect(storage.values.size).toBe(1);
  });

  it('does not let a stale device repopulate a newer durable reset generation', async () => {
    const storage = new MemoryStorage();
    const exclusive = new ExclusiveRunnerFixture();
    const resetter = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      runExclusive: exclusive.run,
      sourceId: 'resetter'
    });
    const staleDevice = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      runExclusive: exclusive.run,
      sourceId: 'stale-device'
    });
    const staleCursor = cursorAt(5n);
    await resetter.mergeAndPersist({
      scope: SCOPE,
      candidates: [staleCursor],
      canonicalMessageCount: 5n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    const reset = await resetter.reset(SCOPE);
    expect(reset).toMatchObject({ generation: 1, lastReadMessageId: '0' });

    const reconciled = await staleDevice.mergeAndPersist({
      scope: SCOPE,
      candidates: [staleCursor],
      canonicalMessageCount: 5n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    expect(reconciled).toMatchObject({ generation: 1, lastReadMessageId: '0' });

    const acknowledged = await staleDevice.advanceVisibleAndPersist({
      scope: SCOPE,
      visibleMessage: finalizedMessage(5n),
      canonicalMessageCount: 5n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    expect(acknowledged).toMatchObject({ generation: 1, lastReadMessageId: '5' });
  });

  it('serializes same-scope merges so a slower lower cursor cannot overwrite a higher cursor', async () => {
    const storage = new MemoryStorage();
    const store = createDirectChatV2ReadCursorStore({ storage, broadcastFactory: null });
    let releaseLowerHash: ((hash: string) => void) | undefined;
    const lowerHashPending = new Promise<string>((resolve) => {
      releaseLowerHash = resolve;
    });
    const lower = store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(2n)],
      canonicalMessageCount: 8n,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 100n + messageId,
        blockHash: await lowerHashPending
      })
    });
    await Promise.resolve();
    const higher = store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(8n)],
      canonicalMessageCount: 8n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    await flushAsync();

    releaseLowerHash?.(BLOCK_HASH);
    await Promise.all([lower, higher]);

    expect((await loadCanonical(store, SCOPE, 8n)).lastReadMessageId).toBe('8');
  });

  it('uses one cross-context lock so separate stores cannot finish high-then-low', async () => {
    const storage = new MemoryStorage();
    const exclusive = new ExclusiveRunnerFixture();
    const lowerStore = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      runExclusive: exclusive.run,
      sourceId: 'lower-store'
    });
    const higherStore = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      runExclusive: exclusive.run,
      sourceId: 'higher-store'
    });
    expect(lowerStore.coordination).toBe('cross-context-atomic');
    expect(higherStore.coordination).toBe('cross-context-atomic');
    let releaseLowerHash: ((hash: string) => void) | undefined;
    const lowerHashPending = new Promise<string>((resolve) => {
      releaseLowerHash = resolve;
    });
    const lower = lowerStore.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(2n)],
      canonicalMessageCount: 8n,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 100n + messageId,
        blockHash: await lowerHashPending
      })
    });
    await Promise.resolve();
    const higher = higherStore.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(8n)],
      canonicalMessageCount: 8n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    await flushAsync();

    releaseLowerHash?.(BLOCK_HASH);
    await Promise.all([lower, higher]);

    expect((await loadCanonical(higherStore, SCOPE, 8n)).lastReadMessageId).toBe('8');
  });

  it('fails closed when a queued writer carries a stale count past the cross-context lock', async () => {
    const storage = new MemoryStorage();
    const exclusive = new ExclusiveRunnerFixture();
    const higherStore = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      runExclusive: exclusive.run,
      sourceId: 'fresh-count-store'
    });
    const staleStore = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null,
      runExclusive: exclusive.run,
      sourceId: 'stale-count-store'
    });
    let releaseHigherHash: ((hash: string) => void) | undefined;
    const higherHashPending = new Promise<string>((resolve) => {
      releaseHigherHash = resolve;
    });
    const higher = higherStore.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(8n)],
      canonicalMessageCount: 8n,
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 100n + messageId,
        blockHash: await higherHashPending
      })
    });
    await Promise.resolve();
    const stale = staleStore.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(2n)],
      canonicalMessageCount: 2n,
      readCanonicalMessageAnchor: canonicalAnchor
    });

    releaseHigherHash?.(BLOCK_HASH);
    await higher;
    await expect(stale).rejects.toThrow('anchored message exceeds the message count');
    expect((await loadCanonical(higherStore, SCOPE, 8n)).lastReadMessageId).toBe('8');
  });

  it('never exposes a persisted cursor until its block anchor is canonical again', async () => {
    const storage = new MemoryStorage();
    const first = createDirectChatV2ReadCursorStore({ storage, broadcastFactory: null });
    await first.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(5n)],
      canonicalMessageCount: 5n,
      readCanonicalMessageAnchor: canonicalAnchor
    });

    const restored = createDirectChatV2ReadCursorStore({ storage, broadcastFactory: null });
    const replacementHash = `0x${'99'.repeat(32)}`;
    const cursor = await loadCanonical(restored, SCOPE, 5n, async (messageId) => ({
      messageId,
      blockNumber: 100n + messageId,
      blockHash: replacementHash
    }));

    expect(cursor.lastReadMessageId).toBe('0');
    expect(storage.values.size).toBe(0);
  });

  it('reports memory-only after a durable getItem failure and keeps the cursor in memory', async () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const failingStorage: DirectChatV2ReadCursorStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem,
      removeItem
    };
    const store = createDirectChatV2ReadCursorStore({
      storage: failingStorage,
      broadcastFactory: null,
      runExclusive: null
    });
    expect(store.coordination).toBe('best-effort');
    expect(store.durability).toBe('durable');
    const cursor = await store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(2n)],
      canonicalMessageCount: 2n,
      readCanonicalMessageAnchor: canonicalAnchor
    });

    expect(cursor.lastReadMessageId).toBe('2');
    expect((await loadCanonical(store, SCOPE, 2n)).lastReadMessageId).toBe('2');
    expect(store.durability).toBe('memory-only');
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('reports memory-only after a durable setItem failure and keeps its safe memory fallback', async () => {
    const values = new Map<string, string>();
    const attemptedWrites: string[] = [];
    const quotaStorage: DirectChatV2ReadCursorStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (_key, value) => {
        attemptedWrites.push(value);
        throw new Error('quota');
      },
      removeItem: (key) => { values.delete(key); }
    };
    const store = createDirectChatV2ReadCursorStore({
      storage: quotaStorage,
      broadcastFactory: null
    });
    expect(store.durability).toBe('durable');
    await store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(2n)],
      canonicalMessageCount: 2n,
      readCanonicalMessageAnchor: canonicalAnchor
    });

    expect((await loadCanonical(store, SCOPE, 2n)).lastReadMessageId).toBe('2');
    expect(store.durability).toBe('memory-only');
    expect(attemptedWrites).toHaveLength(1);
    expect(attemptedWrites.join('\n')).not.toMatch(
      /never persisted|ciphertext|plaintext|nonce|seed|epoch/
    );
  });

  it('reports memory-only after a durable reset-boundary write failure without reviving the cursor in memory', async () => {
    const values = new Map<string, string>();
    let failSet = false;
    const storage: DirectChatV2ReadCursorStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failSet) throw new Error('blocked');
        values.set(key, value);
      },
      removeItem: (key) => { values.delete(key); }
    };
    const store = createDirectChatV2ReadCursorStore({
      storage,
      broadcastFactory: null
    });
    await store.mergeAndPersist({
      scope: SCOPE,
      candidates: [cursorAt(3n)],
      canonicalMessageCount: 3n,
      readCanonicalMessageAnchor: canonicalAnchor
    });
    expect(store.durability).toBe('durable');
    expect(values.size).toBe(1);

    failSet = true;
    const reset = await store.reset(SCOPE);

    expect(reset.lastReadMessageId).toBe('0');
    expect(reset.generation).toBe(1);
    expect(store.durability).toBe('memory-only');
    expect(await loadCanonical(store, SCOPE, 3n)).toMatchObject({
      generation: 1,
      lastReadMessageId: '0'
    });
    expect(values.size).toBe(1);
    expect([...values.values()].join('\n')).not.toMatch(
      /never persisted|ciphertext|plaintext|nonce|seed|epoch/
    );
  });

  it('reports memory-only immediately when no durable storage is configured', () => {
    const store = createDirectChatV2ReadCursorStore({
      storage: null,
      broadcastFactory: null
    });

    expect(store.durability).toBe('memory-only');
  });
});
