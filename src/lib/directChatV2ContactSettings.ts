import type {
  DirectChatV2ContactSettings,
  DirectChatV2ContactSettingsSnapshot
} from './directChatV2Chain';

export const DIRECT_CHAT_V2_CONTACT_SETTINGS_SCHEMA = '1';
export const DIRECT_CHAT_V2_CONTACT_SAVED_NAME_MAX_BYTES = 32;

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

export const normalizeDirectChatV2ContactSavedName = (value: string): string => {
  if (typeof value !== 'string') {
    throw new Error('Saved contact name must be text.');
  }
  const normalized = value.trim();
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      throw new Error('Saved contact name cannot contain control characters.');
    }
  }
  if (utf8Length(normalized) > DIRECT_CHAT_V2_CONTACT_SAVED_NAME_MAX_BYTES) {
    throw new Error(
      `Saved contact name must be at most ${DIRECT_CHAT_V2_CONTACT_SAVED_NAME_MAX_BYTES} UTF-8 bytes.`
    );
  }
  return normalized;
};

export const normalizeDirectChatV2ContactSettings = (
  value: DirectChatV2ContactSettings
): DirectChatV2ContactSettings => Object.freeze({
  savedName: normalizeDirectChatV2ContactSavedName(value.savedName),
  hidden: value.hidden === true
});

export const isEmptyDirectChatV2ContactSettings = (
  value: DirectChatV2ContactSettings
): boolean => {
  const normalized = normalizeDirectChatV2ContactSettings(value);
  return normalized.savedName.length === 0 && !normalized.hidden;
};

export const encodeDirectChatV2ContactSettings = (
  value: DirectChatV2ContactSettings
): string => {
  const normalized = normalizeDirectChatV2ContactSettings(value);
  return `${DIRECT_CHAT_V2_CONTACT_SETTINGS_SCHEMA}${normalized.hidden ? '1' : '0'}${normalized.savedName}`;
};

export const decodeDirectChatV2ContactSettings = (
  value: unknown
): DirectChatV2ContactSettings => {
  if (typeof value !== 'string') {
    throw new Error('Decrypted contact settings are not text.');
  }
  const unpadded = value.replace(/\0+$/u, '');
  if (unpadded.length < 2 || unpadded[0] !== DIRECT_CHAT_V2_CONTACT_SETTINGS_SCHEMA) {
    throw new Error('Decrypted contact settings use an unsupported schema.');
  }
  const hiddenFlag = unpadded[1];
  if (hiddenFlag !== '0' && hiddenFlag !== '1') {
    throw new Error('Decrypted contact settings contain an invalid hidden flag.');
  }
  return normalizeDirectChatV2ContactSettings({
    savedName: unpadded.slice(2),
    hidden: hiddenFlag === '1'
  });
};

export type DirectChatV2LoadedContactSettings = readonly [
  contact: string,
  snapshot: DirectChatV2ContactSettingsSnapshot
];

/**
 * Private contact settings are intentionally read one at a time. Each existing
 * record requires a COTI user-envelope decryption, so concurrent fan-out can
 * overload an injected wallet even though the reads do not request signatures.
 */
export const readDirectChatV2ContactSettingsSerially = async ({
  contacts,
  read,
  shouldContinue = () => true
}: {
  contacts: readonly string[];
  read: (contact: string) => Promise<DirectChatV2ContactSettingsSnapshot>;
  shouldContinue?: () => boolean;
}): Promise<readonly DirectChatV2LoadedContactSettings[]> => {
  const loaded: DirectChatV2LoadedContactSettings[] = [];
  const seen = new Set<string>();
  for (const rawContact of contacts) {
    const contact = rawContact.trim().toLowerCase();
    if (!contact || seen.has(contact)) continue;
    seen.add(contact);
    if (!shouldContinue()) break;
    try {
      const snapshot = await read(contact);
      if (!shouldContinue()) break;
      loaded.push(Object.freeze([contact, snapshot]));
    } catch {
      // One malformed or temporarily unavailable private record must not hide
      // other contacts. It remains eligible for a later retry.
    }
  }
  return Object.freeze(loaded);
};
