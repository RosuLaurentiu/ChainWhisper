import { describe, expect, it } from 'vitest';
import { REWARD_TOKEN_ADDRESS, shortenAddress } from './appShared';
import {
  GCOTI_TOKEN_ADDRESS,
  HOTDOG_PRIVATE_TOKEN_ADDRESS,
  USDC_E_TOKEN_ADDRESS,
  VERIFIED_ECOSYSTEM_TOKENS,
  buildTradeCustomTokenInfoKey
} from './appHelpers';
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

const verifiedTokenValue = (symbol: string): string => {
  const token = VERIFIED_ECOSYSTEM_TOKENS.find((candidate) => candidate.symbol === symbol);
  if (!token) {
    throw new Error(`Missing verified token fixture: ${symbol}`);
  }
  return token.address.toLowerCase();
};

describe('trade composer private token visibility', () => {
  it('keeps public and private create token options in matching asset order', () => {
    const model = deriveTradeComposerModel(baseParams);
    const optionValues = model.tradeTokenOptions.map((option) => option.value);

    const pairedPublicOrder = [
      'coti',
      GCOTI_TOKEN_ADDRESS.toLowerCase(),
      USDC_E_TOKEN_ADDRESS.toLowerCase(),
      'wisp',
      verifiedTokenValue('WETH'),
      verifiedTokenValue('WBTC'),
      verifiedTokenValue('USDT'),
      verifiedTokenValue('wADA'),
      verifiedTokenValue('Pengo')
    ];
    const pairedPrivateOrder = [
      verifiedTokenValue('p.COTI'),
      verifiedTokenValue('p.gCOTI'),
      verifiedTokenValue('p.USDC.e'),
      'pwisp',
      verifiedTokenValue('p.WETH'),
      verifiedTokenValue('p.WBTC'),
      verifiedTokenValue('p.USDT'),
      verifiedTokenValue('p.wADA'),
      verifiedTokenValue('pPENGO')
    ];

    expect(optionValues.slice(0, 3)).toEqual([
      'coti',
      GCOTI_TOKEN_ADDRESS.toLowerCase(),
      USDC_E_TOKEN_ADDRESS.toLowerCase()
    ]);
    expect(optionValues.filter((value) => pairedPublicOrder.includes(value))).toEqual(pairedPublicOrder);
    expect(optionValues.filter((value) => pairedPrivateOrder.includes(value))).toEqual(pairedPrivateOrder);
  });

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

    expect(privatePwispOptions).toEqual([
      expect.objectContaining({
        value: 'pwisp',
        label: '✓ pWISP (private)',
        kindLabel: 'Private',
        verificationLabel: 'Verified private token'
      })
    ]);
    expect(model.tradeTokenOptions.some((option) => option.value.startsWith('custom'))).toBe(false);
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
    expect(model.tradeTokenOptions).toContainEqual(
      expect.objectContaining({
        value: HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase(),
        label: '✓ HOTDOG (private)',
        kindLabel: 'Private',
        verificationLabel: 'Verified private token'
      })
    );
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
    expect(model.tradeTokenOptions).toContainEqual(
      expect.objectContaining({
        value: HOTDOG_PRIVATE_TOKEN_ADDRESS.toLowerCase(),
        label: '✓ HOTDOG (private)',
        kindLabel: 'Private',
        verificationLabel: 'Verified private token'
      })
    );
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

  it('uses combined owner and ChainWhisper balances for max and validation', () => {
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'wisp',
      tradeRequestTokenSelection: 'coti',
      tradeOfferAmountInput: '150',
      rewardTokenBalanceWei: 100_000_000n,
      combinedBalanceByAssetKey: {
        [`erc20:${REWARD_TOKEN_ADDRESS.toLowerCase()}`]: {
          combinedBalanceWei: 200_000_000n
        }
      }
    });

    expect(model.tradeComposerFieldErrors.offerAmount).toBeUndefined();
    expect(model.tradeOfferMaxInputValue).toBe('200');
  });

  it('rejects same-asset trades even when the amounts differ', () => {
    const model = deriveTradeComposerModel({
      ...baseParams,
      tradeOfferTokenSelection: 'coti',
      tradeRequestTokenSelection: 'coti',
      tradeOfferAmountInput: '100',
      tradeRequestAmountInput: '2',
      tipNativeBalanceWei: 200n * 10n ** 18n,
      tradeRequiredFeeWei: 2n * 10n ** 18n
    });

    expect(model.tradeComposerFieldErrors.general).toBe('Choose two different assets for the trade.');
    expect(model.canSendTradeOffer).toBe(false);
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
    expect(model.tradeComposerFieldErrors.general).toBe('Private liquidity requires the token you sell to be private.');
    expect(model.canSendTradeOffer).toBe(false);
  });
});
