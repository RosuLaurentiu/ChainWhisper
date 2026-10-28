import {
  getBytes,
  solidityPacked,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import { decodeUint, decryptUint, decryptUint256, encodeKey, encodeUint, encrypt } from '@coti-io/coti-sdk-typescript';
import { describe, expect, it, vi } from 'vitest';
import { decryptPrivateBoolOutput, decryptPrivateUint256Output, encryptPrivateUint128Input, encryptPrivateUint256Input, resignPrivateInput } from './privateUint256';

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
  it.each([false, true])('rejects inexact or invalid amounts before wallet access (native=%s)', async (native) => {
    const access = vi.fn(() => { throw new Error('wallet accessed'); });
    const signer = {
      getUserOnboardInfo: access,
      signMessage: access,
      ...(native ? { encryptValue256: access } : {})
    } as unknown as JsonRpcSigner;
    for (const amount of [Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, Infinity, -1n, 1n << 256n]) {
      await expect(encryptPrivateUint256Input(signer, amount,
        '0x2222222222222222222222222222222222222222', '0x12345678'))
        .rejects.toThrow(/safe integer|fit uint256/);
      expect(access).not.toHaveBeenCalled();
    }
  });

  it('passes exact bigint amounts to the native SDK without reducing the amount domain', async () => {
    const encrypted = { ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: SIGNATURE };
    const encryptValue256 = vi.fn(async () => encrypted);
    const signer = { encryptValue256 } as unknown as JsonRpcSigner;
    for (const amount of [0n, (1n << 256n) - 1n, Number.MAX_SAFE_INTEGER]) {
      await expect(encryptPrivateUint256Input(signer, amount,
        '0x2222222222222222222222222222222222222222', '0x12345678')).resolves.toEqual(encrypted);
      expect(encryptValue256).toHaveBeenLastCalledWith(BigInt(amount),
        '0x2222222222222222222222222222222222222222', '0x12345678');
    }
  });

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
    expect(toHex(getSignedMessage() ?? new Uint8Array())).toBe(
      solidityPacked(
        ['address', 'address', 'bytes4', 'uint256', 'uint256'],
        [
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
          '0x12345678',
          encrypted.ciphertext.ciphertextHigh,
          encrypted.ciphertext.ciphertextLow
        ]
      )
    );
    expect(getBytes(toHex(getSignedMessage() ?? new Uint8Array()))).toHaveLength(108);
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
    expect(decryptPrivateUint256Output(signer, encrypted.ciphertext)).toBe(amount);
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

  it('requires AES to be unlocked before private-token reveals', () => {
    expect(() => decryptPrivateUint256Output(createLockedSigner(), {
      ciphertextHigh: 1n,
      ciphertextLow: 2n
    })).toThrow('Unlock privacy');
  });
});

describe('private Boolean output', () => {
  it('uses the native single-word cipher and rejects unavailable or invalid Boolean values', () => {
    const cipher = (value: bigint) => {
      const encrypted = encrypt(encodeKey(AES_KEY), encodeUint(value));
      return decodeUint(new Uint8Array([...encrypted.ciphertext, ...encrypted.r]));
    };
    const { signer } = createBrowserLikeSigner();
    expect(decryptPrivateBoolOutput(signer, cipher(0n))).toBe(false);
    expect(decryptPrivateBoolOutput(signer, cipher(1n))).toBe(true);
    expect(() => decryptPrivateBoolOutput(signer, cipher(2n))).toThrow('Boolean');
    expect(() => decryptPrivateBoolOutput(createLockedSigner(), cipher(1n))).toThrow('Unlock privacy');
    expect(() => decryptPrivateBoolOutput(signer, -1n)).toThrow('fit uint256');
    expect(() => decryptPrivateBoolOutput(signer, 1n << 256n)).toThrow('fit uint256');
    expect(() => decryptPrivateBoolOutput(createBrowserLikeSigner('11'.repeat(16)).signer, cipher(1n))).toThrow('Boolean');
  });
});

