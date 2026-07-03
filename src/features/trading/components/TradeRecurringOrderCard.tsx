import type { ReactNode } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import { resolveRecurringPriceDeskDisplay } from '../../../lib/tradePerspective';
import {
  buildTradeAssetExplorerUrl,
  formatTradeContractIdLabel,
  getSnapshotKey
} from '../../../lib/p2pTradeView';
import {
  OPEN_TERMINAL_LABEL,
  SHARE_LABEL,
  formatCompactTradeTimestamp,
  formatRecurringPriceDeskAriaLabel,
  formatRecurringTokenAmount,
  getRecurringLiquidityLabel,
  getRecurringOrderOpenActionCta,
  renderDeskLiquidityLabel,
  renderDeskPriceLabel,
  renderOpenActionCtaContent,
  type TradeOverviewCardOptions
} from './P2PTradingPage.helpers';

type TradeRecurringOrderCardProps = {
  snapshot: TradeSnapshot;
  options?: TradeOverviewCardOptions;
  walletKey: string;
  reversedRateTradeIds: Record<string, boolean>;
  lastCopiedKey: string;
  openTradeSnapshot: (snapshot: TradeSnapshot) => void;
  toggleTradeRateDirection: (tradeId: number, escrowContract?: string) => void;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  copyWithFeedback: (value: string, feedbackKey: string) => Promise<void>;
};

