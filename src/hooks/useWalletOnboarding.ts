import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  getProviderErrorMessage,
  mergeOnboardInfo,
  normalizeChainId,
  type Eip1193Provider,
  type SignerSource
} from '../lib/appShared';
import { saveWalletPreference } from '../lib/appStorage';
import {
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption
} from '../lib/walletOptions';
import { buildWalletAesHealthState, clearCotiAesUnlockRequest, getOrRecoverAesForWallet } from '../lib/cotiAesUnlock';
import type { WalletAesHealthState } from '../lib/cotiAesUnlock';
import { clearWalletTransactionFlow, isWalletTransactionFlowActive } from '../lib/walletTransactionFlow';
import useInjectedWalletOptions from './useInjectedWalletOptions';

type UseWalletOnboardingArgs = {
  clearCachedStateBackupMemo: () => void;
  loadMyNicknameFromChainRef: MutableRefObject<(address: string) => Promise<string>>;
  resetBurnerSessionRef: MutableRefObject<() => void>;
  runPostConnectDataSyncUntilAppliedRef: MutableRefObject<(address: string) => Promise<void>>;
  setError: Dispatch<SetStateAction<string>>;
  setMyNickname: Dispatch<SetStateAction<string>>;
  onWalletAesHealthChange?: (walletAddress: string, health: WalletAesHealthState) => void;
  walletAesHealthByAddress?: Record<string, WalletAesHealthState>;
};

export type BrowserWalletSession = {
  address: string;
  chainId: number | null;
  provider: Eip1193Provider;
  walletId: string;
  walletLabel: string;
};

type BrowserWalletActivationOptions = {
  forceAccountPicker?: boolean;
  forceFreshPrivacy?: boolean;
  preparePrivacy?: boolean;
};

