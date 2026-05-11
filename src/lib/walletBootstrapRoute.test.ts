import { describe, expect, it } from 'vitest';
import {
  WALLET_BOOTSTRAP_ACTIVE_ROUTE_STORAGE_KEY,
  buildWalletBootstrapDappTargetUrl,
  buildWalletBootstrapPath,
  normalizeWalletBootstrapTargetPath,
  resolveWalletBootstrapTargetPath,
  syncWalletBootstrapRouteFromLocation,
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

describe('wallet bootstrap route helpers', () => {
  it('builds a stable wallet bootstrap path for app routes', () => {
    expect(buildWalletBootstrapPath('/trades/l/abc?escrow=direct#secret', 'https://chainwhisper.example')).toBe(
      '/wallet-connect?p=%2Ftrades%2Fl%2Fabc%3Fescrow%3Ddirect%23secret'
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
