import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type {
  TerminalFillInputSide,
  TerminalReturnSurface
} from '../components/P2PTradingPage.helpers';
import type { TradePageView } from './useP2PTradeRoute';

type UseCloseTradeTerminalPanelArgs = {
  buildCurrentTradeSurfacePath: (surface: TerminalReturnSurface) => string;
  isMobileNav: boolean;
  mobileTerminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
  navigateToTradePath: (path: string) => void;
  resetSwapLinkedOrder: () => void;
  restoreMobileDeskScroll: (surface: TerminalReturnSurface) => void;
  routeView: TradePageView;
  setEmptyTerminalDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedMyTradeDetailKey: Dispatch<SetStateAction<string>>;
  setTerminalBuyInput: Dispatch<SetStateAction<string>>;
  setTerminalFillInputSide: Dispatch<SetStateAction<TerminalFillInputSide>>;
  setTerminalHistorySheetKey: Dispatch<SetStateAction<string>>;
  setTerminalPayInput: Dispatch<SetStateAction<string>>;
  terminalReturnSurfaceRef: MutableRefObject<TerminalReturnSurface>;
};

export default function useCloseTradeTerminalPanel({
  buildCurrentTradeSurfacePath,
  isMobileNav,
  mobileTerminalReturnSurfaceRef,
  navigateToTradePath,
  resetSwapLinkedOrder,
  restoreMobileDeskScroll,
  routeView,
  setEmptyTerminalDrawerOpen,
  setSelectedMyTradeDetailKey,
  setTerminalBuyInput,
  setTerminalFillInputSide,
  setTerminalHistorySheetKey,
  setTerminalPayInput,
  terminalReturnSurfaceRef
}: UseCloseTradeTerminalPanelArgs) {
  return useCallback(() => {
    if (isMobileNav) {
      const targetSurface = routeView === 'mine' ? 'mine' : mobileTerminalReturnSurfaceRef.current;
      setEmptyTerminalDrawerOpen(false);
      setSelectedMyTradeDetailKey('');
      setTerminalFillInputSide('pay');
      setTerminalPayInput('');
      setTerminalBuyInput('');
      setTerminalHistorySheetKey('');
      if (targetSurface === 'swap') {
        resetSwapLinkedOrder();
      }
      navigateToTradePath(
        targetSurface === 'mine'
          ? buildCurrentTradeSurfacePath('mine')
          : targetSurface === 'public'
            ? buildCurrentTradeSurfacePath('public')
            : targetSurface === 'agent'
              ? buildCurrentTradeSurfacePath('agent')
              : buildCurrentTradeSurfacePath('swap')
      );
      restoreMobileDeskScroll(targetSurface);
      return;
    }
    setEmptyTerminalDrawerOpen(false);
    if (routeView === 'mine') {
      setSelectedMyTradeDetailKey('');
      return;
    }
    if (routeView === 'public') {
      return;
    }
    const targetSurface = terminalReturnSurfaceRef.current;
    if (targetSurface === 'swap') {
      resetSwapLinkedOrder();
    }
    navigateToTradePath(
      targetSurface === 'public'
        ? buildCurrentTradeSurfacePath('public')
        : targetSurface === 'mine'
          ? buildCurrentTradeSurfacePath('mine')
          : targetSurface === 'agent'
            ? buildCurrentTradeSurfacePath('agent')
            : buildCurrentTradeSurfacePath('swap')
    );
  }, [
    buildCurrentTradeSurfacePath,
    isMobileNav,
    mobileTerminalReturnSurfaceRef,
    navigateToTradePath,
    resetSwapLinkedOrder,
    restoreMobileDeskScroll,
    routeView,
    setEmptyTerminalDrawerOpen,
    setSelectedMyTradeDetailKey,
    setTerminalBuyInput,
    setTerminalFillInputSide,
    setTerminalHistorySheetKey,
    setTerminalPayInput,
    terminalReturnSurfaceRef
  ]);
}
