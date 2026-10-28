import {
  assertCanonicalPrivateLiquidityCatalogAnchor,
  assertCanonicalPrivateLiquidityPositionSnapshot,
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot,
  composeCompleteCanonicalPrivateLiquidityPositionSnapshot,
  readCanonicalPrivateLiquidityBlock,
  readCanonicalPrivateLiquidityCatalogAnchor,
  readCanonicalPrivateLiquidityPositions,
  type AttestedPrivateLiquidityDeployment,
  type CanonicalPrivateLiquidityCatalogAnchor,
  type CanonicalPrivateLiquidityPositionSnapshot,
  type CompleteCanonicalPrivateLiquidityPositionSnapshot,
  type PrivateLiquidityReadCapability
} from './privateLiquidityChain';
import {
  assertCanonicalPrivateLiquidityPositionCatalog,
  materializeCanonicalPrivateLiquidityPositionCatalog,
  readCanonicalPrivateLiquidityCatalogPage,
  type CanonicalPrivateLiquidityPositionCatalog
} from './privateLiquidityCatalog';
import type { PrivateLiquidityHistory } from './privateLiquidityHistory';
import {
  buildPrivateLiquidityHistorySyncScopeKey,
  createPrivateLiquidityHistorySyncState,
  getPrivateLiquidityHistorySyncScope,
  syncPrivateLiquidityHistoryRange,
  type PrivateLiquidityHistorySyncState
} from './privateLiquiditySync';
import {
  buildPrivateLiquidityWorkspaceModel,
  type PrivateLiquidityWorkspaceModel
} from './privateLiquidityWorkspaceModel';

export type PrivateLiquidityWorkspacePhase =
  | 'syncing-events'
  | 'hydrating-positions'
  | 'ready';

declare const PRIVATE_LIQUIDITY_WORKSPACE_STATE_BRAND: unique symbol;
export type PrivateLiquidityWorkspaceCoordinatorState = Readonly<{
  revision: number;
  deploymentKey?: string;
  phase: PrivateLiquidityWorkspacePhase;
  historySync: PrivateLiquidityHistorySyncState;
  anchor?: CanonicalPrivateLiquidityCatalogAnchor;
  catalog?: CanonicalPrivateLiquidityPositionCatalog;
  positionBatches: readonly CanonicalPrivateLiquidityPositionSnapshot[];
  nextOffset: string;
  completeSnapshot?: CompleteCanonicalPrivateLiquidityPositionSnapshot;
  model?: PrivateLiquidityWorkspaceModel;
  readonly [PRIVATE_LIQUIDITY_WORKSPACE_STATE_BRAND]: true;
}>;

export type PrivateLiquidityWorkspaceCoordinatorResult = Readonly<{
  state: PrivateLiquidityWorkspaceCoordinatorState;
  phase: PrivateLiquidityWorkspacePhase;
  reorged: boolean;
  eventSafeHead?: string;
  eventHasMore: boolean;
  hydratedPositionCount: number;
  totalPositionCount?: string;
}>;

const STATES = new WeakSet<object>();
const EMPTY_HISTORY: PrivateLiquidityHistory = Object.freeze({
  traderRows: Object.freeze([]),
  positionRows: Object.freeze([]),
  positionTotals: Object.freeze([])
});

const own = (
  value: Omit<PrivateLiquidityWorkspaceCoordinatorState, typeof PRIVATE_LIQUIDITY_WORKSPACE_STATE_BRAND>
): PrivateLiquidityWorkspaceCoordinatorState => {
  const state = Object.freeze(value) as PrivateLiquidityWorkspaceCoordinatorState;
  STATES.add(state);
  return state;
};

export const createPrivateLiquidityWorkspaceCoordinatorState = () => own({
  revision: 0,
  phase: 'syncing-events',
  historySync: createPrivateLiquidityHistorySyncState(),
  positionBatches: Object.freeze([]),
  nextOffset: '0'
});

export const assertPrivateLiquidityWorkspaceCoordinatorState = (
  state: PrivateLiquidityWorkspaceCoordinatorState
): void => {
  if (!state || !STATES.has(state)) {
    throw new Error('Private-liquidity workspace state was not created by its coordinator.');
  }
};

const assertContinue = (shouldContinue?: () => boolean): void => {
  if (shouldContinue && !shouldContinue()) {
    throw new Error('Private-liquidity workspace scope changed while loading.');
  }
};

const hydratedCount = (batches: readonly CanonicalPrivateLiquidityPositionSnapshot[]): number =>
  batches.reduce((total, batch) => total + batch.positions.length, 0);

