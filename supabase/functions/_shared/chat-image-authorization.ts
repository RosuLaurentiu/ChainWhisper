import {
  CHAT_CONTRACT_ADDRESS,
  COTI_CHAIN_ID_HEX,
  GROUP_CHAT_CONTRACT_ADDRESS
} from './chat-image.ts';

export const CHAT_IMAGE_AUTHORIZATION_VERSION = '1';
export const CHAT_IMAGE_AUTHORIZATION_TTL_SECONDS = 5 * 60;
export const CHAT_IMAGE_AUTHORIZATION_CLOCK_SKEW_SECONDS = 30;

const WALLET_ADDRESS_REGEX = /^0x[a-f0-9]{40}$/;
const BLOB_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;
const SIGNATURE_REGEX = /^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/;
const CHAIN_ID_REGEX = /^0x[1-9a-f][0-9a-f]*$/;
const DIRECT_TARGET_REGEX = /^0x[a-f0-9]{40}$/;
const GROUP_TARGET_REGEX = /^[1-9][0-9]{0,77}$/;

export type ChatImageAuthorizationKind = 'direct' | 'group';

export const getChatImageAuthorizationDomain = (kind: ChatImageAuthorizationKind): {
  chainId: string;
  contractAddress: string;
} => ({
  chainId: COTI_CHAIN_ID_HEX,
  contractAddress: kind === 'direct' ? CHAT_CONTRACT_ADDRESS : GROUP_CHAT_CONTRACT_ADDRESS
});

export type ChatImageUploadAuthorization = {
  audience: string;
  blobId: string;
  chainId: string;
  ciphertextSha256: string;
  confirmationTokenHash: string;
  contractAddress: string;
  conversationKind: ChatImageAuthorizationKind;
  conversationTarget: string;
  encryptedSize: number;
  expiresAt: number;
  issuedAt: number;
  mime: string;
  ownerAddress: string;
  plaintextSize: number;
};

const normalizeAudience = (value: string): string => {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error('Chat image authorization audience must use HTTPS.');
    }
    return `${parsed.origin.toLowerCase()}/functions/v1/chat-image-upload`;
  } catch (error) {
    if (error instanceof Error && error.message === 'Chat image authorization audience must use HTTPS.') {
      throw error;
    }
    throw new Error('Invalid chat image authorization audience.');
  }
};

const normalizeConversationTarget = (
  kind: ChatImageAuthorizationKind,
  target: string
): string => {
  const normalized = target.trim().toLowerCase();
  if (kind === 'direct') {
    if (!DIRECT_TARGET_REGEX.test(normalized)) {
      throw new Error('Invalid direct chat image target.');
    }
    return normalized;
  }

  if (!GROUP_TARGET_REGEX.test(normalized)) {
    throw new Error('Invalid group chat image target.');
  }
  try {
    const value = BigInt(normalized);
    if (value <= 0n || value >= 1n << 256n) {
      throw new Error('Invalid group chat image target.');
    }
    return value.toString(10);
  } catch {
    throw new Error('Invalid group chat image target.');
  }
};

// The client must apply the same bounded target rules before either upload authorization path.
export { normalizeConversationTarget as normalizeChatImageConversationTarget };

export const normalizeChatImageUploadAuthorization = (
  input: ChatImageUploadAuthorization
): ChatImageUploadAuthorization => {
  const audience = normalizeAudience(input.audience);
  const blobId = input.blobId.trim().toLowerCase();
  const chainId = input.chainId.trim().toLowerCase();
  const contractAddress = input.contractAddress.trim().toLowerCase();
  const ownerAddress = input.ownerAddress.trim().toLowerCase();
  const conversationKind = input.conversationKind;
  const mime = input.mime.trim().toLowerCase();
  const ciphertextSha256 = input.ciphertextSha256.trim().toLowerCase();
  const confirmationTokenHash = input.confirmationTokenHash.trim().toLowerCase();

  if (!BLOB_ID_REGEX.test(blobId)) {
    throw new Error('Invalid chat image blob id.');
  }
  if (!WALLET_ADDRESS_REGEX.test(ownerAddress)) {
    throw new Error('Invalid chat image owner.');
  }
  if (!CHAIN_ID_REGEX.test(chainId)) {
    throw new Error('Invalid chat image authorization chain.');
  }
  if (!WALLET_ADDRESS_REGEX.test(contractAddress)) {
    throw new Error('Invalid chat image authorization contract.');
  }
  if (conversationKind !== 'direct' && conversationKind !== 'group') {
    throw new Error('Invalid chat image conversation kind.');
  }
  const conversationTarget = normalizeConversationTarget(conversationKind, input.conversationTarget);
  if (!mime || mime.length > 128 || /[\r\n]/u.test(mime)) {
    throw new Error('Invalid chat image MIME type.');
  }
  if (!Number.isSafeInteger(input.plaintextSize) || input.plaintextSize <= 0) {
    throw new Error('Invalid chat image plaintext size.');
  }
  if (!Number.isSafeInteger(input.encryptedSize) || input.encryptedSize <= 0) {
    throw new Error('Invalid chat image encrypted size.');
  }
  if (!SHA256_HEX_REGEX.test(ciphertextSha256)) {
    throw new Error('Invalid chat image ciphertext digest.');
  }
  if (!SHA256_HEX_REGEX.test(confirmationTokenHash)) {
    throw new Error('Invalid chat image confirmation token hash.');
  }
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new Error('Invalid chat image authorization expiry.');
  }
  if (!Number.isSafeInteger(input.issuedAt) || input.issuedAt <= 0) {
    throw new Error('Invalid chat image authorization issue time.');
  }

  return {
    audience,
    blobId,
    chainId,
    ciphertextSha256,
    confirmationTokenHash,
    contractAddress,
    conversationKind,
    conversationTarget,
    encryptedSize: input.encryptedSize,
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt,
    mime,
    ownerAddress,
    plaintextSize: input.plaintextSize
  };
};

