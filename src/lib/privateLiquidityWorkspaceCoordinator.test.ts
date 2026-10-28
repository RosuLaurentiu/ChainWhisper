import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readBlock: vi.fn(),
  readAnchor: vi.fn(),
  readPositions: vi.fn(),
  compose: vi.fn(),
  materializeCatalog: vi.fn(),
  readCatalogPage: vi.fn(),
  sync: vi.fn(),
  buildModel: vi.fn()
}));

vi.mock('./privateLiquidityChain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityChain')>(),
  assertAttestedPrivateLiquidityDeployment: vi.fn(),
  assertCanonicalPrivateLiquidityCatalogAnchor: vi.fn(),
  assertCanonicalPrivateLiquidityPositionSnapshot: vi.fn(),
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot: vi.fn(),
  readCanonicalPrivateLiquidityBlock: mocks.readBlock,
  readCanonicalPrivateLiquidityCatalogAnchor: mocks.readAnchor,
  readCanonicalPrivateLiquidityPositions: mocks.readPositions,
  composeCompleteCanonicalPrivateLiquidityPositionSnapshot: mocks.compose
}));

vi.mock('./privateLiquidityCatalog', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityCatalog')>(),
  assertCanonicalPrivateLiquidityPositionCatalog: vi.fn(),
  materializeCanonicalPrivateLiquidityPositionCatalog: mocks.materializeCatalog,
  readCanonicalPrivateLiquidityCatalogPage: mocks.readCatalogPage
}));

vi.mock('./privateLiquiditySync', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquiditySync')>(),
  syncPrivateLiquidityHistoryRange: mocks.sync
}));

vi.mock('./privateLiquidityWorkspaceModel', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityWorkspaceModel')>(),
  buildPrivateLiquidityWorkspaceModel: mocks.buildModel
}));

import type {
  AttestedPrivateLiquidityDeployment,
  CanonicalPrivateLiquidityCatalogAnchor,
  CanonicalPrivateLiquidityPositionSnapshot,
  CompleteCanonicalPrivateLiquidityPositionSnapshot,
  PrivateLiquidityReadCapability
} from './privateLiquidityChain';
import type { CanonicalPrivateLiquidityPositionCatalog } from './privateLiquidityCatalog';
import {
  buildPrivateLiquidityHistorySyncScopeKey,
  type PrivateLiquidityHistorySyncState
} from './privateLiquiditySync';
import type { PrivateLiquidityWorkspaceModel } from './privateLiquidityWorkspaceModel';
import {
  advancePrivateLiquidityWorkspace,
  assertPrivateLiquidityWorkspaceCoordinatorState,
  createPrivateLiquidityWorkspaceCoordinatorState
} from './privateLiquidityWorkspaceCoordinator';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const CONTRACT = address('11');
const OWNER = address('22');
const CHAIN_ID = '7082400';

const deployment = Object.freeze({
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  deploymentBlock: '100'
}) as unknown as AttestedPrivateLiquidityDeployment;
const capability = Object.freeze({}) as PrivateLiquidityReadCapability;
const anchor = Object.freeze({
  scope: Object.freeze({ chainId: CHAIN_ID, contractAddress: CONTRACT, deploymentBlock: '100' }),
  atBlock: Object.freeze({ number: '120', hash: hash('12') }),
  nextPositionId: '3',
  positionCount: '2'
}) as unknown as CanonicalPrivateLiquidityCatalogAnchor;
const catalog = Object.freeze({
  scope: anchor.scope,
  atBlock: anchor.atBlock,
  positionCount: '2',
  entries: Object.freeze([])
}) as unknown as CanonicalPrivateLiquidityPositionCatalog;
const batch = Object.freeze({
  scope: anchor.scope,
  atBlock: anchor.atBlock,
  positions: Object.freeze([
    { identity: { positionId: '1' } },
    { identity: { positionId: '2' } }
  ])
}) as unknown as CanonicalPrivateLiquidityPositionSnapshot;
const complete = Object.freeze({
  ...batch,
  positionCount: '2'
}) as unknown as CompleteCanonicalPrivateLiquidityPositionSnapshot;
const model = Object.freeze({
  atBlock: anchor.atBlock,
  positions: Object.freeze([]),
  markets: Object.freeze([]),
  ownedPositions: Object.freeze([]),
  selection: Object.freeze({ status: 'none', historyRows: Object.freeze([]) })
}) as PrivateLiquidityWorkspaceModel;

const syncedState = (): PrivateLiquidityHistorySyncState => {
  const key = buildPrivateLiquidityHistorySyncScopeKey(deployment);
  return {
    scopes: {
      [key]: {
        revision: 1,
        pages: [],
        checkpoint: { blockNumber: '120', blockHash: hash('12') }
      }
    }
  };
};

describe('privateLiquidityWorkspaceCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sync.mockResolvedValue({
      status: 'page-applied',
      state: syncedState(),
      safeHead: '120',
      hasMore: false,
      reorged: false
    });
    mocks.readAnchor.mockResolvedValue(anchor);
    mocks.materializeCatalog.mockReturnValue(catalog);
    mocks.readBlock.mockResolvedValue(anchor.atBlock);
    mocks.readCatalogPage.mockReturnValue({ positionIds: ['1', '2'], complete: true });
    mocks.readPositions.mockResolvedValue(batch);
    mocks.compose.mockReturnValue(complete);
    mocks.buildModel.mockReturnValue(model);
  });

  it('holds one finalized anchor, hydrates bounded batches, and exposes only a complete model', async () => {
    const initial = createPrivateLiquidityWorkspaceCoordinatorState();
    expect(() => assertPrivateLiquidityWorkspaceCoordinatorState(initial)).not.toThrow();
    const prepared = await advancePrivateLiquidityWorkspace({
      previous: initial,
      expectedRevision: initial.revision,
      capability,
      deployment,
      walletAddress: OWNER,
      positionBatchSize: 2
    });
    expect(prepared.phase).toBe('hydrating-positions');
    expect(prepared.state.model).toBeUndefined();

    const ready = await advancePrivateLiquidityWorkspace({
      previous: prepared.state,
      expectedRevision: prepared.state.revision,
      capability,
      deployment,
      walletAddress: OWNER,
      positionBatchSize: 2
    });
    expect(ready.phase).toBe('ready');
    expect(ready.hydratedPositionCount).toBe(2);
    expect(ready.totalPositionCount).toBe('2');
    expect(ready.state.model).toBe(model);
    expect(mocks.readPositions).toHaveBeenCalledWith(expect.objectContaining({
      positionIds: [1n, 2n],
      atBlock: 120n
    }));
    expect(mocks.compose).toHaveBeenCalledWith({ anchor, snapshots: [batch] });

    vi.clearAllMocks();
    mocks.sync.mockResolvedValue({
      status: 'up-to-date',
      state: ready.state.historySync,
      safeHead: '120',
      hasMore: false,
      reorged: false
    });
    mocks.buildModel.mockReturnValue(model);
    const refreshed = await advancePrivateLiquidityWorkspace({
      previous: ready.state,
      expectedRevision: ready.state.revision,
      capability,
      deployment,
      walletAddress: OWNER,
      selectedPositionId: '2'
    });
    expect(refreshed.phase).toBe('ready');
    expect(mocks.readAnchor).not.toHaveBeenCalled();
    expect(mocks.readPositions).not.toHaveBeenCalled();
    expect(mocks.buildModel).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: complete,
      selectedPositionId: '2'
    }));
  });

  it('drops in-progress hydration and returns to event replay when its anchor is reorganized', async () => {
    const initial = createPrivateLiquidityWorkspaceCoordinatorState();
    const prepared = await advancePrivateLiquidityWorkspace({
      previous: initial,
      expectedRevision: 0,
      capability,
      deployment
    });
    mocks.readBlock
      .mockResolvedValueOnce({ number: '120', hash: hash('12') })
      .mockResolvedValueOnce({ number: '120', hash: hash('ff') });
    mocks.sync.mockResolvedValueOnce({
      status: 'reorg-replay',
      state: syncedState(),
      safeHead: '120',
      hasMore: true,
      reorged: true
    });

    const replay = await advancePrivateLiquidityWorkspace({
      previous: prepared.state,
      expectedRevision: prepared.state.revision,
      capability,
      deployment
    });
    expect(replay.phase).toBe('syncing-events');
    expect(replay.reorged).toBe(true);
    expect(replay.state.positionBatches).toEqual([]);
    expect(mocks.readPositions).not.toHaveBeenCalled();
  });

  it('makes an empty, fully anchored deployment ready without an invalid empty getter batch', async () => {
    const emptyAnchor = Object.freeze({ ...anchor, nextPositionId: '1', positionCount: '0' }) as unknown as
      CanonicalPrivateLiquidityCatalogAnchor;
    const emptyCatalog = Object.freeze({ ...catalog, positionCount: '0' }) as unknown as
      CanonicalPrivateLiquidityPositionCatalog;
    const emptyComplete = Object.freeze({ ...complete, positionCount: '0', positions: Object.freeze([]) }) as unknown as
      CompleteCanonicalPrivateLiquidityPositionSnapshot;
    mocks.readAnchor.mockResolvedValue(emptyAnchor);
    mocks.materializeCatalog.mockReturnValue(emptyCatalog);
    mocks.compose.mockReturnValue(emptyComplete);

    const initial = createPrivateLiquidityWorkspaceCoordinatorState();
    const ready = await advancePrivateLiquidityWorkspace({
      previous: initial,
      expectedRevision: 0,
      capability,
      deployment
    });
    expect(ready.phase).toBe('ready');
    expect(mocks.readPositions).not.toHaveBeenCalled();
    expect(mocks.compose).toHaveBeenCalledWith({ anchor: emptyAnchor, snapshots: [] });
  });

  it('rejects structural states, stale commits, and oversized hydration batches', async () => {
    expect(() => assertPrivateLiquidityWorkspaceCoordinatorState({} as never)).toThrow(/not created/);
    const initial = createPrivateLiquidityWorkspaceCoordinatorState();
    await expect(advancePrivateLiquidityWorkspace({
      previous: initial,
      expectedRevision: 1,
      capability,
      deployment
    })).rejects.toThrow(/stale revision/);
    await expect(advancePrivateLiquidityWorkspace({
      previous: initial,
      expectedRevision: 0,
      capability,
      deployment,
      positionBatchSize: 129
    })).rejects.toThrow(/between 1 and 128/);
  });
});
