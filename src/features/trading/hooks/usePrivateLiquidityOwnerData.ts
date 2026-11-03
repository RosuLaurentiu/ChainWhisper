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
import {
  assertBrowserWalletPrivacyReadScopeCurrent,
  type BrowserWalletPrivacyReadScope
} from '../../../lib/browserWalletRuntimeScope';

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
  privacyReadScope?: BrowserWalletPrivacyReadScope;
  canonicalDataKey?: string;
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
  privacyReadScope,
  walletActions
}: {
  deployment: AttestedPrivateLiquidityDeployment | null;
  model: PrivateLiquidityWorkspaceModel | null;
  historyPages: readonly CanonicalPrivateLiquidityLogRange[];
  walletAddress?: string | null;
  walletReady: boolean;
  privacyReadScope: BrowserWalletPrivacyReadScope;
  walletActions?: Pick<WalletSessionActions, 'getPrivateLiquidityCapability' | 'runWalletTransactionFlow'>;
}) {
  const capabilityRef = useRef<Awaited<ReturnType<NonNullable<WalletSessionActions['getPrivateLiquidityCapability']>>> | null>(null);
  const revealedRef = useRef(false);
  const requestIdRef = useRef(0);
  const activeRevealRef = useRef(false);
  const privacyScopeRef = useRef(privacyReadScope);
  if (privacyScopeRef.current !== privacyReadScope) {
    capabilityRef.current = null;
    revealedRef.current = false;
  }
  privacyScopeRef.current = privacyReadScope;
  const pendingUnlockRef = useRef<{
    scope: BrowserWalletPrivacyReadScope;
    resume?: (scope: BrowserWalletPrivacyReadScope | null) => void;
  } | null>(null);
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
    canonicalDataKey,
    deployment,
    historyPages,
    model,
    selectedPosition,
    walletActions,
    walletKey,
    walletReady
  });
  loadContextRef.current = {
    canonicalDataKey,
    deployment,
    historyPages,
    model,
    selectedPosition,
    walletActions,
    walletKey,
    walletReady
  };

  const load = useCallback(async ({ interactive }: { interactive: boolean }) => {
    const startingScope = privacyScopeRef.current;
    const {
      canonicalDataKey: capturedCanonicalDataKey,
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
        currentHistoryPages.length === 0 || !getCapability || !runWalletTransactionFlow ||
        !startingScope.runtimeScopeKey || (!interactive && (!startingScope.ready || !capabilityRef.current))) {
      setState(LOCKED_STATE);
      return;
    }
    if (interactive && activeRevealRef.current) return;
    const requestId = ++requestIdRef.current;
    if (interactive) activeRevealRef.current = true;
    if (!startingScope.ready) pendingUnlockRef.current = { scope: startingScope };
    let readScope = startingScope;
    setState((previous) => Object.freeze({
      ...(previous.privacyReadScope === startingScope && previous.canonicalDataKey === capturedCanonicalDataKey
        ? previous : LOCKED_STATE),
      privacyReadScope: startingScope,
      canonicalDataKey: capturedCanonicalDataKey,
      status: 'loading',
      error: ''
    }));
    try {
      const operation = async () => {
        let capability = capabilityRef.current ?? await getCapability(true, BigInt(currentDeployment.chainId));
        if (loadContextRef.current.canonicalDataKey !== capturedCanonicalDataKey) return null;
        if (!startingScope.ready) {
          const currentScope = privacyScopeRef.current;
          const unlockedScope = currentScope === startingScope
            ? await new Promise<BrowserWalletPrivacyReadScope | null>((resume, reject) => {
                const timer = setTimeout(() => reject(new Error(
                  'Privacy unlock did not become ready. Unlock privacy and reveal again.'
                )), 10_000);
                const finish = (scope: BrowserWalletPrivacyReadScope | null) => {
                  clearTimeout(timer);
                  resume(scope);
                };
                if (pendingUnlockRef.current?.scope === startingScope) pendingUnlockRef.current.resume = finish;
                else finish(null);
              })
            : currentScope;
          if (!unlockedScope?.ready || unlockedScope.runtimeScopeKey !== startingScope.runtimeScopeKey ||
              unlockedScope.revision !== startingScope.revision + 1) return null;
          readScope = unlockedScope;
        }
        if (requestId !== requestIdRef.current) return null;
        assertBrowserWalletPrivacyReadScopeCurrent(readScope, privacyScopeRef.current);
        pendingUnlockRef.current = null;
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
          if (loadContextRef.current.canonicalDataKey !== capturedCanonicalDataKey) return null;
          assertBrowserWalletPrivacyReadScopeCurrent(readScope, privacyScopeRef.current);
          capabilityRef.current = null;
          capability = await getCapability(true, BigInt(currentDeployment.chainId), { refreshAes: true });
          if (loadContextRef.current.canonicalDataKey !== capturedCanonicalDataKey) return null;
          assertBrowserWalletPrivacyReadScopeCurrent(readScope, privacyScopeRef.current);
          capabilityRef.current = capability;
          return read();
        }
      };
      const loaded = interactive
        ? await runWalletTransactionFlow(operation)
        : await operation();
      if (!loaded || requestId !== requestIdRef.current ||
          loadContextRef.current.canonicalDataKey !== capturedCanonicalDataKey) return;
      assertBrowserWalletPrivacyReadScopeCurrent(readScope, privacyScopeRef.current);
      revealedRef.current = true;
      setState(Object.freeze({
        status: 'available',
        privacyReadScope: readScope,
        canonicalDataKey: capturedCanonicalDataKey,
        inventory: loaded.inventory,
        history: loaded.history.history,
        error: ''
      }));
    } catch (error) {
      if (requestId !== requestIdRef.current ||
          loadContextRef.current.canonicalDataKey !== capturedCanonicalDataKey) return;
      pendingUnlockRef.current = null;
      const message = errorMessage(error);
      const unavailable = message.includes('privacy must be activated') ||
        message.includes('not initialized for this connected owner');
      if (!unavailable) capabilityRef.current = null;
      setState(Object.freeze({
        status: unavailable ? 'unavailable' : 'error',
        privacyReadScope: readScope,
        canonicalDataKey: capturedCanonicalDataKey,
        inventory: null,
        history: EMPTY_HISTORY,
        error: message
      }));
    } finally {
      if (interactive && requestId === requestIdRef.current) activeRevealRef.current = false;
    }
  }, []);

  useEffect(() => {
    const pending = pendingUnlockRef.current;
    const resumedUnlock = securityScopeKey && pending && !pending.scope.ready && privacyReadScope.ready &&
      pending.scope.runtimeScopeKey === privacyReadScope.runtimeScopeKey &&
      privacyReadScope.revision === pending.scope.revision + 1;
    capabilityRef.current = null;
    revealedRef.current = false;
    setState(LOCKED_STATE);
    if (resumedUnlock) {
      pending.resume?.(privacyReadScope);
      return;
    }
    pending?.resume?.(null);
    pendingUnlockRef.current = null;
    requestIdRef.current += 1;
    activeRevealRef.current = false;
  }, [securityScopeKey, privacyReadScope]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    pendingUnlockRef.current?.resume?.(null);
  }, []);

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

  const visibleState = securityScopeKey && state.privacyReadScope === privacyReadScope &&
    state.canonicalDataKey === canonicalDataKey &&
    (privacyReadScope.ready || state.status !== 'available') ? state : LOCKED_STATE;
  return Object.freeze({ ...visibleState, reveal });
}
