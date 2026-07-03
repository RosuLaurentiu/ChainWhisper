import { useCallback, type MutableRefObject } from 'react';
import {
  buildTradeSurfacePath,
  type TradeEntryMode,
  type TradeNavigationOptions,
  type TradeRouteState
} from './useP2PTradeRoute';
import type { TradeSnapshot } from '../../../lib/appShared';
import { getSnapshotKey } from '../../../lib/p2pTradeView';
import type {
  TerminalFillInputSide,
  TerminalReturnSurface
} from '../components/P2PTradingPage.helpers';

type DeskNavigationPath = '/otc' | '/otc/agent' | '/otc/desk' | '/otc/orders';

type UseP2PTradeDeskNavigationArgs = {
  buildCurrentTradeSurfacePath: (view: Parameters<typeof buildTradeSurfacePath>[0], tradeMode?: TradeEntryMode) => string;
  emptyTerminalDrawerOpen: boolean;
  isMobileNav: boolean;
  lastAppliedSwapPinnedTradeKeyRef: MutableRefObject<string>;
  mobileDeskScrollRef: MutableRefObject<Record<TerminalReturnSurface, number>>;
  mobileTerminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
  navigateToTradePath: (path: string, options?: TradeNavigationOptions) => void;
  openTrade: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  rememberTradeTerminalReturn: (tradeId: number, accessSecret?: string, escrowContract?: string) => void;
  resolvedRouteAccessSecret: string;
  resetSwapLinkedOrder: () => void;
  resolveKnownTradeAccessSecret: (tradeId: number, escrowContract?: string) => string;
  route: TradeRouteState;
  routeSurfaceView: TradeRouteState['view'] | TerminalReturnSurface | null;
  selectedMyTradeDetailKey: string;
  setDetailTrade: (trade: TradeSnapshot | null) => void;
  setEmptyTerminalDrawerOpen: (open: boolean) => void;
  setSelectedMyTradeDetailKey: (key: string) => void;
  setSwapPinnedTradeKey: (key: string) => void;
  setTerminalBuyInput: (value: string) => void;
  setTerminalFillInputSide: (side: TerminalFillInputSide) => void;
  setTerminalHistorySheetKey: (key: string) => void;
  setTerminalPayInput: (value: string) => void;
  terminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
};

