import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAddress } from '@coti-io/coti-ethers';
import type {
  BrowserWalletSignerLease
} from './useWalletOnboarding';
import { createLeaseGuardedEip1193Provider } from './useSharedWalletSigner';
import type { ChatReadCursorCloudSession } from '../../../lib/chatReadCursorCloudAuth';

const PREFERENCE_PREFIX = 'chainwhisper-chat-read-cursor-cloud-v1:';

export type ChatReadCursorCloudSyncStatus =
  | 'unavailable'
  | 'disabled'
  | 'restoring'
  | 'authorization-required'
  | 'authorizing'
  | 'ready'
  | 'error';

const preferenceKey = (walletAddress: string): string =>
  `${PREFERENCE_PREFIX}${getAddress(walletAddress.trim()).toLowerCase()}`;

const readPreference = (walletAddress: string): boolean => {
  try {
    return window.localStorage.getItem(preferenceKey(walletAddress)) === 'enabled';
  } catch {
    return false;
  }
};

const writePreference = (walletAddress: string, enabled: boolean): void => {
  try {
    const key = preferenceKey(walletAddress);
    if (enabled) window.localStorage.setItem(key, 'enabled');
    else window.localStorage.removeItem(key);
  } catch {
    if (enabled) throw new Error('This browser cannot remember the cross-device sync preference.');
  }
};

export type ChatReadCursorCloudSyncController = Readonly<{
  configured: boolean;
  enabled: boolean;
  error: string;
  session: ChatReadCursorCloudSession | null;
  status: ChatReadCursorCloudSyncStatus;
  authorize: () => Promise<void>;
  disableAndDelete: () => Promise<void>;
  reportCloudError: (error: unknown) => void;
}>;

export default function useChatReadCursorCloudSync({
  assertLeaseSnapshotCurrent,
  captureLease,
  configured = import.meta.env.VITE_CHAT_READ_CURSOR_CLOUD_SYNC_ENABLED === 'true',
  walletAddress
}: {
  assertLeaseSnapshotCurrent: (lease: BrowserWalletSignerLease) => void;
  captureLease: () => BrowserWalletSignerLease;
  configured?: boolean;
  walletAddress: string;
}): ChatReadCursorCloudSyncController {
  const owner = useMemo(() => {
    try { return walletAddress ? getAddress(walletAddress.trim()) : ''; }
    catch { return ''; }
  }, [walletAddress]);
  const [session, setSession] = useState<ChatReadCursorCloudSession | null>(null);
  const [status, setStatus] = useState<ChatReadCursorCloudSyncStatus>(
    configured ? 'disabled' : 'unavailable'
  );
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setSession(null);
    setError('');
    if (!configured || !owner) {
      setStatus(configured ? 'disabled' : 'unavailable');
      return () => { disposed = true; };
    }
    if (!readPreference(owner)) {
      setStatus('disabled');
      return () => { disposed = true; };
    }
    let lease: BrowserWalletSignerLease;
    try {
      lease = captureLease();
      assertLeaseSnapshotCurrent(lease);
    } catch {
      setStatus('authorization-required');
      return () => { disposed = true; };
    }
    setStatus('restoring');
    void import('../../../lib/chatReadCursorCloudAuth').then(async (auth) => {
      const restored = await auth.restoreChatReadCursorCloudSession({
        assertCurrent: () => assertLeaseSnapshotCurrent(lease),
        ownerAddress: owner
      });
      if (disposed) return;
      if (restored) {
        setSession(restored);
        setStatus('ready');
      } else {
        setStatus('authorization-required');
      }
    }).catch(() => {
      if (!disposed) {
        setStatus('error');
        setError('Cross-device read-status sync could not restore its wallet session.');
      }
    });
    return () => { disposed = true; };
  }, [assertLeaseSnapshotCurrent, captureLease, configured, owner]);

  const authorize = useCallback(async () => {
    if (!configured || !owner) {
      throw new Error('Connect the owner wallet before enabling cross-device read-status sync.');
    }
    const lease = captureLease();
    assertLeaseSnapshotCurrent(lease);
    const guardedProvider = createLeaseGuardedEip1193Provider(
      lease.signingProvider,
      async () => assertLeaseSnapshotCurrent(lease),
      () => assertLeaseSnapshotCurrent(lease)
    );
    setStatus('authorizing');
    setError('');
    try {
      const auth = await import('../../../lib/chatReadCursorCloudAuth');
      const authorized = await auth.authorizeChatReadCursorCloudSession({
        assertCurrent: () => assertLeaseSnapshotCurrent(lease),
        ownerAddress: owner,
        wallet: guardedProvider
      });
      assertLeaseSnapshotCurrent(lease);
      writePreference(owner, true);
      setSession(authorized);
      setStatus('ready');
    } catch (cause) {
      setSession(null);
      setStatus('error');
      setError('Cross-device read-status authorization was not completed.');
      throw cause;
    }
  }, [assertLeaseSnapshotCurrent, captureLease, configured, owner]);

  const disableAndDelete = useCallback(async () => {
    if (!owner) return;
    setError('');
    try {
      if (session) {
        const [{ deleteChatReadCursorCloudWallet }, auth] = await Promise.all([
          import('../../../lib/chatReadCursorCloud'),
          import('../../../lib/chatReadCursorCloudAuth')
        ]);
        await deleteChatReadCursorCloudWallet({ session });
        await auth.signOutChatReadCursorCloudSession(session);
      }
      writePreference(owner, false);
      setSession(null);
      setStatus(configured ? 'disabled' : 'unavailable');
    } catch (cause) {
      setStatus('error');
      setError('Cross-device read-status data could not be deleted. Retry before disconnecting.');
      throw cause;
    }
  }, [configured, owner, session]);

  const reportCloudError = useCallback(() => {
    setError('Cross-device read-status sync is temporarily offline. Local unread state is still working.');
  }, []);

  return Object.freeze({
    configured,
    enabled: status === 'ready' && session !== null,
    error,
    session,
    status,
    authorize,
    disableAndDelete,
    reportCloudError
  });
}
