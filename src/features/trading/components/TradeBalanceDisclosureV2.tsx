import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAddress, formatUnits } from '@coti-io/coti-ethers';
import type { TradeBalanceDisclosureV2Runtime, TradeBalanceDisclosureV2State } from '../../../lib/tradeBalanceDisclosureV2';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { isTradeActionConfirmationCancelledError, type TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';

export type TradeBalanceDisclosureV2Props = { runtime: TradeBalanceDisclosureV2Runtime; orderId?: string; actionInProgress: boolean;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>; ensureTokenInfo: (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>; runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>; onBusyChange: (busy: boolean) => void };
const wallet = (value: string) => { try { const result = getAddress(value.trim()).toLowerCase(); return BigInt(result) === 0n ? undefined : result; } catch { return undefined; } };

/** Decrypted snapshots stay in this wallet/order view. No timer, automatic grant or automatic transaction. */
export default function TradeBalanceDisclosureV2({ runtime, orderId, actionInProgress, tokenInfoByKey, ensureTokenInfo, confirmFunding, runWalletFlow, onBusyChange }: TradeBalanceDisclosureV2Props) {
  const session = useMemo(() => ({ runtime, orderId, owner: runtime.ownerAddress.toLowerCase() }), [runtime, orderId]);
  const active = useRef<typeof session | null>(null), running = useRef<typeof session | null>(null), ensureRef = useRef(ensureTokenInfo);
  useEffect(() => { ensureRef.current = ensureTokenInfo; }, [ensureTokenInfo]);
  const [opened, setOpened] = useState<typeof session | null>(null), [target, setTarget] = useState<{ session: typeof session; recipient: string } | null>(null);
  const [text, setText] = useState<{ session: typeof session; value: string } | null>(null), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState<typeof session | null>(null);
  const request = useMemo(() => ({ session, recipient: target?.session === session ? target.recipient : undefined }), [session, target]);
  type Pending = Awaited<ReturnType<TradeBalanceDisclosureV2Runtime['pending']>>;
  const [loaded, setLoaded] = useState<{ request: typeof request; state?: TradeBalanceDisclosureV2State; pending?: Pending; error?: string } | null>(null);
  const [message, setMessage] = useState<{ session: typeof session; value: string } | null>(null);
  type Recipients = { session: typeof session; values: string[]; cursor?: { number: string; hash: string }; complete: boolean; busy: boolean; failed?: boolean };
  const [recipients, setRecipients] = useState<Recipients | null>(null), recipientsRef = useRef<Recipients | null>(null);
  const enabled = orderId === undefined || opened === session;
  useEffect(() => { active.current = enabled ? session : null; return () => { if (active.current === session) active.current = null; }; }, [session, enabled]);
  useEffect(() => {
    let current = true;
    if (!enabled || actionInProgress) return;
    void (async () => {
      const pending = await runtime.pending(orderId), id = orderId ?? pending?.action.orderId;
      if (!id) { if (current) setLoaded({ request }); return; }
      // Clear the previous value before a new authorized read, including after revocation.
      if (current) setLoaded({ request, pending });
      if (runtime.available !== true) return;
      try {
        const state = await runtime.read(id, request.recipient);
        if (!current) return; setLoaded({ request, state, pending });
        void ensureRef.current({ address: state.offerToken, kind: 'private-erc20' }).catch(() => {});
      } catch { if (current) setLoaded({ request, pending, error: 'Balance access could not load. No balance is shown.' }); }
    })().catch(() => { if (current) setLoaded({ request, error: 'Saved balance recovery is unavailable.' }); });
    return () => { current = false; };
  }, [runtime, request, orderId, session, enabled, actionInProgress, attempt]);
  const current = loaded?.request === request ? loaded : null, state = current?.state, pending = current?.pending;
  const own = state?.maker === session.owner, token = state && tokenInfoByKey[buildTradeCustomTokenInfoKey('private-erc20', state.offerToken)];
  const ready = token && !token.loading && !token.error && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36;
  const entry = text?.session === session ? text.value : '', candidate = wallet(entry);
  const recipientChecked = Boolean(state?.recipient && (state.taker || candidate === state.recipient));
  const locked = runtime.available !== true || actionInProgress || busy === session || Boolean(pending?.active);
  const history = recipients?.session === session ? recipients : null;
  const loadRecipients = useCallback(async () => {
    const previous = recipientsRef.current?.session === session ? recipientsRef.current : null;
    if (!orderId || !enabled || active.current !== session || previous?.busy) return;
    let progress: Recipients = { session, values: previous?.values ?? [], cursor: previous?.cursor, complete: false, busy: true };
    recipientsRef.current = progress; setRecipients(progress);
    try {
      for (let step = 0; step < 4 && active.current === session; step++) {
        const result = await runtime.recipients(orderId, progress.cursor); if (active.current !== session) return;
        progress = { session, values: [...new Set([...(result.reset ? [] : progress.values), ...result.recipients])], cursor: result.cursor, complete: result.complete, busy: true };
        recipientsRef.current = progress; setRecipients(progress); if (result.complete) break;
      }
    } catch { progress = { ...progress, failed: true }; }
    finally { if (active.current === session) { progress = { ...progress, busy: false }; recipientsRef.current = progress; setRecipients(progress); } }
  }, [runtime, orderId, enabled, session]);
  useEffect(() => { if (own && !state?.taker && !history) void loadRecipients(); }, [own, state?.taker, history, loadRecipients]);
  const run = async (kind: 'grant' | 'snapshot' | 'check', allowed?: boolean) => {
    const id = orderId ?? pending?.action.orderId;
    if (!id || actionInProgress || busy === session || running.current === session || active.current !== session || kind !== 'check' && pending?.active) return;
    if (kind !== 'check' && runtime.available !== true) return;
    running.current = session; setBusy(session); onBusyChange(true); setMessage(null);
    try {
      if (kind === 'check') {
        const result = await runtime.reconcile(); if (active.current !== session) return;
        setMessage({ session, value: result ? 'Balance request confirmed.' : 'Still pending. No new transaction was sent.' });
      } else {
        if (!state || kind === 'grant' && (!own || !recipientChecked) || kind === 'snapshot' && !own && !state.grant?.allowed) throw new Error('Balance permission is unavailable.');
        await runWalletFlow(async () => {
          await confirmFunding({ actionLabel: kind === 'snapshot' ? 'refresh escrow balance' : allowed ? 'share escrow balance' : 'stop balance sharing',
            confirmTitle: kind === 'snapshot' ? 'Refresh escrow balance' : allowed ? 'Share escrow balance' : 'Stop sharing',
            confirmButtonLabel: kind === 'snapshot' ? 'Refresh balance' : allowed ? 'Confirm sharing' : 'Stop sharing', confirmationPolicy: 'always', requirements: [],
            confirmMessage: kind === 'snapshot' ? 'Record the current trade balance for your wallet. No tokens move.'
              : allowed ? `Allow ${state.recipient} to read this trade’s escrowed balance. Your wallet-token balances stay private.` : 'Block new balance reads. Previously received copies cannot be erased.' });
          if (active.current !== session) throw new Error('Wallet session changed.');
          await runtime.execute({ orderId: id, kind, ...(kind === 'grant' ? { recipient: state.recipient, allowed } : {}) });
          if (active.current === session && kind === 'grant' && !state.taker && state.recipient) {
            const previous = recipientsRef.current?.session === session ? recipientsRef.current : null;
            const updated: Recipients = { session, values: [...new Set([...(previous?.values ?? []), state.recipient])], cursor: previous?.cursor, complete: previous?.complete ?? false, busy: false };
            recipientsRef.current = updated; setRecipients(updated);
          }
          if (active.current === session) setMessage({ session, value: kind === 'snapshot' ? 'Balance snapshot recorded.' : allowed ? 'Balance access updated.' : 'Balance access revoked.' });
        });
      }
      if (active.current === session) setAttempt(v => v + 1);
    } catch (error) {
      if (active.current === session && !isTradeActionConfirmationCancelledError(error)) {
        setLoaded(previous => previous?.request === request ? { ...previous, state: previous.state && { ...previous.state, balance: undefined, availability: 'unavailable' } } : previous);
        setMessage({ session, value: 'Request not confirmed. Check saved balance recovery before another attempt.' }); setAttempt(v => v + 1);
      }
    } finally { if (running.current === session) running.current = null; setBusy(previous => previous === session ? null : previous); onBusyChange(false); }
  };
  if (!orderId && !pending?.active && !current?.error) return null;
  return <details className="p2p-management-group-block" aria-label="Trade balance sharing" open={orderId === undefined || opened === session}
    onToggle={event => { if (orderId) setOpened(event.currentTarget.open ? session : null); }}>
    <summary>{orderId ? 'Balance sharing' : 'Balance request pending'}</summary>
    {runtime.available !== true && orderId ? <p>Balance sharing unavailable.</p> : null}
    {state ? <>
      <p>{own ? 'Your recorded escrow balance' : 'Recorded shared balance'}: {state.availability === 'current' && state.balance !== undefined && ready
        ? `${formatUnits(state.balance, token.decimals)} ${token.symbol}` : state.availability === 'off' ? 'Not shared' : 'Unavailable or stale'}</p>
      {own && !state.taker ? <><label className="p2p-terminal-input-field">Counterparty wallet<input type="text" autoComplete="off" spellCheck={false} value={entry} disabled={locked}
        onChange={event => setText({ session, value: event.target.value })} /></label>
        <button type="button" className="standalone-trade-secondary-btn" disabled={locked || !candidate || candidate === state.maker} onClick={() => { if (candidate) setTarget({ session, recipient: candidate }); }}>Check access</button>
        {history?.values.map(value => <button type="button" key={value} className="standalone-trade-secondary-btn" title={value} disabled={locked || history.busy}
          onClick={() => { setText({ session, value }); setTarget({ session, recipient: value }); }}>{value.slice(0, 8)}…{value.slice(-4)}</button>)}
        {!history?.complete || history?.failed ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked || history?.busy} onClick={() => { void loadRecipients(); }}>{history?.busy ? 'Loading recipients…' : 'Load more recipients'}</button> : null}
        {history?.failed ? <p role="alert">Recipient history could not refresh.</p> : null}
      </> : null}
      {own && recipientChecked ? <p>{state.grant?.allowed ? 'Shared' : 'Not shared'} with <span style={{ overflowWrap: 'anywhere' }}>{state.recipient}</span></p> : null}
      <div className="p2p-link-recovery-actions">
        {own && recipientChecked ? <><button type="button" className="standalone-trade-secondary-btn" disabled={locked} onClick={() => { void run('grant', true); }}>{state.grant?.allowed ? 'Renew access' : 'Share balance'}</button>
          {state.grant?.allowed ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked} onClick={() => { void run('grant', false); }}>Stop sharing</button> : null}</> : null}
        {own || state.grant?.allowed ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked} onClick={() => { void run('snapshot'); }}>Refresh balance</button> : null}
      </div>
      <details><summary>Privacy details</summary><p>Only this trade’s remaining escrow is shared. Recipient and permission are public. Revocation cannot erase prior copies.</p><p>Recorded state: revision {state.revision}, status {state.status}.</p></details>
    </> : runtime.available === true && enabled && !current?.error && !pending ? <p role="status">Loading balance access…</p> : null}
    {pending?.active ? <div><p role="status">A balance request is pending.</p><button type="button" className="standalone-trade-secondary-btn" disabled={actionInProgress || busy === session || !pending.last || pending.last.state === 'rejected'} onClick={() => { void run('check'); }}>Check balance request</button>
      <details><summary>Recovery details</summary><p>Order {pending.action.orderId}</p><p style={{ overflowWrap: 'anywhere' }}>Recipient {pending.action.recipient}</p><p>Recorded fees: {formatUnits(pending.feeWei, 18)} COTI</p>
        {pending.last?.search ? <p>Checked through block {pending.last.search.throughBlock} of {pending.last.search.headBlock}.</p> : null}</details></div> : null}
    {current?.error ? <p role="alert">{current.error}</p> : null}
    {message?.session === session ? <p role="status">{message.value}</p> : null}
    {enabled ? <button type="button" className="standalone-trade-secondary-btn" disabled={actionInProgress || busy === session} onClick={() => setAttempt(v => v + 1)}>Reload access</button> : null}
  </details>;
}
