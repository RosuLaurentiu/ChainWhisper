import { useMemo, useState } from 'react';
import { sanitizeTokenAmountInput } from '../../../lib/appShared/core';
import {
  derivePrivateLiquidityPositionCreateDraft,
  orderPrivateLiquidityPositionTokens,
  type PrivateLiquidityPositionBudgetSide,
  type PrivateLiquidityAllowancePolicy,
  type PrivateLiquidityPositionActionIntent,
  type PrivateLiquidityPositionToken
} from '../../../lib/privateLiquidityPositionFlow';

type AmountFieldProps = Readonly<{
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}>;

const AmountField = ({ label, placeholder, value, onChange }: AmountFieldProps) => (
  <label>
    <span>{label}</span>
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(sanitizeTokenAmountInput(event.target.value))}
    />
  </label>
);

export default function PrivateLiquidityPositionCreateForm({
  tokens,
  deploymentReady,
  walletReady,
  busy,
  message,
  messageStatus = 'idle',
  onCreate
}: {
  tokens: readonly PrivateLiquidityPositionToken[];
  deploymentReady: boolean;
  walletReady: boolean;
  busy: boolean;
  message?: string;
  messageStatus?: 'idle' | 'pending' | 'success' | 'error';
  onCreate: (intent: Extract<PrivateLiquidityPositionActionIntent, { kind: 'create' }>) => void;
}) {
  const [firstSelection, setFirstSelection] = useState('');
  const [secondSelection, setSecondSelection] = useState('');
  const [startingPriceInput, setStartingPriceInput] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSide, setBudgetSide] = useState<PrivateLiquidityPositionBudgetSide>('quote');
  const [spreadPercentInput, setSpreadPercentInput] = useState('2');
  const [allowancePolicy, setAllowancePolicy] = useState<PrivateLiquidityAllowancePolicy>('approve-exact');

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
  const derived = useMemo(() => {
    if (!ordered || !startingPriceInput || !budgetInput || !spreadPercentInput) {
      return { draft: null, error: '' } as const;
    }
    try {
      return {
        draft: derivePrivateLiquidityPositionCreateDraft({
          baseToken: ordered.baseToken,
          quoteToken: ordered.quoteToken,
          startingPriceInput,
          spreadPercentInput,
          budgetInput,
          budgetSide
        }),
        error: ''
      } as const;
    } catch (error) {
      return {
        draft: null,
        error: error instanceof Error ? error.message : 'Position inputs are invalid.'
      } as const;
    }
  }, [budgetInput, budgetSide, ordered, spreadPercentInput, startingPriceInput]);
  const disabled = !deploymentReady || !walletReady || busy || !firstToken || !secondToken || !ordered || !derived.draft;

  const chooseToken = (side: 'first' | 'second', value: string) => {
    if (side === 'first') {
      setFirstSelection(value);
      if (value === secondValue) {
        setSecondSelection(tokens.find((token) => token.selection !== value)?.selection ?? '');
      }
      return;
    }
    setSecondSelection(value);
    if (value === firstValue) {
      setFirstSelection(tokens.find((token) => token.selection !== value)?.selection ?? '');
    }
  };

  const submit = () => {
    if (!firstToken || !secondToken || !derived.draft || disabled) return;
    onCreate({
      kind: 'create',
      firstToken,
      secondToken,
      buyBaseAmountInput: derived.draft.buyBaseAmountInput,
      buyQuoteAmountInput: derived.draft.buyQuoteAmountInput,
      sellBaseAmountInput: derived.draft.sellBaseAmountInput,
      sellQuoteAmountInput: derived.draft.sellQuoteAmountInput,
      baseInventoryInput: derived.draft.baseInventoryInput,
      quoteInventoryInput: derived.draft.quoteInventoryInput,
      allowancePolicy
    });
  };

  return (
    <div className="p2p-private-liquidity-position-form">
      <div className="p2p-private-liquidity-token-pair">
        <label>
          <span>Token A</span>
          <select value={firstValue} onChange={(event) => chooseToken('first', event.target.value)}>
            {tokens.map((token) => <option key={token.selection} value={token.selection}>{token.symbol}</option>)}
          </select>
        </label>
        <label>
          <span>Token B</span>
          <select value={secondValue} onChange={(event) => chooseToken('second', event.target.value)}>
            {tokens.map((token) => <option key={token.selection} value={token.selection}>{token.symbol}</option>)}
          </select>
        </label>
      </div>

      {ordered ? (
        <p className="p2p-private-liquidity-pair-summary">
          Canonical pair: <strong>{ordered.baseToken.symbol}</strong> base / <strong>{ordered.quoteToken.symbol}</strong> quote
        </p>
      ) : (
        <p className="p2p-private-liquidity-pair-summary">Choose two different verified private tokens.</p>
      )}

      <div className="p2p-private-liquidity-create-flow">
        <section className="p2p-private-liquidity-create-step" aria-labelledby="private-liquidity-starting-price">
          <div>
            <span>Starting price</span>
            <strong id="private-liquidity-starting-price">
              1 {ordered?.baseToken.symbol ?? 'base'} in {ordered?.quoteToken.symbol ?? 'quote'}
            </strong>
            <small>This is the midpoint between your buy and sell prices.</small>
          </div>
          <AmountField
            label={`${ordered?.quoteToken.symbol ?? 'Quote'} per ${ordered?.baseToken.symbol ?? 'base'}`}
            placeholder="1"
            value={startingPriceInput}
            onChange={setStartingPriceInput}
          />
        </section>

        <section className="p2p-private-liquidity-create-step" aria-labelledby="private-liquidity-budget">
          <div>
            <span>Balanced budget</span>
            <strong id="private-liquidity-budget">Choose either token</strong>
            <small>The other side is matched automatically at the starting price.</small>
          </div>
          <div className="p2p-private-liquidity-budget-input">
            <AmountField
              label="Amount"
              placeholder="100"
              value={budgetInput}
              onChange={setBudgetInput}
            />
            <label>
              <span>Budget token</span>
              <select
                aria-label="Budget token"
                value={budgetSide}
                onChange={(event) => setBudgetSide(event.target.value as PrivateLiquidityPositionBudgetSide)}
              >
                <option value="base">{ordered?.baseToken.symbol ?? 'Base'}</option>
                <option value="quote">{ordered?.quoteToken.symbol ?? 'Quote'}</option>
              </select>
            </label>
          </div>
          <div className="p2p-private-liquidity-matched-budget" aria-live="polite">
            <span>Encrypted inventory</span>
            <strong>
              {derived.draft
                ? `${derived.draft.baseInventoryInput} ${ordered?.baseToken.symbol} + ${derived.draft.quoteInventoryInput} ${ordered?.quoteToken.symbol}`
                : 'Enter a price and budget'}
            </strong>
            <small>Both deposits are packed into one COTI private input.</small>
          </div>
        </section>

        <section className="p2p-private-liquidity-create-step" aria-labelledby="private-liquidity-spread">
          <div>
            <span>Total spread</span>
            <strong id="private-liquidity-spread">Split evenly around the starting price</strong>
            <small>For example, 2% places the bid 1% below and the ask 1% above.</small>
          </div>
          <div className="p2p-private-liquidity-spread-control">
            <AmountField label="Spread %" placeholder="2" value={spreadPercentInput} onChange={setSpreadPercentInput} />
            <div className="p2p-private-liquidity-spread-presets" aria-label="Spread presets">
              {['0.5', '1', '2', '5', '10'].map((spread) => (
                <button
                  key={spread}
                  type="button"
                  aria-pressed={spreadPercentInput === spread}
                  onClick={() => setSpreadPercentInput(spread)}
                >
                  {spread}%
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="p2p-private-liquidity-create-step" aria-labelledby="private-liquidity-allowances">
          <div>
            <span>Token allowances</span>
            <strong id="private-liquidity-allowances">Choose how this position may use approvals</strong>
            <small>The app never submits an allowance change outside the policy you select.</small>
          </div>
          <label>
            <span>Allowance policy</span>
            <select
              value={allowancePolicy}
              onChange={(event) => setAllowancePolicy(event.target.value as PrivateLiquidityAllowancePolicy)}
            >
              <option value="approve-exact">Approve exact deposits (recommended)</option>
              <option value="reuse-existing">Use existing allowances only</option>
            </select>
            <small>
              {allowancePolicy === 'approve-exact'
                ? 'Only a missing amount is approved; sufficient existing allowances are reused.'
                : 'No token setup, refresh, or approval transaction will be submitted.'}
            </small>
          </label>
        </section>
      </div>

      <div className="p2p-private-liquidity-create-preview" aria-live="polite">
        <div>
          <span>Position buys at</span>
          <strong>{derived.draft ? `${derived.draft.bidPriceInput} ${ordered?.quoteToken.symbol}` : '—'}</strong>
          <small>per {ordered?.baseToken.symbol ?? 'base'}</small>
        </div>
        <div>
          <span>Position sells at</span>
          <strong>{derived.draft ? `${derived.draft.askPriceInput} ${ordered?.quoteToken.symbol}` : '—'}</strong>
          <small>per {ordered?.baseToken.symbol ?? 'base'}</small>
        </div>
      </div>

      {derived.error ? <div className="p2p-private-liquidity-action-message is-error" role="alert">{derived.error}</div> : null}

      {message ? <div className={`p2p-private-liquidity-action-message is-${messageStatus}`} role={messageStatus === 'error' ? 'alert' : 'status'}>{message}</div> : null}

      <button
        type="button"
        className="trade-card-action trade-card-action-accept"
        disabled={disabled}
        onClick={submit}
      >
        {!deploymentReady
          ? 'Private liquidity deployment pending'
          : !walletReady
            ? 'Connect MetaMask or CipherTrade'
            : busy
              ? 'Position action in progress…'
              : 'Review Position NFT'}
      </button>
    </div>
  );
}
