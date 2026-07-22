import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPathForAppPage,
  getTitleForAppPage,
  resolveAppRouteFromLocation,
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

    stubLocation('/home');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'home' });
  });

  it('returns clearer canonical page paths', () => {
    expect(getPathForAppPage('chat')).toBe('/chat');
    expect(getPathForAppPage('swap')).toBe('/portal');
    expect(getPathForAppPage('treasury')).toBe('/treasury');
    expect(getPathForAppPage('trades')).toBe('/otc');
  });

  it('returns page titles for document title updates', () => {
    expect(getTitleForAppPage('home')).toBe('ChainWhisper');
    expect(getTitleForAppPage('chat')).toBe('Encrypted Chat | ChainWhisper');
    expect(getTitleForAppPage('swap')).toBe('Privacy Portal | ChainWhisper');
    expect(getTitleForAppPage('trades')).toBe('OTC Desk | ChainWhisper');
    expect(getTitleForAppPage('treasury')).toBe('Treasury Data | ChainWhisper');
  });

  it('keeps old trade links while using OTC as the friendly route', () => {
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
