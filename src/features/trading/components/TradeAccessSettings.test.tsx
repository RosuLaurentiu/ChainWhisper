import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TradeAccessSettings from './TradeAccessSettings';

const render = (tradeVisibility: 'public' | 'unlisted' | 'direct') => renderToStaticMarkup(createElement(
  TradeAccessSettings,
  {
    disabled: false,
    directTradeRecipient: tradeVisibility === 'direct' ? '0x2222222222222222222222222222222222222222' : '',
    directTradeRecipientIsValid: tradeVisibility === 'direct',
    directTradeRecipientNormalized: tradeVisibility === 'direct'
      ? '0x2222222222222222222222222222222222222222'
      : '',
    onDirectTradeRecipientChange: vi.fn(),
    onTradeVisibilityChange: vi.fn(),
    tradeVisibility
  }
));

describe('TradeAccessSettings', () => {
  it('presents the three audience choices without repeating the amount-privacy model', () => {
    const markup = render('public');

    expect(markup).toContain('>Access<');
    expect(markup).not.toContain('Access is separate from whether the order amounts are public or private.');
    expect(markup).toContain('Public offer');
    expect(markup).toContain('Private link');
    expect(markup).toContain('Direct proposal');
  });

  it('keeps the private-link UI selectable while the final contract step is pending', () => {
    const markup = render('unlisted');

    expect(markup).toContain('Shareable link');
    expect(markup).not.toContain('Anyone with the link can review and fill it');
    expect(markup).not.toContain('Contract activation pending');
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<svg[^>]*>.*Private link/s);
  });

  it('shows the recipient input only for a direct proposal', () => {
    const publicMarkup = render('public');
    const directMarkup = render('direct');

    expect(publicMarkup).not.toContain('Recipient wallet');
    expect(directMarkup).toContain('Recipient wallet');
    expect(directMarkup).not.toContain('Only 0x2222...2222 can fill this proposal');
  });
});
