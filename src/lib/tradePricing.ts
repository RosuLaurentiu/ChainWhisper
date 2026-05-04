export type TradePricingField = 'baseAmount' | 'quoteAmount' | 'price';

export type TradePricingInputs = {
  baseAmountInput: string;
  quoteAmountInput: string;
  priceInput: string;
  baseDecimals: number;
  quoteDecimals: number;
  editedFields: TradePricingField[];
};

export type TradePricingUpdate = {
  field: TradePricingField;
  value: string;
  sourceFields: [TradePricingField, TradePricingField];
};

const PRICE_DECIMALS = 18;
const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS);
const PRICING_FIELDS: TradePricingField[] = ['baseAmount', 'quoteAmount', 'price'];
export type RecurringCalculatorSide = 'buy' | 'sell';

const normalizeDecimals = (decimals: number): number => {
  if (!Number.isFinite(decimals)) return 18;
  return Math.max(0, Math.min(36, Math.trunc(decimals)));
};

const scaleForDecimals = (decimals: number): bigint => 10n ** BigInt(normalizeDecimals(decimals));

const parseDecimalInput = (input: string, decimals: number): bigint | null => {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return null;
  }

  const safeDecimals = normalizeDecimals(decimals);
  const [wholeChunk, fractionChunk = ''] = trimmed.split('.');
  if (fractionChunk.length > safeDecimals) {
    return null;
  }

  try {
    const whole = BigInt(wholeChunk);
    const fraction =
      safeDecimals > 0 ? BigInt(`${fractionChunk}${'0'.repeat(safeDecimals)}`.slice(0, safeDecimals) || '0') : 0n;
    return whole * scaleForDecimals(safeDecimals) + fraction;
  } catch {
    return null;
  }
};

export const formatDecimalInput = (value: bigint, decimals: number, maxFractionDigits = 18): string => {
  const safeDecimals = normalizeDecimals(decimals);
  const scale = scaleForDecimals(safeDecimals);
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n || safeDecimals === 0) {
    return whole.toString();
  }

  const fractionLimit = Math.max(0, Math.min(safeDecimals, maxFractionDigits));
  let fractionText = fraction.toString().padStart(safeDecimals, '0');
  if (fractionLimit < safeDecimals) {
    fractionText = fractionText.slice(0, fractionLimit);
  }
  fractionText = fractionText.replace(/0+$/u, '');
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
};

export const nextTradePricingEditedFields = (
  previous: TradePricingField[],
  field: TradePricingField
): TradePricingField[] => [...previous.filter((value) => value !== field), field].slice(-2);

export const deriveTradePricingUpdate = ({
  baseAmountInput,
  quoteAmountInput,
  priceInput,
  baseDecimals,
  quoteDecimals,
  editedFields
}: TradePricingInputs): TradePricingUpdate | null => {
  const filledFields = PRICING_FIELDS.filter((field) => {
    if (field === 'baseAmount') return baseAmountInput.trim();
    if (field === 'quoteAmount') return quoteAmountInput.trim();
    return priceInput.trim();
  });
  const targetField =
    editedFields.length >= 2
      ? PRICING_FIELDS.find((field) => !editedFields.slice(-2).includes(field))
      : editedFields.length === 0 && filledFields.length === 2
        ? PRICING_FIELDS.find((field) => !filledFields.includes(field))
        : undefined;
  if (!targetField) {
    return null;
  }

  const baseAmountWei = parseDecimalInput(baseAmountInput, baseDecimals);
  const quoteAmountWei = parseDecimalInput(quoteAmountInput, quoteDecimals);
  const priceScaled = parseDecimalInput(priceInput, PRICE_DECIMALS);
  const baseScale = scaleForDecimals(baseDecimals);
  const quoteScale = scaleForDecimals(quoteDecimals);

  if (targetField === 'price') {
    if (!baseAmountWei || !quoteAmountWei || baseAmountWei <= 0n || quoteAmountWei <= 0n) {
      return null;
    }
    const nextPrice = (quoteAmountWei * baseScale * PRICE_SCALE) / (baseAmountWei * quoteScale);
    if (nextPrice <= 0n) {
      return null;
    }
    const value = formatDecimalInput(nextPrice, PRICE_DECIMALS, 12);
    return value === priceInput ? null : { field: 'price', value, sourceFields: ['baseAmount', 'quoteAmount'] };
  }

  if (targetField === 'quoteAmount') {
    if (!baseAmountWei || !priceScaled || baseAmountWei <= 0n || priceScaled <= 0n) {
      return null;
    }
    const nextQuoteAmount = (baseAmountWei * priceScaled * quoteScale) / (baseScale * PRICE_SCALE);
    if (nextQuoteAmount <= 0n) {
      return null;
    }
    const value = formatDecimalInput(nextQuoteAmount, quoteDecimals);
    return value === quoteAmountInput
      ? null
      : { field: 'quoteAmount', value, sourceFields: ['baseAmount', 'price'] };
  }

  if (!quoteAmountWei || !priceScaled || quoteAmountWei <= 0n || priceScaled <= 0n) {
    return null;
  }
  const nextBaseAmount = (quoteAmountWei * baseScale * PRICE_SCALE) / (priceScaled * quoteScale);
  if (nextBaseAmount <= 0n) {
    return null;
  }
  const value = formatDecimalInput(nextBaseAmount, baseDecimals);
  return value === baseAmountInput ? null : { field: 'baseAmount', value, sourceFields: ['quoteAmount', 'price'] };
};

