import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS
} from '../../../lib/appShared/core';
import { encodeTradeLink } from '../../../lib/tradeLinks';
import {
  buildTradeRoutePath,
  buildTradeLinkPath,
  buildTradeTerminalPath,
  clearPendingTradeTerminalRoute,
  readPendingTradeTerminalRoute,
  rememberPendingTradeTerminalRoute,
  resolvePendingTradeTerminalRoutePath,
  resolveTradeLinkInput,
  resolveTradeRouteFromLocation,
  resolveTradeRouteFromParts
} from './useP2PTradeRoute';

const ACCESS_SECRET = `0x${'12'.repeat(32)}`;

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

describe('P2P trade route helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves top-level trade routes without changing route ownership', () => {
    expect(resolveTradeRouteFromParts('/otc')).toMatchObject({ view: 'swap', tradeMode: 'swap', tradeId: null, routeFamily: 'desk' });
    expect(resolveTradeRouteFromParts('/otc/limit')).toMatchObject({
      view: 'create',
      tradeMode: 'limit',
      tradeId: null
    });
    expect(resolveTradeRouteFromParts('/otc/recurring')).toMatchObject({
      view: 'create',
      tradeMode: 'recurring',
      tradeId: null
    });
    expect(resolveTradeRouteFromParts('/otc/desk')).toMatchObject({ view: 'public', tradeId: null });
    expect(resolveTradeRouteFromParts('/otc/orders')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades')).toMatchObject({ view: 'public', tradeId: null, routeFamily: 'trades' });
    expect(resolveTradeRouteFromParts('/otcdesk')).toMatchObject({ view: 'swap', tradeMode: 'swap', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/desk')).toMatchObject({ view: 'public', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/create')).toMatchObject({ view: 'create', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/create')).toMatchObject({ view: 'create', tradeMode: 'limit', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/mine')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/mytrades')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/recurring')).toMatchObject({ view: 'create', tradeMode: 'recurring', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/recurring', '?order=11')).toMatchObject({
      view: 'trade',
      tradeId: 11,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
    });
    expect(resolveTradeRouteFromParts('/otcdesk/terminal/recurring', '?order=11')).toMatchObject({
      view: 'trade',
      tradeId: 11,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
    });
    expect(resolveTradeRouteFromParts('/otc/order/recurring/11')).toMatchObject({
      view: 'trade',
      tradeId: 11,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
    });
    expect(resolveTradeRouteFromParts('/trades/open')).toMatchObject({ view: 'trade', tradeId: null, routeFamily: 'trades' });
    expect(resolveTradeRouteFromParts('/otc/order')).toMatchObject({ view: 'trade', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/terminal')).toMatchObject({ view: 'trade', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/open/counter')).toMatchObject({ view: 'counter', tradeId: null });
    expect(resolveTradeRouteFromParts('/otc/order/counter')).toMatchObject({ view: 'counter', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/terminal/counter')).toMatchObject({ view: 'counter', tradeId: null });
  });

  it('builds clean OTC Desk app routes while preserving public share links', () => {
    expect(buildTradeRoutePath({ view: 'swap', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe('/otc');
    expect(buildTradeRoutePath({ view: 'public', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe('/otc/desk');
    expect(buildTradeRoutePath({ view: 'create', tradeMode: 'limit', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe(
      '/otc/limit'
    );
    expect(buildTradeRoutePath({ view: 'create', tradeMode: 'recurring', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe(
      '/otc/recurring'
    );
    expect(buildTradeRoutePath({ view: 'mine', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe('/otc/orders');
    expect(buildTradeRoutePath({ view: 'trade', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe('/otc/order');
    expect(buildTradeRoutePath({ view: 'counter', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe(
      '/otc/order/counter'
    );
    expect(buildTradeRoutePath({ view: 'trade', tradeId: 7, accessSecret: ACCESS_SECRET, routeFamily: 'desk', routeError: '' })).toContain(
      '/otc/order/link/'
    );
    expect(buildTradeRoutePath({ view: 'public', tradeId: null, accessSecret: '', routeFamily: 'trades', routeError: '' })).toBe(
      '/trades'
    );
    expect(buildTradeRoutePath({ view: 'trade', tradeId: null, accessSecret: '', routeFamily: 'trades', routeError: '' })).toBe(
      '/trades/open'
    );
    expect(
      buildTradeRoutePath({
        view: 'trade',
        tradeId: 7,
        escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
        accessSecret: ACCESS_SECRET,
        routeFamily: 'trades',
        routeError: ''
      })
    ).toBe(`/trades/recurring?order=7#${ACCESS_SECRET}`);
  });

  it('resolves compact private trade links with escrow aliases', () => {
    const code = encodeTradeLink(42, ACCESS_SECRET);

    expect(resolveTradeRouteFromParts(`/trades/l/${code}`, '?escrow=private')).toMatchObject({
      view: 'trade',
      tradeId: 42,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET,
      routeError: ''
    });
    expect(resolveTradeRouteFromParts(`/otcdesk/terminal/l/${code}`, '?escrow=private')).toMatchObject({
      view: 'trade',
      tradeId: 42,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET,
      routeError: ''
    });
    expect(resolveTradeRouteFromParts(`/otc/order/link/${code}`, '?escrow=private')).toMatchObject({
      view: 'trade',
      tradeId: 42,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET,
      routeError: ''
    });
    expect(resolveTradeRouteFromParts(`/trades/l/${code}`, '?escrow=direct')).toMatchObject({
      view: 'trade',
      tradeId: 42,
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET,
      routeError: ''
    });
  });

  it('preserves legacy numeric links and secret hashes', () => {
    expect(resolveTradeRouteFromParts('/trades/77', '', `#${ACCESS_SECRET}`)).toMatchObject({
      view: 'trade',
      tradeId: 77,
      accessSecret: ACCESS_SECRET
    });
  });

  it('parses shared input while rejecting partial numeric text', () => {
    const bareCode = encodeTradeLink(9, ACCESS_SECRET);
    expect(resolveTradeLinkInput(bareCode)).toEqual({ tradeId: 9, accessSecret: ACCESS_SECRET });
    expect(resolveTradeLinkInput('#123')).toEqual({ tradeId: 123 });
    expect(resolveTradeLinkInput(`http://localhost:5173/trades/recurring?order=7#${ACCESS_SECRET}`)).toEqual({
      tradeId: 7,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET
    });
    expect(resolveTradeLinkInput(`http://localhost:5173/otcdesk/terminal/recurring?order=7#${ACCESS_SECRET}`)).toEqual({
      tradeId: 7,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET
    });
    expect(resolveTradeLinkInput(`http://localhost:5173/otc/order/recurring/7#${ACCESS_SECRET}`)).toEqual({
      tradeId: 7,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET
    });
    expect(resolveTradeLinkInput('123abc')).toBeNull();
  });

  it('preserves recurring private-link secrets in share paths', () => {
    expect(buildTradeLinkPath(7, ACCESS_SECRET, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(
      `/otc/order/recurring/7#${ACCESS_SECRET}`
    );
    expect(buildTradeLinkPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(
      `/otc/order/link/${encodeTradeLink(8, ACCESS_SECRET)}?escrow=direct`
    );
  });

  it('builds clean internal terminal links while keeping share links legacy-compatible', () => {
    expect(buildTradeTerminalPath(7, ACCESS_SECRET, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(
      `/otc/order/recurring/7#${ACCESS_SECRET}`
    );
    expect(buildTradeTerminalPath(7, ACCESS_SECRET, RECURRING_OTC_CONTRACT_ADDRESS, 'trades')).toBe(
      `/trades/recurring?order=7#${ACCESS_SECRET}`
    );
    expect(buildTradeTerminalPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(
      `/otc/order/link/${encodeTradeLink(8, ACCESS_SECRET)}?escrow=direct`
    );
    expect(buildTradeTerminalPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, 'trades')).toBe(
      `/trades/l/${encodeTradeLink(8, ACCESS_SECRET)}?escrow=direct`
    );
    expect(buildTradeLinkPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(
      `/otc/order/link/${encodeTradeLink(8, ACCESS_SECRET)}?escrow=direct`
    );
  });

  it('remembers and restores a pending terminal route from the desk route', () => {
    const storage = createMemoryStorage();
    const pending = rememberPendingTradeTerminalRoute('/otc/order/recurring/7', storage, 1_000);

    expect(pending).toMatchObject({
      path: '/otc/order/recurring/7',
      tradeId: 7
    });
    expect(readPendingTradeTerminalRoute(storage, 1_500)).toMatchObject({ tradeId: 7 });
    expect(resolvePendingTradeTerminalRoutePath(resolveTradeRouteFromParts('/trades'), '/trades', storage, 1_500)).toBe(
      '/otc/order/recurring/7'
    );
    expect(resolvePendingTradeTerminalRoutePath(resolveTradeRouteFromParts('/otc/desk'), '/otc/desk', storage, 1_500)).toBe(
      '/otc/order/recurring/7'
    );
    expect(resolvePendingTradeTerminalRoutePath(resolveTradeRouteFromParts('/otc'), '/otc', storage, 1_500)).toBeNull();
  });

  it('expires and clears stale pending terminal routes', () => {
    const storage = createMemoryStorage();
    rememberPendingTradeTerminalRoute('/trades/recurring?order=7', storage, 1_000);

    expect(readPendingTradeTerminalRoute(storage, 1_000 + 10 * 60 * 1000 + 1)).toBeNull();
    expect(readPendingTradeTerminalRoute(storage, 1_500)).toBeNull();
  });

  it('clears pending terminal routes explicitly', () => {
    const storage = createMemoryStorage();
    rememberPendingTradeTerminalRoute('/trades/recurring?order=7', storage, 1_000);

    clearPendingTradeTerminalRoute(storage);

    expect(readPendingTradeTerminalRoute(storage, 1_500)).toBeNull();
  });

  it('resolves wallet bootstrap trade links while keeping public share paths canonical', () => {
    vi.stubGlobal('window', {
      location: {
        hash: '',
        origin: 'https://chainwhisper.example',
        pathname: '/wallet-connect',
        search: `?p=${encodeURIComponent('/trades/recurring?order=7')}`
      },
      sessionStorage: createMemoryStorage()
    });

    expect(resolveTradeRouteFromLocation()).toMatchObject({
      view: 'trade',
      tradeId: 7,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
    });
    expect(buildTradeLinkPath(7, ACCESS_SECRET, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(
      `/otc/order/recurring/7#${ACCESS_SECRET}`
    );
  });
});
