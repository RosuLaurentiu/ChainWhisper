import { bytesToHex, hexToBytes } from './byteEncoding';

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
const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type ImageFileLike = Pick<File, 'size' | 'type'>;

export class ChatImageExpiredError extends Error {
  constructor() {
    super('This image has expired.');
    this.name = 'ChatImageExpiredError';
  }
}

export class ChatImageDecryptError extends Error {
  constructor() {
    super('This image could not be decrypted.');
    this.name = 'ChatImageDecryptError';
  }
}

export class ChatImageBlobTooLargeError extends Error {
  constructor() {
    super('Encrypted image blob exceeds the supported size limit.');
    this.name = 'ChatImageBlobTooLargeError';
  }
}

export const isChatImageExpiredError = (error: unknown): error is ChatImageExpiredError =>
  error instanceof ChatImageExpiredError;

export const isChatImageDecryptError = (error: unknown): error is ChatImageDecryptError =>
  error instanceof ChatImageDecryptError;

export const isChatImageBlobTooLargeError = (error: unknown): error is ChatImageBlobTooLargeError =>
  error instanceof ChatImageBlobTooLargeError;

export const formatImageFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 bytes';
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} bytes`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib >= 10 ? Math.round(kib) : kib.toFixed(1)} KB`;
  }

  const mib = kib / 1024;
  return `${mib >= 10 ? Math.round(mib) : mib.toFixed(1)} MB`;
};

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

export function getImageFileValidationError(file: ImageFileLike): string | null {
  const mime = normalizeImageMimeType(file.type);
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mime)) {
    return 'Unsupported image format. Use JPEG, PNG, WEBP, GIF, or AVIF.';
  }

  const sizeBytes = Math.floor(file.size);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return 'The selected image is empty.';
  }
  if (sizeBytes > MAX_IMAGE_PLAINTEXT_BYTES) {
    return `Image is too large (${formatImageFileSize(sizeBytes)}). The limit is ${formatImageFileSize(MAX_IMAGE_PLAINTEXT_BYTES)} before encryption.`;
  }

  return null;
}

function validateImageFile(file: ImageFileLike): { mime: string; sizeBytes: number } {
  const validationError = getImageFileValidationError(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const mime = normalizeImageMimeType(file.type);
  const sizeBytes = Math.floor(file.size);
  return { mime, sizeBytes };
}

const getStorageErrorStatusCode = (error: unknown): number | null => {
  const rawStatus =
    error && typeof error === 'object'
      ? (error as { statusCode?: unknown; status?: unknown }).statusCode ?? (error as { status?: unknown }).status
      : null;
  const parsedStatus = Number(rawStatus);
  return Number.isFinite(parsedStatus) ? parsedStatus : null;
};

const getStorageUploadErrorMessage = (error: unknown): string => {
  const rawMessage =
    error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';
  const normalizedMessage = rawMessage.toLowerCase();
  const statusCode = getStorageErrorStatusCode(error);

  if (statusCode === 413 || normalizedMessage.includes('file size') || normalizedMessage.includes('too large')) {
    return `Encrypted upload was rejected by Supabase Storage because it is too large. Try an image under ${formatImageFileSize(MAX_IMAGE_PLAINTEXT_BYTES)}.`;
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    normalizedMessage.includes('row-level security') ||
    normalizedMessage.includes('permission')
  ) {
    return 'Supabase Storage upload is blocked by policy. Apply the storage policy migration first.';
  }
  if (statusCode === 404 || normalizedMessage.includes('bucket not found')) {
    return 'Supabase Storage bucket "chat-images" does not exist yet.';
  }
  if (normalizedMessage.includes('network') || normalizedMessage.includes('fetch')) {
    return 'Encrypted image upload failed. Check your connection and try again.';
  }

  return rawMessage
    ? `Encrypted image upload failed: ${rawMessage}`
    : 'Encrypted image upload failed. Try again in a moment.';
};

async function uploadEncryptedBlob(
  blobId: string,
  encrypted: ArrayBuffer,
  mime: string,
  sizeBytes: number,
  kind: ChatImageConversationKind,
  ownerAddress: string
): Promise<void> {
  const normalizedOwnerAddress = ownerAddress.trim().toLowerCase();
  if (!WALLET_ADDRESS_REGEX.test(normalizedOwnerAddress)) {
    throw new Error('Connect a wallet before sending an image.');
  }

  const { getSupabaseBrowserClient } = await import('./supabaseClient');
  const supabase = getSupabaseBrowserClient();
  const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });
  const { error } = await supabase.functions.invoke('chat-image-upload', {
    body: encryptedBlob,
    headers: {
      'content-type': 'application/octet-stream',
      'x-chat-image-blob-id': blobId,
      'x-chat-image-kind': kind,
      'x-chat-image-mime': mime,
      'x-chat-image-owner': normalizedOwnerAddress,
      'x-chat-image-plaintext-size': String(sizeBytes)
    }
  });
  if (error) {
    throw new Error(getStorageUploadErrorMessage(error));
  }
}

