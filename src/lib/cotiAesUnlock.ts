import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import { COTI_NETWORK, type Eip1193Provider } from './appShared';
import {
  getCotiSnapAesKeyResult,
  type CotiSnapAesKeyResult,
  type CotiSnapAesStatus
} from './cotiSnap';

type CotiAesSigner = Pick<
  JsonRpcSigner,
  'generateOrRecoverAes' | 'getUserOnboardInfo' | 'setUserOnboardInfo'
> &
  Partial<Pick<JsonRpcSigner, 'clearUserOnboardInfo'>>;

type UnlockArgs = {
  allowLegacyFallback?: boolean;
  allowUnrecoverableReset?: boolean;
  assertCurrent?: () => void | Promise<void>;
  forceFreshAes?: boolean;
  forceLegacyRefresh?: boolean;
  forceRefresh?: boolean;
  preferSnapAes?: boolean;
  probeSnapAes?: boolean;
  provider?: Eip1193Provider | null;
  requireSnapAes?: boolean;
  onInvalidatedOnboardInfo?: (completed: {
    onboardInfo: OnboardInfo;
    walletAddress: string;
  }) => void | Promise<void>;
  signer: CotiAesSigner;
  walletAddress: string;
};

type UnlockLifecycleState = {
  completedFallbackOnboardInfo?: OnboardInfo;
  fallbackGenerationStarted: boolean;
  fallbackStorageCommitted: boolean;
  invalidated: boolean;
  invalidatedOnboardInfoSalvage: 'not-attempted' | 'succeeded' | 'failed';
};

const runWithUnlockLifecycleAssertion = async <T>(
  assertCurrent: UnlockArgs['assertCurrent'],
  lifecycleState: UnlockLifecycleState,
  operation: () => T | Promise<T>
): Promise<T> => {
  if (assertCurrent) {
    try {
      const assertion = assertCurrent();
      if (assertion) {
        await assertion;
      }
    } catch (error) {
      lifecycleState.invalidated = true;
      throw error;
    }
  }
  return operation();
};

export type PrivacyUnlockResult =
  | {
      status: 'ready';
      onboardInfo: OnboardInfo;
      snapStoreStatus?: Exclude<CotiSnapAesKeyResult['status'], 'missing-aes'>;
      source: 'cache' | 'snap' | 'fallback';
    }
  | {
      status: 'fallback-unavailable';
      reason: Exclude<CotiSnapAesKeyResult['status'], 'ready'> | 'disabled' | 'unrecoverable';
    };

export type CotiAesValidationProbe = {
  name: string;
  validate: (signer: CotiAesSigner, onboardInfo: OnboardInfo) => Promise<boolean | null> | boolean | null;
};

export type CotiAesValidationResult = {
  failedProbes: string[];
  passedProbes: string[];
  status: 'valid' | 'ready-unverified' | 'key-mismatch';
};

export type WalletAesHealthState = {
  message?: string;
  status: 'locked' | 'ready' | 'ready-unverified' | 'key-mismatch' | 'repair-needed' | 'repairing';
  updatedAt: number;
  walletKey: string;
};

export type ValidatedPrivacyUnlockResult =
  | {
      onboardInfo: OnboardInfo;
      source: 'cache' | 'snap' | 'fallback';
      status: 'ready' | 'ready-unverified';
      validation: CotiAesValidationResult;
    }
  | {
      reason: Exclude<CotiSnapAesKeyResult['status'], 'ready'> | 'disabled' | 'unrecoverable';
      status: 'fallback-unavailable';
    }
  | {
      source: 'cache' | 'snap' | 'fallback';
      status: 'key-mismatch';
      validation: CotiAesValidationResult;
    };

export type WalletScopedSnapAesState = {
  sessionKey: string;
  staleTokenAddresses: string[];
  status: CotiSnapAesStatus;
  walletKey: string;
};

export type WalletScopedAesValidationResult = CotiAesValidationResult & {
  walletKey: string;
};

const providerIds = new WeakMap<object, number>();
let nextProviderId = 1;
const inFlightUnlocks = new Map<
  string,
  {
    promise: Promise<PrivacyUnlockResult>;
    walletKey: string;
  }
