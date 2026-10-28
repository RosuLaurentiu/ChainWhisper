import { lazy } from 'react';

export const QuickActionsModal = lazy(() => import('../features/chat/components/QuickActionsModal'));

let directChatPanelModulePromise: Promise<typeof import('../features/chat/components/DirectChatPanel')> | null = null;
let groupChatPanelModulePromise: Promise<typeof import('../features/groups/components/GroupChatPanel')> | null = null;
let p2pTradingPageModulePromise: Promise<typeof import('../features/trading/components/P2PTradingPage')> | null = null;
let tokenSwapPageModulePromise: Promise<typeof import('../features/tokenTools/components/TokenSwapPage')> | null = null;
let privateTvlPageModulePromise: Promise<typeof import('../features/treasury/components/PrivateTvlPage')> | null = null;
type DexPageModule = Pick<typeof import('../features/dex/components/DexV2Page'), 'default'>;
let dexV2PageModulePromise: Promise<DexPageModule> | null = null;
let privateTvlDataModulePromise: Promise<typeof import('../features/treasury/privateTvlData')> | null = null;

const loadDirectChatPanel = () => {
  directChatPanelModulePromise ??= import('../features/chat/components/DirectChatPanel');
  return directChatPanelModulePromise;
};

const loadGroupChatPanel = () => {
  groupChatPanelModulePromise ??= import('../features/groups/components/GroupChatPanel');
  return groupChatPanelModulePromise;
};

const loadP2PTradingPage = () => {
  p2pTradingPageModulePromise ??= import('../features/trading/components/P2PTradingPage');
  return p2pTradingPageModulePromise;
};

const loadTokenSwapPage = () => {
  tokenSwapPageModulePromise ??= import('../features/tokenTools/components/TokenSwapPage');
  return tokenSwapPageModulePromise;
};

const loadPrivateTvlPage = () => {
  privateTvlPageModulePromise ??= import('../features/treasury/components/PrivateTvlPage');
  return privateTvlPageModulePromise;
};

const loadDexV2Page = () => {
  dexV2PageModulePromise ??= import('../features/dex/components/DexV2Page');
  return dexV2PageModulePromise;
};

const preloadPrivateTvlSnapshot = () => {
  privateTvlDataModulePromise ??= import('../features/treasury/privateTvlData');
  void privateTvlDataModulePromise.then(({ preloadPrivateTvlData }) => preloadPrivateTvlData()).catch(() => {});
};

export const preloadPrivateTvlPage = () => {
  void loadPrivateTvlPage();
  preloadPrivateTvlSnapshot();
};

export const preloadChatPage = () => {
  void loadDirectChatPanel();
  void loadGroupChatPanel();
};

export const preloadTradesPage = () => {
  void loadP2PTradingPage();
};

export const preloadSwapPage = () => {
  void loadTokenSwapPage();
};

export const preloadDexV2Page = () => {
  void loadDexV2Page();
};

export const DirectChatPanel = lazy(loadDirectChatPanel);
export const GroupChatPanel = lazy(loadGroupChatPanel);
export const P2PTradingPage = lazy(loadP2PTradingPage);
export const TokenSwapPage = lazy(loadTokenSwapPage);
export const PrivateTvlPage = lazy(loadPrivateTvlPage);
export const DexV2Page = lazy(loadDexV2Page);
export const TradeComposerPanel = lazy(() => import('../features/trading/components/TradeComposerPanel'));

export function RouteLoadingFallback({
  label,
  shellClassName,
  variant = 'standard'
}: {
  label: string;
  shellClassName: string;
  variant?: 'standard' | 'treasury';
}) {
  const rowCount = variant === 'treasury' ? 4 : 3;

  return (
    <main className={shellClassName}>
      <section className={`route-loading route-loading-${variant}`} role="status" aria-live="polite" aria-label={label}>
        <div className="route-loading-header">
          <span className="inline-spinner" aria-hidden="true" />
          <span>{label}</span>
        </div>
        <div className="route-loading-lines" aria-hidden="true">
          {Array.from({ length: rowCount }, (_, index) => (
            <span key={`route-loading-line-${index}`} />
          ))}
        </div>
      </section>
    </main>
  );
}
