import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPathForAppPage,
  getTitleForAppPage,
  resolveAppRouteFromLocation,
  resolveCanonicalTradingPath,
  resolveNavigationPathFromLocation,
  stripStaleTradeSearchParams
} from './routing';

const stubLocation = (pathname: string, search = '', hash = '') => {
  vi.stubGlobal('window', {
    location: {
      hash,
      origin: 'https://chainwhisper.example',
      pathname,
      search
    }
  });
};

describe('app routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the domain root as the canonical home route', () => {
    expect(getPathForAppPage('home')).toBe('/');
    stubLocation('/');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'home' });
  });

  it('keeps legacy links as aliases for renamed pages', () => {
    stubLocation('/portal');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'swap' });

    stubLocation('/swap');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'swap' });

    stubLocation('/treasury');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'treasury' });

    stubLocation('/treasury-data');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'treasury' });

    stubLocation('/private-tvl');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'treasury' });

    stubLocation('/tvl');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'treasury' });

    stubLocation('/home');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'home' });
  });

  it('returns clearer canonical page paths', () => {
    expect(getPathForAppPage('chat')).toBe('/chat');
    expect(getPathForAppPage('swap')).toBe('/portal');
    expect(getPathForAppPage('dex')).toBe('/dex');
    expect(getPathForAppPage('treasury')).toBe('/tvl');
    expect(getPathForAppPage('trades')).toBe('/otc/desk');
  });

  it('returns page titles for document title updates', () => {
    expect(getTitleForAppPage('home')).toBe('ChainWhisper');
    expect(getTitleForAppPage('chat')).toBe('Encrypted Chat | ChainWhisper');
    expect(getTitleForAppPage('swap')).toBe('Privacy Portal | ChainWhisper');
    expect(getTitleForAppPage('dex')).toBe('Private DEX | ChainWhisper');
    expect(getTitleForAppPage('trades')).toBe('Trading | ChainWhisper');
    expect(getTitleForAppPage('treasury')).toBe('COTI Private TVL | ChainWhisper');
  });

  it('keeps routed DEX separate from OTC trade links', () => {
    stubLocation('/dex');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'dex' });

    stubLocation('/dex/strategies');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'dex' });

    stubLocation('/otc');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });

    stubLocation('/otc/orders');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });

    stubLocation('/otc/order/link/abc');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });

    stubLocation('/otcdesk');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });

    stubLocation('/otcdesk/mytrades');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });

    stubLocation('/trades');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });

    stubLocation('/trades/l/abc');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });
  });

  it('moves legacy DEX workspaces to the new DEX routes', () => {
    expect(resolveCanonicalTradingPath('/otc')).toBe('/otc/desk');
    expect(resolveCanonicalTradingPath('/otcdesk')).toBe('/otc/desk');
    expect(resolveCanonicalTradingPath('/dex/desk')).toBe('/dex/strategies');
    expect(resolveCanonicalTradingPath('/dex/orders/position/7')).toBe('/dex/positions');
    expect(resolveCanonicalTradingPath('/otc/pools/create')).toBe('/dex/positions');

    stubLocation('/otc/pools');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'dex' });
  });

  it('resolves stable trade shell URLs through the redirected path', () => {
    stubLocation('/trades', `?p=${encodeURIComponent('/trades/l/abc?escrow=direct')}`);

    expect(resolveNavigationPathFromLocation()).toBe('/trades/l/abc?escrow=direct');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });
  });

  it('resolves wallet bootstrap trade URLs through the redirected path', () => {
    stubLocation('/wallet-connect', `?p=${encodeURIComponent('/trades/l/abc?escrow=direct')}`);

    expect(resolveNavigationPathFromLocation()).toBe('/trades/l/abc?escrow=direct');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });
  });

  it('resolves wallet bootstrap chat URLs through the redirected path', () => {
    stubLocation('/wallet-connect', `?p=${encodeURIComponent('/chat')}`);

    expect(resolveNavigationPathFromLocation()).toBe('/chat');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'chat' });
  });

  it('strips stale trade params outside deep trade routes', () => {
    expect(stripStaleTradeSearchParams('/chat', '?order=4&escrow=private&debug=1')).toBe('?debug=1');
    expect(stripStaleTradeSearchParams('/trades', '?order=4&escrow=private')).toBe('');
    expect(stripStaleTradeSearchParams('/otc/order/recurring/4', '?escrow=recurring')).toBe('?escrow=recurring');
    expect(stripStaleTradeSearchParams('/otc/order/link/abc', '?escrow=direct')).toBe('?escrow=direct');
    expect(stripStaleTradeSearchParams('/trades/recurring', '?order=4')).toBe('?order=4');
    expect(stripStaleTradeSearchParams('/trades/l/abc', '?escrow=direct')).toBe('?escrow=direct');
    expect(stripStaleTradeSearchParams('/otcdesk/terminal/recurring', '?order=4')).toBe('?order=4');
    expect(stripStaleTradeSearchParams('/otcdesk/terminal/l/abc', '?escrow=direct')).toBe('?escrow=direct');
  });

  it('falls back safely for invalid wallet bootstrap routes', () => {
    stubLocation('/wallet-connect', `?p=${encodeURIComponent('https://evil.example/chat')}`);

    expect(resolveNavigationPathFromLocation()).toBe('/');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'home' });
  });
});
