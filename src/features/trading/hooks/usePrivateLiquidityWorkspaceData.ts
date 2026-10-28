import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adoptAttestedPrivateLiquidityV2Book,
  bindPrivateLiquidityReadCapability,
  composeCompleteCanonicalPrivateLiquidityPositionSnapshot,
  readCanonicalPrivateLiquidityCatalogAnchor,
  readCanonicalPrivateLiquidityPositions,
  type CompleteCanonicalPrivateLiquidityPositionSnapshot,
  type AttestedPrivateLiquidityDeployment,
  type CanonicalPrivateLiquidityLogRange,
  type CanonicalPrivateLiquidityPositionSnapshot,
  type PrivateLiquidityReadCapability
} from '../../../lib/privateLiquidityChain';
import {
  PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG,
  type PrivateLiquidityV2DeploymentConfig
} from '../../../lib/privateLiquidityV2Deployment';
import {
  attestPrivateLiquidityV2Deployment,
  bindPrivateLiquidityV2ReadCapability
} from '../../../lib/privateLiquidityV2Chain';
import type { PrivateLiquidityHistory } from '../../../lib/privateLiquidityHistory';
import { createPrivateLiquidityHttpProvider } from '../../../lib/privateLiquidityRpc';
import {
  advancePrivateLiquidityWorkspace,
  createPrivateLiquidityWorkspaceCoordinatorState,
  type PrivateLiquidityWorkspaceCoordinatorState,
  type PrivateLiquidityWorkspacePhase
} from '../../../lib/privateLiquidityWorkspaceCoordinator';
import type { PrivateLiquidityWorkspaceModel } from '../../../lib/privateLiquidityWorkspaceModel';
import { buildPrivateLiquidityWorkspaceModel } from '../../../lib/privateLiquidityWorkspaceModel';
import { getPrivateLiquidityHistorySyncScope } from '../../../lib/privateLiquiditySync';
import { buildBrowserOwnerDataScopeKey } from '../../../lib/browserWalletRuntimeScope';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

const MAX_ADVANCES_PER_LOAD = 1_024;
const CURRENT_POSITION_BATCH_SIZE = 128n;
const EMPTY_HISTORY: PrivateLiquidityHistory = Object.freeze({
  traderRows: Object.freeze([]),
  positionRows: Object.freeze([]),
  positionTotals: Object.freeze([])
});
const EMPTY_HISTORY_PAGES: readonly CanonicalPrivateLiquidityLogRange[] = Object.freeze([]);

export const buildPrivateLiquidityWorkspaceDeploymentScopeKey = (
  config:
    | Readonly<{ status: 'inactive' }>
    | Readonly<{ status: 'invalid'; error: string }>
    | Readonly<{ status: 'active'; fingerprint: string }>
): string => config.status === 'active'
  ? config.fingerprint
  : config.status === 'invalid'
    ? `invalid:${config.error}`
    : config.status;

type ActiveContext = Readonly<{
  fingerprint: string;
  token: { active: boolean };
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
}>;

export type PrivateLiquidityWorkspaceDataStatus =
  | 'idle'
  | 'inactive'
  | 'configuration-error'
  | 'attesting'
  | PrivateLiquidityWorkspacePhase
  | 'error';

export type PrivateLiquidityWorkspaceData = Readonly<{
  status: PrivateLiquidityWorkspaceDataStatus;
  deploymentReady: boolean;
  deployment: AttestedPrivateLiquidityDeployment | null;
  model: PrivateLiquidityWorkspaceModel | null;
  completeSnapshot?: CompleteCanonicalPrivateLiquidityPositionSnapshot;
  error: string;
  hydratedPositionCount: number;
  totalPositionCount?: string;
  historyPages: readonly CanonicalPrivateLiquidityLogRange[];
  historyLoading: boolean;
  refresh: () => void;
  retryDeployment: () => void;
}>;

type ViewState = Omit<
  PrivateLiquidityWorkspaceData,
  'historyPages' | 'historyLoading' | 'refresh' | 'retryDeployment'
>;

