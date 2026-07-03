import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  decodeUint,
  encodeKey,
  encrypt,
  prepareIT256,
  type itUint256
} from '@coti-io/coti-sdk-typescript';
import { logMobileWalletDiagnostic } from './mobileWalletDiagnostics';

type PrivateUint256Signer = Wallet | JsonRpcSigner;

export type PrivateUint256Input = {
  ciphertext: {
    ciphertextHigh: bigint;
    ciphertextLow: bigint;
  };
  signature: string | Uint8Array;
};

export const EMPTY_PRIVATE_UINT256_INPUT: PrivateUint256Input = {
  ciphertext: {
    ciphertextHigh: 0n,
    ciphertextLow: 0n
  },
  signature: '0x'
};

const BLOCK_SIZE_BYTES = 16;
const UINT256_SIZE_BYTES = 32;
const MAX_UINT256 = (1n << 256n) - 1n;

const stripHexPrefix = (value: string): string => value.startsWith('0x') ? value.slice(2) : value;

const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

const hexToBytes = (value: string): Uint8Array => {
  const hex = stripHexPrefix(value);
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string.');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

const packPrivateUint256ValidationMessage = (
  senderAddress: string,
  contractAddress: string,
  functionSelector: string,
  ciphertextBytes: Uint8Array
): Uint8Array =>
  hexToBytes(
    `0x${stripHexPrefix(senderAddress)}${stripHexPrefix(contractAddress)}${stripHexPrefix(functionSelector)}${stripHexPrefix(bytesToHex(ciphertextBytes))}`
  );

const normalizePrivateUint256Input = (value: itUint256 | PrivateUint256Input): PrivateUint256Input => ({
  ciphertext: {
    ciphertextHigh: BigInt(value.ciphertext.ciphertextHigh),
    ciphertextLow: BigInt(value.ciphertext.ciphertextLow)
  },
  signature: typeof value.signature === 'string' ? value.signature : bytesToHex(value.signature)
});

const uintToBytes = (value: bigint, byteLength: number): Uint8Array => {
  const bytes = new Uint8Array(byteLength);
  let nextValue = value;
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = Number(nextValue & 0xffn);
    nextValue >>= 8n;
  }
  return bytes;
};

const buildCiphertextBytes = (plaintext: bigint, aesKey: string): Uint8Array => {
  const aesKeyBytes = encodeKey(aesKey);
  if (plaintext < 1n << 128n) {
    const encryptedHigh = encrypt(aesKeyBytes, uintToBytes(0n, BLOCK_SIZE_BYTES));
    const encryptedLow = encrypt(aesKeyBytes, uintToBytes(plaintext, BLOCK_SIZE_BYTES));
    return new Uint8Array([
      ...encryptedHigh.ciphertext,
      ...encryptedHigh.r,
      ...encryptedLow.ciphertext,
      ...encryptedLow.r
    ]);
  }

  const plaintextBytes = uintToBytes(plaintext, UINT256_SIZE_BYTES);
  const encryptedHigh = encrypt(aesKeyBytes, plaintextBytes.slice(0, BLOCK_SIZE_BYTES));
  const encryptedLow = encrypt(aesKeyBytes, plaintextBytes.slice(BLOCK_SIZE_BYTES));
  return new Uint8Array([
    ...encryptedHigh.ciphertext,
    ...encryptedHigh.r,
    ...encryptedLow.ciphertext,
    ...encryptedLow.r
  ]);
};

const ensureSignerAesKey = async (signer: PrivateUint256Signer): Promise<string> => {
  const currentInfo = signer.getUserOnboardInfo();
  if (currentInfo?.aesKey) {
    return currentInfo.aesKey;
  }

  throw new Error('Unlock privacy before preparing a private token transaction.');
};

const resolveSignerAddress = async (signer: PrivateUint256Signer): Promise<string> => {
  const directAddress = (signer as { address?: unknown }).address;
  if (typeof directAddress === 'string' && directAddress.trim()) {
    return directAddress;
  }
  return signer.getAddress();
};

const normalizeAmount = (plaintextValue: bigint | number): bigint => {
  const plaintext = typeof plaintextValue === 'number' ? BigInt(plaintextValue) : plaintextValue;
  if (plaintext < 0n || plaintext > MAX_UINT256) {
    throw new RangeError('encryptPrivateUint256Input: value must fit uint256.');
  }
  return plaintext;
};

const encryptWithBrowserSigner = async (
  signer: PrivateUint256Signer,
  plaintext: bigint,
  contractAddress: string,
  functionSelector: string,
  aesKey: string
): Promise<PrivateUint256Input> => {
  const senderAddress = await resolveSignerAddress(signer);
  const ciphertextBytes = buildCiphertextBytes(plaintext, aesKey);
  const ciphertextHigh = decodeUint(ciphertextBytes.slice(0, UINT256_SIZE_BYTES));
  const ciphertextLow = decodeUint(ciphertextBytes.slice(UINT256_SIZE_BYTES));
  const validationMessage = packPrivateUint256ValidationMessage(
    senderAddress,
    contractAddress,
    functionSelector,
    ciphertextBytes
  );
  const signature = await signer.signMessage(validationMessage);

  return {
    ciphertext: {
      ciphertextHigh,
      ciphertextLow
    },
    signature
  };
};

export const encryptPrivateUint256Input = async (
  signer: PrivateUint256Signer,
  plaintextValue: bigint | number,
  contractAddress: string,
  functionSelector: string
): Promise<PrivateUint256Input> => {
  const nativeEncryptValue256 = (signer as {
    encryptValue256?: (
      plaintextValue: bigint | number,
      contractAddress: string,
      functionSelector: string
    ) => Promise<itUint256 | PrivateUint256Input>;
  }).encryptValue256;
  if (typeof nativeEncryptValue256 === 'function') {
    logMobileWalletDiagnostic('private-amount-sign', {
      source: 'native-encrypt'
    });
    return normalizePrivateUint256Input(
      await nativeEncryptValue256.call(signer, plaintextValue, contractAddress, functionSelector)
    );
  }

  const plaintext = normalizeAmount(plaintextValue);
  const aesKey = await ensureSignerAesKey(signer);
  const privateKey = (signer as { privateKey?: unknown }).privateKey;
  if (typeof privateKey === 'string' && privateKey.trim()) {
    return normalizePrivateUint256Input(
      prepareIT256(plaintext, { wallet: signer as Wallet, userKey: aesKey }, contractAddress, functionSelector)
    );
  }

  logMobileWalletDiagnostic('private-amount-sign', {
    source: 'browser-signer'
  });
  return encryptWithBrowserSigner(signer, plaintext, contractAddress, functionSelector, aesKey);
};
