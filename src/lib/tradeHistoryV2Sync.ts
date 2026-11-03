import {
  buildTradeHistoryV2ScopeKey,
  clearTradeHistoryV2Scope,
  getTradeHistoryV2LedgerRevision,
  replaceTradeHistoryV2Range,
  type TradeHistoryV2LedgerState,
  type TradeHistoryV2RangePage
} from './tradeHistoryV2Ledger';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const UINT256_MAX = (1n << 256n) - 1n;

export type TradeHistoryV2SyncScope = {
  chainId: string;
  contractAddress: string;
  deploymentBlock: string;
};

export type TradeHistoryV2Checkpoint = {
  blockNumber: string;
  blockHash: string;
};

export type TradeHistoryV2SyncState = {
  ledger: TradeHistoryV2LedgerState;
  checkpointsByScope: Readonly<Record<string, TradeHistoryV2Checkpoint>>;
  oldestBlockByScope?: Readonly<Record<string, string>>;
};

export type TradeHistoryV2CanonicalBlock = {
  number: string;
  hash: string;
};

export type TradeHistoryV2SyncDependencies = {
  getLatestBlockNumber: (chainId: string) => Promise<string>;
  readCanonicalBlock: (
    chainId: string,
    blockNumber: string
  ) => Promise<TradeHistoryV2CanonicalBlock | null>;
  /** Must return the complete provider-owned log result for exactly this contract and inclusive range. */
  readCompleteRange: (input: {
    scope: TradeHistoryV2SyncScope;
    fromBlock: string;
    toBlock: string;
    reorged: boolean;
    reset?: boolean;
  }) => Promise<TradeHistoryV2RangePage>;
};

export type TradeHistoryV2SyncResult = {
  status: 'up-to-date' | 'page-applied' | 'reorg-replay';
  state: TradeHistoryV2SyncState;
  safeHead: string;
  hasMore: boolean;
  reorged: boolean;
  reset?: boolean;
  page?: { fromBlock: string; toBlock: string };
};

const parseDecimal = (value: string, label: string): bigint => {
  const normalized = value.trim();
  if (!DECIMAL_PATTERN.test(normalized)) throw new Error(`${label} must be a canonical decimal string.`);
  const parsed = BigInt(normalized);
  if (parsed > UINT256_MAX) throw new Error(`${label} is out of range.`);
  return parsed;
};

const normalizeHash = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!BYTES32_PATTERN.test(normalized)) throw new Error(`${label} must be a 32-byte hex value.`);
  return normalized.toLowerCase();
};

const assertLease = (shouldContinue?: () => boolean): void => {
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Trade-history sync scope changed while a range was loading.');
  }
};

const assertCanonicalBlock = (
  block: TradeHistoryV2CanonicalBlock | null,
  expectedNumber: bigint,
  label: string
): TradeHistoryV2CanonicalBlock => {
  if (!block || parseDecimal(block.number, `${label} number`) !== expectedNumber) {
    throw new Error(`${label} is unavailable or has the wrong number.`);
  }
  return { number: expectedNumber.toString(), hash: normalizeHash(block.hash, `${label} hash`) };
};

export const createTradeHistoryV2SyncState = (
  ledger: TradeHistoryV2LedgerState
): TradeHistoryV2SyncState => ({ ledger, checkpointsByScope: {} });

/**
 * Reads and atomically applies at most one finalized range. A checkpoint mismatch clears only this
 * chain/contract scope and restarts bounded replay from the attested deployment block. This favors
 * correctness over retaining a potentially orphaned suffix; subsequent calls continue pagination.
 */
