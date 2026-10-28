import { ChartNoAxesCombined, ChevronDown, ChevronRight, Link2, LockKeyhole, SlidersHorizontal } from 'lucide-react';
import { useRef, type FormEventHandler, type KeyboardEventHandler } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import type { CarbonPairReferenceDisplay } from '../../../lib/carbonMarketPrice';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import {
  getOtcSwapSourceLabel,
  type OtcSwapInputMode,
  type OtcSwapQuoteCandidate
} from '../../../lib/otcSwapQuote';
import {
  compactOtcSwapPriceLabel,
  formatOtcSwapQuoteAmount,
  resolveVisibleOtcSwapPriceRatioDisplay
} from '../../../lib/otcSwapUi';
import { moveFocusWithin } from '../../../shared/components/a11y';
import type { TradeComposerTokenOption } from './TradeComposerPanel';
import OtcOfferMarketChart from './OtcOfferMarketChart';
import {
  resolveCanonicalTradeActionSide,
  resolveDisplayedTradeActionSide,
  type TradeActionSide
} from '../../../lib/tradePerspective';

type OtcOffersPanelProps = {
  actionMode: OtcSwapInputMode;
  linkedActionModes: Record<OtcSwapInputMode, boolean>;
  orderLinkInput: string;
  orderLinkError: string;
  pinnedTradeKey: string;
  pinnedTrade: TradeSnapshot | null;
  sellTokenSelection: TradeTokenPresetKey;
  buyTokenSelection: TradeTokenPresetKey;
  tokenOptions: TradeComposerTokenOption[];
  displayQuote: OtcSwapQuoteCandidate | null;
  bestQuote: OtcSwapQuoteCandidate | null;
  quoteCandidates: OtcSwapQuoteCandidate[];
  carbonReference: CarbonPairReferenceDisplay | null;
  priceDisplayInverted: boolean;
  marketLabel: string;
  filtersOpen: boolean;
  filtersActive: boolean;
  filterResultSummary: string;
  loadingOffers: boolean;
  offersError: string;
  typeFilter: string;
  typeFilterOptions: Array<{ value: string; label: string }>;
  onActionModeChange: (mode: OtcSwapInputMode) => void;
  onToggleFilters: () => void;
  onTypeFilterChange: (value: string) => void;
  onClearFilters: () => void;
  onRetryOffers: () => void;
  onSubmitOrderLink: FormEventHandler<HTMLFormElement>;
  onOrderLinkInputChange: (value: string) => void;
  onClearPinnedOrder: () => void;
  onCreateLimitOrder: () => void;
  onOpenQuote: (quote: OtcSwapQuoteCandidate) => void;
  formatAvailability: (quote?: OtcSwapQuoteCandidate | null) => string;
};

const readLeadingNumber = (value?: string | null): number | null => {
  const match = value?.replace(/,/gu, '').match(/(?:^|\s)(\d+(?:\.\d+)?)/u);
  const parsed = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatMarketPrice = (value: number): string =>
  value.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '');

const getQuoteRate = (
  quote: OtcSwapQuoteCandidate,
  actionMode: OtcSwapInputMode,
  priceDisplayInverted: boolean
) => {
  const display = resolveVisibleOtcSwapPriceRatioDisplay(quote, actionMode, priceDisplayInverted);
  if (!display) return { label: '--', value: null };
  const compactLabel = compactOtcSwapPriceLabel(display.label, display.basisLabel);
  return {
    label: compactLabel,
    value: readLeadingNumber(compactLabel)
  };
};

