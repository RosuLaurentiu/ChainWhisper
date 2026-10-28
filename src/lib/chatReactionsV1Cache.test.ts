import { Interface } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  CHAT_REACTIONS_V1_ABI,
  deriveChatReactionSourceAnchor,
  parseChatReactionsV1Log,
  type ChatReactionSource,
  type ComparedChatReactionsV1Deployment
} from './chatReactionsV1';
import {
  createChatReactionsV1Cache,
  reduceCanonicalChatReactionCacheSnapshot,
  type ChatReactionsV1CacheStorage
} from './chatReactionsV1Cache';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const hash = (value: string) => `0x${value.padStart(64, '0')}`;
const REACTIONS = address('11');
const DIRECT = address('22');
const GROUP = address('33');
const ALICE = address('44');
const CONVERSATION = hash('55');
const CHECKPOINT_HASH = hash('99');
const deployment: ComparedChatReactionsV1Deployment = Object.freeze({
  chainId: '7082400',
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
});
const source: ChatReactionSource = Object.freeze({
  kind: 'direct',
  chainId: deployment.chainId,
  contractAddress: DIRECT,
  conversationId: CONVERSATION,
  messageId: '7',
  blockHash: hash('77'),
  transactionHash: hash('78'),
  logIndex: 2
});

class MemoryStorage implements ChatReactionsV1CacheStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const observation = ({
  active = true,
  blockNumber = 120,
  transactionSeed = 0x89
}: {
  active?: boolean;
  blockNumber?: number;
  transactionSeed?: number;
} = {}) => {
  const abi = new Interface(CHAT_REACTIONS_V1_ABI);
  const event = abi.getEvent('DirectReactionSet');
  if (!event) throw new Error('Direct reaction ABI missing.');
  const encoded = abi.encodeEventLog(event, [
    CONVERSATION,
    7n,
    ALICE,
    1,
    active,
    deriveChatReactionSourceAnchor(source)
  ]);
  return parseChatReactionsV1Log({
    deployment,
    observedChainId: deployment.chainId,
    log: {
      address: REACTIONS,
      topics: encoded.topics,
      data: encoded.data,
      blockHash: hash(blockNumber.toString(16)),
      blockNumber: blockNumber.toString(),
      transactionHash: hash(transactionSeed.toString(16)),
      transactionIndex: 1,
      index: 3,
      removed: false
    }
  });
};

describe('ChatReactionsV1 finalized public cache', () => {
  it('round-trips exact public logs and revalidates their source anchor after checkpoint acceptance', () => {
    const storage = new MemoryStorage();
    const cache = createChatReactionsV1Cache({ storage });
    cache.save({
      deployment,
      finalityLagBlocks: 5n,
      checkpointBlock: '125',
      checkpointHash: CHECKPOINT_HASH,
      observations: [observation()]
    });

    const serialized = [...storage.values.values()][0] ?? '';
    expect(serialized).toContain('"checkpointBlock":"125"');
    expect(serialized).toContain(REACTIONS);
    expect(serialized).not.toMatch(/plaintext|ciphertext|aesKey|privateKey|pending/i);

    const candidate = cache.load({ deployment, finalityLagBlocks: 5n });
    expect(candidate).not.toBeNull();
    const snapshot = cache.accept({
      candidate: candidate!,
      canonicalCheckpointHash: CHECKPOINT_HASH
    });
    const reduced = reduceCanonicalChatReactionCacheSnapshot(snapshot, [source]);
    expect(reduced.accepted).toHaveLength(1);
    expect(reduced.states[0]).toMatchObject({ active: true, messageId: '7' });
  });

  it('rejects a stale canonical checkpoint and structural candidates', () => {
    const storage = new MemoryStorage();
    const cache = createChatReactionsV1Cache({ storage });
    cache.save({
      deployment,
      finalityLagBlocks: 5n,
      checkpointBlock: '125',
      checkpointHash: CHECKPOINT_HASH,
      observations: [observation()]
    });
    const candidate = cache.load({ deployment, finalityLagBlocks: 5n });
    expect(() => cache.accept({
      candidate: candidate!,
      canonicalCheckpointHash: hash('aa')
    })).toThrow('no longer canonical');
    expect(() => cache.accept({
      candidate: { checkpointBlock: '125', checkpointHash: CHECKPOINT_HASH } as never,
      canonicalCheckpointHash: CHECKPOINT_HASH
    })).toThrow('unverified');

    const otherCache = createChatReactionsV1Cache({ storage });
    expect(() => otherCache.accept({
      candidate: candidate!,
      canonicalCheckpointHash: CHECKPOINT_HASH
    })).toThrow('unverified');
  });

  it('deletes corrupted records and ignores another deployment/finality scope', () => {
    const storage = new MemoryStorage();
    const cache = createChatReactionsV1Cache({ storage });
    cache.save({
      deployment,
      finalityLagBlocks: 5n,
      checkpointBlock: '125',
      checkpointHash: CHECKPOINT_HASH,
      observations: [observation()]
    });
    const [key, raw] = [...storage.values.entries()][0] ?? [];
    if (!key || !raw) throw new Error('Expected cached record.');
    storage.values.set(key, raw.replace('"checkpointBlock":"125"', '"checkpointBlock":"124"'));

    expect(cache.load({ deployment, finalityLagBlocks: 5n })).toBeNull();
    expect(storage.values.has(key)).toBe(false);

    cache.save({
      deployment,
      finalityLagBlocks: 5n,
      checkpointBlock: '125',
      checkpointHash: CHECKPOINT_HASH,
      observations: [observation()]
    });
    expect(cache.load({ deployment, finalityLagBlocks: 6n })).toBeNull();
    expect(cache.load({
      deployment: { ...deployment, runtimeBytecodeHash: hash('ff') },
      finalityLagBlocks: 5n
    })).toBeNull();
  });

  it('compacts long toggle history to the latest canonical state per reaction key', () => {
    const storage = new MemoryStorage();
    const cache = createChatReactionsV1Cache({ storage });
    const first = observation();
    const toggles = Array.from({ length: 4_500 }, (_, index) => Object.freeze({
      ...first,
      active: index % 2 === 0,
      blockHash: hash((120 + index).toString(16)),
      blockNumber: (120 + index).toString(),
      transactionHash: hash((0x1000 + index).toString(16)),
      rawIdentity: `long-toggle:${index}`
    }));
    cache.save({
      deployment,
      finalityLagBlocks: 5n,
      checkpointBlock: '5000',
      checkpointHash: CHECKPOINT_HASH,
      observations: toggles
    });

    const serialized = [...storage.values.values()][0];
    expect(serialized).toBeDefined();
    const parsed = JSON.parse(serialized!) as { logs: unknown[] };
    expect(parsed.logs).toHaveLength(1);
    const candidate = cache.load({ deployment, finalityLagBlocks: 5n });
    const snapshot = cache.accept({
      candidate: candidate!,
      canonicalCheckpointHash: CHECKPOINT_HASH
    });
    const reduced = reduceCanonicalChatReactionCacheSnapshot(snapshot, [source]);
    expect(reduced.states).toHaveLength(1);
    expect(reduced.states[0]?.active).toBe(false);
    expect(reduced.states[0]?.blockNumber).toBe('4619');
  });
});
