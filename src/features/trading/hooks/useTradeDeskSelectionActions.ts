import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import type {
  MyTradeGroupView,
  TerminalFillInputSide,
  TradeFilterRouteScope
} from '../components/P2PTradingPage.helpers';

type UseTradeDeskSelectionActionsArgs = {
  canOpenMyTradeTerminal: (trade: TradeSnapshot, groupId: MyTradeGroupView) => boolean;
  previousTradeFilterRouteScopeRef: MutableRefObject<TradeFilterRouteScope>;
  resetTradeDeskFilters: () => void;
  saveMobileDeskScroll: (surface: 'mine') => void;
  selectedMyTradeDetail: TradeSnapshot | null;
  selectedMyTradeDetailKey: string;
  selectedMyTradeGroupId: MyTradeGroupView;
  setEmptyTerminalDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedMyTradeDetailKey: Dispatch<SetStateAction<string>>;
  setTerminalBuyInput: Dispatch<SetStateAction<string>>;
  setTerminalFillInputSide: Dispatch<SetStateAction<TerminalFillInputSide>>;
  setTerminalHistorySheetKey: Dispatch<SetStateAction<string>>;
  setTerminalPayInput: Dispatch<SetStateAction<string>>;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  tradeFilterRouteScope: TradeFilterRouteScope;
};

export default function useTradeDeskSelectionActions({
  canOpenMyTradeTerminal,
  previousTradeFilterRouteScopeRef,
  resetTradeDeskFilters,
  saveMobileDeskScroll,
  selectedMyTradeDetail,
  selectedMyTradeDetailKey,
  selectedMyTradeGroupId,
  setEmptyTerminalDrawerOpen,
  setSelectedMyTradeDetailKey,
  setTerminalBuyInput,
  setTerminalFillInputSide,
  setTerminalHistorySheetKey,
  setTerminalPayInput,
  setTradeActionError,
  tradeFilterRouteScope
}: UseTradeDeskSelectionActionsArgs) {
  useEffect(() => {
    if (!tradeFilterRouteScope) {
      return;
    }
    const previousScope = previousTradeFilterRouteScopeRef.current;
    if (previousScope && previousScope !== tradeFilterRouteScope) {
      resetTradeDeskFilters();
    }
    previousTradeFilterRouteScopeRef.current = tradeFilterRouteScope;
  }, [previousTradeFilterRouteScopeRef, resetTradeDeskFilters, tradeFilterRouteScope]);

  useEffect(() => {
    if (!selectedMyTradeDetailKey) {
      return;
    }
    if (!selectedMyTradeDetail) {
      setSelectedMyTradeDetailKey('');
    }
  }, [selectedMyTradeDetail, selectedMyTradeDetailKey, setSelectedMyTradeDetailKey]);

  return useCallback((trade: TradeSnapshot) => {
    if (!canOpenMyTradeTerminal(trade, selectedMyTradeGroupId)) {
      return;
    }
    saveMobileDeskScroll('mine');
    setTradeActionError('');
    setTerminalFillInputSide('pay');
    setTerminalPayInput('');
    setTerminalBuyInput('');
    setTerminalHistorySheetKey('');
    setEmptyTerminalDrawerOpen(false);
    setSelectedMyTradeDetailKey(getSnapshotKey(trade));
  }, [
    canOpenMyTradeTerminal,
    saveMobileDeskScroll,
    selectedMyTradeGroupId,
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput,
    setTradeActionError
  ]);
}
