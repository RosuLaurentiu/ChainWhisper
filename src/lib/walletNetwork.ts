import {
  COTI_NETWORK,
  normalizeChainId,
  type Eip1193Provider
} from './appShared';
import {
  isMetaMaskConnectMobileProvider,
  logMetaMaskMobileRequestMethod,
  switchMetaMaskConnectMobileToCoti
} from './metamaskConnectMobile';

export const getProviderChainId = async (provider: Eip1193Provider): Promise<number | null> => {
  const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
  return normalizeChainId(currentChain);
};

export const ensureProviderOnCotiNetwork = async (provider: Eip1193Provider): Promise<void> => {
  if (!provider) {
    throw new Error('Wallet provider is not available.');
  }
  const providerFlags = provider as Eip1193Provider & { isBraveWallet?: boolean; isMetaMask?: boolean };
  const injectedMetaMaskSource = providerFlags.isMetaMask && !providerFlags.isBraveWallet ? 'injected-metamask' : null;

  try {
    const currentChainId = await getProviderChainId(provider);
    if (currentChainId === COTI_NETWORK.chainIdDecimal) {
      return;
    }
  } catch {
    // Some providers only expose the chain once the switch request is attempted.
  }

  if (isMetaMaskConnectMobileProvider(provider)) {
    await switchMetaMaskConnectMobileToCoti();
    return;
  }

  try {
    if (injectedMetaMaskSource) {
      logMetaMaskMobileRequestMethod('wallet_switchEthereumChain', injectedMetaMaskSource);
    }
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: COTI_NETWORK.chainIdHex }]
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
            chainId: COTI_NETWORK.chainIdHex,
            chainName: COTI_NETWORK.chainName,
            rpcUrls: [COTI_NETWORK.rpcUrl],
            blockExplorerUrls: [COTI_NETWORK.blockExplorerUrl],
            nativeCurrency: COTI_NETWORK.nativeCurrency
          }
        ]
      });
      if (injectedMetaMaskSource) {
        logMetaMaskMobileRequestMethod('wallet_switchEthereumChain', injectedMetaMaskSource);
      }
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: COTI_NETWORK.chainIdHex }]
      });
      return;
    }

    throw new Error(errorWithCode.message ?? 'Could not switch to the COTI network.');
  }
};
