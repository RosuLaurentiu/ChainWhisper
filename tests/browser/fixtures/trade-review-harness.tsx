// Local visual fixture. No wallet, provider, network request, or transaction.
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TradeActionConfirmModal from '../../../src/features/trading/components/TradeActionConfirmModal';
import TokenApprovalChoice, { useTokenApprovalMode } from '../../../src/features/wallet/TokenApprovalChoice';
import '../../../src/features/dex/components/CurrentDexOwnerViews.css';
import useTradeActionConfirmationState from '../../../src/features/trading/hooks/useTradeActionConfirmationState';
import type { TradeActionConfirmModel } from '../../../src/lib/tradeActionConfirm';
import CurrentSwapProgress from '../../../src/features/dex/components/CurrentSwapProgress';
import { buildStandardTerminalHistoryConfig } from '../../../src/features/trading/components/tradeTerminalHistoryConfig';
import { TradeTerminalHistoryContent } from '../../../src/features/trading/components/TradeTerminalHistoryPanel';
import type { TradeSnapshot } from '../../../src/lib/appShared';
import useP2PTradeComposerActions from '../../../src/features/trading/hooks/useP2PTradeComposerActions';
import useP2PTradeFundingPreflight from '../../../src/features/trading/hooks/useP2PTradeFundingPreflight';
import LinkTradeV2FillControls from '../../../src/features/trading/components/LinkTradeV2FillControls';
import CounterTradeV2Controls, { CounterTradeV2ParticipantControls } from '../../../src/features/trading/components/CounterTradeV2Controls';
import { buildTradeCustomTokenInfoKey } from '../../../src/lib/appHelpers';
import '../../../src/styles.css';

