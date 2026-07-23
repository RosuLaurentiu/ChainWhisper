import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import type { ReactNode } from 'react';
import {
  formatTokenAmount,
  formatTradeAssetDisplayText,
  parseTokenAmountInput,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import type { CarbonPairReferenceDisplay } from '../../../lib/carbonMarketPrice';
import type { AppHelpResponseSource } from '../../../lib/appHelp';
import type { AppHelpLaunchContext, AppHelpReason } from '../../../lib/appHelpLaunch';
import type { LinkedTradeContext } from '../../../lib/linkedTradeContext';
import type { P2PSyncRequest } from '../../../lib/p2pSyncCoordinator';
import {
  getRecurringTerminalSideState,
  getRemainingOfferAmount,
  getRemainingRequestAmount,
  type RecurringTerminalActionSide
} from '../../../lib/p2pTradeView';
import type { TradeAgentResponseAction } from '../../../lib/tradeAgent';
import type { TradeTransactionHistoryRow } from '../../../lib/tradeHistory';
import type { RecurringPriceDeskDisplay } from '../../../lib/tradePerspective';
import type { TradePricingField } from '../../../lib/tradePricing';
import type { SharedWalletSession } from '../../../lib/walletSession';
export { bytesEqual, mergeOnboardInfoByAddress, onboardInfoEqual } from '../../../lib/appShared';
export const formatCompactTradeTimestamp = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '';
  }
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export type TradeVisibility = 'public' | 'unlisted' | 'direct';
export type MyTradeGroupView = 'received' | 'active' | 'history';
export type PendingBurnerWalletAction = 'connect' | 'generate' | 'import';
export type P2PEmptyStateTone = 'default' | 'error' | 'loading' | 'locked';
export type TradeCreateMode = 'one-off' | 'recurring';
export type TerminalFillInputSide = 'pay' | 'buy';
export type MakerControlsSurface = 'desk' | 'terminal';
export type TradeFilterRouteScope = 'desk' | 'mine' | null;
export type TradeOpenActionCta = { kind: 'direction' | 'cycle' | 'manage' | 'view'; label: string };
export type TradeOverviewCardOptions = {
  canOpenTerminal?: boolean;
  groupId?: MyTradeGroupView;
  onOpenTerminal?: (snapshot: TradeSnapshot) => void;
  selected?: boolean;
};
export type TradeProgressSummary = {
  percent: number;
  percentLabel: string;
  headerValueLabel?: string;
  filledLabel: string;
  remainingLabel: string;
  totalLabel: string;
  totalAmountLabel?: string;
  filledAmountLabel?: string;
  remainingAmountLabel?: string;
  paymentAmountLabel?: string;
  paymentTotalLabel?: string;
  paymentHeaderValueLabel?: string;
  paymentFilledAmountLabel?: string;
  paymentRemainingAmountLabel?: string;
  hasFills?: boolean;
};

export type TradeTermSideForHistory = {
  asset: TradeAssetPayload;
  tone: 'send' | 'receive' | 'neutral';
};

export const getTradeAssetIdentity = (asset: TradeAssetPayload): string =>
  `${asset.kind}:${asset.tokenAddress?.trim().toLowerCase() ?? ''}:${asset.symbol.trim().toLowerCase()}`;

export const resolveRevealedHistoryAssetForSide = (
  row: TradeTransactionHistoryRow | undefined,
  side: TradeTermSideForHistory
): (TradeAssetPayload & { visible: boolean }) | null => {
  if (!row || row.amountVisibility === 'private-hidden') {
    return null;
  }

  const sideIdentity = getTradeAssetIdentity(side.asset);
  const preferredAsset = side.tone === 'receive' ? row.bought : side.tone === 'send' ? row.sold : null;
  if (preferredAsset?.visible && getTradeAssetIdentity(preferredAsset) === sideIdentity) {
    return preferredAsset;
  }

  const matchingFlow = row.tokenFlows.find(
    (flow) => flow.asset.visible && getTradeAssetIdentity(flow.asset) === sideIdentity
  );
  return matchingFlow?.asset ?? null;
};

