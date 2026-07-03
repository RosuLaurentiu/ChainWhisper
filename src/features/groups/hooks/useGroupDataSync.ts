import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  COTI_NETWORK,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  INITIAL_SYNC_LOOKBACK_BLOCKS,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfo,
  parseStoredGroupTitle,
  toSafeNumber,
  type ChatMessage,
  type Contact,
  type GroupInvite,
  type GroupSummary,
  type MobileView,
  type SyncGroupOptions,
  type WalletAccountRole
} from '../../../lib/appShared';
import {
  getStoredGroupRemovalNoticeMarker as getStoredGroupRemovalNoticeMarkerStorage,
  setStoredGroupRemovalNoticeMarker as setStoredGroupRemovalNoticeMarkerStorage
} from '../../../lib/appStorage';
import { syncActiveGroupMessagesFast, type GroupMessageSyncContract } from '../../../lib/groupMessageSync';
import {
  collectGroupIdsFromLogs,
  collectLatestGroupRemovalEvents,
  mergeGroupSyncOptions,
  resolveActiveGroupBackfillPlan,
  resolveGroupPrefetchPlan,
  resolveTrackedGroupMessageLoad,
  trackedGroupMessageLoadsMatch,
  type GroupMessageLoadPhase
} from '../../../lib/groupSyncPlan';

type ParsedGroupMessagePayload = {
  cleanText: string;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
  embeddedContactName?: unknown;
  embeddedConversationState?: unknown;
  embeddedReaction?: {
    targetTxHash?: string;
    targetBlockNumber?: number;
    targetLogIndex?: number;
    emoji?: string;
  };
};

type MemoSignerBundle = {
  signer: Wallet | JsonRpcSigner;
  cacheKey: string;
};

type UseGroupDataSyncArgs = {
  activeGroupId: number | null;
  activeGroupIdRef: MutableRefObject<number | null>;
  activeSignerSource: string;
  blockTimestampCacheRef: MutableRefObject<Map<number, number>>;
  chainId: number | null;
  clearGroupMessageLoadPhase: (groupId: number) => void;
  currentWalletKeyRef: MutableRefObject<string>;
  fetchOnChainNicknames: (addresses: string[]) => Promise<Map<string, string>>;
  getMemoSigner: () => Promise<MemoSignerBundle>;
  groupInvitesRef: MutableRefObject<GroupInvite[]>;
  groupDeepBackfillDoneRef: MutableRefObject<Record<string, boolean>>;
  groupMemberLastSyncedBlockRef: MutableRefObject<Record<string, number>>;
  groupMessageLastSyncedBlockRef: MutableRefObject<Record<string, number>>;
  groupOverviewLastSyncedBlockRef: MutableRefObject<Record<string, number>>;
  groupRemovalNoticeMarkersLoadedRef: MutableRefObject<boolean>;
  groupRemovalNoticeMarkersRef: MutableRefObject<Record<string, Record<string, string>>>;
  groupRemovalNoticeSeenRef: MutableRefObject<Record<string, Set<number>>>;
  groupsRef: MutableRefObject<GroupSummary[]>;
  hasAesReady: boolean;
  isMobileNav: boolean;
  lastReadAllTsRef: MutableRefObject<number>;
  lastReadByGroupRef: MutableRefObject<Record<string, number>>;
  markGroupConversationAsRead: (groupId?: number | null) => void;
  messagesByGroup: Record<string, ChatMessage[]>;
  messagesByGroupRef: MutableRefObject<Record<string, ChatMessage[]>>;
  parseEncryptedChatMessagePayload: (
    signer: Wallet | JsonRpcSigner,
    cacheKey: string,
    ciphertext: unknown
  ) => Promise<ParsedGroupMessagePayload>;
  pendingForcedBottomAnchorThreadKeyRef: MutableRefObject<string | null>;
  pendingGroupSyncOptionsRef: MutableRefObject<SyncGroupOptions | null>;
  prefetchedGroupMessagesRef: MutableRefObject<Record<string, boolean>>;
  readStateFeaturesEnabled: boolean;
  setActiveContact: Dispatch<SetStateAction<string | null>>;
  setActiveGroupId: Dispatch<SetStateAction<number | null>>;
  setActiveMobileView: (view: MobileView) => void;
  setContacts: Dispatch<SetStateAction<Contact[]>>;
  setError: Dispatch<SetStateAction<string>>;
  setGroupInvites: Dispatch<SetStateAction<GroupInvite[]>>;
  setGroups: Dispatch<SetStateAction<GroupSummary[]>>;
  setGroupMessageLoadPhase: (groupId: number, phase: GroupMessageLoadPhase) => void;
  setMessagesByGroup: Dispatch<SetStateAction<Record<string, ChatMessage[]>>>;
  setReplyingToMessage: Dispatch<SetStateAction<ChatMessage | null>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  setSyncingGroups: (next: boolean) => void;
  setUnreadGroupMap: (next: Record<string, boolean>) => void;
  showGroupRemovalNotice: (message: string) => void;
  sortedGroups: GroupSummary[];
  stickToBottomRef: MutableRefObject<boolean>;
  syncGroupDataInFlightRef: MutableRefObject<boolean>;
  syncGroupDataRef: MutableRefObject<(options?: SyncGroupOptions) => Promise<void>>;
  unreadGroupMapRef: MutableRefObject<Record<string, boolean>>;
  walletAccountScope: { readAccounts: Array<{ key: string; role?: WalletAccountRole }> };
  walletAddress: string;
};

