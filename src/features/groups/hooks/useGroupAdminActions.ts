import { useCallback, useEffect, type MutableRefObject } from 'react';
import {
  getGroupActionErrorMessage,
  getGroupCreateErrorMessage,
  getGroupJoinErrorMessage,
  getProviderErrorMessage,
  GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS,
  GROUP_PRIVATE_TITLE_LABEL,
  isWalletAddress,
  normalizeContactName,
  parseGroupInviteCode,
  parseGroupJoinCodeFromPayload,
  parseWalletAddressListInput,
  shortenAddress,
  type ActiveGroupJoinCode,
  type GroupSummary,
  type SyncGroupOptions
} from '../../../lib/appShared';
import type { GeneratedGroupJoinCode, GroupJoinCodeMode } from '../groupUiStore';
import type { GroupChatV2SessionController } from '../../../lib/groupChatV2Session';
import {
  createGroupChatV2JoinCodeMaterial,
  encodeGroupChatV2JoinInvite,
  parseGroupChatV2JoinCodeUses,
  readGroupChatV2JoinCodeMaterial,
  signGroupChatV2JoinProof
} from '../../../lib/groupChatV2JoinCode';

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type UseGroupAdminActionsArgs = {
  activeGroupId: number | null;
  activeGroupIdRef: MutableRefObject<number | null>;
  activeGroupMeta: GroupSummary | null;
  activateGroup: (groupId: number) => void;
  currentWalletKeyRef: MutableRefObject<string>;
  generatedGroupInviteCode: string;
  generatedGroupJoinCodeHash: string;
  groupChatV2Session: GroupChatV2SessionController | null;
  isGroupChatV2ScopeCurrent: () => boolean;
  groupInviteMembersInput: string;
  groupInviteTtlInput: string;
  groupJoinCodeInput: string;
  groupJoinCodeMaxUsesInput: string;
  groupJoinCodeMode: GroupJoinCodeMode;
  groupRenameInput: string;
  isActiveGroupAdmin: boolean;
  newGroupIsPrivate: boolean;
  newGroupMembersInput: string;
  newGroupTitle: string;
  processingGroupAction: boolean;
  setActiveGroupId: StateSetter<number | null>;
  setActiveGroupJoinCodes: StateSetter<ActiveGroupJoinCode[]>;
  setError: (message: string) => void;
  setGeneratedGroupJoinCode: StateSetter<GeneratedGroupJoinCode | null>;
  setGroupInviteMembersInput: StateSetter<string>;
  setGroupJoinCodeInput: StateSetter<string>;
  setGroupRenameInput: StateSetter<string>;
  setGroupRenameOpen: StateSetter<boolean>;
  setLoadingActiveGroupJoinCodes: StateSetter<boolean>;
  setNewGroupIsPrivate: StateSetter<boolean>;
  setNewGroupMembersInput: StateSetter<string>;
  setNewGroupTitle: StateSetter<string>;
  setProcessingGroupAction: StateSetter<boolean>;
  setRevokingGroupJoinCodeHash: StateSetter<string>;
  setShowQuickActionsModal: StateSetter<boolean>;
  syncGroupData: (options?: SyncGroupOptions) => Promise<void>;
  walletAddress: string;
};

const GROUP_CHAT_V2_REQUIRED_ERROR =
  'Group Chat V2 is unavailable. No legacy group transaction was sent.';

export const isGroupAdminActionContextCurrent = ({
  activeGroupIdRef,
  currentWalletKeyRef,
  groupId,
  walletKey
}: {
  activeGroupIdRef: MutableRefObject<number | null>;
  currentWalletKeyRef: MutableRefObject<string>;
  groupId: number;
  walletKey: string;
}): boolean =>
  activeGroupIdRef.current === groupId && currentWalletKeyRef.current === walletKey;

