import { useCallback, useEffect, type MutableRefObject } from 'react';
import {
  isWalletAddress,
  toSafeNumber,
  type ChatMessage,
  type GroupSummary
} from '../../../lib/appShared';
import type { StateUpdate } from '../../../shared/state/storeUtils';

type UseConversationReadStateActionsArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  groups: GroupSummary[];
  groupsRef: MutableRefObject<GroupSummary[]>;
  lastReadAllTsRef: MutableRefObject<number>;
  lastReadByContactRef: MutableRefObject<Record<string, number>>;
  lastReadByGroupRef: MutableRefObject<Record<string, number>>;
  messagesByContact: Record<string, ChatMessage[]>;
  messagesByGroup: Record<string, ChatMessage[]>;
  prevUnreadGroupRef: MutableRefObject<Record<string, boolean>>;
  prevUnreadRef: MutableRefObject<Record<string, boolean>>;
  readStateFeaturesEnabled: boolean;
  setLastReadAllTs: (next: StateUpdate<number>) => void;
  setUnreadGroupMap: (next: StateUpdate<Record<string, boolean>>) => void;
  setUnreadMap: (next: StateUpdate<Record<string, boolean>>) => void;
  unreadGroupMapRef: MutableRefObject<Record<string, boolean>>;
  unreadMapRef: MutableRefObject<Record<string, boolean>>;
  walletAddress: string;
};

const pageIsVisible = (): boolean =>
  typeof document !== 'undefined' &&
  !document.hidden &&
  (typeof document.hasFocus === 'function' ? document.hasFocus() : true);

const latestIncomingTimestamp = (messages: ChatMessage[]): number => {
  let latest = 0;
  for (const message of messages) {
    if (message.direction !== 'incoming' || typeof message.timestamp !== 'number') {
      continue;
    }
    const ts = Number(message.timestamp);
    if (ts > latest) {
      latest = ts;
    }
  }
  return latest;
};

