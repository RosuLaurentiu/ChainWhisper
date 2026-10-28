import { lazy, Suspense, type KeyboardEventHandler } from 'react';
import { moveFocusWithin } from '../../../shared/components/a11y';
import { formatTokenAmount } from '../../../lib/appShared/core';
import type { PrivateLiquidityWorkspaceModel } from '../../../lib/privateLiquidityWorkspaceModel';
import { buildPrivateLiquidityPositionKey } from '../../../lib/privateLiquidity';
import type { PrivateLiquidityHistory } from '../../../lib/privateLiquidityHistory';
import type {
  PrivateLiquidityPositionActionIntent,
  PrivateLiquidityPositionToken
} from '../../../lib/privateLiquidityPositionFlow';
import type { PrivateLiquidityWorkspaceView } from '../hooks/useP2PTradeRoute';
import PrivateLiquidityPositionManager, {
  type PrivateLiquidityInventoryDisplay,
} from './PrivateLiquidityPositionManager';
import PrivateLiquidityPositionCreateForm from './PrivateLiquidityPositionCreateForm';
import PrivateLiquidityHiddenIntentPanel from './PrivateLiquidityHiddenIntentPanel';
import type { PrivateLiquidityHiddenIntentDraft } from '../../../lib/privateLiquidityHiddenIntentFlow';
import type { PrivateLiquidityHiddenIntentOwnerPage } from '../../../lib/privateLiquidityActions';
import type { PrivateLiquidityDailyPriceChartProps } from './PrivateLiquidityDailyPriceChart';

const PrivateLiquidityDailyPriceChart = lazy(() => import('./PrivateLiquidityDailyPriceChart'));

type PrivateLiquidityWorkspaceProps = {
  activeView: PrivateLiquidityWorkspaceView;
  deploymentReady: boolean;
  walletReady: boolean;
  loading?: boolean;
  hydratedPositionCount?: number;
  totalPositionCount?: string;
  model?: PrivateLiquidityWorkspaceModel | null;
  positionTokens?: readonly PrivateLiquidityPositionToken[];
  managedPositionInventory?: PrivateLiquidityInventoryDisplay;
  ownerPrivateHistory?: PrivateLiquidityHistory;
  ownerPrivateDataStatus?: 'locked' | 'loading' | 'available' | 'unavailable' | 'error';
  ownerPrivateDataLoading?: boolean;
  ownerPrivateDataError?: string;
  processingPositionAction?: PrivateLiquidityPositionActionIntent['kind'] | null;
  positionActionMessage?: string;
  positionActionStatus?: 'idle' | 'pending' | 'success' | 'error';
  positionActionBusy?: boolean;
  hiddenIntentBusy?: boolean;
  hiddenIntentMessage?: string;
  hiddenIntentStatus?: 'idle' | 'pending' | 'success' | 'error';
  hiddenIntentOwnerDataStatus?: 'locked' | 'loading' | 'available' | 'error';
  hiddenIntentOwnerPage?: PrivateLiquidityHiddenIntentOwnerPage | null;
  hiddenIntentOwnerDataError?: string;
  dailyPriceChart?: PrivateLiquidityDailyPriceChartProps;
  selectedDailyPricePairKey?: string;
  routeError?: string;
  onChangeView: (view: PrivateLiquidityWorkspaceView) => void;
  onBackToSwap: () => void;
  onBackToPositions?: () => void;
  onOpenPosition?: (positionId: string) => void;
  onPositionAction?: (intent: PrivateLiquidityPositionActionIntent) => void;
  onCreateHiddenIntent?: (draft: PrivateLiquidityHiddenIntentDraft) => void;
  onCancelHiddenIntent?: (intentId: string) => void;
  onReclaimHiddenIntent?: (intentId: string) => void;
  onSettleHiddenIntents?: (pairKey: string) => void;
  onRevealHiddenIntentOwnerData?: () => void;
  onRevealOwnerPrivateData?: () => void;
  onSelectDailyPricePair?: (pairKey: string) => void;
  onRefresh?: () => void;
};

