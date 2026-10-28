import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildPrivateLiquidityDailyPriceDemoSeries,
  type PrivateLiquidityDailyPricePoint
} from '../../../lib/privateLiquidityDailyPrice';
import PrivateLiquidityDailyPriceChart, {
  buildPrivateLiquidityDailyPriceCandles,
  buildPrivateLiquidityDailyPriceChartData
} from './PrivateLiquidityDailyPriceChart';

const point = (day: number, price: number): PrivateLiquidityDailyPricePoint => Object.freeze({
  day: String(day),
  capturedAt: String(day * 86_400 + 86_399),
  timestamp: day * 86_400 + 86_399,
  direction: day % 2 === 0 ? 0 : 1,
  revision: '1',
  price,
  priceLabel: String(price),
  sourceBlockNumber: String(1_000 + day),
  sourceTransactionHash: `0x${'ab'.repeat(32)}`
});

const renderChart = (props: Partial<Parameters<typeof PrivateLiquidityDailyPriceChart>[0]> = {}) =>
  renderToStaticMarkup(createElement(PrivateLiquidityDailyPriceChart, {
    pairLabel: 'p.COTI / p.USDC',
    quoteSymbol: 'p.USDC',
    points: [point(20_000, 1.25), point(20_001, 1.3)],
    ...props
  }));

describe('PrivateLiquidityDailyPriceChart', () => {
  it('labels live candles as close-to-close without implying public depth or volume', () => {
    const markup = renderChart();
    expect(markup).toContain('Daily marginal price');
    expect(markup).toContain('1.3 p.USDC');
    expect(markup).toContain('On-chain closes');
    expect(markup).toContain('Close-to-close candles use one saved marginal price per completed UTC day.');
    expect(markup).toContain('No hidden depth or volume is inferred.');
    expect(markup).toContain('daily close-to-close marginal-price candles');
    expect(markup).not.toContain('Volume');
    expect(markup).not.toContain('TVL');
  });

  it('renders honest empty and provenance-error states', () => {
    expect(renderChart({ points: [] })).toContain('No daily closes saved yet');
    const errorMarkup = renderChart({ status: 'error', error: 'Source receipt mismatch.' });
    expect(errorMarkup).toContain('Daily price history is unavailable');
    expect(errorMarkup).toContain('Source receipt mismatch.');
  });

  it('inserts null chart gaps instead of inventing prices on no-trade days', () => {
    const candles = buildPrivateLiquidityDailyPriceCandles([
      point(20_000, 1.25),
      point(20_003, 1.4)
    ], 'live');
    const data = buildPrivateLiquidityDailyPriceChartData(candles);
    expect(data.map(({ day }) => day)).toEqual(['20000', '20001', '20003']);
    expect(data[1]).toMatchObject({ day: '20001', candleRange: null, gap: true });
  });

  it('derives truthful live candles from consecutive saved closes without invented wicks', () => {
    const candles = buildPrivateLiquidityDailyPriceCandles([
      point(20_000, 1.25),
      point(20_001, 1.3),
      point(20_002, 1.2)
    ], 'live');
    expect(candles[1]).toMatchObject({ open: 1.25, close: 1.3, low: 1.25, high: 1.3, simulatedWick: false });
    expect(candles[2]).toMatchObject({ open: 1.3, close: 1.2, low: 1.2, high: 1.3, simulatedWick: false });
  });

  it('adds deterministic wicks only to clearly illustrative demo candles', () => {
    const demo = buildPrivateLiquidityDailyPriceDemoSeries({ endingDay: 20_100n });
    const first = buildPrivateLiquidityDailyPriceCandles(demo, 'demo');
    const second = buildPrivateLiquidityDailyPriceCandles(demo, 'demo');
    expect(first).toEqual(second);
    expect(first.every((candle) => candle.simulatedWick)).toBe(true);
    expect(first.every((candle) => candle.high > Math.max(candle.open, candle.close))).toBe(true);
    expect(first.every((candle) => candle.low < Math.min(candle.open, candle.close))).toBe(true);
  });

  it('marks invented data everywhere and never fabricates on-chain provenance', () => {
    const markup = renderChart({
      mode: 'demo',
      points: buildPrivateLiquidityDailyPriceDemoSeries({ endingDay: 20_100n })
    });
    expect(markup).toContain('Illustrative demo');
    expect(markup).toContain('Invented OHLC candles preview the exchange chart only.');
    expect(markup).toContain('illustrative OHLC candles');
    expect(markup).not.toContain('Source block');
    expect(markup).not.toContain('On-chain closes');
  });
});
