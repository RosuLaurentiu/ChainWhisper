const DECIMAL = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-f]{64}$/;
const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const MAX_TOKEN_DECIMALS = 36;

export type PrivateLiquidityDailyPriceSnapshot = Readonly<{
  day: string;
  capturedAt: string;
  sourceBlockNumber: string;
  sourceLogIndex: number;
  direction: 0 | 1;
  revision: string;
  priceBaseAmount: string;
  priceQuoteAmount: string;
  swapId: string;
  positionId: string;
  sourceBlockHash: string;
  sourceTransactionHash: string;
}>;

export type PrivateLiquidityDailyPricePoint = Readonly<{
  day: string;
  capturedAt: string;
  timestamp: number;
  direction: 0 | 1;
  revision: string;
  price: number;
  priceLabel: string;
  sourceBlockNumber: string;
  sourceTransactionHash: string;
}>;

export const PRIVATE_LIQUIDITY_DAILY_PRICE_DEMO_SEED = 0x57a11e;
export const PRIVATE_LIQUIDITY_DAILY_PRICE_DEMO_ASSUMPTIONS = Object.freeze({
  label: 'Illustrative demo',
  days: 90,
  startingPrice: 1,
  unit: 'quote per base',
  model: 'seeded low-volatility trend with one illustrative repricing event and deterministic no-trade gaps'
});

export type PrivateLiquidityDailyPriceDemoPoint = Readonly<{
  day: string;
  timestamp: number;
  direction: 0 | 1;
  price: number;
  priceLabel: string;
  simulation: 'illustrative-v1';
}>;

export type PrivateLiquidityDailyPriceChartPoint =
  | PrivateLiquidityDailyPricePoint
  | PrivateLiquidityDailyPriceDemoPoint;

export type PrivateLiquidityDailyPricePresentation = Readonly<{
  mode: 'demo' | 'live';
  status: 'loading' | 'ready' | 'error';
  points: readonly PrivateLiquidityDailyPriceChartPoint[];
}>;

const decimal = (value: string, label: string, max: bigint): bigint => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error(`${label} must be canonical decimal.`);
  const parsed = BigInt(value);
  if (parsed > max) throw new Error(`${label} exceeds its bound.`);
  return parsed;
};

const nonzeroBytes32 = (value: string, label: string): string => {
  const normalized = value.toLowerCase();
  if (!BYTES32.test(normalized) || /^0x0{64}$/.test(normalized)) {
    throw new Error(`${label} must be nonzero bytes32.`);
  }
  return normalized;
};

const decimals = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKEN_DECIMALS) {
    throw new Error(`${label} must be between 0 and ${MAX_TOKEN_DECIMALS}.`);
  }
  return value;
};

const pow10 = (value: number): bigint => 10n ** BigInt(value);

const demoPriceLabel = (value: number): string => value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');

/** Gives every reviewed pair a stable illustrative curve without adding market-like provenance. */
export const derivePrivateLiquidityDailyPriceDemoSeed = (pairKey: string): number => {
  const normalized = pairKey.toLowerCase();
  if (!BYTES32.test(normalized) || /^0x0{64}$/.test(normalized)) {
    throw new Error('Daily marginal-price demo pair must be nonzero bytes32.');
  }
  let seed = PRIVATE_LIQUIDITY_DAILY_PRICE_DEMO_SEED;
  for (let offset = 2; offset < normalized.length; offset += 8) {
    seed ^= Number.parseInt(normalized.slice(offset, offset + 8), 16) >>> 0;
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
  }
  return seed || PRIVATE_LIQUIDITY_DAILY_PRICE_DEMO_SEED;
};

