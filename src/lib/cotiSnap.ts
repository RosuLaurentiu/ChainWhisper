import { COTI_NETWORK, normalizeChainId, type Eip1193Provider } from './appShared';

const COTI_SNAP_ID = 'npm:@coti-io/coti-snap';
// Snap 1.0.54 is the first version that reads AES keys by the requested
// account address. Older versions return the key of the Snap's own first
// permitted account, so the App confirms that account before it reads a key.
// The App never requests a Snap update: every COTI Snap version clears all of
// its stored AES keys in its onUpdate handler.
const COTI_SNAP_ADDRESS_LOOKUP_VERSION = '1.0.54';
const PASSIVE_SNAP_RPC_TIMEOUT_MS = 1500;

type SnapResponse = Record<string, unknown>;
type CotiSnapConnectionStatus =
  | 'ready'
  | 'not-installed'
  | 'unsupported'
  | 'unsupported-mobile'
  | 'rejected'
  | 'error';
const SET_AES_KEY_ALLOWED_ORIGINS = new Set(['https://metamask.coti.io', 'https://dev.metamask.coti.io']);

export type WalletSnapCapability = 'supported' | 'unsupported' | 'unsupported-mobile' | 'unknown';

export type CotiSnapAesStatus =
  | 'unknown'
  | 'unsupported'
  | 'unsupported-mobile'
  | 'not-installed'
  | 'installed'
  | 'installed-aes-ready'
  | 'installed-aes-missing'
  | 'installed-aes-stale'
  | 'key-mismatch'
  | 'repair-needed'
  | 'rejected'
  | 'error';

export type CotiSnapAesKeyResult =
  | { status: 'ready'; aesKey: string }
  | { status: 'missing-aes' }
  | { status: 'not-installed' }
  | { status: 'snap-account-mismatch' }
  | { status: 'unsupported' }
  | { status: 'unsupported-mobile' }
  | { status: 'wallet-mismatch' }
  | { status: 'wrong-network' }
  | { status: 'rejected' }
  | { status: 'error' };

export type CotiSnapOwnerAesStatus =
  | 'ready'
  | 'snap-not-installed'
  | 'snap-account-mismatch'
  | 'snap-missing-aes'
  | 'unsupported'
  | 'unsupported-mobile'
  | 'wallet-mismatch'
  | 'wrong-network'
  | 'rejected'
  | 'error';

export type CotiSnapOwnerAesResult =
  | { status: 'ready'; aesKey: string }
  | { status: Exclude<CotiSnapOwnerAesStatus, 'ready'> };

const getCurrentOrigin = (): string | null => {
  const maybeWindow = globalThis as { window?: { location?: { origin?: unknown } } };
  const origin = maybeWindow.window?.location?.origin;
  return typeof origin === 'string' && origin.trim() ? origin.trim() : null;
};

export const canStoreCotiSnapAesKeyFromCurrentOrigin = (origin: string | null = getCurrentOrigin()): boolean =>
  !origin || SET_AES_KEY_ALLOWED_ORIGINS.has(origin);

export type CotiSnapWalletContext = {
  expectedChainId?: number;
  userAgent?: string;
  walletAddress?: string;
};

const getNavigatorUserAgent = (): string => {
  const maybeNavigator = globalThis as { navigator?: { userAgent?: unknown } };
  return typeof maybeNavigator.navigator?.userAgent === 'string' ? maybeNavigator.navigator.userAgent : '';
};

const isMobileUserAgent = (userAgent = getNavigatorUserAgent()): boolean =>
  /android|iphone|ipad|ipod|mobile/i.test(userAgent);

const isMetaMaskMobileContext = (
  provider: Eip1193Provider,
  userAgent = getNavigatorUserAgent()
): boolean => {
  const providerWithFlags = provider as Eip1193Provider & { isMetaMask?: boolean };
  return Boolean(
    isMobileUserAgent(userAgent) &&
      (providerWithFlags.isMetaMask || /metamaskmobile|metamask/i.test(userAgent))
  );
};

