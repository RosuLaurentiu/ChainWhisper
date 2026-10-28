import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './appShared';
import { buildDirectChatV2MessageKey } from './directChatV2Chain';
import { createDirectChatV2HistoryCheckpoint, type DirectChatV2HistoryScope } from './directChatV2History';
import {
  createDirectChatV2ReadCursorStore,
  type DirectChatV2ReadCursorStore
} from './directChatV2ReadCursorStore';
import { createDirectChatV2ReadCursor } from './directChatV2ReadCursor';

const mocks = vi.hoisted(() => ({
  assertSession: vi.fn(),
  syncPage: vi.fn()
}));

vi.mock('./directChatV2Session', async (importOriginal) => ({
  ...await importOriginal<typeof import('./directChatV2Session')>(),
  assertDirectChatV2SessionController: mocks.assertSession
}));

vi.mock('./directChatV2SyncCoordinator', async (importOriginal) => ({
  ...await importOriginal<typeof import('./directChatV2SyncCoordinator')>(),
  syncDirectChatV2HistoryPage: mocks.syncPage
}));

import { createDirectChatV2HistoryRuntime } from './directChatV2HistoryRuntime';
import type { DirectChatV2SessionController } from './directChatV2Session';

const OWNER = '0x1111111111111111111111111111111111111111';
const PEER = '0x2222222222222222222222222222222222222222';
const CHAT = '0x3333333333333333333333333333333333333333';
const CONVERSATION_ID = `0x${'44'.repeat(32)}`;
const BLOCK_HASH = `0x${'55'.repeat(32)}`;
const SCOPE: DirectChatV2HistoryScope = {
  chainId: 7_082_400n,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  deploymentBlock: 90n,
  conversationStartBlock: 100n
};

const dependencies = {
  getLatestBlockNumber: vi.fn(),
  readCanonicalBlock: vi.fn(),
  readMessagePage: vi.fn(),
  readConversationMessageCountAtBlock: vi.fn(),
  resolveEpochKey: vi.fn(),
  clearEpochKeys: vi.fn()
};

const sessionWatch = vi.fn<(
  peer: string,
  onHint: () => void | Promise<void>
) => Promise<(() => Promise<void>) | null>>(async () => null);
const sessionWatchIncoming = vi.fn<(
  onHint: (peer: string) => void | Promise<void>
) => Promise<() => Promise<void>>>(async () => async () => undefined);

const incomingDependencies = {
  getLatestBlockNumber: vi.fn(async () => 110n),
  readCanonicalBlock: vi.fn(async (blockNumber: bigint) => ({
    number: blockNumber,
    hash: BLOCK_HASH,
    timestamp: 123
  })),
  readIncomingPage: vi.fn(async () => [])
};

const session = {
  ownerAddress: OWNER,
  incomingHistory: vi.fn(async () => ({
    scope: {
      chainId: SCOPE.chainId,
      contractAddress: SCOPE.contractAddress,
      ownerAddress: OWNER,
      deploymentBlock: SCOPE.deploymentBlock
    },
    dependencies: incomingDependencies
  })),
  history: vi.fn(async () => ({
    conversation: { exists: true },
    scope: SCOPE,
    dependencies
  })),
  watch: sessionWatch,
  watchIncoming: sessionWatchIncoming
} as unknown as DirectChatV2SessionController;

const testCursorStore = () => createDirectChatV2ReadCursorStore({
  storage: null,
  broadcastFactory: null,
  runExclusive: null,
  sourceId: 'history-runtime-test'
});

const finalizedMessage = (): ChatMessage => ({
  id: buildDirectChatV2MessageKey({
    chainId: SCOPE.chainId,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    messageId: 1n
  }),
  direction: 'incoming',
  text: 'encrypted message',
  accountAddress: OWNER,
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: SCOPE.chainId.toString(),
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    messageId: '1',
    epoch: '1',
    senderSequence: '1',
    nonce: `0x${'66'.repeat(12)}`,
    transactionHash: `0x${'77'.repeat(32)}`,
    blockNumber: '100',
    blockHash: BLOCK_HASH,
    logIndex: 0,
    finality: 'finalized'
  }
});

const pageResult = (blockHash = BLOCK_HASH) => {
  const message = finalizedMessage();
  return {
    status: 'page-applied', messagesByContact: {}, safeHead: 110n, hasMore: false, reorged: false, appliedEntries: 1, unavailableEntries: 0,
    checkpoint: createDirectChatV2HistoryCheckpoint({ scope: SCOPE, blockNumber: 110n, blockHash, lastMessageId: 1n }),
    mutation: { scope: SCOPE, viewerAddress: OWNER, resetConversation: false, entries: [{ ...message, contact: PEER, blockNumber: 100, logIndex: 0,
      directV2: { ...message.directV2!, blockHash } }] },
    page: { fromBlock: 100n, toBlock: 110n, expectedPreviousMessageId: 0n, lastMessageId: 1n }
  };
};

