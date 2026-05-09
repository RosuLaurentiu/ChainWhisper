import { describe, expect, it } from 'vitest';
import {
  resolveBalanceWeiAfterRefresh,
  resolvePrivateBalanceStateAfterRefresh
} from './useP2PTradeTokenData';

describe('wallet balance refresh helpers', () => {
  it('keeps previous balances during silent failed refreshes', () => {
    expect(resolveBalanceWeiAfterRefresh(123n, null, true)).toBe(123n);
    expect(resolveBalanceWeiAfterRefresh(123n, 456n, true)).toBe(456n);
    expect(resolveBalanceWeiAfterRefresh(123n, null, false)).toBeNull();
  });

  it('keeps a ready private-token state during silent non-ready refreshes', () => {
    const readyState = { status: 'ready' as const, balanceWei: 123n };
    expect(resolvePrivateBalanceStateAfterRefresh(readyState, { status: 'decrypt-failed' }, true)).toBe(readyState);
    expect(resolvePrivateBalanceStateAfterRefresh(readyState, { status: 'locked' }, false)).toEqual({
      status: 'locked'
    });
    expect(resolvePrivateBalanceStateAfterRefresh({ status: 'locked' }, { status: 'ready', balanceWei: 456n }, true)).toEqual({
      status: 'ready',
      balanceWei: 456n
    });
  });
});
