import { useMemo } from 'react';
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
  deriveTokenSwapView
} from './tokenSwapView';

type UseTokenSwapViewModelArgs = {
  hasAesReady: boolean;
  loadingRewardBalances: boolean;
  onCotiNetwork: boolean;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  swapAmountInput: string;
  swapDirection: SwapDirection;
  swappingTokens: boolean;
  walletAddress: string;
};

export default function useTokenSwapViewModel({
  hasAesReady,
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
}: UseTokenSwapViewModelArgs) {
  const view = useMemo(
    () =>
      deriveTokenSwapView({
        hasAesReady,
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
