import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import type { ResolvedTradeToken } from './appHelpers';
import { getSnapshotKey, getTradeDisplayTerms, getTradeTermsVisibility } from './p2pTradeView';
import {
  getNormalizedOfferAssetKey,
  normalizeStandardPublicOtcOffer,
  type NormalizedOfferAsset
} from './otcOfferNormalization';

const PRICE_SCALE = 10n ** 18n;

export type OtcSwapInputMode = 'sell' | 'buy';
export type OtcSwapSourceType = 'standard' | 'recurring';
export type OtcSwapAvailability =
  | {
      kind: 'known';
      maxBuyAmountWei: bigint;
      maxSellAmountWei: bigint;
    }
  | {
      kind: 'terminal';
    };

export type OtcSwapTerminalPrefill =
  | {
      kind: 'standard';
      inputSide: 'pay' | 'buy';
      amountWei: bigint;
    }
  | {
      kind: 'recurring';
      displayAction: 'sell' | 'buy';
      fillSide: 'buy' | 'sell';
      amountWei: bigint;
    };

export type OtcSwapQuoteCandidate = {
  trade: TradeSnapshot;
  tradeId: number;
  tradeKey: string;
  escrowContract: string;
  sourceType: OtcSwapSourceType;
  recurringSide?: 'buy' | 'sell';
  sellToken: NormalizedOfferAsset;
  buyToken: NormalizedOfferAsset;
  requestedSellAmountWei: bigint;
  requestedBuyAmountWei: bigint;
  estimatedSellAmountWei: bigint;
  estimatedBuyAmountWei: bigint;
  complete: boolean;
  price: bigint;
  priceScale: bigint;
  availability: OtcSwapAvailability;
  terminalPrefill: OtcSwapTerminalPrefill;
};

export type OtcSwapQuoteResult = {
  best: OtcSwapQuoteCandidate | null;
  compatibleCount: number;
  otherCompatibleCount: number;
};

const normalizeAddress = (value?: string | null): string => value?.trim().toLowerCase() ?? '';

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

const normalizeSwapAsset = (
  asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol' | 'decimals'>
): NormalizedOfferAsset => ({
  kind: asset.kind,
  tokenAddress: asset.tokenAddress,
  symbol: asset.symbol,
  decimals: asset.decimals,
  key: getNormalizedOfferAssetKey(asset)
});

export const getOtcSwapAssetKey = (
  asset: Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'symbol'> | ResolvedTradeToken
): string => getNormalizedOfferAssetKey(asset);

const calculateSellPerBuyPrice = ({
  buyAmount,
  buyDecimals,
  sellAmount,
  sellDecimals
}: {
  buyAmount: bigint;
  buyDecimals: number;
  sellAmount: bigint;
  sellDecimals: number;
}): bigint =>
  buyAmount > 0n && sellAmount > 0n
    ? ceilDiv(sellAmount * decimalsScale(buyDecimals) * PRICE_SCALE, buyAmount * decimalsScale(sellDecimals))
    : 0n;

const buildAmountsForTerms = ({
  inputAmountWei,
  inputMode,
  unitBuyAmountWei,
  unitSellAmountWei
}: {
  inputAmountWei: bigint;
  inputMode: OtcSwapInputMode;
  unitBuyAmountWei: bigint;
  unitSellAmountWei: bigint;
}): {
  estimatedBuyAmountWei: bigint;
  estimatedSellAmountWei: bigint;
  requestedBuyAmountWei: bigint;
  requestedSellAmountWei: bigint;
} => {
  if (inputAmountWei <= 0n || unitBuyAmountWei <= 0n || unitSellAmountWei <= 0n) {
    return {
      estimatedBuyAmountWei: 0n,
      estimatedSellAmountWei: 0n,
      requestedBuyAmountWei: inputMode === 'buy' ? inputAmountWei : 0n,
      requestedSellAmountWei: inputMode === 'sell' ? inputAmountWei : 0n
    };
  }

  if (inputMode === 'sell') {
    return {
      estimatedBuyAmountWei: (inputAmountWei * unitBuyAmountWei) / unitSellAmountWei,
      estimatedSellAmountWei: inputAmountWei,
      requestedBuyAmountWei: 0n,
      requestedSellAmountWei: inputAmountWei
    };
  }

  return {
    estimatedBuyAmountWei: inputAmountWei,
    estimatedSellAmountWei: ceilDiv(inputAmountWei * unitSellAmountWei, unitBuyAmountWei),
    requestedBuyAmountWei: inputAmountWei,
    requestedSellAmountWei: 0n
  };
};

