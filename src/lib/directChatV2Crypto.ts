import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { bytesToHex, hexToBytes, TEXT_DECODER, TEXT_ENCODER, toArrayBuffer } from './byteEncoding';
import { getSecureWebCrypto } from './appShared/parsers';

export const DIRECT_CHAT_V2_PROTOCOL_VERSION = 2n;
export const DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES = 16;
export const DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES = 4_096;
export const DIRECT_CHAT_V2_AES_TAG_BITS = 128;
export const DIRECT_CHAT_V2_NONCE_BYTES = 12;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const CONVERSATION_DOMAIN = keccak256(toUtf8Bytes('chainwhisper.chat.v2.conversation'));
const HKDF_SALT_DOMAIN = keccak256(toUtf8Bytes('chainwhisper.chat.v2.hkdf.salt.v1'));
const MESSAGE_AAD_DOMAIN = keccak256(toUtf8Bytes('chainwhisper.chat.v2.aes-gcm.aad.v2'));
const HKDF_INFO = TEXT_ENCODER.encode('ChainWhisperChatV2/AES-256-GCM/v1');
const ABI_CODER = AbiCoder.defaultAbiCoder();

export type DirectChatV2Seed = {
  value: bigint;
};

export type DirectChatV2EpochContext = {
  chainId: bigint;
  contractAddress: string;
  conversationId: string;
  epoch: bigint;
  participantA: string;
  participantB: string;
};

export type DirectChatV2MessageContext = DirectChatV2EpochContext & {
  sender: string;
  recipient: string;
  senderSequence: bigint;
  valueSent: bigint;
  feeTaken: bigint;
};

export type DirectChatV2EncryptedMessage = {
  nonce: string;
  aadHash: string;
  ciphertext: string;
};

const normalizeUint64 = (value: bigint, label: string, allowZero = false): bigint => {
  if (value < 0n || value > UINT64_MAX || (!allowZero && value === 0n)) {
    throw new Error(`${label} must be ${allowZero ? 'a' : 'a non-zero'} uint64 value.`);
  }
  return value;
};

const normalizeUint256 = (value: bigint, label: string): bigint => {
  if (value < 0n || value > UINT256_MAX) {
    throw new Error(`${label} must be a uint256 value.`);
  }
  return value;
};

const normalizeBytes32 = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return normalized.toLowerCase();
};

const sortParticipants = (accountA: string, accountB: string): [string, string] => {
  const normalizedA = getAddress(accountA.trim());
  const normalizedB = getAddress(accountB.trim());
  if (normalizedA.toLowerCase() === normalizedB.toLowerCase()) {
    throw new Error('Direct chat participants must be different wallets.');
  }
  return BigInt(normalizedA) < BigInt(normalizedB)
    ? [normalizedA, normalizedB]
    : [normalizedB, normalizedA];
};

const uint128ToBigEndianBytes = (value: bigint): Uint8Array => {
  if (value < 0n || value > UINT128_MAX) {
    throw new Error('Conversation seed must be a uint128 value.');
  }
  const bytes = new Uint8Array(16);
  let remainder = value;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(remainder & 0xffn);
    remainder >>= 8n;
  }
  return bytes;
};

const validateEpochContext = (context: DirectChatV2EpochContext) => {
  if (context.chainId <= 0n || context.chainId > UINT256_MAX) {
    throw new Error('Chain ID must be a positive uint256 value.');
  }
  const contractAddress = getAddress(context.contractAddress.trim());
  const [participantA, participantB] = sortParticipants(context.participantA, context.participantB);
  const conversationId = normalizeBytes32(context.conversationId, 'Conversation ID');
  const expectedConversationId = deriveDirectChatV2ConversationId({
    chainId: context.chainId,
    contractAddress,
    participantA,
    participantB
  });
  if (conversationId !== expectedConversationId) {
    throw new Error('Conversation ID does not match this chain, contract, and wallet pair.');
  }
  return {
    chainId: context.chainId,
    contractAddress,
    conversationId,
    epoch: normalizeUint64(context.epoch, 'Epoch'),
    participantA,
    participantB
  };
};

const validateMessageContext = (context: DirectChatV2MessageContext) => {
  const epochContext = validateEpochContext(context);
  const sender = getAddress(context.sender.trim());
  const recipient = getAddress(context.recipient.trim());
  const participants = new Set([
    epochContext.participantA.toLowerCase(),
    epochContext.participantB.toLowerCase()
  ]);
  if (!participants.has(sender.toLowerCase()) || !participants.has(recipient.toLowerCase())) {
    throw new Error('Message sender and recipient must be conversation participants.');
  }
  if (sender.toLowerCase() === recipient.toLowerCase()) {
    throw new Error('Message sender and recipient must be different wallets.');
  }
  const valueSent = normalizeUint256(context.valueSent, 'Message value');
  const feeTaken = normalizeUint256(context.feeTaken, 'Message fee');
  if (feeTaken > valueSent) {
    throw new Error('Message fee cannot exceed the transaction value.');
  }
  return {
    ...epochContext,
    sender,
    recipient,
    senderSequence: normalizeUint64(context.senderSequence, 'Sender sequence'),
    valueSent,
    feeTaken
  };
};

export const deriveDirectChatV2ConversationId = ({
  chainId,
  contractAddress,
  participantA,
  participantB
}: {
  chainId: bigint;
  contractAddress: string;
  participantA: string;
  participantB: string;
}): string => {
  if (chainId <= 0n || chainId > UINT256_MAX) {
    throw new Error('Chain ID must be a positive uint256 value.');
  }
  const normalizedContract = getAddress(contractAddress.trim());
  const [low, high] = sortParticipants(participantA, participantB);
  return keccak256(
    ABI_CODER.encode(
      ['bytes32', 'uint256', 'address', 'address', 'address'],
      [CONVERSATION_DOMAIN, chainId, normalizedContract, low, high]
    )
  );
};

