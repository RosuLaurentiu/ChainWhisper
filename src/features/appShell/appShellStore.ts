import { create } from 'zustand';
import type { AppPage } from '../../shell/routing';
import { resolveAppRouteFromLocation } from '../../shell/routing';
import type { MobileView } from '../../lib/appShared';
import type { RealtimeConnectionStatus } from '../../shell/realtimeConnection';
import { resolveStateUpdate, type StateUpdate } from '../../shared/state/storeUtils';

type AppShellState = {
  activePage: AppPage;
  activeMobileView: MobileView;
  mobileLinksOpen: boolean;
  chatWalletMenuOpen: boolean;
  directRealtimeStatus: RealtimeConnectionStatus;
  groupRealtimeStatus: RealtimeConnectionStatus;
  setActivePage: (page: AppPage) => void;
  setActiveMobileView: (view: MobileView) => void;
  setMobileLinksOpen: (next: StateUpdate<boolean>) => void;
  setChatWalletMenuOpen: (next: StateUpdate<boolean>) => void;
  setDirectRealtimeStatus: (status: RealtimeConnectionStatus) => void;
  setGroupRealtimeStatus: (status: RealtimeConnectionStatus) => void;
};

export const useAppShellStore = create<AppShellState>((set) => ({
  activePage: resolveAppRouteFromLocation().page,
  activeMobileView: 'contacts',
  mobileLinksOpen: false,
  chatWalletMenuOpen: false,
  directRealtimeStatus: 'idle',
  groupRealtimeStatus: 'idle',
  setActivePage: (activePage) => set({ activePage }),
  setActiveMobileView: (activeMobileView) => set({ activeMobileView }),
  setMobileLinksOpen: (next) =>
    set((state) => ({ mobileLinksOpen: resolveStateUpdate(next, state.mobileLinksOpen) })),
  setChatWalletMenuOpen: (next) =>
    set((state) => ({ chatWalletMenuOpen: resolveStateUpdate(next, state.chatWalletMenuOpen) })),
  setDirectRealtimeStatus: (directRealtimeStatus) => set({ directRealtimeStatus }),
  setGroupRealtimeStatus: (groupRealtimeStatus) => set({ groupRealtimeStatus })
}));
