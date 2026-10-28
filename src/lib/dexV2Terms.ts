const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export type DexV2SwapDirection = 'base-to-quote' | 'quote-to-base';
export type DexV2LimitMakerSide = 'sell-base' | 'sell-quote';

export type DexV2Tick = Readonly<{
  rank: number;
  quoteNumerator: bigint;
  baseDenominator: bigint;
}>;

const RATIOS = Object.freeze([
  [3n, 4n],
  [997n, 1_250n],
  [800n, 997n],
  [17n, 20n],
  [8_973n, 10_000n],
  [900n, 997n],
  [19n, 20n],
  [997n, 1_000n],
  [1_000n, 997n],
  [21n, 20n],
  [10_967n, 10_000n],
  [1_100n, 997n],
  [23n, 20n],
  [5n, 4n],
  [13n, 10n],
  [7n, 5n]
] as const);

export const DEX_V2_TICKS: readonly DexV2Tick[] = Object.freeze(
  RATIOS.map(([quoteNumerator, baseDenominator], rank) => Object.freeze({
    rank,
    quoteNumerator,
    baseDenominator
  }))
);

const unsigned = (value: bigint, label: string, maximum: bigint): bigint => {
  if (typeof value !== 'bigint' || value < 0n || value > maximum) {
    throw new Error(`${label} is out of range.`);
  }
  return value;
};

const rank = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0 || value > 15) {
    throw new Error(`${label} must be an integer from 0 through 15.`);
  }
  return value;
};

export const getDexV2TickQuanta = (
  tickRank: number,
  direction: DexV2SwapDirection
): Readonly<{ inputLots: bigint; outputLots: bigint }> => {
  const tick = DEX_V2_TICKS[rank(tickRank, 'DEX V2 tick rank')];
  return direction === 'quote-to-base'
    ? Object.freeze({ inputLots: tick.quoteNumerator, outputLots: tick.baseDenominator })
    : Object.freeze({ inputLots: tick.baseDenominator, outputLots: tick.quoteNumerator });
};

/** Formats the exact public quote/base ratio without floating-point rounding. */
export const formatDexV2TickPrice = (tickRank: number, fractionDigits = 4): string => {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 12) {
    throw new Error('DEX V2 tick price precision must be an integer from 0 through 12.');
  }
  const tick = DEX_V2_TICKS[rank(tickRank, 'DEX V2 tick rank')];
  const scale = 10n ** BigInt(fractionDigits);
  const scaled = (tick.quoteNumerator * scale) / tick.baseDenominator;
  if (fractionDigits === 0) return scaled.toString();
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(fractionDigits, '0');
  return `${whole}.${fraction}`;
};

export const packDexV2Uint32Pair = (high: bigint, low: bigint): bigint =>
  (unsigned(high, 'DEX V2 high uint32', UINT32_MAX) << 32n) |
  unsigned(low, 'DEX V2 low uint32', UINT32_MAX);

export const unpackDexV2Uint32Pair = (
  packed: bigint
): Readonly<{ high: bigint; low: bigint }> => {
  const value = unsigned(packed, 'DEX V2 packed uint64', UINT64_MAX);
  return Object.freeze({ high: value >> 32n, low: value & UINT32_MAX });
};

export const packDexV2PoolDepositLots = (baseLots: bigint, quoteLots: bigint): bigint => {
  if (baseLots === 0n || quoteLots === 0n) throw new Error('DEX V2 Pool deposits require both token lots.');
  return packDexV2Uint32Pair(baseLots, quoteLots);
};

export const packDexV2LiquidityAdditionLots = (baseLots: bigint, quoteLots: bigint): bigint => {
  if (baseLots === 0n && quoteLots === 0n) throw new Error('DEX V2 liquidity additions cannot be empty.');
  return packDexV2Uint32Pair(baseLots, quoteLots);
};

export const packDexV2LimitTerms = ({
  makerSide,
  tickRank,
  minimumFillQuanta,
  inventoryLots
}: {
  makerSide: DexV2LimitMakerSide;
  tickRank: number;
  minimumFillQuanta: bigint;
  inventoryLots: bigint;
}): bigint => {
  const normalizedRank = rank(tickRank, 'DEX V2 Limit tick rank');
  const inventory = unsigned(inventoryLots, 'DEX V2 Limit inventory', UINT32_MAX);
  const minimum = unsigned(minimumFillQuanta, 'DEX V2 Limit minimum fill', 63n);
  if (inventory === 0n) throw new Error('DEX V2 Limit inventory cannot be zero.');
  const traderDirection: DexV2SwapDirection = makerSide === 'sell-base'
    ? 'quote-to-base'
    : makerSide === 'sell-quote'
      ? 'base-to-quote'
      : (() => { throw new Error('DEX V2 Limit maker side is invalid.'); })();
  const outputQuantum = getDexV2TickQuanta(normalizedRank, traderDirection).outputLots;
  if (inventory < outputQuantum || inventory >= outputQuantum * 64n) {
    throw new Error('DEX V2 Limit inventory is outside its executable 1-63 quantum range.');
  }
  if (minimum * outputQuantum > inventory) {
    throw new Error('DEX V2 Limit minimum fill exceeds funded inventory.');
  }
  const encodedSide = traderDirection === 'quote-to-base' ? 0n : 1n;
  return (inventory << 32n) |
    (minimum << 5n) |
    (BigInt(normalizedRank) << 1n) |
    encodedSide;
};

