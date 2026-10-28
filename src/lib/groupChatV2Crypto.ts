import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { bytesToHex, hexToBytes, TEXT_DECODER, TEXT_ENCODER, toArrayBuffer } from './byteEncoding';
import { getSecureWebCrypto } from './appShared/parsers';

export const GROUP_CHAT_V2_PROTOCOL_VERSION = 2n;
export const GROUP_CHAT_V2_MIN_CIPHERTEXT_BYTES = 16;
export const GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES = 4_096;
export const GROUP_CHAT_V2_NONCE_BYTES = 12;

const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const HKDF_SALT_DOMAIN = keccak256(toUtf8Bytes('chainwhisper.group-chat.v2.hkdf.salt.v1'));
const MESSAGE_AAD_DOMAIN = keccak256(toUtf8Bytes('chainwhisper.group-chat.v2.aes-gcm.aad.v1'));
const METADATA_AAD_DOMAIN = keccak256(toUtf8Bytes('chainwhisper.group-chat.v2.metadata.aad.v1'));
const MESSAGE_HKDF_INFO = TEXT_ENCODER.encode('ChainWhisperGroupChatV2/AES-256-GCM/message/v1');
const METADATA_HKDF_INFO = TEXT_ENCODER.encode('ChainWhisperGroupChatV2/AES-256-GCM/metadata/v1');
const ABI_CODER = AbiCoder.defaultAbiCoder();

export type GroupChatV2Seed = Readonly<{ value: bigint }>;

export type GroupChatV2EpochContext = Readonly<{
  chainId: bigint;
  contractAddress: string;
  groupId: bigint;
  epoch: bigint;
}>;

export type GroupChatV2MessageContext = GroupChatV2EpochContext & Readonly<{
  membershipRevision: bigint;
  sender: string;
  senderSequence: bigint;
  valueSent: bigint;
  feeTaken: bigint;
}>;

export type GroupChatV2MetadataContext = GroupChatV2EpochContext & Readonly<{
  membershipRevision: bigint;
  metadataVersion: bigint;
  editor: string;
}>;

export type GroupChatV2EncryptedPayload = Readonly<{
  nonce: string;
  aadHash: string;
  ciphertext: string;
}>;

const integer = (
  value: bigint,
  label: string,
  maximum: bigint,
  allowZero = false
): bigint => {
  if (value < 0n || value > maximum || (!allowZero && value === 0n)) {
    throw new Error(`${label} must be ${allowZero ? 'a' : 'a non-zero'} integer in range.`);
  }
  return value;
};

const bytes32 = (value: string, label: string): string => {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) throw new Error(`${label} must be bytes32.`);
  return normalized;
};

const seedBytes = (seed: GroupChatV2Seed): Uint8Array => {
  const value = integer(seed.value, 'Group epoch seed', UINT128_MAX, true);
  const result = new Uint8Array(16);
  let remaining = value;
  for (let index = result.length - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
};

const epochContext = (context: GroupChatV2EpochContext) => Object.freeze({
  chainId: integer(context.chainId, 'Group chain ID', UINT256_MAX),
  contractAddress: getAddress(context.contractAddress.trim()),
  groupId: integer(context.groupId, 'Group ID', UINT256_MAX),
  epoch: integer(context.epoch, 'Group epoch', UINT64_MAX)
});

const messageContext = (context: GroupChatV2MessageContext) => {
  const normalized = {
    ...epochContext(context),
    membershipRevision: integer(
      context.membershipRevision,
      'Group membership revision',
      UINT32_MAX
    ),
    sender: getAddress(context.sender.trim()),
    senderSequence: integer(context.senderSequence, 'Group sender sequence', UINT64_MAX),
    valueSent: integer(context.valueSent, 'Group message value', UINT256_MAX, true),
    feeTaken: integer(context.feeTaken, 'Group message fee', UINT256_MAX, true)
  };
  if (normalized.valueSent !== normalized.feeTaken) {
    throw new Error('Group Chat V2 does not permit a message value above or below its exact fee.');
  }
  return Object.freeze(normalized);
};

const metadataContext = (context: GroupChatV2MetadataContext) => Object.freeze({
  ...epochContext(context),
  membershipRevision: integer(
    context.membershipRevision,
    'Group metadata membership revision',
    UINT32_MAX
  ),
  metadataVersion: integer(context.metadataVersion, 'Group metadata version', UINT64_MAX),
  editor: getAddress(context.editor.trim())
});

const nonceBytes = (value: string): Uint8Array => {
  const nonce = hexToBytes(value, 'Invalid Group Chat V2 nonce.');
  if (nonce.length !== GROUP_CHAT_V2_NONCE_BYTES || nonce.every((byte) => byte === 0)) {
    throw new Error('Group Chat V2 nonce must be a non-zero bytes12 value.');
  }
  return nonce;
};

const freshNonce = (): Uint8Array => {
  const { webCrypto } = getSecureWebCrypto();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nonce = webCrypto.getRandomValues(new Uint8Array(GROUP_CHAT_V2_NONCE_BYTES));
    if (!nonce.every((byte) => byte === 0)) return nonce;
  }
  throw new Error('Secure randomness failed to produce a Group Chat V2 nonce.');
};

