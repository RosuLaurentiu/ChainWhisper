import { describe, expect, it } from 'vitest';
import { buildCombinedWalletAssetBalance, formatWalletFundAmount } from './walletFunds';

const cotiAsset = { kind: 'native' as const, symbol: 'COTI', decimals: 18 };
const privateAsset = {
  kind: 'private-erc20' as const,
  tokenAddress: '0x0000000000000000000000000000000000000001',
  symbol: 'p.TEST',
  decimals: 6
};

describe('connected-wallet funding helpers', () => {
  it('reports only the connected browser-wallet balance', () => {
    const balance = buildCombinedWalletAssetBalance({
      asset: cotiAsset,
      balanceWei: 25n * 10n ** 18n
    });

    expect(balance.combinedBalanceWei).toBe(25n * 10n ** 18n);
    expect(balance.availableLabel).toContain('Available 25');
    expect(balance.splitLabel).toBe('Available 25 COTI - 25 COTI in connected wallet');
    expect(balance.splitLabel).not.toContain('ChainWhisper');
  });

  it('shows private balances as locked without exposing cached values', () => {
    const balance = buildCombinedWalletAssetBalance({
      asset: privateAsset,
      balanceWei: null,
      privacyRequired: true
    });

    expect(balance.combinedBalanceWei).toBeNull();
    expect(balance.breakdownLabel).toBe('privacy locked in connected wallet');
    expect(balance.breakdownLabel).not.toContain('0.000075');
  });

  it('formats the connected-wallet requirement using the asset decimals', () => {
    expect(formatWalletFundAmount(1_250_000n, privateAsset)).toBe('1.25 p.TEST');
  });
});
