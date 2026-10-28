const FORWARDED_ADDRESS_REGEX = /^[0-9a-f:.]{3,64}$/i;

export class ChatImageRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ChatImageRequestError';
    this.status = status;
  }
}

const getForwardedClientAddress = (request: Request): string => {
  const direct =
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-real-ip')?.trim();
  const forwarded = request.headers.get('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1);
  const value = (direct || forwarded || '').toLowerCase();
  if (!FORWARDED_ADDRESS_REGEX.test(value)) {
    throw new ChatImageRequestError('Chat image client identity is unavailable.', 503);
  }
  return value;
};

export const getChatImageClientHash = async (
  request: Request,
  secret: string
): Promise<string> => {
  if (secret.length < 32) {
    throw new ChatImageRequestError('Chat image rate limiting is unavailable.', 503);
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(getForwardedClientAddress(request))
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const parseChatImageInteger = (value: string, label: string): number => {
  if (!/^[0-9]+$/u.test(value)) {
    throw new ChatImageRequestError(`Invalid ${label}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ChatImageRequestError(`Invalid ${label}.`);
  }
  return parsed;
};

export const readRequestBodyWithLimit = async (
  request: Request,
  maximumBytes: number,
  expectedBytes?: number
): Promise<Uint8Array> => {
  const contentLengthValue = request.headers.get('content-length')?.trim();
  if (contentLengthValue) {
    const contentLength = parseChatImageInteger(contentLengthValue, 'chat image content length');
    if (contentLength > maximumBytes) {
      throw new ChatImageRequestError('Encrypted image blob exceeds the supported size limit.', 413);
    }
    if (typeof expectedBytes === 'number' && contentLength !== expectedBytes) {
      throw new ChatImageRequestError('Encrypted image size does not match its authorization.');
    }
  }

  if (!request.body) {
    throw new ChatImageRequestError('Encrypted image blob is empty.');
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ChatImageRequestError('Encrypted image blob exceeds the supported size limit.', 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total <= 0) {
    throw new ChatImageRequestError('Encrypted image blob is empty.');
  }
  if (typeof expectedBytes === 'number' && total !== expectedBytes) {
    throw new ChatImageRequestError('Encrypted image size does not match its authorization.');
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};
