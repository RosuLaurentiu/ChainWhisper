import { describe, expect, it, vi } from 'vitest';
import type { WalletSessionActions } from '../../../lib/walletSession';
import { getSharedP2PTradeSigner } from './useP2PTradeSigner';

describe('getSharedP2PTradeSigner', () => {
  it('delegates Trading signer requests to the shared wallet session when available', async () => {
    const signer = { id: 'shared-signer' };
    const sharedGetSigner = vi.fn(async () => signer) as unknown as WalletSessionActions['getSigner'];

    await expect(getSharedP2PTradeSigner(sharedGetSigner, true, { refreshAes: true })).resolves.toBe(signer);

    expect(sharedGetSigner).toHaveBeenCalledWith(true, { refreshAes: true });
  });

  it('returns null when Trading is running without a shared wallet session', () => {
    expect(getSharedP2PTradeSigner(undefined, false)).toBeNull();
  });
});
