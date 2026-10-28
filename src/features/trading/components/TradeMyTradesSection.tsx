import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useState, type KeyboardEventHandler, type ReactNode } from 'react';
import type { TradeSnapshot } from '../../../lib/appShared';
import { moveFocusWithin } from '../../../shared/components/a11y';
import {
  MY_TRADES_EMPTY_PREVIEW_GROUPS,
  renderP2PEmptyState,
  type MyTradeGroupView
} from './P2PTradingPage.helpers';
import { TradeMyOrderList, type TradeOrderCardProps } from './TradeOrderLists';

export type MyTradeGroupOption = {
  id: MyTradeGroupView;
  label: string;
  mobileLabel: string;
  subLabel: string;
  description: string;
  count: number;
  trades: TradeSnapshot[];
  emptyTitle: string;
  emptyDescription: string;
  emptySearchTitle: string;
  emptySearchMessage: string;
};

type TradeMyTradesSectionProps = TradeOrderCardProps & {
  walletAddress: string;
  loadingMyTrades: boolean;
  myTradesCount: number;
  myTradesError: string;
  privateTradesLocked?: boolean;
  myTradeGroupOptions: MyTradeGroupOption[];
  selectedMyTradeGroup: MyTradeGroupOption;
  selectedTradeKey: string;
  hasActiveDeskFilters: boolean;
  mobileTradeFiltersOpen: boolean;
  activeAdvancedTradeFilterCount: number;
  tradeSearchSummary: string;
  tradeSearchInput: string;
  tradeSearchPlaceholder: string;
  tradeTypeFilter: string;
  tradeTypeFilterOptions: Array<{ value: string; label: string }>;
  tradeSortMode: string;
  canOpenMyTradeTerminal: (trade: TradeSnapshot, groupId: MyTradeGroupView) => boolean;
  openMyTradeTerminal: (trade: TradeSnapshot) => void;
  onRefreshMyTrades: () => void;
  onSelectGroup: (groupId: MyTradeGroupView) => void;
  currentPairLabel: string;
  pairScope: 'current' | 'all';
  onPairScopeChange: (scope: 'current' | 'all') => void;
  onClearFilters: () => void;
  onSearchInputChange: (value: string) => void;
  onClearSearch: () => void;
  onToggleMobileFilters: () => void;
  onTypeFilterChange: (value: string) => void;
  onSortModeChange: (value: string) => void;
  onCreateOffer: () => void;
  additionalActiveCount?: number; additionalReceivedCount?: number; additionalHistoryCount?: number; additionalPending?: boolean;
  renderAdditionalTrades?: (lifecycle: 'active' | 'history', filter: 'all' | 'received' | 'active') => ReactNode;
};

const DisconnectedMyTradesState = () => (
  <div className="p2p-my-trades-empty-workspace">
    <section className="p2p-my-trades-wallet-card" aria-label="Wallet readiness">
      <div>
        <strong>Connect your trading wallet</strong>
        <p>Connect in the header, then unlock privacy to view your trades.</p>
      </div>
    </section>
    <div className="p2p-my-trades-empty-preview" aria-label="Orders groups preview">
      {MY_TRADES_EMPTY_PREVIEW_GROUPS.map((group) => (
        <article key={group.label} className="p2p-my-trades-empty-slot" aria-disabled="true">
          <div>
            <span>{group.label}</span>
            <strong>—</strong>
          </div>
          <p>{group.description}</p>
        </article>
      ))}
    </div>
  </div>
);

