import { describe, expect, it } from 'vitest';
import {
  __resolveDirectOnChainAccessSecretForTest,
  __resolvePrivateOrderFillFunctionNameForTest,
  shouldRouteTradeThroughDirectEscrow
} from './tradeActions';

describe('tradeActions routing', () => {
  it('routes every non-public one-off offer and counter through Direct escrow', () => {
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: true })).toBe(false);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: false })).toBe(true);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: true, parentTradeId: 3 })).toBe(true);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: true, parentTradeId: 3, hidePrivateLiquidity: true })).toBe(true);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: false, hidePrivateLiquidity: true })).toBe(false);
  });

  it('keeps Direct link secrets off-chain when fixed-recipient wallet authority is enough', () => {
    const secret = `0x${'ab'.repeat(32)}`;

    expect(__resolveDirectOnChainAccessSecretForTest(secret, true)).toBeUndefined();
    expect(__resolveDirectOnChainAccessSecretForTest(secret, false)).toBe(secret);
    expect(__resolveDirectOnChainAccessSecretForTest(secret)).toBe(secret);
  });

  it('uses no-secret hidden private fill functions when no access hash is present', () => {
    expect(
      __resolvePrivateOrderFillFunctionNameForTest({
        requestIsPrivate: true
      })
    ).toBe('fillPrivateOrder');
    expect(
      __resolvePrivateOrderFillFunctionNameForTest({
        requestIsPrivate: false
      })
    ).toBe('fillHybridPrivateOrder');
  });

  it('keeps legacy or private-link hidden fills secret gated when a secret exists', () => {
    const secret = `0x${'cd'.repeat(32)}`;

    expect(
      __resolvePrivateOrderFillFunctionNameForTest({
        requestIsPrivate: true,
        accessSecret: secret
      })
    ).toBe('fillPrivateOrderWithEncryptedAccess');
    expect(
      __resolvePrivateOrderFillFunctionNameForTest({
        requestIsPrivate: false,
        accessSecret: secret
      })
    ).toBe('fillHybridPrivateOrderWithEncryptedAccess');
  });
});
