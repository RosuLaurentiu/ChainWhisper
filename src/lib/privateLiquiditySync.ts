import {
  assertAttestedPrivateLiquidityDeployment,
  assertCanonicalPrivateLiquidityLogRange,
  readCanonicalPrivateLiquidityBlock,
  readCanonicalPrivateLiquidityLogRange,
  type AttestedPrivateLiquidityDeployment,
  type CanonicalPrivateLiquidityLogRange,
  type PrivateLiquidityReadCapability
} from './privateLiquidityChain';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;

export type PrivateLiquidityHistoryCheckpoint = Readonly<{
  blockNumber: string;
  blockHash: string;
}>;

export type PrivateLiquidityHistorySyncScopeState = Readonly<{
  revision: number;
  pages: readonly CanonicalPrivateLiquidityLogRange[];
  checkpoint?: PrivateLiquidityHistoryCheckpoint;
}>;

export type PrivateLiquidityHistorySyncState = Readonly<{
  scopes: Readonly<Record<string, PrivateLiquidityHistorySyncScopeState>>;
}>;

export type PrivateLiquidityHistorySyncResult = Readonly<{
  status: 'up-to-date' | 'page-applied' | 'reorg-replay';
  state: PrivateLiquidityHistorySyncState;
  safeHead: string;
  hasMore: boolean;
  reorged: boolean;
  page?: Readonly<{ fromBlock: string; toBlock: string }>;
}>;

const decimal = (value: string, label: string): bigint => {
  if (!DECIMAL_PATTERN.test(value)) throw new Error(`${label} must be canonical decimal.`);
  return BigInt(value);
};

const blockHash = (value: string, label: string): string => {
  const normalized = value.toLowerCase();
  if (!BYTES32_PATTERN.test(normalized) || /^0x0{64}$/.test(normalized)) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return normalized;
};

export const buildPrivateLiquidityHistorySyncScopeKey = (
  deployment: AttestedPrivateLiquidityDeployment
): string => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  return [
    'chainwhisper-private-liquidity-v1',
    deployment.chainId,
    deployment.contractAddress,
    deployment.deploymentBlock
  ].join(':');
};

export const createPrivateLiquidityHistorySyncState = (): PrivateLiquidityHistorySyncState =>
  Object.freeze({ scopes: Object.freeze({}) });

export const getPrivateLiquidityHistorySyncScope = ({
  state,
  deployment
}: {
  state: PrivateLiquidityHistorySyncState;
  deployment: AttestedPrivateLiquidityDeployment;
}): PrivateLiquidityHistorySyncScopeState => {
  const key = buildPrivateLiquidityHistorySyncScopeKey(deployment);
  return state.scopes[key] ?? Object.freeze({ revision: 0, pages: Object.freeze([]) });
};

const assertContinue = (shouldContinue?: () => boolean): void => {
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Private-liquidity history scope changed while syncing.');
  }
};

const pageMatchesDeployment = (
  page: CanonicalPrivateLiquidityLogRange,
  deployment: AttestedPrivateLiquidityDeployment,
  fromBlock: bigint,
  toBlock: bigint
): void => {
  assertCanonicalPrivateLiquidityLogRange(page);
  if (
    page.scope.chainId !== deployment.chainId ||
    page.scope.contractAddress !== deployment.contractAddress ||
    page.scope.deploymentBlock !== deployment.deploymentBlock ||
    decimal(page.range.fromBlock, 'Private-liquidity returned range start') !== fromBlock ||
    decimal(page.range.toBlock, 'Private-liquidity returned range end') !== toBlock
  ) {
    throw new Error('Private-liquidity history reader returned the wrong scope or range.');
  }
};

/**
 * Applies at most one complete provider-owned finalized range. State is memory-only: branded pages
 * and their checkpoint are committed together after every canonicality check succeeds. A checkpoint
 * mismatch clears only this deployment and begins replay from its attested deployment block.
 */
