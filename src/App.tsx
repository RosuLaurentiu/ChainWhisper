import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DirectChatPanel,
  GroupChatPanel,
  P2PTradingPage,
  QuickActionsModal,
  RouteLoadingFallback,
  TokenSwapPage,
  TradeComposerPanel,
  TreasuryPage,
  preloadChatPage,
  preloadSwapPage,
  preloadTradesPage,
  preloadTreasuryPage
} from './app/lazyRoutes';
import { BROWSER_WALLET_DIRECT_MESSAGE_MAX_LENGTH } from './app/appHelpers';
import AppErrorBoundary from './app/components/AppErrorBoundary';
import AppHeader from './app/components/AppHeader';
import { AppHeaderHomeButton, AppHeaderNavigation } from './app/components/AppHeaderNavigation';
import ContactsSidebar from './features/chat/components/ContactsSidebar';
import ChatReadinessState from './features/chat/components/ChatReadinessState';
import GroupActionControls from './features/groups/components/GroupActionControls';
import HomePage from './app/components/HomePage';
import { ActiveJoinCodeList, GroupInviteMenu } from './features/groups/components/GroupInviteTools';
import MobileBottomNav from './app/components/MobileBottomNav';
import { readChatComposerText } from './shared/chatComposeText';
import useBlockTimestampCache from './shared/hooks/useBlockTimestampCache';
import useClipboardFeedback from './shared/hooks/useClipboardFeedback';
import useAppNavigation from './app/hooks/useAppNavigation';
import useAppChainLookups from './app/hooks/useAppChainLookups';
import useAppFeeResolvers from './app/hooks/useAppFeeResolvers';
import useMobileHeaderLinks from './app/hooks/useMobileHeaderLinks';
import { useBurnerWallet } from './features/wallet/hooks/useBurnerWallet';
import useBurnerWalletDisplay from './features/wallet/hooks/useBurnerWalletDisplay';
import useAccountFundsSigners from './features/wallet/hooks/useAccountFundsSigners';
import useAccountFundsTransfer from './features/wallet/hooks/useAccountFundsTransfer';
import useAccountFundsViewModel from './features/wallet/hooks/useAccountFundsViewModel';
import useOwnerWalletBalances from './features/wallet/hooks/useOwnerWalletBalances';
import useOwnerRecoveryBootstrap from './features/wallet/hooks/useOwnerRecoveryBootstrap';
import useAppWalletHeaderControl from './features/wallet/hooks/useChatWalletHeaderControl';
import useWalletReadiness from './features/wallet/hooks/useWalletReadiness';
import useSharedWalletSigner from './features/wallet/hooks/useSharedWalletSigner';
import useWalletBalanceRefreshEffects from './features/wallet/hooks/useWalletBalanceRefreshEffects';
import useDirectConversationSync from './features/chat/hooks/useDirectConversationSync';
import useActiveConversationState from './features/chat/hooks/useActiveConversationState';
import useConversationSidebarState from './features/chat/hooks/useConversationSidebarState';
import useConversationPreferenceActions from './features/chat/hooks/useConversationPreferenceActions';
import useContactActions from './features/chat/hooks/useContactActions';
import useConversationReadStateActions from './features/chat/hooks/useConversationReadStateActions';
import useDirectMessageActions from './features/chat/hooks/useDirectMessageActions';
import useDirectConversationRealtimeSync from './features/chat/hooks/useDirectConversationRealtimeSync';
import useContactsSidebarHandlers from './features/chat/hooks/useContactsSidebarHandlers';
import useDirectChatPanelHandlers from './features/chat/hooks/useDirectChatPanelHandlers';
import useChatMemoCrypto from './features/chat/hooks/useChatMemoCrypto';
import useDirectComposerPromptEstimates from './features/chat/hooks/useDirectComposerPromptEstimates';
import useUnreadConversationNotifications from './features/chat/hooks/useUnreadConversationNotifications';
import useTipComposerState from './features/chat/hooks/useTipComposerState';
import useMessageReactionActions from './features/chat/hooks/useMessageReactionActions';
import useMessageReactions from './features/chat/hooks/useMessageReactions';
import useChatThreadScroll from './features/chat/hooks/useChatThreadScroll';
import useActiveGroupThreadState from './features/groups/hooks/useActiveGroupThreadState';
import useGroupAdminActions from './features/groups/hooks/useGroupAdminActions';
import useGroupDataSync from './features/groups/hooks/useGroupDataSync';
import useGroupRealtimeSync from './features/groups/hooks/useGroupRealtimeSync';
import useGroupMessageActions from './features/groups/hooks/useGroupMessageActions';
import useInChatTradeActions from './features/trading/hooks/useInChatTradeActions';
import useActiveTradeOfferSnapshots from './features/trading/hooks/useActiveTradeOfferSnapshots';
import useChatTradeAgentActions from './features/trading/hooks/useChatTradeAgentActions';
import useTradeAgentChatFeeLabels from './features/trading/hooks/useTradeAgentChatFeeLabels';
import useTradeCustomTokenInfoLoader from './features/trading/hooks/useTradeCustomTokenInfoLoader';
import { useNotificationSound } from './app/hooks/useNotificationSound';
import useImageAttachmentStatus from './features/chat/hooks/useImageAttachmentStatus';
import WalletSessionModals from './features/wallet/components/WalletSessionModals';
import { useStateBackupSync } from './app/hooks/useStateBackupSync';
import { useStoredWalletPreference } from './features/wallet/hooks/useStoredWalletPreference';
import { useWalletOnboarding } from './features/wallet/hooks/useWalletOnboarding';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  resolveTradePresetKind,
  sanitizeOutgoingMessagePlainText,
  type TradeTokenPresetKey
} from './lib/appHelpers';
import { type WalletAesHealthState } from './lib/cotiAesUnlock';
import { COTI_ECOSYSTEM_LINKS } from './lib/ecosystemLinks';
import {
  getAppHelpReadinessTopicId,
  normalizeAppHelpLaunchContext,
  type AppHelpLaunchContext,
  type AppHelpOrigin,
  type AppHelpReason
} from './lib/appHelpLaunch';
import type { LinkedTradeContext } from './lib/linkedTradeContext';
import { isWalletTransactionFlowActive, runWalletTransactionFlow } from './lib/walletTransactionFlow';
import { getPreferredBrowserWalletId } from './lib/appStorage';
import { deriveTradeComposerModel } from './lib/tradeComposer';
import { type GroupMessageLoadPhase } from './lib/groupSyncPlan';
import {
  resolveRestorableAppWalletId,
  type SharedWalletSession,
  type WalletSessionActions
} from './lib/walletSession';
import { getAppWalletPolicy } from './shell/walletPolicy';
import { useAppShellStore } from './features/appShell/appShellStore';
import { useChatUiStore } from './features/chat/chatUiStore';
import { useGroupUiStore } from './features/groups/groupUiStore';
import { useInChatTradeStore } from './features/trading/inChatTradeStore';
import { useTokenToolsStore } from './features/tokenTools/tokenToolsStore';
import useRewardTokenMetrics from './features/tokenTools/useRewardTokenMetrics';
import useTokenSwapActions from './features/tokenTools/useTokenSwapActions';
import useTokenSwapViewModel, { usePrivacyPortalViewModel } from './features/tokenTools/useTokenSwapViewModel';
import usePrivacyPortal from './features/tokenTools/usePrivacyPortal';
import { getPrivacyTokenPair, PRIVACY_TOKEN_PAIRS } from './lib/privacyPortal';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI,
  ChatMessage,
  Contact,
  COPY_FEEDBACK_DURATION_MS,
  COTI_NETWORK,
  DEFAULT_GROUP_JOIN_CODE_MULTI_USES,
  DEFAULT_NICKNAME_MAX_BYTES,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  formatCotiAmount,
  formatTokenAmount,
  getMessageDisplayText,
  GROUP_REMOVAL_NOTICE_AUTO_DISMISS_MS,
  GroupInvite,
  GroupSummary,
  isWalletAddress,
  MAX_MESSAGE_LENGTH,
  normalizeLastReadAllTs,
  sanitizeTokenAmountInput,
  SyncConversationOptions,
  SyncGroupOptions,
  trimReplyPreview,
} from './lib/appShared';

