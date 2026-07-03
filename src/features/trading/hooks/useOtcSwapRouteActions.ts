import { useCallback, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react';
import { buildTradeSnapshotKey } from '../../../lib/appShared';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import type { OtcSwapInputMode } from '../../../lib/otcSwapQuote';
import { resolveSwapTokenFlip } from '../../../lib/otcSwapUi';
import { resolveTradeLinkInput } from './useP2PTradeRoute';
import type { TerminalReturnSurface } from '../components/P2PTradingPage.helpers';

type UseOtcSwapRouteActionsArgs = {
  lastAppliedSwapPinnedTradeKeyRef: MutableRefObject<string>;
  navigateToTradePath: (path: string) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  resetSwapLinkedOrder: () => void;
  routeView: string;
  setDetailTradeError: Dispatch<SetStateAction<string>>;
  setEmptyTerminalDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedMyTradeDetailKey: Dispatch<SetStateAction<string>>;
  setSwapActionMode: Dispatch<SetStateAction<OtcSwapInputMode>>;
  setSwapBuyAmountInput: Dispatch<SetStateAction<string>>;
  setSwapBuyTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setSwapInputMode: Dispatch<SetStateAction<OtcSwapInputMode>>;
  setSwapOrderLinkError: Dispatch<SetStateAction<string>>;
  setSwapOrderLinkInput: Dispatch<SetStateAction<string>>;
  setSwapPinnedTradeKey: Dispatch<SetStateAction<string>>;
  setSwapSellAmountInput: Dispatch<SetStateAction<string>>;
  setSwapSellTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setTradeActionError: Dispatch<SetStateAction<string>>;
  swapActionMode: OtcSwapInputMode;
  swapBuyAmountInput: string;
  swapBuyTokenSelection: TradeTokenPresetKey;
  swapOrderLinkError: string;
  swapOrderLinkInput: string;
  swapSellAmountInput: string;
  swapSellTokenSelection: TradeTokenPresetKey;
  terminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
};

export default function useOtcSwapRouteActions({
  lastAppliedSwapPinnedTradeKeyRef,
  navigateToTradePath,
  openTrade,
  resetSwapLinkedOrder,
  routeView,
  setDetailTradeError,
  setEmptyTerminalDrawerOpen,
  setSelectedMyTradeDetailKey,
  setSwapActionMode,
  setSwapBuyAmountInput,
  setSwapBuyTokenSelection,
  setSwapInputMode,
  setSwapOrderLinkError,
  setSwapOrderLinkInput,
  setSwapPinnedTradeKey,
  setSwapSellAmountInput,
  setSwapSellTokenSelection,
  setTradeActionError,
  swapActionMode,
  swapBuyAmountInput,
  swapBuyTokenSelection,
  swapOrderLinkError,
  swapOrderLinkInput,
  swapSellAmountInput,
  swapSellTokenSelection,
  terminalReturnSurfaceRef
}: UseOtcSwapRouteActionsArgs) {
  const openSwapOrderFromInput = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const parsedLink = resolveTradeLinkInput(swapOrderLinkInput);
      if (!parsedLink) {
        setSwapOrderLinkError(swapOrderLinkInput.trim() ? 'Paste a valid offer link, code, or id.' : '');
        return;
      }

      setSwapOrderLinkError('');
      setTradeActionError('');
      setDetailTradeError('');
      setEmptyTerminalDrawerOpen(false);
      setSelectedMyTradeDetailKey('');
      terminalReturnSurfaceRef.current = 'swap';
      setSwapActionMode('sell');
      setSwapInputMode('sell');
      setSwapSellAmountInput('');
      setSwapBuyAmountInput('');
      lastAppliedSwapPinnedTradeKeyRef.current = '';
      setSwapPinnedTradeKey(buildTradeSnapshotKey(parsedLink.tradeId, parsedLink.escrowContract));
      openTrade(parsedLink.tradeId, parsedLink.accessSecret, parsedLink.escrowContract);
    },
    [
      lastAppliedSwapPinnedTradeKeyRef,
      openTrade,
      setDetailTradeError,
      setEmptyTerminalDrawerOpen,
      setSelectedMyTradeDetailKey,
      setSwapActionMode,
      setSwapBuyAmountInput,
      setSwapInputMode,
      setSwapOrderLinkError,
      setSwapPinnedTradeKey,
      setSwapSellAmountInput,
      setTradeActionError,
      swapOrderLinkInput,
      terminalReturnSurfaceRef
    ]
  );

  const clearSwapPinnedOrder = useCallback(() => {
    resetSwapLinkedOrder();
    if (routeView === 'trade' && terminalReturnSurfaceRef.current === 'swap') {
      navigateToTradePath('/otc');
    }
  }, [navigateToTradePath, resetSwapLinkedOrder, routeView, terminalReturnSurfaceRef]);

  const updateSwapOrderLinkInput = useCallback((value: string) => {
    setSwapOrderLinkInput(value);
    if (swapOrderLinkError) {
      setSwapOrderLinkError('');
    }
  }, [setSwapOrderLinkError, setSwapOrderLinkInput, swapOrderLinkError]);

  const flipSwapTokens = useCallback(() => {
    const nextState = resolveSwapTokenFlip({
      inputMode: swapActionMode,
      sellTokenSelection: swapSellTokenSelection,
      buyTokenSelection: swapBuyTokenSelection,
      sellAmountInput: swapSellAmountInput,
      buyAmountInput: swapBuyAmountInput
    });
    setSwapSellTokenSelection(nextState.sellTokenSelection as TradeTokenPresetKey);
    setSwapBuyTokenSelection(nextState.buyTokenSelection as TradeTokenPresetKey);
    setSwapSellAmountInput(nextState.sellAmountInput);
    setSwapBuyAmountInput(nextState.buyAmountInput);
    setSwapInputMode(nextState.inputMode);
  }, [
    setSwapBuyAmountInput,
    setSwapBuyTokenSelection,
    setSwapInputMode,
    setSwapSellAmountInput,
    setSwapSellTokenSelection,
    swapActionMode,
    swapBuyAmountInput,
    swapBuyTokenSelection,
    swapSellAmountInput,
    swapSellTokenSelection
  ]);

  return {
    clearSwapPinnedOrder,
    flipSwapTokens,
    openSwapOrderFromInput,
    updateSwapOrderLinkInput
  };
}
