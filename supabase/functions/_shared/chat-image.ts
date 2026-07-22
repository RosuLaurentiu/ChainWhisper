export const CHAT_IMAGES_BUCKET = 'chat-images';
export const CHAT_IMAGE_UPLOADS_TABLE = 'chat_image_uploads';
export const MAX_IMAGE_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_ENCRYPTED_BYTES = MAX_IMAGE_PLAINTEXT_BYTES + 64 * 1024;
export const IMAGE_RETENTION_HOURS = 24;
export const PENDING_IMAGE_RETENTION_MINUTES = 30;
export const COTI_CHAIN_ID_HEX = '0x282b34';
export const CHAT_CONTRACT_ADDRESS = '0xE5101D33986c91565D2C9f8b49AAF0b8FFeE2243';
export const GROUP_CHAT_CONTRACT_ADDRESS = '0xE175ec590CE13FB6349f1CAd8b7e9D5d21eaa32b';
export const DIRECT_CHAT_SUBMIT_SELECTORS = new Set(['0x19aaa6de', '0x8221c873']);
export const GROUP_CHAT_SUBMIT_SELECTORS = new Set(['0x218cf10d', '0xf6085bf7']);
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);
export const BLOB_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TX_HASH_REGEX = /^0x[a-f0-9]{64}$/i;
export const WALLET_ADDRESS_REGEX = /^0x[a-f0-9]{40}$/i;

export const jsonResponse = (
  body: Record<string, unknown>,
  init?: Omit<ResponseInit, 'headers'> & { headers?: HeadersInit }
): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {})
    }
  });

export const normalizeMimeType = (value: string | null): string => (value ?? '').trim().toLowerCase();