const loadCurrentWorkspace = async ({
  capability,
  deployment,
  walletAddress,
  selectedPositionId,
  history,
  shouldContinue
}: {
  capability: PrivateLiquidityReadCapability;
  deployment: AttestedPrivateLiquidityDeployment;
  walletAddress?: string;
  selectedPositionId?: string | null;
  history: PrivateLiquidityHistory;
  shouldContinue: () => boolean;
}): Promise<Readonly<{
  snapshot: CompleteCanonicalPrivateLiquidityPositionSnapshot;
  model: PrivateLiquidityWorkspaceModel;
}>> => {
  const anchor = await readCanonicalPrivateLiquidityCatalogAnchor({ capability, deployment });
  if (!shouldContinue()) throw new Error('Private-liquidity current snapshot was superseded.');
  const count = BigInt(anchor.positionCount);
  if (BigInt(anchor.nextPositionId) !== count + 1n) {
    throw new Error('Private-liquidity current catalog is not contiguous.');
  }
  const snapshots: CanonicalPrivateLiquidityPositionSnapshot[] = [];
  for (let offset = 0n; offset < count; offset += CURRENT_POSITION_BATCH_SIZE) {
    const end = offset + CURRENT_POSITION_BATCH_SIZE < count
      ? offset + CURRENT_POSITION_BATCH_SIZE
      : count;
    const positionIds: bigint[] = [];
    for (let positionId = offset + 1n; positionId <= end; positionId += 1n) {
      positionIds.push(positionId);
    }
    const snapshot = await readCanonicalPrivateLiquidityPositions({
      capability,
      deployment,
      positionIds,
      atBlock: BigInt(anchor.atBlock.number)
    });
    if (!shouldContinue()) throw new Error('Private-liquidity current snapshot was superseded.');
    snapshots.push(snapshot);
  }
  const snapshot = composeCompleteCanonicalPrivateLiquidityPositionSnapshot({ anchor, snapshots });
  return Object.freeze({
    snapshot,
    model: buildPrivateLiquidityWorkspaceModel({
      snapshot,
      walletAddress,
      selectedPositionId,
      history
    })
  });
};

const inactiveView = (status: 'idle' | 'inactive'): ViewState => Object.freeze({
  status,
  deploymentReady: false,
  deployment: null,
  model: null,
  error: '',
  hydratedPositionCount: 0
});

/**
 * Inactive unless the complete public manifest is explicitly enabled. Public price/position reads
 * use the configured untrusted RPC and need no wallet prompt; MetaMask remains reserved for private
 * inventory/history reveals and mutations.
 */
