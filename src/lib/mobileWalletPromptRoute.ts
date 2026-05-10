import { isMobileBrowserUserAgent } from './walletOptions';

export const MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY = 'chainwhisper:p2p:mobile-prompt-route-shim:v1';

const TRADE_ROUTE_PREFIX = '/trades';
const PROMPT_SAFE_PATH = '/chat';

type PromptRouteShimOptions = {
  enabled: boolean;
  isMobileBrowser?: boolean;
  location?: Pick<Location, 'pathname' | 'search' | 'hash'>;
  storage?: Pick<Storage, 'removeItem' | 'setItem'> | null;
  history?: Pick<History, 'replaceState' | 'state'> | null;
  now?: number;
  onTrace?: (event: string, detail: Record<string, unknown>) => void;
};

const buildCurrentRoute = (location: Pick<Location, 'pathname' | 'search' | 'hash'>): string =>
  `${location.pathname}${location.search}${location.hash}`;

const buildPromptSafeRoute = (tradeRoute: string): string =>
  `${PROMPT_SAFE_PATH}?p=${encodeURIComponent(tradeRoute)}`;

const describeRouteForTrace = (pathname: string): string =>
  pathname.toLowerCase().startsWith(`${TRADE_ROUTE_PREFIX}/`) ? `${TRADE_ROUTE_PREFIX}/[route]` : pathname;

export const beginMobileWalletPromptRouteShim = ({
  enabled,
  isMobileBrowser = isMobileBrowserUserAgent(),
  location = typeof window !== 'undefined' ? window.location : undefined,
  storage = typeof window !== 'undefined' ? window.sessionStorage : null,
  history = typeof window !== 'undefined' ? window.history : null,
  now = Date.now(),
  onTrace
}: PromptRouteShimOptions): (() => void) => {
  if (!enabled || !isMobileBrowser || !location || !history) {
    return () => {};
  }

  if (!location.pathname.toLowerCase().startsWith(TRADE_ROUTE_PREFIX)) {
    return () => {};
  }

  const originalPathname = location.pathname;
  const originalRoute = buildCurrentRoute(location);
  const promptSafeRoute = buildPromptSafeRoute(originalRoute);

  try {
    storage?.setItem(
      MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY,
      JSON.stringify({
        path: originalRoute,
        timestamp: now
      })
    );
  } catch {
  }

  try {
    history.replaceState(history.state, '', promptSafeRoute);
    onTrace?.('mobile-prompt-route-shim-start', {
      fromRoute: describeRouteForTrace(originalPathname),
      toRoute: `${PROMPT_SAFE_PATH}?p=[route]`
    });
  } catch {
    return () => {};
  }

  let restored = false;
  return () => {
    if (restored) {
      return;
    }
    restored = true;

    try {
      storage?.removeItem(MOBILE_WALLET_PROMPT_ROUTE_SHIM_KEY);
    } catch {
    }

    const currentPathname = location.pathname;
    if (currentPathname !== PROMPT_SAFE_PATH) {
      onTrace?.('mobile-prompt-route-shim-skip-restore', {
        currentRoute: describeRouteForTrace(currentPathname),
        expectedRoute: PROMPT_SAFE_PATH
      });
      return;
    }

    try {
      history.replaceState(history.state, '', originalRoute);
      onTrace?.('mobile-prompt-route-shim-finish', {
        restoredRoute: originalRoute.startsWith(TRADE_ROUTE_PREFIX) ? TRADE_ROUTE_PREFIX : location.pathname
      });
    } catch {
    }
  };
};
