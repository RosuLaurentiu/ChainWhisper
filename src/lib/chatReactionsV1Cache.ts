import { Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import {
  CHAT_REACTIONS_V1_ABI,
  chatReactionObservationsEqual,
  chatReactionStableTargetKey,
  chatReactionTargetOf,
  compareChatReactionObservationOrder,
  createChatReactionSourceResolver,
  deriveChatReactionSourceAnchor,
  normalizeChatReactionSource,
  parseChatReactionsV1Log,
  type ChatReactionObservation,
  type ChatReactionReducedState,
  type ChatReactionSource,
  type ComparedChatReactionsV1Deployment
} from './chatReactionsV1';

const CACHE_SCHEMA = 1;
const CACHE_PREFIX = 'chainwhisper:chat-reactions-v1:';
const MAX_CACHED_LOGS = 4_096;
const MAX_CACHE_BYTES = 4_500_000;
const BYTES32 = /^0x[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const REACTIONS_INTERFACE = new Interface(CHAT_REACTIONS_V1_ABI);

export type ChatReactionsV1CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

declare const CHAT_REACTIONS_V1_CACHE_CANDIDATE_BRAND: unique symbol;
export type ChatReactionsV1CacheCandidate = Readonly<{
  checkpointBlock: string;
  checkpointHash: string;
  readonly [CHAT_REACTIONS_V1_CACHE_CANDIDATE_BRAND]: true;
}>;

declare const CANONICAL_CHAT_REACTIONS_V1_CACHE_BRAND: unique symbol;
export type CanonicalChatReactionsV1CacheSnapshot = Readonly<{
  checkpointBlock: string;
  checkpointHash: string;
  observations: readonly ChatReactionObservation[];
  readonly [CANONICAL_CHAT_REACTIONS_V1_CACHE_BRAND]: true;
}>;

declare const CHAT_REACTIONS_V1_CACHE_BRAND: unique symbol;
export type ChatReactionsV1Cache = Readonly<{
  readonly [CHAT_REACTIONS_V1_CACHE_BRAND]: true;
  load(input: Readonly<{
    deployment: ComparedChatReactionsV1Deployment;
    finalityLagBlocks: bigint;
  }>): ChatReactionsV1CacheCandidate | null;
  accept(input: Readonly<{
    candidate: ChatReactionsV1CacheCandidate;
    canonicalCheckpointHash: string;
  }>): CanonicalChatReactionsV1CacheSnapshot;
  save(input: Readonly<{
    deployment: ComparedChatReactionsV1Deployment;
    finalityLagBlocks: bigint;
    checkpointBlock: string;
    checkpointHash: string;
    observations: readonly ChatReactionObservation[];
  }>): void;
  clear(input: Readonly<{
    deployment: ComparedChatReactionsV1Deployment;
    finalityLagBlocks: bigint;
  }>): void;
}>;

type ChatReactionsV1CacheImplementation = Omit<
  ChatReactionsV1Cache,
  typeof CHAT_REACTIONS_V1_CACHE_BRAND
>;

type CachedRawLog = Readonly<{
  address: string;
  topics: readonly string[];
  data: string;
  blockHash: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: number;
  index: number;
  removed: false;
}>;

type CachePayload = Readonly<{
  schema: 1;
  scope: string;
  checkpointBlock: string;
  checkpointHash: string;
  logs: readonly CachedRawLog[];
}>;

type CandidateBinding = Readonly<{
  cacheToken: object;
  scope: string;
  observations: readonly ChatReactionObservation[];
}>;

const CACHES = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateBinding>();
const SNAPSHOTS = new WeakMap<object, CandidateBinding>();

const canonicalHash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !BYTES32.test(value.toLowerCase()) || /^0x0{64}$/.test(value.toLowerCase())) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return value.toLowerCase();
};

const canonicalDecimal = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new Error(`${label} must be canonical unsigned decimal.`);
  }
  return value;
};

