import { getSupabaseBrowserClient } from './supabaseClient';

export type ParsedImageTag = {
  blobId: string;
  keyHex: string;
  ivHex: string;
  sizeBytes: number;
  mime: string;
};

export type ChatImageConversationKind = 'direct' | 'group';

export const MAX_IMAGE_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_ENCRYPTED_BYTES = MAX_IMAGE_PLAINTEXT_BYTES + 64 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);
export const CHAT_IMAGE_FILE_ACCEPT = Array.from(ALLOWED_IMAGE_MIME_TYPES).join(',');

const CHAT_IMAGES_BUCKET = 'chat-images';

export class ChatImageExpiredError extends Error {
  constructor() {
    super('This image has expired.');
    this.name = 'ChatImageExpiredError';
  }
}

export const isChatImageExpiredError = (error: unknown): error is ChatImageExpiredError =>
  error instanceof ChatImageExpiredError;

const getSecureWebCrypto = (): { webCrypto: Crypto; subtle: SubtleCrypto } => {
  const webCrypto = globalThis.crypto;
  const subtle = webCrypto?.subtle;
  if (webCrypto && subtle) {
    return { webCrypto, subtle };
  }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error('Image encryption requires HTTPS. Open the app using an https:// URL.');
  }

  throw new Error('Web Crypto API is unavailable in this browser.');
};

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function buildImageBlobId(): string {
  const { webCrypto } = getSecureWebCrypto();
  if (typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  const randomBytes = webCrypto.getRandomValues(new Uint8Array(16));
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(randomBytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeImageMimeType(mime: string): string {
  return mime.trim().toLowerCase();
}

function validateImageFile(file: File): { mime: string; sizeBytes: number } {
  const mime = normalizeImageMimeType(file.type);
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
    throw new Error('Unsupported image format. Use JPEG, PNG, WEBP, GIF, or AVIF.');
  }

  const sizeBytes = Math.floor(file.size);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error('The selected image is empty.');
  }
  if (sizeBytes > MAX_IMAGE_PLAINTEXT_BYTES) {
    throw new Error('Image is too large. The 8 MB limit applies before encryption.');
  }

  return { mime, sizeBytes };
}

async function uploadEncryptedBlob(
  blobId: string,
  encrypted: ArrayBuffer,
  mime: string,
  sizeBytes: number,
  kind: ChatImageConversationKind
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });
  const { error } = await supabase.storage.from(CHAT_IMAGES_BUCKET).upload(blobId, encryptedBlob, {
    cacheControl: '86400',
    contentType: 'application/octet-stream',
    upsert: false,
    metadata: {
      mime,
      plaintextSize: String(sizeBytes),
      conversationKind: kind
    }
  });
  if (error) {
    const normalizedMessage = error.message.toLowerCase();
    if (normalizedMessage.includes('row-level security')) {
      throw new Error('Supabase Storage upload is blocked by policy. Apply the storage policy migration first.');
    }
    if (normalizedMessage.includes('bucket not found')) {
      throw new Error('Supabase Storage bucket "chat-images" does not exist yet.');
    }
    throw new Error(error.message || 'Failed to upload the encrypted image.');
  }
}

async function encryptImageToBlob(file: File): Promise<{ blobId: string; encrypted: ArrayBuffer; keyHex: string; ivHex: string }> {
  const { webCrypto, subtle } = getSecureWebCrypto();
  const plainBuffer = await file.arrayBuffer();
  if (plainBuffer.byteLength > MAX_IMAGE_PLAINTEXT_BYTES) {
    throw new Error('Image is too large. The 8 MB limit applies before encryption.');
  }

  const keyBytes = webCrypto.getRandomValues(new Uint8Array(32));
  const ivBytes = webCrypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes as unknown as BufferSource },
    cryptoKey,
    plainBuffer
  );

  if ((encrypted as ArrayBuffer).byteLength > MAX_IMAGE_ENCRYPTED_BYTES) {
    throw new Error('Encrypted image blob exceeds the supported size limit.');
  }

  return {
    blobId: buildImageBlobId(),
    encrypted: encrypted as ArrayBuffer,
    keyHex: bytesToHex(keyBytes),
    ivHex: bytesToHex(ivBytes)
  };
}

export async function createEncryptedImageTagFromFile(
  file: File,
  kind: ChatImageConversationKind
): Promise<string> {
  const { mime, sizeBytes } = validateImageFile(file);
  const { blobId, encrypted, keyHex, ivHex } = await encryptImageToBlob(file);
  await uploadEncryptedBlob(blobId, encrypted, mime, sizeBytes, kind);
  return `[img:${blobId}|${keyHex}:${ivHex}|${sizeBytes}|${mime}]`;
}

export async function fetchEncryptedBlob(blobId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const { data } = getSupabaseBrowserClient().storage.from(CHAT_IMAGES_BUCKET).getPublicUrl(blobId);
  const resp = await fetch(data.publicUrl, { signal });
  if (!resp.ok) {
    if (resp.status === 404 || resp.status === 410) {
      throw new ChatImageExpiredError();
    }
    throw new Error(`Blob ${resp.status}`);
  }

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

export async function decryptBlobToObjectUrl(
  encrypted: ArrayBuffer,
  keyHex: string,
  ivHex: string,
  mime?: string
): Promise<string> {
  if (encrypted.byteLength > MAX_IMAGE_ENCRYPTED_BYTES) {
    throw new Error('Encrypted image blob exceeds limit.');
  }

  const { subtle } = getSecureWebCrypto();
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const cryptoKey = await subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: ivBytes as unknown as BufferSource }, cryptoKey, encrypted);
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
