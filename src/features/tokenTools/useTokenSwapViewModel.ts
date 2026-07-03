import { useEffect, useMemo } from 'react';
import type { SwapDirection } from '../../lib/appShared';
import { deriveTokenSwapView } from './tokenSwapView';

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
    if (view.currentSwapDirectionEnabled) {
      return;
    }
    const fallbackSwapDirection = view.canShieldTokens
      ? 'shield'
      : view.canUnshieldTokens
        ? 'unshield'
        : view.canLegacyUnshieldTokens
          ? 'legacy-unshield'
          : swapDirection;
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