export const syncTradeHistoryV2Range = async ({
  previous,
  scope,
  confirmationDepth,
  maxBlockSpan,
  overlapBlocks,
  dependencies,
  expectedRevision,
  mode,
  shouldContinue
}: {
  previous: TradeHistoryV2SyncState;
  scope: TradeHistoryV2SyncScope;
  confirmationDepth: bigint;
  maxBlockSpan: bigint;
  overlapBlocks: bigint;
  dependencies: TradeHistoryV2SyncDependencies;
  expectedRevision: number;
  mode?: 'latest' | 'older';
  shouldContinue?: () => boolean;
}): Promise<TradeHistoryV2SyncResult> => {
  if (confirmationDepth <= 0n) throw new Error('Trade-history confirmation depth must be non-zero.');
  if (maxBlockSpan <= 0n || maxBlockSpan > 100_000n) {
    throw new Error('Trade-history range span must be between 1 and 100,000 blocks.');
  }
  if (overlapBlocks < 0n || overlapBlocks >= maxBlockSpan) {
    throw new Error('Trade-history overlap must be non-negative and smaller than the range span.');
  }
  const deploymentBlock = parseDecimal(scope.deploymentBlock, 'Trade-history deployment block');
  const scopeKey = buildTradeHistoryV2ScopeKey(scope);
  const currentRevision = getTradeHistoryV2LedgerRevision({
    state: previous.ledger,
    chainId: scope.chainId,
    contractAddress: scope.contractAddress
  });
  if (expectedRevision !== currentRevision) {
    throw new Error('Trade-history sync started from a stale ledger revision.');
  }
  assertLease(shouldContinue);
  const latestBlock = parseDecimal(
    await dependencies.getLatestBlockNumber(scope.chainId),
    'Trade-history latest block'
  );
  assertLease(shouldContinue);
  const safeHead = latestBlock >= confirmationDepth ? latestBlock - confirmationDepth : 0n;

  let checkpoint: TradeHistoryV2Checkpoint | undefined = previous.checkpointsByScope[scopeKey];
  let ledger = previous.ledger;
  let reorged = false;
  if (checkpoint) {
    const checkpointNumber = parseDecimal(checkpoint.blockNumber, 'Trade-history checkpoint block');
    const rawCanonicalCheckpoint = await dependencies.readCanonicalBlock(
      scope.chainId,
      checkpointNumber.toString()
    );
    assertLease(shouldContinue);
    let checkpointIsCanonical = false;
    if (rawCanonicalCheckpoint && checkpointNumber <= safeHead) {
      try {
        const canonicalCheckpoint = assertCanonicalBlock(
          rawCanonicalCheckpoint,
          checkpointNumber,
          'Trade-history checkpoint block'
        );
        checkpointIsCanonical = canonicalCheckpoint.hash === normalizeHash(
          checkpoint.blockHash,
          'Trade-history checkpoint hash'
        );
      } catch {
        checkpointIsCanonical = false;
      }
    }
    if (!checkpointIsCanonical) {
      ledger = clearTradeHistoryV2Scope({
        previous: ledger,
        chainId: scope.chainId,
        contractAddress: scope.contractAddress,
        expectedRevision: currentRevision
      });
      checkpoint = undefined;
      reorged = true;
    }
  }

  let oldestBlock = checkpoint ? previous.oldestBlockByScope?.[scopeKey] : undefined;
  let reset = reorged;
  // A long idle gap starts a fresh recent window; older pages remain retrievable.
  if (mode && checkpoint && (oldestBlock === undefined ||
      mode === 'latest' && safeHead - BigInt(checkpoint.blockNumber) > maxBlockSpan)) {
    ledger = clearTradeHistoryV2Scope({ previous: ledger, ...scope,
      expectedRevision: getTradeHistoryV2LedgerRevision({ state: ledger, ...scope }) });
    checkpoint = undefined;
    oldestBlock = undefined;
    reset = true;
  }
  const effectiveRevision = getTradeHistoryV2LedgerRevision({
    state: ledger,
    chainId: scope.chainId,
    contractAddress: scope.contractAddress
  });
  if (safeHead < deploymentBlock) {
    return {
      status: reorged ? 'reorg-replay' : 'up-to-date',
      state: {
        ledger,
        checkpointsByScope: reorged
          ? Object.fromEntries(Object.entries(previous.checkpointsByScope).filter(([key]) => key !== scopeKey))
          : previous.checkpointsByScope,
        ...(mode ? { oldestBlockByScope: Object.fromEntries(Object.entries(previous.oldestBlockByScope ?? {}).filter(([key]) => key !== scopeKey)) } : {})
      },
      safeHead: safeHead.toString(),
      hasMore: false,
      reorged,
      ...(mode ? { reset } : {})
    };
  }

  let fromBlock = deploymentBlock;
  let toBlock: bigint;
  if (mode) {
    const oldest = oldestBlock === undefined ? undefined : parseDecimal(oldestBlock, 'History oldest block');
    if (checkpoint && (mode === 'older' ? oldest === deploymentBlock : BigInt(checkpoint.blockNumber) === safeHead)) {
      return { status: 'up-to-date', state: previous, safeHead: checkpoint.blockNumber,
        hasMore: oldest !== undefined && oldest > deploymentBlock, reorged: false };
    }
    toBlock = mode === 'older' && oldest !== undefined ? oldest - 1n : safeHead;
    fromBlock = toBlock - deploymentBlock + 1n > maxBlockSpan ? toBlock - maxBlockSpan + 1n : deploymentBlock;
  } else {
    if (checkpoint) {
      const checkpointNumber = parseDecimal(checkpoint.blockNumber, 'Trade-history checkpoint block');
      if (checkpointNumber >= safeHead) {
        return {
          status: 'up-to-date',
          state: previous,
          safeHead: safeHead.toString(),
          hasMore: false,
          reorged: false
        };
      }
      const nextBlock = checkpointNumber + 1n;
      fromBlock = nextBlock > overlapBlocks ? nextBlock - overlapBlocks : deploymentBlock;
      if (fromBlock < deploymentBlock) fromBlock = deploymentBlock;
    }
    toBlock = fromBlock + maxBlockSpan - 1n < safeHead
      ? fromBlock + maxBlockSpan - 1n
      : safeHead;
  }

  const beforeFrom = assertCanonicalBlock(
    await dependencies.readCanonicalBlock(scope.chainId, fromBlock.toString()),
    fromBlock,
    'Trade-history range start block'
  );
  const beforeTo = assertCanonicalBlock(
    await dependencies.readCanonicalBlock(scope.chainId, toBlock.toString()),
    toBlock,
    'Trade-history range end block'
  );
  assertLease(shouldContinue);
  const page = await dependencies.readCompleteRange({
    scope,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    reorged,
    ...(mode ? { reset } : {})
  });
  assertLease(shouldContinue);
  if (
    parseDecimal(page.fromBlock, 'Trade-history returned range start') !== fromBlock ||
    parseDecimal(page.toBlock, 'Trade-history returned range end') !== toBlock ||
    buildTradeHistoryV2ScopeKey(page) !== scopeKey ||
    normalizeHash(page.fromBlockHash, 'Trade-history returned start hash') !== beforeFrom.hash ||
    normalizeHash(page.toBlockHash, 'Trade-history returned end hash') !== beforeTo.hash
  ) {
    throw new Error('Trade-history provider returned the wrong scope or range boundaries.');
  }
  const afterFrom = assertCanonicalBlock(
    await dependencies.readCanonicalBlock(scope.chainId, fromBlock.toString()),
    fromBlock,
    'Trade-history final range start block'
  );
  const afterTo = assertCanonicalBlock(
    await dependencies.readCanonicalBlock(scope.chainId, toBlock.toString()),
    toBlock,
    'Trade-history final range end block'
  );
  assertLease(shouldContinue);
  if (afterFrom.hash !== beforeFrom.hash || afterTo.hash !== beforeTo.hash) {
    throw new Error('Trade-history range changed while it was being read.');
  }
  if (mode && checkpoint) {
    const head = await dependencies.readCanonicalBlock(scope.chainId, checkpoint.blockNumber);
    assertLease(shouldContinue);
    if (!head || head.number !== checkpoint.blockNumber || head.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
      throw new Error('Trade-history snapshot changed while reading an older page.');
    }
  }

  const nextLedger = replaceTradeHistoryV2Range({
    previous: ledger,
    page,
    expectedRevision: effectiveRevision
  });
  const nextCheckpoint: TradeHistoryV2Checkpoint = mode === 'older' && checkpoint ? checkpoint : {
    blockNumber: toBlock.toString(),
    blockHash: afterTo.hash
  };
  return {
    status: reorged ? 'reorg-replay' : 'page-applied',
    state: {
      ledger: nextLedger,
      checkpointsByScope: {
        ...previous.checkpointsByScope,
        [scopeKey]: nextCheckpoint
      },
      ...(mode ? { oldestBlockByScope: { ...previous.oldestBlockByScope,
        [scopeKey]: oldestBlock !== undefined && BigInt(oldestBlock) < fromBlock ? oldestBlock : fromBlock.toString() } } : {})
    },
    safeHead: mode ? nextCheckpoint.blockNumber : safeHead.toString(),
    hasMore: mode ? BigInt(oldestBlock !== undefined && BigInt(oldestBlock) < fromBlock ? oldestBlock : fromBlock) > deploymentBlock : toBlock < safeHead,
    reorged,
    ...(mode ? { reset } : {}),
    page: { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }
  };
};
