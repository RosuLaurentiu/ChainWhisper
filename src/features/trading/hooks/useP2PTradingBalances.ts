import { useCallback, useMemo } from 'react';
import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_SYMBOL,
  isWalletAddress,
  type TradeAssetPayload
} from '../../../lib/appShared';
import {
  buildTradeCustomTokenInfoKey,
  type PrivateTokenBalanceState,
  type ResolvedTradeToken,
  type TradeCustomTokenInfo
} from '../../../lib/appHelpers';
import { buildTradeComposerAssetBalanceKey } from '../../../lib/tradeComposer';
import {
  buildCombinedWalletAssetBalance,
  type CombinedWalletAssetBalance
} from '../../../lib/walletFunds';
import { buildVisibleTradingBalanceItems, type TradingBalanceDisplayItem } from '../../../lib/tradingBalances';

type ComposerCombinedBalance = Pick<
  CombinedWalletAssetBalance,
  'combinedBalanceWei' | 'privacyRequired' | 'availableLabel' | 'breakdownLabel' | 'splitLabel'
>;

type UseP2PTradingBalancesArgs = {
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  isPrivateTokenSnapStale: (address: string) => boolean;
  nativeBalanceWei: bigint | null;
  privateRewardTokenBalanceState: PrivateTokenBalanceState;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  walletKey: string;
};

type FundingBalance = {
  balanceWei: bigint | null;
  privacyRequired: boolean;
};

export default function useP2PTradingBalances({
  customTradeTokenInfoByAddress,
  isPrivateTokenSnapStale,
  nativeBalanceWei,
  privateRewardTokenBalanceState,
  privateRewardTokenBalanceWei,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  walletKey
}: UseP2PTradingBalancesArgs) {
  const pWispFooterBalanceState = useMemo(
    () =>
      isPrivateTokenSnapStale(PRIVATE_REWARD_TOKEN_ADDRESS)
        ? ({ status: 'snap-stale' } as const)
        : privateRewardTokenBalanceState,
    [isPrivateTokenSnapStale, privateRewardTokenBalanceState]
  );

  const visibleTradingBalances = useMemo<TradingBalanceDisplayItem[]>(
    () =>
      buildVisibleTradingBalanceItems({
        accountLabel: 'Connected wallet',
        accountRole: 'owner',
        customTradeTokenInfoByAddress,
        nativeBalanceWei,
        privateRewardTokenBalanceState: pWispFooterBalanceState,
        privateRewardTokenDecimals,
        privateRewardTokenSymbol,
        rewardTokenBalanceWei,
        rewardTokenDecimals,
        rewardTokenSymbol,
        walletKey
      }),
    [
      customTradeTokenInfoByAddress,
      nativeBalanceWei,
      pWispFooterBalanceState,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenBalanceWei,
      rewardTokenDecimals,
      rewardTokenSymbol,
      walletKey
    ]
  );

  const combinedBalanceByAssetKey = useMemo<Record<string, ComposerCombinedBalance>>(() => {
    const balances: Record<string, ComposerCombinedBalance> = {};
    const addBalance = (
      asset: ResolvedTradeToken,
      balanceWei: bigint | null,
      privacyRequired = false
    ) => {
      const key = buildTradeComposerAssetBalanceKey(asset);
      if (!key) return;
      const combined = buildCombinedWalletAssetBalance({
        asset,
        balanceWei,
        privacyRequired
      });
      balances[key] = {
        combinedBalanceWei: combined.combinedBalanceWei,
        privacyRequired: combined.privacyRequired,
        availableLabel: combined.availableLabel,
        breakdownLabel: combined.breakdownLabel,
        splitLabel: combined.splitLabel
      };
    };

    addBalance({ kind: 'native', symbol: TIP_NATIVE_TOKEN_SYMBOL, decimals: 18 }, nativeBalanceWei);
    addBalance(
      { kind: 'erc20', tokenAddress: REWARD_TOKEN_ADDRESS, symbol: rewardTokenSymbol, decimals: rewardTokenDecimals },
      rewardTokenBalanceWei
    );
    addBalance(
      {
        kind: 'private-erc20',
        tokenAddress: PRIVATE_REWARD_TOKEN_ADDRESS,
        symbol: privateRewardTokenSymbol,
        decimals: privateRewardTokenDecimals
      },
      privateRewardTokenBalanceWei,
      pWispFooterBalanceState.status !== 'ready'
    );

    for (const info of Object.values(customTradeTokenInfoByAddress)) {
      if (!isWalletAddress(info.address)) continue;
      if (info.kind === 'private-erc20') {
        addBalance(
          { kind: 'private-erc20', tokenAddress: info.address, symbol: info.symbol, decimals: info.decimals },
          info.privateBalanceState?.status === 'ready' ? info.privateBalanceState.balanceWei : info.balanceWei,
          info.privateBalanceState?.status !== 'ready'
        );
      } else {
        addBalance(
          { kind: 'erc20', tokenAddress: info.address, symbol: info.symbol, decimals: info.decimals },
          info.balanceWei
        );
      }
    }
    return balances;
  }, [
    customTradeTokenInfoByAddress,
    nativeBalanceWei,
    pWispFooterBalanceState.status,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol
  ]);

  const resolveFundingBalanceForAsset = useCallback(
    (asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>): FundingBalance => {
      if (asset.kind === 'native') return { balanceWei: nativeBalanceWei, privacyRequired: false };
      const tokenAddress = asset.tokenAddress?.trim() ?? '';
      if (!isWalletAddress(tokenAddress)) return { balanceWei: null, privacyRequired: false };
      const tokenKey = tokenAddress.toLowerCase();
      if (asset.kind === 'erc20') {
        if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
          return { balanceWei: rewardTokenBalanceWei, privacyRequired: false };
        }
        const info = customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey('erc20', tokenAddress)];
        return { balanceWei: info?.balanceWei ?? null, privacyRequired: false };
      }
      if (tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
        return {
          balanceWei: pWispFooterBalanceState.status === 'ready' ? pWispFooterBalanceState.balanceWei : null,
          privacyRequired: pWispFooterBalanceState.status !== 'ready'
        };
      }
      const state = customTradeTokenInfoByAddress[
        buildTradeCustomTokenInfoKey('private-erc20', tokenAddress)
      ]?.privateBalanceState;
      return {
        balanceWei: state?.status === 'ready' ? state.balanceWei : null,
        privacyRequired: state?.status !== 'ready'
      };
    },
    [customTradeTokenInfoByAddress, nativeBalanceWei, pWispFooterBalanceState, rewardTokenBalanceWei]
  );

  return { combinedBalanceByAssetKey, pWispFooterBalanceState, resolveFundingBalanceForAsset, visibleTradingBalances };
}
