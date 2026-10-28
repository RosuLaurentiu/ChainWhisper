import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatUnits } from '@coti-io/coti-ethers';
import { buildTradeCustomTokenInfoKey, type TradeCustomTokenInfo } from '../../../lib/appHelpers';
import { readLinkTradeV2CurrentReview, type LinkTradeV2Deployment, type LinkTradeV2Review } from '../../../lib/linkTradeV2';
import type { LinkTradeV2Reference } from '../../../lib/linkTradeV2Terms';
import type { TradeHistoryV2ReadCapability } from '../../../lib/tradeHistoryV2Chain';

export type LinkTradeV2ReadContext = Readonly<{
  capability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment;
}>;
type TokenInfo = Readonly<Record<string, TradeCustomTokenInfo>>;

export function LinkTradeV2ReviewDetails({ review, tokenInfoByKey }: {
  review: LinkTradeV2Review; tokenInfoByKey: TokenInfo;
}) {
  const { terms, reference } = review, kind = terms.privatePair ? 'private-erc20' : 'erc20';
  const offer = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, terms.offerToken)];
  const request = tokenInfoByKey[buildTradeCustomTokenInfoKey(kind, terms.requestToken)];
  const ready = (token?: TradeCustomTokenInfo): token is TradeCustomTokenInfo => Boolean(token &&
    !token.loading && !token.error && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36);
  return <div className="standalone-trade-details">
    <p>{terms.privatePair ? 'Private trade' : 'Public trade'}</p>
    {ready(offer) && ready(request)
      ? <p><strong>{formatUnits(terms.priceOffer, offer.decimals)} {offer.symbol} for {formatUnits(terms.priceRequest, request.decimals)} {request.symbol}</strong></p>
      : <p role="status">Token details unavailable.</p>}
    <p>Partial fills use this price. Unspent funds are refunded.</p>
    <details><summary>Trade details</summary><dl style={{ overflowWrap: 'anywhere' }}>
      <dt>Order</dt><dd>{reference.id}</dd>
      <dt>Escrow</dt><dd>{reference.escrow}</dd>
      <dt>Network</dt><dd>{reference.chainId}</dd>
      <dt>Expires</dt><dd>{terms.expiresAt === '0' ? 'No expiry' : new Date(Number(terms.expiresAt) * 1000).toUTCString()}</dd>
    </dl></details>
  </div>;
}

export default function LinkTradeV2Terminal({ reference, secret, readContext, resolveReadContext, tokenInfoByKey, ensureTokenInfo, renderFill, renderCounter, renderBalance }: {
  reference: LinkTradeV2Reference;
  secret: string;
  readContext?: LinkTradeV2ReadContext;
  resolveReadContext?: (reference: LinkTradeV2Reference) => Promise<LinkTradeV2ReadContext>;
  tokenInfoByKey: TokenInfo;
  ensureTokenInfo?: (token: { address: string; kind: 'erc20' | 'private-erc20' }) => Promise<unknown>;
  renderFill?: (review: LinkTradeV2Review) => ReactNode;
  renderCounter?: (review: LinkTradeV2Review) => ReactNode;
  renderBalance?: (review: LinkTradeV2Review) => ReactNode;
}) {
  const request = useMemo(() => ({ reference, secret, readContext, resolveReadContext }), [reference, secret, readContext, resolveReadContext]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ request: typeof request; review?: LinkTradeV2Review; failed?: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if ((!request.readContext && !request.resolveReadContext) || !request.secret) return;
    const load = async () => {
      try {
        const context = request.readContext ?? await request.resolveReadContext!(request.reference);
        if (!active) return;
        const review = await readLinkTradeV2CurrentReview({ ...context, reference: request.reference, secret: request.secret });
        if (!active) return;
        setResult({ request, review });
        if (ensureTokenInfo) {
          const kind = review.terms.privatePair ? 'private-erc20' : 'erc20';
          await Promise.all([review.terms.offerToken, review.terms.requestToken].map(address => ensureTokenInfo({ address, kind })));
        }
      } catch {
        if (active) setResult({ request, failed: true });
      }
    };
    void load();
    return () => { active = false; };
  }, [request, attempt, ensureTokenInfo]);
  if (!secret) return <p role="alert">Open the full Share link to view this trade.</p>;
  if (!readContext && !resolveReadContext) return <p role="status">This shared trade is not available in this App deployment.</p>;
  const current = result?.request === request ? result : null;
  if (!current) return <p role="status">Loading shared trade…</p>;
  if (current.failed) return <div role="alert"><p>Could not load this shared trade.</p>
    <button type="button" className="standalone-trade-secondary-btn" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Retry</button></div>;
  return current.review ? <>
    <LinkTradeV2ReviewDetails review={current.review} tokenInfoByKey={tokenInfoByKey} />
    {renderFill ? renderFill(current.review) : <p role="status">Trade submission is not enabled for this deployment.</p>}
    {renderCounter?.(current.review)}
    {current.review.terms.privatePair ? renderBalance?.(current.review) : null}
  </> : null;
}
