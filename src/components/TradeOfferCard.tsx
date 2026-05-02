import { useEffect, useState } from 'react';
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
import {
  formatTradeRatioLabel,
  isZeroTradeTakerAddress,
  resolveTradeOrderSummary,
  type TradeOrderSideRole
} from '../lib/tradePerspective';

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
  tradeWindowLayout?: boolean;
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
  role: TradeOrderSideRole;
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
  tradeWindowLayout = false,
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
  const [fillPayInput, setFillPayInput] = useState('');
  const [fillBuyInput, setFillBuyInput] = useState('');
  const [fillInputSide, setFillInputSide] = useState<'pay' | 'buy'>('pay');
  const [showReverseRate, setShowReverseRate] = useState(false);
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
            role: side.role,
            verifyUrl: isOfferSide ? offerVerifyUrl : requestVerifyUrl,
            scopeLabel: isOfferSide ? offerScopeLabel : requestScopeLabel,
            custom: Boolean(side.asset.custom),
            verified: isVerifiedAsset(side.asset)
          };
        })
      : [];
  const defaultRateLabel =
    assetPanels.length >= 2 ? formatTradeRatioLabel(assetPanels[0]?.asset, assetPanels[1]?.asset) : null;
  const reverseRateLabel =
    assetPanels.length >= 2 ? formatTradeRatioLabel(assetPanels[1]?.asset, assetPanels[0]?.asset) : null;
  const showRatioCard = Boolean((hiddenLiquidity || tradeWindowLayout) && defaultRateLabel);
  const visibleRatioLabel =
    showRatioCard && showReverseRate && reverseRateLabel ? reverseRateLabel : showRatioCard ? defaultRateLabel : null;
  const tradeRateLabel = !hiddenLiquidity && !tradeWindowLayout && defaultRateLabel ? `Price: ${defaultRateLabel}` : null;
  const visibleOrderValueLabel =
    tradeWindowLayout && !hiddenLiquidity && assetPanels.length >= 2
      ? `${assetPanels[0].displayText} for ${assetPanels[1].displayText}`
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
  const partialFillDisabled = actionPending || (canAcceptOpenTakerTrade && !hasWalletForOpenAccept);
  const showPrivateFillInline = Boolean(canShowPartialFill && hiddenLiquidity && baseOffer && baseRequest);
  const showVisibleFillInline = Boolean(canShowPartialFill && !hiddenLiquidity && tradeWindowLayout && baseOffer && baseRequest);
  const showInlineFill = showPrivateFillInline || showVisibleFillInline;
  const fillOfferUnitAmount = showPrivateFillInline && baseOffer ? parseFillAmount(baseOffer.amount) : remainingOfferAmount;
  const fillRequestUnitAmount = showPrivateFillInline && baseRequest ? parseFillAmount(baseRequest.amount) : remainingRequestAmount;
  const fillPayInputAmount = showInlineFill && baseRequest ? parseTokenAmountInput(fillPayInput, baseRequest.decimals) : null;
  const fillBuyInputAmount = showInlineFill && baseOffer ? parseTokenAmountInput(fillBuyInput, baseOffer.decimals) : null;
  const fillRequestAmount =
    showInlineFill && fillInputSide === 'buy' && fillBuyInputAmount !== null
      ? quoteRequestAmountForOffer(fillBuyInputAmount, fillOfferUnitAmount, fillRequestUnitAmount)
      : fillPayInputAmount;
  const fillReceiveAmount =
    showInlineFill && fillInputSide === 'buy' && fillBuyInputAmount !== null
      ? fillBuyInputAmount
      : showInlineFill && fillRequestAmount !== null && fillOfferUnitAmount > 0n && fillRequestUnitAmount > 0n
        ? (fillRequestAmount * fillOfferUnitAmount) / fillRequestUnitAmount
        : 0n;
  const visibleFillTooHigh =
    showVisibleFillInline && fillRequestAmount !== null && fillRequestAmount > remainingRequestAmount;
  const fillPayDisplayValue =
    fillInputSide === 'buy'
      ? baseRequest && fillRequestAmount !== null && fillRequestAmount > 0n
        ? formatExactTokenAmount(fillRequestAmount, baseRequest.decimals)
        : ''
      : fillPayInput;
  const fillBuyDisplayValue =
    fillInputSide === 'pay'
      ? baseOffer && fillReceiveAmount > 0n
        ? formatExactTokenAmount(fillReceiveAmount, baseOffer.decimals)
        : ''
      : fillBuyInput;
  const fillSubmitInput =
    baseRequest && fillRequestAmount !== null && fillRequestAmount > 0n
      ? formatExactTokenAmount(fillRequestAmount, baseRequest.decimals)
      : fillPayInput;
  const fillCanSubmit = fillRequestAmount !== null && fillRequestAmount > 0n && !visibleFillTooHigh;
  const defaultVisibleFillPayInput =
    showVisibleFillInline && baseRequest && remainingRequestAmount > 0n
      ? formatExactTokenAmount(remainingRequestAmount, baseRequest.decimals)
      : '';
  const ratioResetKey = `${offer.escrowContract}:${offer.tradeId}:${baseOffer?.symbol ?? ''}:${
    baseOffer?.amount ?? ''
  }:${baseRequest?.symbol ?? ''}:${baseRequest?.amount ?? ''}:${remainingOfferAmount.toString()}:${remainingRequestAmount.toString()}`;

  useEffect(() => {
    setShowReverseRate(false);
    setFillPayInput(defaultVisibleFillPayInput);
    setFillBuyInput('');
    setFillInputSide('pay');
  }, [defaultVisibleFillPayInput, ratioResetKey]);

  return (
    <div className={collapsed ? 'trade-card collapsed' : 'trade-card'}>
      <div className="trade-card-header">
        <div className="trade-card-title-wrap">
          <div className="trade-card-title-row">
            <div className="trade-card-title">
              <strong>{tradeOrderSummary?.directionLabel ?? `Escrow trade #${offer.tradeId}`}</strong>
              <span className="trade-card-id">Trade #{offer.tradeId}</span>
            </div>
            <div className="trade-card-header-actions">
              <span className={`trade-card-status ${statusClassName}`}>{statusDisplayLabel}</span>
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
        </div>
        <div className="trade-card-header-tags">
          {isMaker ? <span className="trade-card-parent">Your offer</span> : null}
          {isTaker ? <span className="trade-card-parent incoming">Incoming offer</span> : null}
          {canAcceptOpenTakerTrade ? <span className="trade-card-parent incoming">Open offer</span> : null}
          {hiddenLiquidity ? <span className="trade-card-parent">Private liquidity</span> : null}
          {counterParentTradeId ? <span className="trade-card-parent">Counter to #{counterParentTradeId}</span> : null}
          {snapshot?.replacesTradeId ? <span className="trade-card-parent">Edited from #{snapshot.replacesTradeId}</span> : null}
          {snapshot?.replacementTradeId ? <span className="trade-card-parent">Replaced by #{snapshot.replacementTradeId}</span> : null}
        </div>
      </div>

      {collapsed ? (
        visibleRatioLabel ? (
          <button
            type="button"
            className="trade-card-ratio-card"
            onClick={() => setShowReverseRate((value) => !value)}
            title="Flip price ratio"
            aria-label="Flip price ratio"
          >
            <span>Price ratio</span>
            <strong>{visibleRatioLabel}</strong>
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
          {visibleRatioLabel ? (
            <button
              type="button"
              className="trade-card-ratio-card"
              onClick={() => setShowReverseRate((value) => !value)}
              title="Flip price ratio"
              aria-label="Flip price ratio"
            >
              <span>Price ratio</span>
              <strong>{visibleRatioLabel}</strong>
            </button>
          ) : null}
          {visibleOrderValueLabel ? (
            <div className="trade-card-order-value">
              <span>Order value</span>
              <strong>{visibleOrderValueLabel}</strong>
            </div>
          ) : null}

          {assetPanels.length > 0 ? (
            <div className="trade-card-grid">
              {assetPanels.map((panel) => {
                const isInlineFillPayPanel = showInlineFill && panel.role === 'payment';
                const isInlineFillBuyPanel = showInlineFill && panel.role === 'offer';
                const isInlineFillPanel = isInlineFillPayPanel || isInlineFillBuyPanel;
                const showPanelMetaText = Boolean(panel.metaText && !isInlineFillPanel);

                return (
                  <div
                    key={`${panel.label}-${panel.asset.symbol}-${panel.asset.amount}`}
                    className={`trade-card-asset trade-card-asset-${panel.tone}${
                      isInlineFillPanel ? ' trade-card-asset-private-fill trade-card-asset-inline-fill' : ''
                    }`}
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
                          {panel.verified ? (
                            <span className="trade-card-contract-verified" aria-label="Verified contract">
                              &#10003;
                            </span>
                          ) : null}
                        </a>
                      ) : null}
                    </div>
                    <strong>{showVisibleFillInline ? panel.asset.symbol : panel.displayText}</strong>
                    {isInlineFillPayPanel && baseRequest ? (
                      <label className="trade-card-inline-private-input">
                        <span>Amount to pay</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={fillPayDisplayValue}
                          onFocus={() => {
                            if (fillInputSide !== 'pay') {
                              setFillPayInput(fillPayDisplayValue);
                              setFillInputSide('pay');
                            }
                          }}
                          onChange={(event) => {
                            setFillInputSide('pay');
                            setFillPayInput(sanitizeTokenAmountInput(event.target.value));
                          }}
                          placeholder={`0 ${baseRequest.symbol}`}
                          disabled={partialFillDisabled}
                          aria-label={`Amount to pay in ${baseRequest.symbol}`}
                        />
                      </label>
                    ) : null}
                    {isInlineFillBuyPanel && baseOffer ? (
                      <label className="trade-card-inline-private-input trade-card-inline-private-input-buy">
                        <span>Amount to buy</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={fillBuyDisplayValue}
                          onFocus={() => {
                            if (fillInputSide !== 'buy') {
                              setFillBuyInput(fillBuyDisplayValue);
                              setFillInputSide('buy');
                            }
                          }}
                          onChange={(event) => {
                            setFillInputSide('buy');
                            setFillBuyInput(sanitizeTokenAmountInput(event.target.value));
                          }}
                          placeholder={`0 ${baseOffer.symbol}`}
                          disabled={partialFillDisabled}
                          aria-label={`Amount to buy in ${baseOffer.symbol}`}
                        />
                      </label>
                    ) : null}
                    <div className="trade-card-flags">
                      {showPanelMetaText ? <span className="trade-card-flag">{panel.metaText}</span> : null}
                      {panel.scopeLabel ? <span className="trade-card-flag">{panel.scopeLabel}</span> : null}
                      {!panel.verified && panel.custom ? (
                        <span className="trade-card-flag">Custom token</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
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
                <span>Your private liquidity</span>
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
          {isOpen && (isTaker || canAcceptOpenTakerTrade) ? (
            <div className="trade-card-actions">
              {!hiddenLiquidity ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-accept"
                  onClick={showVisibleFillInline ? () => onPartialFill?.(fillSubmitInput) : onAccept}
                  disabled={
                    showVisibleFillInline
                      ? partialFillDisabled || !fillCanSubmit
                      : actionPending || (canAcceptOpenTakerTrade && !hasWalletForOpenAccept)
                  }
                >
                  {actionPending
                    ? 'Processing...'
                    : hasWalletForOpenAccept
                      ? 'Buy'
                    : 'Connect wallet to buy'}
                </button>
              ) : null}
              {(isTaker || canAcceptOpenTakerTrade) &&
              showCounterAction &&
              !(canShowPartialFill && hiddenLiquidity && baseOffer && baseRequest) ? (
                <button
                  type="button"
                  className="trade-card-action trade-card-action-counter"
                  onClick={onCounter}
                  disabled={actionPending}
                >
                  Counter
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
              {canShowPartialFill && hiddenLiquidity && baseOffer && baseRequest ? (
                <div className="trade-card-private-fill-actions">
                  <div className="trade-card-private-fill-action-row">
                    <button
                      type="button"
                      className="trade-card-action trade-card-action-accept trade-card-partial-fill-submit"
                      onClick={() => onPartialFill?.(fillSubmitInput)}
                      disabled={partialFillDisabled || !fillCanSubmit}
                    >
                      {actionPending ? 'Processing...' : hasWalletForOpenAccept ? 'Pay & fill' : 'Connect wallet to buy'}
                    </button>
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
                  <p className="trade-card-private-fill-note">
                    Private liquidity may fill partially. The contract settles what is available at this ratio and returns any unspent private payment.
                  </p>
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
          {!showPrivateFillInline ? (
            <p className="trade-card-note">
              {hiddenLiquidity
                ? 'Private settlement. Public users see only the price ratio; amounts and fills stay private.'
                : 'On-chain escrow. Verify token contracts before accepting.'}
            </p>
          ) : null}
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