/** Deterministic illustrative data only. It deliberately carries no block or transaction provenance. */
export const buildPrivateLiquidityDailyPriceDemoSeries = ({
  endingDay,
  days = PRIVATE_LIQUIDITY_DAILY_PRICE_DEMO_ASSUMPTIONS.days,
  seed = PRIVATE_LIQUIDITY_DAILY_PRICE_DEMO_SEED
}: {
  endingDay: bigint;
  days?: number;
  seed?: number;
}): readonly PrivateLiquidityDailyPriceDemoPoint[] => {
  if (!Number.isSafeInteger(days) || days < 30 || days > 366) {
    throw new Error('Daily marginal-price demo must cover between 30 and 366 days.');
  }
  if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffff_ffff) {
    throw new Error('Daily marginal-price demo seed must be a positive uint32.');
  }
  const firstDay = endingDay - BigInt(days - 1);
  if (firstDay < 0n || endingDay * 86_400n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Daily marginal-price demo range is not display-safe.');
  }
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
  let price: number = PRIVATE_LIQUIDITY_DAILY_PRICE_DEMO_ASSUMPTIONS.startingPrice;
  const repricingDay = Math.floor(days * 0.58);
  const points: PrivateLiquidityDailyPriceDemoPoint[] = [];
  for (let index = 0; index < days; index += 1) {
    const noise = (random() - 0.5) * 0.012;
    const cycle = Math.sin(index / 7.5) * 0.0035;
    const repricing = index === repricingDay ? 0.032 : index === repricingDay + 1 ? 0.012 : 0;
    price = Math.max(0.25, price * (1 + 0.0007 + cycle + noise + repricing));
    const isNoTradeGap = index > 0 && index < days - 1 && (index + seed % 23) % 29 === 0;
    if (isNoTradeGap) continue;
    const day = firstDay + BigInt(index);
    const timestamp = Number(day * 86_400n);
    const rounded = Number(price.toFixed(6));
    points.push(Object.freeze({
      day: day.toString(),
      timestamp,
      direction: random() >= 0.5 ? 0 : 1,
      price: rounded,
      priceLabel: demoPriceLabel(rounded),
      simulation: 'illustrative-v1'
    }));
  }
  return Object.freeze(points);
};

export const selectPrivateLiquidityDailyPricePresentation = ({
  status,
  livePoints,
  demoPoints
}: {
  status: 'inactive' | 'configuration-error' | 'loading' | 'ready' | 'error';
  livePoints: readonly PrivateLiquidityDailyPricePoint[];
  demoPoints: readonly PrivateLiquidityDailyPriceDemoPoint[];
}): PrivateLiquidityDailyPricePresentation => {
  if (status === 'ready' && livePoints.length > 0) {
    return Object.freeze({ mode: 'live', status: 'ready', points: livePoints });
  }
  if (status === 'inactive' || status === 'ready') {
    return Object.freeze({ mode: 'demo', status: 'ready', points: demoPoints });
  }
  return Object.freeze({
    mode: 'live',
    status: status === 'loading' ? 'loading' : 'error',
    points: Object.freeze([])
  });
};

const decimalRatio = ({
  numerator,
  denominator,
  significantDigits = 12
}: {
  numerator: bigint;
  denominator: bigint;
  significantDigits?: number;
}): { value: number; label: string } => {
  if (numerator <= 0n || denominator <= 0n) throw new Error('Daily marginal price ratio must be positive.');
  const scale = 10n ** BigInt(significantDigits);
  const scaled = (numerator * scale + denominator / 2n) / denominator;
  const integer = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(significantDigits, '0').replace(/0+$/, '');
  const label = fraction ? `${integer}.${fraction}` : integer.toString();
  const value = Number(label);
  if (!Number.isFinite(value) || value <= 0) throw new Error('Daily marginal price cannot be represented safely.');
  return { value, label };
};