export default function usePrivateLiquidityWorkspaceData({
  enabled,
  config = PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG,
  walletAddress,
  selectedPositionId,
  history = EMPTY_HISTORY
}: {
  enabled: boolean;
  config?: PrivateLiquidityV2DeploymentConfig;
  walletAddress?: string | null;
  selectedPositionId?: string | null;
  history?: PrivateLiquidityHistory;
}): PrivateLiquidityWorkspaceData {
  const contextRef = useRef<ActiveContext | null>(null);
  const coordinatorRef = useRef<PrivateLiquidityWorkspaceCoordinatorState | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const [contextRevision, setContextRevision] = useState(0);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [attestationRetryRevision, setAttestationRetryRevision] = useState(0);
  const [view, setView] = useState<ViewState>(() => inactiveView(
    config.status === 'inactive' ? 'inactive' : 'idle'
  ));
  const refresh = useCallback(() => setRefreshRevision((revision) => revision + 1), []);
  const retryDeployment = useCallback(() => {
    setAttestationRetryRevision((revision) => revision + 1);
  }, []);
  const deploymentScopeKey = buildPrivateLiquidityWorkspaceDeploymentScopeKey(config);
  const activeFingerprint = config.status === 'active' ? config.fingerprint : '';
  const ownerDataScopeKey = buildBrowserOwnerDataScopeKey(walletAddress ?? '');

  useEffect(() => {
    const scopedConfig = configRef.current;
    const prior = contextRef.current;
    if (prior) prior.token.active = false;
    contextRef.current = null;
    coordinatorRef.current = null;
    if (!enabled) {
      setView(inactiveView(scopedConfig.status === 'inactive' ? 'inactive' : 'idle'));
      return;
    }
    if (scopedConfig.status === 'inactive') {
      setView(inactiveView('inactive'));
      return;
    }
    if (scopedConfig.status === 'invalid') {
      setView(Object.freeze({
        status: 'configuration-error',
        deploymentReady: false,
        deployment: null,
        model: null,
        error: scopedConfig.error,
        hydratedPositionCount: 0
      }));
      return;
    }

    const token = { active: true };
    setView(Object.freeze({
      status: 'attesting',
      deploymentReady: false,
      deployment: null,
      model: null,
      error: '',
      hydratedPositionCount: 0
    }));
    void (async () => {
      try {
        const provider = createPrivateLiquidityHttpProvider({ rpcUrl: scopedConfig.rpcUrl });
        const assertCurrent = () => {
          if (!token.active) throw new Error('Private-liquidity deployment attestation was superseded.');
        };
        const [capability, v2Capability] = await Promise.all([
          bindPrivateLiquidityReadCapability({
            provider,
            expectedChainId: BigInt(scopedConfig.manifest.chainId),
            assertCurrent
          }),
          bindPrivateLiquidityV2ReadCapability({
            provider,
            expectedChainId: BigInt(scopedConfig.manifest.chainId),
            assertCurrent
          })
        ]);
        const v2Deployment = await attestPrivateLiquidityV2Deployment({
          capability: v2Capability,
          manifest: scopedConfig.manifest,
          finalityLagBlocks: scopedConfig.finalityLagBlocks
        });
        const deployment = await adoptAttestedPrivateLiquidityV2Book({
          capability,
          deployment: v2Deployment
        });
        assertCurrent();
        contextRef.current = Object.freeze({
          fingerprint: scopedConfig.fingerprint,
          token,
          capability,
          deployment
        });
        coordinatorRef.current = createPrivateLiquidityWorkspaceCoordinatorState();
        setView(Object.freeze({
          status: 'syncing-events',
          deploymentReady: true,
          deployment,
          model: null,
          error: '',
          hydratedPositionCount: 0
        }));
        setContextRevision((revision) => revision + 1);
      } catch (error) {
        if (!token.active) return;
        setView(Object.freeze({
          status: 'error',
          deploymentReady: false,
          deployment: null,
          model: null,
          error: getProviderErrorMessage(error, 'Private-liquidity deployment attestation failed.'),
          hydratedPositionCount: 0
        }));
      }
    })();
    return () => {
      token.active = false;
      if (contextRef.current?.token === token) contextRef.current = null;
    };
  }, [attestationRetryRevision, deploymentScopeKey, enabled]);

  useEffect(() => {
    const context = contextRef.current;
    let current = coordinatorRef.current;
    if (!enabled || !context || !current || context.fingerprint !== activeFingerprint) return;
    let cancelled = false;
    const shouldContinue = () => !cancelled && context.token.active && contextRef.current === context;
    void (async () => {
      let currentWorkspace: Awaited<ReturnType<typeof loadCurrentWorkspace>> | null = null;
      try {
        // Current public terms and side availability do not need the historical event backfill.
        // Publish the exact safe-head snapshot first so prices remain responsive while history
        // catches up in the background.
        currentWorkspace = await loadCurrentWorkspace({
          capability: context.capability,
          deployment: context.deployment,
          ...(ownerDataScopeKey ? { walletAddress: ownerDataScopeKey } : {}),
          selectedPositionId,
          history,
          shouldContinue
        });
        if (!shouldContinue()) return;
        setView(Object.freeze({
          status: 'ready',
          deploymentReady: true,
          deployment: context.deployment,
          model: currentWorkspace.model,
          completeSnapshot: currentWorkspace.snapshot,
          error: '',
          hydratedPositionCount: currentWorkspace.snapshot.positions.length,
          totalPositionCount: currentWorkspace.snapshot.positionCount
        }));
        for (let advanceCount = 0; advanceCount < MAX_ADVANCES_PER_LOAD; advanceCount += 1) {
          const loaded = await advancePrivateLiquidityWorkspace({
            previous: current,
            expectedRevision: current.revision,
            capability: context.capability,
            deployment: context.deployment,
            walletAddress: ownerDataScopeKey || undefined,
            selectedPositionId,
            history,
            shouldContinue
          });
          if (!shouldContinue()) return;
          current = loaded.state;
          coordinatorRef.current = current;
          if (loaded.phase === 'ready') {
            setView(Object.freeze({
              status: loaded.phase,
              deploymentReady: true,
              deployment: context.deployment,
              model: current.model ?? currentWorkspace.model,
              ...(current.completeSnapshot
                ? { completeSnapshot: current.completeSnapshot }
                : { completeSnapshot: currentWorkspace.snapshot }),
              error: '',
              hydratedPositionCount: loaded.hydratedPositionCount,
              ...(loaded.totalPositionCount ? { totalPositionCount: loaded.totalPositionCount } : {})
            }));
          }
          if (loaded.phase === 'ready') return;
        }
        throw new Error('Private-liquidity workspace exceeded its bounded synchronization budget.');
      } catch (error) {
        if (!shouldContinue()) return;
        if (currentWorkspace) {
          // A delayed history backfill must not take an already verified market quote offline.
          setView(Object.freeze({
            status: 'ready',
            deploymentReady: true,
            deployment: context.deployment,
            model: currentWorkspace.model,
            completeSnapshot: currentWorkspace.snapshot,
            error: '',
            hydratedPositionCount: currentWorkspace.snapshot.positions.length,
            totalPositionCount: currentWorkspace.snapshot.positionCount
          }));
          return;
        }
        setView(Object.freeze({
          status: 'error',
          deploymentReady: true,
          deployment: context.deployment,
          model: current.model ?? null,
          error: getProviderErrorMessage(error, 'Private-liquidity workspace loading failed.'),
          hydratedPositionCount: current.positionBatches.reduce(
            (total, batch) => total + batch.positions.length,
            0
          ),
          ...(current.catalog ? { totalPositionCount: current.catalog.positionCount } : {})
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFingerprint, contextRevision, enabled, history, ownerDataScopeKey, refreshRevision, selectedPositionId]);

  const historyPages = view.status === 'ready' && view.deployment && coordinatorRef.current
    ? getPrivateLiquidityHistorySyncScope({
        state: coordinatorRef.current.historySync,
        deployment: view.deployment
      }).pages
    : EMPTY_HISTORY_PAGES;
  const historyLoading = Boolean(
    enabled && view.deploymentReady && view.status === 'ready' && coordinatorRef.current &&
    !getPrivateLiquidityHistorySyncScope({
      state: coordinatorRef.current.historySync,
      deployment: view.deployment!
    }).checkpoint
  );
  return Object.freeze({ ...view, historyPages, historyLoading, refresh, retryDeployment });
}
