import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { COTI_NETWORK, type Eip1193Provider } from './appShared';
import {
  getCotiSnapAesKeyResult,
  type CotiSnapAesKeyResult,
  type CotiSnapAesStatus
} from './cotiSnap';

type CotiAesSigner = Pick<
  JsonRpcSigner | Wallet,
  'generateOrRecoverAes' | 'getUserOnboardInfo' | 'setUserOnboardInfo'
> &
  Partial<Pick<JsonRpcSigner | Wallet, 'clearUserOnboardInfo'>>;

type UnlockArgs = {
  allowLegacyFallback?: boolean;
  allowUnrecoverableReset?: boolean;
  forceFreshAes?: boolean;
  forceLegacyRefresh?: boolean;
  forceRefresh?: boolean;
  provider?: Eip1193Provider | null;
  requireSnapAes?: boolean;
  signer: CotiAesSigner;
  walletAddress: string;
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
const inFlightUnlocks = new Map<string, Promise<PrivacyUnlockResult>>();
const FALLBACK_AES_SESSION_STORAGE_PREFIX = 'chainwhisper:fallback-aes:v1:';

const normalizeWalletKey = (walletAddress: string): string => walletAddress.trim().toLowerCase();

const getStableProviderId = (provider?: Eip1193Provider | null): string => {
  if (!provider || (typeof provider !== 'object' && typeof provider !== 'function')) {
    return 'no-provider';
  }

  const providerWithFlags = provider as Eip1193Provider & {
    isBackpack?: boolean;
    isBraveWallet?: boolean;
    isCipher?: boolean;
    isCipherTrade?: boolean;
    isCipherWallet?: boolean;
    isCoinbaseWallet?: boolean;
    isCypher?: boolean;
    isCypherTrade?: boolean;
    isCypherWallet?: boolean;
    isFrame?: boolean;
    isMetaMask?: boolean;
    isOKXWallet?: boolean;
    isPhantom?: boolean;
    isRabby?: boolean;
    isTally?: boolean;
    isTrust?: boolean;
    isTrustWallet?: boolean;
  };
  if (
    providerWithFlags.isCipherTrade ||
    providerWithFlags.isCipherWallet ||
    providerWithFlags.isCipher ||
    providerWithFlags.isCypherTrade ||
    providerWithFlags.isCypherWallet ||
    providerWithFlags.isCypher
  ) {
    return 'ciphertrade';
  }
  if (providerWithFlags.isMetaMask && providerWithFlags.isBraveWallet) {
    return 'brave-wallet';
  }
  if (providerWithFlags.isMetaMask) {
    return 'metamask';
  }
  if (providerWithFlags.isRabby) {
    return 'rabby';
  }
  if (providerWithFlags.isCoinbaseWallet) {
    return 'coinbase-wallet';
  }
  if (providerWithFlags.isTrust || providerWithFlags.isTrustWallet) {
    return 'trust-wallet';
  }
  if (providerWithFlags.isFrame) {
    return 'frame';
  }
  if (providerWithFlags.isPhantom) {
    return 'phantom';
  }
  if (providerWithFlags.isBackpack) {
    return 'backpack';
  }
  if (providerWithFlags.isOKXWallet) {
    return 'okx-wallet';
  }
  if (providerWithFlags.isTally) {
    return 'tally';
  }
  return '';
};

const getProviderId = (provider?: Eip1193Provider | null): string => {
  if (!provider || (typeof provider !== 'object' && typeof provider !== 'function')) {
    return 'no-provider';
  }
  const stableProviderId = getStableProviderId(provider);
  if (stableProviderId) {
    return stableProviderId;
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

const getFallbackAesSessionStorageKey = (walletAddress: string, provider?: Eip1193Provider | null): string =>
  `${FALLBACK_AES_SESSION_STORAGE_PREFIX}${getCotiAesWalletSessionKey(walletAddress, provider)}`;

export const readFallbackAesSessionOnboardInfo = (
  walletAddress: string,
  provider?: Eip1193Provider | null
): OnboardInfo | null => {
  const walletKey = normalizeWalletKey(walletAddress);
  const storage = getFallbackAesStorage();
  if (!walletKey || !provider || !storage) {
    return null;
  }

  try {
    const raw = storage.getItem(getFallbackAesSessionStorageKey(walletAddress, provider));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      aesKey?: unknown;
      chainId?: unknown;
      providerId?: unknown;
      walletKey?: unknown;
    };
    const aesKey = typeof parsed.aesKey === 'string' ? parsed.aesKey.trim() : '';
    if (
      !aesKey ||
      parsed.walletKey !== walletKey ||
      parsed.providerId !== getProviderId(provider) ||
      parsed.chainId !== COTI_NETWORK.chainIdDecimal
    ) {
      return null;
    }
    return { aesKey } as OnboardInfo;
  } catch {
    return null;
  }
};

export const storeFallbackAesSessionOnboardInfo = (
  walletAddress: string,
  provider: Eip1193Provider | null | undefined,
  onboardInfo?: OnboardInfo
): boolean => {
  const walletKey = normalizeWalletKey(walletAddress);
  const aesKey = typeof onboardInfo?.aesKey === 'string' ? onboardInfo.aesKey.trim() : '';
  const storage = getFallbackAesStorage();
  if (!walletKey || !provider || !aesKey || !storage) {
    return false;
  }

  try {
    storage.setItem(
      getFallbackAesSessionStorageKey(walletAddress, provider),
      JSON.stringify({
        aesKey,
        chainId: COTI_NETWORK.chainIdDecimal,
        providerId: getProviderId(provider),
        savedAt: Date.now(),
        walletKey
      })
    );
    return true;
  } catch {
    return false;
  }
};

export const clearFallbackAesSessionOnboardInfo = (
  walletAddress: string,
  provider?: Eip1193Provider | null
): void => {
  const walletKey = normalizeWalletKey(walletAddress);
  const storage = getFallbackAesStorage();
  if (!walletKey || !storage) {
    return;
  }

  try {
    if (provider) {
      storage.removeItem(getFallbackAesSessionStorageKey(walletAddress, provider));
      return;
    }
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(FALLBACK_AES_SESSION_STORAGE_PREFIX)) {
        continue;
      }
      const raw = storage.getItem(key);
      if (!raw) {
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as { walletKey?: unknown };
        if (parsed.walletKey === walletKey) {
          storage.removeItem(key);
        }
      } catch {
      }
    }
  } catch {
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
  return state.walletKey === walletKey && state.sessionKey === getCotiAesWalletSessionKey(walletAddress, provider)
    ? state
    : null;
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

export const clearCotiAesUnlockRequest = (walletAddress: string, provider?: Eip1193Provider | null): void => {
  inFlightUnlocks.delete(getCotiAesWalletSessionKey(walletAddress, provider));
};

export const getOrRecoverAesForWalletResult = async ({
  allowLegacyFallback = true,
  allowUnrecoverableReset = false,
  forceFreshAes = false,
  forceLegacyRefresh = false,
  forceRefresh = false,
  provider,
  requireSnapAes = false,
  signer,
  walletAddress
}: UnlockArgs): Promise<PrivacyUnlockResult> => {
  const walletKey = normalizeWalletKey(walletAddress);
  if (!walletKey) {
    throw new Error('Connect a wallet before unlocking privacy.');
  }

  const existingOnboardInfo = signer.getUserOnboardInfo();
  if (existingOnboardInfo?.aesKey && !forceRefresh && !forceLegacyRefresh) {
    return {
      status: 'ready',
      onboardInfo: existingOnboardInfo,
      source: 'cache'
    };
  }
  if (!forceRefresh && !forceLegacyRefresh) {
    const storedOnboardInfo = hydrateSignerWithFallbackAesSession(signer, walletAddress, provider);
    if (storedOnboardInfo?.aesKey) {
      return {
        status: 'ready',
        onboardInfo: storedOnboardInfo,
        source: 'cache'
      };
    }
  }

  const unlockKey = getCotiAesWalletSessionKey(walletAddress, provider);
  const existingUnlock = inFlightUnlocks.get(unlockKey);
  if (existingUnlock) {
    return existingUnlock;
  }

  const unlockPromise = (async () => {
    if (provider && !forceLegacyRefresh) {
      const snapResult = await getCotiSnapAesKeyResult(provider, getSnapWalletContext(walletAddress));
      if (snapResult.status === 'ready') {
        const onboardInfo = mergeAesKey(signer.getUserOnboardInfo(), snapResult.aesKey);
        signer.setUserOnboardInfo(onboardInfo);
        return {
          status: 'ready' as const,
          onboardInfo,
          source: 'snap' as const
        };
      }
      if (snapResult.status === 'wallet-mismatch' || snapResult.status === 'wrong-network') {
        return {
          status: 'fallback-unavailable' as const,
          reason: snapResult.status
        };
      }
      if (
        requireSnapAes &&
        snapResult.status !== 'unsupported' &&
        snapResult.status !== 'unsupported-mobile'
      ) {
        return {
          status: 'fallback-unavailable' as const,
          reason: snapResult.status
        };
      }
      if (!allowLegacyFallback) {
        return {
          status: 'fallback-unavailable' as const,
          reason: snapResult.status
        };
      }
    }

    if (!allowLegacyFallback) {
      return {
        status: 'fallback-unavailable' as const,
        reason: 'disabled' as const
      };
    }

    const existingInfoBeforeFallback = signer.getUserOnboardInfo();
    if (forceLegacyRefresh && !forceFreshAes && !hasRecoverableOnboardInfo(existingInfoBeforeFallback)) {
      if (!allowUnrecoverableReset) {
        return {
          status: 'fallback-unavailable' as const,
          reason: 'unrecoverable' as const
        };
      }
    }
    if (forceLegacyRefresh && forceFreshAes) {
      resetSignerOnboardInfoForFreshAes(signer);
    } else if (forceLegacyRefresh) {
      clearSignerAesKey(signer);
    }
    await signer.generateOrRecoverAes();
    const recoveredOnboardInfo = requireOnboardInfo(signer.getUserOnboardInfo());
    storeFallbackAesSessionOnboardInfo(walletAddress, provider, recoveredOnboardInfo);
    return {
      status: 'ready' as const,
      onboardInfo: recoveredOnboardInfo,
      source: 'fallback' as const
    };
  })();

  inFlightUnlocks.set(unlockKey, unlockPromise);
  try {
    return await unlockPromise;
  } finally {
    if (inFlightUnlocks.get(unlockKey) === unlockPromise) {
      inFlightUnlocks.delete(unlockKey);
    }
  }
};

export const getOrRecoverAesForWallet = async (args: UnlockArgs): Promise<OnboardInfo> => {
  const result = await getOrRecoverAesForWalletResult(args);
  if (result.status === 'ready') {
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
