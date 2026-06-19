import {
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_SYMBOL,
  formatCotiAmount,
  formatTokenAmount
} from './appShared';
import {
  VERIFIED_ECOSYSTEM_TOKENS,
  buildPrivateTradeTokenSymbolOrder,
  buildPublicTradeTokenSymbolOrder,
  buildTradeCustomTokenInfoKey,
  sortTradeTokenOptionsBySymbol,
  type PrivateTokenBalanceState,
  type TradeCustomTokenInfo
} from './appHelpers';

export type TradingBalanceDisplayItem = {
  id: string;
  symbol: string;
  amountWei: bigint;
  amountLabel: string;
  decimals: number;
  kindLabel: 'Native' | 'Public' | 'Private';
  sortGroup: number;
  address?: string;
  accountRole?: 'chainwhisper' | 'owner';
  accountLabel?: string;
};

type BuildVisibleTradingBalanceItemsInput = {
  accountLabel?: string;
  accountRole?: 'chainwhisper' | 'owner';
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

const orderVisibleTradingBalanceItems = (
  items: TradingBalanceDisplayItem[],
  rewardTokenSymbol: string,
  privateRewardTokenSymbol: string
): TradingBalanceDisplayItem[] => {
  const nativeItems = items.filter((item) => item.kindLabel === 'Native');
  const publicItems = sortTradeTokenOptionsBySymbol(
    items.filter((item) => item.kindLabel === 'Public'),
    buildPublicTradeTokenSymbolOrder(rewardTokenSymbol)
  );
  const privateItems = sortTradeTokenOptionsBySymbol(
    items.filter((item) => item.kindLabel === 'Private'),
    buildPrivateTradeTokenSymbolOrder(privateRewardTokenSymbol)
  );

  return [...nativeItems, ...publicItems, ...privateItems].map((item, index) => ({
    ...item,
    sortGroup: index
  }));
};

const resolveTotalBalanceKey = (item: TradingBalanceDisplayItem): string =>
  item.kindLabel === 'Native'
    ? 'native:coti'
    : `${item.kindLabel.toLowerCase()}:${(item.address ?? item.symbol).toLowerCase()}`;

const formatPositiveBalanceForItem = (item: Pick<TradingBalanceDisplayItem, 'amountWei' | 'decimals' | 'kindLabel'>): string =>
  item.kindLabel === 'Native'
    ? formatPositiveNativeBalance(item.amountWei)
    : formatPositiveTokenBalance(item.amountWei, item.decimals);

export const buildTotalTradingBalanceItems = (items: TradingBalanceDisplayItem[]): TradingBalanceDisplayItem[] => {
  const totalsByKey = new Map<string, TradingBalanceDisplayItem>();

  for (const item of items) {
    if (item.amountWei <= 0n) {
      continue;
    }

    const totalKey = resolveTotalBalanceKey(item);
    const existing = totalsByKey.get(totalKey);
    if (existing) {
      const amountWei = existing.amountWei + item.amountWei;
      totalsByKey.set(totalKey, {
        ...existing,
        amountWei,
        amountLabel: formatPositiveBalanceForItem({ ...existing, amountWei }),
        sortGroup: Math.min(existing.sortGroup, item.sortGroup)
      });
      continue;
    }

    const totalItem = { ...item };
    delete totalItem.accountLabel;
    delete totalItem.accountRole;
    totalsByKey.set(totalKey, {
      ...totalItem,
      id: `total:${totalKey}`,
      accountLabel: 'Total',
      amountLabel: formatPositiveBalanceForItem(item)
    });
  }

  return Array.from(totalsByKey.values()).sort((a, b) => {
    const kindOrder = { Native: 0, Public: 1, Private: 2 } as const;
    const kindDelta = kindOrder[a.kindLabel] - kindOrder[b.kindLabel];
    if (kindDelta !== 0) {
      return kindDelta;
    }
    const sortDelta = a.sortGroup - b.sortGroup;
    if (sortDelta !== 0) {
      return sortDelta;
    }
    return a.symbol.localeCompare(b.symbol);
  });
};

export const buildVisibleTradingBalanceItems = ({
  accountLabel,
  accountRole = 'chainwhisper',
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
  const itemPrefix = accountRole === 'owner' ? 'owner' : 'chainwhisper';
  const withAccount = (
    item: Omit<TradingBalanceDisplayItem, 'accountLabel' | 'accountRole'>
  ): TradingBalanceDisplayItem => ({
    ...item,
    id: `${itemPrefix}:${item.id}`,
    accountLabel,
    accountRole
  });

  if (isPositiveBalance(nativeBalanceWei)) {
    items.push(withAccount({
      id: 'native:coti',
      symbol: TIP_NATIVE_TOKEN_SYMBOL,
      amountWei: nativeBalanceWei,
      amountLabel: formatPositiveNativeBalance(nativeBalanceWei),
      decimals: 18,
      kindLabel: 'Native',
      sortGroup: 0
    }));
  }

  if (isPositiveBalance(rewardTokenBalanceWei)) {
    items.push(withAccount({
      id: `erc20:${REWARD_TOKEN_ADDRESS.toLowerCase()}`,
      symbol: rewardTokenSymbol,
      amountWei: rewardTokenBalanceWei,
      amountLabel: formatPositiveTokenBalance(rewardTokenBalanceWei, rewardTokenDecimals),
      decimals: rewardTokenDecimals,
      kindLabel: 'Public',
      sortGroup: 10,
      address: REWARD_TOKEN_ADDRESS
    }));
  }

  if (privateRewardTokenBalanceState.status === 'ready' && privateRewardTokenBalanceState.balanceWei > 0n) {
    items.push(withAccount({
      id: `private-erc20:${PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()}`,
      symbol: privateRewardTokenSymbol,
      amountWei: privateRewardTokenBalanceState.balanceWei,
      amountLabel: formatPositiveTokenBalance(privateRewardTokenBalanceState.balanceWei, privateRewardTokenDecimals),
      decimals: privateRewardTokenDecimals,
      kindLabel: 'Private',
      sortGroup: 20,
      address: PRIVATE_REWARD_TOKEN_ADDRESS
    }));
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
      items.push(withAccount({
        id: key,
        symbol: info.symbol?.trim() || token.symbol,
        amountWei: state.balanceWei,
        amountLabel: formatPositiveTokenBalance(state.balanceWei, info.decimals),
        decimals: info.decimals,
        kindLabel: 'Private',
        sortGroup: 40 + index,
        address: token.address
      }));
      continue;
    }

    if (!isPositiveBalance(info.balanceWei)) {
      continue;
    }

    items.push(withAccount({
      id: key,
      symbol: info.symbol?.trim() || token.symbol,
      amountWei: info.balanceWei,
      amountLabel: formatPositiveTokenBalance(info.balanceWei, info.decimals),
      decimals: info.decimals,
      kindLabel: 'Public',
      sortGroup: 30 + index,
      address: token.address
    }));
  }

  return orderVisibleTradingBalanceItems(items, rewardTokenSymbol, privateRewardTokenSymbol);
};
