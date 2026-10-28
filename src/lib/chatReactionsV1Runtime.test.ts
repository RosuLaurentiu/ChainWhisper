import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  bindOwner: vi.fn(),
  release: vi.fn(),
  setReaction: vi.fn()
}));
const chainMocks = vi.hoisted(() => ({
  attest: vi.fn(),
  bindRead: vi.fn(),
  latest: vi.fn(),
  readRange: vi.fn(),
  reduce: vi.fn()
}));

vi.mock('./chatReactionsV1Actions', () => ({
  bindChatReactionsV1OwnerDeployment: actionMocks.bindOwner,
  releaseChatReactionsV1MetaMaskCapability: actionMocks.release,
  setChatReactionsV1Reaction: actionMocks.setReaction
}));
vi.mock('./chatReactionsV1Chain', () => ({
  CHAT_REACTIONS_V1_MAX_LOG_RANGE_BLOCKS: 2_048n,
  attestChatReactionsV1Deployment: chainMocks.attest,
  bindChatReactionsV1ReadCapability: chainMocks.bindRead,
  readCanonicalChatReactionsV1LogRange: chainMocks.readRange,
  readChatReactionsV1LatestBlock: chainMocks.latest,
  reduceCanonicalChatReactionRangePage: chainMocks.reduce,
  isChatReactionsV1DenseRangeError: (error: unknown) =>
    error instanceof Error && error.message === 'dense reaction range'
}));

import {
  deriveChatReactionSourceAnchor,
  getChatReactionEmoji,
  type ChatReactionObservation,
  type ChatReactionSource
} from './chatReactionsV1';
import type {
  ChatReactionsV1MetaMaskCapability
} from './chatReactionsV1Actions';
import {
  createChatReactionsV1Cache,
  type ChatReactionsV1CacheStorage
} from './chatReactionsV1Cache';
import type {
  AttestedChatReactionsV1Deployment,
  CanonicalChatReactionRangePage
} from './chatReactionsV1Chain';
import type { ChatReactionsV1DeploymentConfig } from './chatReactionsV1Deployment';
import {
  assertChatReactionsV1Runtime,
  createChatReactionsV1Runtime
} from './chatReactionsV1Runtime';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const hash = (value: bigint | string) => {
  const text = typeof value === 'bigint' ? value.toString(16) : value;
  return `0x${text.padStart(64, '0')}`;
};
const CHAIN_ID = 7_082_400n;
const REACTIONS = address('11');
const DIRECT = address('22');
const GROUP = address('33');
const ALICE = address('44');
const CONVERSATION_ID = hash('55');
const capability = Object.freeze({}) as ChatReactionsV1MetaMaskCapability;
const readCapability = Object.freeze({});
const readProvider = Object.freeze({ send: vi.fn() }) as never;
const deployment = Object.freeze({
  chainId: CHAIN_ID.toString(),
  contractAddress: REACTIONS,
  deploymentBlock: '100',
  runtimeBytecodeHash: hash('11'),
  directChatV2: Object.freeze({
    contractAddress: DIRECT,
    deploymentBlock: '10',
    runtimeBytecodeHash: hash('22')
  }),
  groupChatV2: Object.freeze({
    contractAddress: GROUP,
    deploymentBlock: '20',
    runtimeBytecodeHash: hash('33')
  })
}) as unknown as AttestedChatReactionsV1Deployment;
const config = Object.freeze({
  status: 'active',
  manifest: Object.freeze({
    chainId: CHAIN_ID,
    contractAddress: REACTIONS,
    deploymentBlock: 100n,
    runtimeBytecodeHash: hash('11'),
    directChatV2: Object.freeze({
      contractAddress: DIRECT,
      deploymentBlock: 10n,
      runtimeBytecodeHash: hash('22')
    }),
    groupChatV2: Object.freeze({
      contractAddress: GROUP,
      deploymentBlock: 20n,
      runtimeBytecodeHash: hash('33')
    })
  }),
  finalityLagBlocks: 5n,
  fingerprint: 'reaction-runtime-test'
}) as Extract<ChatReactionsV1DeploymentConfig, { status: 'active' }>;
const source: ChatReactionSource = Object.freeze({
  kind: 'direct',
  chainId: CHAIN_ID.toString(),
  contractAddress: DIRECT,
  conversationId: CONVERSATION_ID,
  messageId: '7',
  blockHash: hash('77'),
  transactionHash: hash('88'),
  logIndex: 1
});
const runOwnerTransactionFlow = <T>(operation: () => Promise<T>): Promise<T> => operation();
let getOwnerCapability: Mock<() => Promise<ChatReactionsV1MetaMaskCapability>>;

