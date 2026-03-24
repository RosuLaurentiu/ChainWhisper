import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  getDefaultInjectedWalletOption,
  getInjectedWalletOptions,
  getProviderErrorMessage,
  mergeOnboardInfo,
  normalizeChainId,
  type Eip1193Provider,
  type SignerSource
} from '../lib/appShared';

type UseWalletOnboardingArgs = {
  clearCachedStateBackupMemo: () => void;
  loadMyNicknameFromChainRef: MutableRefObject<(address: string) => Promise<string>>;
  resetBurnerSessionRef: MutableRefObject<() => void>;
  runPostConnectDataSyncUntilAppliedRef: MutableRefObject<(address: string) => Promise<void>>;
  setError: Dispatch<SetStateAction<string>>;
  setMyNickname: Dispatch<SetStateAction<string>>;
};

export function useWalletOnboarding({
  clearCachedStateBackupMemo,
  loadMyNicknameFromChainRef,
  resetBurnerSessionRef,
  runPostConnectDataSyncUntilAppliedRef,
  setError,
  setMyNickname
}: UseWalletOnboardingArgs) {
  const [walletAddress, setWalletAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState('Disconnected');
  const [activeSignerSource, setActiveSignerSource] = useState<SignerSource>('burner');
  const [connectionMethod, setConnectionMethod] = useState<'metamask' | null>(null);
  const [connectingMethod, setConnectingMethod] = useState<'metamask' | null>(null);
  const [connectingWalletLabel, setConnectingWalletLabel] = useState('');
  const [selectedInjectedWalletId, setSelectedInjectedWalletId] = useState('');
  const [onboardStatus, setOnboardStatus] = useState('Not onboarded');
  const [sessionOnboardInfo, setSessionOnboardInfo] = useState<Record<string, OnboardInfo>>({});
  const [activeProvider, setActiveProvider] = useState<Eip1193Provider | null>(null);

  const activeProviderRef = useRef<Eip1193Provider | null>(null);
  const signerCacheRef = useRef<Record<string, JsonRpcSigner>>({});
  const currentWalletKeyRef = useRef('');

  const injectedWalletOptions = getInjectedWalletOptions();
  const preferredInjectedWalletOption =
    injectedWalletOptions.find((option) => option.id === selectedInjectedWalletId) ??
    injectedWalletOptions.find((option) => option.provider.isMetaMask && !option.provider.isBraveWallet) ??
    injectedWalletOptions[0] ??
    null;
  const currentInjectedWalletOption =
    (activeProvider ? injectedWalletOptions.find((option) => option.provider === activeProvider) ?? null : null) ??
    injectedWalletOptions.find((option) => option.id === selectedInjectedWalletId) ??
    null;

  useEffect(() => {
    currentWalletKeyRef.current = walletAddress.trim().toLowerCase();
  }, [walletAddress]);

  const setConnectedProvider = useCallback((provider: Eip1193Provider | null) => {
    activeProviderRef.current = provider;
    setActiveProvider(provider);
  }, []);

  const getConnectedProvider = useCallback((): Eip1193Provider | null => {
    if (connectionMethod === 'metamask') {
      return activeProviderRef.current ?? activeProvider ?? getDefaultInjectedWalletOption()?.provider ?? null;
    }

    return activeProviderRef.current ?? activeProvider ?? null;
  }, [activeProvider, connectionMethod]);

  const ensureCotiNetwork = useCallback(async (provider: Eip1193Provider) => {
    if (!provider) {
      throw new Error('Wallet provider is not available.');
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
      } else {
        throw new Error(errorWithCode.message ?? 'Could not switch to the COTI network.');
      }
    }
  }, []);

  const refreshWalletState = useCallback(
    async (providerOverride?: Eip1193Provider | null) => {
      const provider = providerOverride ?? getConnectedProvider();
      if (!provider) {
        return;
      }

      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      const selected = accounts[0] ?? '';
      setWalletAddress(selected);

      if (selected) {
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
        setStatus('Connected');
      } else {
        setChainId(null);
        setStatus('Disconnected');
      }
    },
    [getConnectedProvider]
  );

  const onboardAddressAes = useCallback(
    async (address: string, provider: Eip1193Provider): Promise<OnboardInfo> => {
      if (!provider) {
        throw new Error('Wallet provider is not available.');
      }

      setOnboardStatus('Onboarding...');
      await ensureCotiNetwork(provider);

      const browserProvider = await createCotiBrowserProvider(provider);

      const cacheKey = address.toLowerCase();
      const signer = await browserProvider.getSigner(address, sessionOnboardInfo[cacheKey]);
      signer.disableAutoOnboard();
      signerCacheRef.current[cacheKey] = signer;

      await signer.generateOrRecoverAes();

      const rawOnboardInfo = signer.getUserOnboardInfo();
      const onboardInfo = mergeOnboardInfo(undefined, rawOnboardInfo);
      const aesKey = onboardInfo.aesKey ?? '';
      if (!aesKey) {
        throw new Error('AES key was not returned during onboarding.');
      }

      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
      }));

      setOnboardStatus('AES key ready');
      return onboardInfo;
    },
    [ensureCotiNetwork, sessionOnboardInfo]
  );

  const connectAndOnboard = useCallback(
    async (walletId?: string) => {
      setError('');
      setConnectingMethod('metamask');

      const walletOption =
        (walletId ? injectedWalletOptions.find((option) => option.id === walletId) ?? null : preferredInjectedWalletOption) ??
        preferredInjectedWalletOption;
      const provider = walletOption?.provider ?? null;
      const walletLabel = walletOption?.label ?? 'Wallet';
      setConnectingWalletLabel(walletLabel);
      if (!provider) {
        setError('No browser wallet detected. Install a compatible wallet to continue.');
        setConnectingMethod(null);
        setConnectingWalletLabel('');
        return;
      }

      try {
        setStatus(`Connecting ${walletLabel}...`);
        const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
        const selected = accounts[0] ?? '';

        if (!selected) {
          throw new Error('No wallet account selected.');
        }

        if (walletOption?.id) {
          setSelectedInjectedWalletId(walletOption.id);
        }
        setConnectedProvider(provider);
        setConnectionMethod('metamask');
        setActiveSignerSource('metamask');
        setWalletAddress(selected);

        await onboardAddressAes(selected, provider);
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
        setStatus(`Connected (${walletLabel})`);
        const selectedWalletKey = selected.toLowerCase();
        window.setTimeout(() => {
          void (async () => {
            try {
              const nickname = await loadMyNicknameFromChainRef.current(selected);
              if (currentWalletKeyRef.current !== selectedWalletKey) {
                return;
              }
              setMyNickname(nickname);
            } catch {
              // Post-connect sync should not block successful connection.
            } finally {
              if (currentWalletKeyRef.current === selectedWalletKey) {
                runPostConnectDataSyncUntilAppliedRef.current(selected).catch(() => {});
              }
            }
          })();
        }, 0);
      } catch (connectionError) {
        const message = getProviderErrorMessage(connectionError, 'Failed to connect wallet.');
        setError(message);
        setStatus('Disconnected');
        setOnboardStatus('Not onboarded');
      } finally {
        setConnectingMethod(null);
        setConnectingWalletLabel('');
      }
    },
    [
      injectedWalletOptions,
      loadMyNicknameFromChainRef,
      onboardAddressAes,
      preferredInjectedWalletOption,
      runPostConnectDataSyncUntilAppliedRef,
      setConnectedProvider,
      setError,
      setMyNickname
    ]
  );

  const disconnectWallet = useCallback(async () => {
    setError('');
    setConnectingWalletLabel('');

    resetBurnerSessionRef.current();

    const provider = getConnectedProvider();

    try {
      if (connectionMethod === 'metamask' && provider) {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }]
        });
      }
    } catch {
      // Some wallets do not support revoking permissions.
    }

    setWalletAddress('');
    setChainId(null);
    setStatus('Disconnected');
    setActiveSignerSource('burner');
    setConnectionMethod(null);
    setOnboardStatus('Not onboarded');
    setSessionOnboardInfo({});
    setConnectedProvider(null);
    signerCacheRef.current = {};
    clearCachedStateBackupMemo();
  }, [clearCachedStateBackupMemo, connectionMethod, getConnectedProvider, resetBurnerSessionRef, setConnectedProvider, setError]);

  useEffect(() => {
    const provider = getConnectedProvider();

    refreshWalletState(provider).catch(() => {
      setError('Unable to read wallet state.');
    });

    if (!provider?.on || !provider?.removeListener) {
      return;
    }

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : [];
      const selected = nextAccounts[0] ?? '';
      setWalletAddress(selected);
      if (!selected) {
        setStatus('Disconnected');
        setChainId(null);
      }
    };

    const handleChainChanged = (newChainId: unknown) => {
      if (typeof newChainId === 'string' || typeof newChainId === 'number') {
        setChainId(normalizeChainId(newChainId));
      }
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [activeProvider, connectionMethod, getConnectedProvider, refreshWalletState, setError]);

  return {
    activeProvider,
    activeSignerSource,
    chainId,
    connectAndOnboard,
    connectingMethod,
    connectingWalletLabel,
    connectionMethod,
    currentInjectedWalletOption,
    currentWalletKeyRef,
    disconnectWallet,
    ensureCotiNetwork,
    getConnectedProvider,
    injectedWalletOptions,
    onboardAddressAes,
    onboardStatus,
    preferredInjectedWalletOption,
    refreshWalletState,
    selectedInjectedWalletId,
    sessionOnboardInfo,
    setActiveSignerSource,
    setChainId,
    setConnectedProvider,
    setConnectionMethod,
    setOnboardStatus,
    setSelectedInjectedWalletId,
    setSessionOnboardInfo,
    setStatus,
    setWalletAddress,
    signerCacheRef,
    status,
    walletAddress
  };
}
