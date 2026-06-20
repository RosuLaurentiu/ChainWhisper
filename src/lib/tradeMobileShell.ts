export const TRADE_ROUTE_PREFIX = '/trades';
export const TRADE_MOBILE_SHELL_PATH = '/trades';
const OTC_ROUTE_PREFIX = '/otc';
const OTC_DESK_ROUTE_PREFIX = '/otcdesk';

const isTradeAppRoute = (path: string): boolean => {
  const normalizedPath = path.toLowerCase();
  return (
    normalizedPath.startsWith(OTC_ROUTE_PREFIX) ||
    normalizedPath.startsWith(TRADE_ROUTE_PREFIX) ||
    normalizedPath.startsWith(OTC_DESK_ROUTE_PREFIX)
  );
};

const getTradeShellRedirectPath = (search: string): string => {
  try {
    const redirectedPath = new URLSearchParams(search).get('p')?.trim() ?? '';
    return isTradeAppRoute(redirectedPath) ? redirectedPath : '';
  } catch {
    return '';
  }
};

export const isTradeMobileShellRoute = (pathname: string, search = ''): boolean =>
  pathname.toLowerCase() === TRADE_MOBILE_SHELL_PATH && Boolean(getTradeShellRedirectPath(search));

export const buildTradeMobileShellPath = (tradeRoute: string): string => {
  const parsedRoute = new URL(tradeRoute, 'https://chainwhisper.local');
  if (isTradeMobileShellRoute(parsedRoute.pathname, parsedRoute.search)) {
    return `${parsedRoute.pathname}${parsedRoute.search}${parsedRoute.hash}`;
  }

  const normalizedRoute = `${parsedRoute.pathname}${parsedRoute.search}${parsedRoute.hash}`;
  return `${TRADE_MOBILE_SHELL_PATH}?p=${encodeURIComponent(normalizedRoute)}`;
};
