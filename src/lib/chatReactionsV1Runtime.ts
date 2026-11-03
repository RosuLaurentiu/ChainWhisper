import {
  chatReactionObservationsEqual,
  compareChatReactionObservationOrder,
  createChatReactionSourceResolver,
  normalizeChatReactionSource,
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
  sync(sources: readonly ChatReactionSource[], shouldContinue?: () => boolean): Promise<ChatReactionsV1SyncResult>;
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
  toBlock,
  assertCurrent
}: {
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
  fromBlock: bigint;
  toBlock: bigint;
  assertCurrent: () => Promise<void>;
}): Promise<CanonicalChatReactionRangePage[]> => {
  if (fromBlock > toBlock) return [];
  const pages: CanonicalChatReactionRangePage[] = [];
  const readAdaptive = async (start: bigint, end: bigint): Promise<void> => {
    try {
      await assertCurrent();
      pages.push(await readCanonicalChatReactionsV1LogRange({
        capability,
        deployment,
        fromBlock: start,
        toBlock: end
      }));
      await assertCurrent();
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
  block,
  assertCurrent
}: {
  capability: ChatReactionsV1ReadCapability;
  deployment: AttestedChatReactionsV1Deployment;
  block: bigint;
  assertCurrent: () => Promise<void>;
}): Promise<string> => {
  await assertCurrent();
  const fence = await readCanonicalChatReactionsV1LogRange({
    capability,
    deployment,
    fromBlock: block,
    toBlock: block
  });
  await assertCurrent();
  if (fence.range.fromBlock !== block.toString() ||
      fence.range.toBlock !== block.toString() ||
      fence.range.fromBlockHash !== fence.range.toBlockHash) {
    throw new Error('Canonical reaction fence did not bind the requested block.');
  }
  return fence.range.toBlockHash;
};

export const createChatReactionsV1Runtime = async ({
  assertCurrent,
  cache,
  config,
  getOwnerCapability,
  readProvider,
  runOwnerTransactionFlow
}: {
  assertCurrent?: () => void | Promise<void>;
  cache?: ChatReactionsV1Cache | null;
  config: ActiveDeploymentConfig;
  getOwnerCapability: () => Promise<ChatReactionsV1MetaMaskCapability>;
  readProvider: Pick<CotiReadProvider, 'send' | 'getTransactionReceipt'>;
  runOwnerTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<ChatReactionsV1Runtime> => {
  if (!config || config.status !== 'active' || typeof getOwnerCapability !== 'function' ||
      !readProvider || typeof readProvider.send !== 'function' ||
      typeof runOwnerTransactionFlow !== 'function') {
    throw new Error('ChatReactionsV1 runtime requires an active deployment configuration.');
  }
  let alive = true;
  let activeSyncGuard: (() => boolean) | null = null;
  const assertReadCurrent = async (): Promise<void> => {
    if (!alive) throw new Error('ChatReactionsV1 runtime is closed.');
    if (activeSyncGuard && !activeSyncGuard()) throw new Error('Chat reaction selection changed.');
    await assertCurrent?.();
    if (!alive) throw new Error('ChatReactionsV1 runtime is closed.');
    if (activeSyncGuard && !activeSyncGuard()) throw new Error('Chat reaction selection changed.');
  };
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
    assertCurrent: assertReadCurrent
  });
  const deployment: AttestedChatReactionsV1Deployment = await attestChatReactionsV1Deployment({
    capability: readCapability,
    manifest: config.manifest,
    policy: { safeHeadLagBlocks: config.finalityLagBlocks }
  });
  await assertReadCurrent();
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
  let ownerCapability: Promise<ChatReactionsV1MetaMaskCapability> | null = null;
  let ownerDeploymentBound = false;
  let pages: CanonicalChatReactionRangePage[] = [];
  let cachedSnapshot: CanonicalChatReactionsV1CacheSnapshot | null = null;
  let cacheAttempted = false;
  let checkpointBlock: bigint | null = null;
  let checkpointHash: string | null = null;
  let coverageStartBlock: bigint | null = null;
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
      await assertReadCurrent();
      return await operation();
    } finally {
      release();
    }
  };

  const sync = (input: readonly ChatReactionSource[], shouldContinue: () => boolean = () => true) => {
    // Capture inputs before waiting for another operation. Write sources can omit
    // block metadata; a bounded canonical read cannot.
    const sources = input.map((source) => Object.freeze({ ...source }));
    return exclusive(async () => {
      activeSyncGuard = shouldContinue;
      try {
        await assertReadCurrent();
        if (sources.length === 0) return Object.freeze({
          ...combineReducedStates([]), safeHeadBlock: checkpointBlock?.toString() ?? '0',
          safeHeadBlockHash: checkpointHash, rebuilt: false, restoredFromCache: false
        });
        let floor: bigint | null = null;
        for (const source of sources) {
          const normalized = normalizeChatReactionSource(source);
          const chat = normalized.kind === 'direct' ? deployment.directChatV2 : deployment.groupChatV2;
          if (normalized.chainId !== deployment.chainId ||
              normalized.contractAddress.toLowerCase() !== chat.contractAddress.toLowerCase() ||
              typeof source.blockNumber !== 'string' || !/^[1-9][0-9]*$/.test(source.blockNumber) ||
              BigInt(source.blockNumber) >= 2n ** 64n ||
              BigInt(source.blockNumber) < BigInt(chat.deploymentBlock)) {
            throw new Error('Reaction reads require a current finalized source and its canonical block number.');
          }
          const birth = BigInt(source.blockNumber);
          floor = floor === null || birth < floor ? birth : floor;
        }
        createChatReactionSourceResolver(sources);
        const startFloor = floor! < deploymentBlock ? deploymentBlock : floor!;
        const latest = await readChatReactionsV1LatestBlock(readCapability);
        await assertReadCurrent();
        const safeHead = latest >= config.finalityLagBlocks ? latest - config.finalityLagBlocks : 0n;
        if (sources.some((source) => BigInt(source.blockNumber!) > safeHead)) {
          throw new Error('Reaction source is newer than the finalized safe head.');
        }
        const fence = (block: bigint) => fenceHash({
          capability: readCapability, deployment, block, assertCurrent: assertReadCurrent
        });
        const scan = (fromBlock: bigint, toBlock: bigint) => scanRanges({
          capability: readCapability, deployment, fromBlock, toBlock, assertCurrent: assertReadCurrent
        });
        // Stage coverage until every page and fence passes the live view guard.
        let nextPages = pages;
        let nextSnapshot = cachedSnapshot;
        let nextCheckpoint = checkpointBlock;
        let nextHash = checkpointHash;
        let nextStart = coverageStartBlock;
        let restoredFromCache = false;
        if (!cacheAttempted && nextCheckpoint === null) {
          const candidate = reactionCache?.load(cacheScope) ?? null;
          if (candidate) {
            try {
              if (BigInt(candidate.checkpointBlock) > safeHead) throw new Error('Reaction cache is ahead of safe head.');
              nextSnapshot = reactionCache!.accept({ candidate, canonicalCheckpointHash: await fence(BigInt(candidate.checkpointBlock)) });
              nextCheckpoint = BigInt(nextSnapshot.checkpointBlock);
              nextHash = nextSnapshot.checkpointHash;
              nextStart = deploymentBlock;
              restoredFromCache = true;
            } catch {
              await assertReadCurrent();
              nextSnapshot = null;
              try { reactionCache?.clear(cacheScope); } catch { /* best-effort public cache */ }
            }
          }
        }
        let rebuilt = nextCheckpoint === null;
        if (nextCheckpoint !== null && (safeHead < nextCheckpoint || await fence(nextCheckpoint) !== nextHash)) {
          nextPages = []; nextSnapshot = null; nextCheckpoint = null; nextHash = null; nextStart = null;
          rebuilt = true; restoredFromCache = false;
          try { reactionCache?.clear(cacheScope); } catch { /* best-effort public cache */ }
        }
        // A cache older than every selected source cannot contain their reactions.
        // Drop it locally so an unrelated gap does not become an archive scan.
        if (nextCheckpoint !== null && nextCheckpoint + 1n < startFloor) {
          nextPages = []; nextSnapshot = null; nextCheckpoint = null; nextHash = null; nextStart = null;
          rebuilt = true; restoredFromCache = false;
        }
        if (nextStart !== null && startFloor < nextStart) {
          const prefix = await scan(startFloor, nextStart - 1n);
          // Bind new older coverage to the retained canonical suffix.
          if (nextCheckpoint !== null && await fence(nextCheckpoint) !== nextHash) {
            throw new Error('Canonical reaction history changed during synchronization.');
          }
          nextPages = [...prefix, ...nextPages];
          nextStart = startFloor;
        }
        const added = await scan(nextCheckpoint === null ? startFloor : nextCheckpoint + 1n, safeHead);
        nextPages = [...nextPages, ...added];
        nextStart ??= startFloor;
        const expectedHash = added[added.length - 1]?.range.toBlockHash ?? (nextCheckpoint === safeHead ? nextHash : null);
        const finalHash = safeHead >= deploymentBlock ? await fence(safeHead) : null;
        if (expectedHash !== null && finalHash !== expectedHash) {
          throw new Error('Canonical reaction history changed during synchronization.');
        }
        const reduced = combinePages(nextPages, sources, nextSnapshot);
        await assertReadCurrent();
        pages = nextPages; cachedSnapshot = nextSnapshot; coverageStartBlock = nextStart;
        checkpointBlock = safeHead >= deploymentBlock ? safeHead : null;
        checkpointHash = finalHash; cacheAttempted = true;
        // Persistent cache keys describe complete deployment history only.
        if (finalHash !== null && nextStart === deploymentBlock) {
          try {
            reactionCache?.save({ ...cacheScope, checkpointBlock: safeHead.toString(), checkpointHash: finalHash,
              observations: [...(nextSnapshot?.observations ?? []), ...nextPages.flatMap((page) => page.observations)] });
          } catch { /* optional public-data persistence */ }
        }
        return Object.freeze({ ...reduced, safeHeadBlock: safeHead.toString(), safeHeadBlockHash: finalHash, rebuilt, restoredFromCache });
      } finally {
        activeSyncGuard = null;
      }
    });
  };

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
      coverageStartBlock = null;
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
