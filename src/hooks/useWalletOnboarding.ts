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
  getOrRecoverAesForWallet,
  readFallbackAesSessionOnboardInfo
} from '../lib/cotiAesUnlock';
import type { WalletAesHealthState } from '../lib/cotiAesUnlock';
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
  waitForMetaMaskMobileInjectedWalletOption,
  shouldUseMetaMaskConnectMobile
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
  const onboardInfo = readFallbackAesSessionOnboardInfo(selected, provider);
  return {
    address: selected,
    chainId: normalizedChainId,
    onboardInfo,
    provider,
    source: 'injected',
    walletId: walletOption.id,
    walletLabel: walletOption.label
  };
};

export const readPassiveBrowserWalletRestore = async (
  walletOption: InjectedWalletOption | null | undefined
): Promise<PassiveBrowserWalletRestoreResult | null> => {
  const injectedMetaMaskOption = walletOption
    ? resolveMetaMaskMobileInjectedWalletOption([walletOption])
    : resolveMetaMaskMobileInjectedWalletOption();
  if (injectedMetaMaskOption) {
    return readInjectedPassiveBrowserWalletRestore(injectedMetaMaskOption);
  }

  if (shouldUseMetaMaskConnectMobile({ walletOption })) {
    const delayedInjectedMetaMaskOption = await waitForMetaMaskMobileInjectedWalletOption({
      initialOptions: walletOption ? [walletOption] : undefined
    });
    if (delayedInjectedMetaMaskOption) {
      return readInjectedPassiveBrowserWalletRestore(delayedInjectedMetaMaskOption);
    }

    const session = await readMetaMaskConnectMobileSession();
    if (!session) {
      return null;
    }

    logMetaMaskMobileProviderSelection('connect-evm');
    return {
      ...session,
      onboardInfo: readFallbackAesSessionOnboardInfo(session.address, session.provider),
      source: 'metamask-connect-mobile'
    };
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

  const getConnectedProvider = useCallback((): Eip1193Provider | null => {
    if (connectionMethod === 'metamask') {
      return activeProviderRef.current ?? activeProvider ?? preferredInjectedWalletOption?.provider ?? null;
    }

    return null;
  }, [activeProvider, connectionMethod, preferredInjectedWalletOption?.provider]);

  const ensureCotiNetwork = useCallback((provider: Eip1193Provider) => ensureProviderOnCotiNetwork(provider), []);

  const promoteMetaMaskMobileSessionToInjected = useCallback(
    async (expectedAddress?: string | null): Promise<BrowserWalletSession | null> => {
      const currentSession = browserWalletSessionRef.current;
      const activeProvider = activeProviderRef.current;
      if (currentSession?.source !== 'metamask-connect-mobile' && !isMetaMaskConnectMobileProvider(activeProvider)) {
        return null;
      }

      const injectedOption =
        resolveMetaMaskMobileInjectedWalletOption(injectedWalletOptions) ??
        await waitForMetaMaskMobileInjectedWalletOption({
          initialOptions: injectedWalletOptions,
          timeoutMs: 350
        });
      if (!injectedOption?.provider) {
        return null;
      }

      logMetaMaskMobileProviderSelection('promoted-to-injected', {
        walletId: injectedOption.id
      });
      logMetaMaskMobileRequestMethod('eth_accounts', 'promoted-to-injected', {
        walletId: injectedOption.id
      });
      const accounts = (await injectedOption.provider.request({ method: 'eth_accounts' })) as string[];
      const expectedWalletKey = (expectedAddress || currentSession?.address || currentWalletKeyRef.current)
        .trim()
        .toLowerCase();
      const selected =
        accounts.find((account) => account.toLowerCase() === expectedWalletKey) ??
        (!expectedWalletKey ? accounts[0] : '') ??
        '';
      if (!selected || (expectedWalletKey && selected.toLowerCase() !== expectedWalletKey)) {
        logMobileWalletDiagnostic('metamask-mobile-provider-promotion-skipped', {
          accountsCount: Array.isArray(accounts) ? accounts.length : 0,
          reason: selected ? 'wallet-mismatch' : 'no-authorized-account',
          selected: maskWalletForDiagnostics(selected),
          walletId: injectedOption.id
        });
        return null;
      }

      logMetaMaskMobileRequestMethod('eth_chainId', 'promoted-to-injected', {
        walletId: injectedOption.id
      });
      const currentChain = (await injectedOption.provider.request({ method: 'eth_chainId' })) as string | number;
      const normalizedChainId = normalizeChainId(currentChain);
      const nextSession: BrowserWalletSession = {
        address: selected,
        chainId: normalizedChainId,
        provider: injectedOption.provider,
        source: 'injected',
        walletId: injectedOption.id,
        walletLabel: injectedOption.label
      };

      signerCacheRef.current = {};
      setConnectedProvider(injectedOption.provider);
      setConnectionMethod('metamask');
      setActiveSignerSource('metamask');
      setSelectedInjectedWalletId(injectedOption.id);
      resetBrowserPrivacySessionForWalletChange(selected);
      setWalletAddress(selected);
      setChainId(normalizedChainId);
      setBrowserWalletSession(nextSession);
      saveWalletPreference({ kind: 'browser', browserWalletId: injectedOption.id });
      setStatus(`Connected (${injectedOption.label})`);
      return nextSession;
    },
    [
      injectedWalletOptions,
      resetBrowserPrivacySessionForWalletChange,
      setActiveSignerSource,
      setBrowserWalletSession,
      setConnectedProvider
    ]
  );

  const resolveWalletPromptProvider = useCallback(
    async (providerOverride?: Eip1193Provider | null, expectedAddress?: string | null): Promise<Eip1193Provider | null> => {
      const provider = providerOverride ?? getConnectedProvider();
      if (
        browserWalletSessionRef.current?.source === 'metamask-connect-mobile' ||
        isMetaMaskConnectMobileProvider(provider)
      ) {
        const promotedSession = await promoteMetaMaskMobileSessionToInjected(expectedAddress);
        if (promotedSession?.provider) {
          return promotedSession.provider;
        }
      }
      return provider;
    },
    [getConnectedProvider, promoteMetaMaskMobileSessionToInjected]
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
        provider: promptProvider,
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

      let walletOption =
        (walletId ? injectedWalletOptions.find((option) => option.id === walletId) ?? null : preferredInjectedWalletOption) ??
        preferredInjectedWalletOption;
      if (!walletOption && shouldUseMetaMaskConnectMobile({ walletId, walletOption })) {
        walletOption = await waitForMetaMaskMobileInjectedWalletOption();
      }
      const injectedMetaMaskOption = walletOption
        ? resolveMetaMaskMobileInjectedWalletOption([walletOption])
        : resolveMetaMaskMobileInjectedWalletOption();
      if (injectedMetaMaskOption && (!walletId || walletId === 'metamask' || isMetaMaskConnectMobileWalletId(walletId))) {
        walletOption = injectedMetaMaskOption;
      }
      const useMetaMaskConnectMobile = shouldUseMetaMaskConnectMobile({ walletId, walletOption });
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
        if (useMetaMaskConnectMobile) {
          if (options?.forceAccountPicker) {
            const injectedOption =
              resolveMetaMaskMobileInjectedWalletOption(injectedWalletOptions) ??
              await waitForMetaMaskMobileInjectedWalletOption({
                initialOptions: injectedWalletOptions
              });
            if (injectedOption) {
              return connectAndOnboard(injectedOption.id, options);
            }
          }

          const promotedSession = await promoteMetaMaskMobileSessionToInjected(targetSession.address);
          if (promotedSession) {
            const onboardInfo = options?.preparePrivacy
              ? await onboardAddressAes(promotedSession.address, promotedSession.provider, options)
              : null;
            schedulePostConnectSync(promotedSession.address);
            return onboardInfo;
          }
        }

        if (useMetaMaskConnectMobile && options?.forceAccountPicker) {
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
        const restoredMobileSession = useMetaMaskConnectMobile
          ? await readMetaMaskConnectMobileSession()
          : null;
        const accounts = restoredMobileSession
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

        const activeWalletProvider = restoredMobileSession?.provider ?? targetSession.provider;
        setConnectedProvider(activeWalletProvider);
        setConnectionMethod('metamask');
        setActiveSignerSource('metamask');
        setSelectedInjectedWalletId(targetSession.walletId);
        resetBrowserPrivacySessionForWalletChange(selected);
        setWalletAddress(selected);
        saveWalletPreference({ kind: 'browser', browserWalletId: targetSession.walletId });

        const normalizedChainId =
          restoredMobileSession?.chainId ??
          normalizeChainId((await activeWalletProvider.request({ method: 'eth_chainId' })) as string | number);
        setChainId(normalizedChainId);
        const nextSession = {
          ...targetSession,
          address: selected,
          chainId: normalizedChainId,
          provider: activeWalletProvider
        };
        setBrowserWalletSession(nextSession);
        setStatus(`Connected (${targetSession.walletLabel})`);
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
      injectedWalletOptions,
      onboardAddressAes,
      promoteMetaMaskMobileSessionToInjected,
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
          setOnboardStatus('AES key ready');
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
    status,
    walletAddress
  };
}
