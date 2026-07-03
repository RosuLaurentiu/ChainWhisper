import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  mergeOnboardInfo,
  normalizeChainId,
  type Eip1193Provider,
  type SignerSource
} from '../../../lib/appShared';
import {
  buildWalletAesHealthState,
  getOrRecoverAesForWallet,
  type WalletAesHealthState
} from '../../../lib/cotiAesUnlock';
import { getCotiSnapOwnerAesKeyResult, getCotiSnapOwnerAesStatusMessage } from '../../../lib/cotiSnap';
import type { WalletSessionActions } from '../../../lib/walletSession';

type UseSharedWalletSignerArgs = {
  activeSignerSource: SignerSource;
  burnerWalletRef: MutableRefObject<Wallet | null>;
  chainId: number | null;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  getConnectedProvider: () => Eip1193Provider | null;
  resolveWalletPromptProvider: (
    provider: Eip1193Provider | null,
    walletAddress: string
  ) => Promise<Eip1193Provider | null>;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  setChainId: Dispatch<SetStateAction<number | null>>;
  setOnboardStatus: (status: string) => void;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setWalletAesHealth: (address: string, health: WalletAesHealthState) => void;
  signerCacheRef: MutableRefObject<Record<string, JsonRpcSigner>>;
  signerProviderCacheRef: MutableRefObject<Record<string, Eip1193Provider>>;
  walletAddress: string;
};

export default function useSharedWalletSigner({
  activeSignerSource,
  burnerWalletRef,
  chainId,
  ensureCotiNetwork,
  getConnectedProvider,
  resolveWalletPromptProvider,
  sessionOnboardInfo,
  setChainId,
  setOnboardStatus,
  setSessionOnboardInfo,
  setWalletAesHealth,
  signerCacheRef,
  signerProviderCacheRef,
  walletAddress
}: UseSharedWalletSignerArgs): WalletSessionActions['getSigner'] {
  return useCallback<WalletSessionActions['getSigner']>(
    async (requireAes, options = {}) => {
      if (activeSignerSource === 'metamask') {
        const connectedProvider = getConnectedProvider();
        const provider = await resolveWalletPromptProvider(connectedProvider, walletAddress);
        if (!provider) {
          throw new Error('Owner wallet provider not detected. Connect your owner wallet first.');
        }

        if (!walletAddress) {
          throw new Error('Connect your owner wallet first.');
        }

        if (chainId !== COTI_NETWORK.chainIdDecimal || provider !== connectedProvider) {
          await ensureCotiNetwork(provider);
          const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
          setChainId(normalizeChainId(currentChain));
        }

        const cacheKey = walletAddress.toLowerCase();
        const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
        let signer = signerCacheRef.current[cacheKey] as JsonRpcSigner | undefined;
        if (signer && signerProviderCacheRef.current[cacheKey] !== provider) {
          delete signerCacheRef.current[cacheKey];
          delete signerProviderCacheRef.current[cacheKey];
          signer = undefined;
        }
        if (!signer) {
          const browserProvider = await createCotiBrowserProvider(provider);
          signer = await browserProvider.getSigner(walletAddress, cachedOnboardInfo);
          signer.disableAutoOnboard();
          signerCacheRef.current[cacheKey] = signer;
          signerProviderCacheRef.current[cacheKey] = provider;
        } else if (cachedOnboardInfo) {
          signer.setUserOnboardInfo(cachedOnboardInfo);
        }

        signer.disableAutoOnboard();
        if (requireAes && (options.refreshAes || !signer.getUserOnboardInfo()?.aesKey)) {
          const snapAesResult = await getCotiSnapOwnerAesKeyResult(provider, walletAddress);
          if (snapAesResult.status !== 'ready') {
            throw new Error(getCotiSnapOwnerAesStatusMessage(snapAesResult.status));
          }
          signer.setUserOnboardInfo(
            mergeOnboardInfo(signer.getUserOnboardInfo(), {
              aesKey: snapAesResult.aesKey
            } as OnboardInfo)
          );
        }

        const onboardInfo = signer.getUserOnboardInfo();
        if (onboardInfo?.aesKey) {
          setSessionOnboardInfo((previous) => ({
            ...previous,
            [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
          }));
          setWalletAesHealth(walletAddress, buildWalletAesHealthState({
            status: 'ready-unverified',
            walletAddress
          }));
          setOnboardStatus('Owner privacy ready');
        }

        return signer;
      }

      const signer = burnerWalletRef.current;
      if (!signer) {
        throw new Error('ChainWhisper account is not initialized.');
      }

      const cacheKey = signer.address.toLowerCase();
      const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
      if (cachedOnboardInfo) {
        signer.setUserOnboardInfo(cachedOnboardInfo);
      }

      signer.disableAutoOnboard();
      if (requireAes && (options.refreshAes || !signer.getUserOnboardInfo()?.aesKey)) {
        await getOrRecoverAesForWallet({
          forceRefresh: options.refreshAes,
          signer,
          walletAddress: signer.address
        });
      }

      const onboardInfo = signer.getUserOnboardInfo();
      if (onboardInfo?.aesKey) {
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
        }));
        setOnboardStatus('Privacy ready');
      }

      return signer;
    },
    [
      activeSignerSource,
      burnerWalletRef,
      chainId,
      ensureCotiNetwork,
      getConnectedProvider,
      resolveWalletPromptProvider,
      sessionOnboardInfo,
      setChainId,
      setOnboardStatus,
      setSessionOnboardInfo,
      setWalletAesHealth,
      signerCacheRef,
      signerProviderCacheRef,
      walletAddress
    ]
  );
}