const isKnownAmountComplete = ({
  availability,
  estimatedBuyAmountWei,
  estimatedSellAmountWei,
  inputAmountWei
}: {
  availability: OtcSwapAvailability;
  estimatedBuyAmountWei: bigint;
  estimatedSellAmountWei: bigint;
  inputAmountWei: bigint;
}): boolean => {
  if (inputAmountWei <= 0n || availability.kind !== 'known') {
    return false;
  }
  return (
    estimatedBuyAmountWei > 0n &&
    estimatedSellAmountWei > 0n &&
    estimatedBuyAmountWei <= availability.maxBuyAmountWei &&
    estimatedSellAmountWei <= availability.maxSellAmountWei
  );
};

const compareSwapCandidates = (left: OtcSwapQuoteCandidate, right: OtcSwapQuoteCandidate): number => {
  if (left.price !== right.price) {
    return left.price < right.price ? -1 : 1;
  }
  if (left.complete !== right.complete) {
    return left.complete ? -1 : 1;
  }
  if (left.availability.kind !== right.availability.kind) {
    return left.availability.kind === 'known' ? -1 : 1;
  }
  return left.tradeId - right.tradeId;
};

const isSupportedLinkedStandardTrade = (trade: TradeSnapshot): boolean => {
  if (trade.recurringOrder || trade.status !== 'open') {
    return false;
  }
  const escrowContract = normalizeAddress(trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS);
  return [
    normalizeAddress(TRADE_ESCROW_CONTRACT_ADDRESS),
    normalizeAddress(PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS),
    normalizeAddress(DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)
  ].includes(escrowContract);
};

const buildLinkedStandardSwapCandidate = ({
  inputAmountWei,
  inputMode,
  trade,
  sellKey,
  buyKey
}: {
  inputAmountWei: bigint;
  inputMode: OtcSwapInputMode;
  trade: TradeSnapshot;
  sellKey: string;
  buyKey: string;
}): OtcSwapQuoteCandidate | null => {
  if (!isSupportedLinkedStandardTrade(trade)) {
    return null;
  }

  const displayTerms = getTradeDisplayTerms(trade);
  const buyAsset = normalizeSwapAsset(displayTerms.offer);
  const sellAsset = normalizeSwapAsset(displayTerms.request);
  if (buyAsset.key !== buyKey || sellAsset.key !== sellKey || buyAsset.key === sellAsset.key) {
    return null;
  }

  const unitBuyAmountWei = parsePositiveAmount(displayTerms.offer.amount);
  const unitSellAmountWei = parsePositiveAmount(displayTerms.request.amount);
  if (unitBuyAmountWei <= 0n || unitSellAmountWei <= 0n) {
    return null;
  }

  const amounts = buildAmountsForTerms({
    inputAmountWei,
    inputMode,
    unitBuyAmountWei,
    unitSellAmountWei
  });
  const termsVisibility = getTradeTermsVisibility(trade);
  const availability: OtcSwapAvailability =
    termsVisibility === 'public'
      ? {
          kind: 'known',
          maxBuyAmountWei: unitBuyAmountWei,
          maxSellAmountWei: unitSellAmountWei
        }
      : { kind: 'terminal' };

  return {
    trade,
    tradeId: trade.tradeId,
    tradeKey: getSnapshotKey(trade),
    escrowContract: trade.escrowContract || TRADE_ESCROW_CONTRACT_ADDRESS,
    sourceType: 'standard',
    sellToken: sellAsset,
    buyToken: buyAsset,
    ...amounts,
    complete: isKnownAmountComplete({
      availability,
      estimatedBuyAmountWei: amounts.estimatedBuyAmountWei,
      estimatedSellAmountWei: amounts.estimatedSellAmountWei,
      inputAmountWei
    }),
    price: calculateSellPerBuyPrice({
      buyAmount: unitBuyAmountWei,
      buyDecimals: buyAsset.decimals,
      sellAmount: unitSellAmountWei,
      sellDecimals: sellAsset.decimals
    }),
    priceScale: PRICE_SCALE,
    availability,
    terminalPrefill: {
      kind: 'standard',
      inputSide: inputMode === 'buy' ? 'buy' : 'pay',
      amountWei: inputMode === 'buy' ? amounts.estimatedBuyAmountWei : amounts.estimatedSellAmountWei
    }
  };
};

