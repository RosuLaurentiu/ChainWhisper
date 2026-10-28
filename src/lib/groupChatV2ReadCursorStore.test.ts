import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './appShared';
import {
  buildGroupChatV2ReadCursorKey,
  createGroupChatV2ReadCursor,
  type GroupChatV2ReadCursorScope
} from './groupChatV2ReadCursor';
import { createGroupChatV2ReadCursorStore } from './groupChatV2ReadCursorStore';

const SCOPE = {
  chainId: 7_082_400n,
  contractAddress: '0x1111111111111111111111111111111111111111',
  walletAddress: '0x2222222222222222222222222222222222222222',
  groupId: 3n
};
const HASH = `0x${'33'.repeat(32)}`;
const CHANNEL = 'chainwhisper-group-chat-v2-read-cursor-channel-v1';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

class BroadcastHub {
  private readonly ports = new Set<HubPort>();

  create = (name: string) => {
    expect(name).toBe(CHANNEL);
    const port = new HubPort(this);
    this.ports.add(port);
    return port;
  };

  post(sender: HubPort, message: unknown): void {
    for (const port of this.ports) if (port !== sender) port.deliver(message);
  }

  close(port: HubPort): void { this.ports.delete(port); }
}

class HubPort {
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  constructor(private readonly hub: BroadcastHub) {}
  postMessage(message: unknown): void { this.hub.post(this, message); }
  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }
  deliver(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<unknown>);
  }
  close(): void { this.listeners.clear(); this.hub.close(this); }
}

class ExclusiveRunnerFixture {
  private readonly tails = new Map<string, Promise<void>>();

  run = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => next);
    this.tails.set(key, tail);
    await previous;
    try { return await operation(); } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  };
}

const cursorAt = (
  scope: GroupChatV2ReadCursorScope,
  messageId: bigint,
  generation = 0
) => createGroupChatV2ReadCursor(scope, generation, {
  messageId,
  blockNumber: 100n + messageId,
  blockHash: HASH
});

const canonicalContext = (count = 100n) => ({
  getCanonicalMessageCount: async () => count,
  readCanonicalAnchor: async (messageId: bigint, blockNumber: bigint) =>
    messageId <= count && blockNumber === 100n + messageId
      ? { messageId, blockNumber, blockHash: HASH }
      : null
});

