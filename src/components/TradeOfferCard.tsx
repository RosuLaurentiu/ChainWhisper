import { useState } from 'react';
import {
  COTI_NETWORK,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  formatExpiryCountdown,
  formatMessageTimestamp,
  formatTokenAmount,
  formatTradeAssetDisplayText,
  parseTokenAmountInput,
  sanitizeTokenAmountInput,
  shortenAddress,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeResponseMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';
import { isVerifiedEcosystemToken } from '../lib/appHelpers';
import { isZeroTradeTakerAddress, resolveTradeOrderSummary } from '../lib/tradePerspective';

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
  showEditAction?: boolean;
  onToggleCollapsed?: () => void;
  onAccept: () => void;
  onPartialFill?: (amountInput: string) => void;
  onDecline: () => void;
  onCounter: () => void;
  onCancel: () => void;
  onEdit?: () => void;
};

type TradeCardAssetPanel = {
  asset: TradeAssetPayload;
  label: string;
  displayText: string;
  metaText?: string;
  tone: 'send' | 'receive' | 'neutral';
  verifyUrl?: string;
  scopeLabel: string | null;
  custom: boolean;
  verified: boolean;
};

const buildTokenExplorerUrl = (tokenAddress?: string): string | undefined =>
  tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/token/${tokenAddress}` : undefined;

const isVerifiedAsset = (asset: TradeAssetPayload): boolean => {
  if (asset.kind === 'native') return true;
  const addr = asset.tokenAddress?.toLowerCase() ?? '';
  return (
    addr === REWARD_TOKEN_ADDRESS.toLowerCase() ||
    addr === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase() ||
    isVerifiedEcosystemToken(addr)
  );
};

const buildTransactionExplorerUrl = (txHash?: string): string | undefined =>
  txHash ? `${COTI_NETWORK.blockExplorerUrl}/tx/${txHash}` : undefined;

const buildAddressExplorerUrl = (address?: string): string | undefined =>
  address ? `${COTI_NETWORK.blockExplorerUrl}/address/${address}` : undefined;

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
    if (
      (snapshot.hiddenLiquidity || offer.hiddenLiquidity) &&
      snapshot.status === 'open' &&
      latestResponse?.action === 'accepted'
    ) {
      return 'Open';
    }
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

const parseFillAmount = (value?: string): bigint => {
  try {
    return BigInt(value ?? '0');
  } catch {
    return 0n;
  }
};

const withDisplayAmount = (asset: TradeAssetPayload | undefined, amount?: string): TradeAssetPayload | undefined =>
  asset && amount !== undefined ? { ...asset, amount } : asset;

const formatExactTokenAmount = (amount: bigint, decimals: number): string => {
  if (decimals <= 0) {
    return amount.toString();
  }

  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

const quoteRequestAmountForOffer = (
  offerAmountOut: bigint,
  offerUnitAmount: bigint,
  requestUnitAmount: bigint
): bigint => {
  if (offerAmountOut <= 0n || offerUnitAmount <= 0n || requestUnitAmount <= 0n) {
    return 0n;
  }

  return (offerAmountOut * requestUnitAmount + offerUnitAmount - 1n) / offerUnitAmount;
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
  showEditAction = false,
  onToggleCollapsed,
  onAccept,
  onPartialFill,
  onDecline,
  onCounter,
  onCancel,
  onEdit
}: TradeOfferCardProps) {
  const [partialFillPercent, setPartialFillPercent] = useState(50);
  const [privateFillReceiveInput, setPrivateFillReceiveInput] = useState('');
  const [showReverseHiddenRate, setShowReverseHiddenRate] = useState(false);
  const walletKey = currentWalletAddress?.trim().toLowerCase() ?? '';
  const isMaker = walletKey.length > 0 && offer.maker.toLowerCase() === walletKey;
  const isTaker = walletKey.length > 0 && offer.taker.toLowerCase() === walletKey;
  const isOpenTakerTrade = isZeroTradeTakerAddress(offer.taker);
  const hiddenLiquidity = Boolean(snapshot?.hiddenLiquidity || offer.hiddenLiquidity);
  const statusLabel = resolveTradeStatus(offer, snapshot, latestResponse);
  const statusClassName = statusLabel.toLowerCase().replace(/\s+/g, '-');
  const isOpen = statusLabel === 'Open' || statusLabel === 'Pending sync';
  const canAcceptOpenTakerTrade = isOpen && isOpenTakerTrade && !isMaker;
  const hasWalletForOpenAccept = walletKey.length > 0;
  const showExpiryAt = isOpen;
  const baseOffer = snapshot?.offer ?? offer.offer;
  const baseRequest = snapshot?.request ?? offer.request;
  const useRemainingTerms = Boolean(
    !hiddenLiquidity &&
      isOpen &&
      snapshot?.fillState &&
      parseFillAmount(snapshot.fillState.filledRequestAmount) > 0n &&
      parseFillAmount(snapshot.fillState.remainingRequestAmount) > 0n
  );
  const resolvedOffer = useRemainingTerms
    ? withDisplayAmount(baseOffer, snapshot?.fillState?.remainingOfferAmount)
    : baseOffer;
  const resolvedRequest = useRemainingTerms
    ? withDisplayAmount(baseRequest, snapshot?.fillState?.remainingRequestAmount)
    : baseRequest;
  const createdAt = snapshot?.createdAt ?? offer.createdAt;
  const expiresAt = snapshot?.expiresAt ?? offer.expiresAt;
  const expiryCountdown = showExpiryAt ? formatExpiryCountdown(expiresAt) : null;
  const statusDisplayLabel = buildTradeStatusDisplayLabel(statusLabel, offer, currentWalletAddress, latestResponse);
  const offerVerifyUrl = buildTokenExplorerUrl(resolvedOffer?.tokenAddress);
  const requestVerifyUrl = buildTokenExplorerUrl(resolvedRequest?.tokenAddress);
  const acceptedTransactionUrl = buildTransactionExplorerUrl(snapshot?.acceptedTxHash);
  const counterpartyAddress = isMaker ? offer.taker : offer.maker;
  const hasCounterpartyAddress = !isZeroTradeTakerAddress(counterpartyAddress);
  const counterpartyExplorerUrl = hasCounterpartyAddress ? buildAddressExplorerUrl(counterpartyAddress) : undefined;
  const offerScopeLabel = resolvedOffer ? resolveAssetScopeLabel(resolvedOffer.kind) : null;
  const requestScopeLabel = resolvedRequest ? resolveAssetScopeLabel(resolvedRequest.kind) : null;
  const tradeOrderSummary =
    resolvedOffer && resolvedRequest
      ? resolveTradeOrderSummary(
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
    resolvedOffer && resolvedRequest && tradeOrderSummary
      ? [tradeOrderSummary.primarySide, tradeOrderSummary.secondarySide].map((side) => {
          const isOfferSide = side.role === 'offer';
          return {
            asset: side.asset,
            label: side.label,
            displayText:
              hiddenLiquidity
                ? side.asset.symbol
                : formatTradeAssetDisplayText(side.asset),
            metaText: hiddenLiquidity ? 'Amount hidden' : undefined,
            tone: side.tone,
            verifyUrl: isOfferSide ? offerVerifyUrl : requestVerifyUrl,
            scopeLabel: isOfferSide ? offerScopeLabel : requestScopeLabel,
            custom: Boolean(side.asset.custom),
            verified: isVerifiedAsset(side.asset)
          };
        })
      : [];
  const hiddenForwardRateLabel = hiddenLiquidity ? tradeOrderSummary?.ratioLabel ?? null : null;
  const hiddenReverseRateLabel = hiddenLiquidity ? tradeOrderSummary?.reverseRatioLabel ?? null : null;
  const visibleHiddenRateLabel =
    showReverseHiddenRate && hiddenReverseRateLabel ? hiddenReverseRateLabel : hiddenForwardRateLabel;
  const tradeRateLabel =
    !hiddenLiquidity && tradeOrderSummary?.ratioLabel ? `Price: ${tradeOrderSummary.ratioLabel}` : null;
  const hiddenDirectionLabel =
    hiddenLiquidity && tradeOrderSummary
      ? tradeOrderSummary.directionLabel
      : '';
  const filledRequestAmount = hiddenLiquidity ? 0n : parseFillAmount(snapshot?.fillState?.filledRequestAmount);
  const remainingRequestAmount = hiddenLiquidity
    ? parseFillAmount(baseRequest?.amount)
    : parseFillAmount(snapshot?.fillState?.remainingRequestAmount ?? baseRequest?.amount);
  const remainingOfferAmount = hiddenLiquidity
    ? parseFillAmount(baseOffer?.amount)
    : parseFillAmount(snapshot?.fillState?.remainingOfferAmount ?? baseOffer?.amount);
  const totalRequestAmount =
    filledRequestAmount + remainingRequestAmount > 0n
      ? filledRequestAmount + remainingRequestAmount
      : parseFillAmount(baseRequest?.amount);
  const hasFillProgress = filledRequestAmount > 0n && totalRequestAmount > 0n;
  const fillProgressPercent =
    hasFillProgress && totalRequestAmount > 0n
      ? Math.max(1, Math.min(99, Number((filledRequestAmount * 10_000n) / totalRequestAmount) / 100))
      : 0;
  const fillProgressLabel =
    hasFillProgress && baseRequest
      ? `${formatTokenAmount(filledRequestAmount, baseRequest.decimals, 6)} / ${formatTokenAmount(
          totalRequestAmount,
          baseRequest.decimals,
          6
        )} ${baseRequest.symbol} filled`
      : '';
  const remainingRequestLabel =
    hasFillProgress && baseRequest
      ? `${formatTokenAmount(remainingRequestAmount, baseRequest.decimals, 6)} ${baseRequest.symbol} remaining`
      : '';
  const makerPrivateProgressSummary =
    hiddenLiquidity && isMaker && snapshot?.makerPrivateProgress && baseOffer
      ? (() => {
          try {
            const remainingOfferAmount = BigInt(snapshot.makerPrivateProgress?.remainingOfferAmount ?? '0');
            const initialOfferAmountRaw = snapshot.makerPrivateProgress?.initialOfferAmount;
            const initialOfferAmount =
              initialOfferAmountRaw && /^\d+$/.test(initialOfferAmountRaw) ? BigInt(initialOfferAmountRaw) : null;
            const filledOfferAmount =
              initialOfferAmount !== null && initialOfferAmount >= remainingOfferAmount
                ? initialOfferAmount - remainingOfferAmount
                : snapshot.makerPrivateProgress?.filledOfferAmount &&
                    /^\d+$/.test(snapshot.makerPrivateProgress.filledOfferAmount)
                  ? BigInt(snapshot.makerPrivateProgress.filledOfferAmount)
                  : null;
            const percent =
              initialOfferAmount !== null && initialOfferAmount > 0n && filledOfferAmount !== null
                ? Number((filledOfferAmount * 10_000n) / initialOfferAmount) / 100
                : 0;
            const safePercent = Math.max(0, Math.min(100, percent));

            return {
              percent: safePercent,
              percentLabel:
                initialOfferAmount !== null && filledOfferAmount !== null
                  ? `${safePercent.toFixed(safePercent % 1 === 0 ? 0 : 1)}% filled`
                  : 'Live remaining',
              filledLabel:
                filledOfferAmount !== null
                  ? `${formatTokenAmount(filledOfferAmount, baseOffer.decimals, 6)} ${baseOffer.symbol} filled`
                  : 'Filled amount unavailable',
              remainingLabel: `${formatTokenAmount(remainingOfferAmount, baseOffer.decimals, 6)} ${baseOffer.symbol} remaining`,
              totalLabel:
                initialOfferAmount !== null
                  ? `${formatTokenAmount(initialOfferAmount, baseOffer.decimals, 6)} ${baseOffer.symbol} total`
                  : `${formatTokenAmount(remainingOfferAmount, baseOffer.decimals, 6)} ${baseOffer.symbol} remaining`
            };
          } catch {
            return null;
          }
        })()
      : null;
  const counterParentTradeId = snapshot?.counterParentTradeId ?? offer.parentTradeId;
  const canShowPartialFill = Boolean(
    onPartialFill &&
      isOpen &&
      (isTaker || canAcceptOpenTakerTrade) &&
      baseOffer &&
      baseRequest &&
      remainingRequestAmount > 0n &&
      !snapshot?.counterParentTradeId
  );
  const partialFillRequestAmount =
    remainingRequestAmount <= 0n
      ? 0n
      : partialFillPercent >= 100
        ? remainingRequestAmount
        : (remainingRequestAmount * BigInt(partialFillPercent)) / 100n || 1n;
  const partialFillOfferAmount =
    remainingRequestAmount <= 0n || remainingOfferAmount <= 0n
      ? 0n
      : partialFillRequestAmount >= remainingRequestAmount
        ? remainingOfferAmount
        : (partialFillRequestAmount * remainingOfferAmount) / remainingRequestAmount;
  const partialFillRequestLabel =
    baseRequest && partialFillRequestAmount > 0n
      ? `${formatTokenAmount(partialFillRequestAmount, baseRequest.decimals, 6)} ${baseRequest.symbol}`
      : '--';
  const partialFillOfferLabel =
    baseOffer && partialFillOfferAmount > 0n
      ? `${formatTokenAmount(partialFillOfferAmount, baseOffer.decimals, 6)} ${baseOffer.symbol}`
      : '--';
  const partialFillAmountInput =
    baseRequest && partialFillRequestAmount > 0n ? formatExactTokenAmount(partialFillRequestAmount, baseRequest.decimals) : '';
  const partialFillDisabled = actionPending || (canAcceptOpenTakerTrade && !hasWalletForOpenAccept);
  const privateFillReceiveAmount =
    hiddenLiquidity && baseOffer ? parseTokenAmountInput(privateFillReceiveInput, baseOffer.decimals) : null;
  const privateFillRequestAmount =
    hiddenLiquidity && privateFillReceiveAmount !== null && baseOffer && baseRequest
      ? quoteRequestAmountForOffer(
          privateFillReceiveAmount,
          parseFillAmount(baseOffer.amount),
          parseFillAmount(baseRequest.amount)
        )
      : 0n;
  const privateFillRequestLabel =
    baseRequest && privateFillRequestAmount > 0n
      ? `${formatTokenAmount(privateFillRequestAmount, baseRequest.decimals, 6)} ${baseRequest.symbol}`
      : '--';
  const privateFillReceiveLabel =
    baseOffer && privateFillReceiveAmount !== null && privateFillReceiveAmount > 0n
      ? `${formatTokenAmount(privateFillReceiveAmount, baseOffer.decimals, 6)} ${baseOffer.symbol}`
      : '--';
  const privateFillCanSubmit =
    privateFillReceiveAmount !== null && privateFillReceiveAmount > 0n && privateFillRequestAmount > 0n;

  return (
    <div className={collapsed ? 'trade-card collapsed' : 'trade-card'}>
      <div className="trade-card-header">
        <div className="trade-card-title-wrap">
          <div className="trade-card-title-row">
            <div className="trade-card-title">
              <strong>{tradeOrderSummary?.directionLabel ?? `Escrow trade #${offer.tradeId}`}</strong>
              <span className="trade-card-id">Trade #{offer.tradeId}</span>
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
          {hiddenLiquidity ? <span className="trade-card-parent">Hidden liquidity</span> : null}
          {counterParentTradeId ? <span className="trade-card-parent">Counter to #{counterParentTradeId}</span> : null}
          {snapshot?.replacesTradeId ? <span className="trade-card-parent">Edited from #{snapshot.replacesTradeId}</span> : null}
          {snapshot?.replacementTradeId ? <span className="trade-card-parent">Replaced by #{snapshot.replacementTradeId}</span> : null}
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
        hiddenLiquidity && visibleHiddenRateLabel ? (
          <button
            type="button"
            className="trade-card-ratio-card"
            onClick={() => setShowReverseHiddenRate((value) => !value)}
            title="Flip price ratio"
            aria-label="Flip price ratio"
          >
            <span>Price ratio</span>
            <strong>{visibleHiddenRateLabel}</strong>
            {hiddenDirectionLabel ? <small>{hiddenDirectionLabel}. Liquidity and fill amounts stay private.</small> : null}
          </button>
        ) : assetPanels.length > 0 ? (
          <div className="trade-card-summary">
            {assetPanels.map((panel) => (
              <div
                key={`summary-${panel.label}-${panel.asset.symbol}-${panel.asset.amount}`}
                className={`trade-card-summary-item trade-card-summary-item-${panel.tone}`}
              >
                <span className="trade-card-summary-label">{panel.label}</span>
                <strong>{panel.displayText}</strong>
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
          {hiddenLiquidity && visibleHiddenRateLabel ? (
            <button
              type="button"
              className="trade-card-ratio-card"
              onClick={() => setShowReverseHiddenRate((value) => !value)}
              title="Flip price ratio"
              aria-label="Flip price ratio"
            >
              <span>Price ratio</span>
              <strong>{visibleHiddenRateLabel}</strong>
              {hiddenDirectionLabel ? <small>{hiddenDirectionLabel}. Liquidity and fill amounts stay private.</small> : null}
            </button>
          ) : null}

          {assetPanels.length > 0 ? (
            <div className="trade-card-grid">
              {assetPanels.map((panel) => (
                <div
                  key={`${panel.label}-${panel.asset.symbol}-${panel.asset.amount}`}
                  className={`trade-card-asset trade-card-asset-${panel.tone}`}
                >
                  <div className="trade-card-asset-head">
                    <span className="trade-card-label">{panel.label}</span>
                    {panel.asset.tokenAddress ? (
                      <a
                        className="trade-card-contract-link"
                        href={panel.verifyUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={panel.asset.tokenAddress}
                      >
                        {shortenAddress(panel.asset.tokenAddress)}
                        {panel.verified ? <span className="trade-card-contract-verified">✓</span> : null}
                      </a>
                    ) : null}
                  </div>
                  <strong>{panel.displayText}</strong>
                  <div className="trade-card-flags">
                    {panel.metaText ? <span className="trade-card-flag">{panel.metaText}</span> : null}
                    {panel.scopeLabel ? <span className="trade-card-flag">{panel.scopeLabel}</span> : null}
                    {panel.verified ? (
                      <span className="trade-card-flag trade-card-flag-verified">✓ Verified</span>
                    ) : panel.custom ? (
                      <span className="trade-card-flag">Custom token</span>
                    ) : null}
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

          {tradeRateLabel && !hiddenLiquidity ? <p className="trade-card-rate">{tradeRateLabel}</p> : null}
          {makerPrivateProgressSummary ? (
            <div className="trade-card-fill-progress" aria-label={makerPrivateProgressSummary.percentLabel}>
              <div>
                <span>Your liquidity</span>
                <strong>{makerPrivateProgressSummary.totalLabel}</strong>
              </div>
              <div className="trade-card-fill-bar">
                <span style={{ width: `${makerPrivateProgressSummary.percent}%` }} />
              </div>
              <small>
                {makerPrivateProgressSummary.filledLabel} / {makerPrivateProgressSummary.remainingLabel}
              </small>
            </div>
          ) : hasFillProgress ? (
            <div className="trade-card-fill-progress" aria-label={fillProgressLabel}>
              <div>
                <span>Fill progress</span>
                <strong>{remainingRequestLabel}</strong>
              </div>
              <div className="trade-card-fill-bar">
                <span style={{ width: `${fillProgressPercent}%` }} />
              </div>
              <small>{fillProgressLabel}</small>
            </div>
          ) : null}
          <p className="trade-card-note">
            {hiddenLiquidity
              ? 'Private settlement. Liquidity amount is hidden; only the fixed price is public.'
              : 'On-chain escrow. Verify token contracts before accepting.'}
          </p>
          <div className="trade-card-counterparty">
            <span>Counterparty</span>
            {counterpartyExplorerUrl ? (
              <a href={counterpartyExplorerUrl} target="_blank" rel="noreferrer" title={counterpartyAddress}>
                {shortenAddress(counterpartyAddress)}
              </a>
            ) : (
              <strong>Any wallet</strong>
            )}
          </div>

          {isOpen && (isTaker || canAcceptOpenTakerTrade) ? (
            <div className="trade-card-actions">
              {!hiddenLiquidity ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-accept"
                  onClick={onAccept}
                  disabled={actionPending || (canAcceptOpenTakerTrade && !hasWalletForOpenAccept)}
                >
                  {actionPending
                    ? 'Processing...'
                    : hasWalletForOpenAccept
                      ? hasFillProgress
                        ? 'Buy Rest'
                        : 'Buy'
                      : 'Connect wallet to buy'}
                </button>
              ) : null}
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
              {canShowPartialFill && hiddenLiquidity && baseOffer && baseRequest ? (
                <div className="trade-card-partial-fill trade-card-private-fill">
                  <div className="trade-card-partial-fill-head">
                    <span>Buy amount</span>
                    <strong>{baseOffer.symbol}</strong>
                  </div>
                  <label className="trade-card-private-fill-input">
                    <span>You buy</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={privateFillReceiveInput}
                      onChange={(event) => setPrivateFillReceiveInput(sanitizeTokenAmountInput(event.target.value))}
                      placeholder={`0 ${baseOffer.symbol}`}
                      disabled={partialFillDisabled}
                    />
                  </label>
                  <div className="trade-card-partial-fill-terms">
                    <div className="trade-card-partial-fill-term trade-card-partial-fill-send">
                      <span>Max pay</span>
                      <strong>{privateFillRequestLabel}</strong>
                    </div>
                    <div className="trade-card-partial-fill-link" aria-hidden="true">
                      for
                    </div>
                    <div className="trade-card-partial-fill-term trade-card-partial-fill-receive">
                      <span>Receive</span>
                      <strong>{privateFillReceiveLabel}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-accept trade-card-partial-fill-submit"
                    onClick={() => onPartialFill?.(privateFillReceiveInput)}
                    disabled={partialFillDisabled || !privateFillCanSubmit}
                  >
                    {actionPending ? 'Processing...' : hasWalletForOpenAccept ? 'Buy' : 'Connect wallet to buy'}
                  </button>
                </div>
              ) : canShowPartialFill ? (
                <div className="trade-card-partial-fill">
                  <div className="trade-card-partial-fill-head">
                    <span>Partial fill</span>
                    <strong>{partialFillPercent}%</strong>
                  </div>
                  <div className="trade-card-partial-fill-terms">
                    <div className="trade-card-partial-fill-term trade-card-partial-fill-send">
                      <span>You send</span>
                      <strong>{partialFillRequestLabel}</strong>
                    </div>
                    <div className="trade-card-partial-fill-link" aria-hidden="true">
                      for
                    </div>
                    <div className="trade-card-partial-fill-term trade-card-partial-fill-receive">
                      <span>You receive</span>
                      <strong>{partialFillOfferLabel}</strong>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={partialFillPercent}
                    onChange={(event) => setPartialFillPercent(Number.parseInt(event.target.value, 10))}
                    disabled={partialFillDisabled}
                    aria-label="Partial fill percentage"
                  />
                  <button
                    type="button"
                    className="trade-card-action trade-card-action-counter trade-card-partial-fill-submit"
                    onClick={() => onPartialFill?.(partialFillAmountInput)}
                    disabled={partialFillDisabled || !partialFillAmountInput}
                  >
                    Fill Selected
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {isOpen && isMaker ? (
            <div className="trade-card-actions">
              {showEditAction && onEdit ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-counter"
                  onClick={onEdit}
                  disabled={actionPending}
                >
                  Edit Public Trade
                </button>
              ) : null}
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
        {expiryCountdown ? (
          <span
            className={`trade-card-expiry-${expiryCountdown.urgency}`}
            title={`Created: ${formatMessageTimestamp(createdAt)}`}
          >
            {expiryCountdown.label}
          </span>
        ) : null}
        {!showExpiryAt && latestResponse ? <span>Updated {formatMessageTimestamp(latestResponse.createdAt)}</span> : null}
      </div>
    </div>
  );
}
