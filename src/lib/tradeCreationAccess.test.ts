import { describe, expect, it } from 'vitest';
import { resolveOneOffTradeAccessPlan } from './tradeCreationAccess';

describe('trade creation access planning', () => {
  it('creates fixed-recipient hidden direct orders without link secrets', () => {
    expect(
      resolveOneOffTradeAccessPlan({
        hiddenLiquidity: true,
        tradeVisibility: 'direct'
      })
    ).toEqual({
      shouldCreateAccessSecret: false,
      useHiddenDirectWalletAuthority: true
    });
  });

  it('keeps hidden private-link orders secret gated', () => {
    expect(
      resolveOneOffTradeAccessPlan({
        hiddenLiquidity: true,
        tradeVisibility: 'unlisted'
      })
    ).toEqual({
      shouldCreateAccessSecret: true,
      useHiddenDirectWalletAuthority: false
    });
  });

  it('keeps visible direct and counter offers on Direct link/envelope terms', () => {
    expect(
      resolveOneOffTradeAccessPlan({
        hiddenLiquidity: false,
        tradeVisibility: 'direct'
      }).shouldCreateAccessSecret
    ).toBe(true);
    expect(
      resolveOneOffTradeAccessPlan({
        hiddenLiquidity: false,
        tradeVisibility: 'public',
        isCounterTrade: true
      }).shouldCreateAccessSecret
    ).toBe(true);
  });

  it('does not create secrets for normal public offers', () => {
    expect(
      resolveOneOffTradeAccessPlan({
        hiddenLiquidity: false,
        tradeVisibility: 'public'
      })
    ).toEqual({
      shouldCreateAccessSecret: false,
      useHiddenDirectWalletAuthority: false
    });
  });
});
