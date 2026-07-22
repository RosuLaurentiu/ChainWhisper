import { useEffect, useMemo } from 'react';
import type { SwapDirection } from '../../lib/appShared';
import type {
  PrivacyDirection,
  PrivacyPortalConversionStage,
  PrivacyPortalPairMetrics,
  PrivacyPortalQuote,
  PrivacyTokenPair
} from '../../lib/privacyPortal';
import {
  derivePrivacyPortalView,
  deriveTokenSwapView,
  resolveTokenSwapDirectionFallback
} from './tokenSwapView';

type UseTokenSwapViewModelArgs = {
  hasAesReady: boolean;
  legacyPrivateRewardTokenBalanceWei: bigint | null;
  legacyPrivateRewardTokenDecimals: number;
  legacyPrivateRewardTokenSymbol: string;
  loadingRewardBalances: boolean;
  onCotiNetwork: boolean;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  setSwapDirection: (direction: SwapDirection) => void;
  swapAmountInput: string;
  swapDirection: SwapDirection;
  swappingTokens: boolean;
  walletAddress: string;
};

export default function useTokenSwapViewModel({
  hasAesReady,
  legacyPrivateRewardTokenBalanceWei,
  legacyPrivateRewardTokenDecimals,
  legacyPrivateRewardTokenSymbol,
  loadingRewardBalances,
  onCotiNetwork,
  privateRewardTokenBalanceWei,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  setSwapDirection,
  swapAmountInput,
  swapDirection,
  swappingTokens,
  walletAddress
}: UseTokenSwapViewModelArgs) {
  const view = useMemo(
    () =>
      deriveTokenSwapView({
        hasAesReady,
        legacyPrivateRewardTokenBalanceWei,
        legacyPrivateRewardTokenDecimals,
        legacyPrivateRewardTokenSymbol,
        loadingRewardBalances,
        onCotiNetwork,
        privateRewardTokenBalanceWei,
        privateRewardTokenDecimals,
        privateRewardTokenSymbol,
        rewardTokenBalanceWei,
        rewardTokenDecimals,
        rewardTokenSymbol,
        swapAmountInput,
        swapDirection,
        swappingTokens,
        walletAddress
      }),
    [
      hasAesReady,
      legacyPrivateRewardTokenBalanceWei,
      legacyPrivateRewardTokenDecimals,
      legacyPrivateRewardTokenSymbol,
      loadingRewardBalances,
      onCotiNetwork,
      privateRewardTokenBalanceWei,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenBalanceWei,
      rewardTokenDecimals,
      rewardTokenSymbol,
      swapAmountInput,
      swapDirection,
      swappingTokens,
      walletAddress
    ]
  );

  useEffect(() => {
    const fallbackSwapDirection = resolveTokenSwapDirectionFallback({
      canLegacyUnshieldTokens: view.canLegacyUnshieldTokens,
      canShieldTokens: view.canShieldTokens,
      canUnshieldTokens: view.canUnshieldTokens,
      currentSwapDirectionEnabled: view.currentSwapDirectionEnabled,
      swapDirection
    });
    if (fallbackSwapDirection !== swapDirection) {
      setSwapDirection(fallbackSwapDirection);
    }
  }, [
    setSwapDirection,
    swapDirection,
    view.canLegacyUnshieldTokens,
    view.canShieldTokens,
    view.canUnshieldTokens,
    view.currentSwapDirectionEnabled
  ]);

  return view;
}

type UsePrivacyPortalViewModelArgs = {
  actionStage: PrivacyPortalConversionStage | null;
  amountInput: string;
  direction: PrivacyDirection;
  hasAesReady: boolean;
  loading: boolean;
  metrics: PrivacyPortalPairMetrics | null;
  onCotiNetwork: boolean;
  pair: PrivacyTokenPair;
  quote: PrivacyPortalQuote | null;
  walletAddress: string;
};

export const usePrivacyPortalViewModel = ({
  actionStage,
  amountInput,
  direction,
  hasAesReady,
  loading,
  metrics,
  onCotiNetwork,
  pair,
  quote,
  walletAddress
}: UsePrivacyPortalViewModelArgs) =>
  useMemo(
    () =>
      derivePrivacyPortalView({
        actionStage,
        amountInput,
        direction,
        hasAesReady,
        loading,
        metrics,
        onCotiNetwork,
        pair,
        quote,
        walletAddress
      }),
    [
      actionStage,
      amountInput,
      direction,
      hasAesReady,
      loading,
      metrics,
      onCotiNetwork,
      pair,
      quote,
      walletAddress
    ]
  );
