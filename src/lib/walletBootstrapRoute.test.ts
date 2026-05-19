import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY,
  WALLET_BOOTSTRAP_HISTORY_STATE_KEY,
  buildWalletBootstrapDappTargetUrl,
  buildWalletBootstrapPath,
  freezeDirectMetaMaskMobileRoute,
  freezeWalletBootstrapUrlAfterEntry,
  isMetaMaskMobileUserAgent,
  isWalletBootstrapStableUrl,
  normalizeWalletBootstrapTargetPath,
  resolveWalletBootstrapActiveRoute,
  resolveWalletBootstrapTargetPath,
  syncWalletBootstrapRouteFromLocation,
  writeWalletBootstrapActiveRouteState,
  writeWalletBootstrapActiveRoutePath
} from './walletBootstrapRoute';

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

const createLocation = (pathname: string, search = '', hash = '') => ({
  hash,
  origin: 'https://chainwhisper.example',
  pathname,
  search
});

const createHistory = () => {
  const entries: Array<{ state: unknown; url: string | undefined }> = [];
  const history = {
    state: null as unknown,
    entries,
    pushState(state: unknown, _title: string, url?: string | URL | null) {
      this.state = state;
      entries.push({ state, url: url?.toString() });
    },
    replaceState(state: unknown, _title: string, url?: string | URL | null) {
      this.state = state;
      const entry = { state, url: url?.toString() };
      if (entries.length > 0) {
        entries[entries.length - 1] = entry;
      } else {
        entries.push(entry);
      }
    }
  };
  return history;
};

