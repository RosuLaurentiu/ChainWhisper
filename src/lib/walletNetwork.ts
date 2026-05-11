import {
  COTI_NETWORK,
  normalizeChainId,
  type Eip1193Provider
} from './appShared';
import {
  isMetaMaskConnectMobileProvider,
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
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: COTI_NETWORK.chainIdHex }]
    });
  } catch (switchError) {
    const errorWithCode = switchError as { code?: number; message?: string };

    if (errorWithCode.code === 4902) {
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
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: COTI_NETWORK.chainIdHex }]
      });
      return;
    }

    throw new Error(errorWithCode.message ?? 'Could not switch to the COTI network.');
  }
};
