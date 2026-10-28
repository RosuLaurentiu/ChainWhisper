import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  createStateBackupFingerprint,
  isWalletAddress,
  normalizeLastReadAllTs,
  type StateBackupPayload
} from '../../lib/appShared';

type UseStateBackupSyncArgs = Readonly<{
  chainId: number | null;
  lastReadAllTs: number;
  lastReadAllTsRef: MutableRefObject<number>;
  readStateSyncEnabled: boolean;
  setLastReadAllTs: Dispatch<SetStateAction<number>>;
  setUnreadGroupMap: Dispatch<SetStateAction<Record<string, boolean>>>;
  setUnreadMap: Dispatch<SetStateAction<Record<string, boolean>>>;
  unreadGroupMapRef: MutableRefObject<Record<string, boolean>>;
  unreadMapRef: MutableRefObject<Record<string, boolean>>;
  walletAddress: string;
}>;

type LocalReadState = Readonly<{
  lastReadAllTs: number;
  version: 1;
}>;

const LOCAL_READ_STATE_PREFIX = 'chainwhisper-read-state-v1:';

const localReadStateKey = (chainId: number | null, walletAddress: string): string | null => {
  const normalizedAddress = walletAddress.trim().toLowerCase();
  if (!Number.isSafeInteger(chainId) || (chainId ?? 0) <= 0 || !isWalletAddress(normalizedAddress)) return null;
  return `${LOCAL_READ_STATE_PREFIX}${chainId}:${normalizedAddress}`;
};

const parseLocalReadState = (raw: string | null): LocalReadState | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalReadState> | null;
    if (!parsed || parsed.version !== 1) return null;
    return Object.freeze({ version: 1, lastReadAllTs: normalizeLastReadAllTs(parsed.lastReadAllTs) });
  } catch {
    return null;
  }
};

/**
 * Keeps legacy global read state local to the selected browser wallet.
 *
 * This intentionally never encrypts, signs, or submits an on-chain self-message. Direct and Group
 * Chat V2 use their stable per-thread cursor stores; this adapter only preserves the old global
 * timestamp locally and across tabs while historical legacy backup messages remain read-only.
 */
export function useStateBackupSync({
  chainId,
  lastReadAllTs,
  lastReadAllTsRef,
  readStateSyncEnabled,
  setLastReadAllTs,
  setUnreadGroupMap,
  setUnreadMap,
  unreadGroupMapRef,
  unreadMapRef,
  walletAddress
}: UseStateBackupSyncArgs) {
  const lastAppliedStateBackupTsRef = useRef<Record<string, number>>({});
  const lastBackedUpStateFingerprintRef = useRef<Record<string, string>>({});
  const storageKey = localReadStateKey(chainId, walletAddress);

  const applyReadTimestamp = useCallback((candidate: number) => {
    const normalized = normalizeLastReadAllTs(candidate);
    if (normalized <= lastReadAllTsRef.current) return;
    lastReadAllTsRef.current = normalized;
    setLastReadAllTs((previous) => (normalized > previous ? normalized : previous));
    setUnreadMap((previous) => {
      if (Object.keys(previous).length === 0) return previous;
      unreadMapRef.current = {};
      return {};
    });
    setUnreadGroupMap((previous) => {
      if (Object.keys(previous).length === 0) return previous;
      unreadGroupMapRef.current = {};
      return {};
    });
  }, [lastReadAllTsRef, setLastReadAllTs, setUnreadGroupMap, setUnreadMap, unreadGroupMapRef, unreadMapRef]);

  const applyStateBackupPayload = useCallback((walletKey: string, payload: StateBackupPayload) => {
    const normalized = normalizeLastReadAllTs(payload.lastReadAllTs);
    applyReadTimestamp(normalized);
    lastAppliedStateBackupTsRef.current[walletKey] = Math.max(
      lastAppliedStateBackupTsRef.current[walletKey] ?? 0,
      payload.updatedAt
    );
    lastBackedUpStateFingerprintRef.current[walletKey] = createStateBackupFingerprint(normalized);
  }, [applyReadTimestamp]);

  useEffect(() => {
    if (!readStateSyncEnabled || !storageKey) return;
    try {
      const stored = parseLocalReadState(window.localStorage.getItem(storageKey));
      if (stored) applyReadTimestamp(stored.lastReadAllTs);
    } catch {
      // Private browsing and storage policy failures must not block chat.
    }
  }, [applyReadTimestamp, readStateSyncEnabled, storageKey]);

  useEffect(() => {
    if (!readStateSyncEnabled || !storageKey) return;
    const normalized = normalizeLastReadAllTs(lastReadAllTs);
    if (normalized <= 0) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, lastReadAllTs: normalized }));
    } catch {
      // Memory state remains authoritative for this tab.
    }
  }, [lastReadAllTs, readStateSyncEnabled, storageKey]);

  useEffect(() => {
    if (!readStateSyncEnabled || !storageKey) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const stored = parseLocalReadState(event.newValue);
      if (stored) applyReadTimestamp(stored.lastReadAllTs);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [applyReadTimestamp, readStateSyncEnabled, storageKey]);

  return {
    applyStateBackupPayload,
    lastAppliedStateBackupTsRef,
    lastBackedUpStateFingerprintRef
  };
}
