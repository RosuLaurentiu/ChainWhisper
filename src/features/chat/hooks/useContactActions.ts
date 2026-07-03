import type { Dispatch, FormEvent, MutableRefObject, SetStateAction } from 'react';
import {
  Contact,
  ConversationPreferenceState,
  isWalletAddress,
  normalizeContactName
} from '../../../lib/appShared';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type UseContactActionsArgs = {
  activeContact: string | null;
  browserWalletLiteMode: boolean;
  contacts: Contact[];
  editingContactName: string;
  findBurnerWalletDefaultNameForAddress: (address: string) => string | undefined;
  isConversationStateSyncPending: (address?: string | null) => boolean;
  newContact: string;
  newContactName: string;
  pinnedContactStateRef: MutableRefObject<Map<string, ConversationPreferenceState>>;
  setActiveContact: StateSetter<string | null>;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setConversationStateSyncPendingByContact: Dispatch<SetStateAction<Record<string, boolean>>>;
  setEditingContactAddress: StateSetter<string | null>;
  setEditingContactName: StateSetter<string>;
  setError: (next: string) => void;
  setNewContact: StateSetter<string>;
  setNewContactName: StateSetter<string>;
  setShowQuickActionsModal: StateSetter<boolean>;
  showHiddenContacts: boolean;
  syncContactNameAliasFromInput: (contactAddress: string, contactName: string) => Promise<void>;
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
  editingContactName,
  findBurnerWalletDefaultNameForAddress,
  isConversationStateSyncPending,
  newContact,
  newContactName,
  pinnedContactStateRef,
  setActiveContact,
  setContacts,
  setConversationStateSyncPendingByContact,
  setEditingContactAddress,
  setEditingContactName,
  setError,
  setNewContact,
  setNewContactName,
  setShowQuickActionsModal,
  showHiddenContacts,
  syncContactNameAliasFromInput,
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
    const explicitName = normalizeContactName(newContactName);
    const name = explicitName ?? findBurnerWalletDefaultNameForAddress(address);
    if (!isWalletAddress(address)) {
      setError('Enter a valid EVM wallet address.');
      return;
    }

    const existingIndex = contacts.findIndex((contact) => contact.address.toLowerCase() === address.toLowerCase());
    if (existingIndex >= 0) {
      const existingContact = contacts[existingIndex];
      if (!name || existingContact.name === name) {
        setError('This contact already exists.');
        return;
      }

      setContacts((previous) =>
        previous.map((contact, index) => (index === existingIndex ? { ...contact, name } : contact))
      );
      setNewContact('');
      setNewContactName('');
      if (explicitName) {
        syncContactNameAliasFromInput(address, explicitName).catch(() => {});
      }
      setShowQuickActionsModal(false);
      return;
    }

    setContacts((previous) => [...previous, { address, name }]);
    setNewContact('');
    setNewContactName('');
    if (explicitName) {
      syncContactNameAliasFromInput(address, explicitName).catch(() => {});
    }
    if (!activeContact) {
      setActiveContact(address);
    }
    setShowQuickActionsModal(false);
  };

  const startRenameContact = (address: string, currentName?: string) => {
    setEditingContactAddress(address);
    setEditingContactName(currentName ?? '');
    setError('');
  };

  const cancelRenameContact = () => {
    setEditingContactAddress(null);
    setEditingContactName('');
  };

  const saveRenamedContact = (address: string) => {
    const name = normalizeContactName(editingContactName);
    if (!name) {
      setError('Contact name cannot be empty.');
      return;
    }

    setContacts((previous) =>
      previous.map((contact) =>
        contact.address.toLowerCase() === address.toLowerCase() ? { ...contact, name } : contact
      )
    );
    cancelRenameContact();
    syncContactNameAliasFromInput(address, name).catch(() => {});
  };

  const removeContact = (address: string) => {
    toggleConversationHiddenForContact(address).catch(() => {});
  };

  const toggleConversationMuteForContact = async (address: string) => {
    if (browserWalletLiteMode) {
      setError('Use the ChainWhisper account to sync muted or hidden conversations.');
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

    const nextMuted = !targetContact.muted;
    const nextHidden = !!targetContact.hidden;
    setConversationStateSyncPending(normalizedAddress, true);

    const muteNoticeText = nextMuted ? 'Conversation was muted.' : 'Conversation was unmuted.';
    try {
      const synced = await syncConversationStateFromInput(
        address,
        { muted: nextMuted, hidden: nextHidden },
        muteNoticeText
      );
      if (!synced) {
        return;
      }

      pinnedContactStateRef.current.set(normalizedAddress, { muted: nextMuted, hidden: nextHidden });
      setContacts((previous) =>
        previous.map((contact) =>
          contact.address.trim().toLowerCase() === normalizedAddress
            ? { ...contact, muted: nextMuted, hidden: nextHidden }
            : contact
        )
      );
    } finally {
      setConversationStateSyncPending(normalizedAddress, false);
    }
  };

  const toggleConversationHiddenForContact = async (address: string) => {
    if (browserWalletLiteMode) {
      setError('Use the ChainWhisper account to sync muted or hidden conversations.');
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

    const nextMuted = !!targetContact.muted;
    const nextHidden = !targetContact.hidden;
    setConversationStateSyncPending(normalizedAddress, true);
    const hiddenNoticeText = nextHidden ? 'Conversation was muted.' : 'Conversation was unmuted.';

    try {
      const synced = await syncConversationStateFromInput(
        address,
        {
          muted: nextMuted,
          hidden: nextHidden
        },
        hiddenNoticeText
      );
      if (!synced) {
        return;
      }

      pinnedContactStateRef.current.set(normalizedAddress, { muted: nextMuted, hidden: nextHidden });
      setContacts((previous) =>
        previous.map((contact) =>
          contact.address.trim().toLowerCase() === normalizedAddress
            ? { ...contact, muted: nextMuted, hidden: nextHidden }
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
    cancelRenameContact,
    handleAddContact,
    removeContact,
    saveRenamedContact,
    startRenameContact,
    toggleConversationHiddenForContact,
    toggleConversationMuteForContact
  };
}
