import { useCallback, type MutableRefObject } from 'react';
import {
  COTI_NETWORK,
  isWalletAddress,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  type ResolvedTradeToken,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import type {
  CarbonPairReferenceDisplay,
  CarbonPriceAsset
} from '../../../lib/carbonMarketPrice';
import type { CombinedWalletAssetBalance } from '../../../lib/walletFunds';
import { buildTradeComposerAssetBalanceKey } from '../../../lib/tradeComposer';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import {
  getOtcSwapSourceLabel,
  type OtcSwapInputMode,
  type OtcSwapQuoteCandidate
} from '../../../lib/otcSwapQuote';
import {
  rememberPendingOtcSwapIntent,
  type OtcSwapIntent
} from '../../../lib/otcSwapIntent';
import {
  buildOtcSwapActionSummary,
  formatOtcSwapAvailabilityLabel,
  formatOtcSwapMarketDirectionLabel,
  formatOtcSwapPrice,
  resolveVisibleOtcSwapPriceRatioDisplay
} from '../../../lib/otcSwapUi';
import type { TradeFillActionOptions } from './useP2PTradeActions';
import { formatExactTokenAmountInput } from '../components/P2PTradingPage.helpers';

type ComposerCombinedBalance = Pick<
  CombinedWalletAssetBalance,
  'availableLabel' | 'splitLabel'
>;

type CarbonReferenceContext = {
  label: string | null;
  basisLabel: string | null;
  title: string | null;
  baseSymbol: string;
  quoteSymbol: string;
  price: number | null;
  usedPublicCounterpart: boolean;
  sourcePair: string;
  carbonPair: string;
} | null;

type UseOtcSwapReviewStateArgs = {
  activeTerminalSwapIntentRef: MutableRefObject<OtcSwapIntent | null>;
  combinedBalanceByAssetKey: Record<string, ComposerCombinedBalance>;
  fillRecurringOrderSide: (
    snapshot: TradeSnapshot,
    side: 'buy' | 'sell',
    amountInputOverride?: string,
    options?: TradeFillActionOptions
  ) => Promise<void>;
  getCarbonReferenceContext: (
    baseAsset?: CarbonPriceAsset | null,
    quoteAsset?: CarbonPriceAsset | null,
    inverted?: boolean
  ) => CarbonReferenceContext;
  getCarbonReferenceDisplay: (
    baseAsset?: CarbonPriceAsset | null,
    quoteAsset?: CarbonPriceAsset | null,
    inverted?: boolean
  ) => CarbonPairReferenceDisplay | null;
  lastAppliedSwapPinnedTradeKeyRef: MutableRefObject<string>;
  openTradeSnapshot: (snapshot: TradeSnapshot) => void;
  partialFillTrade: (
    snapshot: TradeSnapshot,
    amountInput: string,
    options?: TradeFillActionOptions
  ) => Promise<void>;
  processingRecurringAction: string;
  processingTradeActionId: string;
  setSwapPinnedTradeKey: (key: string) => void;
  swapActionMode: OtcSwapInputMode;
  swapBestQuote: OtcSwapQuoteCandidate | null;
  swapBuyToken: ResolvedTradeToken | null;
  swapBuyTokenKey: string;
  swapBuyTokenSelection: TradeTokenPresetKey;
  swapDisplayBaseToken: ResolvedTradeToken | null;
  swapDisplayQuoteToken: ResolvedTradeToken | null;
  swapInputAmountWei: bigint;
  swapInputMode: OtcSwapInputMode;
  swapPinnedTrade: TradeSnapshot | null;
  swapPriceDisplayInverted: boolean;
  swapSellToken: ResolvedTradeToken | null;
  swapSellTokenKey: string;
  swapSellTokenSelection: TradeTokenPresetKey;
};

const buildSwapVerifyUrl = (
  token?: ResolvedTradeToken | null,
  selection?: TradeTokenPresetKey
): string | undefined => {
  const tokenAddress = token?.tokenAddress ?? (selection && isWalletAddress(selection) ? selection : '');
  return tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/address/${tokenAddress}` : undefined;
};

export default function useOtcSwapReviewState({
  activeTerminalSwapIntentRef,
  combinedBalanceByAssetKey,
  fillRecurringOrderSide,
  getCarbonReferenceContext,
  getCarbonReferenceDisplay,
  lastAppliedSwapPinnedTradeKeyRef,
  openTradeSnapshot,
  partialFillTrade,
  processingRecurringAction,
  processingTradeActionId,
  setSwapPinnedTradeKey,
  swapActionMode,
  swapBestQuote,
  swapBuyToken,
  swapBuyTokenKey,
  swapBuyTokenSelection,
  swapDisplayBaseToken,
  swapDisplayQuoteToken,
  swapInputAmountWei,
  swapInputMode,
  swapPinnedTrade,
  swapPriceDisplayInverted,
  swapSellToken,
  swapSellTokenKey,
  swapSellTokenSelection
}: UseOtcSwapReviewStateArgs) {
  const swapSellBalance = swapSellToken
    ? combinedBalanceByAssetKey[buildTradeComposerAssetBalanceKey(swapSellToken)]
    : undefined;
  const swapSellBalanceLabel =
    swapSellBalance?.availableLabel ??
    (swapSellToken ? `Available -- ${swapSellToken.symbol}` : 'Available --');
  const swapSellBalanceTitle = swapSellBalance?.splitLabel ?? swapSellBalanceLabel;
  const swapSameTokenSelected = Boolean(swapSellTokenKey && swapSellTokenKey === swapBuyTokenKey);
  const swapDisplayQuote = swapBestQuote;
  const swapPriceRatioDisplay = resolveVisibleOtcSwapPriceRatioDisplay(
    swapBestQuote,
    swapActionMode,
    swapPriceDisplayInverted
  );
  const swapDisplayPriceRatioDisplay = resolveVisibleOtcSwapPriceRatioDisplay(
    swapDisplayQuote,
    swapActionMode,
    swapPriceDisplayInverted
  );
  const swapCarbonReference = getCarbonReferenceDisplay(
    swapDisplayBaseToken,
    swapDisplayQuoteToken,
    swapPriceDisplayInverted
  );
  const swapCarbonReferenceContext = getCarbonReferenceContext(
    swapDisplayBaseToken,
    swapDisplayQuoteToken,
    swapPriceDisplayInverted
  );
  const swapChainWhisperMarketLabel = swapDisplayPriceRatioDisplay
    ? formatOtcSwapMarketDirectionLabel(swapActionMode, swapDisplayPriceRatioDisplay)
    : '--';
  const formatSwapAvailability = useCallback(
    (quote?: OtcSwapQuoteCandidate | null): string =>
      formatOtcSwapAvailabilityLabel(quote, swapInputMode, swapInputAmountWei, 6),
    [swapInputAmountWei, swapInputMode]
  );
  const buildSwapActionSummary = useCallback(
    (quote: OtcSwapQuoteCandidate) => buildOtcSwapActionSummary({
      availabilityLabel: formatSwapAvailability(quote),
      buyToken: swapBuyToken,
      priceLabel: formatOtcSwapPrice(quote, swapBestQuote, swapPriceRatioDisplay),
      quote,
      sellToken: swapSellToken,
      sourceLabel: getOtcSwapSourceLabel(quote.sourceType)
    }),
    [formatSwapAvailability, swapBestQuote, swapBuyToken, swapPriceRatioDisplay, swapSellToken]
  );
  const swapSellVerifyUrl = buildSwapVerifyUrl(swapSellToken, swapSellTokenSelection);
  const swapBuyVerifyUrl = buildSwapVerifyUrl(swapBuyToken, swapBuyTokenSelection);
  const buildSwapQuoteIntent = useCallback(
    (quote: OtcSwapQuoteCandidate): OtcSwapIntent | null => {
      if (!swapSellToken || !swapBuyToken || swapInputAmountWei <= 0n) {
        return null;
      }
      return {
        version: 1,
        tradeKey: quote.tradeKey,
        tradeId: quote.tradeId,
        escrowContract: quote.escrowContract,
        inputMode: swapInputMode,
        sellTokenKey: swapSellTokenKey,
        sellTokenSymbol: swapSellToken.symbol,
        sellTokenDecimals: swapSellToken.decimals,
        buyTokenKey: swapBuyTokenKey,
        buyTokenSymbol: swapBuyToken.symbol,
        buyTokenDecimals: swapBuyToken.decimals,
        requestedSellAmountWei: quote.estimatedSellAmountWei.toString(),
        requestedBuyAmountWei: quote.estimatedBuyAmountWei.toString(),
        terminalInputAmountWei: quote.terminalPrefill.amountWei.toString(),
        terminalInput: quote.terminalPrefill.kind === 'standard'
          ? {
              kind: 'standard',
              inputSide: quote.terminalPrefill.inputSide
            }
          : {
              kind: 'recurring',
              displayAction: quote.terminalPrefill.displayAction,
              fillSide: quote.terminalPrefill.fillSide
            },
        privateLiquidity: quote.availability.kind === 'terminal',
        timestamp: Date.now()
      };
    },
    [swapBuyToken, swapBuyTokenKey, swapInputAmountWei, swapInputMode, swapSellToken, swapSellTokenKey]
  );
  const rememberSwapQuoteIntent = useCallback(
    (quote: OtcSwapQuoteCandidate): OtcSwapIntent | null => {
      const intent = buildSwapQuoteIntent(quote);
      if (!intent) {
        return null;
      }
      rememberPendingOtcSwapIntent(intent);
      activeTerminalSwapIntentRef.current = intent;
      return intent;
    },
    [activeTerminalSwapIntentRef, buildSwapQuoteIntent]
  );
  const openSwapCurrentOrderInTerminal = useCallback(() => {
    const quote = swapBestQuote;
    if (quote) {
      rememberSwapQuoteIntent(quote);
      lastAppliedSwapPinnedTradeKeyRef.current = '';
      setSwapPinnedTradeKey(getSnapshotKey(quote.trade));
      openTradeSnapshot(quote.trade);
      return;
    }
    if (swapPinnedTrade) {
      openTradeSnapshot(swapPinnedTrade);
    }
  }, [
    lastAppliedSwapPinnedTradeKeyRef,
    openTradeSnapshot,
    rememberSwapQuoteIntent,
    setSwapPinnedTradeKey,
    swapBestQuote,
    swapPinnedTrade
  ]);
  const executeSwapQuote = useCallback(async () => {
    const quote = swapBestQuote;
    if (!quote || !swapSellToken || !swapBuyToken || swapInputAmountWei <= 0n || swapSameTokenSelected) {
      return;
    }
    const intent = rememberSwapQuoteIntent(quote);
    if (!intent) {
      return;
    }
    const confirmButtonLabel = swapActionMode === 'buy' ? `Buy ${swapBuyToken.symbol}` : `Sell ${swapSellToken.symbol}`;
    const confirmationOptions: TradeFillActionOptions = {
      actionLabel: 'swap',
      confirmButtonLabel,
      confirmMessage:
        quote.availability.kind === 'terminal'
          ? 'Review this swap. Private liquidity is checked while signing.'
          : 'Review this swap before the wallet approval.',
      confirmTitle: 'Review swap',
      confirmationPolicy: 'always',
      openAfterAction: false,
      rememberTerminalReturn: false,
      tradeSummary: buildSwapActionSummary(quote)
    };

    if (quote.terminalPrefill.kind === 'standard') {
      await partialFillTrade(
        quote.trade,
        formatExactTokenAmountInput(quote.estimatedSellAmountWei, swapSellToken.decimals),
        confirmationOptions
      );
      return;
    }

    const recurring = quote.trade.recurringOrder;
    if (!recurring) {
      return;
    }
    const inputDecimals =
      quote.terminalPrefill.fillSide === 'buy' ? recurring.baseAsset.decimals : recurring.quoteAsset.decimals;
    await fillRecurringOrderSide(
      quote.trade,
      quote.terminalPrefill.fillSide,
      formatExactTokenAmountInput(quote.terminalPrefill.amountWei, inputDecimals),
      confirmationOptions
    );
  }, [
    buildSwapActionSummary,
    fillRecurringOrderSide,
    partialFillTrade,
    rememberSwapQuoteIntent,
    swapActionMode,
    swapBestQuote,
    swapBuyToken,
    swapInputAmountWei,
    swapSameTokenSelected,
    swapSellToken
  ]);
  const swapActionProcessing = Boolean(
    swapBestQuote &&
      (processingTradeActionId === swapBestQuote.tradeKey ||
        (swapBestQuote.terminalPrefill.kind === 'recurring' &&
          processingRecurringAction === `${swapBestQuote.tradeKey}:${swapBestQuote.terminalPrefill.fillSide}`))
  );
  const swapReviewDisabled = !swapBestQuote || swapInputAmountWei <= 0n || swapSameTokenSelected || swapActionProcessing;
  const swapReviewLabel =
    swapActionProcessing
      ? 'Processing...'
      : swapInputAmountWei <= 0n
      ? 'Enter amount'
      : swapSameTokenSelected
        ? 'Choose different tokens'
        : !swapBestQuote
          ? 'No order found'
          : swapActionMode === 'buy'
            ? `Buy ${swapBuyToken?.symbol ?? 'token'}`
            : `Sell ${swapSellToken?.symbol ?? 'token'}`;

  return {
    executeSwapQuote,
    formatSwapAvailability,
    openSwapCurrentOrderInTerminal,
    swapBuyVerifyUrl,
    swapCarbonReference,
    swapCarbonReferenceContext,
    swapChainWhisperMarketLabel,
    swapDisplayQuote,
    swapReviewDisabled,
    swapReviewLabel,
    swapSellBalanceLabel,
    swapSellBalanceTitle,
    swapSellVerifyUrl
  };
}