export function useWalletOnboarding({
  clearCachedStateBackupMemo,
  loadMyNicknameFromChainRef,
  resetBurnerSessionRef,
  runPostConnectDataSyncUntilAppliedRef,
  setError,
  setMyNickname,
  onWalletAesHealthChange,
  walletAesHealthByAddress = {}
}: UseWalletOnboardingArgs) {
  const [walletAddress, setWalletAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState('Disconnected');
  const [activeSignerSource, setActiveSignerSourceState] = useState<SignerSource>('burner');
  const [connectionMethod, setConnectionMethod] = useState<'metamask' | null>(null);
  const [connectingMethod, setConnectingMethod] = useState<'metamask' | null>(null);
  const [connectingWalletLabel, setConnectingWalletLabel] = useState('');
  const [selectedInjectedWalletId, setSelectedInjectedWalletId] = useState('');
  const [onboardStatus, setOnboardStatus] = useState('Not onboarded');
  const [sessionOnboardInfo, setSessionOnboardInfo] = useState<Record<string, OnboardInfo>>({});
  const [activeProvider, setActiveProvider] = useState<Eip1193Provider | null>(null);
  const [browserWalletSession, setBrowserWalletSessionState] = useState<BrowserWalletSession | null>(null);

  const activeProviderRef = useRef<Eip1193Provider | null>(null);
  const browserWalletSessionRef = useRef<BrowserWalletSession | null>(null);
  const signerCacheRef = useRef<Record<string, JsonRpcSigner>>({});
  const currentWalletKeyRef = useRef('');
  const activeSignerSourceRef = useRef<SignerSource>('burner');

  const detectedInjectedWalletOptions = useInjectedWalletOptions();
  const injectedWalletOptions = useMemo(
    () => filterAllowedBrowserWalletOptions(detectedInjectedWalletOptions),
    [detectedInjectedWalletOptions]
  );
  const preferredInjectedWalletOption = getPreferredInjectedWalletOption(
    injectedWalletOptions,
    selectedInjectedWalletId,
    'metamask'
  );
  const currentInjectedWalletOption =
    (activeProvider ? injectedWalletOptions.find((option) => option.provider === activeProvider) ?? null : null) ??
    injectedWalletOptions.find((option) => option.id === selectedInjectedWalletId) ??
    null;

  useEffect(() => {
    currentWalletKeyRef.current = walletAddress.trim().toLowerCase();
  }, [walletAddress]);

  useEffect(() => {
    activeSignerSourceRef.current = activeSignerSource;
  }, [activeSignerSource]);

  const setActiveSignerSource = useCallback<Dispatch<SetStateAction<SignerSource>>>((nextSource) => {
    setActiveSignerSourceState((previousSource) => {
      const resolvedSource = typeof nextSource === 'function' ? nextSource(previousSource) : nextSource;
      activeSignerSourceRef.current = resolvedSource;
      return resolvedSource;
    });
  }, []);

  const setConnectedProvider = useCallback((provider: Eip1193Provider | null) => {
    activeProviderRef.current = provider;
    setActiveProvider(provider);
  }, []);

  const setBrowserWalletSession = useCallback((session: BrowserWalletSession | null) => {
    browserWalletSessionRef.current = session;
    setBrowserWalletSessionState(session);
  }, []);

  const resetBrowserPrivacySessionForWalletChange = useCallback((nextAddress: string) => {
    const nextWalletKey = nextAddress.trim().toLowerCase();
    const previousWalletKey = currentWalletKeyRef.current;
    if (nextWalletKey === previousWalletKey) {
      return;
    }

    if (previousWalletKey) {
      clearCotiAesUnlockRequest(previousWalletKey, activeProviderRef.current);
    }
    if (nextWalletKey) {
      clearCotiAesUnlockRequest(nextWalletKey, activeProviderRef.current);
    }
    signerCacheRef.current = {};
    setSessionOnboardInfo((previous) => {
      const next = { ...previous };
      if (nextWalletKey) {
        delete next[nextWalletKey];
      }
      if (previousWalletKey) {
        delete next[previousWalletKey];
      }
      return next;
    });
    setOnboardStatus('Not onboarded');
  }, []);

  const adoptBrowserWalletSession = useCallback((session: BrowserWalletSession) => {
    activeProviderRef.current = session.provider;
    setActiveProvider(session.provider);
    browserWalletSessionRef.current = session;
    setBrowserWalletSessionState(session);
    setConnectionMethod('metamask');
    setActiveSignerSource('metamask');
    setSelectedInjectedWalletId(session.walletId);
    resetBrowserPrivacySessionForWalletChange(session.address);
    setWalletAddress(session.address);
    setChainId(session.chainId);
    setStatus(`Connected (${session.walletLabel || 'Browser wallet'})`);
    saveWalletPreference({ kind: 'browser', browserWalletId: session.walletId });
  }, [resetBrowserPrivacySessionForWalletChange, setActiveSignerSource]);

  const getConnectedProvider = useCallback((): Eip1193Provider | null => {
    if (connectionMethod === 'metamask') {
      return activeProviderRef.current ?? activeProvider ?? preferredInjectedWalletOption?.provider ?? null;
    }

    return null;
  }, [activeProvider, connectionMethod, preferredInjectedWalletOption?.provider]);

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
      if (activeSignerSourceRef.current !== 'metamask' || activeProviderRef.current !== provider) {
        return;
      }
      const selected = accounts[0] ?? '';
      resetBrowserPrivacySessionForWalletChange(selected);
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
    [getConnectedProvider, resetBrowserPrivacySessionForWalletChange]
  );

  const onboardAddressAes = useCallback(
    async (address: string, provider: Eip1193Provider, options?: BrowserWalletActivationOptions): Promise<OnboardInfo> => {
      if (!provider) {
        throw new Error('Wallet provider is not available.');
      }

      setOnboardStatus('Onboarding...');
      await ensureCotiNetwork(provider);

      const browserProvider = await createCotiBrowserProvider(provider);

      const cacheKey = address.toLowerCase();
      const currentAesHealth = walletAesHealthByAddress[cacheKey]?.status;
      const forceFreshPrivacy = Boolean(options?.forceFreshPrivacy);
      const refreshMismatch =
        forceFreshPrivacy || currentAesHealth === 'key-mismatch' || currentAesHealth === 'repair-needed';
      if (refreshMismatch) {
        clearCotiAesUnlockRequest(address, provider);
        setSessionOnboardInfo((previous) => {
          if (!previous[cacheKey]) {
            return previous;
          }
          const next = { ...previous };
          delete next[cacheKey];
          return next;
        });
      }
      const signer = await browserProvider.getSigner(address, refreshMismatch ? undefined : sessionOnboardInfo[cacheKey]);
      signer.disableAutoOnboard();
      signerCacheRef.current[cacheKey] = signer;

      if (refreshMismatch) {
        onWalletAesHealthChange?.(
          address,
          buildWalletAesHealthState({
            status: 'repairing',
            walletAddress: address
          })
        );
      }
      await getOrRecoverAesForWallet({
        allowUnrecoverableReset: refreshMismatch,
        forceFreshAes: refreshMismatch,
        forceLegacyRefresh: refreshMismatch,
        forceRefresh: true,
        provider,
        signer,
        walletAddress: address
      });

      const rawOnboardInfo = signer.getUserOnboardInfo();
      const onboardInfo = mergeOnboardInfo(undefined, rawOnboardInfo);
      const aesKey = onboardInfo.aesKey ?? '';
      if (!aesKey) {
        throw new Error('AES key was not returned during onboarding.');
      }

      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: refreshMismatch ? onboardInfo : mergeOnboardInfo(previous[cacheKey], onboardInfo)
      }));
      onWalletAesHealthChange?.(
        address,
        buildWalletAesHealthState({
          status: 'ready-unverified',
          walletAddress: address
        })
      );

      setOnboardStatus('AES key ready');
      return onboardInfo;
    },
    [ensureCotiNetwork, onWalletAesHealthChange, sessionOnboardInfo, walletAesHealthByAddress]
  );

  const connectAndOnboard = useCallback(
    async (walletId?: string, options?: BrowserWalletActivationOptions): Promise<OnboardInfo | null> => {
      setError('');
      setConnectingMethod('metamask');

      const walletOption =
        (walletId ? injectedWalletOptions.find((option) => option.id === walletId) ?? null : preferredInjectedWalletOption) ??
        preferredInjectedWalletOption;
      const provider = walletOption?.provider ?? null;
      const walletLabel = walletOption?.label ?? 'Wallet';
      setConnectingWalletLabel(walletLabel);
      if (!provider) {
        setError('MetaMask or CypherTrade is required to continue.');
        setConnectingMethod(null);
        setConnectingWalletLabel('');
        return null;
      }

      try {
        setStatus(`Connecting ${walletLabel}...`);
        if (options?.forceAccountPicker) {
          await provider
            .request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }]
            })
            .catch(() => null);
        }
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
        resetBrowserPrivacySessionForWalletChange(selected);
        setWalletAddress(selected);
        saveWalletPreference({ kind: 'browser', browserWalletId: walletOption?.id });

        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        const normalizedChainId = normalizeChainId(currentChain);
        setChainId(normalizedChainId);
        setBrowserWalletSession({
          address: selected,
          chainId: normalizedChainId,
          provider,
          walletId: walletOption?.id ?? walletId ?? '',
          walletLabel
        });
        setStatus(`Connected (${walletLabel})`);
        const onboardInfo = options?.preparePrivacy ? await onboardAddressAes(selected, provider, options) : null;
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
        return onboardInfo;
      } catch (connectionError) {
        const message = getProviderErrorMessage(connectionError, 'Failed to connect wallet.');
        setError(message);
        setStatus('Disconnected');
        setOnboardStatus('Not onboarded');
        return null;
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
      resetBrowserPrivacySessionForWalletChange,
      runPostConnectDataSyncUntilAppliedRef,
      setBrowserWalletSession,
      setConnectedProvider,
      setError,
      setMyNickname
    ]
  );

  const activateBrowserWalletSession = useCallback(
    async (walletId?: string, options?: BrowserWalletActivationOptions) => {
      const storedSession = browserWalletSessionRef.current;
      const targetSession =
        storedSession && (!walletId || storedSession.walletId === walletId)
          ? storedSession
          : null;

      if (!targetSession) {
        return connectAndOnboard(walletId, options);
      }

      setError('');
      setConnectingMethod('metamask');
      setConnectingWalletLabel(targetSession.walletLabel);

      try {
        if (options?.forceAccountPicker) {
          await targetSession.provider
            .request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }]
            })
            .catch(() => null);
        }
        const accounts = (await targetSession.provider.request({
          method: options?.forceAccountPicker ? 'eth_requestAccounts' : 'eth_accounts'
        })) as string[];
        const selected =
          accounts.find((account) => account.toLowerCase() === targetSession.address.toLowerCase()) ?? accounts[0] ?? '';
        if (!selected) {
          setConnectingMethod(null);
          setConnectingWalletLabel('');
          return connectAndOnboard(targetSession.walletId || walletId, options);
        }

        setConnectedProvider(targetSession.provider);
        setConnectionMethod('metamask');
        setActiveSignerSource('metamask');
        setSelectedInjectedWalletId(targetSession.walletId);
        resetBrowserPrivacySessionForWalletChange(selected);
        setWalletAddress(selected);
        saveWalletPreference({ kind: 'browser', browserWalletId: targetSession.walletId });

        const currentChain = (await targetSession.provider.request({ method: 'eth_chainId' })) as string | number;
        const normalizedChainId = normalizeChainId(currentChain);
        setChainId(normalizedChainId);
        const nextSession = {
          ...targetSession,
          address: selected,
          chainId: normalizedChainId
        };
        setBrowserWalletSession(nextSession);
        setStatus(`Connected (${targetSession.walletLabel})`);
        const onboardInfo = options?.preparePrivacy
          ? await onboardAddressAes(selected, targetSession.provider, options)
          : null;

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
            } finally {
              if (currentWalletKeyRef.current === selectedWalletKey) {
                runPostConnectDataSyncUntilAppliedRef.current(selected).catch(() => {});
              }
            }
          })();
        }, 0);
        return onboardInfo;
      } catch (connectionError) {
        const message = getProviderErrorMessage(connectionError, 'Failed to activate wallet.');
        setError(message);
        return null;
      } finally {
        setConnectingMethod(null);
        setConnectingWalletLabel('');
      }
    },
    [
      connectAndOnboard,
      loadMyNicknameFromChainRef,
      onboardAddressAes,
      resetBrowserPrivacySessionForWalletChange,
      runPostConnectDataSyncUntilAppliedRef,
      setBrowserWalletSession,
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
    setBrowserWalletSession(null);
    signerCacheRef.current = {};
    clearCachedStateBackupMemo();
  }, [
    clearCachedStateBackupMemo,
    connectionMethod,
    getConnectedProvider,
    resetBurnerSessionRef,
    setBrowserWalletSession,
    setConnectedProvider,
    setError
  ]);

  useEffect(() => {
    const provider = getConnectedProvider();

    refreshWalletState(provider).catch(() => {
      setError('Unable to read wallet state.');
    });

    if (!provider?.on || !provider?.removeListener) {
      return;
    }

    const handleAccountsChanged = (accounts: unknown) => {
      if (activeSignerSourceRef.current !== 'metamask') {
        return;
      }
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : [];
      const selected = nextAccounts[0] ?? '';
      const selectedWalletKey = selected.trim().toLowerCase();
      const previousWalletKey = walletAddress.trim().toLowerCase();
      const previousFlowInput = { chainId, provider, walletAddress };
      const walletFlowActive = previousWalletKey && isWalletTransactionFlowActive(previousFlowInput);
      if (walletFlowActive && (!selectedWalletKey || selectedWalletKey === previousWalletKey)) {
        return;
      }
      if (walletFlowActive && selectedWalletKey !== previousWalletKey) {
        clearWalletTransactionFlow(previousFlowInput);
      }
      resetBrowserPrivacySessionForWalletChange(selected);
      setWalletAddress(selected);
      setBrowserWalletSession(
        browserWalletSessionRef.current
          ? {
              ...browserWalletSessionRef.current,
              address: selected
            }
          : null
      );
      if (!selected) {
        setStatus('Disconnected');
        setChainId(null);
      }
    };

    const handleChainChanged = (newChainId: unknown) => {
      if (activeSignerSourceRef.current !== 'metamask') {
        return;
      }
      if (walletAddress && isWalletTransactionFlowActive({ chainId, provider, walletAddress })) {
        return;
      }
      if (typeof newChainId === 'string' || typeof newChainId === 'number') {
        if (walletAddress) {
          clearWalletTransactionFlow({ chainId, provider, walletAddress });
        }
        setChainId(normalizeChainId(newChainId));
      }
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [
    activeProvider,
    chainId,
    connectionMethod,
    getConnectedProvider,
    refreshWalletState,
    resetBrowserPrivacySessionForWalletChange,
    setBrowserWalletSession,
    setError,
    walletAddress
  ]);

  return {
    activeProvider,
    activeSignerSource,
    activateBrowserWalletSession,
    adoptBrowserWalletSession,
    browserWalletSession,
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