export const packDexV2RecurringRanks = (buyTickRank: number, sellTickRank: number): bigint => {
  const buy = rank(buyTickRank, 'DEX V2 Recurring buy tick rank');
  const sell = rank(sellTickRank, 'DEX V2 Recurring sell tick rank');
  if (buy <= sell) throw new Error('DEX V2 Recurring buy rank must be greater than its sell rank.');
  return (BigInt(sell) << 4n) | BigInt(buy);
};

export const packDexV2RecurringInventories = ({
  buyTickRank,
  sellTickRank,
  baseInventoryLots,
  quoteInventoryLots
}: {
  buyTickRank: number;
  sellTickRank: number;
  baseInventoryLots: bigint;
  quoteInventoryLots: bigint;
}): bigint => {
  packDexV2RecurringRanks(buyTickRank, sellTickRank);
  const base = unsigned(baseInventoryLots, 'DEX V2 Recurring base inventory', UINT32_MAX);
  const quote = unsigned(quoteInventoryLots, 'DEX V2 Recurring quote inventory', UINT32_MAX);
  const buyOutput = getDexV2TickQuanta(buyTickRank, 'quote-to-base').outputLots;
  const sellOutput = getDexV2TickQuanta(sellTickRank, 'base-to-quote').outputLots;
  if (base < buyOutput || base >= buyOutput * 64n) {
    throw new Error('DEX V2 Recurring base inventory is outside its executable range.');
  }
  if (quote < sellOutput || quote >= sellOutput * 64n) {
    throw new Error('DEX V2 Recurring quote inventory is outside its executable range.');
  }
  return packDexV2Uint32Pair(base, quote);
};

export const packDexV2SwapLots = (
  maximumInputLots: bigint,
  minimumInputFilledLots: bigint
): bigint => {
  const maximum = unsigned(maximumInputLots, 'DEX V2 maximum swap input', UINT32_MAX);
  const minimum = unsigned(minimumInputFilledLots, 'DEX V2 minimum filled input', UINT32_MAX);
  if (maximum === 0n) throw new Error('DEX V2 maximum swap input cannot be zero.');
  if (minimum > maximum) throw new Error('DEX V2 minimum filled input cannot exceed its maximum input.');
  return packDexV2Uint32Pair(maximum, minimum);
};

export const dexV2DirectionCode = (direction: DexV2SwapDirection): 0 | 1 => {
  if (direction === 'base-to-quote') return 0;
  if (direction === 'quote-to-base') return 1;
  throw new Error('DEX V2 swap direction is invalid.');
};

export const scaleDexV2LotsToRaw = (lots: bigint, lotSize: bigint): bigint => {
  const normalizedLots = unsigned(lots, 'DEX V2 lots', UINT64_MAX);
  const normalizedLotSize = unsigned(lotSize, 'DEX V2 lot size', UINT128_MAX);
  if (normalizedLotSize === 0n) throw new Error('DEX V2 lot size cannot be zero.');
  const raw = normalizedLots * normalizedLotSize;
  if (raw > UINT256_MAX) throw new Error('DEX V2 lot scaling exceeds uint256.');
  return raw;
};

const tokenScale = (decimals: number): bigint => {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('DEX V2 token decimals are out of range.');
  }
  return 10n ** BigInt(decimals);
};

/** Converts a human token amount into the contract's exact settlement-lot domain. */
export const parseDexV2TokenAmountToLots = (
  amount: string,
  decimals: number,
  lotSize: bigint
): bigint => {
  if (typeof amount !== 'string' || amount !== amount.trim() || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)) {
    throw new Error('Enter a canonical token amount.');
  }
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > decimals) throw new Error(`Token amount supports at most ${decimals} decimals.`);
  const raw = BigInt(whole) * tokenScale(decimals) + BigInt((fraction || '').padEnd(decimals, '0') || '0');
  const normalizedLotSize = unsigned(lotSize, 'DEX V2 lot size', UINT128_MAX);
  if (normalizedLotSize === 0n) throw new Error('DEX V2 lot size cannot be zero.');
  if (raw === 0n) throw new Error('DEX V2 token amount cannot be zero.');
  if (raw % normalizedLotSize !== 0n) {
    throw new Error('Token amount must be an exact settlement-lot multiple.');
  }
  return unsigned(raw / normalizedLotSize, 'DEX V2 token amount lots', UINT32_MAX);
};

/** Formats settlement lots for the token-facing UI without using floating point. */
export const formatDexV2LotsAsTokenAmount = (
  lots: bigint,
  decimals: number,
  lotSize: bigint
): string => {
  const raw = scaleDexV2LotsToRaw(lots, lotSize);
  const scale = tokenScale(decimals);
  const whole = raw / scale;
  const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

export const quoteDexV2LimitOutputLots = (
  maximumInputLots: bigint,
  tickRank: number,
  direction: DexV2SwapDirection
): bigint => {
  const maximum = unsigned(maximumInputLots, 'DEX V2 maximum swap input', UINT32_MAX);
  const { inputLots, outputLots } = getDexV2TickQuanta(tickRank, direction);
  return (maximum * outputLots) / inputLots;
};
