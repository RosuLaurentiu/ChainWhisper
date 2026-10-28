import { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from '@coti-io/coti-ethers';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import type { LinkTradeV2Review } from '../../../lib/linkTradeV2';
import type { LinkTradeV2FillResult } from '../../../lib/linkTradeV2FillFlow';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import { isTradeActionConfirmationCancelledError, type TradeFundingPreflightInput } from '../../../lib/tradeActionConfirm';

export default function LinkTradeV2FillControls({ review, runtime, ownerAddress, tokenInfoByKey, actionInProgress,
  confirmFunding, runWalletFlow, onBusyChange }: {
  review: LinkTradeV2Review; runtime: NonNullable<OtcV2ActionRuntime['link']>; ownerAddress: string;
  tokenInfoByKey: Readonly<Record<string, TradeCustomTokenInfo>>; actionInProgress: boolean;
  confirmFunding: (input: TradeFundingPreflightInput) => Promise<void>;
  runWalletFlow: <T>(operation: () => Promise<T>) => Promise<T>; onBusyChange: (busy: boolean) => void;
}) {
  const session = useMemo(() => ({ review, runtime, owner: ownerAddress.toLowerCase() }), [review, runtime, ownerAddress]);
  const active = useRef<typeof session | null>(null), running = useRef<typeof session | null>(null);
  const [entry, setEntry] = useState<{ session: typeof session; value: string } | null>(null), [busy, setBusy] = useState<typeof session | null>(null);
  const amount = entry?.session === session ? entry.value : '';
  const [outcome, setOutcome] = useState<{ session: typeof session; result?: LinkTradeV2FillResult; error?: string } | null>(null);
  useEffect(() => { active.current = session; return () => { if (active.current === session) active.current = null; }; }, [session]);
  const kind = review.terms.privatePair ? 'private-erc20' : 'erc20';
  const offer = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, review.terms.offerToken)], request = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, review.terms.requestToken)];
  const ready = (token?: TradeCustomTokenInfo): token is TradeCustomTokenInfo => Boolean(token && !token.loading && !token.error && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36);
  let maximum = 0n;
  try { if (ready(request) && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)) maximum = parseUnits(amount, request.decimals); } catch { /* Invalid input stays disabled. */ }
  const valid = maximum > 0n && maximum < (1n << 128n) && ready(offer) && ready(request);
  const current = outcome?.session === session ? outcome : null;
  if (session.owner !== runtime.ownerAddress.toLowerCase() || session.owner === review.maker) return null;
  const execute = async () => {
    if (!valid || !ready(offer) || !ready(request) || actionInProgress || running.current === session || active.current !== session) return;
    running.current = session; setBusy(session); onBusyChange(true); setOutcome(null);
    try {
      await runWalletFlow(async () => {
        await confirmFunding({ actionLabel: 'fill shared trade', confirmTitle: 'Review trade', confirmButtonLabel: 'Confirm trade', confirmationPolicy: 'always',
          confirmMessage: 'Fill at this price up to your maximum payment. A partial fill returns the unspent amount.',
          requirements: [{ asset: { kind, tokenAddress: review.terms.requestToken, symbol: request.symbol, decimals: request.decimals }, amountWei: maximum, reason: 'maximum trade payment' }],
          tradeSummary: [{ label: 'Maximum payment', value: `${formatUnits(maximum, request.decimals)} ${request.symbol}` },
            { label: 'Receive up to', value: `${formatUnits(maximum * BigInt(review.terms.priceOffer) / BigInt(review.terms.priceRequest), offer.decimals)} ${offer.symbol}` },
            { label: 'Price', value: `${formatUnits(review.terms.priceOffer, offer.decimals)} ${offer.symbol} for ${formatUnits(review.terms.priceRequest, request.decimals)} ${request.symbol}` },
            { label: 'Network / escrow', value: `${review.reference.chainId} / ${review.reference.escrow}` },
            { label: 'Order / revision', value: `${review.reference.id} / ${review.reference.revision}` },
            { label: 'Privacy', value: review.terms.privatePair ? 'Terms encrypted on-chain' : 'Public token terms and amounts' }] });
        if (active.current !== session) throw new Error('Wallet session changed.');
        const result = await runtime.fill(review, maximum.toString());
        if (active.current === session) setOutcome({ session, result });
      });
    } catch (error) {
      if (active.current === session && !isTradeActionConfirmationCancelledError(error)) setOutcome({ session, error: 'Trade not confirmed. Check the saved recovery before trying again.' });
    } finally {
      if (running.current === session) running.current = null;
      setBusy(previous => previous === session ? null : previous); onBusyChange(false);
    }
  };
  if (current?.result && ready(offer) && ready(request)) return <section aria-label="Trade result" role="status">
    <strong>{current.result.offerReceived === '0' ? 'No fill · payment returned' : 'Trade complete'}</strong>
    <p>Received {formatUnits(current.result.offerReceived, offer.decimals)} {offer.symbol}</p>
    <p>Paid {formatUnits(current.result.payment, request.decimals)} {request.symbol} · Refunded {formatUnits(current.result.refund, request.decimals)} {request.symbol}</p>
  </section>;
  return <section aria-label="Fill shared trade" aria-busy={busy === session}>
    <label className="p2p-terminal-input-field"><span>Maximum payment {ready(request) ? `(${request.symbol})` : ''}</span>
      <input type="text" inputMode="decimal" value={amount} disabled={busy === session || actionInProgress}
        onChange={event => setEntry({ session, value: event.target.value })} autoComplete="off" />
    </label>
    {valid && ready(offer) ? <p>Receive up to {formatUnits(maximum * BigInt(review.terms.priceOffer) / BigInt(review.terms.priceRequest), offer.decimals)} {offer.symbol}</p> : null}
    {current?.error ? <p role="alert">{current.error}</p> : null}
    <button type="button" className="standalone-trade-secondary-btn" disabled={!valid || busy === session || actionInProgress} onClick={() => { void execute(); }}>
      {busy === session ? 'Waiting for wallet…' : 'Review trade'}
    </button>
  </section>;
}
