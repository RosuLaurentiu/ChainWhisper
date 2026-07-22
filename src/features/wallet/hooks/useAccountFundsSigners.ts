import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  isWalletAddress,
  mergeOnboardInfo,
  mergeOnboardInfoByAddress,
  normalizeChainId,
  type Eip1193Provider,
  type InjectedWalletOption
} from '../../../lib/appShared';
import {
  buildWalletAesHealthState,
  getOrRecoverAesForWallet,
  type WalletAesHealthState
} from '../../../lib/cotiAesUnlock';
import { getCotiSnapOwnerAesKeyResult, getCotiSnapOwnerAesStatusMessage } from '../../../lib/cotiSnap';
import { runWalletTransactionFlow } from '../../../lib/walletTransactionFlow';
import type { BrowserWalletSession } from './useWalletOnboarding';

type UseAccountFundsSignersArgs = {
  browserWalletSession: BrowserWalletSession | null;
  burnerWalletRef: MutableRefObject<Wallet | null>;
  chainId: number | null;
  currentInjectedWalletOption: Pick<InjectedWalletOption, 'id'> | null;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  getConnectedProvider: () => Eip1193Provider | null;
  ownerAesKey: string;
  ownerWalletAddress: string;
  preferredBrowserWalletId: string;
  resolveWalletPromptProvider: (
    providerOverride?: Eip1193Provider | null,
    expectedAddress?: string | null
  ) => Promise<Eip1193Provider | null>;
  sessionOnboardInfo: Record<string, OnboardInfo>;
  setChainId: Dispatch<SetStateAction<number | null>>;
  setOnboardStatus: Dispatch<SetStateAction<string>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setWalletAesHealth: (address: string, health: WalletAesHealthState) => void;
  signerCacheRef: MutableRefObject<Record<string, JsonRpcSigner>>;
  signerProviderCacheRef: MutableRefObject<Record<string, Eip1193Provider>>;
};

export default function useAccountFundsSigners({
  browserWalletSession,
  burnerWalletRef,
  chainId,
  currentInjectedWalletOption,
  ensureCotiNetwork,
  getConnectedProvider,
  ownerAesKey,
  ownerWalletAddress,
  preferredBrowserWalletId,
  resolveWalletPromptProvider,
  sessionOnboardInfo,
  setChainId,
  setOnboardStatus,
  setSessionOnboardInfo,
  setWalletAesHealth,
  signerCacheRef,
  signerProviderCacheRef
}: UseAccountFundsSignersArgs) {
  const getOwnerFundsSigner = useCallback(
    async (requirePrivacy: boolean): Promise<JsonRpcSigner> => {
      const normalizedOwnerAddress = ownerWalletAddress.trim();
      if (!normalizedOwnerAddress || !isWalletAddress(normalizedOwnerAddress)) {
        throw new Error('Connect the owner wallet first.');
      }

      const connectedProvider = browserWalletSession?.provider ?? getConnectedProvider();
      const provider = await resolveWalletPromptProvider(connectedProvider, normalizedOwnerAddress);
      if (!provider) {
        throw new Error('Owner wallet provider not detected. Connect the owner wallet first.');
      }

      if (chainId !== COTI_NETWORK.chainIdDecimal || provider !== connectedProvider) {
        await ensureCotiNetwork(provider);
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
      }

      const cacheKey = normalizedOwnerAddress.toLowerCase();
      const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
      let signer = signerCacheRef.current[cacheKey] as JsonRpcSigner | undefined;
      if (signer && signerProviderCacheRef.current[cacheKey] !== provider) {
        delete signerCacheRef.current[cacheKey];
        delete signerProviderCacheRef.current[cacheKey];
        signer = undefined;
      }
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(normalizedOwnerAddress, cachedOnboardInfo);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
        signerProviderCacheRef.current[cacheKey] = provider;
      } else if (cachedOnboardInfo) {
        signer.setUserOnboardInfo(cachedOnboardInfo);
      }

      signer.disableAutoOnboard();
      const cachedOwnerAesKey = ownerAesKey.trim();
      if (cachedOwnerAesKey && !signer.getUserOnboardInfo()?.aesKey) {
        signer.setUserOnboardInfo(
          mergeOnboardInfo(signer.getUserOnboardInfo(), {
            aesKey: cachedOwnerAesKey
          } as OnboardInfo)
        );
      }

      if (requirePrivacy && !signer.getUserOnboardInfo()?.aesKey) {
        const snapAesResult = await getCotiSnapOwnerAesKeyResult(provider, normalizedOwnerAddress);
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
        setSessionOnboardInfo((previous) => mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo));
        setWalletAesHealth(normalizedOwnerAddress, buildWalletAesHealthState({
          status: 'ready-unverified',
          walletAddress: normalizedOwnerAddress
        }));
      }

      return signer;
    },
    [
      browserWalletSession?.provider,
      chainId,
      ensureCotiNetwork,
      getConnectedProvider,
      ownerAesKey,
      ownerWalletAddress,
      resolveWalletPromptProvider,
      sessionOnboardInfo,
      setChainId,
      setSessionOnboardInfo,
      setWalletAesHealth,
      signerCacheRef,
      signerProviderCacheRef
    ]
  );

  const getChainWhisperFundsSigner = useCallback(
    async (requirePrivacy: boolean): Promise<Wallet> => {
      const signer = burnerWalletRef.current;
      if (!signer) {
        throw new Error('Set up the ChainWhisper account first.');
      }

      const cacheKey = signer.address.toLowerCase();
      const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
      if (cachedOnboardInfo) {
        signer.setUserOnboardInfo(cachedOnboardInfo);
      }
      signer.disableAutoOnboard();

      if (requirePrivacy && !signer.getUserOnboardInfo()?.aesKey) {
        await getOrRecoverAesForWallet({
          signer,
          walletAddress: signer.address
        });
      }

      const onboardInfo = signer.getUserOnboardInfo();
      if (onboardInfo?.aesKey) {
        setSessionOnboardInfo((previous) => mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo));
        setOnboardStatus('Privacy ready');
      }

      return signer;
    },
    [burnerWalletRef, sessionOnboardInfo, setOnboardStatus, setSessionOnboardInfo]
  );

  const runOwnerFundsTransactionFlow = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> =>
      runWalletTransactionFlow(
        {
          chainId,
          provider: browserWalletSession?.provider ?? getConnectedProvider(),
          providerKey: browserWalletSession?.walletId ?? currentInjectedWalletOption?.id ?? preferredBrowserWalletId,
          walletAddress: ownerWalletAddress
        },
        operation
      ),
    [
      browserWalletSession?.provider,
      browserWalletSession?.walletId,
      chainId,
      currentInjectedWalletOption?.id,
      getConnectedProvider,
      ownerWalletAddress,
      preferredBrowserWalletId
    ]
  );

  return {
    getChainWhisperFundsSigner,
    getOwnerFundsSigner,
    runOwnerFundsTransactionFlow
  };
}