const isUserRejectedError = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown } | null | undefined;
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
  return candidate?.code === 4001 || message.includes('reject') || message.includes('denied');
};

const isUnsupportedSnapError = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown } | null | undefined;
  const message = typeof candidate?.message === 'string' ? candidate.message.toLowerCase() : '';
  return (
    candidate?.code === -32601 ||
    candidate?.code === 4200 ||
    message.includes('unsupported') ||
    message.includes('does not exist') ||
    message.includes('not supported')
  );
};

const requestPassiveProviderRpc = async <T>(
  provider: Eip1193Provider,
  request: { method: string; params?: object | unknown[] },
  timeoutMs = PASSIVE_SNAP_RPC_TIMEOUT_MS
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      provider.request(request) as Promise<T>,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(Object.assign(new Error(`Passive wallet RPC timed out: ${request.method}`), { code: 'CW_TIMEOUT' }));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

const parseSnapVersion = (version: unknown): [number, number, number] | null => {
  const match = typeof version === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim()) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const ADDRESS_LOOKUP_VERSION_PARTS = parseSnapVersion(COTI_SNAP_ADDRESS_LOOKUP_VERSION) as [number, number, number];

// COTI version suffixes are build hashes, not ordered pre-release labels, so
// compare only the numeric release part.
export const cotiSnapSupportsAddressLookup = (version: unknown): boolean => {
  const parts = parseSnapVersion(version);
  if (!parts) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (parts[index] !== ADDRESS_LOOKUP_VERSION_PARTS[index]) {
      return parts[index] > ADDRESS_LOOKUP_VERSION_PARTS[index];
    }
  }
  return true;
};

const getSnapEntry = (snaps: unknown): SnapResponse | null => {
  if (!snaps || typeof snaps !== 'object' || !Object.prototype.hasOwnProperty.call(snaps, COTI_SNAP_ID)) {
    return null;
  }
  const entry = (snaps as Record<string, unknown>)[COTI_SNAP_ID];
  return entry && typeof entry === 'object' ? (entry as SnapResponse) : {};
};

const getInstalledSnaps = async (provider: Eip1193Provider): Promise<Record<string, SnapResponse> | null> => {
  try {
    return await requestPassiveProviderRpc<Record<string, SnapResponse> | null>(provider, { method: 'wallet_getSnaps' });
  } catch {
    return null;
  }
};

export const detectWalletSnapCapability = async (
  provider: Eip1193Provider,
  userAgent = getNavigatorUserAgent()
): Promise<WalletSnapCapability> => {
  try {
    await requestPassiveProviderRpc(provider, { method: 'wallet_getSnaps' });
    return 'supported';
  } catch (error) {
    // A mobile-looking user agent can come from desktop device emulation while
    // the injected MetaMask extension still supports Snaps. Let the provider
    // capability win, and only classify genuine mobile MetaMask after its Snap
    // RPC probe fails.
    if (isMetaMaskMobileContext(provider, userAgent)) {
      return 'unsupported-mobile';
    }
    return isUnsupportedSnapError(error) || (error as { code?: unknown })?.code === 'CW_TIMEOUT'
      ? 'unsupported'
      : 'unknown';
  }
};

const normalizeWalletAddress = (address?: string | null): string => address?.trim().toLowerCase() ?? '';

const confirmSnapWalletContext = async (
  provider: Eip1193Provider,
  context?: CotiSnapWalletContext
): Promise<'ready' | 'wallet-mismatch' | 'wrong-network' | 'error'> => {
  const expectedWallet = normalizeWalletAddress(context?.walletAddress);
  const expectedChainId = context?.expectedChainId ?? COTI_NETWORK.chainIdDecimal;

  try {
    if (expectedWallet) {
      const accounts = await requestPassiveProviderRpc<string[]>(provider, { method: 'eth_accounts' });
      const activeWallet = normalizeWalletAddress(Array.isArray(accounts) ? accounts[0] : '');
      if (activeWallet !== expectedWallet) {
        return 'wallet-mismatch';
      }
    }

    const activeChainId = normalizeChainId(
      await requestPassiveProviderRpc<string | number>(provider, { method: 'eth_chainId' })
    );
    return activeChainId === expectedChainId ? 'ready' : 'wrong-network';
  } catch {
    return 'error';
  }
};

