import { isWalletAddress } from './appShared';

export type WalletPreferenceKind = 'app' | 'browser';

export type WalletPreference = {
  version: 1;
  kind: WalletPreferenceKind;
  browserWalletId?: string;
};

type GroupRemovalNoticeMarkerMap = Record<string, Record<string, string>>;

type GroupRemovalNoticeMarkerArgs = {
  groupRemovalNoticeMarkersLoadedRef: { current: boolean };
  groupRemovalNoticeMarkersRef: { current: GroupRemovalNoticeMarkerMap };
  storageKey: string;
};

export const WALLET_PREFERENCE_STORAGE_KEY = 'chainwhisper-wallet-preference:v1';
export const WALLET_PREFERENCE_CHANGED_EVENT = 'chainwhisper:wallet-preference-changed';

const normalizeBrowserWalletId = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('0x')) {
    return '';
  }

  return /^[a-z0-9-]{1,64}$/.test(normalized) ? normalized : '';
};

export const normalizeWalletPreference = (value: unknown): WalletPreference | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as { version?: unknown; kind?: unknown; browserWalletId?: unknown };
  if (record.version !== 1) {
    return null;
  }

  if (record.kind === 'app') {
    return { version: 1, kind: 'app' };
  }

  if (record.kind === 'browser') {
    const browserWalletId = normalizeBrowserWalletId(record.browserWalletId);
    return {
      version: 1,
      kind: 'browser',
      ...(browserWalletId ? { browserWalletId } : {})
    };
  }

  return null;
};

export const readWalletPreference = (): WalletPreference | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WALLET_PREFERENCE_STORAGE_KEY);
    return raw ? normalizeWalletPreference(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

export const getPreferredBrowserWalletId = (preference = readWalletPreference()): string =>
  preference?.kind === 'browser' ? preference.browserWalletId ?? '' : '';

export const saveWalletPreference = (preference: Omit<WalletPreference, 'version'>): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeWalletPreference({ version: 1, ...preference });
  if (!normalized) {
    return;
  }

  try {
    window.localStorage.setItem(WALLET_PREFERENCE_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(WALLET_PREFERENCE_CHANGED_EVENT, { detail: normalized }));
  } catch {
  }
};

export const subscribeWalletPreferenceChanges = (listener: (preference: WalletPreference | null) => void): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handlePreferenceChange = () => listener(readWalletPreference());
  const handleStorage = (event: StorageEvent) => {
    if (event.key === WALLET_PREFERENCE_STORAGE_KEY) {
      handlePreferenceChange();
    }
  };

  window.addEventListener(WALLET_PREFERENCE_CHANGED_EVENT, handlePreferenceChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(WALLET_PREFERENCE_CHANGED_EVENT, handlePreferenceChange);
    window.removeEventListener('storage', handleStorage);
  };
};

export const ensureGroupRemovalNoticeMarkersLoaded = ({
  groupRemovalNoticeMarkersLoadedRef,
  groupRemovalNoticeMarkersRef,
  storageKey
}: GroupRemovalNoticeMarkerArgs): void => {
  if (groupRemovalNoticeMarkersLoadedRef.current) {
    return;
  }
  groupRemovalNoticeMarkersLoadedRef.current = true;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return;
    }

    const normalized: GroupRemovalNoticeMarkerMap = {};
    for (const [walletKey, markerMap] of Object.entries(parsed)) {
      if (!isWalletAddress(walletKey) || !markerMap || typeof markerMap !== 'object' || Array.isArray(markerMap)) {
        continue;
      }
      const nextMarkerMap: Record<string, string> = {};
      for (const [groupId, marker] of Object.entries(markerMap)) {
        if (!/^\d+$/.test(groupId) || typeof marker !== 'string' || marker.length === 0) {
          continue;
        }
        nextMarkerMap[groupId] = marker;
      }
      if (Object.keys(nextMarkerMap).length > 0) {
        normalized[walletKey] = nextMarkerMap;
      }
    }
    groupRemovalNoticeMarkersRef.current = normalized;
  } catch {
  }
};

export const getStoredGroupRemovalNoticeMarker = (
  walletKey: string,
  groupId: number,
  args: GroupRemovalNoticeMarkerArgs
): string | undefined => {
  ensureGroupRemovalNoticeMarkersLoaded(args);
  return args.groupRemovalNoticeMarkersRef.current[walletKey]?.[String(groupId)];
};

export const setStoredGroupRemovalNoticeMarker = (
  walletKey: string,
  groupId: number,
  marker: string,
  args: GroupRemovalNoticeMarkerArgs
): void => {
  ensureGroupRemovalNoticeMarkersLoaded(args);
  const walletMarkers =
    args.groupRemovalNoticeMarkersRef.current[walletKey] ??
    (args.groupRemovalNoticeMarkersRef.current[walletKey] = {});
  walletMarkers[String(groupId)] = marker;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(args.storageKey, JSON.stringify(args.groupRemovalNoticeMarkersRef.current));
  } catch {
  }
};