>();
const walletUnlockEpochs = new Map<string, number>();
const signerUnlockTails = new WeakMap<object, Promise<void>>();
const fallbackAesSessionCache = new Map<string, OnboardInfo>();
const LEGACY_FALLBACK_AES_SESSION_STORAGE_PREFIX = 'chainwhisper:fallback-aes:v1:';
const COTI_ONBOARD_CONSOLE_ERROR = 'unable to onboard user.';
let cotiOnboardConsoleSuppressionDepth = 0;
let originalCotiOnboardConsoleError: typeof console.error | null = null;
const normalizeWalletKey = (walletAddress: string): string => walletAddress.trim().toLowerCase();

const cloneOnboardInfo = (onboardInfo: OnboardInfo): OnboardInfo => ({
  ...onboardInfo,
  rsaKey: onboardInfo.rsaKey
    ? {
        privateKey: onboardInfo.rsaKey.privateKey.slice(),
        publicKey: onboardInfo.rsaKey.publicKey.slice()
      }
    : onboardInfo.rsaKey
});

const salvageInvalidatedOnboardInfo = async (
  onInvalidatedOnboardInfo: UnlockArgs['onInvalidatedOnboardInfo'],
  walletAddress: string,
  lifecycleState: UnlockLifecycleState
): Promise<void> => {
  if (
    !onInvalidatedOnboardInfo ||
    !lifecycleState.completedFallbackOnboardInfo ||
    lifecycleState.invalidatedOnboardInfoSalvage !== 'not-attempted'
  ) {
    return;
  }

  try {
    await onInvalidatedOnboardInfo({
      onboardInfo: cloneOnboardInfo(lifecycleState.completedFallbackOnboardInfo),
      walletAddress: normalizeWalletKey(walletAddress)
    });
    lifecycleState.invalidatedOnboardInfoSalvage = 'succeeded';
  } catch {
    // Keep the original stale-lifecycle error authoritative and retain the
    // signer's recovery copy when the address-bound persistence sink fails.
    lifecycleState.invalidatedOnboardInfoSalvage = 'failed';
  }
};

const runWithSerializedSignerUnlock = async <T>(signer: CotiAesSigner, operation: () => Promise<T>): Promise<T> => {
  const signerKey = signer as object;
  const previousUnlock = signerUnlockTails.get(signerKey) ?? Promise.resolve();
  let releaseUnlock = () => {};
  const currentUnlock = new Promise<void>((resolve) => {
    releaseUnlock = resolve;
  });
  signerUnlockTails.set(signerKey, currentUnlock);

  await previousUnlock;
  try {
    return await operation();
  } finally {
    releaseUnlock();
    if (signerUnlockTails.get(signerKey) === currentUnlock) {
      signerUnlockTails.delete(signerKey);
    }
  }
};

const getProviderId = (provider?: Eip1193Provider | null): string => {
  if (!provider || (typeof provider !== 'object' && typeof provider !== 'function')) {
    return 'no-provider';
  }
  const providerObject = provider as object;
  const existing = providerIds.get(providerObject);
  if (existing) {
    return String(existing);
  }
  const next = nextProviderId;
  nextProviderId += 1;
  providerIds.set(providerObject, next);
  return String(next);
};

export const getCotiAesWalletSessionKey = (walletAddress: string, provider?: Eip1193Provider | null): string =>
  `${normalizeWalletKey(walletAddress)}:${getProviderId(provider)}:${COTI_NETWORK.chainIdDecimal}`;

const getFallbackAesStorage = (): Storage | null => {
  try {
    const maybeWindow = globalThis as {
      sessionStorage?: Storage;
      window?: { sessionStorage?: Storage };
    };
    return maybeWindow.window?.sessionStorage ?? maybeWindow.sessionStorage ?? null;
  } catch {
    return null;
  }
};

const purgeLegacyFallbackAesSessionStorage = (): void => {
  const storage = getFallbackAesStorage();
  if (!storage) {
    return;
  }

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(LEGACY_FALLBACK_AES_SESSION_STORAGE_PREFIX)) {
        storage.removeItem(key);
      }
    }
  } catch {
  }
};

purgeLegacyFallbackAesSessionStorage();

