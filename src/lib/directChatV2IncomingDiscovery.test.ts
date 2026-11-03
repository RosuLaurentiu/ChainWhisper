import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectChatV2MessageEvent } from './directChatV2Chain';
import {
  buildDirectChatV2IncomingDiscoveryStorageKey,
  createDirectChatV2IncomingDiscovery,
  rememberDirectChatV2Preview,
  subscribeDirectChatV2DiscoveryHints,
  type DirectChatV2IncomingDiscoveryScope,
  type DirectChatV2IncomingDiscoveryStorage
} from './directChatV2IncomingDiscovery';
import type { CotiEventHintSubscription } from './appShared/cotiEventHints';
import { DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC } from './directChatV2Chain';

const OWNER = '0x1111111111111111111111111111111111111111';
const PEER = '0x2222222222222222222222222222222222222222';
const CHAT = '0x3333333333333333333333333333333333333333';
const scope: DirectChatV2IncomingDiscoveryScope = {
  chainId: 7_082_400n,
  contractAddress: CHAT,
  ownerAddress: OWNER,
  deploymentBlock: 99n
};

it('schedules unchanged previews once and notices new messages, key changes and rolled-back anchors', () => {
  const seen = new Map<string, string>();
  const schedule = vi.fn();
  const preview = { peer: PEER, conversationId: `0x${'ab'.repeat(32)}`, currentEpoch: 1n,
    messageCount: 2n, createdAt: 1n, lastMessageAt: 2n, createdBlock: 99n,
    firstMessageBlock: 100n, lastMessageBlock: 101n };
  const poll = (value = preview) => { if (rememberDirectChatV2Preview(seen, value)) schedule(value.peer); };
  poll(); poll({ ...preview });
  expect(schedule).toHaveBeenCalledOnce();
  poll({ ...preview, messageCount: 3n });
  poll({ ...preview, currentEpoch: 2n });
  poll();
  expect(schedule).toHaveBeenCalledTimes(4);
  seen.clear(); poll();
  expect(schedule).toHaveBeenCalledTimes(5);
});

it('uses an owner-recipient Direct hint filter and rejects callbacks after close', async () => {
  let request!: CotiEventHintSubscription;
  const onHint = vi.fn(), onStatus = vi.fn(), unsubscribe = vi.fn();
  const stop = await subscribeDirectChatV2DiscoveryHints({ scope, isCurrent: () => true, onHint, onStatus,
    subscribe: async input => { request = input; return unsubscribe; } });
  expect(request.address).toBe(CHAT);
  expect(request.topics).toEqual([DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, null, null, `0x${OWNER.slice(2).padStart(64, '0')}`]);
  request.onHint(); request.onStatus?.('connected');
  expect(onHint).toHaveBeenCalledOnce(); expect(onStatus).toHaveBeenCalledWith('connected');
  stop(); request.onHint(); request.onStatus?.('reconnecting');
  expect(unsubscribe).toHaveBeenCalledOnce(); expect(onHint).toHaveBeenCalledOnce(); expect(onStatus).toHaveBeenCalledOnce();
});

it('unsubscribes a late Direct hint setup after its owner session is replaced', async () => {
  let current = true, release!: (stop: () => void) => void;
  const onHint = vi.fn(), onStatus = vi.fn(), unsubscribe = vi.fn();
  let request!: CotiEventHintSubscription;
  const pending = subscribeDirectChatV2DiscoveryHints({ scope, isCurrent: () => current, onHint, onStatus,
    subscribe: async input => { request = input; return new Promise(resolve => { release = resolve; }); } });
  current = false; request.onHint(); request.onStatus?.('connected'); release(unsubscribe);
  await pending;
  expect(unsubscribe).toHaveBeenCalledOnce(); expect(onHint).not.toHaveBeenCalled(); expect(onStatus).not.toHaveBeenCalled();
});

const memoryStorage = (): DirectChatV2IncomingDiscoveryStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); })
  };
};

