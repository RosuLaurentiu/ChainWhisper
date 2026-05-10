import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  normalizeChainId,
  type Eip1193Provider
} from '../lib/appShared';
import { getOrRecoverAesForWallet, hydrateSignerWithFallbackAesSession } from '../lib/cotiAesUnlock';
import type { WalletSessionActions } from '../lib/walletSession';

export type P2PTradeSigner = JsonRpcSigner | Wallet;
export type P2PTradeSignerOptions = {
  refreshAes?: boolean;
};

type MergeOnboardInfoByAddress = (
  previous: Record<string, OnboardInfo>,
  cacheKey: string,
  onboardInfo?: OnboardInfo
) => Record<string, OnboardInfo>;

type UseP2PTradeSignerArgs = {
  burnerWalletRef: MutableRefObject<Wallet | null>;
  chainId: number | null;
  ensureCotiNetwork: (provider: Eip1193Provider) => Promise<void>;
  mergeOnboardInfoByAddress: MergeOnboardInfoByAddress;
  onboardInfoByAddress: Record<string, OnboardInfo>;
  providerRef: MutableRefObject<Eip1193Provider | null>;
  setChainId: Dispatch<SetStateAction<number | null>>;
  setOnboardInfoByAddress: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  signerCacheRef: MutableRefObject<Record<string, P2PTradeSigner>>;
  sharedGetSigner?: WalletSessionActions['getSigner'];
  walletAddress: string;
};

export const getSharedP2PTradeSigner = (
  sharedGetSigner: WalletSessionActions['getSigner'] | undefined,
  requireAes: boolean,
  options: P2PTradeSignerOptions = {}
): Promise<P2PTradeSigner> | null => {
  return sharedGetSigner ? sharedGetSigner(requireAes, options) : null;
};

export default function useP2PTradeSigner({
  burnerWalletRef,
  chainId,
  ensureCotiNetwork,
  mergeOnboardInfoByAddress,
  onboardInfoByAddress,
  providerRef,
  setChainId,
  setOnboardInfoByAddress,
  signerCacheRef,
  sharedGetSigner,
  walletAddress
}: UseP2PTradeSignerArgs): (requireAes: boolean, options?: P2PTradeSignerOptions) => Promise<P2PTradeSigner> {
  return useCallback(
    async (requireAes: boolean, options: P2PTradeSignerOptions = {}): Promise<P2PTradeSigner> => {
      const sharedSigner = getSharedP2PTradeSigner(sharedGetSigner, requireAes, options);
      if (sharedSigner) {
        return sharedSigner;
      }

      const burnerSigner = burnerWalletRef.current;
      if (burnerSigner && walletAddress && burnerSigner.address.toLowerCase() === walletAddress.toLowerCase()) {
        const cacheKey = burnerSigner.address.toLowerCase();
        if (onboardInfoByAddress[cacheKey]) {
          burnerSigner.setUserOnboardInfo(onboardInfoByAddress[cacheKey]);
        }
        burnerSigner.disableAutoOnboard();
        if (requireAes && (options.refreshAes || !burnerSigner.getUserOnboardInfo()?.aesKey)) {
          await getOrRecoverAesForWallet({
            forceRefresh: options.refreshAes,
            signer: burnerSigner,
            walletAddress: burnerSigner.address
          });
        }
        const onboardInfo = burnerSigner.getUserOnboardInfo();
        if (onboardInfo?.aesKey) {
          setOnboardInfoByAddress((previous) =>
            mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo)
          );
        }
        return burnerSigner;
      }

      const provider = providerRef.current;
      if (!provider || !walletAddress) {
        throw new Error('Connect a wallet first.');
      }

      if (chainId !== COTI_NETWORK.chainIdDecimal) {
        await ensureCotiNetwork(provider);
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
      }

      const cacheKey = walletAddress.toLowerCase();
      let signer = signerCacheRef.current[cacheKey] as JsonRpcSigner | undefined;
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(walletAddress, onboardInfoByAddress[cacheKey]);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
      } else if (onboardInfoByAddress[cacheKey]) {
        signer.setUserOnboardInfo(onboardInfoByAddress[cacheKey]);
      }
      if (!signer.getUserOnboardInfo()?.aesKey) {
        hydrateSignerWithFallbackAesSession(signer, walletAddress, provider);
      }

      signer.disableAutoOnboard();
      if (requireAes && (options.refreshAes || !signer.getUserOnboardInfo()?.aesKey)) {
        await getOrRecoverAesForWallet({
          forceRefresh: options.refreshAes,
          provider,
          signer,
          walletAddress
        });
      }

      const onboardInfo = signer.getUserOnboardInfo();
      if (onboardInfo?.aesKey) {
        setOnboardInfoByAddress((previous) =>
          mergeOnboardInfoByAddress(previous, cacheKey, onboardInfo)
        );
      }

      return signer;
    },
    [
      burnerWalletRef,
      chainId,
      ensureCotiNetwork,
      mergeOnboardInfoByAddress,
      onboardInfoByAddress,
      providerRef,
      setChainId,
      setOnboardInfoByAddress,
      signerCacheRef,
      sharedGetSigner,
      walletAddress
    ]
  );
}
