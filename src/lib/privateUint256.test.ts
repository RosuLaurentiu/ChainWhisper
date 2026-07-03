import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import { decryptUint256 } from '@coti-io/coti-sdk-typescript';
import { describe, expect, it } from 'vitest';
import { encryptPrivateUint256Input } from './privateUint256';

const AES_KEY = '000102030405060708090a0b0c0d0e0f';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const toHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

const createBrowserLikeSigner = (aesKey = AES_KEY) => {
  let signedMessage: Uint8Array | null = null;
  const signer = {
    address: '0x1111111111111111111111111111111111111111',
    getAddress: async () => '0x1111111111111111111111111111111111111111',
    getUserOnboardInfo: () => ({ aesKey }),
    getAutoOnboard: () => true,
    generateOrRecoverAes: async () => undefined,
    signMessage: async (message: Uint8Array) => {
      signedMessage = message;
      return SIGNATURE;
    }
  } as unknown as JsonRpcSigner;

  return {
    signer,
    getSignedMessage: () => signedMessage
  };
};

const createLockedSigner = () =>
  ({
    address: '0x1111111111111111111111111111111111111111',
    getAddress: async () => '0x1111111111111111111111111111111111111111',
    getUserOnboardInfo: () => undefined,
    getAutoOnboard: () => true,
    generateOrRecoverAes: async () => {
      throw new Error('should not recover aes from encrypt helper');
    },
    signMessage: async () => SIGNATURE
  }) as unknown as JsonRpcSigner;

describe('private uint256 input encryption', () => {
  it('encrypts trading amounts larger than the legacy 64-bit limit', async () => {
    const { signer, getSignedMessage } = createBrowserLikeSigner();
    const amount = 2n ** 80n + 12345n;

    const encrypted = await encryptPrivateUint256Input(
      signer,
      amount,
      '0x2222222222222222222222222222222222222222',
      '0x12345678'
    );

    expect(decryptUint256(encrypted.ciphertext, AES_KEY)).toBe(amount);
    expect(encrypted.signature).toBe(SIGNATURE);
    expect(getSignedMessage()?.length).toBe(108);
    expect(toHex(getSignedMessage() ?? new Uint8Array()).startsWith(
      '0x1111111111111111111111111111111111111111222222222222222222222222222222222222222212345678'
    )).toBe(true);
  });

  it('encrypts full 256-bit private-token amounts', async () => {
    const { signer } = createBrowserLikeSigner();
    const amount = 2n ** 200n + 987654321n;

    const encrypted = await encryptPrivateUint256Input(
      signer,
      amount,
      '0x3333333333333333333333333333333333333333',
      '0xabcdef12'
    );

    expect(decryptUint256(encrypted.ciphertext, AES_KEY)).toBe(amount);
  });

  it('rejects values outside uint256', async () => {
    const { signer } = createBrowserLikeSigner();

    await expect(
      encryptPrivateUint256Input(
        signer,
        2n ** 256n,
        '0x4444444444444444444444444444444444444444',
        '0x12345678'
      )
    ).rejects.toThrow('value must fit uint256');
  });

  it('requires AES to be unlocked before private-token writes', async () => {
    await expect(
      encryptPrivateUint256Input(
        createLockedSigner(),
        123n,
        '0x4444444444444444444444444444444444444444',
        '0x12345678'
      )
    ).rejects.toThrow('Unlock privacy');
  });
});
