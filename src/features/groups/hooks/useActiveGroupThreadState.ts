import { useEffect, useMemo, type MutableRefObject } from 'react';
import {
  isWalletAddress,
  normalizeContactName,
  shortenAddress,
  type Contact,
  type GroupSummary
} from '../../../lib/appShared';

type StateUpdate<T> = T | ((previous: T) => T);

export type GroupParticipantSummary = {
  key: string;
  address: string;
  name?: string;
  shortAddress: string;
  isSelf: boolean;
  isAdmin: boolean;
};

type UseActiveGroupThreadStateArgs = {
  activeGroupId: number | null;
  contacts: Contact[];
  groups: GroupSummary[];
  groupRenameInput: string;
  groupRenameOpen: boolean;
  groupTipRecipientAddress: string;
  myNickname: string;
  onChainNicknameCacheRef: MutableRefObject<Record<string, string | null>>;
  setGroupRenameInput: (next: StateUpdate<string>) => void;
  setGroupRenameOpen: (next: StateUpdate<boolean>) => void;
  setGroupTipRecipientAddress: (next: StateUpdate<string>) => void;
  walletAddress: string;
};

export default function useActiveGroupThreadState({
  activeGroupId,
  contacts,
  groups,
  groupRenameInput,
  groupRenameOpen,
  groupTipRecipientAddress,
  myNickname,
  onChainNicknameCacheRef,
  setGroupRenameInput,
  setGroupRenameOpen,
  setGroupTipRecipientAddress,
  walletAddress
}: UseActiveGroupThreadStateArgs) {
  const activeGroupMeta = useMemo(
    () => (activeGroupId !== null ? groups.find((group) => group.id === activeGroupId) ?? null : null),
    [activeGroupId, groups]
  );

  const activeGroupParticipants = useMemo((): GroupParticipantSummary[] => {
    if (!activeGroupMeta) {
      return [];
    }

    const currentWalletKey = walletAddress.trim().toLowerCase();
    const adminKey = activeGroupMeta.admin.trim().toLowerCase();
    const ownNickname = normalizeContactName(myNickname);
    const seenMembers = new Set<string>();
    const orderedMembers = [activeGroupMeta.admin, ...activeGroupMeta.members]
      .map((address) => String(address ?? '').trim())
      .filter((address) => isWalletAddress(address))
      .filter((address) => {
        const key = address.toLowerCase();
        if (seenMembers.has(key)) {
          return false;
        }
        seenMembers.add(key);
        return true;
      });

    return orderedMembers.map((address) => {
      const key = address.toLowerCase();
      const isSelf = currentWalletKey.length > 0 && key === currentWalletKey;
      const isAdmin = adminKey.length > 0 && key === adminKey;
      const contactName = contacts.find((contact) => contact.address.toLowerCase() === key)?.name;
      const onChainNickname = onChainNicknameCacheRef.current[key] ?? undefined;
      const name = isSelf ? ownNickname ?? contactName ?? onChainNickname : contactName ?? onChainNickname;

      return {
        key,
        address,
        name,
        shortAddress: shortenAddress(address),
        isSelf,
        isAdmin
      };
    });
  }, [activeGroupMeta, contacts, myNickname, onChainNicknameCacheRef, walletAddress]);

  const activeGroupMemberCount =
    activeGroupParticipants.length > 0 ? activeGroupParticipants.length : activeGroupMeta?.memberCount ?? 0;

  const activeGroupTipRecipients = useMemo(
    () =>
      activeGroupParticipants.filter(
        (participant) => !participant.isSelf && isWalletAddress(participant.address)
      ),
    [activeGroupParticipants]
  );

  useEffect(() => {
    if (activeGroupId === null) {
      setGroupTipRecipientAddress('');
      return;
    }

    setGroupTipRecipientAddress((previous) => {
      const normalizedPrevious = previous.trim().toLowerCase();
      const existingRecipient = activeGroupTipRecipients.find(
        (participant) => participant.address.toLowerCase() === normalizedPrevious
      );
      if (existingRecipient) {
        return existingRecipient.address;
      }
      return activeGroupTipRecipients[0]?.address ?? '';
    });
  }, [activeGroupId, activeGroupTipRecipients, setGroupTipRecipientAddress]);

  const selectedGroupTipRecipient = useMemo(
    () =>
      activeGroupTipRecipients.find(
        (participant) =>
          participant.address.toLowerCase() === groupTipRecipientAddress.trim().toLowerCase()
      ) ?? null,
    [activeGroupTipRecipients, groupTipRecipientAddress]
  );

  const isActiveGroupAdmin = useMemo(() => {
    if (!activeGroupMeta || !walletAddress) {
      return false;
    }

    return activeGroupMeta.admin.trim().toLowerCase() === walletAddress.trim().toLowerCase();
  }, [activeGroupMeta, walletAddress]);

  useEffect(() => {
    if (!isActiveGroupAdmin && groupRenameOpen) {
      setGroupRenameOpen(false);
      setGroupRenameInput('');
    }
  }, [groupRenameOpen, isActiveGroupAdmin, setGroupRenameInput, setGroupRenameOpen]);

  const canInviteToActiveGroup = useMemo(() => {
    if (!activeGroupMeta) {
      return false;
    }
    if (!activeGroupMeta.isPrivate) {
      return true;
    }
    return isActiveGroupAdmin;
  }, [activeGroupMeta, isActiveGroupAdmin]);

  const canSubmitGroupRename = useMemo(() => {
    if (!isActiveGroupAdmin || activeGroupId === null) {
      return false;
    }

    const nextTitle = normalizeContactName(groupRenameInput ?? '');
    const currentTitle = normalizeContactName(activeGroupMeta?.title ?? '') ?? `Group ${activeGroupId}`;
    return Boolean(nextTitle && nextTitle !== currentTitle);
  }, [activeGroupId, activeGroupMeta, groupRenameInput, isActiveGroupAdmin]);

  return {
    activeGroupMemberCount,
    activeGroupMeta,
    activeGroupParticipants,
    activeGroupTipRecipients,
    canInviteToActiveGroup,
    canSubmitGroupRename,
    isActiveGroupAdmin,
    selectedGroupTipRecipient
  };
}
