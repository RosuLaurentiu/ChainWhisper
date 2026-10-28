import { useCallback, useEffect, useRef, useState } from 'react';
import {
  discoverDexV2OwnedPositions,
  type DexV2PositionDiscovery
} from '../../../lib/dexV2PositionDiscovery';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { DexV2RuntimeState } from './useDexV2Runtime';

export type DexV2PositionsState =
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'disconnected' }>
  | Readonly<{ status: 'wrong-network' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'ready'; discovery: DexV2PositionDiscovery }>;

const initialState = (
  runtime: DexV2RuntimeState,
  walletSession?: SharedWalletSession
): DexV2PositionsState => {
  if (runtime.status !== 'ready') return Object.freeze({ status: 'unavailable' });
  if (!walletSession?.walletAddress.trim() || !walletSession.browserProvider) {
    return Object.freeze({ status: 'disconnected' });
  }
  if (walletSession.chainId !== Number(runtime.deployment.manifest.chainId)) {
    return Object.freeze({ status: 'wrong-network' });
  }
  return Object.freeze({ status: 'loading' });
};

export default function useDexV2Positions({
  runtime,
  sharedWalletSession
}: {
  runtime: DexV2RuntimeState;
  sharedWalletSession?: SharedWalletSession;
}): Readonly<{
  state: DexV2PositionsState;
  refresh: () => void;
}> {
  const sessionRef = useRef(sharedWalletSession);
  sessionRef.current = sharedWalletSession;
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [state, setState] = useState<DexV2PositionsState>(() => initialState(runtime, sharedWalletSession));
  const refresh = useCallback(() => setRefreshEpoch((value) => value + 1), []);

  useEffect(() => {
    const nextInitial = initialState(runtime, sharedWalletSession);
    if (nextInitial.status !== 'loading' || runtime.status !== 'ready') {
      setState(nextInitial);
      return undefined;
    }
    const provider = sharedWalletSession?.browserProvider;
    const owner = sharedWalletSession?.walletAddress.trim() ?? '';
    const chainId = sharedWalletSession?.chainId ?? null;
    if (!provider || !owner) {
      setState(Object.freeze({ status: 'disconnected' }));
      return undefined;
    }
    let current = true;
    setState(Object.freeze({ status: 'loading' }));
    void discoverDexV2OwnedPositions({
      deployment: runtime.deployment,
      owner,
      provider,
      assertCurrent: () => {
        if (!current) throw new Error('DEX V2 position discovery was cancelled.');
        const latest = sessionRef.current;
        if (
          latest?.browserProvider !== provider ||
          latest.walletAddress.trim().toLowerCase() !== owner.toLowerCase() ||
          latest.chainId !== chainId
        ) {
          throw new Error('DEX V2 wallet session changed during position discovery.');
        }
      }
    }).then((discovery) => {
      if (current) setState(Object.freeze({ status: 'ready', discovery }));
    }).catch(() => {
      if (current) setState(Object.freeze({
        status: 'error',
        message: 'Position ownership could not be reconciled at the finalized DEX block.'
      }));
    });
    return () => { current = false; };
  }, [
    refreshEpoch,
    runtime,
    sharedWalletSession?.browserProvider,
    sharedWalletSession?.chainId,
    sharedWalletSession?.walletAddress
  ]);

  return Object.freeze({ state, refresh });
}