const workspaceViews = [
  ['discover', 'Discover'],
  ['mine', 'My positions'],
  ['create', 'Create'],
  ['intents', 'Hidden limit intents']
] as const;

export default function PrivateLiquidityWorkspace({
  activeView,
  deploymentReady,
  walletReady,
  loading = false,
  hydratedPositionCount = 0,
  totalPositionCount,
  model = null,
  positionTokens = [],
  managedPositionInventory = { state: 'locked' },
  ownerPrivateHistory,
  ownerPrivateDataStatus = 'locked',
  ownerPrivateDataLoading = false,
  ownerPrivateDataError = '',
  processingPositionAction = null,
  positionActionMessage = '',
  positionActionStatus = 'idle',
  positionActionBusy = false,
  hiddenIntentBusy = false,
  hiddenIntentMessage = '',
  hiddenIntentStatus = 'idle',
  hiddenIntentOwnerDataStatus = 'locked',
  hiddenIntentOwnerPage = null,
  hiddenIntentOwnerDataError = '',
  dailyPriceChart,
  selectedDailyPricePairKey,
  routeError = '',
  onChangeView,
  onBackToSwap,
  onBackToPositions,
  onOpenPosition,
  onPositionAction,
  onCreateHiddenIntent,
  onCancelHiddenIntent,
  onReclaimHiddenIntent,
  onSettleHiddenIntents,
  onRevealHiddenIntentOwnerData,
  onRevealOwnerPrivateData,
  onSelectDailyPricePair,
  onRefresh
}: PrivateLiquidityWorkspaceProps) {
  const selection = model?.selection;
  const managedPosition = selection?.status === 'manageable' ? selection.position : undefined;
  const managedBaseToken = managedPosition
    ? positionTokens.find((token) => token.address === managedPosition.baseToken)
    : undefined;
  const managedQuoteToken = managedPosition
    ? positionTokens.find((token) => token.address === managedPosition.quoteToken)
    : undefined;
  const managedPositionKey = managedPosition
    ? buildPrivateLiquidityPositionKey(managedPosition.identity)
    : '';
  const ownerHistoryRows = ownerPrivateHistory && managedPosition
    ? ownerPrivateHistory.positionRows.filter((row) => row.positionKey === managedPositionKey)
    : selection?.historyRows;
  const ownerHistoryTotals = ownerPrivateHistory && managedPosition
    ? ownerPrivateHistory.positionTotals.find((totals) => totals.positionKey === managedPositionKey)
    : selection?.totals;
  const traderHistoryRows = ownerPrivateHistory?.traderRows ?? [];
  const formatTraderAmount = (value: string, tokenAddress: string | undefined, fallback: string): string => {
    const token = tokenAddress
      ? positionTokens.find((candidate) => candidate.address === tokenAddress)
      : undefined;
    return token
      ? `${formatTokenAmount(BigInt(value), token.decimals, 8)} ${token.symbol}`
      : `${value} ${fallback} units`;
  };
  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!moveFocusWithin(event, { orientation: 'horizontal', selector: '[role="tab"]' })) return;
    const nextView = (
      event.currentTarget.ownerDocument.activeElement as HTMLElement | null
    )?.dataset.privateLiquidityView as PrivateLiquidityWorkspaceView | undefined;
    if (nextView && nextView !== activeView) onChangeView(nextView);
  };

  return (
    <section className="standalone-trades-section p2p-trade-workspace-panel p2p-private-liquidity-workspace">
      <div className="standalone-trades-section-head">
        <div>
          <p className="landing-eyebrow">Legacy recurring limit strategies</p>
          <h2>Legacy Position NFT workspace</h2>
          <p>Manage fixed bid/ask strategies, encrypted inventory, and private hidden-limit intents.</p>
        </div>
        <button type="button" className="standalone-trade-secondary-btn" onClick={onBackToSwap}>
          Back to swap
        </button>
      </div>

      <div
        className="p2p-trade-mode-tabs p2p-private-liquidity-workspace-tabs"
        role="tablist"
        aria-label="Recurring limit strategy workspace"
        onKeyDown={handleKeyDown}
      >
        {workspaceViews.map(([view, label]) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={activeView === view}
            tabIndex={activeView === view ? 0 : -1}
            className={activeView === view ? 'active' : undefined}
            data-private-liquidity-view={view}
            onClick={() => onChangeView(view)}
          >
            {label}
          </button>
        ))}
      </div>

      {!deploymentReady ? (
        <div className="p2p-swap-order-empty p2p-private-liquidity-notice" role="status">
          <strong>Reviewed deployment required</strong>
          <p>
            Position discovery and mutations remain disabled until the exact chain, address, deployment block,
            and runtime hash are pinned and attested.
          </p>
        </div>
      ) : null}

      {routeError ? (
        <div className="standalone-trade-error" role="alert">{routeError}</div>
      ) : null}

      {deploymentReady && loading ? (
        <div className="p2p-swap-order-empty p2p-private-liquidity-notice" role="status">
          <strong>Loading finalized Position NFTs</strong>
          <p>
            {totalPositionCount
              ? `${hydratedPositionCount} of ${totalPositionCount} positions verified at one canonical block.`
              : 'Finalized events and deployment provenance are being verified.'}
          </p>
        </div>
      ) : null}

      {activeView === 'discover' ? (
        <div className="p2p-private-liquidity-workspace-card" role="tabpanel">
          {dailyPriceChart ? (
            <Suspense fallback={<div className="p2p-private-liquidity-price-state" role="status">Loading daily price chart…</div>}>
              <PrivateLiquidityDailyPriceChart {...dailyPriceChart} />
            </Suspense>
          ) : null}
          <div className="p2p-private-liquidity-market-head" aria-hidden="true">
            <span>Pair</span>
            <span>Best bid</span>
            <span>Best ask</span>
            <span>Spread</span>
            <span>Positions</span>
          </div>
          {model && model.markets.length > 0 ? (
            <div className="p2p-private-liquidity-market-list">
              {model.markets.map((market) => (
                <article
                  key={market.pairKey}
                  className={market.pairKey === selectedDailyPricePairKey ? 'is-price-selected' : undefined}
                >
                  <button
                    type="button"
                    className="p2p-private-liquidity-market-pair"
                    aria-pressed={market.pairKey === selectedDailyPricePairKey}
                    disabled={!onSelectDailyPricePair}
                    onClick={() => onSelectDailyPricePair?.(market.pairKey)}
                  >
                    <strong>{market.baseToken.slice(0, 8)}… / {market.quoteToken.slice(0, 8)}…</strong>
                    <small>{market.pairKey.slice(0, 10)}…</small>
                  </button>
                  <span>{market.bestBid ? `${market.bestBid.terms.quoteAmount} / ${market.bestBid.terms.baseAmount}` : '—'}</span>
                  <span>{market.bestAsk ? `${market.bestAsk.terms.quoteAmount} / ${market.bestAsk.terms.baseAmount}` : '—'}</span>
                  <span>{market.crossed ? 'Crossed' : market.spreadBps !== undefined ? `${market.spreadBps} bps` : '—'}</span>
                  <span>{market.activePositionCount}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="p2p-swap-order-empty">
              <strong>{loading ? 'Position markets are loading' : deploymentReady ? 'No indexed position markets yet' : 'Market index is not active yet'}</strong>
              <p>Only verified private-token pairs and finalized, canonically indexed Position NFTs appear here.</p>
            </div>
          )}
        </div>
      ) : null}

      {activeView === 'mine' ? (
        <div className="p2p-private-liquidity-workspace-card" role="tabpanel">
          {managedPosition ? (
            <PrivateLiquidityPositionManager
              position={managedPosition}
              baseToken={managedBaseToken}
              quoteToken={managedQuoteToken}
              inventory={managedPositionInventory}
              totals={ownerHistoryTotals}
              historyRows={ownerHistoryRows}
              deploymentReady={deploymentReady && Boolean(onPositionAction)}
              walletReady={walletReady}
              processingAction={processingPositionAction === 'create' ? null : processingPositionAction}
              actionMessage={positionActionMessage}
              actionStatus={positionActionStatus}
              privateDataLoading={ownerPrivateDataLoading}
              privateDataError={ownerPrivateDataError}
              onRevealPrivateData={onRevealOwnerPrivateData}
              onAction={(intent) => onPositionAction?.(intent)}
              onBack={() => onBackToPositions?.()}
            />
          ) : selection?.status === 'missing' ? (
            <div className="p2p-swap-order-empty" role="status">
              <strong>Position NFT not found at the finalized block</strong>
              <p>The position may not exist, may have been removed by a reorg, or may belong to another deployment.</p>
              <button type="button" onClick={() => onBackToPositions?.()}>Back to positions</button>
            </div>
          ) : selection?.status === 'read-only' || selection?.status === 'wallet-required' ? (
            <div className="p2p-swap-order-empty" role="status">
              <strong>{selection.status === 'wallet-required' ? 'Connect MetaMask or CipherTrade to manage this Position NFT' : 'This Position NFT belongs to another wallet'}</strong>
              <p>Its prices and status are public, but inventory, receipts, and management actions remain owner-only.</p>
              <button type="button" onClick={() => onBackToPositions?.()}>Back to positions</button>
            </div>
          ) : model && model.ownedPositions.length > 0 ? (
            <div className="p2p-private-liquidity-owned-list">
              {model.ownedPositions.map((position) => (
                <article key={position.identity.positionId}>
                  <div>
                    <strong>Position NFT #{position.identity.positionId}</strong>
                    <span>{position.baseToken.slice(0, 8)}… / {position.quoteToken.slice(0, 8)}…</span>
                    <small>Revision {position.revision} · {position.status}</small>
                  </div>
                  <button type="button" onClick={() => onOpenPosition?.(position.identity.positionId)}>Manage</button>
                </article>
              ))}
            </div>
          ) : (
            <div className="p2p-swap-order-empty">
              <strong>{walletReady ? 'No owned Position NFTs found' : 'Connect MetaMask or CipherTrade to view your positions'}</strong>
              <p>
                Public terms and status are indexed without a signature. Live base/quote inventories are revealed only
                to the current NFT owner through COTI privacy.
              </p>
              <button type="button" onClick={() => onChangeView('create')}>Create a position</button>
            </div>
          )}

          <section className="p2p-private-liquidity-activity p2p-private-liquidity-trader-activity" aria-label="My private swap activity">
            <div className="p2p-private-liquidity-activity-head">
              <div>
                <span>My private swap activity</span>
                <strong>{ownerPrivateDataStatus === 'available' ? `${traderHistoryRows.length} finalized swaps` : 'Wallet-private history'}</strong>
              </div>
              {ownerPrivateDataStatus !== 'available' && onRevealOwnerPrivateData ? (
                <button
                  type="button"
                  className="standalone-trade-secondary-btn"
                  disabled={!walletReady || ownerPrivateDataLoading}
                  onClick={onRevealOwnerPrivateData}
                >
                  {ownerPrivateDataLoading ? 'Revealing…' : ownerPrivateDataError ? 'Retry private history' : 'Reveal private history'}
                </button>
              ) : null}
            </div>
            {ownerPrivateDataError ? <p className="p2p-private-liquidity-private-error" role="alert">{ownerPrivateDataError}</p> : null}
            {ownerPrivateDataStatus === 'available' && traderHistoryRows.length === 0 ? (
              <p>No finalized private-liquidity swaps for this wallet yet.</p>
            ) : null}
            {ownerPrivateDataStatus === 'available' && traderHistoryRows.length > 0 ? (
              <ol>
                {[...traderHistoryRows].reverse().map((row) => {
                  const pair = model?.positions.find((candidate) => candidate.pairKey === row.pairKey);
                  const inputToken = row.direction === 'base-to-quote' ? pair?.baseToken : pair?.quoteToken;
                  const outputToken = row.direction === 'base-to-quote' ? pair?.quoteToken : pair?.baseToken;
                  const inputFallback = row.direction === 'base-to-quote' ? 'base' : 'quote';
                  const outputFallback = row.direction === 'base-to-quote' ? 'quote' : 'base';
                  return (
                    <li key={row.key}>
                      <div>
                        <strong>Swap #{row.swapId}</strong>
                        <span>{row.direction === 'base-to-quote' ? 'Base → quote' : 'Quote → base'}</span>
                      </div>
                      <div>
                        <span>Spent {formatTraderAmount(row.inputAmount, inputToken, inputFallback)}</span>
                        <span>Received {formatTraderAmount(row.outputAmount, outputToken, outputFallback)}</span>
                        {BigInt(row.unusedInputAmount) > 0n ? (
                          <span>Returned {formatTraderAmount(row.unusedInputAmount, inputToken, inputFallback)}</span>
                        ) : null}
                      </div>
                      <small>{row.candidateCount} positions checked · block {row.provenance.blockNumber}</small>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeView === 'create' ? (
        <div className="p2p-private-liquidity-workspace-card" role="tabpanel">
          <div className="p2p-private-liquidity-create-grid">
            <div>
              <span>1. Pair</span>
              <strong>Two verified private tokens</strong>
              <small>Canonical base/quote orientation is derived by the app and contract.</small>
            </div>
            <div>
              <span>2. Market setup</span>
              <strong>Starting price and spread</strong>
              <small>The app derives the public bid and ask automatically.</small>
            </div>
            <div>
              <span>3. Budget</span>
              <strong>Balanced encrypted inventory</strong>
              <small>Enter either token amount; the matching side is calculated for you.</small>
            </div>
          </div>
          <PrivateLiquidityPositionCreateForm
            tokens={positionTokens}
            deploymentReady={deploymentReady && Boolean(onPositionAction)}
            walletReady={walletReady}
            busy={positionActionBusy}
            message={positionActionMessage}
            messageStatus={positionActionStatus}
            onCreate={(intent) => onPositionAction?.(intent)}
          />
        </div>
      ) : null}

      {activeView === 'intents' ? (
        <div className="p2p-private-liquidity-workspace-card" role="tabpanel">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Private recurring limit orders</p>
              <h3>Hidden limit order</h3>
              <p>
                Create it like a normal limit order. Your side, amount, price, and fills remain private while
                settlement checks the complete bounded Position NFT market.
              </p>
            </div>
          </div>
          <PrivateLiquidityHiddenIntentPanel
            tokens={positionTokens}
            deploymentReady={deploymentReady && Boolean(onCreateHiddenIntent)}
            walletReady={walletReady}
            busy={hiddenIntentBusy}
            message={hiddenIntentMessage}
            messageStatus={hiddenIntentStatus}
            ownerDataStatus={hiddenIntentOwnerDataStatus}
            ownerPage={hiddenIntentOwnerPage}
            ownerDataError={hiddenIntentOwnerDataError}
            settlementPairs={(model?.markets ?? [])
              .filter((market) => market.activePositionCount > 0)
              .map((market) => Object.freeze({
                pairKey: market.pairKey,
                baseToken: market.baseToken,
                quoteToken: market.quoteToken,
                activePositionCount: market.activePositionCount
              }))}
            onCreate={(draft) => onCreateHiddenIntent?.(draft)}
            onCancel={(intentId) => onCancelHiddenIntent?.(intentId)}
            onReclaim={(intentId) => onReclaimHiddenIntent?.(intentId)}
            onSettle={(pairKey) => onSettleHiddenIntents?.(pairKey)}
            onRevealOwnerData={() => onRevealHiddenIntentOwnerData?.()}
          />
        </div>
      ) : null}

      {!loading && onRefresh && (deploymentReady || Boolean(routeError)) ? (
        <button type="button" className="standalone-trade-secondary-btn" onClick={onRefresh}>
          {deploymentReady ? 'Refresh finalized positions' : 'Retry deployment check'}
        </button>
      ) : null}
    </section>
  );
}
