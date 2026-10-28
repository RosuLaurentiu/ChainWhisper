import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  createCotiBrowserProvider,
  getProviderErrorMessage,
  isProviderActionRejected,
  isProviderRequestAlreadyPending,
  loadCotiReadProvider,
  mergeOnboardInfo,
  normalizeChainId,
  PROVIDER_RPC_UNAVAILABLE_MESSAGE,
  type Eip1193Provider,
  type InjectedWalletOption,
  type SignerSource
} from '../../../lib/appShared';
import { saveWalletPreference } from '../../../lib/appStorage';
import {
  filterAllowedBrowserWalletOptions,
  getPreferredInjectedWalletOption,
  isCypherTradeWalletOption
} from '../../../lib/walletOptions';
import {
  buildWalletAesHealthState,
  clearCotiAesUnlockRequest,
  clearFallbackAesSessionOnboardInfo,
  getOrRecoverAesForWalletResult,
  type PrivacyUnlockResult
} from '../../../lib/cotiAesUnlock';
import type { WalletAesHealthState } from '../../../lib/cotiAesUnlock';
import { getCotiSnapOwnerAesStatusMessage } from '../../../lib/cotiSnap';
import {
  logMobileWalletDiagnostic,
  maskWalletForDiagnostics
} from '../../../lib/mobileWalletDiagnostics';
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
} from '../../../lib/metamaskConnectMobile';
import {
  CIPHERTRADE_WALLETCONNECT_WALLET_ID,
  connectCipherTradeWalletConnect,
  discardCipherTradeWalletConnectProvider,
  disconnectCipherTradeWalletConnect,
  forgetCipherTradeWalletConnectProvider,
  isCipherTradeWalletConnectProvider
} from '../../../lib/walletConnectMobile';
import {
  ensureProviderOnCotiNetwork,
  ensureProviderOnNetworkAndVerifyOwner
} from '../../../lib/walletNetwork';
import {
  clearWalletTransactionFlow,
  isWalletTransactionFlowActive,
  isWalletTransactionPromptActive,
  recordWalletTransactionFlowStage,
  shouldDeferBrowserWalletChainRefreshDuringPrompt,
  shouldIgnoreBrowserWalletRefreshDuringFlow
} from '../../../lib/walletTransactionFlow';
import useInjectedWalletOptions from './useInjectedWalletOptions';
import { createLeaseGuardedEip1193Provider } from './useSharedWalletSigner';

type UseWalletOnboardingArgs = {
  allowPassiveBrowserRestore?: boolean;
  loadMyNicknameFromChainRef: MutableRefObject<(address: string) => Promise<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setMyNickname: Dispatch<SetStateAction<string>>;
  onWalletAesHealthChange?: (walletAddress: string, health: WalletAesHealthState) => void;
  walletAesHealthByAddress?: Record<string, WalletAesHealthState>;
};

export type BrowserWalletSession = {
  address: string;
  chainId: number | null;
  provider: Eip1193Provider;
  source?: 'injected' | 'metamask-connect-mobile' | 'walletconnect';
  walletId: string;
  walletLabel: string;
};

export type BrowserWalletSignerLease = Readonly<{
  activeAddress: string;
  activeChainId: number | null;
  activeProvider: Eip1193Provider | null;
  activeSignerSource: SignerSource;
  address: string;
  chainId: number | null;
  epoch: number;
  session: BrowserWalletSession;
  sessionProvider: Eip1193Provider;
  signingProvider: Eip1193Provider;
  source: BrowserWalletSession['source'];
}>;

export type BrowserWalletSignerLeaseState = {
  activeProvider: Eip1193Provider | null;
  activeSignerSource: SignerSource;
  address: string;
  chainId: number | null;
  epoch: number;
  session: BrowserWalletSession | null;
};

export const resolveCachedBrowserWalletReadSigner = ({
  assertSnapshotCurrent,
  cachedProvider,
  expectedAddress,
  requirePrivacy,
  signer
}: {
  assertSnapshotCurrent: () => void;
  cachedProvider: Eip1193Provider | undefined;
  expectedAddress: string;
  requirePrivacy: boolean;
  signer: JsonRpcSigner | undefined;
}): JsonRpcSigner => {
  assertSnapshotCurrent();
  if (!signer || !cachedProvider) {
    throw new Error('Unlock privacy before reading encrypted wallet data.');
  }
  if (signer.address.trim().toLowerCase() !== expectedAddress.trim().toLowerCase()) {
    throw new Error(BROWSER_WALLET_SIGNER_LEASE_EXPIRED);
  }
  if (requirePrivacy && !signer.getUserOnboardInfo()?.aesKey) {
    throw new Error('Unlock privacy before reading encrypted wallet data.');
  }
  assertSnapshotCurrent();
  return signer;
};

export const BROWSER_WALLET_SIGNER_LEASE_EXPIRED =
  'Owner wallet session changed. Reconnect the owner wallet and try again.';

type BrowserWalletSignerLeaseMismatch =
  | 'active-address'
  | 'active-chain'
  | 'active-provider'
  | 'active-source'
  | 'lifecycle-epoch'
  | 'live-account'
  | 'live-chain'
  | 'owner-session-binding'
  | 'session-address'
  | 'session-chain'
  | 'session-missing'
  | 'session-provider'
  | 'session-source';

const expiredBrowserWalletSignerLease = (
  mismatch: BrowserWalletSignerLeaseMismatch
): Error => new Error(`${BROWSER_WALLET_SIGNER_LEASE_EXPIRED} [${mismatch}]`);

export const assertBrowserWalletSignerLeaseState = (
  lease: BrowserWalletSignerLease,
  current: BrowserWalletSignerLeaseState
): void => {
  if (current.activeProvider !== lease.activeProvider) {
    throw expiredBrowserWalletSignerLease('active-provider');
  }
  if (current.activeSignerSource !== lease.activeSignerSource) {
    throw expiredBrowserWalletSignerLease('active-source');
  }
  if (current.address.trim().toLowerCase() !== lease.activeAddress) {
    throw expiredBrowserWalletSignerLease('active-address');
  }
  if (current.chainId !== lease.activeChainId) {
    throw expiredBrowserWalletSignerLease('active-chain');
  }
  if (current.epoch !== lease.epoch) {
    throw expiredBrowserWalletSignerLease('lifecycle-epoch');
  }
  if (!current.session) {
    throw expiredBrowserWalletSignerLease('session-missing');
  }
  if (current.session.provider !== lease.sessionProvider) {
    throw expiredBrowserWalletSignerLease('session-provider');
  }
  if (current.session.address.trim().toLowerCase() !== lease.address) {
    throw expiredBrowserWalletSignerLease('session-address');
  }
  if (current.session.chainId !== lease.chainId) {
    throw expiredBrowserWalletSignerLease('session-chain');
  }
  if (current.session.source !== lease.source) {
    throw expiredBrowserWalletSignerLease('session-source');
  }
  if (lease.session.provider !== lease.sessionProvider) {
    throw expiredBrowserWalletSignerLease('session-provider');
  }
  if (lease.session.address.trim().toLowerCase() !== lease.address) {
    throw expiredBrowserWalletSignerLease('session-address');
  }
  if (lease.session.chainId !== lease.chainId) {
    throw expiredBrowserWalletSignerLease('session-chain');
  }
  if (lease.session.source !== lease.source) {
    throw expiredBrowserWalletSignerLease('session-source');
  }
  if (
    lease.activeSignerSource === 'metamask' &&
    (
      lease.activeProvider !== lease.sessionProvider ||
      lease.activeAddress !== lease.address ||
      lease.activeChainId !== lease.chainId
    )
  ) {
    throw expiredBrowserWalletSignerLease('owner-session-binding');
  }
};

