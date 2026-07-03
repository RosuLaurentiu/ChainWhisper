import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  acceptGroupInviteOnChain,
  createGroupOnChain,
  declineGroupInviteOnChain,
  disbandGroupOnChain,
  handoffAdminAndLeaveGroupOnChain,
  inviteMembersToGroupOnChain,
  leaveGroupOnChain,
  removeMemberFromGroupOnChain,
  renameGroupOnChain
} from '../../../lib/groupActions';
import {
  createGroupJoinCode,
  fetchActiveJoinCodesForAdmin,
  hasActiveLegacyGroupInvite,
  joinWithGroupCode,
  revokeGroupJoinCode
} from '../../../lib/groupJoinCodes';
import {
  COTI_NETWORK,
  getGroupActionErrorMessage,
  getGroupCreateErrorMessage,
  getGroupJoinErrorMessage,
  GROUP_ADMIN_BURN_ADDRESS,
  isWalletAddress,
  mergeOnboardInfo,
  normalizeContactName,
  parseGroupInviteCode,
  parseGroupJoinCodeFromPayload,
  parseWalletAddressListInput,
  shortenAddress,
  type ActiveGroupJoinCode,
  type GroupSummary,
  type SyncGroupOptions
} from '../../../lib/appShared';
import type { GroupJoinCodeMode } from '../groupUiStore';

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type StateSetter<T> = (next: T | ((previous: T) => T)) => void;

type UseGroupAdminActionsArgs = {
  activeGroupId: number | null;
  activeGroupIdRef: MutableRefObject<number | null>;
  activeGroupMeta: GroupSummary | null;
  activateGroup: (groupId: number) => void;
  chainId: number | null;
  currentWalletKeyRef: MutableRefObject<string>;
  generatedGroupInviteCode: string;
  generatedGroupJoinCodeHash: string;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  groupInviteMembersInput: string;
  groupInviteTtlInput: string;
  groupJoinCodeInput: string;
  groupJoinCodeMaxUsesInput: string;
  groupJoinCodeMode: GroupJoinCodeMode;
  groupRenameInput: string;
  hasAesReady: boolean;
  isActiveGroupAdmin: boolean;
  newGroupIsPrivate: boolean;
  newGroupMembersInput: string;
  newGroupTitle: string;
  processingGroupAction: boolean;
  setActiveGroupId: StateSetter<number | null>;
  setActiveGroupJoinCodes: StateSetter<ActiveGroupJoinCode[]>;
  setError: (message: string) => void;
  setGeneratedGroupInviteCode: StateSetter<string>;
  setGeneratedGroupJoinCodeHash: StateSetter<string>;
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
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setShowQuickActionsModal: StateSetter<boolean>;
  setStatus: (message: string) => void;
  runWalletTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  syncGroupData: (options?: SyncGroupOptions) => Promise<void>;
  walletAddress: string;
};

