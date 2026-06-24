import type { OtcSwapInputMode } from './otcSwapQuote';
import { getOtcSwapAssetKey, OTC_SWAP_PRICE_SCALE, type OtcSwapQuoteCandidate } from './otcSwapQuote';
import { formatTokenAmount, type TradeAssetPayload } from './appShared';
import type { OtcSwapFillNote } from './otcSwapIntent';
import { formatTradeRatioLabel, type TradePriceRatioDisplay } from './tradePerspective';

export type OtcSwapActionState = {
  inputMode: OtcSwapInputMode;
  sellTokenSelection: string;
  buyTokenSelection: string;
  sellAmountInput: string;
  buyAmountInput: string;
};

export type OtcSwapLinkedActionModes = Record<OtcSwapInputMode, boolean>;

export type OtcSwapLimitPrefill = {
  offerTokenSelection: string;
  requestTokenSelection: string;
};

type OtcSwapSelectionPair = {
  baseSelection: string;
  quoteSelection: string;
};

// The Swap ticket mirrors the terminal model: Sell/Buy changes the action side,
// while the token flip is the only control that reverses the displayed basis.
const getDisplayPairForActionState = (state: OtcSwapActionState): OtcSwapSelectionPair =>
  state.inputMode === 'buy'
    ? {
        baseSelection: state.buyTokenSelection,
        quoteSelection: state.sellTokenSelection
      }
    : {
        baseSelection: state.sellTokenSelection,
        quoteSelection: state.buyTokenSelection
      };

const applyDisplayPairToActionState = (
  state: OtcSwapActionState,
  pair: OtcSwapSelectionPair,
  actionMode: OtcSwapInputMode
): OtcSwapActionState => ({
  ...state,
  inputMode: actionMode,
  sellTokenSelection: actionMode === 'buy' ? pair.quoteSelection : pair.baseSelection,
  buyTokenSelection: actionMode === 'buy' ? pair.baseSelection : pair.quoteSelection,
  sellAmountInput: '',
  buyAmountInput: ''
});

export const resolveSwapTokenFlip = (state: OtcSwapActionState): OtcSwapActionState => {
  const pair = getDisplayPairForActionState(state);
  return applyDisplayPairToActionState(
    state,
    {
      baseSelection: pair.quoteSelection,
      quoteSelection: pair.baseSelection
    },
    state.inputMode
  );
};

export const getOtcSwapLinkedActionModes = (
  trade?: { recurringOrder?: { buySideOpen?: boolean; sellSideOpen?: boolean } | null } | null
): OtcSwapLinkedActionModes => {
  if (!trade) {
    return { sell: true, buy: true };
  }

  const recurring = trade.recurringOrder;
  if (!recurring) {
    return { sell: true, buy: true };
  }

  return {
    sell: Boolean(recurring.buySideOpen),
    buy: Boolean(recurring.sellSideOpen)
  };
};

export const resolveOtcSwapLinkedActionMode = (
  currentMode: OtcSwapInputMode,
  availableModes: OtcSwapLinkedActionModes
): OtcSwapInputMode => {
  if (availableModes[currentMode]) {
    return currentMode;
  }
  if (availableModes.sell) {
    return 'sell';
  }
  if (availableModes.buy) {
    return 'buy';
  }
  return currentMode;
};

export const resolveSwapActionModeChange = (
  state: OtcSwapActionState,
  nextMode: OtcSwapInputMode
): OtcSwapActionState => {
  if (state.inputMode === nextMode) {
    return state;
  }

  return applyDisplayPairToActionState(state, getDisplayPairForActionState(state), nextMode);
};

export const resolveSwapLimitPrefill = (state: OtcSwapActionState): OtcSwapLimitPrefill => ({
  offerTokenSelection: state.sellTokenSelection,
  requestTokenSelection: state.buyTokenSelection
});

const tokenUnitWei = (decimals: number): bigint => {
  const safeDecimals = Number.isFinite(decimals) ? Math.max(0, Math.min(36, Math.trunc(decimals))) : 18;
  return 10n ** BigInt(safeDecimals);
};

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  denominator <= 0n || numerator <= 0n ? 0n : (numerator + denominator - 1n) / denominator;

const quoteAssetToPayload = (
  asset: OtcSwapQuoteCandidate['sellToken'] | OtcSwapQuoteCandidate['buyToken'],
  amount: bigint
): TradeAssetPayload => ({
  kind: asset.kind,
  tokenAddress: asset.tokenAddress,
  symbol: asset.symbol,
  decimals: asset.decimals,
  amount: amount.toString()
});

