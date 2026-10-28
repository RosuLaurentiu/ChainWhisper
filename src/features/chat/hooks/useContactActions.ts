import type { Dispatch, FormEvent, MutableRefObject, SetStateAction } from 'react';
import { Contact, ConversationPreferenceState, isWalletAddress } from '../../../lib/appShared';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type UseContactActionsArgs = {
  activeContact: string | null;
  browserWalletLiteMode: boolean;
  contacts: Contact[];
  isConversationStateSyncPending: (address?: string | null) => boolean;
  newContact: string;
  pinnedContactStateRef: MutableRefObject<Map<string, ConversationPreferenceState>>;
  setActiveContact: StateSetter<string | null>;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setConversationStateSyncPendingByContact: Dispatch<SetStateAction<Record<string, boolean>>>;
  setError: (next: string) => void;
  setNewContact: StateSetter<string>;
  setShowQuickActionsModal: StateSetter<boolean>;
  showHiddenContacts: boolean;
  syncConversationStateFromInput: (
    contactAddress: string,
    state: ConversationPreferenceState,
    visibleNotice?: string
  ) => Promise<boolean>;
};

export default function useContactActions({
  activeContact,
  browserWalletLiteMode,
  contacts,
  isConversationStateSyncPending,
  newContact,
  pinnedContactStateRef,
  setActiveContact,
  setContacts,
  setConversationStateSyncPendingByContact,
  setError,
  setNewContact,
  setShowQuickActionsModal,
  showHiddenContacts,
  syncConversationStateFromInput
}: UseContactActionsArgs) {
  const setConversationStateSyncPending = (address: string, pending: boolean) => {
    const normalizedAddress = address.trim().toLowerCase();
    if (!isWalletAddress(normalizedAddress)) {
      return;
    }

    setConversationStateSyncPendingByContact((previous) => {
      if (pending) {
        return {
          ...previous,
          [normalizedAddress]: true
        };
      }

      if (!previous[normalizedAddress]) {
        return previous;
      }

      const next = { ...previous };
      delete next[normalizedAddress];
      return next;
    });
  };

  const handleAddContact = (event: FormEvent) => {
    event.preventDefault();
    setError('');

    const address = newContact.trim();
    if (!isWalletAddress(address)) {
      setError('Enter a valid EVM wallet address.');
      return;
    }

    const existingIndex = contacts.findIndex((contact) => contact.address.toLowerCase() === address.toLowerCase());
    if (existingIndex >= 0) {
      setError('This contact already exists.');
      return;
    }

    setContacts((previous) => [...previous, { address }]);
    setNewContact('');
    if (!activeContact) {
      setActiveContact(address);
    }
    setShowQuickActionsModal(false);
  };

  const removeContact = (address: string) => {
    toggleConversationHiddenForContact(address).catch(() => {});
  };

  const toggleConversationHiddenForContact = async (address: string) => {
    if (browserWalletLiteMode) {
      setError('Private contact settings are unavailable for this wallet mode.');
      return;
    }

    const normalizedAddress = address.trim().toLowerCase();
    if (isConversationStateSyncPending(normalizedAddress)) {
      return;
    }

    const targetContact = contacts.find(
      (contact) => contact.address.trim().toLowerCase() === normalizedAddress
    );
    if (!targetContact) {
      return;
    }

    const nextHidden = !(targetContact.hidden || targetContact.muted);
    setConversationStateSyncPending(normalizedAddress, true);
    const hiddenNoticeText = nextHidden ? 'Conversation hidden.' : 'Conversation restored.';

    try {
      const synced = await syncConversationStateFromInput(
        address,
        { hidden: nextHidden },
        hiddenNoticeText
      );
      if (!synced) {
        return;
      }

      pinnedContactStateRef.current.set(normalizedAddress, { hidden: nextHidden });
      setContacts((previous) =>
        previous.map((contact) =>
          contact.address.trim().toLowerCase() === normalizedAddress
            ? { ...contact, muted: undefined, hidden: nextHidden }
            : contact
        )
      );

      if (nextHidden && !showHiddenContacts && activeContact?.trim().toLowerCase() === normalizedAddress) {
        setActiveContact(null);
      }
    } finally {
      setConversationStateSyncPending(normalizedAddress, false);
    }
  };

  return {
    handleAddContact,
    removeContact,
    toggleConversationHiddenForContact
  };
}