export const normalizePrivateLiquidityDailyPriceSnapshot = (
  snapshot: PrivateLiquidityDailyPriceSnapshot
): PrivateLiquidityDailyPriceSnapshot => {
  const day = decimal(snapshot.day, 'Daily price day', UINT64_MAX);
  const capturedAt = decimal(snapshot.capturedAt, 'Daily price timestamp', UINT64_MAX);
  const sourceBlockNumber = decimal(snapshot.sourceBlockNumber, 'Daily price source block', UINT64_MAX);
  const revision = decimal(snapshot.revision, 'Daily price revision', UINT64_MAX);
  const priceBaseAmount = decimal(snapshot.priceBaseAmount, 'Daily base price amount', UINT128_MAX);
  const priceQuoteAmount = decimal(snapshot.priceQuoteAmount, 'Daily quote price amount', UINT128_MAX);
  const swapId = decimal(snapshot.swapId, 'Daily price swap ID', (1n << 256n) - 1n);
  const positionId = decimal(snapshot.positionId, 'Daily price position ID', (1n << 256n) - 1n);
  if (
    capturedAt / 86_400n !== day || sourceBlockNumber === 0n || revision === 0n ||
    priceBaseAmount === 0n || priceQuoteAmount === 0n || swapId === 0n || positionId === 0n
  ) {
    throw new Error('Daily marginal-price snapshot is incomplete.');
  }
  if (snapshot.direction !== 0 && snapshot.direction !== 1) throw new Error('Daily price direction is invalid.');
  if (!Number.isSafeInteger(snapshot.sourceLogIndex) || snapshot.sourceLogIndex < 0 ||
    BigInt(snapshot.sourceLogIndex) > UINT32_MAX) {
    throw new Error('Daily price source log index is invalid.');
  }
  return Object.freeze({
    day: day.toString(),
    capturedAt: capturedAt.toString(),
    sourceBlockNumber: sourceBlockNumber.toString(),
    sourceLogIndex: snapshot.sourceLogIndex,
    direction: snapshot.direction,
    revision: revision.toString(),
    priceBaseAmount: priceBaseAmount.toString(),
    priceQuoteAmount: priceQuoteAmount.toString(),
    swapId: swapId.toString(),
    positionId: positionId.toString(),
    sourceBlockHash: nonzeroBytes32(snapshot.sourceBlockHash, 'Daily price source block hash'),
    sourceTransactionHash: nonzeroBytes32(snapshot.sourceTransactionHash, 'Daily price source transaction hash')
  });
};

export const buildPrivateLiquidityDailyPriceSeries = ({
  snapshots,
  baseTokenDecimals,
  quoteTokenDecimals
}: {
  snapshots: readonly PrivateLiquidityDailyPriceSnapshot[];
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
}): readonly PrivateLiquidityDailyPricePoint[] => {
  const baseDecimals = decimals(baseTokenDecimals, 'Daily price base-token decimals');
  const quoteDecimals = decimals(quoteTokenDecimals, 'Daily price quote-token decimals');
  const byDay = new Map<string, PrivateLiquidityDailyPriceSnapshot>();
  for (const raw of snapshots) {
    const snapshot = normalizePrivateLiquidityDailyPriceSnapshot(raw);
    const previous = byDay.get(snapshot.day);
    if (!previous || BigInt(snapshot.revision) > BigInt(previous.revision)) {
      byDay.set(snapshot.day, snapshot);
    } else if (snapshot.revision === previous.revision && JSON.stringify(snapshot) !== JSON.stringify(previous)) {
      throw new Error('Daily marginal-price snapshots conflict at one day and revision.');
    }
  }
  return Object.freeze([...byDay.values()]
    .sort((left, right) => BigInt(left.day) < BigInt(right.day) ? -1 : 1)
    .map((snapshot) => {
      const ratio = decimalRatio({
        numerator: BigInt(snapshot.priceQuoteAmount) * pow10(baseDecimals),
        denominator: BigInt(snapshot.priceBaseAmount) * pow10(quoteDecimals)
      });
      const timestamp = Number(BigInt(snapshot.day) * 86_400n);
      if (!Number.isSafeInteger(timestamp)) throw new Error('Daily marginal-price timestamp is not display-safe.');
      return Object.freeze({
        day: snapshot.day,
        capturedAt: snapshot.capturedAt,
        timestamp,
        direction: snapshot.direction,
        revision: snapshot.revision,
        price: ratio.value,
        priceLabel: ratio.label,
        sourceBlockNumber: snapshot.sourceBlockNumber,
        sourceTransactionHash: snapshot.sourceTransactionHash
      });
    }));
};