export const getRevealedHistoryProgressSummary = (
  row: TradeTransactionHistoryRow | undefined,
  primarySide: TradeTermSideForHistory,
  secondarySide: TradeTermSideForHistory
): TradeProgressSummary | null => {
  const primaryAsset = resolveRevealedHistoryAssetForSide(row, primarySide);
  const secondaryAsset = resolveRevealedHistoryAssetForSide(row, secondarySide);
  if (!primaryAsset || !secondaryAsset) {
    return null;
  }

  const primaryAmountLabel = formatTradeAssetDisplayText(primaryAsset);
  const secondaryAmountLabel = formatTradeAssetDisplayText(secondaryAsset);
  return {
    percent: 100,
    percentLabel: 'Trade values revealed',
    headerValueLabel: primaryAmountLabel,
    filledLabel: `${primaryAmountLabel} filled`,
    remainingLabel: primaryAmountLabel,
    totalLabel: primaryAmountLabel,
    totalAmountLabel: primaryAmountLabel,
    filledAmountLabel: primaryAmountLabel,
    remainingAmountLabel: primaryAmountLabel,
    paymentAmountLabel: secondaryAmountLabel,
    paymentTotalLabel: secondaryAmountLabel,
    paymentHeaderValueLabel: secondaryAmountLabel,
    paymentFilledAmountLabel: secondaryAmountLabel,
    paymentRemainingAmountLabel: secondaryAmountLabel,
    hasFills: true
  };
};

export const getKnownTermProgressSummary = (
  primaryAsset: TradeAssetPayload,
  secondaryAsset: TradeAssetPayload,
  status: TradeSnapshot['status']
): TradeProgressSummary | null => {
  const primaryAmount = parseTokenAmountString(primaryAsset.amount);
  const secondaryAmount = parseTokenAmountString(secondaryAsset.amount);
  if (primaryAmount <= 0n || secondaryAmount <= 0n) {
    return null;
  }

  const isAccepted = status === 'accepted';
  const isClosedWithoutFill = status !== 'open' && !isAccepted;
  const filledPrimaryAmount = isAccepted ? primaryAmount : 0n;
  const filledSecondaryAmount = isAccepted ? secondaryAmount : 0n;
  const remainingPrimaryAmount = isAccepted || isClosedWithoutFill ? 0n : primaryAmount;
  const remainingSecondaryAmount = isAccepted || isClosedWithoutFill ? 0n : secondaryAmount;
  const totalPrimaryLabel = `${formatTokenAmount(primaryAmount, primaryAsset.decimals, 6)} ${primaryAsset.symbol}`;
  const totalSecondaryLabel = `${formatTokenAmount(secondaryAmount, secondaryAsset.decimals, 6)} ${secondaryAsset.symbol}`;
  const filledPrimaryLabel = `${formatTokenAmount(filledPrimaryAmount, primaryAsset.decimals, 6)} ${primaryAsset.symbol}`;
  const filledSecondaryLabel = `${formatTokenAmount(filledSecondaryAmount, secondaryAsset.decimals, 6)} ${secondaryAsset.symbol}`;
  const remainingPrimaryLabel = `${formatTokenAmount(remainingPrimaryAmount, primaryAsset.decimals, 6)} ${primaryAsset.symbol}`;
  const remainingSecondaryLabel = `${formatTokenAmount(remainingSecondaryAmount, secondaryAsset.decimals, 6)} ${secondaryAsset.symbol}`;
  const percent = isAccepted ? 100 : 0;

  return {
    percent,
    percentLabel: isAccepted ? '100% filled' : '0% filled',
    totalLabel: `${totalPrimaryLabel} total`,
    totalAmountLabel: totalPrimaryLabel,
    filledAmountLabel: filledPrimaryLabel,
    remainingAmountLabel: remainingPrimaryLabel,
    filledLabel: `${filledPrimaryLabel} filled`,
    remainingLabel: `${remainingPrimaryLabel} remaining`,
    paymentAmountLabel: totalSecondaryLabel,
    paymentTotalLabel: `${totalSecondaryLabel} order value`,
    paymentFilledAmountLabel: filledSecondaryLabel,
    paymentRemainingAmountLabel: remainingSecondaryLabel,
    hasFills: isAccepted
  };
};

