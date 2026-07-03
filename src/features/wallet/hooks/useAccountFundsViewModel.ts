import { useMemo } from 'react';
import { formatCotiAmount } from '../../../lib/appShared';
import type { TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { buildAccountFundsAssets } from '../accountFundsAssets';

type UseAccountFundsViewModelArgs = {
  burnerAddress: string;
  burnerBalanceWei: bigint | null;
  chainwhisperCustomTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  chainwhisperHasAesReady: boolean;
  estimatedCotiPerMessageWei: bigint;
  ownerAesReady: boolean;
  ownerCustomTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  ownerNativeBalanceWei: bigint | null;
  ownerPrivateRewardBalanceLocked: boolean;
  ownerPrivateRewardTokenBalanceWei: bigint | null;
  ownerRewardTokenBalanceWei: bigint | null;
  ownerWalletAddress: string;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  topUpAmountWei: bigint | null;
  walletAddress: string;
};

export default function useAccountFundsViewModel({
  burnerAddress,
  burnerBalanceWei,
  chainwhisperCustomTokenInfoByAddress,
  chainwhisperHasAesReady,
  estimatedCotiPerMessageWei,
  ownerAesReady,
  ownerCustomTokenInfoByAddress,
  ownerNativeBalanceWei,
  ownerPrivateRewardBalanceLocked,
  ownerPrivateRewardTokenBalanceWei,
  ownerRewardTokenBalanceWei,
  ownerWalletAddress,
  privateRewardTokenBalanceWei,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  topUpAmountWei,
  walletAddress
}: UseAccountFundsViewModelArgs) {
  const accountFundsAssets = useMemo(() => buildAccountFundsAssets({
    burnerAddress,
    burnerBalanceWei,
    chainwhisperCustomTokenInfoByAddress,
    chainwhisperHasAesReady,
    ownerAesReady,
    ownerCustomTokenInfoByAddress,
    ownerNativeBalanceWei,
    ownerPrivateRewardBalanceLocked,
    ownerPrivateRewardTokenBalanceWei,
    ownerRewardTokenBalanceWei,
    ownerWalletAddress,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletAddress
  }), [
    burnerAddress,
    burnerBalanceWei,
    chainwhisperCustomTokenInfoByAddress,
    chainwhisperHasAesReady,
    ownerAesReady,
    ownerCustomTokenInfoByAddress,
    ownerNativeBalanceWei,
    ownerPrivateRewardBalanceLocked,
    ownerPrivateRewardTokenBalanceWei,
    ownerRewardTokenBalanceWei,
    ownerWalletAddress,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletAddress
  ]);

  const estimatedMessagesLeft = useMemo(() => {
    if (burnerBalanceWei === null || estimatedCotiPerMessageWei <= 0n) {
      return null;
    }
    return burnerBalanceWei / estimatedCotiPerMessageWei;
  }, [burnerBalanceWei, estimatedCotiPerMessageWei]);

  const topUpAmountLabel = useMemo(() => {
    if (topUpAmountWei !== null) {
      return `${formatCotiAmount(topUpAmountWei, 3)} COTI`;
    }
    return '--';
  }, [topUpAmountWei]);

  return {
    accountFundsAssets,
    estimatedMessagesLeft,
    topUpAmountLabel
  };
}
