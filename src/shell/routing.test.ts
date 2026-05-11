import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPathForAppPage, resolveAppRouteFromLocation, resolveNavigationPathFromLocation } from './routing';

const stubLocation = (pathname: string, search = '', hash = '') => {
  vi.stubGlobal('window', {
    location: {
      hash,
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
    stubLocation('/swap');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'swap' });

    stubLocation('/treasury');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'treasury' });

    stubLocation('/home');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'home' });
  });

  it('returns clearer canonical page paths', () => {
    expect(getPathForAppPage('chat')).toBe('/chat');
    expect(getPathForAppPage('swap')).toBe('/shield');
    expect(getPathForAppPage('treasury')).toBe('/treasury');
    expect(getPathForAppPage('trades')).toBe('/trades');
  });

  it('resolves stable trade shell URLs through the redirected path', () => {
    stubLocation('/trades', `?p=${encodeURIComponent('/trades/l/abc?escrow=direct')}`);

    expect(resolveNavigationPathFromLocation()).toBe('/trades/l/abc?escrow=direct');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'trades' });
  });
});
