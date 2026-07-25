import { useCallback, useEffect } from 'react';
import { isTradeMobileShellRoute } from '../../lib/tradeMobileShell';
import {
  freezeDirectMetaMaskMobileRoute,
  freezeWalletBootstrapUrlAfterEntry,
  isWalletBootstrapRoute,
  writeWalletBootstrapActiveRouteState
} from '../../lib/walletBootstrapRoute';
import { isWalletTransactionFlowActive } from '../../lib/walletTransactionFlow';
import {
  getPathForAppPage,
  getTitleForAppPage,
  resolveAppRouteFromLocation,
  resolveAppRouteFromPath,
  resolveNavigationPathFromLocation,
  stripStaleTradeSearchParams,
  type AppPage
} from '../../shell/routing';

type UseAppNavigationArgs = {
  activePage: AppPage;
  setActivePage: (page: AppPage) => void;
};

export default function useAppNavigation({ activePage, setActivePage }: UseAppNavigationArgs) {
  const navigateToPage = useCallback(
    (page: AppPage) => {
      setActivePage(page);
      if (typeof window === 'undefined') {
        return;
      }

      const nextPath = getPathForAppPage(page);
      if (isWalletBootstrapRoute(window.location.pathname)) {
        writeWalletBootstrapActiveRouteState(nextPath, {
          replace: resolveNavigationPathFromLocation() === nextPath
        });
        return;
      }

      const currentPath = resolveNavigationPathFromLocation();
      const nextHash = '';
      if (
        currentPath !== nextPath ||
        window.location.hash !== nextHash ||
        new URLSearchParams(window.location.search).has('p') ||
        window.location.search !== stripStaleTradeSearchParams(nextPath, window.location.search)
      ) {
        const nextUrl = new URL(window.location.href);
        nextUrl.pathname = nextPath;
        nextUrl.search = stripStaleTradeSearchParams(nextPath, nextUrl.search);
        nextUrl.searchParams.delete('p');
        nextUrl.hash = nextHash;
        window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      }
    },
    [setActivePage]
  );

  const navigateToInternalAppLink = useCallback(
    (href: string) => {
      if (typeof window === 'undefined') {
        return;
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(href, window.location.origin);
      } catch {
        return;
      }

      if (targetUrl.origin !== window.location.origin) {
        return;
      }

      const nextUrl = new URL(window.location.href);
      nextUrl.pathname = targetUrl.pathname;
      nextUrl.search = stripStaleTradeSearchParams(targetUrl.pathname, targetUrl.search);
      nextUrl.hash = targetUrl.hash;
      if (isWalletBootstrapRoute(window.location.pathname)) {
        const targetPath = `${targetUrl.pathname}${stripStaleTradeSearchParams(targetUrl.pathname, targetUrl.search)}${targetUrl.hash}`;
        writeWalletBootstrapActiveRouteState(targetPath, {
          replace: resolveNavigationPathFromLocation() === targetPath
        });
        setActivePage(resolveAppRouteFromPath(targetPath).page);
        return;
      }

      window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      setActivePage(resolveAppRouteFromLocation().page);
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    },
    [setActivePage]
  );

  useEffect(() => {
    const syncPageWithLocation = () => {
      if (isWalletTransactionFlowActive()) {
        return;
      }
      freezeDirectMetaMaskMobileRoute();
      const nextRoute = resolveAppRouteFromLocation();
      setActivePage(nextRoute.page);

      const currentPath = resolveNavigationPathFromLocation();
      const preserveWalletBootstrap = isWalletBootstrapRoute(window.location.pathname);
      if (preserveWalletBootstrap) {
        freezeWalletBootstrapUrlAfterEntry();
      }
      const lowerCurrentPath = currentPath.toLowerCase();
      const canonicalPath =
        nextRoute.page === 'trades' &&
        (lowerCurrentPath.startsWith('/otc') ||
          lowerCurrentPath.startsWith('/trades') ||
          lowerCurrentPath.startsWith('/otcdesk'))
          ? currentPath
          : getPathForAppPage(nextRoute.page);
      const canonicalHash = nextRoute.page === 'trades' ? window.location.hash : '';
      const preserveTradeShell =
        nextRoute.page === 'trades' && isTradeMobileShellRoute(window.location.pathname, window.location.search);
      const canonicalSearch =
        preserveWalletBootstrap || preserveTradeShell
          ? window.location.search
          : stripStaleTradeSearchParams(canonicalPath, window.location.search);
      if (
        !preserveWalletBootstrap &&
        !preserveTradeShell &&
        (currentPath !== canonicalPath ||
          window.location.search !== canonicalSearch ||
          window.location.hash !== canonicalHash ||
          new URLSearchParams(window.location.search).has('p'))
      ) {
        const nextUrl = new URL(window.location.href);
        nextUrl.pathname = canonicalPath;
        nextUrl.search = canonicalSearch;
        nextUrl.searchParams.delete('p');
        nextUrl.hash = canonicalHash;
        window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      }
    };

    syncPageWithLocation();
    window.addEventListener('popstate', syncPageWithLocation);
    window.addEventListener('hashchange', syncPageWithLocation);
    return () => {
      window.removeEventListener('popstate', syncPageWithLocation);
      window.removeEventListener('hashchange', syncPageWithLocation);
    };
  }, [setActivePage]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = getTitleForAppPage(activePage);
    }
  }, [activePage]);

  return { navigateToInternalAppLink, navigateToPage };
}
