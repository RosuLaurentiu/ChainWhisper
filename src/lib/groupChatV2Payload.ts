import { TEXT_ENCODER } from './byteEncoding';
import {
  GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES,
  GROUP_CHAT_V2_MIN_CIPHERTEXT_BYTES
} from './groupChatV2Crypto';
import { normalizeChatReplySourceAnchor } from './chatReplySourceAnchor';

export const GROUP_CHAT_V2_PAYLOAD_VERSION = 1 as const;
export const GROUP_CHAT_V2_MAX_PLAINTEXT_BYTES =
  GROUP_CHAT_V2_MAX_CIPHERTEXT_BYTES - GROUP_CHAT_V2_MIN_CIPHERTEXT_BYTES;

const UINT64_MAX = (1n << 64n) - 1n;
const PAYLOAD_KEYS = new Set(['v', 'b', 'r', 'a', 'p']);

export type GroupChatV2Payload = Readonly<{
  version: typeof GROUP_CHAT_V2_PAYLOAD_VERSION;
  body: string;
  replyToMessageId?: bigint;
  replyToMessageAnchor?: string;
  replyPreview?: string;
}>;

const replyId = (value: bigint): bigint => {
  if (value <= 0n || value > UINT64_MAX) {
    throw new Error('Group-chat reply target must be a non-zero uint64 message ID.');
  }
  return value;
};

const assertByteBound = (value: string): void => {
  if (
    value.length > GROUP_CHAT_V2_MAX_PLAINTEXT_BYTES ||
    TEXT_ENCODER.encode(value).length > GROUP_CHAT_V2_MAX_PLAINTEXT_BYTES
  ) {
    throw new Error('Group-chat payload exceeds the encrypted message limit.');
  }
};

export const encodeGroupChatV2Payload = ({
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
  if (!body.trim()) throw new Error('Group-chat payload body cannot be empty.');
  if (replyPreview !== undefined && replyToMessageId === undefined) {
    throw new Error('Group-chat reply preview requires a stable reply target.');
  }
  if (replyToMessageAnchor !== undefined && replyToMessageId === undefined) {
    throw new Error('Group-chat reply source anchor requires a stable reply target.');
  }
  const encoded = JSON.stringify({
    v: GROUP_CHAT_V2_PAYLOAD_VERSION,
    b: body,
    ...(replyToMessageId === undefined ? {} : { r: replyId(replyToMessageId).toString() }),
    ...(replyToMessageAnchor === undefined
      ? {}
      : { a: normalizeChatReplySourceAnchor(replyToMessageAnchor) }),
    ...(replyPreview === undefined ? {} : { p: replyPreview })
  });
  assertByteBound(encoded);
  return encoded;
};

export const decodeGroupChatV2Payload = (encoded: string): GroupChatV2Payload => {
  assertByteBound(encoded);
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('Group-chat payload is not valid versioned JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Group-chat payload must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !PAYLOAD_KEYS.has(key))) {
    throw new Error('Group-chat payload contains unsupported fields.');
  }
  if (record.v !== GROUP_CHAT_V2_PAYLOAD_VERSION || typeof record.b !== 'string' || !record.b.trim()) {
    throw new Error('Group-chat payload version or body is invalid.');
  }
  let replyToMessageId: bigint | undefined;
  if (record.r !== undefined) {
    if (typeof record.r !== 'string' || !/^[1-9][0-9]*$/u.test(record.r)) {
      throw new Error('Group-chat reply target is not canonical.');
    }
    replyToMessageId = replyId(BigInt(record.r));
  }
  if (record.p !== undefined && (typeof record.p !== 'string' || replyToMessageId === undefined)) {
    throw new Error('Group-chat reply preview is invalid.');
  }
  if (record.a !== undefined && (typeof record.a !== 'string' || replyToMessageId === undefined)) {
    throw new Error('Group-chat reply source anchor is invalid.');
  }
  const replyToMessageAnchor = record.a === undefined
    ? undefined
    : normalizeChatReplySourceAnchor(record.a as string);
  return Object.freeze({
    version: GROUP_CHAT_V2_PAYLOAD_VERSION,
    body: record.b,
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
    ...(replyToMessageAnchor === undefined ? {} : { replyToMessageAnchor }),
    ...(record.p === undefined ? {} : { replyPreview: record.p as string })
  });
};
