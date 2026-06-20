import {
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetKind,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { getRemainingOfferAmount, getRemainingRequestAmount, getTradeTermsVisibility } from './p2pTradeView';
import { isZeroTradeTakerAddress } from './tradePerspective';

const PRICE_SCALE = 10n ** 18n;

export type NormalizedOfferSourceType = 'standard';
export type NormalizedOfferFillKind = 'accept' | 'partialFill';

export type NormalizedOfferAsset = {
  kind: TradeAssetKind;
  tokenAddress?: string;
  symbol: string;
  decimals: number;
  key: string;
};

export type NormalizedOffer = {
  sourceContract: string;
  sourceType: NormalizedOfferSourceType;
  id: bigint;
  tradeId: number;
  tradeKey: string;
  maker: string;
  givesToken: NormalizedOfferAsset;
  wantsToken: NormalizedOfferAsset;
  givesAmount: bigint;
  wantsAmount: bigint;
  price: bigint;
  priceScale: bigint;
  isPublic: true;
  hiddenAmount: false;
  fillKind: NormalizedOfferFillKind;
  createdAt: number;
  expiresAt: number;
};

export type NormalizedOfferSkipReason =
  | 'not-open'
  | 'unsupported-source'
  | 'not-public'
  | 'not-open-to-anyone'
  | 'hidden-amount'
  | 'invalid-amount'
  | 'same-token';

export type NormalizedOfferResult =
  | { ok: true; offer: NormalizedOffer }
  | { ok: false; reason: NormalizedOfferSkipReason };

export type NormalizedOfferPairInput = {
  buyToken: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol'> | NormalizedOfferAsset;
  payToken: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol'> | NormalizedOfferAsset;
};

export type BestFillQuoteLeg = {
  offer: NormalizedOffer;
  buyAmount: bigint;
  payAmount: bigint;
  fullyConsumesOffer: boolean;
};

export type BestFillQuote = {
  buyToken: NormalizedOfferAsset | null;
  payToken: NormalizedOfferAsset | null;
  requestedBuyAmount: bigint;
  filledBuyAmount: bigint;
  totalPayAmount: bigint;
  averagePrice: bigint;
  priceScale: bigint;
  complete: boolean;
  legs: BestFillQuoteLeg[];
  excluded: Array<{
    offer: NormalizedOffer;
    reason: 'pair-mismatch' | 'above-max-price';
  }>;
};

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

const ceilDiv = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) {
    return 0n;
  }
  return numerator <= 0n ? 0n : (numerator + denominator - 1n) / denominator;
};

const decimalsScale = (decimals: number): bigint => {
  const safeDecimals = Number.isFinite(decimals) ? Math.max(0, Math.min(36, Math.trunc(decimals))) : 18;
  return 10n ** BigInt(safeDecimals);
};

