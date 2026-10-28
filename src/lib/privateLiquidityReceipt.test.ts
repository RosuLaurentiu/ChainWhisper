import { describe, expect, it, vi } from 'vitest';
import {
  decryptPrivateLiquidityReceiptAmount,
  isPrivateLiquidityReceiptPrivacyRefreshRequired,
  packSelfCheckingPrivateLiquidityAmountForTest,
  unpackSelfCheckingPrivateLiquidityAmount
} from './privateLiquidityReceipt';

const encrypted = {
  ciphertextHigh: '1',
  ciphertextLow: '2',
  userCiphertextHigh: '3',
  userCiphertextLow: '4'
};

describe('privateLiquidityReceipt', () => {
  it.each([0n, 1n, 42n, (1n << 128n) - 1n])(
    'round-trips self-checking amount %s',
    (amount) => {
      expect(unpackSelfCheckingPrivateLiquidityAmount(
        packSelfCheckingPrivateLiquidityAmountForTest(amount)
      )).toBe(amount);
    }
  );

  it('decrypts only the recipient user ciphertext and validates the result', async () => {
    const decrypt = vi.fn(async () => packSelfCheckingPrivateLiquidityAmountForTest(77n));
    await expect(decryptPrivateLiquidityReceiptAmount({ encrypted, decrypt })).resolves.toBe(77n);
    expect(decrypt).toHaveBeenCalledWith({ ciphertextHigh: 3n, ciphertextLow: 4n });
  });

  it('rejects plausible-looking wrong-key values and malformed ciphertext limbs', async () => {
    const wrongKey = decryptPrivateLiquidityReceiptAmount({
      encrypted,
      decrypt: async () => 77n << 128n
    });
    await expect(wrongKey).rejects.toThrow(/failed its self-check/);
    await expect(wrongKey.catch((error) => isPrivateLiquidityReceiptPrivacyRefreshRequired(error)))
      .resolves.toBe(true);
    await expect(decryptPrivateLiquidityReceiptAmount({
      encrypted: { ...encrypted, userCiphertextLow: '01' },
      decrypt: async () => 0n
    })).rejects.toThrow(/canonical decimal/);
  });

  it('rejects values outside uint256 and unsafe numeric decryptions', () => {
    expect(() => unpackSelfCheckingPrivateLiquidityAmount((1n << 256n).toString()))
      .toThrow(/out of uint256 range/);
    expect(() => unpackSelfCheckingPrivateLiquidityAmount(Number.MAX_SAFE_INTEGER + 1))
      .toThrow(/safe unsigned integer/);
  });
});