export const readFallbackAesSessionOnboardInfo = (
  walletAddress: string,
  provider?: Eip1193Provider | null
): OnboardInfo | null => {
  const walletKey = normalizeWalletKey(walletAddress);
  purgeLegacyFallbackAesSessionStorage();
  if (!walletKey || !provider) {
    return null;
  }

  const cached = fallbackAesSessionCache.get(getCotiAesWalletSessionKey(walletAddress, provider));
  const aesKey = typeof cached?.aesKey === 'string' ? cached.aesKey.trim() : '';
  return aesKey ? ({ aesKey } as OnboardInfo) : null;
};

export const storeFallbackAesSessionOnboardInfo = (
  walletAddress: string,
  provider: Eip1193Provider | null | undefined,
  onboardInfo?: OnboardInfo
): boolean => {
  const walletKey = normalizeWalletKey(walletAddress);
  const aesKey = typeof onboardInfo?.aesKey === 'string' ? onboardInfo.aesKey.trim() : '';
  purgeLegacyFallbackAesSessionStorage();
  if (!walletKey || !provider || !aesKey) {
    return false;
  }

  fallbackAesSessionCache.set(
    getCotiAesWalletSessionKey(walletAddress, provider),
    { aesKey } as OnboardInfo
  );
  return true;
};

export const clearFallbackAesSessionOnboardInfo = (
  walletAddress: string,
  provider?: Eip1193Provider | null
): void => {
  const walletKey = normalizeWalletKey(walletAddress);
  purgeLegacyFallbackAesSessionStorage();
  if (!walletKey) {
    return;
  }

  if (provider) {
    fallbackAesSessionCache.delete(getCotiAesWalletSessionKey(walletAddress, provider));
    return;
  }
  const walletPrefix = `${walletKey}:`;
  for (const cacheKey of fallbackAesSessionCache.keys()) {
    if (cacheKey.startsWith(walletPrefix)) {
      fallbackAesSessionCache.delete(cacheKey);
    }
  }
};

export const hydrateSignerWithFallbackAesSession = (
  signer: CotiAesSigner,
  walletAddress: string,
  provider?: Eip1193Provider | null
): OnboardInfo | null => {
  const storedOnboardInfo = readFallbackAesSessionOnboardInfo(walletAddress, provider);
  if (!storedOnboardInfo?.aesKey) {
    return null;
  }

  const onboardInfo = mergeAesKey(signer.getUserOnboardInfo(), storedOnboardInfo.aesKey);
  signer.setUserOnboardInfo(onboardInfo);
  return onboardInfo;
};

const getSnapWalletContext = (walletAddress: string) => ({
  expectedChainId: COTI_NETWORK.chainIdDecimal,
  walletAddress
});

export const createWalletScopedSnapAesState = ({
  provider,
  staleTokenAddresses = [],
  status,
  walletAddress
}: {
  provider?: Eip1193Provider | null;
  staleTokenAddresses?: string[];
  status: CotiSnapAesStatus;
  walletAddress: string;
}): WalletScopedSnapAesState => ({
  sessionKey: getCotiAesWalletSessionKey(walletAddress, provider),
  staleTokenAddresses: staleTokenAddresses.map((address) => address.trim().toLowerCase()).filter(Boolean),
  status,
  walletKey: normalizeWalletKey(walletAddress)
});

export const resolveWalletScopedSnapAesState = (
  state: WalletScopedSnapAesState | null | undefined,
  walletAddress: string,
  provider?: Eip1193Provider | null
): WalletScopedSnapAesState | null => {
  const walletKey = normalizeWalletKey(walletAddress);
  if (!state || !walletKey) {
    return null;
  }
  if (state.walletKey !== walletKey || state.sessionKey !== getCotiAesWalletSessionKey(walletAddress, provider)) {
    return null;
  }
  // Vite fast refresh can preserve a state object created before this field
  // existed. Normalize that legacy in-memory shape at the boundary.
  return Array.isArray(state.staleTokenAddresses)
    ? state
    : { ...state, staleTokenAddresses: [] };
};

export const isWalletScopedPrivateTokenSnapStale = (
  state: WalletScopedSnapAesState | null | undefined,
  walletAddress: string,
  tokenAddress: string,
  provider?: Eip1193Provider | null
): boolean => {
  const scopedState = resolveWalletScopedSnapAesState(state, walletAddress, provider);
  return (
    (scopedState?.status === 'installed-aes-stale' ||
      scopedState?.status === 'key-mismatch' ||
      scopedState?.status === 'repair-needed') &&
    scopedState.staleTokenAddresses.includes(tokenAddress.trim().toLowerCase())
  );
};