type CotiSnapRequestResult =
  | { status: 'ready'; snap: SnapResponse }
  | { status: Exclude<CotiSnapConnectionStatus, 'ready'> };

const requestSnap = async (provider: Eip1193Provider): Promise<CotiSnapRequestResult> => {
  const capability = await detectWalletSnapCapability(provider);
  if (capability === 'unsupported-mobile') {
    return { status: 'unsupported-mobile' };
  }
  if (capability === 'unsupported' || capability === 'unknown') {
    return { status: 'unsupported' };
  }

  // wallet_getSnaps lists only Snaps that this origin may use. Any listed
  // version is kept: an update would clear the Snap's stored AES keys.
  const installedEntry = getSnapEntry(await getInstalledSnaps(provider));
  if (installedEntry) {
    return { status: 'ready', snap: installedEntry };
  }

  // No version: MetaMask installs its allowlisted version, or only grants this
  // origin access to an installed Snap without changing its version.
  try {
    const requested = await provider.request({
      method: 'wallet_requestSnaps',
      params: {
        [COTI_SNAP_ID]: {}
      }
    });
    return {
      status: 'ready',
      snap: getSnapEntry(requested) ?? getSnapEntry(await getInstalledSnaps(provider)) ?? {}
    };
  } catch (error) {
    if (isUserRejectedError(error)) {
      return { status: 'rejected' };
    }
    return { status: isUnsupportedSnapError(error) ? 'unsupported' : 'not-installed' };
  }
};

const invokeInstalledCotiSnap = async <T>(
  provider: Eip1193Provider,
  method: string,
  params?: Record<string, unknown>
): Promise<{ ok: true; value: T } | { ok: false; status: 'rejected' | 'error' }> => {
  try {
    const value = (await provider.request({
      method: 'wallet_invokeSnap',
      params: {
        snapId: COTI_SNAP_ID,
        request: params ? { method, params } : { method }
      }
    })) as T;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, status: isUserRejectedError(error) ? 'rejected' : 'error' };
  }
};

// connect-to-wallet only reports whether the Snap has any account access;
// it shows no prompt. False means the Snap has no account, not a rejection.
const connectInstalledCotiSnapToWallet = async (
  provider: Eip1193Provider
): Promise<'ready' | 'snap-account-mismatch' | 'rejected' | 'error'> => {
  const connected = await invokeInstalledCotiSnap<unknown>(provider, 'connect-to-wallet');
  if (!connected.ok) {
    return connected.status;
  }
  return connected.value !== null && connected.value !== false ? 'ready' : 'snap-account-mismatch';
};

type CotiSnapAccountStatus = 'ready' | 'snap-account-mismatch' | 'rejected' | 'error';

// A Snap older than 1.0.54 ignores `address` and uses its first permitted
// account. Read that account and refuse another account's key.
const confirmSnapKeyAccount = async (
  provider: Eip1193Provider,
  snap: SnapResponse,
  context?: CotiSnapWalletContext
): Promise<CotiSnapAccountStatus> => {
  const expectedWallet = normalizeWalletAddress(context?.walletAddress);
  if (!expectedWallet || cotiSnapSupportsAddressLookup(snap.version)) {
    return 'ready';
  }
  const permissions = await invokeInstalledCotiSnap<{ permittedAccounts?: unknown }>(
    provider,
    'check-account-permissions'
  );
  if (!permissions.ok) {
    return permissions.status;
  }
  const permittedAccounts = permissions.value?.permittedAccounts;
  const snapAccount = Array.isArray(permittedAccounts) && typeof permittedAccounts[0] === 'string'
    ? normalizeWalletAddress(permittedAccounts[0])
    : '';
  if (!snapAccount) {
    return 'error';
  }
  return snapAccount === expectedWallet ? 'ready' : 'snap-account-mismatch';
};