export const withProgressPaymentFallback = (
  summary: TradeProgressSummary | null,
  fallback: TradeProgressSummary | null
): TradeProgressSummary | null => {
  if (!summary || summary.paymentAmountLabel || !fallback?.paymentAmountLabel) {
    return summary;
  }

  return {
    ...summary,
    paymentAmountLabel: fallback.paymentAmountLabel,
    paymentTotalLabel: fallback.paymentTotalLabel,
    paymentHeaderValueLabel: fallback.paymentHeaderValueLabel,
    paymentFilledAmountLabel: fallback.paymentFilledAmountLabel,
    paymentRemainingAmountLabel: fallback.paymentRemainingAmountLabel
  };
};

export const getTradeSideProgressVerb = (side: { label: string; tone: TradeTermSideForHistory['tone'] }): 'bought' | 'sold' => {
  if (/^You sell\b/i.test(side.label)) {
    return 'sold';
  }
  if (/^You buy\b/i.test(side.label)) {
    return 'bought';
  }
  return side.tone === 'send' ? 'sold' : 'bought';
};

export type TerminalHistoryPanelConfig = {
  tradeKey: string;
  title: string;
  count: number;
  emptyCopy: string;
  children?: ReactNode;
};

export const buildMakerControlsKey = (surface: MakerControlsSurface, tradeKey: string): string => `${surface}:${tradeKey}`;

export const getRecurringFillSideForDisplayAction = (
  action: RecurringTerminalActionSide,
  pairReversed: boolean
): RecurringTerminalActionSide =>
  action === 'sell'
    ? pairReversed
      ? 'sell'
      : 'buy'
    : pairReversed
      ? 'buy'
      : 'sell';

export const OPEN_TERMINAL_LABEL = 'Open order';
export const SHARE_LABEL = 'Share';
export const UNLISTED_ORDER_LABEL = 'Unlisted';
export const PRIVATE_LIQUIDITY_LABEL = 'Private liquidity';
export const PUBLIC_LIQUIDITY_LABEL = 'Public liquidity';
export const HYBRID_LIQUIDITY_LABEL = 'Hybrid liquidity';
export const VISIBLE_LIQUIDITY_LABEL = PUBLIC_LIQUIDITY_LABEL;
export const MY_TRADES_EMPTY_PREVIEW_GROUPS = [
  {
    label: 'Received',
    description: 'Direct offers and counters sent to this wallet.'
  },
  {
    label: 'Active',
    description: 'Offers you created and reusable liquidity you manage.'
  },
  {
    label: 'History',
    description: 'Settled, cancelled, declined, and expired trades.'
  }
] as const;

export const getTradeLiquidityLabel = (offer: TradeAssetPayload, request: TradeAssetPayload): string => {
  const privateSideCount = [offer, request].filter((asset) => asset.kind === 'private-erc20').length;
  if (privateSideCount === 2) {
    return PRIVATE_LIQUIDITY_LABEL;
  }
  if (privateSideCount === 1) {
    return HYBRID_LIQUIDITY_LABEL;
  }
  return PUBLIC_LIQUIDITY_LABEL;
};

export const getRecurringLiquidityLabel = (mode: string): string => {
  if (mode === 'fully-private') {
    return PRIVATE_LIQUIDITY_LABEL;
  }
  if (mode === 'hybrid-private') {
    return HYBRID_LIQUIDITY_LABEL;
  }
  return PUBLIC_LIQUIDITY_LABEL;
};

