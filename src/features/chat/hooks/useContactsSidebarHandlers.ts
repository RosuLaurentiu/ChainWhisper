import { useCallback, useRef } from 'react';
import type { QuickActionTab } from '../chatUiStore';

type StateUpdate<T> = T | ((previous: T) => T);

type UseContactsSidebarHandlersArgs = {
  acceptGroupInvite: (groupId: number) => Promise<unknown>;
  declineGroupInvite: (groupId: number) => Promise<unknown>;
  forceSyncAllData: () => Promise<unknown>;
  saveMyNicknameOnChain: () => Promise<unknown>;
  setQuickActionTab: (next: StateUpdate<QuickActionTab>) => void;
  setShowHiddenContacts: (next: StateUpdate<boolean>) => void;
  setShowQuickActionsModal: (next: StateUpdate<boolean>) => void;
};

export default function useContactsSidebarHandlers({
  acceptGroupInvite,
  declineGroupInvite,
  forceSyncAllData,
  saveMyNicknameOnChain,
  setQuickActionTab,
  setShowHiddenContacts,
  setShowQuickActionsModal
}: UseContactsSidebarHandlersArgs) {
  const saveMyNicknameOnChainRef = useRef(saveMyNicknameOnChain);
  saveMyNicknameOnChainRef.current = saveMyNicknameOnChain;
  const handleSaveNickname = useCallback(() => {
    saveMyNicknameOnChainRef.current().catch(() => {});
  }, []);

  const forceSyncAllDataRef = useRef(forceSyncAllData);
  forceSyncAllDataRef.current = forceSyncAllData;
  const handleForceSync = useCallback(() => {
    forceSyncAllDataRef.current().catch(() => {});
  }, []);

  const handleOpenNewChat = useCallback(() => {
    setQuickActionTab('contact');
    setShowQuickActionsModal(true);
  }, [setQuickActionTab, setShowQuickActionsModal]);

  const handleToggleShowHiddenContacts = useCallback(
    () => setShowHiddenContacts((previous) => !previous),
    [setShowHiddenContacts]
  );

  const acceptGroupInviteRef = useRef(acceptGroupInvite);
  acceptGroupInviteRef.current = acceptGroupInvite;
  const handleAcceptGroupInvite = useCallback((groupId: number) => {
    acceptGroupInviteRef.current(groupId).catch(() => {});
  }, []);

  const declineGroupInviteRef = useRef(declineGroupInvite);
  declineGroupInviteRef.current = declineGroupInvite;
  const handleDeclineGroupInvite = useCallback((groupId: number) => {
    declineGroupInviteRef.current(groupId).catch(() => {});
  }, []);

  return {
    handleAcceptGroupInvite,
    handleDeclineGroupInvite,
    handleForceSync,
    handleOpenNewChat,
    handleSaveNickname,
    handleToggleShowHiddenContacts
  };
}
