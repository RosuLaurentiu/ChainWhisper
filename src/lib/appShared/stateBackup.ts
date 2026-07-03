import { unzlibSync, zlibSync } from 'fflate';
import {
  base64ToBytes,
  bytesToBase64,
  TEXT_DECODER,
  TEXT_ENCODER
} from '../byteEncoding';
import {
  isShortAddress,
  isWalletAddress,
  READ_CURSOR_PREFIX,
  STATE_BACKUP_COMPRESSED_PREFIX,
  STATE_BACKUP_PREFIX,
  STATE_BACKUP_VERSION,
  toSafeNumber,
  type BackupReadStateEntry,
  type ReadCursorPayload,
  type StateBackupPayload
} from './core';

export const normalizeBackupAddressToken = (value: unknown): string | null => {
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) {
    return null;
  }

  if (isWalletAddress(token) || isShortAddress(token)) {
    return token;
  }

  return null;
};

export const normalizeReadStateEntries = (value: unknown): BackupReadStateEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const maxTsByAddress = new Map<string, number>();
  for (const item of value) {
    const entry =
      Array.isArray(item) && item.length >= 2
        ? { address: item[0], lastReadTs: item[1] }
        : item && typeof item === 'object'
          ? {
              address: (item as { address?: unknown; p?: unknown }).address ?? (item as { p?: unknown }).p,
              lastReadTs: (item as { lastReadTs?: unknown; t?: unknown }).lastReadTs ?? (item as { t?: unknown }).t
            }
          : null;
    if (!entry) {
      continue;
    }

    const address = normalizeBackupAddressToken(entry.address);
    const lastReadTs = toSafeNumber(entry.lastReadTs);
    if (!address || !Number.isFinite(lastReadTs) || lastReadTs <= 0) {
      continue;
    }

    const existing = maxTsByAddress.get(address) ?? 0;
    if (lastReadTs > existing) {
      maxTsByAddress.set(address, lastReadTs);
    }
  }

  return Array.from(maxTsByAddress.entries())
    .map(([address, lastReadTs]) => ({ address, lastReadTs }))
    .sort((left, right) => left.address.localeCompare(right.address));
};

export const normalizeLastReadAllTs = (value: unknown): number => {
  const normalized = Math.floor(toSafeNumber(value));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }
  return normalized;
};

export const deriveLegacyLastReadAllTs = (entries: BackupReadStateEntry[]): number => {
  let latest = 0;
  for (const entry of entries) {
    if (entry.lastReadTs > latest) {
      latest = entry.lastReadTs;
    }
  }
  return latest;
};

export const buildStateBackupPayload = (lastReadAllTs = 0): StateBackupPayload => {
  return {
    version: STATE_BACKUP_VERSION,
    updatedAt: Math.floor(Date.now() / 1000),
    lastReadAllTs: normalizeLastReadAllTs(lastReadAllTs) || undefined
  };
};

export const buildStateBackupText = (payload: StateBackupPayload): string => {
  // Compact format: {v, u, g} to minimize on-chain size.
  const normalizedLastReadAllTs = normalizeLastReadAllTs(payload.lastReadAllTs);
  const compactBase = {
    v: payload.version,
    u: payload.updatedAt
  };
  const compact =
    normalizedLastReadAllTs > 0
      ? { ...compactBase, g: normalizedLastReadAllTs }
      : compactBase;

  const rawJson = JSON.stringify(compact);
  try {
    const compressedBytes = zlibSync(TEXT_ENCODER.encode(rawJson), { level: 9 });
    const encodedCompressed = bytesToBase64(compressedBytes);
    const compressedPayload = `${STATE_BACKUP_COMPRESSED_PREFIX}${encodedCompressed}`;
    if (compressedPayload.length < rawJson.length) {
      return `${STATE_BACKUP_PREFIX}${compressedPayload}`;
    }
  } catch {
  }

  return `${STATE_BACKUP_PREFIX}${rawJson}`;
};

export const parseStateBackupText = (text: string): StateBackupPayload | null => {
  if (!text.startsWith(STATE_BACKUP_PREFIX)) {
    return null;
  }

  try {
    let rawPayload = text.slice(STATE_BACKUP_PREFIX.length).trim();
    if (!rawPayload) {
      return null;
    }

    if (rawPayload.startsWith(STATE_BACKUP_COMPRESSED_PREFIX)) {
      const encodedCompressed = rawPayload.slice(STATE_BACKUP_COMPRESSED_PREFIX.length);
      if (!encodedCompressed) {
        return null;
      }

      const compressedBytes = base64ToBytes(encodedCompressed);
      const inflatedBytes = unzlibSync(compressedBytes);
      rawPayload = TEXT_DECODER.decode(inflatedBytes).trim();
      if (!rawPayload) {
        return null;
      }
    }

    const parsed = JSON.parse(rawPayload) as any;

    // Current compact format: {v, u, g}
    if (parsed && typeof parsed === 'object' && parsed.v === STATE_BACKUP_VERSION) {
      const updatedAt = typeof parsed.u === 'number' ? parsed.u : 0;
      const legacyReadState = normalizeReadStateEntries(parsed.r);
      const explicitReadAllTs = normalizeLastReadAllTs(parsed.g);
      const fallbackReadAllTs = deriveLegacyLastReadAllTs(legacyReadState);
      return {
        version: STATE_BACKUP_VERSION,
        updatedAt,
        lastReadAllTs: explicitReadAllTs || fallbackReadAllTs || undefined
      };
    }

    // Fallback to legacy full-object format.
    if (parsed && typeof parsed === 'object' && parsed.version === STATE_BACKUP_VERSION) {
      const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
      const legacyReadState = normalizeReadStateEntries((parsed as any).readState ?? (parsed as any).r);
      const explicitReadAllTs = normalizeLastReadAllTs((parsed as any).lastReadAllTs ?? (parsed as any).g);
      const fallbackReadAllTs = deriveLegacyLastReadAllTs(legacyReadState);
      return {
        version: STATE_BACKUP_VERSION,
        updatedAt,
        lastReadAllTs: explicitReadAllTs || fallbackReadAllTs || undefined
      };
    }

    return null;
  } catch {
    return null;
  }
};

export const parseReadCursorText = (text: string): ReadCursorPayload | null => {
  if (!text.startsWith(READ_CURSOR_PREFIX)) {
    return null;
  }

  try {
    const rawPayload = text.slice(READ_CURSOR_PREFIX.length).trim();
    if (!rawPayload) {
      return null;
    }

    const parsed = JSON.parse(rawPayload) as { p?: unknown; t?: unknown; b?: unknown };
    const peer = typeof parsed.p === 'string' ? parsed.p.trim().toLowerCase() : '';
    if (!isWalletAddress(peer)) {
      return null;
    }

    const lastReadTs = toSafeNumber(parsed.t);
    const lastReadBlock = toSafeNumber(parsed.b);
    if (!lastReadTs || !Number.isFinite(lastReadTs)) {
      return null;
    }

    return {
      peer,
      lastReadTs,
      lastReadBlock: lastReadBlock > 0 ? lastReadBlock : undefined
    };
  } catch {
    return null;
  }
};

export const createStateBackupFingerprint = (lastReadAllTs = 0): string =>
  JSON.stringify({
    g: normalizeLastReadAllTs(lastReadAllTs)
  });
