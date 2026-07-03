import { useEffect, useMemo } from 'react';
import type {
  ChatMessage,
  Contact,
  GroupInvite,
  GroupSummary
} from '../../../lib/appShared';
import { isWalletAddress } from '../../../lib/appShared';

type UseConversationSidebarStateArgs = {
  contacts: Contact[];
  groupInvites: GroupInvite[];
  groups: GroupSummary[];
  messagesByContact: Record<string, ChatMessage[]>;
  persistedContactOrder: string[];
  readStateFeaturesEnabled: boolean;
  setPersistedContactOrder: (next: string[]) => void;
  showHiddenContacts: boolean;
  unreadGroupMap: Record<string, boolean>;
  unreadMap: Record<string, boolean>;
  walletAddress: string;
};

export default function useConversationSidebarState({
  contacts,
  groupInvites,
  groups,
  messagesByContact,
  persistedContactOrder,
  readStateFeaturesEnabled,
  setPersistedContactOrder,
  showHiddenContacts,
  unreadGroupMap,
  unreadMap,
  walletAddress
}: UseConversationSidebarStateArgs) {
  const sortedContacts = useMemo(() => {
    const persistedOrderIndex = new Map<string, number>();
    for (let index = 0; index < persistedContactOrder.length; index += 1) {
      persistedOrderIndex.set(persistedContactOrder[index], index);
    }

    const withIndex = contacts.map((contact, index) => {
      const key = contact.address.toLowerCase();
      const messages = messagesByContact[key] ?? [];
      const latestTimestamp = messages.reduce((max, message) => {
        const value = message.timestamp ?? 0;
        return value > max ? value : max;
      }, 0);

      return {
        contact,
        index,
        messageCount: messages.length,
        latestTimestamp
      };
    });

    withIndex.sort((a, b) => {
      if (a.latestTimestamp !== b.latestTimestamp) {
        return b.latestTimestamp - a.latestTimestamp;
      }

      if (a.messageCount !== b.messageCount) {
        return b.messageCount - a.messageCount;
      }

      const aPersistedOrder = persistedOrderIndex.get(a.contact.address.toLowerCase());
      const bPersistedOrder = persistedOrderIndex.get(b.contact.address.toLowerCase());
      if (
        typeof aPersistedOrder === 'number' &&
        typeof bPersistedOrder === 'number' &&
        aPersistedOrder !== bPersistedOrder
      ) {
        return aPersistedOrder - bPersistedOrder;
      }
      if (typeof aPersistedOrder === 'number') {
        return -1;
      }
      if (typeof bPersistedOrder === 'number') {
        return 1;
      }

      return a.index - b.index;
    });

    return withIndex.map((item) => item.contact);
  }, [contacts, messagesByContact, persistedContactOrder]);

  useEffect(() => {
    if (!walletAddress || !isWalletAddress(walletAddress)) {
      return;
    }

    const nextOrder = sortedContacts.map((contact) => contact.address.toLowerCase());
    const sameLength = persistedContactOrder.length === nextOrder.length;
    const sameOrder = sameLength && persistedContactOrder.every((value, index) => value === nextOrder[index]);
    if (!sameOrder) {
      setPersistedContactOrder(nextOrder);
    }
  }, [persistedContactOrder, setPersistedContactOrder, sortedContacts, walletAddress]);

  const visibleSortedContacts = useMemo(
    () =>
      sortedContacts.filter((contact) => {
        return showHiddenContacts ? !!contact.hidden : !contact.hidden;
      }),
    [sortedContacts, showHiddenContacts]
  );

  const hiddenContactsCount = useMemo(
    () => contacts.reduce((count, contact) => (contact.hidden ? count + 1 : count), 0),
    [contacts]
  );
  const hiddenContactsLabel = hiddenContactsCount === 1 ? '1 hidden chat' : `${hiddenContactsCount} hidden chats`;
  const contactsListEmptyMessage = showHiddenContacts
    ? 'No hidden conversations yet.'
    : contacts.length > 0 && hiddenContactsCount === contacts.length
      ? 'All contacts are hidden. Open hidden chats to restore one.'
      : 'No contacts yet.';

  const sortedGroups = useMemo(
    () =>
      [...groups].sort((left, right) => {
        if (left.lastTimestamp !== right.lastTimestamp) {
          return right.lastTimestamp - left.lastTimestamp;
        }
        return left.id - right.id;
      }),
    [groups]
  );

  const sortedGroupInvites = useMemo(
    () => [...groupInvites].sort((left, right) => left.expiresAt - right.expiresAt || left.groupId - right.groupId),
    [groupInvites]
  );

  const contactGroupPanelRatio = useMemo(() => {
    const contactCount = Math.max(visibleSortedContacts.length, 1);
    const groupCount = Math.max(sortedGroups.length + sortedGroupInvites.length, 1);
    const total = contactCount + groupCount;

    const contactsPanelFlex = Math.max(0.9, Math.min(2.1, (contactCount / total) * 3));
    const groupsPanelFlex = Math.max(0.9, Math.min(2.1, (groupCount / total) * 3));

    return { contactsPanelFlex, groupsPanelFlex };
  }, [visibleSortedContacts.length, sortedGroups.length, sortedGroupInvites.length]);

  const hasUnreadConversations = useMemo(
    () =>
      readStateFeaturesEnabled &&
      (Object.values(unreadMap).some((isUnread) => Boolean(isUnread)) ||
        Object.values(unreadGroupMap).some((isUnread) => Boolean(isUnread))),
    [readStateFeaturesEnabled, unreadGroupMap, unreadMap]
  );

  return {
    contactGroupPanelRatio,
    contactsListEmptyMessage,
    hasUnreadConversations,
    hiddenContactsCount,
    hiddenContactsLabel,
    sortedContacts,
    sortedGroupInvites,
    sortedGroups,
    visibleSortedContacts
  };
}
