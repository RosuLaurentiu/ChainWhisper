import type { Eip1193Provider } from './appShared';

const COTI_SNAP_ID = 'npm:@coti-io/coti-snap';

type SnapResponse = Record<string, unknown>;

const requestSnap = async (provider: Eip1193Provider): Promise<boolean> => {
  try {
    const snaps = (await provider.request({ method: 'wallet_getSnaps' })) as Record<string, SnapResponse> | null;
    if (snaps && Object.prototype.hasOwnProperty.call(snaps, COTI_SNAP_ID)) {
      return true;
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
    return true;
  } catch {
    return false;
  }
};

const invokeCotiSnap = async <T>(
  provider: Eip1193Provider,
  method: string,
  params?: Record<string, unknown>
): Promise<T | null> => {
  const installed = await requestSnap(provider);
  if (!installed) {
    return null;
  }

  try {
    return (await provider.request({
      method: 'wallet_invokeSnap',
      params: {
        snapId: COTI_SNAP_ID,
        request: params ? { method, params } : { method }
      }
    })) as T;
  } catch {
    return null;
  }
};

export const getCotiSnapAesKey = async (provider: Eip1193Provider): Promise<string | null> => {
  const hasAesKey = await invokeCotiSnap<boolean>(provider, 'has-aes-key');
  if (!hasAesKey) {
    return null;
  }
  const aesKey = await invokeCotiSnap<unknown>(provider, 'get-aes-key');
  return typeof aesKey === 'string' && aesKey.trim() ? aesKey.trim() : null;
};

export const storeCotiSnapAesKey = async (provider: Eip1193Provider, aesKey?: string | null): Promise<void> => {
  if (!aesKey?.trim()) {
    return;
  }
  await invokeCotiSnap(provider, 'set-aes-key', { newUserAesKey: aesKey.trim() });
};
