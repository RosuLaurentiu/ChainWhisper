import { describe, expect, it } from 'vitest';
import { deriveTokenSwapView } from './tokenSwapView';

const baseInput = {
  hasAesReady: true,
  legacyPrivateRewardTokenBalanceWei: 1_000000n,
  legacyPrivateRewardTokenDecimals: 6,
  legacyPrivateRewardTokenSymbol: 'pWISP',
  loadingRewardBalances: false,
  onCotiNetwork: true,
  privateRewardTokenBalanceWei: 2_000000n,
  privateRewardTokenDecimals: 6,
  privateRewardTokenSymbol: 'pWISP',
  rewardTokenBalanceWei: 3_000000n,
  rewardTokenDecimals: 6,
  rewardTokenSymbol: 'WISP',
  swapAmountInput: '1.5',
  swapDirection: 'shield' as const,
  swappingTokens: false,
  walletAddress: '0x0000000000000000000000000000000000000001'
};

describe('deriveTokenSwapView', () => {
  it('builds the active shield view model', () => {
    const view = deriveTokenSwapView(baseInput);

    expect(view.swapInputSymbol).toBe('WISP');
    expect(view.swapPrivateRewardTokenSymbol).toBe('pWISP');
    expect(view.parsedSwapAmount).toBe(1_500000n);
    expect(view.canSwapRewardTokens).toBe(true);
    expect(view.swapButtonLabel).toBe('Move to pWISP');
    expect(view.tokenToolsSummary).toBe('WISP 3 | pWISP 2');
  });

  it('shows locked private balance when privacy is not ready', () => {
    const view = deriveTokenSwapView({
      ...baseInput,
      hasAesReady: false,
      privateRewardTokenBalanceWei: null
    });

    expect(view.canSwapRewardTokens).toBe(false);
    expect(view.swapButtonLabel).toBe('Unlock privacy');
    expect(view.tokenToolsSummary).toBe('WISP 3 | pWISP locked');
  });

  it('uses legacy private token details for legacy unshield', () => {
    const view = deriveTokenSwapView({
      ...baseInput,
      legacyPrivateRewardTokenSymbol: '',
      swapDirection: 'legacy-unshield'
    });

    expect(view.swapInputSymbol).toBe('p.WISP (old)');
    expect(view.swapPrivateRewardTokenBalanceWei).toBe(1_000000n);
  });
});
