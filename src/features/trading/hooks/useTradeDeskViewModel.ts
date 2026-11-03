import { useMemo } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import {
  getTradePairFilterOptions,
  type TradeDeskSortMode,
  type TradeDeskTypeFilter
} from '../../../lib/p2pTradeView';
import { UNLISTED_ORDER_LABEL } from '../components/P2PTradingPage.helpers';

type RouteSurfaceView = 'swap' | 'agent' | 'public' | 'create' | 'recurring' | 'trade' | 'counter' | 'mine' | 'pools' | null;

type UseTradeDeskViewModelArgs = {
  counterParentTrade: TradeSnapshot | null;
  editingTrade: TradeSnapshot | null;
  filteredPublicTradeCount: number;
  myTrades: TradeSnapshot[];
  openPublicTradeCount: number;
  publicOpenTrades: TradeSnapshot[];
  resetTradeDeskFilters: () => void;
  routeSurfaceView: RouteSurfaceView;
  selectedMyTradeGroupLabel: string;
  selectedMyTradeGroupTradeCount: number;
  tradePairFilter: string;
  tradeSearchInput: string;
  tradeSortMode: TradeDeskSortMode;
  tradeTypeFilter: TradeDeskTypeFilter;
  walletAddress: string;
};

export default function useTradeDeskViewModel({
  counterParentTrade,
  editingTrade,
  filteredPublicTradeCount,
  myTrades,
  openPublicTradeCount,
  publicOpenTrades,
  resetTradeDeskFilters,
  routeSurfaceView,
  selectedMyTradeGroupLabel,
  selectedMyTradeGroupTradeCount,
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
          { value: 'all', label: 'All offers' },
          { value: 'private-liquidity', label: 'Hidden budget' },
          { value: 'private-link', label: UNLISTED_ORDER_LABEL },
          { value: 'direct', label: 'Direct offers' },
          { value: 'counter', label: 'Counteroffers' },
          { value: 'visible', label: 'Public terms' }
        ]
      : [
          { value: 'all', label: 'All offers' },
          { value: 'private', label: 'Private terms' },
          { value: 'visible', label: 'Public terms' }
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
          title: 'Private Liquidity',
          copy: 'Manage private liquidity positions and hidden intents.'
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
    : editingTrade
      ? {
          title: 'Edit Order',
          copy: 'Adjust terms while preserving desk context.'
        }
      : {
            title: 'Create',
            copy: 'Create a fixed-term P2P offer.'
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
