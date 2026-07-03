import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import type { OtcSwapInputMode } from '../../../lib/otcSwapQuote';
import { resolveSwapLimitPrefill } from '../../../lib/otcSwapUi';
import type { TradeCreateMode } from '../components/P2PTradingPage.helpers';
import type { TradeEntryMode, TradePageView } from './useP2PTradeRoute';

type UseP2PTradeEntryNavigationArgs = {
  buildCurrentTradeSurfacePath: (surface: 'recurring') => string;
  navigateDeskView: (path: '/otc') => void;
  navigateToTradePath: (path: string) => void;
  routeTradeMode?: TradeEntryMode;
  routeView: TradePageView;
  setTradeActionError: (message: string) => void;
  setTradeCreateMode: Dispatch<SetStateAction<TradeCreateMode>>;
  setTradeOfferCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeOfferTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setTradeRequestCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeRequestTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  startFreshOneOffTrade: () => void;
  startFreshRecurringOrder: () => void;
  swapActionMode: OtcSwapInputMode;
  swapBuyTokenSelection: TradeTokenPresetKey;
  swapSellTokenSelection: TradeTokenPresetKey;
};

export default function useP2PTradeEntryNavigation({
  buildCurrentTradeSurfacePath,
  navigateDeskView,
  navigateToTradePath,
  routeTradeMode,
  routeView,
  setTradeActionError,
  setTradeCreateMode,
  setTradeOfferCustomTokenAddress,
  setTradeOfferTokenSelection,
  setTradeRequestCustomTokenAddress,
  setTradeRequestTokenSelection,
  startFreshOneOffTrade,
  startFreshRecurringOrder,
  swapActionMode,
  swapBuyTokenSelection,
  swapSellTokenSelection
}: UseP2PTradeEntryNavigationArgs) {
  const activeTradeMode: TradeEntryMode =
    routeView === 'create'
      ? routeTradeMode === 'recurring'
        ? 'recurring'
        : 'limit'
      : 'swap';

  useEffect(() => {
    if (routeView !== 'create') {
      return;
    }
    const nextCreateMode = routeTradeMode === 'recurring' ? 'recurring' : 'one-off';
    setTradeCreateMode((current) => (current === nextCreateMode ? current : nextCreateMode));
  }, [routeTradeMode, routeView, setTradeCreateMode]);

  const openTradeEntryMode = useCallback(
    (mode: TradeEntryMode) => {
      setTradeActionError('');
      if (mode === 'swap') {
        navigateDeskView('/otc');
        return;
      }
      if (mode === 'recurring') {
        startFreshRecurringOrder();
        navigateToTradePath(buildCurrentTradeSurfacePath('recurring'));
        return;
      }
      startFreshOneOffTrade();
    },
    [buildCurrentTradeSurfacePath, navigateDeskView, navigateToTradePath, setTradeActionError, startFreshOneOffTrade, startFreshRecurringOrder]
  );

  const openLimitOrderFromSwapPair = useCallback(() => {
    const prefill = resolveSwapLimitPrefill({
      inputMode: swapActionMode,
      sellTokenSelection: swapSellTokenSelection,
      buyTokenSelection: swapBuyTokenSelection,
      sellAmountInput: '',
      buyAmountInput: ''
    });
    startFreshOneOffTrade();
    setTradeOfferTokenSelection(prefill.offerTokenSelection as TradeTokenPresetKey);
    setTradeRequestTokenSelection(prefill.requestTokenSelection as TradeTokenPresetKey);
    setTradeOfferCustomTokenAddress('');
    setTradeRequestCustomTokenAddress('');
  }, [
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    startFreshOneOffTrade,
    swapActionMode,
    swapBuyTokenSelection,
    swapSellTokenSelection
  ]);

  return {
    activeTradeMode,
    openLimitOrderFromSwapPair,
    openTradeEntryMode
  };
}
