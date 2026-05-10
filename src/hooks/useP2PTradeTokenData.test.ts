import { describe, expect, it } from 'vitest';
import {
  resolveBalanceWeiAfterRefresh,
  resolvePrivateBalanceWeiAfterRefresh,
  resolvePrivateBalanceStateAfterRefresh
} from './useP2PTradeTokenData';

describe('wallet balance refresh helpers', () => {
  it('keeps previous balances during silent failed refreshes', () => {
    expect(resolveBalanceWeiAfterRefresh(123n, null, true)).toBe(123n);
    expect(resolveBalanceWeiAfterRefresh(123n, 456n, true)).toBe(456n);
    expect(resolveBalanceWeiAfterRefresh(123n, null, false)).toBeNull();
  });

  it('keeps a ready private-token state during same-wallet non-ready refreshes', () => {
    const readyState = { status: 'ready' as const, balanceWei: 123n };
    expect(resolvePrivateBalanceStateAfterRefresh(readyState, { status: 'decrypt-failed' })).toBe(readyState);
    expect(resolvePrivateBalanceStateAfterRefresh(readyState, { status: 'locked' })).toBe(readyState);
    expect(resolvePrivateBalanceStateAfterRefresh({ status: 'locked' }, { status: 'ready', balanceWei: 456n })).toEqual({
      status: 'ready',
      balanceWei: 456n
    });
  });

  it('keeps the previous private-token balance when a same-wallet refresh is not ready', () => {
    expect(resolvePrivateBalanceWeiAfterRefresh(123n, { status: 'locked' })).toBe(123n);
    expect(resolvePrivateBalanceWeiAfterRefresh(123n, { status: 'decrypt-failed' })).toBe(123n);
    expect(resolvePrivateBalanceWeiAfterRefresh(123n, { status: 'setup-needed' })).toBe(123n);
    expect(resolvePrivateBalanceWeiAfterRefresh(123n, { status: 'ready', balanceWei: 456n })).toBe(456n);
  });
});
