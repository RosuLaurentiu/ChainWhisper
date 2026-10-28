import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CounterTradeV2Controls from './CounterTradeV2Controls';

const owner = `0x${'11'.repeat(20)}`, maker = `0x${'22'.repeat(20)}`;
const render = (privatePair: boolean, privateOnly: boolean, recoveryOnly: boolean, publicOnly = false) => {
  const props = { runtime: { ownerAddress: owner, privateOnly, recoveryOnly, publicOnly }, ownerAddress: owner,
    review: { maker, terms: { privatePair, offerToken: `0x${'33'.repeat(20)}`, requestToken: `0x${'44'.repeat(20)}` } },
    actionInProgress: false, tokenInfoByKey: {}, ensureTokenInfo: vi.fn(), confirmFunding: vi.fn(),
    runWalletFlow: vi.fn(), onBusyChange: vi.fn() } as unknown as ComponentProps<typeof CounterTradeV2Controls>;
  return renderToStaticMarkup(createElement(CounterTradeV2Controls, props));
};

describe('Counter controls follow scoped candidate admission', () => {
  it('keeps private funding out of a public-only runtime', () => {
    expect(render(true, false, false, true)).toBe('');
    expect(render(false, false, false, true)).toContain('Review counter-offer');
  });
  const standard = (options: { native?: boolean; privateOnly?: boolean; mine?: boolean } = {}) => renderToStaticMarkup(createElement(CounterTradeV2Controls, {
    runtime: { ownerAddress: owner, privateOnly: options.privateOnly ?? false, recoveryOnly: false }, ownerAddress: owner,
    bookTrade: { tradeId: 3, status: 'open', maker: options.mine ? owner : maker,
      v2: { protocol: 'standard-v2', chainId: '7082400', contractAddress: `0x${'44'.repeat(20)}`, revision: '2' },
      offer: { kind: options.native ? 'native' : 'erc20', tokenAddress: `0x${'55'.repeat(20)}` },
      request: { kind: 'erc20', tokenAddress: `0x${'66'.repeat(20)}` } },
    actionInProgress: false, tokenInfoByKey: {}, ensureTokenInfo: vi.fn(), confirmFunding: vi.fn(), runWalletFlow: vi.fn(), onBusyChange: vi.fn()
  } as unknown as ComponentProps<typeof CounterTradeV2Controls>));
  it('offers the existing form for another maker’s public ERC20 Book trade', () => {
    expect(standard()).toContain('Review counter-offer');
  });
  it('keeps native parents, own offers and private-only admission out of the public Book form', () => {
    expect(standard({ native: true })).toBe('');
    expect(standard({ mine: true })).toBe('');
    expect(standard({ privateOnly: true })).toBe('');
  });
  it.each([[false, true, false], [true, true, true], [false, false, true]])(
    'does not offer new funding when privatePair=%s privateOnly=%s recoveryOnly=%s', (privatePair, privateOnly, recoveryOnly) => {
      expect(render(privatePair, privateOnly, recoveryOnly)).toBe('');
    });
  it('keeps the private form in qualified private scope and the public form in full admission', () => {
    expect(render(true, true, false)).toContain('Review counter-offer');
    expect(render(false, false, false)).toContain('Review counter-offer');
  });
});