export const deriveRecurringReceiveAmountInput = ({
  side,
  liquidityInput,
  priceInput,
  baseDecimals,
  quoteDecimals
}: {
  side: RecurringCalculatorSide;
  liquidityInput: string;
  priceInput: string;
  baseDecimals: number;
  quoteDecimals: number;
}): string => {
  const priceScaled = parseDecimalInput(priceInput, PRICE_DECIMALS);
  if (!priceScaled || priceScaled <= 0n) {
    return '';
  }

  const baseScale = scaleForDecimals(baseDecimals);
  const quoteScale = scaleForDecimals(quoteDecimals);
  if (side === 'buy') {
    const quoteLiquidityWei = parseDecimalInput(liquidityInput, quoteDecimals);
    if (!quoteLiquidityWei || quoteLiquidityWei <= 0n) {
      return '';
    }
    const baseReceivedWei = (quoteLiquidityWei * baseScale * PRICE_SCALE) / (priceScaled * quoteScale);
    return baseReceivedWei > 0n ? formatDecimalInput(baseReceivedWei, baseDecimals) : '';
  }

  const baseLiquidityWei = parseDecimalInput(liquidityInput, baseDecimals);
  if (!baseLiquidityWei || baseLiquidityWei <= 0n) {
    return '';
  }
  const quoteReceivedWei = (baseLiquidityWei * priceScaled * quoteScale) / (baseScale * PRICE_SCALE);
  return quoteReceivedWei > 0n ? formatDecimalInput(quoteReceivedWei, quoteDecimals) : '';
};

export const deriveRecurringLiquidityInputFromReceive = ({
  side,
  receiveInput,
  priceInput,
  baseDecimals,
  quoteDecimals
}: {
  side: RecurringCalculatorSide;
  receiveInput: string;
  priceInput: string;
  baseDecimals: number;
  quoteDecimals: number;
}): string => {
  const priceScaled = parseDecimalInput(priceInput, PRICE_DECIMALS);
  if (!priceScaled || priceScaled <= 0n) {
    return '';
  }

  const baseScale = scaleForDecimals(baseDecimals);
  const quoteScale = scaleForDecimals(quoteDecimals);
  if (side === 'buy') {
    const baseReceivedWei = parseDecimalInput(receiveInput, baseDecimals);
    if (!baseReceivedWei || baseReceivedWei <= 0n) {
      return '';
    }
    const quoteLiquidityWei = (baseReceivedWei * priceScaled * quoteScale) / (baseScale * PRICE_SCALE);
    return quoteLiquidityWei > 0n ? formatDecimalInput(quoteLiquidityWei, quoteDecimals) : '';
  }

  const quoteReceivedWei = parseDecimalInput(receiveInput, quoteDecimals);
  if (!quoteReceivedWei || quoteReceivedWei <= 0n) {
    return '';
  }
  const baseLiquidityWei = (quoteReceivedWei * baseScale * PRICE_SCALE) / (priceScaled * quoteScale);
  return baseLiquidityWei > 0n ? formatDecimalInput(baseLiquidityWei, baseDecimals) : '';
};