const mergeAesKey = (current: OnboardInfo | undefined, aesKey: string): OnboardInfo =>
  ({
    ...(current ?? {}),
    aesKey
  }) as OnboardInfo;

const requireOnboardInfo = (onboardInfo?: OnboardInfo): OnboardInfo => {
  if (!onboardInfo?.aesKey) {
    throw new Error('AES key was not returned during privacy unlock.');
  }
  return onboardInfo;
};

const hasRecoverableOnboardInfo = (onboardInfo?: OnboardInfo): boolean =>
  Boolean(onboardInfo?.txHash && onboardInfo.rsaKey?.privateKey && onboardInfo.rsaKey.publicKey);

const isKnownCotiOnboardConsoleError = (args: unknown[]): boolean =>
  args.length === 1 &&
  typeof args[0] === 'string' &&
  args[0].trim() === COTI_ONBOARD_CONSOLE_ERROR;

const generateOrRecoverAes = async (signer: CotiAesSigner): Promise<void> => {
  if (cotiOnboardConsoleSuppressionDepth === 0) {
    originalCotiOnboardConsoleError = console.error;
    console.error = ((...args: unknown[]) => {
      if (isKnownCotiOnboardConsoleError(args)) {
        return;
      }
      originalCotiOnboardConsoleError?.(...args);
    }) as typeof console.error;
  }
  cotiOnboardConsoleSuppressionDepth += 1;

  try {
    await signer.generateOrRecoverAes();
  } finally {
    cotiOnboardConsoleSuppressionDepth -= 1;
    if (cotiOnboardConsoleSuppressionDepth === 0 && originalCotiOnboardConsoleError) {
      console.error = originalCotiOnboardConsoleError;
      originalCotiOnboardConsoleError = null;
    }
  }
};

export const clearSignerAesKey = (signer: CotiAesSigner): void => {
  signer.setUserOnboardInfo(clearOnboardInfoAesKey(signer.getUserOnboardInfo()) ?? ({ aesKey: null } as OnboardInfo));
};

export const resetSignerOnboardInfoForFreshAes = (signer: CotiAesSigner): void => {
  if (typeof signer.clearUserOnboardInfo === 'function') {
    signer.clearUserOnboardInfo();
    return;
  }
  signer.setUserOnboardInfo({
    aesKey: null,
    rsaKey: null,
    txHash: null
  } as OnboardInfo);
};

export const clearOnboardInfoAesKey = (onboardInfo?: OnboardInfo): OnboardInfo | undefined => {
  if (!onboardInfo) {
    return undefined;
  }
  return {
    ...onboardInfo,
    aesKey: null
  };
};

export const resetOnboardInfoForFreshAes = (onboardInfo?: OnboardInfo): OnboardInfo | undefined => {
  if (!onboardInfo) {
    return undefined;
  }
  return {
    ...onboardInfo,
    aesKey: null,
    rsaKey: null,
    txHash: null
  };
};

export const buildWalletAesHealthState = ({
  message,
  status,
  walletAddress
}: {
  message?: string;
  status: WalletAesHealthState['status'];
  walletAddress: string;
}): WalletAesHealthState => ({
  ...(message ? { message } : {}),
  status,
  updatedAt: Date.now(),
  walletKey: normalizeWalletKey(walletAddress)
});

export const validateCotiAesForWallet = async (
  signer: CotiAesSigner,
  onboardInfo: OnboardInfo,
  probes: CotiAesValidationProbe[] = []
): Promise<CotiAesValidationResult> => {
  if (probes.length === 0) {
    return {
      failedProbes: [],
      passedProbes: [],
      status: 'ready-unverified'
    };
  }

  const results = await Promise.all(
    probes.map(async (probe) => {
      try {
        return {
          name: probe.name,
          valid: await probe.validate(signer, onboardInfo)
        };
      } catch {
        return {
          name: probe.name,
          valid: false
        };
      }
    })
  );
  const failedProbes = results.filter((result) => result.valid === false).map((result) => result.name);
  const passedProbes = results.filter((result) => result.valid === true).map((result) => result.name);
  if (failedProbes.length > 0) {
    return {
      failedProbes,
      passedProbes,
      status: 'key-mismatch'
    };
  }
  if (passedProbes.length === 0) {
    return {
      failedProbes,
      passedProbes,
      status: 'ready-unverified'
    };
  }
  return {
    failedProbes,
    passedProbes,
    status: 'valid'
  };
};

