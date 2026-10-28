import { useCallback, useRef, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import { createSuccessorStrategy, type SuccessorStrategyRequest } from '../../../lib/successorDexStrategies';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { SuccessorDexRuntimeState } from './useSuccessorDexDeployment';

export default function useSuccessorStrategyAction({ runtime, sharedWalletSession, refresh }: {
  runtime: SuccessorDexRuntimeState;
  sharedWalletSession?: SharedWalletSession;
  refresh: () => void;
}) {
  const active = useRef(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const create = useCallback(async (request: SuccessorStrategyRequest) => {
    const actions = sharedWalletSession?.actions;
    if (!actions || runtime.status !== 'ready' || active.current) return null;
    if (!sharedWalletSession?.walletAddress.trim()) {
      await actions.connectBrowserWallet(undefined, { preparePrivacy: true });
      return null;
    }
    active.current = true;
    setBusy(true);
    setMessage('Preparing private strategy inputs and allowances…');
    try {
      const result = await actions.runWalletTransactionFlow(async () => {
        const signer = await actions.getSigner(true);
        return createSuccessorStrategy({ signer, manifest: runtime.manifest, request });
      });
      setMessage(`Position NFT #${result.positionId} was created. Transaction ${result.transactionHash.slice(0, 10)}…`);
      refresh();
      return result;
    } catch (error) {
      setMessage(getProviderErrorMessage(error, 'Strategy creation failed.'));
      return null;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }, [refresh, runtime, sharedWalletSession]);
  return Object.freeze({ busy, create, message });
}
