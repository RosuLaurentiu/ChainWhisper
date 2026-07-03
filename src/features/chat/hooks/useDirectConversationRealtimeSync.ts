import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { BACKGROUND_DEEP_SYNC_DELAY_MS } from '../../../app/appHelpers';
import {
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  COTI_NETWORK,
  getCotiWsLastHealthyAt,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiWsProvider,
  markCotiWsHealthyNow,
  normalizeContactName,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  resetCotiWsProvider,
  type Contact,
  type SyncConversationOptions,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS
} from '../../../lib/appShared';
import { mergeDirectSyncOptions } from '../../../lib/directSyncPlan';
import type { WalletReadAccount } from '../../../lib/walletAccountScope';
import { isWalletTransactionFlowActive } from '../../../lib/walletTransactionFlow';
import { attachWsDisconnectListeners, type RealtimeConnectionStatus } from '../../../shell/realtimeConnection';

type UseDirectConversationRealtimeSyncArgs = {
  activeContactRef: MutableRefObject<string | null>;
  chainId: number | null;
  conversationDeepBackfillDoneRef: MutableRefObject<Record<string, boolean>>;
  isSyncingConversationHistoryRef: MutableRefObject<boolean>;
  onChainNicknameCacheRef: MutableRefObject<Record<string, string | null>>;
  readableWalletAccountKeys: string;
  readableWalletAccounts: WalletReadAccount[];
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setDirectRealtimeStatus: (status: RealtimeConnectionStatus) => void;
  setMyNickname: (nickname: string) => void;
  syncConversationHistoryRef: MutableRefObject<(options?: SyncConversationOptions) => Promise<void>>;
  walletAddress: string;
};