const requestAndConnectCotiSnap = async (
  provider: Eip1193Provider,
  context?: CotiSnapWalletContext
): Promise<CotiSnapConnectionStatus | 'snap-account-mismatch'> => {
  const installed = await requestSnap(provider);
  if (installed.status !== 'ready') {
    return installed.status;
  }

  const connected = await connectInstalledCotiSnapToWallet(provider);
  if (connected !== 'ready') {
    return connected;
  }
  return confirmSnapKeyAccount(provider, installed.snap, context);
};

// Snap 1.0.54+ reads the key stored for `address`. Older Snaps ignore it.
const buildSnapChainParams = (context?: CotiSnapWalletContext): Record<string, unknown> | undefined => {
  const address = normalizeWalletAddress(context?.walletAddress);
  const chainId = context?.expectedChainId ? String(context.expectedChainId) : undefined;
  const params: Record<string, unknown> = {
    ...(address ? { address } : {}),
    ...(chainId ? { chainId } : {})
  };
  return Object.keys(params).length > 0 ? params : undefined;
};

export const getCotiSnapAesStatus = async (
  provider: Eip1193Provider,
  userAgent = getNavigatorUserAgent()
): Promise<CotiSnapAesStatus> => {
  const capability = await detectWalletSnapCapability(provider, userAgent);
  if (capability === 'unsupported-mobile') {
    return 'unsupported-mobile';
  }
  if (capability === 'unsupported') {
    return 'unsupported';
  }

  const snaps = await getInstalledSnaps(provider);
  if (!snaps) {
    return 'unsupported';
  }
  if (!Object.prototype.hasOwnProperty.call(snaps, COTI_SNAP_ID)) {
    return 'not-installed';
  }

  return 'installed';
};

export const getCotiSnapAesKeyResult = async (
  provider: Eip1193Provider,
  context?: CotiSnapWalletContext
): Promise<CotiSnapAesKeyResult> => {
  const walletContext = await confirmSnapWalletContext(provider, context);
  if (walletContext !== 'ready') {
    return { status: walletContext };
  }

  const capability = await detectWalletSnapCapability(provider, context?.userAgent);
  if (capability === 'unsupported-mobile' || capability === 'unsupported') {
    return { status: capability };
  }
  if (capability === 'unknown') {
    return { status: 'unsupported' };
  }

  const connected = await requestAndConnectCotiSnap(provider, context);
  if (connected !== 'ready') {
    return { status: connected };
  }

  const connectedWalletContext = await confirmSnapWalletContext(provider, context);
  if (connectedWalletContext !== 'ready') {
    return { status: connectedWalletContext };
  }

  const snapChainParams = buildSnapChainParams(context);
  const hasAesKey = await invokeInstalledCotiSnap<boolean>(provider, 'has-aes-key', snapChainParams);
  if (!hasAesKey.ok) {
    return { status: hasAesKey.status };
  }
  if (!hasAesKey.value) {
    return { status: 'missing-aes' };
  }
  const aesKey = await invokeInstalledCotiSnap<unknown>(provider, 'get-aes-key', snapChainParams);
  if (!aesKey.ok) {
    return { status: aesKey.status };
  }
  return typeof aesKey.value === 'string' && aesKey.value.trim()
    ? { status: 'ready', aesKey: aesKey.value.trim() }
    : { status: 'missing-aes' };
};

export const getCotiSnapAesKey = async (provider: Eip1193Provider): Promise<string | null> => {
  const result = await getCotiSnapAesKeyResult(provider);
  return result.status === 'ready' ? result.aesKey : null;
};

