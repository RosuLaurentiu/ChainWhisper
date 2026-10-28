import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { PrivateLiquidityDailyPriceChartPoint } from '../../../lib/privateLiquidityDailyPrice';

const SECONDS_PER_DAY = 86_400;
const TIMEFRAMES = [
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null }
] as const;

type Timeframe = (typeof TIMEFRAMES)[number]['key'];

export type PrivateLiquidityDailyPriceCandle = Readonly<{
  point: PrivateLiquidityDailyPriceChartPoint;
  day: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  candleRange: readonly [number, number];
  changePercent: number;
  rising: boolean;
  simulatedWick: boolean;
}>;

export type PrivateLiquidityDailyPriceChartDatum =
  | PrivateLiquidityDailyPriceCandle
  | Readonly<{
      day: string;
      timestamp: number;
      candleRange: null;
      gap: true;
    }>;

const deterministicDemoWick = (day: string, side: 'upper' | 'lower'): number => {
  const dayNumber = Number(BigInt(day) % 97n);
  const offset = side === 'upper' ? 17 : 43;
  return 0.0025 + ((dayNumber * 37 + offset) % 29) / 10_000;
};

/**
 * The live store records one close per UTC day, so live candles are deliberately close-to-close.
 * Only illustrative demo candles receive simulated high/low wicks.
 */
export const buildPrivateLiquidityDailyPriceCandles = (
  points: readonly PrivateLiquidityDailyPriceChartPoint[],
  mode: 'demo' | 'live'
): readonly PrivateLiquidityDailyPriceCandle[] => {
  const candles: PrivateLiquidityDailyPriceCandle[] = [];
  let previousClose: number | undefined;
  let previousDay: bigint | undefined;
  for (const point of points) {
    const day = BigInt(point.day);
    if (previousDay !== undefined && day <= previousDay) {
      throw new Error('Daily marginal-price chart points must be ordered by unique UTC day.');
    }
    if (!Number.isFinite(point.price) || point.price <= 0) {
      throw new Error('Daily marginal-price chart point must have a positive display price.');
    }
    const open = previousClose ?? point.price;
    const close = point.price;
    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    const upperWick = mode === 'demo' ? deterministicDemoWick(point.day, 'upper') : 0;
    const lowerWick = mode === 'demo' ? deterministicDemoWick(point.day, 'lower') : 0;
    const high = bodyHigh * (1 + upperWick);
    const low = Math.max(Number.EPSILON, bodyLow * (1 - lowerWick));
    const changePercent = open === 0 ? 0 : ((close - open) / open) * 100;
    candles.push(Object.freeze({
      point,
      day: point.day,
      timestamp: point.timestamp,
      open,
      high,
      low,
      close,
      candleRange: Object.freeze([low, high] as const),
      changePercent,
      rising: close >= open,
      simulatedWick: mode === 'demo'
    }));
    previousClose = close;
    previousDay = day;
  }
  return Object.freeze(candles);
};

export const buildPrivateLiquidityDailyPriceChartData = (
  candles: readonly PrivateLiquidityDailyPriceCandle[]
): readonly PrivateLiquidityDailyPriceChartDatum[] => {
  if (candles.length < 2) return candles;
  const result: PrivateLiquidityDailyPriceChartDatum[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    result.push(candle);
    const next = candles[index + 1];
    if (!next) continue;
    const pointDay = BigInt(candle.day);
    const nextDay = BigInt(next.day);
    if (nextDay <= pointDay) throw new Error('Daily marginal-price candles must be ordered by unique UTC day.');
    const missingDay = pointDay + 1n;
    if (missingDay < nextDay) {
      const timestamp = Number(missingDay * BigInt(SECONDS_PER_DAY));
      if (!Number.isSafeInteger(timestamp)) throw new Error('Daily marginal-price gap is not display-safe.');
      result.push(Object.freeze({ day: missingDay.toString(), timestamp, candleRange: null, gap: true as const }));
    }
  }
  return Object.freeze(result);
};

const formatDay = (timestamp: number): string => new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC'
}).format(new Date(timestamp * 1_000));

const formatFullDay = (timestamp: number): string => new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
  year: 'numeric'
}).format(new Date(timestamp * 1_000));

const formatPrice = (value: number): string => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 8,
  minimumSignificantDigits: 1,
  maximumSignificantDigits: 10
}).format(value);

const formatChange = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

type TooltipEntry = Readonly<{ payload: PrivateLiquidityDailyPriceChartDatum }>;