const hkdfSalt = (context: GroupChatV2EpochContext): Uint8Array => {
  const normalized = epochContext(context);
  return hexToBytes(keccak256(ABI_CODER.encode(
    ['bytes32', 'uint16', 'uint256', 'address', 'uint256', 'uint64'],
    [
      HKDF_SALT_DOMAIN,
      GROUP_CHAT_V2_PROTOCOL_VERSION,
      normalized.chainId,
      normalized.contractAddress,
      normalized.groupId,
      normalized.epoch
    ]
  )));
};

const aesKey = async (
  seed: GroupChatV2Seed,
  context: GroupChatV2EpochContext,
  info: Uint8Array,
  usages: KeyUsage[]
): Promise<CryptoKey> => {
  const { subtle } = getSecureWebCrypto();
  const material = await subtle.importKey('raw', toArrayBuffer(seedBytes(seed)), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(hkdfSalt(context)),
      info: toArrayBuffer(info)
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
};

export const deriveGroupChatV2MessageAadHash = (
  context: GroupChatV2MessageContext,
  nonceHex: string
): string => {
  const normalized = messageContext(context);
  const nonce = bytesToHex(nonceBytes(nonceHex), '0x');
  return keccak256(ABI_CODER.encode(
    [
      'bytes32',
      'uint16',
      'uint256',
      'address',
      'uint256',
      'uint64',
      'uint32',
      'address',
      'uint64',
      'bytes12',
      'uint256',
      'uint256'
    ],
    [
      MESSAGE_AAD_DOMAIN,
      GROUP_CHAT_V2_PROTOCOL_VERSION,
      normalized.chainId,
      normalized.contractAddress,
      normalized.groupId,
      normalized.epoch,
      normalized.membershipRevision,
      normalized.sender,
      normalized.senderSequence,
      nonce,
      normalized.valueSent,
      normalized.feeTaken
    ]
  ));
};

export const deriveGroupChatV2MetadataAadHash = (
  context: GroupChatV2MetadataContext,
  nonceHex: string
): string => {
  const normalized = metadataContext(context);
  const nonce = bytesToHex(nonceBytes(nonceHex), '0x');
  return keccak256(ABI_CODER.encode(
    [
      'bytes32',
      'uint16',
      'uint256',
      'address',
      'uint256',
      'uint64',
      'uint32',
      'uint64',
      'address',
      'bytes12'
    ],
    [
      METADATA_AAD_DOMAIN,
      GROUP_CHAT_V2_PROTOCOL_VERSION,
      normalized.chainId,
      normalized.contractAddress,
      normalized.groupId,
      normalized.epoch,
      normalized.membershipRevision,
      normalized.metadataVersion,
      normalized.editor,
      nonce
    ]
  ));
};

const encrypt = async (
  plaintext: string,
  seed: GroupChatV2Seed,
  context: GroupChatV2EpochContext,
  info: Uint8Array,
  aadHash: (nonce: string) => string
): Promise<GroupChatV2EncryptedPayload> => {
  const plaintextBytes = TEXT_ENCODER.encode(plaintext);
  if (plaintextBytes.length + GROUP_CHAT_V2_MIN_CIPHERTEXT_BYTES > GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES) {
    throw new Error('Encrypted Group Chat V2 payload exceeds the contract limit.');
  }
  const nonce = freshNonce();
  const nonceHex = bytesToHex(nonce, '0x');
  const canonicalAadHash = aadHash(nonceHex);
  const key = await aesKey(seed, context, info, ['encrypt']);
  const { subtle } = getSecureWebCrypto();
  const ciphertext = new Uint8Array(await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(hexToBytes(canonicalAadHash)),
      tagLength: 128
    },
    key,
    toArrayBuffer(plaintextBytes)
  ));
  if (
    ciphertext.length < GROUP_CHAT_V2_MIN_CIPHERTEXT_BYTES ||
    ciphertext.length > GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error('Encrypted Group Chat V2 payload has an invalid length.');
  }
  return Object.freeze({
    nonce: nonceHex,
    aadHash: canonicalAadHash,
    ciphertext: bytesToHex(ciphertext, '0x')
  });
};

