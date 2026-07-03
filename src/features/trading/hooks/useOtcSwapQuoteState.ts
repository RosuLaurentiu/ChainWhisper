import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react';
import {
  parseTokenAmountInput,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  type ResolvedTradeToken,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import { buildTradeComposerAssetBalanceKey } from '../../../lib/tradeComposer';
import {
  quoteBestSingleOtcSwap,
  type OtcSwapInputMode
} from '../../../lib/otcSwapQuote';
import {
  getOtcSwapLinkedActionModes,
  resolveOtcSwapLinkedActionMode,
  resolveSwapActionModeChange
} from '../../../lib/otcSwapUi';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import {
  formatCompactTokenAmountInput,
  type TerminalReturnSurface
} from '../components/P2PTradingPage.helpers';

type SwapPairSelections = {
  sellSelection: TradeTokenPresetKey;
  buySelection: TradeTokenPresetKey;
};

type UseOtcSwapQuoteStateArgs = {
  detailTrade: TradeSnapshot | null;
  lastAppliedSwapPinnedTradeKeyRef: MutableRefObject<string>;
  lastSyncedRouteSwapTradeKeyRef: MutableRefObject<string>;
  myTrades: TradeSnapshot[];
  publicOpenTrades: TradeSnapshot[];
  resolveSwapPairSelectionsForTrade: (
    snapshot: TradeSnapshot,
    mode?: OtcSwapInputMode
  ) => SwapPairSelections | null;
  routeView: string;
  setSwapActionMode: Dispatch<SetStateAction<OtcSwapInputMode>>;
  setSwapBuyAmountInput: Dispatch<SetStateAction<string>>;
  setSwapBuyTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  setSwapInputMode: Dispatch<SetStateAction<OtcSwapInputMode>>;
  setSwapPinnedTradeKey: Dispatch<SetStateAction<string>>;
  setSwapPriceDisplayInverted: Dispatch<SetStateAction<boolean>>;
  setSwapSellAmountInput: Dispatch<SetStateAction<string>>;
  setSwapSellTokenSelection: Dispatch<SetStateAction<TradeTokenPresetKey>>;
  swapActionMode: OtcSwapInputMode;
  swapBuyAmountInput: string;
  swapBuyToken: ResolvedTradeToken | null;
  swapBuyTokenSelection: TradeTokenPresetKey;
  swapInputMode: OtcSwapInputMode;
  swapPinnedTradeKey: string;
  swapSellAmountInput: string;
  swapSellToken: ResolvedTradeToken | null;
  swapSellTokenSelection: TradeTokenPresetKey;
  terminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
};

export default function useOtcSwapQuoteState({
  detailTrade,
  lastAppliedSwapPinnedTradeKeyRef,
  lastSyncedRouteSwapTradeKeyRef,
  myTrades,
  publicOpenTrades,
  resolveSwapPairSelectionsForTrade,
  routeView,
  setSwapActionMode,
  setSwapBuyAmountInput,
  setSwapBuyTokenSelection,
  setSwapInputMode,
  setSwapPinnedTradeKey,
  setSwapPriceDisplayInverted,
  setSwapSellAmountInput,
  setSwapSellTokenSelection,
  swapActionMode,
  swapBuyAmountInput,
  swapBuyToken,
  swapBuyTokenSelection,
  swapInputMode,
  swapPinnedTradeKey,
  swapSellAmountInput,
  swapSellToken,
  swapSellTokenSelection,
  terminalReturnSurfaceRef
}: UseOtcSwapQuoteStateArgs) {
  const swapPinnedTrade = useMemo(() => {
    if (!swapPinnedTradeKey) {
      return null;
    }
    if (detailTrade && getSnapshotKey(detailTrade) === swapPinnedTradeKey) {
      return detailTrade;
    }
    return (
      publicOpenTrades.find((trade) => getSnapshotKey(trade) === swapPinnedTradeKey) ??
      myTrades.find((trade) => getSnapshotKey(trade) === swapPinnedTradeKey) ??
      null
    );
  }, [detailTrade, myTrades, publicOpenTrades, swapPinnedTradeKey]);

  useEffect(() => {
    if (routeView !== 'trade' || terminalReturnSurfaceRef.current !== 'swap' || !detailTrade) {
      lastSyncedRouteSwapTradeKeyRef.current = '';
      return;
    }

    const detailKey = getSnapshotKey(detailTrade);
    if (lastSyncedRouteSwapTradeKeyRef.current === detailKey) {
      return;
    }

    lastSyncedRouteSwapTradeKeyRef.current = detailKey;
    lastAppliedSwapPinnedTradeKeyRef.current = '';
    setSwapPinnedTradeKey(detailKey);
  }, [
    detailTrade,
    lastAppliedSwapPinnedTradeKeyRef,
    lastSyncedRouteSwapTradeKeyRef,
    routeView,
    setSwapPinnedTradeKey,
    terminalReturnSurfaceRef
  ]);

  const swapInitialLinkedActionModes = useMemo(
    () => getOtcSwapLinkedActionModes(swapPinnedTrade),
    [swapPinnedTrade]
  );
  const swapPinnedOneOffOrder = Boolean(swapPinnedTrade && !swapPinnedTrade.recurringOrder);

  const changeSwapActionMode = useCallback(
    (nextMode: OtcSwapInputMode) => {
      if (nextMode === swapActionMode) {
        return;
      }
      const nextState = resolveSwapActionModeChange(
        {
          inputMode: swapActionMode,
          sellTokenSelection: swapSellTokenSelection,
          buyTokenSelection: swapBuyTokenSelection,
          sellAmountInput: swapSellAmountInput,
          buyAmountInput: swapBuyAmountInput
        },
        nextMode
      );

      setSwapActionMode(nextState.inputMode);
      setSwapInputMode(nextState.inputMode);
      setSwapSellTokenSelection(nextState.sellTokenSelection as TradeTokenPresetKey);
      setSwapBuyTokenSelection(nextState.buyTokenSelection as TradeTokenPresetKey);
      setSwapSellAmountInput(nextState.sellAmountInput);
      setSwapBuyAmountInput(nextState.buyAmountInput);
    },
    [
      setSwapActionMode,
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
    ]
  );

  const swapQuoteTrades = useMemo(
    () => (swapPinnedTrade ? [swapPinnedTrade] : publicOpenTrades),
    [publicOpenTrades, swapPinnedTrade]
  );

  const swapInputAmountWei = useMemo(() => {
    const inputToken = swapInputMode === 'sell' ? swapSellToken : swapBuyToken;
    const inputValue = swapInputMode === 'sell' ? swapSellAmountInput : swapBuyAmountInput;
    return inputToken ? parseTokenAmountInput(inputValue, inputToken.decimals) ?? 0n : 0n;
  }, [swapBuyAmountInput, swapBuyToken, swapInputMode, swapSellAmountInput, swapSellToken]);

  const swapDisplayBaseToken = swapActionMode === 'buy' ? swapBuyToken : swapSellToken;
  const swapDisplayQuoteToken = swapActionMode === 'buy' ? swapSellToken : swapBuyToken;
  const swapDisplayBaseKey = swapDisplayBaseToken
    ? buildTradeComposerAssetBalanceKey(swapDisplayBaseToken)
    : '';
  const swapDisplayQuoteKey = swapDisplayQuoteToken
    ? buildTradeComposerAssetBalanceKey(swapDisplayQuoteToken)
    : '';

  useEffect(() => {
    setSwapPriceDisplayInverted(false);
  }, [setSwapPriceDisplayInverted, swapActionMode, swapDisplayBaseKey, swapDisplayQuoteKey]);

  const swapMarketSellQuote = useMemo(
    () =>
      swapDisplayBaseToken && swapDisplayQuoteToken
        ? quoteBestSingleOtcSwap({
            includePrivateOtcQuotes: true,
            trades: swapQuoteTrades,
            sellToken: swapDisplayBaseToken,
            buyToken: swapDisplayQuoteToken,
            inputMode: swapActionMode === 'sell' ? swapInputMode : 'sell',
            inputAmountWei: swapActionMode === 'sell' ? swapInputAmountWei : 0n
          })
        : { best: null, compatibleCount: 0, otherCompatibleCount: 0 },
    [
      swapDisplayBaseToken,
      swapDisplayQuoteToken,
      swapActionMode,
      swapInputAmountWei,
      swapInputMode,
      swapQuoteTrades
    ]
  );

  const swapMarketBuyQuote = useMemo(
    () =>
      swapDisplayBaseToken && swapDisplayQuoteToken
        ? quoteBestSingleOtcSwap({
            includePrivateOtcQuotes: true,
            trades: swapQuoteTrades,
            sellToken: swapDisplayQuoteToken,
            buyToken: swapDisplayBaseToken,
            inputMode: swapActionMode === 'buy' ? swapInputMode : 'buy',
            inputAmountWei: swapActionMode === 'buy' ? swapInputAmountWei : 0n
          })
        : { best: null, compatibleCount: 0, otherCompatibleCount: 0 },
    [
      swapDisplayBaseToken,
      swapDisplayQuoteToken,
      swapActionMode,
      swapInputAmountWei,
      swapInputMode,
      swapQuoteTrades
    ]
  );

  const swapBestQuote = swapActionMode === 'buy' ? swapMarketBuyQuote.best : swapMarketSellQuote.best;

  const swapLinkedActionModes = useMemo(
    () =>
      swapPinnedTrade
        ? {
            sell: swapMarketSellQuote.compatibleCount > 0,
            buy: swapMarketBuyQuote.compatibleCount > 0
          }
        : { sell: true, buy: true },
    [swapMarketBuyQuote.compatibleCount, swapMarketSellQuote.compatibleCount, swapPinnedTrade]
  );

  useEffect(() => {
    if (!swapPinnedTrade || !swapPinnedTradeKey) {
      lastAppliedSwapPinnedTradeKeyRef.current = '';
      return;
    }
    const linkedActionMode = swapPinnedOneOffOrder
      ? 'sell'
      : resolveOtcSwapLinkedActionMode(swapActionMode, swapInitialLinkedActionModes);
    const linkedApplyKey = swapPinnedOneOffOrder
      ? `${swapPinnedTradeKey}:one-off`
      : `${swapPinnedTradeKey}:${linkedActionMode}`;
    if (lastAppliedSwapPinnedTradeKeyRef.current === linkedApplyKey) {
      return;
    }
    lastAppliedSwapPinnedTradeKeyRef.current = linkedApplyKey;
    const linkedPair = resolveSwapPairSelectionsForTrade(swapPinnedTrade, linkedActionMode);
    if (!linkedPair) {
      return;
    }
    if (swapActionMode !== linkedActionMode) {
      setSwapActionMode(linkedActionMode);
    }
    setSwapSellTokenSelection((current) => (current === linkedPair.sellSelection ? current : linkedPair.sellSelection));
    setSwapBuyTokenSelection((current) => (current === linkedPair.buySelection ? current : linkedPair.buySelection));
    setSwapSellAmountInput('');
    setSwapBuyAmountInput('');
    setSwapInputMode(linkedActionMode);
  }, [
    lastAppliedSwapPinnedTradeKeyRef,
    resolveSwapPairSelectionsForTrade,
    setSwapActionMode,
    setSwapBuyAmountInput,
    setSwapBuyTokenSelection,
    setSwapInputMode,
    setSwapSellAmountInput,
    setSwapSellTokenSelection,
    swapActionMode,
    swapInitialLinkedActionModes,
    swapPinnedOneOffOrder,
    swapPinnedTrade,
    swapPinnedTradeKey
  ]);

  useEffect(() => {
    if (!swapPinnedTrade) {
      return;
    }
    const nextMode = resolveOtcSwapLinkedActionMode(swapActionMode, swapLinkedActionModes);
    if (nextMode !== swapActionMode && swapLinkedActionModes[nextMode]) {
      changeSwapActionMode(nextMode);
    }
  }, [changeSwapActionMode, swapActionMode, swapLinkedActionModes, swapPinnedTrade]);

  useEffect(() => {
    if (!swapSellToken || !swapBuyToken) {
      return;
    }
    if (!swapBestQuote) {
      if (swapInputMode === 'sell' && swapBuyAmountInput) {
        setSwapBuyAmountInput('');
      }
      if (swapInputMode === 'buy' && swapSellAmountInput) {
        setSwapSellAmountInput('');
      }
      return;
    }
    if (swapInputMode === 'sell') {
      const nextBuyInput = formatCompactTokenAmountInput(swapBestQuote.estimatedBuyAmountWei, swapBuyToken.decimals);
      setSwapBuyAmountInput((current) => (current === nextBuyInput ? current : nextBuyInput));
      return;
    }
    const nextSellInput = formatCompactTokenAmountInput(swapBestQuote.estimatedSellAmountWei, swapSellToken.decimals);
    setSwapSellAmountInput((current) => (current === nextSellInput ? current : nextSellInput));
  }, [
    setSwapBuyAmountInput,
    setSwapSellAmountInput,
    swapBestQuote,
    swapBuyAmountInput,
    swapBuyToken,
    swapInputMode,
    swapSellAmountInput,
    swapSellToken
  ]);

  return {
    changeSwapActionMode,
    swapBestQuote,
    swapDisplayBaseKey,
    swapDisplayBaseToken,
    swapDisplayQuoteKey,
    swapDisplayQuoteToken,
    swapInputAmountWei,
    swapInitialLinkedActionModes,
    swapLinkedActionModes,
    swapMarketBuyQuote,
    swapMarketSellQuote,
    swapPinnedOneOffOrder,
    swapPinnedTrade,
    swapQuoteTrades
  };
}
