import type { KeyboardEventHandler } from 'react';
import { moveFocusWithin } from '../../../shared/components/a11y';
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
  const handleModeKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (
      !moveFocusWithin(event, {
        orientation: 'horizontal',
        selector: '[role="tab"]:not(:disabled)'
      })
    ) {
      return;
    }

    const nextMode = (
      event.currentTarget.ownerDocument.activeElement as HTMLElement | null
    )?.dataset.tradeMode as TradeEntryMode | undefined;
    if (nextMode && nextMode !== activeTradeMode) {
      onOpenTradeEntryMode(nextMode);
    }
  };

  return (
    <div
      className="p2p-trade-mode-tabs"
      role="tablist"
      aria-label="Trade mode"
      onKeyDown={handleModeKeyDown}
    >
      {visibleModes.map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          className={activeTradeMode === mode ? 'active' : undefined}
          onClick={() => onOpenTradeEntryMode(mode)}
          role="tab"
          aria-selected={activeTradeMode === mode}
          tabIndex={activeTradeMode === mode ? 0 : -1}
          data-trade-mode={mode}
        >
          {label}
        </button>
      ))}
    </div>
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
  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!moveFocusWithin(event, { orientation: 'horizontal', selector: '[role="tab"]' })) return;
    const venue = (
      event.currentTarget.ownerDocument.activeElement as HTMLElement | null
    )?.dataset.swapVenue as TradeSwapVenue | undefined;
    if (venue && venue !== activeVenue) onChange(venue);
  };

  return (
    <div
      className="p2p-swap-side-switch p2p-swap-venue-switch"
      role="tablist"
      aria-label="Swap venue"
      onKeyDown={handleKeyDown}
    >
      {swapVenues.map(([venue, label]) => (
        <button
          key={venue}
          type="button"
          className={activeVenue === venue ? 'active' : undefined}
          onClick={() => onChange(venue)}
          role="tab"
          aria-selected={activeVenue === venue}
          tabIndex={activeVenue === venue ? 0 : -1}
          data-swap-venue={venue}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