export async function confirmChatImageUpload(blobId: string, txHash: string): Promise<void> {
  const normalizedBlobId = blobId.trim().toLowerCase();
  const normalizedTxHash = txHash.trim().toLowerCase();
  if (!normalizedBlobId || !normalizedTxHash) {
    throw new Error('Image message transaction is unavailable.');
  }

  const { getSupabaseBrowserClient } = await import('./supabaseClient');
  const { error } = await getSupabaseBrowserClient().functions.invoke('chat-image-confirm', {
    body: {
      blobId: normalizedBlobId,
      txHash: normalizedTxHash
    }
  });
  if (error) {
    throw new Error('Image message was sent, but the server could not confirm image retention.');
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
    throw new ChatImageBlobTooLargeError();
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
  kind: ChatImageConversationKind,
  ownerAddress: string
): Promise<string> {
  const { mime, sizeBytes } = validateImageFile(file);
  const { blobId, encrypted, keyHex, ivHex } = await encryptImageToBlob(file);
  await uploadEncryptedBlob(blobId, encrypted, mime, sizeBytes, kind, ownerAddress);
  return `[img:${blobId}|${keyHex}:${ivHex}|${sizeBytes}|${mime}]`;
}

export async function fetchEncryptedBlob(blobId: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const { getSupabaseBrowserClient } = await import('./supabaseClient');
  const { data } = getSupabaseBrowserClient().storage.from(CHAT_IMAGES_BUCKET).getPublicUrl(blobId);
  const resp = await fetch(data.publicUrl, { signal });
  if (!resp.ok) {
    if (resp.status === 404 || resp.status === 410) {
      throw new ChatImageExpiredError();
    }
    if (resp.status === 413) {
      throw new ChatImageBlobTooLargeError();
    }
    throw new Error(`Encrypted image download failed with HTTP ${resp.status}.`);
  }

  const contentLengthHeader = resp.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_ENCRYPTED_BYTES) {
      throw new ChatImageBlobTooLargeError();
    }
  }

  const encrypted = await resp.arrayBuffer();
  if (encrypted.byteLength > MAX_IMAGE_ENCRYPTED_BYTES) {
    throw new ChatImageBlobTooLargeError();
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
    throw new ChatImageBlobTooLargeError();
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
  let pt: ArrayBuffer;
  try {
    pt = (await subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes as unknown as BufferSource },
      cryptoKey,
      encrypted
    )) as ArrayBuffer;
  } catch {
    throw new ChatImageDecryptError();
  }
  if ((pt as ArrayBuffer).byteLength > MAX_IMAGE_PLAINTEXT_BYTES) {
    throw new ChatImageBlobTooLargeError();
  }
  const blob = new Blob([pt], { type: mime ?? 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

export const getChatImageLoadErrorMessage = (error: unknown): string => {
  if (isChatImageDecryptError(error)) {
    return 'This image could not be decrypted. The message may be corrupted or missing its image key.';
  }
  if (isChatImageBlobTooLargeError(error)) {
    return 'This encrypted image is larger than the app can safely display.';
  }

  return 'Unable to download the encrypted image. Check your connection and try again.';
};

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