export default function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversationStateSyncPendingByContact, setConversationStateSyncPendingByContact] = useState<
    Record<string, boolean>
  >({});
  const [activeContact, setActiveContact] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [linkedTradeContext, setLinkedTradeContext] = useState<LinkedTradeContext | null>(null);
  const [negotiatingLinkedTradeKey, setNegotiatingLinkedTradeKey] = useState('');
  const [draftingTradeMessageId, setDraftingTradeMessageId] = useState('');
  const tradeAgentChatFeeLabels = useTradeAgentChatFeeLabels();
  const [myNickname, setMyNickname] = useState('');
  const [nicknameMaxBytes, setNicknameMaxBytes] = useState(DEFAULT_NICKNAME_MAX_BYTES);
  const [messagesByContact, setMessagesByContact] = useState<Record<string, ChatMessage[]>>({});
  const [messagesByGroup, setMessagesByGroup] = useState<Record<string, ChatMessage[]>>({});
  const [groupMessageLoadPhaseByGroup, setGroupMessageLoadPhaseByGroup] = useState<Record<string, GroupMessageLoadPhase>>({});
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const {
    clearImageAttachmentStatus,
    imageAttachmentStatus,
    showImageAttachmentStatus
  } = useImageAttachmentStatus();
  const {
    newContact,
    newContactName,
    showHiddenContacts,
    editingContactAddress,
    editingContactName,
    showQuickActionsModal,
    showTopUpModal,
    messageInput,
    persistedContactOrder,
    unreadMap,
    unreadGroupMap,
    lastCopiedKey,
    lastReadAllTs,
    soundEnabled,
    sending,
    uploadingImage,
    sendingReaction,
    syncingHistory,
    loadingOlderHistory,
    replyingToMessage,
    reactionPickerMessageId,
    highlightedMessageId,
    tipping,
    tipComposerOpen,
    tipTokenSelection,
    tipAmountInput,
    setNewContact,
    setNewContactName,
    setShowHiddenContacts,
    setEditingContactAddress,
    setEditingContactName,
    setShowQuickActionsModal,
    setShowTopUpModal,
    setQuickActionTab,
    setMessageInput,
    setPersistedContactOrder,
    setUnreadMap,
    setUnreadGroupMap,
    setLastCopiedKey,
    setLastReadAllTs,
    setSoundEnabled,
    setSending,
    setUploadingImage,
    setSendingReaction,
    setSyncingHistory,
    setLoadingOlderHistory,
    setReplyingToMessage,
    setReactionPickerMessageId,
    setHighlightedMessageId,
    setTipping,
    setTipComposerOpen,
    setTipTokenSelection,
    setTipAmountInput
  } = useChatUiStore();
  const {
    newGroupTitle,
    newGroupIsPrivate,
    newGroupMembersInput,
    groupInviteMembersInput,
    groupInviteTtlInput,
    groupJoinCodeMode,
    groupJoinCodeMaxUsesInput,
    generatedGroupInviteCode,
    generatedGroupJoinCodeHash,
    activeGroupJoinCodes,
    loadingActiveGroupJoinCodes,
    revokingGroupJoinCodeHash,
    groupInviteMenuView,
    groupJoinCodeInput,
    groupRenameOpen,
    groupRenameInput,
    groupTipRecipientAddress,
    sendingGroupMessage,
    processingGroupAction,
    syncingGroups,
    mobileGroupOptionsOpen,
    setNewGroupTitle,
    setNewGroupIsPrivate,
    setNewGroupMembersInput,
    setGroupInviteMembersInput,
    setGroupInviteTtlInput,
    setGroupJoinCodeMode,
    setGroupJoinCodeMaxUsesInput,
    setGeneratedGroupInviteCode,
    setGeneratedGroupJoinCodeHash,
    setActiveGroupJoinCodes,
    setLoadingActiveGroupJoinCodes,
    setRevokingGroupJoinCodeHash,
    setGroupInviteMenuView,
    setGroupJoinCodeInput,
    setGroupRenameOpen,
    setGroupRenameInput,
    setGroupTipRecipientAddress,
    setSendingGroupMessage,
    setProcessingGroupAction,
    setSyncingGroups,
    setMobileGroupOptionsOpen
  } = useGroupUiStore();
  const {
    topUpAmountWei,
    requiredFeeWei,
    tipNativeBalanceWei,
    shieldVaultTokenBalanceWei,
    rewardTokenBalanceWei,
    privateRewardTokenBalanceWei,
    rewardTokenSymbol,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    privateRewardTokenDecimals,
    swapFeeWei,
    swapTokenFeeAmount,
    groupFeeModeSelection,
    swapDirection,
    swapAmountInput,
    privacyAmountInput,
    swappingTokens,
    swapActionStage,
    swapStatusMessage,
    swapTransactionHash,
    selectedPrivacyPairId,
    privacyDirection,
    privacyTokenSearch,
    privacyRecoveryOpen,
    loadingTopUpQuote,
    loadingRewardBalances,
    setTopUpAmountWei,
    setRequiredFeeWei,
    setTipNativeBalanceWei,
    setGroupRewardsContractAddress,
    setGroupRewardsPaused,
    setRewardsContractPaused,
    setRewardsCallerAllowed,
    setRewardsPublicPerInteractionWei,
    setRewardsPublicReserveWei,
    setRewardTokenBalanceWei,
    setPrivateRewardTokenBalanceWei,
    setSwapFeeWei,
    setSwapTokenFeeAmount,
    setGroupFeeModeSelection,
    setSwapDirection,
    setSwapAmountInput,
    setPrivacyAmountInput,
    setSelectedPrivacyPairId,
    setPrivacyDirection,
    setPrivacyTokenSearch,
    setPrivacyRecoveryOpen,
    setLoadingTopUpQuote
  } = useTokenToolsStore();
  const [legacyPrivateRewardTokenBalanceWei, setLegacyPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [legacyPrivateRewardTokenSymbol, setLegacyPrivateRewardTokenSymbol] = useState(FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL);
  const [legacyPrivateRewardTokenDecimals, setLegacyPrivateRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [privacyPortalAccount, setPrivacyPortalAccount] = useState<'chainwhisper' | 'owner'>('chainwhisper');
  const {
    tradeComposerOpen,
    creatingTrade,
    processingTradeActionId,
    tradeFeeModeSelection,
    tradeRequiredFeeWei,
    tradeOfferTokenSelection,
    tradeRequestTokenSelection,
    tradeOfferCustomTokenAddress,
    tradeRequestCustomTokenAddress,
    customTradeTokenInfoByAddress,
    tradeOfferAmountInput,
    tradeRequestAmountInput,
    tradeExpiryHoursInput,
    tradeCounterParentId,
    tradeCounterContext,
    tradeSnapshotsById,
    setTradeComposerOpen,
    setCreatingTrade,
    setProcessingTradeActionId,
    setTradeFeeModeSelection,
    setTradeRequiredFeeWei,
    setTradeOfferTokenSelection,
    setTradeRequestTokenSelection,
    setTradeOfferCustomTokenAddress,
    setTradeRequestCustomTokenAddress,
    setCustomTradeTokenInfoByAddress,
    setTradeOfferAmountInput,
    setTradeRequestAmountInput,
    setTradeExpiryHoursInput,
    setTradeHidePrivateLiquidity,
    setTradeCounterParentId,
    setTradeCounterContext,
    setTradeSnapshotsById
  } = useInChatTradeStore();
  const lastReadAllTsRef = useRef(0);
  const lastReadByContactRef = useRef<Record<string, number>>({});
  const lastReadByGroupRef = useRef<Record<string, number>>({});
  const unreadMapRef = useRef<Record<string, boolean>>({});
  const unreadGroupMapRef = useRef<Record<string, boolean>>({});
  const {
    beginConnectSoundSuppression,
    endConnectSoundSuppression,
    initPersistentAudio,
    isConnectSoundSuppressed,
    playNotificationSound,
    stopNotificationSound
  } = useNotificationSound(soundEnabled);
  const [error, setError] = useState<string>('');
  const { copyWithFeedback } = useClipboardFeedback({
    feedbackDurationMs: COPY_FEEDBACK_DURATION_MS,
    onError: setError,
    setLastCopiedKey
  });
  const [walletAesHealthByAddress, setWalletAesHealthByAddress] = useState<Record<string, WalletAesHealthState>>({});
  const {
    activePage,
    activeMobileView,
    mobileLinksOpen,
    chatWalletMenuOpen,
    directRealtimeStatus,
    groupRealtimeStatus,
    setActivePage,
    setActiveMobileView,
    setMobileLinksOpen,
    setChatWalletMenuOpen,
    setDirectRealtimeStatus,
    setGroupRealtimeStatus
  } = useAppShellStore();
  const [appHelpLaunchContext, setAppHelpLaunchContext] = useState<AppHelpLaunchContext | null>(null);
  const activePageWalletPolicy = useMemo(() => getAppWalletPolicy(activePage), [activePage]);
  const allowStartupWalletRestore = activePageWalletPolicy.walletControlKind === 'app';
  const [chatAppWalletMenuOpen, setChatAppWalletMenuOpen] = useState(false);
  const topHeaderRef = useRef<HTMLElement | null>(null);
  const isMobileNav = useMobileHeaderLinks({ mobileLinksOpen, setMobileLinksOpen, topHeaderRef });
  useEffect(() => {
    setGroupInviteTtlInput((previous) => {
      const normalized = previous.trim();
      if (!normalized || normalized === '168') {
        return '8';
      }
      return previous;
    });
  }, [setGroupInviteTtlInput]);
  const nicknameEditorRef = useRef<HTMLDivElement | null>(null);
  const chatComposerRef = useRef<HTMLDivElement | null>(null);
  const groupRemovalNoticeTimeoutRef = useRef<number | null>(null);
  const sendingRef = useRef(false);
  const previousWalletAddressRef = useRef<string>('');
  const postConnectDataSyncRunIdRef = useRef(0);
  const pinnedContactStateRef = useRef<Map<string, { muted?: boolean; hidden?: boolean }>>(new Map());
  const { blockTimestampCacheRef, resetBlockTimestampCache, resolveBlockTimestampMap } = useBlockTimestampCache();

  useEffect(() => {
    lastReadAllTsRef.current = normalizeLastReadAllTs(lastReadAllTs);
  }, [lastReadAllTs]);

  const prevUnreadRef = useRef<Record<string, boolean>>({});
  const prevUnreadGroupRef = useRef<Record<string, boolean>>({});
  const onChainNicknameCacheRef = useRef<Record<string, string | null>>({});
  const notificationSuppressedContactAddressSet = useUnreadConversationNotifications({
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
  });

  const syncConversationHistoryRef = useRef<(options?: SyncConversationOptions) => Promise<void>>(async () => {});
  const syncGroupDataRef = useRef<(options?: SyncGroupOptions) => Promise<void>>(async () => {});
  const syncGroupDataInFlightRef = useRef(false);
  const pendingGroupSyncOptionsRef = useRef<SyncGroupOptions | null>(null);
  const groupOverviewLastSyncedBlockRef = useRef<Record<string, number>>({});
  const groupMessageLastSyncedBlockRef = useRef<Record<string, number>>({});
  const groupMemberLastSyncedBlockRef = useRef<Record<string, number>>({});
  const groupRemovalNoticeSeenRef = useRef<Record<string, Set<number>>>({});
  const groupRemovalNoticeMarkersRef = useRef<Record<string, Record<string, string>>>({});
  const groupRemovalNoticeMarkersLoadedRef = useRef(false);
  const conversationDeepBackfillDoneRef = useRef<Record<string, boolean>>({});
  const groupDeepBackfillDoneRef = useRef<Record<string, boolean>>({});
  const memoAesRecoveryAttemptedRef = useRef<Record<string, boolean>>({});
  const messagesByGroupRef = useRef<Record<string, ChatMessage[]>>({});
  const groupMessageLoadPhaseByGroupRef = useRef<Record<string, GroupMessageLoadPhase>>({});
  const prefetchedGroupMessagesRef = useRef<Record<string, boolean>>({});
  const groupsRef = useRef<GroupSummary[]>([]);
  const groupInvitesRef = useRef<GroupInvite[]>([]);
  const activeContactRef = useRef<string | null>(null);
  const activeGroupIdRef = useRef<number | null>(null);
  const clearCachedStateBackupMemoRef = useRef<() => void>(() => {});
  const getMemoSignerRef = useRef<() => Promise<{ signer: Wallet | JsonRpcSigner; cacheKey: string }>>(async () => {
    throw new Error('Memo signer is not ready yet.');
  });
  const encodeMemoForActiveSignerRef = useRef<(plain: string) => string>((plain) => plain);
  const clearCachedStateBackupMemo = useCallback(() => {
    clearCachedStateBackupMemoRef.current();
  }, []);
  const setGroupMessageLoadPhase = useCallback((groupId: number, phase: GroupMessageLoadPhase) => {
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return;
    }

    const groupKey = String(Math.floor(groupId));
    if (groupMessageLoadPhaseByGroupRef.current[groupKey] === phase) {
      return;
    }

    const nextPhases = {
      ...groupMessageLoadPhaseByGroupRef.current,
      [groupKey]: phase
    };
    groupMessageLoadPhaseByGroupRef.current = nextPhases;
    setGroupMessageLoadPhaseByGroup(nextPhases);
  }, [setGroupInviteTtlInput]);
  const clearGroupMessageLoadPhase = useCallback((groupId: number) => {
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return;
    }

    const groupKey = String(Math.floor(groupId));
    if (!groupMessageLoadPhaseByGroupRef.current[groupKey]) {
      return;
    }

    const nextPhases = { ...groupMessageLoadPhaseByGroupRef.current };
    delete nextPhases[groupKey];
    groupMessageLoadPhaseByGroupRef.current = nextPhases;
    setGroupMessageLoadPhaseByGroup(nextPhases);
  }, []);
  const loadMyNicknameFromChainRef = useRef<(address: string) => Promise<string>>(async () => '');
  const runPostConnectDataSyncUntilAppliedRef = useRef<(address: string) => Promise<void>>(async () => {});
  const resetBurnerSessionRef = useRef<() => void>(() => {});
  const schedulePostUnlockRefresh = useCallback(() => {
    const runRefresh = () => {
      if (isWalletTransactionFlowActive()) {
        window.setTimeout(runRefresh, 500);
        return;
      }
      try {
        syncConversationHistoryRef.current({
          contactsOnly: true,
          previewPerContact: true,
          updateHead: true,
          background: true
        }).catch(() => {});
      } catch {}
    };
    window.setTimeout(runRefresh, 300);
  }, []);
  const walletPreference = useStoredWalletPreference();
  const preferredBrowserWalletId = getPreferredBrowserWalletId(walletPreference);
  const setWalletAesHealth = useCallback((address: string, health: WalletAesHealthState) => {
    const walletKey = address.trim().toLowerCase();
    if (!walletKey) {
      return;
    }
    setWalletAesHealthByAddress((previous) =>
      previous[walletKey]?.status === health.status && previous[walletKey]?.message === health.message
        ? previous
        : {
            ...previous,
            [walletKey]: health
          }
    );
  }, []);
  const {
    activeProvider,
    activeSignerSource,
    activateBrowserWalletSession,
    browserWalletSession,
    chainId,
    connectingMethod,
    connectingWalletLabel,
    connectionMethod,
    currentInjectedWalletOption,
    currentWalletKeyRef,
    disconnectWallet: disconnectWalletSession,
    ensureCotiNetwork,
    getConnectedProvider,
    injectedWalletOptions,
    preferredInjectedWalletOption,
    resolveWalletPromptProvider,
    sessionOnboardInfo,
    setActiveSignerSource,
    setChainId,
    setConnectedProvider,
    setConnectionMethod,
    setOnboardStatus,
    setSelectedInjectedWalletId,
    setSessionOnboardInfo,
    setStatus,
    setWalletAddress,
    signerCacheRef,
    signerProviderCacheRef,
    walletAddress,
    onboardStatus
  } = useWalletOnboarding({
    allowPassiveBrowserRestore: false,
    clearCachedStateBackupMemo,
    loadMyNicknameFromChainRef,
    resetBurnerSessionRef,
    runPostConnectDataSyncUntilAppliedRef,
    setError,
    setMyNickname,
    onWalletAesHealthChange: setWalletAesHealth,
    walletAesHealthByAddress
  });
  const sharedWalletTransactionRuntimeRef = useRef({
    activeSignerSource,
    chainId,
    provider: activeSignerSource === 'metamask' ? activeProvider ?? browserWalletSession?.provider ?? null : null,
    providerKey:
      activeSignerSource === 'metamask'
        ? currentInjectedWalletOption?.id ?? browserWalletSession?.walletId ?? preferredBrowserWalletId
        : 'app-wallet',
    walletAddress
  });
  sharedWalletTransactionRuntimeRef.current = {
    activeSignerSource,
    chainId,
    provider: activeSignerSource === 'metamask' ? activeProvider ?? browserWalletSession?.provider ?? getConnectedProvider() : null,
    providerKey:
      activeSignerSource === 'metamask'
        ? currentInjectedWalletOption?.id ?? browserWalletSession?.walletId ?? preferredBrowserWalletId
        : 'app-wallet',
    walletAddress
  };
  const runSharedWalletTransactionFlow = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      const runtime = sharedWalletTransactionRuntimeRef.current;
      return runWalletTransactionFlow(
        {
          chainId: runtime.chainId,
          provider: runtime.activeSignerSource === 'metamask' ? runtime.provider : null,
          providerKey: runtime.providerKey,
          walletAddress: runtime.walletAddress
        },
        operation
      );
    },
    []
  );
  const activateBrowserWalletSessionGuarded = useCallback(
    async (
      walletId?: string,
      options?: Parameters<typeof activateBrowserWalletSession>[1]
    ) => {
      return runSharedWalletTransactionFlow(() => activateBrowserWalletSession(walletId, options));
    },
    [activateBrowserWalletSession, runSharedWalletTransactionFlow]
  );
  const {
    beginBurnerPinFlow,
    beginLinkExistingPinWallet,
    beginRevealBurnerBackup,
    bootstrapOwnerLinkedAccount,
    burnerAddress,
    burnerBalanceWei,
    burnerImportInput,
    burnerMnemonicBackup,
    burnerPinInput,
    burnerPinMode,
    burnerRecordRef,
    burnerStorageBlocked,
    burnerWalletRef,
    burnerWalletSelectionValue,
    burnerWallets,
    cancelRecoverySavePrompt,
    closeBurnerBackup,
    closeBurnerPinModal,
    confirmRecoverySavePrompt,
    checkingOwnerRecovery,
    importBurnerWallet,
    initializingBurner,
    isAppWalletRecoveryConfigured,
    linkBurnerRecoveryWithWallet,
    openChangeBurnerPin,
    ownerRecoveryError,
    recoverySavePrompt,
    recoverLinkedBurnerWallet,
    recoveringAppWallet,
    resetBurnerSession,
    savedBurnerWalletCount,
    setActiveRecoveryProfileAsDefault,
    setBurnerBalanceWei,
    setBurnerImportInput,
    setBurnerPinInput,
    setShowBurnerImportModal,
    setRecoverySavePromptMakeDefault,
    setTopUpMetricsNonce,
    setTopUpMessageTarget,
    showBurnerImportModal,
    showBurnerMnemonic,
    showBurnerPinModal,
    submitBurnerPinAndInitialize,
    switchActiveBurnerWallet,
    topUpBurnerWithWallet,
    topUpMetricsNonce,
    topUpMessageTarget
  } = useBurnerWallet({
    activeSignerSource,
    browserWalletSession,
    currentWalletKeyRef,
    ensureCotiNetwork,
    loadMyNicknameFromChainRef,
    preferredInjectedWalletOption,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    runPostConnectDataSyncUntilAppliedRef,
    schedulePostUnlockRefresh,
    sessionOnboardInfo,
    setActiveSignerSource,
    setChainId,
    setConnectedProvider,
    setConnectionMethod,
    setError,
    setMyNickname,
    setOnboardStatus,
    setSelectedInjectedWalletId,
    setSessionOnboardInfo,
    setStatus,
    setWalletAddress,
    topUpAmountWei,
    walletAddress
  });
  resetBurnerSessionRef.current = resetBurnerSession;
  const disconnectWallet = useCallback(async () => {
    const appWalletId = resolveRestorableAppWalletId({
      activeBurnerWalletId: burnerWalletSelectionValue,
      activeSignerSource,
      burnerWallets
    });

    await disconnectWalletSession();

    if (appWalletId) {
      await switchActiveBurnerWallet(appWalletId);
    }
  }, [
    activeSignerSource,
    burnerWalletSelectionValue,
    burnerWallets,
    disconnectWalletSession,
    switchActiveBurnerWallet
  ]);

  useEffect(() => {
    if (preferredBrowserWalletId) {
      setSelectedInjectedWalletId(preferredBrowserWalletId);
    }
  }, [preferredBrowserWalletId, setSelectedInjectedWalletId]);

  useEffect(() => {
    const prev = previousWalletAddressRef.current || '';
    const next = (walletAddress || '').trim();
    const prevKey = prev.toLowerCase();
    const nextKey = next.toLowerCase();
    const didConnect = !prev && Boolean(next);
    const didSwitchWallet = Boolean(prev) && Boolean(next) && prevKey !== nextKey;
    if (didConnect || didSwitchWallet) {
      beginConnectSoundSuppression();
    }
    if (prev && !next) {
      endConnectSoundSuppression();
    }
    previousWalletAddressRef.current = next;
  }, [beginConnectSoundSuppression, endConnectSoundSuppression, walletAddress]);

  useEffect(() => {
    messagesByGroupRef.current = messagesByGroup;
  }, [messagesByGroup]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    groupInvitesRef.current = groupInvites;
  }, [groupInvites]);

  useEffect(() => {
    activeContactRef.current = activeContact;
  }, [activeContact]);

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);
  useEffect(() => {
    setGeneratedGroupInviteCode('');
    setGeneratedGroupJoinCodeHash('');
  }, [activeGroupId, setGeneratedGroupInviteCode, setGeneratedGroupJoinCodeHash, walletAddress]);
  useEffect(() => {
    setGroupRenameOpen(false);
    setGroupRenameInput('');
  }, [activeGroupId, setGroupRenameInput, setGroupRenameOpen, walletAddress]);

  useEffect(() => {
    setMobileGroupOptionsOpen(false);
    setGroupInviteMenuView('invite');
  }, [activeGroupId, isMobileNav, setGroupInviteMenuView, setMobileGroupOptionsOpen, walletAddress]);

  const isConnected = walletAddress.length > 0;
  const onCotiNetwork = chainId === COTI_NETWORK.chainIdDecimal;
  const browserWalletLiteMode = activeSignerSource === 'metamask';
  const readStateFeaturesEnabled = activeSignerSource === 'burner';
  const browserWalletLiteModeTitle = 'Use the ChainWhisper account for this chat feature.';
  const directMessageMaxLength = browserWalletLiteMode ? BROWSER_WALLET_DIRECT_MESSAGE_MAX_LENGTH : MAX_MESSAGE_LENGTH;
  useEffect(() => {
    if (readStateFeaturesEnabled) {
      return;
    }

    unreadMapRef.current = {};
    unreadGroupMapRef.current = {};
    prevUnreadRef.current = {};
    prevUnreadGroupRef.current = {};
    lastReadByContactRef.current = {};
    lastReadByGroupRef.current = {};
    lastReadAllTsRef.current = 0;
    setUnreadMap({});
    setUnreadGroupMap({});
    setLastReadAllTs(0);
    setReplyingToMessage(null);
    setReactionPickerMessageId(null);
  }, [
    readStateFeaturesEnabled,
    setLastReadAllTs,
    setReactionPickerMessageId,
    setReplyingToMessage,
    setUnreadGroupMap,
    setUnreadMap
  ]);
  const {
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
  } = useActiveConversationState({
    activeContact,
    activeGroupId,
    contacts,
    conversationStateSyncPendingByContact,
    groupMessageLoadPhaseByGroup,
    linkedTradeContext,
    messagesByContact,
    messagesByGroup,
    walletAddress
  });
  const {
    activeGroupMemberCount,
    activeGroupMeta,
    activeGroupParticipants,
    activeGroupTipRecipients,
    canInviteToActiveGroup,
    canSubmitGroupRename,
    isActiveGroupAdmin,
    selectedGroupTipRecipient
  } = useActiveGroupThreadState({
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
  });
  const {
    activeThreadMessageReferenceLookup,
    activeThreadReactions,
    getReactionsForMessage,
    isReactionOnlyMessage
  } = useMessageReactions({
    activeContact,
    activeGroupId,
    activeThreadMessages,
    walletAddress
  });
  const {
    contactGroupPanelRatio,
    contactsListEmptyMessage,
    hasUnreadConversations,
    hiddenContactsCount,
    hiddenContactsLabel,
    sortedGroupInvites,
    sortedGroups,
    visibleSortedContacts
  } = useConversationSidebarState({
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
  });
  const {
    canManageActiveGroupJoinCodes,
    hasAesReady,
    ownerAesKey,
    ownerAesReady,
    ownerWalletAddress,
    readableWalletAccountKeys,
    readableWalletAccounts,
    walletAccountScope
  } = useWalletReadiness({
    activeGroupId,
    activeSignerSource,
    browserWalletAddress: browserWalletSession?.address,
    chainId,
    isActiveGroupAdmin,
    sessionOnboardInfo,
    walletAddress,
    walletAesHealthByAddress
  });
  useEffect(() => {
    if (!canManageActiveGroupJoinCodes && groupInviteMenuView !== 'invite') {
      setGroupInviteMenuView('invite');
    }
  }, [canManageActiveGroupJoinCodes, groupInviteMenuView]);
  const {
    ownerCustomTradeTokenInfoByAddress,
    ownerLegacyPrivateRewardTokenBalanceWei,
    ownerNativeBalanceWei,
    ownerPrivateRewardBalanceLocked,
    ownerPrivateRewardTokenBalanceWei,
    ownerRewardTokenBalanceWei,
    ownerTokenBalancesLoading
  } = useOwnerWalletBalances({
    browserProvider: browserWalletSession?.provider ?? null,
    chainId,
    getConnectedProvider,
    ownerAesKey,
    ownerAesReady,
    ownerWalletAddress,
    refreshNonce: topUpMetricsNonce
  });
  const hasChainWhisperWispAccount = Boolean(walletAddress && isWalletAddress(walletAddress));
  const hasOwnerWispAccount = Boolean(ownerWalletAddress && isWalletAddress(ownerWalletAddress));
  const showWispPortalAccountTabs =
    hasChainWhisperWispAccount &&
    hasOwnerWispAccount &&
    walletAddress.trim().toLowerCase() !== ownerWalletAddress.trim().toLowerCase();

  useEffect(() => {
    if (privacyPortalAccount === 'chainwhisper' && !hasChainWhisperWispAccount && hasOwnerWispAccount) {
      setPrivacyPortalAccount('owner');
    } else if (privacyPortalAccount === 'owner' && (!hasOwnerWispAccount || hasChainWhisperWispAccount && !showWispPortalAccountTabs)) {
      setPrivacyPortalAccount('chainwhisper');
    }
  }, [hasChainWhisperWispAccount, hasOwnerWispAccount, privacyPortalAccount, showWispPortalAccountTabs]);

  const selectedWispPortalAccount =
    privacyPortalAccount === 'owner' && hasOwnerWispAccount ? 'owner' : 'chainwhisper';
  const wispPortalUsesOwner = selectedWispPortalAccount === 'owner';
  const wispPortalWalletAddress = wispPortalUsesOwner ? ownerWalletAddress : walletAddress;
  const wispPortalHasAesReady = wispPortalUsesOwner ? ownerAesReady : hasAesReady;
  const selectedPrivacyPair = getPrivacyTokenPair(selectedPrivacyPairId) ?? PRIVACY_TOKEN_PAIRS[0];
  const wispPortalLoadingRewardBalances = wispPortalUsesOwner ? ownerTokenBalancesLoading : loadingRewardBalances;
  const wispPortalRewardTokenBalanceWei = wispPortalUsesOwner ? ownerRewardTokenBalanceWei : rewardTokenBalanceWei;
  const wispPortalPrivateRewardTokenBalanceWei = wispPortalUsesOwner
    ? ownerPrivateRewardTokenBalanceWei
    : privateRewardTokenBalanceWei;
  const wispPortalLegacyPrivateRewardTokenBalanceWei = wispPortalUsesOwner
    ? ownerLegacyPrivateRewardTokenBalanceWei
    : legacyPrivateRewardTokenBalanceWei;
  const hasSavedBurnerWallet = savedBurnerWalletCount > 0;
  const {
    bootstrapOwnerRecoveryOnce,
    resetOwnerRecoveryAttempt
  } = useOwnerRecoveryBootstrap({
    allowStartupWalletRestore,
    beginBurnerPinFlow,
    bootstrapOwnerLinkedAccount,
    burnerWalletRef,
    chainId,
    connectingMethod,
    initializingBurner,
    ownerAesKey,
    ownerAesReady,
    ownerWalletAddress,
    recoveringAppWallet,
    showBurnerImportModal,
    showBurnerPinModal
  });
  const {
    findBurnerWalletDefaultNameForAddress,
    findContactNameForWalletAddress,
    getBurnerWalletDisplayName,
    handleSwitchActiveBurnerWallet
  } = useBurnerWalletDisplay({
    activeSignerSource,
    burnerWallets,
    contacts,
    myNickname,
    onChainNicknameCacheRef,
    switchActiveBurnerWallet,
    walletAddress
  });
  const {
    activeSwapVaultContractAddress,
    legacySwapVaultContractUrl,
    wispBridgeContractUrl,
    canLegacyUnshieldTokens,
    canShieldTokens,
    canSwapRewardTokens,
    canUnshieldTokens,
    currentSwapDirectionEnabled,
    swapButtonLabel,
    swapInputDecimals,
    swapInputSymbol,
    swapPrivateRewardTokenBalanceWei,
    swapPrivateRewardTokenDecimals,
    swapPrivateRewardTokenSymbol
  } = useTokenSwapViewModel({
    hasAesReady: wispPortalHasAesReady,
    legacyPrivateRewardTokenBalanceWei: wispPortalLegacyPrivateRewardTokenBalanceWei,
    legacyPrivateRewardTokenDecimals,
    legacyPrivateRewardTokenSymbol,
    loadingRewardBalances: wispPortalLoadingRewardBalances,
    onCotiNetwork,
    privateRewardTokenBalanceWei: wispPortalPrivateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei: wispPortalRewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    setSwapDirection,
    swapAmountInput,
    swapDirection,
    swappingTokens,
    walletAddress: wispPortalWalletAddress
  });

  const {
    getChainWhisperFundsSigner,
    getOwnerFundsSigner,
    runOwnerFundsTransactionFlow
  } = useAccountFundsSigners({
    browserWalletSession,
    burnerWalletRef,
    chainId,
    currentInjectedWalletOption,
    ensureCotiNetwork,
    getConnectedProvider,
    ownerAesKey,
    ownerWalletAddress,
    preferredBrowserWalletId,
    resolveWalletPromptProvider,
    sessionOnboardInfo,
    setChainId,
    setOnboardStatus,
    setSessionOnboardInfo,
    setWalletAesHealth,
    signerCacheRef,
    signerProviderCacheRef
  });
  const {
    accountFundsDirection,
    accountFundsProcessing,
    clearAccountFundsModal,
    closeAccountFundsModal,
    openAccountFundsModal,
    requestChainWhisperFundingAfterError,
    submitAccountFundsTransfer
  } = useAccountFundsTransfer({
    burnerAddress,
    getChainWhisperFundsSigner,
    getOwnerFundsSigner,
    onRefreshBalances: () => setTopUpMetricsNonce((previous) => previous + 1),
    ownerWalletAddress,
    runOwnerFundsTransactionFlow,
    runSharedWalletTransactionFlow,
    setError,
    setStatus
  });
  const {
    accountFundsAssets,
    estimatedMessagesLeft,
    topUpAmountLabel
  } = useAccountFundsViewModel({
    burnerAddress,
    burnerBalanceWei,
    chainwhisperCustomTokenInfoByAddress: customTradeTokenInfoByAddress,
    chainwhisperHasAesReady: hasAesReady,
    estimatedCotiPerMessageWei: BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI,
    ownerAesReady,
    ownerCustomTokenInfoByAddress: ownerCustomTradeTokenInfoByAddress,
    ownerNativeBalanceWei,
    ownerPrivateRewardBalanceLocked,
    ownerPrivateRewardTokenBalanceWei,
    ownerRewardTokenBalanceWei,
    ownerWalletAddress,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    topUpAmountWei,
    walletAddress
  });
  const {
    activeTipTokenSymbol,
    canSendGroupTipFromComposer,
    canSendTipFromComposer,
    tipAmountExceedsBalance,
    tipAmountSummaryLabel,
    tipAmountWeiFromInput,
    tipBalanceSummaryLabel
  } = useTipComposerState({
    activeContact,
    activeGroupId,
    hasSelectedGroupTipRecipient: Boolean(selectedGroupTipRecipient),
    isSelfChat,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    sending,
    sendingGroupMessage,
    tipAmountInput,
    tipNativeBalanceWei,
    tipping,
    tipTokenSelection
  });
  const normalizedTradeOfferCustomTokenAddress = tradeOfferCustomTokenAddress.trim();
  const normalizedTradeRequestCustomTokenAddress = tradeRequestCustomTokenAddress.trim();
  const tradeCustomOfferTokenKind =
    resolveTradePresetKind(tradeOfferTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20';
  const tradeCustomRequestTokenKind =
    resolveTradePresetKind(tradeRequestTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20';
  const {
    selectedTradeOfferToken,
    selectedTradeRequestToken,
    parsedTradeOfferAmountWei,
    parsedTradeRequestAmountWei,
    tradeTokenOptions,
    tradeComposerFieldErrors,
    tradeComposerValidationMessage,
    canSendTradeOffer,
    tradeOfferAmountSummaryLabel,
    tradeRequestAmountSummaryLabel,
    tradeOfferBalanceSummaryLabel,
    tradeOfferAmountLabel,
    tradeRequestAmountLabel,
    tradeOfferAmountPlaceholder,
    tradeRequestAmountPlaceholder,
    tradeOfferVerifyUrl,
    tradeRequestVerifyUrl,
    parsedTradeExpiryHours,
    tradeOfferMaxInputValue,
    canUseTradeOfferMax,
    tradePreviewLabel,
    tradeRateLabel,
    tradeReverseRateLabel,
    tradeFeeSummaryLabel,
    tradeOfferCustomMetaLabel,
    tradeRequestCustomMetaLabel
  } = useMemo(
    () =>
      deriveTradeComposerModel({
        activeContact,
        walletAddress,
        isSelfChat,
        onCotiNetwork,
        creatingTrade,
        sending,
        tipping,
        tradeFeeModeSelection,
        tradeOfferTokenSelection,
        tradeRequestTokenSelection,
        tradeOfferCustomTokenAddress,
        tradeRequestCustomTokenAddress,
        tradeCustomOfferTokenKind,
        tradeCustomRequestTokenKind,
        customTradeTokenInfoByAddress,
        tradeOfferAmountInput,
        tradeRequestAmountInput,
        tradeExpiryHoursInput,
        tradeHidePrivateLiquidity: false,
        hiddenLiquidityUnavailableMessage: '',
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        tipNativeBalanceWei,
        rewardTokenBalanceWei,
        privateRewardTokenBalanceWei,
        tradeRequiredFeeWei,
        counterpartyRequired: true,
        missingCounterpartyMessage: 'Select a contact first.',
        selfTradeMessage: 'OTC Desk offers are only available in private chats with another wallet.'
      }),
    [
      activeContact,
      walletAddress,
      isSelfChat,
      onCotiNetwork,
      creatingTrade,
      sending,
      tipping,
      tradeFeeModeSelection,
      tradeOfferTokenSelection,
      tradeRequestTokenSelection,
      tradeOfferCustomTokenAddress,
      tradeRequestCustomTokenAddress,
      tradeCustomOfferTokenKind,
      tradeCustomRequestTokenKind,
      customTradeTokenInfoByAddress,
      tradeOfferAmountInput,
      tradeRequestAmountInput,
      tradeExpiryHoursInput,
      rewardTokenSymbol,
      rewardTokenDecimals,
      privateRewardTokenSymbol,
      privateRewardTokenDecimals,
      tipNativeBalanceWei,
      rewardTokenBalanceWei,
      privateRewardTokenBalanceWei,
      tradeRequiredFeeWei
    ]
  );
  useActiveTradeOfferSnapshots({
    activeMessages,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    setTradeSnapshotsById
  });
  useEffect(() => {
    setTradeComposerOpen(false);
    setTradeOfferAmountInput('');
    setTradeRequestAmountInput('');
    setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
    setTradeHidePrivateLiquidity(false);
    setTradeCounterParentId(null);
    setTradeCounterContext(null);
  }, [
    activeContact,
    setTradeComposerOpen,
    setTradeCounterContext,
    setTradeCounterParentId,
    setTradeExpiryHoursInput,
    setTradeHidePrivateLiquidity,
    setTradeOfferAmountInput,
    setTradeRequestAmountInput
  ]);
  useTradeCustomTokenInfoLoader({
    chainId,
    getMemoSignerRef,
    hasAesReady,
    normalizedTradeOfferCustomTokenAddress,
    normalizedTradeRequestCustomTokenAddress,
    setCustomTradeTokenInfoByAddress,
    setSessionOnboardInfo,
    topUpMetricsNonce,
    tradeCustomOfferTokenKind,
    tradeCustomRequestTokenKind,
    tradeOfferTokenSelection,
    tradeRequestTokenSelection,
    walletAddress
  });
  const showGroupRemovalNotice = useCallback((message: string) => {
    setError(message);
    if (groupRemovalNoticeTimeoutRef.current !== null) {
      window.clearTimeout(groupRemovalNoticeTimeoutRef.current);
    }

    groupRemovalNoticeTimeoutRef.current = window.setTimeout(() => {
      groupRemovalNoticeTimeoutRef.current = null;
      setError((previous) => (previous === message ? '' : previous));
    }, GROUP_REMOVAL_NOTICE_AUTO_DISMISS_MS);
  }, []);

  const activeComposerMaxMessageLength = activeGroupId !== null ? MAX_MESSAGE_LENGTH : directMessageMaxLength;
  const handleMessageInputChange = useCallback((value: string) => {
    setMessageInput(sanitizeOutgoingMessagePlainText(value).slice(0, activeComposerMaxMessageLength));
  }, [activeComposerMaxMessageLength, setMessageInput]);
  const {
    directComposerPromptEstimate,
    tradeComposerPromptEstimate
  } = useDirectComposerPromptEstimates({
    activeContact,
    activeGroupId,
    activeLinkedTradeContext,
    browserWalletLiteMode,
    messageInput,
    parsedTradeExpiryHours,
    tradeComposerOpen,
    tradeCounterParentId,
    walletAddress
  });

  const {
    markAllConversationsAsRead,
    markConversationAsRead,
    markGroupConversationAsRead
  } = useConversationReadStateActions({
    activeContact,
    activeGroupId,
    groups,
    groupsRef,
    lastReadAllTsRef,
    lastReadByContactRef,
    lastReadByGroupRef,
    messagesByContact,
    messagesByGroup,
    prevUnreadGroupRef,
    prevUnreadRef,
    readStateFeaturesEnabled,
    setLastReadAllTs,
    setUnreadGroupMap,
    setUnreadMap,
    unreadGroupMapRef,
    unreadMapRef,
    walletAddress
  });

  const activateContact = useCallback((contactAddress: string) => {
    activeGroupIdRef.current = null;
    setActiveGroupId(null);
    setActiveContact(contactAddress);
    markConversationAsRead(contactAddress);
    if (isMobileNav) {
      setActiveMobileView('chat');
    }
  }, [isMobileNav, markConversationAsRead, setActiveMobileView]);

  const {
    decryptMemoPlaintextWithRecovery,
    encodeMemoForActiveSigner,
    getMemoSigner,
    getMemoSignerForAccount,
    parseEncryptedChatMessagePayload
  } = useChatMemoCrypto({
    activeSignerSource,
    browserWalletProvider: browserWalletSession?.provider,
    burnerWalletRef,
    chainId,
    encodeMemoForActiveSignerRef,
    getConnectedProvider,
    getMemoSignerRef,
    memoAesRecoveryAttemptedRef,
    ownerWalletAddress,
    sessionOnboardInfo,
    setOnboardStatus,
    setSessionOnboardInfo,
    setWalletAesHealth,
    signerCacheRef,
    signerProviderCacheRef,
    walletAddress,
    walletAesHealthByAddress
  });
  const getWispPortalSwapSigner = useCallback(async () => {
    if (wispPortalUsesOwner) {
      const signer = await getOwnerFundsSigner(true);
      return {
        signer,
        cacheKey: ownerWalletAddress.trim().toLowerCase()
      };
    }

    return getMemoSigner();
  }, [getMemoSigner, getOwnerFundsSigner, ownerWalletAddress, wispPortalUsesOwner]);
  const runWispPortalSwapTransactionFlow = wispPortalUsesOwner
    ? runOwnerFundsTransactionFlow
    : runSharedWalletTransactionFlow;
  const privacyPortal = usePrivacyPortal({
    amountInput: privacyAmountInput,
    direction: privacyDirection,
    enabled: activePage === 'swap' && !privacyRecoveryOpen,
    getPrivacySigner: getWispPortalSwapSigner,
    hasAesReady: wispPortalHasAesReady,
    onCotiNetwork,
    pair: selectedPrivacyPair,
    runTransactionFlow: runWispPortalSwapTransactionFlow,
    setAmountInput: setPrivacyAmountInput,
    setSessionOnboardInfo,
    walletAddress: wispPortalWalletAddress
  });
  const privacyPortalView = usePrivacyPortalViewModel({
    actionStage: privacyPortal.actionStage,
    amountInput: privacyAmountInput,
    direction: privacyDirection,
    hasAesReady: wispPortalHasAesReady,
    loading: privacyPortal.loading,
    metrics: privacyPortal.metrics,
    onCotiNetwork,
    pair: selectedPrivacyPair,
    quote: privacyPortal.quote,
    walletAddress: wispPortalWalletAddress
  });
  const { swapRewardTokens } = useTokenSwapActions({
    activeSwapVaultContractAddress,
    currentSwapDirectionEnabled,
    getSwapSigner: getWispPortalSwapSigner,
    onCotiNetwork,
    runSwapTransactionFlow: runWispPortalSwapTransactionFlow,
    setError,
    setSessionOnboardInfo,
    setTopUpMetricsNonce,
    swapAmountInput,
    swapDirection,
    swapFeeWei,
    swapInputDecimals,
    swapInputSymbol,
    swapPrivateRewardTokenBalanceWei,
    swapPrivateRewardTokenDecimals,
    swapPrivateRewardTokenSymbol,
    swapTokenFeeAmount,
    walletAddress: wispPortalWalletAddress
  });
  const wispMaxBalanceWei = swapDirection === 'shield'
    ? wispPortalRewardTokenBalanceWei
    : swapPrivateRewardTokenBalanceWei;
  const wispCurrentPrivateTokenSymbol = privateRewardTokenSymbol.replace(/^p\.WISP$/i, 'pWISP');
  const wispInputBalanceSymbol = swapDirection === 'unshield'
    ? wispCurrentPrivateTokenSymbol
    : swapInputSymbol;
  const wispInputUsesPrivateBalance = swapDirection !== 'shield';
  const wispInputBalanceLabel = wispInputUsesPrivateBalance && !wispPortalHasAesReady
    ? 'Locked'
    : wispMaxBalanceWei === null
      ? wispPortalLoadingRewardBalances
        ? 'Loading…'
        : 'Unavailable'
      : `${formatTokenAmount(wispMaxBalanceWei, swapInputDecimals, 6)} ${wispInputBalanceSymbol}`;
  const wispOutputBalanceWei = swapDirection === 'shield'
    ? wispPortalPrivateRewardTokenBalanceWei
    : wispPortalRewardTokenBalanceWei;
  const wispOutputBalanceDecimals = swapDirection === 'shield'
    ? privateRewardTokenDecimals
    : rewardTokenDecimals;
  const wispOutputBalanceSymbol = swapDirection === 'shield'
    ? wispCurrentPrivateTokenSymbol
    : rewardTokenSymbol;
  const wispOutputUsesPrivateBalance = swapDirection === 'shield';
  const wispOutputBalanceLabel = wispOutputUsesPrivateBalance && !wispPortalHasAesReady
    ? 'Locked'
    : wispOutputBalanceWei === null
      ? wispPortalLoadingRewardBalances
        ? 'Loading…'
        : 'Unavailable'
      : `${formatTokenAmount(wispOutputBalanceWei, wispOutputBalanceDecimals, 6)} ${wispOutputBalanceSymbol}`;
  const wispMaxDisabled =
    swappingTokens ||
    wispPortalLoadingRewardBalances ||
    wispMaxBalanceWei === null ||
    (wispInputUsesPrivateBalance && !wispPortalHasAesReady) ||
    (swapDirection !== 'shield' && shieldVaultTokenBalanceWei === null);
  const handleWispMaxAmount = useCallback(() => {
    if (wispMaxBalanceWei === null) {
      setError('Unable to read the selected WISP balance. Refresh and try again.');
      return;
    }
    const maxAmountWei = swapDirection === 'shield' || shieldVaultTokenBalanceWei === null
      ? wispMaxBalanceWei
      : wispMaxBalanceWei < shieldVaultTokenBalanceWei
        ? wispMaxBalanceWei
        : shieldVaultTokenBalanceWei;
    setError('');
    setSwapAmountInput(formatTokenAmount(maxAmountWei, swapInputDecimals, swapInputDecimals));
  }, [
    setSwapAmountInput,
    shieldVaultTokenBalanceWei,
    swapDirection,
    swapInputDecimals,
    wispMaxBalanceWei
  ]);

  const {
    groupRequiredFeeCacheRef,
    groupTokenFeeCacheRef,
    resetGroupFeeCaches,
    resolveGroupSubmitSelector,
    resolveRequiredFeeForGroupSend,
    resolveRequiredFeeForSend,
    resolveRequiredFeeForSendRef,
    resolveRequiredFeeForTradeCreate,
    resolveRequiredTokenFeeForGroupSend,
    resolveSubmitSelector,
    resolveSubmitSelectorRef
  } = useAppFeeResolvers({
    requiredFeeWei,
    setRequiredFeeWei,
    setTradeRequiredFeeWei
  });

  const {
    fetchOnChainNicknames,
    getNicknameMaxLength,
    loadMyNicknameFromChain,
    resolveConversationBlockRange,
    resolveConversationBlockRangeRef,
    resolveTradeSnapshotForOffer,
    saveMyNicknameOnChain
  } = useAppChainLookups({
    getMemoSigner,
    loadMyNicknameFromChainRef,
    myNickname,
    nicknameMaxBytes,
    onChainNicknameCacheRef,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    runSharedWalletTransactionFlow,
    setContacts,
    setError,
    setMyNickname,
    setNicknameMaxBytes,
    setSessionOnboardInfo,
    setTradeSnapshotsById,
    tradeSnapshotsById,
    walletAddress
  });
  const {
    applyStateBackupPayload,
    backupLocalStateToSelf,
    clearCachedStateBackupMemo: clearCachedStateBackupMemoImpl,
    lastAutoBackupAttemptBlockRef,
    lastStateBackupBlockRef,
    runPostConnectDataSyncUntilApplied
  } = useStateBackupSync({
    beginConnectSoundSuppression,
    chainId,
    currentWalletKeyRef,
    encodeMemoForActiveSignerRef,
    endConnectSoundSuppression,
    getMemoSignerRef,
    hasAesReady,
    lastReadAllTs,
    lastReadAllTsRef,
    postConnectDataSyncRunIdRef,
    readStateSyncEnabled: readStateFeaturesEnabled,
    resolveConversationBlockRangeRef,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    resolveRequiredFeeForSendRef,
    resolveSubmitSelectorRef,
    setLastReadAllTs,
    setSessionOnboardInfo,
    setUnreadGroupMap,
    setUnreadMap,
    unreadGroupMapRef,
    unreadMapRef,
    walletAddress
  });
  clearCachedStateBackupMemoRef.current = clearCachedStateBackupMemoImpl;
  runPostConnectDataSyncUntilAppliedRef.current = runPostConnectDataSyncUntilApplied;

  const {
    isSyncingConversationHistoryRef,
    loadFullConversationHistory,
    loadOlderMessagesForActiveContact,
    resetConversationHistoryCaches,
    syncConversationHistory
  } = useDirectConversationSync({
    activeContact,
    activeGroupId,
    activeMessagesLength: activeMessages.length,
    applyStateBackupPayload,
    backupLocalStateToSelf,
    chainId,
    contacts,
    currentWalletKeyRef,
    decryptMemoPlaintextWithRecovery,
    fetchOnChainNicknames,
    getMemoSigner,
    getMemoSignerForAccount,
    hasAesReady,
    lastAutoBackupAttemptBlockRef,
    lastReadAllTsRef,
    lastReadByContactRef,
    lastStateBackupBlockRef,
    messagesByContact,
    notificationSuppressedContactAddressSet,
    parseEncryptedChatMessagePayload,
    pinnedContactStateRef,
    readStateFeaturesEnabled,
    resolveBlockTimestampMap,
    resolveConversationBlockRange,
    setContacts,
    setError,
    setLoadingOlderHistory,
    setMessagesByContact,
    setSessionOnboardInfo,
    setSyncingHistory,
    setUnreadMap,
    unreadMapRef,
    walletAddress,
    readAccounts: readableWalletAccounts
  });

  useEffect(() => {
    syncConversationHistoryRef.current = syncConversationHistory;
  }, [syncConversationHistory]);
  useDirectConversationRealtimeSync({
    activeContactRef,
    chainId,
    conversationDeepBackfillDoneRef,
    isSyncingConversationHistoryRef,
    onChainNicknameCacheRef,
    readableWalletAccountKeys,
    readableWalletAccounts,
    setContacts,
    setDirectRealtimeStatus,
    setMyNickname,
    syncConversationHistoryRef,
    walletAddress
  });
  const {
    chatMessagesRef: setChatMessagesContainerRef,
    getReplyReferenceFallbackLabel,
    jumpToReferencedMessage,
    messageElementRefs,
    pendingForcedBottomAnchorThreadKeyRef,
    resetThreadScrollState,
    stickToBottomRef,
    visibleActiveGroupMessages,
    visibleActiveMessages
  } = useChatThreadScroll({
    activeContact,
    activeGroupId,
    activeGroupMessages,
    activeMessages,
    activeThreadKey,
    activeThreadLastMessageId,
    activeThreadMessages,
    hasAesReady,
    isConnected,
    loadOlderMessagesForActiveContact,
    setHighlightedMessageId,
    walletAddress
  });
  const {
    activateGroup,
    prefetchGroupBeforeOpen,
    syncGroupData
  } = useGroupDataSync({
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
  });
  useGroupRealtimeSync({
    activeGroupIdRef,
    chainId,
    groupInvitesRef,
    groupsRef,
    hasAesReady,
    setGroupRealtimeStatus,
    syncGroupDataInFlightRef,
    syncGroupDataRef,
    walletAddress
  });

  const {
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
  } = useGroupAdminActions({
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
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
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
    syncGroupData,
    walletAddress
  });
  const { sendGroupImageMessage, sendGroupMessage } = useGroupMessageActions({
    activeGroupId,
    activeGroupIdRef,
    browserWalletLiteMode,
    clearImageAttachmentStatus,
    currentWalletKeyRef,
    encodeMemoForActiveSigner,
    getMemoSigner,
    groupFeeModeSelection,
    messageInput,
    privateRewardTokenBalanceWei,
    replyingToMessage,
    resolveGroupSubmitSelector,
    resolveRequiredFeeForGroupSend,
    resolveRequiredTokenFeeForGroupSend,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    sendingGroupMessage,
    setError,
    setMessageInput,
    setMessagesByGroup,
    setReplyingToMessage,
    setSendingGroupMessage,
    setSessionOnboardInfo,
    setTopUpMetricsNonce,
    setUploadingImage,
    showImageAttachmentStatus,
    syncGroupData,
    uploadingImage,
    walletAddress
  });
  const { syncContactNameAliasFromInput, syncConversationStateFromInput } = useConversationPreferenceActions({
    activeSignerSource,
    browserWalletLiteMode,
    chainId,
    encodeMemoForActiveSigner,
    getMemoSigner,
    hasAesReady,
    requestChainWhisperFundingAfterError,
    resolveRequiredFeeForSend,
    resolveSubmitSelector,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    setError,
    setSessionOnboardInfo,
    setTopUpMetricsNonce,
    syncConversationHistory,
    walletAddress
  });
  const {
    cancelRenameContact,
    handleAddContact,
    removeContact,
    saveRenamedContact,
    startRenameContact,
    toggleConversationMuteForContact
  } = useContactActions({
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
  });
  const { sendReactionToMessage } = useMessageReactionActions({
    activeContact,
    activeGroupId,
    activeSignerSource,
    activeThreadMessageReferenceLookup,
    activeThreadReactions,
    browserWalletLiteMode,
    currentWalletKeyRef,
    encodeMemoForActiveSigner,
    getMemoSigner,
    groupFeeModeSelection,
    privateRewardTokenBalanceWei,
    requestChainWhisperFundingAfterError,
    resolveGroupSubmitSelector,
    resolveRequiredFeeForGroupSend,
    resolveRequiredFeeForSend,
    resolveRequiredTokenFeeForGroupSend,
    resolveSubmitSelector,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    sendingReaction,
    setError,
    setMessagesByContact,
    setMessagesByGroup,
    setReactionPickerMessageId,
    setSendingReaction,
    setSessionOnboardInfo,
    setTopUpMetricsNonce,
    syncConversationHistory,
    syncGroupData,
    walletAddress
  });

  const {
    preflightDirectMessageSend,
    sendDirectImageMessage,
    sendMessage,
    sendTipToActiveContact,
    sendTipToActiveGroupMember
  } = useDirectMessageActions({
    activeContact,
    activeContactRef,
    activeLinkedTradeContext,
    activeMessages,
    activeSignerSource,
    browserWalletLiteMode,
    clearImageAttachmentStatus,
    currentWalletKeyRef,
    directMessageMaxLength,
    encodeMemoForActiveSigner,
    getMemoSigner,
    getMemoSignerForAccount,
    groupTipRecipientAddress,
    messageInput,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    replyingToMessage,
    requestChainWhisperFundingAfterError,
    resolveRequiredFeeForSend,
    resolveSubmitSelector,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    sendingRef,
    setError,
    setMessageInput,
    setMessagesByContact,
    setPrivateRewardTokenBalanceWei,
    setReplyingToMessage,
    setRewardTokenBalanceWei,
    setSending,
    setSessionOnboardInfo,
    setTipAmountInput,
    setTipNativeBalanceWei,
    setTipping,
    setTopUpMetricsNonce,
    setUploadingImage,
    showImageAttachmentStatus,
    syncConversationHistory,
    tipNativeBalanceWei,
    tipping,
    uploadingImage,
    walletAddress,
    walletReadAccounts: readableWalletAccounts
  });
  const sendMessageForSideEffects = useCallback(async (...args: Parameters<typeof sendMessage>) => {
    await sendMessage(...args);
  }, [sendMessage]);

  const {
    acceptTradeOffer,
    cancelTradeOffer,
    createTradeOffer,
    declineTradeOffer,
    prepareCounterTrade
  } = useInChatTradeActions({
    activeContact,
    activeSignerSource,
    creatingTrade,
    currentWalletKeyRef,
    getMemoSigner,
    parsedTradeExpiryHours,
    parsedTradeOfferAmountWei,
    parsedTradeRequestAmountWei,
    processingTradeActionId,
    onRequestAccountFunding: requestChainWhisperFundingAfterError,
    preflightDirectMessageSend,
    replyingToMessage,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    resolveRequiredFeeForTradeCreate,
    resolveTradeSnapshotForOffer,
    selectedTradeOfferToken,
    selectedTradeRequestToken,
    sendMessage: sendMessageForSideEffects,
    sendingRef,
    setCreatingTrade,
    setError,
    setProcessingTradeActionId,
    setReplyingToMessage,
    setSessionOnboardInfo,
    setTipComposerOpen,
    setTopUpMetricsNonce,
    setTradeComposerOpen,
    setTradeCounterContext,
    setTradeCounterParentId,
    setTradeExpiryHoursInput,
    setTradeHidePrivateLiquidity,
    setTradeOfferAmountInput,
    setTradeOfferCustomTokenAddress,
    setTradeOfferTokenSelection,
    setTradeRequestAmountInput,
    setTradeRequestCustomTokenAddress,
    setTradeRequestTokenSelection,
    setTradeSnapshotsById,
    tipping,
    tradeComposerValidationMessage,
    tradeCounterContext,
    tradeCounterParentId,
    walletAddress
  });

  const forceSyncAllData = async () => {
    if (!walletAddress || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    syncConversationHistory({ deep: true }).catch(() => {});
    syncGroupData({ deep: true }).catch(() => {});
  };

  useEffect(() => {
    setContacts([]);
    setConversationStateSyncPendingByContact({});
    setPersistedContactOrder([]);
    setActiveContact(null);
    setShowHiddenContacts(false);
  }, [walletAddress]);

  useEffect(() => {
    setGroups([]);
    setGroupInvites([]);
    setActiveGroupId(null);
    setActiveGroupJoinCodes([]);
    setLoadingActiveGroupJoinCodes(false);
    setRevokingGroupJoinCodeHash('');
    setMessagesByGroup({});
    memoAesRecoveryAttemptedRef.current = {};
    messagesByGroupRef.current = {};
    groupMessageLoadPhaseByGroupRef.current = {};
    prefetchedGroupMessagesRef.current = {};
    setGroupMessageLoadPhaseByGroup({});
    setGeneratedGroupInviteCode('');
    setGeneratedGroupJoinCodeHash('');
    setGroupJoinCodeInput('');
    setGroupJoinCodeMode('single');
    setGroupJoinCodeMaxUsesInput(String(DEFAULT_GROUP_JOIN_CODE_MULTI_USES));
    groupsRef.current = [];
    groupInvitesRef.current = [];
    activeGroupIdRef.current = null;
    groupOverviewLastSyncedBlockRef.current = {};
    groupMessageLastSyncedBlockRef.current = {};
    groupRemovalNoticeSeenRef.current = {};
    conversationDeepBackfillDoneRef.current = {};
    groupDeepBackfillDoneRef.current = {};
    resetGroupFeeCaches();
    setGroupRewardsContractAddress('');
    setGroupRewardsPaused(null);
    setRewardsContractPaused(null);
    setRewardsCallerAllowed(null);
    setRewardsPublicPerInteractionWei(null);
    setRewardsPublicReserveWei(null);
    setRewardTokenBalanceWei(null);
    setPrivateRewardTokenBalanceWei(null);
    setSwapFeeWei(null);
    setSwapTokenFeeAmount(null);
    setSwapAmountInput('');
    setGroupFeeModeSelection('coti');
  }, [resetGroupFeeCaches, walletAddress]);

  useEffect(() => {
    let cancelled = false;

    const hydrateNickname = async () => {
      if (!walletAddress || !isWalletAddress(walletAddress)) {
        if (!cancelled) {
          setMyNickname('');
        }
        return;
      }

      getNicknameMaxLength().catch(() => {});

      try {
        const resolvedNickname = await loadMyNicknameFromChain(walletAddress);
        if (!cancelled) {
          setMyNickname(resolvedNickname);
        }
      } catch {
        if (!cancelled) {
          setMyNickname('');
        }
      }
    };

    hydrateNickname().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (!nicknameEditorRef.current) {
      return;
    }

    const nextValue = myNickname;
    if ((nicknameEditorRef.current.textContent ?? '') !== nextValue) {
      nicknameEditorRef.current.textContent = nextValue;
    }
  }, [myNickname]);

  useEffect(() => {
    if (!contacts.length) {
      setActiveContact(null);
      return;
    }

    if (!activeContact) {
      return;
    }

    const activeContactRecord = contacts.find(
      (contact) => contact.address.toLowerCase() === activeContact.toLowerCase()
    );
    if (!activeContactRecord) {
      setActiveContact(null);
      return;
    }

    const shouldBeVisibleInCurrentMode = showHiddenContacts
      ? !!activeContactRecord.hidden
      : !activeContactRecord.hidden;
    if (!shouldBeVisibleInCurrentMode) {
      setActiveContact(null);
    }
  }, [contacts, activeContact, showHiddenContacts]);

  useEffect(() => {
    let nextOnboardStatus = 'Signature required';
    if (!walletAddress) {
      nextOnboardStatus = 'Not onboarded';
    } else {
      const cachedOnboardInfo = sessionOnboardInfo[walletAddress.toLowerCase()];
      if (cachedOnboardInfo?.aesKey) {
        nextOnboardStatus = 'Privacy ready';
      }
    }

    if (onboardStatus !== nextOnboardStatus) {
      setOnboardStatus(nextOnboardStatus);
    }
  }, [onboardStatus, walletAddress, sessionOnboardInfo, setOnboardStatus]);

  useEffect(() => {
    if (!isConnected) {
      setActiveMobileView('contacts');
    }
  }, [isConnected]);

  const { navigateToInternalAppLink, navigateToPage } = useAppNavigation({ activePage, setActivePage });

  const openAppHelp = useCallback(
    ({
      origin,
      reason,
      topicId
    }: {
      origin: AppHelpOrigin;
      reason?: AppHelpReason;
      topicId?: string;
    }) => {
      const normalized = normalizeAppHelpLaunchContext({
        origin,
        reason,
        topicId: topicId || (reason ? getAppHelpReadinessTopicId(reason) : undefined)
      });
      if (!normalized) {
        return;
      }
      setAppHelpLaunchContext(normalized);
      navigateToInternalAppLink('/otc/agent');
    },
    [navigateToInternalAppLink]
  );

  const currentAppHelpOrigin: AppHelpOrigin =
    activePage === 'trades'
      ? 'otc'
      : activePage === 'swap'
        ? 'portal'
        : activePage === 'treasury'
          ? 'treasury'
          : activePage;

  const openCurrentAppHelp = useCallback(() => {
    openAppHelp({ origin: currentAppHelpOrigin });
  }, [currentAppHelpOrigin, openAppHelp]);

  const openGenericErrorHelp = useCallback(() => {
    openAppHelp({ origin: 'error', reason: 'generic-error' });
  }, [openAppHelp]);

  const {
    draftTradeFromChatMessage,
    hasPendingChatTradeAgentRetry,
    negotiateLinkedTrade
  } = useChatTradeAgentActions({
    activeLinkedTradeContext,
    draftingTradeMessageId,
    getMemoSigner,
    handleMessageInputChange,
    negotiatingLinkedTradeKey,
    prepareCounterTrade,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    setDraftingTradeMessageId,
    setError,
    setNegotiatingLinkedTradeKey,
    setReplyingToMessage,
    setStatus,
    setTipComposerOpen,
    setTradeComposerOpen,
    setTradeCounterContext,
    setTradeCounterParentId,
    setTradeOfferAmountInput,
    setTradeOfferTokenSelection,
    setTradeRequestAmountInput,
    setTradeRequestTokenSelection,
    tradeTokenOptions,
    walletAddress
  });

  const ensureContactAndOpenTradeChat = useCallback(
    (counterpartyAddress: string, context: LinkedTradeContext) => {
      const address = counterpartyAddress.trim();
      if (!isWalletAddress(address)) {
        setError('Could not open chat for this trade participant.');
        return;
      }

      const addressKey = address.toLowerCase();
      setContacts((previous) =>
        previous.some((contact) => contact.address.trim().toLowerCase() === addressKey)
          ? previous
          : [...previous, { address }]
      );
      activeGroupIdRef.current = null;
      setActiveGroupId(null);
      setActiveContact(address);
      setLinkedTradeContext({
        ...context,
        counterpartyAddress: address
      });
      markConversationAsRead(address);
      if (isMobileNav) {
        setActiveMobileView('chat');
      }
      navigateToPage('chat');
    },
    [isMobileNav, markConversationAsRead, navigateToPage, setActiveMobileView]
  );

  useEffect(() => {
    setMobileLinksOpen(false);
    setChatWalletMenuOpen(false);
    if (activePage !== 'chat') {
      setShowQuickActionsModal(false);
      setMobileGroupOptionsOpen(false);
    }
    if (activePage !== 'chat' && activePage !== 'trades' && activePage !== 'swap') {
      clearAccountFundsModal();
      setShowTopUpModal(false);
      setShowBurnerImportModal(false);
      closeBurnerPinModal();
    }
  }, [activePage, clearAccountFundsModal, closeBurnerPinModal, setShowBurnerImportModal]);

  useEffect(() => {
    if (activePage === 'trades' && activeMobileView === 'contacts') {
      setActiveMobileView('chat');
    }
  }, [activeMobileView, activePage]);

  useEffect(() => {
    setMessageInput('');
    setReplyingToMessage(null);
    setHighlightedMessageId(null);
    clearImageAttachmentStatus();
  }, [activeContact, activeGroupId, clearImageAttachmentStatus]);

  useEffect(() => {
    if (!chatComposerRef.current) {
      return;
    }

    const nextValue = messageInput;
    if (readChatComposerText(chatComposerRef.current) !== nextValue) {
      chatComposerRef.current.textContent = nextValue;
    }
  }, [messageInput]);

  useEffect(() => {
    return () => {
      if (groupRemovalNoticeTimeoutRef.current !== null) {
        window.clearTimeout(groupRemovalNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const previousWallet = previousWalletAddressRef.current;
    const nextWallet = walletAddress.trim().toLowerCase();

    if (previousWallet !== nextWallet) {
      postConnectDataSyncRunIdRef.current += 1;
      resetThreadScrollState();
      resetConversationHistoryCaches();
      setMessagesByContact({});
      setReplyingToMessage(null);
      setHighlightedMessageId(null);
      pinnedContactStateRef.current.clear();
      resetBlockTimestampCache();
    }

    previousWalletAddressRef.current = nextWallet;
  }, [
    resetBlockTimestampCache,
    resetConversationHistoryCaches,
    resetThreadScrollState,
    setHighlightedMessageId,
    setReplyingToMessage,
    walletAddress
  ]);

  useEffect(() => {
    setReactionPickerMessageId(null);
    setTipComposerOpen(false);
    setTipAmountInput('');
  }, [activeThreadKey, setReactionPickerMessageId, setTipAmountInput, setTipComposerOpen]);

  useWalletBalanceRefreshEffects({
    activeSignerSource,
    burnerAddress,
    chainId,
    setBurnerBalanceWei,
    setLoadingTopUpQuote,
    setTipNativeBalanceWei,
    setTopUpAmountWei,
    setTopUpMetricsNonce,
    tipComposerOpen,
    topUpMessageTarget,
    topUpMetricsNonce,
    walletAddress
  });

  useRewardTokenMetrics({
    activeSwapVaultContractAddress,
    chainId,
    currentSwapDirectionEnabled,
    getMemoSigner,
    groupRequiredFeeCacheRef,
    groupTokenFeeCacheRef,
    hasAesReady,
    refreshNonce: topUpMetricsNonce,
    setLegacyPrivateRewardTokenBalanceWei,
    setLegacyPrivateRewardTokenDecimals,
    setLegacyPrivateRewardTokenSymbol,
    setSessionOnboardInfo,
    swapDirection,
    walletAddress
  });

  const desktopJoinCodeList = !isMobileNav && canManageActiveGroupJoinCodes ? (
    <ActiveJoinCodeList
      activeGroupJoinCodes={activeGroupJoinCodes}
      loadingActiveGroupJoinCodes={loadingActiveGroupJoinCodes}
      lastCopiedKey={lastCopiedKey}
      onCopyWithFeedback={copyWithFeedback}
      revokingGroupJoinCodeHash={revokingGroupJoinCodeHash}
      onRevokeJoinCode={(codeHash, code) => {
        revokeJoinCodeForActiveGroup(codeHash, code).catch(() => {});
      }}
      processingGroupAction={processingGroupAction}
      isActiveGroupAdmin={isActiveGroupAdmin}
    />
  ) : null;
  const desktopInviteMenu = (
    <GroupInviteMenu
      activeGroupId={activeGroupId}
      walletAddress={walletAddress}
      canInviteToActiveGroup={canInviteToActiveGroup}
      canManageActiveGroupJoinCodes={canManageActiveGroupJoinCodes}
      groupInviteMenuView={groupInviteMenuView}
      onGroupInviteMenuViewChange={setGroupInviteMenuView}
      groupInviteMembersInput={groupInviteMembersInput}
      onGroupInviteMembersInputChange={setGroupInviteMembersInput}
      groupInviteTtlInput={groupInviteTtlInput}
      onGroupInviteTtlInputChange={setGroupInviteTtlInput}
      onInviteMembers={() => {
        inviteMembersToActiveGroup().catch(() => {});
      }}
      groupJoinCodeMode={groupJoinCodeMode}
      onGroupJoinCodeModeChange={setGroupJoinCodeMode}
      groupJoinCodeMaxUsesInput={groupJoinCodeMaxUsesInput}
      onGroupJoinCodeMaxUsesInputChange={setGroupJoinCodeMaxUsesInput}
      onGenerateJoinCode={() => {
        generateJoinCodeForActiveGroup().catch(() => {});
      }}
      generatedGroupInviteCode={generatedGroupInviteCode}
      generatedGroupJoinCodeHash={generatedGroupJoinCodeHash}
      lastCopiedKey={lastCopiedKey}
      onCopyWithFeedback={copyWithFeedback}
      onRevokeGeneratedJoinCode={() => {
        revokeGeneratedJoinCodeForActiveGroup().catch(() => {});
      }}
      processingGroupAction={processingGroupAction}
      hasAesReady={hasAesReady}
      isActiveGroupAdmin={isActiveGroupAdmin}
    />
  );
  const mobileInviteTools = (
    <>
      <GroupInviteMenu
        mobile
        activeGroupId={activeGroupId}
        walletAddress={walletAddress}
        canInviteToActiveGroup={canInviteToActiveGroup}
        canManageActiveGroupJoinCodes={canManageActiveGroupJoinCodes}
        groupInviteMenuView={groupInviteMenuView}
        onGroupInviteMenuViewChange={setGroupInviteMenuView}
        groupInviteMembersInput={groupInviteMembersInput}
        onGroupInviteMembersInputChange={setGroupInviteMembersInput}
        groupInviteTtlInput={groupInviteTtlInput}
        onGroupInviteTtlInputChange={setGroupInviteTtlInput}
        onInviteMembers={() => {
          inviteMembersToActiveGroup().catch(() => {});
        }}
        groupJoinCodeMode={groupJoinCodeMode}
        onGroupJoinCodeModeChange={setGroupJoinCodeMode}
        groupJoinCodeMaxUsesInput={groupJoinCodeMaxUsesInput}
        onGroupJoinCodeMaxUsesInputChange={setGroupJoinCodeMaxUsesInput}
        onGenerateJoinCode={() => {
          generateJoinCodeForActiveGroup().catch(() => {});
        }}
        generatedGroupInviteCode={generatedGroupInviteCode}
        generatedGroupJoinCodeHash={generatedGroupJoinCodeHash}
        lastCopiedKey={lastCopiedKey}
        onCopyWithFeedback={copyWithFeedback}
        onRevokeGeneratedJoinCode={() => {
          revokeGeneratedJoinCodeForActiveGroup().catch(() => {});
        }}
        processingGroupAction={processingGroupAction}
        hasAesReady={hasAesReady}
        isActiveGroupAdmin={isActiveGroupAdmin}
      />
      {canManageActiveGroupJoinCodes ? (
        <ActiveJoinCodeList
          mobile
          activeGroupJoinCodes={activeGroupJoinCodes}
          loadingActiveGroupJoinCodes={loadingActiveGroupJoinCodes}
          lastCopiedKey={lastCopiedKey}
          onCopyWithFeedback={copyWithFeedback}
          revokingGroupJoinCodeHash={revokingGroupJoinCodeHash}
          onRevokeJoinCode={(codeHash, code) => {
            revokeJoinCodeForActiveGroup(codeHash, code).catch(() => {});
          }}
          processingGroupAction={processingGroupAction}
          isActiveGroupAdmin={isActiveGroupAdmin}
        />
      ) : null}
    </>
  );
  const replyingPreviewText =
    replyingToMessage ? trimReplyPreview(getMessageDisplayText(replyingToMessage.text)) : '';
  const handleToggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      if (next) {
        try {
          initPersistentAudio();
        } catch {}
      } else {
        stopNotificationSound();
      }
      return next;
    });
  };
  const debugControl =
    typeof window !== 'undefined' && window.location.search.includes('debug') ? (
      <button
        type="button"
        className="sound-toggle-btn"
        onClick={() => {
          const contactsList = contacts.length ? contacts : [];
          const target = contactsList[0]?.address ?? activeContact ?? '0x' + Math.random().toString(16).slice(2, 10);
          const key = target.toLowerCase();
          const nowId = `sim-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
          const msg: ChatMessage = {
            id: nowId,
            direction: 'incoming',
            text: 'Simulated incoming',
            timestamp: Math.floor(Date.now() / 1000)
          };
          setMessagesByContact((prev) => {
            const copy = { ...prev };
            const arr = (copy[key] ?? []).slice();
            arr.push(msg);
            copy[key] = arr;
            return copy;
          });
        }}
        title="Simulate incoming message (debug)"
        style={{ marginLeft: 6 }}
      >
        {'\uD83E\uDDEA'}
      </button>
    ) : null;
  const mobileGroupActions = (
    <GroupActionControls
      isActiveGroupAdmin={isActiveGroupAdmin}
      groupRenameOpen={groupRenameOpen}
      groupRenameInput={groupRenameInput}
      onGroupRenameInputChange={setGroupRenameInput}
      canSubmitGroupRename={canSubmitGroupRename}
      processingGroupAction={processingGroupAction}
      variant="mobile"
      onBeginRename={beginRenameActiveGroup}
      onCancelRename={cancelRenameActiveGroup}
      onSubmitRename={() => {
        renameActiveGroup().catch(() => {});
      }}
      onLeave={() => {
        leaveActiveGroup().catch(() => {});
      }}
      onHandoffAdminAndLeave={() => {
        handoffAdminAndLeaveActiveGroup().catch(() => {});
      }}
      onDisband={() => {
        disbandActiveGroup().catch(() => {});
      }}
    />
  );
  const desktopGroupActions = (
    <GroupActionControls
      isActiveGroupAdmin={isActiveGroupAdmin}
      groupRenameOpen={groupRenameOpen}
      groupRenameInput={groupRenameInput}
      onGroupRenameInputChange={setGroupRenameInput}
      canSubmitGroupRename={canSubmitGroupRename}
      processingGroupAction={processingGroupAction}
      variant="desktop"
      onBeginRename={beginRenameActiveGroup}
      onCancelRename={cancelRenameActiveGroup}
      onSubmitRename={() => {
        renameActiveGroup().catch(() => {});
      }}
      onLeave={() => {
        leaveActiveGroup().catch(() => {});
      }}
      onHandoffAdminAndLeave={() => {
        handoffAdminAndLeaveActiveGroup().catch(() => {});
      }}
      onDisband={() => {
        disbandActiveGroup().catch(() => {});
      }}
    />
  );
  const swapTradeComposerSides = () => {
    if (creatingTrade) {
      return;
    }

    const nextOfferSelection = tradeRequestTokenSelection;
    const nextRequestSelection = tradeOfferTokenSelection;
    const nextOfferCustomAddress = tradeRequestCustomTokenAddress;
    const nextRequestCustomAddress = tradeOfferCustomTokenAddress;
    const nextOfferAmountInput = tradeRequestAmountInput;
    const nextRequestAmountInput = tradeOfferAmountInput;

    setTradeOfferTokenSelection(nextOfferSelection);
    setTradeRequestTokenSelection(nextRequestSelection);
    setTradeOfferCustomTokenAddress(nextOfferCustomAddress);
    setTradeRequestCustomTokenAddress(nextRequestCustomAddress);
    setTradeOfferAmountInput(nextOfferAmountInput);
    setTradeRequestAmountInput(nextRequestAmountInput);
  };
  const tradeComposerActionNotice = tradeComposerPromptEstimate ? (
    <p className={`chat-compose-prompt-estimate ${tradeComposerPromptEstimate.tone}`}>
      {tradeComposerPromptEstimate.label}
    </p>
  ) : undefined;
  const tradeComposerContent = tradeComposerOpen ? (
    <Suspense fallback={<div className="chat-placeholder">Loading trade composer...</div>}>
      <TradeComposerPanel
        feeMode={tradeFeeModeSelection}
        onFeeModeChange={setTradeFeeModeSelection}
        feeSummaryLabel={tradeFeeSummaryLabel}
        feeError={tradeComposerFieldErrors.fee}
        offerTokenOptions={tradeTokenOptions}
        requestTokenOptions={tradeTokenOptions}
        offerTokenSelection={tradeOfferTokenSelection}
        onOfferTokenSelectionChange={(value) => setTradeOfferTokenSelection(value as TradeTokenPresetKey)}
        requestTokenSelection={tradeRequestTokenSelection}
        onRequestTokenSelectionChange={(value) => setTradeRequestTokenSelection(value as TradeTokenPresetKey)}
        offerAssetError={tradeComposerFieldErrors.offerAsset}
        requestAssetError={tradeComposerFieldErrors.requestAsset}
        offerCustomAddress={tradeOfferCustomTokenAddress}
        onOfferCustomAddressChange={setTradeOfferCustomTokenAddress}
        requestCustomAddress={tradeRequestCustomTokenAddress}
        onRequestCustomAddressChange={setTradeRequestCustomTokenAddress}
        offerCustomMetaLabel={tradeOfferCustomMetaLabel}
        requestCustomMetaLabel={tradeRequestCustomMetaLabel}
        offerVerifyUrl={tradeOfferVerifyUrl}
        requestVerifyUrl={tradeRequestVerifyUrl}
        offerAmountInput={tradeOfferAmountInput}
        onOfferAmountInputChange={(value) => setTradeOfferAmountInput(sanitizeTokenAmountInput(value))}
        requestAmountInput={tradeRequestAmountInput}
        onRequestAmountInputChange={(value) => setTradeRequestAmountInput(sanitizeTokenAmountInput(value))}
        offerAmountLabel={tradeOfferAmountLabel}
        requestAmountLabel={tradeRequestAmountLabel}
        offerAmountPlaceholder={tradeOfferAmountPlaceholder}
        requestAmountPlaceholder={tradeRequestAmountPlaceholder}
        offerAmountError={tradeComposerFieldErrors.offerAmount}
        requestAmountError={tradeComposerFieldErrors.requestAmount}
        canUseMaxOfferAmount={canUseTradeOfferMax}
        onUseMaxOfferAmount={() => setTradeOfferAmountInput(tradeOfferMaxInputValue)}
        offerAmountSummaryLabel={tradeOfferAmountSummaryLabel}
        requestAmountSummaryLabel={tradeRequestAmountSummaryLabel}
        offerBalanceSummaryLabel={tradeOfferBalanceSummaryLabel}
        onSwapSides={swapTradeComposerSides}
        swapDisabled={creatingTrade}
        tradePreviewLabel={tradePreviewLabel}
        tradeRateLabel={tradeRateLabel}
        tradeReverseRateLabel={tradeReverseRateLabel}
        expiresHoursInput={tradeExpiryHoursInput}
        onExpiresHoursInputChange={(value) => setTradeExpiryHoursInput(value.replace(/[^0-9]/g, ''))}
        expiryError={tradeComposerFieldErrors.expiry}
        sending={creatingTrade}
        canSend={canSendTradeOffer}
        actionNotice={tradeComposerActionNotice}
        onSendTradeOffer={() => {
          createTradeOffer().catch(() => {});
        }}
        generalError={tradeComposerFieldErrors.general}
        validationMessage={tradeComposerValidationMessage || undefined}
      />
    </Suspense>
  ) : null;
  const activateBrowserWalletSessionWithBootstrap = useCallback(
    async (
      walletId?: string,
      options?: Parameters<typeof activateBrowserWalletSessionGuarded>[1]
    ) => {
      const onboardInfo = await activateBrowserWalletSessionGuarded(walletId, options);
      const returnedOwnerAesKey =
        options?.preparePrivacy && typeof onboardInfo?.aesKey === 'string'
          ? onboardInfo.aesKey.trim()
          : '';
      if (!returnedOwnerAesKey || burnerWalletRef.current) {
        return onboardInfo;
      }

      let bootstrapOwnerAddress = ownerWalletAddress;
      if (!bootstrapOwnerAddress) {
        const provider =
          browserWalletSession?.provider ??
          (walletId ? injectedWalletOptions.find((option) => option.id === walletId)?.provider : null) ??
          preferredInjectedWalletOption?.provider ??
          null;
        const accounts = provider
          ? ((await provider.request({ method: 'eth_accounts' }).catch(() => [])) as string[])
          : [];
        bootstrapOwnerAddress = accounts.find((account) => isWalletAddress(account)) ?? '';
      }

      if (bootstrapOwnerAddress) {
        bootstrapOwnerRecoveryOnce(bootstrapOwnerAddress, returnedOwnerAesKey).catch(() => {});
      }

      return onboardInfo;
    },
    [
      activateBrowserWalletSessionGuarded,
      bootstrapOwnerRecoveryOnce,
      browserWalletSession?.provider,
      injectedWalletOptions,
      ownerWalletAddress,
      preferredInjectedWalletOption?.provider
    ]
  );
  const {
    chatPreferredBrowserWalletOption,
    chatWalletHeaderControl: appWalletHeaderControl,
    chatWarmAppWallet
  } = useAppWalletHeaderControl({
    activeSignerSource,
    appWallet: burnerWalletRef.current,
    activateBrowserWalletSession: activateBrowserWalletSessionWithBootstrap,
    beginLinkExistingPinWallet,
    beginBurnerPinFlow,
    beginRevealBurnerBackup,
    browserWalletSession,
    burnerAddress,
    burnerMnemonicBackup,
    burnerRecordReady: Boolean(burnerRecordRef.current),
    burnerStorageBlocked,
    burnerWallets,
    chainId,
    chatAppWalletMenuOpen,
    chatWalletMenuOpen,
    checkingOwnerRecovery,
    connectingMethod,
    connectingWalletLabel,
    connectionMethod,
    copyWithFeedback,
    currentInjectedWalletOption,
    disconnectWallet,
    ensureCotiNetwork,
    getBurnerWalletDisplayName,
    getConnectedProvider,
    handleSwitchActiveBurnerWallet,
    hasAesReady,
    hasSavedBurnerWallet,
    injectedWalletOptions,
    initializingBurner,
    isAppWalletRecoveryConfigured,
    isConnected,
    isMobileLayout: isMobileNav,
    lastCopiedKey,
    linkBurnerRecoveryWithWallet,
    onCotiNetwork,
    openChangeBurnerPin,
    ownerAesReady,
    ownerRecoveryError,
    preferredBrowserWalletId,
    recoverLinkedBurnerWallet,
    recoveringAppWallet,
    resetOwnerRecoveryAttempt,
    setActiveRecoveryProfileAsDefault,
    setChatAppWalletMenuOpen,
    setChatWalletMenuOpen,
    setError,
    setShowBurnerImportModal,
    onOpenFundsTransfer: openAccountFundsModal,
    walletAesHealth: walletAesHealthByAddress[walletAddress.trim().toLowerCase()] ?? null,
    walletAddress
  });
  const getSharedWalletSigner = useSharedWalletSigner({
    activeSignerSource,
    burnerWalletRef,
    chainId,
    ensureCotiNetwork,
    getConnectedProvider,
    resolveWalletPromptProvider,
    sessionOnboardInfo,
    setChainId,
    setOnboardStatus,
    setSessionOnboardInfo,
    setWalletAesHealth,
    signerCacheRef,
    signerProviderCacheRef,
    walletAddress
  });
  const sharedWalletActions = useMemo<WalletSessionActions>(
    () => ({
      connectAppWallet: async (walletId?: string) => {
        if (walletId) {
          await Promise.resolve(handleSwitchActiveBurnerWallet(walletId));
          return;
        }
        await beginBurnerPinFlow('stored');
      },
      connectBrowserWallet: (walletId?: string, options = {}) =>
        activateBrowserWalletSessionWithBootstrap(walletId, {
          forceAccountPicker: options.forceAccountPicker,
          forceFreshPrivacy: options.forceFreshPrivacy,
          preparePrivacy: options.preparePrivacy
        }),
      disconnect: disconnectWallet,
      generateAppWallet: async () => {
        await beginBurnerPinFlow('generate');
      },
      getSigner: getSharedWalletSigner,
      importAppWallet: () => {
        setShowBurnerImportModal(true);
      },
      linkAppWalletRecovery: () => linkBurnerRecoveryWithWallet(),
      recoverLinkedAppWallet: () => recoverLinkedBurnerWallet(),
      runWalletTransactionFlow: runSharedWalletTransactionFlow,
      switchAppWallet: (walletIdOrAddress: string) => Promise.resolve(handleSwitchActiveBurnerWallet(walletIdOrAddress)),
      unlockPrivacy: async (options = {}) => {
        if (activeSignerSource === 'metamask') {
          return runSharedWalletTransactionFlow(() =>
            getSharedWalletSigner(true, {
              refreshAes: options.forceFreshPrivacy
            })
          );
        }
        await beginBurnerPinFlow('stored');
        return null;
      }
    }),
    [
      activateBrowserWalletSessionWithBootstrap,
      activeSignerSource,
      beginBurnerPinFlow,
      disconnectWallet,
      getSharedWalletSigner,
      handleSwitchActiveBurnerWallet,
      linkBurnerRecoveryWithWallet,
      recoverLinkedBurnerWallet,
      runSharedWalletTransactionFlow,
      setShowBurnerImportModal
    ]
  );
  const sharedTradeWalletSession = useMemo<SharedWalletSession>(
    () => ({
      actions: sharedWalletActions,
      activeSignerSource,
      browserProvider: activeProvider ?? browserWalletSession?.provider ?? null,
      browserWalletId:
        browserWalletSession?.source === 'metamask-connect-mobile'
          ? browserWalletSession.walletId
          : currentInjectedWalletOption?.id ?? browserWalletSession?.walletId ?? preferredBrowserWalletId,
      browserWalletLabel:
        currentInjectedWalletOption?.label ??
        browserWalletSession?.walletLabel ??
        chatPreferredBrowserWalletOption?.label ??
        preferredInjectedWalletOption?.label ??
        'Browser wallet',
      activeBurnerWalletId: burnerWalletSelectionValue,
      burnerWallet: chatWarmAppWallet,
      burnerWallets,
      chainId,
      onWalletAesHealthChange: setWalletAesHealth,
      onSwitchActiveBurnerWallet: handleSwitchActiveBurnerWallet,
      sessionOnboardInfo,
      walletAesHealthByAddress,
      walletAddress,
      walletReadAccounts: readableWalletAccounts
    }),
    [
      activeProvider,
      activeSignerSource,
      browserWalletSession?.provider,
      browserWalletSession?.source,
      browserWalletSession?.walletId,
      browserWalletSession?.walletLabel,
      burnerWalletSelectionValue,
      burnerWallets,
      chainId,
      chatWarmAppWallet,
      chatPreferredBrowserWalletOption?.label,
      currentInjectedWalletOption?.id,
      currentInjectedWalletOption?.label,
      handleSwitchActiveBurnerWallet,
      preferredBrowserWalletId,
      preferredInjectedWalletOption?.label,
      sessionOnboardInfo,
      sharedWalletActions,
      setWalletAesHealth,
      walletAesHealthByAddress,
      walletAddress,
      readableWalletAccounts
    ]
  );
  const {
    handleAcceptGroupInvite,
    handleDeclineGroupInvite,
    handleForceSync,
    handleOpenNewChat,
    handleSaveNickname,
    handleToggleShowHiddenContacts
  } = useContactsSidebarHandlers({
    acceptGroupInvite,
    declineGroupInvite,
    forceSyncAllData,
    saveMyNicknameOnChain,
    setQuickActionTab,
    setShowHiddenContacts,
    setShowQuickActionsModal
  });

  const {
    handleCancelReply,
    handleReplyToMessage,
    handleSendImage,
    handleSendMessage,
    handleSendTip,
    handleTipAmountInputChange,
    handleToggleReactionPicker,
    handleToggleTipComposer,
    handleToggleTradeComposer
  } = useDirectChatPanelHandlers({
    browserWalletLiteMode,
    sendDirectImageMessage,
    sendMessage: sendMessageForSideEffects,
    sendTipToActiveContact,
    setError,
    setReactionPickerMessageId,
    setReplyingToMessage,
    setTipAmountInput,
    setTipComposerOpen,
    setTradeComposerOpen,
    setTradeCounterContext,
    setTradeCounterParentId,
    setTradeExpiryHoursInput,
    setTradeOfferAmountInput,
    setTradeRequestAmountInput,
    tipAmountWeiFromInput,
    tipTokenSelection,
    tradeCounterParentId
  });

  const activeAppWalletControl =
    activePageWalletPolicy.walletControlKind === 'app' ? appWalletHeaderControl : null;

  const headerHomeAction =
    activePage !== 'home' ? (
      <AppHeaderHomeButton onNavigateHome={() => navigateToPage('home')} />
    ) : null;
  const appHeaderNavigationControl = (
    <AppHeaderNavigation
      activePage={activePage}
      onNavigate={(page) => {
        setMobileLinksOpen(false);
        navigateToPage(page);
      }}
    />
  );
  const renderAppHeader = ({
    brandActions,
    debugControl: headerDebugControl,
    links,
    subtitle,
    walletControl,
    showSoundToggle = false
  }: {
    brandActions?: ReactNode;
    debugControl?: ReactNode;
    links?: typeof COTI_ECOSYSTEM_LINKS;
    subtitle?: string;
    walletControl?: ReactNode;
    showSoundToggle?: boolean;
  }) => (
    <AppHeader
      headerRef={topHeaderRef}
      mobileLinksOpen={mobileLinksOpen}
      isMobileNav={isMobileNav}
      soundEnabled={soundEnabled}
      onToggleMobileLinksOpen={() => setMobileLinksOpen((previous) => !previous)}
      onToggleSound={handleToggleSound}
      onOpenHelp={openCurrentAppHelp}
      onCloseMobileLinks={() => setMobileLinksOpen(false)}
      debugControl={headerDebugControl}
      links={links}
      brandActions={brandActions}
      homeControl={headerHomeAction}
      appNavigationControl={appHeaderNavigationControl}
      walletControl={walletControl}
      subtitle={subtitle}
      showSoundToggle={showSoundToggle}
    />
  );
  const chatRealtimeReconnecting =
    activePage === 'chat' &&
    (directRealtimeStatus === 'reconnecting' || groupRealtimeStatus === 'reconnecting');
  const realtimeConnectionIndicator = chatRealtimeReconnecting ? (
    <span className="realtime-status-pill" role="status" aria-live="polite">
      <span className="realtime-status-dot" aria-hidden="true" />
      Reconnecting...
    </span>
  ) : null;
  const chatBrandActions = realtimeConnectionIndicator;
  const walletSessionModals = (
    <WalletSessionModals
      accountFundsAssets={accountFundsAssets}
      accountFundsDirection={accountFundsDirection}
      accountFundsProcessing={accountFundsProcessing}
      burnerAddress={burnerAddress}
      burnerBalanceWei={burnerBalanceWei}
      burnerImportInput={burnerImportInput}
      burnerMnemonicBackup={burnerMnemonicBackup}
      burnerPinInput={burnerPinInput}
      burnerPinMode={burnerPinMode}
      cancelRecoverySavePrompt={cancelRecoverySavePrompt}
      closeAccountFundsModal={closeAccountFundsModal}
      closeBurnerBackup={closeBurnerBackup}
      closeBurnerPinModal={closeBurnerPinModal}
      confirmRecoverySavePrompt={confirmRecoverySavePrompt}
      error={error}
      estimatedMessagesLeft={estimatedMessagesLeft}
      importBurnerWallet={importBurnerWallet}
      initializingBurner={initializingBurner}
      loadingTopUpQuote={loadingTopUpQuote}
      ownerWalletAddress={ownerWalletAddress}
      recoverySavePrompt={recoverySavePrompt}
      setBurnerImportInput={setBurnerImportInput}
      setBurnerPinInput={setBurnerPinInput}
      setRecoverySavePromptMakeDefault={setRecoverySavePromptMakeDefault}
      setShowBurnerImportModal={setShowBurnerImportModal}
      setShowTopUpModal={setShowTopUpModal}
      showBurnerImportModal={showBurnerImportModal}
      showBurnerMnemonic={showBurnerMnemonic}
      showBurnerPinModal={showBurnerPinModal}
      showTopUpModal={showTopUpModal}
      submitAccountFundsTransfer={submitAccountFundsTransfer}
      submitBurnerPinAndInitialize={submitBurnerPinAndInitialize}
      topUpAmountLabel={topUpAmountLabel}
      topUpAmountWei={topUpAmountWei}
      topUpBurnerWithWallet={topUpBurnerWithWallet}
      topUpMessageTarget={topUpMessageTarget}
      setTopUpMessageTarget={setTopUpMessageTarget}
    />
  );  const chatWorkspace = (
    <>
      <div className="app-root">
        <ContactsSidebar
            nicknameEditorRef={nicknameEditorRef}
            nicknameMaxBytes={nicknameMaxBytes}
            hasAesReady={hasAesReady}
            walletAddress={walletAddress}
            onNicknameInputChange={setMyNickname}
            onSaveNickname={handleSaveNickname}
            hasUnreadConversations={hasUnreadConversations}
            readStateActionsDisabled={!readStateFeaturesEnabled}
            walletPromptSensitiveActionsTitle={browserWalletLiteModeTitle}
            onMarkAllConversationsAsRead={markAllConversationsAsRead}
            onForceSync={handleForceSync}
            syncingHistory={syncingHistory}
            syncingGroups={syncingGroups}
            onOpenNewChat={handleOpenNewChat}
            showHiddenContacts={showHiddenContacts}
            onToggleShowHiddenContacts={handleToggleShowHiddenContacts}
            hiddenContactsCount={hiddenContactsCount}
            hiddenContactsLabel={hiddenContactsLabel}
            contactGroupPanelRatio={contactGroupPanelRatio}
            visibleSortedContacts={visibleSortedContacts}
            contactsListEmptyMessage={contactsListEmptyMessage}
            activeContact={activeContact}
            editingContactAddress={editingContactAddress}
            editingContactName={editingContactName}
            onEditingContactNameChange={setEditingContactName}
            isConversationStateSyncPending={isConversationStateSyncPending}
            conversationMetadataActionsDisabled={browserWalletLiteMode}
            messagesByContact={messagesByContact}
            lastCopiedKey={lastCopiedKey}
            unreadMap={readStateFeaturesEnabled ? unreadMap : {}}
            onCopyWithFeedback={copyWithFeedback}
            onActivateContact={activateContact}
            onStartRenameContact={startRenameContact}
            onRemoveContact={removeContact}
            onSaveRenamedContact={saveRenamedContact}
            onCancelRenameContact={cancelRenameContact}
            sortedGroupInvites={sortedGroupInvites}
            onAcceptGroupInvite={handleAcceptGroupInvite}
            onDeclineGroupInvite={handleDeclineGroupInvite}
            processingGroupAction={processingGroupAction}
            sortedGroups={sortedGroups}
            activeGroupId={activeGroupId}
            messagesByGroup={messagesByGroup}
            unreadGroupMap={readStateFeaturesEnabled ? unreadGroupMap : {}}
            onActivateGroup={activateGroup}
            onPrefetchGroup={prefetchGroupBeforeOpen}
            error={error}
          />

        <main className="chat-panel">
          <AppErrorBoundary
            fallback={
              <div className="chat-placeholder" role="alert">
                <strong>Something went wrong.</strong>
                <div className="app-error-boundary-actions">
                  <button type="button" onClick={() => window.location.reload()}>Reload</button>
                  <button type="button" className="app-help-context-link" onClick={openGenericErrorHelp}>
                    Get help
                  </button>
                </div>
              </div>
            }
          >
          <Suspense fallback={<div className="chat-placeholder">Loading conversation...</div>}>
            {!isConnected ? (
              <ChatReadinessState
                onOpenHelp={() => openAppHelp({ origin: 'chat', reason: 'wallet-needed' })}
              />
            ) : activeGroupId !== null ? (
              <GroupChatPanel
                activeGroupId={activeGroupId!}
                activeGroupMeta={activeGroupMeta}
                isActiveGroupAdmin={isActiveGroupAdmin}
                activeGroupMemberCount={activeGroupMemberCount}
                activeGroupParticipants={activeGroupParticipants}
                lastCopiedKey={lastCopiedKey}
                onCopyWithFeedback={copyWithFeedback}
                processingGroupAction={processingGroupAction}
                onRemoveMember={removeMemberFromActiveGroup}
                desktopJoinCodeList={desktopJoinCodeList}
                desktopInviteMenu={desktopInviteMenu}
                mobileInviteTools={mobileInviteTools}
                desktopGroupActions={desktopGroupActions}
                mobileGroupActions={mobileGroupActions}
                isMobileNav={isMobileNav}
                syncingGroups={syncingGroups}
                mobileGroupOptionsOpen={mobileGroupOptionsOpen}
                onToggleMobileGroupOptions={() => setMobileGroupOptionsOpen((previous) => !previous)}
                onRefreshGroup={() => {
                  syncGroupData({ deep: true }).catch(() => {});
                }}
                chatMessagesRef={setChatMessagesContainerRef}
                activeGroupMessages={visibleActiveGroupMessages}
                messageLoadPhase={activeGroupMessageLoadPhase}
                isReactionOnlyMessage={isReactionOnlyMessage}
                getReactionsForMessage={getReactionsForMessage}
                reactionPickerMessageId={reactionPickerMessageId}
                onToggleReactionPicker={(messageId) => {
                  if (browserWalletLiteMode) {
                    return;
                  }
                  setReactionPickerMessageId((previous) => (previous === messageId ? null : messageId));
                }}
                sendingReaction={sendingReaction}
                onSendReaction={sendReactionToMessage}
                walletPromptSensitiveActionsDisabled={browserWalletLiteMode}
                walletPromptSensitiveActionsTitle={browserWalletLiteModeTitle}
                replyingToMessage={replyingToMessage}
                onReplyToMessage={(message) => {
                  if (browserWalletLiteMode) {
                    setError('Use the ChainWhisper account to send replies.');
                    return;
                  }
                  setReplyingToMessage(message);
                }}
                highlightedMessageId={highlightedMessageId}
                messageElementRefs={messageElementRefs}
                onJumpToReferencedMessage={jumpToReferencedMessage}
                getReplyReferenceFallbackLabel={getReplyReferenceFallbackLabel}
                walletAddress={walletAddress}
                findContactNameForWalletAddress={findContactNameForWalletAddress}
                replyingPreviewText={replyingPreviewText}
                onCancelReply={() => setReplyingToMessage(null)}
                tipComposerOpen={tipComposerOpen}
                onToggleTipComposer={() => setTipComposerOpen((previous) => !previous)}
                tipping={tipping}
                tipTokenSelection={tipTokenSelection}
                onTipTokenSelectionChange={setTipTokenSelection}
                rewardTokenSymbol={rewardTokenSymbol}
                privateRewardTokenSymbol={privateRewardTokenSymbol}
                tipAmountInput={tipAmountInput}
                onTipAmountInputChange={(value) => setTipAmountInput(sanitizeTokenAmountInput(value))}
                activeTipTokenSymbol={activeTipTokenSymbol}
                tipAmountWeiFromInput={tipAmountWeiFromInput}
                canSendGroupTipFromComposer={canSendGroupTipFromComposer}
                tipAmountExceedsBalance={tipAmountExceedsBalance}
                tipAmountSummaryLabel={tipAmountSummaryLabel}
                tipBalanceSummaryLabel={tipBalanceSummaryLabel}
                onSendTip={() => {
                  sendTipToActiveGroupMember(tipTokenSelection, tipAmountWeiFromInput).catch(() => {});
                }}
                groupTipRecipientAddress={groupTipRecipientAddress}
                onGroupTipRecipientChange={setGroupTipRecipientAddress}
                activeGroupTipRecipients={activeGroupTipRecipients}
                selectedGroupTipRecipient={selectedGroupTipRecipient}
                sendingGroupMessage={sendingGroupMessage}
                composerRef={chatComposerRef}
                onSendImage={(file) => {
                  sendGroupImageMessage(file).catch(() => {});
                }}
                uploadingImage={uploadingImage}
                imageAttachmentStatus={imageAttachmentStatus}
                imageAttachDisabled={uploadingImage || sendingGroupMessage || processingGroupAction}
                imageAttachTitle={uploadingImage ? 'Uploading image...' : 'Attach or paste an image'}
                onDismissImageAttachmentStatus={clearImageAttachmentStatus}
                onSendMessage={() => {
                  sendGroupMessage().catch(() => {});
                }}
                maxMessageLength={MAX_MESSAGE_LENGTH}
                onMessageInputChange={handleMessageInputChange}
                onOpenInternalAppLink={navigateToInternalAppLink}
              />
            ) : activeContact ? (
              <DirectChatPanel
                activeContact={activeContact!}
                activeContactMeta={activeContactMeta}
                isSelfChat={isSelfChat}
                activeConversationMuted={activeConversationMuted}
                activeConversationHidden={activeConversationHidden}
                activeConversationStateSyncPending={activeConversationStateSyncPending}
                walletPromptSensitiveActionsDisabled={browserWalletLiteMode}
                walletPromptSensitiveActionsTitle={browserWalletLiteModeTitle}
                onToggleConversationMute={() => {
                  toggleConversationMuteForContact(activeContact!).catch(() => {});
                }}
                onLoadFullConversationHistory={loadFullConversationHistory}
                syncingHistory={syncingHistory}
                chatMessagesRef={setChatMessagesContainerRef}
                markConversationAsRead={markConversationAsRead}
                loadingOlderHistory={loadingOlderHistory}
                activeMessages={visibleActiveMessages}
                isReactionOnlyMessage={isReactionOnlyMessage}
                reactionPickerMessageId={reactionPickerMessageId}
                onToggleReactionPicker={handleToggleReactionPicker}
                sendingReaction={sendingReaction}
                onSendReaction={sendReactionToMessage}
                onReplyToMessage={handleReplyToMessage}
                replyingToMessage={replyingToMessage}
                highlightedMessageId={highlightedMessageId}
                messageElementRefs={messageElementRefs}
                getReactionsForMessage={getReactionsForMessage}
                onJumpToReferencedMessage={jumpToReferencedMessage}
                getReplyReferenceFallbackLabel={getReplyReferenceFallbackLabel}
                tradeSnapshotsById={tradeSnapshotsById}
                linkedTradeContext={activeLinkedTradeContext}
                linkedTradeContextShareCopied={lastCopiedKey === activeLinkedTradeContextCopyKey}
                walletAddress={walletAddress}
                processingTradeActionId={processingTradeActionId}
                onCopyLinkedTradeContextLink={(value) => {
                  if (activeLinkedTradeContextCopyKey) {
                    copyWithFeedback(value, activeLinkedTradeContextCopyKey).catch(() => {});
                  }
                }}
                draftingTradeMessageId={draftingTradeMessageId}
                draftTradeFeeLabel={tradeAgentChatFeeLabels.chat_to_trade}
                negotiationFeeLabel={tradeAgentChatFeeLabels.draft_counter}
                pendingTradeAgentRetry={hasPendingChatTradeAgentRetry}
                negotiatingLinkedTrade={
                  activeLinkedTradeContext
                    ? negotiatingLinkedTradeKey ===
                      `${activeLinkedTradeContext.escrowContract ?? 'default'}:${activeLinkedTradeContext.tradeId}`
                    : false
                }
                onDraftTradeFromMessage={(message) => {
                  draftTradeFromChatMessage(message).catch(() => {});
                }}
                onNegotiateLinkedTrade={(context) => {
                  negotiateLinkedTrade(context).catch(() => {});
                }}
                onDismissLinkedTradeContext={() => setLinkedTradeContext(null)}
                onOpenTradeTerminalPath={navigateToInternalAppLink}
                onAcceptTrade={acceptTradeOffer}
                onDeclineTrade={declineTradeOffer}
                onCounterTrade={prepareCounterTrade}
                onCancelTrade={cancelTradeOffer}
                replyingPreviewText={replyingPreviewText}
                onCancelReply={handleCancelReply}
                tipComposerOpen={tipComposerOpen}
                onToggleTipComposer={handleToggleTipComposer}
                tipping={tipping}
                tipTokenSelection={tipTokenSelection}
                onTipTokenSelectionChange={setTipTokenSelection}
                rewardTokenSymbol={rewardTokenSymbol}
                privateRewardTokenSymbol={privateRewardTokenSymbol}
                tipAmountInput={tipAmountInput}
                onTipAmountInputChange={handleTipAmountInputChange}
                activeTipTokenSymbol={activeTipTokenSymbol}
                tipAmountWeiFromInput={tipAmountWeiFromInput}
                canSendTipFromComposer={canSendTipFromComposer}
                tipAmountExceedsBalance={tipAmountExceedsBalance}
                tipAmountSummaryLabel={tipAmountSummaryLabel}
                tipBalanceSummaryLabel={tipBalanceSummaryLabel}
                onSendTip={handleSendTip}
                tradeComposerOpen={tradeComposerOpen}
                tradeComposerContent={tradeComposerContent}
                onToggleTradeComposer={handleToggleTradeComposer}
                composerRef={chatComposerRef}
                isMobileNav={isMobileNav}
                onSendImage={handleSendImage}
                uploadingImage={uploadingImage}
                imageAttachmentStatus={imageAttachmentStatus}
                imageAttachDisabled={uploadingImage || sending || tipping}
                imageAttachTitle={uploadingImage ? 'Uploading image...' : 'Attach or paste an image'}
                onDismissImageAttachmentStatus={clearImageAttachmentStatus}
                onSendMessage={handleSendMessage}
                maxMessageLength={directMessageMaxLength}
                onMessageInputChange={handleMessageInputChange}
                promptEstimate={directComposerPromptEstimate}
                onOpenInternalAppLink={navigateToInternalAppLink}
                sending={sending}
                tipToggleDisabled={tipping || sending || uploadingImage || !activeContact || isSelfChat}
                tipToggleTitle={tipComposerOpen ? 'Hide tip options' : 'Open tip options'}
                tradeToggleDisabled={creatingTrade || tipping || sending || uploadingImage || !activeContact || isSelfChat}
                tradeToggleTitle={tradeComposerOpen ? 'Hide trade options' : 'Open trade offer'}
              />
            ) : (
              <div className="chat-placeholder chat-placeholder-state" role="status" aria-live="polite">
                <strong>Select a conversation</strong>
                <p>Open a contact or group from the sidebar to start messaging.</p>
              </div>
            )}
          </Suspense>
          </AppErrorBoundary>
        </main>
      </div>

      <MobileBottomNav activeMobileView={activeMobileView} isConnected={isConnected} onSelectView={setActiveMobileView} />

      {showQuickActionsModal ? (
        <Suspense fallback={null}>
          <QuickActionsModal
            isOpen={showQuickActionsModal}
            onClose={() => setShowQuickActionsModal(false)}
            newContactName={newContactName}
            onNewContactNameChange={setNewContactName}
            newContact={newContact}
            onNewContactChange={setNewContact}
            onAddContactSubmit={handleAddContact}
            newGroupTitle={newGroupTitle}
            onNewGroupTitleChange={setNewGroupTitle}
            newGroupMembersInput={newGroupMembersInput}
            onNewGroupMembersInputChange={setNewGroupMembersInput}
            newGroupIsPrivate={newGroupIsPrivate}
            onNewGroupIsPrivateChange={setNewGroupIsPrivate}
            onCreateGroup={createGroup}
            processingGroupAction={processingGroupAction}
            hasAesReady={hasAesReady}
            groupJoinCodeInput={groupJoinCodeInput}
            onGroupJoinCodeInputChange={setGroupJoinCodeInput}
            onJoinGroupWithCode={joinGroupWithCode}
            error={error}
          />
        </Suspense>
      ) : null}
    </>
  );

  if (activePage === 'home') {
    return (
      <div className="app-shell app-shell-landing app-shell-home">
        {renderAppHeader({ links: COTI_ECOSYSTEM_LINKS })}
        <HomePage
          onLaunchChat={() => navigateToPage('chat')}
          onOpenSwap={() => navigateToPage('swap')}
          onOpenTreasury={() => navigateToPage('treasury')}
          onPrefetchChat={preloadChatPage}
          onPrefetchSwap={preloadSwapPage}
          onPrefetchTrades={preloadTradesPage}
          onPrefetchTreasury={preloadTreasuryPage}
          onOpenTrades={() => navigateToPage('trades')}
        />
        {walletSessionModals}
      </div>
    );
  }

  if (activePage === 'trades') {
    return (
      <div className="app-shell app-shell-trades">
        {renderAppHeader({
          walletControl: activeAppWalletControl,
          subtitle: 'OTC Desk',
          showSoundToggle: true
        })}
        {walletSessionModals}
        <AppErrorBoundary
          onOpenHelp={openGenericErrorHelp}
          resetKey={appHelpLaunchContext ? `${appHelpLaunchContext.origin}:${appHelpLaunchContext.topicId ?? ''}` : ''}
        >
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="standalone-trades-shell" label="Loading OTC Desk" />
            }
          >
            <P2PTradingPage
              isMobileNav={isMobileNav}
              sharedWalletSession={sharedTradeWalletSession}
              appHelpLaunchContext={appHelpLaunchContext}
              onAppHelpLaunchConsumed={() => setAppHelpLaunchContext(null)}
              onOpenAppHelp={(reason) => openAppHelp({ origin: 'otc', reason })}
              onOpenInternalAppLink={navigateToInternalAppLink}
              onOpenTradeConversation={ensureContactAndOpenTradeChat}
            />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  if (activePage === 'swap') {
    return (
      <div className="app-shell app-shell-swap">
        {renderAppHeader({
          walletControl: activeAppWalletControl,
          subtitle: 'Privacy Portal',
          showSoundToggle: true
        })}
        {walletSessionModals}
        <AppErrorBoundary onOpenHelp={openGenericErrorHelp}>
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="swap-page-shell" label="Loading Privacy Portal" />
            }
          >
            <TokenSwapPage
              pairs={PRIVACY_TOKEN_PAIRS}
              selectedPair={selectedPrivacyPair}
              onPairChange={setSelectedPrivacyPairId}
              tokenSearch={privacyTokenSearch}
              onTokenSearchChange={setPrivacyTokenSearch}
              privacyDirection={privacyDirection}
              onPrivacyDirectionChange={setPrivacyDirection}
              activePortalAccount={selectedWispPortalAccount}
              showPortalAccountTabs={showWispPortalAccountTabs}
              onPortalAccountChange={setPrivacyPortalAccount}
              amountInput={privacyAmountInput}
              onAmountInputChange={(value) => setPrivacyAmountInput(sanitizeTokenAmountInput(value))}
              onMaxAmount={() => {
                privacyPortal.onMaxAmount().catch(() => {});
              }}
              metrics={privacyPortal.metrics}
              quote={privacyPortal.quote}
              loading={privacyPortal.loading}
              actionStage={privacyPortal.actionStage}
              walletAddress={wispPortalWalletAddress}
              onCotiNetwork={onCotiNetwork}
              hasAesReady={wispPortalHasAesReady}
              canConvert={privacyPortalView.canConvert}
              buttonLabel={privacyPortalView.buttonLabel}
              onConvert={privacyPortal.convert}
              onRefresh={privacyPortal.refresh}
              statusMessage={privacyPortal.statusMessage}
              error={privacyPortal.error}
              transactionUrl={privacyPortal.transactionUrl}
              onOpenHelp={(reason) => openAppHelp({ origin: 'portal', reason })}
              recovery={{
                open: privacyRecoveryOpen,
                onOpenChange: setPrivacyRecoveryOpen,
                amountInput: swapAmountInput,
                onAmountInputChange: (value) => setSwapAmountInput(sanitizeTokenAmountInput(value)),
                onMaxAmount: handleWispMaxAmount,
                maxDisabled: wispMaxDisabled,
                inputBalanceLabel: wispInputBalanceLabel,
                outputBalanceLabel: wispOutputBalanceLabel,
                direction: swapDirection,
                onDirectionChange: setSwapDirection,
                canShield: canShieldTokens,
                canUnshield: canUnshieldTokens,
                canLegacyUnshield: canLegacyUnshieldTokens,
                publicSymbol: rewardTokenSymbol,
                privateSymbol: wispCurrentPrivateTokenSymbol,
                legacyPrivateSymbol: legacyPrivateRewardTokenSymbol,
                inputSymbol: swapInputSymbol,
                feeLabel: swapFeeWei === null ? 'Read at confirmation' : `${formatCotiAmount(swapFeeWei)} COTI`,
                contractUrl: wispBridgeContractUrl,
                legacyContractUrl: legacySwapVaultContractUrl,
                busy: swappingTokens,
                actionStage: swapActionStage,
                canSubmit: canSwapRewardTokens,
                buttonLabel: swapButtonLabel,
                onSubmit: swapRewardTokens,
                statusMessage: swapStatusMessage,
                error,
                transactionUrl: swapTransactionHash
                  ? `${COTI_NETWORK.blockExplorerUrl}/tx/${swapTransactionHash}`
                  : undefined
              }}
            />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  if (activePage === 'treasury') {
    return (
      <div className="app-shell app-shell-landing">
        {renderAppHeader({
          subtitle: 'Treasury',
          showSoundToggle: true
        })}
        <AppErrorBoundary onOpenHelp={openGenericErrorHelp}>
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="treasury-shell" label="Loading Treasury Data" variant="treasury" />
            }
          >
            <TreasuryPage isCompactLayout={isMobileNav} />
          </Suspense>
        </AppErrorBoundary>
        {walletSessionModals}
      </div>
    );
  }

  return (
    <div className={`app-shell app-shell-chat mobile-view-${activeMobileView}`}>
      {renderAppHeader({
        debugControl,
        brandActions: chatBrandActions,
        walletControl: activeAppWalletControl,
        subtitle: 'Chat',
        showSoundToggle: true
      })}
      {walletSessionModals}
      {chatWorkspace}
    </div>
  );
}
