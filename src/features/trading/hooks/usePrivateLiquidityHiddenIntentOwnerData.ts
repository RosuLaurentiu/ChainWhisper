import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readPrivateLiquidityHiddenIntentOwnerPage,
  type PrivateLiquidityHiddenIntentOwnerPage
} from '../../../lib/privateLiquidityActions';
import type { AttestedPrivateLiquidityDeployment } from '../../../lib/privateLiquidityChain';
import type { PrivateLiquidityWorkspaceModel } from '../../../lib/privateLiquidityWorkspaceModel';
import type { WalletSessionActions } from '../../../lib/walletSession';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  assertBrowserWalletPrivacyReadScopeCurrent,
  type BrowserWalletPrivacyReadScope
} from '../../../lib/browserWalletRuntimeScope';

type State = Readonly<{
  privacyReadScope?: BrowserWalletPrivacyReadScope;
  status: 'locked' | 'loading' | 'available' | 'error';
  page: PrivateLiquidityHiddenIntentOwnerPage | null;
  error: string;
}>;

const LOCKED: State = Object.freeze({ status: 'locked', page: null, error: '' });

export default function usePrivateLiquidityHiddenIntentOwnerData({
  active,
  deployment,
  model,
  walletAddress,
  walletReady,
  privacyReadScope,
  walletActions,
  refreshKey
}: {
  active: boolean;
  deployment: AttestedPrivateLiquidityDeployment | null;
  model: PrivateLiquidityWorkspaceModel | null;
  walletAddress?: string | null;
  walletReady: boolean;
  privacyReadScope: BrowserWalletPrivacyReadScope;
  walletActions?: Pick<WalletSessionActions, 'getPrivateLiquidityCapability' | 'runWalletTransactionFlow'>;
  refreshKey: string;
}) {
  const capabilityRef = useRef<Awaited<ReturnType<NonNullable<WalletSessionActions['getPrivateLiquidityCapability']>>> | null>(null);
  const requestIdRef = useRef(0);
  const revealedRef = useRef(false);
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
  const [state, setState] = useState<State>(LOCKED);
  const walletKey = walletAddress?.trim().toLowerCase() ?? '';
  const scope = deployment && walletKey
    ? `${deployment.chainId}:${deployment.contractAddress}:${walletKey}`
    : '';
  const canonicalKey = model
    ? `${model.atBlock.number}:${model.atBlock.hash}:${refreshKey}`
    : '';
  const load = useCallback(async (interactive: boolean) => {
    const startingScope = privacyScopeRef.current;
    if (startingScope !== privacyReadScope) return;
    const getCapability = walletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = walletActions?.runWalletTransactionFlow;
    if (!active || !deployment || !model || !walletReady || !walletKey ||
        !getCapability || !runWalletTransactionFlow || !startingScope.runtimeScopeKey ||
        (!interactive && (!startingScope.ready || !capabilityRef.current))) {
      setState(LOCKED);
      return;
    }
    const requestId = ++requestIdRef.current;
    if (!startingScope.ready) pendingUnlockRef.current = { scope: startingScope };
    let readScope = startingScope;
    setState((previous) => Object.freeze({
      ...(previous.privacyReadScope === startingScope ? previous : LOCKED),
      privacyReadScope: startingScope, status: 'loading', error: ''
    }));
    try {
      const operation = async () => {
        const capability = capabilityRef.current ?? await getCapability(true, BigInt(deployment.chainId));
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
        return readPrivateLiquidityHiddenIntentOwnerPage({
          capability,
          deployment,
          atBlock: model.atBlock
        });
      };
      const page = interactive ? await runWalletTransactionFlow(operation) : await operation();
      if (!page || requestId !== requestIdRef.current) return;
      assertBrowserWalletPrivacyReadScopeCurrent(readScope, privacyScopeRef.current);
      revealedRef.current = true;
      setState(Object.freeze({ status: 'available', privacyReadScope: readScope, page, error: '' }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      pendingUnlockRef.current = null;
      capabilityRef.current = null;
      setState(Object.freeze({
        status: 'error',
        privacyReadScope: readScope,
        page: null,
        error: getProviderErrorMessage(error, 'Hidden-intent owner data could not be decrypted.')
      }));
    }
  }, [active, deployment, model, walletActions, walletKey, walletReady, privacyReadScope]);

  useEffect(() => {
    const pending = pendingUnlockRef.current;
    const resumedUnlock = active && walletReady && scope && pending && !pending.scope.ready && privacyReadScope.ready &&
      pending.scope.runtimeScopeKey === privacyReadScope.runtimeScopeKey &&
      privacyReadScope.revision === pending.scope.revision + 1;
    capabilityRef.current = null;
    revealedRef.current = false;
    setState(LOCKED);
    if (resumedUnlock) {
      pending.resume?.(privacyReadScope);
      return;
    }
    pending?.resume?.(null);
    pendingUnlockRef.current = null;
    requestIdRef.current += 1;
  }, [scope, walletReady, active, privacyReadScope]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    pendingUnlockRef.current?.resume?.(null);
  }, []);

  useEffect(() => {
    if (!active || !canonicalKey || !revealedRef.current || !capabilityRef.current) return;
    void load(false);
  }, [active, canonicalKey, load]);

  const reveal = useCallback(() => load(true), [load]);
  const visibleState = active && walletReady && scope && state.privacyReadScope === privacyReadScope &&
    (privacyReadScope.ready || state.status !== 'available') ? state : LOCKED;
  return Object.freeze({ ...visibleState, reveal });
}
