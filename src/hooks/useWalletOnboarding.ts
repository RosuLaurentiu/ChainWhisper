import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  getProviderErrorMessage,
  isProviderActionRejected,
  isProviderRequestAlreadyPending,
  mergeOnboardInfo,
  normalizeChainId,
  type Eip1193Provider,
  type InjectedWalletOption,
  type SignerSource
} from '../lib/appShared';
import { saveWalletPreference } from '../lib/appStorage';
import {
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption
} from '../lib/walletOptions';
import {
  buildWalletAesHealthState,
  clearCotiAesUnlockRequest,
  clearFallbackAesSessionOnboardInfo
} from '../lib/cotiAesUnlock';
import type { WalletAesHealthState } from '../lib/cotiAesUnlock';
import { getCotiSnapOwnerAesKeyResult, getCotiSnapOwnerAesStatusMessage } from '../lib/cotiSnap';
import {
  logMobileWalletDiagnostic,
  maskWalletForDiagnostics
} from '../lib/mobileWalletDiagnostics';
import {
  connectMetaMaskMobile,
  disconnectMetaMaskConnectMobile,
  isMetaMaskConnectMobileProvider,
  isMetaMaskConnectMobileWalletId,
  logMetaMaskMobileProviderSelection,
  logMetaMaskMobileRequestMethod,
  METAMASK_CONNECT_MOBILE_WALLET_ID,
  METAMASK_CONNECT_MOBILE_WALLET_LABEL,
  readMetaMaskConnectMobileSession,
  resolveMetaMaskMobileInjectedWalletOption,
  shouldUseMetaMaskConnectMobile,
  waitForMetaMaskMobileInjectedWalletOption
} from '../lib/metamaskConnectMobile';
import { ensureProviderOnCotiNetwork } from '../lib/walletNetwork';
import {
  clearWalletTransactionFlow,
  isWalletTransactionFlowActive,
  recordWalletTransactionFlowStage,
  shouldIgnoreBrowserWalletAccountsDuringFlow,
  shouldIgnoreBrowserWalletRefreshDuringFlow
} from '../lib/walletTransactionFlow';
import useInjectedWalletOptions from './useInjectedWalletOptions';

type UseWalletOnboardingArgs = {
  allowPassiveBrowserRestore?: boolean;
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
  source?: 'injected' | 'metamask-connect-mobile';
  walletId: string;
  walletLabel: string;
};

type BrowserWalletActivationOptions = {
  forceAccountPicker?: boolean;
  forceFreshPrivacy?: boolean;
  preparePrivacy?: boolean;
};

export type PassiveBrowserWalletRestoreResult = {
  address: string;
  chainId: number | null;
  onboardInfo: OnboardInfo | null;
  provider: Eip1193Provider;
  source?: 'injected' | 'metamask-connect-mobile';
  walletId: string;
  walletLabel: string;
};

const readInjectedPassiveBrowserWalletRestore = async (
  walletOption: InjectedWalletOption
): Promise<PassiveBrowserWalletRestoreResult | null> => {
  const provider = walletOption.provider;
  const source = resolveMetaMaskMobileInjectedWalletOption([walletOption]) ? 'injected-metamask' : null;
  if (source) {
    logMetaMaskMobileProviderSelection(source, {
      walletId: walletOption.id
    });
    logMetaMaskMobileRequestMethod('eth_accounts', source, {
      walletId: walletOption.id
    });
  }

  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
  const selected = accounts[0] ?? '';
  logMobileWalletDiagnostic('passive-restore-accounts', {
    accountsCount: Array.isArray(accounts) ? accounts.length : 0,
    selected: maskWalletForDiagnostics(selected),
    walletId: walletOption.id
  });
  if (!selected) {
    return null;
  }

  if (source) {
    logMetaMaskMobileRequestMethod('eth_chainId', source, {
      walletId: walletOption.id
    });
  }
  const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
  const normalizedChainId = normalizeChainId(currentChain);
  return {
    address: selected,
    chainId: normalizedChainId,
    onboardInfo: null,
    provider,
    source: 'injected',
    walletId: walletOption.id,
    walletLabel: walletOption.label
  };
};

