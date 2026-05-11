import type { Hex, MetamaskConnectEVM } from '@metamask/connect-evm';
import {
  COTI_NETWORK,
  getInjectedWalletOptions,
  normalizeChainId,
  rememberInjectedWalletProvider,
  type Eip1193Provider,
  type InjectedWalletOption
} from './appShared';
import {
  isMobileWalletDiagnosticsEnabled,
  logMobileWalletDiagnostic,
  maskWalletForDiagnostics
} from './mobileWalletDiagnostics';
import { isWalletBootstrapRoute } from './walletBootstrapRoute';
import { isMobileBrowserUserAgent, isPreferredMetaMaskWalletOption } from './walletOptions';

export const METAMASK_CONNECT_MOBILE_WALLET_ID = 'metamask-connect-mobile';
export const METAMASK_CONNECT_MOBILE_WALLET_LABEL = 'MetaMask Mobile';

export type MetaMaskConnectMobileSession = {
  address: string;
  chainId: number | null;
  provider: Eip1193Provider;
  source: 'connect-evm';
  walletId: typeof METAMASK_CONNECT_MOBILE_WALLET_ID;
  walletLabel: typeof METAMASK_CONNECT_MOBILE_WALLET_LABEL;
};

export type MetaMaskMobileProviderSource = 'connect-evm' | 'injected-metamask';

type Eip6963ProviderInfo = {
  name?: string;
  rdns?: string;
  uuid?: string;
};

type MetaMaskConnectProvider = Eip1193Provider & {
  __chainWhisperMetaMaskConnectMobile?: true;
  __chainWhisperMetaMaskRequestWrapped?: true;
  isMetaMask?: boolean;
};

type MetaMaskConnectMobileContextInput = {
  force?: boolean;
  provider?: Eip1193Provider | null;
  userAgent?: string;
  walletId?: string | null;
  walletLabel?: string | null;
  walletOption?: InjectedWalletOption | null;
};

type MetaMaskConnectMobileClientOptions = Parameters<
  typeof import('@metamask/connect-evm').createEVMClient
>[0];

const COTI_CHAIN_ID_HEX = COTI_NETWORK.chainIdHex as Hex;
const SUPPORTED_NETWORKS: Record<Hex, string> = {
  [COTI_CHAIN_ID_HEX]: COTI_NETWORK.rpcUrl
};

let clientPromise: Promise<MetamaskConnectEVM> | null = null;
let clientInstance: MetamaskConnectEVM | null = null;
let providerListenerAttached = false;

const getWindowOrigin = (): string => {
  if (typeof window === 'undefined') {
    return 'https://chainwhisper.chat';
  }

  return window.location.origin || 'https://chainwhisper.chat';
};

const getDappIconUrl = (): string | undefined => {
  const origin = getWindowOrigin();
  return origin.startsWith('http://') || origin.startsWith('https://') ? `${origin}/favicon.svg` : undefined;
};

const isMetaMaskWalletIdentity = (
  walletId?: string | null,
  walletLabel?: string | null,
  provider?: Eip1193Provider | null
): boolean => {
  if (walletId === METAMASK_CONNECT_MOBILE_WALLET_ID || walletId === 'metamask') {
    return true;
  }

  const providerFlags = provider as (Eip1193Provider & { isBraveWallet?: boolean; isMetaMask?: boolean }) | null | undefined;
  if (providerFlags?.isMetaMask && !providerFlags.isBraveWallet) {
    return true;
  }

  return `${walletId ?? ''} ${walletLabel ?? ''}`.toLowerCase().includes('metamask');
};

const normalizeAccounts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

const META_MASK_MOBILE_REQUEST_METHODS = new Set([
  'eth_accounts',
  'eth_requestAccounts',
  'personal_sign',
  'eth_sendTransaction',
  'wallet_addEthereumChain',
  'wallet_switchEthereumChain'
]);

export const logMetaMaskMobileProviderSelection = (
  source: MetaMaskMobileProviderSource,
  detail: Record<string, unknown> = {}
): void => {
  logMobileWalletDiagnostic('metamask-mobile-provider-selected', {
    source,
    ...detail
  });
};

