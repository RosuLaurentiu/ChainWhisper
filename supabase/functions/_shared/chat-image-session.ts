export const CHAT_IMAGE_SESSION_VERSION = 1;
export const CHAT_IMAGE_SESSION_TTL_SECONDS = 15 * 60;
export const CHAT_IMAGE_SESSION_CLOCK_SKEW_SECONDS = 30;

const WALLET_ADDRESS_REGEX = /^0x[a-f0-9]{40}$/;
const CHAIN_ID_REGEX = /^0x[1-9a-f][0-9a-f]*$/;
const NONCE_REGEX = /^[a-f0-9]{64}$/;
const TOKEN_SIGNATURE_REGEX = /^[A-Za-z0-9_-]{43}$/;
const SECRET_REGEX = /^[a-fA-F0-9]{64}$/;

export type ChatImageSessionAuthorization = {
  audience: string;
  chainId: string;
  expiresAt: number;
  issuedAt: number;
  nonce: string;
  ownerAddress: string;
};

export type ChatImageSessionTokenPayload = {
  version: number;
  audience: string;
  chainId: string;
  expiresAt: number;
  issuedAt: number;
  nonce: string;
  ownerAddress: string;
};

const endpointAudience = (value: string, functionName: string): string => {
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== 'https:' &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1'
    ) {
      throw new Error('Chat image session audience must use HTTPS.');
    }
    return `${parsed.origin.toLowerCase()}/functions/v1/${functionName}`;
  } catch (error) {
    if (error instanceof Error && error.message === 'Chat image session audience must use HTTPS.') {
      throw error;
    }
    throw new Error('Invalid chat image session audience.');
  }
};

export const getChatImageSessionAuthorizationAudience = (supabaseUrl: string): string =>
  endpointAudience(supabaseUrl, 'chat-image-session');

export const getChatImageSessionTokenAudience = (supabaseUrl: string): string =>
  endpointAudience(supabaseUrl, 'chat-image-upload');

export const normalizeChatImageSessionAuthorization = (
  input: ChatImageSessionAuthorization
): ChatImageSessionAuthorization => {
  const audience = getChatImageSessionAuthorizationAudience(input.audience);
  const chainId = input.chainId.trim().toLowerCase();
  const nonce = input.nonce.trim().toLowerCase();
  const ownerAddress = input.ownerAddress.trim().toLowerCase();
  if (!CHAIN_ID_REGEX.test(chainId)) throw new Error('Invalid chat image session chain.');
  if (!NONCE_REGEX.test(nonce)) throw new Error('Invalid chat image session nonce.');
  if (!WALLET_ADDRESS_REGEX.test(ownerAddress)) throw new Error('Invalid chat image session owner.');
  if (!Number.isSafeInteger(input.issuedAt) || input.issuedAt <= 0) {
    throw new Error('Invalid chat image session issue time.');
  }
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new Error('Invalid chat image session expiry.');
  }
  return {
    audience,
    chainId,
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt,
    nonce,
    ownerAddress
  };
};

export const assertChatImageSessionFresh = (
  issuedAt: number,
  expiresAt: number,
  nowSeconds = Math.floor(Date.now() / 1000)
): void => {
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) {
    throw new Error('Invalid chat image session time.');
  }
  if (issuedAt > nowSeconds + CHAT_IMAGE_SESSION_CLOCK_SKEW_SECONDS) {
    throw new Error('Chat image session was issued in the future.');
  }
  if (issuedAt < nowSeconds - CHAT_IMAGE_SESSION_TTL_SECONDS - CHAT_IMAGE_SESSION_CLOCK_SKEW_SECONDS) {
    throw new Error('Chat image session is too old.');
  }
  if (expiresAt < issuedAt || expiresAt > issuedAt + CHAT_IMAGE_SESSION_TTL_SECONDS) {
    throw new Error('Invalid chat image session lifetime.');
  }
  if (expiresAt + CHAT_IMAGE_SESSION_CLOCK_SKEW_SECONDS < nowSeconds) {
    throw new Error('Chat image session expired.');
  }
};