const resetHydration = ({
  previous,
  deploymentKey,
  historySync,
  phase = 'syncing-events'
}: {
  previous: PrivateLiquidityWorkspaceCoordinatorState;
  deploymentKey: string;
  historySync: PrivateLiquidityHistorySyncState;
  phase?: PrivateLiquidityWorkspacePhase;
}): PrivateLiquidityWorkspaceCoordinatorState => own({
  revision: previous.revision + 1,
  deploymentKey,
  phase,
  historySync,
  positionBatches: Object.freeze([]),
  nextOffset: '0'
});

const result = ({
  state,
  reorged,
  eventSafeHead,
  eventHasMore
}: {
  state: PrivateLiquidityWorkspaceCoordinatorState;
  reorged: boolean;
  eventSafeHead?: string;
  eventHasMore: boolean;
}): PrivateLiquidityWorkspaceCoordinatorResult => Object.freeze({
  state,
  phase: state.phase,
  reorged,
  ...(eventSafeHead ? { eventSafeHead } : {}),
  eventHasMore,
  hydratedPositionCount: hydratedCount(state.positionBatches),
  ...(state.catalog ? { totalPositionCount: state.catalog.positionCount } : {})
});

const sameAnchor = (
  left: CanonicalPrivateLiquidityCatalogAnchor,
  right: { number: string; hash: string }
): boolean => left.atBlock.number === right.number && left.atBlock.hash === right.hash;

/**
 * Advances at most one finalized event page and one 1-128 position-view batch. While position
 * hydration is in progress it holds one canonical anchor, avoiding starvation as the safe head
 * advances. Any anchor reorg discards only this deployment's in-memory projection and lets the
 * range synchronizer replay it.
 */
