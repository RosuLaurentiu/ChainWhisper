import { useMemo } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import {
  getTradePairFilterOptions,
  type TradeDeskSortMode,
  type TradeDeskTypeFilter
} from '../../../lib/p2pTradeView';
import {
  PRIVATE_LIQUIDITY_LABEL,
  PUBLIC_LIQUIDITY_LABEL,
  UNLISTED_ORDER_LABEL,
  type TradeCreateMode
} from '../components/P2PTradingPage.helpers';

type RouteSurfaceView = 'swap' | 'agent' | 'public' | 'create' | 'recurring' | 'trade' | 'counter' | 'mine' | null;

type UseTradeDeskViewModelArgs = {
  counterParentTrade: TradeSnapshot | null;
  editingRecurringOrder: TradeSnapshot | null;
  editingTrade: TradeSnapshot | null;
  filteredPublicTradeCount: number;
  myTrades: TradeSnapshot[];
  openPublicTradeCount: number;
  publicOpenTrades: TradeSnapshot[];
  resetTradeDeskFilters: () => void;
  routeSurfaceView: RouteSurfaceView;
  selectedMyTradeGroupLabel: string;
  selectedMyTradeGroupTradeCount: number;
  tradeCreateMode: TradeCreateMode;
  tradePairFilter: string;
  tradeSearchInput: string;
  tradeSortMode: TradeDeskSortMode;
  tradeTypeFilter: TradeDeskTypeFilter;
  walletAddress: string;
};

export default function useTradeDeskViewModel({
  counterParentTrade,
  editingRecurringOrder,
  editingTrade,
  filteredPublicTradeCount,
  myTrades,
  openPublicTradeCount,
  publicOpenTrades,
  resetTradeDeskFilters,
  routeSurfaceView,
  selectedMyTradeGroupLabel,
  selectedMyTradeGroupTradeCount,
  tradeCreateMode,
  tradePairFilter,
  tradeSearchInput,
  tradeSortMode,
  tradeTypeFilter,
  walletAddress
}: UseTradeDeskViewModelArgs) {
  const tradePairFilterOptions = useMemo(
    () => getTradePairFilterOptions(routeSurfaceView === 'mine' ? myTrades : publicOpenTrades),
    [myTrades, publicOpenTrades, routeSurfaceView]
  );

  const hasActiveDeskFilters =
    tradeSearchInput.trim().length > 0 ||
    tradePairFilter !== 'all' ||
    tradeTypeFilter !== 'all' ||
    tradeSortMode !== 'newest';

  const activeAdvancedTradeFilterCount = [
    tradePairFilter !== 'all',
    tradeTypeFilter !== 'all',
    tradeSortMode !== 'newest'
  ].filter(Boolean).length;

  const showTradeSearch =
    routeSurfaceView === 'public' || (routeSurfaceView === 'mine' && Boolean(walletAddress));

  const tradeSearchPlaceholder =
    routeSurfaceView === 'mine'
      ? 'Search by token, wallet, status, or id'
      : 'Search offers by pair, token, wallet, or id';

  const tradeSearchSummary =
    routeSurfaceView === 'mine'
      ? `${selectedMyTradeGroupTradeCount} ${selectedMyTradeGroupLabel.toLowerCase()}`
      : `${filteredPublicTradeCount} of ${openPublicTradeCount} offers`;

  const tradeTypeFilterOptions: Array<{ value: TradeDeskTypeFilter; label: string }> =
    routeSurfaceView === 'mine'
      ? [
          { value: 'all', label: 'All types' },
          { value: 'one-off', label: 'One-off' },
          { value: 'recurring', label: 'Recurring' },
          { value: 'private-liquidity', label: PRIVATE_LIQUIDITY_LABEL },
          { value: 'private-link', label: UNLISTED_ORDER_LABEL },
          { value: 'direct', label: 'Direct links' },
          { value: 'counter', label: 'Counters' },
          { value: 'visible', label: PUBLIC_LIQUIDITY_LABEL }
        ]
      : [
          { value: 'all', label: 'All types' },
          { value: 'one-off', label: 'One-off' },
          { value: 'recurring', label: 'Recurring' },
          { value: 'private', label: PRIVATE_LIQUIDITY_LABEL },
          { value: 'visible', label: PUBLIC_LIQUIDITY_LABEL }
        ];

  const tradeDeskIdentity =
    routeSurfaceView === 'mine'
      ? {
          title: 'Orders',
          copy: 'Offers and history.'
        }
      : routeSurfaceView === 'swap'
        ? {
            title: 'Trade',
            copy: 'Swap from the best order, create a limit offer, or open recurring liquidity.'
          }
        : routeSurfaceView === 'agent'
          ? {
              title: 'Trade Agent',
              copy: 'Ask for quote help, order explanations, and trade drafts.'
            }
          : {
              title: 'OTC Desk',
              copy: 'Wallet-to-wallet escrow offers.'
            };

  const createDeskIdentity = counterParentTrade
    ? {
        title: 'Counter Offer',
        copy: 'Reply with a direct OTC quote.'
      }
    : editingTrade || editingRecurringOrder
      ? {
          title: 'Edit Order',
          copy: 'Adjust terms while preserving desk context.'
        }
      : tradeCreateMode === 'recurring'
        ? {
            title: 'Trade',
            copy: 'Create reusable two-sided OTC liquidity.'
          }
        : {
            title: 'Trade',
            copy: 'Create a limit OTC offer.'
          };

  return {
    activeAdvancedTradeFilterCount,
    clearTradeDeskFilters: resetTradeDeskFilters,
    createDeskIdentity,
    hasActiveDeskFilters,
    showTradeSearch,
    tradeDeskIdentity,
    tradePairFilterOptions,
    tradeSearchPlaceholder,
    tradeSearchSummary,
    tradeTypeFilterOptions
  };
}
