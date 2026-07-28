import { useCallback, useMemo, useRef, type FormEvent, type MutableRefObject } from 'react';
import {
  fetchCarbonPairReference,
  type CarbonPairReference,
  type CarbonPriceAsset
} from '../../../lib/carbonMarketPrice';
import {
  formatTokenAmount,
  isWalletAddress,
  parseTokenAmountInput,
  TRADE_ESCROW_CONTRACT_ADDRESS,
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
  buildTradeAgentOpenedOrderContext,
  buildTradeAgentOrderReviewContext,
  createTradeAgentPaymentQuote,
  getTradeAgentPreflightError,
  getTradeAgentPromptTokenMentions,
  isTradeAgentTerminalPaymentError,
  recoverTradeAgentRequest,
  runTradeAgentRequest,
  type TradeAgentActionType,
  type TradeAgentFeeQuote,
  type TradeAgentKnownToken,
  type TradeAgentNormalizationOptions,
  type TradeAgentResponse,
  type TradeAgentResponseAction
} from '../../../lib/tradeAgent';
import {
  buildTradeAgentRecoveryMessage,
  doesTradeAgentPaymentRetryMatch,
  hashTradeAgentPaymentRequest,
  orchestrateTradeAgentPayment,
  readTradeAgentPaymentRetry,
  type TradeAgentPaymentRequest,
  type TradeAgentPaymentRetryRecord,
  type TradeAgentSafeContext
} from '../../../lib/tradeAgentPayment';
import { transferWalletFundAsset } from '../../../lib/walletFunds';
import type { TradeEntryMode } from './useP2PTradeRoute';
import {
  type TerminalReturnSurface,
  type TradeAgentChatMessage,
  type TradeSigner,
  type TradeVisibility
} from '../components/P2PTradingPage.helpers';
import type { TradeAgentPanelMode } from '../components/TradeAgentPanel';

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

export const selectBestExecutableTradeAgentQuote = (
  candidates: Array<OtcSwapQuoteCandidate | null>
): OtcSwapQuoteCandidate | null =>
  candidates
    .filter(
      (candidate): candidate is OtcSwapQuoteCandidate =>
        Boolean(candidate?.complete && candidate.availability.kind === 'known')
    )
    .sort((left, right) =>
      left.price === right.price
        ? left.tradeId - right.tradeId
        : left.price < right.price
          ? -1
          : 1
    )[0] ?? null;