export const syncPrivateLiquidityHistoryRange = async ({
  previous,
  capability,
  deployment,
  maxBlockSpan,
  overlapBlocks,
  expectedRevision,
  shouldContinue
}: {
  previous: PrivateLiquidityHistorySyncState;
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  maxBlockSpan: bigint;
  overlapBlocks: bigint;
  expectedRevision: number;
  shouldContinue?: () => boolean;
}): Promise<PrivateLiquidityHistorySyncResult> => {
  assertAttestedPrivateLiquidityDeployment(deployment);
  if (typeof maxBlockSpan !== 'bigint' || maxBlockSpan <= 0n || maxBlockSpan > 2_048n) {
    throw new Error('Private-liquidity history range span must be between 1 and 2,048 blocks.');
  }
  if (typeof overlapBlocks !== 'bigint' || overlapBlocks < 0n || overlapBlocks >= maxBlockSpan) {
    throw new Error('Private-liquidity history overlap must be non-negative and smaller than its range span.');
  }
  const scopeKey = buildPrivateLiquidityHistorySyncScopeKey(deployment);
  const current = previous.scopes[scopeKey] ?? Object.freeze({ revision: 0, pages: Object.freeze([]) });
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== current.revision) {
    throw new Error('Private-liquidity history sync started from a stale revision.');
  }
  for (const page of current.pages) {
    assertCanonicalPrivateLiquidityLogRange(page);
    pageMatchesDeployment(
      page,
      deployment,
      decimal(page.range.fromBlock, 'Stored private-liquidity range start'),
      decimal(page.range.toBlock, 'Stored private-liquidity range end')
    );
  }

  assertContinue(shouldContinue);
  const safeHeadBlock = await readCanonicalPrivateLiquidityBlock({ capability, deployment });
  assertContinue(shouldContinue);
  const safeHead = decimal(safeHeadBlock.number, 'Private-liquidity safe head');
  const deploymentBlock = decimal(deployment.deploymentBlock, 'Private-liquidity deployment block');
  let checkpoint = current.checkpoint;
  let pages = current.pages;
  let reorged = false;

  if (checkpoint) {
    const checkpointNumber = decimal(checkpoint.blockNumber, 'Private-liquidity checkpoint block');
    if (checkpointNumber > safeHead) {
      checkpoint = undefined;
      pages = Object.freeze([]);
      reorged = true;
    } else {
      const canonicalCheckpoint = await readCanonicalPrivateLiquidityBlock({
        capability,
        deployment,
        blockNumber: checkpointNumber
      });
      assertContinue(shouldContinue);
      if (canonicalCheckpoint.hash !== blockHash(checkpoint.blockHash, 'Private-liquidity checkpoint hash')) {
        checkpoint = undefined;
        pages = Object.freeze([]);
        reorged = true;
      }
    }
  }

  if (safeHead < deploymentBlock) {
    if (!reorged) {
      return Object.freeze({
        status: 'up-to-date',
        state: previous,
        safeHead: safeHead.toString(),
        hasMore: false,
        reorged: false
      });
    }
    const nextScope = Object.freeze({ revision: current.revision + 1, pages: Object.freeze([]) });
    return Object.freeze({
      status: 'reorg-replay',
      state: Object.freeze({ scopes: Object.freeze({ ...previous.scopes, [scopeKey]: nextScope }) }),
      safeHead: safeHead.toString(),
      hasMore: false,
      reorged: true
    });
  }

  let fromBlock = deploymentBlock;
  if (checkpoint) {
    const checkpointNumber = decimal(checkpoint.blockNumber, 'Private-liquidity checkpoint block');
    if (checkpointNumber >= safeHead) {
      return Object.freeze({
        status: 'up-to-date',
        state: previous,
        safeHead: safeHead.toString(),
        hasMore: false,
        reorged: false
      });
    }
    const nextBlock = checkpointNumber + 1n;
    fromBlock = nextBlock > overlapBlocks ? nextBlock - overlapBlocks : deploymentBlock;
    if (fromBlock < deploymentBlock) fromBlock = deploymentBlock;
  }
  const toBlock = fromBlock + maxBlockSpan - 1n < safeHead
    ? fromBlock + maxBlockSpan - 1n
    : safeHead;

  const page = await readCanonicalPrivateLiquidityLogRange({
    capability,
    deployment,
    fromBlock,
    toBlock
  });
  assertContinue(shouldContinue);
  pageMatchesDeployment(page, deployment, fromBlock, toBlock);
  const pageSafeHead = decimal(page.safeHead.number, 'Returned private-liquidity safe head');
  if (pageSafeHead < safeHead || (pageSafeHead === safeHead && page.safeHead.hash !== safeHeadBlock.hash)) {
    throw new Error('Private-liquidity safe head changed inconsistently while syncing.');
  }

  if (current.checkpoint && !reorged) {
    const checkpointNumber = decimal(current.checkpoint.blockNumber, 'Private-liquidity checkpoint block');
    const finalCheckpoint = await readCanonicalPrivateLiquidityBlock({
      capability,
      deployment,
      blockNumber: checkpointNumber
    });
    assertContinue(shouldContinue);
    if (finalCheckpoint.hash !== blockHash(current.checkpoint.blockHash, 'Private-liquidity checkpoint hash')) {
      throw new Error('Private-liquidity checkpoint changed while a range was loading.');
    }
  }

  const duplicateRangeIndex = pages.findIndex((stored) =>
    stored.range.fromBlock === page.range.fromBlock && stored.range.toBlock === page.range.toBlock
  );
  const nextPages = duplicateRangeIndex < 0
    ? Object.freeze([...pages, page])
    : Object.freeze(pages.map((stored, index) => index === duplicateRangeIndex ? page : stored));
  const nextScope = Object.freeze({
    revision: current.revision + 1,
    pages: nextPages,
    checkpoint: Object.freeze({ blockNumber: toBlock.toString(), blockHash: page.range.toBlockHash })
  });
  return Object.freeze({
    status: reorged ? 'reorg-replay' : 'page-applied',
    state: Object.freeze({ scopes: Object.freeze({ ...previous.scopes, [scopeKey]: nextScope }) }),
    safeHead: pageSafeHead.toString(),
    hasMore: toBlock < pageSafeHead,
    reorged,
    page: Object.freeze({ fromBlock: fromBlock.toString(), toBlock: toBlock.toString() })
  });
};
