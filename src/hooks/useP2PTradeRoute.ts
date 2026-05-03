import { useCallback, useEffect, useState } from 'react';
import {
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  isWalletAddress
} from '../lib/appShared/core';
import { decodeTradeLink, encodeTradeLink } from '../lib/tradeLinks';

export type TradePageView = 'public' | 'create' | 'trade' | 'mine';

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
  if (lowerPathname === '/trades/open') {
    return createEmptyTradeRoute();
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

const buildTradeLinkPath = (tradeId: number, accessSecret?: string, escrowContract?: string): string => {
  const code = encodeTradeLink(tradeId, accessSecret);
  const search =
    escrowContract && escrowContract.toLowerCase() === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()
      ? '?escrow=private'
      : '';
  return `/trades/l/${code}${search}`;
};

type UseP2PTradeRouteResult = {
  buildTradeShareUrl: (tradeId: number, accessSecret?: string, escrowContract?: string) => string;
  navigateToTradePath: (path: string) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  route: TradeRouteState;
  showEmptyTradeRoute: () => void;
};

export default function useP2PTradeRoute(): UseP2PTradeRouteResult {
  const [route, setRoute] = useState<TradeRouteState>(() => resolveTradeRouteFromLocation());

  const navigateToTradePath = useCallback((path: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    const targetUrl = new URL(path, window.location.origin);
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = targetUrl.pathname;
    nextUrl.search = targetUrl.search;
    nextUrl.hash = targetUrl.hash;
    window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    setRoute(resolveTradeRouteFromLocation());
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
    nextUrl.hash = '';
    return nextUrl.toString();
  }, []);

  const openTrade = useCallback(
    (tradeId: number, accessSecret?: string, escrowContract?: string) => {
      navigateToTradePath(buildTradeLinkPath(tradeId, accessSecret, escrowContract));
    },
    [navigateToTradePath]
  );

  const showEmptyTradeRoute = useCallback(() => {
    setRoute(createEmptyTradeRoute());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncRoute = () => {
      setRoute(resolveTradeRouteFromLocation());
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  return {
    buildTradeShareUrl,
    navigateToTradePath,
    openTrade,
    route,
    showEmptyTradeRoute
  };
}
