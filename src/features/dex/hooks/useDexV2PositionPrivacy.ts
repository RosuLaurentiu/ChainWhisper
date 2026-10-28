import { useCallback, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  revealDexV2PoolPosition,
  type RevealedDexV2PoolPosition
} from '../../../lib/dexV2PoolExecution';
import {
  revealDexV2HiddenPosition,
  type RevealedDexV2HiddenPosition
} from '../../../lib/dexV2HiddenExecution';
import type { DexV2OwnedPosition } from '../../../lib/dexV2PositionDiscovery';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

type RevealState = Readonly<{
  scopeKey: string;
  activePositionId: string | null;
  message: string;
  poolSnapshots: Readonly<Record<string, RevealedDexV2PoolPosition>>;
  hiddenSnapshots: Readonly<Record<string, RevealedDexV2HiddenPosition>>;
}>;

const EMPTY: RevealState = Object.freeze({
  scopeKey: '',
  activePositionId: null,
  message: '',
  poolSnapshots: Object.freeze({}),
  hiddenSnapshots: Object.freeze({})
});

export default function useDexV2PositionPrivacy({
  runtime,
  sharedWalletSession
}: {
  runtime: DexV2RuntimeState;
  sharedWalletSession?: SharedWalletSession;
}) {
  const scopeKey = runtime.status === 'ready'
    ? [
        runtime.deployment.manifest.manifestHash,
        runtime.deployment.attestationBlock.number,
        sharedWalletSession?.walletAddress.trim().toLowerCase() ?? ''
      ].join(':')
    : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [state, setState] = useState<RevealState>(EMPTY);
  const visibleState = state.scopeKey === scopeKey ? state : EMPTY;

  const revealPool = useCallback(async (position: DexV2OwnedPosition) => {
    const walletActions = sharedWalletSession?.actions;
    if (
      runtime.status !== 'ready' ||
      !walletActions ||
      !scopeKey ||
      position.kind !== 'pool' ||
      position.needsPrivacyActivation ||
      visibleState.activePositionId
    ) return;
    const capturedScope = scopeKey;
    setState(Object.freeze({
      scopeKey: capturedScope,
      activePositionId: position.positionId,
      message: 'Unlocking your private Pool claim…',
      poolSnapshots: visibleState.poolSnapshots,
      hiddenSnapshots: visibleState.hiddenSnapshots
    }));
    try {
      const snapshot = await walletActions.runWalletTransactionFlow(async () => {
        const signer = await walletActions.getSigner(true);
        if (scopeRef.current !== capturedScope) throw new Error('The DEX position view changed.');
        return revealDexV2PoolPosition({
          deployment: runtime.deployment,
          positionId: BigInt(position.positionId),
          expectedOwnerRevision: BigInt(position.ownerRevision),
          signer
        });
      });
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: '',
        poolSnapshots: Object.freeze({ ...visibleState.poolSnapshots, [position.positionId]: snapshot }),
        hiddenSnapshots: visibleState.hiddenSnapshots
      }));
    } catch (error) {
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: getProviderErrorMessage(error, 'The private Pool claim could not be revealed.'),
        poolSnapshots: visibleState.poolSnapshots,
        hiddenSnapshots: visibleState.hiddenSnapshots
      }));
    }
  }, [
    runtime,
    scopeKey,
    sharedWalletSession,
    visibleState.activePositionId,
    visibleState.hiddenSnapshots,
    visibleState.poolSnapshots
  ]);

  const revealHidden = useCallback(async (position: DexV2OwnedPosition) => {
    const walletActions = sharedWalletSession?.actions;
    if (
      runtime.status !== 'ready' ||
      !walletActions ||
      !scopeKey ||
      position.kind === 'pool' ||
      position.needsPrivacyActivation ||
      visibleState.activePositionId
    ) return;
    const hiddenKind = position.kind === 'limit' ? 'limit' as const : 'recurring' as const;
    const capturedScope = scopeKey;
    setState(Object.freeze({
      scopeKey: capturedScope,
      activePositionId: position.positionId,
      message: 'Unlocking the private hidden inventory…',
      poolSnapshots: visibleState.poolSnapshots,
      hiddenSnapshots: visibleState.hiddenSnapshots
    }));
    try {
      const snapshot = await walletActions.runWalletTransactionFlow(async () => {
        const signer = await walletActions.getSigner(true);
        if (scopeRef.current !== capturedScope) throw new Error('The DEX position view changed.');
        return revealDexV2HiddenPosition({
          deployment: runtime.deployment,
          positionId: BigInt(position.positionId),
          kind: hiddenKind,
          expectedOwnerRevision: BigInt(position.ownerRevision),
          signer
        });
      });
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: '',
        poolSnapshots: visibleState.poolSnapshots,
        hiddenSnapshots: Object.freeze({ ...visibleState.hiddenSnapshots, [position.positionId]: snapshot })
      }));
    } catch (error) {
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: getProviderErrorMessage(error, 'The private hidden inventory could not be revealed.'),
        poolSnapshots: visibleState.poolSnapshots,
        hiddenSnapshots: visibleState.hiddenSnapshots
      }));
    }
  }, [
    runtime,
    scopeKey,
    sharedWalletSession,
    visibleState.activePositionId,
    visibleState.hiddenSnapshots,
    visibleState.poolSnapshots
  ]);

  return Object.freeze({
    activePositionId: visibleState.activePositionId,
    message: visibleState.message,
    poolSnapshots: visibleState.poolSnapshots,
    hiddenSnapshots: visibleState.hiddenSnapshots,
    revealPool,
    revealHidden
  });
}
