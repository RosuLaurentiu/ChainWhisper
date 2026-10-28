import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from '@coti-io/coti-ethers';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import type { LinkTradeV2Review } from '../../../lib/linkTradeV2';
import type { CounterTradeV2Result } from '../../../lib/counterTradeV2Flow';
import type { CounterTradeV2Proposal } from '../../../lib/counterTradeV2';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { TradeSnapshot } from '../../../lib/appShared/core';
import { isTradeActionConfirmationCancelledError, type TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';
import TradeBalanceDisclosureV2 from './TradeBalanceDisclosureV2';

type Runtime = NonNullable<OtcV2ActionRuntime['counter']>;
type Props = { runtime: Runtime; ownerAddress: string; actionInProgress: boolean;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>;
  ensureTokenInfo: (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>;
  runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>; onBusyChange: (busy: boolean) => void };
const ready = (token?: TradeCustomTokenInfo): token is TradeCustomTokenInfo => Boolean(token && !token.loading && !token.error &&
  Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36);

/** Creation and recovery share the existing wallet review; no automatic transaction or timer. */
export default function CounterTradeV2Controls(props: Props & { review?: LinkTradeV2Review; parentProposal?: CounterTradeV2Proposal; bookTrade?: TradeSnapshot }) {
  const { runtime, ownerAddress, review, parentProposal, bookTrade, actionInProgress, tokenInfoByKey, ensureTokenInfo, confirmFunding, runWalletFlow, onBusyChange } = props;
  const privateBook = bookTrade?.v2?.protocol === 'private-v2' && bookTrade.v2.privateMode === 'fully-private' &&
    bookTrade.offer.kind === 'private-erc20' && bookTrade.request.kind === 'private-erc20' && 'privateBook' in bookTrade;
  const publicBook = bookTrade?.v2?.protocol === 'standard-v2' && bookTrade.offer.kind === 'erc20' && bookTrade.request.kind === 'erc20';
  const book = bookTrade?.status === 'open' && bookTrade.v2?.revision && bookTrade.offer.tokenAddress && bookTrade.request.tokenAddress && (privateBook || publicBook) ? bookTrade : undefined;
  const source = review?.terms ?? parentProposal ?? (book ? { offerToken: book.offer.tokenAddress!, requestToken: book.request.tokenAddress!, privatePair: privateBook } : undefined);
  const form = Boolean(source || bookTrade);
  const fundingAllowed = !runtime.recoveryOnly && (!runtime.privateOnly || source?.privatePair === true) && (!runtime.publicOnly || source?.privatePair === false);
  const session = useMemo(() => ({ runtime, owner: ownerAddress.toLowerCase(), review, parentProposal, bookTrade }), [runtime, ownerAddress, review, parentProposal, bookTrade]);
  const active = useRef<typeof session | null>(null), running = useRef<typeof session | null>(null);
  const [busy, setBusy] = useState<typeof session | null>(null), [attempt, setAttempt] = useState(0);
  const [entry, setEntry] = useState<{ session: typeof session; offer: string; request: string } | null>(null);
  type State = { session: typeof session; saved?: Awaited<ReturnType<Runtime['readRecovery']>>; proposal?: CounterTradeV2Proposal;
    result?: CounterTradeV2Result; error?: string };
  const [state, setState] = useState<State | null>(null);
  useEffect(() => { active.current = session; return () => { if (active.current === session) active.current = null; }; }, [session]);
  useEffect(() => {
    let current = true;
    if (form || actionInProgress || session.owner !== runtime.ownerAddress.toLowerCase()) return;
    void (async () => {
      const saved = await runtime.readRecovery();
      let result: CounterTradeV2Result | undefined, proposal: CounterTradeV2Proposal | undefined;
      if (saved?.last && ['create', 'cancel', 'accept', 'decline'].includes(saved.last.step) && saved.last.state === 'confirmed') {
        result = (await runtime.reconcile()) ?? undefined;
        if (result?.proposalId) proposal = await runtime.read(result.proposalId);
      }
      if (!current) return;
      setState({ session, saved, result, proposal });
      const material = saved?.material;
      if (material) void Promise.all([material.offerToken, material.requestToken].map(address => ensureTokenInfo({ address, kind: material.privatePair ? 'private-erc20' : 'erc20' }))).catch(() => {});
    })().catch(() => { if (current) setState(previous => ({ ...(previous?.session === session ? previous : {}), session, error: 'Could not restore the counter-offer. Its recovery record is retained.' })); });
    return () => { current = false; };
  }, [session, runtime, form, actionInProgress, attempt, ensureTokenInfo]);
  const current = state?.session === session ? state : null, saved = current?.saved;
  const kind = (source?.privatePair ?? saved?.material.privatePair) ? 'private-erc20' : 'erc20';
  const offerToken = source?.requestToken ?? saved?.material.offerToken, requestToken = source?.offerToken ?? saved?.material.requestToken;
  const offer = offerToken ? tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, offerToken)] : undefined;
  const request = requestToken ? tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, requestToken)] : undefined;
  const value = entry?.session === session ? entry : { offer: '', request: '' };
  let offerWei = 0n, requestWei = 0n;
  try {
    if (ready(offer) && ready(request) && [value.offer, value.request].every(v => /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v))) {
      offerWei = parseUnits(value.offer, offer.decimals); requestWei = parseUnits(value.request, request.decimals);
    }
  } catch { /* Invalid amounts keep review disabled. */ }
  const valid = offerWei > 0n && requestWei > 0n && offerWei < (1n << 128n) && requestWei < (1n << 128n);
  const locked = busy === session || actionInProgress;
  const run = async (operation: 'create' | 'continue' | 'check' | 'cancel' | 'cleanup') => {
    if (locked || running.current === session || active.current !== session) return;
    if (operation === 'create' && !fundingAllowed || operation === 'continue' && (runtime.recoveryOnly || runtime.privateOnly && !saved?.material.privatePair || runtime.publicOnly && saved?.material.privatePair)) return;
    const captured = { offer: offerWei.toString(), request: requestWei.toString(), expiresAt: '0' };
    const parent = parentProposal ? { proposalId: parentProposal.id } : review ?? (book ? {
      bookReference: { chainId: book.v2!.chainId, escrow: book.v2!.contractAddress, id: String(book.tradeId), revision: book.v2!.revision!, credentialEpoch: '0' },
      maker: book.maker, offerToken: book.offer.tokenAddress!, requestToken: book.request.tokenAddress!
    } : undefined);
    running.current = session; setBusy(session); onBusyChange(true);
    setState(previous => previous?.session === session ? { ...previous, error: undefined } : null);
    try {
      let result: CounterTradeV2Result | null | undefined;
      if (operation === 'check') result = await runtime.reconcile();
      else await runWalletFlow(async () => {
        const funding = operation === 'create' || operation === 'continue', material = saved?.material, accepting = operation === 'continue' && saved?.kind === 'accept';
        if (!ready(offer) || funding && !ready(request) || operation === 'create' && (!source || !valid)) throw new Error('Counter terms or token details are unavailable.');
        const amounts = operation === 'create' ? captured : material;
        await confirmFunding({ actionLabel: funding ? 'fund counter-offer' : operation === 'cancel' ? 'cancel counter-offer' : 'remove unused approval',
          confirmTitle: funding ? 'Review counter-offer' : operation === 'cancel' ? 'Cancel counter-offer' : 'Remove approval',
          confirmButtonLabel: funding ? 'Fund counter-offer' : operation === 'cancel' ? 'Cancel and refund' : 'Remove approval', confirmationPolicy: 'always',
          confirmMessage: accepting ? 'Continue the agreed payment and delivery. Parent offers return before payment.' : funding ? 'Your offer is held until the other party accepts, or you cancel for a full refund.' : operation === 'cancel' ? 'Return the funded offer to your wallet.' : 'Set the counter contract allowance to zero. No tokens move.',
          requirements: funding && saved?.kind !== 'accept' && amounts && offerToken ? [{ asset: { kind, tokenAddress: offerToken, symbol: offer.symbol, decimals: offer.decimals }, amountWei: BigInt(amounts.offer), reason: 'counter-offer funding' }] : [],
          ...(funding && amounts && ready(request) ? { tradeSummary: [{ label: accepting ? 'You receive' : 'You offer', value: `${formatUnits(amounts.offer, offer.decimals)} ${offer.symbol}` },
            { label: accepting ? 'You pay' : 'You request', value: `${formatUnits(amounts.request, request.decimals)} ${request.symbol}` },
            { label: 'Privacy', value: kind === 'private-erc20' ? 'Terms encrypted for the two participants' : 'Public terms and amounts' }] } : {}) });
        if (active.current !== session) throw new Error('Wallet session changed.');
        if (operation === 'create') {
          if (!parent) throw new Error('Counter parent review is unavailable.');
          result = await runtime.propose(parent, captured);
        }
        else if (operation === 'continue') result = await runtime.continue(saved!.id);
        else if (operation === 'cancel') result = await runtime.cancel(current!.proposal!.id);
        else result = await runtime.cleanup();
      });
      if (active.current === session) {
        // Keep the result even when the following display read fails.
        setState(previous => ({ ...(previous?.session === session ? previous : {}), session, result: result ?? previous?.result }));
        if (!form) setAttempt(v => v + 1);
      }
    } catch (error) {
      if (active.current === session && !isTradeActionConfirmationCancelledError(error)) setState(previous => ({ ...(previous?.session === session ? previous : {}), session,
        error: 'Counter-offer not confirmed. Check its saved status before trying again.' }));
    } finally {
      if (running.current === session) running.current = null;
      setBusy(previous => previous === session ? null : previous); onBusyChange(false);
    }
  };
  if (session.owner !== runtime.ownerAddress.toLowerCase() || bookTrade && (!book || session.owner === book.maker.toLowerCase()) || review && session.owner === review.maker || parentProposal && (parentProposal.taker !== session.owner || parentProposal.effectiveStatus !== 1 || parentProposal.depth >= 16)) return null;
  if (form && !fundingAllowed) return null;
  if (form) return <details aria-label="Make counter-offer"><summary>Make a counter-offer</summary>
    {current?.result ? <p role="status">Counter-offer created. You can manage it in My trades.</p> : <>
      <label className="p2p-terminal-input-field">You offer {ready(offer) ? `(${offer.symbol})` : ''}<input type="text" inputMode="decimal" autoComplete="off" value={value.offer} disabled={locked}
        onChange={event => setEntry({ session, offer: event.target.value, request: value.request })} /></label>
      <label className="p2p-terminal-input-field">You request {ready(request) ? `(${request.symbol})` : ''}<input type="text" inputMode="decimal" autoComplete="off" value={value.request} disabled={locked}
        onChange={event => setEntry({ session, request: event.target.value, offer: value.offer })} /></label>
      <button type="button" className="standalone-trade-secondary-btn" disabled={!valid || locked} onClick={() => { void run('create'); }}>{busy === session ? 'Waiting for wallet…' : 'Review counter-offer'}</button>
    </>}{current?.error ? <p role="alert">{current.error}</p> : null}
  </details>;
  if (!saved && !current?.error && !current?.result) return null;
  const refundable = current?.proposal?.maker === session.owner && current.proposal.status === 1 && current.proposal.offerLocked;
  return <section className="p2p-link-recovery" aria-label="Counter-offer recovery" aria-busy={busy === session}>
    <div><strong>{refundable ? 'Your counter-offer' : current?.result?.kind === 'cancel' ? 'Counter-offer refunded' : current?.result?.kind === 'accept' ? 'Counter-offer accepted' : current?.result?.kind === 'decline' ? 'Counter-offer declined' : saved?.canContinue ? 'Continue counter-offer' : 'Counter-offer status'}</strong>
      {saved && ready(offer) && ready(request) ? <p>Offer {formatUnits(saved.material.offer, offer.decimals)} {offer.symbol} · Request {formatUnits(saved.material.request, request.decimals)} {request.symbol}</p> : null}
      {current?.result?.kind === 'cancel' && ready(offer) ? <p role="status">Returned {formatUnits(current.result.refund, offer.decimals)} {offer.symbol}</p> : null}
      {current?.result?.kind === 'accept' && ready(offer) && ready(request) ? <p role="status">Received {formatUnits(current.result.received!, offer.decimals)} {offer.symbol} · Paid {formatUnits(current.result.payment!, request.decimals)} {request.symbol} · Returned {formatUnits(current.result.refund, request.decimals)} {request.symbol}</p> : null}
      {current?.error ? <p role="alert">{current.error}</p> : null}
      {saved ? <details><summary>Details</summary><p>Recorded fees: {formatUnits(saved.feeWei, 18)} COTI</p>
        {current?.proposal ? <p>Counter-offer {current.proposal.id}</p> : null}</details> : null}
    </div>
    <div className="p2p-link-recovery-actions">
      {refundable ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked || !ready(offer)} onClick={() => { void run('cancel'); }}>Cancel and refund</button>
        : saved?.canContinue ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked || !ready(offer) || !ready(request)} onClick={() => { void run('continue'); }}>Continue counter-offer</button>
          : saved?.active && saved.last ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked} onClick={() => { void run('check'); }}>Check status</button> : null}
      {saved?.canCleanup ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked || !ready(offer)} onClick={() => { void run('cleanup'); }}>Remove approval</button> : null}
      {!saved || !saved.active ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked} onClick={() => setAttempt(v => v + 1)}>Refresh</button> : null}
    </div>
  </section>;
}