const buildStandardSwapCandidate = ({
  includePrivateOtcQuotes,
  inputAmountWei,
  inputMode,
  trade,
  sellKey,
  buyKey
}: {
  includePrivateOtcQuotes?: boolean;
  inputAmountWei: bigint;
  inputMode: OtcSwapInputMode;
  trade: TradeSnapshot;
  sellKey: string;
  buyKey: string;
}): OtcSwapQuoteCandidate | null => {
  const result = normalizeStandardPublicOtcOffer(trade);
  if (!result.ok) {
    if (includePrivateOtcQuotes) {
      return buildLinkedStandardSwapCandidate({ inputAmountWei, inputMode, trade, sellKey, buyKey });
    }
    return null;
  }
  const offer = result.offer;
  if (offer.givesToken.key !== buyKey || offer.wantsToken.key !== sellKey) {
    return null;
  }

  const amounts = buildAmountsForTerms({
    inputAmountWei,
    inputMode,
    unitBuyAmountWei: offer.givesAmount,
    unitSellAmountWei: offer.wantsAmount
  });
  const availability: OtcSwapAvailability = {
    kind: 'known',
    maxBuyAmountWei: offer.givesAmount,
    maxSellAmountWei: offer.wantsAmount
  };

  return {
    trade,
    tradeId: offer.tradeId,
    tradeKey: offer.tradeKey,
    escrowContract: offer.sourceContract,
    sourceType: 'standard',
    sellToken: offer.wantsToken,
    buyToken: offer.givesToken,
    ...amounts,
    complete: isKnownAmountComplete({
      availability,
      estimatedBuyAmountWei: amounts.estimatedBuyAmountWei,
      estimatedSellAmountWei: amounts.estimatedSellAmountWei,
      inputAmountWei
    }),
    price: offer.price,
    priceScale: offer.priceScale,
    availability,
    terminalPrefill: {
      kind: 'standard',
      inputSide: inputMode === 'buy' ? 'buy' : 'pay',
      amountWei: inputMode === 'buy' ? amounts.estimatedBuyAmountWei : amounts.estimatedSellAmountWei
    }
  };
};

const buildRecurringAvailability = ({
  recurringMode,
  unitBuyAmountWei,
  unitSellAmountWei,
  visibleBuyInventoryWei
}: {
  recurringMode: string;
  unitBuyAmountWei: bigint;
  unitSellAmountWei: bigint;
  visibleBuyInventoryWei: bigint;
}): OtcSwapAvailability => {
  if (recurringMode !== 'public') {
    return { kind: 'terminal' };
  }
  return {
    kind: 'known',
    maxBuyAmountWei: visibleBuyInventoryWei,
    maxSellAmountWei: ceilDiv(visibleBuyInventoryWei * unitSellAmountWei, unitBuyAmountWei)
  };
};

