import { describe, expect, it } from 'vitest';
import { buildDexLiquidityPlan, type DexLiquiditySource } from './dexLiquidity';

const pairKey = `0x${'11'.repeat(32)}`;
const contractAddress = `0x${'22'.repeat(20)}`;
const source = (
  sourceId: string,
  kind: DexLiquiditySource['kind'],
  overrides: Partial<DexLiquiditySource> = {}
): DexLiquiditySource => ({
  sourceId,
  kind,
  chainId: '7082400',
  contractAddress,
  pairKey,
  publicMarginalPriceE18: kind === 'pool' ? '1010000000000000000' : null,
  active: true,
  finality: 'finalized',
  ...overrides
});

describe('DEX private-liquidity discovery plan', () => {
  it('preserves the canonical window without ranking hidden Limit or Recurring prices', () => {
    const plan = buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'quote-to-base',
      sources: [
        source('recurring:4', 'recurring'),
        source('pool:1', 'pool'),
        source('limit:8', 'limit')
      ]
    });

    expect(plan.availability).toBe('available');
    expect(plan.publicPoolSource?.sourceId).toBe('pool:1');
    expect(plan.publicPoolSource?.publicMarginalPriceE18).toBe('1010000000000000000');
    expect(plan.canonicalSources.map((item) => item.sourceId)).toEqual([
      'recurring:4',
      'pool:1',
      'limit:8'
    ]);
    expect(plan.hiddenSourceCount).toBe(2);
    expect(plan.sourceCounts).toEqual({ pool: 1, limit: 1, recurring: 1 });
    expect(plan.settlementPolicy).toBe('price-ordered-multi-source');
    expect(plan.routingPolicy).toBe('onchain-private-price-gc');
  });

  it('rejects any public Limit or Recurring price', () => {
    expect(() => buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'quote-to-base',
      sources: [source('limit:8', 'limit', { publicMarginalPriceE18: '1' })]
    })).toThrow('must remain private');
  });

  it('requires the Pool public marginal price and at most one aggregate Pool', () => {
    expect(() => buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'base-to-quote',
      sources: [source('pool:1', 'pool', { publicMarginalPriceE18: null })]
    })).toThrow('marginal price is required');
    expect(() => buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'base-to-quote',
      sources: [source('pool:1', 'pool'), source('pool:2', 'pool')]
    })).toThrow('more than one aggregate Pool');
  });

  it('treats active hidden sources as presence, never as an executable quote', () => {
    const plan = buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'base-to-quote',
      sources: [source('limit:8', 'limit')]
    });
    expect(plan.availability).toBe('available');
    expect(plan.publicPoolSource).toBeNull();
    expect(plan.hiddenSourceCount).toBe(1);
    expect('bestSource' in plan).toBe(false);
    expect('executableSources' in plan).toBe(false);
  });

  it('uses pending/error states without exposing hidden compatibility', () => {
    const pending = buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'base-to-quote',
      sources: [source('recurring:4', 'recurring', { finality: 'pending' })]
    });
    expect(pending.availability).toBe('loading');
    expect(pending.canonicalSources).toHaveLength(0);
    const failed = buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'base-to-quote',
      sources: [],
      verificationError: true
    });
    expect(failed.availability).toBe('error');
  });

  it('rejects duplicate identities and invalid chain or pair inputs', () => {
    expect(() => buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey,
      direction: 'base-to-quote',
      sources: [source('pool:1', 'pool'), source('pool:1', 'pool')]
    })).toThrow('Duplicate');
    expect(() => buildDexLiquidityPlan({
      chainId: -1,
      pairKey,
      direction: 'base-to-quote',
      sources: []
    })).toThrow('unsigned integer');
    expect(() => buildDexLiquidityPlan({
      chainId: 7082400,
      pairKey: '0x1234',
      direction: 'base-to-quote',
      sources: []
    })).toThrow('bytes32');
  });
});
