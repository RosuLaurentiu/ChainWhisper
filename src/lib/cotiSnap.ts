import { COTI_NETWORK, normalizeChainId, type Eip1193Provider } from './appShared';

const COTI_SNAP_ID = 'npm:@coti-io/coti-snap';
const PASSIVE_SNAP_RPC_TIMEOUT_MS = 1500;

type SnapResponse = Record<string, unknown>;
type CotiSnapConnectionStatus = 'ready' | 'not-installed' | 'unsupported' | 'unsupported-mobile' | 'rejected' | 'error';
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
  | { status: 'unsupported' }
  | { status: 'unsupported-mobile' }
  | { status: 'wallet-mismatch' }
  | { status: 'wrong-network' }
  | { status: 'rejected' }
  | { status: 'error' };

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

const requestSnap = async (provider: Eip1193Provider): Promise<CotiSnapConnectionStatus> => {
  const capability = await detectWalletSnapCapability(provider);
  if (capability === 'unsupported-mobile') {
    return 'unsupported-mobile';
  }
  if (capability === 'unsupported') {
    return 'unsupported';
  }
  if (capability === 'unknown') {
    return 'unsupported';
  }

  try {
    const snaps = await getInstalledSnaps(provider);
    if (snaps && Object.prototype.hasOwnProperty.call(snaps, COTI_SNAP_ID)) {
      return 'ready';
    }
  } catch {
    // Some injected wallets do not expose Snap discovery; requestSnaps below
    // is the decisive MetaMask-only capability check.
  }

  try {
    await provider.request({
      method: 'wallet_requestSnaps',
      params: {
        [COTI_SNAP_ID]: {}
      }
    });
    return 'ready';
  } catch (error) {
    if (isUserRejectedError(error)) {
      return 'rejected';
    }
    return isUnsupportedSnapError(error) ? 'unsupported' : 'not-installed';
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

const connectInstalledCotiSnapToWallet = async (
  provider: Eip1193Provider
): Promise<'ready' | 'rejected' | 'error'> => {
  const connected = await invokeInstalledCotiSnap<unknown>(provider, 'connect-to-wallet');
  if (!connected.ok) {
    return connected.status;
  }
  return connected.value !== null && connected.value !== false ? 'ready' : 'rejected';
};

const requestAndConnectCotiSnap = async (
  provider: Eip1193Provider
): Promise<CotiSnapConnectionStatus> => {
  const installed = await requestSnap(provider);
  if (installed !== 'ready') {
    return installed;
  }

  return connectInstalledCotiSnapToWallet(provider);
};

const buildSnapChainParams = (context?: CotiSnapWalletContext): Record<string, unknown> | undefined => {
  const chainId = context?.expectedChainId ? String(context.expectedChainId) : undefined;
  return chainId ? { chainId } : undefined;
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

  const connected = await requestAndConnectCotiSnap(provider);
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
  const connected = await requestAndConnectCotiSnap(provider);
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
  const connected = await requestAndConnectCotiSnap(provider);
  if (connected !== 'ready') {
    return connected;
  }
  const deleted = await invokeInstalledCotiSnap(provider, 'delete-aes-key', buildSnapChainParams(context));
  return deleted.ok ? 'ready' : deleted.status;
};