export const clearCotiAesUnlockRequest = (walletAddress: string, _provider?: Eip1193Provider | null): void => {
  const walletKey = normalizeWalletKey(walletAddress);
  if (!walletKey) {
    return;
  }

  // A disconnect clears every provider's fallback AES for this owner, so any
  // pending recovery for the same owner must be invalidated as one session.
  walletUnlockEpochs.set(walletKey, (walletUnlockEpochs.get(walletKey) ?? 0) + 1);
  for (const [sessionKey, unlock] of inFlightUnlocks) {
    if (unlock.walletKey === walletKey) {
      inFlightUnlocks.delete(sessionKey);
    }
  }
};

const getOrRecoverAesForWalletResultWithinSignerLock = async (
  {
    allowLegacyFallback = true,
    allowUnrecoverableReset = false,
    assertCurrent,
    forceFreshAes = false,
    forceLegacyRefresh = false,
    forceRefresh = false,
    onInvalidatedOnboardInfo,
    preferSnapAes = false,
    probeSnapAes = true,
    provider,
    requireSnapAes = false,
    signer,
    walletAddress
  }: UnlockArgs,
  walletUnlockEpoch: number,
  lifecycleState: UnlockLifecycleState
): Promise<PrivacyUnlockResult> => {
  const walletKey = normalizeWalletKey(walletAddress);
  if (!walletKey) {
    throw new Error('Connect a wallet before unlocking privacy.');
  }
  const assertUnlockSessionIsCurrent = () => {
    if ((walletUnlockEpochs.get(walletKey) ?? 0) !== walletUnlockEpoch) {
      throw new Error('Privacy unlock was cancelled because the wallet session changed.');
    }
  };
  const runIfUnlockCurrent = <T>(operation: () => T | Promise<T>): Promise<T> => {
    assertUnlockSessionIsCurrent();
    return runWithUnlockLifecycleAssertion(assertCurrent, lifecycleState, () => {
      assertUnlockSessionIsCurrent();
      return operation();
    });
  };
  await runIfUnlockCurrent(() => undefined);

  const shouldTrySnapBeforeCache = Boolean(
    probeSnapAes && preferSnapAes && provider && !forceLegacyRefresh
  );
  const existingOnboardInfo = signer.getUserOnboardInfo();
  if (
    !shouldTrySnapBeforeCache &&
    existingOnboardInfo?.aesKey &&
    !forceRefresh &&
    !forceLegacyRefresh
  ) {
    return runIfUnlockCurrent(() => ({
      status: 'ready',
      onboardInfo: existingOnboardInfo,
      source: 'cache'
    }));
  }
  if (!shouldTrySnapBeforeCache && !forceRefresh && !forceLegacyRefresh) {
    const storedOnboardInfo = await runIfUnlockCurrent(
      () => hydrateSignerWithFallbackAesSession(signer, walletAddress, provider)
    );
    if (storedOnboardInfo?.aesKey) {
      return runIfUnlockCurrent(() => ({
        status: 'ready',
        onboardInfo: storedOnboardInfo,
        source: 'cache'
      }));
    }
  }

  const unlockKey = getCotiAesWalletSessionKey(walletAddress, provider);
  const existingUnlock = inFlightUnlocks.get(unlockKey)?.promise;
  if (existingUnlock) {
    const existingResult = await existingUnlock;
    return runIfUnlockCurrent(() => {
      if (existingResult.status === 'ready') {
        signer.setUserOnboardInfo(existingResult.onboardInfo);
      }
      return existingResult;
    });
  }

  const unlockPromise = (async () => {
    if (probeSnapAes && provider && !forceLegacyRefresh) {
      const snapResult = await runIfUnlockCurrent(
        () => getCotiSnapAesKeyResult(provider, getSnapWalletContext(walletAddress))
      );
      if (snapResult.status === 'ready') {
        return runIfUnlockCurrent(() => {
          const onboardInfo = mergeAesKey(signer.getUserOnboardInfo(), snapResult.aesKey);
          signer.setUserOnboardInfo(onboardInfo);
          return {
            status: 'ready' as const,
            onboardInfo,
            source: 'snap' as const
          };
        });
      }
      if (
        snapResult.status === 'wallet-mismatch' ||
        snapResult.status === 'wrong-network' ||
        snapResult.status === 'rejected'
      ) {
        return runIfUnlockCurrent(() => ({
          status: 'fallback-unavailable' as const,
          reason: snapResult.status
        }));
      }
      if (
        requireSnapAes &&
        snapResult.status !== 'unsupported' &&
        snapResult.status !== 'unsupported-mobile'
      ) {
        return runIfUnlockCurrent(() => ({
          status: 'fallback-unavailable' as const,
          reason: snapResult.status
        }));
      }
      if (!allowLegacyFallback) {
        return runIfUnlockCurrent(() => ({
          status: 'fallback-unavailable' as const,
          reason: snapResult.status
        }));
      }
    }

    if (shouldTrySnapBeforeCache && !forceRefresh) {
      const cachedOnboardInfo = signer.getUserOnboardInfo();
      if (cachedOnboardInfo?.aesKey) {
        return runIfUnlockCurrent(() => ({
          status: 'ready' as const,
          onboardInfo: cachedOnboardInfo,
          source: 'cache' as const
        }));
      }
      const storedOnboardInfo = await runIfUnlockCurrent(
        () => hydrateSignerWithFallbackAesSession(signer, walletAddress, provider)
      );
      if (storedOnboardInfo?.aesKey) {
        return runIfUnlockCurrent(() => ({
          status: 'ready' as const,
          onboardInfo: storedOnboardInfo,
          source: 'cache' as const
        }));
      }
    }

    if (!allowLegacyFallback) {
      return runIfUnlockCurrent(() => ({
        status: 'fallback-unavailable' as const,
        reason: 'disabled' as const
      }));
    }

    const existingInfoBeforeFallback = signer.getUserOnboardInfo();
    if (forceLegacyRefresh && !forceFreshAes && !hasRecoverableOnboardInfo(existingInfoBeforeFallback)) {
      if (!allowUnrecoverableReset) {
        return runIfUnlockCurrent(() => ({
          status: 'fallback-unavailable' as const,
          reason: 'unrecoverable' as const
        }));
      }
    }
    await runIfUnlockCurrent(() => {
      if (forceLegacyRefresh && forceFreshAes) {
        resetSignerOnboardInfoForFreshAes(signer);
      } else if (forceLegacyRefresh) {
        clearSignerAesKey(signer);
      }
      lifecycleState.fallbackGenerationStarted = true;
      return generateOrRecoverAes(signer);
    });
    const recoveredOnboardInfo = requireOnboardInfo(signer.getUserOnboardInfo());
    lifecycleState.completedFallbackOnboardInfo = cloneOnboardInfo(recoveredOnboardInfo);
    let fallbackCommitStarted = false;
    try {
      return await runIfUnlockCurrent(() => {
        fallbackCommitStarted = true;
        lifecycleState.fallbackStorageCommitted = storeFallbackAesSessionOnboardInfo(
          walletAddress,
          provider,
          recoveredOnboardInfo
        );
        return {
          status: 'ready' as const,
          onboardInfo: recoveredOnboardInfo,
          source: 'fallback' as const
        };
      });
    } catch (error) {
      if (!fallbackCommitStarted) {
        await salvageInvalidatedOnboardInfo(
          onInvalidatedOnboardInfo,
          walletKey,
          lifecycleState
        );
      }
      throw error;
    }
  })();

  inFlightUnlocks.set(unlockKey, { promise: unlockPromise, walletKey });
  try {
    return await unlockPromise;
  } finally {
    if (inFlightUnlocks.get(unlockKey)?.promise === unlockPromise) {
      inFlightUnlocks.delete(unlockKey);
    }
  }
};

