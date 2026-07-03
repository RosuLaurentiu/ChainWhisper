import { useCallback, useMemo } from 'react';
import type { ChatMessage, Contact } from '../../../lib/appShared';
import type { LinkedTradeContext } from '../../../lib/linkedTradeContext';
import type { GroupMessageLoadPhase } from '../../../lib/groupSyncPlan';

type UseActiveConversationStateArgs = {
  activeContact: string | null;
  activeGroupId: number | null;
  contacts: Contact[];
  conversationStateSyncPendingByContact: Record<string, boolean>;
  groupMessageLoadPhaseByGroup: Record<string, GroupMessageLoadPhase>;
  linkedTradeContext: LinkedTradeContext | null;
  messagesByContact: Record<string, ChatMessage[]>;
  messagesByGroup: Record<string, ChatMessage[]>;
  walletAddress: string;
};

export default function useActiveConversationState({
  activeContact,
  activeGroupId,
  contacts,
  conversationStateSyncPendingByContact,
  groupMessageLoadPhaseByGroup,
  linkedTradeContext,
  messagesByContact,
  messagesByGroup,
  walletAddress
}: UseActiveConversationStateArgs) {
  const activeMessages = useMemo(() => {
    if (!activeContact) {
      return [];
    }
    return messagesByContact[activeContact.toLowerCase()] ?? [];
  }, [activeContact, messagesByContact]);

  const activeGroupMessages = useMemo(() => {
    if (activeGroupId === null) {
      return [];
    }
    return messagesByGroup[String(activeGroupId)] ?? [];
  }, [activeGroupId, messagesByGroup]);

  const activeGroupMessageLoadPhase = useMemo(() => {
    if (activeGroupId === null) {
      return null;
    }
    return groupMessageLoadPhaseByGroup[String(activeGroupId)] ?? null;
  }, [activeGroupId, groupMessageLoadPhaseByGroup]);

  const activeThreadKey = useMemo(() => {
    if (activeGroupId !== null) {
      return `group:${activeGroupId}`;
    }
    if (activeContact) {
      return `contact:${activeContact.toLowerCase()}`;
    }
    return null;
  }, [activeGroupId, activeContact]);

  const activeThreadMessages = useMemo(
    () => (activeGroupId !== null ? activeGroupMessages : activeMessages),
    [activeGroupId, activeGroupMessages, activeMessages]
  );

  const activeThreadLastMessageId = useMemo(
    () => (activeThreadMessages.length > 0 ? activeThreadMessages[activeThreadMessages.length - 1].id : null),
    [activeThreadMessages]
  );

  const activeContactMeta = useMemo(
    () => contacts.find((contact) => contact.address.toLowerCase() === activeContact?.toLowerCase()),
    [contacts, activeContact]
  );

  const activeLinkedTradeContext = useMemo(() => {
    const activeContactKey = activeContact?.trim().toLowerCase() ?? '';
    const contextContactKey = linkedTradeContext?.counterpartyAddress?.trim().toLowerCase() ?? '';
    return activeContactKey && contextContactKey && activeContactKey === contextContactKey ? linkedTradeContext : null;
  }, [activeContact, linkedTradeContext]);

  const activeLinkedTradeContextCopyKey = activeLinkedTradeContext
    ? `linked-trade-context:${activeLinkedTradeContext.escrowContract ?? 'default'}:${activeLinkedTradeContext.tradeId}`
    : '';

  const isConversationStateSyncPending = useCallback(
    (address?: string | null): boolean => {
      const normalized = String(address ?? '').trim().toLowerCase();
      if (!normalized) {
        return false;
      }
      return Boolean(conversationStateSyncPendingByContact[normalized]);
    },
    [conversationStateSyncPendingByContact]
  );

  const activeConversationStateSyncPending = isConversationStateSyncPending(activeContact);
  const activeConversationMuted = Boolean(activeContactMeta?.muted);
  const activeConversationHidden = Boolean(activeContactMeta?.hidden);
  const isSelfChat = Boolean(
    activeContact && walletAddress && activeContact.toLowerCase() === walletAddress.toLowerCase()
  );

  return {
    activeContactMeta,
    activeConversationHidden,
    activeConversationMuted,
    activeConversationStateSyncPending,
    activeGroupMessageLoadPhase,
    activeGroupMessages,
    activeLinkedTradeContext,
    activeLinkedTradeContextCopyKey,
    activeMessages,
    activeThreadKey,
    activeThreadLastMessageId,
    activeThreadMessages,
    isConversationStateSyncPending,
    isSelfChat
  };
}
