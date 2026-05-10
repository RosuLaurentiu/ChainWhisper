import { useCallback, useEffect, useState } from 'react';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  isWalletAddress
} from '../lib/appShared/core';
import { decodeTradeLink, encodeTradeLink } from '../lib/tradeLinks';

export type TradePageView = 'public' | 'create' | 'trade' | 'counter' | 'mine';

export type TradeNavigationOptions = {
  clearPendingTerminalRoute?: boolean;
  replace?: boolean;
};

export type TradeRouteState = {
  view: TradePageView;
  tradeId: number | null;
  escrowContract?: string;
  accessSecret: string;
  routeError: string;
};

export type ResolvedTradeLinkInput = {
  tradeId: number;
  escrowContract?: string;
  accessSecret?: string;
};

type PendingTradeTerminalRoute = {
  escrowContract?: string;
  path: string;
  timestamp: number;
  tradeId: number;
};

type TradeRouteStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const PENDING_TRADE_TERMINAL_ROUTE_STORAGE_KEY = 'chainwhisper:p2p:pending-terminal-route:v1';
const PENDING_TRADE_TERMINAL_ROUTE_TTL_MS = 10 * 60 * 1000;
const createEmptyPublicRoute = (): TradeRouteState => ({ view: 'public', tradeId: null, accessSecret: '', routeError: '' });
const createEmptyTradeRoute = (): TradeRouteState => ({ view: 'trade', tradeId: null, accessSecret: '', routeError: '' });

const normalizeTradePathname = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized || '/';
};

const normalizeTradeSearch = (value: string): string => {
  if (!value.trim()) {
    return '';
  }
  return value.startsWith('?') ? value : `?${value}`;
};

