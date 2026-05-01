export type AppPage = 'home' | 'chat' | 'swap' | 'treasury' | 'trades';

export type AppRoute = {
  page: AppPage;
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
  if (page === 'home') {
    return '/home';
  }

  if (page === 'chat') {
    return '/chat';
  }

  if (page === 'swap') {
    return '/swap';
  }

  if (page === 'treasury') {
    return '/treasury';
  }

  if (page === 'trades') {
    return '/trades';
  }

  return '/';
};

export const resolveNavigationPathFromLocation = (): string => {
  if (typeof window === 'undefined') {
    return '/';
  }

  const redirectedPath = new URLSearchParams(window.location.search).get('p');
  return normalizeAppPathname(redirectedPath || window.location.pathname);
};

export const resolveAppRouteFromLocation = (): AppRoute => {
  if (typeof window === 'undefined') {
    return { page: 'chat' };
  }

  const normalizedPathname = resolveNavigationPathFromLocation().toLowerCase();
  if (normalizedPathname === '/home') {
    return { page: 'home' };
  }

  if (normalizedPathname === '/treasury') {
    return { page: 'treasury' };
  }

  if (normalizedPathname === '/swap') {
    return { page: 'swap' };
  }

  if (normalizedPathname === '/trades' || normalizedPathname.startsWith('/trades/')) {
    return { page: 'trades' };
  }

  if (normalizedPathname === '/' || normalizedPathname === '/chat') {
    return { page: 'chat' };
  }

  const normalizedHash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  if (
    normalizedHash === 'home' ||
    normalizedHash === 'chat' ||
    normalizedHash === 'swap' ||
    normalizedHash === 'treasury' ||
    normalizedHash === 'trades'
  ) {
    return { page: normalizedHash as AppPage };
  }

  return { page: 'chat' };
};
