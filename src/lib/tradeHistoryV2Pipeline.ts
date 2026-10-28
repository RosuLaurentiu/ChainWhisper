import { getAddress } from '@coti-io/coti-ethers';
import {
  readCanonicalTradeHistoryV2LogRange,
  type AttestedTradeHistoryV2Deployment,
  type TradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';
import {
  clearTradeHistoryV2MaterializationScope,
  getTradeHistoryV2MaterializationRevision,
  materializeCanonicalTradeHistoryV2Range,
  type TradeHistoryV2DirectPrivateAmountResolver,
  type TradeHistoryV2MaterializationState,
  type TradeHistoryV2PrivateAmountResolver
} from './tradeHistoryV2Materialize';
import {
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

export type TradeHistoryV2PipelineResult = Omit<TradeHistoryV2SyncResult, 'state'> & Readonly<{
  state: TradeHistoryV2PipelineState;
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
  resolvePrivateReceiptAmounts,
  resolveDirectPrivateAmounts,
  expectedLedgerRevision,
  expectedMaterializationRevision,
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
  resolvePrivateReceiptAmounts?: TradeHistoryV2PrivateAmountResolver;
  resolveDirectPrivateAmounts?: TradeHistoryV2DirectPrivateAmountResolver;
  expectedLedgerRevision: number;
  expectedMaterializationRevision: number;
  shouldContinue?: () => boolean;
}): Promise<TradeHistoryV2PipelineResult> => {
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

  let pendingMaterialization = previous.materialization;
  let materializedPage = false;
  const syncResult = await syncTradeHistoryV2Range({
    previous: previous.sync,
    scope,
    confirmationDepth,
    maxBlockSpan,
    overlapBlocks,
    expectedRevision: expectedLedgerRevision,
    shouldContinue,
    dependencies: {
      ...reads,
      readCompleteRange: async ({ fromBlock, toBlock, reorged }) => {
        let base = previous.materialization;
        let baseRevision = expectedMaterializationRevision;
        if (reorged) {
          base = clearTradeHistoryV2MaterializationScope({
            previous: base,
            chainId: scope.chainId,
            contractAddress: scope.contractAddress,
            expectedRevision: baseRevision
          });
          baseRevision += 1;
        }
        const canonicalPage = await readCanonicalTradeHistoryV2LogRange({
          capability,
          deployment,
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock)
        });
        const materialized = await materializeCanonicalTradeHistoryV2Range({
          previous: base,
          canonicalPage,
          chainId: scope.chainId,
          contractAddress: scope.contractAddress,
          expectedRevision: baseRevision,
          viewer,
          resolvePrivateReceiptAmounts,
          resolveDirectPrivateAmounts,
          shouldContinue
        });
        pendingMaterialization = materialized.state;
        materializedPage = true;
        return materialized.page;
      }
    }
  });

  if (syncResult.reorged && !materializedPage) {
    pendingMaterialization = clearTradeHistoryV2MaterializationScope({
      previous: previous.materialization,
      chainId: scope.chainId,
      contractAddress: scope.contractAddress,
      expectedRevision: expectedMaterializationRevision
    });
  }
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Trade-history pipeline scope changed before commit.');
  }
  return {
    ...syncResult,
    state: {
      sync: syncResult.state,
      materialization: pendingMaterialization
    }
  };
};
