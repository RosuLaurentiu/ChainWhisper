import { describe, expect, it } from 'vitest';
import { deriveTradeComposerModel } from './tradeComposer';

const baseParams = {
  activeContact: null,
  walletAddress: '0x000000000000000000000000000000000000dEaD',
  isSelfChat: false,
  onCotiNetwork: true,
  creatingTrade: false,
  sending: false,
  tipping: false,
  tradeFeeModeSelection: 'coti' as const,
  tradeOfferTokenSelection: 'pwisp' as const,
  tradeRequestTokenSelection: 'coti' as const,
  tradeOfferCustomTokenAddress: '',
  tradeRequestCustomTokenAddress: '',
  tradeCustomOfferTokenKind: 'erc20' as const,
  tradeCustomRequestTokenKind: 'erc20' as const,
  customTradeTokenInfoByAddress: {},
  tradeOfferAmountInput: '10',
  tradeRequestAmountInput: '2',
  tradeExpiryHoursInput: '24',
  tradeHasNoExpiry: false,
  tradeHidePrivateLiquidity: false,
  rewardTokenSymbol: 'WISP',
  rewardTokenDecimals: 6,
  privateRewardTokenSymbol: 'pWISP',
  privateRewardTokenDecimals: 6,
  tipNativeBalanceWei: 10n ** 18n,
  rewardTokenBalanceWei: 0n,
  privateRewardTokenBalanceWei: 100_000_000n,
  tradeRequiredFeeWei: 0n,
  counterpartyRequired: false
};

describe('trade composer private token visibility', () => {
  it('allows visible private-token orders without forcing hidden amount mode', () => {
    const model = deriveTradeComposerModel(baseParams);

    expect(model.hiddenLiquidityActive).toBe(false);
    expect(model.tradeComposerFieldErrors.general).toBeUndefined();
    expect(model.canSendTradeOffer).toBe(true);
  });

  it('allows visible private-token request orders through the normal visible path', () => {
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'wisp',
      tradeRequestTokenSelection: 'pwisp',
      rewardTokenBalanceWei: 100_000_000n,
      privateRewardTokenBalanceWei: 0n
    });

    expect(model.hiddenLiquidityActive).toBe(false);
    expect(model.canHidePrivateLiquidity).toBe(false);
    expect(model.tradeComposerFieldErrors.general).toBeUndefined();
    expect(model.canSendTradeOffer).toBe(true);
  });

  it('still supports explicit hidden amount mode when the offered token is private', () => {
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeHidePrivateLiquidity: true
    });

    expect(model.hiddenLiquidityActive).toBe(true);
    expect(model.canHidePrivateLiquidity).toBe(true);
    expect(model.tradeComposerFieldErrors.general).toBeUndefined();
  });

  it('rejects hidden amount mode when the offered token is public', () => {
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'wisp',
      tradeRequestTokenSelection: 'pwisp',
      tradeHidePrivateLiquidity: true,
      rewardTokenBalanceWei: 100_000_000n
    });

    expect(model.hiddenLiquidityActive).toBe(false);
    expect(model.tradeComposerFieldErrors.general).toBe('Hide amount requires the token you sell to be private.');
    expect(model.canSendTradeOffer).toBe(false);
  });
});