export const formatOrderProgressFractionLabel = (filledLabel?: string, totalLabel?: string, verb?: string): string => {
  if (!filledLabel || !totalLabel || !verb) {
    return '';
  }
  const filledParts = filledLabel.trim().split(/\s+/);
  const totalParts = totalLabel.trim().split(/\s+/);
  const filledSymbol = filledParts[filledParts.length - 1];
  const totalSymbol = totalParts[totalParts.length - 1];
  if (filledParts.length > 1 && totalParts.length > 1 && filledSymbol && filledSymbol === totalSymbol) {
    return `${filledParts.slice(0, -1).join(' ')}/${totalParts.slice(0, -1).join(' ')} ${totalSymbol} ${verb}`;
  }
  return `${filledLabel} / ${totalLabel} ${verb}`;
};

export type CounterRelationTone = 'counter' | 'parent';

export const getTradeCounterRelation = (
  trade: TradeSnapshot
): { tone: CounterRelationTone; chipLabel: string; title: string; detail: string } | null => {
  const parentId =
    trade.parentTradeId ||
    (trade.counterParentTradeId && trade.counterParentTradeId < trade.tradeId ? trade.counterParentTradeId : undefined);
  const linkedCounterId =
    trade.counterParentTradeId && trade.counterParentTradeId > trade.tradeId ? trade.counterParentTradeId : undefined;

  if (parentId) {
    return {
      tone: 'counter',
      chipLabel: `Counter to #${parentId}`,
      title: `Counter to offer #${parentId}`,
      detail: 'A direct reply to the parent offer; accepting it can close the parent and sibling counters.'
    };
  }

  if (linkedCounterId) {
    const actionLabel = trade.status === 'accepted' ? 'accepted counter' : 'linked counter';
    return {
      tone: 'parent',
      chipLabel: `Counter #${linkedCounterId}`,
      title: `Parent offer with ${actionLabel} #${linkedCounterId}`,
      detail:
        trade.status === 'accepted'
          ? 'This parent was settled through the linked counter offer.'
          : 'This offer has a linked counter reply for review.'
    };
  }

  return null;
};

export type P2PTradingPageProps = {
  isMobileNav?: boolean;
  sharedWalletSession?: SharedWalletSession;
  appHelpLaunchContext?: AppHelpLaunchContext | null;
  onAppHelpLaunchConsumed?: () => void;
  onOpenAppHelp?: (reason: AppHelpReason) => void;
  onOpenInternalAppLink?: (href: string) => void;
  onOpenTradeConversation?: (counterpartyAddress: string, context: LinkedTradeContext) => void;
};

export const P2P_VISIBLE_SYNC_INTERVAL_MS = 20_000;
export const EMPTY_STALE_TOKEN_ADDRESSES: string[] = [];
export type TradeAgentChatRole = 'assistant' | 'user' | 'status';
export type TradeAgentChatMessage = {
  id: string;
  role: TradeAgentChatRole;
  title: string;
  text: string;
  helpTopicId?: string;
  helpSource?: AppHelpResponseSource;
  relatedHelpTopicIds?: string[];
  warnings?: string[];
  actions?: TradeAgentResponseAction[];
};
export type TerminalReturnSurface = 'swap' | 'agent' | 'public' | 'mine';
export type TradeSigner = JsonRpcSigner | Wallet;
export type QueuedTradeDataRefresh = P2PSyncRequest<TradeSigner>;
export type RecurringFundingBalanceResult = {
  balanceWei: bigint | null;
  unavailableMessage?: string;
};

export const decimalScale = (decimals: number): bigint => 10n ** BigInt(Math.max(0, Math.floor(decimals)));

