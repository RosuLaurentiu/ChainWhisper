import { describe, expect, it } from 'vitest';
import {
  DEX_V2_INITIAL_POOL_BASE_WEIGHT_LOTS,
  DEX_V2_INITIAL_POOL_QUOTE_WEIGHT_LOTS,
  quoteDexV2PoolDeposit
} from './dexV2PoolTerms';

const quote = (overrides: Record<string, unknown> = {}) => quoteDexV2PoolDeposit({
  baseAmount: '0.3988',
  quoteAmount: '2.1934',
  baseDecimals: 6,
  quoteDecimals: 6,
  baseLotSize: 100n,
  quoteLotSize: 100n,
  maximumAggregateLots: 2_000_000n,
  poolEmpty: true,
  ...overrides
});

describe('dexV2PoolTerms', () => {
  it('maps the deployed empty-Pool seed to one exact canonical depth unit', () => {
    expect(quote()).toEqual({
      baseMaximumLots: DEX_V2_INITIAL_POOL_BASE_WEIGHT_LOTS,
      quoteMaximumLots: DEX_V2_INITIAL_POOL_QUOTE_WEIGHT_LOTS,
      initialSeedUnits: 1n
    });
  });

  it('rejects mismatched, fractional, zero, or excessive empty-Pool seed units', () => {
    expect(() => quote({ quoteAmount: '4.3868' })).toThrow(/matching canonical/);
    expect(() => quote({ baseAmount: '0.3989' })).toThrow(/exact canonical/);
    expect(() => quote({ baseAmount: '0', quoteAmount: '0' })).toThrow(/cannot be zero/);
    expect(() => quote({
      baseAmount: '25.5232',
      quoteAmount: '140.3776'
    })).toThrow(/1 to 63/);
  });

  it('accepts independent maxima once the aggregate Pool already exists', () => {
    expect(quote({ baseAmount: '1', quoteAmount: '3', poolEmpty: false })).toEqual({
      baseMaximumLots: 10_000n,
      quoteMaximumLots: 30_000n,
      initialSeedUnits: null
    });
  });

  it('enforces the activated pair aggregate ceiling on both assets', () => {
    expect(() => quote({ baseAmount: '200.0001', poolEmpty: false })).toThrow(/aggregate-lot ceiling/);
    expect(() => quote({ quoteAmount: '200.0001', poolEmpty: false })).toThrow(/aggregate-lot ceiling/);
  });
});
