import { lazy, Suspense } from 'react';
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
  recoveryOnly?: boolean;
  intentMode?: 'create' | 'manage';
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
  onTradeMarket?: (baseToken: string, quoteToken: string) => void;
  onCreatePosition?: () => void;
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

export default function PrivateLiquidityWorkspace({
  activeView,
  recoveryOnly = false,
  intentMode = 'create',
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
  onTradeMarket,
  onCreatePosition,
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
  const tokenLabel = (address: string): string =>
    positionTokens.find((token) => token.address.toLowerCase() === address.toLowerCase())?.symbol
    ?? `${address.slice(0, 8)}…`;
  const formatTraderAmount = (value: string, tokenAddress: string | undefined, fallback: string): string => {
    const token = tokenAddress
      ? positionTokens.find((candidate) => candidate.address === tokenAddress)
      : undefined;
    return token
      ? `${formatTokenAmount(BigInt(value), token.decimals, 8)} ${token.symbol}`
      : `${value} ${fallback} units`;
  };
  return (
    <section className="standalone-trades-section p2p-trade-workspace-panel p2p-private-liquidity-workspace">
      <div className="p2p-order-section-head">
        <div>
          <h3>{recoveryOnly ? activeView === 'intents' ? 'Hidden limit refunds' : 'Existing strategy funds' : activeView === 'intents' ? intentMode === 'manage' ? 'My hidden limits' : 'Create hidden limit'
            : activeView === 'create' ? 'Create bid/ask strategy' : 'Bid/ask strategies'}</h3>
          {!recoveryOnly && activeView === 'create' ? <p>Set a bid and ask for repeated fills. Your inventory stays private.</p> : null}
        </div>
      </div>

      {!deploymentReady ? (
        <div className="p2p-swap-order-empty p2p-private-liquidity-notice" role="status">
          <strong>{recoveryOnly ? 'Recovery unavailable' : 'Strategies unavailable'}</strong>
          <p>{recoveryOnly ? 'The current deployment could not be verified. Recovery actions are disabled.'
            : 'The current deployment could not be verified. Trading is disabled.'}</p>
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

      {!recoveryOnly && activeView === 'discover' ? (
        <div className="p2p-private-liquidity-workspace-card">
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
                    <strong>{tokenLabel(market.baseToken)} / {tokenLabel(market.quoteToken)}</strong>
                    <small>{market.pairKey.slice(0, 10)}…</small>
                  </button>
                  <span>{market.bestBid ? `${market.bestBid.terms.quoteAmount} / ${market.bestBid.terms.baseAmount}` : '—'}</span>
                  <span>{market.bestAsk ? `${market.bestAsk.terms.quoteAmount} / ${market.bestAsk.terms.baseAmount}` : '—'}</span>
                  <span>{market.crossed ? 'Crossed' : market.spreadBps !== undefined ? `${market.spreadBps} bps` : '—'}</span>
                  <span>{market.activePositionCount}
                    {onTradeMarket ? <button type="button" className="standalone-trade-secondary-btn"
                      disabled={!deploymentReady || loading || market.activePositionCount === 0 || positionActionBusy || hiddenIntentBusy}
                      onClick={() => onTradeMarket(market.baseToken, market.quoteToken)}>Trade</button> : null}
                  </span>
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
        <div className="p2p-private-liquidity-workspace-card">
          {managedPosition ? (
            <PrivateLiquidityPositionManager
              recoveryOnly={recoveryOnly}
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
                    <span>{tokenLabel(position.baseToken)} / {tokenLabel(position.quoteToken)}</span>
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
              {!recoveryOnly ? <button type="button" disabled={!onCreatePosition} onClick={onCreatePosition}>Create a strategy</button> : null}
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

      {!recoveryOnly && activeView === 'create' ? (
        <div className="p2p-private-liquidity-workspace-card">
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
        <div className="p2p-private-liquidity-workspace-card">
          <PrivateLiquidityHiddenIntentPanel
            recoveryOnly={recoveryOnly}
            mode={recoveryOnly ? 'manage' : intentMode}
            tokens={positionTokens}
            deploymentReady={deploymentReady && (recoveryOnly || Boolean(onCreateHiddenIntent))}
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
