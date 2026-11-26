
import './CurrentDexOwnerViews.css';
import { useEffect, useState } from 'react';
import { logMobileWalletDiagnostic } from '../../../lib/mobileWalletDiagnostics';
import DexMarketChart from './DexMarketChart';
import useCurrentDexDailyPrice from '../hooks/useCurrentDexDailyPrice';
import type { CurrentDexDailyPriceConfig } from '../../../lib/currentDexDailyPrice';
import type { Eip1193Provider } from '@coti-io/coti-ethers';
import CurrentPoolWorkspace  from './CurrentPoolWorkspace';
export { parseCurrentTrialAtoms, parseCurrentTrialPriceLimit } from './CurrentPoolWorkspace';
import CurrentPoolPositionsWorkspace from './CurrentPoolPositionsWorkspace';
import CurrentDexActivity from './CurrentDexActivity';
import CurrentLimitWorkspace from './CurrentLimitWorkspace';


import { currentDexPendingStorage } from '../../../lib/currentDexPendingAttempt';
import { currentDexRecordScope } from '../../../lib/currentDexDisplay';
import type { TradingPair } from '../../../app/components/TradingProductSwitch';
import { type SharedWalletSession } from '../../../lib/walletSession';
import { resolveCurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from '../../../lib/dexV2Deployment';
import { resolvePreparedDexScope } from '../../../lib/currentDexPreparedScope';
import { currentDexManageAttentionView } from '../../../lib/currentDexPositionReview';



import { type CurrentDexMarketReference } from '../../../lib/currentDexMarketReference';


import { DexViewTabs, type DexView } from '../../trading/components/TradeDeskTabs';
import useVisualViewportKeyboardOpen from '../../../shared/hooks/useVisualViewportKeyboardOpen';
import { resolveCanonicalTradingPath } from '../../../shell/routing';
import { CurrentSwapWorkspace } from './CurrentSwapWorkspace';

type DexMode = Exclude<DexView, 'agent' | 'recurring'>;

export const resolveDexModeFromPath = (path: string): DexMode => {
  const canonicalPath = resolveCanonicalTradingPath(path).toLowerCase();
  if (canonicalPath.endsWith('/positions')) return 'positions';
  if (canonicalPath.endsWith('/strategies')) return 'strategies';
  if (canonicalPath.endsWith('/limit')) return 'limit';
  if (canonicalPath.endsWith('/recurring')) return 'swap';
  if (canonicalPath.endsWith('/liquidity')) return 'liquidity';
  if (canonicalPath.endsWith('/activity')) return 'activity';
  return 'swap';
};

export function ModeNavigation({ activeMode, onOpenAgent, onSelect }: { activeMode: DexMode; onOpenAgent?: () => void; onSelect: (mode: DexMode) => void }) {
  const selectView = (view: DexView) => {
    if (view === 'agent') {
      onOpenAgent?.();
      return;
    }
    onSelect(view === 'recurring' ? 'swap' : view);
  };
  return (
    <div className="dex-v2-mode-nav">
      <strong>DEX</strong>
      <DexViewTabs activeView={activeMode} onSelect={selectView} />
    </div>
  );
}

const DEFAULT_DEX_PAIR: TradingPair = ['BCN', 'HBR'];

export default function DexV2Page({
  priceDisplayInverted = false, selectedPair = DEFAULT_DEX_PAIR, sharedWalletSession,
  onOpenAgent, onNavigateMode, dailyPriceConfig, dailyPriceProvider, marketReference,
  swapCandidate = 'cheap-history'
}: {
  priceDisplayInverted?: boolean; selectedPair?: TradingPair; sharedWalletSession?: SharedWalletSession;
  /** Unused since CW-096: the header pair control reverses the price ratio; the Swap middle button switches Buy and Sell. */
  onPriceDisplayInvertedChange?: (inverted: boolean) => void; onOpenAgent?: () => void;
  onNavigateMode?: (mode: DexMode) => void; dailyPriceConfig?: CurrentDexDailyPriceConfig;
  dailyPriceProvider?: Pick<Eip1193Provider, 'request'>;
  marketReference?: CurrentDexMarketReference;
  swapCandidate?: CurrentCheapDexCandidateKey;
} = {}) {
  const [activeMode, setActiveMode] = useState<DexMode>(() => typeof window === 'undefined' ? 'swap' : resolveDexModeFromPath(window.location.pathname));
  const [activityView, setActivityView] = useState<'orders' | 'history'>('orders');
  useEffect(() => {
    logMobileWalletDiagnostic('dex-mounted');
    return () => logMobileWalletDiagnostic('dex-unmounted');
  }, []);
  useEffect(() => {
    logMobileWalletDiagnostic('dex-view', { mode: activeMode, activityView });
  }, [activeMode, activityView]);
  const dailyHistory = useCurrentDexDailyPrice({ pair: selectedPair, config: dailyPriceConfig, provider: dailyPriceProvider });
  const mobileKeyboardOpen = useVisualViewportKeyboardOpen();
  useEffect(() => {
    const syncModeWithLocation = () => setActiveMode(resolveDexModeFromPath(window.location.pathname));
    window.addEventListener('popstate', syncModeWithLocation);
    return () => window.removeEventListener('popstate', syncModeWithLocation);
  }, []);
  const trade = ['swap', 'limit'].includes(activeMode);
  const liquidity = ['liquidity', 'strategies'].includes(activeMode);
  const management = activeMode === 'activity' || activeMode === 'positions';
  // An unavailable prepared-market chart must keep the selected pair labels.
  const chartPair = selectedPair;
  const selectMode = (mode: DexMode) => { setActiveMode(mode); onNavigateMode?.(mode); };
  const inspect = (mode: DexMode) => { if (mode === 'activity') setActivityView('orders'); selectMode(mode); };
  // CW-140.08: Manage opens on the view of the saved item that waits for the owner.
  const attentionView = () => {
    const owner = sharedWalletSession?.walletAddress;
    if (typeof window === 'undefined' || !owner) return null;
    const prepared = true;
    const c = prepared ? resolvePreparedDexScope(swapCandidate).candidate : resolveCurrentCheapDexCandidate(swapCandidate);
    return currentDexManageAttentionView(currentDexPendingStorage(currentDexRecordScope(c, owner)),
      { chainId: String(c.chainId), owner: owner.toLowerCase(), core: c.core.toLowerCase(), graph: `0x${c.graph}`.toLowerCase() });
  };
  const openMode = (mode: DexMode) => {
    if (mode !== 'activity' || management) { selectMode(mode); return; }
    const view = attentionView();
    if (view === 'positions') selectMode('positions'); else inspect('activity');
  };
  const managementTabs = (className: string) => <nav className={`dex-v2-section-tabs ${className}`} aria-label="Manage views">
    <button type="button" aria-current={activeMode === 'activity' && activityView === 'orders' ? 'page' : undefined} onClick={() => { setActivityView('orders'); selectMode('activity'); }}>Orders</button>
    <button type="button" aria-current={activeMode === 'positions' ? 'page' : undefined} onClick={() => selectMode('positions')}>Positions</button>
    <button type="button" aria-current={activeMode === 'activity' && activityView === 'history' ? 'page' : undefined} onClick={() => { setActivityView('history'); selectMode('activity'); }}>History</button>
  </nav>;
  return <main className={`dex-v2-page${management ? ' dex-v2-manage' : ''}${mobileKeyboardOpen ? ' dex-v2-keyboard-open' : ''}`}>
    <ModeNavigation activeMode={activeMode} onOpenAgent={onOpenAgent} onSelect={openMode} />
    <section className="dex-v2-main">
      <div className="dex-v2-content-grid">
        <details className="dex-market-chart-host" open={!management || undefined}>
          <summary hidden={!management}>Market chart · {chartPair.join(' / ')}</summary>
          <DexMarketChart baseSymbol={chartPair[0]} quoteSymbol={chartPair[1]} history={dailyHistory.view}
            onHistoryRefresh={dailyHistory.refresh} marketReference={marketReference}
            priceDisplayInverted={priceDisplayInverted} />
        </details>
        <div className="dex-v2-form-column">
          <div className={management ? 'dex-mobile-management-navigation-host' : undefined} hidden={!trade && !management}>
            {trade ? <nav className="dex-v2-section-tabs" aria-label="Trade type">
              {(['swap', 'limit'] as const).map(mode => <button type="button" key={mode} aria-current={activeMode === mode ? 'page' : undefined} onClick={() => selectMode(mode)}>{mode === 'swap' ? 'Swap' : 'Limit'}</button>)}
            </nav> : management ? managementTabs('dex-mobile-management-navigation') : null}
          </div>
          {/* Keep transaction origins and private result scopes alive when users change views. */}
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'swap'}>
            <CurrentSwapWorkspace priceDisplayInverted={priceDisplayInverted} onInspect={inspect}
              selectedPair={selectedPair} sharedWalletSession={sharedWalletSession} marketReference={marketReference} candidateKey={swapCandidate} visible={activeMode === 'swap'} />
          </div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'limit' && !(activeMode === 'activity' && activityView === 'orders')}>
            <CurrentLimitWorkspace sharedWalletSession={sharedWalletSession} priceDisplayInverted={priceDisplayInverted} candidateKey={swapCandidate} selectedPair={selectedPair} managementNavigation={managementTabs('dex-desktop-management-navigation')} view={activeMode === 'activity' ? 'manage' : 'create'} visible={activeMode === 'limit' || activeMode === 'activity' && activityView === 'orders'} />
          </div>
          <div className="dex-v2-workspace-panel" hidden={!liquidity || activeMode === 'positions'}><CurrentPoolWorkspace sharedWalletSession={sharedWalletSession} priceDisplayInverted={priceDisplayInverted}
            candidateKey={swapCandidate} selectedPair={selectedPair} marketReference={marketReference} onOpenPositions={()=>selectMode('positions')} /></div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'positions'}><CurrentPoolPositionsWorkspace selectedPair={selectedPair} priceDisplayInverted={priceDisplayInverted} sharedWalletSession={sharedWalletSession} candidateKey={swapCandidate} managementNavigation={managementTabs('dex-desktop-management-navigation')} visible={activeMode === 'positions'} /></div>
          <div className="dex-v2-workspace-panel" hidden={activeMode !== 'activity' || activityView !== 'history'}><CurrentDexActivity sharedWalletSession={sharedWalletSession} candidateKey={swapCandidate} managementNavigation={managementTabs('dex-desktop-management-navigation')} visible={activeMode === 'activity' && activityView === 'history'} priceDisplayInverted={priceDisplayInverted} onInspect={inspect} /></div>
        </div>
      </div>
    </section>
  </main>;
}