export default function TradeMyTradesSection({
  walletAddress,
  loadingMyTrades,
  myTradesCount,
  myTradesError,
  privateTradesLocked = false,
  myTradeGroupOptions,
  selectedMyTradeGroup,
  selectedTradeKey,
  hasActiveDeskFilters,
  mobileTradeFiltersOpen,
  activeAdvancedTradeFilterCount,
  tradeSearchSummary,
  tradeSearchInput,
  tradeSearchPlaceholder,
  tradeTypeFilter,
  tradeTypeFilterOptions,
  tradeSortMode,
  canOpenMyTradeTerminal,
  openMyTradeTerminal,
  onRefreshMyTrades,
  onSelectGroup,
  currentPairLabel,
  pairScope,
  onPairScopeChange,
  onClearFilters,
  onSearchInputChange,
  onClearSearch,
  onToggleMobileFilters,
  onTypeFilterChange,
  onSortModeChange,
  onCreateOffer,
  additionalActiveCount = 0, additionalReceivedCount = 0, additionalHistoryCount = 0, additionalPending = false, renderAdditionalTrades,
  ...tradeOrderCardProps
}: TradeMyTradesSectionProps) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'received' | 'active'>('all');
  const receivedGroup = myTradeGroupOptions.find((group) => group.id === 'received');
  const activeGroup = myTradeGroupOptions.find((group) => group.id === 'active');
  const historyGroup = myTradeGroupOptions.find((group) => group.id === 'history');
  const activeCount = (receivedGroup?.count ?? 0) + (activeGroup?.count ?? 0) + additionalActiveCount;
  const lifecycleView = selectedMyTradeGroup.id === 'history' ? 'history' : 'active';
  const totalsUnavailable = privateTradesLocked || loadingMyTrades || Boolean(myTradesError) || additionalPending;
  const displayCount = (count: number) => totalsUnavailable ? '—' : count;
  const showConsolidatedActiveEmpty =
    lifecycleView === 'active' && activeFilter === 'all' && activeCount === 0 && !hasActiveDeskFilters && !totalsUnavailable;
  const visibleActiveGroups = useMemo(() => {
    if (activeFilter === 'received') return receivedGroup ? [receivedGroup] : [];
    if (activeFilter === 'active') return activeGroup ? [activeGroup] : [];
    return [receivedGroup, activeGroup].filter((group): group is MyTradeGroupOption => Boolean(group));
  }, [activeFilter, activeGroup, receivedGroup]);

  const showActive = () => {
    const fallback = receivedGroup?.count ? receivedGroup : activeGroup ?? receivedGroup;
    if (fallback) onSelectGroup(fallback.id);
  };
  const emptyState = (
    <div className="p2p-wallet-trade-empty">
      <span>{selectedMyTradeGroup.label}</span>
      <strong>
        {hasActiveDeskFilters ? selectedMyTradeGroup.emptySearchTitle : selectedMyTradeGroup.emptyTitle}
      </strong>
      <p>
        {hasActiveDeskFilters
          ? 'Clear filters or try another token, wallet, status, or id.'
          : selectedMyTradeGroup.emptyDescription}
      </p>
      {hasActiveDeskFilters ? (
        <button type="button" onClick={onClearFilters}>
          Clear filters
        </button>
      ) : selectedMyTradeGroup.id === 'active' ? (
        <button type="button" onClick={onCreateOffer}>
          Create Offer
        </button>
      ) : null}
    </div>
  );
  const handleGroupKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (
      !moveFocusWithin(event, {
        orientation: 'horizontal',
        selector: '[role="tab"]:not(:disabled)'
      })
    ) {
      return;
    }

    const nextGroupId = (
      event.currentTarget.ownerDocument.activeElement as HTMLElement | null
    )?.dataset.tradeGroup;
    if (nextGroupId === 'active') showActive();
    if (nextGroupId === 'history' && historyGroup) onSelectGroup(historyGroup.id);
  };

  const renderTradeGroup = (group: MyTradeGroupOption) => {
    const groupEmptyState = (
      <div className="p2p-wallet-trade-empty">
        <span>{group.label}</span>
        <strong>{hasActiveDeskFilters ? group.emptySearchTitle : group.emptyTitle}</strong>
        <p>
          {hasActiveDeskFilters
            ? 'Clear filters or try another token, wallet, status, or id.'
            : group.emptyDescription}
        </p>
        {hasActiveDeskFilters ? (
          <button type="button" onClick={onClearFilters}>Clear filters</button>
        ) : group.id === 'active' ? (
          <button type="button" onClick={onCreateOffer}>Create Offer</button>
        ) : null}
      </div>
    );

    return (
      <section className="p2p-management-group-block" key={group.id} aria-label={`${group.label} trades`}>
        {lifecycleView === 'active' && activeFilter === 'all' ? (
          <header className="p2p-management-group-head">
            <div>
              <strong>{group.id === 'received' ? 'Incoming' : 'Made by me'}</strong>
              <span>{group.description}</span>
            </div>
            <b>{displayCount(group.count)}</b>
          </header>
        ) : null}
        <TradeMyOrderList
          trades={group.trades}
          groupId={group.id}
          emptyLabel={hasActiveDeskFilters ? group.emptySearchMessage : group.emptyTitle}
          emptyState={groupEmptyState}
          selectedTradeKey={selectedTradeKey}
          walletAddress={walletAddress}
          canOpenMyTradeTerminal={canOpenMyTradeTerminal}
          openMyTradeTerminal={openMyTradeTerminal}
          {...tradeOrderCardProps}
        />
      </section>
    );
  };

  return (
    <section
      className={`standalone-trades-section p2p-my-trades-section${
        walletAddress ? '' : ' p2p-my-trades-section-disconnected'
      }`}
      aria-label={walletAddress ? 'My trades' : 'Connect your trading wallet'}
    >
      <div className="standalone-trades-section-head p2p-my-trades-section-head">
        <div>
          <h2>My trades</h2>
          {walletAddress ? <p>Received offers, active orders, and completed trades.</p> : null}
        </div>
        <div className="p2p-my-trades-head-actions">
          <button type="button" className="p2p-my-trades-create-btn" onClick={onCreateOffer}>
            New offer
          </button>
          {walletAddress ? (
            <button
              type="button"
              className="standalone-trade-secondary-btn p2p-my-trades-refresh-btn"
              onClick={onRefreshMyTrades}
              aria-busy={loadingMyTrades}
            >
              {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
            </button>
          ) : null}
        </div>
      </div>
      {walletAddress ? (
        <div
          className={[
            'p2p-filter-bar',
            'p2p-my-trades-filter-bar',
            mobileTradeFiltersOpen ? 'p2p-filter-bar-open' : '',
            activeAdvancedTradeFilterCount > 0 ? 'p2p-filter-bar-advanced-active' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label="My trade search and filters"
        >
          <label className="p2p-token-search p2p-filter-search" id="p2p-my-trades-search">
            <span className="p2p-token-search-head">
              <span className="p2p-token-search-label">Search trades</span>
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
            aria-controls="p2p-my-trades-search p2p-advanced-trade-filters"
          >
            <SlidersHorizontal size={14} strokeWidth={2.4} aria-hidden="true" />
            <span>Search &amp; filters</span>
            {activeAdvancedTradeFilterCount > 0 ? <strong>{activeAdvancedTradeFilterCount}</strong> : null}
          </button>
          <div className="p2p-advanced-filter-panel" id="p2p-advanced-trade-filters">
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
            <button type="button" className="p2p-filter-clear" onClick={onClearFilters} disabled={!hasActiveDeskFilters}>
              Reset
            </button>
          </div>
        </div>
      ) : null}
      {!walletAddress ? <DisconnectedMyTradesState /> : null}
      {walletAddress && privateTradesLocked ? <p role="status">Private trades are locked. Unlock privacy in the header.</p> : null}
      {myTradesError
        ? renderP2PEmptyState(
            renderAdditionalTrades ? 'Some trades could not load' : 'My trades could not load',
            'Refresh to try again.',
            <details className="p2p-inline-diagnostics"><summary>Technical details</summary><p>{myTradesError}</p></details>,
            'error'
          )
        : null}
      {walletAddress && loadingMyTrades && myTradesCount === 0
        ? renderP2PEmptyState(
            'Loading your trades',
            'Checking received offers, active offers, counters, and history.',
            undefined,
            'loading'
          )
        : null}
      {walletAddress && (renderAdditionalTrades || (!myTradesError || myTradesCount > 0) && (!loadingMyTrades || myTradesCount > 0)) ? (
        <div className="p2p-wallet-trade-groups">
          <div className="p2p-management-scope-row">
            <div className="p2p-management-pair-scope" role="group" aria-label="Trade pair scope">
              <button
                type="button"
                className={pairScope === 'current' ? 'active' : undefined}
                aria-pressed={pairScope === 'current'}
                onClick={() => onPairScopeChange('current')}
              >
                <span>Current pair</span>
                <strong>{currentPairLabel}</strong>
              </button>
              <button
                type="button"
                className={pairScope === 'all' ? 'active' : undefined}
                aria-pressed={pairScope === 'all'}
                onClick={() => onPairScopeChange('all')}
              >
                All pairs
              </button>
            </div>
          </div>
          <div
            className="p2p-wallet-trade-switcher p2p-management-lifecycle"
            role="tablist"
            aria-label="Trade lifecycle"
            onKeyDown={handleGroupKeyDown}
          >
            <button
              type="button"
              className={lifecycleView === 'active' ? 'active' : undefined}
              onClick={showActive}
              role="tab"
              aria-selected={lifecycleView === 'active'}
              tabIndex={lifecycleView === 'active' ? 0 : -1}
              data-trade-group="active"
              aria-label={`Active: ${totalsUnavailable ? 'unavailable' : activeCount}`}
            >
              <span className="p2p-wallet-trade-tab-text"><span>Active</span><small>Open and actionable</small></span>
              <strong className="p2p-wallet-trade-count">{displayCount(activeCount)}</strong>
            </button>
            <button
              type="button"
              className={lifecycleView === 'history' ? 'active' : undefined}
              onClick={() => historyGroup && onSelectGroup(historyGroup.id)}
              role="tab"
              aria-selected={lifecycleView === 'history'}
              tabIndex={lifecycleView === 'history' ? 0 : -1}
              data-trade-group="history"
              aria-label={`History: ${totalsUnavailable ? 'unavailable' : (historyGroup?.count ?? 0) + additionalHistoryCount}`}
            >
              <span className="p2p-wallet-trade-tab-text"><span>History</span><small>{renderAdditionalTrades ? 'Trade activity' : 'Completed and closed'}</small></span>
              <strong className="p2p-wallet-trade-count">{displayCount((historyGroup?.count ?? 0) + additionalHistoryCount)}</strong>
            </button>
          </div>
          {lifecycleView === 'active' ? (
            <div className="p2p-management-quick-filters" role="group" aria-label="Active trade filters">
              <button type="button" className={activeFilter === 'all' ? 'active' : undefined} aria-pressed={activeFilter === 'all'} onClick={() => setActiveFilter('all')}>All <strong>{displayCount(activeCount)}</strong></button>
              <button type="button" className={activeFilter === 'received' ? 'active' : undefined} aria-pressed={activeFilter === 'received'} onClick={() => { setActiveFilter('received'); if (receivedGroup) onSelectGroup(receivedGroup.id); }}>Incoming <strong>{displayCount((receivedGroup?.count ?? 0) + additionalReceivedCount)}</strong></button>
              <button type="button" className={activeFilter === 'active' ? 'active' : undefined} aria-pressed={activeFilter === 'active'} onClick={() => { setActiveFilter('active'); if (activeGroup) onSelectGroup(activeGroup.id); }}>Made by me <strong>{displayCount((activeGroup?.count ?? 0) + additionalActiveCount - additionalReceivedCount)}</strong></button>
            </div>
          ) : null}
          <section className="p2p-wallet-trade-group" role="tabpanel" aria-label={`${lifecycleView === 'active' ? 'Active' : 'History'} trades`}>
            {lifecycleView === 'history'
              ? historyGroup ? historyGroup.count > 0 || !additionalHistoryCount && !totalsUnavailable ? renderTradeGroup(historyGroup) : null : totalsUnavailable ? null : emptyState
              : showConsolidatedActiveEmpty
                ? (
                  <div className="p2p-wallet-trade-empty p2p-management-empty-summary">
                    <span>Active trades</span>
                    <strong>No active trades</strong>
                    <p>Received offers and open trades will appear here.</p>
                  </div>
                )
                : visibleActiveGroups.filter(group => group.count > 0 || !renderAdditionalTrades && !totalsUnavailable).map(renderTradeGroup)}
            {renderAdditionalTrades?.(lifecycleView, activeFilter)}
          </section>
        </div>
      ) : null}
    </section>
  );
}
