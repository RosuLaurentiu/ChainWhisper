import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  formatExpiryCountdown,
  formatMessageTimestamp,
  formatTokenAmount,
  formatTradeAssetDisplayText,
  shortenAddress,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  canUseWalletAuthorityForDirectAccess
} from '../../../lib/tradeCounterSupport';
import { buildTradeTransactionHistoryRows } from '../../../lib/tradeHistory';
import {
  isZeroTradeTakerAddress,
  resolveTradePriceRatioDisplay,
  resolveTradeOrderSummary
} from '../../../lib/tradePerspective';
import {
  getTradeAccountPerspectiveAddress,
  getWalletActionAccount,
  getWalletOwnerAccount,
  type WalletReadAccount
} from '../../../lib/walletAccountScope';
import {
  buildTradeAssetExplorerUrl,
  formatHiddenFixedPriceTerms,
  formatTradeContractIdLabel,
  formatTradeExpiryParts,
  formatTradeListTerms,
  formatTradeRateText,
  getMakerPrivateProgressSummary,
  getSnapshotKey,
  getTradeAccessFilter,
  getTradeCompletionSummary,
  getTradeDisplayTerms,
  getTradeTermsVisibility,
  hasHydratedDirectTradeTerms
} from '../../../lib/p2pTradeView';
import {
  OPEN_TERMINAL_LABEL,
  SHARE_LABEL,
  UNLISTED_ORDER_LABEL,
  formatDeskPriceSideLabel,
  formatOrderProgressFractionLabel,
  getKnownTermProgressSummary,
  getRevealedHistoryProgressSummary,
  getStandardTradeOpenActionCta,
  getTradeCounterRelation,
  getTradeLiquidityLabel,
  getTradeSideProgressVerb,
  getVisibleOfferLiquiditySummary,
  parseTokenAmountString,
  quoteRequestAmountForOfferAmount,
  renderDeskPriceLabel,
  renderOpenActionCtaContent,
  resolveRevealedHistoryAssetForSide,
  withProgressPaymentFallback,
  type TradeOverviewCardOptions
} from './P2PTradingPage.helpers';

type TradeStandardOrderCardProps = {
  trade: TradeSnapshot;
  options?: TradeOverviewCardOptions;
  routeView: string;
  walletAddress: string;
  walletKey: string;
  walletReadAccounts: WalletReadAccount[];
  reversedRateTradeIds: Record<string, boolean>;
  lastCopiedKey: string;
  revealingPrivateTradeKey: string;
  openTradeSnapshot: (trade: TradeSnapshot) => void;
  toggleTradeRateDirection: (tradeId: number, escrowContract?: string) => void;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
  revealMakerPrivateProgress: (trade: TradeSnapshot, forceReveal?: boolean) => Promise<unknown>;
};

