import { TEXT_ENCODER } from './byteEncoding';
import {
  DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES,
  DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES
} from './directChatV2Crypto';
import { normalizeChatReplySourceAnchor } from './chatReplySourceAnchor';

export const DIRECT_CHAT_V2_PAYLOAD_VERSION = 1 as const;
export const DIRECT_CHAT_V2_MAX_PLAINTEXT_BYTES =
  DIRECT_CHAT_V2_MAX_CIPHERTEXT_BYTES - DIRECT_CHAT_V2_MIN_CIPHERTEXT_BYTES;

const UINT64_MAX = (1n << 64n) - 1n;
const PAYLOAD_KEYS = new Set(['v', 'b', 'r', 'a', 'p']);

export type DirectChatV2Payload = {
  version: typeof DIRECT_CHAT_V2_PAYLOAD_VERSION;
  body: string;
  replyToMessageId?: bigint;
  replyToMessageAnchor?: string;
  replyPreview?: string;
};

const normalizeReplyId = (value: bigint): bigint => {
  if (value <= 0n || value > UINT64_MAX) {
    throw new Error('Direct-chat reply target must be a non-zero uint64 message ID.');
  }
  return value;
};

const assertPayloadByteBound = (value: string): void => {
  if (
    value.length > DIRECT_CHAT_V2_MAX_PLAINTEXT_BYTES ||
    TEXT_ENCODER.encode(value).length > DIRECT_CHAT_V2_MAX_PLAINTEXT_BYTES
  ) {
    throw new Error('Direct-chat payload exceeds the encrypted message limit.');
  }
};

export const encodeDirectChatV2Payload = ({
  body,
  replyToMessageId,
  replyToMessageAnchor,
  replyPreview
}: {
  body: string;
  replyToMessageId?: bigint;
  replyToMessageAnchor?: string;
  replyPreview?: string;
}): string => {
  if (!body.trim()) {
    throw new Error('Direct-chat payload body cannot be empty.');
  }
  if (replyPreview !== undefined && replyToMessageId === undefined) {
    throw new Error('Direct-chat reply preview requires a stable reply target.');
  }
  if (replyToMessageAnchor !== undefined && replyToMessageId === undefined) {
    throw new Error('Direct-chat reply source anchor requires a stable reply target.');
  }
  const payload = JSON.stringify({
    v: DIRECT_CHAT_V2_PAYLOAD_VERSION,
    b: body,
    ...(replyToMessageId === undefined ? {} : { r: normalizeReplyId(replyToMessageId).toString() }),
    ...(replyToMessageAnchor === undefined
      ? {}
      : { a: normalizeChatReplySourceAnchor(replyToMessageAnchor) }),
    ...(replyPreview === undefined ? {} : { p: replyPreview })
  });
  assertPayloadByteBound(payload);
  return payload;
};

export const decodeDirectChatV2Payload = (encoded: string): DirectChatV2Payload => {
  assertPayloadByteBound(encoded);
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('Direct-chat payload is not valid versioned JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Direct-chat payload must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !PAYLOAD_KEYS.has(key))) {
    throw new Error('Direct-chat payload contains unsupported fields.');
  }
  if (record.v !== DIRECT_CHAT_V2_PAYLOAD_VERSION || typeof record.b !== 'string' || !record.b.trim()) {
    throw new Error('Direct-chat payload version or body is invalid.');
  }

  let replyToMessageId: bigint | undefined;
  if (record.r !== undefined) {
    if (typeof record.r !== 'string' || !/^[1-9][0-9]*$/.test(record.r)) {
      throw new Error('Direct-chat reply target is not canonical.');
    }
    replyToMessageId = normalizeReplyId(BigInt(record.r));
  }
  if (record.p !== undefined && (typeof record.p !== 'string' || replyToMessageId === undefined)) {
    throw new Error('Direct-chat reply preview is invalid.');
  }
  if (record.a !== undefined && (typeof record.a !== 'string' || replyToMessageId === undefined)) {
    throw new Error('Direct-chat reply source anchor is invalid.');
  }
  const replyToMessageAnchor = record.a === undefined
    ? undefined
    : normalizeChatReplySourceAnchor(record.a as string);

  return {
    version: DIRECT_CHAT_V2_PAYLOAD_VERSION,
    body: record.b,
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    ...(replyToMessageAnchor === undefined ? {} : { replyToMessageAnchor }),
    ...(record.p === undefined ? {} : { replyPreview: record.p as string })
  };
};
