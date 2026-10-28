import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectChatV2MessageEvent } from './directChatV2Chain';
import {
  buildDirectChatV2IncomingDiscoveryStorageKey,
  createDirectChatV2IncomingDiscovery,
  type DirectChatV2IncomingDiscoveryScope,
  type DirectChatV2IncomingDiscoveryStorage
} from './directChatV2IncomingDiscovery';

const OWNER = '0x1111111111111111111111111111111111111111';
const PEER = '0x2222222222222222222222222222222222222222';
const CHAT = '0x3333333333333333333333333333333333333333';
const scope: DirectChatV2IncomingDiscoveryScope = {
  chainId: 7_082_400n,
  contractAddress: CHAT,
  ownerAddress: OWNER,
  deploymentBlock: 99n
};

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

  it('scans finalized incoming and outgoing activity, persists a public checkpoint, and resumes', async () => {
    const storage = memoryStorage();
    const getLatestBlockNumber = vi.fn(async () => 10_000n);
    const readCanonicalBlock = vi.fn(async (blockNumber: bigint) => canonicalBlock(blockNumber));
    const readIncomingPage = vi.fn(async ({ fromBlock }: { fromBlock: bigint }) => (
      fromBlock === 99n ? [incomingEvent(100n), outgoingEvent(101n)] : []
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
      hasMore: true,
      reorged: false,
      scannedFromBlock: 99n,
      scannedToBlock: 8_290n
    });
    expect(readIncomingPage.mock.calls.map(([range]) => range)).toEqual([
      { fromBlock: 99n, toBlock: 2_146n },
      { fromBlock: 2_147n, toBlock: 4_194n },
      { fromBlock: 4_195n, toBlock: 6_242n },
      { fromBlock: 6_243n, toBlock: 8_290n }
    ]);
    const serialized = storage.data.get(buildDirectChatV2IncomingDiscoveryStorageKey(scope));
    expect(serialized).toContain('"nextBlock":"8291"');
    expect(serialized).toContain(`"peers":["${PEER}"]`);
    expect(serialized).not.toContain('ciphertext');

    const second = await discovery.scan();
    expect(second).toMatchObject({
      peers: [PEER],
      hasMore: false,
      scannedFromBlock: 8_291n,
      scannedToBlock: 9_995n
    });
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
      hasMore: false,
      reorged: false
    });
    expect(dependencies.readIncomingPage).not.toHaveBeenCalled();
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
