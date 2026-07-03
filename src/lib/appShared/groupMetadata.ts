import {
  decodeBase64Url,
  decodeBase64UrlBytes,
  encodeBase64Url,
  encodeBase64UrlBytes,
  TEXT_DECODER,
  TEXT_ENCODER
} from '../byteEncoding';
import {
  isWalletAddress,
  normalizeContactName,
  shortenAddress
} from './identity';

export type LegacyGroupInviteCodePayload = {
  version: 1;
  groupId: number;
  expiresAt: number;
  inviter?: string;
};

export type GroupJoinCodePayload = {
  version: 2;
  groupId: number;
  code: string;
  expiresAt: number;
  inviter?: string;
};

export type GroupInviteCodePayload = LegacyGroupInviteCodePayload | GroupJoinCodePayload;

export const GROUP_JOIN_CODE_PREFIX = 'coti-group-code-v2:';
export const LEGACY_GROUP_INVITE_CODE_PREFIX = 'coti-group-code-v1:';
export const GROUP_TITLE_METADATA_PREFIX = '[[coti-group:v1]]';
export const GROUP_TITLE_COMPACT_PREFIX = 'cg3:';
export const GROUP_TITLE_ENCRYPTION_VERSION = 3;
export const GROUP_TITLE_KEY_MATERIAL = 'chainwhisper-group-title-aes-v1';
export const GROUP_JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GROUP_JOIN_CODE_LENGTH = 5;
export const GROUP_JOIN_CODE_SIGNER_KEY_PREFIX = 'coti-group-join-key-v1:';
export const GROUP_JOIN_CODE_PROOF_DOMAIN = 'COTI_GROUP_JOIN_CODE_PROOF_V1';
export const GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS = 15 * 60;

let groupTitleCryptoKeyPromise: Promise<CryptoKey | null> | null = null;

export const loadGroupTitleCryptoKey = (): Promise<CryptoKey | null> => {
  if (!groupTitleCryptoKeyPromise) {
    groupTitleCryptoKeyPromise = (async () => {
      if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
        return null;
      }
      const keySeed = TEXT_ENCODER.encode(GROUP_TITLE_KEY_MATERIAL);
      const keyDigest = await crypto.subtle.digest('SHA-256', keySeed);
      return crypto.subtle.importKey(
        'raw',
        keyDigest,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    })().catch(() => null);
  }
  return groupTitleCryptoKeyPromise;
};

export const encryptGroupTitle = async (plainTitle: string): Promise<{ iv: string; ciphertext: string } | null> => {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    return null;
  }
  const key = await loadGroupTitleCryptoKey();
  if (!key) {
    return null;
  }

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plainBytes = new Uint8Array(TEXT_ENCODER.encode(plainTitle));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBytes
  );
  return {
    iv: encodeBase64UrlBytes(iv),
    ciphertext: encodeBase64UrlBytes(new Uint8Array(encryptedBuffer))
  };
};

export const decryptGroupTitle = async (ivRaw: string, ciphertextRaw: string): Promise<string | null> => {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
    return null;
  }
  const key = await loadGroupTitleCryptoKey();
  if (!key) {
    return null;
  }

  try {
    const iv = decodeBase64UrlBytes(ivRaw);
    const ciphertext = decodeBase64UrlBytes(ciphertextRaw);
    if (iv.length !== 12 || ciphertext.length === 0) {
      return null;
    }
    const ivBytes = new Uint8Array(iv.length);
    ivBytes.set(iv);
    const ciphertextBytes = new Uint8Array(ciphertext.length);
    ciphertextBytes.set(ciphertext);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      ciphertextBytes
    );
    return normalizeContactName(TEXT_DECODER.decode(new Uint8Array(decryptedBuffer))) ?? null;
  } catch {
    return null;
  }
};

export const generateRandomGroupJoinCode = (): string => {
  const values = new Uint8Array(GROUP_JOIN_CODE_LENGTH);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 256);
    }
  }

  let compactCode = '';
  for (let index = 0; index < values.length; index += 1) {
    compactCode += GROUP_JOIN_CODE_ALPHABET[values[index] % GROUP_JOIN_CODE_ALPHABET.length];
  }

  return compactCode.slice(0, GROUP_JOIN_CODE_LENGTH);
};