export const formatDecimalInput = (wholeUnits: bigint, decimals: number): string => {
  if (wholeUnits <= 0n) {
    return '';
  }
  const scale = decimalScale(decimals);
  const whole = wholeUnits / scale;
  const fraction = wholeUnits % scale;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fractionText}`;
};

export const parseTokenAmountString = (value?: string): bigint => {
  const normalizedValue = value?.trim() ?? '';
  if (!/^\d+$/.test(normalizedValue)) {
    return 0n;
  }
  try {
    return BigInt(normalizedValue);
  } catch {
    return 0n;
  }
};

export const formatExactTokenAmountInput = (amount: bigint, decimals: number): string => {
  if (amount <= 0n) {
    return '';
  }
  if (decimals <= 0) {
    return amount.toString();
  }

  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

export const formatCompactTokenAmountInput = (amount: bigint, decimals: number, precision = 6): string => {
  if (amount <= 0n) {
    return '';
  }
  return formatTokenAmount(amount, decimals, precision);
};

export const quoteRequestAmountForOfferAmount = (
  offerAmountOut: bigint,
  offerUnitAmount: bigint,
  requestUnitAmount: bigint
): bigint => {
  if (offerAmountOut <= 0n || offerUnitAmount <= 0n || requestUnitAmount <= 0n) {
    return 0n;
  }

  return (offerAmountOut * requestUnitAmount + offerUnitAmount - 1n) / offerUnitAmount;
};

export const resolveVisibleHiddenTermAmounts = ({
  initialOfferAmount,
  remainingOfferAmount,
  offerUnitAmount,
  requestUnitAmount
}: {
  initialOfferAmount: bigint;
  remainingOfferAmount: bigint;
  offerUnitAmount: bigint;
  requestUnitAmount: bigint;
}): { offerAmount: bigint; requestAmount: bigint } | null => {
  const offerAmount = initialOfferAmount > 0n ? initialOfferAmount : remainingOfferAmount;
  const requestAmount = quoteRequestAmountForOfferAmount(offerAmount, offerUnitAmount, requestUnitAmount);
  return offerAmount > 0n && requestAmount > 0n ? { offerAmount, requestAmount } : null;
};

export const getVisibleOfferLiquiditySummary = (trade: TradeSnapshot): TradeProgressSummary | null => {
  try {
    const filledOfferAmount = BigInt(trade.fillState?.filledOfferAmount ?? '0');
    const remainingOfferAmount = getRemainingOfferAmount(trade);
    const filledRequestAmount = BigInt(trade.fillState?.filledRequestAmount ?? '0');
    const remainingRequestAmount = getRemainingRequestAmount(trade);
    const returnedCancelledLiquidity =
      trade.status === 'cancelled' && !trade.acceptedTxHash && remainingOfferAmount === 0n && filledOfferAmount > 0n;
    const totalOfferAmount = filledOfferAmount + remainingOfferAmount;
    if (totalOfferAmount <= 0n) {
      return null;
    }

    const displayFilledOfferAmount = returnedCancelledLiquidity ? 0n : filledOfferAmount;
    const displayRemainingOfferAmount = returnedCancelledLiquidity ? 0n : remainingOfferAmount;
    const displayFilledRequestAmount = returnedCancelledLiquidity ? 0n : filledRequestAmount;
    const displayRemainingRequestAmount = returnedCancelledLiquidity ? 0n : remainingRequestAmount;
    const rawPercent = Number((displayFilledOfferAmount * 10_000n) / totalOfferAmount) / 100;
    const percent =
      displayFilledOfferAmount <= 0n
        ? 0
        : displayRemainingOfferAmount <= 0n
          ? 100
          : Math.max(1, Math.min(99, rawPercent));
    const percentLabel = `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}% filled`;
    const unitOfferAmount = parseTokenAmountString(trade.offer.amount);
    const unitRequestAmount = parseTokenAmountString(trade.request.amount);
    const totalRequestAmount =
      filledRequestAmount + remainingRequestAmount > 0n
        ? filledRequestAmount + remainingRequestAmount
        : quoteRequestAmountForOfferAmount(totalOfferAmount, unitOfferAmount, unitRequestAmount);
    const totalOfferAmountLabel = `${formatTokenAmount(totalOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`;
    const filledOfferAmountLabel = `${formatTokenAmount(displayFilledOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`;
    const remainingOfferAmountLabel = `${formatTokenAmount(displayRemainingOfferAmount, trade.offer.decimals, 6)} ${trade.offer.symbol}`;
    const paymentAmountLabel = `${formatTokenAmount(totalRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol}`;
    const paymentFilledAmountLabel = `${formatTokenAmount(displayFilledRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol}`;
    const paymentRemainingAmountLabel = `${formatTokenAmount(displayRemainingRequestAmount, trade.request.decimals, 6)} ${trade.request.symbol}`;

    return {
      percent,
      percentLabel,
      totalLabel: `${totalOfferAmountLabel} total`,
      totalAmountLabel: totalOfferAmountLabel,
      paymentAmountLabel,
      paymentTotalLabel: `${paymentAmountLabel} order value`,
      paymentFilledAmountLabel,
      paymentRemainingAmountLabel,
      filledAmountLabel: filledOfferAmountLabel,
      remainingAmountLabel: remainingOfferAmountLabel,
      filledLabel: `${filledOfferAmountLabel} filled`,
      remainingLabel: `${remainingOfferAmountLabel} remaining`,
      hasFills: displayFilledOfferAmount > 0n
    };
  } catch {
    return null;
  }
};

export const formatPriceInputFromTerms = (
  baseAmountRaw: string,
  quoteAmountRaw: string,
  baseDecimals: number,
  quoteDecimals: number
): string => {
  const baseAmount = BigInt(baseAmountRaw || '0');
  const quoteAmount = BigInt(quoteAmountRaw || '0');
  if (baseAmount <= 0n || quoteAmount <= 0n) {
    return '';
  }
  const priceScale = decimalScale(RECURRING_PRICE_DECIMALS);
  const scaledPrice =
    (quoteAmount * decimalScale(baseDecimals) * priceScale) / (baseAmount * decimalScale(quoteDecimals));
  return formatDecimalInput(scaledPrice, RECURRING_PRICE_DECIMALS);
};

export const pricingFieldsEqual = (left: TradePricingField[], right: TradePricingField[]): boolean =>
  left.length === right.length && left.every((field, index) => field === right[index]);

export const RECURRING_PRICE_DECIMALS = 18;
export const RECURRING_PRICE_SCALE = 10n ** BigInt(RECURRING_PRICE_DECIMALS);

export const tokenUnitWei = (decimals: number): bigint => {
  const safeDecimals = Number.isFinite(decimals) ? Math.max(0, Math.min(36, Math.trunc(decimals))) : 18;
  return 10n ** BigInt(safeDecimals);
};

export const resolveRecurringSideTerms = ({
  baseAmountWei,
  quoteAmountWei,
  priceInput,
  baseDecimals,
  quoteDecimals,
  forcePriceOnly = false
}: {
  baseAmountWei: bigint | null;
  quoteAmountWei: bigint | null;
  priceInput: string;
  baseDecimals: number;
  quoteDecimals: number;
  forcePriceOnly?: boolean;
}): { baseAmountWei: bigint; quoteAmountWei: bigint } | null => {
  if (!forcePriceOnly && baseAmountWei && quoteAmountWei && baseAmountWei > 0n && quoteAmountWei > 0n) {
    return { baseAmountWei, quoteAmountWei };
  }

  const priceScaled = parseTokenAmountInput(priceInput, RECURRING_PRICE_DECIMALS);
  if (!priceScaled || priceScaled <= 0n) {
    return null;
  }

  const priceQuoteAmountWei = (priceScaled * tokenUnitWei(quoteDecimals)) / RECURRING_PRICE_SCALE;
  if (priceQuoteAmountWei <= 0n) {
    return null;
  }

  return {
    baseAmountWei: tokenUnitWei(baseDecimals),
    quoteAmountWei: priceQuoteAmountWei
  };
};

export function RecurringCycleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 7h9.5a3.5 3.5 0 0 1 0 7H15" />
      <path d="M8.5 4.5 6 7l2.5 2.5" />
      <path d="M17 17H7.5a3.5 3.5 0 0 1 0-7H9" />
      <path d="M15.5 19.5 18 17l-2.5-2.5" />
    </svg>
  );
}

export const renderCarbonPriceReference = (
  reference: CarbonPairReferenceDisplay | null,
  options?: {
    fallbackLabel?: string;
    fallbackTitle?: string;
    onToggle?: () => void;
    pressed?: boolean;
  }
) => {
  const label = reference?.label ?? options?.fallbackLabel;
  const title = reference?.title ?? options?.fallbackTitle ?? label;
  if (!label) {
    return null;
  }
  return options?.onToggle ? (
    <button
      type="button"
      className="p2p-carbon-price-reference"
      onClick={options.onToggle}
      aria-pressed={options.pressed}
      title={title}
    >
      {label}
    </button>
  ) : (
    <small className="p2p-carbon-price-reference" title={title}>
      {label}
    </small>
  );
};

export const renderDeskPriceLabel = (label: string) => {
  const trimmedLabel = label.trim();
  const [amount, ...unitParts] = trimmedLabel.split(/\s+/);
  const unit = unitParts.join(' ');
  if (!amount || !unit) {
    return <span className="p2p-price-number">{trimmedLabel}</span>;
  }
  return (
    <>
      <span className="p2p-price-number">{amount}</span>{' '}
      <span className="p2p-price-unit">{unit}</span>
    </>
  );
};

export const formatDeskPriceSideLabel = (
  side: { asset: TradeAssetPayload; label: string },
  counterSide?: { asset: TradeAssetPayload }
): string => {
  const tokenSymbol = side.asset.symbol.trim() || 'Token';
  const counterTokenSymbol = counterSide?.asset.symbol.trim() || '';
  const normalizedAction = side.label.replace(/^you\s+/i, '').trim().split(/\s+/)[0]?.toLowerCase();
  if (normalizedAction === 'buy') {
    return counterTokenSymbol ? `Buy ${tokenSymbol} with ${counterTokenSymbol}` : `Buy ${tokenSymbol}`;
  }
  if (normalizedAction === 'sell') {
    return counterTokenSymbol ? `Sell ${tokenSymbol} for ${counterTokenSymbol}` : `Sell ${tokenSymbol}`;
  }
  return tokenSymbol;
};

export const formatRecurringPriceDeskAriaLabel = (
  subjectLabel: string,
  display: RecurringPriceDeskDisplay
): string =>
  `${subjectLabel} price desk quoted in ${display.basisLabel}. ${display.sellSide.label}: ${display.sellSide.priceLabel}. ${display.buySide.label}: ${display.buySide.priceLabel}. Switch to ${display.nextBasisLabel}.`;

export const renderDeskLiquidityLabel = (label: string) => {
  const trimmedLabel = label.trim();
  const [amount, ...unitParts] = trimmedLabel.split(/\s+/);
  const unit = unitParts.join(' ');
  if (!amount || !unit) {
    return <span className="p2p-liquidity-number">{trimmedLabel}</span>;
  }
  return (
    <>
      <span className="p2p-liquidity-number">{amount}</span>
      <span className="p2p-liquidity-unit">{unit}</span>
    </>
  );
};

export const renderP2PEmptyState = (
  title: string,
  description: string,
  actions?: ReactNode,
  tone: P2PEmptyStateTone = 'default'
) => (
  <div className={`p2p-empty-state${tone !== 'default' ? ` p2p-empty-state-${tone}` : ''}`}>
    <div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
    {tone === 'loading' ? (
      <div className="p2p-loading-skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    ) : null}
    {actions ? <div className="p2p-empty-actions">{actions}</div> : null}
  </div>
);

export const renderDeskLoadingSkeletons = () => (
  <div
    className="p2p-offer-grid p2p-public-trade-grid p2p-desk-skeleton-grid"
    role="status"
    aria-live="polite"
    aria-label="Loading active offers"
  >
    <span className="p2p-sr-only">Loading active offers from escrow events.</span>
    {Array.from({ length: 5 }, (_, index) => {
      const recurringSkeleton = index >= 2;
      return (
        <article
          key={`desk-skeleton-${index}`}
          className={`p2p-desk-skeleton-card${recurringSkeleton ? ' p2p-desk-skeleton-card-recurring' : ''}`}
          aria-hidden="true"
        >
          <div className="p2p-desk-skeleton-head">
            <span className="p2p-skeleton-line p2p-skeleton-title" />
            <span className="p2p-skeleton-pill" />
            <span className="p2p-skeleton-line p2p-skeleton-meta" />
          </div>
          <div className="p2p-desk-skeleton-market">
            <span className="p2p-skeleton-line p2p-skeleton-label" />
            {recurringSkeleton ? (
              <div className="p2p-desk-skeleton-price-grid">
                <span className="p2p-skeleton-cell" />
                <span className="p2p-skeleton-cell" />
              </div>
            ) : (
              <>
                <span className="p2p-skeleton-line p2p-skeleton-price" />
                <span className="p2p-skeleton-line p2p-skeleton-unit" />
              </>
            )}
          </div>
          <div className={`p2p-desk-skeleton-detail${recurringSkeleton ? ' p2p-desk-skeleton-detail-grid' : ''}`}>
            <span className="p2p-skeleton-cell" />
            <span className="p2p-skeleton-cell" />
            {recurringSkeleton ? <span className="p2p-skeleton-cell" /> : null}
          </div>
          <div className="p2p-desk-skeleton-verify">
            <span className="p2p-skeleton-line" />
            <span className="p2p-skeleton-pill" />
          </div>
          <div className="p2p-desk-skeleton-actions">
            <span className="p2p-skeleton-button" />
            <span className="p2p-skeleton-button" />
          </div>
        </article>
      );
    })}
  </div>
);

export const getStandardTradeOpenActionCta = (): TradeOpenActionCta => ({
  kind: 'view',
  label: OPEN_TERMINAL_LABEL
});

export const getRecurringOrderOpenActionCta = (snapshot: TradeSnapshot, isMaker: boolean): TradeOpenActionCta => {
  if (isMaker) {
    return { kind: 'manage', label: OPEN_TERMINAL_LABEL };
  }

  const buyState = getRecurringTerminalSideState(snapshot, 'buy');
  const sellState = getRecurringTerminalSideState(snapshot, 'sell');

  if (buyState.isOpen && sellState.isOpen) {
    return {
      kind: 'cycle',
      label: OPEN_TERMINAL_LABEL
    };
  }

  if (buyState.isOpen || sellState.isOpen) {
    return {
      kind: 'direction',
      label: OPEN_TERMINAL_LABEL
    };
  }

  return { kind: 'view', label: OPEN_TERMINAL_LABEL };
};

export const renderOpenActionCtaContent = (action: TradeOpenActionCta) => <span>{action.label}</span>;

export const formatRecurringTokenAmount = (asset: TradeAssetPayload, amount: string, hidden = false): string => {
  if (hidden) {
    return `Private ${asset.symbol}`;
  }
  try {
    return `${formatTokenAmount(BigInt(amount), asset.decimals, 6)} ${asset.symbol}`;
  } catch {
    return `0 ${asset.symbol}`;
  }
};

export const formatRecurringLiveLiquidityAmount = (
  snapshot: TradeSnapshot | null,
  side: 'sell' | 'buy'
): string => {
  const recurring = snapshot?.recurringOrder;
  if (!recurring) {
    return '--';
  }
  const asset = side === 'sell' ? recurring.baseAsset : recurring.quoteAsset;
  const publicAmount = side === 'sell' ? recurring.publicBaseInventory : recurring.publicQuoteInventory;
  const revealedAmount =
    side === 'sell'
      ? recurring.makerPrivateInventory?.baseInventory
      : recurring.makerPrivateInventory?.quoteInventory;
  const hidden = recurring.mode !== 'public' && asset.kind === 'private-erc20';
  if (hidden && revealedAmount === undefined) {
    return `Private ${asset.symbol}`;
  }
  return formatRecurringTokenAmount(asset, revealedAmount ?? publicAmount, false);
};