const finalizedMessage = (scope: GroupChatV2ReadCursorScope, messageId: bigint): ChatMessage => ({
  id: `group-v2:${messageId}`,
  direction: 'incoming',
  text: 'test message',
  groupV2: {
    protocol: 'group-v2',
    contentState: 'available',
    chainId: scope.chainId.toString(),
    contractAddress: scope.contractAddress,
    groupId: scope.groupId.toString(),
    messageId: messageId.toString(),
    epoch: '2',
    membershipRevision: '4',
    senderSequence: messageId.toString(),
    nonce: `0x${'44'.repeat(12)}`,
    transactionHash: `0x${'55'.repeat(32)}`,
    blockNumber: (100n + messageId).toString(),
    blockHash: HASH,
    logIndex: 0,
    finality: 'finalized'
  }
});

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('groupChatV2ReadCursorStore', () => {
  it('persists only a canonically anchored cursor and advances reset generation', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); })
    };
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const store = createGroupChatV2ReadCursorStore({
      storage,
      broadcastFactory: () => ({
        postMessage: vi.fn(),
        addEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
          listeners.add(listener);
        },
        removeEventListener: (_type: 'message', listener: (event: MessageEvent<unknown>) => void) => {
          listeners.delete(listener);
        },
        close: vi.fn()
      }),
      runExclusive: async (_key, operation) => operation(),
      instanceId: 'test-store'
    });
    const context = {
      getCanonicalMessageCount: async () => 8n,
      readCanonicalAnchor: async (messageId: bigint, blockNumber: bigint) =>
        messageId === 8n && blockNumber === 120n
          ? { messageId, blockNumber, blockHash: HASH }
          : null
    };
    const cursor = await store.advanceVisible(SCOPE, {
      direction: 'incoming',
      groupV2: {
        protocol: 'group-v2',
        contentState: 'available',
        chainId: SCOPE.chainId.toString(),
        contractAddress: SCOPE.contractAddress,
        groupId: '3',
        messageId: '8',
        epoch: '2',
        membershipRevision: '4',
        senderSequence: '3',
        nonce: `0x${'44'.repeat(12)}`,
        transactionHash: `0x${'55'.repeat(32)}`,
        blockNumber: '120',
        blockHash: HASH,
        logIndex: 1,
        finality: 'finalized'
      }
    }, context);
    expect(cursor.lastReadMessageId).toBe('8');
    await expect(store.loadCanonical(SCOPE, context)).resolves.toEqual(cursor);
    await expect(store.reset(SCOPE)).resolves.toMatchObject({ generation: 1, lastReadMessageId: '0' });
    store.close();
  });

  it('serializes cross-context merges so a slower lower cursor cannot overwrite a higher cursor', async () => {
    const storage = new MemoryStorage();
    const exclusive = new ExclusiveRunnerFixture();
    const lowerStore = createGroupChatV2ReadCursorStore({
      storage,
      broadcastFactory: undefined,
      runExclusive: exclusive.run,
      instanceId: 'lower-store'
    });
    const higherStore = createGroupChatV2ReadCursorStore({
      storage,
      broadcastFactory: undefined,
      runExclusive: exclusive.run,
      instanceId: 'higher-store'
    });
    expect(lowerStore.coordination).toBe('cross-context-atomic');
    let releaseLowerAnchor: (() => void) | undefined;
    const lowerAnchorPending = new Promise<void>((resolve) => { releaseLowerAnchor = resolve; });
    const lower = lowerStore.mergeCanonical(SCOPE, [cursorAt(SCOPE, 2n)], {
      getCanonicalMessageCount: async () => 8n,
      readCanonicalAnchor: async (messageId, blockNumber) => {
        await lowerAnchorPending;
        return { messageId, blockNumber, blockHash: HASH };
      }
    });
    await Promise.resolve();
    const higher = higherStore.mergeCanonical(SCOPE, [cursorAt(SCOPE, 8n)], canonicalContext(8n));
    await flushAsync();
    releaseLowerAnchor?.();
    await Promise.all([lower, higher]);

    await expect(higherStore.loadCanonical(SCOPE, canonicalContext(8n)))
      .resolves.toMatchObject({ lastReadMessageId: '8' });
  });

  it('keeps a cross-context reset generation ahead of stale cursors and accepts a new visible read', async () => {
    const storage = new MemoryStorage();
    const exclusive = new ExclusiveRunnerFixture();
    const resetter = createGroupChatV2ReadCursorStore({
      storage, broadcastFactory: undefined, runExclusive: exclusive.run, instanceId: 'resetter'
    });
    const staleStore = createGroupChatV2ReadCursorStore({
      storage, broadcastFactory: undefined, runExclusive: exclusive.run, instanceId: 'stale-store'
    });
    await resetter.mergeCanonical(SCOPE, [cursorAt(SCOPE, 5n)], canonicalContext(5n));
    await expect(resetter.reset(SCOPE)).resolves.toMatchObject({
      generation: 1,
      lastReadMessageId: '0'
    });

    await expect(staleStore.mergeCanonical(SCOPE, [cursorAt(SCOPE, 5n)], canonicalContext(5n)))
      .resolves.toMatchObject({ generation: 1, lastReadMessageId: '0' });
    await expect(staleStore.advanceVisible(
      SCOPE,
      finalizedMessage(SCOPE, 6n),
      canonicalContext(6n)
    )).resolves.toMatchObject({ generation: 1, lastReadMessageId: '6' });
  });

  it('isolates cursors by chain, contract, wallet, and group and rejects foreign candidates', async () => {
    const storage = new MemoryStorage();
    const store = createGroupChatV2ReadCursorStore({ storage, broadcastFactory: undefined });
    await store.mergeCanonical(SCOPE, [cursorAt(SCOPE, 2n)], canonicalContext(2n));
    const otherScopes: GroupChatV2ReadCursorScope[] = [
      { ...SCOPE, chainId: 1n },
      { ...SCOPE, contractAddress: '0x9000000000000000000000000000000000000009' },
      { ...SCOPE, walletAddress: '0x3000000000000000000000000000000000000003' },
      { ...SCOPE, groupId: 4n }
    ];

    for (const scope of otherScopes) {
      expect(buildGroupChatV2ReadCursorKey(scope)).not.toBe(buildGroupChatV2ReadCursorKey(SCOPE));
      await expect(store.loadCanonical(scope, canonicalContext(0n)))
        .resolves.toMatchObject({ lastReadMessageId: '0' });
      await expect(store.mergeCanonical(SCOPE, [cursorAt(scope, 3n)], canonicalContext(3n)))
        .rejects.toThrow('Group read cursor belongs to another scope');
    }
    await expect(store.loadCanonical(SCOPE, canonicalContext(2n)))
      .resolves.toMatchObject({ lastReadMessageId: '2' });
  });

  it('revalidates a reset notice across stores and ignores a notice for another scope', async () => {
    const storage = new MemoryStorage();
    const hub = new BroadcastHub();
    const sender = createGroupChatV2ReadCursorStore({ storage, broadcastFactory: hub.create, instanceId: 'sender' });
    const receiver = createGroupChatV2ReadCursorStore({ storage, broadcastFactory: hub.create, instanceId: 'receiver' });
    const otherScope = { ...SCOPE, groupId: 4n };
    const observed = vi.fn();
    let resolveReset: (() => void) | undefined;
    const resetObserved = new Promise<void>((resolve) => { resolveReset = resolve; });
    const unsubscribe = receiver.subscribe(SCOPE, canonicalContext(10n), (cursor) => {
      observed(cursor);
      if (cursor.generation === 1) resolveReset?.();
    });

    await sender.reset(otherScope);
    await flushAsync();
    expect(observed).not.toHaveBeenCalled();
    await sender.reset(SCOPE);
    await resetObserved;
    expect(observed).toHaveBeenCalledOnce();
    expect(observed.mock.calls[0][0]).toMatchObject({ generation: 1, lastReadMessageId: '0' });
    unsubscribe();
    sender.close();
    receiver.close();
  });
});
