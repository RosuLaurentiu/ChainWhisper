import { describe, expect, it, vi } from 'vitest';
import {
  assertLegacyWispRecoveryDeployment,
  submitLegacyWispRecoveryTransaction
} from './useTokenSwapActions';

describe('assertLegacyWispRecoveryDeployment', () => {
  it('accepts both exact reviewed vault deployments', () => {
    expect(() => assertLegacyWispRecoveryDeployment({
      contractAddress: '0x5C35CD3659991051F4Fb04F2C4120643739b7BdE',
      direction: 'legacy-unshield',
      runtimeHash: '0x35eebd4f535eb366b9ef29bfc11aea32def0e5257ca15926de244cc2946449de'
    })).not.toThrow();
    expect(() => assertLegacyWispRecoveryDeployment({
      contractAddress: '0xAE80B55D78A88dD65AFB692DFf5BF3e71ab9fE7a',
      direction: 'legacy-unshield-earlier',
      runtimeHash: '0x98e9da6216143afc65f5b0c1bf32c01d7c3ba8c6ae3e6eeee09b0dd33348eeb5'
    })).not.toThrow();
  });

  it('rejects an address, direction, or runtime mismatch before submission', () => {
    expect(() => assertLegacyWispRecoveryDeployment({
      contractAddress: '0xAE80B55D78A88dD65AFB692DFf5BF3e71ab9fE7a',
      direction: 'legacy-unshield',
      runtimeHash: '0x98e9da6216143afc65f5b0c1bf32c01d7c3ba8c6ae3e6eeee09b0dd33348eeb5'
    })).toThrow('No transaction was submitted.');
  });
});

describe('submitLegacyWispRecoveryTransaction', () => {
  it('uses the newer legacy vault native-only payment mode', async () => {
    const unshieldWithMode = vi.fn(async () => ({ hash: `0x${'11'.repeat(32)}` }));
    const unshield = vi.fn();

    await submitLegacyWispRecoveryTransaction({
      amountWei: 12_000000n,
      contract: { unshield, unshieldWithMode },
      direction: 'legacy-unshield',
      nativeFeeWei: 500_000_000_000_000n
    });

    expect(unshieldWithMode).toHaveBeenCalledWith(
      12_000000n,
      1,
      { value: 500_000_000_000_000n }
    );
    expect(unshield).not.toHaveBeenCalled();
  });

  it('uses the earlier legacy vault unshield ABI', async () => {
    const unshieldWithMode = vi.fn();
    const unshield = vi.fn(async () => ({ hash: `0x${'22'.repeat(32)}` }));

    await submitLegacyWispRecoveryTransaction({
      amountWei: 12_000000n,
      contract: { unshield, unshieldWithMode },
      direction: 'legacy-unshield-earlier',
      nativeFeeWei: 500_000_000_000_000n
    });

    expect(unshield).toHaveBeenCalledWith(
      12_000000n,
      { value: 500_000_000_000_000n }
    );
    expect(unshieldWithMode).not.toHaveBeenCalled();
  });

  it('fails closed instead of calling a mismatched vault ABI', async () => {
    await expect(submitLegacyWispRecoveryTransaction({
      amountWei: 1n,
      contract: { unshieldWithMode: vi.fn() },
      direction: 'legacy-unshield-earlier',
      nativeFeeWei: 1n
    })).rejects.toThrow('Earlier legacy vault unshield method is unavailable.');
  });
});