export const buildChatImageSessionAuthorizationMessage = (
  input: ChatImageSessionAuthorization
): string => {
  const value = normalizeChatImageSessionAuthorization(input);
  return [
    'ChainWhisper Chat Image Upload Session',
    `version:${CHAT_IMAGE_SESSION_VERSION}`,
    `audience:${value.audience}`,
    `chainId:${value.chainId}`,
    `owner:${value.ownerAddress}`,
    `nonce:${value.nonce}`,
    `issuedAt:${value.issuedAt}`,
    `expiresAt:${value.expiresAt}`
  ].join('\n');
};

const hexToBytes = (value: string): Uint8Array => {
  if (!SECRET_REGEX.test(value)) throw new Error('Chat image session secret is invalid.');
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

const base64UrlToBytes = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Chat image session token is malformed.');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  } catch {
    throw new Error('Chat image session token is malformed.');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const hmac = async (secretHex: string, encodedPayload: string): Promise<Uint8Array> => {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    hexToBytes(secretHex) as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(encodedPayload)
  ));
};

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
};

const canonicalTokenPayload = (
  authorization: ChatImageSessionAuthorization,
  tokenAudience: string
): ChatImageSessionTokenPayload => ({
  version: CHAT_IMAGE_SESSION_VERSION,
  audience: getChatImageSessionTokenAudience(tokenAudience),
  chainId: authorization.chainId,
  expiresAt: authorization.expiresAt,
  issuedAt: authorization.issuedAt,
  nonce: authorization.nonce,
  ownerAddress: authorization.ownerAddress
});

export const issueChatImageSessionToken = async ({
  authorization,
  secretHex,
  supabaseUrl
}: {
  authorization: ChatImageSessionAuthorization;
  secretHex: string;
  supabaseUrl: string;
}): Promise<string> => {
  const normalized = normalizeChatImageSessionAuthorization(authorization);
  assertChatImageSessionFresh(normalized.issuedAt, normalized.expiresAt);
  const payload = canonicalTokenPayload(normalized, supabaseUrl);
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(secretHex, encodedPayload));
  return `${encodedPayload}.${signature}`;
};

export const verifyChatImageSessionToken = async ({
  expectedChainId,
  expectedOwnerAddress,
  secretHex,
  supabaseUrl,
  token
}: {
  expectedChainId: string;
  expectedOwnerAddress: string;
  secretHex: string;
  supabaseUrl: string;
  token: string;
}): Promise<ChatImageSessionTokenPayload> => {
  const parts = token.trim().split('.');
  if (parts.length !== 2 || parts[0].length > 2_048 || !TOKEN_SIGNATURE_REGEX.test(parts[1])) {
    throw new Error('Chat image session token is malformed.');
  }
  const expectedSignature = await hmac(secretHex, parts[0]);
  const suppliedSignature = base64UrlToBytes(parts[1]);
  if (!equalBytes(expectedSignature, suppliedSignature)) {
    throw new Error('Chat image session token signature is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
  } catch {
    throw new Error('Chat image session token payload is invalid.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Chat image session token payload is invalid.');
  }
  const record = parsed as Record<string, unknown>;
  const expectedKeys = ['audience', 'chainId', 'expiresAt', 'issuedAt', 'nonce', 'ownerAddress', 'version'];
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')) {
    throw new Error('Chat image session token payload is invalid.');
  }
  if (record.version !== CHAT_IMAGE_SESSION_VERSION) {
    throw new Error('Chat image session token version is unsupported.');
  }
  const authorization = normalizeChatImageSessionAuthorization({
    audience: supabaseUrl,
    chainId: String(record.chainId ?? ''),
    expiresAt: Number(record.expiresAt),
    issuedAt: Number(record.issuedAt),
    nonce: String(record.nonce ?? ''),
    ownerAddress: String(record.ownerAddress ?? '')
  });
  assertChatImageSessionFresh(authorization.issuedAt, authorization.expiresAt);
  const payload = canonicalTokenPayload(authorization, supabaseUrl);
  if (
    record.audience !== payload.audience ||
    authorization.chainId !== expectedChainId.trim().toLowerCase() ||
    authorization.ownerAddress !== expectedOwnerAddress.trim().toLowerCase()
  ) {
    throw new Error('Chat image session token scope does not match this upload.');
  }
  return payload;
};
