import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS
} from '../../../lib/appShared/core';
import { encodeTradeLink } from '../../../lib/tradeLinks';
import { buildLinkTradeV2Path } from '../../../lib/linkTradeV2Links';
import {
  buildPrivateLiquidityPositionPath,
  buildTradeRoutePath,
  buildTradeSurfacePath,
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

describe('Link V2 in existing trade routes', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reference = { chainId: '7082400', escrow: `0x${'11'.repeat(20)}`,
    id: ((1n << 256n) - 1n).toString(), revision: '2', credentialEpoch: '1' };
  const path = buildLinkTradeV2Path(reference, ACCESS_SECRET), url = new URL(path, 'https://chainwhisper.chat');
  it('preserves full-width identity without entering the legacy numeric-ID path', () => {
    const route = resolveTradeRouteFromParts(url.pathname, url.search, url.hash);
    expect(route).toMatchObject({ view: 'trade', tradeId: null, linkV2Reference: reference,
      accessSecret: ACCESS_SECRET, escrowContract: reference.escrow, routeError: '' });
    expect(buildTradeRoutePath(route)).toBe(path);
    expect(resolveTradeLinkInput(url.href)).toMatchObject({ tradeId: null, linkV2Reference: reference,
      accessSecret: ACCESS_SECRET });
  });
  it('does not persist the credential in legacy terminal recovery storage', () => {
    const storage = createMemoryStorage();
    expect(rememberPendingTradeTerminalRoute(path, storage)).toBeNull();
    expect(readPendingTradeTerminalRoute(storage)).toBeNull();
  });
  it('requires the fragment and rejects query substitution without an old-instance fallback', () => {
    expect(resolveTradeRouteFromParts(url.pathname).routeError).toMatch(/full Share link/);
    const bad = resolveTradeRouteFromParts(url.pathname, `?secret=${ACCESS_SECRET}`, '');
    expect(bad.tradeId).toBeNull();
    expect(bad.routeError).toMatch(/invalid/i);
    expect(resolveTradeLinkInput(`/wallet-connect?p=${encodeURIComponent(path)}`)).toBeNull();
  });
  it('opens redirected public references only with the live outer fragment', () => {
    const publicPath = path.split('#')[0];
    vi.stubGlobal('window', { location: { origin: 'https://chainwhisper.chat', pathname: '/',
      search: `?p=${encodeURIComponent(publicPath)}`, hash: `#secret=${ACCESS_SECRET}` } });
    expect(resolveTradeRouteFromLocation()).toMatchObject({ linkV2Reference: reference,
      tradeId: null, accessSecret: ACCESS_SECRET, routeError: '' });
    expect(resolveTradeLinkInput(`/wallet-connect?p=${encodeURIComponent(publicPath)}#secret=${ACCESS_SECRET}`))
      .toMatchObject({ linkV2Reference: reference, accessSecret: ACCESS_SECRET });
  });
  it('rejects a credential embedded in the browser redirect query', () => {
    vi.stubGlobal('window', { location: { origin: 'https://chainwhisper.chat', pathname: '/',
      search: `?p=${encodeURIComponent(path)}`, hash: '' } });
    expect(resolveTradeRouteFromLocation()).toMatchObject({ tradeId: null, accessSecret: '',
      routeError: expect.stringMatching(/invalid/i) });
  });
});

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
    expect(resolveTradeRouteFromParts('/otc')).toMatchObject({ view: 'public', tradeId: null, routeFamily: 'desk' });
    expect(resolveTradeRouteFromParts('/otc', '?venue=private-liquidity')).toMatchObject({ view: 'public' });
    expect(resolveTradeRouteFromParts('/dex')).toMatchObject({
      view: 'swap',
      tradeMode: 'swap',
      swapVenue: 'private-liquidity'
    });
    expect(resolveTradeRouteFromParts('/dex/desk')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'discover'
    });
    expect(resolveTradeRouteFromParts('/dex/orders')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'mine'
    });
    expect(resolveTradeRouteFromParts('/dex/agent')).toMatchObject({
      view: 'agent',
      tradeProduct: 'dex'
    });
    expect(resolveTradeRouteFromParts('/dex/strategies')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'discover'
    });
    expect(resolveTradeRouteFromParts('/otc/pools')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'discover',
      routeFamily: 'desk'
    });
    expect(resolveTradeRouteFromParts('/otc/pools/mine')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'mine'
    });
    expect(resolveTradeRouteFromParts('/otc/pools/create')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'create'
    });
    expect(resolveTradeRouteFromParts('/otc/pools/intents')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'intents'
    });
    expect(resolveTradeRouteFromParts('/otc/pools/position/7')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'mine',
      privateLiquidityPositionId: '7'
    });
    expect(resolveTradeRouteFromParts('/otc/pools/position/0')).toMatchObject({
      view: 'pools',
      privateLiquidityView: 'mine',
      routeError: 'This private-liquidity position id is not valid.'
    });
    expect(resolveTradeRouteFromParts('/otc/limit')).toMatchObject({
      view: 'create',
      tradeMode: 'limit',
      tradeId: null
    });
    expect(resolveTradeRouteFromParts('/otc/recurring')).toMatchObject({
      view: 'create',
      tradeMode: 'limit',
      tradeId: null
    });
    expect(resolveTradeRouteFromParts('/otc/desk')).toMatchObject({ view: 'public', tradeId: null });
    expect(resolveTradeRouteFromParts('/otc/agent')).toMatchObject({ view: 'agent', tradeId: null });
    expect(resolveTradeRouteFromParts('/otc/orders')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades')).toMatchObject({ view: 'public', tradeId: null, routeFamily: 'trades' });
    expect(resolveTradeRouteFromParts('/otcdesk')).toMatchObject({ view: 'public', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/desk')).toMatchObject({ view: 'public', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/create')).toMatchObject({ view: 'create', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/create')).toMatchObject({ view: 'create', tradeMode: 'limit', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/mine')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/otcdesk/mytrades')).toMatchObject({ view: 'mine', tradeId: null });
    expect(resolveTradeRouteFromParts('/trades/recurring')).toMatchObject({ view: 'create', tradeMode: 'limit', tradeId: null });
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
    expect(buildTradeRoutePath({ view: 'swap', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe('/otc/desk');
    expect(buildTradeRoutePath({
      view: 'swap',
      swapVenue: 'private-liquidity',
      tradeId: null,
      accessSecret: '',
      routeFamily: 'desk',
      routeError: ''
    })).toBe('/dex');
    expect(buildTradeRoutePath({ view: 'agent', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe('/otc/agent');
    expect(buildTradeRoutePath({
      view: 'pools',
      privateLiquidityView: 'mine',
      tradeId: null,
      accessSecret: '',
      routeFamily: 'desk',
      routeError: ''
    })).toBe('/dex/orders');
    expect(buildTradeRoutePath({
      view: 'pools',
      privateLiquidityView: 'mine',
      privateLiquidityPositionId: '7',
      tradeId: null,
      accessSecret: '',
      routeFamily: 'desk',
      routeError: ''
    })).toBe('/dex/orders/position/7');
    expect(buildPrivateLiquidityPositionPath(7n)).toBe('/dex/orders/position/7');
    expect(() => buildPrivateLiquidityPositionPath('01')).toThrow(/positive uint256/);
    expect(buildTradeRoutePath({ view: 'public', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe('/otc/desk');
    expect(buildTradeRoutePath({ view: 'create', tradeMode: 'limit', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe(
      '/otc/limit'
    );
    expect(buildTradeRoutePath({ view: 'create', tradeMode: 'recurring', tradeId: null, accessSecret: '', routeFamily: 'desk', routeError: '' })).toBe(
      '/otc/limit'
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

  it.each([
    ['/otc/recurring', ''],
    ['/trades/recurring', ''],
    ['/otc/order/recurring', ''],
    ['/otcdesk/terminal/recurring', ''],
    ['/otc/limit', '?mode=recurring'],
    ['/trades/create', '?tab=recurring'],
    ['/otcdesk/create', '?mode=recurring']
  ])('maps the retired empty composer %s%s to one-off Create', (pathname, search) => {
    const route = resolveTradeRouteFromParts(pathname, search);
    expect(route).toMatchObject({ view: 'create', tradeMode: 'limit', tradeId: null });
    expect(buildTradeRoutePath(route, 'desk')).toBe('/otc/limit');
  });

  it.each(['desk', 'trades'] as const)('never builds new recurring creation for the %s route family', (family) => {
    const expected = family === 'desk' ? '/otc/limit' : '/trades/create';
    expect(buildTradeSurfacePath('recurring', family)).toBe(expected);
    expect(buildTradeSurfacePath('create', family, 'recurring')).toBe(expected);
  });

  it.each([
    ['/otc/order/recurring/11', ''],
    ['/trades/recurring', '?order=11'],
    ['/otc/order/recurring', '?id=11'],
    ['/otcdesk/terminal/recurring', '?order=11']
  ])('keeps the funded recurring order in %s%s and its secret', (pathname, search) => {
    const route = resolveTradeRouteFromParts(pathname, search, `#${ACCESS_SECRET}`);
    expect(route).toMatchObject({
      view: 'trade', tradeId: 11, escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET, routeError: ''
    });
    expect(buildTradeRoutePath(route, 'desk')).toBe(`/otc/order/recurring/11#${ACCESS_SECRET}`);
  });

  it('resolves new compact trade links with fragment secrets', () => {
    const code = encodeTradeLink(42);

    expect(resolveTradeRouteFromParts(`/trades/l/${code}`, '?escrow=private', `#${ACCESS_SECRET}`)).toMatchObject({
      view: 'trade',
      tradeId: 42,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET,
      routeError: ''
    });
    expect(resolveTradeRouteFromParts(`/otc/order/link/${code}`, '?escrow=direct', `#${ACCESS_SECRET}`)).toMatchObject({
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
    expect(resolveTradeLinkInput(`http://localhost:5173/trades/l/${encodeTradeLink(9)}?escrow=direct#${ACCESS_SECRET}`)).toEqual({
      tradeId: 9,
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      accessSecret: ACCESS_SECRET
    });
    expect(resolveTradeLinkInput('123abc')).toBeNull();
  });

  it('bounds nested redirect parsing while tolerating malformed unrelated query values', () => {
    const privatePath = `/otcdesk/terminal/l/${encodeTradeLink(9, ACCESS_SECRET)}`;
    const wrapRedirect = (path: string) => `?p=${encodeURIComponent(path)}`;
    const sixRedirects = Array.from({ length: 6 }).reduce<string>(
      (path) => wrapRedirect(path),
      privatePath
    );
    const sevenRedirects = wrapRedirect(sixRedirects);

    expect(resolveTradeLinkInput(sixRedirects)).toEqual({
      tradeId: 9,
      accessSecret: ACCESS_SECRET
    });
    expect(resolveTradeLinkInput(sevenRedirects)).toBeNull();
    expect(resolveTradeLinkInput(`?noise=%ZZ&p=${encodeURIComponent(privatePath)}`)).toEqual({
      tradeId: 9,
      accessSecret: ACCESS_SECRET
    });
  });

  it('preserves recurring private-link secrets in share paths', () => {
    expect(buildTradeLinkPath(7, ACCESS_SECRET, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(
      `/otc/order/recurring/7#${ACCESS_SECRET}`
    );
    expect(buildTradeLinkPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(
      `/otc/order/link/${encodeTradeLink(8)}?escrow=direct#${ACCESS_SECRET}`
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
      `/otc/order/link/${encodeTradeLink(8)}?escrow=direct#${ACCESS_SECRET}`
    );
    expect(buildTradeTerminalPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, 'trades')).toBe(
      `/trades/l/${encodeTradeLink(8)}?escrow=direct#${ACCESS_SECRET}`
    );
    expect(buildTradeLinkPath(8, ACCESS_SECRET, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(
      `/otc/order/link/${encodeTradeLink(8)}?escrow=direct#${ACCESS_SECRET}`
    );
  });

  it.each([TRADE_ESCROW_CONTRACT_ADDRESS, '0x7777777777777777777777777777777777777777'])(
    'retains the exact selected standard or registry escrow in order and share paths: %s', escrowContract => {
      const paths = [buildTradeLinkPath(8, ACCESS_SECRET, escrowContract),
        buildTradeTerminalPath(8, ACCESS_SECRET, escrowContract),
        buildTradeTerminalPath(8, ACCESS_SECRET, escrowContract, 'trades')];
      for (const routePath of paths) {
        const url = new URL(routePath, 'https://chainwhisper.example');
        expect(resolveTradeRouteFromParts(url.pathname, url.search, url.hash)).toMatchObject({
          view:'trade', tradeId:8, escrowContract, accessSecret:ACCESS_SECRET, routeError:''
        });
      }
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