export default function useDirectConversationRealtimeSync({
  activeContactRef,
  chainId,
  conversationDeepBackfillDoneRef,
  isSyncingConversationHistoryRef,
  onChainNicknameCacheRef,
  readableWalletAccountKeys,
  readableWalletAccounts,
  setContacts,
  setDirectRealtimeStatus,
  setMyNickname,
  syncConversationHistoryRef,
  walletAddress
}: UseDirectConversationRealtimeSyncArgs) {
  useEffect(() => {
    const directRealtimeAccounts = readableWalletAccounts.filter(
      (account) => account.canReadPrivate && isWalletAddress(account.address)
    );
    if (!walletAddress || chainId !== COTI_NETWORK.chainIdDecimal || directRealtimeAccounts.length === 0) {
      setDirectRealtimeStatus('idle');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeWsDisconnect: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let deepConversationSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;
    let pendingRealtimeSyncOptions: SyncConversationOptions | null = null;

    const mergeRealtimeSyncOptions = (options?: SyncConversationOptions): void => {
      pendingRealtimeSyncOptions = mergeDirectSyncOptions(
        { background: true, ...(options ?? {}) },
        pendingRealtimeSyncOptions
      );
    };

    const dispatchRealtimeSync = () => {
      if (cancelled) {
        return;
      }

      const nextOptions = pendingRealtimeSyncOptions;
      pendingRealtimeSyncOptions = null;
      lastRealtimeSyncDispatchAt = Date.now();
      syncConversationHistoryRef.current({
        background: true,
        ...(nextOptions ?? {})
      }).catch(() => {});
    };

    const scheduleRealtimeSync = (options?: SyncConversationOptions) => {
      if (isWalletTransactionFlowActive()) {
        return;
      }
      mergeRealtimeSyncOptions(options);
      if (cancelled) {
        return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
        !isSyncingConversationHistoryRef.current &&
        realtimeSyncTimerId === null;
      if (canDispatchImmediately) {
        dispatchRealtimeSync();
        return;
      }

      if (realtimeSyncTimerId !== null) {
        return;
      }

      const nextDelay = Math.max(
        REALTIME_SYNC_DEBOUNCE_MS,
        REALTIME_SYNC_BURST_THROTTLE_MS - elapsedSinceLastDispatch
      );
      realtimeSyncTimerId = window.setTimeout(() => {
        realtimeSyncTimerId = null;
        if (!cancelled) {
          dispatchRealtimeSync();
        }
      }, nextDelay);
    };

    const clearPollFallback = () => {
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }

      if (wsReconnectIntervalId !== null) {
        window.clearInterval(wsReconnectIntervalId);
        wsReconnectIntervalId = null;
      }
    };

    const startReconnectFallback = () => {
      if (cancelled) {
        return;
      }

      setDirectRealtimeStatus('reconnecting');
      if (pollIntervalId === null) {
        pollIntervalId = window.setInterval(() => {
          scheduleRealtimeSync();
        }, REALTIME_SYNC_FALLBACK_INTERVAL_MS);
      }

      if (wsReconnectIntervalId === null) {
        wsReconnectIntervalId = window.setInterval(() => {
          if (wsReconnectInFlight || cancelled) {
            return;
          }

          wsReconnectInFlight = true;
          setupRealtimeSubscription()
            .catch(() => {})
            .finally(() => {
              wsReconnectInFlight = false;
            });
        }, WS_RETRY_COOLDOWN_MS);
      }
    };

    const handleRealtimeDisconnect = () => {
      if (cancelled) {
        return;
      }

      unsubscribe?.();
      unsubscribe = null;
      scheduleRealtimeSync();
      resetCotiWsProvider().catch(() => {});
      startReconnectFallback();
    };

    const setupRealtimeSubscription = async () => {
      try {
        if (cancelled) {
          return;
        }

        const cotiEthers = await loadCotiEthersModule();
        const wsProvider = await loadCotiWsProvider();
        if (Date.now() - getCotiWsLastHealthyAt() > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        markCotiWsHealthyNow();
        const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, wsProvider);

        const directMessageFilters = directRealtimeAccounts.flatMap((account) => [
          contract.filters.MessageSubmitted(null, account.address, null),
          contract.filters.MessageSubmitted(null, null, account.address)
        ]);
        const nicknameFilter = contract.filters.NicknameSet();
        const resolveDirectRealtimeSyncOptions = (_messageId: unknown, recipient: unknown, from: unknown): SyncConversationOptions => {
          const activeContactKey = activeContactRef.current?.trim().toLowerCase() ?? '';
          const recipientKey = String(recipient ?? '').trim().toLowerCase();
          const fromKey = String(from ?? '').trim().toLowerCase();
          if (
            activeContactKey &&
            isWalletAddress(activeContactKey) &&
            (recipientKey === activeContactKey || fromKey === activeContactKey)
          ) {
            return { activeContactOnly: true };
          }

          return {
            contactsOnly: true,
            previewPerContact: true,
            updateHead: true
          };
        };
        const handleMessageSubmitted = (messageId: unknown, recipient: unknown, from: unknown) => {
          scheduleRealtimeSync(resolveDirectRealtimeSyncOptions(messageId, recipient, from));
        };
        const handleNicknameSet = (user: unknown, nickname: unknown) => {
          const userAddress = String(user ?? '').trim().toLowerCase();
          if (!isWalletAddress(userAddress)) {
            return;
          }

          const normalizedNickname = normalizeContactName(String(nickname ?? '').replace(/\r?\n/g, '')) ?? null;
          onChainNicknameCacheRef.current[userAddress] = normalizedNickname;
          if (normalizedNickname && userAddress === walletAddress.toLowerCase()) {
            setMyNickname(normalizedNickname);
          }

          setContacts((previous) =>
            previous.map((contact) =>
              contact.address.toLowerCase() === userAddress
                ? {
                    ...contact,
                    name: normalizedNickname ?? undefined
                  }
                : contact
            )
          );
        };

        for (const filter of directMessageFilters) {
          contract.on(filter, handleMessageSubmitted);
        }
        contract.on(nicknameFilter, handleNicknameSet);
        unsubscribeWsDisconnect?.();
        unsubscribeWsDisconnect = attachWsDisconnectListeners(wsProvider, handleRealtimeDisconnect);

        if (cancelled) {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          for (const filter of directMessageFilters) {
            contract.off(filter, handleMessageSubmitted);
          }
          contract.off(nicknameFilter, handleNicknameSet);
          return;
        }

        unsubscribe = () => {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          for (const filter of directMessageFilters) {
            contract.off(filter, handleMessageSubmitted);
          }
          contract.off(nicknameFilter, handleNicknameSet);
        };

        clearPollFallback();
        setDirectRealtimeStatus('connected');
      } catch {
        await resetCotiWsProvider();
        startReconnectFallback();
      }
    };

    const initialConversationSync = syncConversationHistoryRef.current({
      contactsOnly: true,
      previewPerContact: true,
      updateHead: true
    }).catch(() => {});
    const walletKey = walletAddress.trim().toLowerCase();
    initialConversationSync.finally(() => {
      if (
        cancelled ||
        !isWalletAddress(walletKey) ||
        conversationDeepBackfillDoneRef.current[walletKey]
      ) {
        return;
      }

      deepConversationSyncTimerId = window.setTimeout(() => {
        deepConversationSyncTimerId = null;
        if (cancelled || conversationDeepBackfillDoneRef.current[walletKey]) {
          return;
        }

        conversationDeepBackfillDoneRef.current[walletKey] = true;
        syncConversationHistoryRef.current({ background: true, deep: true }).catch(() => {
          delete conversationDeepBackfillDoneRef.current[walletKey];
        });
      }, BACKGROUND_DEEP_SYNC_DELAY_MS);
    });
    setupRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      setDirectRealtimeStatus('idle');
      clearPollFallback();
      if (deepConversationSyncTimerId !== null) {
        window.clearTimeout(deepConversationSyncTimerId);
      }
      if (realtimeSyncTimerId !== null) {
        window.clearTimeout(realtimeSyncTimerId);
      }
      unsubscribe?.();
    };
  }, [
    activeContactRef,
    chainId,
    conversationDeepBackfillDoneRef,
    isSyncingConversationHistoryRef,
    onChainNicknameCacheRef,
    readableWalletAccountKeys,
    readableWalletAccounts,
    setContacts,
    setDirectRealtimeStatus,
    setMyNickname,
    syncConversationHistoryRef,
    walletAddress
  ]);
}
