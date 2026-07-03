import { useCallback } from 'react';
import {
  formatCotiAmount,
  formatTokenAmount,
  isWalletAddress,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  type TradeAssetPayload
} from '../../../lib/appShared';
import {
  buildTradeCustomTokenInfoKey,
  type PrivateTokenBalanceState,
  type TradeCustomTokenInfo
} from '../../../lib/appHelpers';

type UseTerminalAssetBalanceLabelArgs = {
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  nativeBalanceWei: bigint | null;
  pWispFooterBalanceState: PrivateTokenBalanceState;
  rewardTokenBalanceWei: bigint | null;
  walletAddress: string;
};

export default function useTerminalAssetBalanceLabel({
  customTradeTokenInfoByAddress,
  nativeBalanceWei,
  pWispFooterBalanceState,
  rewardTokenBalanceWei,
  walletAddress
}: UseTerminalAssetBalanceLabelArgs) {
  return useCallback(
    (asset: TradeAssetPayload, maxDecimals = 2): string => {
      const formatBalanceLabel = (balanceWei: bigint): string =>
        `Bal ${asset.kind === 'native' ? formatCotiAmount(balanceWei, maxDecimals) : formatTokenAmount(balanceWei, asset.decimals, maxDecimals)}`;

      if (!walletAddress) {
        return 'Connect';
      }

      if (asset.kind === 'native') {
        return nativeBalanceWei !== null ? formatBalanceLabel(nativeBalanceWei) : 'Bal --';
      }

      const tokenAddress = asset.tokenAddress?.trim() ?? '';
      if (!isWalletAddress(tokenAddress)) {
        return 'Bal --';
      }

      const tokenKey = tokenAddress.toLowerCase();
      if (asset.kind === 'erc20') {
        if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
          return rewardTokenBalanceWei !== null ? formatBalanceLabel(rewardTokenBalanceWei) : 'Bal --';
        }
        const publicInfo = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('erc20', tokenAddress)];
        return publicInfo?.balanceWei !== null && publicInfo?.balanceWei !== undefined
          ? formatBalanceLabel(publicInfo.balanceWei)
          : 'Bal --';
      }

      const privateInfo = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('private-erc20', tokenAddress)];
      const privateState: PrivateTokenBalanceState =
        tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
          ? pWispFooterBalanceState
          : privateInfo?.privateBalanceState ?? { status: 'locked' };
      if (privateState.status === 'ready') {
        return formatBalanceLabel(privateState.balanceWei);
      }
      if (privateState.status === 'setup-needed') {
        return 'Set up';
      }
      if (privateState.status === 'decrypt-failed' || privateState.status === 'snap-stale') {
        return 'Refresh';
      }
      if (privateState.status === 'unsupported') {
        return 'Unsupported';
      }
      if (privateInfo?.loading || privateState.status === 'setup-pending') {
        return 'Loading';
      }
      return 'Unlock';
    },
    [
      customTradeTokenInfoByAddress,
      nativeBalanceWei,
      pWispFooterBalanceState,
      rewardTokenBalanceWei,
      walletAddress
    ]
  );
}