export const logMetaMaskMobileRequestMethod = (
  method: string,
  source: MetaMaskMobileProviderSource,
  detail: Record<string, unknown> = {}
): void => {
  if (!META_MASK_MOBILE_REQUEST_METHODS.has(method)) {
    return;
  }

  logMobileWalletDiagnostic('metamask-mobile-provider-request', {
    method,
    source,
    ...detail
  });
};

export const resolveMetaMaskMobileInjectedWalletOption = (
  options?: readonly InjectedWalletOption[] | null
): InjectedWalletOption | null => {
  const candidates = options && options.length > 0 ? [...options] : getInjectedWalletOptions();
  return candidates.find(isPreferredMetaMaskWalletOption) ?? null;
};

export const waitForMetaMaskMobileInjectedWalletOption = async ({
  initialOptions,
  pollMs = 75,
  timeoutMs = 900
}: {
  initialOptions?: readonly InjectedWalletOption[] | null;
  pollMs?: number;
  timeoutMs?: number;
} = {}): Promise<InjectedWalletOption | null> => {
  const immediate = resolveMetaMaskMobileInjectedWalletOption(initialOptions);
  if (immediate || typeof window === 'undefined') {
    return immediate;
  }

  return new Promise((resolve) => {
    let completed = false;
    let pollTimer: number | null = null;
    let timeoutTimer: number | null = null;

    const cleanup = () => {
      window.removeEventListener('ethereum#initialized', check);
      window.removeEventListener('eip6963:announceProvider', handleProviderAnnouncement);
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
      if (timeoutTimer !== null) {
        window.clearTimeout(timeoutTimer);
      }
    };

    const finish = (option: InjectedWalletOption | null) => {
      if (completed) {
        return;
      }
      completed = true;
      cleanup();
      resolve(option);
    };

    function check() {
      const option = resolveMetaMaskMobileInjectedWalletOption();
      if (option) {
        finish(option);
        return;
      }
      pollTimer = window.setTimeout(check, pollMs);
    }

    function handleProviderAnnouncement(event: Event) {
      const detail = (event as CustomEvent<{ provider?: Eip1193Provider; info?: Eip6963ProviderInfo }>).detail;
      rememberInjectedWalletProvider(detail?.provider, detail?.info);
      check();
    }

    window.addEventListener('ethereum#initialized', check);
    window.addEventListener('eip6963:announceProvider', handleProviderAnnouncement);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    timeoutTimer = window.setTimeout(() => finish(resolveMetaMaskMobileInjectedWalletOption()), timeoutMs);
    check();
  });
};

const getProviderChainId = async (
  client: MetamaskConnectEVM,
  provider: Eip1193Provider
): Promise<number | null> => {
  const clientChainId = client.getChainId();
  if (clientChainId) {
    return normalizeChainId(clientChainId);
  }

  try {
    const providerChainId = (await provider.request({ method: 'eth_chainId' })) as string | number;
    return normalizeChainId(providerChainId);
  } catch {
    return null;
  }
};

const attachProviderDiagnostics = (provider: Eip1193Provider): void => {
  if (providerListenerAttached || !provider.on) {
    return;
  }

  providerListenerAttached = true;
  provider.on('wallet_sessionChanged', (session: unknown) => {
    logMobileWalletDiagnostic('metamask-connect-wallet-session-changed', {
      hasSession: Boolean(session)
    });
  });
  provider.on('accountsChanged', (accounts: unknown) => {
    const normalizedAccounts = normalizeAccounts(accounts);
    logMobileWalletDiagnostic('metamask-connect-accounts-changed', {
      accountsCount: normalizedAccounts.length,
      selected: maskWalletForDiagnostics(normalizedAccounts[0])
    });
  });
  provider.on('chainChanged', (chainId: unknown) => {
    logMobileWalletDiagnostic('metamask-connect-chain-changed', {
      chainId: typeof chainId === 'string' || typeof chainId === 'number' ? chainId : '[unknown]'
    });
  });
  provider.on('disconnect', () => {
    logMobileWalletDiagnostic('metamask-connect-disconnect');
  });
};