export const assertLiveBrowserWalletSignerLease = async (
  lease: BrowserWalletSignerLease,
  assertCurrent: () => void
): Promise<void> => {
  assertCurrent();
  const accounts = await lease.signingProvider.request({ method: 'eth_accounts' });
  assertCurrent();
  const selectedAccount = Array.isArray(accounts) && typeof accounts[0] === 'string'
    ? accounts[0].trim().toLowerCase()
    : '';
  if (selectedAccount !== lease.address) {
    throw expiredBrowserWalletSignerLease('live-account');
  }

  const liveChainId = await lease.signingProvider.request({ method: 'eth_chainId' });
  assertCurrent();
  if (
    (typeof liveChainId !== 'string' && typeof liveChainId !== 'number') ||
    normalizeChainId(liveChainId) !== lease.chainId
  ) {
    throw expiredBrowserWalletSignerLease('live-chain');
  }
};

type BrowserWalletActivationOptions = {
  forceAccountPicker?: boolean;
  forceFreshPrivacy?: boolean;
  preparePrivacy?: boolean;
};

export const buildOwnerPrivacyUnlockOptions = (
  refreshMismatch: boolean,
  walletRequiresSnap = true
) => ({
  allowLegacyFallback: !walletRequiresSnap,
  allowUnrecoverableReset: refreshMismatch,
  forceFreshAes: refreshMismatch,
  forceLegacyRefresh: refreshMismatch,
  forceRefresh: refreshMismatch,
  preferSnapAes: walletRequiresSnap,
  probeSnapAes: walletRequiresSnap,
  requireSnapAes: walletRequiresSnap
});

const destroyedCotiSignerProviders = new WeakSet<object>();

const destroyCotiSignerProviderOnce = (
  provider: { destroy?: () => void } | null | undefined
): void => {
  if (!provider || destroyedCotiSignerProviders.has(provider) || typeof provider.destroy !== 'function') return;
  destroyedCotiSignerProviders.add(provider);
  try {
    provider.destroy();
  } catch {
    // A retired wallet provider must not block lifecycle cleanup.
  }
};

export const destroyCachedCotiSignerProviders = (
  signers: Readonly<Record<string, JsonRpcSigner>>
): void => {
  for (const signer of Object.values(signers)) {
    const provider = signer.provider as unknown as { destroy?: () => void } | null;
    destroyCotiSignerProviderOnce(provider);
  }
};

export const disconnectBrowserWalletSession = async ({
  connectionMethod,
  provider,
  walletAddress
}: {
  connectionMethod: 'metamask' | null;
  provider: Eip1193Provider | null;
  walletAddress: string;
}): Promise<void> => {
  if (walletAddress) {
    clearCotiAesUnlockRequest(walletAddress, provider);
    clearFallbackAesSessionOnboardInfo(walletAddress);
  }
  try {
    if (connectionMethod === 'metamask' && provider) {
      if (isCipherTradeWalletConnectProvider(provider)) {
        await disconnectCipherTradeWalletConnect();
      } else if (isMetaMaskConnectMobileProvider(provider)) {
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
};

export const shouldPreserveBrowserWalletSessionOnProviderDisconnect = ({
  activeSignerSource,
  provider,
  session,
  walletAddress
}: {
  activeSignerSource: SignerSource;
  provider: Eip1193Provider;
  session: BrowserWalletSession | null;
  walletAddress: string;
}): boolean =>
  activeSignerSource === 'metamask' &&
  !isCipherTradeWalletConnectProvider(provider) &&
  Boolean(walletAddress.trim()) &&
  session?.provider === provider &&
  session.address.trim().toLowerCase() === walletAddress.trim().toLowerCase();

export const shouldRetryEmptyBrowserWalletAccountsBeforeDisconnect = ({
  accounts,
  ...sessionInput
}: {
  accounts: unknown;
  activeSignerSource: SignerSource;
  provider: Eip1193Provider;
  session: BrowserWalletSession | null;
  walletAddress: string;
}): boolean =>
  Array.isArray(accounts) &&
  accounts.length === 0 &&
  shouldPreserveBrowserWalletSessionOnProviderDisconnect(sessionInput);

export const preserveEquivalentBrowserWalletSession = (
  current: BrowserWalletSession | null,
  next: BrowserWalletSession | null
): BrowserWalletSession | null => {
  if (!current || !next) return next;
  // walletId and walletLabel are discovery/UI metadata. EIP-6963 providers can
  // be rediscovered with a different generated id or label after an extension
  // reload without changing the authority that signs the transaction. Keep the
  // original session identity stable while the exact provider, owner, chain,
  // and transport source remain unchanged.
  return current.provider === next.provider &&
    current.address.trim().toLowerCase() === next.address.trim().toLowerCase() &&
    current.chainId === next.chainId &&
    current.source === next.source
    ? current
    : next;
};

export const createBrowserWalletStateReconciler = (
  refresh: () => Promise<void>
): (() => Promise<void>) => {
  let requestedRevision = 0;
  let completedRevision = 0;
  let inFlight: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    let lastError: unknown = null;
    while (completedRevision < requestedRevision) {
      const targetRevision = requestedRevision;
      try {
        await refresh();
        lastError = null;
      } catch (error) {
        lastError = error;
      } finally {
        completedRevision = targetRevision;
      }
    }
    if (lastError) {
      throw lastError;
    }
  };

  return () => {
    requestedRevision += 1;
    if (!inFlight) {
      inFlight = drain().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
};

export type BrowserWalletProviderEventHandlers = Readonly<{
  accountsChanged: (...args: unknown[]) => void;
  chainChanged: (...args: unknown[]) => void;
  connect: (...args: unknown[]) => void;
  disconnect: (...args: unknown[]) => void;
}>;

/** Owns exactly one listener set for one injected-wallet provider and retires it idempotently. */
export const subscribeBrowserWalletProviderEvents = (
  provider: Pick<Eip1193Provider, 'on' | 'removeListener'>,
  handlers: BrowserWalletProviderEventHandlers
): (() => void) => {
  if (!provider.on || !provider.removeListener) {
    throw new Error('Browser wallet provider does not support lifecycle subscriptions.');
  }
  const entries = Object.entries(handlers) as Array<[
    keyof BrowserWalletProviderEventHandlers,
    (...args: unknown[]) => void
  ]>;
  for (const [event, listener] of entries) provider.on(event, listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const [event, listener] of entries) provider.removeListener?.(event, listener);
  };
};

export type BrowserWalletRpcRecoveryScheduler = Readonly<{
  cancel: () => void;
  schedule: () => void;
}>;

export const createBrowserWalletRpcRecoveryScheduler = ({
  clearTimer,
  delayMs,
  retry,
  setTimer
}: Readonly<{
  clearTimer: (timerId: number) => void;
  delayMs: number;
  retry: () => void;
  setTimer: (callback: () => void, delayMs: number) => number;
}>): BrowserWalletRpcRecoveryScheduler => {
  let timerId: number | null = null;
  return Object.freeze({
    cancel: () => {
      if (timerId === null) return;
      clearTimer(timerId);
      timerId = null;
    },
    schedule: () => {
      if (timerId !== null) return;
      timerId = setTimer(() => {
        timerId = null;
        retry();
      }, delayMs);
    }
  });
};

const PRIVACY_PROMPT_AFTER_CONNECT_DELAY_MS = 450;
const EMPTY_ACCOUNTS_RECHECK_DELAY_MS = 800;

const waitForPrivacyPromptAfterConnect = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, PRIVACY_PROMPT_AFTER_CONNECT_DELAY_MS);
  });

class StaleWalletLifecycleError extends Error {
  constructor() {
    super('Wallet lifecycle operation was superseded.');
    this.name = 'StaleWalletLifecycleError';
  }
}

const isStaleWalletLifecycleError = (error: unknown): error is StaleWalletLifecycleError =>
  error instanceof StaleWalletLifecycleError;

type PrivacyFallbackReason = Extract<
  PrivacyUnlockResult,
  { status: 'fallback-unavailable' }
>['reason'];

