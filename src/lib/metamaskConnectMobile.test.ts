import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COTI_NETWORK, type Eip1193Provider, type InjectedWalletOption } from './appShared';

const mocks = vi.hoisted(() => ({
  createEVMClient: vi.fn(),
  providerRequest: vi.fn(),
  providerOn: vi.fn(),
  clientConnect: vi.fn(),
  clientDisconnect: vi.fn(),
  clientGetAccount: vi.fn(),
  clientGetChainId: vi.fn(),
  clientGetProvider: vi.fn(),
  clientSwitchChain: vi.fn()
}));

vi.mock('@metamask/connect-evm', () => ({
  createEVMClient: mocks.createEVMClient
}));

import {
  buildMetaMaskConnectMobileOptions,
  connectMetaMaskMobile,
  getMetaMaskConnectMobileClient,
  METAMASK_CONNECT_MOBILE_WALLET_ID,
  readMetaMaskConnectMobileSession,
  resolveMetaMaskMobileInjectedWalletOption,
  resetMetaMaskConnectMobileForTests,
  shouldUseMetaMaskConnectMobile,
  switchMetaMaskConnectMobileToCoti,
  waitForMetaMaskMobileInjectedWalletOption
} from './metamaskConnectMobile';

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

const createMockClient = (provider: Eip1193Provider) => ({
  accounts: [] as string[],
  connect: mocks.clientConnect,
  disconnect: mocks.clientDisconnect,
  getAccount: mocks.clientGetAccount,
  getChainId: mocks.clientGetChainId,
  getProvider: mocks.clientGetProvider.mockReturnValue(provider),
  status: 'disconnected',
  switchChain: mocks.clientSwitchChain
});

