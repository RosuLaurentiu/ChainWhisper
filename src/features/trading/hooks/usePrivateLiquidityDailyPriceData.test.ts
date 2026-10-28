import { describe, expect, it } from 'vitest';
import {
  PRIVATE_LIQUIDITY_DAILY_PRICE_BACKGROUND_REFRESH_MS,
  PRIVATE_LIQUIDITY_DAILY_PRICE_FOCUS_REFRESH_MINIMUM_MS,
  resolveScopedPrivateLiquidityDailyPriceView,
  shouldRequestPrivateLiquidityDailyPriceBackgroundRefresh,
  type PrivateLiquidityDailyPriceData
} from './usePrivateLiquidityDailyPriceData';

const point = Object.freeze({
  day: '20000',
  capturedAt: '1728000001',
  timestamp: 1_728_000_000,
  direction: 0 as const,
  revision: '1',
  price: 2.5,
  priceLabel: '2.5',
  sourceBlockNumber: '100',
  sourceTransactionHash: `0x${'11'.repeat(32)}`
});

const fallback: Omit<PrivateLiquidityDailyPriceData, 'refresh'> = Object.freeze({
  status: 'loading',
  points: Object.freeze([]),
  error: ''
});

describe('Private Liquidity daily-price request scope', () => {
  it('never exposes settled live points under a different pair request', () => {
    const visible = resolveScopedPrivateLiquidityDailyPriceView({
      requestKey: 'pair-b',
      scopeKey: 'pair-b',
      settled: {
        scopeKey: 'pair-a',
        requestKey: 'pair-a',
        status: 'ready',
        points: Object.freeze([point]),
        error: ''
      },
      fallback
    });
    expect(visible).toEqual(fallback);
    expect(visible.points).toEqual([]);
  });

  it('exposes settled points only for the exact current request', () => {
    const points = Object.freeze([point]);
    const visible = resolveScopedPrivateLiquidityDailyPriceView({
      requestKey: 'pair-a',
      scopeKey: 'pair-a',
      settled: { scopeKey: 'pair-a', requestKey: 'pair-a', status: 'ready', points, error: '' },
      fallback
    });
    expect(visible).toMatchObject({ status: 'ready', points });
  });

  it('preserves a verified same-pair chart while a background refresh is pending', () => {
    const points = Object.freeze([point]);
    const visible = resolveScopedPrivateLiquidityDailyPriceView({
      requestKey: 'pair-a:2',
      scopeKey: 'pair-a',
      settled: { scopeKey: 'pair-a', requestKey: 'pair-a:1', status: 'ready', points, error: '' },
      fallback,
      preserveSettled: true
    });
    expect(visible).toMatchObject({ status: 'ready', points });
  });

  it('never preserves a different pair or a prior verification error during refresh', () => {
    const points = Object.freeze([point]);
    expect(resolveScopedPrivateLiquidityDailyPriceView({
      requestKey: 'pair-b:2',
      scopeKey: 'pair-b',
      settled: { scopeKey: 'pair-a', requestKey: 'pair-a:1', status: 'ready', points, error: '' },
      fallback,
      preserveSettled: true
    })).toEqual(fallback);
    expect(resolveScopedPrivateLiquidityDailyPriceView({
      requestKey: 'pair-a:2',
      scopeKey: 'pair-a',
      settled: { scopeKey: 'pair-a', requestKey: 'pair-a:1', status: 'error', points: [], error: 'failed' },
      fallback,
      preserveSettled: true
    })).toEqual(fallback);
  });

  it('bounds automatic refreshes and never polls while the chart is hidden', () => {
    expect(PRIVATE_LIQUIDITY_DAILY_PRICE_BACKGROUND_REFRESH_MS).toBe(300_000);
    expect(shouldRequestPrivateLiquidityDailyPriceBackgroundRefresh({
      now: 130_000,
      lastRequestedAt: 100_000,
      visible: true
    })).toBe(true);
    expect(shouldRequestPrivateLiquidityDailyPriceBackgroundRefresh({
      now: 100_000 + PRIVATE_LIQUIDITY_DAILY_PRICE_FOCUS_REFRESH_MINIMUM_MS - 1,
      lastRequestedAt: 100_000,
      visible: true
    })).toBe(false);
    expect(shouldRequestPrivateLiquidityDailyPriceBackgroundRefresh({
      now: 500_000,
      lastRequestedAt: 100_000,
      visible: false
    })).toBe(false);
  });
});
