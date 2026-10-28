import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as archived, CURRENT_CHEAP_DEX_CANDIDATE as current,
  STAGED_NATIVE_DEX_CANDIDATE as native, STAGED_D06_DEX_CANDIDATE as d06, assertCurrentCheapDexNativeAdmission,
  currentCheapDexCandidateKey, currentCheapDexQuoteProtocol, currentCheapDexStages,
  resolveCurrentCheapDexCandidate } from './dexV2Deployment';
import { assertCurrentSwapCandidate, assertCurrentSwapIdentity, isCurrentNativeSwapCandidate } from './currentDexNativeSwapPolicy';
import { currentCheapDexGasCaps } from './currentDexSubmission';
import { currentNativeDexDailyPriceConfig } from './currentDexNativeDailyPriceTestnet';

describe('active native candidate integration', () => {
  it('matches the complete descriptor reproduced from the saved public capture', () => {
    const { attestationSha256, ...observed } = d06;
    expect(attestationSha256).toBe('15c6d096d7dfd3b79fd69aee8ee9d99a134d30fb8a441aa9d194ce877b429747');
    expect(createHash('sha256').update(JSON.stringify(observed)).digest('hex'))
      .toBe('0aa630d033db523b5988bbf1d0e1ee44da7829ae3d03ace83ff4aaa3ec852059');
  });
  it('selects d06 with admitted public history while native signing remains held', () => {
    expect(current).toBe(d06);
    expect(resolveCurrentCheapDexCandidate('cheap-current')).toBe(d06);
    expect(currentCheapDexCandidateKey(current)).toBe('cheap-d06');
    expect(currentCheapDexStages()).toEqual({ workCalls: 4, ready: 5, funded: 6, settled: 7, released: 8 });
    expect(currentCheapDexQuoteProtocol(current)).toBe('quote-slippage');
    expect(() => assertCurrentSwapIdentity(current)).not.toThrow();
    expect(() => assertCurrentSwapCandidate(current)).toThrow('admission is absent');
    expect(isCurrentNativeSwapCandidate(current)).toBe(false);
    // Source-bound gas caps are available for review. Signing remains held above.
    expect(currentCheapDexGasCaps(current)).toEqual({
      'fast-pool': { quote: 75_000_000n, accept: 75_000_000n },
      'cheap-async': { quote: 65_000_000n, accept: 35_000_000n, cancel: 20_000_000n, recover: 50_000_000n }
    });
    expect(currentNativeDexDailyPriceConfig(current).status).toBe('active');
    expect(resolveCurrentCheapDexCandidate('cheap-native')).toBe(native);
    expect(() => assertCurrentSwapCandidate(native)).not.toThrow();
    expect(currentNativeDexDailyPriceConfig(native).status).toBe('active');
  });
  it('retains phase-specific admission and does not grant generic owner authority', () => {
    expect(current.readyToSign).toBe(false);
    expect(() => assertCurrentCheapDexNativeAdmission(current)).toThrow('admission is absent');
    expect(() => assertCurrentSwapCandidate({ ...current, packageSha256: '00'.repeat(32) })).toThrow('identity changed');
  });
  it('retains archived identity and receipt stage decoding independently of the alias', () => {
    expect(resolveCurrentCheapDexCandidate('cheap-archived')).toBe(archived);
    expect(currentCheapDexCandidateKey(archived)).toBe('cheap-archived');
    expect(currentCheapDexStages(archived)).toEqual({ workCalls: 3, ready: 4, funded: 5, settled: 6, released: 7 });
    expect(currentNativeDexDailyPriceConfig(archived).status).toBe('inactive');
  });
});
