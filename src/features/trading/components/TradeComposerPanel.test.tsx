import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TradeComposerPanel from './TradeComposerPanel';

const render = (tradeVisibility: 'public' | 'unlisted' | 'direct', overrides: Partial<ComponentProps<typeof TradeComposerPanel>> = {}) => {
  const props = {
    feeMode: 'coti', onFeeModeChange: vi.fn(), feeSummaryLabel: 'Fee',
    offerTokenOptions: [], requestTokenOptions: [], offerTokenSelection: '', requestTokenSelection: '',
    onOfferTokenSelectionChange: vi.fn(), onRequestTokenSelectionChange: vi.fn(),
    offerCustomAddress: '', requestCustomAddress: '', onOfferCustomAddressChange: vi.fn(),
    onRequestCustomAddressChange: vi.fn(), offerCustomMetaLabel: '', requestCustomMetaLabel: '',
    offerAmountInput: '', requestAmountInput: '', onOfferAmountInputChange: vi.fn(),
    onRequestAmountInputChange: vi.fn(), offerAmountSummaryLabel: '', requestAmountSummaryLabel: '',
    offerBalanceSummaryLabel: '', expiresHoursInput: '24', onExpiresHoursInputChange: vi.fn(),
    privateTokenAmounts: true, hidePrivateLiquidity: true, canHidePrivateLiquidity: true, onHidePrivateLiquidityChange: vi.fn(),
    sending: false, canSend: false, onSendTradeOffer: vi.fn(), tradeVisibility, ...overrides
  } satisfies ComponentProps<typeof TradeComposerPanel> & { tradeVisibility: 'public' | 'unlisted' | 'direct' };
  return renderToStaticMarkup(createElement(TradeComposerPanel, props));
};

describe('TradeComposerPanel privacy copy', () => {
  it.each(['public', 'unlisted', 'direct'] as const)('keeps unsupported visible private amounts disabled for %s creation', visibility => {
    const markup = render(visibility);
    expect(markup).not.toMatch(/<button[^>]*>Visible amounts<\/button>/);
    expect(markup).toContain('after creation in Manage offer');
  });

  it('keeps ordinary public-token amounts visible', () => {
    const markup = render('public', { privateTokenAmounts: false, hidePrivateLiquidity: false, canHidePrivateLiquidity: false });
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Visible amounts<\/button>/);
  });

  it('describes private counter terms without using the legacy budget toggle state', () => {
    const markup = render('direct', { hidePrivateLiquidity: false, canHidePrivateLiquidity: false });
    expect(markup).toContain('Encrypted offer terms');
    expect(markup).toContain('Offer terms are encrypted on-chain');
    expect(markup).not.toContain('Amounts visible');
    expect(markup).not.toContain('trade-compose-privacy-panel-disabled');
    expect(markup).not.toMatch(/<button[^>]*>(Hide budget|Visible amounts)<\/button>/);
  });

  it('describes private in-chat offers without requiring a budget toggle callback', () => {
    const markup = render('direct', { hidePrivateLiquidity: false, canHidePrivateLiquidity: false, onHidePrivateLiquidityChange: undefined });
    expect(markup).toContain('Encrypted offer terms');
    expect(markup).not.toContain('Visible amounts');
  });

  it('requires an explicit hidden-budget choice for a retained visible private draft', () => {
    const markup = render('public', { hidePrivateLiquidity: false, canSend: true });
    expect(markup).toContain('Choose hidden budget');
    expect(markup).not.toContain('Private-token budget hidden');
    expect(markup).not.toMatch(/<button[^>]*>Visible amounts<\/button>/);
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Hide budget<\/button>/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Send Trade<\/button>/);
  });
  it('says that the book price is public', () => {
    expect(render('public')).toContain('Public views show the price ratio');
  });

  it.each(['unlisted', 'direct'] as const)('describes encrypted terms for %s', (visibility) => {
    const markup = render(visibility);
    expect(markup).toContain('Offer terms are encrypted on-chain');
    expect(markup).toContain('Public-token transfers can reveal amounts');
    expect(markup).toContain('Review the agreed terms before signing');
    expect(markup).not.toContain('Public views show the price ratio');
    expect(markup).not.toContain('Publish only the ratio');
  });
});