describe('wallet bootstrap route helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a stable wallet bootstrap path for app routes', () => {
    expect(buildWalletBootstrapPath('/trades/l/abc?escrow=direct#secret', 'https://chainwhisper.example')).toBe(
      '/wallet-connect?p=%2Ftrades%2Fl%2Fabc%3Fescrow%3Ddirect%23secret'
    );
    expect(buildWalletBootstrapPath('/otcdesk/mytrades', 'https://chainwhisper.example')).toBe(
      '/wallet-connect?p=%2Fotcdesk%2Fmytrades'
    );
    expect(buildWalletBootstrapPath('/chat', 'https://chainwhisper.example')).toBe('/wallet-connect?p=%2Fchat');
  });

  it('rejects external and non-app bootstrap targets', () => {
    expect(normalizeWalletBootstrapTargetPath('https://evil.example/trades/1', 'https://chainwhisper.example')).toBe('');
    expect(normalizeWalletBootstrapTargetPath('/admin', 'https://chainwhisper.example')).toBe('');
    expect(normalizeWalletBootstrapTargetPath('/wallet-connect?p=/chat', 'https://chainwhisper.example')).toBe('');
  });

  it('resolves the entry route from wallet-connect p', () => {
    const location = createLocation('/wallet-connect', '?p=%2Ftrades%2Fl%2Fabc%3Fescrow%3Ddirect');

    expect(resolveWalletBootstrapTargetPath({ location })).toBe('/trades/l/abc?escrow=direct');
  });

  it('freezes a wallet bootstrap entry into history state and a stable URL', () => {
    const storage = createMemoryStorage();
    const history = createHistory();
    const location = createLocation('/wallet-connect', '?p=%2Ftrades%2Fl%2Fabc%3Fescrow%3Ddirect');

    expect(freezeWalletBootstrapUrlAfterEntry({ history, location, storage })).toBe('/trades/l/abc?escrow=direct');
    expect(history.entries[history.entries.length - 1]?.url).toBe('/wallet-connect');
    expect(history.state).toMatchObject({
      [WALLET_BOOTSTRAP_HISTORY_STATE_KEY]: {
        activePath: '/trades/l/abc?escrow=direct',
        entryPath: '/trades/l/abc?escrow=direct'
      }
    });
    expect(JSON.parse(storage.getItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY) ?? '{}')).toMatchObject({
      activePath: '/trades/l/abc?escrow=direct',
      entryPath: '/trades/l/abc?escrow=direct'
    });
  });

  it('freezes direct MetaMask Mobile app routes into the wallet bootstrap URL', () => {
    const storage = createMemoryStorage();
    const history = createHistory();
    const location = createLocation('/trades/l/abc', '?escrow=direct', '#secret');

    expect(
      freezeDirectMetaMaskMobileRoute({
        history,
        location,
        storage,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile'
      })
    ).toBe('/trades/l/abc?escrow=direct#secret');
    expect(history.entries[history.entries.length - 1]?.url).toBe('/wallet-connect');
    expect(resolveWalletBootstrapActiveRoute({
      historyState: history.state,
      location: createLocation('/wallet-connect'),
      storage
    })).toBe('/trades/l/abc?escrow=direct#secret');
  });

  it('does not freeze direct routes outside MetaMask Mobile', () => {
    const storage = createMemoryStorage();
    const history = createHistory();
    const location = createLocation('/trades/l/abc');

    expect(freezeDirectMetaMaskMobileRoute({ history, location, storage, userAgent: 'Mozilla Desktop' })).toBe('');
    expect(history.entries).toEqual([]);
  });

  it('detects MetaMask Mobile user agents narrowly', () => {
    expect(isMetaMaskMobileUserAgent('Mozilla/5.0 iPhone Mobile MetaMaskMobile')).toBe(true);
    expect(isMetaMaskMobileUserAgent('Mozilla/5.0 iPhone Mobile Safari')).toBe(false);
    expect(isMetaMaskMobileUserAgent('Mozilla/5.0 Desktop MetaMask')).toBe(false);
  });

  it('updates bootstrap route state without changing the visible wallet URL', () => {
    const storage = createMemoryStorage();
    const history = createHistory();
    const location = createLocation('/wallet-connect');

    writeWalletBootstrapActiveRouteState('/trades/l/one', { history, location, storage });
    writeWalletBootstrapActiveRouteState('/trades/l/two?escrow=direct', { history, location, storage });

    expect(history.entries.map((entry) => entry.url)).toEqual(['/wallet-connect', '/wallet-connect']);
    expect(resolveWalletBootstrapActiveRoute({ historyState: history.state, location, storage })).toBe(
      '/trades/l/two?escrow=direct'
    );
  });

  it('restores back-forward route entries from history state before storage', () => {
    const storage = createMemoryStorage();
    const location = createLocation('/wallet-connect');
    writeWalletBootstrapActiveRoutePath('/trades/l/stored', {
      entryPath: '/trades/l/stored',
      location,
      now: 10,
      storage
    });

    const historyState = {
      [WALLET_BOOTSTRAP_HISTORY_STATE_KEY]: {
        activePath: '/chat',
        entryPath: '/chat',
        timestamp: 20
      }
    };

    expect(resolveWalletBootstrapActiveRoute({ historyState, location, storage })).toBe('/chat');
  });

  it('restores a stable wallet bootstrap URL from session storage after reload', () => {
    const storage = createMemoryStorage();
    const location = createLocation('/wallet-connect');
    writeWalletBootstrapActiveRoutePath('/trades/recurring?order=7', {
      entryPath: '/trades/recurring?order=7',
      location,
      now: 10,
      storage
    });

    expect(resolveWalletBootstrapActiveRoute({ location, storage })).toBe('/trades/recurring?order=7');
    expect(isWalletBootstrapStableUrl(location.pathname, location.search)).toBe(true);
  });

  it('restores a stable wallet bootstrap URL from local storage when session state is gone', () => {
    const localStorage = createMemoryStorage();
    vi.stubGlobal('window', {
      localStorage,
      location: createLocation('/wallet-connect'),
      sessionStorage: createMemoryStorage()
    });
    writeWalletBootstrapActiveRoutePath('/trades/recurring?order=8', {
      entryPath: '/trades/recurring?order=8',
      location: createLocation('/wallet-connect'),
      storage: createMemoryStorage()
    });

    expect(resolveWalletBootstrapActiveRoute({
      location: createLocation('/wallet-connect'),
      storage: createMemoryStorage()
    })).toBe('/trades/recurring?order=8');
  });

  it('uses the persisted route when MetaMask Mobile reloads wallet-connect as the origin', () => {
    const localStorage = createMemoryStorage();
    const history = createHistory();
    vi.stubGlobal('window', {
      localStorage,
      location: createLocation('/'),
      sessionStorage: createMemoryStorage()
    });
    writeWalletBootstrapActiveRoutePath('/trades/recurring?order=9', {
      entryPath: '/trades/recurring?order=9',
      location: createLocation('/wallet-connect'),
      storage: createMemoryStorage()
    });

    expect(
      freezeDirectMetaMaskMobileRoute({
        history,
        location: createLocation('/'),
        storage: createMemoryStorage(),
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile MetaMaskMobile'
      })
    ).toBe('/trades/recurring?order=9');
    expect(history.entries[history.entries.length - 1]?.url).toBe('/wallet-connect');
  });

  it('uses the stored active route when still on the same bootstrap entry', () => {
    const storage = createMemoryStorage();
    const location = createLocation('/wallet-connect', '?p=%2Ftrades%2Fl%2Fabc');

    writeWalletBootstrapActiveRoutePath('/chat', {
      entryPath: '/trades/l/abc',
      location,
      now: 10,
      origin: location.origin,
      storage
    });

    expect(resolveWalletBootstrapTargetPath({ location, storage })).toBe('/chat');
  });

  it('treats a different p value as a fresh bootstrap entry', () => {
    const storage = createMemoryStorage();
    const location = createLocation('/wallet-connect', '?p=%2Ftrades%2Fl%2Fabc');
    writeWalletBootstrapActiveRoutePath('/chat', {
      entryPath: '/chat',
      location,
      now: 10,
      origin: location.origin,
      storage
    });

    expect(resolveWalletBootstrapTargetPath({ location, storage })).toBe('/trades/l/abc');
  });

  it('syncs the active route into session storage', () => {
    const storage = createMemoryStorage();
    const location = createLocation('/wallet-connect', '?p=%2Fchat');

    expect(syncWalletBootstrapRouteFromLocation({ location, storage })).toBe('/chat');
    expect(JSON.parse(storage.getItem(WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY) ?? '{}')).toMatchObject({
      activePath: '/chat',
      entryPath: '/chat'
    });
  });

  it('builds documented MetaMask dapp targets through the app bootstrap', () => {
    expect(buildWalletBootstrapDappTargetUrl('https://chainwhisper.example/trades/open/1?escrow=direct#secret')).toBe(
      'chainwhisper.example/wallet-connect?p=%2Ftrades%2Fopen%2F1%3Fescrow%3Ddirect%23secret'
    );
    expect(buildWalletBootstrapDappTargetUrl('https://chainwhisper.example/chat')).toBe(
      'chainwhisper.example/wallet-connect?p=%2Fchat'
    );
  });
});
