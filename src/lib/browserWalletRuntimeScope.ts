import { getAddress } from '@coti-io/coti-ethers';

export type BrowserWalletRuntimeScopeSession = Readonly<{
  address: string;
  chainId: number | null;
  source?: string;
  walletId: string;
  provider?: object;
}>;

const PROVIDER_IDENTITIES = new WeakMap<object, number>();
let nextProviderIdentity = 0;
const providerIdentity = (provider?: object): string => {
  if (!provider) return 'unspecified-provider';
  if (!PROVIDER_IDENTITIES.has(provider)) PROVIDER_IDENTITIES.set(provider, ++nextProviderIdentity);
  return `provider-${PROVIDER_IDENTITIES.get(provider)}`;
};

const normalizeAddress = (value: string): string | null => {
  try {
    return getAddress(value.trim()).toLowerCase();
  } catch {
    return null;
  }
};

export const buildBrowserOwnerDataScopeKey = (walletAddress: string): string =>
  normalizeAddress(walletAddress) ?? '';

/** Defer cold background setup without closing the same already-started owner runtime. */
export const resolveBrowserRuntimeStartupScope = (
  scopeKey: string | null,
  startedScopeKey: string | null,
  deferStartup: boolean
): string | null => scopeKey && (!deferStartup || scopeKey === startedScopeKey) ? scopeKey : null;

export type BrowserRuntimeInitialDiscovery<T> = Readonly<{ scopeKey: string | null; runtime: T }>;
export type BrowserRuntimeSetupFailure = Readonly<{ scopeKey: string | null; message: string }>;

export type BrowserWalletPrivacyReadScope = Readonly<{
  runtimeScopeKey: string | null;
  ready: boolean;
  revision: number;
}>;

/** Public identity stays admitted; each lock/unlock replaces private read authority. */
export const resolveBrowserWalletPrivacyReadScope = (
  runtimeScopeKey: string | null, ready: boolean, previous: BrowserWalletPrivacyReadScope | null
): BrowserWalletPrivacyReadScope => {
  const allowed = Boolean(runtimeScopeKey) && ready;
  if (previous?.runtimeScopeKey === runtimeScopeKey && previous.ready === allowed) return previous;
  return Object.freeze({ runtimeScopeKey, ready: allowed, revision: (previous?.revision ?? -1) + 1 });
};

export const assertBrowserWalletPrivacyReadScopeCurrent = (
  captured: BrowserWalletPrivacyReadScope | null, current: BrowserWalletPrivacyReadScope | null
): void => {
  if (!captured?.ready || !captured.runtimeScopeKey || captured !== current) {
    throw new Error('P2P private read session changed. Unlock privacy to continue.');
  }
};

export const getBrowserRuntimeSetupError = (
  scopeKey: string | null, failure: BrowserRuntimeSetupFailure | null
): string => failure?.scopeKey === scopeKey ? failure.message : '';

/** Keep cold background work behind the selected owner's initial discovery attempt. */
export const shouldDeferBrowserRuntimeStartup = <T extends { isCurrent: () => boolean }>({
  selected, scopeKey, runtime, setupFailed, initialDiscovery, activeReadPass
}: {
  selected: boolean;
  scopeKey: string | null;
  runtime: T | null;
  setupFailed: boolean;
  initialDiscovery?: BrowserRuntimeInitialDiscovery<T> | null;
  activeReadPass?: Readonly<{ scopeKey: string | null; pending: boolean }> | null;
}): boolean => selected && Boolean(scopeKey) && !setupFailed &&
  (activeReadPass?.scopeKey === scopeKey && activeReadPass.pending ||
    !runtime?.isCurrent() || initialDiscovery?.runtime !== runtime || initialDiscovery.scopeKey !== scopeKey);

/** Reject private projections immediately, before the old runtime's effect cleanup. */
export const bindBrowserWalletRuntimePrivacyScope = <T extends { isCurrent: () => boolean }>(
  runtime: T, isPrivacyScopeCurrent: () => boolean
): T => Object.freeze({ ...runtime,
  isCurrent: () => isPrivacyScopeCurrent() && runtime.isCurrent()
}) as T;

/** Stop an obsolete setup from producing another read or publishing a late result. */
export const createBrowserWalletRuntimeReadGuard = (assertSnapshotCurrent: () => void) => {
  let current = true;
  const pendingReads = new AbortController();
  const assertCurrent = () => {
    if (!current) throw new Error('Browser wallet runtime setup was replaced.');
    assertSnapshotCurrent();
  };
  return Object.freeze({
    assertCurrent,
    signal: pendingReads.signal,
    run: async <T>(read: () => Promise<T>): Promise<T> => {
      assertCurrent();
      const result = await read();
      assertCurrent();
      return result;
    },
    close: () => {
      current = false;
      pendingReads.abort(new Error('Browser wallet runtime setup was replaced.'));
    }
  });
};

export const buildBrowserWalletRuntimeScopeKey = ({
  activeSignerSource,
  deploymentFingerprint,
  expectedChainId,
  session,
  variant = 'default',
  walletAddress
}: {
  activeSignerSource: string | null | undefined;
  deploymentFingerprint: string;
  expectedChainId: bigint;
  session: BrowserWalletRuntimeScopeSession | null;
  variant?: string;
  walletAddress: string;
}): string | null => {
  const owner = normalizeAddress(walletAddress);
  const sessionOwner = session ? normalizeAddress(session.address) : null;
  const sessionChainId = session?.chainId;
  const fingerprint = deploymentFingerprint.trim();
  const walletId = session?.walletId.trim() ?? '';
  const source = session?.source?.trim() || 'injected';
  const scopeVariant = variant.trim();

  if (
    activeSignerSource !== 'metamask' ||
    !session ||
    !owner ||
    sessionOwner !== owner ||
    !Number.isSafeInteger(sessionChainId) ||
    Number(sessionChainId) <= 0 ||
    BigInt(sessionChainId as number) !== expectedChainId ||
    !fingerprint ||
    !walletId ||
    !scopeVariant
  ) {
    return null;
  }

  return [
    fingerprint,
    expectedChainId.toString(),
    owner,
    walletId,
    source,
    scopeVariant,
    providerIdentity(session.provider)
  ].join(':');
};