export default function useGroupAdminActions({
  activeGroupId,
  activeGroupIdRef,
  activeGroupMeta,
  activateGroup,
  currentWalletKeyRef,
  generatedGroupInviteCode,
  generatedGroupJoinCodeHash,
  groupChatV2Session,
  groupInviteMembersInput,
  groupInviteTtlInput,
  groupJoinCodeInput,
  groupJoinCodeMaxUsesInput,
  groupJoinCodeMode,
  groupRenameInput,
  isActiveGroupAdmin,
  isGroupChatV2ScopeCurrent,
  newGroupIsPrivate,
  newGroupMembersInput,
  newGroupTitle,
  processingGroupAction,
  setActiveGroupId,
  setActiveGroupJoinCodes,
  setError,
  setGeneratedGroupJoinCode,
  setGroupInviteMembersInput,
  setGroupJoinCodeInput,
  setGroupRenameInput,
  setGroupRenameOpen,
  setLoadingActiveGroupJoinCodes,
  setNewGroupIsPrivate,
  setNewGroupMembersInput,
  setNewGroupTitle,
  setProcessingGroupAction,
  setRevokingGroupJoinCodeHash,
  setShowQuickActionsModal,
  syncGroupData,
  walletAddress
}: UseGroupAdminActionsArgs) {
  const loadActiveJoinCodesForGroup = useCallback(
    async (_groupId: number, _options?: { silent?: boolean }) => {
      // Group Chat V2 codes are discovered from events. Only the code generated in
      // this session is retained by the UI; no legacy admin read/write path remains.
      setActiveGroupJoinCodes([]);
      setLoadingActiveGroupJoinCodes(false);
    },
    [setActiveGroupJoinCodes, setLoadingActiveGroupJoinCodes]
  );

  useEffect(() => {
    if (
      activeGroupId === null ||
      !walletAddress ||
      !groupChatV2Session ||
      !isActiveGroupAdmin ||
      !isGroupChatV2ScopeCurrent()
    ) {
      setActiveGroupJoinCodes([]);
      setLoadingActiveGroupJoinCodes(false);
      setRevokingGroupJoinCodeHash('');
      return;
    }

    loadActiveJoinCodesForGroup(activeGroupId, { silent: true }).catch(() => {});
  }, [
    activeGroupId,
    activeGroupMeta?.lastBlock,
    groupChatV2Session,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    loadActiveJoinCodesForGroup,
    setActiveGroupJoinCodes,
    setLoadingActiveGroupJoinCodes,
    setRevokingGroupJoinCodeHash,
    walletAddress
  ]);

  const revokeJoinCodeForActiveGroup = useCallback(
    async (codeHashInput: string, displayCode?: string) => {
      setError('');

      if (!groupChatV2Session) {
        setError(GROUP_CHAT_V2_REQUIRED_ERROR);
        return;
      }

      if (activeGroupId === null) {
        setError('Select a group first.');
        return;
      }
      if (!isActiveGroupAdmin) {
        setError('Only the group admin can revoke join codes.');
        return;
      }

      const normalizedCodeHash = codeHashInput.trim().toLowerCase();
      if (!/^0x[a-f0-9]{64}$/.test(normalizedCodeHash)) {
        setError('Invalid join code hash.');
        return;
      }

      if (processingGroupAction) {
        return;
      }

      const confirmationTarget = displayCode?.trim() ? `code ${displayCode.trim()}` : `hash ${normalizedCodeHash}`;
      const confirmationMessage = `Revoke ${confirmationTarget}? Members will no longer be able to join with it.`;
      if (!window.confirm(confirmationMessage)) {
        return;
      }

      try {
        setProcessingGroupAction(true);
        setRevokingGroupJoinCodeHash(normalizedCodeHash);
        if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
        await groupChatV2Session.revokeJoinCode(BigInt(activeGroupId), normalizedCodeHash);

        if (generatedGroupJoinCodeHash.trim().toLowerCase() === normalizedCodeHash) {
          setGeneratedGroupJoinCode(null);
        }

        await loadActiveJoinCodesForGroup(activeGroupId, { silent: true });
        await syncGroupData({ background: true, overviewOnly: true });
      } catch (revokeError) {
        const message = getGroupActionErrorMessage(revokeError, 'Failed to revoke join code.');
        setError(message);
      } finally {
        setRevokingGroupJoinCodeHash('');
        setProcessingGroupAction(false);
      }
    },
    [
      activeGroupId,
      generatedGroupJoinCodeHash,
      groupChatV2Session,
      isActiveGroupAdmin,
      isGroupChatV2ScopeCurrent,
      loadActiveJoinCodesForGroup,
      processingGroupAction,
      setError,
      setGeneratedGroupJoinCode,
      setProcessingGroupAction,
      setRevokingGroupJoinCodeHash,
      syncGroupData
    ]
  );

  const createGroup = useCallback(async () => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    const title = newGroupIsPrivate
      ? GROUP_PRIVATE_TITLE_LABEL
      : normalizeContactName(newGroupTitle ?? '');
    if (!title) {
      setError('Enter a group title.');
      return;
    }

    const myAddress = walletAddress.trim().toLowerCase();
    const initialMembers = parseWalletAddressListInput(newGroupMembersInput).filter(
      (address) => address.toLowerCase() !== myAddress
    );
    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      const created = await groupChatV2Session.create(initialMembers);
      const createdGroupId = Number(created.group.groupId);
      if (!Number.isSafeInteger(createdGroupId) || createdGroupId <= 0) {
        throw new Error('Created Group Chat V2 ID is outside the UI range.');
      }

      setNewGroupTitle('');
      setNewGroupIsPrivate(false);
      setNewGroupMembersInput('');
      await syncGroupData({ deep: true });
      setShowQuickActionsModal(false);
      if (isGroupChatV2ScopeCurrent()) activateGroup(createdGroupId);
    } catch (createGroupError) {
      const message = getGroupCreateErrorMessage(createGroupError, 'Failed to create group.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activateGroup,
    groupChatV2Session,
    isGroupChatV2ScopeCurrent,
    newGroupIsPrivate,
    newGroupMembersInput,
    newGroupTitle,
    setError,
    setNewGroupIsPrivate,
    setNewGroupMembersInput,
    setNewGroupTitle,
    setProcessingGroupAction,
    setShowQuickActionsModal,
    syncGroupData,
    walletAddress
  ]);

  const inviteMembersToActiveGroup = useCallback(async () => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (activeGroupMeta?.isPrivate && !isActiveGroupAdmin) {
      setError('Private group: only the admin can invite new members.');
      return;
    }

    const myAddress = walletAddress.trim().toLowerCase();
    const existingMembers = new Set((activeGroupMeta?.members ?? []).map((member) => member.toLowerCase()));
    const accounts = parseWalletAddressListInput(groupInviteMembersInput).filter((address) => {
      const key = address.toLowerCase();
      if (key === myAddress) {
        return false;
      }
      return !existingMembers.has(key);
    });
    if (accounts.length === 0) {
      setError('Enter at least one valid wallet address to invite.');
      return;
    }

    const ttlHours = Math.max(0, Math.floor(Number(groupInviteTtlInput)));
    if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
      setError('Invite TTL must be a positive number of hours.');
      return;
    }
    const ttlParsed = ttlHours * 60 * 60;

    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.inviteMembers(BigInt(activeGroupId), accounts, BigInt(ttlParsed));

      setGroupInviteMembersInput('');
      await syncGroupData({ deep: true });
    } catch (inviteError) {
      const message = getGroupActionErrorMessage(inviteError, 'Failed to send invites.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    activeGroupMeta,
    groupChatV2Session,
    groupInviteMembersInput,
    groupInviteTtlInput,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    setError,
    setGroupInviteMembersInput,
    setProcessingGroupAction,
    syncGroupData,
    walletAddress
  ]);

  const generateJoinCodeForActiveGroup = useCallback(async () => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!isActiveGroupAdmin) {
      setError('Only the group admin can create join codes.');
      return;
    }

    const ttlHours = Math.max(0, Math.floor(Number(groupInviteTtlInput)));
    if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
      setError('Join code TTL must be a positive number of hours.');
      return;
    }
    const ttlSeconds = ttlHours * 60 * 60;
    const groupId = activeGroupId;
    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();

    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      const material = createGroupChatV2JoinCodeMaterial();
      const uses = parseGroupChatV2JoinCodeUses(groupJoinCodeMode, groupJoinCodeMaxUsesInput);
      await groupChatV2Session.createJoinCode({
        groupId: BigInt(groupId),
        codeHash: material.codeHash,
        proofSigner: material.proofSigner,
        ttl: BigInt(ttlSeconds),
        uses
      });
      const stored = await groupChatV2Session.inspectJoinCode(BigInt(groupId), material.codeHash);
      if (
        !stored.active ||
        !stored.effective ||
        stored.proofSigner.toLowerCase() !== material.proofSigner.toLowerCase()
      ) {
        throw new Error('Created Group Chat V2 join code failed canonical verification.');
      }
      const expiresAt = Number(stored.expiresAt);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error('Created Group Chat V2 join code has an invalid expiration.');
      }
      const nextJoinCode = {
        generatedGroupInviteCode: encodeGroupChatV2JoinInvite({
          groupId,
          code: material.code,
          expiresAt,
          inviter: requestedWalletAddress
        }),
        codeHash: material.codeHash
      };

      if (
        !isGroupAdminActionContextCurrent({
          activeGroupIdRef,
          currentWalletKeyRef,
          groupId,
          walletKey: requestedWalletKey
        })
      ) {
        return;
      }

      setGeneratedGroupJoinCode({
        groupId,
        walletKey: requestedWalletKey,
        inviteCode: nextJoinCode.generatedGroupInviteCode,
        codeHash: nextJoinCode.codeHash
      });

      loadActiveJoinCodesForGroup(groupId, { silent: true }).catch(() => {});
      await syncGroupData({ background: true, overviewOnly: true });
    } catch (joinCodeError) {
      const message = getGroupActionErrorMessage(joinCodeError, 'Failed to create join code.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    activeGroupIdRef,
    currentWalletKeyRef,
    groupChatV2Session,
    groupInviteTtlInput,
    groupJoinCodeMaxUsesInput,
    groupJoinCodeMode,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    loadActiveJoinCodesForGroup,
    setError,
    setGeneratedGroupJoinCode,
    setProcessingGroupAction,
    syncGroupData,
    walletAddress
  ]);

  const revokeGeneratedJoinCodeForActiveGroup = useCallback(async () => {
    setError('');

    if (!/^0x[a-fA-F0-9]{64}$/.test(generatedGroupJoinCodeHash)) {
      setError('No generated join code is available to revoke in this session.');
      return;
    }

    const generatedJoinCode = parseGroupInviteCode(generatedGroupInviteCode);
    const displayCode = generatedJoinCode && generatedJoinCode.version === 2 ? generatedJoinCode.code : undefined;
    await revokeJoinCodeForActiveGroup(generatedGroupJoinCodeHash, displayCode);
  }, [
    generatedGroupInviteCode,
    generatedGroupJoinCodeHash,
    revokeJoinCodeForActiveGroup,
    setError
  ]);

  const acceptGroupInvite = useCallback(async (groupId: number) => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }
    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.acceptInvite(BigInt(groupId));

      await syncGroupData({ deep: true });
      activateGroup(groupId);
    } catch (acceptError) {
      const message = getProviderErrorMessage(acceptError, 'Failed to accept invite.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activateGroup,
    groupChatV2Session,
    isGroupChatV2ScopeCurrent,
    setError,
    setProcessingGroupAction,
    syncGroupData
  ]);

  const joinGroupWithCode = useCallback(async () => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    if (processingGroupAction) {
      return;
    }

    const parsedCode = parseGroupInviteCode(groupJoinCodeInput);
    if (!parsedCode) {
      setError('Invalid group code.');
      return;
    }

    const nowTs = Math.floor(Date.now() / 1000);
    if (parsedCode.expiresAt > 0 && parsedCode.expiresAt <= nowTs) {
      setError('This group code has expired.');
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    const parsedJoinCode = parseGroupJoinCodeFromPayload(parsedCode);
    if (!parsedJoinCode) {
      setError('Legacy group codes are read-only after Group Chat V2 activation. Ask for a new code.');
      return;
    }

    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      const material = readGroupChatV2JoinCodeMaterial(parsedJoinCode.code);
      const [group, stored] = await Promise.all([
        groupChatV2Session.inspect(BigInt(parsedJoinCode.groupId)),
        groupChatV2Session.inspectJoinCode(BigInt(parsedJoinCode.groupId), material.codeHash)
      ]);
      if (
        !stored.active ||
        !stored.effective ||
        stored.proofSigner.toLowerCase() !== material.proofSigner.toLowerCase()
      ) {
        throw new Error('This Group Chat V2 code is inactive or has the wrong proof signer.');
      }
      const signatureDeadline = BigInt(nowTs + GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS);
      const digest = await groupChatV2Session.readJoinProofDigest({
        groupId: BigInt(parsedJoinCode.groupId),
        codeHash: material.codeHash,
        generation: stored.generation,
        expectedAdminRevision: group.adminRevision,
        signatureDeadline
      });
      await groupChatV2Session.joinWithCode({
        groupId: BigInt(parsedJoinCode.groupId),
        codeHash: material.codeHash,
        generation: stored.generation,
        expectedAdminRevision: group.adminRevision,
        signatureDeadline,
        signature: await signGroupChatV2JoinProof(material.code, digest)
      });

      setGroupJoinCodeInput('');
      await syncGroupData({ deep: true });
      activateGroup(parsedJoinCode.groupId);
      setShowQuickActionsModal(false);
    } catch (joinError) {
      const message = getGroupJoinErrorMessage(joinError, 'Failed to join group with code.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activateGroup,
    groupChatV2Session,
    groupJoinCodeInput,
    processingGroupAction,
    isGroupChatV2ScopeCurrent,
    setError,
    setGroupJoinCodeInput,
    setProcessingGroupAction,
    setShowQuickActionsModal,
    syncGroupData,
    walletAddress
  ]);

  const removeMemberFromActiveGroup = useCallback(async (account: string) => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!isActiveGroupAdmin) {
      setError('Only the group admin can remove members.');
      return;
    }
    if (!isWalletAddress(account)) {
      setError('Invalid member wallet address.');
      return;
    }

    const normalizedTarget = account.trim().toLowerCase();
    const normalizedSelf = walletAddress.trim().toLowerCase();
    if (normalizedTarget === normalizedSelf) {
      setError('Use leave group for yourself. Removing your own admin account is disabled here.');
      return;
    }

    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.removeMembers(BigInt(activeGroupId), [account]);

      await syncGroupData({ deep: true });
    } catch (removeError) {
      const message = getProviderErrorMessage(removeError, 'Failed to remove member.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    groupChatV2Session,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    setError,
    setProcessingGroupAction,
    syncGroupData,
    walletAddress
  ]);

  const transferAdminToMember = useCallback(async (account: string) => {
    setError('');
    if (!groupChatV2Session) {
      setError('Direct member administration transfer is available with Group Chat V2.');
      return;
    }
    if (activeGroupId === null || !isActiveGroupAdmin || !isWalletAddress(account)) {
      setError('Select a valid group member while connected as the group admin.');
      return;
    }
    const memberKey = account.trim().toLowerCase();
    if (!(activeGroupMeta?.members ?? []).some((member) => member.toLowerCase() === memberKey)) {
      setError('The new Group Chat V2 admin must already be an active member.');
      return;
    }
    if (!window.confirm(`Transfer group administration to ${shortenAddress(account)}?`)) return;
    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.transferAdmin(BigInt(activeGroupId), account);
      await syncGroupData({ deep: true });
    } catch (transferError) {
      setError(getGroupActionErrorMessage(transferError, 'Failed to transfer group administration.'));
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    activeGroupMeta?.members,
    groupChatV2Session,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    setError,
    setProcessingGroupAction,
    syncGroupData
  ]);

  const beginRenameActiveGroup = useCallback(() => {
    setError('');

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!isActiveGroupAdmin) {
      setError('Only the group admin can rename the group.');
      return;
    }

    const groupId = activeGroupId;
    const currentTitle = normalizeContactName(activeGroupMeta?.title ?? '') ?? `Group ${groupId}`;
    setGroupRenameInput(currentTitle);
    setGroupRenameOpen(true);
  }, [
    activeGroupId,
    activeGroupMeta,
    isActiveGroupAdmin,
    setError,
    setGroupRenameInput,
    setGroupRenameOpen
  ]);

  const cancelRenameActiveGroup = useCallback(() => {
    setGroupRenameOpen(false);
    setGroupRenameInput('');
  }, [setGroupRenameInput, setGroupRenameOpen]);

  const renameActiveGroup = useCallback(async () => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!isActiveGroupAdmin) {
      setError('Only the group admin can rename the group.');
      return;
    }

    const groupId = activeGroupId;
    const currentTitle = normalizeContactName(activeGroupMeta?.title ?? '') ?? `Group ${groupId}`;
    const nextTitle = normalizeContactName(groupRenameInput);
    if (!nextTitle) {
      setError('Enter a group title.');
      return;
    }
    if (nextTitle === currentTitle) {
      cancelRenameActiveGroup();
      return;
    }

    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.setMetadata(BigInt(groupId), nextTitle);

      cancelRenameActiveGroup();
      await syncGroupData({ deep: true });
    } catch (renameError) {
      const message = getGroupActionErrorMessage(renameError, 'Failed to rename group.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    activeGroupMeta,
    cancelRenameActiveGroup,
    groupChatV2Session,
    groupRenameInput,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    setError,
    setProcessingGroupAction,
    syncGroupData
  ]);

  const leaveActiveGroup = useCallback(async () => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }

    const groupId = activeGroupId;
    const groupLabel = `${activeGroupMeta?.title ?? 'Group'} (#${groupId})`;
    if (isActiveGroupAdmin && (activeGroupMeta?.memberCount ?? 0) > 1) {
      setError('Transfer Group Chat V2 administration to another member before leaving.');
      return;
    }
    const leaveMessage = `Leave ${groupLabel}?`;
    if (!window.confirm(leaveMessage)) {
      return;
    }

    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.leave(BigInt(groupId));

      if (activeGroupIdRef.current === groupId) {
        setActiveGroupId(null);
      }
      await syncGroupData({ deep: true });
    } catch (leaveError) {
      const message = getGroupActionErrorMessage(leaveError, 'Failed to leave group.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    activeGroupIdRef,
    activeGroupMeta,
    groupChatV2Session,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    setActiveGroupId,
    setError,
    setProcessingGroupAction,
    syncGroupData
  ]);

  const handoffAdminAndLeaveActiveGroup = useCallback(async () => {
    setError('');
    setError('Group Chat V2 requires transferring administration to an existing consenting member before leaving.');
  }, [setError]);

  const disbandActiveGroup = useCallback(async () => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!isActiveGroupAdmin) {
      setError('Only the group admin can disband the group.');
      return;
    }

    const groupId = activeGroupId;
    const confirmationMessage = 'Archive this group? New messages will stop. Existing messages and authorized history remain available.';
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.disband(BigInt(groupId));

      setGeneratedGroupJoinCode(null);
      if (activeGroupIdRef.current === groupId) {
        setActiveGroupId(null);
      }
      await syncGroupData({ deep: true });
    } catch (disbandError) {
      const message = getGroupActionErrorMessage(disbandError, 'Failed to disband group.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    activeGroupIdRef,
    groupChatV2Session,
    isActiveGroupAdmin,
    isGroupChatV2ScopeCurrent,
    setActiveGroupId,
    setError,
    setGeneratedGroupJoinCode,
    setProcessingGroupAction,
    syncGroupData
  ]);

  const declineGroupInvite = useCallback(async (groupId: number) => {
    setError('');

    if (!groupChatV2Session) {
      setError(GROUP_CHAT_V2_REQUIRED_ERROR);
      return;
    }
    try {
      setProcessingGroupAction(true);
      if (!isGroupChatV2ScopeCurrent()) throw new Error('Group Chat V2 wallet scope changed.');
      await groupChatV2Session.declineInvite(BigInt(groupId));

      await syncGroupData({ deep: true });
    } catch (declineError) {
      const message = getProviderErrorMessage(declineError, 'Failed to decline invite.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    groupChatV2Session,
    isGroupChatV2ScopeCurrent,
    setError,
    setProcessingGroupAction,
    syncGroupData
  ]);

  return {
    acceptGroupInvite,
    beginRenameActiveGroup,
    cancelRenameActiveGroup,
    createGroup,
    declineGroupInvite,
    disbandActiveGroup,
    generateJoinCodeForActiveGroup,
    handoffAdminAndLeaveActiveGroup,
    inviteMembersToActiveGroup,
    joinGroupWithCode,
    leaveActiveGroup,
    removeMemberFromActiveGroup,
    renameActiveGroup,
    revokeGeneratedJoinCodeForActiveGroup,
    revokeJoinCodeForActiveGroup,
    transferAdminToMember
  };
}
