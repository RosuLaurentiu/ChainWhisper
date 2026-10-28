// Local visual fixture. No wallet, provider, network request, or transaction.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import TradeActionConfirmModal from '../../../src/features/trading/components/TradeActionConfirmModal';
import useTradeActionConfirmationState from '../../../src/features/trading/hooks/useTradeActionConfirmationState';
import type { TradeActionConfirmModel } from '../../../src/lib/tradeActionConfirm';
import CurrentSwapProgress from '../../../src/features/dex/components/CurrentSwapProgress';
import '../../../src/styles.css';

const reviews: Record<string, TradeActionConfirmModel> = {
  'Quote inputs': {
    title: 'Confirm private Quote inputs', primaryLabel: 'Continue', fundingMoves: [],
    message: 'Amounts stay private. Wallet transactions use network gas.',
    summaryRows: [
      { label: 'Maximum input', value: '25.0 HBR' },
      { label: 'Fill policy', value: 'Any positive partial fill (0% minimum)' },
      { label: 'Minimum net output', value: '0.0 BCN' },
      { label: 'Slippage', value: '0.5% of the Quote net rate' },
      { label: 'Maximum buy price', value: 'No optional hard price limit' }
    ],
    stats: [{ label: 'Quote fee limit', value: '0.0105 COTI' }, { label: 'Accept fee limit', value: '0.021 COTI' }]
  },
  'Accept quote': {
    title: 'Review private quote', primaryLabel: 'Accept quote', fundingMoves: [],
    message: 'Expected amounts, after fees.',
    summaryRows: [
      { label: 'You pay', value: '25.0 HBR' }, { label: 'You receive', value: '26.24 BCN' },
      { label: 'Average price', value: '1.0496 BCN per HBR (rounded down)' },
      { label: 'Price impact (net)', value: '0.28%' }
    ],
    stats: [{ label: 'Quote fee limit', value: '0.0105 COTI' }, { label: 'Accept fee limit', value: '0.021 COTI' }]
  },
  'Recover swap': {
    title: 'Recover private swap', primaryLabel: 'Recover swap', secondaryLabel: 'Back', fundingMoves: [],
    message: 'Return remaining input. Verify the refund after confirmation. Network gas applies.',
    summaryRows: [{ label: 'Operation', value: '1024' }, { label: 'Public state', value: 'expired' }], stats: []
  },
  'Cancel swap': {
    title: 'Cancel private swap', primaryLabel: 'Cancel swap', secondaryLabel: 'Back', fundingMoves: [],
    message: 'Cancel this swap. Network gas applies.',
    summaryRows: [{ label: 'Operation', value: '1024' }, { label: 'Public state', value: 'quote-prepared' }], stats: []
  },
  'Protection review': {
    title: 'Quote cannot be accepted', primaryLabel: 'Close', secondaryLabel: null, fundingMoves: [],
    message: 'Below your minimum output of 26.0 BCN. No swap was sent.',
    summaryRows: [{ label: 'You pay', value: '25.0 HBR' }, { label: 'You receive', value: '25.8 BCN' }], stats: []
  },
  'Funding review': {
    title: 'Approve exact swap input', primaryLabel: 'Continue', fundingMoves: [{
      amountLabel: '12345678901234567890.123456 BCN', assetSymbol: 'BCN', fromLabel: 'Owner wallet',
      toLabel: 'ChainWhisper', reason: 'Only the exact amount required for this action is approved.'
    }],
    message: 'This approval is separate from the swap. Network gas applies.',
    summaryRows: [{ label: 'Amount', value: '12345678901234567890.123456 BCN' }],
    stats: [{ label: 'Owner prompts', value: '1' }, { label: 'Transfers', value: '1' }]
  }
};

function TradeReviewHarness() {
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState();
  const [decision, setDecision] = useState('No action selected.');
  const [status, setStatus] = useState('Pending');
  const [hash, setHash] = useState('');
  const review = async (name: string) => {
    const accepted = await requestConfirmation(reviews[name]);
    setDecision(accepted ? 'Review confirmed. Local preview only; no transaction sent.' : 'Review closed. No transaction sent.');
  };
  return <div className="app-shell app-shell-dex-v2" style={{ display: 'block', minHeight: '100dvh', padding: 24 }}>
    <main style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1>Trade windows</h1>
      <p>Local preview · Sample amounts · No wallet or transactions</p>
      <nav aria-label="Preview states" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {Object.keys(reviews).map(name => <button className="connect-btn" type="button" key={name} onClick={() => { void review(name); }}>{name}</button>)}
      </nav>
      <p role="status">{decision}</p>
      <nav aria-label="Status previews" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBlock: 24 }}>
        {['Pending', 'Recovery', 'Unknown', 'Verified'].map(name => <button className="connect-btn" type="button" key={name} aria-pressed={status === name} onClick={() => setStatus(name)}>{name}</button>)}
      </nav>
      <div className="dex-v2-current-swap" style={{ maxWidth: 520 }}>
        <CurrentSwapProgress visible status={status === 'Pending' ? 'Accept is mined; settlement remains pending.'
          : status === 'Recovery' ? 'Operation expired. Use Recover swap to return funded input.'
            : status === 'Unknown' ? 'Transaction status is unknown. Check current state; do not resend.' : 'Private receipt verified.'}
          result={status === 'Verified' ? 'Paid 25.0 HBR; received 26.24 BCN; refunded 0.0 HBR.' : null}
          operation={status === 'Unknown' ? null : { id: '1024', expiresAt: '25 Oct 2026, 01:10' }}>
          <div className="dex-v2-progress-actions">
            <button type="button" onClick={() => setDecision('Read-only status check selected. Local sample only.')}>Check current state</button>
            {status === 'Recovery' ? <button type="button" onClick={() => { void review('Recover swap'); }}>Recover swap</button> : null}
            {status === 'Verified' ? <button type="button" onClick={() => setDecision('New Quote selected. No transaction sent.')}>New Quote</button> : null}
          </div>
          {status === 'Unknown' ? <details className="dex-v2-recovery-details"><summary>DEX recovery details</summary>
            <div className="dex-v2-current-fields" style={{ gridTemplateColumns: '1fr' }}><label>Transaction hash (optional)
              <input aria-label="Existing DEX transaction hash" placeholder="0x…" value={hash} onChange={event => setHash(event.target.value)} />
              <small>Checks a saved Quote, Accept or recovery action. Does not send a transaction or restore private Accept authority.</small>
            </label></div>
          </details> : null}
          <a className="dex-v2-progress-transaction" href="#sample-transaction">View transaction</a>
        </CurrentSwapProgress>
      </div>
    </main>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)}
      details={confirmation?.summaryRows.some(row => row.label === 'You pay') ? <details className="trade-action-confirm-details">
        <summary>Price and slippage</summary>
        <p>Price impact compares the net Quote rate with the rounded Pool reference, including spread and fees. Slippage protects the Quote net rate.</p>
      </details> : null} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<TradeReviewHarness />);
