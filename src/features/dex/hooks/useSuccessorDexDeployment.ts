import { useCallback, useEffect, useState } from 'react';
import { readSuccessorDexDeployment, type SuccessorDexChainSnapshot } from '../../../lib/appChain';
import {
  loadSuccessorDexManifest,
  SUCCESSOR_DEX_DEPLOYMENT_CONFIG,
  type SuccessorDexManifest
} from '../../../lib/successorDexDeployment';

export type SuccessorDexRuntimeState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'ready'; manifest: SuccessorDexManifest; snapshot: SuccessorDexChainSnapshot }>;

export default function useSuccessorDexDeployment(walletAddress = ''): Readonly<{
  refresh: () => void;
  state: SuccessorDexRuntimeState;
}> {
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [state, setState] = useState<SuccessorDexRuntimeState>(Object.freeze({ status: 'loading' }));
  const refresh = useCallback(() => setRefreshEpoch((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState(Object.freeze({ status: 'loading' }));
    void loadSuccessorDexManifest({ signal: controller.signal }).then(async (manifest) => ({
      manifest,
      snapshot: await readSuccessorDexDeployment({
        finalityLagBlocks: SUCCESSOR_DEX_DEPLOYMENT_CONFIG.status === 'active'
          ? SUCCESSOR_DEX_DEPLOYMENT_CONFIG.finalityLagBlocks
          : 5,
        manifest,
        walletAddress
      })
    })).then(({ manifest, snapshot }) => {
      if (!controller.signal.aborted) setState(Object.freeze({ status: 'ready', manifest, snapshot }));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState(Object.freeze({
        status: 'error',
        message: error instanceof Error ? error.message : 'Successor DEX verification failed.'
      }));
    });
    return () => controller.abort();
  }, [refreshEpoch, walletAddress]);

  return Object.freeze({ refresh, state });
}
