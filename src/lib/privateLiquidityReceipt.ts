import type { PrivateLiquidityEncryptedUint256 } from './privateLiquidityEvents';

const UINT128_MAX = (1n << 128n) - 1n;
const PACK_BASE = 1n << 128n;
const UINT256_MAX = (1n << 256n) - 1n;

export class PrivateLiquidityReceiptPrivacyRefreshRequiredError extends Error {
  constructor() {
    super('Private-liquidity receipt failed its self-check; privacy state may be stale.');
    this.name = 'PrivateLiquidityReceiptPrivacyRefreshRequiredError';
  }
}

export const isPrivateLiquidityReceiptPrivacyRefreshRequired = (
  error: unknown
): error is PrivateLiquidityReceiptPrivacyRefreshRequiredError =>
  error instanceof PrivateLiquidityReceiptPrivacyRefreshRequiredError;

export type PrivateLiquidityUserCiphertext = Readonly<{
  ciphertextHigh: bigint;
  ciphertextLow: bigint;
}>;

export type DecryptPrivateLiquidityUint256 = (
  ciphertext: PrivateLiquidityUserCiphertext
) => Promise<bigint | number | string>;

const decimal = (value: string, label: string): bigint => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be canonical decimal.`);
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) throw new Error(`${label} is out of uint256 range.`);
  return parsed;
};

const decryptedUint256 = (value: bigint | number | string): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Decrypted private-liquidity receipt must be a safe unsigned integer.');
  }
  const normalized = typeof value === 'string' ? value : value.toString();
  return decimal(normalized, 'Decrypted private-liquidity receipt');
};

export const unpackSelfCheckingPrivateLiquidityAmount = (
  packedValue: bigint | number | string
): bigint => {
  const packed = decryptedUint256(packedValue);
  const amount = packed / PACK_BASE;
  const check = packed % PACK_BASE;
  if (amount > UINT128_MAX || check !== UINT128_MAX - amount) {
    throw new PrivateLiquidityReceiptPrivacyRefreshRequiredError();
  }
  return amount;
};

export const decryptPrivateLiquidityReceiptAmount = async ({
  encrypted,
  decrypt
}: {
  encrypted: PrivateLiquidityEncryptedUint256;
  decrypt: DecryptPrivateLiquidityUint256;
}): Promise<bigint> => {
  if (!encrypted || typeof decrypt !== 'function') {
    throw new Error('Private-liquidity receipt decryption is unavailable.');
  }
  // The public authenticated ciphertext is retained for chain provenance. Wallet decryption uses
  // only its recipient-bound user ciphertext and never accepts a caller-provided plaintext amount.
  decimal(encrypted.ciphertextHigh, 'Receipt authenticated ciphertext high');
  decimal(encrypted.ciphertextLow, 'Receipt authenticated ciphertext low');
  const userCiphertext = Object.freeze({
    ciphertextHigh: decimal(encrypted.userCiphertextHigh, 'Receipt user ciphertext high'),
    ciphertextLow: decimal(encrypted.userCiphertextLow, 'Receipt user ciphertext low')
  });
  return unpackSelfCheckingPrivateLiquidityAmount(await decrypt(userCiphertext));
};

export const packSelfCheckingPrivateLiquidityAmountForTest = (amount: bigint): bigint => {
  if (amount < 0n || amount > UINT128_MAX) throw new Error('Test amount is out of uint128 range.');
  return amount * PACK_BASE + (UINT128_MAX - amount);
};
