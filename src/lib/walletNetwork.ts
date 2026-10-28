import {
  COTI_NETWORK,
  normalizeChainId,
  type Eip1193Provider
} from './appShared';
import type { ChainWhisperCotiNetwork } from './chainWhisperNetworks';
import {
  isMetaMaskConnectMobileProvider,
  logMetaMaskMobileRequestMethod,
  switchMetaMaskConnectMobileToCoti
} from './metamaskConnectMobile';

export const getProviderChainId = async (provider: Eip1193Provider): Promise<number | null> => {
  const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
  return normalizeChainId(currentChain);
};

export const ensureProviderOnNetwork = async (
  provider: Eip1193Provider,
  network: ChainWhisperCotiNetwork
): Promise<void> => {
  if (!provider) {
    throw new Error('Wallet provider is not available.');
  }
  const providerFlags = provider as Eip1193Provider & { isBraveWallet?: boolean; isMetaMask?: boolean };
  const injectedMetaMaskSource = providerFlags.isMetaMask && !providerFlags.isBraveWallet ? 'injected-metamask' : null;

  try {
    const currentChainId = await getProviderChainId(provider);
    if (currentChainId === network.chainIdDecimal) {
      return;
    }
  } catch {
    // Some providers only expose the chain once the switch request is attempted.
  }

  if (isMetaMaskConnectMobileProvider(provider)) {
    await switchMetaMaskConnectMobileToCoti(network);
    return;
  }

  try {
    if (injectedMetaMaskSource) {
      logMetaMaskMobileRequestMethod('wallet_switchEthereumChain', injectedMetaMaskSource);
    }
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.chainIdHex }]
    });
  } catch (switchError) {
    const errorWithCode = switchError as { code?: number; message?: string };

    if (errorWithCode.code === 4902) {
      if (injectedMetaMaskSource) {
        logMetaMaskMobileRequestMethod('wallet_addEthereumChain', injectedMetaMaskSource);
      }
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: network.chainIdHex,
            chainName: network.chainName,
            rpcUrls: [network.rpcUrl],
            blockExplorerUrls: [network.blockExplorerUrl],
            nativeCurrency: network.nativeCurrency
          }
        ]
      });
      if (injectedMetaMaskSource) {
        logMetaMaskMobileRequestMethod('wallet_switchEthereumChain', injectedMetaMaskSource);
      }
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: network.chainIdHex }]
      });
      return;
    }

    throw new Error(errorWithCode.message ?? `Could not switch to ${network.chainName}.`);
  }
};

/** Switches once, then verifies the wallet still exposes the expected owner on the exact network. */
export const ensureProviderOnNetworkAndVerifyOwner = async (
  provider: Eip1193Provider,
  network: ChainWhisperCotiNetwork,
  expectedOwnerAddress: string
): Promise<number> => {
  const expectedOwner = expectedOwnerAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(expectedOwner)) {
    throw new Error('Expected wallet owner is invalid.');
  }
  await ensureProviderOnNetwork(provider, network);
  const accounts = await provider.request({ method: 'eth_accounts' });
  const selectedOwner = Array.isArray(accounts) && typeof accounts[0] === 'string'
    ? accounts[0].trim().toLowerCase()
    : '';
  if (selectedOwner !== expectedOwner) {
    throw new Error('Wallet account changed while selecting the network. Reconnect the intended owner wallet.');
  }
  const verifiedChainId = await getProviderChainId(provider);
  if (verifiedChainId !== network.chainIdDecimal) {
    throw new Error(`Wallet did not finish switching to ${network.chainName}.`);
  }
  return verifiedChainId;
};

export const ensureProviderOnCotiNetwork = async (provider: Eip1193Provider): Promise<void> =>
  ensureProviderOnNetwork(provider, COTI_NETWORK);