const GROUP_MESSAGE_PREFETCH_LIMIT = 6;
const GROUP_MESSAGE_PREFETCH_BATCH_SIZE = 2;
const GROUP_REMOVAL_NOTICE_MARKERS_STORAGE_KEY = 'coti-chat-group-removal-notice-markers-v1';

export default function useGroupDataSync({
  activeGroupId,
  activeGroupIdRef,
  activeSignerSource,
  blockTimestampCacheRef,
  chainId,
  clearGroupMessageLoadPhase,
  currentWalletKeyRef,
  fetchOnChainNicknames,
  getMemoSigner,
  groupInvitesRef,
  groupDeepBackfillDoneRef,
  groupMemberLastSyncedBlockRef,
  groupMessageLastSyncedBlockRef,
  groupOverviewLastSyncedBlockRef,
  groupRemovalNoticeMarkersLoadedRef,
  groupRemovalNoticeMarkersRef,
  groupRemovalNoticeSeenRef,
  groupsRef,
  hasAesReady,
  isMobileNav,
  lastReadAllTsRef,
  lastReadByGroupRef,
  markGroupConversationAsRead,
  messagesByGroup,
  messagesByGroupRef,
  parseEncryptedChatMessagePayload,
  pendingForcedBottomAnchorThreadKeyRef,
  pendingGroupSyncOptionsRef,
  prefetchedGroupMessagesRef,
  readStateFeaturesEnabled,
  setActiveContact,
  setActiveGroupId,
  setActiveMobileView,
  setContacts,
  setError,
  setGroupInvites,
  setGroups,
  setGroupMessageLoadPhase,
  setMessagesByGroup,
  setReplyingToMessage,
  setSessionOnboardInfo,
  setSyncingGroups,
  setUnreadGroupMap,
  showGroupRemovalNotice,
  sortedGroups,
  stickToBottomRef,
  syncGroupDataInFlightRef,
  syncGroupDataRef,
  unreadGroupMapRef,
  walletAccountScope,
  walletAddress
}: UseGroupDataSyncArgs) {
  const groupRemovalNoticeMarkerStorage = {
    groupRemovalNoticeMarkersLoadedRef,
    groupRemovalNoticeMarkersRef,
    storageKey: GROUP_REMOVAL_NOTICE_MARKERS_STORAGE_KEY
  };
  const getStoredGroupRemovalNoticeMarker = (walletKey: string, groupId: number): string | undefined =>
    getStoredGroupRemovalNoticeMarkerStorage(walletKey, groupId, groupRemovalNoticeMarkerStorage);

  const setStoredGroupRemovalNoticeMarker = (walletKey: string, groupId: number, marker: string): void =>
    setStoredGroupRemovalNoticeMarkerStorage(walletKey, groupId, marker, groupRemovalNoticeMarkerStorage);

  const getTrackedGroupMessageLoad = (options?: SyncGroupOptions) => {
    const selectedGroupId = activeGroupIdRef.current;
    const groupKey = String(selectedGroupId);
    return resolveTrackedGroupMessageLoad({
      activeGroupId: selectedGroupId,
      activeGroupMessageCount: selectedGroupId === null ? 0 : messagesByGroupRef.current[groupKey]?.length ?? 0,
      options
    });
  };

  const syncGroupData = async (options?: SyncGroupOptions) => {
    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress) || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    const trackedGroupLoad = getTrackedGroupMessageLoad(options);
    if (trackedGroupLoad) {
      setGroupMessageLoadPhase(trackedGroupLoad.groupId, trackedGroupLoad.phase);
    }

    if (syncGroupDataInFlightRef.current) {
      const pending = pendingGroupSyncOptionsRef.current;
      pendingGroupSyncOptionsRef.current = mergeGroupSyncOptions(options, pending);
      return;
    }

    const walletKey = requestedWalletKey;
    const requestedWalletRole =
      walletAccountScope.readAccounts.find((account) => account.key === walletKey)?.role ??
      (activeSignerSource === 'metamask' ? 'owner' : 'chainwhisper');

    try {
      syncGroupDataInFlightRef.current = true;
      if (!options?.background) {
        setSyncingGroups(true);
      }

      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const selectedActiveGroupId = activeGroupIdRef.current;
      const requestedPrefetchGroupId = toSafeNumber(options?.prefetchGroupId);

      const syncActiveGroupMessagesForGroup = (
        groupId: number,
        fastOptions?: { includeMembershipEvents?: boolean; knownLastBlock?: number; prefetch?: boolean; wideLoad?: boolean }
      ): Promise<Map<string, number>> => syncActiveGroupMessagesFast({
        blockTimestampCacheRef,
        cacheKey,
        contract: contract as unknown as GroupMessageSyncContract,
        fastOptions,
        groupId,
        groupMemberLastSyncedBlockRef,
        groupMessageLastSyncedBlockRef,
        isCurrentWalletKey: () => currentWalletKeyRef.current === requestedWalletKey,
        latestBlock,
        messagesByGroupRef,
        options,
        parseEncryptedChatMessagePayload,
        pendingForcedBottomAnchorThreadKeyRef,
        readProvider,
        requestedWalletAddress,
        requestedWalletRole,
        setMessagesByGroup,
        signer,
        stickToBottomRef,
        walletKey
      });
      if (requestedPrefetchGroupId > 0) {
        const prefetchGroupMeta = groupsRef.current.find((group) => group.id === requestedPrefetchGroupId);
        await syncActiveGroupMessagesForGroup(
          requestedPrefetchGroupId,
          {
            knownLastBlock: prefetchGroupMeta?.lastBlock && prefetchGroupMeta.lastBlock > 0
              ? prefetchGroupMeta.lastBlock
              : undefined,
            prefetch: true,
            wideLoad: options?.wideLoad
          }
        );
        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));
        return;
      }

      if (options?.activeMessagesOnly && selectedActiveGroupId !== null) {
        const activeGroupMeta = groupsRef.current.find((g) => g.id === selectedActiveGroupId);
        await syncActiveGroupMessagesForGroup(
          selectedActiveGroupId,
          {
            includeMembershipEvents: true,
            knownLastBlock: activeGroupMeta?.lastBlock && activeGroupMeta.lastBlock > 0
              ? activeGroupMeta.lastBlock
              : undefined,
            wideLoad: options?.wideLoad
          }
        );
        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));
        return;
      }

      const knownGroupIds = new Set<number>();
      for (const group of groupsRef.current) {
        knownGroupIds.add(group.id);
      }
      for (const invite of groupInvitesRef.current) {
        knownGroupIds.add(invite.groupId);
      }
      if (selectedActiveGroupId !== null) {
        knownGroupIds.add(selectedActiveGroupId);
      }

      const memberGroupIds: number[] = [];
      let hasMemberGroupIndex = false;
      let memberGroupCursor = 0;
      const memberGroupPageLimit = 128;
      const memberGroupPageMax = 256;
      for (let page = 0; page < memberGroupPageMax; page += 1) {
        const pageRaw = await contract
          .getGroupsForMemberPage(requestedWalletAddress, memberGroupCursor, memberGroupPageLimit)
          .catch(() => null);
        if (!pageRaw) {
          break;
        }
        hasMemberGroupIndex = true;

        const pageGroupIdsRaw =
          pageRaw && typeof pageRaw === 'object'
            ? (
              (pageRaw as { groupIds?: unknown }).groupIds ??
              (pageRaw as { 0?: unknown })[0]
            )
            : null;
        const nextCursorRaw =
          pageRaw && typeof pageRaw === 'object'
            ? (
              (pageRaw as { nextCursor?: unknown }).nextCursor ??
              (pageRaw as { 1?: unknown })[1]
            )
            : null;

        if (Array.isArray(pageGroupIdsRaw)) {
          for (const groupIdRaw of pageGroupIdsRaw) {
            const groupId = toSafeNumber(groupIdRaw);
            if (groupId > 0) {
              memberGroupIds.push(groupId);
            }
          }
        }

        const nextCursor = toSafeNumber(nextCursorRaw);
        if (nextCursor <= memberGroupCursor) {
          break;
        }
        memberGroupCursor = nextCursor;
      }

      if (hasMemberGroupIndex) {
        knownGroupIds.clear();
        for (const groupId of memberGroupIds) {
          knownGroupIds.add(groupId);
        }
        for (const invite of groupInvitesRef.current) {
          knownGroupIds.add(invite.groupId);
        }
        if (selectedActiveGroupId !== null) {
          knownGroupIds.add(selectedActiveGroupId);
        }
      }

      const overviewLastSyncedBlock = groupOverviewLastSyncedBlockRef.current[walletKey];
      const fromBlock = options?.deep
        ? knownGroupIds.size > 0
          ? 0
          : Math.max(0, latestBlock - INITIAL_SYNC_LOOKBACK_BLOCKS)
        : typeof overviewLastSyncedBlock === 'number'
          ? overviewLastSyncedBlock + 1
          : Math.max(0, latestBlock - INITIAL_SYNC_LOOKBACK_BLOCKS);
      const toBlock = latestBlock;
      const removedGroupIdsForWallet = new Set<number>();
      const removedGroupEventById = new Map<number, { blockNumber: number; logIndex: number; marker: string }>();

      if (hasMemberGroupIndex && fromBlock <= toBlock) {
        const [
          inviteCreatedLogs,
          inviteAcceptedForMeLogs,
          inviteDeclinedLogs,
          inviteRevokedLogs
        ] = await Promise.all([
          contract.queryFilter(contract.filters.GroupInviteCreated(null, requestedWalletAddress, null), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteAccepted(null, requestedWalletAddress, null), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteDeclined(null, requestedWalletAddress, null), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteRevoked(null, requestedWalletAddress, null), fromBlock, toBlock)
        ]);
        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        for (const groupId of collectGroupIdsFromLogs([
          ...inviteCreatedLogs,
          ...inviteAcceptedForMeLogs,
          ...inviteDeclinedLogs,
          ...inviteRevokedLogs
        ])) {
          knownGroupIds.add(groupId);
        }
      } else if (fromBlock <= toBlock) {
        const [
          createdByMeLogs,
          memberAddedLogs,
          memberRemovedLogs,
          memberLeftLogs,
          inviteCreatedLogs,
          inviteAcceptedForMeLogs,
          inviteAcceptedByMeLogs,
          inviteDeclinedLogs,
          inviteRevokedLogs,
          joinedWithCodeForMeLogs
        ] = await Promise.all([
          contract.queryFilter(contract.filters.GroupCreated(null, requestedWalletAddress), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupMemberAdded(null, requestedWalletAddress), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupMemberRemoved(null, requestedWalletAddress), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupMemberLeft(null, requestedWalletAddress), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteCreated(null, requestedWalletAddress, null), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteAccepted(null, requestedWalletAddress, null), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteAccepted(null, null, requestedWalletAddress), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteDeclined(null, requestedWalletAddress, null), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupInviteRevoked(null, requestedWalletAddress, null), fromBlock, toBlock),
          contract.queryFilter(contract.filters.GroupJoinedWithCode(null, requestedWalletAddress, null), fromBlock, toBlock)
        ]);
        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        const removalEvents = collectLatestGroupRemovalEvents(memberRemovedLogs);
        for (const groupId of removalEvents.groupIds) {
          removedGroupIdsForWallet.add(groupId);
        }
        for (const [groupId, event] of removalEvents.eventByGroupId.entries()) {
          removedGroupEventById.set(groupId, event);
        }

        for (const groupId of collectGroupIdsFromLogs([
          ...createdByMeLogs,
          ...memberAddedLogs,
          ...memberRemovedLogs,
          ...memberLeftLogs,
          ...inviteCreatedLogs,
          ...inviteAcceptedForMeLogs,
          ...inviteAcceptedByMeLogs,
          ...inviteDeclinedLogs,
          ...inviteRevokedLogs,
          ...joinedWithCodeForMeLogs
        ])) {
          knownGroupIds.add(groupId);
        }
      }

      if (knownGroupIds.size === 0 && options?.deep && !hasMemberGroupIndex) {
        const nextGroupId = toSafeNumber(await contract.nextGroupId());
        const cappedGroupId = Math.min(nextGroupId, 250);
        for (let groupId = 1; groupId < cappedGroupId; groupId += 1) {
          knownGroupIds.add(groupId);
        }
      }

      if (knownGroupIds.size === 0 && !options?.deep) {
        return;
      }

      const memberGroupIdSet = new Set<number>(memberGroupIds);
      const previousGroups = groupsRef.current;
      const previousGroupById = new Map<number, GroupSummary>(
        previousGroups.map((group) => [group.id, group])
      );
      const nowTs = Math.floor(Date.now() / 1000);
      const nextGroups: GroupSummary[] = [];
      const nextInvites: GroupInvite[] = [];
      await Promise.all(
        Array.from(knownGroupIds).map(async (groupId) => {
          if (!Number.isFinite(groupId) || groupId <= 0) {
            return;
          }

          const isIndexedMemberGroup = hasMemberGroupIndex && memberGroupIdSet.has(groupId);
          let isMember = isIndexedMemberGroup;
          let invitePending = false;
          let inviteInviter = '';
          let inviteExpiresAt = 0;
          let inviteExpired = false;

          if (!isIndexedMemberGroup) {
            const [memberRaw, inviteRaw] = await Promise.all([
              contract.isMember(groupId, requestedWalletAddress).catch(() => false),
              contract.getInvite(groupId, requestedWalletAddress).catch(() => null)
            ]);

            isMember = Boolean(memberRaw);
            invitePending = Boolean(
              inviteRaw && typeof inviteRaw === 'object' ? (inviteRaw as { pending?: unknown }).pending : null
            ) ||
              (Array.isArray(inviteRaw) ? Boolean(inviteRaw[0]) : false);
            inviteInviter = inviteRaw && typeof inviteRaw === 'object'
              ? String((inviteRaw as { inviter?: unknown }).inviter ?? '')
              : Array.isArray(inviteRaw)
                ? String(inviteRaw[1] ?? '')
                : '';
            inviteExpiresAt = inviteRaw && typeof inviteRaw === 'object'
              ? toSafeNumber((inviteRaw as { expiresAt?: unknown }).expiresAt)
              : Array.isArray(inviteRaw)
                ? toSafeNumber(inviteRaw[2])
                : 0;
            inviteExpired = inviteRaw && typeof inviteRaw === 'object'
              ? Boolean((inviteRaw as { expired?: unknown }).expired)
              : Array.isArray(inviteRaw)
                ? Boolean(inviteRaw[3])
                : inviteExpiresAt > 0 && inviteExpiresAt <= nowTs;
          }

          if (!isMember && !invitePending) {
            return;
          }

          const infoRaw = await contract.getGroupInfo(groupId).catch(() => null);
          if (!infoRaw) {
            return;
          }

          const admin = infoRaw && typeof infoRaw === 'object'
            ? String((infoRaw as { admin?: unknown }).admin ?? '')
            : Array.isArray(infoRaw)
              ? String(infoRaw[0] ?? '')
              : '';
          const createdAt = infoRaw && typeof infoRaw === 'object'
            ? toSafeNumber((infoRaw as { createdAt?: unknown }).createdAt)
            : Array.isArray(infoRaw)
              ? toSafeNumber(infoRaw[1])
              : 0;
          const memberCount = infoRaw && typeof infoRaw === 'object'
            ? toSafeNumber((infoRaw as { memberCount?: unknown }).memberCount)
            : Array.isArray(infoRaw)
              ? toSafeNumber(infoRaw[2])
              : 0;
          const title = infoRaw && typeof infoRaw === 'object'
            ? String((infoRaw as { title?: unknown }).title ?? '')
            : Array.isArray(infoRaw)
              ? String(infoRaw[3] ?? '')
              : '';
          const parsedTitle = await parseStoredGroupTitle(title, groupId);
          const lastBlock = infoRaw && typeof infoRaw === 'object'
            ? toSafeNumber((infoRaw as { lastBlock?: unknown }).lastBlock)
            : Array.isArray(infoRaw)
              ? toSafeNumber(infoRaw[4])
              : 0;
          const lastTimestamp = infoRaw && typeof infoRaw === 'object'
            ? toSafeNumber((infoRaw as { lastTimestamp?: unknown }).lastTimestamp)
            : Array.isArray(infoRaw)
              ? toSafeNumber(infoRaw[5])
              : 0;

          if (isMember) {
            const previousGroup = previousGroupById.get(groupId);
            const shouldFetchMembers =
              Boolean(options?.deep) ||
              groupId === selectedActiveGroupId ||
              !previousGroup ||
              previousGroup.lastBlock !== lastBlock ||
              previousGroup.memberCount !== memberCount ||
              previousGroup.members.length === 0;
            let members = previousGroup?.members ?? [];
            if (shouldFetchMembers) {
              const membersRaw = await contract.getGroupMembers(groupId).catch(() => []);
              members = Array.isArray(membersRaw)
                ? membersRaw
                    .map((addressValue) => String(addressValue ?? '').trim())
                    .filter((addressValue) => isWalletAddress(addressValue))
                : [];
            }

            nextGroups.push({
              id: groupId,
              admin,
              title: parsedTitle.title,
              isPrivate: parsedTitle.isPrivate,
              createdAt,
              memberCount: memberCount > 0 ? memberCount : members.length,
              members,
              lastBlock,
              lastTimestamp
            });
          }

          if (invitePending) {
            nextInvites.push({
              groupId,
              inviter: inviteInviter,
              expiresAt: inviteExpiresAt,
              expired: inviteExpired,
              title: parsedTitle.title,
              admin,
              isPrivate: parsedTitle.isPrivate
            });
          }
        })
      );
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nicknameLookupFromGroups = Array.from(
        new Set(
          [
            ...nextGroups.flatMap((group) => group.members),
            ...nextGroups.map((group) => group.admin),
            ...nextInvites.map((invite) => invite.inviter),
            requestedWalletAddress
          ]
            .map((address) => address.trim())
            .filter((address) => isWalletAddress(address))
        )
      );
      if (nicknameLookupFromGroups.length > 0) {
        const onChainNicknames = await fetchOnChainNicknames(nicknameLookupFromGroups);
        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        setContacts((previous) =>
          previous.map((contact) => {
            const nickname = onChainNicknames.get(contact.address.toLowerCase());
            if (!nickname || contact.name === nickname) {
              return contact;
            }

            return { ...contact, name: nickname };
          })
        );
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nextGroupIdSet = new Set(nextGroups.map((group) => group.id));
      const removedGroupsForWallet = previousGroups.filter((group) => !nextGroupIdSet.has(group.id));
      const removedGroupIdsForNoticeSource = hasMemberGroupIndex
        ? removedGroupsForWallet.map((group) => group.id)
        : Array.from(removedGroupIdsForWallet);
      const removalNoticeSeenGroupIds =
        groupRemovalNoticeSeenRef.current[walletKey] ??
        (groupRemovalNoticeSeenRef.current[walletKey] = new Set<number>());
      const removedNowGroupIds = removedGroupIdsForNoticeSource.filter(
        (groupId) => {
          if (nextGroupIdSet.has(groupId) || removalNoticeSeenGroupIds.has(groupId)) {
            return false;
          }
          const eventMarker = removedGroupEventById.get(groupId)?.marker;
          if (!eventMarker) {
            return true;
          }
          return getStoredGroupRemovalNoticeMarker(walletKey, groupId) !== eventMarker;
        }
      );
      if (removedNowGroupIds.length > 0) {
        for (const groupId of removedNowGroupIds) {
          removalNoticeSeenGroupIds.add(groupId);
          const eventMarker = removedGroupEventById.get(groupId)?.marker;
          if (eventMarker) {
            setStoredGroupRemovalNoticeMarker(walletKey, groupId, eventMarker);
          }
        }
        const removedGroupLabel = removedNowGroupIds
          .map((groupId) => {
            const previousGroup = previousGroups.find((group) => group.id === groupId);
            return previousGroup ? `${previousGroup.title} (#${previousGroup.id})` : `Group #${groupId}`;
          })
          .join(', ');
        showGroupRemovalNotice(
          removedNowGroupIds.length === 1
            ? `You were removed from ${removedGroupLabel}.`
            : `You were removed from these groups: ${removedGroupLabel}.`
        );
      }

      setGroups(nextGroups);
      setGroupInvites(nextInvites.filter((invite) => !invite.expired));
      const removedGroupIdsForUi = new Set<number>([
        ...removedGroupsForWallet.map((group) => group.id),
        ...removedNowGroupIds
      ]);
      if (removedGroupIdsForUi.size > 0) {
        const removedGroupIdSet = new Set(Array.from(removedGroupIdsForUi).map((groupId) => String(groupId)));
        setMessagesByGroup((previous) => {
          let changed = false;
          const nextEntries = Object.entries(previous).filter(([groupKey]) => {
            const keep = !removedGroupIdSet.has(groupKey);
            if (!keep) {
              changed = true;
            }
            return keep;
          });
          if (!changed) {
            return previous;
          }
          return Object.fromEntries(nextEntries);
        });

        for (const removedGroupId of removedGroupIdsForUi) {
          const messageSyncKey = `${walletKey}:${removedGroupId}`;
          const memberSyncKey = `${walletKey}:${removedGroupId}`;
          delete groupMessageLastSyncedBlockRef.current[messageSyncKey];
          delete groupMemberLastSyncedBlockRef.current[memberSyncKey];
        }
      }

      if (selectedActiveGroupId !== null && !nextGroups.some((group) => group.id === selectedActiveGroupId)) {
        setActiveGroupId(null);
      }

      groupOverviewLastSyncedBlockRef.current[walletKey] = latestBlock;
      const latestIncomingByGroup = new Map<string, number>();
      if (options?.overviewOnly && !options.deep && !options.activeMessagesOnly) {
        const prefetchGroups = [...nextGroups]
          .filter((group) => group.lastBlock > 0)
          .sort((left, right) => right.lastTimestamp - left.lastTimestamp || right.lastBlock - left.lastBlock)
          .slice(0, GROUP_MESSAGE_PREFETCH_LIMIT);

        for (
          let batchStart = 0;
          batchStart < prefetchGroups.length;
          batchStart += GROUP_MESSAGE_PREFETCH_BATCH_SIZE
        ) {
          const batch = prefetchGroups.slice(batchStart, batchStart + GROUP_MESSAGE_PREFETCH_BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map((group) =>
              syncActiveGroupMessagesForGroup(group.id, {
                knownLastBlock: group.lastBlock,
                prefetch: true
              }).catch(() => new Map<string, number>())
            )
          );
          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }

          for (const result of batchResults) {
            for (const [groupKey, timestamp] of result.entries()) {
              const existingTimestamp = latestIncomingByGroup.get(groupKey) ?? 0;
              if (timestamp > existingTimestamp) {
                latestIncomingByGroup.set(groupKey, timestamp);
              }
            }
          }
        }
      }

      if (!options?.overviewOnly && selectedActiveGroupId !== null) {
        const activeGroupMeta = nextGroups.find((group) => group.id === selectedActiveGroupId);
        if (activeGroupMeta) {
          const activeGroupIncoming = await syncActiveGroupMessagesForGroup(selectedActiveGroupId, {
            includeMembershipEvents: true,
            knownLastBlock: activeGroupMeta.lastBlock > 0 ? activeGroupMeta.lastBlock : undefined,
            wideLoad: options?.wideLoad
          });
          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }

          for (const [groupKey, timestamp] of activeGroupIncoming.entries()) {
            const existingTimestamp = latestIncomingByGroup.get(groupKey) ?? 0;
            if (timestamp > existingTimestamp) {
              latestIncomingByGroup.set(groupKey, timestamp);
            }
          }
        }
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (!readStateFeaturesEnabled) {
        if (Object.keys(unreadGroupMapRef.current || {}).length > 0) {
          unreadGroupMapRef.current = {};
          setUnreadGroupMap({});
        }
      } else {
        const nextReadByGroup = { ...lastReadByGroupRef.current };
        const previousUnreadGroups = unreadGroupMapRef.current || {};
        const nextUnreadGroups = { ...previousUnreadGroups };
        const activeGroupKey = selectedActiveGroupId !== null ? String(selectedActiveGroupId) : null;
        const pageVisible =
          typeof document !== 'undefined' &&
          !document.hidden &&
          (typeof document.hasFocus === 'function' ? document.hasFocus() : true);
        const globalReadTs = lastReadAllTsRef.current;
        const candidateGroupKeys = new Set(nextGroups.map((group) => String(group.id)));
        let readByGroupChanged = false;
        let unreadGroupsChanged = false;

        for (const group of nextGroups) {
          const groupKey = String(group.id);
          const localMessages = messagesByGroup[groupKey] ?? [];
          let latestIncomingFromLocal = latestIncomingByGroup.get(groupKey) ?? 0;
          let latestOutgoingFromLocal = 0;
          for (const message of localMessages) {
            if (typeof message.timestamp !== 'number') {
              continue;
            }
            const ts = Number(message.timestamp);
            if (message.direction === 'incoming' && ts > latestIncomingFromLocal) {
              latestIncomingFromLocal = ts;
            } else if (message.direction === 'outgoing' && ts > latestOutgoingFromLocal) {
              latestOutgoingFromLocal = ts;
            }
          }

          // Group summary lastTimestamp advances for any activity (including my own outgoing messages).
          // Treat it as incoming only when it is newer than known local outgoing timestamps.
          const summaryLastTimestamp = toSafeNumber(group.lastTimestamp);
          const latestIncomingFromSummary =
            summaryLastTimestamp > latestOutgoingFromLocal ? summaryLastTimestamp : 0;
          const latestMessageTs = Math.max(latestIncomingFromLocal, latestIncomingFromSummary);
          if (groupKey === activeGroupKey && pageVisible && latestMessageTs > 0) {
            const existingReadTs = nextReadByGroup[groupKey] ?? 0;
            if (latestMessageTs > existingReadTs) {
              nextReadByGroup[groupKey] = latestMessageTs;
              readByGroupChanged = true;
            }
          }

          const groupReadTs = nextReadByGroup[groupKey] ?? 0;
          const effectiveReadTs = Math.max(globalReadTs, groupReadTs);
          const shouldUnread = latestMessageTs > effectiveReadTs && !(groupKey === activeGroupKey && pageVisible);
          if (shouldUnread) {
            if (!nextUnreadGroups[groupKey]) {
              nextUnreadGroups[groupKey] = true;
              unreadGroupsChanged = true;
            }
          } else if (nextUnreadGroups[groupKey]) {
            delete nextUnreadGroups[groupKey];
            unreadGroupsChanged = true;
          }
        }

        for (const existingGroupKey of Object.keys(nextUnreadGroups)) {
          if (!candidateGroupKeys.has(existingGroupKey)) {
            delete nextUnreadGroups[existingGroupKey];
            unreadGroupsChanged = true;
          }
        }

        if (unreadGroupsChanged) {
          unreadGroupMapRef.current = nextUnreadGroups;
          setUnreadGroupMap(nextUnreadGroups);
        }
        if (readByGroupChanged) {
          lastReadByGroupRef.current = nextReadByGroup;
        }
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
    } catch (syncError) {
      if (!options?.background) {
        const message = syncError instanceof Error ? syncError.message : 'Failed to sync group data.';
        setError(message);
      }
    } finally {
      syncGroupDataInFlightRef.current = false;
      if (!options?.background) {
        setSyncingGroups(false);
      }

      const pendingOptions = pendingGroupSyncOptionsRef.current;
      pendingGroupSyncOptionsRef.current = null;
      const pendingTrackedGroupLoad = getTrackedGroupMessageLoad(pendingOptions ?? undefined);
      if (trackedGroupLoad && !trackedGroupMessageLoadsMatch(trackedGroupLoad, pendingTrackedGroupLoad)) {
        clearGroupMessageLoadPhase(trackedGroupLoad.groupId);
      }
      if (pendingOptions) {
        syncGroupData(pendingOptions).catch(() => {});
      }
    }
  };

  useEffect(() => {
    syncGroupDataRef.current = syncGroupData;
  }, [syncGroupData]);

  useEffect(() => {
    const walletKey = walletAddress.trim().toLowerCase();
    const backfillPlan = resolveActiveGroupBackfillPlan({
      activeGroupId,
      chainId,
      completedBackfillKeys: groupDeepBackfillDoneRef.current,
      hasAesReady,
      requiredChainId: COTI_NETWORK.chainIdDecimal,
      walletAddress,
      walletAddressValid: isWalletAddress(walletKey)
    });
    if (!backfillPlan) {
      return;
    }

    syncGroupDataRef.current(backfillPlan.fastOptions).catch(() => {});
    if (backfillPlan.deepOptions) {
      groupDeepBackfillDoneRef.current[backfillPlan.cacheKey] = true;
      syncGroupDataRef.current(backfillPlan.deepOptions).catch(() => {
        delete groupDeepBackfillDoneRef.current[backfillPlan.cacheKey];
      });
    }
  }, [activeGroupId, chainId, groupDeepBackfillDoneRef, hasAesReady, syncGroupDataRef, walletAddress]);

  const activateGroup = useCallback((groupId: number) => {
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return;
    }
    activeGroupIdRef.current = groupId;
    setActiveContact(null);
    setReplyingToMessage(null);
    setActiveGroupId(groupId);
    markGroupConversationAsRead(groupId);
    if (isMobileNav) {
      setActiveMobileView('chat');
    }
  }, [isMobileNav, markGroupConversationAsRead]);

  const prefetchGroupBeforeOpen = useCallback((groupId: number) => {
    const prefetchPlan = resolveGroupPrefetchPlan({
      chainId,
      groups: groupsRef.current,
      hasAesReady,
      prefetchedKeys: prefetchedGroupMessagesRef.current,
      requestedGroupId: groupId,
      requiredChainId: COTI_NETWORK.chainIdDecimal,
      walletAddress
    });
    if (!prefetchPlan) {
      return;
    }

    prefetchedGroupMessagesRef.current[prefetchPlan.cacheKey] = true;
    syncGroupDataRef.current(prefetchPlan.options).catch(() => {
      delete prefetchedGroupMessagesRef.current[prefetchPlan.cacheKey];
    });
  }, [walletAddress, hasAesReady, chainId]);

  useEffect(() => {
    if (activeGroupId !== null || sortedGroups.length === 0 || !walletAddress || !hasAesReady) {
      return;
    }

    const mostRecentGroup = sortedGroups[0];
    const prefetchTimerId = window.setTimeout(() => {
      prefetchGroupBeforeOpen(mostRecentGroup.id);
    }, 300);

    return () => {
      window.clearTimeout(prefetchTimerId);
    };
  }, [activeGroupId, sortedGroups, walletAddress, hasAesReady, prefetchGroupBeforeOpen]);



  return {
    activateGroup,
    prefetchGroupBeforeOpen,
    syncGroupData
  };
}
