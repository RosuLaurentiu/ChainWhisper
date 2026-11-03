import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ChatMessage } from '../../../lib/appShared/core';
import type { GroupChatV2Runtime } from '../../../lib/groupChatV2Runtime';
import { isGroupChatV2EpochEnvelopeSyncRequiredError } from '../../../lib/groupChatV2Chain';

type EpochRequest = Readonly<{ groupId: number; epoch: bigint }> | null;

export default function useGroupChatV2History({ runtime, activeGroupId, activeGroupIdRef, hasAesReady, refreshNonce,
  setMessagesByGroup, setEpochSyncRequest, onLoadStart, onLoadEnd }: {
  runtime: GroupChatV2Runtime | null;
  activeGroupId: number | null;
  activeGroupIdRef: MutableRefObject<number | null>;
  hasAesReady: boolean;
  refreshNonce: number;
  setMessagesByGroup: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setEpochSyncRequest: Dispatch<SetStateAction<EpochRequest>>;
  onLoadStart?: (groupId: number) => void;
  onLoadEnd?: (groupId: number) => void;
}) {
  const view = useRef({ runtime, activeGroupId, hasAesReady, refreshNonce });
  view.current = { runtime, activeGroupId, hasAesReady, refreshNonce };
  const [availability, setAvailability] = useState<Readonly<{
    runtime: GroupChatV2Runtime; groupId: number; refreshNonce: number; unavailable: boolean;
    hasOlder: boolean; loadingOlder: boolean
  }> | null>(null);
  const olderRequest = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const selectedGroupId = activeGroupId;
    if (!runtime?.enabled || !hasAesReady || selectedGroupId === null) {
      setEpochSyncRequest(null);
      return;
    }
    setEpochSyncRequest(previous => previous?.groupId === selectedGroupId ? previous : null);
    let disposed = false;
    let timer: number | undefined;
    let loadPending = false;
    let inFlight = false;
    let hasOlder = false;
    const sameView = () => view.current.runtime === runtime && view.current.activeGroupId === selectedGroupId &&
      activeGroupIdRef.current === selectedGroupId;
    const isCurrent = () => !disposed && runtime.isCurrent() && view.current.runtime === runtime && view.current.hasAesReady &&
      view.current.refreshNonce === refreshNonce && sameView();
    const endLoad = () => {
      if (!loadPending) return;
      loadPending = false;
      onLoadEnd?.(selectedGroupId);
    };
    const setUnavailable = (unavailable: boolean, loadingOlder = false) => setAvailability({ runtime,
      groupId: selectedGroupId, refreshNonce, unavailable, hasOlder, loadingOlder });
    if (isCurrent()) {
      setUnavailable(false);
      loadPending = true;
      onLoadStart?.(selectedGroupId);
    }
    const sync = async (older = false) => {
      if (!isCurrent() || inFlight) return;
      inFlight = true;
      if (older) {
        if (timer !== undefined) window.clearTimeout(timer);
        setUnavailable(false, true);
        loadPending = true;
        onLoadStart?.(selectedGroupId);
      }
      try {
        const { mergeGroupMessageEntries } = await import('../../../lib/groupMessageSync');
        if (!isCurrent()) return;
        const result = await (older ? runtime.history.loadOlder : runtime.history.sync)(BigInt(selectedGroupId), page => {
          if (!isCurrent()) return false;
          setMessagesByGroup(previous => {
            if (!runtime.isCurrent() || view.current.runtime !== runtime || !view.current.hasAesReady) return previous;
            const groupKey = String(selectedGroupId);
            const existing = page.resetConversation
              ? (previous[groupKey] ?? []).filter(message => !message.groupV2)
              : previous[groupKey] ?? [];
            return { ...previous, [groupKey]: mergeGroupMessageEntries(existing, [...page.entries]) };
          });
          return true;
        }, isCurrent);
        if (!isCurrent()) return;
        hasOlder = result.hasOlder;
        setUnavailable(false);
        setEpochSyncRequest(previous => previous?.groupId === selectedGroupId ? null : previous);
        endLoad();
        timer = window.setTimeout(() => { void sync(); }, 5_000);
      } catch (historyError) {
        if (!isCurrent()) return;
        endLoad();
        if (isGroupChatV2EpochEnvelopeSyncRequiredError(historyError) && historyError.groupId === BigInt(selectedGroupId)) {
          setUnavailable(false);
          setEpochSyncRequest(Object.freeze({ groupId: selectedGroupId, epoch: historyError.epoch }));
          return;
        }
        setUnavailable(true);
      } finally {
        inFlight = false;
      }
    };
    const loadOlder = async () => { if (hasOlder) await sync(true); };
    olderRequest.current = loadOlder;
    void sync();
    return () => {
      disposed = true;
      if (olderRequest.current === loadOlder) olderRequest.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
      // Cleanup precedes the next effect's start. Never clear a different
      // wallet/runtime/view that has already taken ownership of the phase.
      if (runtime.isCurrent() && sameView()) endLoad();
    };
  }, [activeGroupId, activeGroupIdRef, refreshNonce, runtime, hasAesReady, setMessagesByGroup, setEpochSyncRequest, onLoadStart, onLoadEnd]);
  const currentAvailability = runtime?.enabled && runtime.isCurrent() && hasAesReady &&
    availability?.runtime === runtime && availability.groupId === activeGroupId &&
    availability.refreshNonce === refreshNonce ? availability : null;
  return { historyUnavailable: currentAvailability?.unavailable ?? false,
    hasOlderHistory: currentAvailability?.hasOlder ?? false,
    loadingOlderHistory: currentAvailability?.loadingOlder ?? false,
    loadOlderHistory: async () => { await olderRequest.current?.(); } };
}
