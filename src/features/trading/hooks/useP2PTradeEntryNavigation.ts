import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import type { OtcSwapInputMode } from '../../../lib/otcSwapQuote';
import { resolveSwapLimitPrefill } from '../../../lib/otcSwapUi';
import type { TradeCreateMode } from '../components/P2PTradingPage.helpers';
import type { TradeEntryMode, TradePageView } from './useP2PTradeRoute';

type UseP2PTradeEntryNavigationArgs = {
  navigateDeskView: (path: '/otc' | '/otc/agent' | '/otc/desk' | '/otc/limit' | '/otc/orders') => void;
  hasTradeDraft: boolean;
  isEntryBlocked: () => boolean;
  onPrefillMarketPair: () => void;
  routeTradeMode?: TradeEntryMode;
  routeView: TradePageView;
  setTradeActionError: (message: string) => void;
  setTradeCreateMode: Dispatch<SetStateAction<TradeCreateMode>>;
  setTradeOfferCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeOfferTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setTradeRequestCustomTokenAddress: Dispatch<SetStateAction<string>>;
  setTradeRequestTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  startFreshOneOffTrade: () => void;
  swapActionMode: OtcSwapInputMode;
  swapBuyTokenSelection: TradeTokenPresetKey;
  swapSellTokenSelection: TradeTokenPresetKey;
};

export default function useP2PTradeEntryNavigation({
  navigateDeskView,
  hasTradeDraft,
  isEntryBlocked,
  onPrefillMarketPair,
  routeTradeMode,
  routeView,
  setTradeActionError,
  setTradeCreateMode,
  setTradeOfferCustomTokenAddress,
  setTradeOfferTokenSelection,
  setTradeRequestCustomTokenAddress,
  setTradeRequestTokenSelection,
  startFreshOneOffTrade,
  swapActionMode,
  swapBuyTokenSelection,
  swapSellTokenSelection
}: UseP2PTradeEntryNavigationArgs) {
  const activeTradeMode: TradeEntryMode = routeView === 'create' ? 'limit' : 'swap';

  const navigateTradeView = useCallback((path: '/otc' | '/otc/agent' | '/otc/desk' | '/otc/limit' | '/otc/orders') => {
    if (path === '/otc/limit' && isEntryBlocked()) return;
    if (path === '/otc/limit' && routeView !== 'create' && routeView !== 'counter' && !hasTradeDraft) {
      setTradeOfferTokenSelection(swapSellTokenSelection);
      setTradeRequestTokenSelection(swapBuyTokenSelection);
      onPrefillMarketPair();
    }
    navigateDeskView(path);
  }, [hasTradeDraft, isEntryBlocked, navigateDeskView, onPrefillMarketPair, routeView, setTradeOfferTokenSelection,
    setTradeRequestTokenSelection, swapBuyTokenSelection, swapSellTokenSelection]);

  useEffect(() => {
    if (routeView !== 'create') {
      return;
    }
    setTradeCreateMode((current) => current === 'one-off' ? current : 'one-off');
    if (routeTradeMode === 'recurring') setTradeActionError('Recurring orders are not supported in this App.');
  }, [routeTradeMode, routeView, setTradeActionError, setTradeCreateMode]);

  const openTradeEntryMode = useCallback(
    (mode: TradeEntryMode) => {
      if (mode !== 'swap' && isEntryBlocked()) return;
      setTradeActionError('');
      if (mode === 'swap') {
        navigateDeskView('/otc');
        return;
      }
      if (mode === 'recurring') {
        setTradeActionError('Recurring orders are not supported in this App.');
        return;
      }
      startFreshOneOffTrade();
    },
    [isEntryBlocked, navigateDeskView, setTradeActionError, startFreshOneOffTrade]
  );

  const openLimitOrderFromSwapPair = useCallback(() => {
    if (isEntryBlocked()) return;
    const prefill = resolveSwapLimitPrefill({
      inputMode: swapActionMode,
      sellTokenSelection: swapSellTokenSelection,
      buyTokenSelection: swapBuyTokenSelection,
      sellAmountInput: '',
      buyAmountInput: ''
    });
    startFreshOneOffTrade();
    onPrefillMarketPair();
    setTradeOfferTokenSelection(prefill.offerTokenSelection as TradeTokenPresetKey);
    setTradeRequestTokenSelection(prefill.requestTokenSelection as TradeTokenPresetKey);
    setTradeOfferCustomTokenAddress('');
    setTradeRequestCustomTokenAddress('');
  }, [
    isEntryBlocked,
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    onPrefillMarketPair,
    startFreshOneOffTrade,
    swapActionMode,
    swapBuyTokenSelection,
    swapSellTokenSelection
  ]);

  return {
    activeTradeMode,
    navigateTradeView,
    openLimitOrderFromSwapPair,
    openTradeEntryMode
  };
}
