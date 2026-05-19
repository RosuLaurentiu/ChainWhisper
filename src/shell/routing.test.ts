import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPathForAppPage, resolveAppRouteFromLocation, resolveNavigationPathFromLocation } from './routing';

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
    expect(getPathForAppPage('trades')).toBe('/trades');
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

  it('falls back safely for invalid wallet bootstrap routes', () => {
    stubLocation('/wallet-connect', `?p=${encodeURIComponent('https://evil.example/chat')}`);

    expect(resolveNavigationPathFromLocation()).toBe('/');
    expect(resolveAppRouteFromLocation()).toEqual({ page: 'home' });
  });
});