/** Selected from participant discovery. Every financial action rechecks this immutable review on-chain. */
export function CounterTradeV2ParticipantControls(props: Props & { proposalId: string }) {
  const { runtime, ownerAddress, proposalId, tokenInfoByKey, ensureTokenInfo, confirmFunding, runWalletFlow, onBusyChange, actionInProgress } = props;
  const session = useMemo(() => ({ runtime, owner: ownerAddress.toLowerCase(), proposalId }), [runtime, ownerAddress, proposalId]);
  const active = useRef<typeof session | null>(null), running = useRef<typeof session | null>(null);
  const [attempt, setAttempt] = useState(0), [busy, setBusy] = useState<typeof session | null>(null);
  const [state, setState] = useState<{ session: typeof session; proposal?: CounterTradeV2Proposal; result?: CounterTradeV2Result; pending?: boolean; error?: string } | null>(null);
  useEffect(() => { active.current = session; return () => { if (active.current === session) active.current = null; }; }, [session]);
  useEffect(() => {
    let current = true;
    if (actionInProgress || session.owner !== runtime.ownerAddress.toLowerCase()) return;
    void Promise.all([runtime.read(proposalId), runtime.readRecovery()]).then(([proposal, saved]) => {
      if (!current) return;
      setState(previous => {
        const prior = previous?.session === session ? previous : undefined;
        return { session, proposal: prior?.proposal && JSON.stringify(prior.proposal) === JSON.stringify(proposal) ? prior.proposal : proposal,
          pending: saved?.active, result: prior?.result };
      });
      const kind = proposal.privatePair ? 'private-erc20' : 'erc20';
      void Promise.all([proposal.offerToken, proposal.requestToken].map(address => ensureTokenInfo({ address, kind }))).catch(() => {});
    }).catch(() => { if (current) setState(previous => ({ ...(previous?.session === session ? previous : {}), session, error: 'Could not load current counter terms. Retry before you act.' })); });
    return () => { current = false; };
  }, [session, runtime, proposalId, actionInProgress, attempt, ensureTokenInfo]);
  const current = state?.session === session ? state : null, p = current?.proposal;
  const kind = p?.privatePair ? 'private-erc20' : 'erc20';
  const offer = p ? tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, p.offerToken)] : undefined;
  const request = p ? tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, p.requestToken)] : undefined;
  const locked = actionInProgress || busy === session, termsReady = ready(offer) && ready(request), own = p?.maker === session.owner;
  const acceptAllowed = !runtime.recoveryOnly && (!runtime.privateOnly || p?.privatePair === true) && (!runtime.publicOnly || p?.privatePair === false);
  const run = async (operation: 'accept' | 'decline' | 'cancel') => {
    if (!p || !termsReady || !ready(offer) || !ready(request) || locked || running.current === session || active.current !== session || current?.error || current?.pending) return;
    if (operation === 'accept' && !acceptAllowed) return;
    running.current = session; setBusy(session); onBusyChange(true);
    try {
      await runWalletFlow(async () => {
        await confirmFunding({ actionLabel: operation === 'accept' ? 'accept counter-offer' : operation === 'decline' ? 'decline counter-offer' : 'cancel counter-offer',
          confirmTitle: operation === 'accept' ? 'Accept counter-offer' : operation === 'decline' ? 'Decline counter-offer' : 'Cancel counter-offer',
          confirmButtonLabel: operation === 'accept' ? 'Accept counter-offer' : operation === 'decline' ? 'Decline and return offer' : 'Cancel and refund', confirmationPolicy: 'always',
          confirmMessage: operation === 'accept' ? 'Trade at these exact amounts. Parent offers return before payment. Refunds are shown after settlement.'
            : operation === 'decline' ? 'Return the funded offer to its maker. You make no payment.' : 'Return your funded offer to your wallet.',
          // Parent refunds can fund payment; check the complete call and exact settlement instead of the pre-refund balance.
          requirements: [], tradeSummary: operation === 'accept' ? [{ label: 'You pay', value: `${formatUnits(p.request, request.decimals)} ${request.symbol}` },
            { label: 'You receive', value: `${formatUnits(p.offer, offer.decimals)} ${offer.symbol}` }] : [{ label: operation === 'cancel' ? 'Returned to you' : 'Returned to maker', value: `${formatUnits(p.offer, offer.decimals)} ${offer.symbol}` }] });
        if (active.current !== session) throw new Error('Wallet session changed.');
        const result = operation === 'cancel' ? await runtime.cancel(p.id) : await runtime.recipientAction(p, operation);
        if (active.current === session) setState(previous => ({ ...(previous?.session === session ? previous : {}), session, result }));
      });
      if (active.current === session) setAttempt(v => v + 1);
    } catch (error) {
      if (active.current === session && !isTradeActionConfirmationCancelledError(error)) setState(previous => ({ ...(previous?.session === session ? previous : {}), session,
        error: 'Transaction not confirmed. Check the saved counter recovery before trying again.' }));
    } finally { if (running.current === session) running.current = null; setBusy(previous => previous === session ? null : previous); onBusyChange(false); }
  };
  if (session.owner !== runtime.ownerAddress.toLowerCase()) return null;
  return <section className="p2p-management-group-block" aria-label="Selected counter-offer" aria-busy={locked}>
    {!current ? <p role="status">Loading counter-offer…</p> : null}
    {p && termsReady && ready(offer) && ready(request) ? <><strong>{own ? 'Your offer' : 'Counter-offer to you'}</strong>
      <p>{formatUnits(p.offer, offer.decimals)} {offer.symbol} for {formatUnits(p.request, request.decimals)} {request.symbol}</p>
      {p.status === 1 && p.effectiveStatus !== 1 ? <p>Offer unavailable for acceptance. Funded tokens can still be returned.</p> : null}
      {current?.pending ? <p role="status">Counter transaction pending. Use saved counter recovery before another action.</p> : null}
      {current?.result?.kind === 'accept' ? <p role="status">Received {formatUnits(current.result.received!, offer.decimals)} {offer.symbol} · Paid {formatUnits(current.result.payment!, request.decimals)} {request.symbol} · Returned {formatUnits(current.result.refund, request.decimals)} {request.symbol}</p>
        : current?.result?.kind === 'cancel' ? <p role="status">Returned {formatUnits(current.result.refund, offer.decimals)} {offer.symbol}</p>
          : current?.result?.kind === 'decline' ? <p role="status">Declined. The offer was returned to its maker.</p> : null}
      {p.status === 1 && !current?.result ? <div className="p2p-link-recovery-actions">
        {own ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked || Boolean(current.error) || current.pending} onClick={() => { void run('cancel'); }}>Cancel and refund</button> : <>
          <button type="button" className="standalone-trade-secondary-btn" disabled={!acceptAllowed || locked || Boolean(current?.error) || current?.pending || p.effectiveStatus !== 1} onClick={() => { void run('accept'); }}>Accept counter-offer</button>
          <button type="button" className="standalone-trade-secondary-btn" disabled={locked || Boolean(current?.error) || current?.pending} onClick={() => { void run('decline'); }}>Decline counter-offer</button>
        </>}
      </div> : null}
      {!own && p.status === 1 && p.effectiveStatus === 1 && !current?.result && !current?.error && !current?.pending ? <CounterTradeV2Controls {...props} parentProposal={p} /> : null}
      {p.privatePair && runtime.balance ? <TradeBalanceDisclosureV2 key={`${session.owner}:${p.id}`} runtime={runtime.balance} orderId={p.id} tokenInfoByKey={tokenInfoByKey}
        ensureTokenInfo={ensureTokenInfo} confirmFunding={confirmFunding} runWalletFlow={runWalletFlow} onBusyChange={onBusyChange} actionInProgress={locked} /> : null}
    </> : p ? <p>Token details unavailable.</p> : null}
    {current?.error ? <p role="alert">{current.error}</p> : null}
    <button type="button" className="standalone-trade-secondary-btn" disabled={locked} onClick={() => setAttempt(v => v + 1)}>Refresh counter</button>
  </section>;
}
