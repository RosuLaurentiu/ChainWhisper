import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InjectedWalletOption } from '../lib/appShared';
import { COTI_NETWORK } from '../lib/appShared';
import { storeFallbackAesSessionOnboardInfo } from '../lib/cotiAesUnlock';
import { readPassiveBrowserWalletRestore } from './useWalletOnboarding';

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

const createWalletOption = (accounts: string[] = [], chainId = COTI_NETWORK.chainIdHex) => {
  const methods: string[] = [];
  const provider = {
    isMetaMask: true,
    request: vi.fn(async ({ method }: { method: string }) => {
      methods.push(method);
      if (method === 'eth_accounts') {
        return accounts;
      }
      if (method === 'eth_chainId') {
        return chainId;
      }
      throw new Error(`Unexpected wallet prompt method: ${method}`);
    })
  };
  const option: InjectedWalletOption = {
    id: 'metamask',
    label: 'MetaMask',
    provider
  };
  return { methods, option, provider };
};

describe('readPassiveBrowserWalletRestore', () => {
  beforeEach(() => {
    const storage = createMemoryStorage();
    vi.stubGlobal('window', {
      localStorage: createMemoryStorage(),
      location: {
        hash: '',
        pathname: '/trades',
        search: ''
      },
      sessionStorage: storage
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores an authorized browser wallet from eth_accounts without prompting', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000001';
    const { methods, option } = createWalletOption([walletAddress]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore).toMatchObject({
      address: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      walletId: 'metamask',
      walletLabel: 'MetaMask'
    });
    expect(methods).toEqual(['eth_accounts', 'eth_chainId']);
  });

  it('leaves an unauthorized browser wallet disconnected without prompting', async () => {
    const { methods, option } = createWalletOption([]);

    await expect(readPassiveBrowserWalletRestore(option)).resolves.toBeNull();

    expect(methods).toEqual(['eth_accounts']);
  });

  it('rehydrates fallback AES for the same wallet/provider session', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000002';
    const { option, provider } = createWalletOption([walletAddress]);
    storeFallbackAesSessionOnboardInfo(walletAddress, provider, { aesKey: 'session-aes' } as never);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore?.onboardInfo).toMatchObject({
      aesKey: 'session-aes'
    });
  });
});
