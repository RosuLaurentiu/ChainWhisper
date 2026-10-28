import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatTokenAmount } from '../../../lib/appShared/core';
import type { TradeTokenPresetKey } from '../../../lib/appHelpers';
import type { PrivateLiquiditySwapQuote } from '../../../lib/privateLiquidityQuote';
import { TradeTokenSelect, type TradeComposerTokenOption } from './TradeComposerPanel';

export type PrivateLiquiditySwapHistoryRowView = Readonly<{
  key: string;
  swapId?: string;
  pairLabel: string;
  inputLabel: string;
  outputLabel: string;
  unusedInputLabel: string;
  blockNumber?: string;
  transactionHash: string;
  status: 'confirmed' | 'finalized' | 'failed';
  failureMessage?: string;
  attemptedAt?: number;
}>;

type PrivateLiquiditySwapPanelProps = {
  tradeEntryModeTabs: ReactNode;
  venueTabs: ReactNode;
  sellAmountInput: string;
  sellBalanceLabel: string;
  sellBalanceTitle: string;
  sellTokenSelection: TradeTokenPresetKey;
  sellVerifyUrl?: string;
  buyTokenSelection: TradeTokenPresetKey;
  buyVerifyUrl?: string;
  tokenOptions: TradeComposerTokenOption[];
  quote: PrivateLiquiditySwapQuote | null;
  inputTokenDecimals?: number;
  inputTokenSymbol?: string;
  outputTokenDecimals?: number;
  outputTokenSymbol?: string;
  slippageBps: number;
  minimumFillBps: number;
  deploymentReady: boolean;
  liquidityLoading?: boolean;
  deploymentError?: string;
  walletReady: boolean;
  busy?: boolean;
  quoteError?: string;
  actionMessage?: string;
  actionStatus?: 'idle' | 'success' | 'error' | 'pending';
  historyRows?: readonly PrivateLiquiditySwapHistoryRowView[];
  historyStatus?: 'locked' | 'loading' | 'available' | 'unavailable' | 'error';
  historyError?: string;
  onSellAmountInputChange: (value: string) => void;
  onTokenSelectionChange: (side: 'sell' | 'buy', value: TradeTokenPresetKey) => void;
  onFlipTokens: () => void;
  onOpenPools: () => void;
  onRetryDeployment?: () => void;
  onSlippageBpsChange: (value: number) => void;
  onMinimumFillBpsChange: (value: number) => void;
  onRevealHistory?: () => void;
  onReview: () => void;
};

const formatQuoteAmount = (
  value: string | undefined,
  decimals: number | undefined,
  symbol: string | undefined
): string => {
  if (!value) return '—';
  const amount = typeof decimals === 'number'
    ? formatTokenAmount(BigInt(value), decimals, 6)
    : value;
  return symbol ? `${amount} ${symbol}` : amount;
};

const formatMarginalRate = ({
  quote,
  terms,
  inputTokenDecimals,
  inputTokenSymbol,
  outputTokenDecimals,
  outputTokenSymbol
}: {
  quote: PrivateLiquiditySwapQuote;
  terms: PrivateLiquiditySwapQuote['bestTerms'];
  inputTokenDecimals?: number;
  inputTokenSymbol?: string;
  outputTokenDecimals?: number;
  outputTokenSymbol?: string;
}): string => {
  if (typeof inputTokenDecimals !== 'number' || typeof outputTokenDecimals !== 'number') return 'Public price';
  const inputUnits = BigInt(
    quote.direction === 'base-to-quote' ? terms.baseAmount : terms.quoteAmount
  );
  const outputUnits = BigInt(
    quote.direction === 'base-to-quote' ? terms.quoteAmount : terms.baseAmount
  );
  const precision = 6;
  const scaled = outputUnits * (10n ** BigInt(inputTokenDecimals)) * (10n ** BigInt(precision))
    / (inputUnits * (10n ** BigInt(outputTokenDecimals)));
  const rate = scaled === 0n ? '<0.000001' : formatTokenAmount(scaled, precision, precision);
  return `1 ${inputTokenSymbol ?? 'input'} ≈ ${rate} ${outputTokenSymbol ?? 'output'}`;
};