export const buildChatImageUploadAuthorizationMessage = (
  input: ChatImageUploadAuthorization
): string => {
  const value = normalizeChatImageUploadAuthorization(input);
  return [
    'ChainWhisper Chat Image Upload Authorization',
    `version:${CHAT_IMAGE_AUTHORIZATION_VERSION}`,
    `audience:${value.audience}`,
    `chainId:${value.chainId}`,
    `contract:${value.contractAddress}`,
    `blobId:${value.blobId}`,
    `owner:${value.ownerAddress}`,
    `kind:${value.conversationKind}`,
    `target:${value.conversationTarget}`,
    `mime:${value.mime}`,
    `plaintextSize:${value.plaintextSize}`,
    `encryptedSize:${value.encryptedSize}`,
    `ciphertextSha256:${value.ciphertextSha256}`,
    `confirmationTokenHash:${value.confirmationTokenHash}`,
    `issuedAt:${value.issuedAt}`,
    `expiresAt:${value.expiresAt}`
  ].join('\n');
};

export const assertChatImageAuthorizationFresh = (
  issuedAt: number,
  expiresAt: number,
  nowSeconds = Math.floor(Date.now() / 1000)
): void => {
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) {
    throw new Error('Invalid chat image authorization time.');
  }
  if (issuedAt > nowSeconds + CHAT_IMAGE_AUTHORIZATION_CLOCK_SKEW_SECONDS) {
    throw new Error('Chat image upload authorization was issued in the future.');
  }
  if (issuedAt < nowSeconds - CHAT_IMAGE_AUTHORIZATION_TTL_SECONDS - CHAT_IMAGE_AUTHORIZATION_CLOCK_SKEW_SECONDS) {
    throw new Error('Chat image upload authorization is too old.');
  }
  if (expiresAt < issuedAt || expiresAt > issuedAt + CHAT_IMAGE_AUTHORIZATION_TTL_SECONDS) {
    throw new Error('Invalid chat image authorization lifetime.');
  }
  if (expiresAt + CHAT_IMAGE_AUTHORIZATION_CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new Error('Chat image upload authorization expired.');
  }
};

export const assertChatImageAuthorizationSignature = (signature: string): string => {
  const normalized = signature.trim();
  if (!SIGNATURE_REGEX.test(normalized)) {
    throw new Error('Invalid chat image upload authorization signature.');
  }
  return normalized;
};

export const assertChatImageConversationTargetFromCalldata = (
  input: string,
  kind: ChatImageAuthorizationKind,
  expectedTarget: string
): void => {
  const normalizedInput = input.trim().toLowerCase();
  if (!/^0x[a-f0-9]+$/u.test(normalizedInput) || normalizedInput.length < 74) {
    throw new Error('Image message transaction calldata is invalid.');
  }
  const firstWord = normalizedInput.slice(10, 74);
  const normalizedExpectedTarget = normalizeConversationTarget(kind, expectedTarget);
  if (kind === 'direct') {
    const recipient = `0x${firstWord.slice(24)}`;
    if (recipient !== normalizedExpectedTarget) {
      throw new Error('Image message transaction targets a different recipient.');
    }
    return;
  }

  const groupId = BigInt(`0x${firstWord}`).toString(10);
  if (groupId !== normalizedExpectedTarget) {
    throw new Error('Image message transaction targets a different group.');
  }
};

export const sha256Hex = async (value: ArrayBuffer | Uint8Array): Promise<string> => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const constantTimeEqualHex = (left: string, right: string): boolean => {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!SHA256_HEX_REGEX.test(a) || !SHA256_HEX_REGEX.test(b)) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
};