export default function TradeStandardOrderCard({
  trade,
  options = {},
  routeView,
  walletAddress,
  walletKey,
  walletReadAccounts,
  reversedRateTradeIds,
  lastCopiedKey,
  revealingPrivateTradeKey,
  openTradeSnapshot,
  toggleTradeRateDirection,
  resolveKnownTradeAccessSecret,
  buildTradeShareUrl,
  copyWithFeedback,
  revealMakerPrivateProgress
}: TradeStandardOrderCardProps): ReactNode {
  const tradeKey = getSnapshotKey(trade);
  const canOpenTerminal = options.canOpenTerminal ?? true;
  const hideShareAction = options.groupId === 'history';
  const openCardTerminal = () => {
    if (!canOpenTerminal) {
      return;
    }
    if (options.onOpenTerminal) {
      options.onOpenTerminal(trade);
      return;
    }
    openTradeSnapshot(trade);
  };
  const displayTerms = getTradeDisplayTerms(trade);
  const displayTrade = {
    ...trade,
    offer: displayTerms.offer,
    request: displayTerms.request
  };
  const actionAccount = getWalletActionAccount(walletReadAccounts);
  const ownerAccount = getWalletOwnerAccount(walletReadAccounts);
  const perspectiveWalletAddress =
    getTradeAccountPerspectiveAddress(trade, { actionAccount, ownerAccount }) || walletAddress;
  const perspectiveWalletKey = perspectiveWalletAddress.trim().toLowerCase();
  const orderSummary = resolveTradeOrderSummary(displayTrade, perspectiveWalletAddress);
  const perspective = orderSummary.perspective;
  const leftSide = orderSummary.primarySide;
  const rightSide = orderSummary.secondarySide;
  const termsVisibility = getTradeTermsVisibility(trade);
  const isHiddenLiquidityTerms = termsVisibility === 'hidden-liquidity';
  const isDirectPrivateTerms = termsVisibility === 'direct-private-terms';
  const directTermsHydrated = hasHydratedDirectTradeTerms(trade);
  const completionSummary = getTradeCompletionSummary(trade);
  const walletHistoryRows = perspectiveWalletKey ? buildTradeTransactionHistoryRows([trade], perspectiveWalletAddress) : [];
  const revealedWalletHistoryRow = walletHistoryRows.find(
    (row) => row.bought.visible && row.sold.visible && row.amountVisibility !== 'private-hidden'
  );
  const hasRevealedWalletHiddenTerms = isHiddenLiquidityTerms && Boolean(revealedWalletHistoryRow);
  const canShowParticipantHiddenTerms =
    isHiddenLiquidityTerms &&
    routeView !== 'public' &&
    (perspective.isParticipant || hasRevealedWalletHiddenTerms);
  const hiddenInitialOfferAmount = parseTokenAmountString(trade.makerPrivateProgress?.initialOfferAmount);
  const hiddenOfferUnitAmount = parseTokenAmountString(trade.offer.amount);
  const hiddenRequestUnitAmount = parseTokenAmountString(trade.request.amount);
  const hiddenInitialRequestAmount = quoteRequestAmountForOfferAmount(
    hiddenInitialOfferAmount,
    hiddenOfferUnitAmount,
    hiddenRequestUnitAmount
  );
  const canShowParticipantHiddenSize = canShowParticipantHiddenTerms && hiddenInitialOfferAmount > 0n;
  const getHiddenParticipantTermAsset = (
    asset: TradeAssetPayload,
    role: 'offer' | 'payment'
  ): TradeAssetPayload => {
    if (!canShowParticipantHiddenSize) {
      return asset;
    }
    const amount = role === 'offer' ? hiddenInitialOfferAmount : hiddenInitialRequestAmount;
    return amount > 0n ? { ...asset, amount: amount.toString() } : asset;
  };
  const makerPrivateProgressSummary =
    routeView === 'public' || !perspective.isMaker ? null : getMakerPrivateProgressSummary(trade);
  const publicLiquidityProgressSummary =
    !isHiddenLiquidityTerms && !(isDirectPrivateTerms && !directTermsHydrated)
      ? getVisibleOfferLiquiditySummary(trade)
      : null;
  const revealedWalletProgressSummary = getRevealedHistoryProgressSummary(revealedWalletHistoryRow, leftSide, rightSide);
  const knownTermProgressSummary =
    (!isHiddenLiquidityTerms || canShowParticipantHiddenSize) && !(isDirectPrivateTerms && !directTermsHydrated)
      ? getKnownTermProgressSummary(
          isHiddenLiquidityTerms ? getHiddenParticipantTermAsset(leftSide.asset, leftSide.role) : leftSide.asset,
          isHiddenLiquidityTerms ? getHiddenParticipantTermAsset(rightSide.asset, rightSide.role) : rightSide.asset,
          trade.status
        )
      : null;
  const orderLiquiditySummary =
    withProgressPaymentFallback(
      makerPrivateProgressSummary ?? publicLiquidityProgressSummary ?? revealedWalletProgressSummary ?? knownTermProgressSummary,
      knownTermProgressSummary
    );
  const twoSidedProgressSummary = orderLiquiditySummary;
  const twoSidedFilledVerb = getTradeSideProgressVerb(leftSide);
  const twoSidedPaymentFilledVerb = getTradeSideProgressVerb(rightSide);
  const twoSidedRemainingAmount =
    twoSidedProgressSummary?.remainingAmountLabel ?? twoSidedProgressSummary?.remainingLabel ?? '';
  const twoSidedTotalAmount =
    twoSidedProgressSummary?.totalAmountLabel ?? twoSidedProgressSummary?.totalLabel ?? '';
  const twoSidedPaymentRemainingAmount =
    twoSidedProgressSummary?.paymentRemainingAmountLabel ?? twoSidedProgressSummary?.paymentAmountLabel ?? '';
  const twoSidedPaymentTotalAmount = twoSidedProgressSummary?.paymentAmountLabel ?? '';
  const isAcceptedTrade = trade.status === 'accepted';
  const getAcceptedSideLabel = (label: string): string =>
    label.replace(/^You sell\b/, 'You sold').replace(/^You buy\b/, 'You bought');
  const getDeskSideLabel = (side: typeof leftSide): string =>
    isAcceptedTrade ? getAcceptedSideLabel(side.label) : side.label;
  const orderLiquidityLabel = makerPrivateProgressSummary
    ? isAcceptedTrade ? 'You sold' : 'You sell'
    : perspective.isMaker
      ? publicLiquidityProgressSummary || makerPrivateProgressSummary
        ? isAcceptedTrade ? 'You sold' : 'You sell'
        : getDeskSideLabel(leftSide)
      : publicLiquidityProgressSummary || makerPrivateProgressSummary
        ? isAcceptedTrade ? 'You bought' : 'You buy'
        : getDeskSideLabel(leftSide);
  const orderLiquidityHeaderValue = twoSidedProgressSummary
    ? twoSidedProgressSummary.headerValueLabel ?? `${twoSidedRemainingAmount} left`
    : '';
  const orderLiquidityFilledLabel = twoSidedProgressSummary
    ? formatOrderProgressFractionLabel(
        twoSidedProgressSummary.filledAmountLabel,
        twoSidedTotalAmount,
        twoSidedFilledVerb
      )
    : '';
  const orderLiquidityPaymentLabel = twoSidedProgressSummary?.paymentAmountLabel
    ? perspective.isMaker
      ? publicLiquidityProgressSummary || makerPrivateProgressSummary
        ? isAcceptedTrade ? 'You bought' : 'You buy'
        : getDeskSideLabel(rightSide)
      : publicLiquidityProgressSummary || makerPrivateProgressSummary
        ? isAcceptedTrade ? 'You sold' : 'You sell'
        : getDeskSideLabel(rightSide)
    : '';
  const orderLiquidityPaymentHeaderValue = twoSidedProgressSummary?.paymentAmountLabel
    ? twoSidedProgressSummary.paymentHeaderValueLabel ?? `${twoSidedPaymentRemainingAmount} left`
    : '';
  const orderLiquidityPaymentFilledLabel = twoSidedProgressSummary?.paymentAmountLabel
    ? formatOrderProgressFractionLabel(
        twoSidedProgressSummary.paymentFilledAmountLabel,
        twoSidedPaymentTotalAmount,
        twoSidedPaymentFilledVerb
      )
    : '';
  const fallbackCompletionSummary = orderLiquiditySummary ? null : completionSummary;
  const hasWalletScopedHistory = Boolean(
    walletKey && (trade.walletHasFill || walletHistoryRows.length > 0)
  );
  const canRevealDirectTerms = Boolean(
    routeView !== 'public' &&
    isDirectPrivateTerms &&
    !directTermsHydrated &&
    walletKey &&
    (perspective.isParticipant ||
      hasWalletScopedHistory ||
      canUseWalletAuthorityForDirectAccess(trade, walletKey))
  );
  const accessSecret = resolveKnownTradeAccessSecret(trade.tradeId, trade.escrowContract);
  const shareUrl =
    trade.isPublic === false &&
    trade.hasAccessHash &&
    !accessSecret &&
    !canUseWalletAuthorityForDirectAccess(trade, walletKey)
      ? ''
      : buildTradeShareUrl(trade.tradeId, accessSecret || undefined, trade.escrowContract);
  const shareKey = `offer-trade-link:${tradeKey}:${accessSecret ? 'secret' : 'public'}`;
  const walletRelationTag = perspective.isMaker
    ? 'Maker'
    : perspective.isTaker
      ? 'Reserved'
      : null;
  const tradeRelationTags = [walletRelationTag].filter((label): label is string => Boolean(label));
  const tradeTitleRelationTags = tradeRelationTags.filter((label) => label === 'Maker');
  const tradeMetaRelationTags = tradeRelationTags.filter((label) => label !== 'Maker');
  const tradeLiquidityLabel = getTradeLiquidityLabel(trade.offer, trade.request);
  const tradeAccessTag =
    options.groupId && getTradeAccessFilter(trade) === 'private-link' ? UNLISTED_ORDER_LABEL : null;
  const accountRoleTag =
    trade.accountRole === 'owner' || (ownerAccount?.key && perspectiveWalletKey === ownerAccount.key)
      ? 'Owner wallet'
      : null;
  const counterRelation = getTradeCounterRelation(trade);
  const showExpiryInFixedRow = options.groupId === 'history' || trade.status !== 'open';
  const tradeSecondaryTags = [
    tradeAccessTag,
    accountRoleTag,
    tradeLiquidityLabel,
    showExpiryInFixedRow ? null : counterRelation?.chipLabel ?? null,
    trade.replacesTradeId ? `Edited #${trade.replacesTradeId}` : null,
    trade.replacementTradeId ? `Replaced #${trade.replacementTradeId}` : null
  ].filter((label): label is string => Boolean(label));
  const takerLabel = isZeroTradeTakerAddress(trade.taker) ? '' : shortenAddress(trade.taker);
  const statusLabel =
    trade.status === 'open'
      ? 'Active'
      : trade.status === 'unknown'
        ? 'Unknown'
        : trade.status.charAt(0).toUpperCase() + trade.status.slice(1);
  const statusClassName = `p2p-offer-status-${trade.status}`;
  const isFinishedTrade = trade.status !== 'open';
  const showOpenTradeAction = !isFinishedTrade && !perspective.isMaker;
  const openTradeActionCta = getStandardTradeOpenActionCta();
  const leftSideLabel = getDeskSideLabel(leftSide);
  const rightSideLabel = getDeskSideLabel(rightSide);
  const leftExplorerUrl = buildTradeAssetExplorerUrl(leftSide.asset);
  const rightExplorerUrl = buildTradeAssetExplorerUrl(rightSide.asset);
  const tokenExplorerLinks = [
    leftExplorerUrl
      ? {
          key: leftExplorerUrl,
          href: leftExplorerUrl,
          label: leftSide.asset.symbol,
          title: `View ${leftSide.asset.symbol} on token explorer`
        }
      : null,
    rightExplorerUrl
      ? {
          key: rightExplorerUrl,
          href: rightExplorerUrl,
          label: rightSide.asset.symbol,
          title: `View ${rightSide.asset.symbol} on token explorer`
        }
      : null
  ]
    .filter((link): link is { key: string; href: string; label: string; title: string } => Boolean(link))
    .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);
  const pairTitleFromSymbol = trade.request.symbol.trim() || 'Payment';
  const pairTitleToSymbol = trade.offer.symbol.trim() || 'Offer';
  const pairTitleFull = `${pairTitleFromSymbol} to ${pairTitleToSymbol}`;
  const leftToneClass = `p2p-offer-term-${leftSide.tone}`;
  const rightToneClass = `p2p-offer-term-${rightSide.tone}`;
  const cardPriceLeftAsset =
    isHiddenLiquidityTerms ? resolveRevealedHistoryAssetForSide(revealedWalletHistoryRow, leftSide) ?? leftSide.asset : leftSide.asset;
  const cardPriceRightAsset =
    isHiddenLiquidityTerms ? resolveRevealedHistoryAssetForSide(revealedWalletHistoryRow, rightSide) ?? rightSide.asset : rightSide.asset;
  const priceRatioDisplay = resolveTradePriceRatioDisplay({
    baseAsset: cardPriceLeftAsset,
    quoteAsset: cardPriceRightAsset,
    toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
    forwardFallbackLabel: isHiddenLiquidityTerms
      ? formatHiddenFixedPriceTerms(cardPriceLeftAsset, cardPriceRightAsset)
      : formatTradeRateText(cardPriceLeftAsset, cardPriceRightAsset),
    reverseFallbackLabel: isHiddenLiquidityTerms
      ? formatHiddenFixedPriceTerms(cardPriceRightAsset, cardPriceLeftAsset)
      : formatTradeRateText(cardPriceRightAsset, cardPriceLeftAsset),
    subjectLabel: `price ratio for trade ${trade.tradeId}`
  });
  const tradeRateText = isDirectPrivateTerms && !directTermsHydrated
    ? 'Private terms'
    : isHiddenLiquidityTerms
      ? priceRatioDisplay?.label ?? ''
      : priceRatioDisplay?.label ?? '';
  const priceSideLabel =
    priceRatioDisplay && tradeRateText !== 'Private terms'
      ? formatDeskPriceSideLabel(
          priceRatioDisplay.isReversed ? rightSide : leftSide,
          priceRatioDisplay.isReversed ? leftSide : rightSide
        )
      : '';
  const showPriceSummary = Boolean(tradeRateText);
  const formatCompactVisibleTermText = (asset: TradeAssetPayload): string => {
    try {
      return `${formatTokenAmount(BigInt(asset.amount), asset.decimals, 2)} ${asset.symbol}`;
    } catch {
      return `0 ${asset.symbol}`;
    }
  };
  const resolveHistoryTermAsset = (side: typeof leftSide | typeof rightSide) =>
    isHiddenLiquidityTerms ? resolveRevealedHistoryAssetForSide(revealedWalletHistoryRow, side) : null;
  const formatVisibleTermText = (side: typeof leftSide | typeof rightSide): string => {
    const historyAsset = resolveHistoryTermAsset(side);
    if (historyAsset) {
      return formatCompactVisibleTermText(historyAsset);
    }
    return (isHiddenLiquidityTerms && !canShowParticipantHiddenSize) || (isDirectPrivateTerms && !directTermsHydrated)
      ? side.asset.symbol
      : formatCompactVisibleTermText(
          isHiddenLiquidityTerms ? getHiddenParticipantTermAsset(side.asset, side.role) : side.asset
        );
  };
  const formatVisibleTermTitle = (side: typeof leftSide | typeof rightSide): string => {
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
  const formatHiddenTermMetaLabel = (side: typeof leftSide | typeof rightSide): string => {
    if (resolveHistoryTermAsset(side)) {
      return '';
    }
    return canShowParticipantHiddenTerms ? '' : '';
  };
  const leftMetaLabel =
    isHiddenLiquidityTerms
      ? formatHiddenTermMetaLabel(leftSide)
      : isDirectPrivateTerms && !directTermsHydrated
        ? ''
        : leftSide.role === 'offer'
          ? displayTerms.usingRemaining
            ? 'Remaining now'
            : trade.status === 'open'
              ? 'Available now'
              : ''
          : trade.status === 'open'
            ? takerLabel
            : '';
  const rightMetaLabel =
    isHiddenLiquidityTerms
      ? formatHiddenTermMetaLabel(rightSide)
      : isDirectPrivateTerms && !directTermsHydrated
        ? ''
        : rightSide.role === 'offer'
          ? displayTerms.usingRemaining
            ? 'Remaining now'
            : trade.status === 'open'
              ? 'Available now'
              : ''
          : trade.status === 'open'
            ? takerLabel
            : '';
  const hasExpiry = trade.expiresAt > 0;
  const expiryParts = formatTradeExpiryParts(trade.expiresAt);
  const expiryCountdown = trade.status === 'open' && hasExpiry ? formatExpiryCountdown(trade.expiresAt) : null;
  const expiryChipLabel = expiryCountdown
    ? expiryCountdown.label.replace(/^Expires /, '').replace(/\s+/g, ' ')
    : expiryParts.time
      ? `${expiryParts.date} ${expiryParts.time}`
      : expiryParts.date;
  const expiryChipTitle = `Created: ${formatMessageTimestamp(trade.createdAt)} - ${expiryParts.title}`;
  const renderExpiryChip = () => hasExpiry ? (
    <span
      className={`p2p-offer-expiry p2p-expiry-chip ${
        expiryCountdown ? `trade-card-expiry-${expiryCountdown.urgency}` : ''
      }`}
      title={expiryChipTitle}
    >
      {expiryChipLabel}
    </span>
  ) : null;
  const showFixedDateRowContent = showExpiryInFixedRow && (hasExpiry || Boolean(counterRelation));

  return (
    <article
      key={tradeKey}
      className={[
        'p2p-order-card',
        'p2p-offer-card',
        `p2p-offer-card-${trade.status}`,
        options.selected ? 'p2p-order-card-selected' : '',
        isHiddenLiquidityTerms ? 'p2p-offer-card-private-liquidity' : '',
        showFixedDateRowContent ? 'p2p-order-card-fixed-date' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="p2p-offer-card-head p2p-order-card-head">
        <div className="p2p-offer-title">
          <div className="p2p-order-title-row">
            <h3 className="p2p-order-title-pair" title={pairTitleFull} aria-label={pairTitleFull}>
              <span className="p2p-order-title-token">{pairTitleFromSymbol}</span>
              <ArrowRight className="p2p-order-title-arrow" size={16} strokeWidth={2.4} aria-hidden="true" />
              <span className="p2p-order-title-token">{pairTitleToSymbol}</span>
            </h3>
            <strong className={`p2p-offer-status ${statusClassName}`}>{statusLabel}</strong>
            {tradeTitleRelationTags.map((label) => (
              <span
                className="p2p-order-chip p2p-order-chip-owner"
                key={`${tradeKey}:title-relation:${label}`}
                title="Created by you"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="p2p-order-meta-line p2p-order-tag-stack">
            <p className="p2p-order-subline p2p-order-subline-primary">
              <span className="p2p-order-grid-cell p2p-order-grid-cell-id">
                <span className="p2p-order-id">{formatTradeContractIdLabel(trade)}</span>
              </span>
              <span className="p2p-order-grid-cell p2p-order-grid-cell-relations">
                {tradeMetaRelationTags.map((label) => (
                  <span
                    className={label === 'Maker' ? 'p2p-order-chip p2p-order-chip-owner' : 'p2p-order-chip'}
                    key={`${tradeKey}:relation:${label}`}
                    title={label === 'Maker' ? 'Created by you' : undefined}
                  >
                    {label}
                  </span>
                ))}
              </span>
              <span className="p2p-order-grid-cell p2p-order-grid-cell-tags">
                {tradeSecondaryTags.map((label) => (
                  <span
                    className="p2p-order-chip"
                    key={`${tradeKey}:tag:${label}`}
                    title={counterRelation?.chipLabel === label ? counterRelation.detail : undefined}
                  >
                    {label}
                  </span>
                ))}
                {!showExpiryInFixedRow ? renderExpiryChip() : null}
              </span>
            </p>
          </div>
          {showFixedDateRowContent ? (
            <p className="p2p-order-date-row">
              <span className="p2p-order-grid-cell p2p-order-grid-cell-id">{renderExpiryChip()}</span>
              <span className="p2p-order-grid-cell p2p-order-grid-cell-relations">
                {counterRelation ? (
                  <span className="p2p-order-chip" title={counterRelation.detail}>
                    {counterRelation.chipLabel}
                  </span>
                ) : null}
              </span>
              <span className="p2p-order-grid-cell p2p-order-grid-cell-tags" />
            </p>
          ) : null}
        </div>
      </div>

      {showPriceSummary ? (
        <button
          type="button"
          className={
            isHiddenLiquidityTerms
              ? 'p2p-hidden-price-card p2p-order-market-panel'
              : 'p2p-hidden-price-card p2p-price-ratio-card p2p-order-market-panel'
          }
          onClick={() => toggleTradeRateDirection(trade.tradeId, trade.escrowContract)}
          title={priceRatioDisplay?.toggleTitle ?? 'Private terms'}
          aria-label={priceRatioDisplay?.ariaLabel ?? `Private terms for trade ${trade.tradeId}.`}
        >
          <span>Price ratio</span>
          {priceSideLabel ? <span className="p2p-price-side-label">{priceSideLabel}</span> : null}
          <strong className="p2p-price-label">{renderDeskPriceLabel(tradeRateText)}</strong>
        </button>
      ) : null}

      {orderLiquiditySummary ? (
        <div className="p2p-offer-completion p2p-order-detail-band p2p-order-liquidity-summary" aria-label={orderLiquiditySummary.percentLabel}>
          <div
            className={
              twoSidedProgressSummary?.paymentAmountLabel
                ? 'p2p-order-summary-lines p2p-order-summary-lines-public'
                : 'p2p-order-summary-lines'
            }
          >
            <div className="p2p-offer-completion-head">
              <span>{orderLiquidityLabel}</span>
              <strong>{orderLiquidityHeaderValue}</strong>
            </div>
            {twoSidedProgressSummary?.paymentAmountLabel ? (
              <div className="p2p-offer-completion-flow">
                <span>{orderLiquidityPaymentLabel}</span>
                <strong>{orderLiquidityPaymentHeaderValue}</strong>
              </div>
            ) : null}
          </div>
          <div className="p2p-offer-completion-bar">
            <span style={{ width: `${orderLiquiditySummary.percent}%` }} />
          </div>
          <div className="p2p-offer-completion-meta">
            <span>{orderLiquidityFilledLabel}</span>
            {orderLiquidityPaymentFilledLabel ? <span>{orderLiquidityPaymentFilledLabel}</span> : null}
          </div>
        </div>
      ) : null}

      {!orderLiquiditySummary ? (
        <div className="p2p-offer-terms p2p-offer-terms-clear p2p-order-detail-band" aria-label={formatTradeListTerms(trade)}>
          <div className={`p2p-offer-term p2p-offer-term-offered ${leftToneClass}`}>
            <span>{leftSideLabel}</span>
            <strong title={formatVisibleTermTitle(leftSide)}>
              {formatVisibleTermText(leftSide)}
            </strong>
            {leftMetaLabel ? (
              <small className={isHiddenLiquidityTerms || (isDirectPrivateTerms && !directTermsHydrated) ? 'p2p-order-muted-slot' : undefined}>
                {leftMetaLabel}
              </small>
            ) : null}
          </div>
          <div className="p2p-offer-term-link" aria-hidden="true">
            &rarr;
          </div>
          <div className={`p2p-offer-term p2p-offer-term-requested ${rightToneClass}`}>
            <span>{rightSideLabel}</span>
            <strong title={formatVisibleTermTitle(rightSide)}>
              {formatVisibleTermText(rightSide)}
            </strong>
            {rightMetaLabel ? (
              <small className={isHiddenLiquidityTerms || (isDirectPrivateTerms && !directTermsHydrated) ? 'p2p-order-muted-slot' : undefined}>
                {rightMetaLabel}
              </small>
            ) : null}
          </div>
        </div>
      ) : null}

      {fallbackCompletionSummary ? (
        <div className="p2p-offer-completion" aria-label={fallbackCompletionSummary.percentLabel}>
          <div className="p2p-offer-completion-head">
            <span>Completion</span>
            <strong>{fallbackCompletionSummary.percentLabel}</strong>
          </div>
          <div className="p2p-offer-completion-bar">
            <span style={{ width: `${fallbackCompletionSummary.percent}%` }} />
          </div>
          <div className="p2p-offer-completion-meta">
            <span>{fallbackCompletionSummary.filledLabel}</span>
            <span>{fallbackCompletionSummary.remainingLabel}</span>
          </div>
        </div>
      ) : null}

      <div className="p2p-offer-token-actions p2p-order-token-actions" aria-label="Token explorer links">
        <span>Verify tokens</span>
        <div>
          {tokenExplorerLinks.length ? (
            tokenExplorerLinks.map((link) => (
              <a key={link.key} className="p2p-offer-token-link" href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                {link.label}
              </a>
            ))
          ) : (
            <span className="p2p-token-placeholder p2p-order-muted-slot">Native only</span>
          )}
        </div>
      </div>

      <div className="p2p-offer-footer p2p-order-card-footer">
        {isFinishedTrade ? (
          <div className="p2p-card-footer-actions">
            {canOpenTerminal ? (
              <button
                type="button"
                className="p2p-offer-open-btn"
                onClick={openCardTerminal}
                title={OPEN_TERMINAL_LABEL}
                aria-label={OPEN_TERMINAL_LABEL}
              >
                <span>{OPEN_TERMINAL_LABEL}</span>
              </button>
            ) : (
              <span className="p2p-offer-final-state">
                {statusLabel} offer #{trade.tradeId}
              </span>
            )}
            {canRevealDirectTerms ? (
              <button
                type="button"
                className="p2p-offer-counter-btn"
                onClick={() => revealMakerPrivateProgress(trade).catch(() => {})}
                disabled={revealingPrivateTradeKey === tradeKey}
                title="Reveal this Direct OTC offer with wallet privacy"
              >
                {revealingPrivateTradeKey === tradeKey ? 'Revealing...' : 'Reveal terms'}
              </button>
            ) : null}
            {!hideShareAction && shareUrl ? (
              <button
                type="button"
                className={lastCopiedKey === shareKey ? 'p2p-offer-share-btn copied' : 'p2p-offer-share-btn'}
                onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
                title={lastCopiedKey === shareKey ? 'Trade link copied' : accessSecret ? 'Share private trade link' : 'Share trade link'}
                aria-label={lastCopiedKey === shareKey ? 'Shared' : SHARE_LABEL}
                aria-live="polite"
              >
                {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="p2p-card-footer-actions">
            {perspective.isMaker && canOpenTerminal ? (
              <button
                type="button"
                className="p2p-offer-manage-btn"
                onClick={openCardTerminal}
                title={OPEN_TERMINAL_LABEL}
                aria-label={OPEN_TERMINAL_LABEL}
              >
                <span>{OPEN_TERMINAL_LABEL}</span>
              </button>
            ) : showOpenTradeAction && canOpenTerminal ? (
              <button
                type="button"
                className="p2p-offer-open-btn"
                onClick={openCardTerminal}
                title={OPEN_TERMINAL_LABEL}
                aria-label={OPEN_TERMINAL_LABEL}
              >
                {renderOpenActionCtaContent(openTradeActionCta)}
              </button>
            ) : null}
            {canRevealDirectTerms ? (
              <button
                type="button"
                className="p2p-offer-counter-btn"
                onClick={() => revealMakerPrivateProgress(trade).catch(() => {})}
                disabled={revealingPrivateTradeKey === tradeKey}
                title="Reveal this Direct OTC offer with wallet privacy"
              >
                {revealingPrivateTradeKey === tradeKey ? 'Revealing...' : 'Reveal terms'}
              </button>
            ) : null}
            {!hideShareAction && shareUrl ? (
              <button
                type="button"
                className={lastCopiedKey === shareKey ? 'p2p-offer-share-btn copied' : 'p2p-offer-share-btn'}
                onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
                title={lastCopiedKey === shareKey ? 'Trade link copied' : accessSecret ? 'Share private trade link' : 'Share trade link'}
                aria-label={lastCopiedKey === shareKey ? 'Shared' : SHARE_LABEL}
                aria-live="polite"
              >
                {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}
