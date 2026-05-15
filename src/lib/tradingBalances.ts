import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_SYMBOL,
  formatCotiAmount,
  formatTokenAmount
} from './appShared';
import {
  VERIFIED_ECOSYSTEM_TOKENS,
  buildTradeCustomTokenInfoKey,
  type PrivateTokenBalanceState,
  type TradeCustomTokenInfo
} from './appHelpers';

export type TradingBalanceDisplayItem = {
  id: string;
  symbol: string;
  amountLabel: string;
  kindLabel: 'Native' | 'Public' | 'Private';
  sortGroup: number;
  address?: string;
};

type BuildVisibleTradingBalanceItemsInput = {
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  nativeBalanceWei: bigint | null;
  privateRewardTokenBalanceState: PrivateTokenBalanceState;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  walletKey: string;
};

const isPositiveBalance = (balanceWei: bigint | null | undefined): balanceWei is bigint =>
  typeof balanceWei === 'bigint' && balanceWei > 0n;

const LARGE_BALANCE_WHOLE_UNITS = 1000n;

const resolveTokenBalancePrecision = (balanceWei: bigint, decimals: number): number => {
  if (decimals <= 0) {
    return 0;
  }

  const base = 10n ** BigInt(decimals);
  return balanceWei / base >= LARGE_BALANCE_WHOLE_UNITS ? 0 : 2;
};

const addBalanceGroupSeparators = (label: string): string => {
  if (label.startsWith('<')) {
    return label;
  }

  const [whole, fraction] = label.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
};

const formatPositiveTokenBalance = (balanceWei: bigint, decimals: number): string => {
  const precision = resolveTokenBalancePrecision(balanceWei, decimals);
  const label = formatTokenAmount(balanceWei, decimals, precision);
  return label === '0' ? (precision === 0 ? '<1' : '<0.01') : addBalanceGroupSeparators(label);
};

const formatPositiveNativeBalance = (balanceWei: bigint): string => {
  const precision = balanceWei / 10n ** 18n >= LARGE_BALANCE_WHOLE_UNITS ? 0 : 2;
  const label = formatCotiAmount(balanceWei, precision);
  return label === '0' ? (precision === 0 ? '<1' : '<0.01') : addBalanceGroupSeparators(label);
};

const getCurrentWalletTokenInfo = (
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>,
  key: string,
  walletKey: string
): TradeCustomTokenInfo | null => {
  if (!walletKey) {
    return null;
  }

  const info = customTradeTokenInfoByAddress[key];
  return info?.walletKey === walletKey ? info : null;
};

export const buildVisibleTradingBalanceItems = ({
  customTradeTokenInfoByAddress,
  nativeBalanceWei,
  privateRewardTokenBalanceState,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  rewardTokenBalanceWei,
  rewardTokenDecimals,
  rewardTokenSymbol,
  walletKey
}: BuildVisibleTradingBalanceItemsInput): TradingBalanceDisplayItem[] => {
  const items: TradingBalanceDisplayItem[] = [];

  if (isPositiveBalance(nativeBalanceWei)) {
    items.push({
      id: 'native:coti',
      symbol: TIP_NATIVE_TOKEN_SYMBOL,
      amountLabel: formatPositiveNativeBalance(nativeBalanceWei),
      kindLabel: 'Native',
      sortGroup: 0
    });
  }

  if (isPositiveBalance(rewardTokenBalanceWei)) {
    items.push({
      id: `erc20:${REWARD_TOKEN_ADDRESS.toLowerCase()}`,
      symbol: rewardTokenSymbol,
      amountLabel: formatPositiveTokenBalance(rewardTokenBalanceWei, rewardTokenDecimals),
      kindLabel: 'Public',
      sortGroup: 10,
      address: REWARD_TOKEN_ADDRESS
    });
  }

  if (privateRewardTokenBalanceState.status === 'ready' && privateRewardTokenBalanceState.balanceWei > 0n) {
    items.push({
      id: `private-erc20:${PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()}`,
      symbol: privateRewardTokenSymbol,
      amountLabel: formatPositiveTokenBalance(privateRewardTokenBalanceState.balanceWei, privateRewardTokenDecimals),
      kindLabel: 'Private',
      sortGroup: 20,
      address: PRIVATE_REWARD_TOKEN_ADDRESS
    });
  }

  const builtInTokenKeys = new Set([
    buildTradeCustomTokenInfoKey('erc20', REWARD_TOKEN_ADDRESS),
    buildTradeCustomTokenInfoKey('private-erc20', PRIVATE_REWARD_TOKEN_ADDRESS)
  ]);

  for (const [index, token] of VERIFIED_ECOSYSTEM_TOKENS.entries()) {
    const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
    if (builtInTokenKeys.has(key)) {
      continue;
    }

    const info = getCurrentWalletTokenInfo(customTradeTokenInfoByAddress, key, walletKey);
    if (!info) {
      continue;
    }

    if (token.kind === 'private-erc20') {
      const state = info.privateBalanceState;
      if (state?.status !== 'ready' || state.balanceWei <= 0n) {
        continue;
      }
      items.push({
        id: key,
        symbol: info.symbol?.trim() || token.symbol,
        amountLabel: formatPositiveTokenBalance(state.balanceWei, info.decimals),
        kindLabel: 'Private',
        sortGroup: 40 + index,
        address: token.address
      });
      continue;
    }

    if (!isPositiveBalance(info.balanceWei)) {
      continue;
    }

    items.push({
      id: key,
      symbol: info.symbol?.trim() || token.symbol,
      amountLabel: formatPositiveTokenBalance(info.balanceWei, info.decimals),
      kindLabel: 'Public',
      sortGroup: 30 + index,
      address: token.address
    });
  }

  return items.sort((left, right) => left.sortGroup - right.sortGroup || left.symbol.localeCompare(right.symbol));
};