export const advancePrivateLiquidityWorkspace = async ({
  previous,
  expectedRevision,
  capability,
  deployment,
  walletAddress,
  selectedPositionId,
  history = EMPTY_HISTORY,
  maxBlockSpan = 2_048n,
  overlapBlocks = 64n,
  positionBatchSize = 128,
  shouldContinue
}: {
  previous: PrivateLiquidityWorkspaceCoordinatorState;
  expectedRevision: number;
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  walletAddress?: string | null;
  selectedPositionId?: string | null;
  history?: PrivateLiquidityHistory;
  maxBlockSpan?: bigint;
  overlapBlocks?: bigint;
  positionBatchSize?: number;
  shouldContinue?: () => boolean;
}): Promise<PrivateLiquidityWorkspaceCoordinatorResult> => {
  assertPrivateLiquidityWorkspaceCoordinatorState(previous);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== previous.revision) {
    throw new Error('Private-liquidity workspace advance started from a stale revision.');
  }
  if (!Number.isSafeInteger(positionBatchSize) || positionBatchSize < 1 || positionBatchSize > 128) {
    throw new Error('Private-liquidity workspace position batch must be between 1 and 128.');
  }
  assertContinue(shouldContinue);
  const deploymentKey = buildPrivateLiquidityHistorySyncScopeKey(deployment);
  let current = previous.deploymentKey === deploymentKey
    ? previous
    : resetHydration({
        previous,
        deploymentKey,
        historySync: createPrivateLiquidityHistorySyncState()
      });

  // Finish a stable historical projection before chasing a newer head. The block is still checked
  // against the exact canonical hash on every batch, so a reorg cannot preserve stale hydration.
  if (current.phase === 'hydrating-positions' && current.anchor && current.catalog) {
    assertCanonicalPrivateLiquidityCatalogAnchor(current.anchor);
    assertCanonicalPrivateLiquidityPositionCatalog(current.catalog);
    const safeHead = await readCanonicalPrivateLiquidityBlock({ capability, deployment });
    assertContinue(shouldContinue);
    let anchorIsCanonical = BigInt(current.anchor.atBlock.number) <= BigInt(safeHead.number);
    if (anchorIsCanonical) {
      const anchorBlock = await readCanonicalPrivateLiquidityBlock({
        capability,
        deployment,
        blockNumber: BigInt(current.anchor.atBlock.number)
      });
      assertContinue(shouldContinue);
      anchorIsCanonical = sameAnchor(current.anchor, anchorBlock);
    }
    if (anchorIsCanonical) {
      const catalogPage = readCanonicalPrivateLiquidityCatalogPage({
        catalog: current.catalog,
        offset: current.nextOffset,
        limit: positionBatchSize
      });
      const batch = catalogPage.positionIds.length === 0
        ? undefined
        : await readCanonicalPrivateLiquidityPositions({
            capability,
            deployment,
            positionIds: catalogPage.positionIds.map(BigInt),
            atBlock: BigInt(current.anchor.atBlock.number)
          });
      assertContinue(shouldContinue);
      if (batch) {
        assertCanonicalPrivateLiquidityPositionSnapshot(batch);
        if (!sameAnchor(current.anchor, batch.atBlock) ||
            batch.positions.map(({ identity }) => identity.positionId).join(',') !==
              catalogPage.positionIds.join(',')) {
          throw new Error('Private-liquidity position reader returned another catalog batch.');
        }
      }
      const positionBatches = batch
        ? Object.freeze([...current.positionBatches, batch])
        : current.positionBatches;
      if (!catalogPage.complete) {
        const state = own({
          ...current,
          revision: current.revision + 1,
          positionBatches,
          nextOffset: catalogPage.nextOffset ?? current.nextOffset
        });
        return result({ state, reorged: false, eventHasMore: false });
      }
      const completeSnapshot = composeCompleteCanonicalPrivateLiquidityPositionSnapshot({
        anchor: current.anchor,
        snapshots: positionBatches
      });
      assertCompleteCanonicalPrivateLiquidityPositionSnapshot(completeSnapshot);
      const model = buildPrivateLiquidityWorkspaceModel({
        snapshot: completeSnapshot,
        walletAddress,
        selectedPositionId,
        history
      });
      const state = own({
        ...current,
        revision: current.revision + 1,
        phase: 'ready',
        positionBatches,
        nextOffset: current.catalog.positionCount,
        completeSnapshot,
        model
      });
      return result({ state, reorged: false, eventHasMore: false });
    }
    current = resetHydration({
      previous: current,
      deploymentKey,
      historySync: current.historySync
    });
  }

  const syncScope = getPrivateLiquidityHistorySyncScope({
    state: current.historySync,
    deployment
  });
  const sync = await syncPrivateLiquidityHistoryRange({
    previous: current.historySync,
    capability,
    deployment,
    maxBlockSpan,
    overlapBlocks,
    expectedRevision: syncScope.revision,
    shouldContinue
  });
  assertContinue(shouldContinue);
  if (
    sync.status === 'up-to-date' &&
    sync.state === current.historySync &&
    current.phase === 'ready' &&
    current.completeSnapshot
  ) {
    assertCompleteCanonicalPrivateLiquidityPositionSnapshot(current.completeSnapshot);
    const model = buildPrivateLiquidityWorkspaceModel({
      snapshot: current.completeSnapshot,
      walletAddress,
      selectedPositionId,
      history
    });
    const state = own({
      ...current,
      revision: current.revision + 1,
      model
    });
    return result({
      state,
      reorged: false,
      eventSafeHead: sync.safeHead,
      eventHasMore: false
    });
  }
  if (sync.hasMore || !getPrivateLiquidityHistorySyncScope({
    state: sync.state,
    deployment
  }).checkpoint) {
    const state = resetHydration({
      previous: current,
      deploymentKey,
      historySync: sync.state
    });
    return result({
      state,
      reorged: sync.reorged,
      eventSafeHead: sync.safeHead,
      eventHasMore: sync.hasMore
    });
  }

  const finalScope = getPrivateLiquidityHistorySyncScope({ state: sync.state, deployment });
  const checkpoint = finalScope.checkpoint!;
  const anchor = await readCanonicalPrivateLiquidityCatalogAnchor({
    capability,
    deployment,
    atBlock: BigInt(checkpoint.blockNumber)
  });
  assertContinue(shouldContinue);
  if (
    anchor.atBlock.number !== checkpoint.blockNumber ||
    anchor.atBlock.hash !== checkpoint.blockHash
  ) {
    throw new Error('Private-liquidity catalog anchor changed after event synchronization.');
  }
  const catalog = materializeCanonicalPrivateLiquidityPositionCatalog({
    deployment,
    syncState: sync.state,
    anchor
  });
  const prepared = own({
    revision: current.revision + 1,
    deploymentKey,
    phase: 'hydrating-positions',
    historySync: sync.state,
    anchor,
    catalog,
    positionBatches: Object.freeze([]),
    nextOffset: '0'
  });

  // Zero-position deployments are valid and become ready without issuing an invalid empty getter
  // batch. Non-empty catalogs hydrate on the next bounded advance.
  if (catalog.positionCount !== '0') {
    return result({
      state: prepared,
      reorged: sync.reorged,
      eventSafeHead: sync.safeHead,
      eventHasMore: false
    });
  }
  const completeSnapshot = composeCompleteCanonicalPrivateLiquidityPositionSnapshot({
    anchor,
    snapshots: []
  });
  const model = buildPrivateLiquidityWorkspaceModel({
    snapshot: completeSnapshot,
    walletAddress,
    selectedPositionId,
    history
  });
  const state = own({
    ...prepared,
    revision: prepared.revision + 1,
    phase: 'ready',
    completeSnapshot,
    model
  });
  return result({
    state,
    reorged: sync.reorged,
    eventSafeHead: sync.safeHead,
    eventHasMore: false
  });
};
