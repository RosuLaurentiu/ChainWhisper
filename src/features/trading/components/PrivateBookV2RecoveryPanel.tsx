import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';
import { isTradeActionConfirmationCancelledError } from '../../../lib/tradeActionConfirm';
import { buildPrivateBookV2Review, executePrivateBookV2Review } from '../../../lib/privateBookV2Review';
import { privateBookV2RecoveryActionNeedsPrivacy } from '../../../lib/privateBookV2Terms';
import type { ConfirmedPrivateBookV2Action } from '../../../lib/privateBookV2Actions';

type BookRuntime = NonNullable<OtcV2ActionRuntime['privateBook']>;
type Status = Awaited<ReturnType<BookRuntime['readRecovery']>>;

export default function PrivateBookV2RecoveryPanel({ runtime, ownerAddress, privacyUnlocked, actionInProgress,
  tokenInfoByKey, ensureTokenInfo, confirmFunding, runWalletFlow, onBusyChange, onConfirmed }: {
  runtime: OtcV2ActionRuntime; ownerAddress: string; privacyUnlocked: boolean; actionInProgress: boolean;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>;
  ensureTokenInfo: (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>;
  runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  onBusyChange: (busy: boolean) => void;
  onConfirmed: (result: ConfirmedPrivateBookV2Action) => void;
}) {
  const session = useMemo(() => ({ runtime, owner: ownerAddress.toLowerCase() }), [runtime, ownerAddress]);
  const active = useRef<typeof session | null>(session); active.current = session;
  const inFlight = useRef<typeof session | null>(null);
  const metadata = useRef(tokenInfoByKey); metadata.current = tokenInfoByKey;
  const [result, setResult] = useState<{ session: typeof session; status: Status; error?: boolean } | null>(null);
  const [busySession, setBusySession] = useState<typeof session | null>(null);
  const [message, setMessage] = useState<{ session: typeof session; text: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const book = runtime.privateBook;
  useEffect(() => {
    active.current = session;
    return () => { if (active.current === session) active.current = null; };
  }, [session]);
  useEffect(() => {
    let current = true;
    if (!book || !session.owner || !runtime.isCurrent() || actionInProgress) return;
    void book.readRecovery().then(status => {
      if (status && status.scope.owner !== session.owner) throw new Error('Saved Book owner changed.');
      if (current && active.current === session && runtime.isCurrent()) setResult({ session, status });
    }).catch(() => { if (current && active.current === session) setResult({ session, status: null, error: true }); });
    return () => { current = false; };
  }, [book, session, runtime, actionInProgress, attempt]);
  const current = result?.session === session ? result : null;
  const status = current?.status;
  const busy = busySession === session;
  const pending = status?.records.some(record => record.state === 'sending' || record.state === 'submitted');
  const canContinue = Boolean(status?.active && !status.cleanupOnly && status.records.length > 0 && ['create', 'replace', 'fill'].includes(status.book.kind) && status.records.every(record => record.state === 'confirmed') &&
    !status.records.some(record => record.step === status.book.kind));
  const needsPrivacy = status?.book.kind === 'fill' || Boolean(status?.book.approvalPrivate);
  const last = status?.records[status.records.length - 1];
  const cleanupRetry = last?.step === 'cleanup' && (last.state === 'rejected' || last.state === 'failed' &&
    ['reverted', 'cancelled'].includes(last.mined?.outcome ?? ''));
  const cleanupApprovals = cleanupRetry ? status!.records.slice(0, -1) : status?.records;
  const canCleanup = Boolean(status?.active && status.book.approvalToken && cleanupApprovals?.length &&
    ['create', 'replace', 'fill'].includes(status.book.kind) && cleanupApprovals.every(record =>
      record.state === 'confirmed' && ['approval', 'approval-reset'].includes(record.step)));
  const cleanupNeedsPrivacy = Boolean(status?.book.approvalPrivate);
  const checkNeedsPrivacy = status?.records[status.records.length - 1]?.step === 'cleanup' && cleanupNeedsPrivacy;
  const assertCurrent = () => {
    if (active.current !== session || !runtime.isCurrent()) throw new Error('Wallet session changed.');
  };
  const run = async (operation: 'check' | 'continue' | 'discard' | 'cleanup') => {
    if (!book || !status || actionInProgress || inFlight.current || active.current !== session) return;
    if (operation === 'continue' && (!canContinue || needsPrivacy && !privacyUnlocked)) return;
    if (operation === 'discard' && (!status.active || status.records.length !== 0)) return;
    if (operation === 'cleanup' && (!canCleanup || cleanupNeedsPrivacy && !privacyUnlocked) || operation === 'check' && checkNeedsPrivacy && !privacyUnlocked) return;
    inFlight.current = session; setBusySession(session); setMessage(null); onBusyChange(true);
    try {
      assertCurrent();
      let confirmed: ConfirmedPrivateBookV2Action | null | undefined;
      if (operation === 'discard') await book.discardPreparation(status.id);
      else if (operation === 'check') confirmed = await book.reconcile();
      else if (operation === 'cleanup') await runWalletFlow(async () => {
        assertCurrent();
        await confirmFunding({ actionLabel: 'remove unused approval', confirmTitle: cleanupRetry ? 'Retry removing approval' : 'Remove unused approval',
          confirmButtonLabel: 'Remove approval', confirmationPolicy: 'always', requirements: [],
          confirmMessage: 'Set this Book token allowance to zero. No tokens move.' });
        assertCurrent(); await book.cleanupPreparation(status.id);
      });
      else await runWalletFlow(async () => {
        assertCurrent();
        const action = await book.readPreparedAction(); assertCurrent();
        if (!action) throw new Error('Saved Book terms are unavailable.');
        if (privateBookV2RecoveryActionNeedsPrivacy(action) && !privacyUnlocked) throw new Error('Unlock privacy to continue.');
        const view = action.kind === 'fill' ? await book.read(action.orderId) : undefined; assertCurrent();
        const assets = action.kind === 'create' || action.kind === 'replace' ? [action.offerAsset, action.requestAsset]
          : view ? [view.offerAsset, view.requestAsset] : [];
        const details = new Map<string, { symbol: string; decimals: number }>();
        for (const asset of assets) {
          if (asset.assetType === 'native') continue;
          const kind = asset.assetType, address = asset.token!;
          const key = buildTradeCustomTokenInfoKey(kind, address);
          let info = metadata.current[key];
          if (!info || info.loading || info.error) {
            const loaded = await ensureTokenInfo({ address, kind }); assertCurrent();
            info = metadata.current[key] ?? loaded as TradeCustomTokenInfo;
          }
          if (!info || info.loading || info.error || !info.symbol?.trim() || !Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 36) throw new Error('Token details unavailable.');
          details.set(key, { symbol: info.symbol, decimals: info.decimals });
        }
        const resolveTokenMetadata = (kind: 'erc20' | 'private-erc20', address: string) => {
          const info = details.get(buildTradeCustomTokenInfoKey(kind, address));
          if (!info) throw new Error('Token details unavailable.'); return info;
        };
        const paying = action.kind === 'create' || action.kind === 'replace' ? action.offerAsset : view?.requestAsset;
        const payment = action.kind === 'create' || action.kind === 'replace' ? BigInt(action.offerAsset.amount)
          : action.kind === 'fill' ? BigInt(action.terms.mode === 'private-pair' ? action.terms.maxRequestAmount
            : action.terms.mode === 'private-offer-public-request' ? action.terms.publicRequestAmount : action.terms.maxPrivateRequestAmount) : 0n;
        const review = await buildPrivateBookV2Review({ runtime, action, resolveTokenMetadata }); assertCurrent();
        confirmed = await executePrivateBookV2Review({ runtime, review, confirm: async reviewDetails => {
          assertCurrent();
          const requirements: TradeFundingPreflightInput['requirements'] = paying && payment > 0n ? [{
            asset: { kind: paying.assetType, ...(paying.assetType === 'native' ? { symbol: 'COTI', decimals: 18 }
              : { tokenAddress: paying.token, ...resolveTokenMetadata(paying.assetType, paying.token!) }) },
            amountWei: payment, reason: 'saved Book payment' }] : [];
          await confirmFunding({ actionLabel: 'continue Book trade', confirmTitle: 'Review saved Book trade',
            confirmButtonLabel: 'Continue trade', confirmationPolicy: 'always', requirements,
            confirmMessage: reviewDetails.confirmMessage, confirmationStats: reviewDetails.confirmationStats, tradeSummary: reviewDetails.tradeSummary });
          assertCurrent(); return true;
        } });
      });
      assertCurrent();
      const fresh = await book.readRecovery(); assertCurrent();
      if (fresh && fresh.scope.owner !== session.owner) throw new Error('Saved Book owner changed.');
      setResult({ session, status: fresh });
      setMessage({ session, text: confirmed ? 'Book transaction confirmed.' : operation === 'discard' ? 'Unsent preparation discarded.'
        : operation === 'cleanup' || fresh?.records.some(record => record.step === 'cleanup' && record.state === 'confirmed') ? 'Unused approval removed. No tokens moved.'
        : fresh?.records.some(record => record.state === 'failed') ? 'Transaction did not complete. Its fee is retained.' : 'Still pending. No transaction was sent.' });
      if (confirmed) onConfirmed(confirmed);
    } catch (error) {
      if (active.current === session && !isTradeActionConfirmationCancelledError(error)) setMessage({ session, text: 'Could not complete recovery. The saved request is retained. Do not send it again.' });
    } finally {
      if (inFlight.current === session) { inFlight.current = null; onBusyChange(false); }
      setBusySession(previous => previous === session ? null : previous);
    }
  };
  if (!book || !current || !status?.active && !current.error && message?.session !== session) return null;
  return <section className="p2p-link-recovery" aria-label="Book trade recovery" aria-busy={busy}>
    <div><strong>{status?.active ? 'Book request saved' : current.error ? 'Book recovery unavailable' : 'Book recovery'}</strong>
      {status ? <p>Recorded fees: {formatUnits(status.feeWei, 18)} COTI</p> : null}
      {needsPrivacy && !privacyUnlocked && canContinue ? <p>Unlock privacy to continue.</p> : null}
      {cleanupNeedsPrivacy && !privacyUnlocked && (canCleanup || checkNeedsPrivacy) ? <p>Unlock privacy to remove or check the private approval.</p> : null}
      {current.error ? <p role="alert">Could not read the saved Book request.</p> : null}
      {message?.session === session ? <p role="status">{message.text}</p> : null}
    </div>
    <div className="p2p-link-recovery-actions">
      {status ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy || actionInProgress || checkNeedsPrivacy && !privacyUnlocked} onClick={() => { void run('check'); }}>Check status</button>
        : current.error ? <button type="button" disabled={busy || actionInProgress} onClick={() => setAttempt(value => value + 1)}>Retry</button> : null}
      {canContinue && !pending ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy || actionInProgress || needsPrivacy && !privacyUnlocked} onClick={() => { void run('continue'); }}>Continue trade</button> : null}
      {canCleanup ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy || actionInProgress || cleanupNeedsPrivacy && !privacyUnlocked} onClick={() => { void run('cleanup'); }}>{cleanupRetry ? 'Retry removing approval' : 'Remove unused approval'}</button> : null}
      {status?.active && status.records.length === 0 ? <button type="button" className="standalone-trade-secondary-btn" disabled={busy || actionInProgress} onClick={() => { void run('discard'); }}>Discard unsent preparation</button> : null}
    </div>
  </section>;
}
