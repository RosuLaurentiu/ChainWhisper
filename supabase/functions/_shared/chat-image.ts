export const CHAT_IMAGES_BUCKET = 'chat-images';
export const MAX_IMAGE_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_ENCRYPTED_BYTES = MAX_IMAGE_PLAINTEXT_BYTES + 64 * 1024;
export const IMAGE_RETENTION_HOURS = 24;
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif'
]);
export const BLOB_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
