import { describe, expect, it } from 'vitest';
import {
  PRIVATE_STRATEGY_DEX_MAX_INPUT_LOTS,
  assertPrivateStrategyDexMinedReceipt,
  buildPrivateStrategyDexReview,
  packPrivateStrategyDexRequest,
  unpackPrivateStrategyDexRequest
} from './privateStrategyDexReview';

const pairKey = `0x${'12'.repeat(32)}`;

const review = (overrides: Partial<Parameters<typeof buildPrivateStrategyDexReview>[0]> = {}) =>
  buildPrivateStrategyDexReview({
    pairKey,
    direction: 'buy-base',
    maximumInputLots: 9n,
    minimumInputFilledLots: 6n,
    limitPriceQ: 100_000_000n,
    pairRevision: 7n,
    deadline: 2_000n,
    indicativeOutputLots: 9n,
    ...overrides
  }, 1_000n);

describe('privateStrategyDexReview', () => {
  it('packs the reviewed private maximum and minimum-filled policy exactly', () => {
    const packed = packPrivateStrategyDexRequest(PRIVATE_STRATEGY_DEX_MAX_INPUT_LOTS, 25n);
    expect(unpackPrivateStrategyDexRequest(packed)).toEqual({
      maximumInputLots: PRIVATE_STRATEGY_DEX_MAX_INPUT_LOTS,
      minimumInputFilledLots: 25n
    });
    expect(() => packPrivateStrategyDexRequest(0n, 0n)).toThrow(/between 1/);
    expect(() => packPrivateStrategyDexRequest(8n, 9n)).toThrow(/cannot exceed/);
    expect(() => packPrivateStrategyDexRequest(PRIVATE_STRATEGY_DEX_MAX_INPUT_LOTS + 1n, 0n))
      .toThrow(/Maximum input/);
  });

  it('freezes an indicative review without claiming an exact pre-trade quote', () => {
    const result = review();
    expect(result.indicative).toEqual({
      outputLots: 9n,
      authority: 'public-marginal-guidance-only',
      exactBeforeMining: false
    });
    expect(result.settlement.authority).toBe('canonical-mined-owner-private-receipt');
    expect(result.settlement.reveals).toEqual(['input-used', 'output', 'unused-input', 'invalid']);
    expect(result.packedPrivateRequest).toBe((9n << 32n) | 6n);
    expect(Object.keys(result)).not.toContain('exactOutput');
    expect(Object.keys(result)).not.toContain('guaranteedOutput');
  });

  it('rejects stale or malformed public execution protections', () => {
    expect(() => review({ pairKey: '0x12' })).toThrow(/bytes32/);
    expect(() => review({ limitPriceQ: 0n })).toThrow(/limit price/);
    expect(() => review({ limitPriceQ: 100_000_000_001n })).toThrow(/limit price/);
    expect(() => review({ pairRevision: 0n })).toThrow(/revision/);
    expect(() => review({ deadline: 1_000n })).toThrow(/future/);
  });

  it('accepts only a conserved, minimum-safe and price-safe mined owner receipt', () => {
    const result = review();
    expect(assertPrivateStrategyDexMinedReceipt(result, {
      source: 'canonical-mined-owner-private-receipt',
      inputUsedLots: 6n,
      outputAmountLots: 8n,
      unusedInputLots: 3n,
      invalid: false
    })).toMatchObject({ inputUsedLots: 6n, outputAmountLots: 8n, unusedInputLots: 3n });
    expect(() => assertPrivateStrategyDexMinedReceipt(result, {
      source: 'canonical-mined-owner-private-receipt',
      inputUsedLots: 5n,
      outputAmountLots: 8n,
      unusedInputLots: 4n,
      invalid: false
    })).toThrow(/minimum-fill/);
    expect(() => assertPrivateStrategyDexMinedReceipt(result, {
      source: 'canonical-mined-owner-private-receipt',
      inputUsedLots: 6n,
      outputAmountLots: 5n,
      unusedInputLots: 3n,
      invalid: false
    })).toThrow(/realized-price/);
  });

  it('requires invalid execution to return the complete maximum through atomic rollback', () => {
    const result = review({ minimumInputFilledLots: 9n });
    expect(assertPrivateStrategyDexMinedReceipt(result, {
      source: 'canonical-mined-owner-private-receipt',
      inputUsedLots: 0n,
      outputAmountLots: 0n,
      unusedInputLots: 9n,
      invalid: true
    }).invalid).toBe(true);
    expect(() => assertPrivateStrategyDexMinedReceipt(result, {
      source: 'canonical-mined-owner-private-receipt',
      inputUsedLots: 1n,
      outputAmountLots: 0n,
      unusedInputLots: 8n,
      invalid: true
    })).toThrow(/atomic rollback/);
  });

  it('applies the reciprocal public realized-price inequality for SellBase', () => {
    const result = review({
      direction: 'sell-base',
      maximumInputLots: 10n,
      minimumInputFilledLots: 1n,
      limitPriceQ: 150_000_000n
    });
    expect(() => assertPrivateStrategyDexMinedReceipt(result, {
      source: 'canonical-mined-owner-private-receipt',
      inputUsedLots: 10n,
      outputAmountLots: 14n,
      unusedInputLots: 0n,
      invalid: false
    })).toThrow(/realized-price/);
    expect(assertPrivateStrategyDexMinedReceipt(result, {
      source: 'canonical-mined-owner-private-receipt',
      inputUsedLots: 10n,
      outputAmountLots: 15n,
      unusedInputLots: 0n,
      invalid: false
    }).outputAmountLots).toBe(15n);
  });
});
