import type { KeyboardEventHandler } from 'react';
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
  myTradeGroupOptions: MyTradeGroupOption[];
  selectedMyTradeGroup: MyTradeGroupOption;
  selectedTradeKey: string;
  hasActiveDeskFilters: boolean;
  canOpenMyTradeTerminal: (trade: TradeSnapshot, groupId: MyTradeGroupView) => boolean;
  openMyTradeTerminal: (trade: TradeSnapshot) => void;
  onRefreshMyTrades: () => void;
  onSelectGroup: (groupId: MyTradeGroupView) => void;
  onClearFilters: () => void;
  onCreateOffer: () => void;
};

const DisconnectedMyTradesState = () => (
  <div className="p2p-my-trades-empty-workspace">
    <section className="p2p-my-trades-wallet-card" aria-label="Wallet readiness">
      <div>
        <span>Wallet readiness</span>
        <strong>Connect your trading wallet</strong>
        <p>
          Received offers, active offers, counters, and history will attach to the trading wallet you use here.
        </p>
      </div>
    </section>
    <div className="p2p-my-trades-empty-preview" aria-label="Orders groups preview">
      {MY_TRADES_EMPTY_PREVIEW_GROUPS.map((group) => (
        <article key={group.label} className="p2p-my-trades-empty-slot" aria-disabled="true">
          <div>
            <span>{group.label}</span>
            <strong>0</strong>
          </div>
          <p>{group.description}</p>
          <small>Connect wallet to unlock</small>
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
  myTradeGroupOptions,
  selectedMyTradeGroup,
  selectedTradeKey,
  hasActiveDeskFilters,
  canOpenMyTradeTerminal,
  openMyTradeTerminal,
  onRefreshMyTrades,
  onSelectGroup,
  onClearFilters,
  onCreateOffer,
  ...tradeOrderCardProps
}: TradeMyTradesSectionProps) {
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
  const emptyLabel = hasActiveDeskFilters
    ? selectedMyTradeGroup.emptySearchMessage
    : selectedMyTradeGroup.emptyTitle;
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
    const nextGroup = myTradeGroupOptions.find((group) => group.id === nextGroupId);
    if (nextGroup && nextGroup.id !== selectedMyTradeGroup.id) {
      onSelectGroup(nextGroup.id);
    }
  };

  return (
    <section
      className={`standalone-trades-section p2p-my-trades-section${
        walletAddress ? '' : ' p2p-my-trades-section-disconnected'
      }`}
      aria-label={walletAddress ? 'My trades' : 'Connect your trading wallet'}
    >
      {walletAddress ? (
        <div className="standalone-trades-section-head p2p-my-trades-section-head">
          <div>
            <p className="landing-eyebrow">OTC Desk</p>
            <h2>My trades</h2>
          </div>
          <button
            type="button"
            className="standalone-trade-secondary-btn p2p-my-trades-refresh-btn"
            onClick={onRefreshMyTrades}
            aria-busy={loadingMyTrades}
          >
            {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      ) : null}
      {!walletAddress ? <DisconnectedMyTradesState /> : null}
      {myTradesError
        ? renderP2PEmptyState(
            'My trades could not load',
            walletAddress ? `${myTradesError} Use Refresh in the workspace header to try again.` : myTradesError,
            undefined,
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
      {walletAddress && (!myTradesError || myTradesCount > 0) && (!loadingMyTrades || myTradesCount > 0) ? (
        <div className="p2p-wallet-trade-groups">
          <div
            className="p2p-wallet-trade-switcher"
            role="tablist"
            aria-label="My trade groups"
            onKeyDown={handleGroupKeyDown}
          >
            {myTradeGroupOptions.map((group) => (
              <button
                key={group.id}
                type="button"
                className={group.id === selectedMyTradeGroup.id ? 'active' : undefined}
                onClick={() => onSelectGroup(group.id)}
                role="tab"
                aria-selected={group.id === selectedMyTradeGroup.id}
                tabIndex={group.id === selectedMyTradeGroup.id ? 0 : -1}
                data-trade-group={group.id}
                aria-label={`${group.label}: ${group.count}`}
              >
                <span className="p2p-wallet-trade-tab-text">
                  <span className="p2p-wallet-trade-label-full">{group.label}</span>
                  <span className="p2p-wallet-trade-label-mobile">{group.mobileLabel}</span>
                  <small>{group.subLabel}</small>
                </span>
                <strong className="p2p-wallet-trade-count">{group.count}</strong>
              </button>
            ))}
          </div>
          <section className="p2p-wallet-trade-group" role="tabpanel" aria-label={`${selectedMyTradeGroup.label} trades`}>
            <TradeMyOrderList
              trades={selectedMyTradeGroup.trades}
              groupId={selectedMyTradeGroup.id}
              emptyLabel={emptyLabel}
              emptyState={emptyState}
              selectedTradeKey={selectedTradeKey}
              walletAddress={walletAddress}
              canOpenMyTradeTerminal={canOpenMyTradeTerminal}
              openMyTradeTerminal={openMyTradeTerminal}
              {...tradeOrderCardProps}
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
