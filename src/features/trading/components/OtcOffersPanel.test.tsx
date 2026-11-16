import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import OtcOffersPanel from './OtcOffersPanel';

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
});
