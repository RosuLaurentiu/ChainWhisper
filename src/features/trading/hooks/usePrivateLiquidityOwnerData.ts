import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isPrivateLiquidityReceiptPrivacyRefreshRequired,
  readPrivateLiquidityOwnerPrivateData,
  readPrivateLiquidityPrivateHistory,
  type PrivateLiquidityOwnerInventorySnapshot
} from '../../../lib/privateLiquidityActions';
import type {
  AttestedPrivateLiquidityDeployment,
  CanonicalPrivateLiquidityLogRange
} from '../../../lib/privateLiquidityChain';
import type { PrivateLiquidityHistory } from '../../../lib/privateLiquidityHistory';
import type { PrivateLiquidityWorkspaceModel } from '../../../lib/privateLiquidityWorkspaceModel';
import type { WalletSessionActions } from '../../../lib/walletSession';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

export type PrivateLiquidityOwnerDataStatus =
  | 'locked'
  | 'loading'
  | 'available'
  | 'unavailable'
  | 'error';

const EMPTY_HISTORY: PrivateLiquidityHistory = Object.freeze({
  traderRows: Object.freeze([]),
  positionRows: Object.freeze([]),
  positionTotals: Object.freeze([])
});

type OwnerDataState = Readonly<{
  status: PrivateLiquidityOwnerDataStatus;
  inventory: PrivateLiquidityOwnerInventorySnapshot | null;
  history: PrivateLiquidityHistory;
  error: string;
}>;

const LOCKED_STATE: OwnerDataState = Object.freeze({
  status: 'locked',
  inventory: null,
  history: EMPTY_HISTORY,
  error: ''
});

const errorMessage = (error: unknown): string =>
  getProviderErrorMessage(error, 'Private Position NFT data could not be decrypted.');

export default function usePrivateLiquidityOwnerData({
  deployment,
  model,
  historyPages,
  walletAddress,
  walletReady,
  walletActions
}: {
  deployment: AttestedPrivateLiquidityDeployment | null;
  model: PrivateLiquidityWorkspaceModel | null;
  historyPages: readonly CanonicalPrivateLiquidityLogRange[];
  walletAddress?: string | null;
  walletReady: boolean;
  walletActions?: Pick<WalletSessionActions, 'getPrivateLiquidityCapability' | 'runWalletTransactionFlow'>;
}) {
  const capabilityRef = useRef<Awaited<ReturnType<NonNullable<WalletSessionActions['getPrivateLiquidityCapability']>>> | null>(null);
  const revealedRef = useRef(false);
  const requestIdRef = useRef(0);
  const activeRevealRef = useRef(false);
  const [state, setState] = useState<OwnerDataState>(LOCKED_STATE);
  const selectedPosition = model?.selection.status === 'manageable'
    ? model.selection.position
    : undefined;
  const walletKey = walletAddress?.trim().toLowerCase() ?? '';
  const securityScopeKey = deployment && walletKey && walletReady
    ? `${deployment.chainId}:${deployment.contractAddress}:${walletKey}`
    : '';
  const canonicalDataKey = deployment && model
    ? [
        deployment.chainId,
        deployment.contractAddress,
        walletKey,
        model.atBlock.number,
        model.atBlock.hash,
        selectedPosition?.identity.positionId ?? 'wallet-history',
        selectedPosition?.revision ?? '0',
        historyPages.map((page) => `${page.range.fromBlock}-${page.range.toBlock}:${page.range.toBlockHash}`).join(',')
      ].join(':')
    : '';
  const loadContextRef = useRef({
    deployment,
    historyPages,
    model,
    selectedPosition,
    walletActions,
    walletKey,
    walletReady
  });
  loadContextRef.current = {
    deployment,
    historyPages,
    model,
    selectedPosition,
    walletActions,
    walletKey,
    walletReady
  };

  const load = useCallback(async ({ interactive }: { interactive: boolean }) => {
    const {
      deployment: currentDeployment,
      historyPages: currentHistoryPages,
      model: currentModel,
      selectedPosition: currentSelectedPosition,
      walletActions: currentWalletActions,
      walletKey: currentWalletKey,
      walletReady: currentWalletReady
    } = loadContextRef.current;
    const getCapability = currentWalletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = currentWalletActions?.runWalletTransactionFlow;
    if (!currentDeployment || !currentModel || !currentWalletReady || !currentWalletKey ||
        currentHistoryPages.length === 0 || !getCapability || !runWalletTransactionFlow) {
      setState(LOCKED_STATE);
      return;
    }
    if (interactive && activeRevealRef.current) return;
    const requestId = ++requestIdRef.current;
    if (interactive) activeRevealRef.current = true;
    setState((previous) => Object.freeze({
      ...previous,
      status: 'loading',
      error: ''
    }));
    try {
      const operation = async () => {
        let capability = capabilityRef.current ?? await getCapability(true, BigInt(currentDeployment.chainId));
        capabilityRef.current = capability;
        const read = () => currentSelectedPosition?.privacyOwner?.toLowerCase() === currentWalletKey
          ? readPrivateLiquidityOwnerPrivateData({
              capability,
              deployment: currentDeployment,
              position: currentSelectedPosition,
              atBlock: currentModel.atBlock,
              pages: currentHistoryPages
            })
          : readPrivateLiquidityPrivateHistory({
              capability,
              deployment: currentDeployment,
              pages: currentHistoryPages
            }).then((history) => Object.freeze({ inventory: null, history }));
        try {
          return await read();
        } catch (error) {
          // Background synchronization must never open a wallet prompt. An explicit reveal/retry
          // may refresh the wallet privacy key once, then reread the same canonical history.
          if (!interactive || !isPrivateLiquidityReceiptPrivacyRefreshRequired(error)) throw error;
          capabilityRef.current = null;
          capability = await getCapability(true, BigInt(currentDeployment.chainId), { refreshAes: true });
          capabilityRef.current = capability;
          return read();
        }
      };
      const loaded = interactive
        ? await runWalletTransactionFlow(operation)
        : await operation();
      if (requestId !== requestIdRef.current) return;
      revealedRef.current = true;
      setState(Object.freeze({
        status: 'available',
        inventory: loaded.inventory,
        history: loaded.history.history,
        error: ''
      }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const message = errorMessage(error);
      const unavailable = message.includes('privacy must be activated') ||
        message.includes('not initialized for this connected owner');
      if (!unavailable) capabilityRef.current = null;
      setState(Object.freeze({
        status: unavailable ? 'unavailable' : 'error',
        inventory: null,
        history: EMPTY_HISTORY,
        error: message
      }));
    } finally {
      if (interactive) activeRevealRef.current = false;
    }
  }, []);

  useEffect(() => {
    capabilityRef.current = null;
    revealedRef.current = false;
    requestIdRef.current += 1;
    activeRevealRef.current = false;
    setState(LOCKED_STATE);
  }, [securityScopeKey]);

  useEffect(() => {
    if (!canonicalDataKey) {
      requestIdRef.current += 1;
      setState(LOCKED_STATE);
      return;
    }
    if (!revealedRef.current || !capabilityRef.current) return;
    void load({ interactive: false });
  }, [canonicalDataKey, load]);

  const reveal = useCallback(() => load({ interactive: true }), [load]);

  return Object.freeze({ ...state, reveal });
}
