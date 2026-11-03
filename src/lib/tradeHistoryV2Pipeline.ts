import { getAddress } from '@coti-io/coti-ethers';
import { readDirectTradeV2PublicTradeTerms } from './directTradeV2Actions';
import type { DirectTradeV2AcceptanceTerms, ParsedDirectTradeV2Status } from './tradeHistoryV2Events';
import {
  readCanonicalTradeHistoryV2LogRange,
  assertTradeHistoryV2WalletIndex,
  TradeHistoryV2RangeLimitError,
  TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS,
  type AttestedTradeHistoryV2Deployment,
  type CanonicalTradeHistoryV2LogRange,
  type TradeHistoryV2ReadCapability,
  type TradeHistoryV2WalletIndex
} from './tradeHistoryV2Chain';
import {
  clearTradeHistoryV2MaterializationScope,
  createTradeHistoryV2MaterializationState,
  getTradeHistoryV2MaterializationRevision,
  materializeCanonicalTradeHistoryV2Range,
  type TradeHistoryV2DirectPrivateAmountResolver,
  type TradeHistoryV2MaterializationState,
  type TradeHistoryV2PrivateAmountResolver
} from './tradeHistoryV2Materialize';
import {
  buildTradeHistoryV2ScopeKey,
  clearTradeHistoryV2Scope,
  createTradeHistoryV2LedgerState,
  replaceTradeHistoryV2Range,
  getTradeHistoryV2LedgerRevision
} from './tradeHistoryV2Ledger';
import {
  syncTradeHistoryV2Range,
  type TradeHistoryV2SyncDependencies,
  type TradeHistoryV2SyncResult,
  type TradeHistoryV2SyncScope,
  type TradeHistoryV2SyncState
} from './tradeHistoryV2Sync';

export type TradeHistoryV2PipelineState = Readonly<{
  sync: TradeHistoryV2SyncState;
  materialization: TradeHistoryV2MaterializationState;
}>;

// Keep only verified public input, in memory and bound to its committed state.
const canonicalPagesByState = new WeakMap<TradeHistoryV2PipelineState, Readonly<{
  deployment: AttestedTradeHistoryV2Deployment;
  walletKey: string | undefined;
  pages: readonly CanonicalTradeHistoryV2LogRange[];
  directTerms: ReadonlyMap<string, DirectTradeV2AcceptanceTerms>;
}>>();

export const resetTradeHistoryV2Projection = (previous: TradeHistoryV2PipelineState): TradeHistoryV2PipelineState => {
  const state = Object.freeze({
    sync: { ...previous.sync, ledger: createTradeHistoryV2LedgerState() },
    materialization: createTradeHistoryV2MaterializationState()
  });
  const saved = canonicalPagesByState.get(previous);
  if (saved) canonicalPagesByState.set(state, saved);
  return state;
};

export type TradeHistoryV2PipelineResult = Omit<TradeHistoryV2SyncResult, 'state'> & Readonly<{
  state: TradeHistoryV2PipelineState;
  narrowedForLogLimit?: boolean;
}>;

export type TradeHistoryV2PipelineReadDependencies = Pick<
  TradeHistoryV2SyncDependencies,
  'getLatestBlockNumber' | 'readCanonicalBlock'
>;

/**
 * Applies one complete range as one logical commit across canonical provider evidence, private
 * receipt materialization, Direct opening metadata, the execution ledger, and its checkpoint.
 * No caller-owned log array or structural canonical page can enter this pipeline.
 */
