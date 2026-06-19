import { describe, expect, it } from 'vitest';
import {
  CHAINWHISPER_COTI_FEE_RESERVE_WEI,
  buildCombinedWalletAssetBalance,
  estimateWalletFundingPromptCount,
  resolveCotiFeeReserveFunding,
  resolveWalletFundingRequirement
} from './walletFunds';

const cotiAsset = {
  kind: 'native' as const,
  symbol: 'COTI',
  decimals: 18
};

const privateAsset = {
  kind: 'private-erc20' as const,
  tokenAddress: '0x0000000000000000000000000000000000000001',
  symbol: 'p.TEST',
  decimals: 6
};

describe('wallet funding helpers', () => {
  it('builds a combined ChainWhisper plus owner balance label', () => {
    const combined = buildCombinedWalletAssetBalance({
      asset: cotiAsset,
      chainwhisperBalanceWei: 25n * 10n ** 18n,
      ownerBalanceWei: 75n * 10n ** 18n
    });

    expect(combined.combinedBalanceWei).toBe(100n * 10n ** 18n);
    expect(combined.splitLabel).toContain('Available 100');
    expect(combined.splitLabel).toContain('25');
    expect(combined.splitLabel).toContain('75');
  });

  it('resolves funding requirement states from ChainWhisper and owner balances', () => {
    const cases = [
      {
        label: 'ChainWhisper already covers the required amount',
        input: {
          chainwhisperBalanceWei: 10n,
          ownerBalanceWei: 100n,
          requiredAmountWei: 9n
        },
        expected: { status: 'ready', shortfallWei: 0n }
      },
      {
        label: 'owner wallet covers only the ChainWhisper shortfall',
        input: {
          chainwhisperBalanceWei: 10n,
          ownerBalanceWei: 25n,
          requiredAmountWei: 30n
        },
        expected: { status: 'needs-owner-transfer', shortfallWei: 20n }
      },
      {
        label: 'locked owner private balance cannot be counted',
        input: {
          chainwhisperBalanceWei: 10n,
          ownerBalanceWei: null,
          ownerPrivacyRequired: true,
          requiredAmountWei: 30n
        },
        expected: { status: 'owner-privacy-required', shortfallWei: 20n }
      }
    ];

    for (const { expected, input, label } of cases) {
      expect(resolveWalletFundingRequirement(input), label).toEqual(expected);
    }
  });

  it('estimates private funding as an encryption prompt plus transfer prompt', () => {
    expect(
      estimateWalletFundingPromptCount([
        { asset: cotiAsset, amountWei: 1n },
        { asset: privateAsset, amountWei: 1n }
      ])
    ).toBe(3);
  });

  it('resolves native COTI fee reserve funding states', () => {
    const unit = 10n ** 18n;
    const cases = [
      {
        label: 'tops up enough to leave the fee reserve after the action',
        input: {
          chainwhisperBalanceWei: 9n * unit,
          nativeRequiredAmountWei: 102n * unit,
          ownerBalanceWei: 1000n * unit
        },
        expected: {
          status: 'top-up',
          topUpAmountWei: 93n * unit + CHAINWHISPER_COTI_FEE_RESERVE_WEI
        }
      },
      {
        label: 'does not top up when the post-action COTI reserve remains',
        input: {
          chainwhisperBalanceWei: 103n * unit,
          nativeRequiredAmountWei: 102n * unit,
          ownerBalanceWei: 1000n * unit
        },
        expected: { status: 'ready', topUpAmountWei: 0n }
      },
      {
        label: 'keeps the reserve best-effort when owner cannot cover the extra cushion',
        input: {
          chainwhisperBalanceWei: 102n * unit,
          nativeRequiredAmountWei: 102n * unit,
          ownerBalanceWei: 1n
        },
        expected: { status: 'owner-insufficient', topUpAmountWei: CHAINWHISPER_COTI_FEE_RESERVE_WEI }
      }
    ];

    for (const { expected, input, label } of cases) {
      expect(resolveCotiFeeReserveFunding(input), label).toEqual(expected);
    }
  });
});
