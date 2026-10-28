import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TradingPair } from '../../../app/components/TradingProductSwitch';
import { readSuccessorPrivateErc20BalanceWei } from '../../../lib/appChain';
import { formatTokenAmount, getProviderErrorMessage } from '../../../lib/appShared/core';
import type { SharedWalletSession } from '../../../lib/walletSession';
import type { SuccessorDexRuntimeState } from './useSuccessorDexDeployment';

type BalanceState = Readonly<{
  scopeKey: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  baseBalanceWei: bigint | null;
  quoteBalanceWei: bigint | null;
  message: string;
}>;

const EMPTY: BalanceState = Object.freeze({
  scopeKey: '',
  status: 'idle',
  baseBalanceWei: null,
  quoteBalanceWei: null,
  message: ''
});

export default function useDexV2TokenBalances({
  runtime,
  selectedPair,
  sharedWalletSession
}: {
  runtime: SuccessorDexRuntimeState;
  selectedPair: TradingPair;
  sharedWalletSession?: SharedWalletSession;
}) {
  const walletAddress = sharedWalletSession?.walletAddress.trim() ?? '';
  const pairKey = selectedPair.join('/');
  const scopeKey = runtime.status === 'ready'
    ? `${runtime.manifest.releaseIdentityHash}:${pairKey}:${walletAddress.toLowerCase()}`
    : '';
  const [state, setState] = useState<BalanceState>(EMPTY);
  const visible = state.scopeKey === scopeKey ? state : EMPTY;

  useEffect(() => {
    setState(EMPTY);
  }, [scopeKey]);

  const reveal = useCallback(async () => {
    const actions = sharedWalletSession?.actions;
    if (!actions || runtime.status !== 'ready') return;
    const baseToken = runtime.manifest.tokens.find(({ symbol }) => symbol === selectedPair[0]);
    const quoteToken = runtime.manifest.tokens.find(({ symbol }) => symbol === selectedPair[1]);
    if (!baseToken || !quoteToken) throw new Error(`${pairKey} is not in the successor token manifest.`);
    if (!walletAddress) {
      await actions.connectBrowserWallet(undefined, { preparePrivacy: true });
      return;
    }
    const capturedScope = scopeKey;
    setState(Object.freeze({
      scopeKey: capturedScope,
      status: 'loading',
      baseBalanceWei: null,
      quoteBalanceWei: null,
      message: 'Unlocking privacy and reading both test-token balances…'
    }));
    try {
      const [baseBalanceWei, quoteBalanceWei] = await actions.runWalletTransactionFlow(async () => {
        const signer = await actions.getSigner(true);
        return Promise.all([
          readSuccessorPrivateErc20BalanceWei(
            baseToken.address,
            walletAddress,
            signer
          ),
          readSuccessorPrivateErc20BalanceWei(
            quoteToken.address,
            walletAddress,
            signer
          )
        ]);
      });
      if (baseBalanceWei === null || quoteBalanceWei === null) {
        throw new Error('The private token balances could not be decrypted with this wallet privacy key.');
      }
      setState(Object.freeze({
        scopeKey: capturedScope,
        status: 'ready',
        baseBalanceWei,
        quoteBalanceWei,
        message: 'Private test-token balances revealed for this session.'
      }));
    } catch (error) {
      setState(Object.freeze({
        scopeKey: capturedScope,
        status: 'error',
        baseBalanceWei: null,
        quoteBalanceWei: null,
        message: getProviderErrorMessage(error, 'The private test-token balances could not be revealed.')
      }));
    }
  }, [pairKey, runtime, scopeKey, selectedPair, sharedWalletSession, walletAddress]);

  const labels = useMemo(() => {
    if (runtime.status !== 'ready' || visible.status !== 'ready') {
      return Object.freeze({ base: 'Private', quote: 'Private' });
    }
    const baseToken = runtime.manifest.tokens.find(({ symbol }) => symbol === selectedPair[0]);
    const quoteToken = runtime.manifest.tokens.find(({ symbol }) => symbol === selectedPair[1]);
    return Object.freeze({
      base: formatTokenAmount(visible.baseBalanceWei ?? 0n, baseToken?.decimals ?? 6, 6),
      quote: formatTokenAmount(visible.quoteBalanceWei ?? 0n, quoteToken?.decimals ?? 6, 6)
    });
  }, [runtime, selectedPair, visible]);

  return Object.freeze({
    ...visible,
    baseLabel: labels.base,
    quoteLabel: labels.quote,
    buttonLabel: !walletAddress
      ? 'Connect wallet to reveal'
      : visible.status === 'loading'
        ? 'Revealing balances…'
        : visible.status === 'ready'
          ? 'Refresh balances'
          : 'Reveal test-token balances',
    reveal
  });
}
