export type WalletPreferenceKind = 'browser';

export type WalletPreference = {
  version: 1;
  kind: WalletPreferenceKind;
  browserWalletId?: string;
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
