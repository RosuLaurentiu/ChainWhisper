import {
  normalizeWalletBootstrapTargetPath,
  resolveWalletBootstrapTargetPath
} from '../lib/walletBootstrapRoute';

export type AppPage = 'home' | 'chat' | 'swap' | 'treasury' | 'trades';

export type AppRoute = {
  page: AppPage;
};

const CANONICAL_APP_PATHS: Record<AppPage, string> = {
  home: '/',
  chat: '/chat',
  swap: '/portal',
  treasury: '/treasury',
  trades: '/otc'
};

export const normalizeAppPathname = (pathname: string): string => {
  const trimmed = pathname.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlash || '/';
};

export const getPathForAppPage = (page: AppPage): string => {
  return CANONICAL_APP_PATHS[page] ?? '/';
};

export const resolveNavigationPathFromLocation = (): string => {
  if (typeof window === 'undefined') {
    return '/';
  }

  const bootstrapTargetPath = resolveWalletBootstrapTargetPath();
  if (bootstrapTargetPath) {
    return normalizeAppPathname(bootstrapTargetPath);
  }

  const redirectedPath = normalizeWalletBootstrapTargetPath(
    new URLSearchParams(window.location.search).get('p'),
    window.location.origin
  );
  return normalizeAppPathname(redirectedPath || window.location.pathname);
};

const resolveRoutePathname = (path: string): string => {
  try {
    return normalizeAppPathname(new URL(path, 'https://chainwhisper.local').pathname);
  } catch {
    return normalizeAppPathname(path.split('?')[0]?.split('#')[0] ?? path);
  }
};

const TRADE_ROUTE_SEARCH_PARAMS = ['order', 'id', 'escrow', 'contract', 'secret'];

const canUseTradeSearchParams = (pathname: string): boolean => {
  const normalizedPathname = resolveRoutePathname(pathname).toLowerCase();
  return (
    normalizedPathname === '/otc/order/recurring' ||
    normalizedPathname === '/trades/recurring' ||
    /^\/otc\/order\/recurring\/\d+$/.test(normalizedPathname) ||
    normalizedPathname === '/otcdesk/terminal/recurring' ||
    normalizedPathname.startsWith('/otc/order/link/') ||
    normalizedPathname.startsWith('/trades/l/') ||
    normalizedPathname.startsWith('/otcdesk/terminal/l/') ||
    /^\/otc\/order\/\d+$/.test(normalizedPathname) ||
    /^\/otcdesk\/terminal\/\d+$/.test(normalizedPathname) ||
    /^\/trades\/\d+$/.test(normalizedPathname)
  );
};

export const stripStaleTradeSearchParams = (pathname: string, search: string): string => {
  if (!search.trim() || canUseTradeSearchParams(pathname)) {
    return search;
  }

  const params = new URLSearchParams(search);
  for (const paramName of TRADE_ROUTE_SEARCH_PARAMS) {
    params.delete(paramName);
  }
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : '';
};

export const resolveAppRouteFromPath = (path: string, hash = ''): AppRoute => {
  const normalizedPathname = resolveRoutePathname(path).toLowerCase();
  if (normalizedPathname === '/' || normalizedPathname === '/home') {
    return { page: 'home' };
  }

  if (normalizedPathname === '/treasury' || normalizedPathname === '/treasury-data') {
    return { page: 'treasury' };
  }

  if (
    normalizedPathname === '/portal' ||
    normalizedPathname === '/swap' ||
    normalizedPathname === '/shield' ||
    normalizedPathname === '/whisper-shield'
  ) {
    return { page: 'swap' };
  }

  if (
    normalizedPathname === '/otc' ||
    normalizedPathname.startsWith('/otc/') ||
    normalizedPathname === '/otcdesk' ||
    normalizedPathname.startsWith('/otcdesk/') ||
    normalizedPathname === '/trades' ||
    normalizedPathname.startsWith('/trades/')
  ) {
    return { page: 'trades' };
  }

  if (normalizedPathname === '/chat' || normalizedPathname === '/messages' || normalizedPathname === '/messenger') {
    return { page: 'chat' };
  }

  const normalizedHash = hash.replace(/^#/, '').trim().toLowerCase();
  if (
    normalizedHash === 'home' ||
    normalizedHash === 'chat' ||
    normalizedHash === 'messages' ||
    normalizedHash === 'messenger' ||
    normalizedHash === 'portal' ||
    normalizedHash === 'swap' ||
    normalizedHash === 'shield' ||
    normalizedHash === 'whisper-shield' ||
    normalizedHash === 'treasury' ||
    normalizedHash === 'treasury-data' ||
    normalizedHash === 'otcdesk' ||
    normalizedHash === 'otc' ||
    normalizedHash === 'trades'
  ) {
    if (normalizedHash === 'messages' || normalizedHash === 'messenger') {
      return { page: 'chat' };
    }
    if (normalizedHash === 'portal' || normalizedHash === 'shield' || normalizedHash === 'whisper-shield') {
      return { page: 'swap' };
    }
    if (normalizedHash === 'treasury-data') {
      return { page: 'treasury' };
    }
    if (normalizedHash === 'otcdesk' || normalizedHash === 'otc') {
      return { page: 'trades' };
    }
    return { page: normalizedHash as AppPage };
  }

  return { page: 'home' };
};

export const resolveAppRouteFromLocation = (): AppRoute => {
  if (typeof window === 'undefined') {
    return { page: 'home' };
  }

  return resolveAppRouteFromPath(resolveNavigationPathFromLocation(), window.location.hash);
};