const markProvider = (provider: Eip1193Provider): Eip1193Provider => {
  const connectProvider = provider as MetaMaskConnectProvider;
  try {
    connectProvider.__chainWhisperMetaMaskConnectMobile = true;
    connectProvider.isMetaMask = true;
    if (!connectProvider.__chainWhisperMetaMaskRequestWrapped) {
      const originalRequest = connectProvider.request.bind(connectProvider);
      connectProvider.request = async (requestArgs) => {
        logMetaMaskMobileRequestMethod(requestArgs.method, 'connect-evm');
        return originalRequest(requestArgs);
      };
      connectProvider.__chainWhisperMetaMaskRequestWrapped = true;
    }
  } catch {
    // The SDK provider is normally extensible; if that changes, the provider is still usable as EIP-1193.
  }
  attachProviderDiagnostics(connectProvider);
  return connectProvider;
};

export const isMetaMaskConnectMobileProvider = (
  provider: Eip1193Provider | null | undefined
): boolean => Boolean((provider as MetaMaskConnectProvider | null | undefined)?.__chainWhisperMetaMaskConnectMobile);

export const isMetaMaskConnectMobileWalletId = (walletId: string | null | undefined): boolean =>
  walletId === METAMASK_CONNECT_MOBILE_WALLET_ID;

export const shouldUseMetaMaskConnectMobile = ({
  force = false,
  provider,
  userAgent,
  walletId,
  walletLabel,
  walletOption
}: MetaMaskConnectMobileContextInput = {}): boolean => {
  if (!isMobileBrowserUserAgent(userAgent)) {
    return false;
  }

  const selectedProvider = provider ?? walletOption?.provider ?? null;
  const selectedWalletId = walletId ?? walletOption?.id ?? '';
  const selectedWalletLabel = walletLabel ?? walletOption?.label ?? '';
  const walletIsMetaMask = walletOption
    ? isPreferredMetaMaskWalletOption(walletOption)
    : !selectedWalletId && !selectedWalletLabel && !selectedProvider
      ? true
    : isMetaMaskWalletIdentity(selectedWalletId, selectedWalletLabel, selectedProvider);

  if (!walletIsMetaMask) {
    return false;
  }

  return force || (typeof window !== 'undefined' && isWalletBootstrapRoute(window.location.pathname));
};

export const buildMetaMaskConnectMobileOptions = (): MetaMaskConnectMobileClientOptions => ({
  analytics: {
    integrationType: 'chainwhisper-metamask-mobile'
  },
  api: {
    supportedNetworks: SUPPORTED_NETWORKS
  },
  dapp: {
    iconUrl: getDappIconUrl(),
    name: 'ChainWhisper',
    url: getWindowOrigin()
  },
  debug: isMobileWalletDiagnosticsEnabled(),
  ui: {
    headless: true,
    preferExtension: false,
    showInstallModal: false
  },
  eventHandlers: {
    accountsChanged: (accounts) => {
      logMobileWalletDiagnostic('metamask-connect-event-accounts-changed', {
        accountsCount: accounts.length,
        selected: maskWalletForDiagnostics(accounts[0])
      });
    },
    chainChanged: (chainId) => {
      logMobileWalletDiagnostic('metamask-connect-event-chain-changed', { chainId });
    },
    connect: ({ accounts, chainId }) => {
      logMobileWalletDiagnostic('metamask-connect-event-connect', {
        accountsCount: accounts.length,
        chainId,
        selected: maskWalletForDiagnostics(accounts[0])
      });
    },
    disconnect: () => {
      logMobileWalletDiagnostic('metamask-connect-event-disconnect');
    },
    displayUri: () => {
      logMobileWalletDiagnostic('metamask-connect-event-display-uri');
    }
  }
});