export default function useConversationReadStateActions({
  activeContact,
  activeGroupId,
  groups,
  groupsRef,
  lastReadAllTsRef,
  lastReadByContactRef,
  lastReadByGroupRef,
  messagesByContact,
  messagesByGroup,
  prevUnreadGroupRef,
  prevUnreadRef,
  readStateFeaturesEnabled,
  setLastReadAllTs,
  setUnreadGroupMap,
  setUnreadMap,
  unreadGroupMapRef,
  unreadMapRef,
  walletAddress
}: UseConversationReadStateActionsArgs) {
  const markConversationAsRead = useCallback((contactAddress?: string | null) => {
    if (!readStateFeaturesEnabled || !contactAddress) {
      return;
    }

    const normalizedAddress = contactAddress.trim().toLowerCase();
    if (!isWalletAddress(normalizedAddress)) {
      return;
    }

    const readAtTs = Math.max(
      Math.floor(Date.now() / 1000),
      latestIncomingTimestamp(messagesByContact[normalizedAddress] ?? [])
    );
    const previousContactReadTs = lastReadByContactRef.current[normalizedAddress] ?? 0;
    if (readAtTs > previousContactReadTs) {
      lastReadByContactRef.current = {
        ...lastReadByContactRef.current,
        [normalizedAddress]: readAtTs
      };
    }

    const previousUnread = unreadMapRef.current || {};
    if (!previousUnread[normalizedAddress]) {
      return;
    }

    const nextUnread = { ...previousUnread };
    delete nextUnread[normalizedAddress];
    unreadMapRef.current = nextUnread;
    setUnreadMap(nextUnread);

    if (
      Object.keys(nextUnread).length === 0 &&
      Object.keys(unreadGroupMapRef.current || {}).length === 0 &&
      readAtTs > lastReadAllTsRef.current
    ) {
      lastReadAllTsRef.current = readAtTs;
      setLastReadAllTs((previous) => (readAtTs > previous ? readAtTs : previous));
    }
  }, [
    lastReadAllTsRef,
    lastReadByContactRef,
    messagesByContact,
    readStateFeaturesEnabled,
    setLastReadAllTs,
    setUnreadMap,
    unreadGroupMapRef,
    unreadMapRef
  ]);

  const markGroupConversationAsRead = useCallback((groupId?: number | null) => {
    if (!readStateFeaturesEnabled || !Number.isFinite(groupId) || (groupId ?? 0) <= 0) {
      return;
    }

    const normalizedGroupId = Math.floor(groupId as number);
    const groupKey = String(normalizedGroupId);
    const groupSummary = groupsRef.current.find((group) => group.id === normalizedGroupId);
    const latestFromSummary = groupSummary ? toSafeNumber(groupSummary.lastTimestamp) : 0;
    const readAtTs = Math.max(
      Math.floor(Date.now() / 1000),
      latestIncomingTimestamp(messagesByGroup[groupKey] ?? []),
      latestFromSummary
    );
    const previousGroupReadTs = lastReadByGroupRef.current[groupKey] ?? 0;
    if (readAtTs > previousGroupReadTs) {
      lastReadByGroupRef.current = {
        ...lastReadByGroupRef.current,
        [groupKey]: readAtTs
      };
    }

    const previousUnread = unreadGroupMapRef.current || {};
    if (!previousUnread[groupKey]) {
      return;
    }

    const nextUnread = { ...previousUnread };
    delete nextUnread[groupKey];
    unreadGroupMapRef.current = nextUnread;
    setUnreadGroupMap(nextUnread);

    if (
      Object.keys(nextUnread).length === 0 &&
      Object.keys(unreadMapRef.current || {}).length === 0 &&
      readAtTs > lastReadAllTsRef.current
    ) {
      lastReadAllTsRef.current = readAtTs;
      setLastReadAllTs((previous) => (readAtTs > previous ? readAtTs : previous));
    }
  }, [
    groupsRef,
    lastReadAllTsRef,
    lastReadByGroupRef,
    messagesByGroup,
    readStateFeaturesEnabled,
    setLastReadAllTs,
    setUnreadGroupMap,
    unreadGroupMapRef,
    unreadMapRef
  ]);

  const markAllConversationsAsRead = useCallback(() => {
    if (!readStateFeaturesEnabled) {
      return;
    }

    const previousUnreadContacts = unreadMapRef.current || {};
    const previousUnreadGroups = unreadGroupMapRef.current || {};
    const unreadAddresses = Object.keys(previousUnreadContacts).filter((address) => isWalletAddress(address));
    const unreadGroupKeys = Object.keys(previousUnreadGroups).filter(
      (groupKey) => Number.isFinite(Number(groupKey)) && Number(groupKey) > 0
    );
    if (unreadAddresses.length === 0 && unreadGroupKeys.length === 0) {
      return;
    }

    const nowTs = Math.floor(Date.now() / 1000);
    const nextReadByContact = { ...lastReadByContactRef.current };
    const nextReadByGroup = { ...lastReadByGroupRef.current };
    let nextGlobalReadTs = Math.max(lastReadAllTsRef.current, nowTs);

    for (const address of unreadAddresses) {
      const readAtTs = Math.max(nowTs, latestIncomingTimestamp(messagesByContact[address] ?? []));
      if (readAtTs > (nextReadByContact[address] ?? 0)) {
        nextReadByContact[address] = readAtTs;
      }
      if (readAtTs > nextGlobalReadTs) {
        nextGlobalReadTs = readAtTs;
      }
    }

    for (const groupKey of unreadGroupKeys) {
      const groupId = Number(groupKey);
      const summary = groupsRef.current.find((group) => group.id === groupId);
      const latestFromSummary = summary ? toSafeNumber(summary.lastTimestamp) : 0;
      const readAtTs = Math.max(nowTs, latestIncomingTimestamp(messagesByGroup[groupKey] ?? []), latestFromSummary);
      if (readAtTs > (nextReadByGroup[groupKey] ?? 0)) {
        nextReadByGroup[groupKey] = readAtTs;
      }
      if (readAtTs > nextGlobalReadTs) {
        nextGlobalReadTs = readAtTs;
      }
    }

    lastReadByContactRef.current = nextReadByContact;
    lastReadByGroupRef.current = nextReadByGroup;
    unreadMapRef.current = {};
    unreadGroupMapRef.current = {};
    setUnreadMap({});
    setUnreadGroupMap({});

    if (nextGlobalReadTs > lastReadAllTsRef.current) {
      lastReadAllTsRef.current = nextGlobalReadTs;
      setLastReadAllTs((previous) => (nextGlobalReadTs > previous ? nextGlobalReadTs : previous));
    }
  }, [
    groupsRef,
    lastReadAllTsRef,
    lastReadByContactRef,
    lastReadByGroupRef,
    messagesByContact,
    messagesByGroup,
    readStateFeaturesEnabled,
    setLastReadAllTs,
    setUnreadGroupMap,
    setUnreadMap,
    unreadGroupMapRef,
    unreadMapRef
  ]);

  useEffect(() => {
    setUnreadMap({});
    setUnreadGroupMap({});
    unreadMapRef.current = {};
    unreadGroupMapRef.current = {};
    setLastReadAllTs(0);
    prevUnreadRef.current = {};
    prevUnreadGroupRef.current = {};
    lastReadAllTsRef.current = 0;
    lastReadByContactRef.current = {};
    lastReadByGroupRef.current = {};
  }, [
    lastReadAllTsRef,
    lastReadByContactRef,
    lastReadByGroupRef,
    prevUnreadGroupRef,
    prevUnreadRef,
    setLastReadAllTs,
    setUnreadGroupMap,
    setUnreadMap,
    unreadGroupMapRef,
    unreadMapRef,
    walletAddress
  ]);

  useEffect(() => {
    if (activeContact && pageIsVisible()) {
      markConversationAsRead(activeContact);
    }
  }, [activeContact, markConversationAsRead, messagesByContact]);

  useEffect(() => {
    if (activeGroupId !== null && pageIsVisible()) {
      markGroupConversationAsRead(activeGroupId);
    }
  }, [activeGroupId, groups, markGroupConversationAsRead, messagesByGroup]);

  return {
    markAllConversationsAsRead,
    markConversationAsRead,
    markGroupConversationAsRead
  };
}