const canonicalBlock = (blockNumber: bigint, salt = 'aa') => ({
  number: blockNumber,
  hash: `0x${salt.repeat(32)}`,
  timestamp: Number(blockNumber)
});

const incomingEvent = (blockNumber: bigint): DirectChatV2MessageEvent => ({
  sender: PEER,
  recipient: OWNER,
  blockNumber,
  removed: false
} as DirectChatV2MessageEvent);

const outgoingEvent = (blockNumber: bigint): DirectChatV2MessageEvent => ({
  sender: OWNER,
  recipient: PEER,
  blockNumber,
  removed: false
} as DirectChatV2MessageEvent);

describe('directChatV2IncomingDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the finalized recent window first, persists only recent progress, and resumes', async () => {
    const storage = memoryStorage();
    const getLatestBlockNumber = vi.fn(async () => 10_000n);
    const readCanonicalBlock = vi.fn(async (blockNumber: bigint) => canonicalBlock(blockNumber));
    const readIncomingPage = vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => (
      fromBlock === 7_948n ? [incomingEvent(9_990n), outgoingEvent(9_991n)] : []
    ));
    const discovery = createDirectChatV2IncomingDiscovery({
      confirmationDepth: 5n,
      dependencies: { getLatestBlockNumber, readCanonicalBlock, readIncomingPage },
      isCurrent: () => true,
      scope,
      storage
    });

    const first = await discovery.scan();

    expect(first).toEqual({
      peers: [PEER],
      changedPeers: [PEER],
      hasMore: false,
      reorged: false,
      scannedFromBlock: 7_948n,
      scannedToBlock: 9_995n
    });
    expect(readIncomingPage.mock.calls.map(([range]) => range)).toEqual([
      { fromBlock: 7_948n, toBlock: 9_995n }
    ]);
    const serialized = storage.data.get(buildDirectChatV2IncomingDiscoveryStorageKey(scope));
    expect(serialized).toContain('"nextBlock":"9996"');
    expect(serialized).toContain('recent-activity');
    expect(serialized).toContain(`"activityBlocks":{"${PEER}":"9991"}`);
    expect(serialized).not.toContain('ciphertext');

    const second = await discovery.scan();
    expect(second).toMatchObject({
      peers: [PEER],
      changedPeers: [],
      hasMore: false
    });
    expect(readIncomingPage).toHaveBeenCalledOnce();
  });

  it('reaches recent activity on an old conversation after a long absence without draining the gap', async () => {
    const getLatestBlockNumber = vi.fn(async () => 110n);
    const readIncomingPage = vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      [incomingEvent(100n), incomingEvent(99_990n)].filter(event => event.blockNumber >= fromBlock && event.blockNumber <= toBlock));
    const discovery = createDirectChatV2IncomingDiscovery({ confirmationDepth: 5n, scope, storage: null,
      isCurrent: () => true, dependencies: { getLatestBlockNumber, readIncomingPage,
        readCanonicalBlock: async blockNumber => canonicalBlock(blockNumber) } });
    expect((await discovery.scan()).changedPeers).toEqual([PEER]);
    getLatestBlockNumber.mockResolvedValue(100_000n);
    expect(await discovery.scan()).toMatchObject({ changedPeers: [PEER], hasMore: false,
      scannedFromBlock: 97_948n, scannedToBlock: 99_995n });
    expect(readIncomingPage).toHaveBeenCalledTimes(2);
  });

  it('restores discovered peers after a reload even when no newer messages exist', async () => {
    const storage = memoryStorage();
    const dependencies = {
      getLatestBlockNumber: vi.fn(async () => 110n),
      readCanonicalBlock: vi.fn(async (blockNumber: bigint) => canonicalBlock(blockNumber)),
      readIncomingPage: vi.fn(async () => [outgoingEvent(100n)])
    };
    const first = createDirectChatV2IncomingDiscovery({
      confirmationDepth: 5n,
      dependencies,
      isCurrent: () => true,
      scope,
      storage
    });
    expect((await first.scan()).peers).toEqual([PEER]);
    first.close();

    dependencies.readIncomingPage.mockClear();
    const afterReload = createDirectChatV2IncomingDiscovery({
      confirmationDepth: 5n,
      dependencies,
      isCurrent: () => true,
      scope,
      storage
    });

    const result = await afterReload.scan();

    expect(result).toEqual({
      peers: [PEER],
      changedPeers: [],
      hasMore: false,
      reorged: false
    });
    expect(dependencies.readIncomingPage).not.toHaveBeenCalled();
  });

  it('drops old activity hints when the recent window moves and does not restore them on reload', async () => {
    const storage = memoryStorage();
    const getLatestBlockNumber = vi.fn(async () => 110n);
    const readIncomingPage = vi.fn(async ({ fromBlock }: { fromBlock: bigint }) =>
      fromBlock === 99n ? [incomingEvent(100n)] : []);
    const options = { confirmationDepth: 5n, scope, storage, isCurrent: () => true,
      dependencies: { getLatestBlockNumber, readIncomingPage,
        readCanonicalBlock: async (blockNumber: bigint) => canonicalBlock(blockNumber) } };
    const discovery = createDirectChatV2IncomingDiscovery(options);
    expect((await discovery.scan()).peers).toEqual([PEER]);
    getLatestBlockNumber.mockResolvedValue(10_000n);
    expect(await discovery.scan()).toMatchObject({ peers: [], changedPeers: [], hasMore: false });
    discovery.close();
    const reloaded = createDirectChatV2IncomingDiscovery(options);
    expect((await reloaded.scan()).peers).toEqual([]);
    expect(readIncomingPage).toHaveBeenCalledTimes(2);
    expect(storage.data.get(buildDirectChatV2IncomingDiscoveryStorageKey(scope)))
      .toContain('"activityBlocks":{}');
  });

  it('does not reuse the old full-archive checkpoint as recent coverage', async () => {
    const storage = memoryStorage();
    storage.data.set(buildDirectChatV2IncomingDiscoveryStorageKey(scope), JSON.stringify({
      schema: 'chainwhisper-direct-chat-v2-activity-discovery-v3', chainId: scope.chainId.toString(),
      contractAddress: CHAT, ownerAddress: OWNER, deploymentBlock: '99', nextBlock: '9996',
      lastScannedBlock: '9995', lastScannedBlockHash: canonicalBlock(9995n).hash, peers: [PEER]
    }));
    const readIncomingPage = vi.fn(async () => []);
    const discovery = createDirectChatV2IncomingDiscovery({ confirmationDepth: 5n, scope, storage,
      isCurrent: () => true, dependencies: { getLatestBlockNumber: async () => 10_000n,
        readCanonicalBlock: async blockNumber => canonicalBlock(blockNumber), readIncomingPage } });
    expect(await discovery.scan()).toMatchObject({ peers: [], scannedFromBlock: 7_948n, scannedToBlock: 9_995n });
    expect(readIncomingPage).toHaveBeenCalledOnce();
  });

  it('rejects a stale persisted boundary and restarts from the deployment block', async () => {
    const storage = memoryStorage();
    const canonicalHash = { value: 'aa' };
    const dependencies = {
      getLatestBlockNumber: vi.fn(async () => 110n),
      readCanonicalBlock: vi.fn(async (blockNumber: bigint) =>
        canonicalBlock(blockNumber, canonicalHash.value)
      ),
      readIncomingPage: vi.fn(async () => [] as DirectChatV2MessageEvent[])
    };
    const first = createDirectChatV2IncomingDiscovery({
      confirmationDepth: 5n,
      dependencies,
      isCurrent: () => true,
      scope,
      storage
    });
    await first.scan();
    first.close();

    canonicalHash.value = 'bb';
    const second = createDirectChatV2IncomingDiscovery({
      confirmationDepth: 5n,
      dependencies,
      isCurrent: () => true,
      scope,
      storage
    });
    const result = await second.scan();

    expect(result).toMatchObject({
      reorged: true,
      scannedFromBlock: 99n,
      scannedToBlock: 105n
    });
    expect(dependencies.readIncomingPage).toHaveBeenLastCalledWith({
      fromBlock: 99n,
      toBlock: 105n
    });
  });

  it('reports new finalized activity for an already known peer without repeating unchanged peers', async () => {
    const events = [incomingEvent(100n)];
    const dependencies = {
      getLatestBlockNumber: vi.fn(async () => 110n),
      readCanonicalBlock: vi.fn(async (blockNumber: bigint) => canonicalBlock(blockNumber)),
      readIncomingPage: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
        events.filter(event => event.blockNumber >= fromBlock && event.blockNumber <= toBlock))
    };
    const discovery = createDirectChatV2IncomingDiscovery({ confirmationDepth: 5n,
      dependencies, isCurrent: () => true, scope, storage: null });
    expect(await discovery.scan()).toMatchObject({ peers: [PEER], changedPeers: [PEER] });
    events.push(incomingEvent(110n), outgoingEvent(111n));
    dependencies.getLatestBlockNumber.mockResolvedValue(120n);
    expect(await discovery.scan()).toMatchObject({ peers: [PEER], changedPeers: [PEER],
      scannedFromBlock: 106n, scannedToBlock: 115n });
    expect(await discovery.scan()).toMatchObject({ peers: [PEER], changedPeers: [] });
    expect(dependencies.readIncomingPage).toHaveBeenCalledTimes(2);
  });

  it('rejects changed peers after scope replacement and replays the unapplied scan', async () => {
    const storage = memoryStorage();
    let current = true, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const readIncomingPage = vi.fn(async () => { await held; return [incomingEvent(100n)]; });
    const discovery = createDirectChatV2IncomingDiscovery({ confirmationDepth: 5n, scope, storage,
      isCurrent: () => true, dependencies: {
        getLatestBlockNumber: async () => 110n,
        readCanonicalBlock: async blockNumber => canonicalBlock(blockNumber), readIncomingPage
      } });
    const pending = discovery.scan(() => current);
    const rejected = expect(pending).rejects.toThrow('scope changed');
    await vi.waitFor(() => expect(readIncomingPage).toHaveBeenCalledOnce());
    current = false; release(); await rejected;
    expect(storage.data.size).toBe(0);
    current = true;
    expect(await discovery.scan(() => current)).toMatchObject({ peers: [PEER], changedPeers: [PEER], scannedFromBlock: 99n });
    expect((await discovery.scan()).changedPeers).toEqual([]);
  });

  it('does not advance when the canonical page boundary changes during the read', async () => {
    const storage = memoryStorage();
    const readCanonicalBlock = vi.fn()
      .mockResolvedValueOnce(canonicalBlock(105n, 'aa'))
      .mockResolvedValueOnce(canonicalBlock(105n, 'bb'));
    const discovery = createDirectChatV2IncomingDiscovery({
      confirmationDepth: 5n,
      dependencies: {
        getLatestBlockNumber: vi.fn(async () => 110n),
        readCanonicalBlock,
        readIncomingPage: vi.fn(async () => [])
      },
      isCurrent: () => true,
      scope,
      storage
    });

    await expect(discovery.scan()).rejects.toThrow('changed while it was being scanned');
    expect(storage.data.size).toBe(0);
  });

  it('fails closed after the owning session closes', async () => {
    const discovery = createDirectChatV2IncomingDiscovery({
      confirmationDepth: 5n,
      dependencies: {
        getLatestBlockNumber: vi.fn(async () => 110n),
        readCanonicalBlock: vi.fn(async (blockNumber) => canonicalBlock(blockNumber)),
        readIncomingPage: vi.fn(async () => [])
      },
      isCurrent: () => true,
      scope,
      storage: null
    });
    discovery.close();

    await expect(discovery.scan()).rejects.toThrow('scope changed');
  });
});