const formatFullFillRange = (
  quote: PrivateLiquiditySwapQuote | null,
  decimals: number | undefined,
  symbol: string | undefined
): string => {
  if (!quote) return '—';
  const minimum = formatQuoteAmount(quote.limitFullFillOutput, decimals, undefined);
  const maximum = formatQuoteAmount(quote.bestFullFillOutput, decimals, symbol);
  return minimum === maximum || `${minimum} ${symbol ?? ''}`.trim() === maximum
    ? maximum
    : `${minimum}–${maximum}`;
};

export default function PrivateLiquiditySwapPanel({
  tradeEntryModeTabs,
  venueTabs,
  sellAmountInput,
  sellBalanceLabel,
  sellBalanceTitle,
  sellTokenSelection,
  sellVerifyUrl,
  buyTokenSelection,
  buyVerifyUrl,
  tokenOptions,
  quote,
  inputTokenDecimals,
  inputTokenSymbol,
  outputTokenDecimals,
  outputTokenSymbol,
  slippageBps,
  minimumFillBps,
  deploymentReady,
  liquidityLoading = false,
  deploymentError = '',
  walletReady,
  busy = false,
  quoteError = '',
  actionMessage = '',
  actionStatus = 'idle',
  historyRows = [],
  historyStatus = 'locked',
  historyError = '',
  onSellAmountInputChange,
  onTokenSelectionChange,
  onFlipTokens,
  onOpenPools,
  onRetryDeployment,
  onSlippageBpsChange,
  onMinimumFillBpsChange,
  onRevealHistory,
  onReview
}: PrivateLiquiditySwapPanelProps) {
  const liquidityState = deploymentError
    ? 'error'
    : liquidityLoading
      ? 'loading'
      : quote
        ? 'available'
        : 'empty';
  const liquidityLabel = liquidityState === 'available'
    ? 'Executable liquidity available'
    : liquidityState === 'loading'
      ? 'Checking finalized liquidity'
      : liquidityState === 'error'
        ? 'Liquidity verification failed'
        : 'No executable liquidity found';
  const reviewLabel = busy
    ? 'Private swap in progress…'
    : !deploymentReady
    ? deploymentError
      ? 'Private liquidity unavailable'
      : 'Private liquidity deployment pending'
    : !walletReady
      ? 'Connect MetaMask or CipherTrade'
      : liquidityLoading
        ? 'Loading finalized liquidity…'
      : !quote
        ? 'No executable private quote'
        : 'Review private swap';

  return (
    <section
      className="standalone-trades-section p2p-swap-section p2p-trade-workspace-panel"
      aria-label="Recurring private-limit swap"
    >
      <div className="p2p-trade-entry-panel">
        {tradeEntryModeTabs}
        <div className="p2p-swap-panel p2p-private-liquidity-panel">
          {venueTabs}

          <div className="p2p-swap-order-empty p2p-private-liquidity-notice">
            <div className="p2p-private-liquidity-notice-head">
              <div>
                <strong>Recurring swaps across fixed-price NFT strategies</strong>
                <span className={`p2p-liquidity-availability is-${liquidityState}`} role="status">
                  <i aria-hidden="true" />
                  {liquidityLabel}
                </span>
              </div>
              <button type="button" className="standalone-trade-secondary-btn" onClick={onOpenPools}>
                Position workspace
              </button>
            </div>
            <p>
              Each Position NFT posts a fixed public bid and ask. Depth and fills stay encrypted; reverse fills
              replenish the other side, but this strategy does not continuously move its own price.
            </p>
          </div>

          <div className="p2p-swap-card p2p-swap-card-sell">
            <div className="p2p-swap-card-head">
              <span>Spend up to</span>
              <small title={sellBalanceTitle}>{sellBalanceLabel}</small>
            </div>
            <div className="p2p-swap-card-body">
              <input
                type="text"
                inputMode="decimal"
                value={sellAmountInput}
                onChange={(event) => onSellAmountInputChange(event.target.value)}
                placeholder="0"
                aria-label="Private-liquidity input amount"
              />
              <TradeTokenSelect
                options={tokenOptions}
                value={sellTokenSelection}
                onChange={(value) => onTokenSelectionChange('sell', value as TradeTokenPresetKey)}
                excludedValues={[buyTokenSelection]}
                balanceLabel={sellBalanceLabel}
                verifyUrl={sellVerifyUrl}
              />
            </div>
          </div>

          <button
            type="button"
            className="p2p-swap-token-flip"
            onClick={onFlipTokens}
            aria-label="Swap selected private tokens"
            title="Swap selected private tokens"
          >
            <ArrowRight size={16} strokeWidth={2.5} aria-hidden="true" />
          </button>

          <div className="p2p-swap-card p2p-swap-card-buy">
            <div className="p2p-swap-card-head">
              <span>Receive if fully filled</span>
              <small>{quote ? 'Estimated range' : 'Private depth unknown'}</small>
            </div>
            <div className="p2p-swap-card-body">
              <output aria-label="Private-liquidity best-price full-fill output">
                {formatFullFillRange(quote, outputTokenDecimals, outputTokenSymbol)}
              </output>
              <TradeTokenSelect
                options={tokenOptions}
                value={buyTokenSelection}
                onChange={(value) => onTokenSelectionChange('buy', value as TradeTokenPresetKey)}
                excludedValues={[sellTokenSelection]}
                verifyUrl={buyVerifyUrl}
              />
            </div>
          </div>

          <div className="p2p-swap-quote-grid" aria-label="Private-liquidity quote protection">
            <div className="p2p-swap-quote-card">
              <span>Best available price</span>
              <strong>
                {quote
                  ? formatMarginalRate({
                      quote,
                      terms: quote.bestTerms,
                      inputTokenDecimals,
                      inputTokenSymbol,
                      outputTokenDecimals,
                      outputTokenSymbol
                    })
                  : liquidityLoading
                    ? 'Refreshing finalized position prices…'
                    : 'No executable position at this price limit'}
              </strong>
              <small>{quote ? `${quote.selectedCandidateCount} Position NFT${quote.selectedCandidateCount === 1 ? '' : 's'} available` : 'Public prices only; depth remains private.'}</small>
            </div>
            <div className="p2p-swap-quote-card p2p-swap-quote-card-chainwhisper">
              <label htmlFor="private-liquidity-slippage">Maximum price movement</label>
              <div className="p2p-private-liquidity-slippage-input">
                <input
                id="private-liquidity-slippage"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="99.99"
                  step="0.01"
                  value={Number((slippageBps / 100).toFixed(2))}
                  onChange={(event) => {
                    const percent = Number(event.target.value);
                    if (Number.isFinite(percent) && percent >= 0 && percent < 100) {
                      onSlippageBpsChange(Math.round(percent * 100));
                    }
                  }}
                  aria-label="Custom maximum price movement percentage"
                />
                <span>%</span>
              </div>
              <div className="p2p-private-liquidity-slippage-presets" aria-label="Price movement shortcuts">
                {[50, 100, 200, 500].map((basisPoints) => (
                  <button
                    type="button"
                    key={basisPoints}
                    className={slippageBps === basisPoints ? 'is-active' : ''}
                    onClick={() => onSlippageBpsChange(basisPoints)}
                  >
                    {basisPoints / 100}%
                  </button>
                ))}
              </div>
              <small>
                {quote
                  ? `Worst included price: ${formatMarginalRate({
                      quote,
                      terms: quote.limitTerms,
                      inputTokenDecimals,
                      inputTokenSymbol,
                      outputTokenDecimals,
                      outputTokenSymbol
                    })}`
                  : 'Positions outside this limit are excluded.'}
              </small>
            </div>
          </div>

          <details className="p2p-swap-order-summary p2p-private-liquidity-advanced">
            <summary>Advanced execution protection</summary>
            <div>
              <label htmlFor="private-liquidity-minimum-fill">Minimum fill</label>
              <select
                id="private-liquidity-minimum-fill"
                value={minimumFillBps}
                onChange={(event) => onMinimumFillBpsChange(Number(event.target.value))}
              >
                <option value={0}>Allow any partial fill</option>
                <option value={2500}>At least 25% of maximum spend</option>
                <option value={5000}>At least 50% of maximum spend</option>
                <option value={10000}>100% of maximum spend or revert</option>
              </select>
              <small>
                Any partial fill spends only what can execute within your price limit. Choose a percentage to
                require that much of your maximum spend or revert.
              </small>
            </div>
            <div>
              <span>Execution policy</span>
              <strong>Best price to your limit</strong>
              <small>Actual spend and output are private; unused input stays in your wallet.</small>
            </div>
          </details>

          <div className="p2p-swap-order-empty p2p-private-liquidity-notice" role="note">
            <strong>Private depth means the filled amount is not known before execution.</strong>
            <p>The receive estimate applies only to a full fill. Any unused input remains in your wallet.</p>
          </div>

          {quote && !quote.candidateSetComplete ? (
            <div className="p2p-swap-order-empty p2p-private-liquidity-warning-notice" role="status">
              <strong>Route cap reached</strong>
              <p>
                {quote.omittedPositionCount} additional public position{quote.omittedPositionCount === 1 ? '' : 's'}
                {' '}were not included. This quote is best-price-first among the selected candidates, not a global-best claim.
              </p>
            </div>
          ) : null}

          {!deploymentReady && deploymentError ? (
            <div className="p2p-swap-order-empty p2p-private-liquidity-warning-notice" role="alert">
              <strong>Private liquidity unavailable</strong>
              <p>{deploymentError}</p>
              {onRetryDeployment ? (
                <button type="button" className="standalone-trade-secondary-btn" onClick={onRetryDeployment}>
                  Retry deployment check
                </button>
              ) : null}
            </div>
          ) : null}

          {!quote && quoteError && deploymentReady ? (
            <div className="p2p-swap-order-empty p2p-private-liquidity-warning-notice" role="status">
              <strong>Quote unavailable</strong>
              <p>{quoteError}</p>
            </div>
          ) : null}

          {actionMessage ? (
            <div
              className={`p2p-swap-order-empty p2p-private-liquidity-notice p2p-private-liquidity-action-${actionStatus}`}
              role={actionStatus === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <strong>{actionStatus === 'success' ? 'Private swap confirmed' : actionStatus === 'error' ? 'Private swap stopped' : 'Private swap'}</strong>
              <p>{actionMessage}</p>
            </div>
          ) : null}

          <div className="p2p-swap-actions">
            <button
              type="button"
              className="trade-card-action trade-card-action-accept p2p-swap-review"
              onClick={onReview}
              disabled={busy || liquidityLoading || !deploymentReady || !walletReady || !quote}
            >
              {reviewLabel}
            </button>
          </div>

          <section className="p2p-private-liquidity-activity" aria-label="Private swap history">
            <div className="p2p-private-liquidity-activity-head">
              <div>
                <span>Trade history</span>
                <strong>{historyRows.length} swap record{historyRows.length === 1 ? '' : 's'}</strong>
              </div>
              {historyStatus !== 'available' && onRevealHistory ? (
                <button
                  type="button"
                  className="standalone-trade-secondary-btn"
                  disabled={historyStatus === 'loading' || liquidityLoading || !walletReady}
                  onClick={onRevealHistory}
                >
                  {historyStatus === 'loading' ? 'Loading history…' : historyError ? 'Retry history' : 'Unlock history'}
                </button>
              ) : null}
            </div>
            {historyError ? <p className="p2p-private-liquidity-private-error" role="alert">{historyError}</p> : null}
            {historyRows.length === 0 ? (
              <p>
                {historyStatus === 'available'
                  ? 'No finalized private swaps yet.'
                  : 'Unlock privacy to load exact amounts from your encrypted on-chain receipts.'}
              </p>
            ) : (
              <ol>
                {historyRows.slice(0, 10).map((row) => (
                  <li key={row.key} className={row.status === 'failed' ? 'is-failed' : ''}>
                    <div>
                      <strong>{row.inputLabel} → {row.outputLabel}</strong>
                      <span>{row.pairLabel}{row.swapId ? ` · Swap #${row.swapId}` : ' · Swap attempt'}</span>
                      {row.failureMessage ? <small>{row.failureMessage}</small> : null}
                    </div>
                    <div>
                      <span>{row.status === 'failed' ? 'Failed' : row.status === 'finalized' ? 'Finalized' : 'Confirmed'}</span>
                      <small>Unused: {row.unusedInputLabel}</small>
                    </div>
                    <small>
                      {row.blockNumber
                        ? `Block ${row.blockNumber}`
                        : row.attemptedAt
                          ? new Date(row.attemptedAt).toLocaleTimeString()
                          : row.transactionHash.slice(0, 10)}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