class MemoryStorage implements ChatReactionsV1CacheStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const observation = ({
  blockNumber,
  active,
  stateKey = 'same-state'
}: {
  blockNumber: bigint;
  active: boolean;
  stateKey?: string;
}): ChatReactionObservation => Object.freeze({
  kind: 'direct',
  chainId: CHAIN_ID.toString(),
  reactionsContract: REACTIONS,
  targetContract: DIRECT,
  conversationId: CONVERSATION_ID,
  messageId: '7',
  reactor: ALICE,
  emojiId: 1,
  emoji: getChatReactionEmoji(1),
  active,
  messageAnchor: deriveChatReactionSourceAnchor(source),
  blockHash: hash(blockNumber),
  blockNumber: blockNumber.toString(),
  transactionHash: hash(blockNumber + 10_000n),
  transactionIndex: 0,
  logIndex: 0,
  removed: false,
  rawIdentity: `raw:${blockNumber}`,
  stateKey
});

let latestBlock: bigint;
let canonicalHashes: Map<string, string>;
let observations: Map<string, readonly ChatReactionObservation[]>;

const page = (fromBlock: bigint, toBlock: bigint): CanonicalChatReactionRangePage => ({
  range: {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    fromBlockHash: canonicalHashes.get(fromBlock.toString()) ?? hash(fromBlock),
    toBlockHash: canonicalHashes.get(toBlock.toString()) ?? hash(toBlock)
  },
  safeHead: {
    number: (latestBlock - 5n).toString(),
    hash: canonicalHashes.get((latestBlock - 5n).toString()) ?? hash(latestBlock - 5n)
  },
  checkedBlocks: [],
  finalityLagBlocks: '5',
  observations: observations.get(`${fromBlock}:${toBlock}`) ?? []
}) as unknown as CanonicalChatReactionRangePage;