const decrypt = async (
  encrypted: GroupChatV2EncryptedPayload,
  seed: GroupChatV2Seed,
  context: GroupChatV2EpochContext,
  info: Uint8Array,
  aadHash: (nonce: string) => string
): Promise<string> => {
  const nonce = nonceBytes(encrypted.nonce);
  const canonicalAadHash = aadHash(encrypted.nonce);
  if (bytes32(encrypted.aadHash, 'Group payload AAD hash') !== canonicalAadHash) {
    throw new Error('Group Chat V2 AAD does not match its canonical context.');
  }
  const ciphertext = hexToBytes(encrypted.ciphertext, 'Invalid Group Chat V2 ciphertext.');
  if (
    ciphertext.length < GROUP_CHAT_V2_MIN_CIPHERTEXT_BYTES ||
    ciphertext.length > GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error('Encrypted Group Chat V2 payload has an invalid length.');
  }
  const key = await aesKey(seed, context, info, ['decrypt']);
  const { subtle } = getSecureWebCrypto();
  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(hexToBytes(canonicalAadHash)),
      tagLength: 128
    },
    key,
    toArrayBuffer(ciphertext)
  );
  return TEXT_DECODER.decode(plaintext);
};

export const encryptGroupChatV2Message = (
  plaintext: string,
  seed: GroupChatV2Seed,
  context: GroupChatV2MessageContext
): Promise<GroupChatV2EncryptedPayload> => {
  const normalized = messageContext(context);
  return encrypt(
    plaintext,
    seed,
    normalized,
    MESSAGE_HKDF_INFO,
    (nonce) => deriveGroupChatV2MessageAadHash(normalized, nonce)
  );
};

export const decryptGroupChatV2Message = (
  encrypted: GroupChatV2EncryptedPayload,
  seed: GroupChatV2Seed,
  context: GroupChatV2MessageContext
): Promise<string> => {
  const normalized = messageContext(context);
  return decrypt(
    encrypted,
    seed,
    normalized,
    MESSAGE_HKDF_INFO,
    (nonce) => deriveGroupChatV2MessageAadHash(normalized, nonce)
  );
};

export const encryptGroupChatV2Metadata = (
  plaintext: string,
  seed: GroupChatV2Seed,
  context: GroupChatV2MetadataContext
): Promise<GroupChatV2EncryptedPayload> => {
  const normalized = metadataContext(context);
  return encrypt(
    plaintext,
    seed,
    normalized,
    METADATA_HKDF_INFO,
    (nonce) => deriveGroupChatV2MetadataAadHash(normalized, nonce)
  );
};

export const decryptGroupChatV2Metadata = (
  encrypted: GroupChatV2EncryptedPayload,
  seed: GroupChatV2Seed,
  context: GroupChatV2MetadataContext
): Promise<string> => {
  const normalized = metadataContext(context);
  return decrypt(
    encrypted,
    seed,
    normalized,
    METADATA_HKDF_INFO,
    (nonce) => deriveGroupChatV2MetadataAadHash(normalized, nonce)
  );
};
