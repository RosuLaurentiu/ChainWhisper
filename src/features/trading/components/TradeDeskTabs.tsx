import type { TradeEntryMode } from '../hooks/useP2PTradeRoute';

type DeskNavigationPath = '/otc' | '/otc/agent' | '/otc/desk' | '/otc/orders';

type TradeViewTabsProps = {
  onNavigateDeskView: (path: DeskNavigationPath) => void;
  routeSurfaceView: string | null;
  routeView: string;
};

const tradeEntryModes = [
  ['swap', 'Swap'],
  ['limit', 'Limit'],
  ['recurring', 'Recurring']
] as const;

export function TradeViewTabs({
  onNavigateDeskView,
  routeSurfaceView,
  routeView
}: TradeViewTabsProps) {
  const tradeTabActive = routeSurfaceView === 'swap' || routeView === 'create' || routeView === 'counter';

  return (
    <nav className="p2p-trade-tabs" aria-label="OTC Desk views">
      <button
        type="button"
        className={tradeTabActive ? 'active' : undefined}
        aria-current={tradeTabActive ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc')}
      >
        <span>Trade</span>
      </button>
      <button
        type="button"
        className={routeSurfaceView === 'public' ? 'active' : undefined}
        aria-current={routeSurfaceView === 'public' ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc/desk')}
      >
        <span>Desk</span>
      </button>
      <button
        type="button"
        className={routeSurfaceView === 'agent' ? 'active' : undefined}
        aria-current={routeSurfaceView === 'agent' ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc/agent')}
      >
        <span>Agent</span>
      </button>
      <button
        type="button"
        className={routeSurfaceView === 'mine' ? 'active' : undefined}
        aria-current={routeSurfaceView === 'mine' ? 'page' : undefined}
        onClick={() => onNavigateDeskView('/otc/orders')}
      >
        <span>Orders</span>
      </button>
    </nav>
  );
}

type TradeEntryModeTabsProps = {
  activeTradeMode: TradeEntryMode;
  onOpenTradeEntryMode: (mode: TradeEntryMode) => void;
};

export function TradeEntryModeTabs({
  activeTradeMode,
  onOpenTradeEntryMode
}: TradeEntryModeTabsProps) {
  return (
    <div className="p2p-trade-mode-tabs" role="tablist" aria-label="Trade mode">
      {tradeEntryModes.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          className={activeTradeMode === mode ? 'active' : undefined}
          onClick={() => onOpenTradeEntryMode(mode)}
          role="tab"
          aria-selected={activeTradeMode === mode}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