export default function OtcOffersPanel({
  actionMode,
  linkedActionModes,
  orderLinkInput,
  orderLinkError,
  pinnedTradeKey,
  pinnedTrade,
  sellTokenSelection,
  buyTokenSelection,
  tokenOptions,
  displayQuote,
  bestQuote,
  quoteCandidates,
  carbonReference,
  priceDisplayInverted,
  marketLabel,
  filtersOpen,
  filtersActive,
  filterResultSummary,
  loadingOffers,
  offersError,
  typeFilter,
  typeFilterOptions,
  onActionModeChange,
  onToggleFilters,
  onTypeFilterChange,
  onClearFilters,
  onRetryOffers,
  onSubmitOrderLink,
  onOrderLinkInputChange,
  onClearPinnedOrder,
  onCreateLimitOrder,
  onOpenQuote,
  formatAvailability
}: OtcOffersPanelProps) {
  const marketChartRef = useRef<HTMLDetailsElement>(null);
  const displayedActionMode = resolveDisplayedTradeActionSide(actionMode, priceDisplayInverted);
  const handleMarketChartToggle = () => {
    const chart = marketChartRef.current;
    if (!chart?.open || typeof window === 'undefined' || !window.matchMedia('(max-width: 860px)').matches) return;
    window.requestAnimationFrame(() => {
      chart.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
    });
  };
  const handleActionModeKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!moveFocusWithin(event, { orientation: 'horizontal', selector: '[role="tab"]:not(:disabled)' })) return;
    const nextDisplayedMode = (
      event.currentTarget.ownerDocument.activeElement as HTMLElement | null
    )?.dataset.swapMode as TradeActionSide | undefined;
    if (!nextDisplayedMode) return;
    const nextMode = resolveCanonicalTradeActionSide(nextDisplayedMode, priceDisplayInverted);
    if (linkedActionModes[nextMode] && nextMode !== actionMode) onActionModeChange(nextMode);
  };

  const visibleCandidates = quoteCandidates.slice(0, 8);
  const bestPrice = bestQuote?.price ?? null;
  const baseSymbol = actionMode === 'buy'
    ? tokenOptions.find((option) => option.value === buyTokenSelection)?.symbol ?? 'BASE'
    : tokenOptions.find((option) => option.value === sellTokenSelection)?.symbol ?? 'BASE';
  const quoteSymbol = actionMode === 'buy'
    ? tokenOptions.find((option) => option.value === sellTokenSelection)?.symbol ?? 'QUOTE'
    : tokenOptions.find((option) => option.value === buyTokenSelection)?.symbol ?? 'QUOTE';
  const currentRatio = displayQuote
    ? getQuoteRate(displayQuote, actionMode, priceDisplayInverted)
    : null;
  const displayedBaseSymbol = priceDisplayInverted ? quoteSymbol : baseSymbol;
  const displayedQuoteSymbol = priceDisplayInverted ? baseSymbol : quoteSymbol;
  const canonicalMarketValue = readLeadingNumber(carbonReference?.label);
  const marketValue = canonicalMarketValue !== null && priceDisplayInverted
    ? 1 / canonicalMarketValue
    : canonicalMarketValue;
  const bestIsLower = actionMode === 'buy' ? !priceDisplayInverted : priceDisplayInverted;
  const marketInsertIndex = marketValue === null
    ? 0
    : visibleCandidates.findIndex((quote) => {
        const quoteValue = getQuoteRate(quote, actionMode, priceDisplayInverted).value;
        return quoteValue !== null && (bestIsLower ? quoteValue <= marketValue : quoteValue >= marketValue);
      });
  const resolvedMarketInsertIndex = marketInsertIndex < 0 ? visibleCandidates.length : marketInsertIndex;
  const selectedOfferIsMissing = Boolean(
    pinnedTradeKey && !visibleCandidates.some((quote) => quote.tradeKey === pinnedTradeKey)
  );

  const marketRow = (
    <div className="p2p-offers-market-row" role="note">
      <span>Carbon market reference</span>
      <strong>{marketValue === null ? 'Unavailable' : `${formatMarketPrice(marketValue)} ${displayedQuoteSymbol}`}</strong>
      <small>Reference only — P2P fills one order and does not route across liquidity.</small>
    </div>
  );

  return (
    <section className="standalone-trades-section p2p-swap-section p2p-offers-workspace" aria-label="P2P offers">
      <div className="p2p-offers-panel">
        <h1 className="p2p-sr-only">Offers</h1>
        {marketLabel && marketLabel !== '--' ? <span className="p2p-sr-only">{marketLabel}</span> : null}

        <div className="p2p-swap-side-switch p2p-offers-mobile-direction" role="tablist" aria-label="Trade direction" onKeyDown={handleActionModeKeyDown}>
            {(['buy', 'sell'] as const).map((mode) => {
              const canonicalMode = resolveCanonicalTradeActionSide(mode, priceDisplayInverted);
              const enabled = linkedActionModes[canonicalMode];
              const selected = displayedActionMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  className={selected ? 'active' : undefined}
                  onClick={() => enabled && onActionModeChange(canonicalMode)}
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-swap-mode={mode}
                  disabled={!enabled}
                >
                  {mode === 'buy' ? 'Buy' : 'Sell'}
                </button>
              );
            })}
        </div>

        <div className={`p2p-offers-filter-tool${filtersOpen ? ' open' : ''}${filtersActive ? ' active' : ''}`}>
          <button
            type="button"
            className="p2p-offers-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="p2p-offers-filter-controls"
            onClick={onToggleFilters}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>Filter offers</span>
            <small>{filterResultSummary}</small>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          <div className="p2p-offers-filter-controls" id="p2p-offers-filter-controls" aria-label="Offer filters">
            <div className="p2p-offers-filter-heading">
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span>Filter offers</span>
            </div>
            <label className="p2p-offers-filter-type">
              <span>Type</span>
              <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)}>
                {typeFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="p2p-offers-filter-reset" disabled={!filtersActive} onClick={onClearFilters}>Clear</button>
            <small className="p2p-offers-filter-summary">{filterResultSummary}</small>
          </div>
        </div>

        <div className="p2p-offers-list-head">
          <span>Rate ({displayedQuoteSymbol})</span>
          <span>{displayedActionMode === 'buy' ? 'You pay' : 'You receive'}</span>
          <span>Available</span>
          <span>Action</span>
        </div>

        <div
          className="p2p-offers-orderbook"
          aria-label="Offers ordered around market price"
          aria-busy={loadingOffers}
        >
          {visibleCandidates.length === 0 && loadingOffers ? (
            <div className="p2p-offers-empty is-loading" role="status">
              <strong>Loading market and offers…</strong>
              <span>Checking the current pair without changing your trade direction.</span>
            </div>
          ) : null}
          {visibleCandidates.length === 0 && !loadingOffers && offersError ? (
            <div className="p2p-offers-empty is-error" role="alert">
              <strong>Offers could not be loaded</strong>
              <span>{offersError}</span>
              <button type="button" onClick={onRetryOffers}>Try again</button>
            </div>
          ) : null}
          {visibleCandidates.length === 0 && !loadingOffers && !offersError && selectedOfferIsMissing ? (
            <div className="p2p-offers-empty is-stale" role="status">
              <strong>This selected offer is no longer available</strong>
              <span>Clear it to return to the current offers for this pair.</span>
              <button type="button" onClick={onClearPinnedOrder}>Clear selected offer</button>
            </div>
          ) : null}
          {visibleCandidates.length === 0 && !loadingOffers && !offersError && !selectedOfferIsMissing && filtersActive ? (
            <div className="p2p-offers-empty is-filtered" role="status">
              <strong>No offers match these filters</strong>
              <span>Clear the filters to see the full market-priced ladder.</span>
              <button type="button" onClick={onClearFilters}>Clear filters</button>
            </div>
          ) : null}
          {visibleCandidates.length === 0 && !loadingOffers && !offersError && !selectedOfferIsMissing && !filtersActive ? (
            <div className="p2p-offers-empty">
              <strong>No offers for this pair yet</strong>
              <span>Create the first offer at your price.</span>
              <button type="button" onClick={onCreateLimitOrder}>Create offer</button>
            </div>
          ) : null}
          {visibleCandidates.map((quote, index) => {
            const rate = getQuoteRate(quote, actionMode, priceDisplayInverted);
            const isBestRate = bestPrice !== null && quote.price === bestPrice;
            const isPrivate = quote.availability.kind === 'terminal';
            const isSelected = quote.tradeKey === pinnedTradeKey;
            const outcomeLabel = actionMode === 'buy'
              ? formatOtcSwapQuoteAmount(quote.estimatedSellAmountWei, quote.sellToken, 6)
              : formatOtcSwapQuoteAmount(quote.estimatedBuyAmountWei, quote.buyToken, 6);
            const marketDelta = rate.value !== null && marketValue !== null
              ? ((rate.value - marketValue) / marketValue) * 100
              : null;
            const isBetterThanMarket = marketDelta !== null && (bestIsLower ? marketDelta < 0 : marketDelta > 0);
            const deltaLabel = marketDelta === null
              ? null
              : `${Math.abs(marketDelta).toFixed(2)}% ${isBetterThanMarket ? 'better' : 'worse'}`;
            return (
              <div className="p2p-offer-rate-slot" key={`${quote.tradeKey}:${quote.recurringSide ?? 'standard'}`}>
                {index === resolvedMarketInsertIndex ? marketRow : null}
                <button
                  type="button"
                  className={`p2p-offer-rate-row${isBestRate ? ' p2p-offer-rate-row-best' : ''}${isPrivate ? ' p2p-offer-rate-row-private' : ''}${isSelected ? ' p2p-offer-rate-row-selected' : ''}`}
                  onClick={() => onOpenQuote(quote)}
                  aria-current={isSelected ? 'true' : undefined}
                >
                  <span className="p2p-offer-rate-price">
                    {isBestRate ? <small>Best rate</small> : null}
                    <strong>{rate.label}</strong>
                    {deltaLabel ? <small className={isBetterThanMarket ? 'better' : 'worse'}>{deltaLabel}</small> : null}
                  </span>
                  <span className="p2p-offer-rate-payment">
                    <strong>{outcomeLabel}</strong>
                    <small>{isPrivate ? 'Partial fill allowed' : getOtcSwapSourceLabel(quote.sourceType)}</small>
                  </span>
                  <span className="p2p-offer-rate-availability">
                    <strong>{formatAvailability(quote)}</strong>
                    <small className="p2p-offer-rate-source">
                      {isPrivate ? <LockKeyhole size={12} aria-hidden="true" /> : null}
                      {isPrivate ? 'Private link' : `Offer #${quote.tradeId}`}
                    </small>
                  </span>
                  <span className="p2p-offer-rate-action">
                    <span>
                      <strong>Trade</strong>
                      <ChevronRight size={14} aria-hidden="true" />
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
          {visibleCandidates.length === resolvedMarketInsertIndex ? marketRow : null}
        </div>

        <details className="p2p-offers-private-link-tool">
          <summary><Link2 size={15} aria-hidden="true" /> Open a private trade link</summary>
          <form className={`p2p-offers-link${pinnedTradeKey ? ' p2p-offers-link-active' : ''}`} onSubmit={onSubmitOrderLink}>
            <input value={orderLinkInput} onChange={(event) => onOrderLinkInputChange(event.target.value)} placeholder="Paste a private trade link" aria-label="Private trade link" />
            <button type="submit">Open</button>
            {pinnedTradeKey ? <button type="button" onClick={onClearPinnedOrder}>Clear</button> : null}
          </form>
          {orderLinkError ? <p className="p2p-swap-link-error">{orderLinkError}</p> : null}
        </details>
        {pinnedTrade ? <p className="p2p-offers-linked-note">Private-link offer #{pinnedTrade.recurringOrder?.orderId ?? pinnedTrade.tradeId} is shown with its exact terms.</p> : null}
        <details ref={marketChartRef} className="p2p-offers-chart" onToggle={handleMarketChartToggle}>
          <summary>
            <ChartNoAxesCombined size={15} aria-hidden="true" />
            <span>Show market chart</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <OtcOfferMarketChart
            marketPrice={marketValue}
            orderPrice={currentRatio?.value ?? null}
            baseSymbol={displayedBaseSymbol}
            quoteSymbol={displayedQuoteSymbol}
          />
        </details>
        <span className="p2p-offers-market-summary" aria-live="polite">Best rate uses price and direction only.</span>
      </div>
    </section>
  );
}
