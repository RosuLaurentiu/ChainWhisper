import { useEffect, type MutableRefObject } from 'react';
import { BACKGROUND_DEEP_SYNC_DELAY_MS } from '../../../app/appHelpers';
import {
  COTI_NETWORK,
  getCotiWsLastHealthyAt,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  loadCotiEthersModule,
  loadCotiWsProvider,
  markCotiWsHealthyNow,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  resetCotiWsProvider,
  type GroupInvite,
  type GroupSummary,
  type SyncGroupOptions,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS
} from '../../../lib/appShared';
import { mergeGroupSyncOptions, resolveRealtimeGroupSyncOptions } from '../../../lib/groupSyncPlan';
import { isWalletTransactionFlowActive } from '../../../lib/walletTransactionFlow';
import { attachWsDisconnectListeners, type RealtimeConnectionStatus } from '../../../shell/realtimeConnection';

type UseGroupRealtimeSyncArgs = {
  activeGroupIdRef: MutableRefObject<number | null>;
  chainId: number | null;
  groupInvitesRef: MutableRefObject<GroupInvite[]>;
  groupsRef: MutableRefObject<GroupSummary[]>;
  hasAesReady: boolean;
  setGroupRealtimeStatus: (status: RealtimeConnectionStatus) => void;
  syncGroupDataInFlightRef: MutableRefObject<boolean>;
  syncGroupDataRef: MutableRefObject<(options?: SyncGroupOptions) => Promise<void>>;
  walletAddress: string;
};