const parsePositiveAmount = (value?: string): bigint => {
  if (!/^\d+$/.test(value ?? '')) {
    return 0n;
  }
  try {
    const parsed = BigInt(value ?? '0');
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
};

export const getNormalizedOfferAssetKey = (
  asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol'>
): string => {
  if (asset.kind === 'native') {
    return 'native:coti';
  }
  const address = normalizeAddress(asset.tokenAddress);
  return address ? `${asset.kind}:${address}` : `${asset.kind}:symbol:${asset.symbol.trim().toLowerCase()}`;
};

const normalizeOfferAsset = (
  asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>
): NormalizedOfferAsset => ({
  kind: asset.kind,
  tokenAddress: asset.tokenAddress,
  symbol: asset.symbol,
  decimals: asset.decimals,
  key: getNormalizedOfferAssetKey(asset)
});

const calculatePrice = ({
  givesAmount,
  wantsAmount,
  givesDecimals,
  wantsDecimals
}: {
  givesAmount: bigint;
  wantsAmount: bigint;
  givesDecimals: number;
  wantsDecimals: number;
}): bigint =>
  ceilDiv(wantsAmount * decimalsScale(givesDecimals) * PRICE_SCALE, givesAmount * decimalsScale(wantsDecimals));

const calculatePayAmount = (buyAmount: bigint, offer: NormalizedOffer): bigint =>
  ceilDiv(buyAmount * offer.wantsAmount, offer.givesAmount);

const isStandardEscrowTrade = (trade: Pick<TradeSnapshot, 'escrowContract'>): boolean =>
  normalizeAddress(trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS) ===
  normalizeAddress(TRADE_ESCROW_CONTRACT_ADDRESS);

export const normalizeStandardPublicOtcOffer = (trade: TradeSnapshot): NormalizedOfferResult => {
  if (trade.status !== 'open') {
    return { ok: false, reason: 'not-open' };
  }
  if (trade.recurringOrder || !isStandardEscrowTrade(trade)) {
    return { ok: false, reason: 'unsupported-source' };
  }
  if (trade.isPublic !== true || trade.hasAccessHash) {
    return { ok: false, reason: 'not-public' };
  }
  if (!isZeroTradeTakerAddress(trade.taker)) {
    return { ok: false, reason: 'not-open-to-anyone' };
  }
  if (getTradeTermsVisibility(trade) !== 'public') {
    return { ok: false, reason: 'hidden-amount' };
  }

  const givesAmount = getRemainingOfferAmount(trade);
  const wantsAmount = getRemainingRequestAmount(trade);
  const originalGivesAmount = parsePositiveAmount(trade.offer.amount);
  const originalWantsAmount = parsePositiveAmount(trade.request.amount);
  if (givesAmount <= 0n || wantsAmount <= 0n || originalGivesAmount <= 0n || originalWantsAmount <= 0n) {
    return { ok: false, reason: 'invalid-amount' };
  }

  const givesToken = normalizeOfferAsset(trade.offer);
  const wantsToken = normalizeOfferAsset(trade.request);
  if (givesToken.key === wantsToken.key) {
    return { ok: false, reason: 'same-token' };
  }

  return {
    ok: true,
    offer: {
      sourceContract: trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS,
      sourceType: 'standard',
      id: BigInt(trade.tradeId),
      tradeId: trade.tradeId,
      tradeKey: `${normalizeAddress(trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS)}:${trade.tradeId}`,
      maker: trade.maker,
      givesToken,
      wantsToken,
      givesAmount,
      wantsAmount,
      price: calculatePrice({
        givesAmount,
        wantsAmount,
        givesDecimals: trade.offer.decimals,
        wantsDecimals: trade.request.decimals
      }),
      priceScale: PRICE_SCALE,
      isPublic: true,
      hiddenAmount: false,
      fillKind: 'partialFill',
      createdAt: trade.createdAt,
      expiresAt: trade.expiresAt
    }
  };
};

export const normalizeStandardPublicOtcOffers = (trades: TradeSnapshot[]): NormalizedOffer[] =>
  trades.flatMap((trade) => {
    const result = normalizeStandardPublicOtcOffer(trade);
    return result.ok ? [result.offer] : [];
  });

export const normalizedOfferMatchesPair = (offer: NormalizedOffer, pair: NormalizedOfferPairInput): boolean =>
  offer.givesToken.key === getNormalizedOfferAssetKey(pair.buyToken) &&
  offer.wantsToken.key === getNormalizedOfferAssetKey(pair.payToken);

export const listNormalizedOffersForPair = (
  offers: NormalizedOffer[],
  pair: NormalizedOfferPairInput
): NormalizedOffer[] =>
  offers
    .filter((offer) => normalizedOfferMatchesPair(offer, pair))
    .sort((left, right) => {
      if (left.price !== right.price) {
        return left.price < right.price ? -1 : 1;
      }
      if (left.createdAt !== right.createdAt) {
        return right.createdAt - left.createdAt;
      }
      return left.tradeId - right.tradeId;
    });

export const quoteBestFillFromNormalizedOffers = ({
  offers,
  buyToken,
  payToken,
  buyAmount,
  maxPrice
}: NormalizedOfferPairInput & {
  offers: NormalizedOffer[];
  buyAmount: bigint;
  maxPrice?: bigint;
}): BestFillQuote => {
  const requestedBuyAmount = buyAmount > 0n ? buyAmount : 0n;
  const excluded: BestFillQuote['excluded'] = [];
  const pairOffers: NormalizedOffer[] = [];
  for (const offer of offers) {
    if (!normalizedOfferMatchesPair(offer, { buyToken, payToken })) {
      excluded.push({ offer, reason: 'pair-mismatch' });
      continue;
    }
    if (maxPrice !== undefined && offer.price > maxPrice) {
      excluded.push({ offer, reason: 'above-max-price' });
      continue;
    }
    pairOffers.push(offer);
  }

  let remainingBuyAmount = requestedBuyAmount;
  let filledBuyAmount = 0n;
  let totalPayAmount = 0n;
  const legs: BestFillQuoteLeg[] = [];
  for (const offer of listNormalizedOffersForPair(pairOffers, { buyToken, payToken })) {
    if (remainingBuyAmount <= 0n) {
      break;
    }
    const legBuyAmount = offer.givesAmount < remainingBuyAmount ? offer.givesAmount : remainingBuyAmount;
    if (legBuyAmount <= 0n) {
      continue;
    }
    const legPayAmount = calculatePayAmount(legBuyAmount, offer);
    legs.push({
      offer,
      buyAmount: legBuyAmount,
      payAmount: legPayAmount,
      fullyConsumesOffer: legBuyAmount >= offer.givesAmount
    });
    filledBuyAmount += legBuyAmount;
    totalPayAmount += legPayAmount;
    remainingBuyAmount -= legBuyAmount;
  }

  const buyAsset = legs[0]?.offer.givesToken ?? pairOffers[0]?.givesToken ?? null;
  const payAsset = legs[0]?.offer.wantsToken ?? pairOffers[0]?.wantsToken ?? null;
  const averagePrice =
    filledBuyAmount > 0n && buyAsset && payAsset
      ? calculatePrice({
          givesAmount: filledBuyAmount,
          wantsAmount: totalPayAmount,
          givesDecimals: buyAsset.decimals,
          wantsDecimals: payAsset.decimals
        })
      : 0n;

  return {
    buyToken: buyAsset,
    payToken: payAsset,
    requestedBuyAmount,
    filledBuyAmount,
    totalPayAmount,
    averagePrice,
    priceScale: PRICE_SCALE,
    complete: requestedBuyAmount > 0n && filledBuyAmount >= requestedBuyAmount,
    legs,
    excluded
  };
};