export const getMetaMaskConnectMobileClient = async (): Promise<MetamaskConnectEVM> => {
  if (clientInstance) {
    return clientInstance;
  }

  if (!clientPromise) {
    logMobileWalletDiagnostic('metamask-connect-init-start', {
      chainId: COTI_NETWORK.chainIdHex
    });
    clientPromise = import('@metamask/connect-evm')
      .then(({ createEVMClient }) => createEVMClient(buildMetaMaskConnectMobileOptions()))
      .then((client) => {
        clientInstance = client;
        markProvider(client.getProvider() as unknown as Eip1193Provider);
        logMobileWalletDiagnostic('metamask-connect-init-ready', {
          status: client.status
        });
        return client;
      })
      .catch((error) => {
        clientPromise = null;
        logMobileWalletDiagnostic('metamask-connect-init-error', {
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      });
  }

  return clientPromise;
};

export const readMetaMaskConnectMobileSession = async (): Promise<MetaMaskConnectMobileSession | null> => {
  const client = await getMetaMaskConnectMobileClient();
  const provider = markProvider(client.getProvider() as unknown as Eip1193Provider);
  const clientAccounts = normalizeAccounts(client.accounts);
  const providerAccounts =
    clientAccounts.length > 0
      ? clientAccounts
      : normalizeAccounts(await provider.request({ method: 'eth_accounts' }).catch(() => []));
  const address = client.getAccount() ?? providerAccounts[0] ?? '';
  const chainId = await getProviderChainId(client, provider);

  logMobileWalletDiagnostic('metamask-connect-session-restore', {
    accountsCount: providerAccounts.length,
    chainId,
    selected: maskWalletForDiagnostics(address),
    status: client.status
  });

  if (!address) {
    return null;
  }

  return {
    address,
    chainId,
    provider,
    source: 'connect-evm',
    walletId: METAMASK_CONNECT_MOBILE_WALLET_ID,
    walletLabel: METAMASK_CONNECT_MOBILE_WALLET_LABEL
  };
};

export const connectMetaMaskMobile = async (
  options: { forceAccountPicker?: boolean } = {}
): Promise<MetaMaskConnectMobileSession> => {
  const client = await getMetaMaskConnectMobileClient();
  logMobileWalletDiagnostic('metamask-connect-connect-start', {
    forceAccountPicker: Boolean(options.forceAccountPicker)
  });
  const result = await client.connect({
    chainIds: [COTI_CHAIN_ID_HEX],
    forceRequest: options.forceAccountPicker
  });
  const provider = markProvider(client.getProvider() as unknown as Eip1193Provider);
  const accounts = normalizeAccounts(result.accounts.length > 0 ? result.accounts : client.accounts);
  const address = client.getAccount() ?? accounts[0] ?? '';
  if (!address) {
    throw new Error('No MetaMask Mobile account selected.');
  }

  logMobileWalletDiagnostic('metamask-connect-connect-ready', {
    accountsCount: accounts.length,
    chainId: result.chainId,
    selected: maskWalletForDiagnostics(address)
  });

  return {
    address,
    chainId: normalizeChainId(result.chainId),
    provider,
    source: 'connect-evm',
    walletId: METAMASK_CONNECT_MOBILE_WALLET_ID,
    walletLabel: METAMASK_CONNECT_MOBILE_WALLET_LABEL
  };
};

export const switchMetaMaskConnectMobileToCoti = async (): Promise<void> => {
  const client = await getMetaMaskConnectMobileClient();
  await client.switchChain({
    chainConfiguration: {
      blockExplorerUrls: [COTI_NETWORK.blockExplorerUrl],
      chainId: COTI_NETWORK.chainIdHex,
      chainName: COTI_NETWORK.chainName,
      nativeCurrency: COTI_NETWORK.nativeCurrency,
      rpcUrls: [COTI_NETWORK.rpcUrl]
    },
    chainId: COTI_CHAIN_ID_HEX
  });
};

export const disconnectMetaMaskConnectMobile = async (): Promise<void> => {
  if (!clientInstance && !clientPromise) {
    return;
  }

  const client = await getMetaMaskConnectMobileClient();
  await client.disconnect();
};

export const resetMetaMaskConnectMobileForTests = (): void => {
  clientPromise = null;
  clientInstance = null;
  providerListenerAttached = false;
};
