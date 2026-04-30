import {
  COTI_NETWORK,
  formatMessageTimestamp,
  formatTokenAmount,
  formatTradeAssetDisplayText,
  shortenAddress,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeResponseMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';
import { isZeroTradeTakerAddress, resolveTradePerspective } from '../lib/tradePerspective';

type TradeOfferCardProps = {
  offer: TradeOfferMessagePayload;
  snapshot?: TradeSnapshot | null;
  latestResponse?: TradeResponseMessagePayload | null;
  currentWalletAddress?: string;
  actionPending: boolean;
  collapsed?: boolean;
  canToggleCollapsed?: boolean;
  shareUrl?: string;
  shareLabel?: string;
  shareCopied?: boolean;
  onCopyShareLink?: () => void;
  showCounterAction?: boolean;
  onToggleCollapsed?: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: () => void;
  onCancel: () => void;
};

type TradeCardAssetPanel = {
  asset: TradeAssetPayload;
  label: string;
  tone: 'send' | 'receive' | 'neutral';
  verifyUrl?: string;
  scopeLabel: string | null;
  custom: boolean;
};

const buildTokenExplorerUrl = (tokenAddress?: string): string | undefined =>
  tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/token/${tokenAddress}` : undefined;

const buildTransactionExplorerUrl = (txHash?: string): string | undefined =>
  txHash ? `${COTI_NETWORK.blockExplorerUrl}/tx/${txHash}` : undefined;

const resolveAssetScopeLabel = (kind: TradeAssetPayload['kind']): string | null => {
  if (kind === 'private-erc20') {
    return 'Private token';
  }
  if (kind === 'erc20') {
    return 'Public token';
  }
  return null;
};

const toStatusLabel = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

const resolveTradeStatus = (
  offer: TradeOfferMessagePayload,
  snapshot?: TradeSnapshot | null,
  latestResponse?: TradeResponseMessagePayload | null
): string => {
  if (snapshot?.status && snapshot.status !== 'unknown') {
    if (snapshot.status === 'expired') {
      return 'Expired';
    }
    if (snapshot.status !== 'open' || !latestResponse) {
      return toStatusLabel(snapshot.status);
    }
  }

  if (latestResponse) {
    return latestResponse.action === 'countered' ? 'Countered' : toStatusLabel(latestResponse.action);
  }

  if (offer.expiresAt > 0 && offer.expiresAt <= Math.floor(Date.now() / 1000)) {
    return 'Expired';
  }

  if (snapshot?.status === 'open') {
    return 'Open';
  }

  return 'Pending sync';
};

const resolveTradeActorLabel = (
  response: TradeResponseMessagePayload,
  offer: TradeOfferMessagePayload,
  currentWalletAddress?: string
): string => {
  const actorKey = response.actor.toLowerCase();
  const makerKey = offer.maker.toLowerCase();
  const takerKey = offer.taker.toLowerCase();
  const walletKey = currentWalletAddress?.trim().toLowerCase() ?? '';

  if (actorKey === makerKey) {
    return actorKey === walletKey ? 'maker (you)' : 'maker';
  }

  if (actorKey === takerKey) {
    return actorKey === walletKey ? 'taker (you)' : 'taker';
  }

  if (actorKey === walletKey) {
    return 'you';
  }

  return shortenAddress(response.actor);
};

const resolveTradeParticipantLabel = (
  role: 'maker' | 'taker',
  offer: TradeOfferMessagePayload,
  currentWalletAddress?: string
): string => {
  const walletKey = currentWalletAddress?.trim().toLowerCase() ?? '';
  const participant = role === 'maker' ? offer.maker.toLowerCase() : offer.taker.toLowerCase();

  return participant === walletKey ? `${role} (you)` : role;
};

const buildTradeEventLabel = (
  response: TradeResponseMessagePayload,
  offer: TradeOfferMessagePayload,
  currentWalletAddress?: string
): string => {
  const actorLabel = resolveTradeActorLabel(response, offer, currentWalletAddress);

  if (response.action === 'accepted') {
    return `Accepted by ${actorLabel}`;
  }

  if (response.action === 'declined') {
    return `Declined by ${actorLabel}`;
  }

  if (response.action === 'cancelled') {
    return `Cancelled by ${actorLabel}`;
  }

  return response.counterTradeId
    ? `Countered by ${actorLabel} -> trade #${response.counterTradeId}`
    : `Countered by ${actorLabel}`;
};

const buildTradeStatusDisplayLabel = (
  statusLabel: string,
  offer: TradeOfferMessagePayload,
  currentWalletAddress?: string,
  latestResponse?: TradeResponseMessagePayload | null
): string => {
  if (latestResponse) {
    return buildTradeEventLabel(latestResponse, offer, currentWalletAddress);
  }

  if (statusLabel === 'Accepted') {
    return `Accepted by ${resolveTradeParticipantLabel('taker', offer, currentWalletAddress)}`;
  }

  if (statusLabel === 'Declined') {
    return `Declined by ${resolveTradeParticipantLabel('taker', offer, currentWalletAddress)}`;
  }

  if (statusLabel === 'Cancelled') {
    return `Cancelled by ${resolveTradeParticipantLabel('maker', offer, currentWalletAddress)}`;
  }

  return statusLabel;
};

