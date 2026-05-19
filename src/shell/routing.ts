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
  trades: '/trades'
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

  if (normalizedPathname === '/trades' || normalizedPathname.startsWith('/trades/')) {
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
