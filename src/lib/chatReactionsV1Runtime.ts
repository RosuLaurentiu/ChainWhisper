import {
  chatReactionObservationsEqual,
  compareChatReactionObservationOrder,
  createChatReactionSourceResolver,
  type ChatReactionObservation,
  type ChatReactionReducedState,
  type ChatReactionSource
} from './chatReactionsV1';
import {
  bindChatReactionsV1OwnerDeployment,
  releaseChatReactionsV1MetaMaskCapability,
  setChatReactionsV1Reaction,
  type ChatReactionWriteResult,
  type ChatReactionsV1MetaMaskCapability
} from './chatReactionsV1Actions';
import {
  CHAT_REACTIONS_V1_MAX_LOG_RANGE_BLOCKS,
  attestChatReactionsV1Deployment,
  bindChatReactionsV1ReadCapability,
  readCanonicalChatReactionsV1LogRange,
  readChatReactionsV1LatestBlock,
  reduceCanonicalChatReactionRangePage,
  isChatReactionsV1DenseRangeError,
  type AttestedChatReactionsV1Deployment,
  type CanonicalChatReactionRangePage,
  type ChatReactionsV1ReadCapability
} from './chatReactionsV1Chain';
import {
  assertChatReactionsV1Cache,
  createDefaultChatReactionsV1Cache,
  reduceCanonicalChatReactionCacheSnapshot,
  type CanonicalChatReactionsV1CacheSnapshot,
  type ChatReactionsV1Cache
} from './chatReactionsV1Cache';
import type { ChatReactionsV1DeploymentConfig } from './chatReactionsV1Deployment';
import { isBrowserWalletSessionChangedError, type CotiReadProvider } from './appShared';
import { captureWalletActionIntent, readWalletActionIntent } from './walletActionIntent';

const REACTION_RECEIPT_TIMEOUT_MS = 300_000;
const REACTION_RECEIPT_POLL_MS = 2_000;

type ActiveDeploymentConfig = Extract<ChatReactionsV1DeploymentConfig, { status: 'active' }>;

export type ChatReactionsV1SyncResult = ChatReactionReducedState & Readonly<{
  safeHeadBlock: string;
  safeHeadBlockHash: string | null;
  rebuilt: boolean;
  restoredFromCache: boolean;
}>;

declare const CHAT_REACTIONS_V1_RUNTIME_BRAND: unique symbol;
export type ChatReactionsV1Runtime = Readonly<{
  readonly [CHAT_REACTIONS_V1_RUNTIME_BRAND]: true;
  sync(sources: readonly ChatReactionSource[]): Promise<ChatReactionsV1SyncResult>;
  setReaction(input: Readonly<{
    source: ChatReactionSource;
    emoji: string;
    active: boolean;
    operationId: string;
  }>): Promise<ChatReactionWriteResult>;
  close(): void;
}>;

const RUNTIMES = new WeakSet<object>();

const combineReducedStates = (
  reducedStates: readonly ChatReactionReducedState[]
): ChatReactionReducedState => {
  const acceptedByIdentity = new Map<string, ChatReactionObservation>();
  const ignoredByIdentity = new Map<string, ChatReactionReducedState['ignored'][number]>();
  for (const reduced of reducedStates) {
    for (const observation of reduced.accepted) {
      const previous = acceptedByIdentity.get(observation.rawIdentity);
      if (previous && !chatReactionObservationsEqual(previous, observation)) {
        throw new Error('Canonical reaction history contains conflicting physical log identities.');
      }
      acceptedByIdentity.set(observation.rawIdentity, observation);
      ignoredByIdentity.delete(observation.rawIdentity);
    }
    for (const ignored of reduced.ignored) {
      if (!acceptedByIdentity.has(ignored.rawIdentity)) {
        ignoredByIdentity.set(ignored.rawIdentity, ignored);
      }
    }
  }
  const accepted = [...acceptedByIdentity.values()].sort(compareChatReactionObservationOrder);
  const states = new Map<string, ChatReactionObservation>();
  for (const observation of accepted) states.set(observation.stateKey, observation);
  return Object.freeze({
    accepted: Object.freeze(accepted),
    states: Object.freeze([...states.values()].sort(compareChatReactionObservationOrder)),
    ignored: Object.freeze([...ignoredByIdentity.values()].map((item) => Object.freeze({ ...item })))
  });
};

const combinePages = (
  pages: readonly CanonicalChatReactionRangePage[],
  sources: readonly ChatReactionSource[],
  cachedSnapshot: CanonicalChatReactionsV1CacheSnapshot | null
): ChatReactionReducedState => {
  const resolver = createChatReactionSourceResolver(sources);
  return combineReducedStates([
    ...(cachedSnapshot ? [reduceCanonicalChatReactionCacheSnapshot(cachedSnapshot, sources)] : []),
    ...pages.map((page) => reduceCanonicalChatReactionRangePage(page, resolver))
  ]);
};

