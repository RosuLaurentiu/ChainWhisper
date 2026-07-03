import {
  FALLBACK_REWARD_TOKEN_DECIMALS,
  normalizeTokenDecimals,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL
} from '../../lib/appShared';
import {
  buildPrivateTradeTokenSymbolOrder,
  buildPublicTradeTokenSymbolOrder,
  buildTradeCustomTokenInfoKey,
  VERIFIED_ECOSYSTEM_TOKENS,
  type TradeCustomTokenInfo
} from '../../lib/appHelpers';
import type { WalletFundAsset } from '../../lib/walletFunds';
import type { AccountFundsAssetOption } from './components/AccountFundsModal';

type BuildAccountFundsAssetsInput = {
  burnerAddress: string;
  burnerBalanceWei: bigint | null;
  chainwhisperCustomTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  chainwhisperHasAesReady: boolean;
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
  walletAddress: string;
};

const getCurrentTokenInfo = (
  source: Record<string, TradeCustomTokenInfo>,
  key: string,
  expectedWalletKey: string
): TradeCustomTokenInfo | null => {
  const info = source[key];
  return info && expectedWalletKey && info.walletKey === expectedWalletKey ? info : null;
};

const getPrivateInfoBalance = (info: TradeCustomTokenInfo | null): bigint | null => {
  if (!info) {
    return null;
  }
  if (info.privateBalanceState?.status === 'ready') {
    return info.privateBalanceState.balanceWei;
  }
  return info.balanceWei;
};

const orderBySymbol = (options: AccountFundsAssetOption[], symbolOrder: string[]): AccountFundsAssetOption[] => {
  const rankBySymbol = new Map(symbolOrder.map((symbol, index) => [symbol.toLowerCase(), index]));
  return [...options].sort((left, right) => {
    const leftRank = rankBySymbol.get(left.asset.symbol.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rankBySymbol.get(right.asset.symbol.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.asset.symbol.localeCompare(right.asset.symbol);
  });
};

export const buildAccountFundsAssets = ({
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
}: BuildAccountFundsAssetsInput): AccountFundsAssetOption[] => {
  const chainwhisperWalletKey = walletAddress.trim().toLowerCase();
  const ownerWalletKey = ownerWalletAddress.trim().toLowerCase();
  const builtInTokenAddressSet = new Set([
    REWARD_TOKEN_ADDRESS.toLowerCase(),
    PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
  ]);

  const nativeAsset: WalletFundAsset = {
    kind: 'native',
    symbol: TIP_NATIVE_TOKEN_SYMBOL,
    decimals: TIP_NATIVE_TOKEN_DECIMALS
  };
  const publicRewardAsset: WalletFundAsset = {
    kind: 'erc20',
    tokenAddress: REWARD_TOKEN_ADDRESS,
    symbol: rewardTokenSymbol,
    decimals: rewardTokenDecimals
  };
  const privateRewardAsset: WalletFundAsset = {
    kind: 'private-erc20',
    tokenAddress: PRIVATE_REWARD_TOKEN_ADDRESS,
    symbol: privateRewardTokenSymbol,
    decimals: privateRewardTokenDecimals
  };

  const publicOptions: AccountFundsAssetOption[] = [
    {
      id: `erc20:${REWARD_TOKEN_ADDRESS.toLowerCase()}`,
      asset: publicRewardAsset,
      chainwhisperBalanceWei: rewardTokenBalanceWei,
      ownerBalanceWei: ownerRewardTokenBalanceWei
    }
  ];
  const privateOptions: AccountFundsAssetOption[] = [
    {
      id: `private-erc20:${PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()}`,
      asset: privateRewardAsset,
      chainwhisperBalanceWei: privateRewardTokenBalanceWei,
      ownerBalanceWei: ownerPrivateRewardTokenBalanceWei,
      chainwhisperPrivacyRequired: Boolean(
        burnerAddress && !chainwhisperHasAesReady && privateRewardTokenBalanceWei === null
      ),
      ownerPrivacyRequired: ownerPrivateRewardBalanceLocked
    }
  ];

  for (const token of VERIFIED_ECOSYSTEM_TOKENS) {
    const normalizedAddress = token.address.toLowerCase();
    if (builtInTokenAddressSet.has(normalizedAddress)) {
      continue;
    }

    const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
    const chainwhisperInfo = getCurrentTokenInfo(chainwhisperCustomTokenInfoByAddress, key, chainwhisperWalletKey);
    const ownerInfo = getCurrentTokenInfo(ownerCustomTokenInfoByAddress, key, ownerWalletKey);
    const chainwhisperBalanceWei =
      token.kind === 'private-erc20' ? getPrivateInfoBalance(chainwhisperInfo) : chainwhisperInfo?.balanceWei ?? null;
    const ownerBalanceWei =
      token.kind === 'private-erc20' ? getPrivateInfoBalance(ownerInfo) : ownerInfo?.balanceWei ?? null;
    const symbol = chainwhisperInfo?.symbol?.trim() || ownerInfo?.symbol?.trim() || token.symbol;
    const decimals = normalizeTokenDecimals(chainwhisperInfo?.decimals ?? ownerInfo?.decimals ?? FALLBACK_REWARD_TOKEN_DECIMALS);
    const option: AccountFundsAssetOption = {
      id: key,
      asset: {
        kind: token.kind,
        tokenAddress: token.address,
        symbol,
        decimals
      },
      chainwhisperBalanceWei,
      ownerBalanceWei,
      chainwhisperPrivacyRequired: token.kind === 'private-erc20' && Boolean(burnerAddress && !chainwhisperHasAesReady),
      ownerPrivacyRequired: token.kind === 'private-erc20' && Boolean(ownerWalletAddress && !ownerAesReady)
    };

    if (token.kind === 'private-erc20') {
      privateOptions.push(option);
    } else {
      publicOptions.push(option);
    }
  }

  return [
    {
      id: 'native:coti',
      asset: nativeAsset,
      chainwhisperBalanceWei: burnerBalanceWei,
      ownerBalanceWei: ownerNativeBalanceWei
    },
    ...orderBySymbol(publicOptions, buildPublicTradeTokenSymbolOrder(rewardTokenSymbol)),
    ...orderBySymbol(privateOptions, buildPrivateTradeTokenSymbolOrder(privateRewardTokenSymbol))
  ];
};