const updateOnboardInfo = (
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>,
  cacheKey: string,
  onboardInfo: OnboardInfo | undefined
) => {
  setSessionOnboardInfo((previous) => ({
    ...previous,
    [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
  }));
};

export default function useGroupAdminActions({
  activeGroupId,
  activeGroupIdRef,
  activeGroupMeta,
  activateGroup,
  chainId,
  currentWalletKeyRef,
  generatedGroupInviteCode,
  generatedGroupJoinCodeHash,
  getMemoSigner,
  groupInviteMembersInput,
  groupInviteTtlInput,
  groupJoinCodeInput,
  groupJoinCodeMaxUsesInput,
  groupJoinCodeMode,
  groupRenameInput,
  hasAesReady,
  isActiveGroupAdmin,
  newGroupIsPrivate,
  newGroupMembersInput,
  newGroupTitle,
  processingGroupAction,
  setActiveGroupId,
  setActiveGroupJoinCodes,
  setError,
  setGeneratedGroupInviteCode,
  setGeneratedGroupJoinCodeHash,
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
  setSessionOnboardInfo,
  setShowQuickActionsModal,
  setStatus,
  runWalletTransactionFlow,
  syncGroupData,
  walletAddress
}: UseGroupAdminActionsArgs) {
  const getMemoSignerRef = useRef(getMemoSigner);
  getMemoSignerRef.current = getMemoSigner;

  const loadActiveJoinCodesForGroup = useCallback(
    async (groupId: number, options?: { silent?: boolean }) => {
      const requestedWalletAddress = walletAddress.trim();
      const requestedWalletKey = requestedWalletAddress.toLowerCase();
      if (
        !Number.isFinite(groupId) ||
        groupId <= 0 ||
        !requestedWalletAddress ||
        !isWalletAddress(requestedWalletAddress) ||
        !hasAesReady ||
        !isActiveGroupAdmin ||
        chainId !== COTI_NETWORK.chainIdDecimal
      ) {
        setActiveGroupJoinCodes([]);
        setLoadingActiveGroupJoinCodes(false);
        return;
      }

      try {
        setLoadingActiveGroupJoinCodes(true);
        const { signer, cacheKey } = await getMemoSignerRef.current();
        const nextActiveCodes = await fetchActiveJoinCodesForAdmin({
          groupId,
          signer,
          requestedWalletAddress
        });
        if (
          currentWalletKeyRef.current !== requestedWalletKey ||
          activeGroupIdRef.current !== groupId
        ) {
          return;
        }
        setActiveGroupJoinCodes(nextActiveCodes);
        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      } catch (loadError) {
        setActiveGroupJoinCodes([]);
        if (!options?.silent) {
          const message = loadError instanceof Error ? loadError.message : 'Failed to load active join codes.';
          setError(message);
        }
      } finally {
        if (
          currentWalletKeyRef.current === requestedWalletKey &&
          activeGroupIdRef.current === groupId
        ) {
          setLoadingActiveGroupJoinCodes(false);
        }
      }
    },
    [
      activeGroupIdRef,
      chainId,
      currentWalletKeyRef,
      hasAesReady,
      isActiveGroupAdmin,
      setActiveGroupJoinCodes,
      setError,
      setLoadingActiveGroupJoinCodes,
      setSessionOnboardInfo,
      walletAddress
    ]
  );

  useEffect(() => {
    if (
      activeGroupId === null ||
      !walletAddress ||
      !hasAesReady ||
      !isActiveGroupAdmin ||
      chainId !== COTI_NETWORK.chainIdDecimal
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
    chainId,
    hasAesReady,
    isActiveGroupAdmin,
    loadActiveJoinCodesForGroup,
    setActiveGroupJoinCodes,
    setLoadingActiveGroupJoinCodes,
    setRevokingGroupJoinCodeHash,
    walletAddress
  ]);

  const revokeJoinCodeForActiveGroup = useCallback(
    async (codeHashInput: string, displayCode?: string) => {
      setError('');

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
        await runWalletTransactionFlow(async () => {
          const { signer, cacheKey } = await getMemoSigner();
          await revokeGroupJoinCode({
            signer,
            groupId: activeGroupId,
            codeHash: normalizedCodeHash
          });

          updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
        });

        if (generatedGroupJoinCodeHash.trim().toLowerCase() === normalizedCodeHash) {
          setGeneratedGroupInviteCode('');
          setGeneratedGroupJoinCodeHash('');
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
      getMemoSigner,
      isActiveGroupAdmin,
      loadActiveJoinCodesForGroup,
      processingGroupAction,
      runWalletTransactionFlow,
      setError,
      setGeneratedGroupInviteCode,
      setGeneratedGroupJoinCodeHash,
      setProcessingGroupAction,
      setRevokingGroupJoinCodeHash,
      setSessionOnboardInfo,
      syncGroupData
    ]
  );

  const createGroup = useCallback(async () => {
    setError('');

    const title = normalizeContactName(newGroupTitle ?? '');
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
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await createGroupOnChain({
          signer,
          title,
          isPrivate: newGroupIsPrivate,
          initialMembers
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

      setNewGroupTitle('');
      setNewGroupIsPrivate(false);
      setNewGroupMembersInput('');
      await syncGroupData({ deep: true });
      setShowQuickActionsModal(false);
    } catch (createGroupError) {
      const message = getGroupCreateErrorMessage(createGroupError, 'Failed to create group.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    getMemoSigner,
    newGroupIsPrivate,
    newGroupMembersInput,
    newGroupTitle,
    runWalletTransactionFlow,
    setError,
    setNewGroupIsPrivate,
    setNewGroupMembersInput,
    setNewGroupTitle,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    setShowQuickActionsModal,
    syncGroupData,
    walletAddress
  ]);

  const inviteMembersToActiveGroup = useCallback(async () => {
    setError('');

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
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await inviteMembersToGroupOnChain({
          signer,
          groupId: activeGroupId,
          accounts,
          ttlSeconds: ttlParsed
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

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
    getMemoSigner,
    groupInviteMembersInput,
    groupInviteTtlInput,
    isActiveGroupAdmin,
    runWalletTransactionFlow,
    setError,
    setGroupInviteMembersInput,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    syncGroupData,
    walletAddress
  ]);

  const generateJoinCodeForActiveGroup = useCallback(async () => {
    setError('');

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
    const requestedWalletAddress = walletAddress.trim();

    try {
      setProcessingGroupAction(true);
      const nextJoinCode = await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        const generatedJoinCode = await createGroupJoinCode({
          groupId: activeGroupId,
          signer,
          requestedWalletAddress,
          ttlSeconds,
          groupJoinCodeMode,
          groupJoinCodeMaxUsesInput
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
        return generatedJoinCode;
      });
      setGeneratedGroupInviteCode(nextJoinCode.generatedGroupInviteCode);
      setGeneratedGroupJoinCodeHash(nextJoinCode.codeHash);

      loadActiveJoinCodesForGroup(activeGroupId, { silent: true }).catch(() => {});
      await syncGroupData({ background: true, overviewOnly: true });
    } catch (joinCodeError) {
      const message = getGroupActionErrorMessage(joinCodeError, 'Failed to create join code.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    getMemoSigner,
    groupInviteTtlInput,
    groupJoinCodeMaxUsesInput,
    groupJoinCodeMode,
    isActiveGroupAdmin,
    loadActiveJoinCodesForGroup,
    runWalletTransactionFlow,
    setError,
    setGeneratedGroupInviteCode,
    setGeneratedGroupJoinCodeHash,
    setProcessingGroupAction,
    setSessionOnboardInfo,
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
    try {
      setProcessingGroupAction(true);
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await acceptGroupInviteOnChain({
          signer,
          groupId
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

      await syncGroupData({ deep: true });
      activateGroup(groupId);
    } catch (acceptError) {
      const message = acceptError instanceof Error ? acceptError.message : 'Failed to accept invite.';
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activateGroup,
    getMemoSigner,
    runWalletTransactionFlow,
    setError,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    syncGroupData
  ]);

  const joinGroupWithCode = useCallback(async () => {
    setError('');

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
      try {
        const hasLegacyInvite = await hasActiveLegacyGroupInvite({
          groupId: parsedCode.groupId,
          walletAddress: requestedWalletAddress,
          nowTs
        });

        if (!hasLegacyInvite) {
          setError('Legacy group code detected, but no active on-chain invite exists for this wallet.');
          return;
        }

        setGroupJoinCodeInput('');
        await acceptGroupInvite(parsedCode.groupId);
        setShowQuickActionsModal(false);
      } catch (legacyJoinError) {
        const message = legacyJoinError instanceof Error ? legacyJoinError.message : 'Failed to join group with legacy code.';
        setError(message);
      }
      return;
    }

    try {
      setProcessingGroupAction(true);
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await joinWithGroupCode({
          signer,
          parsedJoinCode,
          chainId,
          nowTs
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
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
    acceptGroupInvite,
    activateGroup,
    chainId,
    getMemoSigner,
    groupJoinCodeInput,
    processingGroupAction,
    runWalletTransactionFlow,
    setError,
    setGroupJoinCodeInput,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    setShowQuickActionsModal,
    syncGroupData,
    walletAddress
  ]);

  const removeMemberFromActiveGroup = useCallback(async (account: string) => {
    setError('');

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
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await removeMemberFromGroupOnChain({
          signer,
          groupId: activeGroupId,
          account
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

      await syncGroupData({ deep: true });
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : 'Failed to remove member.';
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    getMemoSigner,
    isActiveGroupAdmin,
    runWalletTransactionFlow,
    setError,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    syncGroupData,
    walletAddress
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
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await renameGroupOnChain({
          signer,
          groupId,
          title: nextTitle,
          isPrivate: Boolean(activeGroupMeta?.isPrivate)
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

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
    getMemoSigner,
    groupRenameInput,
    isActiveGroupAdmin,
    runWalletTransactionFlow,
    setError,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    syncGroupData
  ]);

  const leaveActiveGroup = useCallback(async () => {
    setError('');

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }

    const groupId = activeGroupId;
    const groupLabel = `${activeGroupMeta?.title ?? 'Group'} (#${groupId})`;
    const leaveMessage = isActiveGroupAdmin
      ? `Leave ${groupLabel} as admin?\n\nIf you are the only member, the group will be disbanded. Otherwise admin rights transfer to another member automatically.`
      : `Leave ${groupLabel}?`;
    if (!window.confirm(leaveMessage)) {
      return;
    }

    try {
      setProcessingGroupAction(true);
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await leaveGroupOnChain({
          signer,
          groupId
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

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
    getMemoSigner,
    isActiveGroupAdmin,
    runWalletTransactionFlow,
    setActiveGroupId,
    setError,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    syncGroupData
  ]);

  const handoffAdminAndLeaveActiveGroup = useCallback(async () => {
    setError('');

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!isActiveGroupAdmin) {
      setError('Only the group admin can use burn and leave.');
      return;
    }

    const groupId = activeGroupId;
    const groupLabel = `${activeGroupMeta?.title ?? 'Group'} (#${groupId})`;
    const burnAddress = GROUP_ADMIN_BURN_ADDRESS;
    const confirmationMessage = `Leave ${groupLabel} as admin?\n\nThis adds ${burnAddress} to the group (if needed), transfers admin to that burn wallet, and then leaves from your current wallet.\n\nThis action is irreversible.`;
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    try {
      setProcessingGroupAction(true);
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await handoffAdminAndLeaveGroupOnChain({
          signer,
          groupId
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

      if (activeGroupIdRef.current === groupId) {
        setActiveGroupId(null);
      }
      await syncGroupData({ deep: true });
      setStatus(`Left group. Admin was transferred to burn wallet ${shortenAddress(burnAddress)}.`);
    } catch (handoffError) {
      const message = getGroupActionErrorMessage(handoffError, 'Failed to transfer admin to burn wallet and leave group.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    activeGroupId,
    activeGroupIdRef,
    activeGroupMeta,
    getMemoSigner,
    isActiveGroupAdmin,
    runWalletTransactionFlow,
    setActiveGroupId,
    setError,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    setStatus,
    syncGroupData
  ]);

  const disbandActiveGroup = useCallback(async () => {
    setError('');

    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }
    if (!isActiveGroupAdmin) {
      setError('Only the group admin can disband the group.');
      return;
    }

    const groupId = activeGroupId;
    const currentMemberCount = Math.max(0, activeGroupMeta?.memberCount ?? activeGroupMeta?.members.length ?? 0);
    const confirmationMessage = `Disband this group now? This will permanently remove the group and all ${currentMemberCount} member records.`;
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    try {
      setProcessingGroupAction(true);
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await disbandGroupOnChain({
          signer,
          groupId
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

      setGeneratedGroupInviteCode('');
      setGeneratedGroupJoinCodeHash('');
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
    activeGroupMeta,
    getMemoSigner,
    isActiveGroupAdmin,
    runWalletTransactionFlow,
    setActiveGroupId,
    setError,
    setGeneratedGroupInviteCode,
    setGeneratedGroupJoinCodeHash,
    setProcessingGroupAction,
    setSessionOnboardInfo,
    syncGroupData
  ]);

  const declineGroupInvite = useCallback(async (groupId: number) => {
    setError('');
    try {
      setProcessingGroupAction(true);
      await runWalletTransactionFlow(async () => {
        const { signer, cacheKey } = await getMemoSigner();
        await declineGroupInviteOnChain({
          signer,
          groupId
        });

        updateOnboardInfo(setSessionOnboardInfo, cacheKey, signer.getUserOnboardInfo());
      });

      await syncGroupData({ deep: true });
    } catch (declineError) {
      const message = declineError instanceof Error ? declineError.message : 'Failed to decline invite.';
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  }, [
    getMemoSigner,
    runWalletTransactionFlow,
    setError,
    setProcessingGroupAction,
    setSessionOnboardInfo,
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
    revokeJoinCodeForActiveGroup
  };
}
