import { useMemo, useState } from 'react';
import { formatTokenAmount, sanitizeTokenAmountInput } from '../../../lib/appShared/core';
import type { PrivateLiquidityHiddenIntentOwnerPage } from '../../../lib/privateLiquidityActions';
import {
  derivePrivateLiquidityHiddenIntentLimitOrderFields,
  type PrivateLiquidityHiddenIntentDraft
} from '../../../lib/privateLiquidityHiddenIntentFlow';
import {
  orderPrivateLiquidityPositionTokens,
  type PrivateLiquidityPositionToken
} from '../../../lib/privateLiquidityPositionFlow';

export default function PrivateLiquidityHiddenIntentPanel({
  tokens,
  deploymentReady,
  walletReady,
  busy,
  message,
  messageStatus,
  ownerDataStatus,
  ownerPage,
  ownerDataError,
  settlementPairs,
  onCreate,
  onCancel,
  onReclaim,
  onSettle,
  onRevealOwnerData
}: {
  tokens: readonly PrivateLiquidityPositionToken[];
  deploymentReady: boolean;
  walletReady: boolean;
  busy: boolean;
  message?: string;
  messageStatus: 'idle' | 'pending' | 'success' | 'error';
  ownerDataStatus: 'locked' | 'loading' | 'available' | 'error';
  ownerPage: PrivateLiquidityHiddenIntentOwnerPage | null;
  ownerDataError?: string;
  settlementPairs: readonly Readonly<{
    pairKey: string;
    baseToken: string;
    quoteToken: string;
    activePositionCount: number;
  }>[];
  onCreate: (draft: PrivateLiquidityHiddenIntentDraft) => void;
  onCancel: (intentId: string) => void;
  onReclaim: (intentId: string) => void;
  onSettle: (pairKey: string) => void;
  onRevealOwnerData: () => void;
}) {
  const [firstSelection, setFirstSelection] = useState('');
  const [secondSelection, setSecondSelection] = useState('');
  const [side, setSide] = useState<'sell-base' | 'buy-base'>('sell-base');
  const [amountInput, setAmountInput] = useState('');
  const [limitPriceInput, setLimitPriceInput] = useState('');
  const [minimumFillBps, setMinimumFillBps] = useState(0);
  const [cooldownBlocks, setCooldownBlocks] = useState(0);
  const [expiryDays, setExpiryDays] = useState(7);
  const firstValue = firstSelection || tokens[0]?.selection || '';
  const secondValue = secondSelection || tokens.find((token) => token.selection !== firstValue)?.selection || '';
  const firstToken = tokens.find((token) => token.selection === firstValue);
  const secondToken = tokens.find((token) => token.selection === secondValue);
  const ordered = useMemo(() => {
    if (!firstToken || !secondToken) return null;
    try {
      return orderPrivateLiquidityPositionTokens(firstToken, secondToken);
    } catch {
      return null;
    }
  }, [firstToken, secondToken]);
  const limitOrder = useMemo(() => {
    if (!ordered || !amountInput || !limitPriceInput) return null;
    try {
      return derivePrivateLiquidityHiddenIntentLimitOrderFields({
        ...ordered,
        side,
        amountInput,
        limitPriceInput
      });
    } catch {
      return null;
    }
  }, [amountInput, limitPriceInput, ordered, side]);
  const choose = (which: 'first' | 'second', selection: string) => {
    if (which === 'first') {
      setFirstSelection(selection);
      if (selection === secondValue) {
        setSecondSelection(tokens.find((token) => token.selection !== selection)?.selection ?? '');
      }
    } else {
      setSecondSelection(selection);
      if (selection === firstValue) {
        setFirstSelection(tokens.find((token) => token.selection !== selection)?.selection ?? '');
      }
    }
  };
  const disabled = !deploymentReady || !walletReady || busy || !ordered || !limitOrder;
  const settlementPair = ordered
    ? settlementPairs.find((pair) =>
        pair.baseToken.toLowerCase() === ordered.baseToken.address.toLowerCase() &&
        pair.quoteToken.toLowerCase() === ordered.quoteToken.address.toLowerCase()
      )
    : undefined;
  const tokenFor = (address: string) => tokens.find(
    (token) => token.address.toLowerCase() === address.toLowerCase()
  );
  const formatAmount = (value: string, token: PrivateLiquidityPositionToken | undefined, fallback: string) =>
    token ? `${formatTokenAmount(BigInt(value), token.decimals, 8)} ${token.symbol}` : `${value} ${fallback} units`;

  return (
    <div className="p2p-private-liquidity-position-form p2p-private-liquidity-hidden-intent-form">
      <div className="p2p-private-liquidity-create-grid">
        <div>
          <span>1. Market</span>
          <strong>Choose a private-token pair</strong>
          <small>The contract derives the canonical base and quote order.</small>
        </div>
        <div>
          <span>2. Limit order</span>
          <strong>Buy or sell at your price</strong>
          <small>Two packed COTI confirmations keep the amount, side, and price private.</small>
        </div>
        <div>
          <span>3. Execution</span>
          <strong>Fill from the best eligible positions</strong>
          <small>Unused budget remains available until filled, cancelled, or expired.</small>
        </div>
      </div>

      <div className="p2p-private-liquidity-token-pair">
        <label>
          <span>Token A</span>
          <select value={firstValue} onChange={(event) => choose('first', event.target.value)}>
            {tokens.map((token) => <option key={token.selection} value={token.selection}>{token.symbol}</option>)}
          </select>
        </label>
        <label>
          <span>Token B</span>
          <select value={secondValue} onChange={(event) => choose('second', event.target.value)}>
            {tokens.map((token) => <option key={token.selection} value={token.selection}>{token.symbol}</option>)}
          </select>
        </label>
      </div>

      <p className="p2p-private-liquidity-pair-summary">
        {ordered
          ? <>Canonical pair: <strong>{ordered.baseToken.symbol}</strong> base / <strong>{ordered.quoteToken.symbol}</strong> quote</>
          : 'Choose two different verified private tokens.'}
      </p>

      <div className="p2p-private-liquidity-limit-ticket">
        <div className="p2p-private-liquidity-side-toggle" role="group" aria-label="Order side">
          <button
            type="button"
            className={side === 'buy-base' ? 'is-active is-buy' : ''}
            aria-pressed={side === 'buy-base'}
            onClick={() => setSide('buy-base')}
          >
            Buy {ordered?.baseToken.symbol ?? 'base'}
          </button>
          <button
            type="button"
            className={side === 'sell-base' ? 'is-active is-sell' : ''}
            aria-pressed={side === 'sell-base'}
            onClick={() => setSide('sell-base')}
          >
            Sell {ordered?.baseToken.symbol ?? 'base'}
          </button>
        </div>

        <div className="p2p-private-liquidity-limit-fields">
          <label>
            <span>Amount to {side === 'buy-base' ? 'buy' : 'sell'}</span>
            <div className="p2p-private-liquidity-input-with-token">
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                placeholder="100"
                onChange={(event) => setAmountInput(sanitizeTokenAmountInput(event.target.value))}
              />
              <strong>{ordered?.baseToken.symbol ?? 'Base'}</strong>
            </div>
          </label>
          <label>
            <span>Limit price</span>
            <div className="p2p-private-liquidity-input-with-token">
              <input
                type="text"
                inputMode="decimal"
                value={limitPriceInput}
                placeholder="12"
                onChange={(event) => setLimitPriceInput(sanitizeTokenAmountInput(event.target.value))}
              />
              <strong>{ordered?.quoteToken.symbol ?? 'Quote'} / {ordered?.baseToken.symbol ?? 'Base'}</strong>
            </div>
          </label>
        </div>

        <div className="p2p-private-liquidity-limit-total" aria-live="polite">
          <span>{side === 'buy-base' ? 'Maximum spend' : 'Receive at limit'}</span>
          <strong>
            {limitOrder
              ? `${side === 'buy-base' ? limitOrder.maximumBudgetInput : limitOrder.estimatedOutputInput} ${ordered?.quoteToken.symbol}`
              : `— ${ordered?.quoteToken.symbol ?? 'Quote'}`}
          </strong>
          <small>Actual fills may execute at a better price. Unused funds stay in the order.</small>
        </div>
      </div>

      <details className="p2p-private-liquidity-limit-advanced">
        <summary>Advanced settings</summary>
        <div className="p2p-private-liquidity-limit-advanced-fields">
          <label>
            <span>Minimum fill</span>
            <select value={minimumFillBps} onChange={(event) => setMinimumFillBps(Number(event.target.value))}>
              <option value={0}>Any executable amount</option>
              <option value={2500}>At least 25%</option>
              <option value={5000}>At least 50%</option>
              <option value={10000}>Full remaining budget</option>
            </select>
          </label>
          <label>
            <span>Cooldown between fills</span>
            <select value={cooldownBlocks} onChange={(event) => setCooldownBlocks(Number(event.target.value))}>
              <option value={0}>No cooldown</option>
              <option value={10}>10 blocks</option>
              <option value={50}>50 blocks</option>
              <option value={100}>100 blocks</option>
            </select>
          </label>
          <label>
            <span>Expiry</span>
            <select value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))}>
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
        </div>
      </details>

      {message ? (
        <div
          className={`p2p-private-liquidity-action-message is-${messageStatus}`}
          role={messageStatus === 'error' ? 'alert' : 'status'}
        >
          {message}
        </div>
      ) : null}

      <button
        type="button"
        className="trade-card-action trade-card-action-accept"
        disabled={disabled}
        onClick={() => {
          if (!firstToken || !secondToken || !ordered || !limitOrder) return;
          onCreate({
            firstToken,
            secondToken,
            side,
            limitBaseAmountInput: limitOrder.limitBaseAmountInput,
            limitQuoteAmountInput: limitOrder.limitQuoteAmountInput,
            maximumBudgetInput: limitOrder.maximumBudgetInput,
            minimumFillBps,
            cooldownBlocks,
            expiryDays,
            currentTimestamp: Math.floor(Date.now() / 1_000)
          });
        }}
      >
        {!deploymentReady
          ? 'Private Liquidity V2 deployment pending'
          : !walletReady
            ? 'Connect MetaMask or CipherTrade'
            : busy
              ? 'Hidden intent in progress…'
              : `Review ${side === 'buy-base' ? 'buy' : 'sell'} limit order`}
      </button>

      <div className="p2p-private-liquidity-settlement-control">
        <div>
          <strong>Process the next pair queue entries</strong>
          <p>
            Anyone can submit both complete price routes. The contract chooses up to four queued intents and
            privately decides whether each can execute; this transaction never names an intent.
          </p>
          <small>
            {settlementPair
              ? `${settlementPair.activePositionCount} active position${settlementPair.activePositionCount === 1 ? '' : 's'} in the complete ${ordered?.baseToken.symbol}/${ordered?.quoteToken.symbol} route.`
              : 'This selected pair has no complete active position route at the finalized block.'}
          </small>
        </div>
        <button
          type="button"
          className="standalone-trade-secondary-btn"
          disabled={!deploymentReady || !walletReady || busy || !settlementPair}
          onClick={() => settlementPair && onSettle(settlementPair.pairKey)}
        >
          {busy ? 'Settlement in progress…' : 'Settle ready intents'}
        </button>
      </div>

      <section className="p2p-private-liquidity-hidden-intents" aria-label="My hidden intents">
        <div className="p2p-private-liquidity-activity-head">
          <div>
            <span>My hidden intents</span>
            <strong>
              {ownerDataStatus === 'available' && ownerPage
                ? `${ownerPage.totalCount} owner-only intent${ownerPage.totalCount === '1' ? '' : 's'}`
                : 'Encrypted owner data'}
            </strong>
          </div>
          {ownerDataStatus !== 'available' ? (
            <button
              type="button"
              className="standalone-trade-secondary-btn"
              disabled={!deploymentReady || !walletReady || ownerDataStatus === 'loading'}
              onClick={onRevealOwnerData}
            >
              {ownerDataStatus === 'loading'
                ? 'Revealing...'
                : ownerDataError
                  ? 'Retry hidden intents'
                  : 'Reveal my hidden intents'}
            </button>
          ) : null}
        </div>

        {ownerDataError ? (
          <p className="p2p-private-liquidity-private-error" role="alert">{ownerDataError}</p>
        ) : null}

        {ownerDataStatus === 'locked' ? (
          <p>Side, limit, remaining budget, minimum fill, and execution amounts stay hidden until you reveal them.</p>
        ) : null}

        {ownerDataStatus === 'available' && ownerPage?.items.length === 0 ? (
          <div className="p2p-swap-order-empty">
            <strong>No hidden intents yet</strong>
            <p>Create one above to automate bounded fills against the complete private-liquidity position set.</p>
          </div>
        ) : null}

        {ownerDataStatus === 'available' && ownerPage && ownerPage.items.length > 0 ? (
          <div className="p2p-private-liquidity-hidden-intent-list">
            {ownerPage.items.map(({ view, receipt }) => {
              const baseToken = tokenFor(view.baseToken);
              const quoteToken = tokenFor(view.quoteToken);
              const inputToken = receipt.side === 'sell-base' ? baseToken : quoteToken;
              const outputToken = receipt.side === 'sell-base' ? quoteToken : baseToken;
              const expiresAt = BigInt(view.expiresAt);
              const expired = expiresAt !== 0n && expiresAt <= BigInt(Math.floor(Date.now() / 1_000));
              const displayedStatus = view.status === 'open' && expired ? 'expired - reclaimable' : view.status;
              return (
                <article key={view.intentId}>
                  <div className="p2p-private-liquidity-hidden-intent-head">
                    <div>
                      <strong>Hidden intent #{view.intentId}</strong>
                      <span>{baseToken?.symbol ?? 'Base'} / {quoteToken?.symbol ?? 'Quote'}</span>
                    </div>
                    <span className={`is-${view.status}`}>{displayedStatus}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Action</dt>
                      <dd>{receipt.side === 'sell-base' ? 'Sell base for quote' : 'Buy base with quote'}</dd>
                    </div>
                    <div>
                      <dt>Private limit</dt>
                      <dd>
                        {formatAmount(receipt.limitTerms.baseAmount, baseToken, 'base')} for{' '}
                        {formatAmount(receipt.limitTerms.quoteAmount, quoteToken, 'quote')}
                      </dd>
                    </div>
                    <div>
                      <dt>Remaining budget</dt>
                      <dd>{formatAmount(receipt.remainingBudget, inputToken, 'input')}</dd>
                    </div>
                    <div>
                      <dt>Minimum fill</dt>
                      <dd>{formatAmount(receipt.minimumFill, inputToken, 'input')}</dd>
                    </div>
                    <div>
                      <dt>Last execution</dt>
                      <dd>
                        {BigInt(receipt.lastInputAmount) === 0n && BigInt(receipt.lastOutputAmount) === 0n
                          ? 'Not filled yet'
                          : `${formatAmount(receipt.lastInputAmount, inputToken, 'input')} -> ${formatAmount(receipt.lastOutputAmount, outputToken, 'output')}`}
                      </dd>
                    </div>
                    <div>
                      <dt>Schedule</dt>
                      <dd>
                        {view.cooldownBlocks === '0' ? 'No cooldown' : `${view.cooldownBlocks} block cooldown`}
                        {' · '}{view.expiresAt === '0'
                          ? 'No expiry'
                          : `expires ${new Date(Number(view.expiresAt) * 1_000).toLocaleString()}`}
                      </dd>
                    </div>
                  </dl>
                  <footer>
                    <span>{view.fillCount} fill{view.fillCount === '1' ? '' : 's'} · receipt revision {receipt.sequence}</span>
                    {view.status === 'open' ? (
                      expired ? (
                        <button type="button" disabled={busy} onClick={() => onReclaim(view.intentId)}>
                          Reclaim expired budget
                        </button>
                      ) : (
                        <button type="button" disabled={busy} onClick={() => onCancel(view.intentId)}>
                          Cancel and refund
                        </button>
                      )
                    ) : null}
                  </footer>
                </article>
              );
            })}
            {ownerPage.nextOffset !== '0' ? (
              <p>Showing the newest {ownerPage.items.length} of {ownerPage.totalCount} intents.</p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