const buildTradeRateLabel = (sendAsset?: TradeAssetPayload, receiveAsset?: TradeAssetPayload): string | null => {
  if (!sendAsset || !receiveAsset) {
    return null;
  }

  try {
    const sendAmount = BigInt(sendAsset.amount);
    const receiveAmount = BigInt(receiveAsset.amount);

    if (sendAmount <= 0n || receiveAmount <= 0n) {
      return null;
    }

    const scaledReceiveAmount = (receiveAmount * 10n ** BigInt(sendAsset.decimals)) / sendAmount;
    return `Rate: 1 ${sendAsset.symbol} ~= ${formatTokenAmount(scaledReceiveAmount, receiveAsset.decimals, 6)} ${receiveAsset.symbol}`;
  } catch {
    return null;
  }
};

export default function TradeOfferCard({
  offer,
  snapshot,
  latestResponse,
  currentWalletAddress,
  actionPending,
  collapsed = false,
  canToggleCollapsed = false,
  shareUrl,
  shareLabel = 'Share Link',
  shareCopied = false,
  onCopyShareLink,
  showCounterAction = true,
  onToggleCollapsed,
  onAccept,
  onDecline,
  onCounter,
  onCancel
}: TradeOfferCardProps) {
  const walletKey = currentWalletAddress?.trim().toLowerCase() ?? '';
  const isMaker = walletKey.length > 0 && offer.maker.toLowerCase() === walletKey;
  const isTaker = walletKey.length > 0 && offer.taker.toLowerCase() === walletKey;
  const isOpenTakerTrade = isZeroTradeTakerAddress(offer.taker);
  const statusLabel = resolveTradeStatus(offer, snapshot, latestResponse);
  const statusClassName = statusLabel.toLowerCase().replace(/\s+/g, '-');
  const isOpen = statusLabel === 'Open' || statusLabel === 'Pending sync';
  const canAcceptOpenTakerTrade = isOpen && isOpenTakerTrade && !isMaker;
  const hasWalletForOpenAccept = walletKey.length > 0;
  const showExpiryAt = isOpen;
  const resolvedOffer = snapshot?.offer ?? offer.offer;
  const resolvedRequest = snapshot?.request ?? offer.request;
  const createdAt = snapshot?.createdAt ?? offer.createdAt;
  const expiresAt = snapshot?.expiresAt ?? offer.expiresAt;
  const statusDisplayLabel = buildTradeStatusDisplayLabel(statusLabel, offer, currentWalletAddress, latestResponse);
  const offerVerifyUrl = buildTokenExplorerUrl(resolvedOffer?.tokenAddress);
  const requestVerifyUrl = buildTokenExplorerUrl(resolvedRequest?.tokenAddress);
  const acceptedTransactionUrl = buildTransactionExplorerUrl(snapshot?.acceptedTxHash);
  const offerScopeLabel = resolvedOffer ? resolveAssetScopeLabel(resolvedOffer.kind) : null;
  const requestScopeLabel = resolvedRequest ? resolveAssetScopeLabel(resolvedRequest.kind) : null;
  const tradePerspective =
    resolvedOffer && resolvedRequest
      ? resolveTradePerspective(
          {
            maker: offer.maker,
            taker: offer.taker,
            offer: resolvedOffer,
            request: resolvedRequest,
            status: snapshot?.status
          },
          currentWalletAddress
        )
      : null;
  const assetPanels: TradeCardAssetPanel[] =
    resolvedOffer && resolvedRequest && tradePerspective
      ? (tradePerspective.showTakerPerspective
          ? [tradePerspective.requestSide, tradePerspective.offerSide]
          : [tradePerspective.offerSide, tradePerspective.requestSide]
        ).map((side) => ({
          asset: side.asset,
          label: side.label,
          tone: side.tone,
          verifyUrl: side.asset === resolvedOffer ? offerVerifyUrl : requestVerifyUrl,
          scopeLabel: side.asset === resolvedOffer ? offerScopeLabel : requestScopeLabel,
          custom: Boolean(side.asset.custom)
        }))
      : [];
  const tradeRateLabel =
    assetPanels.length >= 2 ? buildTradeRateLabel(assetPanels[0]?.asset, assetPanels[1]?.asset) : null;

  return (
    <div className={collapsed ? 'trade-card collapsed' : 'trade-card'}>
      <div className="trade-card-header">
        <div className="trade-card-title-wrap">
          <div className="trade-card-title-row">
            <div className="trade-card-title">
              <strong>Escrow Trade #{offer.tradeId}</strong>
              <span className={`trade-card-status ${statusClassName}`}>{statusDisplayLabel}</span>
            </div>
            {canToggleCollapsed ? (
              <button
                type="button"
                className="trade-card-toggle"
                onClick={onToggleCollapsed}
                aria-expanded={!collapsed}
              >
                {collapsed ? 'Show details' : 'Hide details'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="trade-card-header-tags">
          {isMaker ? <span className="trade-card-parent">Your offer</span> : null}
          {isTaker ? <span className="trade-card-parent incoming">Incoming offer</span> : null}
          {canAcceptOpenTakerTrade ? <span className="trade-card-parent incoming">Open offer</span> : null}
          {offer.parentTradeId ? <span className="trade-card-parent">Counter to #{offer.parentTradeId}</span> : null}
          {shareUrl ? (
            <button
              type="button"
              className={shareCopied ? 'trade-card-link-button copied' : 'trade-card-link-button'}
              onClick={onCopyShareLink}
            >
              {shareCopied ? 'Copied' : shareLabel}
            </button>
          ) : null}
          {acceptedTransactionUrl ? (
            <a className="trade-card-link-button" href={acceptedTransactionUrl} target="_blank" rel="noreferrer">
              Accepted Tx
            </a>
          ) : null}
        </div>
      </div>

      {collapsed ? (
        assetPanels.length > 0 ? (
          <div className="trade-card-summary">
            {assetPanels.map((panel) => (
              <div
                key={`summary-${panel.label}-${panel.asset.symbol}-${panel.asset.amount}`}
                className={`trade-card-summary-item trade-card-summary-item-${panel.tone}`}
              >
                <span className="trade-card-summary-label">{panel.label}</span>
                <strong>{formatTradeAssetDisplayText(panel.asset)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="trade-card-summary trade-card-summary-loading">
            <div className="trade-card-summary-item trade-card-summary-item-neutral">
              <span className="trade-card-summary-label">Escrow terms</span>
              <strong>Loading from contract...</strong>
            </div>
          </div>
        )
      ) : null}

      {!collapsed ? (
        <>
          {assetPanels.length > 0 ? (
            <div className="trade-card-grid">
              {assetPanels.map((panel) => (
                <div
                  key={`${panel.label}-${panel.asset.symbol}-${panel.asset.amount}`}
                  className={`trade-card-asset trade-card-asset-${panel.tone}`}
                >
                  <div className="trade-card-asset-head">
                    <span className="trade-card-label">{panel.label}</span>
                    {panel.verifyUrl ? (
                      <a href={panel.verifyUrl} target="_blank" rel="noreferrer">
                        Explorer
                      </a>
                    ) : null}
                  </div>
                  <strong>{formatTradeAssetDisplayText(panel.asset)}</strong>
                  <div className="trade-card-flags">
                    {panel.scopeLabel ? <span className="trade-card-flag">{panel.scopeLabel}</span> : null}
                    {panel.custom ? <span className="trade-card-flag">Custom token</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="trade-card-grid">
              <div className="trade-card-asset">
                <span className="trade-card-label">Escrow terms</span>
                <strong>Loading from contract...</strong>
              </div>
            </div>
          )}

          {tradeRateLabel ? <p className="trade-card-rate">{tradeRateLabel}</p> : null}
          <p className="trade-card-note">On-chain escrow. Verify token contracts before accepting.</p>

          {isOpen && (isTaker || canAcceptOpenTakerTrade) ? (
            <div className="trade-card-actions">
              <button
                type="button"
                className="trade-card-action trade-card-action-accept"
                onClick={onAccept}
                disabled={actionPending || (canAcceptOpenTakerTrade && !hasWalletForOpenAccept)}
              >
                {actionPending ? 'Processing...' : hasWalletForOpenAccept ? 'Accept' : 'Connect wallet to accept'}
              </button>
              {isTaker ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-refuse"
                  onClick={onDecline}
                  disabled={actionPending}
                >
                  Refuse
                </button>
              ) : null}
              {(isTaker || canAcceptOpenTakerTrade) && showCounterAction ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-counter"
                  onClick={onCounter}
                  disabled={actionPending}
                >
                  Counter
                </button>
              ) : null}
            </div>
          ) : null}

          {isOpen && isMaker ? (
            <div className="trade-card-actions">
              <button
                type="button"
                className="trade-card-action trade-card-action-refuse"
                onClick={onCancel}
                disabled={actionPending}
              >
                {actionPending ? 'Processing...' : 'Cancel Offer'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="trade-card-meta-inline">
        <span>Created {formatMessageTimestamp(createdAt)}</span>
        {showExpiryAt ? <span>Expires {expiresAt > 0 ? formatMessageTimestamp(expiresAt) : 'No expiration'}</span> : null}
        {!showExpiryAt && latestResponse ? <span>Updated {formatMessageTimestamp(latestResponse.createdAt)}</span> : null}
      </div>
    </div>
  );
}
