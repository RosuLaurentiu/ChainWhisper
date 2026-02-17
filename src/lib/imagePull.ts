export type ParsedImageTag = {
  blobId: string;
  keyHex: string;
  ivHex: string;
  sizeBytes: number;
  mime: string;
};

const MAX_IMAGE_PLAINTEXT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_ENCRYPTED_BYTES = MAX_IMAGE_PLAINTEXT_BYTES + 64 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);

export function parseImageTag(plaintext: string): ParsedImageTag | null {
  const m = /\[img:([0-9a-f-]+)\|([0-9a-f]+):([0-9a-f]+)\|(\d+)\|([a-z/+-]+)\]/i.exec(plaintext);
  if (!m) return null;
  const [, blobId, keyHex, ivHex, sizeBytes, mime] = m;
  const normalizedMime = mime.toLowerCase();
  const parsedSize = Number(sizeBytes);

  if (blobId.length < 8 || blobId.length > 128) return null;
  if (!/^[0-9a-f-]+$/i.test(blobId)) return null;
  if (keyHex.length !== 64 || !/^[0-9a-f]+$/i.test(keyHex)) return null;
  if (ivHex.length !== 24 || !/^[0-9a-f]+$/i.test(ivHex)) return null;
  if (!Number.isSafeInteger(parsedSize) || parsedSize <= 0 || parsedSize > MAX_IMAGE_PLAINTEXT_BYTES) return null;
  if (!ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)) return null;

  return { blobId, keyHex, ivHex, sizeBytes: parsedSize, mime: normalizedMime };
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('Invalid hex data.');
  }

  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const part = hex.slice(i, i + 2);
    const value = Number.parseInt(part, 16);
    if (!Number.isFinite(value)) {
      throw new Error('Invalid hex byte.');
    }
    b[i / 2] = value;
  }
  return b;
}

const BASE_URL = 'https://api-ciphertrade.innovunode.io/';

export async function fetchEncryptedBlob(blobId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const resp = await fetch(`${BASE_URL}chat/blob/${encodeURIComponent(blobId)}`, { signal });
  if (!resp.ok) throw new Error(`Blob ${resp.status}`);

  const contentLengthHeader = resp.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_ENCRYPTED_BYTES) {
      throw new Error('Encrypted image blob is too large.');
    }
  }

  const encrypted = await resp.arrayBuffer();
  if (encrypted.byteLength > MAX_IMAGE_ENCRYPTED_BYTES) {
    throw new Error('Encrypted image blob exceeds limit.');
  }
  return encrypted;
}

export async function decryptBlobToObjectUrl(encrypted: ArrayBuffer, keyHex: string, ivHex: string, mime?: string): Promise<string> {
  if (encrypted.byteLength > MAX_IMAGE_ENCRYPTED_BYTES) {
    throw new Error('Encrypted image blob exceeds limit.');
  }

  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes as unknown as BufferSource, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes as unknown as BufferSource }, cryptoKey, encrypted);
  if ((pt as ArrayBuffer).byteLength > MAX_IMAGE_PLAINTEXT_BYTES) {
    throw new Error('Decrypted image exceeds size limit.');
  }
  const blob = new Blob([pt], { type: mime ?? 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

export async function fetchAndDecryptToUrl(
  blobId: string,
  keyHex: string,
  ivHex: string,
  mime?: string,
  signal?: AbortSignal
): Promise<string> {
  const encrypted = await fetchEncryptedBlob(blobId, signal);
  return decryptBlobToObjectUrl(encrypted, keyHex, ivHex, mime);
}