export const readPassiveBrowserWalletRestore = async (
  walletOption: InjectedWalletOption | null | undefined
): Promise<PassiveBrowserWalletRestoreResult | null> => {
  if (shouldUseMetaMaskConnectMobile({ walletOption })) {
    const injectedOption = await waitForMetaMaskMobileInjectedWalletOption({
      initialOptions: walletOption ? [walletOption] : undefined,
      timeoutMs: 3000
    });
    if (injectedOption) {
      try {
        const injectedRestore = await readInjectedPassiveBrowserWalletRestore(injectedOption);
        if (injectedRestore) {
          logMetaMaskMobileProviderSelection('injected-metamask', {
            reason: 'mobile-in-app-restore',
            walletId: injectedOption.id
          });
          return injectedRestore;
        }
      } catch (error) {
        logMobileWalletDiagnostic('mobile-injected-restore-error', {
          message: error instanceof Error ? error.message : String(error),
          walletId: injectedOption.id
        });
      }
    }

    if (injectedOption) {
      return null;
    }

    try {
      const session = await readMetaMaskConnectMobileSession();
      if (session) {
        logMetaMaskMobileProviderSelection('connect-evm', {
          reason: injectedOption ? 'mobile-injected-not-authorized' : 'mobile-injected-unavailable'
        });
        return {
          ...session,
          onboardInfo: null,
          source: 'metamask-connect-mobile'
        };
      }
    } catch (error) {
      logMobileWalletDiagnostic('metamask-connect-session-restore-error', {
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return null;
  }

  const injectedMetaMaskOption = walletOption
    ? resolveMetaMaskMobileInjectedWalletOption([walletOption])
    : resolveMetaMaskMobileInjectedWalletOption();
  if (injectedMetaMaskOption) {
    return readInjectedPassiveBrowserWalletRestore(injectedMetaMaskOption);
  }

  const provider = walletOption?.provider ?? null;
  if (!walletOption || !provider) {
    return null;
  }

  return readInjectedPassiveBrowserWalletRestore(walletOption);
};

export function useWalletOnboarding({
  allowPassiveBrowserRestore = true,
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
  const chainIdRef = useRef<number | null>(null);
  const passiveRestoreInFlightRef = useRef(false);
  const signerCacheRef = useRef<Record<string, JsonRpcSigner>>({});
  const signerProviderCacheRef = useRef<Record<string, Eip1193Provider>>({});
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
    chainIdRef.current = chainId;
  }, [chainId]);

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
    if (activeProviderRef.current !== provider) {
      signerCacheRef.current = {};
      signerProviderCacheRef.current = {};
    }
    activeProviderRef.current = provider;
    setActiveProvider(provider);
  }, []);

  const setBrowserWalletSession = useCallback((session: BrowserWalletSession | null) => {
    browserWalletSessionRef.current = session;
    setBrowserWalletSessionState(session);
  }, []);

  const schedulePostConnectSync = useCallback(
    (selected: string) => {
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
    },
    [loadMyNicknameFromChainRef, runPostConnectDataSyncUntilAppliedRef, setMyNickname]
  );

  const resetBrowserPrivacySessionForWalletChange = useCallback((nextAddress: string) => {
    const nextWalletKey = nextAddress.trim().toLowerCase();
    const previousWalletKey = currentWalletKeyRef.current;
    if (nextWalletKey === previousWalletKey) {
      return;
    }

    if (previousWalletKey) {
      clearCotiAesUnlockRequest(previousWalletKey, activeProviderRef.current);
      clearFallbackAesSessionOnboardInfo(previousWalletKey);
    }
    if (nextWalletKey) {
      clearCotiAesUnlockRequest(nextWalletKey, activeProviderRef.current);
      if (previousWalletKey) {
        clearFallbackAesSessionOnboardInfo(nextWalletKey);
      }
    }
    signerCacheRef.current = {};
    signerProviderCacheRef.current = {};
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

  const getConnectedProvider = useCallback((): Eip1193Provider | null => {
    if (connectionMethod === 'metamask') {
      return activeProviderRef.current ?? activeProvider ?? preferredInjectedWalletOption?.provider ?? null;
    }

    return null;
  }, [activeProvider, connectionMethod, preferredInjectedWalletOption?.provider]);

  const ensureCotiNetwork = useCallback((provider: Eip1193Provider) => ensureProviderOnCotiNetwork(provider), []);

  const resolveWalletPromptProvider = useCallback(
    async (providerOverride?: Eip1193Provider | null, expectedAddress?: string | null): Promise<Eip1193Provider | null> => {
      const provider = providerOverride ?? getConnectedProvider();
      if (
        browserWalletSessionRef.current?.source === 'metamask-connect-mobile' ||
        isMetaMaskConnectMobileProvider(provider)
      ) {
        const injectedOption = await waitForMetaMaskMobileInjectedWalletOption({
          timeoutMs: 1500
        });
        if (injectedOption?.provider) {
          try {
            logMetaMaskMobileRequestMethod('eth_accounts', 'injected-metamask', {
              reason: 'mobile-in-app-signing',
              walletId: injectedOption.id
            });
            const accounts = (await injectedOption.provider.request({ method: 'eth_accounts' })) as string[];
            const expectedWalletKey = expectedAddress?.trim().toLowerCase() ?? '';
            const hasUsableAccount = expectedWalletKey
              ? accounts.some((account) => account.toLowerCase() === expectedWalletKey)
              : accounts.length > 0;
            if (hasUsableAccount) {
              logMetaMaskMobileProviderSelection('injected-metamask', {
                reason: 'mobile-in-app-signing',
                walletId: injectedOption.id
              });
              return injectedOption.provider;
            }
            logMobileWalletDiagnostic('mobile-injected-signing-unavailable', {
              accountsCount: Array.isArray(accounts) ? accounts.length : 0,
              expected: maskWalletForDiagnostics(expectedAddress ?? ''),
              walletId: injectedOption.id
            });
          } catch (error) {
            logMobileWalletDiagnostic('mobile-injected-signing-error', {
              message: error instanceof Error ? error.message : String(error),
              walletId: injectedOption.id
            });
          }
        }
        if (injectedOption) {
          throw new Error('MetaMask Mobile is not authorized for this dapp tab. Tap Connect MetaMask again before signing.');
        }
        if (isMetaMaskConnectMobileProvider(provider)) {
          throw new Error('MetaMask Mobile injected provider was not ready. Reopen this page from MetaMask Mobile and try again.');
        }
        logMetaMaskMobileProviderSelection('connect-evm', {
          reason: 'mobile-injected-missing',
          walletId: browserWalletSessionRef.current?.walletId ?? METAMASK_CONNECT_MOBILE_WALLET_ID
        });
        return browserWalletSessionRef.current?.provider ?? provider;
      }
      return provider;
    },
    [getConnectedProvider]
  );

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
      const previousWalletKey = currentWalletKeyRef.current;
      const activeChainId = chainIdRef.current;
      const providerKey = browserWalletSessionRef.current?.walletId || currentInjectedWalletOption?.id || selectedInjectedWalletId;
      const previousFlowInput = {
        chainId: activeChainId,
        provider,
        providerKey,
        walletAddress: previousWalletKey
      };
      const walletFlowActive =
        Boolean(previousWalletKey && isWalletTransactionFlowActive(previousFlowInput)) ||
        isWalletTransactionFlowActive();
      if (
        shouldIgnoreBrowserWalletRefreshDuringFlow({
          previousWalletKey,
          selectedWalletKey: selected,
          walletFlowActive
        })
      ) {
        recordWalletTransactionFlowStage(previousFlowInput, 'accounts-refresh-ignored-during-flow');
        return;
      }
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
    [
      currentInjectedWalletOption?.id,
      getConnectedProvider,
      resetBrowserPrivacySessionForWalletChange,
      selectedInjectedWalletId
    ]
  );

  const onboardAddressAes = useCallback(
    async (address: string, provider: Eip1193Provider, options?: BrowserWalletActivationOptions): Promise<OnboardInfo> => {
      if (!provider) {
        throw new Error('Wallet provider is not available.');
      }

      const promptProvider = await resolveWalletPromptProvider(provider, address);
      if (!promptProvider) {
        throw new Error('Wallet provider is not available.');
      }

      setOnboardStatus('Onboarding...');
      await ensureCotiNetwork(promptProvider);

      const browserProvider = await createCotiBrowserProvider(promptProvider);

      const cacheKey = address.toLowerCase();
      const currentAesHealth = walletAesHealthByAddress[cacheKey]?.status;
      const forceFreshPrivacy = Boolean(options?.forceFreshPrivacy);
      const refreshMismatch =
        forceFreshPrivacy || currentAesHealth === 'key-mismatch' || currentAesHealth === 'repair-needed';
      if (refreshMismatch) {
        clearCotiAesUnlockRequest(address, promptProvider);
        setSessionOnboardInfo((previous) => {
          if (!previous[cacheKey]) {
            return previous;
          }
          const next = { ...previous };
          delete next[cacheKey];
          return next;
        });
      }
      let signer = signerCacheRef.current[cacheKey] as JsonRpcSigner | undefined;
      if (signer && signerProviderCacheRef.current[cacheKey] !== promptProvider) {
        delete signerCacheRef.current[cacheKey];
        delete signerProviderCacheRef.current[cacheKey];
        signer = undefined;
      }
      if (!signer) {
        signer = await browserProvider.getSigner(address, refreshMismatch ? undefined : sessionOnboardInfo[cacheKey]);
        signerCacheRef.current[cacheKey] = signer;
        signerProviderCacheRef.current[cacheKey] = promptProvider;
      } else if (!refreshMismatch && sessionOnboardInfo[cacheKey]) {
        signer.setUserOnboardInfo(sessionOnboardInfo[cacheKey]);
      }
      signer.disableAutoOnboard();

      if (refreshMismatch) {
        onWalletAesHealthChange?.(
          address,
          buildWalletAesHealthState({
            status: 'repairing',
            walletAddress: address
          })
        );
      }
      const snapAesResult = await getCotiSnapOwnerAesKeyResult(promptProvider, address);
      if (snapAesResult.status !== 'ready') {
        throw new Error(getCotiSnapOwnerAesStatusMessage(snapAesResult.status));
      }

      const onboardInfo = mergeOnboardInfo(signer.getUserOnboardInfo(), { aesKey: snapAesResult.aesKey } as OnboardInfo);
      signer.setUserOnboardInfo(onboardInfo);
      const aesKey = onboardInfo.aesKey ?? '';
      if (!aesKey) {
        throw new Error('Privacy unlock was not returned during onboarding.');
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

      setOnboardStatus('Owner privacy ready');
      return onboardInfo;
    },
    [
      ensureCotiNetwork,
      onWalletAesHealthChange,
      resolveWalletPromptProvider,
      sessionOnboardInfo,
      walletAesHealthByAddress
    ]
  );

  const connectAndOnboard = useCallback(
    async (walletId?: string, options?: BrowserWalletActivationOptions): Promise<OnboardInfo | null> => {
      setError('');
      setConnectingMethod('metamask');

      let walletOption = walletId
        ? injectedWalletOptions.find((option) => option.id === walletId) ?? null
        : preferredInjectedWalletOption;
      if (!walletOption && walletId !== 'metamask' && !isMetaMaskConnectMobileWalletId(walletId)) {
        walletOption = preferredInjectedWalletOption;
      }
      const useMetaMaskConnectMobileContext = shouldUseMetaMaskConnectMobile({ walletId, walletOption });
      const mobileInjectedOption = useMetaMaskConnectMobileContext
        ? await waitForMetaMaskMobileInjectedWalletOption({
            initialOptions: walletOption ? [walletOption] : undefined,
            timeoutMs: 3000
          })
        : null;
      const useMetaMaskConnectMobile = useMetaMaskConnectMobileContext && !mobileInjectedOption;
      if (mobileInjectedOption) {
        walletOption = mobileInjectedOption;
      } else if (!useMetaMaskConnectMobileContext) {
        const injectedMetaMaskOption = walletOption
          ? resolveMetaMaskMobileInjectedWalletOption([walletOption])
          : resolveMetaMaskMobileInjectedWalletOption();
        if (injectedMetaMaskOption && (!walletId || walletId === 'metamask' || isMetaMaskConnectMobileWalletId(walletId))) {
          walletOption = injectedMetaMaskOption;
        }
      }
      const provider = walletOption?.provider ?? null;
      const walletLabel = useMetaMaskConnectMobile
        ? METAMASK_CONNECT_MOBILE_WALLET_LABEL
        : walletOption?.label ?? 'Wallet';
      setConnectingWalletLabel(walletLabel);
      if (!provider && !useMetaMaskConnectMobile) {
        setError('MetaMask or CypherTrade is required to continue.');
        setConnectingMethod(null);
        setConnectingWalletLabel('');
        return null;
      }

      try {
        setStatus(`Connecting ${walletLabel}...`);
        const mobileSession = useMetaMaskConnectMobile
          ? await connectMetaMaskMobile({ forceAccountPicker: options?.forceAccountPicker })
          : null;
        const activeWalletProvider = mobileSession?.provider ?? provider;
        if (!activeWalletProvider) {
          throw new Error('Wallet provider is not available.');
        }
        const usingInjectedMetaMaskMobile = Boolean(
          !mobileSession && walletOption && resolveMetaMaskMobileInjectedWalletOption([walletOption])
        );
        if (!mobileSession && options?.forceAccountPicker && !usingInjectedMetaMaskMobile) {
          await activeWalletProvider
            .request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }]
            })
            .catch(() => null);
        }
        if (usingInjectedMetaMaskMobile && walletOption) {
          logMetaMaskMobileProviderSelection('injected-metamask', {
            walletId: walletOption.id
          });
          logMetaMaskMobileRequestMethod('eth_requestAccounts', 'injected-metamask', {
            walletId: walletOption.id
          });
        }
        const accounts = mobileSession
          ? [mobileSession.address]
          : ((await activeWalletProvider.request({ method: 'eth_requestAccounts' })) as string[]);
        const selected = accounts[0] ?? '';

        if (!selected) {
          throw new Error('No wallet account selected.');
        }

        const nextWalletId = mobileSession?.walletId ?? walletOption?.id ?? walletId ?? '';
        if (nextWalletId) {
          setSelectedInjectedWalletId(nextWalletId);
        }
        setConnectedProvider(activeWalletProvider);
        setConnectionMethod('metamask');
        setActiveSignerSource('metamask');
        resetBrowserPrivacySessionForWalletChange(selected);
        setWalletAddress(selected);
        saveWalletPreference({ kind: 'browser', browserWalletId: nextWalletId || walletOption?.id });

        if (usingInjectedMetaMaskMobile && walletOption) {
          logMetaMaskMobileRequestMethod('eth_chainId', 'injected-metamask', {
            walletId: walletOption.id
          });
        }
        const normalizedChainId =
          mobileSession?.chainId ??
          normalizeChainId((await activeWalletProvider.request({ method: 'eth_chainId' })) as string | number);
        setChainId(normalizedChainId);
        setBrowserWalletSession({
          address: selected,
          chainId: normalizedChainId,
          provider: activeWalletProvider,
          source: mobileSession ? 'metamask-connect-mobile' : 'injected',
          walletId: nextWalletId,
          walletLabel
        });
        setStatus(`Connected (${walletLabel})`);
        const onboardInfo = options?.preparePrivacy ? await onboardAddressAes(selected, activeWalletProvider, options) : null;
        schedulePostConnectSync(selected);
        return onboardInfo;
      } catch (connectionError) {
        const message = getProviderErrorMessage(connectionError, 'Failed to connect wallet.');
        setError(message);
        if (!isProviderRequestAlreadyPending(connectionError) && !isProviderActionRejected(connectionError)) {
          setStatus('Disconnected');
          setOnboardStatus('Not onboarded');
        }
        return null;
      } finally {
        setConnectingMethod(null);
        setConnectingWalletLabel('');
      }
    },
    [
      injectedWalletOptions,
      onboardAddressAes,
      preferredInjectedWalletOption,
      resetBrowserPrivacySessionForWalletChange,
      schedulePostConnectSync,
      setBrowserWalletSession,
      setConnectedProvider,
      setError,
    ]
  );

  const activateBrowserWalletSession = useCallback(
    async (walletId?: string, options?: BrowserWalletActivationOptions) => {
      const storedSession = browserWalletSessionRef.current;
      const targetSession =
        storedSession &&
        (!walletId ||
          storedSession.walletId === walletId ||
          (isMetaMaskConnectMobileWalletId(storedSession.walletId) && walletId === 'metamask'))
          ? storedSession
          : null;

      if (!targetSession) {
        return connectAndOnboard(walletId, options);
      }

      setError('');
      setConnectingMethod('metamask');
      setConnectingWalletLabel(targetSession.walletLabel);

      try {
        const useMetaMaskConnectMobile = targetSession.source === 'metamask-connect-mobile';
        if (useMetaMaskConnectMobile && options?.forceAccountPicker) {
          const injectedOption = await waitForMetaMaskMobileInjectedWalletOption({
            timeoutMs: 3000
          });
          if (injectedOption?.provider) {
            logMetaMaskMobileProviderSelection('injected-metamask', {
              reason: 'mobile-in-app-force-account-picker',
              walletId: injectedOption.id
            });
            logMetaMaskMobileRequestMethod('eth_requestAccounts', 'injected-metamask', {
              walletId: injectedOption.id
            });
            const accounts = (await injectedOption.provider.request({ method: 'eth_requestAccounts' })) as string[];
            const selected = accounts[0] ?? '';
            if (!selected) {
              throw new Error('No wallet account selected.');
            }
            setConnectedProvider(injectedOption.provider);
            setConnectionMethod('metamask');
            setActiveSignerSource('metamask');
            setSelectedInjectedWalletId(injectedOption.id);
            resetBrowserPrivacySessionForWalletChange(selected);
            setWalletAddress(selected);
            saveWalletPreference({ kind: 'browser', browserWalletId: injectedOption.id });
            logMetaMaskMobileRequestMethod('eth_chainId', 'injected-metamask', {
              walletId: injectedOption.id
            });
            const normalizedChainId = normalizeChainId(
              (await injectedOption.provider.request({ method: 'eth_chainId' })) as string | number
            );
            setChainId(normalizedChainId);
            setBrowserWalletSession({
              address: selected,
              chainId: normalizedChainId,
              provider: injectedOption.provider,
              source: 'injected',
              walletId: injectedOption.id,
              walletLabel: injectedOption.label
            });
            setStatus(`Connected (${injectedOption.label})`);
            const onboardInfo = options?.preparePrivacy
              ? await onboardAddressAes(selected, injectedOption.provider, options)
              : null;
            schedulePostConnectSync(selected);
            return onboardInfo;
          }

          const mobileSession = await connectMetaMaskMobile({ forceAccountPicker: true });
          const selected = mobileSession.address;
          setConnectedProvider(mobileSession.provider);
          setConnectionMethod('metamask');
          setActiveSignerSource('metamask');
          setSelectedInjectedWalletId(mobileSession.walletId);
          resetBrowserPrivacySessionForWalletChange(selected);
          setWalletAddress(selected);
          saveWalletPreference({ kind: 'browser', browserWalletId: mobileSession.walletId });
          setChainId(mobileSession.chainId);
          setBrowserWalletSession({
            ...mobileSession,
            source: 'metamask-connect-mobile'
          });
          setStatus(`Connected (${mobileSession.walletLabel})`);
          const onboardInfo = options?.preparePrivacy
            ? await onboardAddressAes(selected, mobileSession.provider, options)
            : null;
          schedulePostConnectSync(selected);
          return onboardInfo;
        }

        if (!useMetaMaskConnectMobile && options?.forceAccountPicker) {
          await targetSession.provider
            .request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }]
            })
            .catch(() => null);
        }
        const restoredInjectedSession = useMetaMaskConnectMobile
          ? await (async () => {
              const injectedOption = await waitForMetaMaskMobileInjectedWalletOption({
                timeoutMs: 3000
              });
              return injectedOption ? readInjectedPassiveBrowserWalletRestore(injectedOption) : null;
            })()
          : null;
        const restoredMobileSession = useMetaMaskConnectMobile && !restoredInjectedSession
          ? await readMetaMaskConnectMobileSession()
          : null;
        const accounts = restoredInjectedSession
          ? [restoredInjectedSession.address]
          : restoredMobileSession
          ? [restoredMobileSession.address]
          : ((await targetSession.provider.request({
              method: options?.forceAccountPicker ? 'eth_requestAccounts' : 'eth_accounts'
            })) as string[]);
        const selected =
          accounts.find((account) => account.toLowerCase() === targetSession.address.toLowerCase()) ?? accounts[0] ?? '';
        if (!selected) {
          setConnectingMethod(null);
          setConnectingWalletLabel('');
          return connectAndOnboard(targetSession.walletId || walletId, options);
        }

        const activeWalletProvider = restoredInjectedSession?.provider ?? restoredMobileSession?.provider ?? targetSession.provider;
        const activeWalletId = restoredInjectedSession?.walletId ?? restoredMobileSession?.walletId ?? targetSession.walletId;
        const activeWalletLabel = restoredInjectedSession?.walletLabel ?? restoredMobileSession?.walletLabel ?? targetSession.walletLabel;
        setConnectedProvider(activeWalletProvider);
        setConnectionMethod('metamask');
        setActiveSignerSource('metamask');
        setSelectedInjectedWalletId(activeWalletId);
        resetBrowserPrivacySessionForWalletChange(selected);
        setWalletAddress(selected);
        saveWalletPreference({ kind: 'browser', browserWalletId: activeWalletId });

        const normalizedChainId =
          restoredInjectedSession?.chainId ??
          restoredMobileSession?.chainId ??
          normalizeChainId((await activeWalletProvider.request({ method: 'eth_chainId' })) as string | number);
        setChainId(normalizedChainId);
        const nextSession = {
          ...targetSession,
          address: selected,
          chainId: normalizedChainId,
          provider: activeWalletProvider,
          source: restoredInjectedSession
            ? 'injected' as const
            : restoredMobileSession
              ? 'metamask-connect-mobile' as const
              : targetSession.source,
          walletId: activeWalletId,
          walletLabel: activeWalletLabel
        };
        setBrowserWalletSession(nextSession);
        setStatus(`Connected (${activeWalletLabel})`);
        const onboardInfo = options?.preparePrivacy
          ? await onboardAddressAes(selected, activeWalletProvider, options)
          : null;

        schedulePostConnectSync(selected);
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
      onboardAddressAes,
      resetBrowserPrivacySessionForWalletChange,
      schedulePostConnectSync,
      setBrowserWalletSession,
      setConnectedProvider,
      setError,
    ]
  );

  const disconnectWallet = useCallback(async () => {
    setError('');
    setConnectingWalletLabel('');

    resetBurnerSessionRef.current();

    const provider = getConnectedProvider();

    try {
      if (connectionMethod === 'metamask' && provider) {
        if (isMetaMaskConnectMobileProvider(provider)) {
          await disconnectMetaMaskConnectMobile();
        } else {
          await provider.request({
            method: 'wallet_revokePermissions',
            params: [{ eth_accounts: {} }]
          });
        }
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
    signerProviderCacheRef.current = {};
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
    if (
      passiveRestoreInFlightRef.current ||
      !allowPassiveBrowserRestore ||
      connectingMethod ||
      browserWalletSessionRef.current ||
      currentWalletKeyRef.current ||
      activeSignerSourceRef.current !== 'burner'
    ) {
      return;
    }

    const walletOption = preferredInjectedWalletOption;
    const useMetaMaskConnectMobile = shouldUseMetaMaskConnectMobile({ walletOption });
    const hasGlobalInjectedMetaMask = Boolean(resolveMetaMaskMobileInjectedWalletOption());
    if (!walletOption?.provider && !useMetaMaskConnectMobile && !hasGlobalInjectedMetaMask) {
      return;
    }

    let cancelled = false;
    passiveRestoreInFlightRef.current = true;
    if (useMetaMaskConnectMobile) {
      setStatus('Restoring MetaMask Mobile...');
    }
    logMobileWalletDiagnostic('passive-restore-start', {
      walletId: useMetaMaskConnectMobile ? METAMASK_CONNECT_MOBILE_WALLET_ID : walletOption?.id ?? ''
    });

    readPassiveBrowserWalletRestore(walletOption)
      .then((restore) => {
        if (cancelled || !restore) {
          if (!restore) {
            logMobileWalletDiagnostic('passive-restore-empty', {
              walletId: useMetaMaskConnectMobile ? METAMASK_CONNECT_MOBILE_WALLET_ID : walletOption?.id ?? ''
            });
            if (useMetaMaskConnectMobile) {
              setStatus('Disconnected');
            }
          }
          return;
        }

        const walletKey = restore.address.toLowerCase();
        setConnectedProvider(restore.provider);
        setConnectionMethod('metamask');
        setActiveSignerSource('metamask');
        setSelectedInjectedWalletId(restore.walletId);
        resetBrowserPrivacySessionForWalletChange(restore.address);
        setWalletAddress(restore.address);
        setChainId(restore.chainId);
        setBrowserWalletSession({
          address: restore.address,
          chainId: restore.chainId,
          provider: restore.provider,
          source: restore.source,
          walletId: restore.walletId,
          walletLabel: restore.walletLabel
        });
        saveWalletPreference({ kind: 'browser', browserWalletId: restore.walletId });
        setStatus(`Connected (${restore.walletLabel})`);

        if (restore.onboardInfo?.aesKey && restore.chainId === COTI_NETWORK.chainIdDecimal) {
          setSessionOnboardInfo((previous) => ({
            ...previous,
            [walletKey]: mergeOnboardInfo(previous[walletKey], restore.onboardInfo ?? undefined)
          }));
          onWalletAesHealthChange?.(
            restore.address,
            buildWalletAesHealthState({
              status: 'ready-unverified',
              walletAddress: restore.address
            })
          );
          setOnboardStatus('Privacy ready');
        }

        logMobileWalletDiagnostic('passive-restore-connected', {
          chainId: restore.chainId,
          hasFallbackAes: Boolean(restore.onboardInfo?.aesKey),
          selected: maskWalletForDiagnostics(restore.address),
          walletId: restore.walletId
        });
        schedulePostConnectSync(restore.address);
      })
      .catch((error) => {
        logMobileWalletDiagnostic('passive-restore-error', {
          message: error instanceof Error ? error.message : String(error),
          walletId: useMetaMaskConnectMobile ? METAMASK_CONNECT_MOBILE_WALLET_ID : walletOption?.id ?? ''
        });
        if (useMetaMaskConnectMobile) {
          setStatus('Disconnected');
        }
      })
      .finally(() => {
        passiveRestoreInFlightRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [
    allowPassiveBrowserRestore,
    connectingMethod,
    onWalletAesHealthChange,
    preferredInjectedWalletOption,
    resetBrowserPrivacySessionForWalletChange,
    schedulePostConnectSync,
    setActiveSignerSource,
    setBrowserWalletSession,
    setConnectedProvider
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
      const previousWalletKey = currentWalletKeyRef.current;
      const activeChainId = chainIdRef.current;
      const providerKey =
        browserWalletSessionRef.current?.walletId || currentInjectedWalletOption?.id || selectedInjectedWalletId;
      const previousFlowInput = {
        chainId: activeChainId,
        provider,
        providerKey,
        walletAddress: previousWalletKey
      };
      const walletFlowActive =
        Boolean(previousWalletKey && isWalletTransactionFlowActive(previousFlowInput)) ||
        isWalletTransactionFlowActive();
      if (shouldIgnoreBrowserWalletAccountsDuringFlow({ previousWalletKey, walletFlowActive })) {
        recordWalletTransactionFlowStage(previousFlowInput, 'accounts-event-ignored-during-flow');
        return;
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
      const activeWalletKey = currentWalletKeyRef.current;
      const activeChainId = chainIdRef.current;
      const providerKey =
        browserWalletSessionRef.current?.walletId || currentInjectedWalletOption?.id || selectedInjectedWalletId;
      const activeFlowInput = {
        chainId: activeChainId,
        provider,
        providerKey,
        walletAddress: activeWalletKey
      };
      if (activeWalletKey && (isWalletTransactionFlowActive(activeFlowInput) || isWalletTransactionFlowActive())) {
        recordWalletTransactionFlowStage(
          activeFlowInput,
          'chain-change-ignored-during-flow'
        );
        return;
      }
      if (typeof newChainId === 'string' || typeof newChainId === 'number') {
        if (activeWalletKey) {
          clearWalletTransactionFlow({
            chainId: activeChainId,
            provider,
            providerKey,
            walletAddress: activeWalletKey
          });
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
    getConnectedProvider,
    currentInjectedWalletOption?.id,
    refreshWalletState,
    resetBrowserPrivacySessionForWalletChange,
    selectedInjectedWalletId,
    setBrowserWalletSession,
    setError
  ]);

  return {
    activeProvider,
    activeSignerSource,
    activateBrowserWalletSession,
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
    resolveWalletPromptProvider,
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
    signerProviderCacheRef,
    status,
    walletAddress
  };
}