describe('directChatV2HistoryRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advances bounded pages with an in-memory-backed checkpoint', async () => {
    const checkpoint = createDirectChatV2HistoryCheckpoint({
      scope: SCOPE,
      blockNumber: 100n,
      blockHash: BLOCK_HASH,
      lastMessageId: 0n
    });
    mocks.syncPage
      .mockResolvedValueOnce({
        status: 'page-applied',
        messagesByContact: {},
        checkpoint,
        safeHead: 101n,
        hasMore: true,
        reorged: false,
        appliedEntries: 0,
        unavailableEntries: 0,
        mutation: {
          scope: SCOPE,
          viewerAddress: OWNER,
          resetConversation: false,
          entries: []
        },
        page: {
          fromBlock: 100n,
          toBlock: 100n,
          expectedPreviousMessageId: 0n,
          lastMessageId: 0n
        }
      })
      .mockResolvedValueOnce({
        status: 'up-to-date',
        messagesByContact: {},
        checkpoint,
        safeHead: 101n,
        hasMore: false,
        reorged: false,
        appliedEntries: 0,
        unavailableEntries: 0
      });
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore()
    });

    const batch = await runtime.sync(PEER, {});

    expect(mocks.syncPage).toHaveBeenCalledTimes(2);
    expect(mocks.syncPage.mock.calls[1]?.[0].checkpoint).toEqual(checkpoint);
    expect(batch.hasMore).toBe(false);
  });

  it('applies a reorg reset only to the matching V2 conversation', async () => {
    mocks.syncPage.mockResolvedValueOnce({
      status: 'reorg-reset',
      messagesByContact: {},
      safeHead: 99n,
      hasMore: false,
      reorged: true,
      appliedEntries: 0,
      unavailableEntries: 0,
      mutation: {
        scope: SCOPE,
        viewerAddress: OWNER,
        resetConversation: true,
        entries: []
      }
    });
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore()
    });
    const legacy: ChatMessage = { id: 'legacy', direction: 'incoming', text: 'legacy' };
    const previous = { [PEER.toLowerCase()]: [legacy, finalizedMessage()] };

    const batch = await runtime.sync(PEER, previous);
    const applied = batch.apply(previous);

    expect(batch.reorged).toBe(true);
    expect(applied[PEER.toLowerCase()]).toEqual([legacy]);
  });

  it('clears an uncheckpointed V2 projection before a fresh canonical replay', async () => {
    mocks.syncPage.mockResolvedValueOnce({
      status: 'up-to-date',
      messagesByContact: {},
      safeHead: 99n,
      hasMore: false,
      reorged: false,
      appliedEntries: 0,
      unavailableEntries: 0
    });
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore()
    });
    const legacy: ChatMessage = { id: 'legacy', direction: 'incoming', text: 'legacy' };
    const finalized = finalizedMessage();
    const confirmed = {
      ...finalized,
      id: 'confirmed-v2',
      directV2: { ...finalized.directV2!, messageId: '2', finality: 'confirmed' as const }
    };
    const previous = { [PEER.toLowerCase()]: [legacy, finalized, confirmed] };

    const batch = await runtime.sync(PEER, previous);

    expect(batch.reorged).toBe(false);
    expect(batch.apply(previous)[PEER.toLowerCase()]).toEqual([legacy, confirmed]);
  });

  it('fails closed after the owner history scope is closed', async () => {
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore()
    });
    runtime.close();

    await expect(runtime.sync(PEER, {})).rejects.toThrow('scope changed');
    expect(session.history).not.toHaveBeenCalled();
  });

  it('cleans up current-session event hint watchers', async () => {
    const stop = vi.fn(async () => undefined);
    sessionWatch.mockResolvedValueOnce(stop);
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore()
    });
    const onHint = vi.fn();

    const closeWatcher = await runtime.watch(PEER, onHint);
    const forwardedHint = sessionWatch.mock.calls[0]?.[1];
    await forwardedHint?.();
    await closeWatcher?.();

    expect(onHint).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('counts finalized incoming messages and persists only a visible canonical cursor', async () => {
    dependencies.getLatestBlockNumber.mockResolvedValue(110n);
    dependencies.readConversationMessageCountAtBlock.mockResolvedValue(1n);
    dependencies.readCanonicalBlock.mockResolvedValue({
      number: 100n,
      hash: BLOCK_HASH,
      timestamp: 123
    });
    dependencies.readMessagePage.mockResolvedValue([{
      messageId: 1n,
      blockNumber: 100n,
      blockHash: BLOCK_HASH
    }]);
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore()
    });
    const message = finalizedMessage();
    const messages = { [PEER.toLowerCase()]: [message] };

    await expect(runtime.getUnreadCount(PEER, messages)).resolves.toBe(1);
    await expect(runtime.markVisible(PEER, message, messages)).resolves.toBe(0);

    expect(dependencies.readMessagePage).toHaveBeenCalledWith({
      scope: SCOPE,
      fromBlock: 100n,
      toBlock: 100n
    });
  });

  it('updates unread state when another browser context advances the canonical cursor', async () => {
    dependencies.getLatestBlockNumber.mockResolvedValue(110n);
    dependencies.readConversationMessageCountAtBlock.mockResolvedValue(1n);
    const baseCursorStore = testCursorStore();
    let broadcastCursor: ((cursor: ReturnType<typeof createDirectChatV2ReadCursor>) => void) | undefined;
    const stop = vi.fn();
    const cursorStore = {
      ...baseCursorStore,
      subscribe: ({ onCursor }: Parameters<DirectChatV2ReadCursorStore['subscribe']>[0]) => {
        broadcastCursor = onCursor;
        return stop;
      }
    } satisfies DirectChatV2ReadCursorStore;
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore
    });
    const messages = { [PEER.toLowerCase()]: [finalizedMessage()] };
    const onUnreadCount = vi.fn();

    const closeWatcher = await runtime.watchUnread(PEER, () => messages, onUnreadCount);
    broadcastCursor?.({
      ...createDirectChatV2ReadCursor({
        chainId: SCOPE.chainId,
        contractAddress: CHAT,
        walletAddress: OWNER,
        conversationId: CONVERSATION_ID
      }),
      lastReadMessageId: '1',
      lastReadBlockNumber: '100',
      lastReadBlockHash: BLOCK_HASH
    });
    await closeWatcher?.();

    expect(onUnreadCount).toHaveBeenCalledWith(0);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('forwards global incoming hints and cleans up the watcher', async () => {
    const stop = vi.fn(async () => undefined);
    sessionWatchIncoming.mockResolvedValueOnce(stop);
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore()
    });
    const onHint = vi.fn();

    const closeWatcher = await runtime.watchIncoming(onHint);
    const forwardedHint = sessionWatchIncoming.mock.calls[0]?.[0];
    await forwardedHint?.(PEER);
    await closeWatcher();

    expect(onHint).toHaveBeenCalledWith(PEER);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('discovers finalized incoming peers without requesting conversation history', async () => {
    incomingDependencies.readIncomingPage.mockResolvedValueOnce([{
      sender: PEER,
      recipient: OWNER,
      blockNumber: 100n,
      removed: false
    } as never]);
    const runtime = createDirectChatV2HistoryRuntime({
      confirmationDepth: 5n,
      isCurrent: () => true,
      ownerAddress: OWNER,
      session,
      cursorStore: testCursorStore(),
      incomingDiscoveryStorage: null
    });

    await expect(runtime.discoverIncoming()).resolves.toMatchObject({
      peers: [PEER],
      hasMore: false,
      reorged: false,
      scannedFromBlock: 90n,
      scannedToBlock: 105n
    });

    expect(session.incomingHistory).toHaveBeenCalledOnce();
    expect(session.history).not.toHaveBeenCalled();
    expect(incomingDependencies.readIncomingPage).toHaveBeenCalledWith({
      fromBlock: 90n,
      toBlock: 105n
    });
  });

  it.each(['peer', 'incoming'] as const)('stops a late %s watcher registration when the runtime closes', async kind => {
    const stop = vi.fn(async () => undefined); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    if (kind === 'peer') sessionWatch.mockImplementationOnce(async () => { await gate; return stop; });
    else sessionWatchIncoming.mockImplementationOnce(async () => { await gate; return stop; });
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => true, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    const onHint = vi.fn();
    const pending = kind === 'peer' ? runtime.watch(PEER, onHint) : runtime.watchIncoming(onHint);
    const rejected = expect(pending).rejects.toThrow(/history scope changed/);
    await Promise.resolve(); runtime.close(); release(); await rejected;
    expect(stop).toHaveBeenCalledOnce();
    if (kind === 'peer') await sessionWatch.mock.calls[sessionWatch.mock.calls.length - 1]?.[1]();
    else await sessionWatchIncoming.mock.calls[sessionWatchIncoming.mock.calls.length - 1]?.[0](PEER);
    expect(onHint).not.toHaveBeenCalled();
  });

  it('allows a history retry after a transient page error without committing partial state', async () => {
    mocks.syncPage.mockRejectedValueOnce(new Error('RPC disconnected')).mockResolvedValueOnce({
      status: 'up-to-date', messagesByContact: {}, checkpoint: undefined, safeHead: 101n,
      hasMore: false, reorged: false, appliedEntries: 0, unavailableEntries: 0
    });
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => true, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    await expect(runtime.sync(PEER, {})).rejects.toThrow('RPC disconnected');
    const recovered = await runtime.sync(PEER, {}); expect(recovered.hasMore).toBe(false);
    expect(mocks.syncPage.mock.calls[mocks.syncPage.mock.calls.length - 1]?.[0].checkpoint).toBeUndefined();
  });
  it('cleans up a pending watcher after the owner session changes without runtime close', async () => {
    let current = true; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const stop = vi.fn(async () => undefined);
    sessionWatch.mockImplementationOnce(async () => { await gate; return stop; });
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => current, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    const pending = runtime.watch(PEER, vi.fn()); const rejected = expect(pending).rejects.toThrow(/history scope changed/);
    await Promise.resolve(); current = false; release(); await rejected; expect(stop).toHaveBeenCalledOnce(); runtime.close();
  });
  it('replays a discarded page without rejecting its old unbacked checkpoint', async () => {
    mocks.syncPage.mockResolvedValue(pageResult());
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => true, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    await runtime.sync(PEER, {});
    const retried = await runtime.sync(PEER, {});
    expect(retried.apply({})[PEER.toLowerCase()]).toHaveLength(1);
    expect(mocks.syncPage.mock.calls[1][0].checkpoint).toBeUndefined();
  });
  it('replays a discarded reorg replacement even when old message IDs still back its new checkpoint', async () => {
    const replacementHash = `0x${'99'.repeat(32)}`;
    mocks.syncPage.mockResolvedValueOnce(pageResult());
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => true, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    const original = (await runtime.sync(PEER, {})).apply({});
    const replaced = pageResult(replacementHash);
    mocks.syncPage.mockResolvedValueOnce({ ...replaced, reorged: true, mutation: { ...replaced.mutation, resetConversation: true } });
    await runtime.sync(PEER, original);
    mocks.syncPage.mockResolvedValueOnce(replaced);
    const recovered = await runtime.sync(PEER, original);
    expect(mocks.syncPage.mock.calls[2][0].checkpoint).toBeUndefined();
    expect(recovered.apply(original)[PEER.toLowerCase()][0].directV2?.blockHash).toBe(replacementHash);
  });
  it('keeps an empty reset pending across a failed replay and clears it only after apply', async () => {
    mocks.syncPage.mockResolvedValueOnce(pageResult());
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => true, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    const original = (await runtime.sync(PEER, {})).apply({});
    mocks.syncPage.mockResolvedValueOnce({ status: 'reorg-reset', safeHead: 99n, hasMore: false, reorged: true, appliedEntries: 0, unavailableEntries: 0,
      mutation: { scope: SCOPE, viewerAddress: OWNER, resetConversation: true, entries: [] } });
    const discarded = await runtime.sync(PEER, original);
    mocks.syncPage.mockRejectedValueOnce(new Error('Temporary page failure'));
    await expect(runtime.sync(PEER, original)).rejects.toThrow('Temporary page failure');
    const empty = { status: 'up-to-date', safeHead: 99n, hasMore: false, reorged: false, appliedEntries: 0, unavailableEntries: 0 };
    mocks.syncPage.mockResolvedValueOnce(empty);
    const replayed = await runtime.sync(PEER, original);
    // Applying an older response must not acknowledge this newer recovery batch.
    discarded.apply(original);
    mocks.syncPage.mockResolvedValueOnce(empty);
    const recovered = await runtime.sync(PEER, original);
    expect(replayed.reorged).toBe(false); expect(replayed.appliedEntries).toBe(0);
    expect(recovered.apply(original)[PEER.toLowerCase()]).toBeUndefined();
  });
  it('retains the ordinary incremental checkpoint after a recovery batch is applied', async () => {
    const first = pageResult(); mocks.syncPage.mockResolvedValueOnce(first).mockResolvedValueOnce(first);
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => true, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    await runtime.sync(PEER, {});
    const projection = (await runtime.sync(PEER, {})).apply({});
    mocks.syncPage.mockResolvedValueOnce({ status: 'up-to-date', checkpoint: first.checkpoint, safeHead: 110n,
      hasMore: false, reorged: false, appliedEntries: 0, unavailableEntries: 0 });
    const unchanged = await runtime.sync(PEER, projection);
    expect(mocks.syncPage.mock.calls[2][0].checkpoint).toEqual(first.checkpoint);
    expect(unchanged.apply(projection)).toBe(projection);
  });
  it('rejects a captured batch after its owner runtime is closed', async () => {
    mocks.syncPage.mockResolvedValueOnce(pageResult());
    const runtime = createDirectChatV2HistoryRuntime({ confirmationDepth: 5n, isCurrent: () => true, ownerAddress: OWNER, session, cursorStore: testCursorStore() });
    const batch = await runtime.sync(PEER, {}); runtime.close();
    expect(() => batch.apply({})).toThrow(/history scope changed/);
  });
});
