const TRADE_LINK_MAGIC = 0x54;
const TRADE_LINK_VERSION = 1;
const TRADE_LINK_VERSION_COMPACT_ID = 2;
const TRADE_LINK_HAS_SECRET = 1;
const TRADE_LINK_ID_BYTES = 6;
const TRADE_LINK_SECRET_BYTES = 32;

export type EncodedTradeLink = {
  tradeId: number;
  accessSecret?: string;
};

export const PRIVATE_LINK_SECRET_MISMATCH_MESSAGE =
  'This private link does not match this offer. Open the full Share link from the maker and try again.';

export const normalizeAccessHash = (value?: string | null): string => {
  const normalized = value?.trim() ?? '';
  return /^0x[a-fA-F0-9]{64}$/i.test(normalized) ? normalized.toLowerCase().replace(/^0x/i, '0x') : '';
};

export const doesAccessSecretMatchHash = (
  accessSecret: string,
  accessHash: string | undefined,
  hashAccessSecret: (secret: string) => string
): boolean => {
  const normalizedAccessHash = normalizeAccessHash(accessHash);
  if (!normalizedAccessHash) {
    return true;
  }

  const normalizedSecretHash = normalizeAccessHash(hashAccessSecret(accessSecret));
  return normalizedSecretHash === normalizedAccessHash;
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string): Uint8Array | null => {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*$/.test(normalized)) {
    return null;
  }

  try {
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

const writeTradeIdWithLength = (bytes: Uint8Array, offset: number, tradeId: number, byteLength: number): void => {
  let remaining = BigInt(tradeId);
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
};

const getTradeIdByteLength = (tradeId: number): number => {
  let remaining = BigInt(tradeId);
  let byteLength = 0;
  do {
    byteLength += 1;
    remaining >>= 8n;
  } while (remaining > 0n);

  return Math.min(byteLength, TRADE_LINK_ID_BYTES);
};

const readTradeIdWithLength = (bytes: Uint8Array, offset: number, byteLength: number): number | null => {
  if (byteLength <= 0 || byteLength > TRADE_LINK_ID_BYTES || offset + byteLength > bytes.length) {
    return null;
  }

  let tradeId = 0n;
  for (let index = 0; index < byteLength; index += 1) {
    tradeId = (tradeId << 8n) + BigInt(bytes[offset + index]);
  }

  const parsed = Number(tradeId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseAccessSecretBytes = (accessSecret?: string): Uint8Array | null => {
  if (!accessSecret) {
    return null;
  }

  const normalized = accessSecret.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    return null;
  }

  const bytes = new Uint8Array(TRADE_LINK_SECRET_BYTES);
  for (let index = 0; index < TRADE_LINK_SECRET_BYTES; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
};

const formatAccessSecret = (bytes: Uint8Array, offset: number): string =>
  `0x${Array.from(bytes.slice(offset, offset + TRADE_LINK_SECRET_BYTES), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')}`;

export const encodeTradeLink = (tradeId: number, accessSecret?: string): string => {
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || tradeId > Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid trade id.');
  }

  const secretBytes = parseAccessSecretBytes(accessSecret);
  const hasSecret = Boolean(secretBytes);
  const tradeIdByteLength = getTradeIdByteLength(tradeId);
  const bytes = new Uint8Array(2 + tradeIdByteLength + (hasSecret ? TRADE_LINK_SECRET_BYTES : 0));
  bytes[0] = TRADE_LINK_MAGIC | TRADE_LINK_VERSION_COMPACT_ID;
  bytes[1] = (hasSecret ? TRADE_LINK_HAS_SECRET : 0) | ((tradeIdByteLength - 1) << 1);
  writeTradeIdWithLength(bytes, 2, tradeId, tradeIdByteLength);
  if (secretBytes) {
    bytes.set(secretBytes, 2 + tradeIdByteLength);
  }

  return toBase64Url(bytes);
};

export const decodeTradeLink = (code: string): EncodedTradeLink | null => {
  const bytes = fromBase64Url(code);
  if (!bytes || bytes.length < 3) {
    return null;
  }

  if (bytes[0] !== (TRADE_LINK_MAGIC | TRADE_LINK_VERSION) && bytes[0] !== (TRADE_LINK_MAGIC | TRADE_LINK_VERSION_COMPACT_ID)) {
    return null;
  }

  const hasSecret = (bytes[1] & TRADE_LINK_HAS_SECRET) === TRADE_LINK_HAS_SECRET;
  const tradeIdByteLength =
    bytes[0] === (TRADE_LINK_MAGIC | TRADE_LINK_VERSION_COMPACT_ID)
      ? ((bytes[1] >> 1) & 0x07) + 1
      : TRADE_LINK_ID_BYTES;
  const expectedLength = 2 + tradeIdByteLength + (hasSecret ? TRADE_LINK_SECRET_BYTES : 0);
  if (bytes.length !== expectedLength) {
    return null;
  }

  const tradeId = readTradeIdWithLength(bytes, 2, tradeIdByteLength);
  if (!tradeId) {
    return null;
  }

  return {
    tradeId,
    accessSecret: hasSecret ? formatAccessSecret(bytes, 2 + tradeIdByteLength) : undefined
  };
};
