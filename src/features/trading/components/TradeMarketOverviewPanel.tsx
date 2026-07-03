import { SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

type TradeDeskIdentity = {
  title: string;
  copy: string;
};

type TradeFilterOption = {
  value: string;
  label: string;
};

type TradeMarketOverviewPanelProps = {
  isComposerRoute: boolean;
  routeSurfaceView: string | null;
  marketOverviewClassView: string;
  tradeViewTabs: ReactNode;
  createDeskIdentity: TradeDeskIdentity;
  tradeDeskIdentity: TradeDeskIdentity;
  showTradeSearch: boolean;
  openPublicTradeCount: number;
  receivedOpenTradeOfferCount: number;
  myOpenTradeCount: number;
  walletTradeHistoryCount: number;
  mobileTradeFiltersOpen: boolean;
  activeAdvancedTradeFilterCount: number;
  hasActiveDeskFilters: boolean;
  tradeSearchSummary: string;
  tradeSearchInput: string;
  tradeSearchPlaceholder: string;
  tradePairFilter: string;
  tradePairFilterOptions: TradeFilterOption[];
  tradeTypeFilter: string;
  tradeTypeFilterOptions: TradeFilterOption[];
  tradeSortMode: string;
  walletError: string;
  tradeActionError: string;
  onSearchInputChange: (value: string) => void;
  onClearSearch: () => void;
  onToggleMobileFilters: () => void;
  onPairFilterChange: (value: string) => void;
  onTypeFilterChange: (value: string) => void;
  onSortModeChange: (value: string) => void;
  onClearFilters: () => void;
};

export default function TradeMarketOverviewPanel({
  isComposerRoute,
  routeSurfaceView,
  marketOverviewClassView,
  tradeViewTabs,
  createDeskIdentity,
  tradeDeskIdentity,
  showTradeSearch,
  openPublicTradeCount,
  receivedOpenTradeOfferCount,
  myOpenTradeCount,
  walletTradeHistoryCount,
  mobileTradeFiltersOpen,
  activeAdvancedTradeFilterCount,
  hasActiveDeskFilters,
  tradeSearchSummary,
  tradeSearchInput,
  tradeSearchPlaceholder,
  tradePairFilter,
  tradePairFilterOptions,
  tradeTypeFilter,
  tradeTypeFilterOptions,
  tradeSortMode,
  walletError,
  tradeActionError,
  onSearchInputChange,
  onClearSearch,
  onToggleMobileFilters,
  onPairFilterChange,
  onTypeFilterChange,
  onSortModeChange,
  onClearFilters
}: TradeMarketOverviewPanelProps) {
  if (isComposerRoute) {
    return (
      <section className="p2p-create-overview" aria-label="Create trade workspace">
        <div className="p2p-create-overview-head">
          <div className="p2p-create-tabs">{tradeViewTabs}</div>
          <div className="p2p-market-identity">
            <strong>{createDeskIdentity.title}</strong>
            <span>{createDeskIdentity.copy}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="p2p-secondary-nav p2p-secondary-nav-mobile">{tradeViewTabs}</div>
      <section
        className={`p2p-market-overview p2p-market-overview-${marketOverviewClassView}${
          routeSurfaceView === 'mine' && !showTradeSearch ? ' p2p-market-overview-summary-only' : ''
        }`}
      >
        <div className="p2p-market-overview-head">
          <div className="p2p-market-tabs">{tradeViewTabs}</div>

          <div className="p2p-market-identity">
            <strong>{tradeDeskIdentity.title}</strong>
            <span>{tradeDeskIdentity.copy}</span>
          </div>

          {routeSurfaceView === 'public' || routeSurfaceView === 'mine' ? (
            <div className="p2p-stats-strip" aria-label="OTC Desk statistics">
              {routeSurfaceView === 'public' ? (
                <div>
                  <span>Active offers</span>
                  <strong>{openPublicTradeCount}</strong>
                </div>
              ) : null}
              {routeSurfaceView === 'mine' ? (
                <>
                  <div>
                    <span>Needs action</span>
                    <strong>{receivedOpenTradeOfferCount}</strong>
                  </div>
                  <div>
                    <span>My active</span>
                    <strong>{myOpenTradeCount}</strong>
                  </div>
                  <div>
                    <span>History</span>
                    <strong>{walletTradeHistoryCount}</strong>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {showTradeSearch ? (
          <div
            className={[
              'p2p-filter-bar',
              mobileTradeFiltersOpen ? 'p2p-filter-bar-open' : '',
              activeAdvancedTradeFilterCount > 0 ? 'p2p-filter-bar-advanced-active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label="Offer filters"
          >
            <label className="p2p-token-search p2p-filter-search">
              <span className="p2p-token-search-head">
                <span className="p2p-token-search-label">Find offers</span>
                {hasActiveDeskFilters ? <small>{tradeSearchSummary}</small> : null}
              </span>
              <span className="p2p-token-search-input-wrap">
                <input
                  type="search"
                  value={tradeSearchInput}
                  onChange={(event) => onSearchInputChange(event.target.value)}
                  placeholder={tradeSearchPlaceholder}
                />
                {tradeSearchInput ? (
                  <button type="button" onClick={onClearSearch} aria-label="Clear trade search">
                    Clear
                  </button>
                ) : null}
              </span>
            </label>
            <button
              type="button"
              className="p2p-mobile-filter-toggle"
              onClick={onToggleMobileFilters}
              aria-expanded={mobileTradeFiltersOpen}
              aria-controls="p2p-advanced-trade-filters"
            >
              <SlidersHorizontal size={14} strokeWidth={2.4} aria-hidden="true" />
              <span>Filters</span>
              {activeAdvancedTradeFilterCount > 0 ? <strong>{activeAdvancedTradeFilterCount}</strong> : null}
            </button>
            <div className="p2p-advanced-filter-panel" id="p2p-advanced-trade-filters">
              <label className="p2p-filter-select p2p-filter-pair">
                <span>Pair</span>
                <select value={tradePairFilter} onChange={(event) => onPairFilterChange(event.target.value)}>
                  {tradePairFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="p2p-filter-select p2p-filter-type">
                <span>Type</span>
                <select value={tradeTypeFilter} onChange={(event) => onTypeFilterChange(event.target.value)}>
                  {tradeTypeFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="p2p-filter-select p2p-filter-sort">
                <span>Sort</span>
                <select value={tradeSortMode} onChange={(event) => onSortModeChange(event.target.value)}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="expiring">Expiring soon</option>
                  <option value="most-active">Most active</option>
                </select>
              </label>
              <button
                type="button"
                className="p2p-filter-clear"
                onClick={onClearFilters}
                disabled={!hasActiveDeskFilters}
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}

        {walletError || tradeActionError ? <p className="error p2p-market-status">{walletError || tradeActionError}</p> : null}
      </section>
    </>
  );
}
