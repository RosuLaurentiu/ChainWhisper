import { describe, expect, it } from 'vitest';
import { shortenAddress } from './appShared';
import { HOTDOG_PRIVATE_TOKEN_ADDRESS, buildTradeCustomTokenInfoKey } from './appHelpers';
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

  it('does not duplicate built-in pWISP in the verified private-token options', () => {
    const model = deriveTradeComposerModel(baseParams);
    const privatePwispOptions = model.tradeTokenOptions.filter(
      (option) => option.label.includes('pWISP') && option.label.includes('(private)')
    );

    expect(privatePwispOptions).toEqual([{ value: 'pwisp', label: '✓ pWISP (private)' }]);
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

  it('keeps a verified token address pending instead of flashing an invalid receive field', () => {
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'wisp',
      tradeRequestTokenSelection: HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase(),
      rewardTokenBalanceWei: 100_000_000n
    });

    expect(model.tradeComposerFieldErrors.requestAsset).toBeUndefined();
    expect(model.tradeComposerValidationMessage).toBe('Loading token to receive.');
    expect(model.tradeRequestVerifyUrl).toBe(`https://mainnet.cotiscan.io/address/${HOTDOG_PRIVATE_TOKEN_ADDRESS}`);
    expect(model.selectedTradeRequestToken?.symbol).toBe('HOTDOG');
    expect(model.tradeTokenOptions).toContainEqual({
      value: HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase(),
      label: '✓ HOTDOG (private)'
    });
    expect(model.tradeRequestAmountSummaryLabel).toBe('2 HOTDOG');
    expect(model.tradeRateLabel).toBe('1 WISP = 0.2 HOTDOG');
    expect(model.canSendTradeOffer).toBe(false);
  });

  it('keeps verified token labels stable when metadata retries after an error', () => {
    const tokenKey = buildTradeCustomTokenInfoKey('private-erc20', HOTDOG_PRIVATE_TOKEN_ADDRESS);
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'wisp',
      tradeRequestTokenSelection: HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase(),
      customTradeTokenInfoByAddress: {
        [tokenKey]: {
          kind: 'private-erc20',
          address: HOTDOG_PRIVATE_TOKEN_ADDRESS,
          symbol: shortenAddress(HOTDOG_PRIVATE_TOKEN_ADDRESS),
          decimals: 6,
          balanceWei: null,
          loading: false,
          error: 'Unable to load token.'
        }
      },
      rewardTokenBalanceWei: 100_000_000n
    });

    expect(model.tradeComposerFieldErrors.requestAsset).toBeUndefined();
    expect(model.tradeComposerValidationMessage).toBe('Loading token to receive.');
    expect(model.selectedTradeRequestToken?.symbol).toBe('HOTDOG');
    expect(model.tradeTokenOptions).toContainEqual({
      value: HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase(),
      label: '✓ HOTDOG (private)'
    });
    expect(model.tradeRequestAmountSummaryLabel).toBe('2 HOTDOG');
    expect(model.tradeRateLabel).toBe('1 WISP = 0.2 HOTDOG');
    expect(model.canSendTradeOffer).toBe(false);
  });

  it('keeps loading custom token metadata pending without marking the token field invalid', () => {
    const tokenKey = buildTradeCustomTokenInfoKey('private-erc20', HOTDOG_PRIVATE_TOKEN_ADDRESS);
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'wisp',
      tradeRequestTokenSelection: 'custom-private',
      tradeRequestCustomTokenAddress: HOTDOG_PRIVATE_TOKEN_ADDRESS,
      tradeCustomRequestTokenKind: 'private-erc20',
      customTradeTokenInfoByAddress: {
        [tokenKey]: {
          kind: 'private-erc20',
          address: HOTDOG_PRIVATE_TOKEN_ADDRESS,
          symbol: 'HOTDOG',
          decimals: 6,
          balanceWei: null,
          loading: true
        }
      },
      rewardTokenBalanceWei: 100_000_000n
    });

    expect(model.tradeComposerFieldErrors.requestAsset).toBeUndefined();
    expect(model.tradeComposerValidationMessage).toBe('Loading token to receive.');
    expect(model.tradeRequestVerifyUrl).toBe(`https://mainnet.cotiscan.io/address/${HOTDOG_PRIVATE_TOKEN_ADDRESS}`);
    expect(model.selectedTradeRequestToken?.symbol).toBe('HOTDOG');
    expect(model.tradeRequestAmountSummaryLabel).toBe('2 HOTDOG');
    expect(model.tradeRateLabel).toBe('1 WISP = 0.2 HOTDOG');
    expect(model.canSendTradeOffer).toBe(false);
  });

  it('reports balances for both selected trade sides', () => {
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'wisp',
      tradeRequestTokenSelection: 'coti',
      rewardTokenBalanceWei: 123_456_000n,
      tipNativeBalanceWei: 2n * 10n ** 18n
    });

    expect(model.tradeOfferBalanceSummaryLabel).toBe('123.456 WISP');
    expect(model.tradeRequestBalanceSummaryLabel).toBe('2 COTI');
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