export const getOrRecoverAesForWalletResult = (args: UnlockArgs): Promise<PrivacyUnlockResult> => {
  const walletKey = normalizeWalletKey(args.walletAddress);
  const walletUnlockEpoch = walletUnlockEpochs.get(walletKey) ?? 0;
  return runWithSerializedSignerUnlock(args.signer, async () => {
    const lifecycleState: UnlockLifecycleState = {
      completedFallbackOnboardInfo: undefined,
      fallbackGenerationStarted: false,
      fallbackStorageCommitted: false,
      invalidated: false,
      invalidatedOnboardInfoSalvage: 'not-attempted'
    };
    try {
      const result = await getOrRecoverAesForWalletResultWithinSignerLock(
        args,
        walletUnlockEpoch,
        lifecycleState
      );
      return await runWithUnlockLifecycleAssertion(args.assertCurrent, lifecycleState, () => {
        if ((walletUnlockEpochs.get(walletKey) ?? 0) !== walletUnlockEpoch) {
          throw new Error('Privacy unlock was cancelled because the wallet session changed.');
        }
        return result;
      });
    } catch (error) {
      if (lifecycleState.fallbackGenerationStarted && args.assertCurrent && !lifecycleState.invalidated) {
        try {
          await runWithUnlockLifecycleAssertion(args.assertCurrent, lifecycleState, () => undefined);
        } catch {
          // Preserve the original unlock error while recording stale lifecycle state for cleanup.
        }
      }
      const walletEpochInvalidated = (walletUnlockEpochs.get(walletKey) ?? 0) !== walletUnlockEpoch;
      const fallbackResultInvalidated =
        lifecycleState.fallbackGenerationStarted &&
        (walletEpochInvalidated || lifecycleState.invalidated);
      if (fallbackResultInvalidated) {
        await salvageInvalidatedOnboardInfo(
          args.onInvalidatedOnboardInfo,
          walletKey,
          lifecycleState
        );
        if (lifecycleState.fallbackStorageCommitted) {
          clearFallbackAesSessionOnboardInfo(args.walletAddress, args.provider);
          lifecycleState.fallbackStorageCommitted = false;
        }
      }
      if (
        walletKey &&
        fallbackResultInvalidated &&
        lifecycleState.invalidatedOnboardInfoSalvage !== 'failed'
      ) {
        resetSignerOnboardInfoForFreshAes(args.signer);
      }
      throw error;
    }
  });
};

