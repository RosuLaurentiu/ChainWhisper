import { describe, expect, it } from 'vitest';
import { MAX_TOKEN_ALLOWANCE, planTokenAllowance, remainingTokenAllowance } from './tokenAllowance';

describe('token allowance policy', () => {
  it('reuses sufficient permission without changing the operation amount', () => {
    for (const allowance of [10n, 20n, MAX_TOKEN_ALLOWANCE]) expect(planTokenAllowance(allowance, 10n)).toBeNull();
  });
  it('sets a missing allowance or increases only the shortfall', () => {
    expect(planTokenAllowance(0n, 10n)).toEqual({ method: 'approve', value: 10n, target: 10n });
    expect(planTokenAllowance(3n, 10n)).toEqual({ method: 'increaseAllowance', value: 7n, target: 10n });
  });
  it('requires explicit unlimited policy and supports its full uint256 range', () => {
    expect(planTokenAllowance(3n, 10n, 'unlimited')).toEqual({ method: 'increaseAllowance', value: MAX_TOKEN_ALLOWANCE - 3n, target: MAX_TOKEN_ALLOWANCE });
    expect(planTokenAllowance(MAX_TOKEN_ALLOWANCE, 10n, 'unlimited')).toBeNull();
  });
  it('accounts for actual debits and preserves true infinite allowance', () => {
    expect(remainingTokenAllowance(20n, 7n)).toBe(13n);
    expect(remainingTokenAllowance(20n, 0n)).toBe(20n);
    expect(remainingTokenAllowance(MAX_TOKEN_ALLOWANCE, 7n)).toBe(MAX_TOKEN_ALLOWANCE);
    expect(() => remainingTokenAllowance(3n, 7n)).toThrow();
  });
  it('rejects invalid bounds and policy before encryption', () => {
    for (const bad of [-1n, MAX_TOKEN_ALLOWANCE + 1n]) {
      expect(() => planTokenAllowance(bad, 10n)).toThrow();
      expect(() => planTokenAllowance(0n, bad)).toThrow();
      expect(() => remainingTokenAllowance(10n, bad)).toThrow();
    }
    expect(() => planTokenAllowance(0n, 0n)).toThrow();
    expect(() => planTokenAllowance(0n, 10n, 'bad' as 'exact')).toThrow();
  });
});