describe('ChatReactionsV1 runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestBlock = 4_200n;
    canonicalHashes = new Map();
    observations = new Map();
    getOwnerCapability = vi.fn(async () => capability);
    actionMocks.bindOwner.mockResolvedValue(undefined);
    chainMocks.bindRead.mockResolvedValue(readCapability);
    chainMocks.attest.mockResolvedValue(deployment);
    chainMocks.latest.mockImplementation(async () => latestBlock);
    chainMocks.readRange.mockImplementation(async ({
      fromBlock,
      toBlock
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) => page(fromBlock, toBlock));
    chainMocks.reduce.mockImplementation((input: CanonicalChatReactionRangePage) => ({
      accepted: input.observations,
      states: input.observations,
      ignored: []
    }));
  });

  it('builds one canonical snapshot across bounded pages and applies last-write-wins globally', async () => {
    observations.set('100:2147', [observation({ blockNumber: 120n, active: true })]);
    observations.set('2148:4195', [observation({ blockNumber: 3_000n, active: false })]);
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });

    const result = await runtime.sync([source]);

    expect(getOwnerCapability).not.toHaveBeenCalled();
    expect(chainMocks.readRange.mock.calls.map(([input]) => [input.fromBlock, input.toBlock])).toEqual([
      [100n, 2_147n],
      [2_148n, 4_195n],
      [4_195n, 4_195n]
    ]);
    expect(result.rebuilt).toBe(true);
    expect(result.safeHeadBlock).toBe('4195');
    expect(result.safeHeadBlockHash).toBe(hash(4_195n));
    expect(result.accepted).toHaveLength(2);
    expect(result.states).toHaveLength(1);
    expect(result.states[0]?.active).toBe(false);
    expect(assertChatReactionsV1Runtime(runtime)).toBe(runtime);
  });

  it('adaptively splits a dense range without weakening the per-page verifier', async () => {
    chainMocks.readRange.mockImplementation(async ({
      fromBlock,
      toBlock
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) => {
      if (fromBlock === 100n && toBlock === 2_147n) throw new Error('dense reaction range');
      return page(fromBlock, toBlock);
    });
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });

    await expect(runtime.sync([source])).resolves.toMatchObject({ safeHeadBlock: '4195' });
    expect(chainMocks.readRange.mock.calls.map(([input]) => [input.fromBlock, input.toBlock])).toContainEqual([
      100n,
      1_123n
    ]);
    expect(chainMocks.readRange.mock.calls.map(([input]) => [input.fromBlock, input.toBlock])).toContainEqual([
      1_124n,
      2_147n
    ]);
  });

  it('validates the old checkpoint, appends only finalized ranges, and rebuilds after a reorg', async () => {
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    await runtime.sync([source]);
    chainMocks.readRange.mockClear();

    latestBlock = 4_205n;
    const appended = await runtime.sync([source]);
    expect(appended.rebuilt).toBe(false);
    expect(chainMocks.readRange.mock.calls.map(([input]) => [input.fromBlock, input.toBlock])).toEqual([
      [4_195n, 4_195n],
      [4_196n, 4_200n],
      [4_200n, 4_200n]
    ]);

    chainMocks.readRange.mockClear();
    canonicalHashes.set('4200', hash('ff'));
    const rebuilt = await runtime.sync([source]);
    expect(rebuilt.rebuilt).toBe(true);
    expect(chainMocks.readRange.mock.calls.map(([input]) => [input.fromBlock, input.toBlock])).toEqual([
      [4_200n, 4_200n],
      [100n, 2_147n],
      [2_148n, 4_195n],
      [4_196n, 4_200n],
      [4_200n, 4_200n]
    ]);
  });

  it('does not commit an appended page when its final canonical fence changes', async () => {
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    await runtime.sync([source]);
    latestBlock = 4_205n;
    let fenceReads = 0;
    chainMocks.readRange.mockImplementation(async ({
      fromBlock,
      toBlock
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) => {
      const result = page(fromBlock, toBlock);
      if (fromBlock === 4_200n && toBlock === 4_200n) {
        fenceReads += 1;
        if (fenceReads === 1) {
          return {
            ...result,
            range: { ...result.range, fromBlockHash: hash('fe'), toBlockHash: hash('fe') }
          } as CanonicalChatReactionRangePage;
        }
      }
      return result;
    });

    await expect(runtime.sync([source])).rejects.toThrow('changed during synchronization');
    chainMocks.readRange.mockClear();
    await expect(runtime.sync([source])).resolves.toMatchObject({ safeHeadBlock: '4200' });
    expect(chainMocks.readRange.mock.calls.some(([input]) => input.fromBlock === 4_196n)).toBe(true);
  });

  it('restores a finalized cache after fencing its checkpoint and skips old ranges', async () => {
    const storage = new MemoryStorage();
    const cache = createChatReactionsV1Cache({ storage });
    observations.set('100:2147', [observation({ blockNumber: 120n, active: true })]);
    const first = await createChatReactionsV1Runtime({
      config,
      cache,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    await first.sync([source]);
    first.close();

    chainMocks.readRange.mockClear();
    const restored = await createChatReactionsV1Runtime({
      config,
      cache: createChatReactionsV1Cache({ storage }),
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    const result = await restored.sync([source]);

    expect(result.restoredFromCache).toBe(true);
    expect(result.states).toHaveLength(1);
    expect(result.states[0]?.active).toBe(true);
    expect(chainMocks.readRange.mock.calls).not.toHaveLength(0);
    expect(chainMocks.readRange.mock.calls.every(([input]) => (
      input.fromBlock === 4_195n && input.toBlock === 4_195n
    ))).toBe(true);
  });

  it('discards a cached checkpoint after a reorg and replays from deployment', async () => {
    const storage = new MemoryStorage();
    const cache = createChatReactionsV1Cache({ storage });
    const first = await createChatReactionsV1Runtime({
      config,
      cache,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    await first.sync([source]);
    first.close();

    chainMocks.readRange.mockClear();
    canonicalHashes.set('4195', hash('ff'));
    const restored = await createChatReactionsV1Runtime({
      config,
      cache: createChatReactionsV1Cache({ storage }),
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    const result = await restored.sync([source]);

    expect(result.restoredFromCache).toBe(false);
    expect(chainMocks.readRange.mock.calls.some(([input]) => input.fromBlock === 100n)).toBe(true);
  });

  it('rejects an old reaction when a deep source reorg reuses the same message ID', async () => {
    const storage = new MemoryStorage();
    const cache = createChatReactionsV1Cache({ storage });
    observations.set('100:2147', [observation({ blockNumber: 120n, active: true })]);
    const first = await createChatReactionsV1Runtime({
      config,
      cache,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    await first.sync([source]);
    first.close();

    const replacementSource = Object.freeze({
      ...source,
      blockHash: hash('aa'),
      transactionHash: hash('bb'),
      logIndex: 2
    });
    chainMocks.readRange.mockClear();
    const restored = await createChatReactionsV1Runtime({
      config,
      cache: createChatReactionsV1Cache({ storage }),
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    const result = await restored.sync([replacementSource]);

    expect(result.restoredFromCache).toBe(true);
    expect(result.states).toHaveLength(0);
    expect(result.ignored).toContainEqual(expect.objectContaining({ reason: 'anchor-mismatch' }));
  });

  it('keeps canonical synchronization available when cache persistence fails', async () => {
    const cache = createChatReactionsV1Cache({
      storage: {
        getItem: () => null,
        setItem: () => { throw new Error('quota'); },
        removeItem: () => undefined
      }
    });
    const runtime = await createChatReactionsV1Runtime({
      config,
      cache,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });

    await expect(runtime.sync([source])).resolves.toMatchObject({
      safeHeadBlock: '4195',
      restoredFromCache: false
    });
  });

  it('serializes public writes through the verified runtime and fails closed after close', async () => {
    const writeResult = Object.freeze({ transactionHash: hash('aa') });
    actionMocks.setReaction.mockResolvedValue(writeResult);
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    await expect(runtime.setReaction({
      source,
      emoji: '👍',
      active: true,
      operationId: 'runtime-write'
    })).resolves.toBe(writeResult);
    expect(actionMocks.setReaction).toHaveBeenCalledWith(expect.objectContaining({
      capability,
      deployment,
      source,
      emoji: '👍',
      active: true
    }));

    runtime.close();
    runtime.close();
    await Promise.resolve();
    expect(actionMocks.release).toHaveBeenCalledOnce();
    expect(actionMocks.release).toHaveBeenCalledWith(capability);
    await expect(runtime.sync([source])).rejects.toThrow('closed');
    expect(() => assertChatReactionsV1Runtime({} as never)).toThrow('verified factory');
  });

  it('submits the immutable reaction intent captured before queued wallet work', async () => {
    const writeResult = Object.freeze({ transactionHash: hash('ab') });
    actionMocks.setReaction.mockResolvedValue(writeResult);
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    const input = {
      source,
      emoji: 'reaction-test',
      active: true,
      operationId: 'original-operation'
    };

    const pending = runtime.setReaction(input);
    input.active = false;
    input.operationId = 'mutated-operation';
    await expect(pending).resolves.toBe(writeResult);

    expect(actionMocks.setReaction).toHaveBeenLastCalledWith(expect.objectContaining({
      active: true,
      operationId: 'original-operation'
    }));
  });

  it('attests publicly at startup and lazily reuses one owner capability across clicks', async () => {
    actionMocks.setReaction.mockResolvedValue(Object.freeze({ transactionHash: hash('ac') }));
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });

    await runtime.setReaction({
      source,
      emoji: 'reaction-test',
      active: true,
      operationId: 'runtime-capability'
    });
    await runtime.setReaction({
      source,
      emoji: 'reaction-test',
      active: false,
      operationId: 'runtime-capability-second'
    });

    expect(chainMocks.attest).toHaveBeenCalledOnce();
    expect(getOwnerCapability).toHaveBeenCalledOnce();
    expect(actionMocks.bindOwner).toHaveBeenCalledOnce();
    expect(actionMocks.setReaction).toHaveBeenCalledWith(expect.objectContaining({
      capability,
      deployment
    }));
    expect(actionMocks.release).not.toHaveBeenCalled();
    runtime.close();
  });

  it('reacquires once when the owner lease expires before the reaction reaches the wallet', async () => {
    const replacementCapability = Object.freeze({ replacement: true }) as unknown as ChatReactionsV1MetaMaskCapability;
    getOwnerCapability
      .mockResolvedValueOnce(capability)
      .mockResolvedValueOnce(replacementCapability);
    actionMocks.setReaction
      .mockRejectedValueOnce(new Error('Owner wallet session changed.'))
      .mockResolvedValueOnce(Object.freeze({ transactionHash: hash('ad') }));
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });
    const input = {
      source,
      emoji: 'reaction-test',
      active: true,
      operationId: 'stale-capability'
    };

    await expect(runtime.setReaction(input)).resolves.toEqual({ transactionHash: hash('ad') });
    await vi.waitFor(() => expect(actionMocks.release).toHaveBeenCalledWith(capability));

    expect(getOwnerCapability).toHaveBeenCalledTimes(2);
    expect(actionMocks.bindOwner).toHaveBeenCalledTimes(2);
    expect(actionMocks.setReaction).toHaveBeenLastCalledWith(expect.objectContaining({
      capability: replacementCapability
    }));
    runtime.close();
  });

  it('does not retry a wallet rejection, transport failure, or on-chain action error', async () => {
    getOwnerCapability.mockResolvedValue(capability);
    actionMocks.setReaction.mockRejectedValueOnce(new Error('execution reverted'));
    const runtime = await createChatReactionsV1Runtime({
      config,
      getOwnerCapability,
      readProvider,
      runOwnerTransactionFlow
    });

    await expect(runtime.setReaction({
      source,
      emoji: 'reaction-test',
      active: true,
      operationId: 'must-not-retry'
    })).rejects.toThrow('execution reverted');
    expect(getOwnerCapability).toHaveBeenCalledOnce();
    expect(actionMocks.setReaction).toHaveBeenCalledOnce();
    runtime.close();
  });
});
