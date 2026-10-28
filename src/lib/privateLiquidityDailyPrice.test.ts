import { describe, expect, it } from 'vitest';
import {
  buildPrivateLiquidityDailyPriceDemoSeries,
  buildPrivateLiquidityDailyPriceSeries,
  derivePrivateLiquidityDailyPriceDemoSeed,
  normalizePrivateLiquidityDailyPriceSnapshot,
  selectPrivateLiquidityDailyPricePresentation,
  type PrivateLiquidityDailyPriceSnapshot
} from './privateLiquidityDailyPrice';

const snapshot = (overrides: Partial<PrivateLiquidityDailyPriceSnapshot> = {}): PrivateLiquidityDailyPriceSnapshot => ({
  day: '20000',
  capturedAt: String(20_000 * 86_400 + 1_000),
  sourceBlockNumber: '100',
  sourceLogIndex: 4,
  direction: 0,
  revision: '1',
  priceBaseAmount: '2000000',
  priceQuoteAmount: '5000000',
  swapId: '9',
  positionId: '7',
  sourceBlockHash: `0x${'11'.repeat(32)}`,
  sourceTransactionHash: `0x${'22'.repeat(32)}`,
  ...overrides
});

describe('Private Liquidity daily marginal-price series', () => {
  it('normalizes quote-per-base price across different token decimals', () => {
    const [point] = buildPrivateLiquidityDailyPriceSeries({
      snapshots: [snapshot()],
      baseTokenDecimals: 6,
      quoteTokenDecimals: 6
    });
    expect(point.price).toBe(2.5);
    expect(point.priceLabel).toBe('2.5');
    expect(point.timestamp).toBe(20_000 * 86_400);

    const [mixedDecimals] = buildPrivateLiquidityDailyPriceSeries({
      snapshots: [snapshot({ priceBaseAmount: '1000000000000000000', priceQuoteAmount: '2500000' })],
      baseTokenDecimals: 18,
      quoteTokenDecimals: 6
    });
    expect(mixedDecimals.price).toBe(2.5);
  });

  it('sorts UTC days and retains only the highest explicit correction revision', () => {
    const points = buildPrivateLiquidityDailyPriceSeries({
      snapshots: [
        snapshot({ day: '20001', capturedAt: String(20_001 * 86_400 + 100), priceQuoteAmount: '6000000' }),
        snapshot(),
        snapshot({ revision: '2', priceQuoteAmount: '4000000', sourceTransactionHash: `0x${'33'.repeat(32)}` })
      ],
      baseTokenDecimals: 6,
      quoteTokenDecimals: 6
    });
    expect(points.map(({ day }) => day)).toEqual(['20000', '20001']);
    expect(points[0].revision).toBe('2');
    expect(points[0].price).toBe(2);
  });

  it('rejects conflicting same-revision data and malformed provenance', () => {
    expect(() => buildPrivateLiquidityDailyPriceSeries({
      snapshots: [snapshot(), snapshot({ priceQuoteAmount: '4000000' })],
      baseTokenDecimals: 6,
      quoteTokenDecimals: 6
    })).toThrow(/conflict/i);
    expect(() => normalizePrivateLiquidityDailyPriceSnapshot(snapshot({ sourceBlockHash: `0x${'00'.repeat(32)}` })))
      .toThrow(/nonzero bytes32/i);
    expect(() => normalizePrivateLiquidityDailyPriceSnapshot(snapshot({ capturedAt: '1' })))
      .toThrow(/incomplete/i);
  });

  it('contains only daily price and public source provenance', () => {
    const [point] = buildPrivateLiquidityDailyPriceSeries({
      snapshots: [snapshot()],
      baseTokenDecimals: 6,
      quoteTokenDecimals: 6
    });
    expect(Object.keys(point).sort()).toEqual([
      'capturedAt',
      'day',
      'direction',
      'price',
      'priceLabel',
      'revision',
      'sourceBlockNumber',
      'sourceTransactionHash',
      'timestamp'
    ]);
  });

  it('generates a deterministic, positive, provenance-free illustrative series with gaps', () => {
    const first = buildPrivateLiquidityDailyPriceDemoSeries({ endingDay: 20_100n });
    const second = buildPrivateLiquidityDailyPriceDemoSeries({ endingDay: 20_100n });
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(85);
    expect(first.length).toBeLessThan(90);
    expect(first.every((point) => point.price > 0 && point.simulation === 'illustrative-v1')).toBe(true);
    expect(first.every((point) => !('sourceBlockNumber' in point) && !('sourceTransactionHash' in point))).toBe(true);
    expect(first.some((point, index) => index > 0 && BigInt(point.day) > BigInt(first[index - 1]!.day) + 1n)).toBe(true);
  });

  it('derives stable distinct illustrative curves for different reviewed pairs', () => {
    const firstPair = `0x${'11'.repeat(32)}`;
    const secondPair = `0x${'22'.repeat(32)}`;
    const firstSeed = derivePrivateLiquidityDailyPriceDemoSeed(firstPair);
    expect(derivePrivateLiquidityDailyPriceDemoSeed(firstPair.toUpperCase())).toBe(firstSeed);
    expect(derivePrivateLiquidityDailyPriceDemoSeed(secondPair)).not.toBe(firstSeed);
    expect(buildPrivateLiquidityDailyPriceDemoSeries({ endingDay: 20_100n, seed: firstSeed }))
      .not.toEqual(buildPrivateLiquidityDailyPriceDemoSeries({
        endingDay: 20_100n,
        seed: derivePrivateLiquidityDailyPriceDemoSeed(secondPair)
      }));
    expect(() => derivePrivateLiquidityDailyPriceDemoSeed(`0x${'00'.repeat(32)}`)).toThrow(/nonzero bytes32/i);
    expect(() => derivePrivateLiquidityDailyPriceDemoSeed('not-a-pair')).toThrow(/nonzero bytes32/i);
  });

  it('uses demo only until a ready live series has at least one point', () => {
    const demo = buildPrivateLiquidityDailyPriceDemoSeries({ endingDay: 20_100n });
    expect(selectPrivateLiquidityDailyPricePresentation({
      status: 'inactive', livePoints: [], demoPoints: demo
    })).toMatchObject({ mode: 'demo', status: 'ready', points: demo });
    expect(selectPrivateLiquidityDailyPricePresentation({
      status: 'ready', livePoints: [], demoPoints: demo
    })).toMatchObject({ mode: 'demo', status: 'ready', points: demo });
    const live = buildPrivateLiquidityDailyPriceSeries({
      snapshots: [snapshot()], baseTokenDecimals: 6, quoteTokenDecimals: 6
    });
    expect(selectPrivateLiquidityDailyPricePresentation({
      status: 'ready', livePoints: live, demoPoints: demo
    })).toMatchObject({ mode: 'live', status: 'ready', points: live });
    expect(selectPrivateLiquidityDailyPricePresentation({
      status: 'error', livePoints: [], demoPoints: demo
    })).toMatchObject({ mode: 'live', status: 'error', points: [] });
  });
});
