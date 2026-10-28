import {
  getBytes,
  getAddress,
  solidityPacked,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import {
  decodeUint,
  decryptUint,
  decryptUint256,
  encodeKey,
  encrypt,
  type ctUint256,
  type itUint256
} from '@coti-io/coti-sdk-typescript';
import { logMobileWalletDiagnostic } from './mobileWalletDiagnostics';

type PrivateUint256Signer = JsonRpcSigner;

export type PrivateUint256Input = {
  ciphertext: {
    ciphertextHigh: bigint;
    ciphertextLow: bigint;
  };
  signature: string | Uint8Array;
};

export type PrivateUint256Output = Readonly<{
  ciphertextHigh: bigint | number | string;
  ciphertextLow: bigint | number | string;
}>;

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

const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

const packPrivateUint256ValidationMessage = (
  senderAddress: string,
  contractAddress: string,
  functionSelector: string,
  ciphertextBytes: Uint8Array
): Uint8Array =>
  // COTI's browser-wallet path validates personal_sign over this full 108-byte domain.
  // Signing its 32-byte keccak digest instead is a different signature and is rejected on-chain.
  getBytes(solidityPacked(
    ['bytes', 'bytes', 'bytes4', 'bytes'],
    [getBytes(senderAddress), getBytes(contractAddress), functionSelector, ciphertextBytes]
  ));

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
  if (typeof plaintextValue === 'number' && !Number.isSafeInteger(plaintextValue)) {
    throw new RangeError('encryptPrivateUint256Input: use bigint unless the value is a safe integer.');
  }
  const plaintext = typeof plaintextValue === 'number' ? BigInt(plaintextValue) : plaintextValue;
  if (plaintext < 0n || plaintext > MAX_UINT256) {
    throw new RangeError('encryptPrivateUint256Input: value must fit uint256.');
  }
  return plaintext;
};

const normalizeCiphertextWord = (value: bigint | number | string, label: string): bigint => {
  let word: bigint;
  try {
    word = BigInt(value);
  } catch {
    throw new TypeError(`${label} must be an unsigned integer.`);
  }
  if (word < 0n || word > MAX_UINT256) {
    throw new RangeError(`${label} must fit uint256.`);
  }
  return word;
};

export const decryptPrivateUint256Output = (
  signer: Pick<PrivateUint256Signer, 'getUserOnboardInfo'>,
  ciphertext: PrivateUint256Output
): bigint => {
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) {
    throw new Error('Unlock privacy before revealing private token amounts.');
  }
  const normalized: ctUint256 = {
    ciphertextHigh: normalizeCiphertextWord(ciphertext.ciphertextHigh, 'Private ciphertext high word'),
    ciphertextLow: normalizeCiphertextWord(ciphertext.ciphertextLow, 'Private ciphertext low word')
  };
  return decryptUint256(normalized, aesKey);
};

export const decryptPrivateBoolOutput = (
  signer: Pick<PrivateUint256Signer, 'getUserOnboardInfo'>, ciphertext: bigint
): boolean => {
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing private Boolean values.');
  const value = decryptUint(normalizeCiphertextWord(ciphertext, 'Private Boolean ciphertext'), aesKey);
  if (value !== 0n && value !== 1n) throw new Error('Private Boolean value is invalid.');
  return value === 1n;
};

// A preview commitment binds ciphertext, not plaintext. Re-encryption would
// invalidate it. Browser COTI signatures cover the full domain, not its digest.
export const resignPrivateInput = async <T extends bigint | Readonly<{ ciphertextHigh: bigint; ciphertextLow: bigint }>>(
  signer: PrivateUint256Signer, ciphertext: T, contractAddress: string, functionSelector: string
): Promise<{ ciphertext: T; signature: string }> => {
  const contract = getAddress(contractAddress);
  if (BigInt(contract) === 0n || !/^0x[0-9a-fA-F]{8}$/.test(functionSelector) || BigInt(functionSelector) === 0n) throw new Error('Invalid private input domain.');
  const words = typeof ciphertext === 'bigint' ? [ciphertext] : [ciphertext?.ciphertextHigh, ciphertext?.ciphertextLow];
  if (words.some(word => typeof word !== 'bigint' || word < 0n || word > MAX_UINT256)) throw new Error('Invalid private input ciphertext.');
  const frozen = (typeof ciphertext === 'bigint' ? ciphertext : Object.freeze({ ciphertextHigh: words[0], ciphertextLow: words[1] })) as T;
  const bytes = new Uint8Array(words.flatMap(word => [...uintToBytes(word, UINT256_SIZE_BYTES)]));
  await ensureSignerAesKey(signer);
  const owner = getAddress(await resolveSignerAddress(signer));
  if (BigInt(owner) === 0n) throw new Error('Invalid private input owner.');
  const signature = await signer.signMessage(packPrivateUint256ValidationMessage(owner, contract, functionSelector, bytes));
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Invalid private input signature.');
  return Object.freeze({ ciphertext: frozen, signature });
};

// The installed browser SDK encryptValue is limited to uint64. Pool terms are
// uint128; use the same 16-byte plaintext block and browser signature domain.
export const encryptPrivateUint128Input = async (
  signer: PrivateUint256Signer, value: bigint, contractAddress: string, functionSelector: string
) => {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << 128n) throw new RangeError('Private value must fit uint128.');
  const encrypted = encrypt(encodeKey(await ensureSignerAesKey(signer)), uintToBytes(value, BLOCK_SIZE_BYTES));
  const ciphertext = decodeUint(new Uint8Array([...encrypted.ciphertext, ...encrypted.r]));
  return resignPrivateInput(signer, ciphertext, contractAddress, functionSelector);
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
  const plaintext = normalizeAmount(plaintextValue);
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
      await nativeEncryptValue256.call(signer, plaintext, contractAddress, functionSelector)
    );
  }

  const aesKey = await ensureSignerAesKey(signer);
  logMobileWalletDiagnostic('private-amount-sign', {
    source: 'browser-signer'
  });
  return encryptWithBrowserSigner(signer, plaintext, contractAddress, functionSelector, aesKey);
};
