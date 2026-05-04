import { formatTokenAmount, type TradeAssetPayload, type TradeOnChainStatus, type TradeSnapshot } from './appShared';

export const ZERO_TRADE_TAKER_ADDRESS = '0x0000000000000000000000000000000000000000';

export type TradePerspectiveTone = 'send' | 'receive' | 'neutral';
export type TradePerspectiveRole = 'maker' | 'taker' | 'open-taker' | 'unrelated' | 'unknown';

export type TradePerspectiveSide = {
  asset: TradeAssetPayload;
  label: string;
  tone: TradePerspectiveTone;
};

export type TradePerspective = {
  walletKey: string;
  role: TradePerspectiveRole;
  isMaker: boolean;
  isTaker: boolean;
  isOpenTakerTrade: boolean;
  isParticipant: boolean;
  showTakerPerspective: boolean;
  offerSide: TradePerspectiveSide;
  requestSide: TradePerspectiveSide;
  sendSide: TradePerspectiveSide | null;
  receiveSide: TradePerspectiveSide | null;
  canAccept: boolean;
  needsAction: boolean;
  isMyActiveOffer: boolean;
  isHistory: boolean;
};

export type TradeOrderSideRole = 'offer' | 'payment';

export type TradeOrderSide = TradePerspectiveSide & {
  role: TradeOrderSideRole;
};

export type TradeOrderSummary = {
  perspective: TradePerspective;
  offerAsset: TradeAssetPayload;
  paymentAsset: TradeAssetPayload;
  primarySide: TradeOrderSide;
  secondarySide: TradeOrderSide;
  offerSide: TradeOrderSide;
  paymentSide: TradeOrderSide;
  pairLabel: string;
  actionLabel: string;
  directionLabel: string;
  ratioLabel: string | null;
  reverseRatioLabel: string | null;
};

type TradePerspectiveInput = Pick<TradeSnapshot, 'maker' | 'taker' | 'offer' | 'request'> & {
  status?: TradeOnChainStatus;
  fillState?: TradeSnapshot['fillState'];
  makerPrivateProgress?: TradeSnapshot['makerPrivateProgress'];
  walletHasFill?: TradeSnapshot['walletHasFill'];
};

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

const parsePositiveAmount = (value?: string | null): bigint => {
  const normalizedValue = value?.trim() ?? '';
  return /^\d+$/.test(normalizedValue) ? BigInt(normalizedValue) : 0n;
};

export const isZeroTradeTakerAddress = (value?: string | null): boolean =>
  normalizeAddress(value) === ZERO_TRADE_TAKER_ADDRESS;

export const hasPartialTradeFill = (trade: TradePerspectiveInput): boolean => {
  const filledOfferAmount = parsePositiveAmount(trade.fillState?.filledOfferAmount);
  const filledRequestAmount = parsePositiveAmount(trade.fillState?.filledRequestAmount);
  const remainingOfferAmount = parsePositiveAmount(trade.fillState?.remainingOfferAmount);
  const remainingRequestAmount = parsePositiveAmount(trade.fillState?.remainingRequestAmount);
  const hasVisiblePartialFill =
    (filledOfferAmount > 0n || filledRequestAmount > 0n) &&
    (remainingOfferAmount > 0n || remainingRequestAmount > 0n);

  if (hasVisiblePartialFill) {
    return true;
  }

  const makerFilledOfferAmount = parsePositiveAmount(trade.makerPrivateProgress?.filledOfferAmount);
  const makerRemainingOfferAmount = parsePositiveAmount(trade.makerPrivateProgress?.remainingOfferAmount);
  const makerInitialOfferAmount = parsePositiveAmount(trade.makerPrivateProgress?.initialOfferAmount);

  return (
    makerFilledOfferAmount > 0n &&
    makerRemainingOfferAmount > 0n &&
    (makerInitialOfferAmount === 0n || makerInitialOfferAmount > makerRemainingOfferAmount)
  );
};

export const resolveTradePerspective = (
  trade: TradePerspectiveInput,
  walletAddress?: string | null
): TradePerspective => {
  const walletKey = normalizeAddress(walletAddress);
  const makerKey = normalizeAddress(trade.maker);
  const takerKey = normalizeAddress(trade.taker);
  const isMaker = Boolean(walletKey && makerKey === walletKey);
  const isTaker = Boolean(walletKey && takerKey === walletKey);
  const isOpenTakerTrade = isZeroTradeTakerAddress(trade.taker);
  const isOpen = trade.status === undefined || trade.status === 'open';
  const showTakerPerspective = Boolean(walletKey && !isMaker && (isTaker || isOpenTakerTrade));
  const role: TradePerspectiveRole = isMaker
    ? 'maker'
    : isTaker
      ? 'taker'
      : showTakerPerspective
        ? 'open-taker'
        : walletKey
          ? 'unrelated'
          : 'unknown';
  const offerSide: TradePerspectiveSide = {
    asset: trade.offer,
    label: isMaker ? 'You send' : showTakerPerspective ? 'You receive' : 'Maker sends',
    tone: isMaker ? 'send' : showTakerPerspective ? 'receive' : 'send'
  };
  const requestSide: TradePerspectiveSide = {
    asset: trade.request,
    label: isMaker ? 'You receive' : showTakerPerspective ? 'You send' : 'Maker wants',
    tone: isMaker ? 'receive' : showTakerPerspective ? 'send' : 'receive'
  };
  const sendSide = isMaker ? offerSide : showTakerPerspective ? requestSide : null;
  const receiveSide = isMaker ? requestSide : showTakerPerspective ? offerSide : null;
  const canAccept = isOpen && !isMaker && Boolean(walletKey && (isTaker || isOpenTakerTrade));
  const needsAction = isOpen && isTaker;
  const isMyActiveOffer = isOpen && isMaker;
  const isParticipant = isMaker || isTaker;
  const isPartiallyFilled = hasPartialTradeFill(trade);

  return {
    walletKey,
    role,
    isMaker,
    isTaker,
    isOpenTakerTrade,
    isParticipant,
    showTakerPerspective,
    offerSide,
    requestSide,
    sendSide,
    receiveSide,
    canAccept,
    needsAction,
    isMyActiveOffer,
    isHistory: isParticipant && (!isOpen || isPartiallyFilled)
  };
};

