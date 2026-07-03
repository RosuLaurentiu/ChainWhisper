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
  'combinedBalanceWei' | 'ownerPrivacyRequired' | 'availableLabel' | 'breakdownLabel' | 'splitLabel'
>;

type UseP2PTradingBalancesArgs = {
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  isPrivateTokenSnapStale: (address: string) => boolean;
  nativeBalanceWei: bigint | null;
  ownerCustomTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  ownerNativeBalanceWei: bigint | null;
  ownerPrivateRewardTokenBalanceState: PrivateTokenBalanceState;
  ownerRewardTokenBalanceWei: bigint | null;
  ownerWalletCanReadPrivate: boolean;
  ownerWalletKey: string;
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
  ownerCustomTradeTokenInfoByAddress,
  ownerNativeBalanceWei,
  ownerPrivateRewardTokenBalanceState,
  ownerRewardTokenBalanceWei,
  ownerWalletCanReadPrivate,
  ownerWalletKey,
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
  const ownerPWispFooterBalanceState = useMemo(
    () =>
      ownerPrivateRewardTokenBalanceState.status === 'ready' && !ownerWalletCanReadPrivate
        ? ({ status: 'locked' } as const)
        : ownerPrivateRewardTokenBalanceState,
    [ownerPrivateRewardTokenBalanceState, ownerWalletCanReadPrivate]
  );

  const hasSeparateOwnerWallet = Boolean(ownerWalletKey && ownerWalletKey !== walletKey);

  const visibleTradingBalances = useMemo<TradingBalanceDisplayItem[]>(
    () => [
      ...buildVisibleTradingBalanceItems({
        accountLabel: 'In ChainWhisper',
        accountRole: 'chainwhisper',
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
      ...buildVisibleTradingBalanceItems({
        accountLabel: 'In owner wallet',
        accountRole: 'owner',
        customTradeTokenInfoByAddress: ownerCustomTradeTokenInfoByAddress,
        nativeBalanceWei: hasSeparateOwnerWallet ? ownerNativeBalanceWei : null,
        privateRewardTokenBalanceState: ownerPWispFooterBalanceState,
        privateRewardTokenDecimals,
        privateRewardTokenSymbol,
        rewardTokenBalanceWei: hasSeparateOwnerWallet ? ownerRewardTokenBalanceWei : null,
        rewardTokenDecimals,
        rewardTokenSymbol,
        walletKey: hasSeparateOwnerWallet ? ownerWalletKey : ''
      })
    ],
    [
      customTradeTokenInfoByAddress,
      hasSeparateOwnerWallet,
      nativeBalanceWei,
      ownerCustomTradeTokenInfoByAddress,
      ownerNativeBalanceWei,
      ownerPWispFooterBalanceState,
      ownerRewardTokenBalanceWei,
      ownerWalletKey,
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
      chainwhisperBalanceWei: bigint | null,
      ownerBalanceWei: bigint | null,
      ownerPrivacyRequired = false
    ) => {
      const key = buildTradeComposerAssetBalanceKey(asset);
      if (!key) {
        return;
      }
      const combined = buildCombinedWalletAssetBalance({
        asset,
        chainwhisperBalanceWei,
        ownerBalanceWei,
        ownerPrivacyRequired
      });
      balances[key] = {
        combinedBalanceWei: combined.combinedBalanceWei,
        ownerPrivacyRequired: combined.ownerPrivacyRequired,
        availableLabel: combined.availableLabel,
        breakdownLabel: combined.breakdownLabel,
        splitLabel: combined.splitLabel
      };
    };

    addBalance(
      { kind: 'native', symbol: TIP_NATIVE_TOKEN_SYMBOL, decimals: 18 },
      nativeBalanceWei,
      hasSeparateOwnerWallet ? ownerNativeBalanceWei : null
    );
    addBalance(
      { kind: 'erc20', tokenAddress: REWARD_TOKEN_ADDRESS, symbol: rewardTokenSymbol, decimals: rewardTokenDecimals },
      rewardTokenBalanceWei,
      hasSeparateOwnerWallet ? ownerRewardTokenBalanceWei : null
    );
    addBalance(
      {
        kind: 'private-erc20',
        tokenAddress: PRIVATE_REWARD_TOKEN_ADDRESS,
        symbol: privateRewardTokenSymbol,
        decimals: privateRewardTokenDecimals
      },
      privateRewardTokenBalanceWei,
      hasSeparateOwnerWallet && ownerPrivateRewardTokenBalanceState.status === 'ready'
        ? ownerPrivateRewardTokenBalanceState.balanceWei
        : null,
      Boolean(hasSeparateOwnerWallet && ownerPrivateRewardTokenBalanceState.status !== 'ready')
    );

    for (const [key, info] of Object.entries(customTradeTokenInfoByAddress)) {
      const tokenAddress = info.address;
      if (!isWalletAddress(tokenAddress)) {
        continue;
      }
      const ownerInfo = ownerCustomTradeTokenInfoByAddress[key];
      if (info.kind === 'private-erc20') {
        const ownerState = ownerInfo?.privateBalanceState;
        addBalance(
          {
            kind: 'private-erc20',
            tokenAddress,
            symbol: info.symbol,
            decimals: info.decimals
          },
          info.privateBalanceState?.status === 'ready' ? info.privateBalanceState.balanceWei : info.balanceWei,
          hasSeparateOwnerWallet && ownerState?.status === 'ready' ? ownerState.balanceWei : null,
          Boolean(hasSeparateOwnerWallet && ownerState?.status !== 'ready')
        );
      } else {
        addBalance(
          {
            kind: 'erc20',
            tokenAddress,
            symbol: info.symbol,
            decimals: info.decimals
          },
          info.balanceWei,
          hasSeparateOwnerWallet ? ownerInfo?.balanceWei ?? null : null
        );
      }
    }

    return balances;
  }, [
    customTradeTokenInfoByAddress,
    hasSeparateOwnerWallet,
    nativeBalanceWei,
    ownerCustomTradeTokenInfoByAddress,
    ownerNativeBalanceWei,
    ownerPrivateRewardTokenBalanceState,
    ownerRewardTokenBalanceWei,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol
  ]);

  const resolveFundingBalanceForAsset = useCallback(
    (
      asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>,
      role: 'chainwhisper' | 'owner'
    ): FundingBalance => {
      const useOwner = role === 'owner';
      if (useOwner && !hasSeparateOwnerWallet) {
        return { balanceWei: null, privacyRequired: false };
      }

      if (asset.kind === 'native') {
        return {
          balanceWei: useOwner ? ownerNativeBalanceWei : nativeBalanceWei,
          privacyRequired: false
        };
      }

      const tokenAddress = asset.tokenAddress?.trim() ?? '';
      if (!isWalletAddress(tokenAddress)) {
        return { balanceWei: null, privacyRequired: false };
      }

      const tokenKey = tokenAddress.toLowerCase();
      if (asset.kind === 'erc20') {
        if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
          return {
            balanceWei: useOwner ? ownerRewardTokenBalanceWei : rewardTokenBalanceWei,
            privacyRequired: false
          };
        }
        const customKey = buildTradeCustomTokenInfoKey('erc20', tokenAddress);
        const info = useOwner
          ? ownerCustomTradeTokenInfoByAddress[customKey]
          : customTradeTokenInfoByAddress[customKey];
        return { balanceWei: info?.balanceWei ?? null, privacyRequired: false };
      }

      if (tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
        const state = useOwner ? ownerPrivateRewardTokenBalanceState : pWispFooterBalanceState;
        return {
          balanceWei: state.status === 'ready' ? state.balanceWei : null,
          privacyRequired: state.status !== 'ready'
        };
      }

      const customKey = buildTradeCustomTokenInfoKey('private-erc20', tokenAddress);
      const state = (useOwner
        ? ownerCustomTradeTokenInfoByAddress[customKey]
        : customTradeTokenInfoByAddress[customKey]
      )?.privateBalanceState;
      return {
        balanceWei: state?.status === 'ready' ? state.balanceWei : null,
        privacyRequired: state?.status !== 'ready'
      };
    },
    [
      customTradeTokenInfoByAddress,
      hasSeparateOwnerWallet,
      nativeBalanceWei,
      ownerCustomTradeTokenInfoByAddress,
      ownerNativeBalanceWei,
      ownerPrivateRewardTokenBalanceState,
      ownerRewardTokenBalanceWei,
      pWispFooterBalanceState,
      rewardTokenBalanceWei
    ]
  );

  return {
    combinedBalanceByAssetKey,
    pWispFooterBalanceState,
    resolveFundingBalanceForAsset,
    visibleTradingBalances
  };
}