export const resolveOtcSwapPriceRatioDisplay = (
  quote: OtcSwapQuoteCandidate | null | undefined,
  inputMode: OtcSwapInputMode,
  toggleInverse = false
): TradePriceRatioDisplay | null => {
  if (!quote || quote.price <= 0n) {
    return null;
  }

  const sellUnit = tokenUnitWei(quote.sellToken.decimals);
  const buyUnit = tokenUnitWei(quote.buyToken.decimals);
  const sellAmountForOneBuy = ceilDiv(quote.price * sellUnit, OTC_SWAP_PRICE_SCALE);
  const buyAmountForOneSell = ceilDiv(buyUnit * OTC_SWAP_PRICE_SCALE, quote.price);
  if (buyUnit <= 0n || sellUnit <= 0n || sellAmountForOneBuy <= 0n || buyAmountForOneSell <= 0n) {
    return null;
  }

  const baseAsset =
    inputMode === 'buy'
      ? quoteAssetToPayload(quote.buyToken, buyUnit)
      : quoteAssetToPayload(quote.sellToken, sellUnit);
  const quoteAsset =
    inputMode === 'buy'
      ? quoteAssetToPayload(quote.sellToken, sellAmountForOneBuy)
      : quoteAssetToPayload(quote.buyToken, buyAmountForOneSell);
  const basisLabel = `${quoteAsset.symbol}/${baseAsset.symbol}`;
  const inverseBasisLabel = `${baseAsset.symbol}/${quoteAsset.symbol}`;
  const forwardLabel = formatTradeRatioLabel(baseAsset, quoteAsset) ?? basisLabel;
  const reverseLabel = formatTradeRatioLabel(quoteAsset, baseAsset) ?? inverseBasisLabel;
  const label = toggleInverse ? reverseLabel : forwardLabel;
  const currentBasisLabel = toggleInverse ? inverseBasisLabel : basisLabel;
  const nextBasisLabel = toggleInverse ? basisLabel : inverseBasisLabel;

  return {
    label,
    basisLabel: currentBasisLabel,
    nextBasisLabel,
    isReversed: toggleInverse,
    toggleTitle: `Switch swap price ratio to ${nextBasisLabel}`,
    ariaLabel: `Swap price ratio for order ${quote.tradeId}. Current ratio: ${label}.`
  };
};

export const formatOtcSwapAvailabilityLabel = (
  quote: OtcSwapQuoteCandidate | null | undefined,
  inputMode: OtcSwapInputMode,
  inputAmountWei = 0n,
  precision = 6
): string => {
  if (!quote) {
    return '--';
  }
  if (quote.availability.kind !== 'known') {
    return 'Private liquidity';
  }

  const asset = inputMode === 'buy' ? quote.buyToken : quote.sellToken;
  const amountWei =
    inputMode === 'buy' ? quote.availability.maxBuyAmountWei : quote.availability.maxSellAmountWei;
  const formattedAmount = `${formatTokenAmount(amountWei, asset.decimals, precision)} ${asset.symbol}`;
  return quote.complete || inputAmountWei <= 0n
    ? `Up to ${formattedAmount}`
    : `Only ${formattedAmount} at this price`;
};

type OtcSwapFillHistoryAsset = TradeAssetPayload & {
  visible: boolean;
};

export type OtcSwapFillHistoryRow = {
  bought: OtcSwapFillHistoryAsset;
  role?: 'maker' | 'taker' | 'filler';
  sold: OtcSwapFillHistoryAsset;
};

const parseOtcSwapNoteAmount = (value: string): bigint => {
  try {
    return /^\d+$/.test(value) ? BigInt(value) : 0n;
  } catch {
    return 0n;
  }
};

export const formatOtcSwapFillHistoryNote = (
  note: OtcSwapFillNote | null | undefined,
  row: OtcSwapFillHistoryRow,
  precision = 6
): string => {
  if (!note) {
    return '';
  }
  if (row.role === 'maker') {
    return '';
  }

  const requestedAmount = parseOtcSwapNoteAmount(note.requestedAmountWei);
  const requestedLabel = `${formatTokenAmount(requestedAmount, note.requestedDecimals, precision)} ${note.requestedSymbol}`;
  const actualAsset = note.requestedRole === 'sold' ? row.sold : row.bought;
  const actualAmount =
    actualAsset.visible && getOtcSwapAssetKey(actualAsset) === note.requestedAssetKey
      ? parseOtcSwapNoteAmount(actualAsset.amount)
      : 0n;
  const actualLabel =
    actualAmount > 0n
      ? `${formatTokenAmount(actualAmount, actualAsset.decimals, precision)} ${actualAsset.symbol}`
      : '';

  if (note.privateLiquidity) {
    if (actualAmount > 0n) {
      return requestedAmount > actualAmount
        ? `Requested ${requestedLabel}, filled ${actualLabel}. Private liquidity only filled the amount available on this order.`
        : `Requested ${requestedLabel}, filled ${actualLabel} from private liquidity.`;
    }
    return `Requested ${requestedLabel}. Private liquidity can fill less than requested; exact fill is shown when revealable.`;
  }

  if (actualAmount > 0n && requestedAmount > actualAmount) {
    return `Requested ${requestedLabel}, filled ${actualLabel} on this order.`;
  }
  return `Requested ${requestedLabel} on this order.`;
};
