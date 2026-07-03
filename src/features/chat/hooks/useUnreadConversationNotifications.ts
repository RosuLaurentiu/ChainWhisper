import { useEffect, useMemo, type MutableRefObject } from 'react';
import {
  isWalletAddress,
  type Contact
} from '../../../lib/appShared';

type StateUpdate<T> = T | ((previous: T) => T);

type UseUnreadConversationNotificationsArgs = {
  contacts: Contact[];
  endConnectSoundSuppression: () => void;
  isConnectSoundSuppressed: () => boolean;
  playNotificationSound: () => void;
  prevUnreadGroupRef: MutableRefObject<Record<string, boolean>>;
  prevUnreadRef: MutableRefObject<Record<string, boolean>>;
  setUnreadMap: (next: StateUpdate<Record<string, boolean>>) => void;
  soundEnabled: boolean;
  unreadGroupMap: Record<string, boolean>;
  unreadGroupMapRef: MutableRefObject<Record<string, boolean>>;
  unreadMap: Record<string, boolean>;
  unreadMapRef: MutableRefObject<Record<string, boolean>>;
};

const hasNewUnread = (
  next: Record<string, boolean>,
  previous: Record<string, boolean>,
  suppressedKeys?: Set<string>
) => {
  for (const key of Object.keys(next)) {
    if (suppressedKeys?.has(key.toLowerCase())) {
      continue;
    }
    if (next[key] && !previous[key]) {
      return true;
    }
  }
  return false;
};

export default function useUnreadConversationNotifications({
  contacts,
  endConnectSoundSuppression,
  isConnectSoundSuppressed,
  playNotificationSound,
  prevUnreadGroupRef,
  prevUnreadRef,
  setUnreadMap,
  soundEnabled,
  unreadGroupMap,
  unreadGroupMapRef,
  unreadMap,
  unreadMapRef
}: UseUnreadConversationNotificationsArgs) {
  const notificationSuppressedContactAddressSet = useMemo(
    () =>
      new Set(
        contacts
          .filter((contact) => contact.muted || contact.hidden)
          .map((contact) => contact.address.trim().toLowerCase())
          .filter((address) => isWalletAddress(address))
      ),
    [contacts]
  );

  useEffect(() => {
    unreadMapRef.current = unreadMap || {};
  }, [unreadMap, unreadMapRef]);

  useEffect(() => {
    unreadGroupMapRef.current = unreadGroupMap || {};
  }, [unreadGroupMap, unreadGroupMapRef]);

  useEffect(() => {
    if (notificationSuppressedContactAddressSet.size === 0) {
      return;
    }

    setUnreadMap((previous) => {
      if (Object.keys(previous).length === 0) {
        return previous;
      }

      let changed = false;
      const nextUnread = { ...previous };
      for (const address of Object.keys(nextUnread)) {
        if (notificationSuppressedContactAddressSet.has(address.toLowerCase())) {
          delete nextUnread[address];
          changed = true;
        }
      }

      if (!changed) {
        return previous;
      }

      unreadMapRef.current = nextUnread;
      return nextUnread;
    });
  }, [notificationSuppressedContactAddressSet, setUnreadMap, unreadMapRef]);

  useEffect(() => {
    const prevContacts = prevUnreadRef.current || {};
    const nextContacts = unreadMap || {};
    const prevGroups = prevUnreadGroupRef.current || {};
    const nextGroups = unreadGroupMap || {};

    const shouldPlaySound =
      hasNewUnread(nextContacts, prevContacts, notificationSuppressedContactAddressSet) ||
      hasNewUnread(nextGroups, prevGroups);
    if (shouldPlaySound && !isConnectSoundSuppressed()) {
      playNotificationSound();
    }

    prevUnreadRef.current = { ...nextContacts };
    prevUnreadGroupRef.current = { ...nextGroups };
  }, [
    isConnectSoundSuppressed,
    notificationSuppressedContactAddressSet,
    playNotificationSound,
    prevUnreadGroupRef,
    prevUnreadRef,
    soundEnabled,
    unreadGroupMap,
    unreadMap
  ]);

  useEffect(() => {
    return () => {
      endConnectSoundSuppression();
    };
  }, [endConnectSoundSuppression]);

  return notificationSuppressedContactAddressSet;
}
