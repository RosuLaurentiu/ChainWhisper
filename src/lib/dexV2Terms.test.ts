import { describe, expect, it } from 'vitest';
import {
  DEX_V2_TICKS,
  dexV2DirectionCode,
  formatDexV2LotsAsTokenAmount,
  formatDexV2TickPrice,
  getDexV2TickQuanta,
  packDexV2LimitTerms,
  packDexV2LiquidityAdditionLots,
  packDexV2PoolDepositLots,
  packDexV2RecurringInventories,
  packDexV2RecurringRanks,
  packDexV2SwapLots,
  packDexV2Uint32Pair,
  parseDexV2TokenAmountToLots,
  quoteDexV2LimitOutputLots,
  scaleDexV2LotsToRaw,
  unpackDexV2Uint32Pair
} from './dexV2Terms';

describe('dexV2Terms', () => {
  it('freezes all sixteen exact rational ticks in both directions', () => {
    expect(DEX_V2_TICKS).toHaveLength(16);
    expect(getDexV2TickQuanta(0, 'quote-to-base')).toEqual({ inputLots: 3n, outputLots: 4n });
    expect(getDexV2TickQuanta(0, 'base-to-quote')).toEqual({ inputLots: 4n, outputLots: 3n });
    expect(getDexV2TickQuanta(15, 'quote-to-base')).toEqual({ inputLots: 7n, outputLots: 5n });
    expect(getDexV2TickQuanta(15, 'base-to-quote')).toEqual({ inputLots: 5n, outputLots: 7n });
    expect(() => getDexV2TickQuanta(16, 'quote-to-base')).toThrow(/0 through 15/);
  });

  it('formats exact ticks as human-readable quote-per-base prices', () => {
    expect(formatDexV2TickPrice(0)).toBe('0.7500');
    expect(formatDexV2TickPrice(8)).toBe('1.0030');
    expect(formatDexV2TickPrice(15)).toBe('1.4000');
    expect(formatDexV2TickPrice(9, 2)).toBe('1.05');
    expect(() => formatDexV2TickPrice(16)).toThrow(/0 through 15/);
    expect(() => formatDexV2TickPrice(8, 13)).toThrow(/precision/);
  });

  it('matches the frozen live activation packing vectors exactly', () => {
    expect(packDexV2PoolDepositLots(39_880n, 219_340n))
      .toBe((39_880n << 32n) | 219_340n);
    expect(packDexV2LimitTerms({
      makerSide: 'sell-base',
      tickRank: 3,
      inventoryLots: 100n,
      minimumFillQuanta: 5n
    })).toBe((100n << 32n) | (5n << 5n) | (3n << 1n));
    expect(packDexV2RecurringRanks(9, 6)).toBe((6n << 4n) | 9n);
    expect(packDexV2RecurringInventories({
      buyTickRank: 9,
      sellTickRank: 6,
      baseInventoryLots: 401n,
      quoteInventoryLots: 381n
    })).toBe((401n << 32n) | 381n);
    expect(packDexV2SwapLots(900n, 0n)).toBe(900n << 32n);
  });

  it('round-trips the shared uint32 pair layout', () => {
    const maximum = (1n << 32n) - 1n;
    expect(unpackDexV2Uint32Pair(packDexV2Uint32Pair(maximum, 17n)))
      .toEqual({ high: maximum, low: 17n });
    expect(() => packDexV2Uint32Pair(maximum + 1n, 0n)).toThrow(/out of range/);
  });

  it('enforces Pool and addition zero rules', () => {
    expect(() => packDexV2PoolDepositLots(0n, 1n)).toThrow(/both token lots/);
    expect(() => packDexV2PoolDepositLots(1n, 0n)).toThrow(/both token lots/);
    expect(packDexV2LiquidityAdditionLots(0n, 1n)).toBe(1n);
    expect(packDexV2LiquidityAdditionLots(1n, 0n)).toBe(1n << 32n);
    expect(() => packDexV2LiquidityAdditionLots(0n, 0n)).toThrow(/cannot be empty/);
  });

  it('rejects Limit terms that the private parser would reject', () => {
    expect(() => packDexV2LimitTerms({
      makerSide: 'sell-base', tickRank: 3, inventoryLots: 19n, minimumFillQuanta: 0n
    })).toThrow(/executable/);
    expect(() => packDexV2LimitTerms({
      makerSide: 'sell-base', tickRank: 3, inventoryLots: 1_280n, minimumFillQuanta: 0n
    })).toThrow(/executable/);
    expect(() => packDexV2LimitTerms({
      makerSide: 'sell-base', tickRank: 3, inventoryLots: 100n, minimumFillQuanta: 6n
    })).toThrow(/exceeds funded inventory/);
    expect(() => packDexV2LimitTerms({
      makerSide: 'bad-side' as never, tickRank: 3, inventoryLots: 100n, minimumFillQuanta: 0n
    })).toThrow(/maker side/);
  });

  it('rejects invalid Recurring spreads and inventory/headroom boundaries', () => {
    expect(() => packDexV2RecurringRanks(6, 6)).toThrow(/greater/);
    expect(() => packDexV2RecurringInventories({
      buyTickRank: 9, sellTickRank: 6, baseInventoryLots: 19n, quoteInventoryLots: 381n
    })).toThrow(/base inventory/);
    expect(() => packDexV2RecurringInventories({
      buyTickRank: 9, sellTickRank: 6, baseInventoryLots: 401n, quoteInventoryLots: 1_216n
    })).toThrow(/quote inventory/);
  });

  it('enforces private minimum-input semantics and direction codes', () => {
    expect(packDexV2SwapLots(50n, 25n)).toBe((50n << 32n) | 25n);
    expect(() => packDexV2SwapLots(0n, 0n)).toThrow(/cannot be zero/);
    expect(() => packDexV2SwapLots(50n, 51n)).toThrow(/cannot exceed/);
    expect(dexV2DirectionCode('base-to-quote')).toBe(0);
    expect(dexV2DirectionCode('quote-to-base')).toBe(1);
  });

  it('scales lot amounts only at the custody/display boundary', () => {
    expect(scaleDexV2LotsToRaw(900n, 100n)).toBe(90_000n);
    expect(() => scaleDexV2LotsToRaw(1n, 0n)).toThrow(/cannot be zero/);
  });

  it('converts exact mixed-decimal token inputs to settlement lots without floating point', () => {
    expect(parseDexV2TokenAmountToLots('1.2', 6, 100n)).toBe(12_000n);
    expect(parseDexV2TokenAmountToLots('0.0001', 6, 100n)).toBe(1n);
    expect(formatDexV2LotsAsTokenAmount(12_000n, 6, 100n)).toBe('1.2');
    expect(formatDexV2LotsAsTokenAmount(1n, 6, 100n)).toBe('0.0001');
    expect(() => parseDexV2TokenAmountToLots('0.000001', 6, 100n)).toThrow(/settlement-lot/);
    expect(() => parseDexV2TokenAmountToLots('01.2', 6, 100n)).toThrow(/canonical/);
  });

  it('quotes the conservative whole-lot output at the public limit', () => {
    expect(quoteDexV2LimitOutputLots(900n, 8, 'base-to-quote')).toBe(902n);
    expect(quoteDexV2LimitOutputLots(901n, 8, 'base-to-quote')).toBe(903n);
    expect(quoteDexV2LimitOutputLots(900n, 8, 'quote-to-base')).toBe(897n);
  });
});
