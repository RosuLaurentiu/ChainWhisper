import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readPrivateLiquidityHiddenIntentOwnerPage,
  type PrivateLiquidityHiddenIntentOwnerPage
} from '../../../lib/privateLiquidityActions';
import type { AttestedPrivateLiquidityDeployment } from '../../../lib/privateLiquidityChain';
import type { PrivateLiquidityWorkspaceModel } from '../../../lib/privateLiquidityWorkspaceModel';
import type { WalletSessionActions } from '../../../lib/walletSession';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

type State = Readonly<{
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
  walletActions,
  refreshKey
}: {
  active: boolean;
  deployment: AttestedPrivateLiquidityDeployment | null;
  model: PrivateLiquidityWorkspaceModel | null;
  walletAddress?: string | null;
  walletReady: boolean;
  walletActions?: Pick<WalletSessionActions, 'getPrivateLiquidityCapability' | 'runWalletTransactionFlow'>;
  refreshKey: string;
}) {
  const capabilityRef = useRef<Awaited<ReturnType<NonNullable<WalletSessionActions['getPrivateLiquidityCapability']>>> | null>(null);
  const requestIdRef = useRef(0);
  const revealedRef = useRef(false);
  const [state, setState] = useState<State>(LOCKED);
  const walletKey = walletAddress?.trim().toLowerCase() ?? '';
  const scope = deployment && walletKey
    ? `${deployment.chainId}:${deployment.contractAddress}:${walletKey}`
    : '';
  const canonicalKey = model
    ? `${model.atBlock.number}:${model.atBlock.hash}:${refreshKey}`
    : '';
  const load = useCallback(async (interactive: boolean) => {
    const getCapability = walletActions?.getPrivateLiquidityCapability;
    const runWalletTransactionFlow = walletActions?.runWalletTransactionFlow;
    if (!active || !deployment || !model || !walletReady || !walletKey ||
        !getCapability || !runWalletTransactionFlow) {
      setState(LOCKED);
      return;
    }
    const requestId = ++requestIdRef.current;
    setState((previous) => Object.freeze({ ...previous, status: 'loading', error: '' }));
    try {
      const operation = async () => {
        const capability = capabilityRef.current ?? await getCapability(true, BigInt(deployment.chainId));
        capabilityRef.current = capability;
        return readPrivateLiquidityHiddenIntentOwnerPage({
          capability,
          deployment,
          atBlock: model.atBlock
        });
      };
      const page = interactive ? await runWalletTransactionFlow(operation) : await operation();
      if (requestId !== requestIdRef.current) return;
      revealedRef.current = true;
      setState(Object.freeze({ status: 'available', page, error: '' }));
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      capabilityRef.current = null;
      setState(Object.freeze({
        status: 'error',
        page: null,
        error: getProviderErrorMessage(error, 'Hidden-intent owner data could not be decrypted.')
      }));
    }
  }, [active, deployment, model, walletActions, walletKey, walletReady]);

  useEffect(() => {
    capabilityRef.current = null;
    requestIdRef.current += 1;
    revealedRef.current = false;
    setState(LOCKED);
  }, [scope]);

  useEffect(() => {
    if (!active || !canonicalKey || !revealedRef.current || !capabilityRef.current) return;
    void load(false);
  }, [active, canonicalKey, load]);

  const reveal = useCallback(() => load(true), [load]);
  return Object.freeze({ ...state, reveal });
}
