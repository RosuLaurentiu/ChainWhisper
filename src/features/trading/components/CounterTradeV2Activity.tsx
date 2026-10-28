import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, getAddress } from '@coti-io/coti-ethers';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { CounterTradeV2ActivitySnapshot, CounterTradeV2ActivityOrder, CounterTradeV2ActivityRow } from '../../../lib/counterTradeV2Activity';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { CounterTradeV2ParticipantControls } from './CounterTradeV2Controls';
import type { TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';

type Runtime = NonNullable<OtcV2ActionRuntime['counter']>;
type Reference = Pick<CounterTradeV2ActivityOrder, 'chainId' | 'escrow' | 'id'>;

export const counterActivityOrderKey = (row: Reference): string => `${row.chainId}:${row.escrow.toLowerCase()}:${row.id}`;
export const resolveCounterActivityRuntime = async (root: Runtime, input: Reference, isCurrent = () => true): Promise<Runtime> => {
  if (!/^[1-9][0-9]*$/.test(input.id) || BigInt(input.id) >= (1n << 256n) || !/^[1-9][0-9]*$/.test(input.chainId)) {
    throw new Error('Counter activity reference is invalid.');
  }
  const reference = Object.freeze({ chainId: input.chainId, escrow: getAddress(input.escrow).toLowerCase(), id: input.id });
  if (!isCurrent()) throw new Error('Counter activity view changed.');
  const selected = root.forReference ? await root.forReference(reference) : root;
  if (!isCurrent()) throw new Error('Counter activity view changed.');
  const deployment = selected.readContext?.deployment;
  if (!deployment || deployment.chainId !== reference.chainId || deployment.contractAddress.toLowerCase() !== reference.escrow ||
      selected.ownerAddress.toLowerCase() !== root.ownerAddress.toLowerCase()) throw new Error('Counter activity target differs from its reference.');
  return selected;
};
type EnsureToken = (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
export const useCounterTradeV2Activity = ({ runtime, ownerAddress, enabled, ensureTokenInfo }: {
  runtime?: Runtime; ownerAddress: string; enabled: boolean; ensureTokenInfo: EnsureToken;
}) => {
  const session = useMemo(() => ({ runtime, owner: ownerAddress.toLowerCase() }), [runtime, ownerAddress]);
  const active = useRef<typeof session | null>(null), running = useRef<typeof session | null>(null), ensureRef = useRef(ensureTokenInfo);
  useEffect(() => { ensureRef.current = ensureTokenInfo; }, [ensureTokenInfo]);
  const [state, setState] = useState<{ session: typeof session; snapshot?: CounterTradeV2ActivitySnapshot; busy: boolean; error: string } | null>(null);
  useEffect(() => { active.current = enabled ? session : null; return () => { if (active.current === session) active.current = null; }; }, [session, enabled]);
  const refresh = useCallback(async () => {
    if (!enabled || !runtime || runtime.ownerAddress.toLowerCase() !== session.owner || running.current === session || active.current !== session) return;
    running.current = session;
    setState(previous => ({ session, snapshot: previous?.session === session ? previous.snapshot : undefined, busy: true, error: '' }));
    try {
      const loaded = new Set<string>();
      for (let step = 0; step < 4 && active.current === session; step++) {
        const snapshot = await runtime.syncActivity(); if (active.current !== session) return;
        setState({ session, snapshot, busy: true, error: '' });
        const tokens = new Map<string, Parameters<EnsureToken>[0]>();
        for (const row of snapshot.orders) {
          const kind = row.privatePair ? 'private-erc20' : 'erc20';
          for (const address of [row.offerToken, row.requestToken]) if (!loaded.has(`${kind}:${address}`)) tokens.set(`${kind}:${address}`, { address, kind });
        }
        await Promise.all([...tokens.entries()].map(async ([key, token]) => { try { await ensureRef.current(token); loaded.add(key); } catch { /* Keep unavailable metadata labelled. */ } }));
        if (snapshot.complete) break;
      }
    } catch {
      if (active.current === session) setState(previous => ({ session, snapshot: previous?.session === session ? previous.snapshot : undefined, busy: false,
        error: 'Counter activity could not refresh. Saved results may be out of date.' }));
    } finally {
      if (running.current === session) running.current = null;
      setState(previous => previous?.session === session ? { ...previous, busy: false } : previous);
    }
  }, [enabled, runtime, session]);
  useEffect(() => { void refresh(); }, [refresh]);
  const current = enabled && state?.session === session ? state : null;
  return { snapshot: current?.snapshot, busy: current?.busy ?? false, error: current?.error ?? '', refresh };
};

export default function CounterTradeV2Activity({ activity, runtime, lifecycle, activeFilter, tokenInfoByKey, ensureTokenInfo,
  search, pairFilter, typeFilter, sortMode, confirmFunding, runWalletFlow, onBusyChange, actionInProgress }: {
  activity: ReturnType<typeof useCounterTradeV2Activity>; runtime: Runtime; lifecycle: 'active' | 'history'; activeFilter: 'all' | 'received' | 'active';
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>; ensureTokenInfo: EnsureToken;
  search: string; pairFilter: string; typeFilter: string; sortMode: string; actionInProgress: boolean;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>; runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>; onBusyChange: (busy: boolean) => void;
}) {
  const view = useRef({ runtime, lifecycle });
  view.current = { runtime, lifecycle };
  const [selection, setSelection] = useState<{ root: Runtime; target: Runtime; reference: Reference; lifecycle: typeof lifecycle } | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const [resolvingKey, setResolvingKey] = useState('');
  useEffect(() => { setSelection(null); setSelectionError(''); setResolvingKey(''); }, [runtime, lifecycle]);
  const select = (row: Reference) => {
    const reference = Object.freeze({ chainId: row.chainId, escrow: row.escrow, id: row.id });
    const current = () => view.current.runtime === runtime && view.current.lifecycle === lifecycle;
    setSelection(null); setSelectionError(''); setResolvingKey(counterActivityOrderKey(reference));
    void resolveCounterActivityRuntime(runtime, reference, current).then(target => {
      if (current()) setSelection({ root: runtime, target, reference, lifecycle });
    }).catch(() => { if (current()) setSelectionError('Counter details could not be loaded for this contract.'); })
      .finally(() => { if (current()) setResolvingKey(''); });
  };
  const meta = (r: CounterTradeV2ActivityOrder) => {
    const kind = r.privatePair ? 'private-erc20' : 'erc20';
    const offer = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, r.offerToken)], request = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, r.requestToken)];
    return { offer, request, pair: `${offer?.symbol ?? r.offerToken.slice(0, 8)}/${request?.symbol ?? r.requestToken.slice(0, 8)}` };
  };
  const amount = (v: string | undefined, token?: TradeCustomTokenInfo) => v !== undefined && token && !token.loading && !token.error && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36
    ? `${formatUnits(v, token.decimals)} ${token.symbol}` : 'Amount unavailable';
  const matches = (r: CounterTradeV2ActivityOrder) => {
    const tokens = meta(r), pair = [tokens.offer?.symbol, tokens.request?.symbol].filter(Boolean).map(v => v!.trim().toUpperCase()).sort().join('/');
    return (pairFilter === 'all' || pair === pairFilter) && (['all', 'one-off', 'private-link'].includes(typeFilter) || typeFilter === 'private' && r.privatePair || typeFilter === 'visible' && !r.privatePair) &&
      (!search.trim() || `counter shared link ${r.id} ${r.maker} ${r.taker} ${r.offerToken} ${r.requestToken} ${tokens.pair}`.toLowerCase().includes(search.trim().toLowerCase()));
  };
  const rows: (CounterTradeV2ActivityOrder & Partial<CounterTradeV2ActivityRow>)[] = lifecycle === 'active' ? (activity.snapshot?.orders ?? []).filter(r => r.status === 1 && matches(r) &&
    (activeFilter === 'all' || (activeFilter === 'received' ? r.taker : r.maker) === runtime.ownerAddress.toLowerCase())) : (activity.snapshot?.history ?? []).filter(matches);
  if (sortMode === 'oldest') rows.reverse();
  if (sortMode === 'expiring') rows.sort((a, b) => { const left = BigInt(a.expiresAt) || (1n << 64n), right = BigInt(b.expiresAt) || (1n << 64n); return left < right ? -1 : left > right ? 1 : 0; });
  if (sortMode === 'most-active') {
    const counts = new Map<string, number>();
    for (const row of activity.snapshot?.history ?? []) { const key = counterActivityOrderKey(row); counts.set(key, (counts.get(key) ?? 0) + 1); }
    rows.sort((a, b) => (counts.get(counterActivityOrderKey(b)) ?? 0) - (counts.get(counterActivityOrderKey(a)) ?? 0));
  }
  const selected = selection?.root === runtime && selection.lifecycle === lifecycle &&
    rows.some(row => counterActivityOrderKey(row) === counterActivityOrderKey(selection.reference)) ? selection : null;
  const labels = ['', 'Created', 'Accepted', 'Cancelled', 'Declined', 'Expired', 'Returned after parent change'];
  return <section className="p2p-management-group-block" aria-label="Counter-offers" aria-busy={activity.busy}>
    <header className="p2p-management-group-head"><strong>Counter-offers</strong>
      {!activity.snapshot?.complete ? <button type="button" className="standalone-trade-secondary-btn" disabled={activity.busy} onClick={() => { void activity.refresh(); }}>{activity.busy ? 'Loading…' : 'Load more'}</button> : null}</header>
    {activity.error ? <p role="alert">{activity.error}</p> : null}
    {selectionError ? <p role="alert">{selectionError}</p> : null}
    {!activity.busy && !activity.error && activity.snapshot?.complete && rows.length === 0 ? <p>No counter-offers in this view.</p> : null}
    {rows.map(row => <article key={`${counterActivityOrderKey(row)}:${row.key ?? 'order'}`} className="p2p-management-group-block">
      <strong>{meta(row).pair}</strong><span> · {lifecycle === 'active' ? row.expiresAt !== '0' && BigInt(row.expiresAt) <= BigInt(Math.floor(Date.now() / 1000)) ? 'Expired · return available' : row.taker === runtime.ownerAddress.toLowerCase() ? 'To you' : 'Your funded offer' : labels[row.status]}</span>
      {lifecycle === 'active' ? <p>{amount(row.offer, meta(row).offer)} for {amount(row.request, meta(row).request)}</p> : row.status === 2 ? <p>
        {row.role === 'taker' ? `Received ${amount(row.received, meta(row).offer)} · Paid ${amount(row.payment, meta(row).request)} · Returned ${amount(row.refund, meta(row).request)}`
          : `Payment received ${amount(row.payment, meta(row).request)}`}</p>
        : row.role === 'maker' && row.status !== 1 ? <p>Returned {amount(row.refund, meta(row).offer)}</p> : null}
      <button type="button" className="standalone-trade-secondary-btn" style={{ overflowWrap: 'anywhere' }} disabled={activity.busy || actionInProgress || Boolean(resolvingKey)} onClick={() => select(row)}>{resolvingKey === counterActivityOrderKey(row) ? 'Loading counter…' : `Review counter ${row.id}`}</button>
      {row.transactionHash ? <details><summary>Transaction</summary><p style={{ overflowWrap: 'anywhere' }}>{row.transactionHash}</p></details> : null}
    </article>)}
    {selected ? <CounterTradeV2ParticipantControls runtime={selected.target} ownerAddress={selected.target.ownerAddress} proposalId={selected.reference.id} tokenInfoByKey={tokenInfoByKey}
      ensureTokenInfo={ensureTokenInfo} confirmFunding={confirmFunding} runWalletFlow={runWalletFlow}
      onBusyChange={busy => { onBusyChange(busy); if (!busy) void activity.refresh(); }} actionInProgress={actionInProgress} /> : null}
    {activity.snapshot ? <details><summary>History coverage</summary><p>Through block {activity.snapshot.throughBlock ?? 'not yet loaded'} of {activity.snapshot.safeHead}</p></details> : null}
  </section>;
}