export default function TradeRecurringOrderCard({
  snapshot,
  options = {},
  walletKey,
  reversedRateTradeIds,
  lastCopiedKey,
  openTradeSnapshot,
  toggleTradeRateDirection,
  buildTradeShareUrl,
  copyWithFeedback
}: TradeRecurringOrderCardProps): ReactNode {
  const recurring = snapshot.recurringOrder;
  if (!recurring) {
    return null;
  }

  const tradeKey = getSnapshotKey(snapshot);
  const canOpenTerminal = options.canOpenTerminal ?? true;
  const hideShareAction = options.groupId === 'history';
  const openCardTerminal = () => {
    if (!canOpenTerminal) {
      return;
    }
    if (options.onOpenTerminal) {
      options.onOpenTerminal(snapshot);
      return;
    }
    openTradeSnapshot(snapshot);
  };
  const isMaker = walletKey.length > 0 && snapshot.maker.toLowerCase() === walletKey;
  const statusLabel =
    recurring.recurringStatus === 'active'
      ? 'Active'
      : recurring.recurringStatus === 'paused'
        ? 'Paused'
        : recurring.recurringStatus === 'cancelled'
          ? 'Cancelled'
          : 'Unknown';
  const modeLabel = getRecurringLiquidityLabel(recurring.mode);
  const baseHidden = recurring.mode !== 'public' && recurring.baseAsset.kind === 'private-erc20';
  const quoteHidden = recurring.mode !== 'public' && recurring.quoteAsset.kind === 'private-erc20';
  const revealedBaseInventory = isMaker ? recurring.makerPrivateInventory?.baseInventory : undefined;
  const revealedQuoteInventory = isMaker ? recurring.makerPrivateInventory?.quoteInventory : undefined;
  const recurringRelationTags = [isMaker ? 'Maker' : null].filter((label): label is string => Boolean(label));
  const recurringTitleRelationTags = recurringRelationTags.filter((label) => label === 'Maker');
  const recurringMetaRelationTags = recurringRelationTags.filter((label) => label !== 'Maker');
  const recurringModeTags = [modeLabel].filter((label): label is string => Boolean(label));
  const showRecurringDateRow = options.groupId === 'history' || recurring.recurringStatus !== 'active';
  const recurringDateLabel = formatCompactTradeTimestamp(snapshot.createdAt);
  const baseInventoryLabel =
    baseHidden && revealedBaseInventory !== undefined
      ? formatRecurringTokenAmount(recurring.baseAsset, revealedBaseInventory, false)
      : baseHidden && recurring.hasPrivateBaseInventory
        ? 'Private'
        : formatRecurringTokenAmount(recurring.baseAsset, recurring.publicBaseInventory, false);
  const quoteInventoryLabel =
    quoteHidden && revealedQuoteInventory !== undefined
      ? formatRecurringTokenAmount(recurring.quoteAsset, revealedQuoteInventory, false)
      : quoteHidden && recurring.hasPrivateQuoteInventory
        ? 'Private'
        : formatRecurringTokenAmount(recurring.quoteAsset, recurring.publicQuoteInventory, false);
  const hasPositiveRecurringAmount = (amount?: string): boolean => {
    if (!amount || !/^\d+$/.test(amount)) {
      return false;
    }
    try {
      return BigInt(amount) > 0n;
    } catch {
      return false;
    }
  };
  const sellLiquidityLive =
    baseHidden && revealedBaseInventory !== undefined
      ? hasPositiveRecurringAmount(revealedBaseInventory)
      : baseHidden
        ? recurring.sellSideOpen && recurring.hasPrivateBaseInventory
        : hasPositiveRecurringAmount(recurring.publicBaseInventory);
  const buyLiquidityLive =
    quoteHidden && revealedQuoteInventory !== undefined
      ? hasPositiveRecurringAmount(revealedQuoteInventory)
      : quoteHidden
        ? recurring.buySideOpen && recurring.hasPrivateQuoteInventory
        : hasPositiveRecurringAmount(recurring.publicQuoteInventory);
  const baseInventoryMuted = baseHidden && revealedBaseInventory === undefined && recurring.hasPrivateBaseInventory;
  const quoteInventoryMuted = quoteHidden && revealedQuoteInventory === undefined && recurring.hasPrivateQuoteInventory;
  const recurringExecutionLabel = recurring.executionCount > 0 ? String(recurring.executionCount) : 'None';
  const recurringExecutionMuted = recurring.executionCount === 0;
  const recurringPriceDisplay = resolveRecurringPriceDeskDisplay({
    terms: {
      baseAsset: recurring.baseAsset,
      quoteAsset: recurring.quoteAsset,
      buyTerms: recurring.buyTerms,
      sellTerms: recurring.sellTerms
    },
    toggleInverse: Boolean(reversedRateTradeIds[tradeKey]),
    subjectLabel: `Recurring order ${recurring.orderId}`
  });
  const shareUrl = buildTradeShareUrl(snapshot.tradeId, undefined, snapshot.escrowContract);
  const shareKey = `recurring-order-link:${tradeKey}`;
  const recurringOpenActionCta = getRecurringOrderOpenActionCta(snapshot, isMaker);
  const recurringBaseSymbol = recurringPriceDisplay.displayBaseAsset.symbol.trim() || 'Base';
  const recurringQuoteSymbol = recurringPriceDisplay.displayQuoteAsset.symbol.trim() || 'Quote';
  const recurringCardTitle = `${recurringBaseSymbol}/${recurringQuoteSymbol}`;
  const recurringBaseExplorerUrl = buildTradeAssetExplorerUrl(recurringPriceDisplay.displayBaseAsset);
  const recurringQuoteExplorerUrl = buildTradeAssetExplorerUrl(recurringPriceDisplay.displayQuoteAsset);
  const recurringTokenExplorerLinks = [
    recurringBaseExplorerUrl
      ? {
          key: recurringBaseExplorerUrl,
          href: recurringBaseExplorerUrl,
          label: recurringPriceDisplay.displayBaseAsset.symbol,
          title: `View ${recurringPriceDisplay.displayBaseAsset.symbol} on token explorer`
        }
      : null,
    recurringQuoteExplorerUrl
      ? {
          key: recurringQuoteExplorerUrl,
          href: recurringQuoteExplorerUrl,
          label: recurringPriceDisplay.displayQuoteAsset.symbol,
          title: `View ${recurringPriceDisplay.displayQuoteAsset.symbol} on token explorer`
        }
      : null
  ]
    .filter((link): link is { key: string; href: string; label: string; title: string } => Boolean(link))
    .filter((link, index, links) => links.findIndex((candidate) => candidate.href === link.href) === index);

  return (
    <article
      key={tradeKey}
      className={[
        'p2p-order-card',
        'p2p-recurring-order-card',
        options.selected ? 'p2p-order-card-selected' : '',
        recurring.mode !== 'public' ? 'p2p-recurring-order-card-private' : '',
        `p2p-recurring-order-card-${recurring.recurringStatus}`,
        showRecurringDateRow ? 'p2p-order-card-fixed-date' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="p2p-recurring-card-head p2p-order-card-head">
        <div className="p2p-offer-title">
          <div className="p2p-order-title-row">
            <h3 title={recurringCardTitle} aria-label={recurringCardTitle}>
              <span className="p2p-order-title-main">{recurringCardTitle}</span>
            </h3>
            <strong className={`p2p-offer-status p2p-offer-status-${snapshot.status}`}>{statusLabel}</strong>
            {recurringTitleRelationTags.map((label) => (
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
                <span className="p2p-order-id">{formatTradeContractIdLabel(snapshot)}</span>
              </span>
              <span className="p2p-order-grid-cell p2p-order-grid-cell-relations">
                {recurringMetaRelationTags.map((label) => (
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
                {recurringModeTags.map((label) => (
                  <span className="p2p-order-chip" key={`${tradeKey}:tag:${label}`}>
                    {label}
                  </span>
                ))}
              </span>
            </p>
          </div>
          {showRecurringDateRow ? (
            <p className="p2p-order-date-row">
              <span className="p2p-order-grid-cell p2p-order-grid-cell-id">
                <span className="p2p-offer-expiry p2p-expiry-chip" title={`Created: ${recurringDateLabel}`}>
                  {recurringDateLabel}
                </span>
              </span>
              <span className="p2p-order-grid-cell p2p-order-grid-cell-relations" />
              <span className="p2p-order-grid-cell p2p-order-grid-cell-tags" />
            </p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        className="p2p-recurring-price-card p2p-order-market-panel"
        onClick={() => toggleTradeRateDirection(snapshot.tradeId, snapshot.escrowContract)}
        title={recurringPriceDisplay.toggleTitle}
        aria-label={formatRecurringPriceDeskAriaLabel(`Recurring order ${recurring.orderId}`, recurringPriceDisplay)}
      >
        <div className="p2p-recurring-price-card-head">
          <span>Price ratio</span>
        </div>
        <div className="p2p-recurring-price-grid">
          <div className="p2p-recurring-price-box p2p-recurring-price-sell">
            <span>{recurringPriceDisplay.sellSide.label}</span>
            <strong className="p2p-price-label">{renderDeskPriceLabel(recurringPriceDisplay.sellSide.priceLabel)}</strong>
          </div>
          <div className="p2p-recurring-price-box p2p-recurring-price-buy">
            <span>{recurringPriceDisplay.buySide.label}</span>
            <strong className="p2p-price-label">{renderDeskPriceLabel(recurringPriceDisplay.buySide.priceLabel)}</strong>
          </div>
        </div>
      </button>

      <div className="p2p-recurring-inventory-strip p2p-order-detail-band" aria-label="Recurring order liquidity">
        <div>
          <div className="p2p-recurring-liquidity-head">
            <span title="Sell liquidity">Sell liq.</span>
            <i
              className={sellLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
              title={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
              role="img"
              aria-label={sellLiquidityLive ? 'Sell liquidity is live' : 'Sell liquidity needs funding'}
            />
          </div>
          <strong className={baseInventoryMuted ? 'p2p-liquidity-label p2p-order-muted-slot' : 'p2p-liquidity-label'}>
            {renderDeskLiquidityLabel(baseInventoryLabel)}
          </strong>
        </div>
        <div>
          <div className="p2p-recurring-liquidity-head">
            <span title="Buy liquidity">Buy liq.</span>
            <i
              className={buyLiquidityLive ? 'p2p-recurring-liquidity-dot is-live' : 'p2p-recurring-liquidity-dot'}
              title={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
              role="img"
              aria-label={buyLiquidityLive ? 'Buy liquidity is live' : 'Buy liquidity needs funding'}
            />
          </div>
          <strong className={quoteInventoryMuted ? 'p2p-liquidity-label p2p-order-muted-slot' : 'p2p-liquidity-label'}>
            {renderDeskLiquidityLabel(quoteInventoryLabel)}
          </strong>
        </div>
        <div>
          <span>Executions</span>
          <strong className={recurringExecutionMuted ? 'p2p-liquidity-label p2p-order-muted-slot' : 'p2p-liquidity-label'}>
            <span className="p2p-liquidity-number">{recurringExecutionLabel}</span>
          </strong>
        </div>
      </div>

      <div className="p2p-offer-token-actions p2p-order-token-actions" aria-label="Token explorer links">
        <span>Verify tokens</span>
        <div>
          {recurringTokenExplorerLinks.length ? (
            recurringTokenExplorerLinks.map((link) => (
              <a key={link.key} className="p2p-offer-token-link" href={link.href} target="_blank" rel="noreferrer" title={link.title}>
                {link.label}
              </a>
            ))
          ) : (
            <span className="p2p-token-placeholder p2p-order-muted-slot">Native only</span>
          )}
        </div>
      </div>

      <div className="p2p-recurring-card-footer p2p-order-card-footer">
        <div className="p2p-card-footer-actions">
          {isMaker && canOpenTerminal ? (
            <button
              type="button"
              className="p2p-offer-manage-btn"
              onClick={openCardTerminal}
              title={OPEN_TERMINAL_LABEL}
              aria-label={OPEN_TERMINAL_LABEL}
            >
              <span>{OPEN_TERMINAL_LABEL}</span>
            </button>
          ) : canOpenTerminal ? (
            <button
              type="button"
              className="p2p-offer-open-btn"
              onClick={openCardTerminal}
              title={OPEN_TERMINAL_LABEL}
              aria-label={OPEN_TERMINAL_LABEL}
            >
              {renderOpenActionCtaContent(recurringOpenActionCta)}
            </button>
          ) : null}
          {!hideShareAction && shareUrl ? (
            <button
              type="button"
              className={lastCopiedKey === shareKey ? 'p2p-offer-share-btn copied' : 'p2p-offer-share-btn'}
              onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
              title={lastCopiedKey === shareKey ? 'Recurring order link copied' : 'Share recurring order link'}
              aria-label={lastCopiedKey === shareKey ? 'Shared' : SHARE_LABEL}
              aria-live="polite"
            >
              {lastCopiedKey === shareKey ? 'Shared' : 'Share'}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
