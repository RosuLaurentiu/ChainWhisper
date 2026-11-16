import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TradeMarketOverviewPanel from './TradeMarketOverviewPanel';
import { P2P_WALLET_REQUIRED_MESSAGE } from '../p2pWalletNotice';

// CW-097. The status line above the P2P panels shows a missing wallet session as a neutral note and
// keeps the error style for real errors.
const markup = (tradeActionError: string, walletError = '') => renderToStaticMarkup(<TradeMarketOverviewPanel
  isComposerRoute={false} marketOverviewClassView="mine" tradeViewTabs={null}
  createDeskIdentity={{ title: 'Create offer', copy: '' }} tradeDeskIdentity={{ title: 'My trades', copy: '' }}
  openPublicTradeCount={0} receivedOpenTradeOfferCount={0} myOpenTradeCount={0} walletTradeHistoryCount={0}
  walletError={walletError} tradeActionError={tradeActionError} />);

describe('P2P status line', () => {
  it('shows a missing wallet session as a neutral note', () => {
    const html = markup(P2P_WALLET_REQUIRED_MESSAGE);
    expect(html).toContain(`<p class="p2p-market-status p2p-market-status-note">${P2P_WALLET_REQUIRED_MESSAGE}</p>`);
    expect(html).not.toContain('class="error p2p-market-status"');
  });

  it('keeps the error style for other messages and shows nothing without a message', () => {
    expect(markup('Trade history read failed.')).toContain('<p class="error p2p-market-status">Trade history read failed.</p>');
    expect(markup('', 'Wallet request rejected.')).toContain('<p class="error p2p-market-status">Wallet request rejected.</p>');
    expect(markup('')).not.toContain('p2p-market-status');
  });
});