const buildRecurringSwapCandidates = ({
  inputAmountWei,
  inputMode,
  trade,
  sellKey,
  buyKey
}: {
  inputAmountWei: bigint;
  inputMode: OtcSwapInputMode;
  trade: TradeSnapshot;
  sellKey: string;
  buyKey: string;
}): OtcSwapQuoteCandidate[] => {
  const recurring = trade.recurringOrder;
  if (
    !recurring ||
    trade.status !== 'open' ||
    recurring.recurringStatus !== 'active' ||
    normalizeAddress(trade.escrowContract || RECURRING_OTC_CONTRACT_ADDRESS) !== normalizeAddress(RECURRING_OTC_CONTRACT_ADDRESS)
  ) {
    return [];
  }

  const baseAsset = normalizeSwapAsset(recurring.baseAsset);
  const quoteAsset = normalizeSwapAsset(recurring.quoteAsset);
  if (baseAsset.key === quoteAsset.key) {
    return [];
  }

  const candidates: OtcSwapQuoteCandidate[] = [];
  const maybeAddCandidate = ({
    buyAsset,
    displayAction,
    fillSide,
    isOpen,
    sellAsset,
    unitBuyAmountWei,
    unitSellAmountWei,
    visibleBuyInventoryWei
  }: {
    buyAsset: NormalizedOfferAsset;
    displayAction: 'sell' | 'buy';
    fillSide: 'buy' | 'sell';
    isOpen: boolean;
    sellAsset: NormalizedOfferAsset;
    unitBuyAmountWei: bigint;
    unitSellAmountWei: bigint;
    visibleBuyInventoryWei: bigint;
  }) => {
    if (!isOpen || sellAsset.key !== sellKey || buyAsset.key !== buyKey || unitBuyAmountWei <= 0n || unitSellAmountWei <= 0n) {
      return;
    }
    const amounts = buildAmountsForTerms({
      inputAmountWei,
      inputMode,
      unitBuyAmountWei,
      unitSellAmountWei
    });
    const availability = buildRecurringAvailability({
      recurringMode: recurring.mode,
      unitBuyAmountWei,
      unitSellAmountWei,
      visibleBuyInventoryWei
    });
    candidates.push({
      trade,
      tradeId: recurring.orderId,
      tradeKey: getSnapshotKey(trade),
      escrowContract: trade.escrowContract || RECURRING_OTC_CONTRACT_ADDRESS,
      sourceType: 'recurring',
      recurringSide: fillSide,
      sellToken: sellAsset,
      buyToken: buyAsset,
      ...amounts,
      complete: isKnownAmountComplete({
        availability,
        estimatedBuyAmountWei: amounts.estimatedBuyAmountWei,
        estimatedSellAmountWei: amounts.estimatedSellAmountWei,
        inputAmountWei
      }),
      price: calculateSellPerBuyPrice({
        buyAmount: unitBuyAmountWei,
        buyDecimals: buyAsset.decimals,
        sellAmount: unitSellAmountWei,
        sellDecimals: sellAsset.decimals
      }),
      priceScale: PRICE_SCALE,
      availability,
      terminalPrefill: {
        kind: 'recurring',
        displayAction,
        fillSide,
        amountWei: amounts.estimatedSellAmountWei
      }
    });
  };

  const buyBaseAmount = parsePositiveAmount(recurring.buyTerms.baseAmount);
  const buyQuoteAmount = parsePositiveAmount(recurring.buyTerms.quoteAmount);
  maybeAddCandidate({
    buyAsset: quoteAsset,
    displayAction: 'sell',
    fillSide: 'buy',
    isOpen: recurring.buySideOpen,
    sellAsset: baseAsset,
    unitBuyAmountWei: buyQuoteAmount,
    unitSellAmountWei: buyBaseAmount,
    visibleBuyInventoryWei: parsePositiveAmount(recurring.publicQuoteInventory)
  });

  const sellBaseAmount = parsePositiveAmount(recurring.sellTerms.baseAmount);
  const sellQuoteAmount = parsePositiveAmount(recurring.sellTerms.quoteAmount);
  maybeAddCandidate({
    buyAsset: baseAsset,
    displayAction: 'buy',
    fillSide: 'sell',
    isOpen: recurring.sellSideOpen,
    sellAsset: quoteAsset,
    unitBuyAmountWei: sellBaseAmount,
    unitSellAmountWei: sellQuoteAmount,
    visibleBuyInventoryWei: parsePositiveAmount(recurring.publicBaseInventory)
  });

  return candidates;
};

export const quoteBestSingleOtcSwap = ({
  includePrivateOtcQuotes = false,
  inputAmountWei,
  inputMode,
  buyToken,
  sellToken,
  trades
}: {
  includePrivateOtcQuotes?: boolean;
  inputAmountWei: bigint;
  inputMode: OtcSwapInputMode;
  buyToken: ResolvedTradeToken | TradeAssetPayload;
  sellToken: ResolvedTradeToken | TradeAssetPayload;
  trades: TradeSnapshot[];
}): OtcSwapQuoteResult => {
  const sellKey = getOtcSwapAssetKey(sellToken);
  const buyKey = getOtcSwapAssetKey(buyToken);
  if (!sellKey || !buyKey || sellKey === buyKey) {
    return { best: null, compatibleCount: 0, otherCompatibleCount: 0 };
  }

  const candidates: OtcSwapQuoteCandidate[] = [];
  for (const trade of trades) {
    const standardCandidate = buildStandardSwapCandidate({
      includePrivateOtcQuotes,
      inputAmountWei,
      inputMode,
      trade,
      sellKey,
      buyKey
    });
    if (standardCandidate) {
      candidates.push(standardCandidate);
    }
    candidates.push(...buildRecurringSwapCandidates({ inputAmountWei, inputMode, trade, sellKey, buyKey }));
  }

  candidates.sort(compareSwapCandidates);
  return {
    best: candidates[0] ?? null,
    compatibleCount: candidates.length,
    otherCompatibleCount: Math.max(0, candidates.length - 1)
  };
};

export const getOtcSwapSourceLabel = (sourceType: OtcSwapSourceType): string =>
  sourceType === 'recurring' ? 'Recurring OTC' : 'One-off OTC';

export { PRICE_SCALE as OTC_SWAP_PRICE_SCALE };
