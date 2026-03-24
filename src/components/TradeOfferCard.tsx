import {
  COTI_NETWORK,
  formatMessageTimestamp,
  formatTradeAssetDisplayText,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';

type TradeOfferCardProps = {
  offer: TradeOfferMessagePayload;
  snapshot?: TradeSnapshot | null;
  currentWalletAddress?: string;
  actionPending: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: () => void;
  onCancel: () => void;
};

const buildTokenExplorerUrl = (tokenAddress?: string): string | undefined =>
  tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/token/${tokenAddress}` : undefined;

const resolveAssetScopeLabel = (kind: TradeAssetPayload['kind']): string | null => {
  if (kind === 'private-erc20') {
    return 'Private token';
  }
  if (kind === 'erc20') {
    return 'Public token';
  }
  return null;
};

const resolveTradeStatus = (offer: TradeOfferMessagePayload, snapshot?: TradeSnapshot | null): string => {
  if (snapshot?.status && snapshot.status !== 'unknown') {
    if (snapshot.status === 'expired') {
      return 'Expired';
    }
    return snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1);
  }

  if (offer.expiresAt <= Math.floor(Date.now() / 1000)) {
    return 'Expired';
  }

  return 'Pending sync';
};

export default function TradeOfferCard({
  offer,
  snapshot,
  currentWalletAddress,
  actionPending,
  onAccept,
  onDecline,
  onCounter,
  onCancel
}: TradeOfferCardProps) {
  const walletKey = currentWalletAddress?.trim().toLowerCase() ?? '';
  const isMaker = walletKey.length > 0 && offer.maker.toLowerCase() === walletKey;
  const isTaker = walletKey.length > 0 && offer.taker.toLowerCase() === walletKey;
  const statusLabel = resolveTradeStatus(offer, snapshot);
  const isOpen = statusLabel === 'Open' || statusLabel === 'Pending sync';
  const resolvedOffer = snapshot?.offer ?? offer.offer;
  const resolvedRequest = snapshot?.request ?? offer.request;
  const createdAt = snapshot?.createdAt ?? offer.createdAt;
  const expiresAt = snapshot?.expiresAt ?? offer.expiresAt;
  const offerVerifyUrl = buildTokenExplorerUrl(resolvedOffer?.tokenAddress);
  const requestVerifyUrl = buildTokenExplorerUrl(resolvedRequest?.tokenAddress);
  const offerScopeLabel = resolvedOffer ? resolveAssetScopeLabel(resolvedOffer.kind) : null;
  const requestScopeLabel = resolvedRequest ? resolveAssetScopeLabel(resolvedRequest.kind) : null;

  return (
    <div className="trade-card">
      <div className="trade-card-header">
        <div className="trade-card-title">
          <strong>Escrow Trade #{offer.tradeId}</strong>
          <span className={`trade-card-status ${statusLabel.toLowerCase()}`}>{statusLabel}</span>
        </div>
        {offer.parentTradeId ? <span className="trade-card-parent">Counter to #{offer.parentTradeId}</span> : null}
      </div>

      {resolvedOffer && resolvedRequest ? (
        <div className="trade-card-grid">
          <div className="trade-card-asset">
            <span className="trade-card-label">Maker locks</span>
            <strong>{formatTradeAssetDisplayText(resolvedOffer)}</strong>
            {offerScopeLabel ? <span className="trade-card-flag">{offerScopeLabel}</span> : null}
            {resolvedOffer.custom ? <span className="trade-card-flag">Custom token</span> : null}
            {offerVerifyUrl ? (
              <a href={offerVerifyUrl} target="_blank" rel="noreferrer">
                Verify token
              </a>
            ) : null}
          </div>

          <div className="trade-card-asset">
            <span className="trade-card-label">Taker sends</span>
            <strong>{formatTradeAssetDisplayText(resolvedRequest)}</strong>
            {requestScopeLabel ? <span className="trade-card-flag">{requestScopeLabel}</span> : null}
            {resolvedRequest.custom ? <span className="trade-card-flag">Custom token</span> : null}
            {requestVerifyUrl ? (
              <a href={requestVerifyUrl} target="_blank" rel="noreferrer">
                Verify token
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="trade-card-grid">
          <div className="trade-card-asset">
            <span className="trade-card-label">Escrow terms</span>
            <strong>Loading from contract...</strong>
          </div>
        </div>
      )}

      <div className="trade-card-meta">
        <span>Created: {formatMessageTimestamp(createdAt)}</span>
        <span>Expires: {formatMessageTimestamp(expiresAt)}</span>
      </div>

      <p className="trade-card-warning">
        Verify token contracts and terms yourself. The escrow enforces settlement only after acceptance.
      </p>

      {isOpen && isTaker ? (
        <div className="trade-card-actions">
          <button type="button" className="trade-card-action trade-card-action-accept" onClick={onAccept} disabled={actionPending}>
            {actionPending ? 'Processing...' : 'Accept'}
          </button>
          <button type="button" className="trade-card-action trade-card-action-refuse" onClick={onDecline} disabled={actionPending}>
            Refuse
          </button>
          <button type="button" className="trade-card-action trade-card-action-counter" onClick={onCounter} disabled={actionPending}>
            Counter
          </button>
        </div>
      ) : null}

      {isOpen && isMaker ? (
        <div className="trade-card-actions">
          <button type="button" className="trade-card-action trade-card-action-refuse" onClick={onCancel} disabled={actionPending}>
            {actionPending ? 'Processing...' : 'Cancel Offer'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