describe('metamaskConnectMobile', () => {
  beforeEach(() => {
    resetMetaMaskConnectMobileForTests();
    const eventTarget = new EventTarget();
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile'
    });
    vi.stubGlobal('window', {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      clearTimeout,
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      localStorage: createMemoryStorage(),
      location: {
        origin: 'https://chainwhisper.example',
        pathname: '/wallet-connect'
      },
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      setTimeout,
      sessionStorage: createMemoryStorage()
    });
    mocks.createEVMClient.mockReset();
    mocks.providerRequest.mockReset();
    mocks.providerOn.mockReset();
    mocks.clientConnect.mockReset();
    mocks.clientDisconnect.mockReset();
    mocks.clientGetAccount.mockReset();
    mocks.clientGetChainId.mockReset();
    mocks.clientGetProvider.mockReset();
    mocks.clientSwitchChain.mockReset();
  });

  afterEach(() => {
    resetMetaMaskConnectMobileForTests();
    vi.unstubAllGlobals();
  });

  it('builds COTI-supported singleton client options', async () => {
    const provider = {
      on: mocks.providerOn,
      request: mocks.providerRequest
    } as unknown as Eip1193Provider;
    mocks.createEVMClient.mockResolvedValue(createMockClient(provider));

    const firstClient = await getMetaMaskConnectMobileClient();
    const secondClient = await getMetaMaskConnectMobileClient();

    expect(firstClient).toBe(secondClient);
    expect(mocks.createEVMClient).toHaveBeenCalledTimes(1);
    const options = mocks.createEVMClient.mock.calls[0]?.[0];
    expect(options.api.supportedNetworks[COTI_NETWORK.chainIdHex]).toBe(COTI_NETWORK.rpcUrl);
    expect(options.dapp).toMatchObject({
      name: 'ChainWhisper',
      url: 'https://chainwhisper.example'
    });
    expect(options.ui).toMatchObject({
      headless: true,
      preferExtension: false,
      showInstallModal: false
    });
  });

  it('uses Connect EVM connect without raw eth_requestAccounts', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000001';
    const provider = {
      on: mocks.providerOn,
      request: mocks.providerRequest
    } as unknown as Eip1193Provider;
    mocks.createEVMClient.mockResolvedValue(createMockClient(provider));
    mocks.clientConnect.mockResolvedValue({
      accounts: [walletAddress],
      chainId: COTI_NETWORK.chainIdHex
    });
    mocks.clientGetAccount.mockReturnValue(walletAddress);

    const session = await connectMetaMaskMobile({ forceAccountPicker: true });

    expect(session).toMatchObject({
      address: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      walletId: METAMASK_CONNECT_MOBILE_WALLET_ID
    });
    expect(mocks.clientConnect).toHaveBeenCalledWith({
      chainIds: [COTI_NETWORK.chainIdHex],
      forceRequest: true
    });
    expect(mocks.providerRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_requestAccounts' })
    );
  });

  it('restores a mobile session with passive eth_accounts', async () => {
    const walletAddress = '0x0000000000000000000000000000000000000002';
    const provider = {
      on: mocks.providerOn,
      request: mocks.providerRequest.mockImplementation(async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') {
          return [walletAddress];
        }
        if (method === 'eth_chainId') {
          return COTI_NETWORK.chainIdHex;
        }
        throw new Error(`Unexpected method ${method}`);
      })
    } as unknown as Eip1193Provider;
    mocks.createEVMClient.mockResolvedValue(createMockClient(provider));

    const session = await readMetaMaskConnectMobileSession();

    expect(session).toMatchObject({
      address: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal
    });
    expect(mocks.providerRequest).toHaveBeenCalledWith({ method: 'eth_accounts' });
    expect(mocks.providerRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_requestAccounts' })
    );
  });

  it('switches the Connect EVM client with COTI chain metadata', async () => {
    const provider = {
      on: mocks.providerOn,
      request: mocks.providerRequest
    } as unknown as Eip1193Provider;
    mocks.createEVMClient.mockResolvedValue(createMockClient(provider));

    await switchMetaMaskConnectMobileToCoti();

    expect(mocks.clientSwitchChain).toHaveBeenCalledWith({
      chainConfiguration: expect.objectContaining({
        chainId: COTI_NETWORK.chainIdHex,
        rpcUrls: [COTI_NETWORK.rpcUrl]
      }),
      chainId: COTI_NETWORK.chainIdHex
    });
  });

  it('does not select Connect EVM when injected MetaMask is available', () => {
    const metamaskOption = {
      id: 'metamask',
      label: 'MetaMask',
      provider: {
        isMetaMask: true,
        request: vi.fn()
      } as unknown as Eip1193Provider
    } satisfies InjectedWalletOption;

    expect(resolveMetaMaskMobileInjectedWalletOption([metamaskOption])).toBe(metamaskOption);
    expect(shouldUseMetaMaskConnectMobile({ walletOption: metamaskOption })).toBe(false);
    expect(shouldUseMetaMaskConnectMobile({ walletOption: metamaskOption, userAgent: 'Mozilla Desktop' })).toBe(false);
  });

  it('selects Connect EVM only for mobile MetaMask bootstrap when no injected provider exists', () => {
    const cipherOption = {
      id: 'ciphertrade',
      label: 'CipherTrade',
      provider: {
        request: vi.fn()
      } as unknown as Eip1193Provider
    } satisfies InjectedWalletOption;

    expect(shouldUseMetaMaskConnectMobile({ walletId: 'metamask' })).toBe(true);
    expect(shouldUseMetaMaskConnectMobile({ walletOption: cipherOption })).toBe(false);
  });

  it('waits for an injected MetaMask provider before falling back to Connect EVM', async () => {
    const provider = {
      isMetaMask: true,
      request: vi.fn()
    } as unknown as Eip1193Provider;
    const waitPromise = waitForMetaMaskMobileInjectedWalletOption({ pollMs: 10, timeoutMs: 200 });
    const event = new Event('eip6963:announceProvider') as CustomEvent;
    Object.defineProperty(event, 'detail', {
      value: {
        info: {
          name: 'MetaMask',
          rdns: 'io.metamask'
        },
        provider
      }
    });

    window.dispatchEvent(event);

    await expect(waitPromise).resolves.toMatchObject({
      id: 'metamask',
      label: 'MetaMask',
      provider
    });
    expect(mocks.createEVMClient).not.toHaveBeenCalled();
  });

  it('exposes the COTI hex chain in generated options', () => {
    const options = buildMetaMaskConnectMobileOptions();

    expect(options.api.supportedNetworks).toMatchObject({
      [COTI_NETWORK.chainIdHex]: COTI_NETWORK.rpcUrl
    });
  });
});
