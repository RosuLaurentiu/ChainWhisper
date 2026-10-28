import { TEXT_ENCODER } from './byteEncoding';

export const GROUP_CHAT_V2_METADATA_PAYLOAD_VERSION = 1 as const;
export const GROUP_CHAT_V2_MAX_TITLE_CHARACTERS = 80;
export const GROUP_CHAT_V2_MAX_TITLE_BYTES = 256;

const METADATA_KEYS = new Set(['v', 'n']);

export type GroupChatV2MetadataPayload = Readonly<{
  version: typeof GROUP_CHAT_V2_METADATA_PAYLOAD_VERSION;
  title: string;
}>;

const normalizeTitle = (value: string): string => {
  if ([...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  })) {
    throw new Error('Group title is empty, too long, or contains control characters.');
  }
  const title = value.trim().replace(/\s+/gu, ' ');
  if (
    !title ||
    [...title].length > GROUP_CHAT_V2_MAX_TITLE_CHARACTERS ||
    TEXT_ENCODER.encode(title).length > GROUP_CHAT_V2_MAX_TITLE_BYTES
  ) {
    throw new Error('Group title is empty, too long, or contains control characters.');
  }
  return title;
};

export const encodeGroupChatV2MetadataPayload = (title: string): string => JSON.stringify({
  v: GROUP_CHAT_V2_METADATA_PAYLOAD_VERSION,
  n: normalizeTitle(title)
});

export const decodeGroupChatV2MetadataPayload = (
  encoded: string
): GroupChatV2MetadataPayload => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('Group metadata is not valid versioned JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Group metadata payload must be an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !METADATA_KEYS.has(key)) ||
    record.v !== GROUP_CHAT_V2_METADATA_PAYLOAD_VERSION ||
    typeof record.n !== 'string'
  ) {
    throw new Error('Group metadata payload has an unsupported schema.');
  }
  return Object.freeze({
    version: GROUP_CHAT_V2_METADATA_PAYLOAD_VERSION,
    title: normalizeTitle(record.n)
  });
};