const scanRanges = async ({
  capability,
  deployment,
  fromBlock,
  toBlock
}: {
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<CanonicalChatReactionRangePage[]> => {
  if (fromBlock > toBlock) return [];
  const pages: CanonicalChatReactionRangePage[] = [];
  const readAdaptive = async (start: bigint, end: bigint): Promise<void> => {
    try {
      pages.push(await readCanonicalChatReactionsV1LogRange({
        capability,
        deployment,
        fromBlock: start,
        toBlock: end
      }));
    } catch (error) {
      if (!isChatReactionsV1DenseRangeError(error) || start === end) throw error;
      const midpoint = start + ((end - start) / 2n);
      await readAdaptive(start, midpoint);
      await readAdaptive(midpoint + 1n, end);
    }
  };
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + CHAT_REACTIONS_V1_MAX_LOG_RANGE_BLOCKS - 1n > toBlock
      ? toBlock
      : start + CHAT_REACTIONS_V1_MAX_LOG_RANGE_BLOCKS - 1n;
    await readAdaptive(start, end);
    start = end + 1n;
  }
  return pages;
};

const fenceHash = async ({
  capability,
  deployment,
  block
}: {
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
  block: bigint;
}): Promise<string> => {
  const fence = await readCanonicalChatReactionsV1LogRange({
    capability,
    deployment,
    fromBlock: block,
    toBlock: block
  });
  if (fence.range.fromBlock !== block.toString() ||
      fence.range.toBlock !== block.toString() ||
      fence.range.fromBlockHash !== fence.range.toBlockHash) {
    throw new Error('Canonical reaction fence did not bind the requested block.');
  }
  return fence.range.toBlockHash;
};

export const createChatReactionsV1Runtime = async ({
  cache,
  config,
  getOwnerCapability,
  readProvider,
  runOwnerTransactionFlow
}: {
  cache?: ChatReactionsV1Cache | null;
  config: ActiveDeploymentConfig;
  getOwnerCapability: () => Promise<ChatReactionsV1MetaMaskCapability>;
  readProvider: CotiReadProvider;
  runOwnerTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<ChatReactionsV1Runtime> => {
  if (!config || config.status !== 'active' || typeof getOwnerCapability !== 'function' ||
      !readProvider || typeof readProvider.send !== 'function' ||
      typeof runOwnerTransactionFlow !== 'function') {
    throw new Error('ChatReactionsV1 runtime requires an active deployment configuration.');
  }
  const request = ({ method, params }: { method: string; params?: readonly unknown[] | object }) =>
    readProvider.send(method, Array.isArray(params) ? [...params] : []);
  const waitForReceipt = async (transactionHash: string) => {
    const deadline = Date.now() + REACTION_RECEIPT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const receipt = await readProvider.getTransactionReceipt(transactionHash);
        if (receipt) return receipt;
      } catch {
        // A transient public-RPC read failure must not turn a submitted wallet
        // transaction into a false failure. Keep polling until the deadline.
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, REACTION_RECEIPT_POLL_MS));
    }
    return null;
  };
  const readCapability = await bindChatReactionsV1ReadCapability({
    provider: { request },
    expectedChainId: config.manifest.chainId,
    assertCurrent: () => undefined
  });
  const deployment: AttestedChatReactionsV1Deployment = await attestChatReactionsV1Deployment({
    capability: readCapability,
    manifest: config.manifest,
    policy: { safeHeadLagBlocks: config.finalityLagBlocks }
  });
  const deploymentBlock = BigInt(deployment.deploymentBlock);
  const reactionCache = cache === undefined
    ? createDefaultChatReactionsV1Cache()
    : cache === null
      ? null
      : assertChatReactionsV1Cache(cache);
  const cacheScope = Object.freeze({
    deployment,
    finalityLagBlocks: config.finalityLagBlocks
  });
  let alive = true;
  let ownerCapability: Promise<ChatReactionsV1MetaMaskCapability> | null = null;
  let ownerDeploymentBound = false;
  let pages: CanonicalChatReactionRangePage[] = [];
  let cachedSnapshot: CanonicalChatReactionsV1CacheSnapshot | null = null;
  let cacheAttempted = false;
  let checkpointBlock: bigint | null = null;
  let checkpointHash: string | null = null;
  let operationTail = Promise.resolve();

  const retireOwnerCapability = (): void => {
    const pending = ownerCapability;
    ownerCapability = null;
    ownerDeploymentBound = false;
    if (pending) {
      void pending.then(releaseChatReactionsV1MetaMaskCapability).catch(() => {});
    }
  };

  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = operationTail;
    let release = () => {};
    operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!alive) throw new Error('ChatReactionsV1 runtime is closed.');
      return await operation();
    } finally {
      release();
    }
  };

  const sync = (sources: readonly ChatReactionSource[]) => exclusive(async () => {
    const latest = await readChatReactionsV1LatestBlock(readCapability);
    const safeHead = latest >= config.finalityLagBlocks
      ? latest - config.finalityLagBlocks
      : 0n;
    let restoredFromCache = false;

    if (!cacheAttempted && checkpointBlock === null) {
      cacheAttempted = true;
      const candidate = reactionCache?.load(cacheScope) ?? null;
      if (candidate) {
        try {
          if (BigInt(candidate.checkpointBlock) > safeHead) {
            throw new Error('Reaction cache checkpoint is newer than the safe head.');
          }
          const canonicalCheckpointHash = await fenceHash({
            capability: readCapability,
            deployment,
            block: BigInt(candidate.checkpointBlock)
          });
          cachedSnapshot = reactionCache?.accept({ candidate, canonicalCheckpointHash }) ?? null;
          if (cachedSnapshot) {
            checkpointBlock = BigInt(cachedSnapshot.checkpointBlock);
            checkpointHash = cachedSnapshot.checkpointHash;
            restoredFromCache = true;
          }
        } catch {
          cachedSnapshot = null;
          try { reactionCache?.clear(cacheScope); } catch { /* best-effort public cache */ }
        }
      }
    }

    let rebuilt = checkpointBlock === null;

    if (checkpointBlock !== null && checkpointHash !== null) {
      if (safeHead < checkpointBlock ||
          await fenceHash({ capability: readCapability, deployment, block: checkpointBlock }) !== checkpointHash) {
        pages = [];
        cachedSnapshot = null;
        checkpointBlock = null;
        checkpointHash = null;
        rebuilt = true;
        restoredFromCache = false;
        try { reactionCache?.clear(cacheScope); } catch { /* best-effort public cache */ }
      }
    }

    const fromBlock = checkpointBlock === null
      ? deploymentBlock
      : checkpointBlock + 1n;
    const added = await scanRanges({
      capability: readCapability,
      deployment,
      fromBlock,
      toBlock: safeHead
    });
    const candidatePages = added.length > 0 ? [...pages, ...added] : pages;

    if (safeHead >= deploymentBlock) {
      const expectedHash = added[added.length - 1]?.range.toBlockHash ??
        (checkpointBlock === safeHead ? checkpointHash : null);
      const finalHash = await fenceHash({ capability: readCapability, deployment, block: safeHead });
      if (expectedHash !== null && finalHash !== expectedHash) {
        throw new Error('Canonical reaction history changed during synchronization.');
      }
      pages = candidatePages;
      checkpointBlock = safeHead;
      checkpointHash = finalHash;
      try {
        reactionCache?.save({
          ...cacheScope,
          checkpointBlock: safeHead.toString(),
          checkpointHash: finalHash,
          observations: [
            ...(cachedSnapshot?.observations ?? []),
            ...pages.flatMap((page) => page.observations)
          ]
        });
      } catch {
        // Persistence is an optional public-data optimization. Canonical
        // in-memory state remains authoritative for this runtime.
      }
    } else {
      pages = [];
      cachedSnapshot = null;
      checkpointBlock = null;
      checkpointHash = null;
      try { reactionCache?.clear(cacheScope); } catch { /* best-effort public cache */ }
    }

    return Object.freeze({
      ...combinePages(pages, sources, cachedSnapshot),
      safeHeadBlock: safeHead.toString(),
      safeHeadBlockHash: checkpointHash,
      rebuilt,
      restoredFromCache
    });
  });

  const setReaction = (input: Readonly<{
    source: ChatReactionSource;
    emoji: string;
    active: boolean;
    operationId: string;
  }>) => {
    const intent = captureWalletActionIntent(input);
    return exclusive(async () => runOwnerTransactionFlow(async () => {
      const attempt = async (): Promise<ChatReactionWriteResult> => {
        if (!ownerCapability) {
          const pending = getOwnerCapability();
          const guarded = pending.catch((error) => {
            if (ownerCapability === guarded) ownerCapability = null;
            throw error;
          });
          ownerCapability = guarded;
        }
        const capability = await ownerCapability;
        if (!ownerDeploymentBound) {
          await bindChatReactionsV1OwnerDeployment({ capability, deployment });
          ownerDeploymentBound = true;
        }
        return await setChatReactionsV1Reaction({
          capability,
          deployment,
          waitForReceipt,
          ...readWalletActionIntent(intent)
        });
      };
      try {
        return await attempt();
      } catch (error) {
        retireOwnerCapability();
        if (!isBrowserWalletSessionChangedError(error)) throw error;
      }
      try {
        return await attempt();
      } catch (error) {
        retireOwnerCapability();
        throw error;
      }
    }));
  };

  const runtime = Object.freeze({
    sync,
    setReaction,
    close: () => {
      if (!alive) return;
      alive = false;
      pages = [];
      cachedSnapshot = null;
      checkpointBlock = null;
      checkpointHash = null;
      retireOwnerCapability();
    }
  }) as ChatReactionsV1Runtime;
  RUNTIMES.add(runtime);
  return runtime;
};

export const assertChatReactionsV1Runtime = (
  runtime: ChatReactionsV1Runtime
): ChatReactionsV1Runtime => {
  if (!runtime || !RUNTIMES.has(runtime)) {
    throw new Error('ChatReactionsV1 requires a runtime created by its verified factory.');
  }
  return runtime;
};
