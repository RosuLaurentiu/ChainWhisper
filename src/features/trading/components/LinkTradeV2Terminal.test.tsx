import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import type { LinkTradeV2Review } from '../../../lib/linkTradeV2';
import LinkTradeV2Terminal, { LinkTradeV2ReviewDetails } from './LinkTradeV2Terminal';

const reference = { chainId: '7082400', escrow: `0x${'11'.repeat(20)}`,
  id: ((1n << 256n) - 1n).toString(), revision: '2', credentialEpoch: '1' };
const secret = `0x${'ab'.repeat(32)}`, a = `0x${'22'.repeat(20)}`, b = `0x${'33'.repeat(20)}`;
const review = { reference, terms: { offerToken: a, requestToken: b, privatePair: true,
  priceOffer: '1000000', priceRequest: '1500000', expiresAt: '0' } } as LinkTradeV2Review;
const token = (address: string, symbol: string): TradeCustomTokenInfo => ({
  address, symbol, kind: 'private-erc20', decimals: 6, balanceWei: null, loading: false
});
const tokens = { [buildTradeCustomTokenInfoKey('private-erc20', a)]: token(a, 'HBR'),
  [buildTradeCustomTokenInfoKey('private-erc20', b)]: token(b, 'BCN') };

describe('Link trade review presentation', () => {
  it('reports missing credentials or deployment honestly without showing a legacy ID prompt', () => {
    const missing = renderToStaticMarkup(createElement(LinkTradeV2Terminal, { reference, secret: '', tokenInfoByKey: {} }));
    expect(missing).toContain('full Share link');
    const inactive = renderToStaticMarkup(createElement(LinkTradeV2Terminal, { reference, secret, tokenInfoByKey: {} }));
    expect(inactive).toContain('not available in this App deployment');
    expect(inactive).not.toContain(secret);
    expect(inactive).not.toContain('trade id');
  });
  it('shows exact token-aware price points and keeps technical identity under details', () => {
    const html = renderToStaticMarkup(createElement(LinkTradeV2ReviewDetails, { review, tokenInfoByKey: tokens }));
    expect(html).toContain('1.0 HBR for 1.5 BCN');
    expect(html).toContain('Private trade');
    expect(html).toContain('Partial fills');
    expect(html).toContain('<summary>Trade details</summary>');
    expect(html).toContain(reference.id);
    expect(html).not.toContain(secret);
    expect(html).not.toContain('Balance: 0');
  });
  it('can load shared-Link review through the read-only resolver while submissions remain unavailable', () => {
    const html = renderToStaticMarkup(createElement(LinkTradeV2Terminal, { reference, secret, tokenInfoByKey: {},
      resolveReadContext: async () => { throw new Error('The server render must not make a chain request.'); } }));
    expect(html).toContain('Loading shared trade');
    expect(html).not.toContain('not available in this App deployment'); expect(html).not.toContain(secret);
  });
  it('does not guess price units when token metadata is unavailable or invalid', () => {
    const html = renderToStaticMarkup(createElement(LinkTradeV2ReviewDetails, { review, tokenInfoByKey: {} }));
    expect(html).toContain('Token details unavailable');
    expect(html).not.toContain('1000000');
    const invalid = { ...tokens, [buildTradeCustomTokenInfoKey('private-erc20', a)]: { ...token(a, 'HBR'), decimals: 999 } };
    expect(renderToStaticMarkup(createElement(LinkTradeV2ReviewDetails, { review, tokenInfoByKey: invalid })))
      .not.toContain('1.0 HBR');
  });
});