export const resolveTradeAgentOpenOrderSnapshot = (
  action: TradeAgentResponseAction,
  trades: Array<TradeSnapshot | null>
): TradeSnapshot | null => {
  if (action.type !== 'open_order' || !action.tradeId) {
    return null;
  }

  const actionEscrowKey = action.escrowContract?.trim().toLowerCase() ?? '';
  if (!actionEscrowKey) {
    return null;
  }
  return trades.find(
    (trade): trade is TradeSnapshot =>
      trade !== null &&
      trade.tradeId === action.tradeId &&
      (trade.escrowContract ?? TRADE_ESCROW_CONTRACT_ADDRESS).toLowerCase() === actionEscrowKey
  ) ?? null;
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
  openTradeSnapshot: (snapshot: TradeSnapshot, accessSecret?: string) => void;
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
  setTradeAgentPanelMode: (mode: TradeAgentPanelMode) => void;
  setTradeAgentPrompt: (prompt: string) => void;
  setTradeAgentRetryPaymentRequestId: (requestId: string) => void;
  setTradeAgentRetryPaymentTxHash: (txHash: string) => void;
  setTradeAgentStatus: (status: string) => void;
  setTradeOfferAmountInput: (value: string) => void;
  setTradeOfferTokenSelection: (value: TradeTokenPresetKey) => void;
  setTradeHidePrivateLiquidity: (value: boolean) => void;
  setTradePriceInput: (value: string) => void;
  setTradeRequestAmountInput: (value: string) => void;
  setTradeRequestTokenSelection: (value: TradeTokenPresetKey) => void;
  setTradeVisibility: (value: TradeVisibility) => void;
  setDirectTradeRecipient: (value: string) => void;
  setRecurringAddBuyBudgetInput: (value: string) => void;
  setRecurringAddSellInventoryInput: (value: string) => void;
  setRecurringBuyPriceInput: (value: string) => void;
  setRecurringHidePrivateAmounts: (value: boolean) => void;
  setRecurringSellPriceInput: (value: string) => void;
  startFreshOneOffTrade: () => void;
  startFreshRecurringOrder: () => void;
  swapActionMode: OtcSwapInputMode;
  swapBuyToken: ResolvedTradeToken | null;
  swapCarbonReferenceContext: CarbonReferenceContext;
  swapChainWhisperMarketLabel: string;
  swapDisplayQuote: OtcSwapQuoteCandidate | null;
  swapSellToken: ResolvedTradeToken | null;
  terminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
  tradeAgentAction: TradeAgentActionType;
  tradeAgentExplicitContext: unknown | null;
  tradeAgentPrompt: string;
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
  openTradeSnapshot,
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
  setTradeAgentPanelMode,
  setTradeAgentPrompt,
  setTradeAgentRetryPaymentRequestId,
  setTradeAgentRetryPaymentTxHash,
  setTradeAgentStatus,
  setTradeOfferAmountInput,
  setTradeOfferTokenSelection,
  setTradeHidePrivateLiquidity,
  setTradePriceInput,
  setTradeRequestAmountInput,
  setTradeRequestTokenSelection,
  setTradeVisibility,
  setDirectTradeRecipient,
  setRecurringAddBuyBudgetInput,
  setRecurringAddSellInventoryInput,
  setRecurringBuyPriceInput,
  setRecurringHidePrivateAmounts,
  setRecurringSellPriceInput,
  startFreshOneOffTrade,
  startFreshRecurringOrder,
  swapActionMode,
  swapBuyToken,
  swapCarbonReferenceContext,
  swapChainWhisperMarketLabel,
  swapDisplayQuote,
  swapSellToken,
  terminalReturnSurfaceRef,
  tradeAgentAction,
  tradeAgentExplicitContext,
  tradeAgentPrompt,
  tradeComposerModel,
  walletAddress
}: UseP2PTradeAgentActionsArgs) {
  const tradeAgentRequestInFlightRef = useRef(false);
  const tradeAgentPaidRequestRef = useRef<TradeAgentPaymentRetryRecord | null>(null);
  const tradeAgentContext = useMemo(
    () => ({
      clientSurface: 'otc-agent' as const,
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
        ? buildTradeAgentOpenedOrderContext(detailTrade)
        : tradeAgentExplicitContext &&
            typeof tradeAgentExplicitContext === 'object' &&
            'openedOrder' in tradeAgentExplicitContext
          ? (tradeAgentExplicitContext as { openedOrder?: unknown }).openedOrder ?? null
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
    () => ({
      clientSurface: 'otc-agent' as const,
      openedOrder: null,
      requestCompleteness: 'partial' as const,
      selectedPair: null,
      surface: routeSurfaceView ?? routeView
    }),
    [routeSurfaceView, routeView]
  );

  const askAgentAboutOrder = useCallback(
    (snapshot: TradeSnapshot) => {
      const id = snapshot.recurringOrder?.orderId ?? snapshot.tradeId;
      const source = snapshot.recurringOrder ? 'Recurring OTC' : 'One-off OTC';
      terminalReturnSurfaceRef.current = 'agent';
      saveMobileDeskScroll('agent');
      setEmptyTerminalDrawerOpen(false);
      setSelectedMyTradeDetailKey('');
      setTradeAgentPanelMode('trade');
      setTradeAgentAction('explain_order');
      setTradeAgentExplicitContext({
        openedOrder: buildTradeAgentOpenedOrderContext(snapshot)
      });
      setTradeAgentPrompt(`Explain ${source} #${id}. Keep it short and point out what I should review.`);
      setTradeAgentStatus('Order loaded.');
      appendTradeAgentStatusMessage(`${source} #${id} loaded.`);
      navigateToTradePath('/otc/agent');
    },
    [
      appendTradeAgentStatusMessage,
      navigateToTradePath,
      saveMobileDeskScroll,
      setEmptyTerminalDrawerOpen,
      setSelectedMyTradeDetailKey,
      setTradeAgentAction,
      setTradeAgentExplicitContext,
      setTradeAgentPanelMode,
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

  const tradeAgentKnownTokens = useMemo<TradeAgentKnownToken[]>(
    () =>
      tradeComposerModel.tradeTokenOptions.flatMap((option) => {
        const selection = option.value as TradeTokenPresetKey;
        const resolved = resolveTradeAgentTokenFromSelection(selection);
        if (!resolved || option.value.startsWith('custom')) {
          return [];
        }
        return [{
          reference: resolved.symbol,
          aliases: [option.value, option.symbol ?? '', option.label].filter(Boolean),
          decimals: resolved.decimals
        }];
      }),
    [resolveTradeAgentTokenFromSelection, tradeComposerModel.tradeTokenOptions]
  );

  const trustedTradeAgentOrders = useMemo<TradeAgentNormalizationOptions['trustedOrders']>(
    () =>
      [detailTrade, ...publicOpenTrades, ...myTrades].flatMap((trade) => {
        if (!trade) {
          return [];
        }
        const summary = buildTradeAgentOpenedOrderContext(trade);
        return summary
          ? [{ tradeId: summary.tradeId, escrowContract: summary.escrowContract }]
          : [];
      }),
    [detailTrade, myTrades, publicOpenTrades]
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
      if (buyIndex === -1 && sellIndex === -1) {
        return null;
      }
      const inputMode: OtcSwapInputMode =
        sellIndex !== -1 && (buyIndex === -1 || sellIndex < buyIndex) ? 'sell' : 'buy';
      const sellSelection = resolveTradeAgentTokenSelection(inputMode === 'sell' ? firstSymbol : secondSymbol);
      const buySelection = resolveTradeAgentTokenSelection(inputMode === 'sell' ? secondSymbol : firstSymbol);
      const sellToken = resolveTradeAgentTokenFromSelection(sellSelection);
      const buyToken = resolveTradeAgentTokenFromSelection(buySelection);
      if (!sellToken || !buyToken || getOtcSwapAssetKey(sellToken) === getOtcSwapAssetKey(buyToken)) {
        return null;
      }
      const requestedAmountInput = prompt.match(/\b(?:buy|sell)\s+(\d+(?:\.\d+)?)/i)?.[1] ?? '';
      const requestedInputToken = inputMode === 'sell' ? sellToken : buyToken;
      const requestedAmountWei = requestedAmountInput
        ? parseTokenAmountInput(requestedAmountInput, requestedInputToken.decimals)
        : null;
      const hasRequestedAmount = requestedAmountWei !== null && requestedAmountWei > 0n;
      const comparisonAmountWei =
        (hasRequestedAmount ? requestedAmountWei : parseTokenAmountInput('1', requestedInputToken.decimals));
      if (comparisonAmountWei === null || comparisonAmountWei <= 0n) {
        return null;
      }

      const priceReferenceQuote = quoteBestSingleOtcSwap({
        includePrivateOtcQuotes: true,
        inputAmountWei: comparisonAmountWei,
        inputMode,
        trades: publicOpenTrades,
        sellToken,
        buyToken
      }).best;
      const executableQuote = hasRequestedAmount
        ? selectBestExecutableTradeAgentQuote(
            publicOpenTrades.map((trade) =>
              quoteBestSingleOtcSwap({
                includePrivateOtcQuotes: true,
                inputAmountWei: comparisonAmountWei,
                inputMode,
                trades: [trade],
                sellToken,
                buyToken
              }).best
            )
          )
        : null;
      const comparisonQuote = executableQuote ?? priceReferenceQuote;
      const displayBaseToken = inputMode === 'buy' ? buyToken : sellToken;
      const displayQuoteToken = inputMode === 'buy' ? sellToken : buyToken;
      const priceDisplay = resolveVisibleOtcSwapPriceRatioDisplay(comparisonQuote, inputMode, false);
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
            carbonReference: {
              ...getCarbonReferenceContext(displayBaseToken, displayQuoteToken, false, carbonReference),
              comparisonRole: 'market-reference',
              rankingEligible: false
            },
            chainwhisperPrice: priceDisplay ? formatOtcSwapMarketDirectionLabel(inputMode, priceDisplay) : '--',
            bestOrder: comparisonQuote
              ? {
                  id: comparisonQuote.tradeId,
                  escrowContract: comparisonQuote.escrowContract,
                  source: getOtcSwapSourceLabel(comparisonQuote.sourceType),
                  availability: formatOtcSwapAvailabilityLabel(
                    comparisonQuote,
                    inputMode,
                    comparisonAmountWei,
                    6
                  ),
                  comparisonRole: executableQuote
                    ? 'verified-executable-for-amount'
                    : 'price-reference',
                  completeForRequestedAmount: hasRequestedAmount ? Boolean(executableQuote) : null,
                  rankingEligible: Boolean(executableQuote)
                }
              : null,
            requestedAmount: hasRequestedAmount
              ? {
                  amount: requestedAmountInput,
                  mode: inputMode,
                  symbol: requestedInputToken.symbol
                }
              : null,
            comparisonRule: hasRequestedAmount
              ? 'Use the supplied amount only for a visible-liquidity executability check. Keep Carbon and Uniswap as separate market references unless their same-chain liquidity is explicitly verified.'
              : 'Compare current display-basis prices only. No amount was requested, so do not rank liquidity or claim a best executable route. Keep Carbon and Uniswap as separate market references.'
          }
        },
        quote: hasRequestedAmount ? executableQuote : priceReferenceQuote
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
        const cachedOrder = resolveTradeAgentOpenOrderSnapshot(action, [detailTrade, ...publicOpenTrades, ...myTrades]);
        if (!cachedOrder) {
          setTradeAgentError('That order is no longer available in your trusted order list. Refresh Orders and try again.');
          return;
        }
        appendTradeAgentStatusMessage('Order opened.');
        openTradeSnapshot(cachedOrder);
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
        setTradeVisibility(action.accessType);
        setDirectTradeRecipient('');
        setTradeHidePrivateLiquidity(action.amountVisibility === 'private-hidden');
        appendTradeAgentStatusMessage('Draft opened in Limit.');
        navigateToTradePath(buildCurrentTradeSurfacePath('create', 'limit'));
        return;
      }

      if (action.type === 'prefill_recurring') {
        const baseSelection = resolveTradeAgentTokenSelection(action.baseToken);
        const quoteSelection = resolveTradeAgentTokenSelection(action.quoteToken);
        startFreshRecurringOrder();
        if (baseSelection) {
          setTradeOfferTokenSelection(baseSelection);
        }
        if (quoteSelection && quoteSelection !== baseSelection) {
          setTradeRequestTokenSelection(quoteSelection);
        }
        setRecurringBuyPriceInput(action.buyPrice);
        setRecurringSellPriceInput(action.sellPrice);
        setRecurringAddBuyBudgetInput(action.buyLiquidity);
        setRecurringAddSellInventoryInput(action.sellLiquidity);
        setRecurringHidePrivateAmounts(action.amountVisibility === 'private-hidden');
        appendTradeAgentStatusMessage('Draft opened in Recurring.');
        navigateToTradePath(buildCurrentTradeSurfacePath('create', 'recurring'));
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

      if (action.type === 'prefill_message') {
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
      openTradeSnapshot,
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
      setDirectTradeRecipient,
      setRecurringAddBuyBudgetInput,
      setRecurringAddSellInventoryInput,
      setRecurringBuyPriceInput,
      setRecurringHidePrivateAmounts,
      setRecurringSellPriceInput,
      setTradeHidePrivateLiquidity,
      setTradeOfferAmountInput,
      setTradeOfferTokenSelection,
      setTradePriceInput,
      setTradeRequestAmountInput,
      setTradeRequestTokenSelection,
      setTradeVisibility,
      startFreshOneOffTrade,
      startFreshRecurringOrder,
      terminalReturnSurfaceRef
    ]
  );

  const submitTradeAgentRequest = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (tradeAgentRequestInFlightRef.current) {
        return;
      }
      const prompt = tradeAgentPrompt.trim();
      const storedRetryCandidate =
        tradeAgentPaidRequestRef.current ?? readTradeAgentPaymentRetry();
      const exactRetryCandidate =
        storedRetryCandidate &&
        storedRetryCandidate.context.clientSurface === 'otc-agent' &&
        storedRetryCandidate.action === tradeAgentAction &&
        storedRetryCandidate.prompt === prompt &&
        (!walletAddress ||
          storedRetryCandidate.payerAddress.toLowerCase() === walletAddress.toLowerCase())
          ? storedRetryCandidate
          : null;
      const preflightContext =
        exactRetryCandidate
          ? exactRetryCandidate.context
          : tradeAgentAction === 'review_orders'
          ? buildTradeAgentOrderReviewContext(myTrades)
          : tradeAgentAction === 'find_price' ||
              tradeAgentAction === 'draft_limit' ||
              tradeAgentAction === 'draft_recurring'
            ? buildPromptOnlyTradeAgentContext()
            : tradeAgentContext;
      const preflightError = getTradeAgentPreflightError({
        action: tradeAgentAction,
        context: preflightContext,
        knownTokens: tradeAgentKnownTokens,
        prompt
      });
      if (preflightError) {
        setTradeAgentError(preflightError);
        return;
      }
      if (!walletAddress) {
        setTradeAgentError('Connect your ChainWhisper account before using the Trade Agent.');
        return;
      }

      tradeAgentRequestInFlightRef.current = true;
      setTradeAgentLoading(true);
      setTradeAgentError('');
      let currentPaymentRequest: TradeAgentPaymentRequest | null = null;
      try {
        const promptQuoteContext =
          tradeAgentAction === 'find_price' && !exactRetryCandidate
            ? await resolveTradeAgentPromptQuoteContext(prompt)
            : null;
        const requestContext =
          exactRetryCandidate?.context ?? promptQuoteContext?.context ?? preflightContext;
        const requestQuote = promptQuoteContext?.quote ?? null;
        const paymentRequest: TradeAgentPaymentRequest = {
          action: tradeAgentAction,
          context: requestContext as TradeAgentSafeContext,
          payerAddress: walletAddress,
          prompt
        };
        currentPaymentRequest = paymentRequest;
        const storedRetry = exactRetryCandidate ?? readTradeAgentPaymentRetry();
        const expectedRequestHash = await hashTradeAgentPaymentRequest(paymentRequest);
        const retryingExactRequest = Boolean(
          storedRetry &&
          storedRetry.context.clientSurface === 'otc-agent' &&
          doesTradeAgentPaymentRetryMatch(storedRetry, paymentRequest) &&
          storedRetry.requestHash === expectedRequestHash
        );
        if (retryingExactRequest && storedRetry) {
          setTradeAgentRetryPaymentTxHash(storedRetry.paymentTxHash);
          setTradeAgentRetryPaymentRequestId(storedRetry.requestId);
          appendTradeAgentStatusMessage('Retrying the exact paid request without another WISP transfer.');
        } else {
          appendTradeAgentMessage({
            role: 'user',
            title: 'You',
            text: prompt
          });
        }
        const normalization = {
          knownTokens: tradeAgentKnownTokens,
          trustedOrders: trustedTradeAgentOrders
        };
        let paymentSigner: TradeSigner | null = null;
        const getPaymentSigner = async (): Promise<TradeSigner> => {
          paymentSigner ??= await getTradeSigner(false);
          return paymentSigner;
        };
        let recoveryChecked = false;
        const result = await orchestrateTradeAgentPayment<TradeAgentResponse>({
          request: paymentRequest,
          retryRecord: tradeAgentPaidRequestRef.current,
          onPaidRequest: (record, persistence) => {
            tradeAgentPaidRequestRef.current = record;
            setTradeAgentRetryPaymentTxHash(record.paymentTxHash);
            setTradeAgentRetryPaymentRequestId(record.requestId);
            if (!persistence.persisted) {
              setTradeAgentStatus('Payment confirmed. Keep this page open while the request finishes.');
            }
          },
          callbacks: {
            createQuote: async (request) => {
              setTradeAgentStatus('Getting the final WISP quote...');
              const quote = await createTradeAgentPaymentQuote(request);
              setTradeAgentFeeQuote(quote);
              return quote;
            },
            signAuthorization: async ({ authorizationMessage }) => {
              setTradeAgentStatus('Authorizing this exact request...');
              return (await getPaymentSigner()).signMessage(authorizationMessage);
            },
            transferPayment: async ({ quote }) => {
              const feeAmountWei = BigInt(quote.feeAmountWei);
              setTradeAgentStatus(
                `Paying ${formatTokenAmount(feeAmountWei, quote.feeTokenDecimals, 4)} WISP...`
              );
              return transferWalletFundAsset({
                amountWei: feeAmountWei,
                asset: {
                  kind: 'erc20',
                  tokenAddress: quote.feeTokenAddress,
                  symbol: 'WISP',
                  decimals: quote.feeTokenDecimals
                },
                signer: await getPaymentSigner(),
                toAddress: quote.feeRecipient
              });
            },
            runRequest: async (record: TradeAgentPaymentRetryRecord) => {
              if (retryingExactRequest && !recoveryChecked) {
                recoveryChecked = true;
                setTradeAgentStatus('Recovering the previous Agent response...');
                const signedAt = new Date().toISOString();
                const signature = await (await getPaymentSigner()).signMessage(
                  buildTradeAgentRecoveryMessage({
                    payerAddress: record.payerAddress,
                    requestId: record.requestId,
                    signedAt
                  })
                );
                try {
                  const recovered = await recoverTradeAgentRequest({
                    normalization,
                    payerAddress: record.payerAddress,
                    requestId: record.requestId,
                    signature,
                    signedAt
                  });
                  if (recovered.status !== 'retryable') {
                    return recovered;
                  }
                } catch {
                  setTradeAgentStatus('Recovery was unavailable. Retrying the exact paid request...');
                }
              }
              setTradeAgentStatus(
                retryingExactRequest
                  ? 'Retrying with the previous WISP payment...'
                  : 'Asking Trade Agent...'
              );
              return runTradeAgentRequest({
                action: record.action,
                context: record.context,
                normalization,
                payerAddress: record.payerAddress,
                payerSignature: record.payerSignature,
                paymentTxHash: record.paymentTxHash,
                prompt: record.prompt,
                quoteToken: record.quoteToken,
                requestHash: record.requestHash,
                requestId: record.requestId
              });
            }
          }
        });
        if (result.status === 'processing') {
          const retryInSeconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 2_000) / 1_000));
          const message = `Payment confirmed. This request is still processing; retry in about ${retryInSeconds} seconds without paying again.`;
          setTradeAgentStatus(message);
          appendTradeAgentStatusMessage(message);
          return;
        }
        if (result.status === 'retryable') {
          const message =
            result.error || 'The provider did not finish this exact request. You can retry without paying again.';
          setTradeAgentError(message);
          setTradeAgentStatus('You can retry without paying again.');
          appendTradeAgentMessage({
            role: 'assistant',
            title: 'Trade Agent',
            text: `${message} You can retry without paying again.`
          });
          return;
        }
        const response = result.response;
        tradeAgentPaidRequestRef.current = null;
        const actions =
          tradeAgentAction === 'find_price' && requestQuote
            ? [
                {
                  type: 'open_order' as const,
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
        setTradeAgentPrompt('');
        setTradeAgentStatus('Ready.');
        if (paymentSigner) {
          refreshAllTradingBalances({ reason: 'trade-action', signer: paymentSigner, silent: true }).catch(() => {});
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Trade Agent request failed.';
        setTradeAgentError(message);
        const storedRetry =
          tradeAgentPaidRequestRef.current ?? readTradeAgentPaymentRetry();
        const paidRetry = Boolean(
          storedRetry &&
          currentPaymentRequest &&
          doesTradeAgentPaymentRetryMatch(storedRetry, currentPaymentRequest)
        );
        const needsManualReview = paidRetry && isTradeAgentTerminalPaymentError(error);
        const retryCopy = needsManualReview
          ? 'No additional payment will be requested. Keep the payment transaction for manual WISP refund review.'
          : paidRetry
            ? 'You can retry without paying again.'
            : 'Request failed before payment.';
        setTradeAgentStatus(paidRetry ? retryCopy : '');
        appendTradeAgentMessage({
          role: 'assistant',
          title: 'Trade Agent',
          text: `${message} ${retryCopy}`
        });
      } finally {
        tradeAgentRequestInFlightRef.current = false;
        setTradeAgentLoading(false);
      }
    },
    [
      appendTradeAgentMessage,
      appendTradeAgentStatusMessage,
      buildPromptOnlyTradeAgentContext,
      getTradeSigner,
      myTrades,
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
      tradeAgentKnownTokens,
      tradeAgentPrompt,
      trustedTradeAgentOrders,
      walletAddress
    ]
  );

  return {
    applyTradeAgentAction,
    askAgentAboutOrder,
    submitTradeAgentRequest
  };
}
