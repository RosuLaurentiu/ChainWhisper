export const TRADE_ROUTE_PREFIX = '/trades';
export const TRADE_MOBILE_SHELL_PATH = '/trades';

const getTradeShellRedirectPath = (search: string): string => {
  try {
    const redirectedPath = new URLSearchParams(search).get('p')?.trim() ?? '';
    return redirectedPath.toLowerCase().startsWith(TRADE_ROUTE_PREFIX) ? redirectedPath : '';
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
