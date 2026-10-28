import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { LinkTradeV2ActivitySnapshot } from '../../../lib/linkTradeV2Activity';
import type { LinkTradeV2Reference } from '../../../lib/linkTradeV2Terms';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import type { TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';
import OwnerControls from './LinkTradeV2OwnerControls';

type Runtime = NonNullable<OtcV2ActionRuntime['link']>;
type EnsureToken = (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
export const useLinkTradeV2Activity = ({ runtime, ownerAddress, enabled, ensureTokenInfo }: {
  runtime?: Runtime; ownerAddress: string; enabled: boolean; ensureTokenInfo: EnsureToken;
}) => {
  const session = useMemo(() => ({ runtime, owner: ownerAddress.toLowerCase() }), [runtime, ownerAddress]);
  const active = useRef<typeof session | null>(null), running = useRef<typeof session | null>(null);
  const ensureRef = useRef(ensureTokenInfo);
  useEffect(() => { ensureRef.current = ensureTokenInfo; }, [ensureTokenInfo]);
  const [state, setState] = useState<{ session: typeof session; snapshot?: LinkTradeV2ActivitySnapshot; busy: boolean; error: string } | null>(null);
  useEffect(() => { active.current = enabled ? session : null; return () => { if (active.current === session) active.current = null; }; }, [session, enabled]);
  const refresh = useCallback(async () => {
    if (!enabled || !runtime || runtime.ownerAddress.toLowerCase() !== session.owner || running.current === session || active.current !== session) return;
    running.current = session;
    setState(previous => ({ session, snapshot: previous?.session === session ? previous.snapshot : undefined, busy: true, error: '' }));
    try {
      const loadedTokens = new Set<string>();
      // Four finite steps per refresh; no timer or retry after an RPC failure.
      for (let step = 0; step < 4 && active.current === session; step++) {
        const snapshot = await runtime.syncActivity();
        if (active.current !== session) return;
        setState({ session, snapshot, busy: true, error: '' });
        const tokens = new Map<string, Parameters<EnsureToken>[0]>();
        for (const row of [...snapshot.orders, ...snapshot.history]) {
          const kind = row.privatePair ? 'private-erc20' : 'erc20';
          for (const address of [row.offerToken, row.requestToken]) tokens.set(`${kind}:${address}`, { address, kind });
        }
        await Promise.all([...tokens.entries()].filter(([key]) => !loadedTokens.has(key)).map(async ([key, token]) => {
          try { await ensureRef.current(token); loadedTokens.add(key); } catch { /* Unavailable metadata stays labelled. */ }
        }));
        if (snapshot.complete) break;
      }
    } catch {
      if (active.current === session) setState(previous => ({ session, snapshot: previous?.session === session ? previous.snapshot : undefined,
        busy: false, error: 'Shared activity could not refresh. Saved results may be out of date.' }));
    } finally {
      if (running.current === session) running.current = null;
      setState(previous => previous?.session === session ? { ...previous, busy: false } : previous);
    }
  }, [enabled, runtime, session]);
  useEffect(() => { void refresh(); }, [refresh]);
  const current = enabled && state?.session === session ? state : null;
  return { snapshot: current?.snapshot, busy: current?.busy ?? false, error: current?.error ?? '', refresh };
};

export default function LinkTradeV2Activity({ activity, runtime, lifecycle, activeFilter, tokenInfoByKey, ensureTokenInfo,
  search, pairFilter, typeFilter, sortMode, confirmFunding, runWalletFlow, onBusyChange }: {
  activity: ReturnType<typeof useLinkTradeV2Activity>; runtime: Runtime; lifecycle: 'active' | 'history'; activeFilter: 'all' | 'received' | 'active';
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>; ensureTokenInfo: EnsureToken;
  search: string; pairFilter: string; typeFilter: string; sortMode: string;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>; runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>; onBusyChange: (busy: boolean) => void;
}) {
  const [selection, setSelection] = useState<{ runtime: Runtime; reference: LinkTradeV2Reference; lifecycle: 'active' | 'history' } | null>(null);
  const selected = selection?.runtime === runtime && selection.lifecycle === lifecycle && activity.snapshot?.orders.some(row => row.reference.id === selection.reference.id && row.reference.escrow === selection.reference.escrow) ? selection.reference : null;
  const meta = (row: { privatePair: boolean; offerToken: string; requestToken: string }) => {
    const kind = row.privatePair ? 'private-erc20' : 'erc20';
    const offer = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, row.offerToken)], request = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, row.requestToken)];
    return { offer, request, pair: `${offer?.symbol ?? row.offerToken.slice(0, 8)}/${request?.symbol ?? row.requestToken.slice(0, 8)}` };
  };
  const amount = (value: string | undefined, token?: TradeCustomTokenInfo) => value !== undefined && token && !token.loading && !token.error && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36
    ? `${formatUnits(value, token.decimals)} ${token.symbol}` : 'Amount unavailable';
  const matches = (row: { privatePair: boolean; offerToken: string; requestToken: string; maker: string }, id: string, detail: string) => {
    const tokens = meta(row), pair = [tokens.offer?.symbol, tokens.request?.symbol].filter(Boolean).map(v => v!.trim().toUpperCase()).sort().join('/');
    if (pairFilter !== 'all' && pair !== pairFilter) return false;
    if (!['all', 'one-off', 'private-link'].includes(typeFilter) && !(typeFilter === 'private' && row.privatePair) && !(typeFilter === 'visible' && !row.privatePair)) return false;
    return !search.trim() || `${id} ${row.maker} ${row.offerToken} ${row.requestToken} ${tokens.pair} ${detail} shared link`.toLowerCase().includes(search.trim().toLowerCase());
  };
  const orders = (activity.snapshot?.orders ?? []).filter(row => activeFilter !== 'received' && row.status === 'Open' && matches(row, row.reference.id, row.status));
  const history = (activity.snapshot?.history ?? []).filter(row => matches(row, row.orderId, row.kind));
  if (sortMode === 'oldest') { orders.reverse(); history.reverse(); }
  if (sortMode === 'expiring') orders.sort((a, b) => {
    const left = BigInt(a.expiresAt || '0') || (1n << 64n), right = BigInt(b.expiresAt || '0') || (1n << 64n);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (sortMode === 'most-active') {
    const counts = new Map<string, number>();
    const key = (chain: string, escrow: string, id: string) => `${chain}:${escrow}:${id}`;
    for (const row of history) { const scope = key(row.chainId, row.escrow, row.orderId); counts.set(scope, (counts.get(scope) ?? 0) + 1); }
    orders.sort((a, b) => (counts.get(key(b.reference.chainId, b.reference.escrow, b.reference.id)) ?? 0) - (counts.get(key(a.reference.chainId, a.reference.escrow, a.reference.id)) ?? 0));
  }
  return <section className="p2p-management-group-block" aria-label="Shared trades" aria-busy={activity.busy}>
    <header className="p2p-management-group-head"><strong>Shared trades</strong>
      {!activity.snapshot?.complete ? <button type="button" className="standalone-trade-secondary-btn" disabled={activity.busy} onClick={() => { void activity.refresh(); }}>{activity.busy ? 'Loading…' : 'Load more'}</button> : null}
    </header>
    {activity.error ? <p role="alert">{activity.error}</p> : null}
    {!activity.error && activity.snapshot && !activity.snapshot.complete ? <p role="status">More activity is available.</p> : null}
    {!activity.busy && !activity.error && activity.snapshot?.complete && (lifecycle === 'active' ? !orders.length : !history.length) ? <p>No shared trades in this view.</p> : null}
    {lifecycle === 'active' ? orders.map(row => <article key={`${row.reference.escrow}:${row.reference.id}`} className="p2p-management-group-block">
      <div><strong>{meta(row).pair}</strong><span> · {row.expiresAt !== '0' && BigInt(row.expiresAt) <= BigInt(Math.floor(Date.now() / 1000)) ? 'Expired · refund available' : row.enabled ? 'Open' : 'Link revoked'}</span></div>
      <button type="button" className="standalone-trade-secondary-btn" disabled={activity.busy} onClick={() => setSelection({ runtime, reference: row.reference, lifecycle })}>Manage trade {row.reference.id}</button>
    </article>) : history.map(row => <article key={row.key} className="p2p-management-group-block">
      <strong>{meta(row).pair}</strong><span> · {row.kind.replace(/-/g, ' ')}</span>
      {row.kind === 'filled' ? <p>{row.role === 'maker' ? 'Sold' : 'Received'} {amount(row.offer, meta(row).offer)} · {row.role === 'maker' ? 'Received' : 'Paid'} {amount(row.payment, meta(row).request)}
        {row.role === 'filler' ? ` · Refunded ${amount(row.refund, meta(row).request)}` : ''}</p>
        : row.kind === 'cancelled' || row.kind === 'expired' ? <p>Refunded {amount(row.refund, meta(row).offer)}</p> : null}
      <details><summary>Transaction</summary><p style={{ overflowWrap: 'anywhere' }}>{row.transactionHash}</p><p>Order {row.orderId} · Block {row.blockNumber}</p>
        {row.role === 'maker' ? <button type="button" className="standalone-trade-secondary-btn" disabled={activity.busy} onClick={() => {
          const order = activity.snapshot?.orders.find(order => order.reference.chainId === row.chainId && order.reference.escrow === row.escrow && order.reference.id === row.orderId);
          if (order) setSelection({ runtime, reference: order.reference, lifecycle });
        }}>Manage trade {row.orderId}</button> : null}
      </details>
    </article>)}
    {selected && (lifecycle === 'active' ? orders.some(row => row.reference.chainId === selected.chainId && row.reference.escrow === selected.escrow && row.reference.id === selected.id)
      : history.some(row => row.chainId === selected.chainId && row.escrow === selected.escrow && row.orderId === selected.id)) ? <OwnerControls runtime={runtime} reference={selected} tokenInfoByKey={tokenInfoByKey} ensureTokenInfo={ensureTokenInfo}
      confirmFunding={confirmFunding} runWalletFlow={runWalletFlow} onBusyChange={onBusyChange} /> : null}
    {activity.snapshot ? <details><summary>History coverage</summary><p>Through block {activity.snapshot.throughBlock ?? 'not yet loaded'} of {activity.snapshot.safeHead}</p></details> : null}
  </section>;
}