export const syncTradeHistoryV2PipelineRange = async ({
  previous,
  scope,
  capability,
  deployment,
  confirmationDepth,
  maxBlockSpan,
  overlapBlocks,
  reads,
  viewer,
  walletIndex,
  resolvePrivateReceiptAmounts,
  resolveDirectPrivateAmounts,
  expectedLedgerRevision,
  expectedMaterializationRevision,
  mode,
  rebuildProjection = false,
  shouldContinue
}: {
  previous: TradeHistoryV2PipelineState;
  scope: TradeHistoryV2SyncScope;
  capability: TradeHistoryV2ReadCapability;
  deployment: AttestedTradeHistoryV2Deployment;
  confirmationDepth: bigint;
  maxBlockSpan: bigint;
  overlapBlocks: bigint;
  reads: TradeHistoryV2PipelineReadDependencies;
  viewer?: string;
  walletIndex?: TradeHistoryV2WalletIndex;
  resolvePrivateReceiptAmounts?: TradeHistoryV2PrivateAmountResolver;
  resolveDirectPrivateAmounts?: TradeHistoryV2DirectPrivateAmountResolver;
  expectedLedgerRevision: number;
  expectedMaterializationRevision: number;
  mode?: 'latest' | 'older';
  rebuildProjection?: boolean;
  shouldContinue?: () => boolean;
}): Promise<TradeHistoryV2PipelineResult> => {
  if (walletIndex) assertTradeHistoryV2WalletIndex(walletIndex, capability, deployment, viewer);
  if (
    deployment.chainId !== scope.chainId ||
    deployment.contractAddress !== getAddress(scope.contractAddress).toLowerCase() ||
    deployment.deploymentBlock !== scope.deploymentBlock
  ) {
    throw new Error('Trade-history pipeline scope does not match its attested deployment.');
  }
  if (BigInt(deployment.finalityLagBlocks) !== confirmationDepth) {
    throw new Error('Trade-history pipeline finality differs from the attested deployment policy.');
  }
  if (getTradeHistoryV2LedgerRevision({
    state: previous.sync.ledger,
    chainId: scope.chainId,
    contractAddress: scope.contractAddress
  }) !== expectedLedgerRevision) {
    throw new Error('Trade-history pipeline started from a stale ledger revision.');
  }
  if (getTradeHistoryV2MaterializationRevision({
    state: previous.materialization,
    chainId: scope.chainId,
    contractAddress: scope.contractAddress
  }) !== expectedMaterializationRevision) {
    throw new Error('Trade-history pipeline started from a stale materialization revision.');
  }

  const scopeKey = buildTradeHistoryV2ScopeKey(scope);
  const saved = canonicalPagesByState.get(previous);
  const walletKey = walletIndex && `${walletIndex.ownerAddress}:${walletIndex.complete === false ? 'all-events' : walletIndex.orderIds.join(',')}`;
  if (saved && (saved.deployment !== deployment || saved.walletKey !== walletKey)) {
    throw new Error('Trade-history public pages belong to another attested deployment.');
  }
  let canonicalPages = saved?.pages ?? [];
  let directTerms = new Map(saved?.directTerms);
  const resolveDirectTerms = mode && viewer ? async (status: ParsedDirectTradeV2Status): Promise<DirectTradeV2AcceptanceTerms> => {
    const cached = directTerms.get(status.orderId);
    if (cached) return cached;
    const terms = await readDirectTradeV2PublicTradeTerms({ capability, deployment, ownerAddress: viewer, tradeId: status.orderId });
    if (BigInt(terms.createdAt) > BigInt(status.changedAt) || terms.maker !== status.maker || terms.taker !== status.taker) {
      throw new Error('Direct history terms do not match the canonical acceptance.');
    }
    const result = Object.freeze({ protocol: 'direct-v2' as const, chainId: deployment.chainId,
      contractAddress: deployment.contractAddress, orderId: status.orderId, maker: terms.maker, taker: terms.taker,
      amountMode: terms.amountMode, publicAmounts: Object.freeze(terms.amountMode === 'public'
        ? { offerAmount: terms.offerAmount, requestAmount: terms.requestAmount } : {}) });
    directTerms.set(status.orderId, result);
    return result;
  } : undefined;
  if (rebuildProjection && previous.sync.checkpointsByScope[scopeKey] && !canonicalPages.length) {
    throw new Error('Trade-history projection is missing its verified public pages.');
  }
  let pendingMaterialization = previous.materialization;
  let materializedPage = false;
  let canNarrowSuccessfulRange = false;
  let syncResult: TradeHistoryV2SyncResult;
  try {
  syncResult = await syncTradeHistoryV2Range({
    previous: previous.sync,
    scope,
    confirmationDepth,
    maxBlockSpan,
    overlapBlocks,
    expectedRevision: expectedLedgerRevision,
    mode,
    shouldContinue,
    dependencies: {
      ...reads,
      readCompleteRange: async ({ fromBlock, toBlock, reorged, reset }) => {
        let base = previous.materialization;
        let baseRevision = expectedMaterializationRevision;
        if (reorged || reset) {
          base = clearTradeHistoryV2MaterializationScope({
            previous: base,
            chainId: scope.chainId,
            contractAddress: scope.contractAddress,
            expectedRevision: baseRevision
          });
          baseRevision += 1;
        }
        const readPage = () => readCanonicalTradeHistoryV2LogRange({
          capability,
          deployment,
          walletIndex,
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock)
        });
        const canonicalPage = await readPage().catch(cause => {
          canNarrowSuccessfulRange = cause instanceof TradeHistoryV2RangeLimitError &&
            BigInt(toBlock) - BigInt(fromBlock) + 1n > TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS;
          throw cause;
        });
        if (reorged || reset) { canonicalPages = []; directTerms = new Map(); }
        canonicalPages = [...canonicalPages.filter(page =>
          BigInt(page.range.fromBlock) < BigInt(fromBlock) || BigInt(page.range.toBlock) > BigInt(toBlock)
        ), canonicalPage];
        const materialized = await materializeCanonicalTradeHistoryV2Range({
          previous: base,
          canonicalPage,
          chainId: scope.chainId,
          contractAddress: scope.contractAddress,
          expectedRevision: baseRevision,
          viewer,
          resolvePrivateReceiptAmounts: rebuildProjection ? undefined : resolvePrivateReceiptAmounts,
          resolveDirectPrivateAmounts: rebuildProjection ? undefined : resolveDirectPrivateAmounts,
          resolveDirectTerms,
          shouldContinue
        });
        pendingMaterialization = materialized.state;
        materializedPage = true;
        return materialized.page;
      }
    }
  });
  } catch (cause) {
    // A successful oversized response has no committed state. Narrow once
    // from the original checkpoint; all transport/validation failures stop.
    if (!canNarrowSuccessfulRange) throw cause;
    if (shouldContinue && !shouldContinue()) throw new Error('Trade-history pipeline scope changed before page fallback.');
    return { ...await syncTradeHistoryV2PipelineRange({ previous, scope, capability, deployment,
      confirmationDepth, maxBlockSpan: TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS, overlapBlocks,
      reads, viewer, walletIndex, resolvePrivateReceiptAmounts, resolveDirectPrivateAmounts,
      expectedLedgerRevision, expectedMaterializationRevision, rebuildProjection, mode, shouldContinue }), narrowedForLogLimit: true };
  }

  if ((syncResult.reorged || syncResult.reset) && !materializedPage) {
    canonicalPages = [];
    directTerms = new Map();
    pendingMaterialization = clearTradeHistoryV2MaterializationScope({
      previous: previous.materialization,
      chainId: scope.chainId,
      contractAddress: scope.contractAddress,
      expectedRevision: expectedMaterializationRevision
    });
  }
  if (rebuildProjection) {
    let ledger = clearTradeHistoryV2Scope({ previous: syncResult.state.ledger, ...scope,
      expectedRevision: getTradeHistoryV2LedgerRevision({ state: syncResult.state.ledger, ...scope }) });
    pendingMaterialization = clearTradeHistoryV2MaterializationScope({ previous: pendingMaterialization, ...scope,
      expectedRevision: getTradeHistoryV2MaterializationRevision({ state: pendingMaterialization, ...scope }) });
    for (const canonicalPage of canonicalPages) {
      const materialized = await materializeCanonicalTradeHistoryV2Range({
        previous: pendingMaterialization, canonicalPage, ...scope, viewer,
        expectedRevision: getTradeHistoryV2MaterializationRevision({ state: pendingMaterialization, ...scope }),
        resolvePrivateReceiptAmounts, resolveDirectPrivateAmounts, resolveDirectTerms, shouldContinue
      });
      ledger = replaceTradeHistoryV2Range({ previous: ledger, page: materialized.page,
        expectedRevision: getTradeHistoryV2LedgerRevision({ state: ledger, ...scope }) });
      pendingMaterialization = materialized.state;
    }
    // Sync checked the retained checkpoint before reuse; check again after private work.
    const checkpoint = syncResult.state.checkpointsByScope[scopeKey];
    if (checkpoint) {
      const latest = await reads.getLatestBlockNumber(scope.chainId);
      if (!/^(0|[1-9][0-9]*)$/.test(latest) || BigInt(latest) < BigInt(checkpoint.blockNumber) + confirmationDepth) {
        throw new Error('Trade-history checkpoint is no longer finalized after rebuilding the private projection.');
      }
      const block = await reads.readCanonicalBlock(scope.chainId, checkpoint.blockNumber);
      if (!block || block.number !== checkpoint.blockNumber || block.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
        throw new Error('Trade-history checkpoint changed while rebuilding the private projection.');
      }
    }
    syncResult = { ...syncResult, state: { ...syncResult.state, ledger } };
  }
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Trade-history pipeline scope changed before commit.');
  }
  const state = Object.freeze({ sync: syncResult.state, materialization: pendingMaterialization });
  canonicalPagesByState.set(state, Object.freeze({ deployment, walletKey, pages: Object.freeze(canonicalPages), directTerms }));
  return { ...syncResult, state };
};
