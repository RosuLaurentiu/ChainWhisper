import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import type { LinkTradeV2CreationStatus, OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';
import { isTradeActionConfirmationCancelledError } from '../../../lib/tradeActionConfirm';
import type { LinkTradeV2FillResult } from '../../../lib/linkTradeV2FillFlow';

type LinkRuntime = NonNullable<OtcV2ActionRuntime['link']>;
type Created = NonNullable<Awaited<ReturnType<LinkRuntime['reconcileCreation']>>>;

/** Only mount for the selected owner with privacy unlocked. No timer or automatic send. */
export default function LinkTradeV2CreationRecoveryPanel({ runtime, ownerAddress, actionInProgress, tokenInfoByKey,
  ensureTokenInfo, confirmFunding, runWalletFlow, onCreated }: {
  runtime: LinkRuntime; ownerAddress: string; actionInProgress: boolean;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>;
  ensureTokenInfo: (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>;
  runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  onCreated: (result: Created) => void;
}) {
  const session = useMemo(() => ({ runtime, owner: ownerAddress.toLowerCase() }), [runtime, ownerAddress]);
  const active = useRef<typeof session | null>(null), inFlight = useRef<{ session: typeof session } | null>(null);
  const [attempt, setAttempt] = useState(0), [busySession, setBusySession] = useState<typeof session | null>(null);
  const busy = busySession === session;
  const [result, setResult] = useState<{ session: typeof session; status: LinkTradeV2CreationStatus | null; failed?: boolean } | null>(null);
  const [message, setMessage] = useState(''), [created, setCreated] = useState<{ session: typeof session; value: Created } | null>(null);
  const [filled, setFilled] = useState<{ session: typeof session; value: LinkTradeV2FillResult } | null>(null);
  const [hashInput, setHashInput] = useState<{ session: typeof session; value: string } | null>(null);
  const transactionHash = hashInput?.session === session ? hashInput.value.trim() : '';
  useEffect(() => {
    active.current = session;
    return () => { if (active.current === session) active.current = null; };
  }, [session]);
  useEffect(() => {
    let current = true;
    if (session.owner !== runtime.ownerAddress.toLowerCase() || actionInProgress) return;
    void runtime.readCreation().then(async status => {
      if (!current) return;
      setResult({ session, status });
      if (status?.terms) {
        const kind = status.terms.privatePair ? 'private-erc20' : 'erc20';
        void Promise.all([status.terms.offerToken, status.terms.requestToken].map(address => ensureTokenInfo({ address, kind })))
          .catch(() => {});
      } else if (status?.ownerAction) {
        void ensureTokenInfo({ address: status.ownerAction.offerToken, kind: status.ownerAction.privatePair ? 'private-erc20' : 'erc20' }).catch(() => {});
      }
      if (status?.last?.step === 'create' && status.last.state === 'confirmed') {
        const restored = await runtime.reconcileCreation();
        if (current && restored) setCreated({ session, value: restored });
      } else if (status?.last?.step === 'fill' && status.last.state === 'confirmed') {
        const restored = await runtime.reconcileFill();
        if (current && restored) setFilled({ session, value: restored });
      }
    }).catch(() => { if (current) setResult({ session, status: null, failed: true }); });
    return () => { current = false; };
  }, [runtime, session, actionInProgress, attempt, ensureTokenInfo]);
  const current = result?.session === session ? result : null;
  const status = current?.status, terms = status?.terms, kind = (terms?.privatePair ?? status?.ownerAction?.privatePair) ? 'private-erc20' : 'erc20';
  const offerAddress = terms?.offerToken ?? status?.ownerAction?.offerToken;
  const offer = offerAddress ? tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, offerAddress)] : undefined;
  const request = terms && tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, terms.requestToken)];
  const ready = (token?: TradeCustomTokenInfo): token is TradeCustomTokenInfo => Boolean(token && !token.loading && !token.error &&
    Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36);
  const tokenReady = ready(offer) && ready(request);
  const run = async (operation: 'check' | 'continue' | 'discard' | 'cleanup' | 'retry') => {
    if (!status || inFlight.current?.session === session || active.current !== session) return;
    const job = { session }; inFlight.current = job; setBusySession(session); setMessage('');
    let completed: Created | null | undefined;
    let fillCompleted: LinkTradeV2FillResult | null | undefined;
    try {
      if (operation === 'continue') {
        const budget = status.fill?.maximumPayment ?? status.offerBudget;
        if (!terms || !budget || !tokenReady) throw new Error('Token details unavailable.');
        await runWalletFlow(async () => {
          const paying = status.fill ? request : offer;
          await confirmFunding({ actionLabel: 'continue shared trade', confirmTitle: 'Continue shared trade',
            confirmButtonLabel: 'Continue trade', confirmationPolicy: 'always',
            confirmMessage: 'Continue the same trade at the saved terms. New wallet signatures are required.',
            requirements: [{ asset: { kind, tokenAddress: status.fill ? terms.requestToken : terms.offerToken, symbol: paying.symbol, decimals: paying.decimals },
              amountWei: BigInt(budget), reason: status.fill ? 'maximum trade payment' : 'trade offer' }],
            tradeSummary: [{ label: status.fill ? 'Maximum payment' : 'Offer budget', value: `${formatUnits(budget, paying.decimals)} ${paying.symbol}` },
              { label: 'Price', value: `${formatUnits(terms.priceOffer, offer.decimals)} ${offer.symbol} for ${formatUnits(terms.priceRequest, request.decimals)} ${request.symbol}` },
              { label: 'Privacy', value: terms.privatePair ? 'Terms encrypted on-chain' : 'Public token terms and amounts' }] });
          if (active.current !== session) throw new Error('Wallet session changed.');
          if (status.fill) fillCompleted = await runtime.continueFill(status.id);
          else completed = await runtime.continueCreation(status.id);
        });
      } else if (operation === 'cleanup' || operation === 'retry') {
        if (!ready(offer)) throw new Error('Token details unavailable.');
        await runWalletFlow(async () => {
          const cancellation = operation === 'retry' && status.ownerAction?.kind === 'cancel';
          await confirmFunding({ actionLabel: cancellation ? 'cancel shared trade' : 'remove unused approval', confirmationPolicy: 'always',
            confirmTitle: cancellation ? 'Cancel shared trade' : 'Remove unused approval', confirmButtonLabel: cancellation ? 'Cancel trade' : 'Remove approval',
            confirmMessage: cancellation ? `Return all remaining ${offer.symbol} to your wallet.` : `Set this trade contract's ${offer.symbol} allowance to zero. No tokens move.`, requirements: [] });
          if (active.current !== session) throw new Error('Wallet session changed.');
          if (operation === 'retry') await runtime.retryOwnerAction(status.id);
          else await runtime.cleanupCreation(status.id);
        });
      } else if (operation === 'discard') await runtime.discardDraft(status.id);
      else if (status.ownerAction) await runtime.reconcileOwnerAction(transactionHash || undefined);
      else if (status.fill) fillCompleted = await runtime.reconcileFill(transactionHash || undefined);
      else completed = await runtime.reconcileCreation(transactionHash || undefined);
      if (active.current !== session) return;
      if (completed) setCreated({ session, value: completed });
      if (fillCompleted) setFilled({ session, value: fillCompleted });
      const fresh = await runtime.readCreation();
      if (active.current === session) {
        setResult({ session, status: fresh });
        if (!completed && !fillCompleted && operation === 'check' && fresh?.last?.state !== 'confirmed') {
          setMessage(fresh?.last?.state === 'failed' ? 'The request did not complete. Its fee is retained. No new transaction was sent.'
            : fresh?.last?.search ? `Checked through block ${fresh.last.search.throughBlock} of ${fresh.last.search.headBlock}. Check again to continue. No transaction was sent.`
              : 'Still pending. No new transaction was sent.');
        }
      }
    } catch (error) {
      if (active.current === session && !isTradeActionConfirmationCancelledError(error)) {
        setMessage(completed || fillCompleted ? 'Trade restored. Its saved status could not be refreshed.'
          : 'Could not complete recovery. The saved trade is retained. Do not create it again.');
      }
    } finally {
      if (inFlight.current === job) inFlight.current = null;
      setBusySession(previous => previous === session ? null : previous);
    }
  };
  const completed = created?.session === session ? created.value : null;
  const filledValue = filled?.session === session ? filled.value : null;
  if (session.owner !== runtime.ownerAddress.toLowerCase() || actionInProgress || (!status && !current?.failed && !completed && !filledValue)) return null;
  return <section className="p2p-link-recovery" aria-label="Shared trade recovery" aria-busy={busy}>
    <div>
      <strong>{filledValue ? filledValue.offerReceived === '0' ? 'No fill · payment returned' : 'Trade complete' : completed ? 'Shared trade restored' : status?.last?.state === 'failed' ? 'Transaction did not complete' : status?.canRetry ? 'Wallet request cancelled'
        : status?.ownerAction ? status.ownerAction.kind === 'cancel' ? 'Cancellation pending' : 'Approval cleanup pending'
          : status?.canContinue ? 'Continue your shared trade'
        : status?.last?.step === 'create' && status.last.state === 'confirmed' ? 'Shared trade created' : 'Shared trade pending'}</strong>
      {filledValue && tokenReady ? <p>Received {formatUnits(filledValue.offerReceived, offer.decimals)} {offer.symbol} · Paid {formatUnits(filledValue.payment, request.decimals)} {request.symbol} · Refunded {formatUnits(filledValue.refund, request.decimals)} {request.symbol}</p>
        : status?.fill && tokenReady ? <p>Pay up to {formatUnits(status.fill.maximumPayment, request.decimals)} {request.symbol}</p>
        : status && tokenReady && terms && status.offerBudget
        ? <p>{formatUnits(status.offerBudget, offer.decimals)} {offer.symbol} · {formatUnits(terms.priceOffer, offer.decimals)} {offer.symbol} for {formatUnits(terms.priceRequest, request.decimals)} {request.symbol}</p>
        : status?.terms ? <p>Token details unavailable.</p> : null}
      {current?.failed ? <p role="alert">Could not restore your saved trade.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {status ? <details><summary>Details</summary><p>Recorded fees: {formatUnits(status.feeWei, 18)} COTI</p>
        {status.last?.mined?.outcome ? <p>Wallet transaction: {status.last.mined.outcome}</p> : null}
        {status.active && status.last && ['sending', 'submitted'].includes(status.last.state) ? <label>Wallet transaction hash (optional)
          <input type="text" value={hashInput?.session === session ? hashInput.value : ''} maxLength={66} autoComplete="off" spellCheck={false}
            disabled={busy} onChange={event => setHashInput({ session, value: event.target.value })} />
        </label> : null}
      </details> : null}
    </div>
    <div className="p2p-link-recovery-actions">
      {filledValue ? null : completed ? <button type="button" className="standalone-trade-secondary-btn" onClick={() => onCreated(completed)}>Open trade</button>
        : current?.failed ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy} onClick={() => setAttempt(v => v + 1)}>Retry</button>
          : <>
            {status?.canRetry ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy || !ready(offer)} onClick={() => { void run('retry'); }}>Try again</button>
              : status?.canContinue ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy || !tokenReady} onClick={() => { void run('continue'); }}>Continue trade</button>
                : !status?.canCleanup ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy} onClick={() => { void run('check'); }}>{busy ? 'Checking…' : 'Check status'}</button> : null}
            {status?.canCleanup ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy || !ready(offer)} onClick={() => { void run('cleanup'); }}>Remove approval</button> : null}
            {status?.active && !status.last && !status.ownerAction ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy} onClick={() => { void run('discard'); }}>Discard draft</button> : null}
          </>}
    </div>
  </section>;
}