const normalizeDirectChatV2Nonce = (value: string): Uint8Array => {
  const nonce = hexToBytes(value, 'Invalid direct-chat nonce.');
  if (nonce.length !== DIRECT_CHAT_V2_NONCE_BYTES) {
    throw new Error('Direct-chat nonce must be exactly 12 bytes.');
  }
  if (nonce.every((byte) => byte === 0)) {
    throw new Error('Direct-chat nonce must not be zero.');
  }
  return nonce;
};

const generateDirectChatV2Nonce = (): Uint8Array => {
  const { webCrypto } = getSecureWebCrypto();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nonce = webCrypto.getRandomValues(new Uint8Array(DIRECT_CHAT_V2_NONCE_BYTES));
    if (!nonce.every((byte) => byte === 0)) return nonce;
  }
  throw new Error('Secure randomness failed to produce a non-zero direct-chat nonce.');
};

export const deriveDirectChatV2AadHash = (
  context: DirectChatV2MessageContext,
  nonceHex: string
): string => {
  const normalized = validateMessageContext(context);
  const nonce = bytesToHex(normalizeDirectChatV2Nonce(nonceHex), '0x');
  return keccak256(
    ABI_CODER.encode(
      [
        'bytes32',
        'uint16',
        'uint256',
        'address',
        'bytes32',
        'uint64',
        'address',
        'address',
        'uint64',
        'bytes12',
        'uint256',
        'uint256'
      ],
      [
        MESSAGE_AAD_DOMAIN,
        DIRECT_CHAT_V2_PROTOCOL_VERSION,
        normalized.chainId,
        normalized.contractAddress,
        normalized.conversationId,
        normalized.epoch,
        normalized.sender,
        normalized.recipient,
        normalized.senderSequence,
        nonce,
        normalized.valueSent,
        normalized.feeTaken
      ]
    )
  );
};

const deriveDirectChatV2AesKey = async (
  seed: DirectChatV2Seed,
  context: DirectChatV2EpochContext,
  usages: KeyUsage[]
): Promise<CryptoKey> => {
  const normalized = validateEpochContext(context);
  const seedBytes = uint128ToBigEndianBytes(seed.value);

  const salt = hexToBytes(
    keccak256(
      ABI_CODER.encode(
        ['bytes32', 'uint16', 'uint256', 'address', 'bytes32', 'uint64'],
        [
          HKDF_SALT_DOMAIN,
          DIRECT_CHAT_V2_PROTOCOL_VERSION,
          normalized.chainId,
          normalized.contractAddress,
          normalized.conversationId,
          normalized.epoch
        ]
      )
    )
  );
  const { subtle } = getSecureWebCrypto();
  const material = await subtle.importKey('raw', toArrayBuffer(seedBytes), 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(HKDF_INFO)
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
};

export const encryptDirectChatV2Message = async (
  plaintext: string,
  seed: DirectChatV2Seed,
  context: DirectChatV2MessageContext
): Promise<DirectChatV2EncryptedMessage> => {
  const normalized = validateMessageContext(context);
  const plaintextBytes = TEXT_ENCODER.encode(plaintext);
  if (plaintextBytes.length + DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES > DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES) {
    throw new Error('Encrypted direct message exceeds the 4096-byte contract limit.');
  }
  const nonce = generateDirectChatV2Nonce();
  const nonceHex = bytesToHex(nonce, '0x');
  const aadHash = deriveDirectChatV2AadHash(normalized, nonceHex);
  const key = await deriveDirectChatV2AesKey(seed, normalized, ['encrypt']);
  const { subtle } = getSecureWebCrypto();
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(hexToBytes(aadHash)),
        tagLength: DIRECT_CHAT_V2_AES_TAG_BITS
      },
      key,
      toArrayBuffer(plaintextBytes)
    )
  );
  if (
    ciphertext.length < DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES ||
    ciphertext.length > DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error('Encrypted direct message has an invalid ciphertext length.');
  }
  return {
    nonce: nonceHex,
    aadHash,
    ciphertext: bytesToHex(ciphertext, '0x')
  };
};

export const decryptDirectChatV2Message = async (
  encrypted: DirectChatV2EncryptedMessage,
  seed: DirectChatV2Seed,
  context: DirectChatV2MessageContext
): Promise<string> => {
  const normalized = validateMessageContext(context);
  const suppliedNonce = normalizeDirectChatV2Nonce(encrypted.nonce);
  const expectedAadHash = deriveDirectChatV2AadHash(normalized, encrypted.nonce);
  if (normalizeBytes32(encrypted.aadHash, 'AAD hash') !== expectedAadHash) {
    throw new Error('Direct-chat AAD does not match the canonical message context.');
  }
  const ciphertext = hexToBytes(encrypted.ciphertext, 'Invalid direct-chat ciphertext.');
  if (
    ciphertext.length < DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES ||
    ciphertext.length > DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES
  ) {
    throw new Error('Encrypted direct message has an invalid ciphertext length.');
  }
  const key = await deriveDirectChatV2AesKey(seed, normalized, ['decrypt']);
  const { subtle } = getSecureWebCrypto();
  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(suppliedNonce),
      additionalData: toArrayBuffer(hexToBytes(expectedAadHash)),
      tagLength: DIRECT_CHAT_V2_AES_TAG_BITS
    },
    key,
    toArrayBuffer(ciphertext)
  );
  return TEXT_DECODER.decode(plaintext);
};
