import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InjectedWalletOption } from '../../../lib/appShared';
import { COTI_NETWORK } from '../../../lib/appShared';
import { resetMetaMaskConnectMobileForTests } from '../../../lib/metamaskConnectMobile';
import { readPassiveBrowserWalletRestore } from './useWalletOnboarding';

const mocks = vi.hoisted(() => ({
  createEVMClient: vi.fn(),
  clientGetAccount: vi.fn(),
  clientGetChainId: vi.fn(),
  clientGetProvider: vi.fn(),
  providerOn: vi.fn(),
  providerRequest: vi.fn()
}));

vi.mock('@metamask/connect-evm', () => ({
  createEVMClient: mocks.createEVMClient
}));

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
    resetMetaMaskConnectMobileForTests();
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Desktop'
    });
    vi.stubGlobal('window', {
      clearTimeout,
      localStorage: createMemoryStorage(),
      location: {
        origin: 'https://chainwhisper.example',
        hash: '',
        pathname: '/trades',
        search: ''
      },
      setTimeout,
      sessionStorage: storage
    });
    mocks.createEVMClient.mockReset();
    mocks.clientGetAccount.mockReset();
    mocks.clientGetChainId.mockReset();
    mocks.clientGetProvider.mockReset();
    mocks.providerOn.mockReset();
    mocks.providerRequest.mockReset();
  });

  afterEach(() => {
    resetMetaMaskConnectMobileForTests();
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

  it('does not rehydrate fallback AES during passive owner restore', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000002';
    const { option } = createWalletOption([walletAddress]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore?.onboardInfo).toBeNull();
  });

  it('prefers injected MetaMask for mobile bootstrap restore when it is already authorized', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000003';
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
    });
    window.location.pathname = '/wallet-connect';
    const { methods, option } = createWalletOption([walletAddress]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore).toMatchObject({
      address: walletAddress,
      source: 'injected',
      walletId: 'metamask'
    });
    expect(mocks.createEVMClient).not.toHaveBeenCalled();
    expect(methods).toEqual(['eth_accounts', 'eth_chainId']);
  });

  it('does not fall back to Connect EVM when injected MetaMask exists but is not authorized', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
    });
    window.location.pathname = '/wallet-connect';
    const { methods, option } = createWalletOption([]);

    const restore = await readPassiveBrowserWalletRestore(option);

    expect(restore).toBeNull();
    expect(mocks.createEVMClient).not.toHaveBeenCalled();
    expect(methods).toEqual(['eth_accounts']);
  });
});