function PriceTooltip({
  active,
  payload,
  mode,
  quoteSymbol
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  mode: 'demo' | 'live';
  quoteSymbol: string;
}) {
  const candle = payload?.[0]?.payload;
  if (!active || !candle || 'gap' in candle) return null;
  return (
    <div className="p2p-private-liquidity-price-tooltip">
      <strong>{formatFullDay(candle.timestamp)} UTC</strong>
      <div className="p2p-private-liquidity-price-tooltip-grid">
        <span>Open <b>{formatPrice(candle.open)}</b></span>
        <span>High <b>{formatPrice(candle.high)}</b></span>
        <span>Low <b>{formatPrice(candle.low)}</b></span>
        <span>Close <b>{formatPrice(candle.close)}</b></span>
      </div>
      <small>{quoteSymbol} per base · {formatChange(candle.changePercent)}</small>
      {mode === 'demo' ? <small>Illustrative OHLC candle</small> : (
        <small>Close-to-close candle · source block {'sourceBlockNumber' in candle.point ? candle.point.sourceBlockNumber : '—'}</small>
      )}
    </div>
  );
}

type CandleShapeProps = Readonly<{
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: PrivateLiquidityDailyPriceChartDatum;
}>;

function CandleShape({ x, y, width, height, payload }: CandleShapeProps) {
  if (
    x === undefined || y === undefined || width === undefined || height === undefined ||
    !payload || 'gap' in payload || payload.high <= payload.low
  ) return null;
  const centerX = x + width / 2;
  const span = payload.high - payload.low;
  const priceToY = (value: number) => y + ((payload.high - value) / span) * height;
  const openY = priceToY(payload.open);
  const closeY = priceToY(payload.close);
  const bodyY = Math.min(openY, closeY);
  const bodyHeight = Math.max(2, Math.abs(closeY - openY));
  const bodyWidth = Math.max(3, Math.min(width * 0.72, 14));
  const color = payload.rising ? '#37d5a5' : '#ff6685';
  return (
    <g className={payload.rising ? 'is-rising' : 'is-falling'}>
      <line x1={centerX} x2={centerX} y1={y} y2={y + height} stroke={color} strokeWidth={1.4} />
      <rect
        x={centerX - bodyWidth / 2}
        y={bodyY}
        width={bodyWidth}
        height={bodyHeight}
        rx={1}
        fill={color}
        stroke={color}
      />
    </g>
  );
}

export type PrivateLiquidityDailyPriceChartProps = Readonly<{
  points: readonly PrivateLiquidityDailyPriceChartPoint[];
  pairLabel: string;
  quoteSymbol: string;
  mode?: 'demo' | 'live';
  status?: 'loading' | 'ready' | 'error';
  error?: string;
  onRetry?: () => void;
}>;