export const formatTradeRatioLabel = (baseAsset?: TradeAssetPayload, quoteAsset?: TradeAssetPayload): string | null => {
  if (!baseAsset || !quoteAsset) {
    return null;
  }

  try {
    const baseAmount = BigInt(baseAsset.amount);
    const quoteAmount = BigInt(quoteAsset.amount);
    if (baseAmount <= 0n || quoteAmount <= 0n) {
      return `${quoteAsset.symbol}/${baseAsset.symbol}`;
    }

    const scaledQuoteAmount = (quoteAmount * 10n ** BigInt(baseAsset.decimals)) / baseAmount;
    return `${formatTokenAmount(scaledQuoteAmount, quoteAsset.decimals, 6)} ${quoteAsset.symbol}/${baseAsset.symbol}`;
  } catch {
    return `${quoteAsset?.symbol ?? 'Asset'}/${baseAsset?.symbol ?? 'Asset'}`;
  }
};

export const resolveTradeOrderSummary = (
  trade: TradePerspectiveInput,
  walletAddress?: string | null
): TradeOrderSummary => {
  const perspective = resolveTradePerspective(trade, walletAddress);
  const isBuyerView = perspective.showTakerPerspective;
  const isMakerView = perspective.isMaker;

  const offerSide: TradeOrderSide = {
    asset: trade.offer,
    label: isBuyerView ? 'You buy' : isMakerView ? 'You sell' : 'Seller sells',
    tone: isBuyerView ? 'receive' : isMakerView ? 'send' : 'receive',
    role: 'offer'
  };
  const paymentSide: TradeOrderSide = {
    asset: trade.request,
    label: 'Buyer pays',
    tone: isBuyerView ? 'send' : isMakerView ? 'receive' : 'send',
    role: 'payment'
  };

  const directionLabel = isBuyerView
    ? `Buy ${trade.offer.symbol} with ${trade.request.symbol}`
    : `Sell ${trade.offer.symbol} for ${trade.request.symbol}`;

  return {
    perspective,
    offerAsset: trade.offer,
    paymentAsset: trade.request,
    primarySide: isBuyerView ? paymentSide : offerSide,
    secondarySide: isBuyerView ? offerSide : paymentSide,
    offerSide,
    paymentSide,
    pairLabel: `${trade.offer.symbol}/${trade.request.symbol}`,
    actionLabel: isBuyerView ? `Buy ${trade.offer.symbol}` : `Sell ${trade.offer.symbol}`,
    directionLabel,
    ratioLabel: formatTradeRatioLabel(trade.offer, trade.request),
    reverseRatioLabel: formatTradeRatioLabel(trade.request, trade.offer)
  };
};

export const groupWalletTradesByPerspective = (trades: TradeSnapshot[], walletAddress: string) => {
  const needsAction: TradeSnapshot[] = [];
  const myActiveOffers: TradeSnapshot[] = [];
  const history: TradeSnapshot[] = [];

  for (const trade of trades) {
    const perspective = resolveTradePerspective(trade, walletAddress);
    if (perspective.needsAction) {
      needsAction.push(trade);
    } else if (perspective.isMyActiveOffer) {
      myActiveOffers.push(trade);
    }

    const isWalletScopedPartialFill =
      perspective.walletKey.length > 0 &&
      perspective.isOpenTakerTrade &&
      !perspective.isParticipant &&
      hasPartialTradeFill(trade);
    const isWalletScopedIndexedFill =
      perspective.walletKey.length > 0 &&
      !perspective.isParticipant &&
      Boolean(trade.walletHasFill);
    const isMakerRecurringWithExecutions =
      perspective.isMaker &&
      Boolean(trade.recurringOrder && trade.recurringOrder.executionCount > 0);

    if (perspective.isHistory || isWalletScopedPartialFill || isWalletScopedIndexedFill || isMakerRecurringWithExecutions) {
      history.push(trade);
    }
  }

  return { needsAction, myActiveOffers, history };
};