const getPrivacyFallbackUnavailableMessage = (reason: PrivacyFallbackReason): string => {
  if (reason === 'not-installed') {
    return getCotiSnapOwnerAesStatusMessage('snap-not-installed');
  }
  if (reason === 'missing-aes') {
    return getCotiSnapOwnerAesStatusMessage('snap-missing-aes');
  }
  if (reason === 'unrecoverable') {
    return 'Privacy recovery data is incomplete. Retry privacy setup to create a fresh owner key.';
  }
  if (reason === 'disabled') {
    return 'Automatic privacy onboarding is unavailable for this wallet.';
  }
  return getCotiSnapOwnerAesStatusMessage(reason);
};

export const resolveOwnerPrivacyOnboardingErrorMessage = (
  message: string,
  balanceWei: bigint | null
): string => {
  const normalized = message.trim().toLowerCase();
  const looksLikeOnboardingFundingFailure =
    normalized.includes('unable to onboard user') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('account balance is 0');

  if (!looksLikeOnboardingFundingFailure) {
    return message || 'Owner privacy onboarding was not completed.';
  }
  if (balanceWei !== null && balanceWei <= 0n) {
    return 'Add a small amount of COTI to this owner wallet for privacy onboarding gas, then tap Unlock privacy.';
  }
  return 'Privacy onboarding could not be completed. Approve both wallet prompts and make sure this owner wallet has enough COTI for gas.';
};