export default function useP2PTradeDeskNavigation({
  buildCurrentTradeSurfacePath,
  emptyTerminalDrawerOpen,
  isMobileNav,
  lastAppliedSwapPinnedTradeKeyRef,
  mobileDeskScrollRef,
  mobileTerminalReturnSurfaceRef,
  navigateToTradePath,
  openTrade,
  rememberTradeTerminalReturn,
  resolvedRouteAccessSecret,
  resetSwapLinkedOrder,
  resolveKnownTradeAccessSecret,
  route,
  routeSurfaceView,
  selectedMyTradeDetailKey,
  setDetailTrade,
  setEmptyTerminalDrawerOpen,
  setSelectedMyTradeDetailKey,
  setSwapPinnedTradeKey,
  setTerminalBuyInput,
  setTerminalFillInputSide,
  setTerminalHistorySheetKey,
  setTerminalPayInput,
  terminalReturnSurfaceRef
}: UseP2PTradeDeskNavigationArgs) {
  const getTradingShellScrollTop = useCallback((): number => {
    const shell = document.querySelector<HTMLElement>('.standalone-trades-shell');
    return shell?.scrollTop ?? window.scrollY ?? 0;
  }, []);

  const saveMobileDeskScroll = useCallback(
    (view = route.view) => {
      if (!isMobileNav) {
        return;
      }
      const surface =
        view === 'mine' ? 'mine' : view === 'public' ? 'public' : view === 'agent' ? 'agent' : view === 'swap' ? 'swap' : null;
      if (!surface) {
        return;
      }
      mobileTerminalReturnSurfaceRef.current = surface;
      mobileDeskScrollRef.current[surface] = getTradingShellScrollTop();
    },
    [getTradingShellScrollTop, isMobileNav, mobileDeskScrollRef, mobileTerminalReturnSurfaceRef, route.view]
  );

  const restoreMobileDeskScroll = useCallback(
    (surface: TerminalReturnSurface) => {
      if (!isMobileNav) {
        return;
      }
      const top = mobileDeskScrollRef.current[surface] ?? 0;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const shell = document.querySelector<HTMLElement>('.standalone-trades-shell');
          if (shell) {
            shell.scrollTo({ top, behavior: 'auto' });
            return;
          }
          window.scrollTo({ top, behavior: 'auto' });
        });
      });
    },
    [isMobileNav, mobileDeskScrollRef]
  );

  const resetTerminalInputs = useCallback(() => {
    setEmptyTerminalDrawerOpen(false);
    setSelectedMyTradeDetailKey('');
    setTerminalFillInputSide('pay');
    setTerminalPayInput('');
    setTerminalBuyInput('');
    setTerminalHistorySheetKey('');
  }, [
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput
  ]);

  const openTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot, accessSecret?: string) => {
      const returnSurface =
        routeSurfaceView === 'public'
          ? 'public'
          : routeSurfaceView === 'mine'
            ? 'mine'
            : routeSurfaceView === 'agent'
              ? 'agent'
              : 'swap';
      terminalReturnSurfaceRef.current = returnSurface;
      const knownAccessSecret =
        accessSecret ||
        (snapshot.isPublic === false || snapshot.hasAccessHash
          ? resolveKnownTradeAccessSecret(snapshot.tradeId, snapshot.escrowContract)
          : '');
      saveMobileDeskScroll(returnSurface);
      if (returnSurface === 'swap') {
        lastAppliedSwapPinnedTradeKeyRef.current = '';
        setSwapPinnedTradeKey(getSnapshotKey(snapshot));
      }
      setEmptyTerminalDrawerOpen(false);
      setDetailTrade(snapshot);
      openTrade(snapshot.tradeId, knownAccessSecret || undefined, snapshot.escrowContract);
    },
    [
      openTrade,
      resolveKnownTradeAccessSecret,
      lastAppliedSwapPinnedTradeKeyRef,
      routeSurfaceView,
      saveMobileDeskScroll,
      setDetailTrade,
      setEmptyTerminalDrawerOpen,
      setSwapPinnedTradeKey,
      terminalReturnSurfaceRef
    ]
  );

  const openEmptyTerminalPanel = useCallback(() => {
    const returnSurface =
      routeSurfaceView === 'public'
        ? 'public'
        : routeSurfaceView === 'mine'
          ? 'mine'
          : routeSurfaceView === 'agent'
            ? 'agent'
            : 'swap';
    terminalReturnSurfaceRef.current = returnSurface;
    saveMobileDeskScroll(returnSurface);
    setEmptyTerminalDrawerOpen(true);
    navigateToTradePath(buildCurrentTradeSurfacePath('trade'));
  }, [
    buildCurrentTradeSurfacePath,
    navigateToTradePath,
    routeSurfaceView,
    saveMobileDeskScroll,
    setEmptyTerminalDrawerOpen,
    terminalReturnSurfaceRef
  ]);

  const scrollTradingShellToTop = useCallback(() => {
    const shell = document.querySelector<HTMLElement>('.standalone-trades-shell');
    if (shell) {
      shell.scrollTo({ top: 0, behavior: 'smooth' });
      if (route.view === 'public' || route.view === 'mine') {
        mobileDeskScrollRef.current[route.view] = 0;
      }
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (route.view === 'public' || route.view === 'mine') {
      mobileDeskScrollRef.current[route.view] = 0;
    }
  }, [mobileDeskScrollRef, route.view]);

  const navigateDeskView = useCallback(
    (path: DeskNavigationPath) => {
      const openingTradeSurface = path === '/otc';
      const targetSurface =
        path === '/otc/orders' ? 'mine' : path === '/otc/desk' ? 'public' : path === '/otc/agent' ? 'agent' : 'swap';
      if (openingTradeSurface) {
        resetSwapLinkedOrder();
      }
      if (
        targetSurface === 'public' &&
        route.view === 'trade' &&
        route.tradeId !== null &&
        terminalReturnSurfaceRef.current === 'swap'
      ) {
        terminalReturnSurfaceRef.current = 'public';
        mobileTerminalReturnSurfaceRef.current = 'public';
        rememberTradeTerminalReturn(route.tradeId, resolvedRouteAccessSecret || undefined, route.escrowContract);
        resetTerminalInputs();
        navigateToTradePath(path, { clearPendingTerminalRoute: false });
        if (isMobileNav) {
          restoreMobileDeskScroll('public');
        }
        return;
      }
      if (isMobileNav) {
        const targetView = targetSurface;
        const returningFromTerminal =
          emptyTerminalDrawerOpen || route.view === 'trade' || (route.view === 'mine' && Boolean(selectedMyTradeDetailKey));
        if (
          route.view === targetView &&
          !emptyTerminalDrawerOpen &&
          !(route.view === 'mine' && selectedMyTradeDetailKey)
        ) {
          scrollTradingShellToTop();
          return;
        }
        resetTerminalInputs();
        navigateToTradePath(path);
        if (returningFromTerminal && (targetView === 'public' || targetView === 'mine')) {
          restoreMobileDeskScroll(targetView);
        }
        return;
      }
      const targetView = targetSurface;
      const currentSurface =
        route.view === 'trade'
          ? terminalReturnSurfaceRef.current
          : route.view === 'mine'
            ? 'mine'
            : route.view === 'public'
              ? 'public'
              : route.view === 'swap'
                ? 'swap'
                : route.view === 'agent'
                  ? 'agent'
                  : null;
      const currentDeskTerminalOpen =
        emptyTerminalDrawerOpen || route.view === 'trade' || (route.view === 'mine' && Boolean(selectedMyTradeDetailKey));
      if (currentSurface === targetSurface && currentDeskTerminalOpen) {
        resetTerminalInputs();
        if (route.view !== targetView) {
          navigateToTradePath(path);
        }
        return;
      }
      const shouldKeepTerminalOpen =
        emptyTerminalDrawerOpen || route.view === 'trade' || (route.view === 'mine' && Boolean(selectedMyTradeDetailKey));
      if (shouldKeepTerminalOpen) {
        resetTerminalInputs();
      }
      navigateToTradePath(path);
    },
    [
      emptyTerminalDrawerOpen,
      isMobileNav,
      mobileTerminalReturnSurfaceRef,
      navigateToTradePath,
      rememberTradeTerminalReturn,
      resetSwapLinkedOrder,
      resetTerminalInputs,
      resolvedRouteAccessSecret,
      restoreMobileDeskScroll,
      route.escrowContract,
      route.tradeId,
      route.view,
      scrollTradingShellToTop,
      selectedMyTradeDetailKey,
      setSwapPinnedTradeKey,
      terminalReturnSurfaceRef
    ]
  );

  return {
    navigateDeskView,
    openEmptyTerminalPanel,
    openTradeSnapshot,
    restoreMobileDeskScroll,
    saveMobileDeskScroll
  };
}