export default function PrivateLiquidityDailyPriceChart({
  points,
  pairLabel,
  quoteSymbol,
  mode = 'live',
  status = 'ready',
  error = '',
  onRetry
}: PrivateLiquidityDailyPriceChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('90d');
  const visiblePoints = useMemo(() => {
    if (points.length === 0) return points;
    const days = TIMEFRAMES.find((option) => option.key === timeframe)?.days;
    if (days === null || days === undefined) return points;
    const latestTimestamp = points[points.length - 1]?.timestamp ?? 0;
    const minimumTimestamp = latestTimestamp - (days - 1) * SECONDS_PER_DAY;
    return points.filter((point) => point.timestamp >= minimumTimestamp);
  }, [points, timeframe]);
  const candles = useMemo(
    () => buildPrivateLiquidityDailyPriceCandles(visiblePoints, mode),
    [mode, visiblePoints]
  );
  const chartData = useMemo(() => buildPrivateLiquidityDailyPriceChartData(candles), [candles]);
  const latest = candles[candles.length - 1];
  const prices = candles.flatMap((candle) => [candle.low, candle.high]);
  const priceMinimum = prices.length > 0 ? Math.min(...prices) : 0;
  const priceMaximum = prices.length > 0 ? Math.max(...prices) : 1;
  const pricePadding = Math.max((priceMaximum - priceMinimum) * 0.08, priceMaximum * 0.002);

  return (
    <section className="p2p-private-liquidity-price-chart" aria-labelledby="private-liquidity-daily-price-title">
      <header>
        <div>
          <span className="landing-eyebrow">Daily marginal price</span>
          <span className={`p2p-private-liquidity-price-mode ${mode === 'live' ? 'is-live' : ''}`}>
            {mode === 'demo' ? 'Illustrative demo' : 'On-chain closes'}
          </span>
          <h3 id="private-liquidity-daily-price-title">{pairLabel}</h3>
          <p>{mode === 'demo'
            ? 'Invented OHLC candles preview the exchange chart only. They are not market data and are never used for swaps.'
            : 'Close-to-close candles use one saved marginal price per completed UTC day. No hidden depth or volume is inferred.'}</p>
        </div>
        <div className="p2p-private-liquidity-price-latest">
          <span>{mode === 'demo' ? 'Latest demo close' : 'Latest saved close'}</span>
          <strong>{latest ? `${formatPrice(latest.close)} ${quoteSymbol}` : '—'}</strong>
          <small className={latest?.rising ? 'is-rising' : 'is-falling'}>
            {latest ? `${formatChange(latest.changePercent)} · ${formatFullDay(latest.timestamp)} UTC` : 'No saved close yet'}
          </small>
        </div>
      </header>

      {latest ? (
        <div className="p2p-private-liquidity-price-ohlc" aria-label="Latest candle summary">
          <span>O <strong>{formatPrice(latest.open)}</strong></span>
          <span>H <strong>{formatPrice(latest.high)}</strong></span>
          <span>L <strong>{formatPrice(latest.low)}</strong></span>
          <span>C <strong>{formatPrice(latest.close)}</strong></span>
        </div>
      ) : null}

      <div className="p2p-private-liquidity-price-timeframes" aria-label="Daily price timeframe">
        {TIMEFRAMES.map((option) => (
          <button
            key={option.key}
            type="button"
            className={timeframe === option.key ? 'active' : undefined}
            aria-pressed={timeframe === option.key}
            onClick={() => setTimeframe(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {status === 'loading' ? (
        <div className="p2p-private-liquidity-price-state" role="status">Loading on-chain daily closes…</div>
      ) : null}
      {status === 'error' ? (
        <div className="p2p-private-liquidity-price-state is-error" role="alert">
          <strong>Daily price history is unavailable</strong>
          <p>{error || 'The reviewed analytics store or its source Book was unavailable.'}</p>
          {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
        </div>
      ) : null}
      {status === 'ready' && visiblePoints.length === 0 ? (
        <div className="p2p-private-liquidity-price-state" role="status">
          <strong>No daily closes saved yet</strong>
          <p>The first point is recorded after the first completed UTC trading day.</p>
        </div>
      ) : null}
      {status === 'ready' && candles.length > 0 ? (
        <div className="p2p-private-liquidity-price-plot" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={[...chartData]}
              margin={{ top: 12, right: 18, bottom: 8, left: 4 }}
              barCategoryGap="22%"
            >
              <CartesianGrid stroke="rgba(129, 115, 183, 0.14)" strokeDasharray="2 5" />
              <XAxis
                type="number"
                dataKey="timestamp"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value) => formatDay(Number(value))}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                tick={{ fill: '#81789f', fontSize: 11 }}
              />
              <YAxis
                orientation="right"
                domain={[priceMinimum - pricePadding, priceMaximum + pricePadding]}
                tickFormatter={(value) => formatPrice(Number(value))}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#81789f', fontSize: 11 }}
                width={74}
              />
              <Tooltip
                cursor={{ fill: 'rgba(157, 114, 255, 0.06)' }}
                content={<PriceTooltip mode={mode} quoteSymbol={quoteSymbol} />}
              />
              {latest ? (
                <ReferenceLine
                  y={latest.close}
                  stroke={latest.rising ? '#37d5a5' : '#ff6685'}
                  strokeDasharray="3 5"
                  strokeOpacity={0.55}
                />
              ) : null}
              <Bar
                dataKey="candleRange"
                maxBarSize={18}
                minPointSize={2}
                shape={(props: unknown) => <CandleShape {...props as CandleShapeProps} />}
                activeBar={(props: unknown) => <CandleShape {...props as CandleShapeProps} />}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {status === 'ready' && candles.length > 0 ? (
        <div className="p2p-sr-only">
          <table>
            <caption>{pairLabel} {mode === 'demo' ? 'illustrative OHLC candles' : 'daily close-to-close marginal-price candles'}</caption>
            <thead>
              <tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th>{mode === 'live' ? <th>Source block</th> : null}</tr>
            </thead>
            <tbody>
              {candles.map((candle) => (
                <tr key={`${candle.day}:${'revision' in candle.point ? candle.point.revision : candle.point.simulation}`}>
                  <td>{formatFullDay(candle.timestamp)} UTC</td>
                  <td>{formatPrice(candle.open)} {quoteSymbol}</td>
                  <td>{formatPrice(candle.high)} {quoteSymbol}</td>
                  <td>{formatPrice(candle.low)} {quoteSymbol}</td>
                  <td>{formatPrice(candle.close)} {quoteSymbol}</td>
                  {mode === 'live' ? <td>{'sourceBlockNumber' in candle.point ? candle.point.sourceBlockNumber : '—'}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