export const encodeGroupInviteCode = (payload: GroupInviteCodePayload): string => {
  if (payload.version === 2) {
    return `${payload.groupId}:${payload.code}`;
  }
  const serialized = JSON.stringify(payload);
  return `${GROUP_JOIN_CODE_PREFIX}${encodeBase64Url(serialized)}`;
};

export const parseGroupInviteCode = (input: string): GroupInviteCodePayload | null => {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  try {
    const encodedPayload = raw.startsWith(GROUP_JOIN_CODE_PREFIX)
      ? raw.slice(GROUP_JOIN_CODE_PREFIX.length)
      : raw.startsWith(LEGACY_GROUP_INVITE_CODE_PREFIX)
        ? raw.slice(LEGACY_GROUP_INVITE_CODE_PREFIX.length)
        : raw;
    if (!encodedPayload) {
      return null;
    }

    const decoded = decodeBase64Url(encodedPayload);
    const parsed = JSON.parse(decoded) as {
      version?: unknown;
      groupId?: unknown;
      code?: unknown;
      expiresAt?: unknown;
      inviter?: unknown;
    };
    const version = Number(parsed.version);
    const groupId = Number(parsed.groupId);
    const expiresAtRaw = Number(parsed.expiresAt);
    const expiresAt = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0 ? Math.floor(expiresAtRaw) : 0;
    const inviter = typeof parsed.inviter === 'string' ? parsed.inviter.trim() : undefined;
    if (version === 2) {
      const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
      if (!Number.isFinite(groupId) || groupId <= 0 || !code) {
        return null;
      }

      return {
        version: 2,
        groupId: Math.floor(groupId),
        code,
        expiresAt,
        inviter: inviter && isWalletAddress(inviter) ? inviter : undefined
      };
    }

    if (version === 1 && Number.isFinite(groupId) && groupId > 0 && expiresAt > 0) {
      return {
        version: 1,
        groupId: Math.floor(groupId),
        expiresAt,
        inviter: inviter && isWalletAddress(inviter) ? inviter : undefined
      };
    }
  } catch {
  }

  const delimiterIndex = raw.indexOf(':');
  if (delimiterIndex <= 0 || delimiterIndex >= raw.length - 1) {
    return null;
  }

  const groupId = Number(raw.slice(0, delimiterIndex).trim());
  const code = raw.slice(delimiterIndex + 1).trim();
  if (!Number.isFinite(groupId) || groupId <= 0 || !code) {
    return null;
  }

  return {
    version: 2,
    groupId: Math.floor(groupId),
    code,
    expiresAt: 0
  };
};

export const parseGroupJoinCodeFromPayload = (payload: GroupInviteCodePayload): GroupJoinCodePayload | null => {
  if (payload.version === 2) {
    return {
      version: 2,
      groupId: payload.groupId,
      code: payload.code,
      expiresAt: payload.expiresAt,
      inviter: payload.inviter
    };
  }

  return null;
};

export const encodeStoredGroupTitle = async (title: string, isPrivate: boolean): Promise<string> => {
  const normalizedTitle = normalizeContactName(title);
  if (!normalizedTitle) {
    return '';
  }

  const encryptedPayload = await encryptGroupTitle(normalizedTitle);
  if (!encryptedPayload) {
    throw new Error('Group title encryption is unavailable in this browser.');
  }

  const visibilityFlag = isPrivate ? 'p' : 'u';
  return `${GROUP_TITLE_COMPACT_PREFIX}${visibilityFlag}:${encryptedPayload.iv}:${encryptedPayload.ciphertext}`;
};