export const getCotiSnapOwnerAesKeyResult = async (
  provider: Eip1193Provider,
  ownerAddress: string,
  context?: Omit<CotiSnapWalletContext, 'walletAddress'>
): Promise<CotiSnapOwnerAesResult> => {
  const result = await getCotiSnapAesKeyResult(provider, {
    ...context,
    expectedChainId: context?.expectedChainId ?? COTI_NETWORK.chainIdDecimal,
    walletAddress: ownerAddress
  });
  if (result.status === 'ready') {
    return result;
  }
  if (result.status === 'not-installed') {
    return { status: 'snap-not-installed' };
  }
  if (result.status === 'missing-aes') {
    return { status: 'snap-missing-aes' };
  }
  return { status: result.status };
};

export const getCotiSnapOwnerAesStatusMessage = (status: Exclude<CotiSnapOwnerAesStatus, 'ready'>): string => {
  switch (status) {
    case 'snap-not-installed':
      return 'COTI Snap is not installed. Install the COTI Snap in MetaMask desktop, then try again.';
    case 'snap-account-mismatch':
      return 'COTI Snap does not use this wallet account. In MetaMask, connect only this wallet account to the COTI Snap, then try again.';
    case 'snap-missing-aes':
      return `COTI Snap has no AES key for this wallet on ${COTI_NETWORK.shortName} on this device. Onboard this wallet in COTI Snap, then try again. Each MetaMask install keeps its own Snap keys.`;
    case 'unsupported-mobile':
      return 'MetaMask Mobile does not support COTI Snap here. Use MetaMask desktop with COTI Snap for account recovery.';
    case 'unsupported':
      return 'This wallet does not support COTI Snap. Use MetaMask desktop with COTI Snap for account recovery.';
    case 'wallet-mismatch':
      return 'The active MetaMask account changed. Select the same owner wallet and try again.';
    case 'wrong-network':
      return `Switch MetaMask to ${COTI_NETWORK.shortName} before unlocking privacy.`;
    case 'rejected':
      return 'The COTI Snap request was rejected.';
    case 'error':
    default:
      return 'COTI Snap could not return the owner AES key. Check the Snap connection and try again.';
  }
};

export const storeCotiSnapAesKeyResult = async (
  provider: Eip1193Provider,
  aesKey?: string | null,
  context?: CotiSnapWalletContext
): Promise<Exclude<CotiSnapAesKeyResult['status'], 'missing-aes'>> => {
  if (!aesKey?.trim()) {
    return 'error';
  }
  if (!canStoreCotiSnapAesKeyFromCurrentOrigin()) {
    return 'unsupported';
  }
  const walletContext = await confirmSnapWalletContext(provider, context);
  if (walletContext !== 'ready') {
    return walletContext;
  }
  const connected = await requestAndConnectCotiSnap(provider, context);
  if (connected !== 'ready') {
    return connected;
  }
  const stored = await invokeInstalledCotiSnap(provider, 'set-aes-key', {
    newUserAesKey: aesKey.trim(),
    ...buildSnapChainParams(context)
  });
  return stored.ok ? 'ready' : stored.status;
};

export const storeCotiSnapAesKey = async (
  provider: Eip1193Provider,
  aesKey?: string | null,
  context?: CotiSnapWalletContext
): Promise<void> => {
  await storeCotiSnapAesKeyResult(provider, aesKey, context);
};

export const deleteCotiSnapAesKeyResult = async (
  provider: Eip1193Provider,
  context?: CotiSnapWalletContext
): Promise<Exclude<CotiSnapAesKeyResult['status'], 'missing-aes'>> => {
  const walletContext = await confirmSnapWalletContext(provider, context);
  if (walletContext !== 'ready') {
    return walletContext;
  }
  const connected = await requestAndConnectCotiSnap(provider, context);
  if (connected !== 'ready') {
    return connected;
  }
  const deleted = await invokeInstalledCotiSnap(provider, 'delete-aes-key', buildSnapChainParams(context));
  return deleted.ok ? 'ready' : deleted.status;
};