export const getOrRecoverAesForWallet = async (args: UnlockArgs): Promise<OnboardInfo> => {
  const result = await getOrRecoverAesForWalletResult(args);
  if (result.status === 'ready') {
    const assertion = args.assertCurrent?.();
    if (assertion) {
      await assertion;
    }
    return result.onboardInfo;
  }
  throw new Error(`Privacy unlock fallback is unavailable: ${result.reason}.`);
};

export const getOrRecoverValidatedAesForWallet = async (
  args: UnlockArgs & { validationProbes?: CotiAesValidationProbe[] }
): Promise<ValidatedPrivacyUnlockResult> => {
  const unlockResult = await getOrRecoverAesForWalletResult(args);
  if (unlockResult.status !== 'ready') {
    return unlockResult;
  }
  const validation = await validateCotiAesForWallet(
    args.signer,
    unlockResult.onboardInfo,
    args.validationProbes
  );
  if (validation.status === 'key-mismatch') {
    clearSignerAesKey(args.signer);
    return {
      source: unlockResult.source,
      status: 'key-mismatch',
      validation
    };
  }
  return {
    onboardInfo: unlockResult.onboardInfo,
    source: unlockResult.source,
    status: validation.status === 'ready-unverified' ? 'ready-unverified' : 'ready',
    validation
  };
};

export const repairCotiAesForWallet = async (
  args: UnlockArgs & { validationProbes?: CotiAesValidationProbe[] }
): Promise<ValidatedPrivacyUnlockResult> => {
  const snapFirstResult = await getOrRecoverValidatedAesForWallet({
    ...args,
    forceFreshAes: false,
    forceLegacyRefresh: false,
    forceRefresh: true
  });
  if (snapFirstResult.status === 'ready' || snapFirstResult.status === 'ready-unverified') {
    return snapFirstResult;
  }
  if (
    snapFirstResult.status === 'fallback-unavailable' &&
    (snapFirstResult.reason === 'wallet-mismatch' || snapFirstResult.reason === 'wrong-network')
  ) {
    return snapFirstResult;
  }

  return getOrRecoverValidatedAesForWallet({
    ...args,
    allowUnrecoverableReset: args.allowUnrecoverableReset ?? true,
    forceFreshAes: false,
    forceLegacyRefresh: true,
    forceRefresh: true
  });
};
