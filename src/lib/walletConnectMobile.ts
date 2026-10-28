import {
  COTI_NETWORK,
  normalizeChainId,
  type Eip1193Provider
} from './appShared';
import chainWhisperFaviconUrl from '../assets/favicon.png';
import type { ChainWhisperCotiNetwork } from './chainWhisperNetworks';

export const CIPHERTRADE_WALLETCONNECT_WALLET_ID = 'ciphertrade-walletconnect';
export const CIPHERTRADE_WALLETCONNECT_WALLET_LABEL = 'CipherTrade Mobile';

type WalletConnectPeerMetadata = Readonly<{
  description?: string;
  name?: string;
  url?: string;
}>;

type WalletConnectProvider = Eip1193Provider & {
  __chainWhisperCipherTradeWalletConnect?: true;
  accounts?: string[];
  chainId?: number | string;
  connect: (options?: { chains?: number[]; rpcMap?: Record<number, string> }) => Promise<unknown>;
  disconnect: () => Promise<void>;
  isCipherTrade?: boolean;
  session?: {
    peer?: { metadata?: WalletConnectPeerMetadata };
  } | null;
};

type WalletConnectProviderModule = typeof import('@walletconnect/ethereum-provider');

let providerPromise: Promise<WalletConnectProvider> | null = null;
let providerInstance: WalletConnectProvider | null = null;

const normalizeIdentity = (...values: Array<string | undefined>): string =>
  values.join(' ').toLowerCase().replace(/[^a-z0-9]/g, '');

export const isCipherTradeWalletConnectPeer = (
  metadata: WalletConnectPeerMetadata | null | undefined
): boolean => {
  const identity = normalizeIdentity(metadata?.name, metadata?.description, metadata?.url);
  return identity.includes('ciphertrade') || identity.includes('cyphertrade');
};

export const isUsableWalletConnectProjectId = (value: string | null | undefined): boolean => {
  const projectId = value?.trim() ?? '';
  return Boolean(
    projectId &&
    projectId !== 'your_walletconnect_project_id_here' &&
    /^[a-zA-Z0-9_-]{16,128}$/.test(projectId)
  );
};

export const getWalletConnectProjectId = (): string => {
  const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? '';
  if (!isUsableWalletConnectProjectId(projectId)) {
    throw new Error('CipherTrade WalletConnect needs a valid VITE_WALLETCONNECT_PROJECT_ID.');
  }
  return projectId;
};

export const isCipherTradeWalletConnectConfigured = (): boolean =>
  isUsableWalletConnectProjectId(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID);

const getDappMetadata = () => {
  const fallbackOrigin = 'https://chainwhisper.chat';
  const origin = typeof window === 'undefined' ? fallbackOrigin : window.location.origin || fallbackOrigin;
  return {
    name: 'ChainWhisper',
    description: 'Private chat and owner-controlled trading on COTI',
    url: origin,
    icons: [new URL(chainWhisperFaviconUrl, origin).href]
  };
};

const markCipherTradeProvider = (provider: WalletConnectProvider): WalletConnectProvider => {
  try {
    provider.__chainWhisperCipherTradeWalletConnect = true;
    provider.isCipherTrade = true;
  } catch {
    // Provider identity is also bound by the immutable session wallet id and peer metadata.
  }
  return provider;
};

const initializeProvider = async (
  network: ChainWhisperCotiNetwork = COTI_NETWORK
): Promise<WalletConnectProvider> => {
  const walletConnectModule: WalletConnectProviderModule = await import('@walletconnect/ethereum-provider');
  const provider = await walletConnectModule.EthereumProvider.init({
    projectId: getWalletConnectProjectId(),
    optionalChains: [network.chainIdDecimal],
    showQrModal: true,
    rpcMap: {
      [network.chainIdDecimal]: network.rpcUrl
    },
    metadata: getDappMetadata()
  });
  return markCipherTradeProvider(provider as unknown as WalletConnectProvider);
};

export const getCipherTradeWalletConnectProvider = async (): Promise<WalletConnectProvider> => {
  if (providerInstance) return providerInstance;
  if (!providerPromise) {
    providerPromise = initializeProvider()
      .then((provider) => {
        providerInstance = provider;
        return provider;
      })
      .catch((error) => {
        providerPromise = null;
        throw error;
      });
  }
  return providerPromise;
};

const readAccounts = async (provider: WalletConnectProvider): Promise<string[]> => {
  const accounts = provider.accounts?.filter((account): account is string => typeof account === 'string') ?? [];
  if (accounts.length > 0) return accounts;
  const response = await provider.request({ method: 'eth_accounts' });
  return Array.isArray(response) ? response.filter((account): account is string => typeof account === 'string') : [];
};

