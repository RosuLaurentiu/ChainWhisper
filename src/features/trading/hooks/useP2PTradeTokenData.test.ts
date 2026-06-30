import { describe, expect, it } from 'vitest';
import {
  resolveBalanceWeiAfterRefresh,
  resolvePrivateBalanceAesReady,
  resolvePrivateBalanceWeiAfterRefresh,
  resolvePrivateBalanceStateAfterRefresh,
  shouldRefreshPrivateTokenInfoForWallet
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

  it('treats an explicit unlocked signer as AES-ready during stale refresh closures', () => {
    expect(resolvePrivateBalanceAesReady({ walletHasAes: false })).toBe(false);
    expect(resolvePrivateBalanceAesReady({ walletHasAes: true })).toBe(true);
    expect(resolvePrivateBalanceAesReady({ signer: {} as never, walletHasAes: false })).toBe(true);
  });

  it('does not refresh private token metadata just because AES readiness is unset and locked', () => {
    expect(
      shouldRefreshPrivateTokenInfoForWallet({
        tokenKind: 'private-erc20',
        existing: { aesReady: undefined, loading: false },
        walletHasAes: false
      })
    ).toBe(false);
    expect(
      shouldRefreshPrivateTokenInfoForWallet({
        tokenKind: 'private-erc20',
        existing: { aesReady: false, loading: false },
        walletHasAes: true
      })
    ).toBe(true);
    expect(
      shouldRefreshPrivateTokenInfoForWallet({
        tokenKind: 'erc20',
        existing: { aesReady: undefined, loading: false },
        walletHasAes: true
      })
    ).toBe(false);
  });
});
