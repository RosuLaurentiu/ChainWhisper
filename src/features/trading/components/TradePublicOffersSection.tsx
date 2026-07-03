import type { TradeSnapshot } from '../../../lib/appShared';
import {
  renderDeskLoadingSkeletons,
  renderP2PEmptyState
} from './P2PTradingPage.helpers';
import { TradeOrderList, type TradeOrderCardProps } from './TradeOrderLists';

type TradePublicOffersSectionProps = TradeOrderCardProps & {
  filteredPublicTrades: TradeSnapshot[];
  hasActiveDeskFilters: boolean;
  loadingPublicTrades: boolean;
  publicTradesCount: number;
  publicTradesError: string;
  selectedTradeKey: string;
  onClearFilters: () => void;
  onCreateOffer: () => void;
  onRefreshPublicTrades: () => void;
};

export default function TradePublicOffersSection({
  filteredPublicTrades,
  hasActiveDeskFilters,
  loadingPublicTrades,
  publicTradesCount,
  publicTradesError,
  selectedTradeKey,
  onClearFilters,
  onCreateOffer,
  onRefreshPublicTrades,
  ...tradeOrderCardProps
}: TradePublicOffersSectionProps) {
  return (
    <section className="standalone-trades-section p2p-public-trades-section">
      <div className="standalone-trades-section-head">
        <div>
          <h2>Active offers</h2>
        </div>
        <div className="standalone-trades-toolbar">
          <button type="button" className="standalone-trade-secondary-btn" onClick={onRefreshPublicTrades}>
            {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
      {publicTradesError
        ? renderP2PEmptyState(
            'Desk refresh failed',
            publicTradesError,
            <button type="button" onClick={onRefreshPublicTrades} disabled={loadingPublicTrades}>
              {loadingPublicTrades ? 'Refreshing...' : 'Retry'}
            </button>,
            'error'
          )
        : null}
      {loadingPublicTrades && publicTradesCount === 0 ? renderDeskLoadingSkeletons() : null}
      {(!publicTradesError || publicTradesCount > 0) && (!loadingPublicTrades || publicTradesCount > 0)
        ? (
          <TradeOrderList
            trades={filteredPublicTrades}
            emptyLabel={hasActiveDeskFilters ? 'No offers match those filters.' : 'No active offers found.'}
            gridClassName="p2p-public-trade-grid"
            selectedTradeKey={selectedTradeKey}
            emptyState={renderP2PEmptyState(
              hasActiveDeskFilters ? 'No matching offers' : 'No active offers right now',
              hasActiveDeskFilters
                ? 'Clear filters or try another token, wallet, status, or trade id.'
                : 'The desk is live, but there are no public offers to review yet.',
              hasActiveDeskFilters ? (
                <>
                  <button type="button" onClick={onClearFilters}>
                    Clear filters
                  </button>
                  <button type="button" onClick={onRefreshPublicTrades} disabled={loadingPublicTrades}>
                    {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={onCreateOffer}>
                    Create Offer
                  </button>
                  <button type="button" onClick={onRefreshPublicTrades} disabled={loadingPublicTrades}>
                    {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
                  </button>
                </>
              )
            )}
            {...tradeOrderCardProps}
          />
        )
        : null}
    </section>
  );
}
