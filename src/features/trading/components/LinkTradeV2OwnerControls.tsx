import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { LinkTradeV2OwnerOrder, LinkTradeV2OwnerResult } from '../../../lib/linkTradeV2OwnerActions';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { isTradeActionConfirmationCancelledError, type TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';
import type { LinkTradeV2Reference } from '../../../lib/linkTradeV2Terms';
import TradeBalanceDisclosureV2 from './TradeBalanceDisclosureV2';

export default function LinkTradeV2OwnerControls({ runtime, reference, tokenInfoByKey, ensureTokenInfo, confirmFunding, runWalletFlow, onBusyChange }: {
  runtime: NonNullable<OtcV2ActionRuntime['link']>; reference: LinkTradeV2Reference; tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>;
  ensureTokenInfo: (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>; runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  onBusyChange: (busy: boolean) => void;
}) {
  const orderId = reference.id;
  const scopeMatches = reference.chainId === runtime.readContext.deployment.chainId && reference.escrow.toLowerCase() === runtime.readContext.deployment.contractAddress;
  const canResolve = scopeMatches || Boolean(runtime.forReference);
  const session = useMemo(() => ({ runtime, reference }), [runtime, reference]), active = useRef<typeof session | null>(null), inFlight = useRef<typeof session | null>(null);
  const [loaded, setLoaded] = useState<{ session: typeof session; order: LinkTradeV2OwnerOrder | null; runtime?: typeof runtime; failed?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0), [busySession, setBusySession] = useState<typeof session | null>(null), [message, setMessage] = useState('');
  const [balanceBusy, setBalanceBusy] = useState<typeof session | null>(null);
  const busy = busySession === session;
  const locked = busy || balanceBusy === session;
  const [result, setResult] = useState<{ session: typeof session; value: LinkTradeV2OwnerResult } | null>(null);
  useEffect(() => {
    if (!canResolve) return;
    let current = true; active.current = session;
    void (async () => {
      const selected = scopeMatches ? runtime : await runtime.forReference!(reference);
      if (!current) return;
      if (selected.ownerAddress.toLowerCase() !== runtime.ownerAddress.toLowerCase() ||
          selected.readContext.deployment.chainId !== reference.chainId || selected.readContext.deployment.contractAddress !== reference.escrow.toLowerCase())
        throw new Error('Shared trade owner reference changed.');
      const order = await selected.readOwnerOrder(orderId);
      if (!current) return; setLoaded({ session, order, runtime: selected });
      if (order) void ensureTokenInfo({ address: order.offerToken, kind: order.privatePair ? 'private-erc20' : 'erc20' }).catch(() => {});
    })().catch(() => { if (current) setLoaded({ session, order: null, failed: true }); });
    return () => { current = false; if (active.current === session) active.current = null; };
  }, [runtime, reference, session, orderId, attempt, ensureTokenInfo, scopeMatches, canResolve]);
  const current = loaded?.session === session ? loaded : null, order = current?.order;
  const selectedRuntime = current?.runtime;
  const token = order && tokenInfoByKey[buildTradeCustomTokenInfoKey(order.privatePair ? 'private-erc20' : 'erc20', order.offerToken)];
  const ready = Boolean(token && !token.loading && !token.error && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36);
  const completed = result?.session === session ? result.value : null;
  const run = async (kind: 'cancel' | 'cleanup') => {
    if (!selectedRuntime || !order || !ready || locked || inFlight.current === session || active.current !== session) return;
    inFlight.current = session; setBusySession(session); onBusyChange(true); setMessage('');
    let completed: LinkTradeV2OwnerResult | undefined;
    try {
      await runWalletFlow(async () => {
        await confirmFunding({ actionLabel: kind === 'cancel' ? 'cancel shared trade' : 'remove unused approval', confirmationPolicy: 'always',
          confirmTitle: kind === 'cancel' ? 'Cancel shared trade' : 'Remove unused approval', confirmButtonLabel: kind === 'cancel' ? 'Cancel trade' : 'Remove approval',
          confirmMessage: kind === 'cancel' ? `Return all remaining ${token!.symbol} to your wallet. No new deposit.`
            : `Set this trade contract's ${token!.symbol} allowance to zero. No tokens move.`, requirements: [] });
        if (active.current !== session) throw new Error('Wallet session changed.');
        completed = await selectedRuntime.ownerOrderAction({ kind, orderId });
      });
      if (active.current !== session || !completed) return;
      setResult({ session, value: completed });
      const fresh = await selectedRuntime.readOwnerOrder(orderId);
      if (active.current === session) setLoaded({ session, order: fresh, runtime: selectedRuntime });
    } catch (error) {
      if (active.current === session && !isTradeActionConfirmationCancelledError(error)) setMessage(completed
        ? 'Action complete. The display is waiting for a refresh.' : 'Action not confirmed. Check saved recovery before another attempt.');
    } finally {
      if (inFlight.current === session) inFlight.current = null;
      onBusyChange(false); setBusySession(previous => previous === session ? null : previous);
    }
  };
  if (!canResolve || !order && !current?.failed) return null;
  return <><section className="p2p-link-recovery" aria-label="Your shared trade" aria-busy={locked}>
    <div><strong>{!order || order.status === 1 && completed?.action !== 'cancel' ? 'Your shared trade' : 'Shared trade closed'}</strong>
      {completed?.action === 'cancel' && ready ? <p>Returned {formatUnits(completed.refund, token!.decimals)} {token!.symbol}</p> : null}
      {completed?.action === 'cleanup' ? <p>Approval removed.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {current?.failed ? <p role="alert">Owner controls are unavailable.</p> : null}
    </div>
    <div className="p2p-link-recovery-actions">
      {order?.status === 1 && completed?.action !== 'cancel' ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked || !ready} onClick={() => { void run('cancel'); }}>Cancel trade</button> : null}
      {order && BigInt(order.allowance) > 0n && completed?.action !== 'cleanup' ? <button type="button" className="standalone-trade-secondary-btn" disabled={locked || !ready} onClick={() => { void run('cleanup'); }}>Remove approval</button> : null}
      {current?.failed ? <button type="button" className="standalone-trade-secondary-btn" onClick={() => setAttempt(v => v + 1)}>Retry</button> : null}
    </div>
  </section>{order?.privatePair && selectedRuntime?.balance ? <TradeBalanceDisclosureV2 key={`${selectedRuntime.ownerAddress}:${reference.escrow}:${orderId}`} runtime={selectedRuntime.balance} orderId={orderId}
    tokenInfoByKey={tokenInfoByKey} ensureTokenInfo={ensureTokenInfo} confirmFunding={confirmFunding} runWalletFlow={runWalletFlow} actionInProgress={busy}
    onBusyChange={value => { setBalanceBusy(previous => value ? session : previous === session ? null : previous); onBusyChange(value); }} /> : null}</>;
}