export type PassiveBrowserWalletRestoreResult = {
  address: string;
  chainId: number | null;
  onboardInfo: OnboardInfo | null;
  provider: Eip1193Provider;
  source?: 'injected' | 'metamask-connect-mobile' | 'walletconnect';
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
          message: getProviderErrorMessage(error, 'Mobile wallet restore failed.'),
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
        message: getProviderErrorMessage(error, 'MetaMask Connect session restore failed.')
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
  loadMyNicknameFromChainRef,
  setError,
  setMyNickname,
  onWalletAesHealthChange,
  walletAesHealthByAddress = {}
}: UseWalletOnboardingArgs) {
  const [walletAddress, setWalletAddressState] = useState('');
  const [chainId, setChainIdState] = useState<number | null>(null);
  const [status, setStatus] = useState('Disconnected');
  const [activeSignerSource, setActiveSignerSourceState] = useState<SignerSource>('metamask');
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
  const browserWalletRpcAvailableRef = useRef(true);
  const chainIdRef = useRef<number | null>(null);
  const passiveRestoreInFlightRef = useRef(false);
  const signerCacheRef = useRef<Record<string, JsonRpcSigner>>({});
  const signerProviderCacheRef = useRef<Record<string, Eip1193Provider>>({});
  const currentWalletKeyRef = useRef('');
  const activeSignerSourceRef = useRef<SignerSource>('metamask');
  const walletLifecycleEpochRef = useRef(0);
  // Connection/restore operations may supersede one another without changing
  // the selected wallet. Keep their cancellation epoch separate from the
  // signer-lease epoch, which advances only when the actual wallet binding
  // changes. Otherwise a harmless same-wallet refresh can reject a transaction
  // that was already prepared for the exact same provider/account/chain.
  const browserWalletSignerLeaseEpochRef = useRef(0);

  const clearCachedSigners = useCallback(() => {
    destroyCachedCotiSignerProviders(signerCacheRef.current);
    signerCacheRef.current = {};
    signerProviderCacheRef.current = {};
  }, []);

  const clearCachedSigner = useCallback((walletKey: string) => {
    const signer = signerCacheRef.current[walletKey];
    if (signer) destroyCachedCotiSignerProviders({ [walletKey]: signer });
    delete signerCacheRef.current[walletKey];
    delete signerProviderCacheRef.current[walletKey];
  }, []);

  const setWalletAddress = useCallback<Dispatch<SetStateAction<string>>>((nextAddress) => {
    const resolvedAddress = typeof nextAddress === 'function'
      ? nextAddress(currentWalletKeyRef.current)
      : nextAddress;
    currentWalletKeyRef.current = resolvedAddress.trim().toLowerCase();
    setWalletAddressState(resolvedAddress);
  }, []);

  const setChainId = useCallback<Dispatch<SetStateAction<number | null>>>((nextChainId) => {
    const resolvedChainId = typeof nextChainId === 'function'
      ? nextChainId(chainIdRef.current)
      : nextChainId;
    chainIdRef.current = resolvedChainId;
    setChainIdState(resolvedChainId);
  }, []);

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

  useEffect(() => () => {
    walletLifecycleEpochRef.current += 1;
    browserWalletSignerLeaseEpochRef.current += 1;
    clearCachedSigners();
  }, [clearCachedSigners]);

  const beginWalletLifecycleOperation = useCallback(() => {
    walletLifecycleEpochRef.current += 1;
    return walletLifecycleEpochRef.current;
  }, []);

  const retireBrowserWalletSignerLeases = useCallback(() => {
    browserWalletSignerLeaseEpochRef.current += 1;
    clearCachedSigners();
  }, [clearCachedSigners]);

  const isWalletLifecycleOperationCurrent = useCallback(
    (epoch: number) => walletLifecycleEpochRef.current === epoch,
    []
  );

  const assertWalletLifecycleOperationCurrent = useCallback((epoch: number) => {
    if (walletLifecycleEpochRef.current !== epoch) {
      throw new StaleWalletLifecycleError();
    }
  }, []);

  const assertBrowserWalletSignerLeaseSnapshotCurrent = useCallback(
    (lease: BrowserWalletSignerLease) => {
      assertBrowserWalletSignerLeaseState(lease, {
        activeProvider: activeProviderRef.current,
        activeSignerSource: activeSignerSourceRef.current,
        address: currentWalletKeyRef.current,
        chainId: chainIdRef.current,
        epoch: browserWalletSignerLeaseEpochRef.current,
        session: browserWalletSessionRef.current
      });
      if (!browserWalletRpcAvailableRef.current) {
        throw new Error(PROVIDER_RPC_UNAVAILABLE_MESSAGE);
      }
    },
    []
  );

  const captureBrowserWalletSignerLease = useCallback((): BrowserWalletSignerLease => {
    const session = browserWalletSessionRef.current;
    if (!session) {
      throw expiredBrowserWalletSignerLease('session-missing');
    }
    const lease: BrowserWalletSignerLease = {
      activeAddress: currentWalletKeyRef.current,
      activeChainId: chainIdRef.current,
      activeProvider: activeProviderRef.current,
      activeSignerSource: activeSignerSourceRef.current,
      address: session.address.trim().toLowerCase(),
      chainId: session.chainId,
      epoch: browserWalletSignerLeaseEpochRef.current,
      session,
      sessionProvider: session.provider,
      signingProvider: session.provider,
      source: session.source
    };
    assertBrowserWalletSignerLeaseSnapshotCurrent(lease);
    return lease;
  }, [assertBrowserWalletSignerLeaseSnapshotCurrent]);

  const getCachedBrowserWalletReadSigner = useCallback((requirePrivacy = true): JsonRpcSigner => {
    const lease = captureBrowserWalletSignerLease();
    const cacheKey = lease.address.toLowerCase();
    return resolveCachedBrowserWalletReadSigner({
      assertSnapshotCurrent: () => assertBrowserWalletSignerLeaseSnapshotCurrent(lease),
      cachedProvider: signerProviderCacheRef.current[cacheKey],
      expectedAddress: lease.address,
      requirePrivacy,
      signer: signerCacheRef.current[cacheKey]
    });
  }, [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease]);

  const assertBrowserWalletSignerLeaseCurrent = useCallback(
    async (lease: BrowserWalletSignerLease): Promise<void> => {
      await assertLiveBrowserWalletSignerLease(
        lease,
        () => assertBrowserWalletSignerLeaseSnapshotCurrent(lease)
      );
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent]
  );

  const setActiveSignerSource = useCallback<Dispatch<SetStateAction<SignerSource>>>((nextSource) => {
    const resolvedSource = typeof nextSource === 'function'
      ? nextSource(activeSignerSourceRef.current)
      : nextSource;
    activeSignerSourceRef.current = resolvedSource;
    setActiveSignerSourceState(resolvedSource);
  }, []);

  const setConnectedProvider = useCallback((
    provider: Eip1193Provider | null,
    expectedEpoch?: number
  ): number | null => {
    if (expectedEpoch !== undefined && walletLifecycleEpochRef.current !== expectedEpoch) {
      return null;
    }
    let committedEpoch = walletLifecycleEpochRef.current;
    if (activeProviderRef.current !== provider) {
      committedEpoch = beginWalletLifecycleOperation();
      retireBrowserWalletSignerLeases();
    }
    activeProviderRef.current = provider;
    setActiveProvider(provider);
    return committedEpoch;
  }, [beginWalletLifecycleOperation, retireBrowserWalletSignerLeases]);

  const setBrowserWalletSession = useCallback((session: BrowserWalletSession | null) => {
    const stableSession = preserveEquivalentBrowserWalletSession(
      browserWalletSessionRef.current,
      session
    );
    if (browserWalletSessionRef.current === stableSession) return;
    browserWalletSessionRef.current = stableSession;
    setBrowserWalletSessionState(stableSession);
  }, []);

  const schedulePostConnectSync = useCallback(
    (selected: string, expectedEpoch = walletLifecycleEpochRef.current) => {
      const selectedWalletKey = selected.toLowerCase();
      window.setTimeout(() => {
        void (async () => {
          try {
            if (walletLifecycleEpochRef.current !== expectedEpoch) {
              return;
            }
            const nickname = await loadMyNicknameFromChainRef.current(selected);
            if (
              walletLifecycleEpochRef.current !== expectedEpoch ||
              currentWalletKeyRef.current !== selectedWalletKey
            ) {
              return;
            }
            setMyNickname(nickname);
          } catch {
            // Post-connect sync should not block successful connection.
          }
        })();
      }, 0);
    },
    [loadMyNicknameFromChainRef, setMyNickname]
  );

  const clearBrowserOwnerPrivacySession = useCallback((
    address: string,
    provider: Eip1193Provider | null
  ) => {
    const walletKey = address.trim().toLowerCase();
    if (!walletKey) {
      return;
    }
    clearCotiAesUnlockRequest(walletKey, provider);
    clearFallbackAesSessionOnboardInfo(walletKey);
    clearCachedSigner(walletKey);
    setSessionOnboardInfo((previous) => {
      if (!previous[walletKey]) {
        return previous;
      }
      const next = { ...previous };
      delete next[walletKey];
      return next;
    });
    setOnboardStatus('Not onboarded');
  }, [clearCachedSigner]);

  const resetBrowserPrivacySessionForWalletChange = useCallback((
    nextAddress: string,
    previousAddress = currentWalletKeyRef.current,
    provider: Eip1193Provider | null = activeProviderRef.current
  ) => {
    const nextWalletKey = nextAddress.trim().toLowerCase();
    const previousWalletKey = previousAddress.trim().toLowerCase();
    if (nextWalletKey === previousWalletKey) {
      return;
    }

    if (previousWalletKey) {
      clearBrowserOwnerPrivacySession(previousWalletKey, provider);
    }
    if (nextWalletKey) {
      clearCotiAesUnlockRequest(nextWalletKey, provider);
      if (previousWalletKey) {
        clearFallbackAesSessionOnboardInfo(nextWalletKey);
      }
    }
    clearCachedSigners();
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
  }, [clearBrowserOwnerPrivacySession, clearCachedSigners]);

  const commitBrowserWalletSession = useCallback(({
    address,
    chainId: nextChainId,
    expectedEpoch,
    provider,
    source,
    walletId,
    walletLabel
  }: BrowserWalletSession & { expectedEpoch: number }): number | null => {
    if (!isWalletLifecycleOperationCurrent(expectedEpoch)) {
      return null;
    }

    const previousSession = browserWalletSessionRef.current;
    const previousAddress = previousSession?.address ??
      (activeSignerSourceRef.current === 'metamask' ? currentWalletKeyRef.current : '');
    resetBrowserPrivacySessionForWalletChange(
      address,
      previousAddress,
      previousSession?.provider ?? activeProviderRef.current
    );

    const committedEpoch = setConnectedProvider(provider, expectedEpoch);
    if (committedEpoch === null) {
      return null;
    }

    const nextSession: BrowserWalletSession = {
      address,
      chainId: nextChainId,
      provider,
      source,
      walletId,
      walletLabel
    };
    if (
      previousSession &&
      preserveEquivalentBrowserWalletSession(previousSession, nextSession) !== previousSession
    ) {
      retireBrowserWalletSignerLeases();
    }
    currentWalletKeyRef.current = address.trim().toLowerCase();
    chainIdRef.current = nextChainId;
    activeSignerSourceRef.current = 'metamask';
    browserWalletSessionRef.current = nextSession;
    browserWalletRpcAvailableRef.current = true;
    setConnectionMethod('metamask');
    setActiveSignerSourceState('metamask');
    setSelectedInjectedWalletId(walletId);
    setWalletAddress(address);
    setChainId(nextChainId);
    setBrowserWalletSessionState(nextSession);
    setStatus(`Connected (${walletLabel})`);
    return committedEpoch;
  }, [
    isWalletLifecycleOperationCurrent,
    resetBrowserPrivacySessionForWalletChange,
    retireBrowserWalletSignerLeases,
    setConnectedProvider
  ]);

  const isCurrentBrowserWalletSession = useCallback((
    epoch: number,
    provider: Eip1193Provider,
    address: string
  ) => {
    const session = browserWalletSessionRef.current;
    return walletLifecycleEpochRef.current === epoch &&
      activeProviderRef.current === provider &&
      session?.provider === provider &&
      session.address.trim().toLowerCase() === address.trim().toLowerCase();
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
              message: getProviderErrorMessage(error, 'Mobile wallet provider was unavailable.'),
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
      let operationEpoch = walletLifecycleEpochRef.current;
      try {
        const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
        assertWalletLifecycleOperationCurrent(operationEpoch);
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
        const walletPromptActive =
          Boolean(previousWalletKey && isWalletTransactionPromptActive(previousFlowInput)) ||
          isWalletTransactionPromptActive();
        if (
          shouldIgnoreBrowserWalletRefreshDuringFlow({
            previousWalletKey,
            selectedWalletKey: selected,
            walletFlowActive: walletPromptActive
          })
        ) {
          recordWalletTransactionFlowStage(previousFlowInput, 'accounts-refresh-change-deferred-during-prompt');
          // The RPC answered successfully; only the conflicting account snapshot is
          // deferred. Keep the session transport available so the in-flight action's
          // just-in-time authority check can decide whether the account is still valid.
          browserWalletRpcAvailableRef.current = true;
          return;
        }
        if (
          shouldIgnoreBrowserWalletRefreshDuringFlow({
            previousWalletKey,
            selectedWalletKey: selected,
            walletFlowActive
          })
        ) {
          recordWalletTransactionFlowStage(previousFlowInput, 'stale-wallet-flow-cleared-during-refresh');
          clearWalletTransactionFlow(previousFlowInput);
        }
        if (selected.trim().toLowerCase() !== previousWalletKey) {
          operationEpoch = beginWalletLifecycleOperation();
        }

        const normalizedChainId = selected
          ? normalizeChainId((await provider.request({ method: 'eth_chainId' })) as string | number)
          : null;
        assertWalletLifecycleOperationCurrent(operationEpoch);
        if (activeSignerSourceRef.current !== 'metamask' || activeProviderRef.current !== provider) {
          return;
        }
        if (shouldDeferBrowserWalletChainRefreshDuringPrompt({
          previousChainId: activeChainId,
          selectedChainId: normalizedChainId,
          previousWalletKey,
          walletPromptActive
        })) {
          recordWalletTransactionFlowStage(previousFlowInput, 'chain-refresh-change-deferred-during-prompt');
          // A one-off wrong-chain snapshot must not masquerade as an RPC outage and
          // abort an otherwise valid pending confirmation. The guarded provider still
          // rereads and compares the live chain immediately before submission.
          browserWalletRpcAvailableRef.current = true;
          return;
        }
        if (normalizedChainId !== activeChainId) {
          operationEpoch = beginWalletLifecycleOperation();
        }

        if (
          selected.trim().toLowerCase() !== previousWalletKey ||
          normalizedChainId !== activeChainId
        ) {
          retireBrowserWalletSignerLeases();
        }

        resetBrowserPrivacySessionForWalletChange(selected, previousWalletKey, provider);
        currentWalletKeyRef.current = selected.trim().toLowerCase();
        chainIdRef.current = normalizedChainId;
        setWalletAddress(selected);
        setChainId(normalizedChainId);
        setBrowserWalletSession(
          selected && browserWalletSessionRef.current
            ? {
                ...browserWalletSessionRef.current,
                address: selected,
                chainId: normalizedChainId,
                provider
              }
            : null
        );
        browserWalletRpcAvailableRef.current = Boolean(selected);
        setStatus(selected ? 'Connected' : 'Disconnected');
      } catch (error) {
        if (isStaleWalletLifecycleError(error) || !isWalletLifecycleOperationCurrent(operationEpoch)) {
          return;
        }
        throw error;
      }
    },
    [
      assertWalletLifecycleOperationCurrent,
      beginWalletLifecycleOperation,
      currentInjectedWalletOption?.id,
      getConnectedProvider,
      isWalletLifecycleOperationCurrent,
      resetBrowserPrivacySessionForWalletChange,
      retireBrowserWalletSignerLeases,
      selectedInjectedWalletId,
      setBrowserWalletSession
    ]
  );

  const onboardAddressAes = useCallback(
    async (
      address: string,
      provider: Eip1193Provider,
      options?: BrowserWalletActivationOptions,
      expectedEpoch?: number
    ): Promise<OnboardInfo> => {
      if (!provider) {
        throw new Error('Wallet provider is not available.');
      }
      const operationEpoch = expectedEpoch ?? beginWalletLifecycleOperation();
      if (!isCurrentBrowserWalletSession(operationEpoch, provider, address)) {
        throw new StaleWalletLifecycleError();
      }

      const promptProvider = await resolveWalletPromptProvider(provider, address);
      if (!isCurrentBrowserWalletSession(operationEpoch, provider, address)) {
        throw new StaleWalletLifecycleError();
      }
      if (!promptProvider) {
        throw new Error('Wallet provider is not available.');
      }

      setOnboardStatus('Onboarding...');
      await ensureCotiNetwork(promptProvider);
      if (!isCurrentBrowserWalletSession(operationEpoch, provider, address)) {
        throw new StaleWalletLifecycleError();
      }

      const assertOnboardingCurrent = () => {
        if (!isCurrentBrowserWalletSession(operationEpoch, provider, address)) {
          throw new StaleWalletLifecycleError();
        }
      };
      const guardedPromptProvider = createLeaseGuardedEip1193Provider(
        promptProvider,
        assertOnboardingCurrent,
        assertOnboardingCurrent
      );
      const browserProvider = await createCotiBrowserProvider(guardedPromptProvider);
      const cacheKey = address.toLowerCase();
      let temporarySigner: JsonRpcSigner | null = null;
      try {
        if (!isCurrentBrowserWalletSession(operationEpoch, provider, address)) {
          throw new StaleWalletLifecycleError();
        }

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
        const signer = await browserProvider.getSigner(
          address,
          refreshMismatch ? undefined : sessionOnboardInfo[cacheKey]
        );
        temporarySigner = signer;
        assertOnboardingCurrent();
        clearCachedSigner(cacheKey);
        signerCacheRef.current[cacheKey] = signer;
        signerProviderCacheRef.current[cacheKey] = promptProvider;
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
        let unlockResult: PrivacyUnlockResult;
        try {
          const ownerSession = browserWalletSessionRef.current;
          const walletRequiresSnap = !ownerSession || !isCypherTradeWalletOption({
            id: ownerSession.walletId,
            label: ownerSession.walletLabel,
            provider: ownerSession.provider as InjectedWalletOption['provider']
          });
          unlockResult = await getOrRecoverAesForWalletResult({
            ...buildOwnerPrivacyUnlockOptions(refreshMismatch, walletRequiresSnap),
            assertCurrent: assertOnboardingCurrent,
            provider: guardedPromptProvider,
            signer,
            walletAddress: address
          });
        } catch (privacyError) {
          if (
            isStaleWalletLifecycleError(privacyError) ||
            !isCurrentBrowserWalletSession(operationEpoch, provider, address)
          ) {
            throw new StaleWalletLifecycleError();
          }
          const providerMessage = getProviderErrorMessage(
            privacyError,
            'Owner privacy onboarding was not completed.'
          );
          const ownerBalanceWei = await loadCotiReadProvider(true)
            .then((readProvider) => readProvider.getBalance(address))
            .catch(() => null);
          if (!isCurrentBrowserWalletSession(operationEpoch, provider, address)) {
            throw new StaleWalletLifecycleError();
          }
          throw new Error(resolveOwnerPrivacyOnboardingErrorMessage(providerMessage, ownerBalanceWei));
        }
        if (!isCurrentBrowserWalletSession(operationEpoch, provider, address)) {
          throw new StaleWalletLifecycleError();
        }
        if (unlockResult.status !== 'ready') {
          throw new Error(getPrivacyFallbackUnavailableMessage(unlockResult.reason));
        }

        const onboardInfo = unlockResult.onboardInfo;
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
      } finally {
        // Privacy onboarding needs a temporary COTI BrowserProvider, but all
        // post-unlock reads and writes use the shared owner capability pool.
        // Retaining this signer created a second long-lived MetaMask stream.
        // This also covers getSigner and lifecycle failures before the signer
        // reached the temporary cache.
        if (temporarySigner && signerCacheRef.current[cacheKey] === temporarySigner) {
          delete signerCacheRef.current[cacheKey];
          delete signerProviderCacheRef.current[cacheKey];
        }
        destroyCotiSignerProviderOnce(browserProvider);
      }
    },
    [
      beginWalletLifecycleOperation,
      clearCachedSigner,
      ensureCotiNetwork,
      isCurrentBrowserWalletSession,
      onWalletAesHealthChange,
      resolveWalletPromptProvider,
      sessionOnboardInfo,
      walletAesHealthByAddress
    ]
  );

  const onboardAddressAesAfterConnect = useCallback(
    async (
      address: string,
      provider: Eip1193Provider,
      options: BrowserWalletActivationOptions | undefined,
      expectedEpoch: number
    ): Promise<OnboardInfo> => {
      await waitForPrivacyPromptAfterConnect();
      assertWalletLifecycleOperationCurrent(expectedEpoch);
      return onboardAddressAes(address, provider, options, expectedEpoch);
    },
    [assertWalletLifecycleOperationCurrent, onboardAddressAes]
  );

  const preparePrivacyAfterConnect = useCallback(
    async (
      address: string,
      provider: Eip1193Provider,
      options: BrowserWalletActivationOptions | undefined,
      expectedEpoch: number
    ): Promise<OnboardInfo | null> => {
      if (!options?.preparePrivacy) {
        return null;
      }

      try {
        return await onboardAddressAesAfterConnect(address, provider, options, expectedEpoch);
      } catch (privacyError) {
        if (
          isStaleWalletLifecycleError(privacyError) ||
          !isCurrentBrowserWalletSession(expectedEpoch, provider, address)
        ) {
          return null;
        }
        setError(
          getProviderErrorMessage(
            privacyError,
            'Owner privacy onboarding was not completed.'
          )
        );
        setOnboardStatus('Signature required');
        return null;
      }
    },
    [isCurrentBrowserWalletSession, onboardAddressAesAfterConnect, setError]
  );

  const connectAndOnboard = useCallback(
    async (walletId?: string, options?: BrowserWalletActivationOptions): Promise<OnboardInfo | null> => {
      let operationEpoch = beginWalletLifecycleOperation();
      let pendingCipherTradeProvider: Eip1193Provider | null = null;
      setError('');
      setConnectingMethod('metamask');

      try {
        const useCipherTradeWalletConnect = walletId === CIPHERTRADE_WALLETCONNECT_WALLET_ID;
        let walletOption = walletId
          ? injectedWalletOptions.find((option) => option.id === walletId) ?? null
          : preferredInjectedWalletOption;
        if (
          !walletOption &&
          !useCipherTradeWalletConnect &&
          walletId !== 'metamask' &&
          !isMetaMaskConnectMobileWalletId(walletId)
        ) {
          walletOption = preferredInjectedWalletOption;
        }
        const useMetaMaskConnectMobileContext = !useCipherTradeWalletConnect &&
          shouldUseMetaMaskConnectMobile({ walletId, walletOption });
        const mobileInjectedOption = useMetaMaskConnectMobileContext
          ? await waitForMetaMaskMobileInjectedWalletOption({
              initialOptions: walletOption ? [walletOption] : undefined,
              timeoutMs: 3000
            })
          : null;
        assertWalletLifecycleOperationCurrent(operationEpoch);
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
        const walletLabel = useCipherTradeWalletConnect
          ? 'CipherTrade Mobile'
          : useMetaMaskConnectMobile
          ? METAMASK_CONNECT_MOBILE_WALLET_LABEL
          : walletOption?.label ?? 'Wallet';
        setConnectingWalletLabel(walletLabel);
        if (!provider && !useMetaMaskConnectMobile && !useCipherTradeWalletConnect) {
          setError('MetaMask or CipherTrade is required to continue.');
          return null;
        }

        setStatus(`Connecting ${walletLabel}...`);
        const cipherTradeSession = useCipherTradeWalletConnect
          ? await connectCipherTradeWalletConnect()
          : null;
        pendingCipherTradeProvider = cipherTradeSession?.provider ?? null;
        assertWalletLifecycleOperationCurrent(operationEpoch);
        const mobileSession = useMetaMaskConnectMobile
          ? await connectMetaMaskMobile({ forceAccountPicker: options?.forceAccountPicker })
          : null;
        assertWalletLifecycleOperationCurrent(operationEpoch);
        const activeWalletProvider = cipherTradeSession?.provider ?? mobileSession?.provider ?? provider;
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
          assertWalletLifecycleOperationCurrent(operationEpoch);
        }
        if (usingInjectedMetaMaskMobile && walletOption) {
          logMetaMaskMobileProviderSelection('injected-metamask', {
            walletId: walletOption.id
          });
          logMetaMaskMobileRequestMethod('eth_requestAccounts', 'injected-metamask', {
            walletId: walletOption.id
          });
        }
        const accounts = cipherTradeSession
          ? [cipherTradeSession.address]
          : mobileSession
          ? [mobileSession.address]
          : ((await activeWalletProvider.request({ method: 'eth_requestAccounts' })) as string[]);
        assertWalletLifecycleOperationCurrent(operationEpoch);
        const selected = accounts[0] ?? '';

        if (!selected) {
          throw new Error('No wallet account selected.');
        }

        if (usingInjectedMetaMaskMobile && walletOption) {
          logMetaMaskMobileRequestMethod('eth_chainId', 'injected-metamask', {
            walletId: walletOption.id
          });
        }
        const normalizedChainId = await ensureProviderOnNetworkAndVerifyOwner(
          activeWalletProvider,
          COTI_NETWORK,
          selected
        );
        // A legitimate wallet_switchEthereumChain event may have retired the
        // pre-switch epoch. Start the committed lease only after re-reading
        // both the selected owner and exact chain from the wallet.
        operationEpoch = beginWalletLifecycleOperation();
        const nextWalletId =
          cipherTradeSession?.walletId ?? mobileSession?.walletId ?? walletOption?.id ?? walletId ?? '';
        const committedEpoch = commitBrowserWalletSession({
          address: selected,
          chainId: normalizedChainId,
          expectedEpoch: operationEpoch,
          provider: activeWalletProvider,
          source: cipherTradeSession
            ? 'walletconnect'
            : mobileSession
              ? 'metamask-connect-mobile'
              : 'injected',
          walletId: nextWalletId,
          walletLabel
        });
        if (committedEpoch === null) {
          throw new StaleWalletLifecycleError();
        }
        pendingCipherTradeProvider = null;
        operationEpoch = committedEpoch;
        saveWalletPreference({ kind: 'browser', browserWalletId: nextWalletId || walletOption?.id });
        const onboardInfo = await preparePrivacyAfterConnect(
          selected,
          activeWalletProvider,
          options,
          operationEpoch
        );
        if (!isCurrentBrowserWalletSession(operationEpoch, activeWalletProvider, selected)) {
          return null;
        }
        schedulePostConnectSync(selected, operationEpoch);
        return onboardInfo;
      } catch (connectionError) {
        if (
          pendingCipherTradeProvider &&
          browserWalletSessionRef.current?.provider !== pendingCipherTradeProvider
        ) {
          await discardCipherTradeWalletConnectProvider(pendingCipherTradeProvider);
        }
        if (
          isStaleWalletLifecycleError(connectionError) ||
          !isWalletLifecycleOperationCurrent(operationEpoch)
        ) {
          return null;
        }
        const message = getProviderErrorMessage(connectionError, 'Failed to connect wallet.');
        setError(message);
        if (
          !browserWalletSessionRef.current &&
          !isProviderRequestAlreadyPending(connectionError) &&
          !isProviderActionRejected(connectionError)
        ) {
          setStatus('Disconnected');
          setOnboardStatus('Not onboarded');
        }
        return null;
      } finally {
        if (isWalletLifecycleOperationCurrent(operationEpoch)) {
          setConnectingMethod(null);
          setConnectingWalletLabel('');
        }
      }
    },
    [
      assertWalletLifecycleOperationCurrent,
      beginWalletLifecycleOperation,
      commitBrowserWalletSession,
      injectedWalletOptions,
      isCurrentBrowserWalletSession,
      isWalletLifecycleOperationCurrent,
      preferredInjectedWalletOption,
      preparePrivacyAfterConnect,
      schedulePostConnectSync,
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

      let operationEpoch = beginWalletLifecycleOperation();
      setError('');
      setConnectingMethod('metamask');
      setConnectingWalletLabel(targetSession.walletLabel);

      try {
        const useMetaMaskConnectMobile = targetSession.source === 'metamask-connect-mobile';
        if (targetSession.source === 'walletconnect' && options?.forceAccountPicker) {
          await disconnectCipherTradeWalletConnect().catch(() => undefined);
          assertWalletLifecycleOperationCurrent(operationEpoch);
          return connectAndOnboard(CIPHERTRADE_WALLETCONNECT_WALLET_ID, options);
        }
        if (useMetaMaskConnectMobile && options?.forceAccountPicker) {
          const injectedOption = await waitForMetaMaskMobileInjectedWalletOption({
            timeoutMs: 3000
          });
          assertWalletLifecycleOperationCurrent(operationEpoch);
          if (injectedOption?.provider) {
            logMetaMaskMobileProviderSelection('injected-metamask', {
              reason: 'mobile-in-app-force-account-picker',
              walletId: injectedOption.id
            });
            logMetaMaskMobileRequestMethod('eth_requestAccounts', 'injected-metamask', {
              walletId: injectedOption.id
            });
            const accounts = (await injectedOption.provider.request({ method: 'eth_requestAccounts' })) as string[];
            assertWalletLifecycleOperationCurrent(operationEpoch);
            const selected = accounts[0] ?? '';
            if (!selected) {
              throw new Error('No wallet account selected.');
            }
            logMetaMaskMobileRequestMethod('eth_chainId', 'injected-metamask', {
              walletId: injectedOption.id
            });
            const normalizedChainId = await ensureProviderOnNetworkAndVerifyOwner(
              injectedOption.provider,
              COTI_NETWORK,
              selected
            );
            operationEpoch = beginWalletLifecycleOperation();
            const committedEpoch = commitBrowserWalletSession({
              address: selected,
              chainId: normalizedChainId,
              expectedEpoch: operationEpoch,
              provider: injectedOption.provider,
              source: 'injected',
              walletId: injectedOption.id,
              walletLabel: injectedOption.label
            });
            if (committedEpoch === null) {
              throw new StaleWalletLifecycleError();
            }
            operationEpoch = committedEpoch;
            saveWalletPreference({ kind: 'browser', browserWalletId: injectedOption.id });
            const onboardInfo = await preparePrivacyAfterConnect(
              selected,
              injectedOption.provider,
              options,
              operationEpoch
            );
            if (!isCurrentBrowserWalletSession(operationEpoch, injectedOption.provider, selected)) {
              return null;
            }
            schedulePostConnectSync(selected, operationEpoch);
            return onboardInfo;
          }

          const mobileSession = await connectMetaMaskMobile({ forceAccountPicker: true });
          assertWalletLifecycleOperationCurrent(operationEpoch);
          const selected = mobileSession.address;
          const normalizedChainId = await ensureProviderOnNetworkAndVerifyOwner(
            mobileSession.provider,
            COTI_NETWORK,
            selected
          );
          operationEpoch = beginWalletLifecycleOperation();
          const committedEpoch = commitBrowserWalletSession({
            ...mobileSession,
            chainId: normalizedChainId,
            expectedEpoch: operationEpoch,
            source: 'metamask-connect-mobile'
          });
          if (committedEpoch === null) {
            throw new StaleWalletLifecycleError();
          }
          operationEpoch = committedEpoch;
          saveWalletPreference({ kind: 'browser', browserWalletId: mobileSession.walletId });
          const onboardInfo = await preparePrivacyAfterConnect(
            selected,
            mobileSession.provider,
            options,
            operationEpoch
          );
          if (!isCurrentBrowserWalletSession(operationEpoch, mobileSession.provider, selected)) {
            return null;
          }
          schedulePostConnectSync(selected, operationEpoch);
          return onboardInfo;
        }

        if (!useMetaMaskConnectMobile && options?.forceAccountPicker) {
          await targetSession.provider
            .request({
              method: 'wallet_requestPermissions',
              params: [{ eth_accounts: {} }]
            })
            .catch(() => null);
          assertWalletLifecycleOperationCurrent(operationEpoch);
        }
        const restoredInjectedSession = useMetaMaskConnectMobile
          ? await (async () => {
              const injectedOption = await waitForMetaMaskMobileInjectedWalletOption({
                timeoutMs: 3000
              });
              return injectedOption ? readInjectedPassiveBrowserWalletRestore(injectedOption) : null;
            })()
          : null;
        assertWalletLifecycleOperationCurrent(operationEpoch);
        const restoredMobileSession = useMetaMaskConnectMobile && !restoredInjectedSession
          ? await readMetaMaskConnectMobileSession()
          : null;
        assertWalletLifecycleOperationCurrent(operationEpoch);
        const accounts = restoredInjectedSession
          ? [restoredInjectedSession.address]
          : restoredMobileSession
          ? [restoredMobileSession.address]
          : ((await targetSession.provider.request({
              method: options?.forceAccountPicker ? 'eth_requestAccounts' : 'eth_accounts'
            })) as string[]);
        assertWalletLifecycleOperationCurrent(operationEpoch);
        const selected =
          accounts.find((account) => account.toLowerCase() === targetSession.address.toLowerCase()) ?? accounts[0] ?? '';
        if (!selected) {
          return connectAndOnboard(targetSession.walletId || walletId, options);
        }

        const activeWalletProvider = restoredInjectedSession?.provider ?? restoredMobileSession?.provider ?? targetSession.provider;
        const activeWalletId = restoredInjectedSession?.walletId ?? restoredMobileSession?.walletId ?? targetSession.walletId;
        const activeWalletLabel = restoredInjectedSession?.walletLabel ?? restoredMobileSession?.walletLabel ?? targetSession.walletLabel;
        const normalizedChainId = await ensureProviderOnNetworkAndVerifyOwner(
          activeWalletProvider,
          COTI_NETWORK,
          selected
        );
        operationEpoch = beginWalletLifecycleOperation();
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
        const committedEpoch = commitBrowserWalletSession({
          ...nextSession,
          expectedEpoch: operationEpoch
        });
        if (committedEpoch === null) {
          throw new StaleWalletLifecycleError();
        }
        operationEpoch = committedEpoch;
        saveWalletPreference({ kind: 'browser', browserWalletId: activeWalletId });
        const onboardInfo = await preparePrivacyAfterConnect(
          selected,
          activeWalletProvider,
          options,
          operationEpoch
        );
        if (!isCurrentBrowserWalletSession(operationEpoch, activeWalletProvider, selected)) {
          return null;
        }

        schedulePostConnectSync(selected, operationEpoch);
        return onboardInfo;
      } catch (connectionError) {
        if (
          isStaleWalletLifecycleError(connectionError) ||
          !isWalletLifecycleOperationCurrent(operationEpoch)
        ) {
          return null;
        }
        const message = getProviderErrorMessage(connectionError, 'Failed to activate wallet.');
        setError(message);
        return null;
      } finally {
        if (isWalletLifecycleOperationCurrent(operationEpoch)) {
          setConnectingMethod(null);
          setConnectingWalletLabel('');
        }
      }
    },
    [
      assertWalletLifecycleOperationCurrent,
      beginWalletLifecycleOperation,
      commitBrowserWalletSession,
      connectAndOnboard,
      isCurrentBrowserWalletSession,
      isWalletLifecycleOperationCurrent,
      preparePrivacyAfterConnect,
      schedulePostConnectSync,
      setError,
    ]
  );

  const disconnectWallet = useCallback(async () => {
    const operationEpoch = beginWalletLifecycleOperation();
    setError('');
    setConnectingWalletLabel('');
    setConnectingMethod(null);

    const browserWalletSession = browserWalletSessionRef.current;
    const provider = getConnectedProvider() ?? browserWalletSession?.provider ?? null;
    const departingOwnerAddress = browserWalletSession?.address ?? currentWalletKeyRef.current;
    const departingConnectionMethod = connectionMethod;

    resetBrowserPrivacySessionForWalletChange('', departingOwnerAddress, provider);
    currentWalletKeyRef.current = '';
    chainIdRef.current = null;
    browserWalletSessionRef.current = null;
    setWalletAddress('');
    setChainId(null);
    setStatus('Disconnected');
    setActiveSignerSource('metamask');
    setConnectionMethod(null);
    setOnboardStatus('Not onboarded');
    setSessionOnboardInfo({});
    setBrowserWalletSessionState(null);
    setConnectedProvider(null, operationEpoch);
    clearCachedSigners();
    await disconnectBrowserWalletSession({
      connectionMethod: departingConnectionMethod,
      provider,
      walletAddress: departingOwnerAddress
    });
  }, [
    beginWalletLifecycleOperation,
    clearCachedSigners,
    connectionMethod,
    getConnectedProvider,
    resetBrowserPrivacySessionForWalletChange,
    setConnectedProvider,
    setError
  ]);

  useEffect(() => {
    if (
      passiveRestoreInFlightRef.current ||
      !allowPassiveBrowserRestore ||
      connectingMethod ||
      browserWalletSessionRef.current ||
      currentWalletKeyRef.current
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
    let operationEpoch = beginWalletLifecycleOperation();
    passiveRestoreInFlightRef.current = true;
    if (useMetaMaskConnectMobile) {
      setStatus('Restoring MetaMask Mobile...');
    }
    logMobileWalletDiagnostic('passive-restore-start', {
      walletId: useMetaMaskConnectMobile ? METAMASK_CONNECT_MOBILE_WALLET_ID : walletOption?.id ?? ''
    });

    readPassiveBrowserWalletRestore(walletOption)
      .then((restore) => {
        if (cancelled || !isWalletLifecycleOperationCurrent(operationEpoch) || !restore) {
          if (!restore) {
            logMobileWalletDiagnostic('passive-restore-empty', {
              walletId: useMetaMaskConnectMobile ? METAMASK_CONNECT_MOBILE_WALLET_ID : walletOption?.id ?? ''
            });
            if (useMetaMaskConnectMobile && isWalletLifecycleOperationCurrent(operationEpoch)) {
              setStatus('Disconnected');
            }
          }
          return;
        }

        const walletKey = restore.address.toLowerCase();
        const committedEpoch = commitBrowserWalletSession({
          address: restore.address,
          chainId: restore.chainId,
          expectedEpoch: operationEpoch,
          provider: restore.provider,
          source: restore.source,
          walletId: restore.walletId,
          walletLabel: restore.walletLabel
        });
        if (committedEpoch === null) {
          return;
        }
        operationEpoch = committedEpoch;
        saveWalletPreference({ kind: 'browser', browserWalletId: restore.walletId });

        if (
          restore.onboardInfo?.aesKey &&
          restore.chainId === COTI_NETWORK.chainIdDecimal &&
          isCurrentBrowserWalletSession(operationEpoch, restore.provider, restore.address)
        ) {
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
        schedulePostConnectSync(restore.address, operationEpoch);
      })
      .catch((error) => {
        if (cancelled || !isWalletLifecycleOperationCurrent(operationEpoch)) {
          return;
        }
        logMobileWalletDiagnostic('passive-restore-error', {
          message: getProviderErrorMessage(error, 'Passive wallet restore failed.'),
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
    beginWalletLifecycleOperation,
    commitBrowserWalletSession,
    connectingMethod,
    isCurrentBrowserWalletSession,
    isWalletLifecycleOperationCurrent,
    onWalletAesHealthChange,
    preferredInjectedWalletOption,
    schedulePostConnectSync,
  ]);

  useEffect(() => {
    const provider = getConnectedProvider() ?? browserWalletSessionRef.current?.provider ?? null;

    if (!provider?.on || !provider?.removeListener) {
      refreshWalletState(provider).catch(() => {
        setError('Unable to read wallet state.');
      });
      return;
    }

    let active = true;
    const reconcileWalletState = createBrowserWalletStateReconciler(
      () => refreshWalletState(provider)
    );

    const isCurrentProvider = () =>
      active &&
      (
        activeProviderRef.current === provider ||
        browserWalletSessionRef.current?.provider === provider
      );

    const reconcileProviderState = (initial = false) => {
      if (!isCurrentProvider()) {
        return;
      }
      void reconcileWalletState()
        .then(() => {
          if (isCurrentProvider() && !initial) {
            setError('');
          }
        })
        .catch(() => {
          if (isCurrentProvider()) {
            browserWalletRpcAvailableRef.current = false;
            setError(initial ? 'Unable to read wallet state.' : PROVIDER_RPC_UNAVAILABLE_MESSAGE);
          }
        });
    };

    const rpcRecoveryScheduler = createBrowserWalletRpcRecoveryScheduler({
      clearTimer: (timerId) => window.clearTimeout(timerId),
      delayMs: EMPTY_ACCOUNTS_RECHECK_DELAY_MS,
      retry: () => reconcileProviderState(),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs)
    });

    const handleAccountsChanged = (accounts: unknown) => {
      browserWalletRpcAvailableRef.current = false;
      rpcRecoveryScheduler.cancel();
      if (shouldRetryEmptyBrowserWalletAccountsBeforeDisconnect({
        accounts,
        activeSignerSource: activeSignerSourceRef.current,
        provider,
        session: browserWalletSessionRef.current,
        walletAddress: currentWalletKeyRef.current
      })) {
        setStatus('Wallet RPC unavailable');
        setError(PROVIDER_RPC_UNAVAILABLE_MESSAGE);
        rpcRecoveryScheduler.schedule();
        return;
      }
      reconcileProviderState();
    };

    const handleChainChanged = () => {
      rpcRecoveryScheduler.cancel();
      browserWalletRpcAvailableRef.current = false;
      reconcileProviderState();
    };

    const handleProviderConnect = () => {
      if (
        activeProviderRef.current !== provider &&
        browserWalletSessionRef.current?.provider !== provider
      ) {
        return;
      }
      rpcRecoveryScheduler.cancel();
      browserWalletRpcAvailableRef.current = false;
      reconcileProviderState();
    };

    const handleProviderDisconnect = () => {
      if (
        activeProviderRef.current !== provider &&
        browserWalletSessionRef.current?.provider !== provider
      ) {
        return;
      }
      if (shouldPreserveBrowserWalletSessionOnProviderDisconnect({
        activeSignerSource: activeSignerSourceRef.current,
        provider,
        session: browserWalletSessionRef.current,
        walletAddress: currentWalletKeyRef.current
      })) {
        browserWalletRpcAvailableRef.current = false;
        setStatus('Wallet RPC unavailable');
        setError(PROVIDER_RPC_UNAVAILABLE_MESSAGE);
        rpcRecoveryScheduler.schedule();
        return;
      }
      forgetCipherTradeWalletConnectProvider(provider);
      const operationEpoch = beginWalletLifecycleOperation();
      const ownerSession = browserWalletSessionRef.current;
      const ownerAddress = ownerSession?.address ??
        (activeSignerSourceRef.current === 'metamask' ? currentWalletKeyRef.current : '');
      clearBrowserOwnerPrivacySession(ownerAddress, provider);
      browserWalletSessionRef.current = null;
      setBrowserWalletSessionState(null);
      setConnectionMethod(null);
      setConnectedProvider(null, operationEpoch);
      clearCachedSigners();

      if (activeSignerSourceRef.current === 'metamask') {
        currentWalletKeyRef.current = '';
        chainIdRef.current = null;
        activeSignerSourceRef.current = 'metamask';
        setWalletAddress('');
        setChainId(null);
        setStatus('Disconnected');
        setActiveSignerSourceState('metamask');
      }
    };

    const unsubscribeProviderEvents = subscribeBrowserWalletProviderEvents(provider, {
      accountsChanged: handleAccountsChanged,
      chainChanged: handleChainChanged,
      connect: handleProviderConnect,
      disconnect: handleProviderDisconnect
    });
    reconcileProviderState(true);

    return () => {
      active = false;
      rpcRecoveryScheduler.cancel();
      unsubscribeProviderEvents();
    };
  }, [
    beginWalletLifecycleOperation,
    browserWalletSession?.provider,
    clearBrowserOwnerPrivacySession,
    clearCachedSigners,
    getConnectedProvider,
    refreshWalletState,
    setConnectedProvider,
    setError
  ]);

  return {
    activeProvider,
    activeSignerSource,
    activateBrowserWalletSession,
    assertBrowserWalletSignerLeaseCurrent,
    assertBrowserWalletSignerLeaseSnapshotCurrent,
    browserWalletSession,
    captureBrowserWalletSignerLease,
    chainId,
    connectAndOnboard,
    connectingMethod,
    connectingWalletLabel,
    connectionMethod,
    currentInjectedWalletOption,
    currentWalletKeyRef,
    disconnectWallet,
    ensureCotiNetwork,
    getCachedBrowserWalletReadSigner,
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