export const parseStoredGroupTitle = async (rawTitle: string, groupId?: number): Promise<{ title: string; isPrivate: boolean }> => {
  const normalizedRawTitle = normalizeContactName(rawTitle);
  const fallbackTitle =
    typeof groupId === 'number' && Number.isFinite(groupId) && groupId > 0 ? `Group ${Math.floor(groupId)}` : 'Group';
  const privateFallbackTitle = 'Private group';
  if (!normalizedRawTitle) {
    return {
      title: fallbackTitle,
      isPrivate: false
    };
  }

  if (normalizedRawTitle.startsWith(GROUP_TITLE_COMPACT_PREFIX)) {
    const compactPayload = normalizedRawTitle.slice(GROUP_TITLE_COMPACT_PREFIX.length).trim();
    const firstSeparatorIndex = compactPayload.indexOf(':');
    const secondSeparatorIndex =
      firstSeparatorIndex >= 0 ? compactPayload.indexOf(':', firstSeparatorIndex + 1) : -1;
    const visibilityFlag = firstSeparatorIndex > 0 ? compactPayload.slice(0, firstSeparatorIndex) : '';
    const ivRaw =
      firstSeparatorIndex >= 0 && secondSeparatorIndex > firstSeparatorIndex
        ? compactPayload.slice(firstSeparatorIndex + 1, secondSeparatorIndex)
        : '';
    const ciphertextRaw =
      secondSeparatorIndex >= 0 ? compactPayload.slice(secondSeparatorIndex + 1).trim() : '';
    const isPrivate = visibilityFlag === 'p';
    if (ivRaw && ciphertextRaw) {
      const decryptedTitle = await decryptGroupTitle(ivRaw, ciphertextRaw);
      if (decryptedTitle) {
        return {
          title: decryptedTitle,
          isPrivate
        };
      }
    }
    return {
      title: isPrivate ? privateFallbackTitle : fallbackTitle,
      isPrivate
    };
  }

  if (!normalizedRawTitle.startsWith(GROUP_TITLE_METADATA_PREFIX)) {
    return {
      title: normalizedRawTitle,
      isPrivate: false
    };
  }

  const encodedPayload = normalizedRawTitle.slice(GROUP_TITLE_METADATA_PREFIX.length).trim();
  if (!encodedPayload) {
    return {
      title: fallbackTitle,
      isPrivate: false
    };
  }

  try {
    const decodedPayload = decodeBase64Url(encodedPayload);
    const parsedPayload = JSON.parse(decodedPayload) as {
      version?: unknown;
      title?: unknown;
      private?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
    };
    const isPrivate = Boolean(parsedPayload.private);
    const version = Number(parsedPayload.version);
    const ivRaw = typeof parsedPayload.iv === 'string' ? parsedPayload.iv : '';
    const ciphertextRaw = typeof parsedPayload.ciphertext === 'string' ? parsedPayload.ciphertext : '';
    if (
      version === GROUP_TITLE_ENCRYPTION_VERSION &&
      ivRaw.length > 0 &&
      ciphertextRaw.length > 0
    ) {
      const decryptedTitle = await decryptGroupTitle(ivRaw, ciphertextRaw);
      if (decryptedTitle) {
        return {
          title: decryptedTitle,
          isPrivate
        };
      }
      return {
        title: isPrivate ? privateFallbackTitle : fallbackTitle,
        isPrivate
      };
    }

    const parsedTitle = typeof parsedPayload.title === 'string' ? normalizeContactName(parsedPayload.title) : undefined;
    if (parsedTitle) {
      return {
        title: parsedTitle,
        isPrivate
      };
    }

    return {
      title: isPrivate ? privateFallbackTitle : fallbackTitle,
      isPrivate
    };
  } catch {
    const legacyTitle = normalizeContactName(encodedPayload);
    if (legacyTitle) {
      return {
        title: legacyTitle,
        isPrivate: true
      };
    }

    return {
      title: fallbackTitle,
      isPrivate: false
    };
  }
};

export const formatGroupMembershipEventText = (
  event: 'added' | 'removed' | 'left',
  account?: string
): string => {
  const normalizedAddress = String(account ?? '').trim();
  const memberLabel = isWalletAddress(normalizedAddress) ? shortenAddress(normalizedAddress) : 'A member';
  if (event === 'added') {
    return `[GROUP] ${memberLabel} joined the group.`;
  }
  if (event === 'removed') {
    return `[GROUP] ${memberLabel} was removed from the group.`;
  }
  return `[GROUP] ${memberLabel} left the group.`;
};