export type CipherTradeWalletConnectSession = Readonly<{
  address: string;
  chainId: number | null;
  provider: Eip1193Provider;
  source: 'walletconnect';
  walletId: typeof CIPHERTRADE_WALLETCONNECT_WALLET_ID;
  walletLabel: typeof CIPHERTRADE_WALLETCONNECT_WALLET_LABEL;
}>;

const connectCipherTradeProvider = async (
  provider: WalletConnectProvider,
  network: ChainWhisperCotiNetwork
): Promise<CipherTradeWalletConnectSession> => {
  try {
    await provider.connect({
      chains: [network.chainIdDecimal],
      rpcMap: { [network.chainIdDecimal]: network.rpcUrl }
    });

    if (!isCipherTradeWalletConnectPeer(provider.session?.peer?.metadata)) {
      throw new Error('This WalletConnect option only accepts CipherTrade Mobile.');
    }

    const accounts = await readAccounts(provider);
    const address = accounts[0]?.trim() ?? '';
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error('CipherTrade did not return a valid wallet account.');
    }
    const rawChainId = provider.chainId ?? await provider.request({ method: 'eth_chainId' });
    const chainId = typeof rawChainId === 'string' || typeof rawChainId === 'number'
      ? normalizeChainId(rawChainId)
      : null;
    if (chainId !== network.chainIdDecimal) {
      throw new Error(`CipherTrade connected to the wrong network. Select ${network.chainName} and try again.`);
    }

    return Object.freeze({
      address,
      chainId,
      provider,
      source: 'walletconnect' as const,
      walletId: CIPHERTRADE_WALLETCONNECT_WALLET_ID,
      walletLabel: CIPHERTRADE_WALLETCONNECT_WALLET_LABEL
    });
  } catch (error) {
    await provider.disconnect().catch(() => undefined);
    throw error;
  }
};

export const connectCipherTradeWalletConnect = async (): Promise<CipherTradeWalletConnectSession> => {
  const provider = await getCipherTradeWalletConnectProvider();
  try {
    return await connectCipherTradeProvider(provider, COTI_NETWORK);
  } catch (error) {
    if (providerInstance === provider) {
      providerInstance = null;
      providerPromise = null;
    }
    throw error;
  }
};

/**
 * Creates an isolated WalletConnect session for a network-pinned operational tool.
 * It deliberately does not replace the main application's cached wallet session.
 */
export const connectCipherTradeWalletConnectForNetwork = async (
  network: ChainWhisperCotiNetwork
): Promise<CipherTradeWalletConnectSession> =>
  connectCipherTradeProvider(await initializeProvider(network), network);

export const disconnectCipherTradeWalletConnect = async (): Promise<void> => {
  if (!providerInstance && !providerPromise) return;
  const pendingProvider = providerInstance
    ? Promise.resolve(providerInstance)
    : providerPromise;
  providerInstance = null;
  providerPromise = null;
  const provider = await pendingProvider?.catch(() => null);
  if (provider) {
    await provider.disconnect();
  }
};

/**
 * Retires one known CipherTrade WalletConnect provider without touching a newer
 * cached session. This is used when an application wallet-lifecycle operation becomes
 * stale after the QR session has already connected.
 */
export const discardCipherTradeWalletConnectProvider = async (
  provider: Eip1193Provider | null | undefined
): Promise<void> => {
  if (!isCipherTradeWalletConnectProvider(provider)) return;
  const walletConnectProvider = provider as WalletConnectProvider;
  if (providerInstance === walletConnectProvider) {
    providerInstance = null;
    providerPromise = null;
  }
  await walletConnectProvider.disconnect().catch(() => undefined);
};

/** Clears a remotely disconnected provider so the next attempt creates a new QR session. */
export const forgetCipherTradeWalletConnectProvider = (
  provider: Eip1193Provider | null | undefined
): void => {
  if (!isCipherTradeWalletConnectProvider(provider)) return;
  if (providerInstance === provider) {
    providerInstance = null;
    providerPromise = null;
  }
};

export const isCipherTradeWalletConnectProvider = (
  provider: Eip1193Provider | null | undefined
): boolean => Boolean((provider as WalletConnectProvider | null | undefined)?.__chainWhisperCipherTradeWalletConnect);

export const resetCipherTradeWalletConnectForTests = (): void => {
  providerPromise = null;
  providerInstance = null;
};
