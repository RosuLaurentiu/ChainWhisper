import { useCallback, useMemo, type FormEvent, type MutableRefObject } from 'react';
import {
  fetchCarbonPairReference,
  type CarbonPairReference,
  type CarbonPriceAsset
} from '../../../lib/carbonMarketPrice';
import {
  formatTokenAmount,
  isWalletAddress,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  type ResolvedTradeToken,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import {
  resolveSelectedTradeToken,
  type TradeComposerModel
} from '../../../lib/tradeComposer';
import {
  getOtcSwapAssetKey,
  getOtcSwapSourceLabel,
  quoteBestSingleOtcSwap,
  type OtcSwapInputMode,
  type OtcSwapQuoteCandidate
} from '../../../lib/otcSwapQuote';
import {
  formatOtcSwapAvailabilityLabel,
  formatOtcSwapMarketDirectionLabel,
  resolveVisibleOtcSwapPriceRatioDisplay
} from '../../../lib/otcSwapUi';
import {
  fetchTradeAgentFeeQuote,
  getTradeAgentPromptTokenMentions,
  runTradeAgentRequest,
  type TradeAgentActionType,
  type TradeAgentFeeQuote,
  type TradeAgentResponseAction
} from '../../../lib/tradeAgent';
import { getTradeDisplayTerms } from '../../../lib/p2pTradeView';
import { transferWalletFundAsset } from '../../../lib/walletFunds';
import type { TradeEntryMode } from './useP2PTradeRoute';
import {
  writeTradeAgentRetryPayment,
  type TerminalReturnSurface,
  type TradeAgentChatMessage,
  type TradeSigner
} from '../components/P2PTradingPage.helpers';

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

type PromptQuoteContext = {
  context: unknown;
  quote: OtcSwapQuoteCandidate | null;
};

type UseP2PTradeAgentActionsArgs = {
  appendTradeAgentMessage: (message: Omit<TradeAgentChatMessage, 'id'>) => void;
  appendTradeAgentStatusMessage: (text: string) => void;
  beginCounterTrade: (snapshot: TradeSnapshot) => void;
  buildCurrentTradeSurfacePath: (view: 'create', tradeMode?: TradeEntryMode) => string;
  detailTrade: TradeSnapshot | null;
  formatSwapAvailability: (quote?: OtcSwapQuoteCandidate | null) => string;
  getCarbonReferenceContext: (
    baseAsset?: CarbonPriceAsset | null,
    quoteAsset?: CarbonPriceAsset | null,
    inverted?: boolean,
    referenceOverride?: CarbonPairReference | null
  ) => CarbonReferenceContext;
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  myTrades: TradeSnapshot[];
  navigateDeskView: (path: '/otc') => void;
  navigateToTradePath: (path: string) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  publicOpenTrades: TradeSnapshot[];
  refreshAllTradingBalances: (options: { reason: 'trade-action'; signer: TradeSigner; silent: boolean }) => Promise<void>;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  routeSurfaceView: string | null;
  routeView: string;
  saveMobileDeskScroll: (surface: TerminalReturnSurface) => void;
  setEmptyTerminalDrawerOpen: (open: boolean) => void;
  setSelectedMyTradeDetailKey: (key: string) => void;
  setSwapActionMode: (mode: OtcSwapInputMode) => void;
  setSwapBuyAmountInput: (value: string) => void;
  setSwapBuyTokenSelection: (value: TradeTokenPresetKey) => void;
  setSwapInputMode: (mode: OtcSwapInputMode) => void;
  setSwapSellAmountInput: (value: string) => void;
  setSwapSellTokenSelection: (value: TradeTokenPresetKey) => void;
  setTradeAgentAction: (action: TradeAgentActionType) => void;
  setTradeAgentError: (message: string) => void;
  setTradeAgentExplicitContext: (context: unknown | null) => void;
  setTradeAgentFeeQuote: (quote: TradeAgentFeeQuote | null) => void;
  setTradeAgentLoading: (loading: boolean) => void;
  setTradeAgentPrompt: (prompt: string) => void;
  setTradeAgentRetryPaymentRequestId: (requestId: string) => void;
  setTradeAgentRetryPaymentTxHash: (txHash: string) => void;
  setTradeAgentStatus: (status: string) => void;
  setTradeOfferAmountInput: (value: string) => void;
  setTradeOfferTokenSelection: (value: TradeTokenPresetKey) => void;
  setTradePriceInput: (value: string) => void;
  setTradeRequestAmountInput: (value: string) => void;
  setTradeRequestTokenSelection: (value: TradeTokenPresetKey) => void;
  startFreshOneOffTrade: () => void;
  swapActionMode: OtcSwapInputMode;
  swapBuyToken: ResolvedTradeToken | null;
  swapCarbonReferenceContext: CarbonReferenceContext;
  swapChainWhisperMarketLabel: string;
  swapDisplayQuote: OtcSwapQuoteCandidate | null;
  swapSellToken: ResolvedTradeToken | null;
  terminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
  tradeAgentAction: TradeAgentActionType;
  tradeAgentExplicitContext: unknown | null;
  tradeAgentFeeQuote: TradeAgentFeeQuote | null;
  tradeAgentPrompt: string;
  tradeAgentRetryPaymentRequestId: string;
  tradeAgentRetryPaymentTxHash: string;
  tradeComposerModel: TradeComposerModel;
  walletAddress: string;
};

export default function useP2PTradeAgentActions({
  appendTradeAgentMessage,
  appendTradeAgentStatusMessage,
  beginCounterTrade,
  buildCurrentTradeSurfacePath,
  detailTrade,
  formatSwapAvailability,
  getCarbonReferenceContext,
  getTradeSigner,
  myTrades,
  navigateDeskView,
  navigateToTradePath,
  openTrade,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  publicOpenTrades,
  refreshAllTradingBalances,
  rewardTokenDecimals,
  rewardTokenSymbol,
  routeSurfaceView,
  routeView,
  saveMobileDeskScroll,
  setEmptyTerminalDrawerOpen,
  setSelectedMyTradeDetailKey,
  setSwapActionMode,
  setSwapBuyAmountInput,
  setSwapBuyTokenSelection,
  setSwapInputMode,
  setSwapSellAmountInput,
  setSwapSellTokenSelection,
  setTradeAgentAction,
  setTradeAgentError,
  setTradeAgentExplicitContext,
  setTradeAgentFeeQuote,
  setTradeAgentLoading,
  setTradeAgentPrompt,
  setTradeAgentRetryPaymentRequestId,
  setTradeAgentRetryPaymentTxHash,
  setTradeAgentStatus,
  setTradeOfferAmountInput,
  setTradeOfferTokenSelection,
  setTradePriceInput,
  setTradeRequestAmountInput,
  setTradeRequestTokenSelection,
  startFreshOneOffTrade,
  swapActionMode,
  swapBuyToken,
  swapCarbonReferenceContext,
  swapChainWhisperMarketLabel,
  swapDisplayQuote,
  swapSellToken,
  terminalReturnSurfaceRef,
  tradeAgentAction,
  tradeAgentExplicitContext,
  tradeAgentFeeQuote,
  tradeAgentPrompt,
  tradeAgentRetryPaymentRequestId,
  tradeAgentRetryPaymentTxHash,
  tradeComposerModel,
  walletAddress
}: UseP2PTradeAgentActionsArgs) {
  const tradeAgentContext = useMemo(
    () => ({
      explicit: tradeAgentExplicitContext,
      surface: routeSurfaceView ?? routeView,
      selectedPair: {
        sellToken: swapSellToken ? { symbol: swapSellToken.symbol, kind: swapSellToken.kind } : null,
        buyToken: swapBuyToken ? { symbol: swapBuyToken.symbol, kind: swapBuyToken.kind } : null,
        mode: swapActionMode,
        favorabilityRule:
          swapActionMode === 'buy'
            ? 'Lower quote/base is better when buying the displayed base token.'
            : 'Higher quote/base is better when selling the displayed base token.'
      },
      swap: {
        carbonReference: swapCarbonReferenceContext,
        chainwhisperPrice: swapChainWhisperMarketLabel,
        bestOrder: swapDisplayQuote
          ? {
              id: swapDisplayQuote.tradeId,
              escrowContract: swapDisplayQuote.escrowContract,
              source: getOtcSwapSourceLabel(swapDisplayQuote.sourceType),
              availability: formatSwapAvailability(swapDisplayQuote)
            }
          : null
      },
      openedOrder: detailTrade
        ? {
            id: detailTrade.recurringOrder?.orderId ?? detailTrade.tradeId,
            source: detailTrade.recurringOrder ? 'Recurring OTC' : 'One-off OTC',
            status: detailTrade.status,
            terms: getTradeDisplayTerms(detailTrade)
          }
        : null
    }),
    [
      detailTrade,
      formatSwapAvailability,
      routeSurfaceView,
      routeView,
      swapActionMode,
      swapBuyToken,
      swapCarbonReferenceContext,
      swapChainWhisperMarketLabel,
      swapDisplayQuote,
      swapSellToken,
      tradeAgentExplicitContext
    ]
  );

  const buildPromptOnlyTradeAgentContext = useCallback(
    (includeExplicit = false) => ({
      explicit: includeExplicit ? tradeAgentExplicitContext : null,
      openedOrder: null,
      selectedPair: null,
      surface: routeSurfaceView ?? routeView,
      swap: {
        bestOrder: null,
        carbonReference: null,
        chainwhisperPrice: null
      }
    }),
    [routeSurfaceView, routeView, tradeAgentExplicitContext]
  );

  const askAgentAboutOrder = useCallback(
    (snapshot: TradeSnapshot) => {
      const id = snapshot.recurringOrder?.orderId ?? snapshot.tradeId;
      const source = snapshot.recurringOrder ? 'Recurring OTC' : 'One-off OTC';
      terminalReturnSurfaceRef.current = 'agent';
      saveMobileDeskScroll('agent');
      setEmptyTerminalDrawerOpen(false);
      setSelectedMyTradeDetailKey('');
      setTradeAgentAction('explain_order');
      setTradeAgentExplicitContext({
        openedOrder: {
          escrowContract: snapshot.escrowContract,
          id,
          source,
          status: snapshot.status,
          terms: getTradeDisplayTerms(snapshot)
        }
      });
      setTradeAgentPrompt(`Explain ${source} #${id}. Keep it short and point out what I should review.`);
      setTradeAgentStatus('Order loaded.');
      appendTradeAgentStatusMessage(`${source} #${id} loaded.`);
      if (routeView !== 'trade') {
        openTrade(snapshot.tradeId, undefined, snapshot.escrowContract);
      }
    },
    [
      appendTradeAgentStatusMessage,
      openTrade,
      routeView,
      saveMobileDeskScroll,
      setEmptyTerminalDrawerOpen,
      setSelectedMyTradeDetailKey,
      setTradeAgentAction,
      setTradeAgentExplicitContext,
      setTradeAgentPrompt,
      setTradeAgentStatus,
      terminalReturnSurfaceRef
    ]
  );

  const resolveTradeAgentTokenSelection = useCallback(
    (value?: string): TradeTokenPresetKey | null => {
      const raw = value?.trim().toLowerCase() ?? '';
      if (!raw) {
        return null;
      }
      const match = tradeComposerModel.tradeTokenOptions.find((option) => {
        const optionValues = [option.value, option.symbol, option.label]
          .map((candidate) => candidate?.trim().toLowerCase())
          .filter(Boolean);
        return optionValues.includes(raw);
      });
      return match ? match.value as TradeTokenPresetKey : null;
    },
    [tradeComposerModel.tradeTokenOptions]
  );

  const resolveTradeAgentTokenFromSelection = useCallback(
    (selection: TradeTokenPresetKey | null): ResolvedTradeToken | null =>
      selection
        ? resolveSelectedTradeToken({
            customAddress: isWalletAddress(selection) ? selection : undefined,
            privateRewardTokenDecimals,
            privateRewardTokenSymbol,
            rewardTokenDecimals,
            rewardTokenSymbol,
            selection
          })
        : null,
    [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]
  );

  const resolveTradeAgentPromptQuoteContext = useCallback(
    async (prompt: string): Promise<PromptQuoteContext | null> => {
      const knownSymbols = tradeComposerModel.tradeTokenOptions
        .map((option) => option.symbol)
        .filter((symbol): symbol is string => Boolean(symbol));
      const [firstSymbol, secondSymbol] = getTradeAgentPromptTokenMentions(prompt, knownSymbols);
      if (!firstSymbol || !secondSymbol) {
        return null;
      }

      const lowerPrompt = prompt.toLowerCase();
      const buyIndex = lowerPrompt.indexOf('buy');
      const sellIndex = lowerPrompt.indexOf('sell');
      const inputMode: OtcSwapInputMode =
        sellIndex !== -1 && (buyIndex === -1 || sellIndex < buyIndex) ? 'sell' : 'buy';
      const sellSelection = resolveTradeAgentTokenSelection(inputMode === 'sell' ? firstSymbol : secondSymbol);
      const buySelection = resolveTradeAgentTokenSelection(inputMode === 'sell' ? secondSymbol : firstSymbol);
      const sellToken = resolveTradeAgentTokenFromSelection(sellSelection);
      const buyToken = resolveTradeAgentTokenFromSelection(buySelection);
      if (!sellToken || !buyToken || getOtcSwapAssetKey(sellToken) === getOtcSwapAssetKey(buyToken)) {
        return null;
      }

      const quote = quoteBestSingleOtcSwap({
        includePrivateOtcQuotes: true,
        inputAmountWei: 0n,
        inputMode,
        trades: publicOpenTrades,
        sellToken,
        buyToken
      }).best;
      const displayBaseToken = inputMode === 'buy' ? buyToken : sellToken;
      const displayQuoteToken = inputMode === 'buy' ? sellToken : buyToken;
      const priceDisplay = resolveVisibleOtcSwapPriceRatioDisplay(quote, inputMode, false);
      const carbonReference = await fetchCarbonPairReference({
        baseAsset: displayBaseToken,
        quoteAsset: displayQuoteToken
      });
      return {
        context: {
          ...tradeAgentContext,
          explicit: null,
          openedOrder: null,
          selectedPair: {
            sellToken: { symbol: sellToken.symbol, kind: sellToken.kind },
            buyToken: { symbol: buyToken.symbol, kind: buyToken.kind },
            mode: inputMode,
            source: 'prompt'
          },
          swap: {
            carbonReference: getCarbonReferenceContext(displayBaseToken, displayQuoteToken, false, carbonReference),
            chainwhisperPrice: priceDisplay ? formatOtcSwapMarketDirectionLabel(inputMode, priceDisplay) : '--',
            bestOrder: quote
              ? {
                  id: quote.tradeId,
                  escrowContract: quote.escrowContract,
                  source: getOtcSwapSourceLabel(quote.sourceType),
                  availability: formatOtcSwapAvailabilityLabel(quote, inputMode, 0n, 6)
                }
              : null
          }
        },
        quote
      };
    },
    [
      getCarbonReferenceContext,
      publicOpenTrades,
      resolveTradeAgentTokenFromSelection,
      resolveTradeAgentTokenSelection,
      tradeAgentContext,
      tradeComposerModel.tradeTokenOptions
    ]
  );

  const applyTradeAgentAction = useCallback(
    async (action: TradeAgentResponseAction) => {
      if (action.type === 'open_order' && action.tradeId) {
        appendTradeAgentStatusMessage('Order opened.');
        terminalReturnSurfaceRef.current = 'agent';
        saveMobileDeskScroll('agent');
        setEmptyTerminalDrawerOpen(false);
        openTrade(action.tradeId, action.accessSecret, action.escrowContract);
        return;
      }

      if (action.type === 'prefill_swap') {
        const sellSelection = resolveTradeAgentTokenSelection(action.sellToken);
        const buySelection = resolveTradeAgentTokenSelection(action.buyToken);
        if (sellSelection) {
          setSwapSellTokenSelection(sellSelection);
        }
        if (buySelection && buySelection !== sellSelection) {
          setSwapBuyTokenSelection(buySelection);
        }
        const mode = action.inputMode === 'sell' || action.inputMode === 'buy' ? action.inputMode : 'sell';
        setSwapActionMode(mode);
        setSwapInputMode(mode);
        setSwapSellAmountInput(action.sellAmount ?? '');
        setSwapBuyAmountInput(action.buyAmount ?? '');
        appendTradeAgentStatusMessage('Draft opened in Swap.');
        navigateDeskView('/otc');
        return;
      }

      if (action.type === 'prefill_limit') {
        const sellSelection = resolveTradeAgentTokenSelection(action.sellToken);
        const buySelection = resolveTradeAgentTokenSelection(action.buyToken);
        startFreshOneOffTrade();
        if (sellSelection) {
          setTradeOfferTokenSelection(sellSelection);
        }
        if (buySelection && buySelection !== sellSelection) {
          setTradeRequestTokenSelection(buySelection);
        }
        setTradeOfferAmountInput(action.sellAmount ?? '');
        setTradeRequestAmountInput(action.buyAmount ?? '');
        setTradePriceInput(action.price ?? '');
        appendTradeAgentStatusMessage('Draft opened in Limit.');
        navigateToTradePath(buildCurrentTradeSurfacePath('create', 'limit'));
        return;
      }

      if (action.type === 'prefill_counter') {
        const actionEscrowKey = action.escrowContract?.trim().toLowerCase() ?? '';
        const parentTrade =
          [detailTrade, ...publicOpenTrades, ...myTrades].filter((trade): trade is TradeSnapshot => Boolean(trade)).find(
            (trade) =>
              (!action.tradeId || trade.tradeId === action.tradeId) &&
              (!actionEscrowKey || (trade.escrowContract ?? '').toLowerCase() === actionEscrowKey)
          ) ?? null;
        if (!parentTrade) {
          setTradeAgentError('Open the order first, then use this counter draft.');
          return;
        }
        beginCounterTrade(parentTrade);
        const sellSelection = resolveTradeAgentTokenSelection(action.sellToken);
        const buySelection = resolveTradeAgentTokenSelection(action.buyToken);
        if (sellSelection) {
          setTradeOfferTokenSelection(sellSelection);
        }
        if (buySelection && buySelection !== sellSelection) {
          setTradeRequestTokenSelection(buySelection);
        }
        setTradeOfferAmountInput(action.sellAmount ?? '');
        setTradeRequestAmountInput(action.buyAmount ?? '');
        appendTradeAgentStatusMessage('Counter draft opened.');
        return;
      }

      if (action.message) {
        await navigator.clipboard?.writeText(action.message).catch(() => {});
        appendTradeAgentStatusMessage('Draft copied.');
        setTradeAgentStatus('Draft copied.');
      }
    },
    [
      appendTradeAgentStatusMessage,
      beginCounterTrade,
      buildCurrentTradeSurfacePath,
      detailTrade,
      myTrades,
      navigateDeskView,
      navigateToTradePath,
      openTrade,
      publicOpenTrades,
      resolveTradeAgentTokenSelection,
      saveMobileDeskScroll,
      setEmptyTerminalDrawerOpen,
      setSwapActionMode,
      setSwapBuyAmountInput,
      setSwapBuyTokenSelection,
      setSwapInputMode,
      setSwapSellAmountInput,
      setSwapSellTokenSelection,
      setTradeAgentError,
      setTradeAgentStatus,
      setTradeOfferAmountInput,
      setTradeOfferTokenSelection,
      setTradePriceInput,
      setTradeRequestAmountInput,
      setTradeRequestTokenSelection,
      startFreshOneOffTrade,
      terminalReturnSurfaceRef
    ]
  );

  const submitTradeAgentRequest = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const prompt = tradeAgentPrompt.trim();
      if (!prompt) {
        setTradeAgentError('Enter what you want the Trade Agent to do.');
        return;
      }
      if (!walletAddress) {
        setTradeAgentError('Connect your ChainWhisper account before using the Trade Agent.');
        return;
      }

      setTradeAgentLoading(true);
      setTradeAgentError('');
      appendTradeAgentMessage({
        role: 'user',
        title: 'You',
        text: prompt
      });
      setTradeAgentStatus('Getting WISP fee quote...');
      let paymentTxHash = tradeAgentRetryPaymentTxHash;
      const requestId = tradeAgentRetryPaymentRequestId || crypto.randomUUID();
      try {
        const promptQuoteContext =
          tradeAgentAction === 'find_price' ? await resolveTradeAgentPromptQuoteContext(prompt) : null;
        const requestContext =
          promptQuoteContext?.context ??
          (tradeAgentAction === 'find_price'
            ? buildPromptOnlyTradeAgentContext(false)
            : tradeAgentAction === 'draft_limit'
              ? buildPromptOnlyTradeAgentContext(Boolean(tradeAgentExplicitContext))
              : tradeAgentContext);
        const requestQuote = promptQuoteContext?.quote ?? null;
        const quote = paymentTxHash
          ? tradeAgentFeeQuote ?? await fetchTradeAgentFeeQuote(tradeAgentAction, requestContext, prompt)
          : await fetchTradeAgentFeeQuote(tradeAgentAction, requestContext, prompt);
        setTradeAgentFeeQuote(quote);
        const signer = await getTradeSigner(false);
        if (paymentTxHash) {
          setTradeAgentStatus('Retrying with the previous WISP payment...');
        } else {
          const feeAmountWei = BigInt(quote.feeAmountWei);
          setTradeAgentStatus(`Paying ${formatTokenAmount(feeAmountWei, quote.feeTokenDecimals, 4)} WISP...`);
          paymentTxHash = await transferWalletFundAsset({
            amountWei: feeAmountWei,
            asset: {
              kind: 'erc20',
              tokenAddress: quote.feeTokenAddress,
              symbol: 'WISP',
              decimals: quote.feeTokenDecimals
            },
            signer,
            toAddress: quote.feeRecipient
          });
          setTradeAgentRetryPaymentTxHash(paymentTxHash);
          setTradeAgentRetryPaymentRequestId(requestId);
          writeTradeAgentRetryPayment({ action: tradeAgentAction, prompt, requestId, txHash: paymentTxHash });
        }
        setTradeAgentStatus('Asking Trade Agent...');
        const response = await runTradeAgentRequest({
          action: tradeAgentAction,
          context: requestContext,
          payerAddress: walletAddress,
          paymentTxHash,
          prompt,
          requestId
        });
        const actions =
          tradeAgentAction === 'find_price' && requestQuote
            ? [
                {
                  type: 'open_order' as const,
                  label: 'Open order',
                  tradeId: requestQuote.tradeId,
                  escrowContract: requestQuote.escrowContract
                }
              ]
            : response.actions;
        appendTradeAgentMessage({
          role: 'assistant',
          title: 'Trade Agent',
          text: response.answer,
          warnings: response.warnings,
          actions
        });
        setTradeAgentRetryPaymentTxHash('');
        setTradeAgentRetryPaymentRequestId('');
        writeTradeAgentRetryPayment(null);
        setTradeAgentPrompt('');
        setTradeAgentStatus('Ready.');
        refreshAllTradingBalances({ reason: 'trade-action', signer, silent: true }).catch(() => {});
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Trade Agent request failed.';
        setTradeAgentError(message);
        const retryCopy = paymentTxHash ? 'You can retry without paying again.' : 'Request failed before payment.';
        setTradeAgentStatus(paymentTxHash ? retryCopy : '');
        appendTradeAgentMessage({
          role: 'assistant',
          title: 'Trade Agent',
          text: `${message} ${retryCopy}`
        });
      } finally {
        setTradeAgentLoading(false);
      }
    },
    [
      appendTradeAgentMessage,
      buildPromptOnlyTradeAgentContext,
      getTradeSigner,
      refreshAllTradingBalances,
      resolveTradeAgentPromptQuoteContext,
      setTradeAgentError,
      setTradeAgentFeeQuote,
      setTradeAgentLoading,
      setTradeAgentPrompt,
      setTradeAgentRetryPaymentRequestId,
      setTradeAgentRetryPaymentTxHash,
      setTradeAgentStatus,
      tradeAgentAction,
      tradeAgentContext,
      tradeAgentExplicitContext,
      tradeAgentFeeQuote,
      tradeAgentPrompt,
      tradeAgentRetryPaymentRequestId,
      tradeAgentRetryPaymentTxHash,
      walletAddress
    ]
  );

  return {
    applyTradeAgentAction,
    askAgentAboutOrder,
    submitTradeAgentRequest
  };
}
