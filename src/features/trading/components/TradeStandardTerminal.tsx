import { ArrowRight, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  COTI_NETWORK,
  formatExpiryCountdown,
  formatTradeAssetDisplayText,
  parseTokenAmountInput,
  sanitizeTokenAmountInput,
  shortenAddress,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import type { CarbonPairReferenceDisplay } from '../../../lib/carbonMarketPrice';
import type { P2PActionNoticeSurface } from '../../../lib/p2pActionNotice';
import {
  PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE,
  canCreateCounterOffer,
  canUseWalletAuthorityForDirectAccess,
  getCounterOfferUnavailableReason
} from '../../../lib/tradeCounterSupport';
import { buildTradeTransactionHistoryRows } from '../../../lib/tradeHistory';
import {
  isZeroTradeTakerAddress,
  resolveTradeOrderSummary,
  resolveTradePriceRatioDisplay
} from '../../../lib/tradePerspective';
import {
  buildTradeAssetExplorerUrl,
  canEditPublicTrade,
  formatHiddenFixedPriceTerms,
  formatTradeContractIdLabel,
  formatTradeExpiryParts,
  formatTradeListTerms,
  formatTradeRateText,
  getMakerPrivateProgressSummary,
  getRemainingOfferAmount,
  getRemainingRequestAmount,
  getSnapshotKey,
  getTradeCompletionSummary,
  getTradeContractNamespaceLabel,
  getTradeDisplayTerms,
  getTradeTermsVisibility,
  hasHydratedDirectTradeTerms,
  shouldBlockFillAboveVisibleLiquidity
} from '../../../lib/p2pTradeView';
import {
  SHARE_LABEL,
  UNLISTED_ORDER_LABEL,
  VISIBLE_LIQUIDITY_LABEL,
  buildMakerControlsKey,
  formatDeskPriceSideLabel,
  formatExactTokenAmountInput,
  formatOrderProgressFractionLabel,
  getKnownTermProgressSummary,
  getRevealedHistoryProgressSummary,
  getTradeCounterRelation,
  getTradeLiquidityLabel,
  getTradeSideProgressVerb,
  getVisibleOfferLiquiditySummary,
  parseTokenAmountString,
  quoteRequestAmountForOfferAmount,
  renderCarbonPriceReference,
  resolveRevealedHistoryAssetForSide,
  resolveVisibleHiddenTermAmounts,
  withProgressPaymentFallback,
  type TerminalFillInputSide,
  type TerminalHistoryPanelConfig
} from './P2PTradingPage.helpers';
import { TradeTerminalHistoryMobileControls } from './TradeTerminalHistoryPanel';

type CounterAcceptMode = 'close-related' | 'fill';

type TradeStandardTerminalProps = {
  snapshot: TradeSnapshot;
  routeView: string;
  walletAddress: string;
  walletKey: string;
  onCotiNetwork: boolean;
  lastCopiedKey: string;
  reversedRateTradeIds: Record<string, boolean>;
  expandedMakerControls: Record<string, boolean>;
  terminalFillInputSide: TerminalFillInputSide;
  terminalPayInput: string;
  terminalBuyInput: string;
  processingTradeActionId: string;
  terminalHistorySheetKey: string;
  setTerminalFillInputSide: (side: TerminalFillInputSide) => void;
  setTerminalPayInput: (value: string) => void;
  setTerminalBuyInput: (value: string) => void;
  setTerminalHistorySheetKey: (key: string) => void;
  acceptTrade: (snapshot: TradeSnapshot, counterAcceptMode?: CounterAcceptMode) => Promise<void>;
  askAgentAboutOrder: (snapshot: TradeSnapshot) => void;
  beginCounterTrade: (snapshot: TradeSnapshot) => void;
  beginEditTrade: (snapshot: TradeSnapshot) => void;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  cancelTrade: (snapshot: TradeSnapshot) => Promise<void>;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  declineTrade: (snapshot: TradeSnapshot) => Promise<void>;
  getCarbonReferenceDisplay: (
    baseAsset?: TradeAssetPayload | null,
    quoteAsset?: TradeAssetPayload | null,
    inverted?: boolean
  ) => CarbonPairReferenceDisplay | null;
  getStandardTerminalHistoryConfig: (snapshot: TradeSnapshot) => TerminalHistoryPanelConfig;
  partialFillTrade: (snapshot: TradeSnapshot, amountInput: string) => Promise<void>;
  renderActionNotice: (surface: P2PActionNoticeSurface, tradeKey?: string) => ReactNode;
  renderTradeConversationButton: (snapshot: TradeSnapshot, shareUrl?: string, accessSecret?: string) => ReactNode;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  resolveTerminalAssetBalanceLabel: (asset: TradeAssetPayload, maximumFractionDigits?: number) => string;
  toggleMakerControls: (surface: 'terminal', tradeKey: string) => void;
  toggleTradeRateDirection: (tradeId: number, escrowContract?: string) => void;
};

export default function TradeStandardTerminal({
  snapshot,
  routeView,
  walletAddress,
  walletKey,
  onCotiNetwork,
  lastCopiedKey,
  reversedRateTradeIds,
  expandedMakerControls,
  terminalFillInputSide,
  terminalPayInput,
  terminalBuyInput,
  processingTradeActionId,
  terminalHistorySheetKey,
  setTerminalFillInputSide,
  setTerminalPayInput,
  setTerminalBuyInput,
  setTerminalHistorySheetKey,
  acceptTrade,
  askAgentAboutOrder,
  beginCounterTrade,
  beginEditTrade,
  buildTradeShareUrl,
  cancelTrade,
  copyWithFeedback,
  declineTrade,
  getCarbonReferenceDisplay,
  getStandardTerminalHistoryConfig,
  partialFillTrade,
  renderActionNotice,
  renderTradeConversationButton,
  resolveKnownTradeAccessSecret,
  resolveTerminalAssetBalanceLabel,
  toggleMakerControls,
  toggleTradeRateDirection
}: TradeStandardTerminalProps) {
  const tradeKey = getSnapshotKey(snapshot);
  const displayTerms = getTradeDisplayTerms(snapshot);
  const displayTrade = {
    ...snapshot,
    offer: displayTerms.offer,
    request: displayTerms.request
  };
  const orderSummary = resolveTradeOrderSummary(displayTrade, walletAddress);
  const perspective = orderSummary.perspective;
  const leftSide = orderSummary.primarySide;
  const rightSide = orderSummary.secondarySide;
  const termsVisibility = getTradeTermsVisibility(snapshot);
  const isHiddenLiquidityTerms = termsVisibility === 'hidden-liquidity';
  const isDirectPrivateTerms = termsVisibility === 'direct-private-terms';
  const directTermsHydrated = hasHydratedDirectTradeTerms(snapshot);
  const walletHistoryRows = walletKey ? buildTradeTransactionHistoryRows([snapshot], walletAddress) : [];
  const revealedWalletHistoryRow = walletHistoryRows.find(
    (row) => row.bought.visible && row.sold.visible && row.amountVisibility !== 'private-hidden'
  );
  const hasRevealedWalletHiddenTerms = isHiddenLiquidityTerms && Boolean(revealedWalletHistoryRow);
  const canShowParticipantHiddenTerms =
    isHiddenLiquidityTerms &&
    routeView !== 'public' &&
    (perspective.isParticipant || hasRevealedWalletHiddenTerms);
  const hiddenInitialOfferAmount = parseTokenAmountString(snapshot.makerPrivateProgress?.initialOfferAmount);
  const hiddenRemainingOfferAmount = parseTokenAmountString(snapshot.makerPrivateProgress?.remainingOfferAmount);
  const hiddenOfferUnitAmount = parseTokenAmountString(snapshot.offer.amount);
  const hiddenRequestUnitAmount = parseTokenAmountString(snapshot.request.amount);
  const visibleHiddenTermAmounts = resolveVisibleHiddenTermAmounts({
    initialOfferAmount: hiddenInitialOfferAmount,
    remainingOfferAmount: hiddenRemainingOfferAmount,
    offerUnitAmount: hiddenOfferUnitAmount,
    requestUnitAmount: hiddenRequestUnitAmount
  });
  const canShowParticipantHiddenSize = canShowParticipantHiddenTerms && Boolean(visibleHiddenTermAmounts);
  const getHiddenParticipantTermAsset = (
    asset: TradeAssetPayload,
    role: 'offer' | 'payment'
  ): TradeAssetPayload => {
    if (!visibleHiddenTermAmounts || !canShowParticipantHiddenSize) {
      return asset;
    }
    const amount = role === 'offer' ? visibleHiddenTermAmounts.offerAmount : visibleHiddenTermAmounts.requestAmount;
    return amount > 0n ? { ...asset, amount: amount.toString() } : asset;
  };
  const counterUnavailableReason = getCounterOfferUnavailableReason(snapshot, walletKey);
  const canCounter = canCreateCounterOffer(snapshot, walletKey);
  const showCounterUnavailable =
    !canCounter &&
    walletKey.length > 0 &&
    !perspective.isMaker &&
    snapshot.status === 'open' &&
    counterUnavailableReason === PRIVATE_ORDER_COUNTER_UNAVAILABLE_MESSAGE;
  const canEdit = canEditPublicTrade(snapshot, walletKey);
  const completionSummary = getTradeCompletionSummary(snapshot);
  const makerPrivateProgressSummary = perspective.isMaker ? getMakerPrivateProgressSummary(snapshot) : null;
  const publicLiquidityProgressSummary =
    !isHiddenLiquidityTerms && !(isDirectPrivateTerms && !directTermsHydrated)
      ? getVisibleOfferLiquiditySummary(snapshot)
      : null;
  const revealedWalletProgressSummary =
    snapshot.status === 'open' ? null : getRevealedHistoryProgressSummary(revealedWalletHistoryRow, leftSide, rightSide);
  const knownTermProgressSummary =
    (!isHiddenLiquidityTerms || canShowParticipantHiddenSize) && !(isDirectPrivateTerms && !directTermsHydrated)
      ? getKnownTermProgressSummary(
          isHiddenLiquidityTerms ? getHiddenParticipantTermAsset(leftSide.asset, leftSide.role) : leftSide.asset,
          isHiddenLiquidityTerms ? getHiddenParticipantTermAsset(rightSide.asset, rightSide.role) : rightSide.asset,
          snapshot.status
        )
      : null;
  const terminalOrderProgressSummary =
    withProgressPaymentFallback(
      makerPrivateProgressSummary ?? publicLiquidityProgressSummary ?? revealedWalletProgressSummary ?? knownTermProgressSummary,
      knownTermProgressSummary
    );
  const twoSidedProgressSummary = terminalOrderProgressSummary;
  const twoSidedFilledVerb = getTradeSideProgressVerb(leftSide);
  const twoSidedPaymentFilledVerb = getTradeSideProgressVerb(rightSide);
  const twoSidedRemainingAmount =
    twoSidedProgressSummary?.remainingAmountLabel ?? twoSidedProgressSummary?.remainingLabel ?? '';
  const twoSidedTotalAmount =
    twoSidedProgressSummary?.totalAmountLabel ?? twoSidedProgressSummary?.totalLabel ?? '';
  const twoSidedPaymentRemainingAmount =
    twoSidedProgressSummary?.paymentRemainingAmountLabel ?? twoSidedProgressSummary?.paymentAmountLabel ?? '';
  const twoSidedPaymentTotalAmount = twoSidedProgressSummary?.paymentAmountLabel ?? '';
  const isAcceptedTrade = snapshot.status === 'accepted';
  const getAcceptedSideLabel = (label: string): string =>
    label.replace(/^You sell\b/, 'You sold').replace(/^You buy\b/, 'You bought');
  const getTerminalSideLabel = (label: string): string =>
    isAcceptedTrade ? getAcceptedSideLabel(label) : label;
  const terminalOrderProgressLabel = makerPrivateProgressSummary
    ? isAcceptedTrade ? 'You sold' : 'You sell'
    : publicLiquidityProgressSummary
      ? perspective.isMaker
        ? isAcceptedTrade ? 'You sold' : 'You sell'
        : isAcceptedTrade ? 'You bought' : 'You buy'
      : getTerminalSideLabel(leftSide.label);
  const terminalOrderProgressHeaderValue = twoSidedProgressSummary
    ? twoSidedProgressSummary.headerValueLabel ?? `${twoSidedRemainingAmount} left`
    : '';
  const terminalOrderProgressFilledLabel = twoSidedProgressSummary
    ? formatOrderProgressFractionLabel(
        twoSidedProgressSummary.filledAmountLabel,
        twoSidedTotalAmount,
        twoSidedFilledVerb
      )
    : '';
  const terminalOrderProgressPaymentLabel = twoSidedProgressSummary?.paymentAmountLabel
    ? perspective.isMaker
      ? publicLiquidityProgressSummary || makerPrivateProgressSummary
        ? isAcceptedTrade ? 'You bought' : 'You buy'
        : getTerminalSideLabel(rightSide.label)
      : publicLiquidityProgressSummary || makerPrivateProgressSummary
        ? isAcceptedTrade ? 'You sold' : 'You sell'
        : getTerminalSideLabel(rightSide.label)
    : '';
  const terminalOrderProgressPaymentHeaderValue = twoSidedProgressSummary?.paymentAmountLabel
    ? twoSidedProgressSummary.paymentHeaderValueLabel ?? `${twoSidedPaymentRemainingAmount} left`
    : '';
  const terminalOrderProgressPaymentFilledLabel = twoSidedProgressSummary?.paymentAmountLabel
    ? formatOrderProgressFractionLabel(
        twoSidedProgressSummary.paymentFilledAmountLabel,
        twoSidedPaymentTotalAmount,
        twoSidedPaymentFilledVerb
      )
    : '';
  const fallbackCompletionSummary = terminalOrderProgressSummary ? null : completionSummary;
  const visibleCompletionSummary = fallbackCompletionSummary as NonNullable<typeof fallbackCompletionSummary>;
  const makerControlsExpanded = Boolean(expandedMakerControls[buildMakerControlsKey('terminal', tradeKey)]);
  const accessSecret = resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract);
  const shareUrl =
    snapshot.isPublic === false &&
    snapshot.hasAccessHash &&
    !accessSecret &&
    !canUseWalletAuthorityForDirectAccess(snapshot, walletKey)
      ? ''
      : buildTradeShareUrl(snapshot.tradeId, accessSecret || undefined, snapshot.escrowContract);
  const shareKey = `terminal-trade-link:${tradeKey}:${accessSecret ? 'secret' : 'public'}`;
  const visibilityLabel = snapshot.isPublic === false ? UNLISTED_ORDER_LABEL : VISIBLE_LIQUIDITY_LABEL;
  const liquidityLabel = getTradeLiquidityLabel(snapshot.offer, snapshot.request);
  const statusLabel =
    snapshot.status === 'open'
      ? 'Active'
      : snapshot.status === 'unknown'
        ? 'Unknown'
        : snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1);
  const hasExpiry = snapshot.expiresAt > 0;
  const expiryParts = formatTradeExpiryParts(snapshot.expiresAt);
  const expiryCountdown = snapshot.status === 'open' && hasExpiry ? formatExpiryCountdown(snapshot.expiresAt) : null;
  const canUseRevealedHistoryTerms = snapshot.status !== 'open';
  const terminalPriceLeftAsset =
    isHiddenLiquidityTerms
      ? (canUseRevealedHistoryTerms ? resolveRevealedHistoryAssetForSide(revealedWalletHistoryRow, leftSide) : null) ??
        (canShowParticipantHiddenSize ? getHiddenParticipantTermAsset(leftSide.asset, leftSide.role) : leftSide.asset)
      : leftSide.asset;
  const terminalPriceRightAsset =
    isHiddenLiquidityTerms
      ? (canUseRevealedHistoryTerms ? resolveRevealedHistoryAssetForSide(revealedWalletHistoryRow, rightSide) : null) ??
        (canShowParticipantHiddenSize ? getHiddenParticipantTermAsset(rightSide.asset, rightSide.role) : rightSide.asset)
      : rightSide.asset;
  const priceRatioDisplay = resolveTradePriceRatioDisplay({
    baseAsset: terminalPriceLeftAsset,
    quoteAsset: terminalPriceRightAsset,
    toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
    forwardFallbackLabel: isHiddenLiquidityTerms
      ? formatHiddenFixedPriceTerms(terminalPriceLeftAsset, terminalPriceRightAsset)
      : formatTradeRateText(terminalPriceLeftAsset, terminalPriceRightAsset),
    reverseFallbackLabel: isHiddenLiquidityTerms
      ? formatHiddenFixedPriceTerms(terminalPriceRightAsset, terminalPriceLeftAsset)
      : formatTradeRateText(terminalPriceRightAsset, terminalPriceLeftAsset),
    subjectLabel: `price ratio for trade ${snapshot.tradeId}`
  });
  const tradeRateText =
    isDirectPrivateTerms && !directTermsHydrated
      ? 'Private terms'
      : priceRatioDisplay?.label ?? formatTradeListTerms(displayTrade);
  const terminalPriceSideLabel =
    priceRatioDisplay && tradeRateText !== 'Private terms'
      ? formatDeskPriceSideLabel(
          priceRatioDisplay.isReversed ? rightSide : leftSide,
          priceRatioDisplay.isReversed ? leftSide : rightSide
        )
      : '';
  const terminalCarbonPriceReference = getCarbonReferenceDisplay(
    terminalPriceLeftAsset,
    terminalPriceRightAsset,
    priceRatioDisplay?.isReversed ?? false
  );
  const resolveHistoryTermAsset = (side: typeof leftSide | typeof rightSide) =>
    isHiddenLiquidityTerms && canUseRevealedHistoryTerms
      ? resolveRevealedHistoryAssetForSide(revealedWalletHistoryRow, side)
      : null;
  const formatTerminalTerm = (side: typeof leftSide | typeof rightSide): string => {
    const historyAsset = resolveHistoryTermAsset(side);
    if (historyAsset) {
      return formatTradeAssetDisplayText(historyAsset);
    }
    return (isHiddenLiquidityTerms && !canShowParticipantHiddenSize) || (isDirectPrivateTerms && !directTermsHydrated)
      ? side.asset.symbol
      : formatTradeAssetDisplayText(
          isHiddenLiquidityTerms ? getHiddenParticipantTermAsset(side.asset, side.role) : side.asset
        );
  };
  const formatTermMeta = (side: typeof leftSide | typeof rightSide): string => {
    const { role } = side;
    if (isHiddenLiquidityTerms) {
      if (resolveHistoryTermAsset(side)) {
        return '';
      }
      if (canShowParticipantHiddenTerms) {
        return '';
      }
      return '';
    }
    if (isDirectPrivateTerms && !directTermsHydrated) {
      return 'Private terms';
    }
    if (role === 'offer') {
      return displayTerms.usingRemaining || snapshot.status === 'open' ? 'Available now' : '';
    }
    return snapshot.status === 'open' && isZeroTradeTakerAddress(snapshot.taker) ? 'Open offer' : '';
  };
  const tokenExplorerLinks = [leftSide.asset, rightSide.asset]
    .map((asset) => {
      const href = buildTradeAssetExplorerUrl(asset);
      return href ? { href, label: asset.symbol, title: `View ${asset.symbol} on token explorer` } : null;
    })
    .filter((link): link is { href: string; label: string; title: string } => Boolean(link))
    .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
  const makerExplorerUrl = `${COTI_NETWORK.blockExplorerUrl}/address/${snapshot.maker}`;
  const peerAddress =
    !isZeroTradeTakerAddress(snapshot.taker) && snapshot.taker.toLowerCase() !== snapshot.maker.toLowerCase()
      ? snapshot.taker
      : snapshot.walletHasFill && walletAddress && walletKey !== snapshot.maker.toLowerCase()
        ? walletAddress
        : '';
  const peerExplorerUrl = peerAddress ? `${COTI_NETWORK.blockExplorerUrl}/address/${peerAddress}` : '';
  const peerLabel = peerAddress ? shortenAddress(peerAddress) : visibilityLabel === VISIBLE_LIQUIDITY_LABEL ? 'Open offer' : visibilityLabel;
  const remainingOfferAmount = getRemainingOfferAmount(snapshot);
  const remainingRequestAmount = getRemainingRequestAmount(snapshot);
  const fillOfferUnitAmount = isHiddenLiquidityTerms ? parseTokenAmountString(snapshot.offer.amount) : remainingOfferAmount;
  const fillRequestUnitAmount = isHiddenLiquidityTerms ? parseTokenAmountString(snapshot.request.amount) : remainingRequestAmount;
  const canActAsTaker = perspective.isTaker || perspective.isOpenTakerTrade;
  const canShowFillTicket = Boolean(
    snapshot.status === 'open' &&
    canActAsTaker &&
    !perspective.isMaker &&
    !snapshot.counterParentTradeId &&
    fillOfferUnitAmount > 0n &&
    fillRequestUnitAmount > 0n
  );
  const terminalInputValue = terminalFillInputSide === 'pay' ? terminalPayInput : terminalBuyInput;
  const terminalPayAmountInput = parseTokenAmountInput(terminalPayInput, displayTrade.request.decimals);
  const terminalBuyAmountInput = parseTokenAmountInput(terminalBuyInput, displayTrade.offer.decimals);
  const terminalRequestAmount =
    canShowFillTicket && terminalFillInputSide === 'buy' && terminalBuyAmountInput !== null
      ? quoteRequestAmountForOfferAmount(terminalBuyAmountInput, fillOfferUnitAmount, fillRequestUnitAmount)
      : terminalPayAmountInput;
  const terminalReceiveAmount =
    canShowFillTicket && terminalFillInputSide === 'buy' && terminalBuyAmountInput !== null
      ? terminalBuyAmountInput
      : canShowFillTicket && terminalRequestAmount !== null && fillOfferUnitAmount > 0n && fillRequestUnitAmount > 0n
        ? (terminalRequestAmount * fillOfferUnitAmount) / fillRequestUnitAmount
        : 0n;
  const terminalSpendAmount =
    terminalFillInputSide === 'buy' && terminalRequestAmount !== null ? terminalRequestAmount : terminalPayAmountInput ?? 0n;
  const terminalSpendFieldValue =
    terminalFillInputSide === 'buy' && terminalInputValue.trim() && terminalSpendAmount > 0n
      ? formatExactTokenAmountInput(terminalSpendAmount, displayTrade.request.decimals)
      : terminalPayInput;
  const terminalReceiveFieldValue =
    terminalFillInputSide === 'pay' && terminalInputValue.trim() && terminalReceiveAmount > 0n
      ? formatExactTokenAmountInput(terminalReceiveAmount, displayTrade.offer.decimals)
      : terminalBuyInput;
  const fillTooHigh = Boolean(canShowFillTicket && shouldBlockFillAboveVisibleLiquidity(snapshot, terminalRequestAmount));
  const fillSubmitInput =
    terminalRequestAmount !== null && terminalRequestAmount > 0n
      ? formatExactTokenAmountInput(terminalRequestAmount, displayTrade.request.decimals)
      : terminalPayInput;
  const fillCanSubmit = Boolean(
    walletKey &&
    onCotiNetwork &&
    terminalInputValue.trim() &&
    terminalRequestAmount !== null &&
    terminalRequestAmount > 0n &&
    !fillTooHigh
  );
  const maxPayInput = formatExactTokenAmountInput(remainingRequestAmount, displayTrade.request.decimals);
  const historyConfig = getStandardTerminalHistoryConfig(snapshot);
  const terminalAccessChip = liquidityLabel;
  const terminalExpiryChip = expiryCountdown ? expiryCountdown.label.replace(/^Expires /, '') : '';
  const counterRelation = getTradeCounterRelation(snapshot);

  return (
    <article className="p2p-terminal-shell p2p-terminal-shell-standard" key={tradeKey}>
      <header className="p2p-terminal-head">
        <div className="p2p-terminal-title">
          <span className="p2p-terminal-eyebrow">{getTradeContractNamespaceLabel(snapshot)} order</span>
          <h3>{orderSummary.directionLabel}</h3>
          <div className="p2p-terminal-tag-row" aria-label="Offer tags">
            <span className="p2p-order-id">{formatTradeContractIdLabel(snapshot)}</span>
            <strong className={`p2p-offer-status p2p-offer-status-${snapshot.status}`}>{statusLabel}</strong>
            {terminalAccessChip ? <span className="p2p-order-chip">{terminalAccessChip}</span> : null}
            {counterRelation ? (
              <span className="p2p-order-chip" title={counterRelation.detail}>
                {counterRelation.chipLabel}
              </span>
            ) : null}
            {terminalExpiryChip && expiryCountdown ? (
              <span className={`p2p-expiry-chip trade-card-expiry-${expiryCountdown.urgency}`} title={expiryParts.title}>
                {terminalExpiryChip}
              </span>
            ) : null}
          </div>
        </div>
        <div className="p2p-terminal-toolbar">
          <button type="button" className="p2p-terminal-share" onClick={() => askAgentAboutOrder(snapshot)}>
            Ask Agent
          </button>
          {renderTradeConversationButton(snapshot, shareUrl || undefined, accessSecret || undefined)}
          {shareUrl ? (
            <button
              type="button"
              className={lastCopiedKey === shareKey ? 'p2p-terminal-share copied' : 'p2p-terminal-share'}
              onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
              title={lastCopiedKey === shareKey ? 'Trade link copied' : 'Share trade link'}
              aria-label={lastCopiedKey === shareKey ? 'Shared' : SHARE_LABEL}
              aria-live="polite"
            >
              {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
            </button>
          ) : null}
        </div>
      </header>

      <div className="p2p-terminal-main">
        <section className="p2p-terminal-market" aria-label="Trade market summary">
          <button
            type="button"
            className="p2p-terminal-price-card"
            onClick={() => toggleTradeRateDirection(snapshot.tradeId, snapshot.escrowContract)}
            title={priceRatioDisplay?.toggleTitle ?? 'Private terms'}
            aria-label={priceRatioDisplay?.ariaLabel ?? `Private terms for trade ${snapshot.tradeId}.`}
          >
            <span>Price ratio</span>
            {terminalPriceSideLabel ? <span className="p2p-price-side-label">{terminalPriceSideLabel}</span> : null}
            <strong>{tradeRateText}</strong>
            {renderCarbonPriceReference(terminalCarbonPriceReference)}
          </button>

          {terminalOrderProgressSummary ? (
            <div className="p2p-terminal-progress p2p-terminal-order-progress" aria-label={terminalOrderProgressSummary.percentLabel}>
              <div
                className={
                  twoSidedProgressSummary?.paymentAmountLabel
                    ? 'p2p-order-summary-lines p2p-order-summary-lines-public'
                    : 'p2p-order-summary-lines'
                }
              >
                <div className="p2p-terminal-progress-head">
                  <span>{terminalOrderProgressLabel}</span>
                  <strong>{terminalOrderProgressHeaderValue}</strong>
                </div>
                {twoSidedProgressSummary?.paymentAmountLabel ? (
                  <div className="p2p-terminal-progress-flow">
                    <span>{terminalOrderProgressPaymentLabel}</span>
                    <strong>{terminalOrderProgressPaymentHeaderValue}</strong>
                  </div>
                ) : null}
              </div>
              <div className="p2p-terminal-progress-bar">
                <span style={{ width: `${terminalOrderProgressSummary.percent}%` }} />
              </div>
              <div className="p2p-terminal-progress-meta">
                <span>{terminalOrderProgressFilledLabel}</span>
                {terminalOrderProgressPaymentFilledLabel ? <span>{terminalOrderProgressPaymentFilledLabel}</span> : null}
              </div>
            </div>
          ) : (
            <div className="p2p-terminal-flow" aria-label={formatTradeListTerms(displayTrade)}>
              <div className={`p2p-terminal-flow-card p2p-terminal-flow-${leftSide.tone}`}>
                <span>{getTerminalSideLabel(leftSide.label)}</span>
                <strong>{formatTerminalTerm(leftSide)}</strong>
                <small>{formatTermMeta(leftSide)}</small>
              </div>
              <div className="p2p-terminal-flow-arrow" aria-hidden="true">
                <ArrowRight size={17} strokeWidth={2.3} />
              </div>
              <div className={`p2p-terminal-flow-card p2p-terminal-flow-${rightSide.tone}`}>
                <span>{getTerminalSideLabel(rightSide.label)}</span>
                <strong>{formatTerminalTerm(rightSide)}</strong>
                <small>{formatTermMeta(rightSide)}</small>
              </div>
            </div>
          )}

          <div className="p2p-terminal-stat-grid">
            <div>
              <span>Maker</span>
              <a href={makerExplorerUrl} target="_blank" rel="noreferrer" title={snapshot.maker}>
                {perspective.isMaker ? `${shortenAddress(snapshot.maker)} (you)` : shortenAddress(snapshot.maker)}
              </a>
            </div>
            <div>
              <span>Peer</span>
              {peerExplorerUrl ? (
                <a href={peerExplorerUrl} target="_blank" rel="noreferrer" title={peerAddress}>
                  {peerLabel}
                </a>
              ) : (
                <strong>{peerLabel}</strong>
              )}
            </div>
          </div>

          {fallbackCompletionSummary ? (
            <div className="p2p-terminal-progress" aria-label={fallbackCompletionSummary.percentLabel}>
              <div>
                <span>Fill progress</span>
                <strong>{fallbackCompletionSummary.percentLabel}</strong>
              </div>
              <div className="p2p-terminal-progress-bar">
                <span style={{ width: `${fallbackCompletionSummary.percent}%` }} />
              </div>
              <small>
                {visibleCompletionSummary.filledLabel} Â· {visibleCompletionSummary.remainingLabel}
              </small>
            </div>
          ) : null}

          <div className="p2p-terminal-token-actions" aria-label="Token explorer links">
            <span>Verify tokens</span>
            <div>
              {tokenExplorerLinks.length ? (
                tokenExplorerLinks.map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                    {link.label}
                  </a>
                ))
              ) : (
                <strong>Native only</strong>
              )}
            </div>
          </div>
        </section>

        <section className="p2p-terminal-ticket" aria-label="Trade action ticket">
          {renderActionNotice('terminal', tradeKey)}

          {canShowFillTicket ? (
            <>
              <div className="p2p-terminal-amount-grid" aria-label="Trade amount calculator">
                <label className="p2p-terminal-input-field p2p-terminal-input-field-sell has-inline-action">
                  <div className="p2p-terminal-field-head">
                    <span>You sell {displayTrade.request.symbol}</span>
                    <small title={resolveTerminalAssetBalanceLabel(displayTrade.request, 6)}>
                      {resolveTerminalAssetBalanceLabel(displayTrade.request)}
                    </small>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={terminalSpendFieldValue}
                    onChange={(event) => {
                      setTerminalFillInputSide('pay');
                      setTerminalPayInput(sanitizeTokenAmountInput(event.target.value));
                      setTerminalBuyInput('');
                    }}
                    placeholder={`0 ${displayTrade.request.symbol}`}
                    disabled={processingTradeActionId === tradeKey}
                  />
                  {maxPayInput && !isHiddenLiquidityTerms ? (
                    <button
                      type="button"
                      className="p2p-terminal-inline-max"
                      onClick={() => {
                        setTerminalFillInputSide('pay');
                        setTerminalPayInput(maxPayInput);
                        setTerminalBuyInput('');
                      }}
                      disabled={processingTradeActionId === tradeKey}
                    >
                      Max
                    </button>
                  ) : null}
                </label>
                <label className="p2p-terminal-input-field p2p-terminal-input-field-buy">
                  <div className="p2p-terminal-field-head">
                    <span>You buy {displayTrade.offer.symbol}</span>
                    <small title={resolveTerminalAssetBalanceLabel(displayTrade.offer, 6)}>
                      {resolveTerminalAssetBalanceLabel(displayTrade.offer)}
                    </small>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={terminalReceiveFieldValue}
                    onChange={(event) => {
                      setTerminalFillInputSide('buy');
                      setTerminalBuyInput(sanitizeTokenAmountInput(event.target.value));
                      setTerminalPayInput('');
                    }}
                    placeholder={`0 ${displayTrade.offer.symbol}`}
                    disabled={processingTradeActionId === tradeKey}
                  />
                </label>
              </div>
              {fillTooHigh ? <p className="p2p-terminal-ticket-warning">Amount is above current visible liquidity.</p> : null}
              <button
                type="button"
                className={`trade-card-action trade-card-action-accept p2p-terminal-primary-action${
                  processingTradeActionId === tradeKey ? ' p2p-action-pending' : ''
                }`}
                onClick={() => partialFillTrade(snapshot, fillSubmitInput).catch(() => {})}
                disabled={processingTradeActionId === tradeKey || !fillCanSubmit}
                title={
                  processingTradeActionId === tradeKey
                    ? 'Confirming on-chain...'
                    : !walletKey
                      ? 'Connect wallet first.'
                      : !onCotiNetwork
                        ? 'Switch to COTI Mainnet first.'
                        : !terminalInputValue.trim()
                          ? 'Enter an amount to continue.'
                          : fillTooHigh
                            ? 'Amount is above current visible liquidity.'
                            : undefined
                }
              >
                {processingTradeActionId === tradeKey
                  ? 'Processing...'
                  : !walletKey
                    ? `Connect wallet to buy`
                    : !onCotiNetwork
                      ? 'Switch network'
                      : !terminalInputValue.trim()
                        ? 'Enter amount'
                        : fillTooHigh
                          ? 'Amount too high'
                          : isHiddenLiquidityTerms
                            ? 'Fill order'
                            : `Buy ${displayTrade.offer.symbol}`}
              </button>
              {canCounter ? (
                <button type="button" className="trade-card-action trade-card-action-counter" onClick={() => beginCounterTrade(snapshot)}>
                  Counter
                </button>
              ) : null}
              {showCounterUnavailable ? (
                <button type="button" className="trade-card-action trade-card-action-counter trade-card-action-disabled" disabled title={counterUnavailableReason}>
                  Counter unavailable
                </button>
              ) : null}
              {perspective.isTaker ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-refuse"
                  onClick={() => declineTrade(snapshot).catch(() => {})}
                  disabled={processingTradeActionId === tradeKey}
                >
                  Refuse
                </button>
              ) : null}
            </>
          ) : snapshot.status === 'open' && perspective.isMaker ? (
            <div className="p2p-terminal-action-stack p2p-terminal-maker-disclosure">
              <button
                type="button"
                className={makerControlsExpanded ? 'p2p-terminal-manage-toggle active' : 'p2p-terminal-manage-toggle'}
                onClick={() => toggleMakerControls('terminal', tradeKey)}
                aria-expanded={makerControlsExpanded}
              >
                <SlidersHorizontal size={15} strokeWidth={2.4} aria-hidden="true" />
                <span>Manage offer</span>
              </button>
              {makerControlsExpanded ? (
                <div className="p2p-terminal-maker-actions">
                  {canEdit ? (
                    <button type="button" className="trade-card-action trade-card-action-counter" onClick={() => beginEditTrade(snapshot)} disabled={processingTradeActionId === tradeKey}>
                      Edit
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-refuse"
                    onClick={() => cancelTrade(snapshot).catch(() => {})}
                    disabled={processingTradeActionId === tradeKey}
                  >
                    {processingTradeActionId === tradeKey ? 'Processing...' : 'Cancel offer'}
                  </button>
                </div>
              ) : (
                <p>Open maker actions to edit or cancel this live offer.</p>
              )}
            </div>
          ) : snapshot.status === 'open' && canActAsTaker ? (
            <div className="p2p-terminal-action-stack">
              <button
                type="button"
                className={`trade-card-action trade-card-action-accept p2p-terminal-primary-action${
                  processingTradeActionId === tradeKey ? ' p2p-action-pending' : ''
                }`}
                onClick={() => acceptTrade(snapshot).catch(() => {})}
                disabled={processingTradeActionId === tradeKey || !walletKey || !onCotiNetwork}
                title={
                  processingTradeActionId === tradeKey
                    ? 'Confirming on-chain...'
                    : !walletKey
                      ? 'Connect wallet first.'
                      : !onCotiNetwork
                        ? 'Switch to COTI Mainnet first.'
                        : snapshot.counterParentTradeId
                          ? 'Close the parent first, accept this counter, then close sibling counters.'
                          : undefined
                }
              >
                {processingTradeActionId === tradeKey
                  ? 'Processing...'
                  : !walletKey
                    ? 'Connect wallet to buy'
                    : !onCotiNetwork
                      ? 'Switch network'
                      : snapshot.counterParentTradeId
                        ? 'Close parent & accept'
                        : `Buy ${displayTrade.offer.symbol}`}
              </button>
              {!isHiddenLiquidityTerms && snapshot.counterParentTradeId && perspective.isTaker && (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-counter"
                  onClick={() => acceptTrade(snapshot, 'fill').catch(() => {})}
                  disabled={processingTradeActionId === tradeKey}
                  title="Fill this counter offer without closing the parent or sibling counters."
                >
                  Fill
                </button>
              )}
              {canCounter ? (
                <button type="button" className="trade-card-action trade-card-action-counter" onClick={() => beginCounterTrade(snapshot)} disabled={processingTradeActionId === tradeKey}>
                  Counter
                </button>
              ) : null}
              {perspective.isTaker ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-refuse"
                  onClick={() => declineTrade(snapshot).catch(() => {})}
                  disabled={processingTradeActionId === tradeKey}
                >
                  Refuse
                </button>
              ) : null}
            </div>
          ) : (
            <div className="p2p-terminal-action-state">
              <strong>{snapshot.status === 'open' ? 'No wallet action available' : `${statusLabel} offer`}</strong>
              <p>
                {snapshot.status === 'open'
                  ? walletKey
                    ? 'This wallet is not assigned to act on the offer.'
                    : 'Connect the trading wallet to see available maker or taker actions.'
                  : 'This trade is no longer accepting new fills.'}
              </p>
            </div>
          )}
        </section>
      </div>

      <TradeTerminalHistoryMobileControls
        config={historyConfig}
        sheetKey={terminalHistorySheetKey}
        setSheetKey={setTerminalHistorySheetKey}
        renderActionNotice={renderActionNotice}
      />
    </article>
  );
}