const normalizeTradeHash = (value: string): string => value.replace(/^#/, '').trim();

const getSessionRouteStorage = (): TradeRouteStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const getCurrentTradePath = (): string => {
  if (typeof window === 'undefined') {
    return '/trades';
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
};

const parseTradePathRoute = (path: string): TradeRouteState | null => {
  try {
    const url = new URL(path, 'https://chainwhisper.local');
    return resolveTradeRouteFromParts(url.pathname, url.search, url.hash);
  } catch {
    return null;
  }
};

export const clearPendingTradeTerminalRoute = (storage: TradeRouteStorage | null = getSessionRouteStorage()): void => {
  try {
    storage?.removeItem(PENDING_TRADE_TERMINAL_ROUTE_STORAGE_KEY);
  } catch {
  }
};

export const readPendingTradeTerminalRoute = (
  storage: TradeRouteStorage | null = getSessionRouteStorage(),
  now = Date.now()
): PendingTradeTerminalRoute | null => {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(PENDING_TRADE_TERMINAL_ROUTE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PendingTradeTerminalRoute>;
    const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
    const tradeId = typeof parsed.tradeId === 'number' ? parsed.tradeId : 0;
    const path = typeof parsed.path === 'string' ? parsed.path : '';
    const route = path ? parseTradePathRoute(path) : null;
    if (
      !path ||
      !Number.isSafeInteger(tradeId) ||
      tradeId <= 0 ||
      !route ||
      route.view !== 'trade' ||
      route.tradeId !== tradeId ||
      now - timestamp > PENDING_TRADE_TERMINAL_ROUTE_TTL_MS
    ) {
      storage.removeItem(PENDING_TRADE_TERMINAL_ROUTE_STORAGE_KEY);
      return null;
    }
    return {
      escrowContract: typeof parsed.escrowContract === 'string' ? parsed.escrowContract : route.escrowContract,
      path,
      timestamp,
      tradeId
    };
  } catch {
    try {
      storage.removeItem(PENDING_TRADE_TERMINAL_ROUTE_STORAGE_KEY);
    } catch {
    }
    return null;
  }
};

export const rememberPendingTradeTerminalRoute = (
  path: string,
  storage: TradeRouteStorage | null = getSessionRouteStorage(),
  now = Date.now()
): PendingTradeTerminalRoute | null => {
  if (!storage) {
    return null;
  }

  const route = parseTradePathRoute(path);
  if (!route || route.view !== 'trade' || route.tradeId === null) {
    clearPendingTradeTerminalRoute(storage);
    return null;
  }

  const pendingRoute: PendingTradeTerminalRoute = {
    escrowContract: route.escrowContract,
    path,
    timestamp: now,
    tradeId: route.tradeId
  };
  try {
    storage.setItem(PENDING_TRADE_TERMINAL_ROUTE_STORAGE_KEY, JSON.stringify(pendingRoute));
    return pendingRoute;
  } catch {
    return null;
  }
};

export const resolvePendingTradeTerminalRoutePath = (
  route: TradeRouteState,
  currentPath: string,
  storage: TradeRouteStorage | null = getSessionRouteStorage(),
  now = Date.now()
): string | null => {
  const normalizedCurrentPath = normalizeTradePathname(currentPath.split('?')[0]?.split('#')[0] ?? currentPath);
  if (route.view !== 'public' || normalizedCurrentPath !== '/trades') {
    return null;
  }

  return readPendingTradeTerminalRoute(storage, now)?.path ?? null;
};

export const normalizeAccessSecret = (value?: string | null): string => {
  const secret = value?.trim() ?? '';
  return /^0x[a-fA-F0-9]{64}$/.test(secret) ? secret : '';
};

const resolveLegacyTradeSecret = (searchValue = '', hashValue = ''): string => {
  const searchSecret = new URLSearchParams(normalizeTradeSearch(searchValue)).get('secret')?.trim() ?? '';
  const normalizedHash = normalizeTradeHash(hashValue);
  const hashSecret =
    normalizedHash.startsWith('secret=')
      ? new URLSearchParams(normalizedHash).get('secret')?.trim() ?? ''
      : normalizedHash;
  return normalizeAccessSecret(searchSecret || hashSecret);
};

const resolveRouteEscrowContract = (searchValue = ''): string | undefined => {
  const params = new URLSearchParams(normalizeTradeSearch(searchValue));
  const raw = params.get('escrow')?.trim() || params.get('contract')?.trim() || '';
  if (!raw) {
    return undefined;
  }
  if (raw.toLowerCase() === 'private') {
    return PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS;
  }
  if (raw.toLowerCase() === 'party') {
    return '0x0000000000000000000000000000000000000000';
  }
  if (raw.toLowerCase() === 'direct') {
    return DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS;
  }
  if (raw.toLowerCase() === 'recurring') {
    return RECURRING_OTC_CONTRACT_ADDRESS;
  }
  if (raw.toLowerCase() === 'v2') {
    return TRADE_ESCROW_CONTRACT_ADDRESS;
  }
  return isWalletAddress(raw) ? raw : undefined;
};

export const resolveTradeRouteFromParts = (
  pathnameValue: string,
  searchValue = '',
  hashValue = ''
): TradeRouteState => {
  const pathname = normalizeTradePathname(pathnameValue);
  const lowerPathname = pathname.toLowerCase();
  const escrowContract = resolveRouteEscrowContract(searchValue);

  if (lowerPathname === '/trades/create') {
    return { view: 'create', tradeId: null, accessSecret: '', routeError: '' };
  }
  if (lowerPathname === '/trades/mine') {
    return { view: 'mine', tradeId: null, accessSecret: '', routeError: '' };
  }
  if (lowerPathname === '/trades/recurring') {
    const params = new URLSearchParams(normalizeTradeSearch(searchValue));
    const orderId = Number.parseInt(params.get('order') ?? params.get('id') ?? '', 10);
    if (Number.isSafeInteger(orderId) && orderId > 0) {
      return {
        view: 'trade',
        tradeId: orderId,
        escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
        accessSecret: resolveLegacyTradeSecret(searchValue, hashValue),
        routeError: ''
      };
    }
    return { view: 'create', tradeId: null, accessSecret: '', routeError: '' };
  }
  if (lowerPathname === '/trades/open') {
    return createEmptyTradeRoute();
  }
  if (lowerPathname === '/trades/open/counter') {
    return { view: 'counter', tradeId: null, accessSecret: '', routeError: '' };
  }

  const encodedMatch = pathname.match(/^\/trades\/l\/([^/?#]+)$/i);
  if (encodedMatch) {
    let linkCode = encodedMatch[1];
    try {
      linkCode = decodeURIComponent(linkCode);
    } catch {
      return { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade link is not valid.' };
    }
    const decoded = decodeTradeLink(linkCode);
    if (!decoded) {
      return { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade link is not valid.' };
    }
    return {
      view: 'trade',
      tradeId: decoded.tradeId,
      escrowContract,
      accessSecret: decoded.accessSecret ?? '',
      routeError: ''
    };
  }

  const legacyMatch = pathname.match(/^\/trades\/(\d+)$/i);
  if (legacyMatch) {
    const tradeId = Number.parseInt(legacyMatch[1], 10);
    return Number.isSafeInteger(tradeId) && tradeId > 0
      ? { view: 'trade', tradeId, escrowContract, accessSecret: resolveLegacyTradeSecret(searchValue, hashValue), routeError: '' }
      : { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade id is not valid.' };
  }

  return createEmptyPublicRoute();
};

export const resolveTradeRouteFromLocation = (): TradeRouteState => {
  if (typeof window === 'undefined') {
    return createEmptyPublicRoute();
  }

  const redirectedPath = new URLSearchParams(window.location.search).get('p');
  if (redirectedPath) {
    try {
      const redirectedUrl = new URL(redirectedPath, window.location.origin);
      return resolveTradeRouteFromParts(
        redirectedUrl.pathname,
        redirectedUrl.search || window.location.search,
        redirectedUrl.hash || window.location.hash
      );
    } catch {
      return resolveTradeRouteFromParts(redirectedPath, window.location.search, window.location.hash);
    }
  }

  return resolveTradeRouteFromParts(window.location.pathname, window.location.search, window.location.hash);
};

const restorePendingTradeTerminalRouteFromLocation = (): TradeRouteState => {
  const route = resolveTradeRouteFromLocation();
  const pendingPath = resolvePendingTradeTerminalRoutePath(route, getCurrentTradePath());
  if (!pendingPath || typeof window === 'undefined') {
    return route;
  }
  window.history.replaceState(window.history.state, '', pendingPath);
  return resolveTradeRouteFromLocation();
};

export const resolveTradeLinkInput = (value: string): ResolvedTradeLinkInput | null => {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const decodedDirect = decodeTradeLink(raw);
  if (decodedDirect) {
    return decodedDirect;
  }

  const resolveFromRoute = (pathname: string, search = '', hash = ''): ResolvedTradeLinkInput | null => {
    const redirectedPath = new URLSearchParams(normalizeTradeSearch(search)).get('p');
    if (redirectedPath) {
      try {
        const redirectedUrl = new URL(redirectedPath, typeof window === 'undefined' ? 'https://chainwhisper.chat' : window.location.origin);
        return resolveFromRoute(redirectedUrl.pathname, redirectedUrl.search || search, redirectedUrl.hash || hash);
      } catch {
        return resolveFromRoute(redirectedPath, search, hash);
      }
    }

    const parsedRoute = resolveTradeRouteFromParts(pathname, search, hash);
    return parsedRoute.view === 'trade' && parsedRoute.tradeId
      ? {
          tradeId: parsedRoute.tradeId,
          escrowContract: parsedRoute.escrowContract,
          accessSecret: parsedRoute.accessSecret || undefined
        }
      : null;
  };

  try {
    const parsedUrl = new URL(raw, typeof window === 'undefined' ? 'https://chainwhisper.chat' : window.location.origin);
    const parsedFromUrl = resolveFromRoute(parsedUrl.pathname, parsedUrl.search, parsedUrl.hash);
    if (parsedFromUrl) {
      return parsedFromUrl;
    }
  } catch {
  }

  if (raw.startsWith('?') || raw.startsWith('p=')) {
    const parsedFromSearch = resolveFromRoute('/', raw.startsWith('?') ? raw : `?${raw}`);
    if (parsedFromSearch) {
      return parsedFromSearch;
    }
  }

  const parsedFromBarePath = resolveFromRoute(raw.startsWith('/') ? raw : `/${raw}`);
  if (parsedFromBarePath) {
    return parsedFromBarePath;
  }

  const legacyIdMatch = raw.match(/^#?(\d+)$/);
  if (legacyIdMatch) {
    const tradeId = Number.parseInt(legacyIdMatch[1], 10);
    return Number.isSafeInteger(tradeId) && tradeId > 0 ? { tradeId } : null;
  }

  return null;
};

export const buildTradeLinkPath = (tradeId: number, accessSecret?: string, escrowContract?: string): string => {
  if (escrowContract?.toLowerCase() === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase()) {
    const secret = normalizeAccessSecret(accessSecret);
    return `/trades/recurring?order=${tradeId}${secret ? `#${secret}` : ''}`;
  }
  const code = encodeTradeLink(tradeId, accessSecret);
  const search =
    escrowContract && escrowContract.toLowerCase() === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()
      ? '?escrow=private'
      : escrowContract && escrowContract.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()
        ? '?escrow=direct'
      : '';
  return `/trades/l/${code}${search}`;
};

type UseP2PTradeRouteResult = {
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  navigateToTradePath: (path: string, options?: TradeNavigationOptions) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string, options?: TradeNavigationOptions) => void;
  rememberTradeTerminalReturn: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  route: TradeRouteState;
  showEmptyTradeRoute: () => void;
};

export default function useP2PTradeRoute(): UseP2PTradeRouteResult {
  const [route, setRoute] = useState<TradeRouteState>(() => restorePendingTradeTerminalRouteFromLocation());

  const navigateToTradePath = useCallback((path: string, options?: TradeNavigationOptions) => {
    if (typeof window === 'undefined') {
      return;
    }

    const targetUrl = new URL(path, window.location.origin);
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = targetUrl.pathname;
    nextUrl.search = targetUrl.search;
    nextUrl.hash = targetUrl.hash;
    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const targetRoute = resolveTradeRouteFromParts(targetUrl.pathname, targetUrl.search, targetUrl.hash);

    if (
      options?.clearPendingTerminalRoute !== false &&
      (targetRoute.view !== 'trade' || targetRoute.tradeId === null)
    ) {
      clearPendingTradeTerminalRoute();
    }

    if (currentPath !== nextPath) {
      if (options?.replace) {
        window.history.replaceState(window.history.state, '', nextPath);
      } else {
        window.history.pushState(window.history.state, '', nextPath);
      }
    }
    setRoute(restorePendingTradeTerminalRouteFromLocation());
  }, []);

  const buildTradeShareUrl = useCallback((tradeId: number, accessSecret?: string, escrowContract?: string): string => {
    const path = buildTradeLinkPath(tradeId, accessSecret, escrowContract);
    if (typeof window === 'undefined') {
      return path;
    }

    const nextUrl = new URL(window.location.href);
    const targetUrl = new URL(path, window.location.origin);
    nextUrl.pathname = targetUrl.pathname;
    nextUrl.search = targetUrl.search;
    nextUrl.hash = targetUrl.hash;
    return nextUrl.toString();
  }, []);

  const openTrade = useCallback(
    (tradeId: number, accessSecret?: string, escrowContract?: string, options?: TradeNavigationOptions) => {
      navigateToTradePath(buildTradeLinkPath(tradeId, accessSecret, escrowContract), options);
    },
    [navigateToTradePath]
  );

  const rememberTradeTerminalReturn = useCallback(
    (tradeId: number, accessSecret?: string, escrowContract?: string) => {
      rememberPendingTradeTerminalRoute(buildTradeLinkPath(tradeId, accessSecret, escrowContract));
    },
    []
  );

  const showEmptyTradeRoute = useCallback(() => {
    clearPendingTradeTerminalRoute();
    setRoute(createEmptyTradeRoute());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncRoute = () => {
      setRoute(restorePendingTradeTerminalRouteFromLocation());
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('focus', syncRoute);
    document.addEventListener('visibilitychange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('focus', syncRoute);
      document.removeEventListener('visibilitychange', syncRoute);
    };
  }, []);

  return {
    buildTradeShareUrl,
    navigateToTradePath,
    openTrade,
    rememberTradeTerminalReturn,
    route,
    showEmptyTradeRoute
  };
}