const reviews: Record<string, TradeActionConfirmModel> = {
  'Token approval': {
    title: 'Approve swap token', primaryLabel: 'Continue', fundingMoves: [], stats: [],
    message: 'Token approval is separate from the swap. Network gas applies.',
    summaryRows: [{ label: 'Input token', value: 'HBR' }, { label: 'Swap amount', value: '25.0' },
      { label: 'Core spender', value: `0x${'22'.repeat(20)}` }]
  },
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

const sampleAddress = (byte: string) => `0x${byte.repeat(20)}`;
const sampleOwner = sampleAddress('11'), sampleMaker = sampleAddress('77');
const sampleOffer = sampleAddress('22'), sampleRequest = sampleAddress('33'), sampleEscrow = sampleAddress('44');
const sampleReview = { maker: sampleMaker, reference: { chainId: '7082400', escrow: sampleEscrow, id: '7', revision: '1', credentialEpoch: '1' },
  terms: { offerToken: sampleOffer, requestToken: sampleRequest, privatePair: true, priceOffer: '1', priceRequest: '2', expiresAt: '0' } };
const sampleProposal = { id: '8', maker: sampleMaker, taker: sampleOwner, offerToken: sampleOffer, requestToken: sampleRequest,
  privatePair: true, offer: '100', request: '200', status: 1, effectiveStatus: 1, depth: 1, offerLocked: true };
const sampleTokens = Object.fromEntries([[sampleOffer, 'A'], [sampleRequest, 'B']].map(([address, symbol]) =>
  [buildTradeCustomTokenInfoKey('private-erc20', address), { address, symbol, decimals: 0, loading: false, error: null }]));
const noop = () => {};
const runLocal = async <T,>(fn: () => Promise<T>) => fn();
const ensureToken = async () => undefined;

function P2PSignaturesHarness() {
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState();
  const confirmFunding = useP2PTradeFundingPreflight({ requestTradeActionConfirmation: requestConfirmation,
    resolveFundingBalanceForAsset: () => ({ balanceWei: 1000000n, privacyRequired: false }) });
  const [calls, setCalls] = useState<string[]>([]), [error, setError] = useState(''), [creating, setCreating] = useState(false);
  const [mode, setMode] = useState('success');
  const modeRef = useRef(mode); modeRef.current = mode;
  const runtime = useMemo(() => {
    const send = async (name: string, ...args: unknown[]) => {
      setCalls(previous => [...previous, JSON.stringify({ name, args }, (_, value) => typeof value === 'bigint' ? value.toString() : value)]);
      if (modeRef.current === 'reject') { modeRef.current = 'success'; setMode('success'); throw new Error('Synthetic rejection'); }
      if (modeRef.current === 'pending') return await new Promise<never>(() => {});
      if (name === 'create') return { reference: sampleReview.reference, sharePath: '/sample-link', transactionHash: 'synthetic' };
      if (name === 'fill') return { offerReceived: '5', payment: '10', refund: '0' };
      if (name === 'accept') return { kind: 'accept', received: '100', payment: '200', refund: '0' };
      return { kind: 'create', proposalId: '8' };
    };
    const link = { ownerAddress: sampleOwner, create: (...args: unknown[]) => send('create', ...args), fill: (...args: unknown[]) => send('fill', ...args) };
    const counter = { ownerAddress: sampleOwner, propose: (...args: unknown[]) => send('propose', ...args),
      recipientAction: (proposal: unknown, action: string) => send(action, proposal), read: async () => sampleProposal, readRecovery: async () => null };
    return { isCurrent: () => true, link, counter };
  }, []);
  const composer = useP2PTradeComposerActions({
    buildCurrentTradeSurfacePath: () => '/create', buildTradeShareUrl: () => '/sample-link', canEditPublicTrade: () => true,
    counterParentTrade: null, directTradeRecipientIsValid: true, directTradeRecipientNormalized: sampleMaker, editingTrade: null,
    ensureTradeFunding: confirmFunding, loadWalletBalances: ensureToken, mergeTradeSnapshot: noop, navigateToTradePath: noop, openTrade: noop,
    refreshMyTrades: ensureToken, refreshPublicTrades: ensureToken, refreshOneOffV2Trades: noop, runTradeWalletPromptFlow: runLocal,
    setCounterParentTrade: noop, setCreatedTradeId: noop, setCreatedTradeLink: noop, setCreatingTrade: setCreating, setDetailTrade: noop,
    setDirectTradeRecipient: noop, setEditingTrade: noop, setTradeActionError: setError, setTradeExpiryHoursInput: noop,
    setTradeHasNoExpiry: noop, setTradeHidePrivateLiquidity: noop, setTradeOfferAmountInput: noop, setTradeOfferCustomTokenAddress: noop,
    setTradeOfferTokenSelection: noop, setTradeRequestAmountInput: noop, setTradeRequestCustomTokenAddress: noop,
    setTradeRequestTokenSelection: noop, setTradeVisibility: noop,
    tradeComposerModel: { selectedTradeOfferToken: { kind: 'private-erc20', tokenAddress: sampleOffer, symbol: 'A', decimals: 0 },
      selectedTradeRequestToken: { kind: 'private-erc20', tokenAddress: sampleRequest, symbol: 'B', decimals: 0 },
      parsedTradeOfferAmountWei: 100n, parsedTradeRequestAmountWei: 200n, tradeComposerValidationMessage: '',
      hiddenLiquidityActive: true, hiddenPriceOfferAmountWei: 1n, hiddenPriceRequestAmountWei: 2n, parsedTradeExpiryHours: 24 },
    tradeHasNoExpiry: true, tradeHidePrivateLiquidity: true, tradeVisibility: 'unlisted', walletAddress: sampleOwner, walletKey: sampleOwner,
    onActionNotice: noop, otcV2ActionRuntime: runtime
  } as never);
  const common = { ownerAddress: sampleOwner, tokenInfoByKey: sampleTokens, actionInProgress: false,
    confirmFunding, runWalletFlow: runLocal, onBusyChange: noop, ensureTokenInfo: ensureToken };
  return <main className="app-shell app-shell-trades" style={{ display: 'block', padding: 24 }}>
    <h1>Local P2P signature review</h1><p>Synthetic data only. No wallet, network or transactions.</p>
    <label>Sender behavior <select value={mode} onChange={event => setMode(event.target.value)}>
      <option value="success">Success</option><option value="reject">Reject once</option><option value="pending">Pending</option>
    </select></label>
    <section aria-busy={creating}><h2>Shared trade creation</h2><button type="button" disabled={creating} onClick={() => { void composer.createTrade(); }}>{creating ? 'Waiting for wallet�' : 'Review shared trade creation'}</button>{error && <p role="alert">{error}</p>}</section>
    <h2>Shared trade fill</h2><LinkTradeV2FillControls {...common} review={sampleReview as never} runtime={runtime.link as never} />
    <h2>Counter proposal</h2><CounterTradeV2Controls {...common} review={sampleReview as never} runtime={runtime.counter as never} />
    <h2>Child counter proposal</h2><CounterTradeV2Controls {...common} parentProposal={sampleProposal as never} runtime={runtime.counter as never} />
    <h2>Counter acceptance</h2><CounterTradeV2ParticipantControls {...common} proposalId="8" runtime={runtime.counter as never} />
    <section aria-label="Synthetic sender calls"><h2>Sender calls: {calls.length}</h2>{calls.map((call, index) => <pre key={index}>{call}</pre>)}</section>
    <TradeActionConfirmModal confirmation={confirmation} onCancel={() => resolveConfirmation(false)} onConfirm={() => resolveConfirmation(true)} />
  </main>;
}

function TradeReviewHarness() {
  const [approvalMode, setApprovalMode, getApprovalMode] = useTokenApprovalMode('sample:token:spender');
  const { confirmation, requestConfirmation, resolveConfirmation } = useTradeActionConfirmationState();
  const [decision, setDecision] = useState('No action selected.');
  const [status, setStatus] = useState('Pending');
  const [hash, setHash] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [olderCalls, setOlderCalls] = useState(0);
  const review = async (name: string) => {
    const accepted = await requestConfirmation(reviews[name]);
    setDecision(accepted ? name === 'Token approval' ? `${getApprovalMode()} approval selected. No transaction sent.` : 'Review confirmed. Local preview only; no transaction sent.' : 'Review closed. No transaction sent.');
  };
  if (new URLSearchParams(location.search).has('activity')) {
    const owner = `0x${'11'.repeat(20)}`;
    const config = buildStandardTerminalHistoryConfig({
      tradeId: 9, maker: owner, taker: `0x${'22'.repeat(20)}`, status: 'declined',
      createdAt: 1, expiresAt: 2, hiddenLiquidity: false,
      offer: { kind: 'erc20', tokenAddress: `0x${'33'.repeat(20)}`, symbol: 'A', decimals: 6, amount: '3' },
      request: { kind: 'erc20', tokenAddress: `0x${'44'.repeat(20)}`, symbol: 'B', decimals: 6, amount: '3' },
      v2: { protocol: 'direct-v2', chainId: '7082400', contractAddress: `0x${'55'.repeat(20)}`, amountMode: 'public' }
    } as TradeSnapshot, {
      walletAddress: owner, walletReadAccounts: [], historyLifecycleTxHashes: {}, historyTransactionTxHashes: {},
      historyTransactionTimestamps: {}, swapFillNotes: [], canonicalV2Rows: [], canonicalV2LifecycleEvents: [],
      canonicalV2Complete: false, canonicalV2HasMore: true, canonicalV2Loading: historyLoading,
      getTransactionLinkFeedbackProps: () => ({ className: '', label: '', title: '', onClick: () => {} }),
      onLoadOlderCanonicalV2History: () => { setHistoryLoading(true); setOlderCalls(count => count + 1); }
    });
    return <main className="app-shell app-shell-trades" style={{ display: 'block', padding: 16 }}><section className="standalone-trades-section">
      <TradeTerminalHistoryContent config={config} renderActionNotice={() => null} />
      <p role="status">Older-page requests: {olderCalls}</p>
    </section></main>;
  }
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
      details={confirmation?.title==='Approve swap token'?<TokenApprovalChoice token="HBR" spender={`0x${'22'.repeat(20)}`} value={approvalMode} onChange={setApprovalMode}/>:confirmation?.summaryRows.some(row => row.label === 'You pay') ? <details className="trade-action-confirm-details">
        <summary>Price and slippage</summary>
        <p>Price impact compares the net Quote rate with the rounded Pool reference, including spread and fees. Slippage protects the Quote net rate.</p>
      </details> : null} />
  </div>;
}

createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('p2p-signatures') ? <P2PSignaturesHarness /> : <TradeReviewHarness />);