export default function useGroupRealtimeSync({
  activeGroupIdRef,
  chainId,
  groupInvitesRef,
  groupsRef,
  hasAesReady,
  setGroupRealtimeStatus,
  syncGroupDataInFlightRef,
  syncGroupDataRef,
  walletAddress
}: UseGroupRealtimeSyncArgs) {
  useEffect(() => {
    if (!walletAddress || chainId !== COTI_NETWORK.chainIdDecimal || !hasAesReady) {
      setGroupRealtimeStatus('idle');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeWsDisconnect: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let deepGroupSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;
    let pendingRealtimeSyncOptions: SyncGroupOptions | null = null;

    const mergeRealtimeSyncOptions = (options?: SyncGroupOptions): void => {
      pendingRealtimeSyncOptions = mergeGroupSyncOptions(
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
      syncGroupDataRef.current({
        background: true,
        ...(nextOptions ?? {})
      }).catch(() => {});
    };

    const scheduleRealtimeSync = (options?: SyncGroupOptions) => {
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
        !syncGroupDataInFlightRef.current &&
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
        dispatchRealtimeSync();
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

      setGroupRealtimeStatus('reconnecting');
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
          setupGroupRealtimeSubscription()
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

    const setupGroupRealtimeSubscription = async () => {
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

        const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, wsProvider);
        const handleOverviewEvent = () => scheduleRealtimeSync({ overviewOnly: true });
        const handleMessageEvent = (groupIdValue: unknown) => {
          scheduleRealtimeSync(resolveRealtimeGroupSyncOptions(groupIdValue, activeGroupIdRef.current));
        };

        const createdFilter = contract.filters.GroupCreated(null, walletAddress);
        const memberAddedFilter = contract.filters.GroupMemberAdded(null, walletAddress);
        const memberRemovedFilter = contract.filters.GroupMemberRemoved(null, walletAddress);
        const memberLeftFilter = contract.filters.GroupMemberLeft(null, walletAddress);
        const inviteCreatedFilter = contract.filters.GroupInviteCreated(null, walletAddress, null);
        const inviteAcceptedFilter = contract.filters.GroupInviteAccepted(null, walletAddress, null);
        const inviteDeclinedFilter = contract.filters.GroupInviteDeclined(null, walletAddress, null);
        const inviteRevokedFilter = contract.filters.GroupInviteRevoked(null, walletAddress, null);
        const joinedWithCodeFilter = contract.filters.GroupJoinedWithCode(null, walletAddress, null);
        const joinCodeCreatedFilter = contract.filters.GroupJoinCodeCreated(null, null, walletAddress);
        const joinCodeRevokedFilter = contract.filters.GroupJoinCodeRevoked(null, null, walletAddress);
        const submittedFilter = contract.filters.GroupMessageSubmitted(null, walletAddress);
        const deliveredFilter = contract.filters.GroupMessageDelivered(null, null, walletAddress);

        contract.on(createdFilter, handleOverviewEvent);
        contract.on(memberAddedFilter, handleOverviewEvent);
        contract.on(memberRemovedFilter, handleOverviewEvent);
        contract.on(memberLeftFilter, handleOverviewEvent);
        contract.on(inviteCreatedFilter, handleOverviewEvent);
        contract.on(inviteAcceptedFilter, handleOverviewEvent);
        contract.on(inviteDeclinedFilter, handleOverviewEvent);
        contract.on(inviteRevokedFilter, handleOverviewEvent);
        contract.on(joinedWithCodeFilter, handleOverviewEvent);
        contract.on(joinCodeCreatedFilter, handleOverviewEvent);
        contract.on(joinCodeRevokedFilter, handleOverviewEvent);
        contract.on(submittedFilter, handleMessageEvent);
        contract.on(deliveredFilter, handleMessageEvent);
        unsubscribeWsDisconnect?.();
        unsubscribeWsDisconnect = attachWsDisconnectListeners(wsProvider, handleRealtimeDisconnect);

        if (cancelled) {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          contract.off(createdFilter, handleOverviewEvent);
          contract.off(memberAddedFilter, handleOverviewEvent);
          contract.off(memberRemovedFilter, handleOverviewEvent);
          contract.off(memberLeftFilter, handleOverviewEvent);
          contract.off(inviteCreatedFilter, handleOverviewEvent);
          contract.off(inviteAcceptedFilter, handleOverviewEvent);
          contract.off(inviteDeclinedFilter, handleOverviewEvent);
          contract.off(inviteRevokedFilter, handleOverviewEvent);
          contract.off(joinedWithCodeFilter, handleOverviewEvent);
          contract.off(joinCodeCreatedFilter, handleOverviewEvent);
          contract.off(joinCodeRevokedFilter, handleOverviewEvent);
          contract.off(submittedFilter, handleMessageEvent);
          contract.off(deliveredFilter, handleMessageEvent);
          return;
        }

        unsubscribe = () => {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          contract.off(createdFilter, handleOverviewEvent);
          contract.off(memberAddedFilter, handleOverviewEvent);
          contract.off(memberRemovedFilter, handleOverviewEvent);
          contract.off(memberLeftFilter, handleOverviewEvent);
          contract.off(inviteCreatedFilter, handleOverviewEvent);
          contract.off(inviteAcceptedFilter, handleOverviewEvent);
          contract.off(inviteDeclinedFilter, handleOverviewEvent);
          contract.off(inviteRevokedFilter, handleOverviewEvent);
          contract.off(joinedWithCodeFilter, handleOverviewEvent);
          contract.off(joinCodeCreatedFilter, handleOverviewEvent);
          contract.off(joinCodeRevokedFilter, handleOverviewEvent);
          contract.off(submittedFilter, handleMessageEvent);
          contract.off(deliveredFilter, handleMessageEvent);
        };
        clearPollFallback();
        setGroupRealtimeStatus('connected');
      } catch {
        await resetCotiWsProvider();
        startReconnectFallback();
      }
    };

    const initialGroupSync = syncGroupDataRef.current({ background: true, overviewOnly: true }).catch(() => {});
    initialGroupSync.finally(() => {
      if (cancelled || groupsRef.current.length > 0 || groupInvitesRef.current.length > 0) {
        return;
      }

      deepGroupSyncTimerId = window.setTimeout(() => {
        deepGroupSyncTimerId = null;
        if (cancelled) {
          return;
        }

        syncGroupDataRef.current({ background: true, deep: true, overviewOnly: true }).catch(() => {});
      }, BACKGROUND_DEEP_SYNC_DELAY_MS);
    });
    setupGroupRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      setGroupRealtimeStatus('idle');
      clearPollFallback();
      if (deepGroupSyncTimerId !== null) {
        window.clearTimeout(deepGroupSyncTimerId);
      }
      if (realtimeSyncTimerId !== null) {
        window.clearTimeout(realtimeSyncTimerId);
      }
      unsubscribe?.();
    };
  }, [
    activeGroupIdRef,
    chainId,
    groupInvitesRef,
    groupsRef,
    hasAesReady,
    setGroupRealtimeStatus,
    syncGroupDataInFlightRef,
    syncGroupDataRef,
    walletAddress
  ]);
}
