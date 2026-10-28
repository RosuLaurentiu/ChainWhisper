import { useCallback, useEffect, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import { captureDexV2ActionIntent } from '../../../lib/dexV2Actions';
import {
  confirmDexV2PositionLifecycle,
  submitDexV2PositionLifecycle,
  type ConfirmedDexV2PositionLifecycle
} from '../../../lib/dexV2PositionExecution';
import type { DexV2OwnedPosition } from '../../../lib/dexV2PositionDiscovery';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

type LifecycleState = Readonly<{
  scopeKey: string;
  activePositionId: string | null;
  message: string;
  confirmed: ConfirmedDexV2PositionLifecycle | null;
}>;

const EMPTY: LifecycleState = Object.freeze({
  scopeKey: '',
  activePositionId: null,
  message: '',
  confirmed: null
});

export default function useDexV2PositionLifecycle({
  requestConfirmation,
  runtime,
  sharedWalletSession,
  refreshRuntime,
  refreshPositions
}: {
  requestConfirmation: (confirmation: TradeActionConfirmModel) => Promise<boolean>;
  runtime: DexV2RuntimeState;
  sharedWalletSession?: SharedWalletSession;
  refreshRuntime: () => void;
  refreshPositions: () => void;
}) {
  const scopeKey = runtime.status === 'ready'
    ? [runtime.deployment.manifest.manifestHash, sharedWalletSession?.walletAddress.trim().toLowerCase() ?? ''].join(':')
    : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<LifecycleState>(EMPTY);
  const visibleState = state.scopeKey === scopeKey ? state : EMPTY;

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshRuntime();
      refreshPositions();
    }, 30_000);
  }, [refreshPositions, refreshRuntime]);

  const execute = useCallback(async ({
    position,
    mode,
    recipient = ''
  }: {
    position: DexV2OwnedPosition;
    mode: 'activate' | 'transfer';
    recipient?: string;
  }) => {
    const walletActions = sharedWalletSession?.actions;
    if (runtime.status !== 'ready' || !walletActions || !scopeKey || visibleState.activePositionId) return;
    const intent = captureDexV2ActionIntent(mode === 'activate' ? {
      kind: 'activate-position-privacy',
      positionId: BigInt(position.positionId),
      expectedOwnerRevision: BigInt(position.ownerRevision)
    } : {
      kind: 'transfer-position',
      recipient,
      positionId: BigInt(position.positionId),
      expectedOwnerRevision: BigInt(position.ownerRevision)
    });
    const accepted = await requestConfirmation(Object.freeze({
      title: mode === 'activate'
        ? `Activate private state for position #${position.positionId}`
        : `Transfer position #${position.positionId}`,
      message: mode === 'activate'
        ? 'This binds future private receipts to your current wallet. A paused hidden position remains paused until resumed separately.'
        : 'Ownership moves to the recipient. Private receipt access is cleared and hidden liquidity is paused until the recipient activates it.',
      primaryLabel: mode === 'activate' ? 'Activate privacy' : 'Transfer Position NFT',
      fundingMoves: [],
      summaryRows: mode === 'activate'
        ? [{ label: 'Position', value: `#${position.positionId}` }]
        : [
            { label: 'Position', value: `#${position.positionId}` },
            { label: 'Recipient', value: recipient }
          ],
      stats: [
        { label: 'Owner revision', value: position.ownerRevision },
        { label: 'Ownership', value: mode === 'activate' ? 'Unchanged' : 'Transferred' },
        { label: 'Finality', value: '5 confirmations' }
      ]
    }));
    if (!accepted || scopeRef.current !== scopeKey) return;
    const capturedScope = scopeKey;
    setState(Object.freeze({
      scopeKey: capturedScope,
      activePositionId: position.positionId,
      message: mode === 'activate' ? 'Activating private state…' : 'Transferring the Position NFT…',
      confirmed: null
    }));
    try {
      const confirmed = await walletActions.runWalletTransactionFlow(async () => {
        const signer = await walletActions.getSigner(mode === 'activate');
        if (scopeRef.current !== capturedScope) throw new Error('The DEX position view changed before signing.');
        const submission = await submitDexV2PositionLifecycle({ deployment: runtime.deployment, intent, signer });
        setState(Object.freeze({
          scopeKey: capturedScope,
          activePositionId: position.positionId,
          message: 'Waiting for five confirmations…',
          confirmed: null
        }));
        return confirmDexV2PositionLifecycle({ deployment: runtime.deployment, signer, submission });
      });
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: confirmed.kind === 'activate-position-privacy'
          ? `Private state activated at owner revision ${confirmed.ownerRevision}.`
          : `Position #${confirmed.positionId} transferred to ${confirmed.recipient}.`,
        confirmed
      }));
      scheduleRefresh();
    } catch (error) {
      if (scopeRef.current !== capturedScope) return;
      setState(Object.freeze({
        scopeKey: capturedScope,
        activePositionId: null,
        message: getProviderErrorMessage(error, 'The Position owner action could not be completed.'),
        confirmed: null
      }));
    }
  }, [requestConfirmation, runtime, scheduleRefresh, scopeKey, sharedWalletSession, visibleState.activePositionId]);

  return Object.freeze({
    activePositionId: visibleState.activePositionId,
    message: visibleState.message,
    confirmed: visibleState.confirmed,
    activatePrivacy: (position: DexV2OwnedPosition) => execute({ position, mode: 'activate' }),
    transfer: (position: DexV2OwnedPosition, recipient: string) => execute({ position, mode: 'transfer', recipient })
  });
}