const exactKeys = (value: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected fields.`);
  }
  return record;
};

const scopeFor = (
  deployment: ComparedChatReactionsV1Deployment,
  finalityLagBlocks: bigint
): string => {
  if (!deployment || typeof deployment !== 'object' || finalityLagBlocks <= 0n) {
    throw new Error('Reaction cache requires an attested deployment scope and non-zero finality lag.');
  }
  return JSON.stringify({
    chainId: deployment.chainId,
    reactions: [
      deployment.contractAddress.toLowerCase(),
      deployment.deploymentBlock,
      deployment.runtimeBytecodeHash.toLowerCase()
    ],
    direct: [
      deployment.directChatV2.contractAddress.toLowerCase(),
      deployment.directChatV2.deploymentBlock,
      deployment.directChatV2.runtimeBytecodeHash.toLowerCase()
    ],
    group: [
      deployment.groupChatV2.contractAddress.toLowerCase(),
      deployment.groupChatV2.deploymentBlock,
      deployment.groupChatV2.runtimeBytecodeHash.toLowerCase()
    ],
    finalityLagBlocks: finalityLagBlocks.toString()
  });
};

const storageKey = (scope: string): string => `${CACHE_PREFIX}${keccak256(toUtf8Bytes(scope))}`;
const payloadHash = (payload: CachePayload): string => keccak256(toUtf8Bytes(JSON.stringify(payload)));

const encodeObservation = (observation: ChatReactionObservation): CachedRawLog => {
  if (observation.removed) throw new Error('Removed reaction observations cannot be cached.');
  const eventName = observation.kind === 'direct' ? 'DirectReactionSet' : 'GroupReactionSet';
  const event = REACTIONS_INTERFACE.getEvent(eventName);
  if (!event) throw new Error('Reaction cache event ABI is unavailable.');
  const encoded = REACTIONS_INTERFACE.encodeEventLog(event, [
    observation.kind === 'direct' ? observation.conversationId : observation.groupId,
    observation.messageId,
    observation.reactor,
    observation.emojiId,
    observation.active,
    observation.messageAnchor
  ]);
  return Object.freeze({
    address: observation.reactionsContract,
    topics: Object.freeze([...encoded.topics]),
    data: encoded.data,
    blockHash: observation.blockHash,
    blockNumber: observation.blockNumber,
    transactionHash: observation.transactionHash,
    transactionIndex: observation.transactionIndex,
    index: observation.logIndex,
    removed: false
  });
};

const parsePayload = ({
  raw,
  deployment,
  expectedScope
}: {
  raw: string;
  deployment: ComparedChatReactionsV1Deployment;
  expectedScope: string;
}): Readonly<{
  checkpointBlock: string;
  checkpointHash: string;
  observations: readonly ChatReactionObservation[];
}> => {
  if (raw.length > MAX_CACHE_BYTES) throw new Error('Reaction cache exceeds its byte limit.');
  const parsed = JSON.parse(raw) as unknown;
  const record = exactKeys(
    parsed,
    ['schema', 'scope', 'checkpointBlock', 'checkpointHash', 'logs', 'contentHash'],
    'Reaction cache record'
  );
  if (record.schema !== CACHE_SCHEMA || record.scope !== expectedScope || !Array.isArray(record.logs)) {
    throw new Error('Reaction cache scope or schema is stale.');
  }
  if (record.logs.length > MAX_CACHED_LOGS) throw new Error('Reaction cache has too many logs.');
  const checkpointBlock = canonicalDecimal(record.checkpointBlock, 'Reaction cache checkpoint block');
  const checkpointHash = canonicalHash(record.checkpointHash, 'Reaction cache checkpoint hash');
  if (BigInt(checkpointBlock) < BigInt(deployment.deploymentBlock)) {
    throw new Error('Reaction cache checkpoint predates deployment.');
  }
  const payload: CachePayload = Object.freeze({
    schema: CACHE_SCHEMA,
    scope: expectedScope,
    checkpointBlock,
    checkpointHash,
    logs: record.logs as CachedRawLog[]
  });
  if (canonicalHash(record.contentHash, 'Reaction cache content hash') !== payloadHash(payload)) {
    throw new Error('Reaction cache content hash is invalid.');
  }

  const byIdentity = new Map<string, ChatReactionObservation>();
  for (const rawLog of payload.logs) {
    exactKeys(
      rawLog,
      ['address', 'topics', 'data', 'blockHash', 'blockNumber', 'transactionHash', 'transactionIndex', 'index', 'removed'],
      'Reaction cache log'
    );
    const observation = parseChatReactionsV1Log({
      deployment,
      observedChainId: deployment.chainId,
      log: rawLog
    });
    if (observation.removed || BigInt(observation.blockNumber) > BigInt(checkpointBlock)) {
      throw new Error('Reaction cache log is outside its finalized checkpoint.');
    }
    const previous = byIdentity.get(observation.rawIdentity);
    if (previous && !chatReactionObservationsEqual(previous, observation)) {
      throw new Error('Reaction cache contains conflicting physical log identities.');
    }
    byIdentity.set(observation.rawIdentity, observation);
  }
  return Object.freeze({
    checkpointBlock,
    checkpointHash,
    observations: Object.freeze([...byIdentity.values()].sort(compareChatReactionObservationOrder))
  });
};

const buildCandidate = ({
  cacheToken,
  scope,
  checkpointBlock,
  checkpointHash,
  observations
}: CandidateBinding & { checkpointBlock: string; checkpointHash: string }): ChatReactionsV1CacheCandidate => {
  const candidate = Object.freeze({ checkpointBlock, checkpointHash }) as ChatReactionsV1CacheCandidate;
  CANDIDATES.set(candidate, Object.freeze({ cacheToken, scope, observations }));
  return candidate;
};

export const createChatReactionsV1Cache = ({
  storage
}: {
  storage: ChatReactionsV1CacheStorage;
}): ChatReactionsV1Cache => {
  if (!storage || ['getItem', 'setItem', 'removeItem'].some((method) => typeof storage[method as keyof typeof storage] !== 'function')) {
    throw new Error('Reaction cache requires a storage implementation.');
  }
  const cacheToken = Object.freeze({});

  const clear = ({ deployment, finalityLagBlocks }: {
    deployment: ComparedChatReactionsV1Deployment;
    finalityLagBlocks: bigint;
  }): void => {
    const scope = scopeFor(deployment, finalityLagBlocks);
    storage.removeItem(storageKey(scope));
  };

  const implementation: ChatReactionsV1CacheImplementation = {
    load: ({ deployment, finalityLagBlocks }) => {
      const scope = scopeFor(deployment, finalityLagBlocks);
      const key = storageKey(scope);
      try {
        const raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = parsePayload({ raw, deployment, expectedScope: scope });
        return buildCandidate({ cacheToken, scope, ...parsed });
      } catch {
        try { storage.removeItem(key); } catch { /* best-effort public cache */ }
        return null;
      }
    },
    accept: ({ candidate, canonicalCheckpointHash }) => {
      const binding = candidate && CANDIDATES.get(candidate);
      if (!binding || binding.cacheToken !== cacheToken) {
        throw new Error('Reaction cache candidate is unverified.');
      }
      if (canonicalHash(canonicalCheckpointHash, 'Canonical reaction checkpoint hash') !== candidate.checkpointHash) {
        throw new Error('Reaction cache checkpoint is no longer canonical.');
      }
      const snapshot = Object.freeze({
        checkpointBlock: candidate.checkpointBlock,
        checkpointHash: candidate.checkpointHash,
        observations: binding.observations
      }) as CanonicalChatReactionsV1CacheSnapshot;
      SNAPSHOTS.set(snapshot, binding);
      return snapshot;
    },
    save: ({ deployment, finalityLagBlocks, checkpointBlock, checkpointHash, observations }) => {
      const scope = scopeFor(deployment, finalityLagBlocks);
      const normalizedCheckpointBlock = canonicalDecimal(checkpointBlock, 'Reaction cache checkpoint block');
      const normalizedCheckpointHash = canonicalHash(checkpointHash, 'Reaction cache checkpoint hash');
      if (BigInt(normalizedCheckpointBlock) < BigInt(deployment.deploymentBlock)) {
        throw new Error('Reaction cache checkpoint predates deployment.');
      }
      const byIdentity = new Map<string, ChatReactionObservation>();
      for (const observation of observations) {
        if (BigInt(observation.blockNumber) > BigInt(normalizedCheckpointBlock)) {
          throw new Error('Reaction cache observation is newer than its checkpoint.');
        }
        const previous = byIdentity.get(observation.rawIdentity);
        if (previous && !chatReactionObservationsEqual(previous, observation)) {
          throw new Error('Reaction cache observations conflict.');
        }
        byIdentity.set(observation.rawIdentity, observation);
      }
      const latestByState = new Map<string, ChatReactionObservation>();
      for (const observation of [...byIdentity.values()].sort(compareChatReactionObservationOrder)) {
        latestByState.set(observation.stateKey, observation);
      }
      if (latestByState.size > MAX_CACHED_LOGS) {
        clear({ deployment, finalityLagBlocks });
        return;
      }
      const payload: CachePayload = Object.freeze({
        schema: CACHE_SCHEMA,
        scope,
        checkpointBlock: normalizedCheckpointBlock,
        checkpointHash: normalizedCheckpointHash,
        logs: Object.freeze(
          [...latestByState.values()].sort(compareChatReactionObservationOrder).map(encodeObservation)
        )
      });
      const serialized = JSON.stringify({ ...payload, contentHash: payloadHash(payload) });
      if (serialized.length > MAX_CACHE_BYTES) {
        clear({ deployment, finalityLagBlocks });
        return;
      }
      storage.setItem(storageKey(scope), serialized);
    },
    clear
  };
  const cache = Object.freeze(implementation) as unknown as ChatReactionsV1Cache;
  CACHES.add(cache);
  return cache;
};

export const createDefaultChatReactionsV1Cache = (): ChatReactionsV1Cache | null => {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : createChatReactionsV1Cache({ storage: globalThis.localStorage });
  } catch {
    return null;
  }
};

export const assertChatReactionsV1Cache = (cache: ChatReactionsV1Cache): ChatReactionsV1Cache => {
  if (!cache || !CACHES.has(cache)) throw new Error('ChatReactionsV1 requires its verified cache implementation.');
  return cache;
};

export const reduceCanonicalChatReactionCacheSnapshot = (
  snapshot: CanonicalChatReactionsV1CacheSnapshot,
  sources: readonly ChatReactionSource[]
): ChatReactionReducedState => {
  if (!snapshot || !SNAPSHOTS.has(snapshot)) {
    throw new Error('Reaction cache reducer requires a canonical checkpoint snapshot.');
  }
  const resolver = createChatReactionSourceResolver(sources);
  const accepted: ChatReactionObservation[] = [];
  const ignored: Array<ChatReactionReducedState['ignored'][number]> = [];
  for (const observation of snapshot.observations) {
    const target = chatReactionTargetOf(observation);
    let source: ChatReactionSource | null | undefined;
    try {
      source = resolver(target);
    } catch {
      ignored.push({ rawIdentity: observation.rawIdentity, reason: 'invalid-source' });
      continue;
    }
    if (!source) {
      ignored.push({ rawIdentity: observation.rawIdentity, reason: 'missing-source' });
      continue;
    }
    try {
      const normalized = normalizeChatReactionSource(source);
      if (chatReactionStableTargetKey(normalized) !== chatReactionStableTargetKey(target)) {
        ignored.push({ rawIdentity: observation.rawIdentity, reason: 'invalid-source' });
      } else if (deriveChatReactionSourceAnchor(normalized) !== observation.messageAnchor) {
        ignored.push({ rawIdentity: observation.rawIdentity, reason: 'anchor-mismatch' });
      } else {
        accepted.push(observation);
      }
    } catch {
      ignored.push({ rawIdentity: observation.rawIdentity, reason: 'invalid-source' });
    }
  }
  accepted.sort(compareChatReactionObservationOrder);
  const states = new Map<string, ChatReactionObservation>();
  for (const observation of accepted) states.set(observation.stateKey, observation);
  return Object.freeze({
    accepted: Object.freeze(accepted),
    states: Object.freeze([...states.values()].sort(compareChatReactionObservationOrder)),
    ignored: Object.freeze(ignored.map((item) => Object.freeze({ ...item })))
  });
};
