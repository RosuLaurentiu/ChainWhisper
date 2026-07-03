import { useCallback, useMemo, useState } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import {
  filterAndSortTradeDesk,
  getSnapshotKey,
  type TradeDeskSortMode,
  type TradeDeskTypeFilter
} from '../../../lib/p2pTradeView';
import { groupWalletTradesByPerspective } from '../../../lib/tradePerspective';
import {
  getTradeAccountPerspectiveAddress,
  getWalletActionAccount,
  getWalletOwnerAccount,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';
import type { MyTradeGroupView } from '../components/P2PTradingPage.helpers';
import type { MyTradeGroupOption } from '../components/TradeMyTradesSection';

type UseTradeDeskListsArgs = {
  myTradeGroupView: MyTradeGroupView;
  myTrades: TradeSnapshot[];
  publicOpenTrades: TradeSnapshot[];
  selectedMyTradeDetailKey: string;
  walletAddress: string;
  walletReadAccounts: WalletReadAccount[];
};

export default function useTradeDeskLists({
  myTradeGroupView,
  myTrades,
  publicOpenTrades,
  selectedMyTradeDetailKey,
  walletAddress,
  walletReadAccounts
}: UseTradeDeskListsArgs) {
  const [tradeSearchInput, setTradeSearchInput] = useState('');
  const [tradePairFilter, setTradePairFilter] = useState('all');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<TradeDeskTypeFilter>('all');
  const [tradeSortMode, setTradeSortMode] = useState<TradeDeskSortMode>('newest');
  const [mobileTradeFiltersOpen, setMobileTradeFiltersOpen] = useState(false);
  const resetTradeDeskFilters = useCallback(() => {
    setTradeSearchInput('');
    setTradePairFilter('all');
    setTradeTypeFilter('all');
    setTradeSortMode('newest');
  }, []);
  const tradeDeskFilters = useMemo(
    () => ({
      search: tradeSearchInput,
      pair: tradePairFilter,
      type: tradeTypeFilter,
      access: 'all' as const,
      sort: tradeSortMode
    }),
    [tradePairFilter, tradeSearchInput, tradeSortMode, tradeTypeFilter]
  );
  const filteredPublicTrades = useMemo(
    () => filterAndSortTradeDesk(publicOpenTrades, tradeDeskFilters),
    [publicOpenTrades, tradeDeskFilters]
  );
  const filteredMyTrades = useMemo(
    () => filterAndSortTradeDesk(myTrades, tradeDeskFilters),
    [myTrades, tradeDeskFilters]
  );
  const walletTradeGroups = useMemo(
    () => {
      const grouped = {
        history: [] as TradeSnapshot[],
        myActiveOffers: [] as TradeSnapshot[],
        needsAction: [] as TradeSnapshot[]
      };
      const actionAccount = getWalletActionAccount(walletReadAccounts);
      const ownerAccount = getWalletOwnerAccount(walletReadAccounts);
      for (const trade of filteredMyTrades) {
        const perspectiveAddress = getTradeAccountPerspectiveAddress(trade, { actionAccount, ownerAccount });
        const perTradeGroups = groupWalletTradesByPerspective([trade], perspectiveAddress || walletAddress);
        grouped.needsAction.push(...perTradeGroups.needsAction);
        grouped.myActiveOffers.push(...perTradeGroups.myActiveOffers);
        grouped.history.push(...perTradeGroups.history);
      }
      return grouped;
    },
    [filteredMyTrades, walletAddress, walletReadAccounts]
  );
  const receivedOpenTradeOffers = walletTradeGroups.needsAction;
  const myOpenTrades = walletTradeGroups.myActiveOffers;
  const walletTradeHistory = walletTradeGroups.history;
  const myTradeGroupOptions: MyTradeGroupOption[] = [
    {
      id: 'received',
      label: 'Received',
      mobileLabel: 'Received',
      subLabel: 'Needs action',
      description: 'Offers and counters sent to this wallet for review.',
      count: receivedOpenTradeOffers.length,
      trades: receivedOpenTradeOffers,
      emptyTitle: 'No received offers',
      emptyDescription: 'Direct and counter offers sent to this wallet will appear here for review.',
      emptySearchTitle: 'No received offers match',
      emptySearchMessage: 'No received offers match that search.'
    },
    {
      id: 'active',
      label: 'Active',
      mobileLabel: 'Active',
      subLabel: 'Created by you',
      description: 'Open offers and reusable liquidity created by this wallet.',
      count: myOpenTrades.length,
      trades: myOpenTrades,
      emptyTitle: 'No active trades',
      emptyDescription: 'Create a public, unlisted, or direct offer to start tracking it here.',
      emptySearchTitle: 'No active trades match',
      emptySearchMessage: 'No trades you created match that search.'
    },
    {
      id: 'history',
      label: 'History',
      mobileLabel: 'History',
      subLabel: 'Settled records',
      description: 'Completed, cancelled, declined, and expired trades.',
      count: walletTradeHistory.length,
      trades: walletTradeHistory,
      emptyTitle: 'No history yet',
      emptyDescription: 'Settled, cancelled, declined, and expired trades will collect here.',
      emptySearchTitle: 'No history matches',
      emptySearchMessage: 'No history matches that search.'
    }
  ];
  const selectedMyTradeGroup =
    myTradeGroupOptions.find((group) => group.id === myTradeGroupView) ?? myTradeGroupOptions[0];
  const canOpenMyTradeTerminal = useCallback((trade: TradeSnapshot, groupId: MyTradeGroupView): boolean => {
    const actionAccount = getWalletActionAccount(walletReadAccounts);
    const ownerAccount = getWalletOwnerAccount(walletReadAccounts);
    const perspectiveWalletAddress =
      getTradeAccountPerspectiveAddress(trade, { actionAccount, ownerAccount }) || walletAddress;
    const perspectiveWalletKey = perspectiveWalletAddress.trim().toLowerCase();
    if (!perspectiveWalletKey) {
      return false;
    }
    if (trade.maker.toLowerCase() === perspectiveWalletKey) {
      return true;
    }
    if (groupId === 'received') {
      return true;
    }
    if (groupId === 'history') {
      return true;
    }
    return false;
  }, [walletAddress, walletReadAccounts]);
  const selectedMyTradeDetail = useMemo(() => {
    if (!selectedMyTradeDetailKey) {
      return null;
    }
    for (const group of myTradeGroupOptions) {
      const selectedTrade = group.trades.find((trade) => getSnapshotKey(trade) === selectedMyTradeDetailKey) ?? null;
      if (selectedTrade && canOpenMyTradeTerminal(selectedTrade, group.id)) {
        return selectedTrade;
      }
    }
    return null;
  }, [canOpenMyTradeTerminal, myTradeGroupOptions, selectedMyTradeDetailKey]);

  return {
    canOpenMyTradeTerminal,
    filteredPublicTrades,
    mobileTradeFiltersOpen,
    myOpenTrades,
    myTradeGroupOptions,
    receivedOpenTradeOffers,
    resetTradeDeskFilters,
    selectedMyTradeDetail,
    selectedMyTradeGroup,
    setMobileTradeFiltersOpen,
    setTradePairFilter,
    setTradeSearchInput,
    setTradeSortMode,
    setTradeTypeFilter,
    tradePairFilter,
    tradeSearchInput,
    tradeSortMode,
    tradeTypeFilter,
    walletTradeHistory
  };
}
