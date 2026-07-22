import { describe, expect, it } from 'vitest';
import {
  formatPrivacyPortalInputAmount,
  resolvePrivacyPortalMaxAmount
} from './usePrivacyPortal';

describe('formatPrivacyPortalInputAmount', () => {
  it('preserves exact 18-decimal values without floating point conversion', () => {
    expect(formatPrivacyPortalInputAmount(1_234567890123456789n, 18)).toBe('1.234567890123456789');
  });

  it('trims only insignificant fractional zeroes', () => {
    expect(formatPrivacyPortalInputAmount(42_500000n, 6)).toBe('42.5');
    expect(formatPrivacyPortalInputAmount(42_000000n, 6)).toBe('42');
    expect(formatPrivacyPortalInputAmount(145n, 8)).toBe('0.00000145');
  });
});

describe('resolvePrivacyPortalMaxAmount', () => {
  it('caps token Max by the live directional bridge maximum', () => {
    expect(resolvePrivacyPortalMaxAmount({ balanceWei: 500n, maxAmountWei: 300n })).toBe(300n);
  });

  it('reserves native COTI gas before applying the live maximum', () => {
    expect(
      resolvePrivacyPortalMaxAmount({
        balanceWei: 500n,
        maxAmountWei: 1_000n,
        gasReserveWei: 25n
      })
    ).toBe(475n);
  });

  it('returns zero when the reserve consumes the balance', () => {
    expect(
      resolvePrivacyPortalMaxAmount({
        balanceWei: 20n,
        maxAmountWei: 1_000n,
        gasReserveWei: 20n
      })
    ).toBe(0n);
  });
});
