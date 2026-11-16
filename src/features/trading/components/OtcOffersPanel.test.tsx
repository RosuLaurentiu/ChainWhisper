import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import OtcOffersPanel from './OtcOffersPanel';
import { P2P_WALLET_REQUIRED_MESSAGE } from '../p2pWalletNotice';

describe('Offers navigation and units', () => {
  it('uses the trade terminal link entry and keeps the complete rate units', () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(<OtcOffersPanel actionMode="buy" linkedActionModes={{buy:false,sell:false}}
      pinnedTrade={null} pinnedTradeKey="" sellTokenSelection="custom" buyTokenSelection="custom" tokenOptions={[]}
      displayQuote={null} bestQuote={null} quoteCandidates={[]} carbonReference={null} priceDisplayInverted={false}
      marketLabel="BCN / HBR" filtersOpen={false} filtersActive={false} filterResultSummary="" loadingOffers={false}
      offersError="" typeFilter="all" typeFilterOptions={[]} onActionModeChange={noop} onToggleFilters={noop}
      onTypeFilterChange={noop} onClearFilters={noop} onRetryOffers={noop} onOpenTradeLink={noop}
      onClearPinnedOrder={noop} onCreateLimitOrder={noop} onOpenQuote={noop} formatAvailability={()=>'Unavailable'} />);
    expect(markup).toContain('Open a private trade link');
    const linkButton = markup.slice(markup.lastIndexOf('<button', markup.indexOf('Open a private trade link')));
    expect(linkButton.startsWith('<button type="button" class="standalone-trade-secondary-btn">')).toBe(true);
    expect(markup).not.toContain('Paste a private trade link');
    expect(markup).not.toContain('<form');
    expect(markup).toMatch(/Rate \(.*\/.*\)/);
    expect(noop).not.toHaveBeenCalled();
  });

  // CW-097. No wallet session is a normal state: a neutral "Wallet needed" note, not the error box.
  const offersMarkup = (offersError: string) => {
    const noop = vi.fn();
    return renderToStaticMarkup(<OtcOffersPanel actionMode="buy" linkedActionModes={{buy:false,sell:false}}
      pinnedTrade={null} pinnedTradeKey="" sellTokenSelection="custom" buyTokenSelection="custom" tokenOptions={[]}
      displayQuote={null} bestQuote={null} quoteCandidates={[]} carbonReference={null} priceDisplayInverted={false}
      marketLabel="BCN / HBR" filtersOpen={false} filtersActive={false} filterResultSummary="" loadingOffers={false}
      offersError={offersError} typeFilter="all" typeFilterOptions={[]} onActionModeChange={noop} onToggleFilters={noop}
      onTypeFilterChange={noop} onClearFilters={noop} onRetryOffers={noop} onOpenTradeLink={noop}
      onClearPinnedOrder={noop} onCreateLimitOrder={noop} onOpenQuote={noop} formatAvailability={()=>'Unavailable'} />);
  };
  it('shows a neutral Wallet needed note without a wallet session and keeps the error box for load failures', () => {
    const waiting = offersMarkup(P2P_WALLET_REQUIRED_MESSAGE);
    expect(waiting).toContain('class="p2p-offers-empty is-note" role="status"');
    expect(waiting).toContain('<strong>Wallet needed</strong>');
    expect(waiting).toContain(P2P_WALLET_REQUIRED_MESSAGE);
    expect(waiting).not.toContain('Offers could not be loaded');
    const failed = offersMarkup('Offer book read failed.');
    expect(failed).toContain('class="p2p-offers-empty is-error" role="alert"');
    expect(failed).toContain('<strong>Offers could not be loaded</strong>');
    expect(failed).toContain('Try again');
  });
});
