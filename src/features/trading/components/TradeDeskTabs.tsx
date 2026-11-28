import { AppTab, AppTabList } from '../../../shared/ui/AppTabs';
import type { TradeEntryMode, TradeSwapVenue } from '../hooks/useP2PTradeRoute';

type DeskNavigationPath = '/otc' | '/otc/agent' | '/otc/desk' | '/otc/limit' | '/otc/orders';
type TradingProduct = 'dex' | 'otc';
export type DexView = 'swap' | 'limit' | 'recurring' | 'liquidity' | 'activity' | 'strategies' | 'positions' | 'agent';

type TradeProductTabsProps = {
  activeProduct: TradingProduct;
  onNavigate: (path: '/dex' | '/otc/desk') => void;
};

export function TradeProductTabs({ activeProduct, onNavigate }: TradeProductTabsProps) {
  return (
    <nav className="p2p-trade-tabs p2p-product-tabs" aria-label="Trading workspace">
      <button
        type="button"
        className={activeProduct === 'dex' ? 'active' : undefined}
        aria-current={activeProduct === 'dex' ? 'page' : undefined}
        onClick={() => onNavigate('/dex')}
      >
        <span>DEX</span>
      </button>
      <button
        type="button"
        className={activeProduct === 'otc' ? 'active' : undefined}
        aria-current={activeProduct === 'otc' ? 'page' : undefined}
        onClick={() => onNavigate('/otc/desk')}
      >
        <span>P2P</span>
      </button>
    </nav>
  );
}

type DexViewTabsProps = {
  activeView: DexView;
  onSelect: (view: DexView) => void;
};

const DEX_VIEWS: ReadonlyArray<Readonly<{ id: DexView; label: string }>> = Object.freeze([
  Object.freeze({ id: 'swap', label: 'Trade' }),
  Object.freeze({ id: 'liquidity', label: 'Liquidity' }),
  Object.freeze({ id: 'activity', label: 'Manage' })
]);

export function DexViewTabs({ activeView, onSelect }: DexViewTabsProps) {
  const section = activeView === 'limit' || activeView === 'recurring' ? 'swap'
    : activeView === 'strategies' ? 'liquidity' : activeView === 'positions' ? 'activity' : activeView;
  return (
    <div className="dex-view-navigation">
    <nav className="p2p-trade-tabs p2p-product-view-tabs" aria-label="DEX trading views">
      {DEX_VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={section === id ? 'active' : undefined}
          aria-current={section === id ? 'page' : undefined}
          onClick={() => onSelect(id)}
        >
          <span>{label}</span>
        </button>
      ))}
    </nav>
    <button type="button" className="dex-agent-link" aria-current={activeView === 'agent' ? 'page' : undefined} onClick={() => onSelect('agent')}>Agent</button>
    </div>
  );
}

type TradeViewTabsProps = {
  onNavigateDeskView: (path: DeskNavigationPath) => void;
  routeSurfaceView: string | null;
  routeView: string;
};

const tradeEntryModes = [
  ['swap', 'Swap'],
  ['limit', 'Limit']
] as const;

const createEntryModes = [
  ['limit', 'One-off']
] as const;

export function TradeViewTabs({
  onNavigateDeskView,
  routeSurfaceView,
  routeView
}: TradeViewTabsProps) {
  const offersTabActive = routeSurfaceView === 'swap' || routeSurfaceView === 'public';
  const createTabActive = routeView === 'create' || routeView === 'counter';

  return (
    <nav className="p2p-trade-tabs" aria-label="P2P trading views">
      <button
        type="button"
        className={offersTabActive ? 'active' : undefined}
        aria-current={offersTabActive ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc')}
      >
        <span>Offers</span>
      </button>
      <button
        type="button"
        className={createTabActive ? 'active' : undefined}
        aria-current={createTabActive ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc/limit')}
      >
        <span>Create</span>
      </button>
      <button
        type="button"
        className={routeSurfaceView === 'mine' ? 'active' : undefined}
        aria-current={routeSurfaceView === 'mine' ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc/orders')}
      >
        <span>My trades</span>
      </button>
      <button
        type="button"
        className={`p2p-agent-nav-tab${routeSurfaceView === 'agent' ? ' active' : ''}`}
        aria-current={routeSurfaceView === 'agent' ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc/agent')}
      >
        <span>Agent</span>
      </button>
    </nav>
  );
}

type TradeEntryModeTabsProps = {
  activeTradeMode: TradeEntryMode;
  createOnly?: boolean;
  onOpenTradeEntryMode: (mode: TradeEntryMode) => void;
};

export function TradeEntryModeTabs({
  activeTradeMode,
  createOnly = false,
  onOpenTradeEntryMode
}: TradeEntryModeTabsProps) {
  const visibleModes = createOnly ? createEntryModes : tradeEntryModes;

  return (
    <AppTabList className="p2p-trade-mode-tabs" label="Trade mode" value={activeTradeMode} onChange={onOpenTradeEntryMode}>
      {visibleModes.map(([mode, label]) => (
        <AppTab
          key={mode}
          value={mode}
          data-trade-mode={mode}
          onClick={activeTradeMode === mode ? () => onOpenTradeEntryMode(mode) : undefined}
        >
          {label}
        </AppTab>
      ))}
    </AppTabList>
  );
}

type TradeSwapVenueTabsProps = {
  activeVenue: TradeSwapVenue;
  onChange: (venue: TradeSwapVenue) => void;
};

const swapVenues = [
  ['private-liquidity', 'Recurring Limits'],
  ['otc', 'P2P Order']
] as const;

export function TradeSwapVenueTabs({ activeVenue, onChange }: TradeSwapVenueTabsProps) {
  return (
    <AppTabList className="p2p-swap-side-switch p2p-swap-venue-switch" label="Swap venue" value={activeVenue} onChange={onChange}>
      {swapVenues.map(([venue, label]) => (
        <AppTab
          key={venue}
          value={venue}
          data-swap-venue={venue}
          onClick={activeVenue === venue ? () => onChange(venue) : undefined}
        >
          {label}
        </AppTab>
      ))}
    </AppTabList>
  );
}