describe('private input signature rebinding', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const contract = '0x2222222222222222222222222222222222222222';
  const selector = '0x12345678';
  const maxWord = (1n << 256n) - 1n;

  it('encrypts the exact uint128 maximum and signs its full 76-byte domain', async () => {
    const { signer, getSignedMessage } = createBrowserLikeSigner();
    const amount = (1n << 128n) - 1n;
    const encrypted = await encryptPrivateUint128Input(signer, amount, contract, selector);

    expect(decryptUint(encrypted.ciphertext, AES_KEY)).toBe(amount);
    expect(encrypted.signature).toBe(SIGNATURE);
    expect(getSignedMessage()).toHaveLength(76);
    expect(toHex(getSignedMessage() ?? new Uint8Array())).toBe(solidityPacked(
      ['address', 'address', 'bytes4', 'uint256'], [owner, contract, selector, encrypted.ciphertext]
    ));
  });

  it('rejects invalid uint128 amounts before privacy or wallet access', async () => {
    const access = vi.fn(() => { throw new Error('wallet accessed'); });
    const signer = { getUserOnboardInfo: access, signMessage: access } as unknown as JsonRpcSigner;
    for (const amount of [-1n, 1n << 128n, 1, '1', null]) {
      await expect(encryptPrivateUint128Input(signer, amount as bigint, contract, selector))
        .rejects.toThrow('fit uint128');
    }
    expect(access).not.toHaveBeenCalled();
  });

  it.each([0n, maxWord, Object.freeze({ ciphertextHigh: 0n, ciphertextLow: maxWord })])(
    'signs the full browser validation domain without changing ciphertext (%s)', async (ciphertext) => {
      const { signer, getSignedMessage } = createBrowserLikeSigner();
      const encryptValue256 = vi.fn(() => { throw new Error('must not encrypt'); });
      Object.assign(signer, { encryptValue256 });
      const result = await resignPrivateInput(signer, ciphertext, contract, selector);
      const words = typeof ciphertext === 'bigint'
        ? [ciphertext] : [ciphertext.ciphertextHigh, ciphertext.ciphertextLow];

      expect(result).toEqual({ ciphertext, signature: SIGNATURE });
      expect(Object.isFrozen(result)).toBe(true);
      expect(toHex(getSignedMessage() ?? new Uint8Array())).toBe(solidityPacked(
        ['address', 'address', 'bytes4', ...words.map(() => 'uint256')],
        [owner, contract, selector, ...words]
      ));
      expect(getSignedMessage()).toHaveLength(words.length === 1 ? 76 : 108);
      expect(encryptValue256).not.toHaveBeenCalled();
      if (typeof ciphertext !== 'bigint') {
        expect(Object.isFrozen(result.ciphertext)).toBe(true);
        expect(ciphertext).toEqual({ ciphertextHigh: 0n, ciphertextLow: maxWord });
        expect(Object.isFrozen(ciphertext)).toBe(true);
      }
    }
  );

  it('changes only the selector domain when the same ciphertext is rebound', async () => {
    const { signer } = createBrowserLikeSigner();
    const messages: Uint8Array[] = [];
    const signMessage = vi.fn(async (message: Uint8Array) => {
      messages.push(message);
      return SIGNATURE;
    });
    Object.assign(signer, { signMessage });
    const ciphertext = Object.freeze({ ciphertextHigh: 17n, ciphertextLow: 29n });

    const first = await resignPrivateInput(signer, ciphertext, contract, selector);
    const second = await resignPrivateInput(signer, ciphertext, contract, '0xabcdef12');

    expect(first.ciphertext).toEqual(ciphertext);
    expect(second.ciphertext).toEqual(ciphertext);
    expect(messages[0].slice(0, 40)).toEqual(messages[1].slice(0, 40));
    expect(toHex(messages[0].slice(40, 44))).toBe(selector);
    expect(toHex(messages[1].slice(40, 44))).toBe('0xabcdef12');
    expect(messages[0].slice(44)).toEqual(messages[1].slice(44));
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid ciphertext words and types before signing', async () => {
    const { signer } = createBrowserLikeSigner();
    const signMessage = vi.fn();
    Object.assign(signer, { signMessage });
    for (const ciphertext of [
      -1n, 1n << 256n, 1, '1', null, undefined, true, [], {},
      { ciphertextHigh: 1n }, { ciphertextHigh: '1', ciphertextLow: 2n },
      { ciphertextHigh: 1n, ciphertextLow: 2 },
      { ciphertextHigh: -1n, ciphertextLow: 2n },
      { ciphertextHigh: 1n, ciphertextLow: 1n << 256n }
    ]) {
      await expect(resignPrivateInput(signer,
        ciphertext as Parameters<typeof resignPrivateInput>[1], contract, selector)).rejects.toThrow();
    }
    expect(signMessage).not.toHaveBeenCalled();
  });

  it('rejects invalid or zero addresses and selectors before signing', async () => {
    const { signer } = createBrowserLikeSigner();
    const signMessage = vi.fn();
    Object.assign(signer, { signMessage });
    for (const address of ['0x1234', `0x${'00'.repeat(20)}`, `0x${'gg'.repeat(20)}`, '']) {
      await expect(resignPrivateInput(signer, 1n, address, selector)).rejects.toThrow();
      Object.assign(signer, { address, getAddress: async () => address });
      await expect(resignPrivateInput(signer, 1n, contract, selector)).rejects.toThrow();
      Object.assign(signer, { address: owner, getAddress: async () => owner });
    }
    for (const invalidSelector of ['0x', '0x123456', '0x1234567890', '0xzzzzzzzz', '0x00000000']) {
      await expect(resignPrivateInput(signer, 1n, contract, invalidSelector)).rejects.toThrow();
    }
    expect(signMessage).not.toHaveBeenCalled();
  });

  it('requires unlocked privacy without recovering AES or signing', async () => {
    const signer = createLockedSigner();
    const signMessage = vi.fn();
    const generateOrRecoverAes = vi.fn();
    Object.assign(signer, { signMessage, generateOrRecoverAes });

    await expect(resignPrivateInput(signer, 1n, contract, selector)).rejects.toThrow('Unlock privacy');
    expect(signMessage).not.toHaveBeenCalled();
    expect(generateOrRecoverAes).not.toHaveBeenCalled();
  });

  it('propagates wallet rejection without changing the ciphertext', async () => {
    const { signer } = createBrowserLikeSigner();
    const rejection = Object.assign(new Error('User rejected the request'), { code: 4001 });
    const signMessage = vi.fn(async () => { throw rejection; });
    Object.assign(signer, { signMessage });
    const ciphertext = Object.freeze({ ciphertextHigh: 17n, ciphertextLow: 29n });

    await expect(resignPrivateInput(signer, ciphertext, contract, selector)).rejects.toBe(rejection);
    expect(ciphertext).toEqual({ ciphertextHigh: 17n, ciphertextLow: 29n });
    expect(signMessage).toHaveBeenCalledTimes(1);
  });
});
