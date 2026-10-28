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

type RouteSurfaceView = 'swap' | 'agent' | 'public' | 'create' | 'recurring' | 'trade' | 'counter' | 'mine' | 'pools' | null;

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
          title: 'My trades',
          copy: 'Review received offers, manage active ones, and revisit history.'
        }
      : routeSurfaceView === 'swap'
        ? {
            title: 'Offers',
            copy: 'Compare one-order P2P rates around the Carbon market reference.'
          }
        : routeSurfaceView === 'pools'
          ? {
              title: 'Recurring Limit Strategies',
              copy: 'Manage fixed bid/ask Position NFTs and hidden private limit intents.'
            }
        : routeSurfaceView === 'agent'
          ? {
              title: 'Trade Agent',
              copy: 'Ask for quote help, order explanations, and trade drafts.'
            }
          : {
              title: 'Offers',
              copy: 'Compare one-order P2P rates around the Carbon market reference.'
            };

  const createDeskIdentity = counterParentTrade
    ? {
        title: 'Counter Offer',
        copy: 'Reply with a direct P2P quote.'
      }
    : editingTrade || editingRecurringOrder
      ? {
          title: 'Edit Order',
          copy: 'Adjust terms while preserving desk context.'
        }
      : tradeCreateMode === 'recurring'
        ? {
            title: 'Create',
            copy: 'Create reusable two-sided P2P liquidity.'
          }
        : {
            title: 'Create',
            copy: 'Create a one-off or recurring P2P offer.'
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
