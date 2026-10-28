import { StrictMode, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import InitialHomeApp from './app/components/InitialHomeApp';
import { RouteLoadingFallback } from './app/lazyRoutes';
import type { AppHelpLaunchContext } from './lib/appHelpLaunch';
import {
  getPathForAppPage,
  getTitleForAppPage,
  resolveAppRouteFromLocation,
  stripStaleTradeSearchParams,
  type AppPage
} from './shell/routing';
import './styles.css';

const App = lazy(() => import('./App'));

const navigateToPath = (path: string) => {
  const nextUrl = new URL(window.location.href);
  nextUrl.pathname = path;
  nextUrl.search = stripStaleTradeSearchParams(path, nextUrl.search);
  nextUrl.searchParams.delete('p');
  nextUrl.hash = '';
  window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}`);
};

function AppEntry() {
  const [fullAppRequired, setFullAppRequired] = useState(
    () => resolveAppRouteFromLocation().page !== 'home'
  );
  const [initialAppHelpLaunchContext, setInitialAppHelpLaunchContext] =
    useState<AppHelpLaunchContext | null>(null);

  useEffect(() => {
    if (fullAppRequired) {
      return undefined;
    }

    document.title = getTitleForAppPage('home');
    if (window.location.pathname !== '/' || window.location.hash || window.location.search) {
      const nextUrl = new URL(window.location.href);
      nextUrl.pathname = '/';
      nextUrl.search = stripStaleTradeSearchParams('/', nextUrl.search);
      nextUrl.searchParams.delete('p');
      nextUrl.hash = '';
      window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}`);
    }

    const handleLocationChange = () => {
      if (resolveAppRouteFromLocation().page !== 'home') {
        setFullAppRequired(true);
      }
    };
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, [fullAppRequired]);

  const openPage = useCallback((page: AppPage) => {
    setInitialAppHelpLaunchContext(null);
    navigateToPath(getPathForAppPage(page));
    setFullAppRequired(true);
  }, []);

  const openHelp = useCallback(() => {
    setInitialAppHelpLaunchContext({ origin: 'home' });
    navigateToPath('/otc/agent');
    setFullAppRequired(true);
  }, []);

  if (!fullAppRequired) {
    return <InitialHomeApp onNavigate={openPage} onOpenHelp={openHelp} />;
  }

  return (
    <Suspense
      fallback={<RouteLoadingFallback shellClassName="app-shell app-shell-wallet" label="Loading ChainWhisper" />}
    >
      <App initialAppHelpLaunchContext={initialAppHelpLaunchContext} />
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>
);
