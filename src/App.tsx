import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import {
  DirectChatPanel,
  DexV2Page,
  GroupChatPanel,
  P2PTradingPage,
  QuickActionsModal,
  RouteLoadingFallback,
  TokenSwapPage,
  TradeComposerPanel,
  PrivateTvlPage,
  preloadChatPage,
  preloadSwapPage,
  preloadTradesPage,
  preloadPrivateTvlPage
} from './app/lazyRoutes';
import { BROWSER_WALLET_DIRECT_MESSAGE_MAX_LENGTH } from './app/appHelpers';
import { type CurrentCheapDexCandidateKey } from './lib/dexV2Deployment';
import { currentDexAppPair, resolveCurrentDexAppCandidate } from './lib/currentDexAppScope';
import { currentNativeDexDailyPriceConfig } from './lib/currentDexNativeDailyPriceTestnet';
import useCurrentDexMarketReference from './features/dex/hooks/useCurrentDexMarketReference';
import AppErrorBoundary from './app/components/AppErrorBoundary';
import AppHeader from './app/components/AppHeader';
import WalletUtilityMenu from './app/components/WalletUtilityMenu';
import { AppHeaderHomeButton, AppHeaderNavigation } from './app/components/AppHeaderNavigation';
import TradingProductSwitch from './app/components/TradingProductSwitch';
import type { TradingPair } from './app/components/TradingProductSwitch';
import useDirectTradeNotifications from './features/notifications/useDirectTradeNotifications';
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
import useAccountFundsSigners from './features/wallet/hooks/useAccountFundsSigners';
import useOwnerWalletBalances from './features/wallet/hooks/useOwnerWalletBalances';
import useWalletTokenWatchlist from './features/wallet/hooks/useWalletTokenWatchlist';
import useChatWalletHeaderControl from './features/wallet/hooks/useChatWalletHeaderControl';
import useChatReadCursorCloudSync from './features/wallet/hooks/useChatReadCursorCloudSync';
import useWalletReadiness from './features/wallet/hooks/useWalletReadiness';
import { mergeLeaseScopedOnboardInfo } from './features/wallet/hooks/useSharedWalletSigner';
import { issuePrivateLiquidityMetaMaskCapability } from './features/wallet/privateLiquidityMetaMaskCapability';
import { issueOtcV2MetaMaskCapability } from './features/wallet/otcV2MetaMaskCapability';
import { releaseOwnerCotiMetaMaskProviderPool } from './features/wallet/ownerCotiMetaMaskCapability';
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
import useChatReactionsV1Runtime from './features/chat/hooks/useChatReactionsV1Runtime';
import useChatThreadScroll from './features/chat/hooks/useChatThreadScroll';
import useActiveGroupThreadState from './features/groups/hooks/useActiveGroupThreadState';
import useGroupAdminActions from './features/groups/hooks/useGroupAdminActions';
import useGroupDataSync from './features/groups/hooks/useGroupDataSync';
import useGroupChatV2History from './features/groups/hooks/useGroupChatV2History';
import useGroupRealtimeSync from './features/groups/hooks/useGroupRealtimeSync';
import useGroupMessageActions from './features/groups/hooks/useGroupMessageActions';
import useInChatTradeActions from './features/trading/hooks/useInChatTradeActions';
import useTradeActionConfirmationState from './features/trading/hooks/useTradeActionConfirmationState';
import TradeActionConfirmModal from './features/trading/components/TradeActionConfirmModal';
import useActiveTradeOfferSnapshots from './features/trading/hooks/useActiveTradeOfferSnapshots';
import useChatTradeAgentActions from './features/trading/hooks/useChatTradeAgentActions';
import useTradeAgentChatFeeLabels from './features/trading/hooks/useTradeAgentChatFeeLabels';
import useTradeCustomTokenInfoLoader from './features/trading/hooks/useTradeCustomTokenInfoLoader';
import { useNotificationSound } from './app/hooks/useNotificationSound';
import useImageAttachmentStatus from './features/chat/hooks/useImageAttachmentStatus';
import { DIRECT_CHAT_V2_DEPLOYMENT_CONFIG } from './lib/directChatV2Deployment';
import { readDirectChatV2ContactSettingsSerially } from './lib/directChatV2ContactSettings';
import type { DirectChatV2Runtime } from './lib/directChatV2Runtime';
import { DIRECT_TRADE_V2_DEPLOYMENT_CONFIG, DIRECT_TRADE_V2_SUPPORTED_CONTRACTS, isSupportedDirectTradeV2Escrow } from './lib/directTradeV2Deployment';
import type { DirectTradeV2Runtime } from './lib/directTradeV2Runtime';
import { GROUP_CHAT_V2_DEPLOYMENT_CONFIG } from './lib/groupChatV2Deployment';
import type { GroupChatV2Runtime } from './lib/groupChatV2Runtime';
import {
  buildChatReactionsV1RuntimeScopeKey,
  CHAT_REACTIONS_V1_DEPLOYMENT_CONFIG
} from './lib/chatReactionsV1Deployment';
import type { ChatReactionsV1Runtime } from './lib/chatReactionsV1Runtime';
import { OTC_V2_DEPLOYMENT_CATALOG } from './lib/otcV2DeploymentCatalog';
import type { OtcTradeHistoryV2Runtime } from './lib/otcTradeHistoryV2Runtime';
import type { OtcV2ActionRuntime } from './lib/otcV2ActionRuntime';
import {
  requestChainWhisperBrowserNotificationPermission,
  showChainWhisperBrowserNotification
} from './lib/browserNotifications';
import {
  buildBrowserOwnerDataScopeKey,
  buildBrowserWalletRuntimeScopeKey
} from './lib/browserWalletRuntimeScope';
import type {
  GroupChatV2ReadCursor,
  GroupChatV2ReadCursorAnchor,
  GroupChatV2ReadCursorScope
} from './lib/groupChatV2ReadCursor';
import { useStateBackupSync } from './app/hooks/useStateBackupSync';
import { useStoredWalletPreference } from './features/wallet/hooks/useStoredWalletPreference';
import { useWalletOnboarding } from './features/wallet/hooks/useWalletOnboarding';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  getOnChainFailureMessage,
  resolveTradePresetKind,
  sanitizeOutgoingMessagePlainText,
  type TradeTokenPresetKey
} from './lib/appHelpers';
import { type WalletAesHealthState } from './lib/cotiAesUnlock';
import { buildGroupChatV2PromptEstimateMessage } from './lib/chatWalletPromptEstimate';
import { COTI_ECOSYSTEM_LINKS } from './lib/ecosystemLinks';
import {
  getAppHelpReadinessTopicId,
  normalizeAppHelpLaunchContext,
  type AppHelpLaunchContext,
  type AppHelpOrigin,
  type AppHelpReason
} from './lib/appHelpLaunch';
import type { LinkedTradeContext } from './lib/linkedTradeContext';
import { buildTradeTerminalPath } from './features/trading/hooks/useP2PTradeRoute';
import { runWalletTransactionFlow } from './lib/walletTransactionFlow';
import { ensureProviderOnNetwork } from './lib/walletNetwork';
import {
  CHAINWHISPER_NETWORK_SELECTION_LOCKED,
  getChainWhisperCotiNetwork,
  storeChainWhisperNetworkId,
  type ChainWhisperActiveNetworkId
} from './lib/chainWhisperNetworks';
import { getPreferredBrowserWalletId } from './lib/appStorage';
import { deriveTradeComposerModel } from './lib/tradeComposer';
import { type GroupMessageLoadPhase } from './lib/groupSyncPlan';
import type { SharedWalletSession, WalletSessionActions, WalletSessionDexOptions } from './lib/walletSession';
import { useAppShellStore } from './features/appShell/appShellStore';
import { useChatUiStore } from './features/chat/chatUiStore';
import {
  getGeneratedGroupJoinCodeForContext,
  useGroupUiStore
} from './features/groups/groupUiStore';
import { useInChatTradeStore } from './features/trading/inChatTradeStore';
import { useTokenToolsStore } from './features/tokenTools/tokenToolsStore';
import useRewardTokenMetrics from './features/tokenTools/useRewardTokenMetrics';
import useTokenSwapActions from './features/tokenTools/useTokenSwapActions';
import useTokenSwapViewModel, { usePrivacyPortalViewModel } from './features/tokenTools/useTokenSwapViewModel';
import {
  isLegacyUnshieldDirection,
  resolveLegacyRecoverySpendableAmount
} from './features/tokenTools/tokenSwapView';
import usePrivacyPortal from './features/tokenTools/usePrivacyPortal';
import { getPrivacyTokenPair, PRIVACY_TOKEN_PAIRS } from './lib/privacyPortal';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import {
  ChatMessage,
  buildTradeSnapshotKey,
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
  getGroupActionErrorMessage,
  getProviderErrorMessage,
  GROUP_REMOVAL_NOTICE_AUTO_DISMISS_MS,
  GroupInvite,
  GroupSummary,
  isWalletAddress,
  loadCotiReadProvider,
  MAX_MESSAGE_LENGTH,
  mergeUniqueContacts,
  normalizeLastReadAllTs,
  sanitizeTokenAmountInput,
  SyncConversationOptions,
  SyncGroupOptions,
  type TradeOfferMessagePayload,
  trimReplyPreview,
} from './lib/appShared';

type AppProps = {
  initialAppHelpLaunchContext?: AppHelpLaunchContext | null;
};

const dexAppScope = resolveCurrentDexAppCandidate(import.meta.env.MODE, import.meta.env.VITE_CHAINWHISPER_DEX_APP_CANDIDATE);

export default function App({ initialAppHelpLaunchContext = null }: AppProps) {
  const [networkSwitching, setNetworkSwitching] = useState(false);
  const [tradingPriceDisplayInverted, setTradingPriceDisplayInverted] = useState(false);
  const [selectedTradingPair, setSelectedTradingPair] = useState<TradingPair>(['BCN', 'HBR']);
  const [mobileTradingScrolled, setMobileTradingScrolled] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversationStateSyncPendingByContact, setConversationStateSyncPendingByContact] = useState<
    Record<string, boolean>
  >({});
  const [activeContact, setActiveContact] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [linkedTradeContext, setLinkedTradeContext] = useState<LinkedTradeContext | null>(null);
  const [negotiatingLinkedTradeKey, setNegotiatingLinkedTradeKey] = useState('');
  const [draftingTradeMessageId, setDraftingTradeMessageId] = useState('');
  const shouldLoadTradeAgentChatFees = useAppShellStore(
    (state) => state.activePage === 'chat'
  );
  const tradeAgentChatFeeLabels = useTradeAgentChatFeeLabels(
    shouldLoadTradeAgentChatFees
  );
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
    showHiddenContacts,
    showQuickActionsModal,
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
    setShowHiddenContacts,
    setShowQuickActionsModal,
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
    generatedGroupJoinCode,
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
    setGeneratedGroupJoinCode,
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
    setPrivacyRecoveryOpen
  } = useTokenToolsStore();
  const [, setLegacyPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [legacyPrivateRewardTokenSymbol, setLegacyPrivateRewardTokenSymbol] = useState(FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL);
  const [legacyPrivateRewardTokenDecimals, setLegacyPrivateRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
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
  const [walletConnectionError, setWalletConnectionError] = useState<string>('');
  const setWalletOnboardingError = useCallback((next: SetStateAction<string>) => {
    setWalletConnectionError(next);
    setError(next);
  }, []);
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
  const [appHelpLaunchContext, setAppHelpLaunchContext] = useState<AppHelpLaunchContext | null>(
    initialAppHelpLaunchContext
  );
  const topHeaderRef = useRef<HTMLElement | null>(null);
  const isMobileNav = useMobileHeaderLinks({ mobileLinksOpen, setMobileLinksOpen, topHeaderRef });
  useEffect(() => {
    setMobileTradingScrolled(false);
  }, [activePage]);
  useEffect(() => {
    if (activePage !== 'trades' && activePage !== 'dex') return;

    const handleTradingScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const expectedScrollContainer = activePage === 'trades'
        ? '.standalone-trades-shell, .p2p-offers-workspace'
        : '.dex-v2-page';
      if (!target.matches(expectedScrollContainer)) return;
      if (target.scrollHeight <= target.clientHeight + 1) return;
      setMobileTradingScrolled(target.scrollTop > 12);
    };

    document.addEventListener('scroll', handleTradingScroll, true);
    return () => document.removeEventListener('scroll', handleTradingScroll, true);
  }, [activePage]);
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
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const notificationSuppressedContactAddressSetRef = useRef(notificationSuppressedContactAddressSet);
  notificationSuppressedContactAddressSetRef.current = notificationSuppressedContactAddressSet;

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
  const messagesByContactRef = useRef<Record<string, ChatMessage[]>>({});
  const directChatV2HistoryCaughtUpRef = useRef<Record<string, boolean>>({});
  const directChatV2PendingPeerHintsRef = useRef<Record<string, Set<string>>>({});
  const contactsRef = useRef<Contact[]>([]);
  const messagesByGroupRef = useRef<Record<string, ChatMessage[]>>({});
  const groupMessageLoadPhaseByGroupRef = useRef<Record<string, GroupMessageLoadPhase>>({});
  const prefetchedGroupMessagesRef = useRef<Record<string, boolean>>({});
  const groupsRef = useRef<GroupSummary[]>([]);
  const groupInvitesRef = useRef<GroupInvite[]>([]);
  const activeContactRef = useRef<string | null>(null);
  const activeGroupIdRef = useRef<number | null>(null);
  const getMemoSignerRef = useRef<() => Promise<{ signer: JsonRpcSigner; cacheKey: string }>>(async () => {
    throw new Error('Memo signer is not ready yet.');
  });
  const encodeMemoForActiveSignerRef = useRef<(plain: string) => string>((plain) => plain);
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
  const walletPreference = useStoredWalletPreference();
  const preferredBrowserWalletId = getPreferredBrowserWalletId(walletPreference);
  const setWalletAesHealth = useCallback((
    address: string,
    health: WalletAesHealthState,
    shouldCommit?: () => boolean
  ) => {
    const walletKey = address.trim().toLowerCase();
    if (!walletKey) {
      return;
    }
    setWalletAesHealthByAddress((previous) => {
      if (shouldCommit && !shouldCommit()) {
        return previous;
      }
      return previous[walletKey]?.status === health.status && previous[walletKey]?.message === health.message
        ? previous
        : {
            ...previous,
            [walletKey]: health
          };
    });
  }, []);
  const {
    activeProvider,
    activeSignerSource,
    activateBrowserWalletSession,
    assertBrowserWalletSignerLeaseCurrent,
    assertBrowserWalletSignerLeaseSnapshotCurrent,
    browserWalletSession,
    captureBrowserWalletSignerLease,
    chainId,
    connectingMethod,
    connectingWalletLabel,
    currentInjectedWalletOption,
    currentWalletKeyRef,
    disconnectWallet: disconnectWalletSession,
    ensureCotiNetwork,
    getConnectedProvider,
    injectedWalletOptions,
    preferredInjectedWalletOption,
    resolveWalletPromptProvider,
    sessionOnboardInfo,
    setChainId,
    setOnboardStatus,
    setSelectedInjectedWalletId,
    setSessionOnboardInfo,
    setStatus,
    walletAddress,
    onboardStatus
  } = useWalletOnboarding({
    loadMyNicknameFromChainRef,
    setError: setWalletOnboardingError,
    setMyNickname,
    onWalletAesHealthChange: setWalletAesHealth,
    walletAesHealthByAddress
  });
  const privacyReadyDesignQa = import.meta.env.DEV && typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('privacyQa') === 'ready';
  const privacyLockedDesignQa = import.meta.env.DEV && typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('privacyQa') === 'locked';
  useEffect(() => {
    if (!privacyReadyDesignQa || !walletAddress) return;
    const walletKey = walletAddress.toLowerCase();
    setSessionOnboardInfo((previous) => previous[walletKey]?.aesKey
      ? previous
      : { ...previous, [walletKey]: { aesKey: 'design-qa-owner-aes' } });
    setWalletAesHealth(walletAddress, {
      status: 'ready-unverified',
      updatedAt: Date.now(),
      walletKey
    });
  }, [privacyReadyDesignQa, setSessionOnboardInfo, setWalletAesHealth, walletAddress]);
  const chatReadCursorCloud = useChatReadCursorCloudSync({
    assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
    captureLease: captureBrowserWalletSignerLease,
    walletAddress
  });
  const handleSelectNetwork = useCallback(async (networkId: ChainWhisperActiveNetworkId) => {
    if (networkSwitching || networkId === COTI_NETWORK.id) return;
    if (CHAINWHISPER_NETWORK_SELECTION_LOCKED) {
      setError(`This build is locked to ${COTI_NETWORK.shortName}.`);
      return;
    }
    setNetworkSwitching(true);
    setError('');
    const previousNetworkId = COTI_NETWORK.id;
    try {
      storeChainWhisperNetworkId(networkId);
      const provider = getConnectedProvider();
      if (provider) {
        await ensureProviderOnNetwork(provider, getChainWhisperCotiNetwork(networkId));
      }
      window.location.reload();
    } catch (switchError) {
      try {
        storeChainWhisperNetworkId(previousNetworkId);
      } catch {
        // The original in-memory network remains authoritative until a successful reload.
      }
      setError(getProviderErrorMessage(switchError, 'Could not switch ChainWhisper network.'));
      setNetworkSwitching(false);
    }
  }, [getConnectedProvider, networkSwitching]);
  const generatedGroupJoinCodeForContext = getGeneratedGroupJoinCodeForContext(
    generatedGroupJoinCode,
    activeGroupId,
    walletAddress
  );
  const generatedGroupInviteCode = generatedGroupJoinCodeForContext?.inviteCode ?? '';
  const generatedGroupJoinCodeHash = generatedGroupJoinCodeForContext?.codeHash ?? '';
  const sharedWalletTransactionRuntimeRef = useRef({
    chainId,
    provider: activeProvider ?? browserWalletSession?.provider ?? null,
    providerKey: currentInjectedWalletOption?.id ?? browserWalletSession?.walletId ?? preferredBrowserWalletId,
    walletAddress
  });
  sharedWalletTransactionRuntimeRef.current = {
    chainId,
    provider: activeProvider ?? browserWalletSession?.provider ?? getConnectedProvider(),
    providerKey: currentInjectedWalletOption?.id ?? browserWalletSession?.walletId ?? preferredBrowserWalletId,
    walletAddress
  };
  const runSharedWalletTransactionFlow = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      const runtime = sharedWalletTransactionRuntimeRef.current;
      return runWalletTransactionFlow(
        {
          chainId: runtime.chainId,
          provider: runtime.provider,
          providerKey: runtime.providerKey,
          walletAddress: runtime.walletAddress
        },
        operation
      );
    },
    []
  );
  const walletHandoffEpochRef = useRef(0);
  const activateBrowserWalletSessionGuarded = useCallback(
    async (
      walletId?: string,
      options?: Parameters<typeof activateBrowserWalletSession>[1]
    ) => {
      walletHandoffEpochRef.current += 1;
      return runSharedWalletTransactionFlow(() => activateBrowserWalletSession(walletId, options));
    },
    [activateBrowserWalletSession, runSharedWalletTransactionFlow]
  );
  const [walletBalanceRefreshNonce, setWalletBalanceRefreshNonce] = useState(0);
  const {
    watchedTokens: watchedAccountTokens
  } = useWalletTokenWatchlist({
    chainId,
    walletAddress
  });
  const browserOwnerDataScopeKey = buildBrowserOwnerDataScopeKey(walletAddress);
  const disconnectWallet = useCallback(async () => {
    walletHandoffEpochRef.current += 1;
    await disconnectWalletSession();
  }, [disconnectWalletSession]);

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
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    messagesByContactRef.current = messagesByContact;
  }, [messagesByContact]);

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
    setGeneratedGroupJoinCode(null);
  }, [activeGroupId, browserOwnerDataScopeKey, setGeneratedGroupJoinCode]);
  useEffect(() => {
    setGroupRenameOpen(false);
    setGroupRenameInput('');
  }, [activeGroupId, browserOwnerDataScopeKey, setGroupRenameInput, setGroupRenameOpen]);

  useEffect(() => {
    setMobileGroupOptionsOpen(false);
    setGroupInviteMenuView('invite');
  }, [activeGroupId, browserOwnerDataScopeKey, isMobileNav, setGroupInviteMenuView, setMobileGroupOptionsOpen]);

  const isConnected = walletAddress.length > 0 || privacyLockedDesignQa;
  const onCotiNetwork = chainId === COTI_NETWORK.chainIdDecimal;
  const browserWalletLiteMode = false;
  const readStateFeaturesEnabled = true;
  const browserWalletLiteModeTitle = '';
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
    browserWalletAddress: browserWalletSession?.address,
    chainId,
    isActiveGroupAdmin,
    sessionOnboardInfo,
    walletAesHealthByAddress
  });
  useEffect(() => {
    if (!canManageActiveGroupJoinCodes && groupInviteMenuView !== 'invite') {
      setGroupInviteMenuView('invite');
    }
  }, [canManageActiveGroupJoinCodes, groupInviteMenuView]);
  const {
    getOwnerFundsSigner,
    runOwnerFundsTransactionFlow
  } = useAccountFundsSigners({
    assertBrowserWalletSignerLeaseCurrent,
    assertBrowserWalletSignerLeaseSnapshotCurrent,
    browserWalletSession,
    captureBrowserWalletSignerLease,
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
    setSessionOnboardInfo,
    setWalletAesHealth
  });
  const getOwnerMemoReadSigner = useCallback(
    (requirePrivacy: boolean) => getOwnerFundsSigner(requirePrivacy),
    [getOwnerFundsSigner]
  );
  const {
    ownerNativeBalanceWei,
    ownerLegacyPrivateRewardTokenBalanceWei,
    ownerPrivateRewardTokenBalanceWei,
    ownerRewardTokenBalanceWei,
    ownerTokenBalancesLoading
  } = useOwnerWalletBalances({
    chainId,
    getOwnerReadSigner: getOwnerMemoReadSigner,
    ownerAesReady,
    ownerWalletAddress,
    refreshNonce: walletBalanceRefreshNonce,
    includeCustomTokens: false
  });
  const wispPortalWalletAddress = ownerWalletAddress;
  const wispPortalHasAesReady = ownerAesReady;
  const selectedPrivacyPair = getPrivacyTokenPair(selectedPrivacyPairId) ?? PRIVACY_TOKEN_PAIRS[0];
  const wispPortalLoadingRewardBalances = ownerTokenBalancesLoading;
  const wispPortalRewardTokenBalanceWei = ownerRewardTokenBalanceWei;
  const wispPortalPrivateRewardTokenBalanceWei = ownerPrivateRewardTokenBalanceWei;
  const wispPortalLegacyPrivateRewardTokenBalanceWei = ownerLegacyPrivateRewardTokenBalanceWei;
  const findContactNameForWalletAddress = useCallback((address?: string): string | undefined => {
    if (!address) return undefined;
    const key = address.toLowerCase();
    return contacts.find((contact) => contact.address.toLowerCase() === key)?.name ??
      onChainNicknameCacheRef.current[key] ?? undefined;
  }, [contacts]);
  const {
    activeSwapVaultContractAddress,
    legacySwapVaultContractUrl,
    wispBridgeContractUrl,
    canEarlierLegacyUnshieldTokens,
    canLegacyUnshieldTokens,
    canShieldTokens,
    canSwapRewardTokens,
    canUnshieldTokens,
    currentSwapDirectionEnabled,
    parsedSwapAmount,
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

  const [directChatV2Runtime, setDirectChatV2Runtime] = useState<DirectChatV2Runtime | null>(null);
  useEffect(() => {
    const provider = browserWalletSession?.provider;
    if (!provider) return;
    return () => releaseOwnerCotiMetaMaskProviderPool(provider);
  }, [browserWalletSession?.provider]);
  const [directTradeV2Runtime, setDirectTradeV2Runtime] = useState<DirectTradeV2Runtime | null>(null);
  const directTradeNotificationScope = useMemo(() => directTradeV2Runtime?.isCurrent() ? Object.freeze({
    chainId: directTradeV2Runtime.deployment.chainId,
    contractAddress: directTradeV2Runtime.contractAddress,
    supportedContracts: directTradeV2Runtime.supportedContracts,
    ownerAddress: directTradeV2Runtime.ownerAddress
  }) : null, [directTradeV2Runtime]);
  const {
    items: directTradeNotificationItems,
    unreadCount: directTradeNotificationUnreadCount,
    ingest: ingestDirectTradeNotifications,
    markRead: markDirectTradeNotificationRead,
    clear: clearDirectTradeNotifications
  } = useDirectTradeNotifications(directTradeNotificationScope);
  const [otcV2Runtime, setOtcV2Runtime] = useState<OtcTradeHistoryV2Runtime | null>(null);
  const [otcV2ActionRuntime, setOtcV2ActionRuntime] = useState<OtcV2ActionRuntime | null>(null);
  const [otcV2HistorySetupError, setOtcV2HistorySetupError] = useState('');
  const [otcV2ActionSetupError, setOtcV2ActionSetupError] = useState('');
  const [groupChatV2Runtime, setGroupChatV2Runtime] = useState<GroupChatV2Runtime | null>(null);
  const [groupChatV2EpochSyncRequest, setGroupChatV2EpochSyncRequest] = useState<Readonly<{
    groupId: number;
    epoch: bigint;
  }> | null>(null);
  const [synchronizingGroupChatV2Epoch, setSynchronizingGroupChatV2Epoch] = useState(false);
  const [groupChatV2HistoryRefreshNonce, setGroupChatV2HistoryRefreshNonce] = useState(0);
  const groupChatV2RefreshRef = useRef<(() => void) | null>(null);
  const directChatV2RefreshRef = useRef<(() => void) | null>(null);
  const [groupChatV2DiscoveryView, setGroupChatV2DiscoveryView] = useState<{
    runtime: GroupChatV2Runtime; state: 'loading' | 'ready' | 'error'; refreshing: boolean;
  } | null>(null);
  const [directChatV2RefreshView, setDirectChatV2RefreshView] = useState<{
    runtime: DirectChatV2Runtime; peer: string; refreshing: boolean;
  } | null>(null);
  const startGroupChatV2HistoryLoad = useCallback((groupId: number) => {
    setGroupMessageLoadPhase(groupId, messagesByGroupRef.current[String(groupId)]?.length ? 'history' : 'initial');
  }, [setGroupMessageLoadPhase]);
  const refreshGroupChatV2 = () => {
    groupChatV2RefreshRef.current?.();
    setGroupChatV2HistoryRefreshNonce(previous => previous + 1);
  };
  const isGroupChatV2ScopeCurrent = useCallback(
    () => groupChatV2Runtime?.isCurrent() ?? false,
    [groupChatV2Runtime]
  );
  const [chatReactionsV1Runtime, setChatReactionsV1Runtime] = useState<ChatReactionsV1Runtime | null>(null);
  const [chatReactionsV1RuntimeError, setChatReactionsV1RuntimeError] = useState('');
  const browserRuntimeDependenciesRef = useRef({
    assertBrowserWalletSignerLeaseSnapshotCurrent,
    captureBrowserWalletSignerLease,
    hasAesReady,
    runOwnerFundsTransactionFlow,
    setSessionOnboardInfo,
    walletAddress
  });
  browserRuntimeDependenciesRef.current = {
    assertBrowserWalletSignerLeaseSnapshotCurrent,
    captureBrowserWalletSignerLease,
    hasAesReady,
    runOwnerFundsTransactionFlow,
    setSessionOnboardInfo,
    walletAddress
  };
  const directChatV2RuntimeScopeKey = useMemo(
    () => DIRECT_CHAT_V2_DEPLOYMENT_CONFIG.status === 'active'
      ? buildBrowserWalletRuntimeScopeKey({
          activeSignerSource,
          deploymentFingerprint: DIRECT_CHAT_V2_DEPLOYMENT_CONFIG.fingerprint,
          expectedChainId: DIRECT_CHAT_V2_DEPLOYMENT_CONFIG.manifest.chainId,
          session: browserWalletSession,
          walletAddress
        })
      : null,
    [activeSignerSource, browserWalletSession, walletAddress]
  );
  const otcV2RuntimeScopeKey = useMemo(
    () => OTC_V2_DEPLOYMENT_CATALOG.status === 'active'
      ? buildBrowserWalletRuntimeScopeKey({
          activeSignerSource,
          deploymentFingerprint: OTC_V2_DEPLOYMENT_CATALOG.fingerprint,
          expectedChainId: BigInt(OTC_V2_DEPLOYMENT_CATALOG.chainId),
          session: browserWalletSession,
          variant: hasAesReady ? 'private' : 'public',
          walletAddress
        })
      : null,
    [activeSignerSource, browserWalletSession, hasAesReady, walletAddress]
  );
  const directTradeV2RuntimeScopeKey = useMemo(
    () => DIRECT_TRADE_V2_DEPLOYMENT_CONFIG.status === 'active'
      ? buildBrowserWalletRuntimeScopeKey({
          activeSignerSource,
          deploymentFingerprint: DIRECT_TRADE_V2_DEPLOYMENT_CONFIG.fingerprint,
          expectedChainId: BigInt(DIRECT_TRADE_V2_DEPLOYMENT_CONFIG.manifest.chainId),
          session: browserWalletSession,
          walletAddress
        })
      : null,
    [activeSignerSource, browserWalletSession, walletAddress]
  );
  const groupChatV2RuntimeScopeKey = useMemo(
    () => GROUP_CHAT_V2_DEPLOYMENT_CONFIG.status === 'active' && hasAesReady
      ? buildBrowserWalletRuntimeScopeKey({
          activeSignerSource,
          deploymentFingerprint: GROUP_CHAT_V2_DEPLOYMENT_CONFIG.fingerprint,
          expectedChainId: GROUP_CHAT_V2_DEPLOYMENT_CONFIG.manifest.chainId,
          session: browserWalletSession,
          variant: 'privacy-ready',
          walletAddress
        })
      : null,
    [activeSignerSource, browserWalletSession, hasAesReady, walletAddress]
  );
  const chatReactionsV1RuntimeScopeKey = useMemo(
    () => buildChatReactionsV1RuntimeScopeKey({
      activeSignerSource,
      config: CHAT_REACTIONS_V1_DEPLOYMENT_CONFIG,
      session: browserWalletSession,
      walletAddress
    }),
    [activeSignerSource, browserWalletSession, walletAddress]
  );
  const directTradeV2OnboardInfoRef = useRef(sessionOnboardInfo);
  directTradeV2OnboardInfoRef.current = sessionOnboardInfo;
  const ownerTradeOnboardInfoRef = useRef(sessionOnboardInfo);
  ownerTradeOnboardInfoRef.current = sessionOnboardInfo;
  const directChatV2OnboardInfoRef = useRef(sessionOnboardInfo);
  directChatV2OnboardInfoRef.current = sessionOnboardInfo;
  const groupChatV2OnboardInfoRef = useRef(sessionOnboardInfo);
  groupChatV2OnboardInfoRef.current = sessionOnboardInfo;
  const groupChatV2ReadCursorRef = useRef<Record<string, GroupChatV2ReadCursor>>({});
  const groupChatV2LatestIncomingRef = useRef<Record<string, GroupChatV2ReadCursorAnchor>>({});
  const groupChatV2DiscoveryCaughtUpRef = useRef<Record<string, boolean>>({});
  const directChatV2LoadedContactSettingsRef = useRef<{
    runtime: DirectChatV2Runtime | null;
    addresses: Set<string>;
  }>({ runtime: null, addresses: new Set() });
  const [directChatV2NativeCredit, setDirectChatV2NativeCredit] = useState<bigint | null>(null);
  const [withdrawingDirectChatV2NativeCredit, setWithdrawingDirectChatV2NativeCredit] = useState(false);
  const [rotatingDirectChatV2Key, setRotatingDirectChatV2Key] = useState(false);
  useEffect(() => {
    let disposed = false;
    let createdRuntime: DirectChatV2Runtime | null = null;
    setDirectChatV2Runtime(null);
    if (DIRECT_CHAT_V2_DEPLOYMENT_CONFIG.status !== 'active' || !directChatV2RuntimeScopeKey) {
      return () => {
        disposed = true;
      };
    }
    const deploymentConfig = DIRECT_CHAT_V2_DEPLOYMENT_CONFIG;
    const ownerAddress = browserRuntimeDependenciesRef.current.walletAddress;
    Promise.all([
      import('./lib/directChatV2Runtime'),
      import('./lib/directChatV2WriteCoordinator'),
      import('./features/wallet/directChatV2MetaMaskCapability'),
      chatReadCursorCloud.session
        ? import('./lib/chatReadCursorCloudStores')
        : Promise.resolve(null)
    ]).then(([runtimeModule, writeModule, capabilityModule, cloudStoreModule]) => {
      if (disposed) return;
      createdRuntime = runtimeModule.createDirectChatV2Runtime({
        cursorStore: cloudStoreModule && chatReadCursorCloud.session
          ? cloudStoreModule.createCloudSyncedDirectChatV2ReadCursorStore({
              onCloudError: chatReadCursorCloud.reportCloudError,
              session: chatReadCursorCloud.session
            })
          : undefined,
        deploymentConfig,
        getOwnerCapability: async (requirePrivacy) => {
          const dependencies = browserRuntimeDependenciesRef.current;
          const lease = dependencies.captureBrowserWalletSignerLease();
          return capabilityModule.issueDirectChatV2MetaMaskCapability({
            // Direct Chat uses the captured event-backed lease for preparation
            // and lets the guarded provider check that snapshot immediately at
            // eth_sendTransaction. Avoid redundant extension RPC probes: they
            // were crashing MetaMask on COTI Testnet after successful sends.
            assertLeaseCurrent: async (lease) =>
              dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent(lease),
            assertLeaseSnapshotCurrent: dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent,
            commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
              dependencies.setSessionOnboardInfo((previous) => mergeLeaseScopedOnboardInfo(
                previous,
                cacheKey,
                onboardInfo,
                assertCurrent
              ));
            },
            expectedChainId: deploymentConfig.manifest.chainId,
            expectedOwnerAddress: lease.address,
            lease,
            requirePrivacy,
            sessionOnboardInfo: directChatV2OnboardInfoRef.current
          });
        },
        lifecycle: {
          onOptimistic: (update) => {
            setMessagesByContact((previous) =>
              writeModule.appendDirectChatV2OptimisticMessage(previous, update)
            );
            setContacts((previous) => mergeUniqueContacts(previous, [update.contactKey]));
          },
          onReceipt: (update) => {
            setMessagesByContact((previous) =>
              writeModule.applyDirectChatV2ReceiptUpdate(previous, update)
            );
            setContacts((previous) => mergeUniqueContacts(previous, [update.contactKey]));
            const ownerKey = ownerAddress.toLowerCase();
            const pendingPeers = directChatV2PendingPeerHintsRef.current[ownerKey] ?? new Set<string>();
            pendingPeers.add(update.contactKey.toLowerCase());
            directChatV2PendingPeerHintsRef.current[ownerKey] = pendingPeers;
          },
          onFailure: (update) => {
            setMessagesByContact((previous) =>
              writeModule.failDirectChatV2OptimisticMessage(previous, update)
            );
          }
        },
        ownerAddress,
        runOwnerTransactionFlow: (operation) =>
          browserRuntimeDependenciesRef.current.runOwnerFundsTransactionFlow(operation)
      });
      if (!disposed) setDirectChatV2Runtime(createdRuntime);
      else createdRuntime.close();
    }).catch(() => {
      if (!disposed) setDirectChatV2Runtime(null);
    });
    return () => {
      disposed = true;
      createdRuntime?.close();
    };
  }, [
    chatReadCursorCloud.reportCloudError,
    chatReadCursorCloud.session,
    directChatV2RuntimeScopeKey
  ]);
  useEffect(() => {
    let disposed = false;
    let createdRuntime: OtcTradeHistoryV2Runtime | null = null;
    let setupReadNumber = 0;
    const reportSetupPhase = (phase: string): void => {
      if (import.meta.env.DEV && !disposed) {
        document.documentElement.setAttribute('data-p2p-history-setup', phase);
      }
    };
    setOtcV2Runtime(null);
    setOtcV2HistorySetupError('');
    if (OTC_V2_DEPLOYMENT_CATALOG.status !== 'active' || !otcV2RuntimeScopeKey) {
      setOtcV2HistorySetupError(OTC_V2_DEPLOYMENT_CATALOG.status === 'invalid'
        ? OTC_V2_DEPLOYMENT_CATALOG.error
        : OTC_V2_DEPLOYMENT_CATALOG.status !== 'active'
          ? 'P2P deployment is not configured.'
          : 'P2P needs a current wallet session on the configured network. Connect the wallet to continue.');
      return () => { disposed = true; };
    }
    const catalog = OTC_V2_DEPLOYMENT_CATALOG;
    const ownerAddress = browserRuntimeDependenciesRef.current.walletAddress;
    const privateReadsEnabled = browserRuntimeDependenciesRef.current.hasAesReady;
    reportSetupPhase('module');
    void import('./lib/otcTradeHistoryV2Runtime').then(async (runtimeModule) => {
      if (disposed) return;
      const dependencies = browserRuntimeDependenciesRef.current;
      const lease = dependencies.captureBrowserWalletSignerLease();
      reportSetupPhase('read-provider');
      const readProvider = await loadCotiReadProvider(true);
      reportSetupPhase('history-runtime');
      createdRuntime = await runtimeModule.createOtcTradeHistoryV2Runtime({
        catalog,
        ownerAddress,
        provider: {
          request: ({ method, params }) => {
            if (import.meta.env.DEV) {
              const safeMethod = ['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method)
                ? method : 'other';
              reportSetupPhase(`rpc-${safeMethod}-${++setupReadNumber}`);
            }
            return readProvider.send(method, Array.isArray(params) ? [...params] : []);
          }
        },
        assertCurrent: () => dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent(lease),
        getOwnerCapability: privateReadsEnabled
          ? () => issueOtcV2MetaMaskCapability({
              assertLeaseCurrent: async (currentLease) =>
                browserRuntimeDependenciesRef.current.assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
              assertLeaseSnapshotCurrent:
                browserRuntimeDependenciesRef.current.assertBrowserWalletSignerLeaseSnapshotCurrent,
              commitOnboardInfo: ({ assertCurrent: assertSnapshot, onboardInfo, walletAddress: cacheKey }) => {
                browserRuntimeDependenciesRef.current.setSessionOnboardInfo((previous) => mergeLeaseScopedOnboardInfo(
                  previous,
                  cacheKey,
                  onboardInfo,
                  assertSnapshot
                ));
              },
              expectedChainId: BigInt(catalog.chainId),
              expectedOwnerAddress: ownerAddress,
              lease,
              requirePrivacy: true,
              sessionOnboardInfo: ownerTradeOnboardInfoRef.current
            })
          : undefined
      });
      if (!disposed) {
        reportSetupPhase('ready');
        setOtcV2Runtime(createdRuntime);
      }
      else createdRuntime.close();
    }).catch((cause) => {
      createdRuntime?.close();
      if (!disposed) {
        reportSetupPhase('failed');
        setOtcV2Runtime(null);
        setOtcV2HistorySetupError(`P2P history setup: ${getProviderErrorMessage(cause, 'Verified history is unavailable.')}`);
      }
    });
    return () => {
      disposed = true;
      createdRuntime?.close();
    };
  }, [otcV2RuntimeScopeKey]);
  useEffect(() => {
    let disposed = false;
    let createdRuntime: DirectTradeV2Runtime | null = null;
    setDirectTradeV2Runtime(null);
    if (DIRECT_TRADE_V2_DEPLOYMENT_CONFIG.status !== 'active' || !directTradeV2RuntimeScopeKey) {
      return () => { disposed = true; };
    }
    const deploymentConfig = DIRECT_TRADE_V2_DEPLOYMENT_CONFIG;
    const ownerAddress = browserRuntimeDependenciesRef.current.walletAddress;
    void Promise.all([
      import('./lib/directTradeV2Runtime'),
      import('./features/wallet/directTradeV2MetaMaskCapability')
    ]).then(async ([runtimeModule, capabilityModule]) => {
      if (disposed) return;
      const readProvider = await loadCotiReadProvider(true);
      createdRuntime = await runtimeModule.createDirectTradeV2Runtime({
        config: deploymentConfig,
        ownerAddress,
        provider: {
          request: ({ method, params }) => readProvider.send(
            method,
            Array.isArray(params) ? [...params] : []
          )
        },
        assertCurrent: () => undefined,
        getOwnerCapability: (requirePrivacy) => {
          const dependencies = browserRuntimeDependenciesRef.current;
          const lease = dependencies.captureBrowserWalletSignerLease();
          return capabilityModule.issueDirectTradeV2MetaMaskCapability({
            assertLeaseCurrent: async (currentLease) =>
              dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
            assertLeaseSnapshotCurrent: dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent,
            commitOnboardInfo: ({ assertCurrent: assertSnapshot, onboardInfo, walletAddress: cacheKey }) => {
              dependencies.setSessionOnboardInfo((previous) => mergeLeaseScopedOnboardInfo(
                previous,
                cacheKey,
                onboardInfo,
                assertSnapshot
              ));
            },
            expectedChainId: BigInt(deploymentConfig.manifest.chainId),
            expectedOwnerAddress: ownerAddress,
            lease,
            requirePrivacy,
            sessionOnboardInfo: directTradeV2OnboardInfoRef.current
          });
        },
        runOwnerTransactionFlow: (operation) =>
          browserRuntimeDependenciesRef.current.runOwnerFundsTransactionFlow(operation)
      });
      if (!disposed) setDirectTradeV2Runtime(createdRuntime);
      else createdRuntime.close();
    }).catch(() => {
      createdRuntime?.close();
      if (!disposed) setDirectTradeV2Runtime(null);
    });
    return () => {
      disposed = true;
      createdRuntime?.close();
    };
  }, [directTradeV2RuntimeScopeKey]);
  useEffect(() => {
    let disposed = false;
    let createdRuntime: ChatReactionsV1Runtime | null = null;
    setChatReactionsV1Runtime(null);
    setChatReactionsV1RuntimeError('');
    if (CHAT_REACTIONS_V1_DEPLOYMENT_CONFIG.status !== 'active' || !chatReactionsV1RuntimeScopeKey) {
      return () => {
        disposed = true;
      };
    }
    const deploymentConfig = CHAT_REACTIONS_V1_DEPLOYMENT_CONFIG;
    void Promise.all([
      import('./lib/chatReactionsV1Runtime'),
      import('./features/wallet/chatReactionsV1MetaMaskCapability')
    ]).then(async ([runtimeModule, capabilityModule]) => {
      if (disposed) return;
      const getOwnerCapability = () => {
        const dependencies = browserRuntimeDependenciesRef.current;
        const lease = dependencies.captureBrowserWalletSignerLease();
        return capabilityModule.issueChatReactionsV1MetaMaskCapability({
          // Reaction preparation uses the already captured event-backed lease.
          // Avoid redundant extension RPC probes around the one wallet send;
          // the guarded provider still validates the snapshot at request time.
          assertLeaseCurrent: async (currentLease) =>
            dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
          assertLeaseSnapshotCurrent: dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent,
          expectedChainId: deploymentConfig.manifest.chainId,
          expectedOwnerAddress: lease.address,
          lease
        });
      };
      const readProvider = await loadCotiReadProvider(true);
      if (disposed) return;
      createdRuntime = await runtimeModule.createChatReactionsV1Runtime({
        config: deploymentConfig,
        getOwnerCapability,
        readProvider,
        runOwnerTransactionFlow: (operation) =>
          browserRuntimeDependenciesRef.current.runOwnerFundsTransactionFlow(operation)
      });
      if (!disposed) setChatReactionsV1Runtime(createdRuntime);
      else createdRuntime.close();
    }).catch((runtimeError) => {
      createdRuntime?.close();
      if (!disposed) {
        setChatReactionsV1Runtime(null);
        setChatReactionsV1RuntimeError(getOnChainFailureMessage(
          runtimeError,
          'Chat reactions could not verify the current testnet deployment.'
        ));
      }
    });
    return () => {
      disposed = true;
      createdRuntime?.close();
    };
  }, [chatReactionsV1RuntimeScopeKey]);
  const {
    enabled: chatReactionsV1Enabled,
    states: chatReactionsV1States,
    submitReaction: submitChatReactionV1,
    syncError: chatReactionsV1SyncError
  } = useChatReactionsV1Runtime({
    activeThreadMessages,
    runtime: chatReactionsV1Runtime
  });
  const {
    getReactionsForMessage,
    isReactionOnlyMessage
  } = useMessageReactions({
    activeContact,
    activeGroupId,
    activeThreadMessages,
    chatReactionsV1States,
    walletAddress
  });
  useEffect(() => {
    let disposed = false;
    let createdRuntime: GroupChatV2Runtime | null = null;
    setGroupChatV2Runtime(null);
    if (GROUP_CHAT_V2_DEPLOYMENT_CONFIG.status !== 'active' || !groupChatV2RuntimeScopeKey) {
      return () => {
        disposed = true;
      };
    }
    const deploymentConfig = GROUP_CHAT_V2_DEPLOYMENT_CONFIG;
    const ownerAddress = browserRuntimeDependenciesRef.current.walletAddress;
    Promise.all([
      import('./lib/groupChatV2Runtime'),
      import('./features/wallet/groupChatV2MetaMaskCapability'),
      chatReadCursorCloud.session
        ? import('./lib/chatReadCursorCloudStores')
        : Promise.resolve(null)
    ]).then(([runtimeModule, capabilityModule, cloudStoreModule]) => {
      if (disposed) return;
      createdRuntime = runtimeModule.createGroupChatV2Runtime({
        deploymentConfig,
        getOwnerCapability: async (requirePrivacy) => {
          const dependencies = browserRuntimeDependenciesRef.current;
          const lease = dependencies.captureBrowserWalletSignerLease();
          return capabilityModule.issueGroupChatV2MetaMaskCapability({
            assertLeaseCurrent: async (currentLease) =>
              dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
            assertLeaseSnapshotCurrent: dependencies.assertBrowserWalletSignerLeaseSnapshotCurrent,
            commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
              dependencies.setSessionOnboardInfo((previous) => mergeLeaseScopedOnboardInfo(
                previous,
                cacheKey,
                onboardInfo,
                assertCurrent
              ));
            },
            expectedChainId: deploymentConfig.manifest.chainId,
            expectedOwnerAddress: lease.address,
            lease,
            requirePrivacy,
            sessionOnboardInfo: groupChatV2OnboardInfoRef.current
          });
        },
        ownerAddress,
        readCursorStore: cloudStoreModule && chatReadCursorCloud.session
          ? cloudStoreModule.createCloudSyncedGroupChatV2ReadCursorStore({
              onCloudError: chatReadCursorCloud.reportCloudError,
              session: chatReadCursorCloud.session
            })
          : undefined,
        runOwnerTransactionFlow: (operation) =>
          browserRuntimeDependenciesRef.current.runOwnerFundsTransactionFlow(operation)
      });
      if (!disposed) setGroupChatV2Runtime(createdRuntime);
      else createdRuntime.close();
    }).catch(() => {
      if (!disposed) setGroupChatV2Runtime(null);
    });
    return () => {
      disposed = true;
      createdRuntime?.close();
    };
  }, [
    chatReadCursorCloud.reportCloudError,
    chatReadCursorCloud.session,
    groupChatV2RuntimeScopeKey
  ]);
  useEffect(() => {
    if (groupChatV2Runtime?.enabled) setGroupFeeModeSelection('coti');
  }, [groupChatV2Runtime?.enabled, setGroupFeeModeSelection]);
  useEffect(() => {
    const runtime = groupChatV2Runtime;
    const privacyLocked =
      GROUP_CHAT_V2_DEPLOYMENT_CONFIG.status === 'active' && !hasAesReady;
    if (!runtime?.enabled && !privacyLocked) return;
    activeGroupIdRef.current = null;
    groupInvitesRef.current = [];
    groupsRef.current = [];
    setActiveGroupId(null);
    setGroupInvites([]);
    setGroups([]);
    setMessagesByGroup({});
    setGroupChatV2EpochSyncRequest(null);
    setSynchronizingGroupChatV2Epoch(false);
    groupChatV2ReadCursorRef.current = {};
    groupChatV2LatestIncomingRef.current = {};
    groupChatV2DiscoveryCaughtUpRef.current = {};
    unreadGroupMapRef.current = {};
    setUnreadGroupMap({});
  }, [
    groupChatV2Runtime?.enabled,
    hasAesReady,
    setActiveGroupId,
    setGroupInvites,
    setGroups,
    setMessagesByGroup,
    setUnreadGroupMap
  ]);
  const getGroupChatV2ReadCursorContext = useCallback((groupId: number) => {
    const runtime = groupChatV2Runtime;
    const config = GROUP_CHAT_V2_DEPLOYMENT_CONFIG;
    if (!runtime?.enabled || config.status !== 'active' || groupId <= 0) {
      throw new Error('Group Chat V2 read-cursor scope is inactive.');
    }
    const selectedGroupId = BigInt(groupId);
    const scope: GroupChatV2ReadCursorScope = {
      chainId: runtime.session.manifest.chainId,
      contractAddress: runtime.session.manifest.contractAddress,
      walletAddress: runtime.session.ownerAddress,
      groupId: selectedGroupId
    };
    const safeHead = async (): Promise<bigint> => {
      const latest = await runtime.session.latestBlock();
      if (latest <= config.finalityLagBlocks) {
        throw new Error('Group Chat V2 has no finalized cursor head yet.');
      }
      return latest - config.finalityLagBlocks;
    };
    return {
      scope,
      context: {
        getCanonicalMessageCount: async () => runtime.session.messageCountAtBlock(
          selectedGroupId,
          await safeHead()
        ),
        readCanonicalAnchor: (messageId: bigint, blockNumber: bigint) =>
          runtime.session.readMessageAnchor(selectedGroupId, messageId, blockNumber)
      }
    };
  }, [groupChatV2Runtime]);
  useEffect(() => {
    const runtime = groupChatV2Runtime;
    if (!runtime?.enabled || !hasAesReady) return;
    let disposed = false;
    let timer: number | undefined;
    let inFlight = false;
    let wakeRequested = false;
    let cursorRecoveryInFlight = false;
    const cursorSubscriptions = new Map<string, () => void>();
    const isCurrent = () => !disposed && runtime.isCurrent();
    const schedule = (delayMs: number) => {
      if (!isCurrent()) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void sync(); }, delayMs);
    };
    const requestRefresh = () => {
      if (!isCurrent()) return;
      setGroupChatV2DiscoveryView(previous => ({
        runtime, state: previous?.runtime === runtime ? previous.state : 'loading', refreshing: true
      }));
      if (inFlight) wakeRequested = true;
      else schedule(0);
    };
    groupChatV2RefreshRef.current = requestRefresh;
    const sync = async () => {
      if (!isCurrent() || inFlight) return;
      inFlight = true;
      try {
        const result = await runtime.discovery.sync();
        if (!isCurrent()) return;
        const nextGroups = [...result.groups];
        const nextInvites = [...result.invites];
        // The verified list does not depend on remote unread-cursor recovery.
        groupsRef.current = nextGroups;
        groupInvitesRef.current = nextInvites;
        setGroups(nextGroups);
        setGroupInvites(nextInvites);
        setGroupChatV2DiscoveryView(previous => ({
          runtime, state: result.complete ? 'ready' : 'loading',
          refreshing: previous?.runtime === runtime && previous.refreshing
        }));
        if (
          result.complete && activeGroupIdRef.current !== null &&
          !nextGroups.some(group => group.id === activeGroupIdRef.current)
        ) {
          activeGroupIdRef.current = null;
          setActiveGroupId(null);
        }
        const nextLatestIncoming: Record<string, GroupChatV2ReadCursorAnchor> = {};
        for (const item of result.latestIncoming) {
          nextLatestIncoming[item.groupId.toString()] = item.anchor;
        }
        groupChatV2LatestIncomingRef.current = nextLatestIncoming;
        groupChatV2DiscoveryCaughtUpRef.current = Object.fromEntries(
          nextGroups.map((group) => [String(group.id), result.complete])
        );
        // Unread recovery has its own bounded store reads. It must not hold
        // discovery, selected history or the Refresh control behind a cloud read.
        if (!cursorRecoveryInFlight) {
          cursorRecoveryInFlight = true;
          void (async () => {
            try {
              const cursorEntries = await Promise.all(result.latestIncoming.map(async ({ groupId, anchor }) => {
                const numericGroupId = Number(groupId);
                if (!Number.isSafeInteger(numericGroupId) || numericGroupId <= 0) {
                  throw new Error('Group Chat V2 unread group ID is outside the UI range.');
                }
                const { scope, context } = getGroupChatV2ReadCursorContext(numericGroupId);
                const cursor = await runtime.readCursors.loadCanonical(scope, context);
                return { groupKey: groupId.toString(), cursor, anchor, scope, context };
              }));
              if (disposed || !runtime.isCurrent()) return;
              const nextUnreadGroups: Record<string, boolean> = {};
              const incomingGroupKeys = new Set(cursorEntries.map(({ groupKey }) => groupKey));
              for (const [groupKey, unsubscribe] of cursorSubscriptions) {
                if (!incomingGroupKeys.has(groupKey)) {
                  unsubscribe();
                  cursorSubscriptions.delete(groupKey);
                }
              }
              for (const { groupKey, cursor, anchor, scope, context } of cursorEntries) {
                groupChatV2ReadCursorRef.current[groupKey] = cursor;
                const latestIncoming = groupChatV2LatestIncomingRef.current[groupKey] ?? anchor;
                if (latestIncoming.messageId > BigInt(cursor.lastReadMessageId)) nextUnreadGroups[groupKey] = true;
                else delete nextUnreadGroups[groupKey];
                if (!cursorSubscriptions.has(groupKey)) {
                  cursorSubscriptions.set(groupKey, runtime.readCursors.subscribe(
                    scope,
                    context,
                    (nextCursor) => {
                      if (disposed || !runtime.isCurrent()) return;
                      groupChatV2ReadCursorRef.current[groupKey] = nextCursor;
                      const latestIncoming = groupChatV2LatestIncomingRef.current[groupKey];
                      setUnreadGroupMap((previous) => {
                        const next = { ...previous };
                        if (latestIncoming && latestIncoming.messageId > BigInt(nextCursor.lastReadMessageId)) {
                          next[groupKey] = true;
                        } else {
                          delete next[groupKey];
                        }
                        unreadGroupMapRef.current = next;
                        return next;
                      });
                    }
                  ));
                }
              }
              unreadGroupMapRef.current = nextUnreadGroups;
              setUnreadGroupMap(nextUnreadGroups);
            } catch {
              // Keep known unread state; the next overview pass can retry.
            } finally {
              cursorRecoveryInFlight = false;
            }
          })();
        }
        schedule(result.complete ? 5_000 : 0);
      } catch {
        if (isCurrent()) {
          setGroupChatV2DiscoveryView({ runtime, state: 'error', refreshing: false });
        }
        schedule(5_000);
      } finally {
        inFlight = false;
        if (isCurrent()) {
          if (wakeRequested) {
            wakeRequested = false;
            schedule(0);
          } else {
            setGroupChatV2DiscoveryView(previous => previous?.runtime === runtime
              ? { ...previous, refreshing: false } : previous);
          }
        }
      }
    };
    void sync();
    return () => {
      disposed = true;
      if (groupChatV2RefreshRef.current === requestRefresh) groupChatV2RefreshRef.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
      for (const unsubscribe of cursorSubscriptions.values()) unsubscribe();
      cursorSubscriptions.clear();
    };
  }, [
    getGroupChatV2ReadCursorContext,
    groupChatV2Runtime,
    hasAesReady,
    setActiveGroupId,
    setGroupInvites,
    setGroups,
    setUnreadGroupMap
  ]);
  const { historyUnavailable: groupChatV2HistoryUnavailable } = useGroupChatV2History({
    runtime: groupChatV2Runtime,
    activeGroupId,
    activeGroupIdRef,
    hasAesReady,
    refreshNonce: groupChatV2HistoryRefreshNonce,
    setMessagesByGroup,
    setEpochSyncRequest: setGroupChatV2EpochSyncRequest,
    onLoadStart: startGroupChatV2HistoryLoad,
    onLoadEnd: clearGroupMessageLoadPhase
  });

  const synchronizeGroupChatV2Epoch = useCallback(async () => {
    const runtime = groupChatV2Runtime;
    const request = groupChatV2EpochSyncRequest;
    if (!runtime?.enabled || !request || processingGroupAction) return;
    if (activeGroupIdRef.current !== request.groupId) return;

    setProcessingGroupAction(true);
    setSynchronizingGroupChatV2Epoch(true);
    setError('');
    try {
      await runtime.session.syncEpoch(BigInt(request.groupId), request.epoch);
      if (!runtime.isCurrent() || activeGroupIdRef.current !== request.groupId) return;
      runtime.history.clearGroup(BigInt(request.groupId));
      setGroupChatV2EpochSyncRequest(null);
      setGroupChatV2HistoryRefreshNonce((previous) => previous + 1);
    } catch (syncError) {
      setError(getGroupActionErrorMessage(
        syncError,
        'The group privacy key was not synchronized. Retry this wallet transaction.'
      ));
    } finally {
      setSynchronizingGroupChatV2Epoch(false);
      setProcessingGroupAction(false);
    }
  }, [
    groupChatV2EpochSyncRequest,
    groupChatV2Runtime,
    processingGroupAction,
    setProcessingGroupAction
  ]);
  useEffect(() => {
    const runtime = directChatV2Runtime;
    setDirectChatV2NativeCredit(null);
    if (!runtime?.enabled || !runtime.session) return;
    let disposed = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const credit = await runtime.session.readNativeCredit();
        if (!disposed && runtime.isCurrent()) setDirectChatV2NativeCredit(credit);
      } catch {
        if (!disposed) setDirectChatV2NativeCredit(null);
      } finally {
        if (!disposed) timer = window.setTimeout(() => { void refresh(); }, 30_000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [directChatV2Runtime]);
  useEffect(() => {
    // An in-flight send belongs to the exact runtime that started it. Replacing
    // that runtime must not leave the compose UI permanently locked.
    sendingRef.current = false;
    setSending(false);
  }, [directChatV2Runtime, setSending]);
  useEffect(() => {
    if (directChatV2Runtime?.enabled) setTipTokenSelection('coti');
  }, [directChatV2Runtime, setTipTokenSelection]);
  const withdrawDirectChatV2NativeCredit = useCallback(async () => {
    const runtime = directChatV2Runtime;
    if (!runtime?.enabled || !runtime.session || withdrawingDirectChatV2NativeCredit) return;
    setError('');
    setWithdrawingDirectChatV2NativeCredit(true);
    try {
      const result = await runtime.session.withdrawNativeCredit();
      if (!runtime.isCurrent()) return;
      setDirectChatV2NativeCredit(result.remainingCredit);
      setWalletBalanceRefreshNonce((previous) => previous + 1);
      setStatus(`Claimed ${formatCotiAmount(result.observedCredit)} COTI from Direct Chat tips.`);
    } catch (creditError) {
      setError(
        getOnChainFailureMessage(creditError, 'Failed to claim Direct Chat tips.')
      );
    } finally {
      setWithdrawingDirectChatV2NativeCredit(false);
    }
  }, [
    directChatV2Runtime,
    setError,
    setStatus,
    setWalletBalanceRefreshNonce,
    withdrawingDirectChatV2NativeCredit
  ]);
  const rotateDirectChatV2Key = useCallback(async () => {
    const runtime = directChatV2Runtime;
    const peer = activeContact?.trim() ?? '';
    if (
      !runtime?.enabled ||
      !runtime.session ||
      rotatingDirectChatV2Key ||
      !isWalletAddress(peer) ||
      !browserOwnerDataScopeKey ||
      peer.toLowerCase() === browserOwnerDataScopeKey
    ) {
      return;
    }
    if (!window.confirm(
      'Rotate the encryption key for this conversation? Future messages will use a new key, while existing messages remain readable. This requires one wallet transaction.'
    )) {
      return;
    }
    setError('');
    setRotatingDirectChatV2Key(true);
    try {
      const result = await runtime.session.rotate(peer);
      if (
        !runtime.isCurrent() ||
        activeContactRef.current?.trim().toLowerCase() !== peer.toLowerCase()
      ) {
        return;
      }
      setStatus(
        `Conversation key rotated successfully. Future messages use key epoch ${result.conversation.currentEpoch}.`
      );
    } catch (rotationError) {
      setError(
        getOnChainFailureMessage(rotationError, 'Failed to rotate the conversation key.')
      );
    } finally {
      setRotatingDirectChatV2Key(false);
    }
  }, [
    activeContact,
    directChatV2Runtime,
    rotatingDirectChatV2Key,
    setError,
    setStatus,
    walletAddress
  ]);
  const getDirectChatV2ImageSessionToken = useCallback(async (): Promise<string> => {
    const runtime = directChatV2Runtime;
    const requestedOwner = browserOwnerDataScopeKey;
    if (!runtime?.enabled || !runtime.session || !requestedOwner) {
      throw new Error('Direct Chat V2 image uploads require the current owner wallet.');
    }
    const { getChatImageSessionToken } = await import('./lib/chatImageSession');
    return getChatImageSessionToken({
      assertCurrent: () => {
        if (
          !runtime.isCurrent() ||
          currentWalletKeyRef.current !== requestedOwner
        ) {
          throw new Error('Wallet session changed while authorizing the image upload.');
        }
      },
      chainId: runtime.session.manifest.chainId,
      ownerAddress: requestedOwner,
      signAuthorization: (message) => runtime.session.signImageSessionAuthorization(message)
    });
  }, [browserOwnerDataScopeKey, directChatV2Runtime]);
  const getGroupChatV2ImageSessionToken = useCallback(async (): Promise<string> => {
    const runtime = groupChatV2Runtime;
    const requestedOwner = browserOwnerDataScopeKey;
    if (!runtime?.enabled || !runtime.session || !requestedOwner) {
      throw new Error('Group Chat V2 image uploads require the current owner wallet.');
    }
    const { getChatImageSessionToken } = await import('./lib/chatImageSession');
    return getChatImageSessionToken({
      assertCurrent: () => {
        if (!runtime.isCurrent() || currentWalletKeyRef.current !== requestedOwner) {
          throw new Error('Wallet session changed while authorizing the group image upload.');
        }
      },
      chainId: runtime.session.manifest.chainId,
      ownerAddress: requestedOwner,
      signAuthorization: (message) => runtime.session.signImageSessionAuthorization(message)
    });
  }, [browserOwnerDataScopeKey, groupChatV2Runtime]);
  useEffect(() => () => {
    void import('./lib/chatImageSession').then(({ clearChatImageSessionTokens }) => {
      clearChatImageSessionTokens();
    });
  }, [directChatV2Runtime, groupChatV2Runtime]);
  useEffect(() => {
    const runtime = directChatV2Runtime;
    const peer = activeContact?.trim() ?? '';
    const historyError = 'Direct Chat V2 history could not be verified. Retrying securely.';
    const clearHistoryError = () => {
      setError((previous) => previous === historyError ? '' : previous);
    };
    if (
      !runtime?.enabled ||
      !runtime.history ||
      !ownerAesReady ||
      !isWalletAddress(peer) ||
      !isWalletAddress(walletAddress) ||
      peer.toLowerCase() === walletAddress.toLowerCase()
    ) {
      clearHistoryError();
      return;
    }

    let disposed = false;
    let retryTimer: number | undefined;
    let stopWatching: (() => Promise<void>) | null = null;
    let watchAttemptInFlight = false;
    let recentHintUntil = 0;
    let errorReported = false;
    let inFlight = false;
    let wakeRequested = false;
    let manualRefresh = false;
    const shouldContinue = () =>
      !disposed &&
      runtime.isCurrent() &&
      activeContactRef.current?.trim().toLowerCase() === peer.toLowerCase();
    const schedule = (delayMs: number) => {
      if (disposed) return;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        void synchronize();
      }, delayMs);
    };
    const requestRefresh = () => {
      if (!shouldContinue()) return;
      manualRefresh = true;
      setDirectChatV2RefreshView({ runtime, peer: peer.toLowerCase(), refreshing: true });
      if (inFlight) wakeRequested = true;
      else schedule(0);
    };
    directChatV2RefreshRef.current = requestRefresh;
    const ensureWatcher = async () => {
      if (disposed || stopWatching || watchAttemptInFlight) return;
      watchAttemptInFlight = true;
      try {
        const stop = await runtime.history.watch(peer, () => {
          recentHintUntil = Date.now() + 60_000;
          schedule(0);
        });
        if (disposed) {
          await stop?.();
          return;
        }
        stopWatching = stop;
      } catch {
        // The safe-head polling fallback remains active and will retry this setup.
      } finally {
        watchAttemptInFlight = false;
      }
    };
    const synchronize = async () => {
      if (!shouldContinue()) return;
      if (inFlight) {
        wakeRequested = true;
        return;
      }
      inFlight = true;
      try {
        const batch = await runtime.history.sync(
          peer,
          messagesByContactRef.current,
          shouldContinue
        );
        if (!shouldContinue()) return;
        errorReported = false;
        clearHistoryError();
        messagesByContactRef.current = batch.apply(messagesByContactRef.current);
        setMessagesByContact((current) => runtime.isCurrent() ? batch.apply(current) : current);
        if (batch.appliedEntries > 0) {
          setContacts((previous) => mergeUniqueContacts(previous, [peer]));
          directChatV2PendingPeerHintsRef.current[browserOwnerDataScopeKey]?.delete(
            peer.toLowerCase()
          );
        }
        const peerKey = peer.toLowerCase();
        directChatV2HistoryCaughtUpRef.current[peerKey] = !batch.hasMore;
        if (!batch.hasMore) {
          const unreadCount = await runtime.history.getUnreadCount(
            peer,
            messagesByContactRef.current
          );
          if (!shouldContinue()) return;
          setUnreadMap((previous) => {
            const next = { ...previous };
            if (unreadCount > 0) next[peerKey] = true;
            else delete next[peerKey];
            unreadMapRef.current = next;
            return next;
          });
        }
        void ensureWatcher();
        schedule(batch.hasMore ? 50 : Date.now() < recentHintUntil ? 2_000 : 12_000);
      } catch (historyFailure) {
        if (!shouldContinue()) return;
        if (
          historyFailure instanceof Error &&
          historyFailure.message === 'Direct-chat V2 history is waiting for the latest message to finalize.'
        ) {
          clearHistoryError();
          schedule(2_000);
          return;
        }
        if (!errorReported) {
          errorReported = true;
          setError(historyError);
        }
        schedule(5_000);
      } finally {
        inFlight = false;
        if (shouldContinue()) {
          if (wakeRequested) {
            wakeRequested = false;
            schedule(0);
          } else if (manualRefresh) {
            manualRefresh = false;
            setDirectChatV2RefreshView({ runtime, peer: peer.toLowerCase(), refreshing: false });
          }
        }
      }
    };

    void synchronize();
    return () => {
      disposed = true;
      if (directChatV2RefreshRef.current === requestRefresh) directChatV2RefreshRef.current = null;
      clearHistoryError();
      delete directChatV2HistoryCaughtUpRef.current[peer.toLowerCase()];
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      void stopWatching?.().catch(() => undefined);
    };
  }, [activeContact, browserOwnerDataScopeKey, directChatV2Runtime, ownerAesReady, setError, setMessagesByContact]);
  useEffect(() => {
    const runtime = directChatV2Runtime;
    if (!runtime?.enabled || !runtime.history || !browserOwnerDataScopeKey) return;

    let disposed = false;
    const walletKey = browserOwnerDataScopeKey;
    const pendingPeerHints = directChatV2PendingPeerHintsRef.current[walletKey] ?? new Set<string>();
    directChatV2PendingPeerHintsRef.current[walletKey] = pendingPeerHints;
    let stopIncoming: (() => Promise<void>) | null = null;
    let discoveryTimer: number | undefined;
    let conversationPreviewTimer: number | undefined;
    let backgroundSyncInFlight = false;
    const timers = new Map<string, number>();
    const hintDeadlines = new Map<string, number>();
    const unreadWatcherStops = new Map<string, () => Promise<void>>();
    const unreadWatcherPending = new Set<string>();
    const shouldContinue = () => !disposed && runtime.isCurrent();
    const clearPeerTimer = (peerKey: string) => {
      const timer = timers.get(peerKey);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.delete(peerKey);
    };
    const schedulePeer = (peer: string, delayMs: number) => {
      const peerKey = peer.toLowerCase();
      clearPeerTimer(peerKey);
      if (disposed) return;
      timers.set(peerKey, window.setTimeout(() => {
        timers.delete(peerKey);
        void synchronizePeer(peer);
      }, delayMs));
    };
    const scheduleDiscovery = (delayMs: number) => {
      if (discoveryTimer !== undefined) window.clearTimeout(discoveryTimer);
      if (disposed) return;
      discoveryTimer = window.setTimeout(() => {
        discoveryTimer = undefined;
        void discoverIncoming();
      }, delayMs);
    };
    const scheduleConversationPreviews = (delayMs: number) => {
      if (conversationPreviewTimer !== undefined) window.clearTimeout(conversationPreviewTimer);
      if (disposed || !ownerAesReady) return;
      conversationPreviewTimer = window.setTimeout(() => {
        conversationPreviewTimer = undefined;
        void discoverKnownConversations();
      }, delayMs);
    };
    const updateUnread = (peer: string, unreadCount: number) => {
      const peerKey = peer.toLowerCase();
      setUnreadMap((previous) => {
        const next = { ...previous };
        if (unreadCount > 0) next[peerKey] = true;
        else delete next[peerKey];
        unreadMapRef.current = next;
        return next;
      });
    };
    const watchPeerUnread = (peer: string) => {
      const peerKey = peer.toLowerCase();
      if (
        disposed ||
        !ownerAesReady ||
        unreadWatcherStops.has(peerKey) ||
        unreadWatcherPending.has(peerKey)
      ) {
        return;
      }
      unreadWatcherPending.add(peerKey);
      void runtime.history.watchUnread(
        peer,
        () => messagesByContactRef.current,
        (unreadCount) => {
          if (shouldContinue()) updateUnread(peer, unreadCount);
        }
      ).then((stop) => {
        unreadWatcherPending.delete(peerKey);
        if (!stop) return;
        if (disposed) void stop().catch(() => undefined);
        else unreadWatcherStops.set(peerKey, stop);
      }).catch(() => {
        unreadWatcherPending.delete(peerKey);
      });
    };
    const synchronizePeer = async (peer: string) => {
      if (
        !shouldContinue() ||
        !ownerAesReady ||
        activeContactRef.current?.trim().toLowerCase() === peer.toLowerCase()
      ) {
        return;
      }
      if (backgroundSyncInFlight) {
        schedulePeer(peer, 100);
        return;
      }
      backgroundSyncInFlight = true;
      try {
        const batch = await runtime.history.sync(
          peer,
          messagesByContactRef.current,
          shouldContinue
        );
        if (!shouldContinue()) return;
        messagesByContactRef.current = batch.apply(messagesByContactRef.current);
        setMessagesByContact((current) => runtime.isCurrent() ? batch.apply(current) : current);
        if (batch.appliedEntries > 0) {
          setContacts((previous) => mergeUniqueContacts(previous, [peer]));
          pendingPeerHints.delete(peer.toLowerCase());
        }
        const peerKey = peer.toLowerCase();
        directChatV2HistoryCaughtUpRef.current[peerKey] = !batch.hasMore;
        if (batch.hasMore) {
          schedulePeer(peer, 50);
          return;
        }
        const unreadCount = await runtime.history.getUnreadCount(
          peer,
          messagesByContactRef.current
        );
        if (!shouldContinue()) return;
        updateUnread(peer, unreadCount);
        if (
          batch.appliedEntries === 0 &&
          Date.now() < (hintDeadlines.get(peerKey) ?? 0)
        ) {
          schedulePeer(peer, 2_000);
        } else {
          hintDeadlines.delete(peerKey);
        }
      } catch {
        if (shouldContinue()) schedulePeer(peer, 5_000);
      } finally {
        backgroundSyncInFlight = false;
      }
    };
    const rememberIncomingPeer = (peer: string, liveHint: boolean) => {
      if (!isWalletAddress(peer) || peer.toLowerCase() === walletKey) return;
      const peerKey = peer.toLowerCase();
      pendingPeerHints.add(peerKey);
      if (liveHint) hintDeadlines.set(peerKey, Date.now() + 60_000);
      if (ownerAesReady) {
        watchPeerUnread(peer);
        schedulePeer(peer, 0);
      }
    };
    const handleIncomingHint = async (peer: string) => {
      rememberIncomingPeer(peer, true);
      scheduleDiscovery(0);
    };
    const discoverKnownConversations = async () => {
      if (!shouldContinue() || !ownerAesReady) return;
      try {
        let beforeIndexExclusive: bigint | undefined;
        for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
          const page = await runtime.session.listConversations(beforeIndexExclusive, 32n);
          if (!shouldContinue()) return;
          const peers = page.previews.map(({ peer }) => peer);
          if (peers.length > 0) {
            setContacts((previous) => mergeUniqueContacts(previous, peers));
            for (const peer of peers) rememberIncomingPeer(peer, false);
          }
          if (page.nextBeforeIndex === 0n || page.previews.length === 0) break;
          beforeIndexExclusive = page.nextBeforeIndex;
        }
        scheduleConversationPreviews(12_000);
      } catch {
        if (shouldContinue()) scheduleConversationPreviews(5_000);
      }
    };
    const discoverIncoming = async () => {
      if (!shouldContinue()) return;
      try {
        const result = await runtime.history.discoverIncoming(shouldContinue);
        if (!shouldContinue()) return;
        for (const peer of result.peers) rememberIncomingPeer(peer, false);
        if (result.reorged && ownerAesReady) {
          for (const contact of contactsRef.current) {
            if (isWalletAddress(contact.address)) schedulePeer(contact.address, 0);
          }
        }
        scheduleDiscovery(result.hasMore ? 50 : 12_000);
      } catch {
        if (shouldContinue()) scheduleDiscovery(5_000);
      }
    };

    void runtime.history.watchIncoming(handleIncomingHint).then((stop) => {
      if (disposed) void stop().catch(() => undefined);
      else stopIncoming = stop;
    }).catch(() => undefined);
    void discoverIncoming();
    if (ownerAesReady) {
      void discoverKnownConversations();
      for (const peer of pendingPeerHints) schedulePeer(peer, 0);
      for (const contact of contactsRef.current) {
        if (isWalletAddress(contact.address)) schedulePeer(contact.address, 0);
      }
    }
    return () => {
      disposed = true;
      if (discoveryTimer !== undefined) window.clearTimeout(discoveryTimer);
      if (conversationPreviewTimer !== undefined) window.clearTimeout(conversationPreviewTimer);
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      hintDeadlines.clear();
      void stopIncoming?.().catch(() => undefined);
      for (const stop of unreadWatcherStops.values()) void stop().catch(() => undefined);
      unreadWatcherStops.clear();
      unreadWatcherPending.clear();
    };
  }, [browserOwnerDataScopeKey, directChatV2Runtime, ownerAesReady, setContacts, setMessagesByContact, setUnreadMap]);
  const directChatV2ContactSettingsScope = contacts
    .map((contact) => contact.address.trim().toLowerCase())
    .filter((address) => isWalletAddress(address))
    .sort()
    .join('|');
  useEffect(() => {
    const runtime = directChatV2Runtime;
    if (!runtime?.enabled || !runtime.isCurrent() || !ownerAesReady) return;
    if (directChatV2LoadedContactSettingsRef.current.runtime !== runtime) {
      directChatV2LoadedContactSettingsRef.current = { runtime, addresses: new Set() };
    }
    const loadedAddresses = directChatV2LoadedContactSettingsRef.current.addresses;
    const currentAddresses = new Set(
      contactsRef.current
        .map((contact) => contact.address.trim().toLowerCase())
        .filter((address) => isWalletAddress(address))
    );
    for (const address of loadedAddresses) {
      if (!currentAddresses.has(address)) loadedAddresses.delete(address);
    }
    const pendingAddresses = [...currentAddresses].filter((address) => !loadedAddresses.has(address));
    if (pendingAddresses.length === 0) return;
    let disposed = false;
    void (async () => {
      if (!(await runtime.session.hasProfileSync()) || disposed || !runtime.isCurrent()) return;
      const snapshots = await readDirectChatV2ContactSettingsSerially({
        contacts: pendingAddresses,
        read: (address) => runtime.session.readContactSettings(address),
        shouldContinue: () => !disposed && runtime.isCurrent()
      });
      if (disposed || !runtime.isCurrent()) return;
      for (const [address] of snapshots) loadedAddresses.add(address);
      const byAddress = new Map(snapshots);
      setContacts((previous) => previous.map((contact) => {
        const snapshot = byAddress.get(contact.address.toLowerCase());
        if (!snapshot) return contact;
        const savedName = snapshot.exists ? snapshot.settings.savedName : '';
        const hidden = snapshot.exists ? snapshot.settings.hidden : false;
        if (
          (contact.savedName ?? '') === savedName &&
          Boolean(contact.hidden || contact.muted) === hidden &&
          contact.muted === undefined
        ) {
          return contact;
        }
        return { ...contact, savedName, hidden, muted: undefined };
      }));
    })().catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [directChatV2ContactSettingsScope, directChatV2Runtime, ownerAesReady, setContacts]);
  useEffect(() => {
    const runtime = directTradeV2Runtime;
    if (!runtime || !runtime.isCurrent() || !browserOwnerDataScopeKey) return;

    let disposed = false;
    let timer: number | undefined;
    let errorReported = false;
    const shouldContinue = () => !disposed && runtime.isCurrent();
    const schedule = (delayMs: number) => {
      if (disposed) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void synchronize(); }, delayMs);
    };
    const synchronize = async () => {
      try {
        const batch = await runtime.sync();
        if (!shouldContinue()) return;
        errorReported = false;
        if (batch.applied) {
          messagesByContactRef.current = batch.apply(messagesByContactRef.current);
          setMessagesByContact((current) => batch.apply(current));
        }
        if (batch.contacts.length > 0) {
          setContacts((previous) => mergeUniqueContacts(previous, [...batch.contacts]));
        }
        ingestDirectTradeNotifications({
          newOpenings: batch.newIncomingOpenings,
          canonicalOpenings: batch.canonicalIncomingOpenings,
          canonicalComplete: !batch.hasMore
        });
        if (batch.incomingContacts.length > 0) {
          const incomingContacts = batch.incomingContacts.filter(
            (contact) => !notificationSuppressedContactAddressSetRef.current.has(contact.toLowerCase())
          );
          setUnreadMap((previous) => {
            const next = { ...previous };
            for (const contact of incomingContacts) {
              const activeThreadIsVisible =
                document.visibilityState === 'visible' &&
                activePageRef.current === 'chat' &&
                activeContactRef.current?.toLowerCase() === contact.toLowerCase();
              if (!activeThreadIsVisible) {
                next[contact.toLowerCase()] = true;
              }
            }
            unreadMapRef.current = next;
            return next;
          });
          if (soundEnabledRef.current && incomingContacts.length > 0) {
            const contact = incomingContacts[0]!;
            showChainWhisperBrowserNotification({
              kind: 'direct-trade',
              onOpen: () => {
                setActivePage('chat');
                setActiveContact(contact);
                setActiveMobileView('chat');
              }
            });
          }
        }
        schedule(batch.hasMore ? 50 : 12_000);
      } catch {
        if (!shouldContinue()) return;
        if (!errorReported) {
          errorReported = true;
          setError('Direct trade notifications could not be verified. Retrying securely.');
        }
        schedule(5_000);
      }
    };

    void synchronize();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    browserOwnerDataScopeKey,
    directTradeV2Runtime,
    ingestDirectTradeNotifications,
    setActiveMobileView,
    setActivePage,
    setContacts,
    setError,
    setMessagesByContact,
    setUnreadMap
  ]);
  const requestChainWhisperFundingAfterError = useCallback(
    (message: string) => {
      setError(`${message} Add funds to the connected owner wallet, then try again.`);
    },
    [setError]
  );
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
        selfTradeMessage: 'P2P offers are only available in private chats with another wallet.'
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
    enabled: activePage === 'chat',
    chainId,
    getMemoSignerRef,
    hasAesReady,
    normalizedTradeOfferCustomTokenAddress,
    normalizedTradeRequestCustomTokenAddress,
    setCustomTradeTokenInfoByAddress,
    setSessionOnboardInfo,
    walletBalanceRefreshNonce,
    tradeCustomOfferTokenKind,
    tradeCustomRequestTokenKind,
    tradeOfferTokenSelection,
    tradeRequestTokenSelection,
    watchedTokens: watchedAccountTokens,
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
    directChatV2ConversationKnown: activeMessages.some((message) => message.directV2 !== undefined),
    directChatV2Session: directChatV2Runtime?.enabled ? directChatV2Runtime.session : null,
    directTradeV2Enabled: directTradeV2Runtime?.isCurrent() === true,
    messageInput,
    parsedTradeExpiryHours,
    tradeComposerOpen,
    tradeCounterParentId,
    tradeOfferTokenKind: selectedTradeOfferToken?.kind ?? null,
    tradeOfferTokenSymbol: selectedTradeOfferToken?.symbol ?? '',
    walletAddress
  });

  const {
    markAllConversationsAsRead: markAllLegacyConversationsAsRead,
    markConversationAsRead,
    markGroupConversationAsRead
  } = useConversationReadStateActions({
    activeContact,
    activeGroupId,
    directChatV2Enabled: Boolean(directChatV2Runtime?.enabled),
    groupChatV2Enabled: Boolean(groupChatV2Runtime?.enabled),
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

  const markAllV2ConversationsAsRead = useCallback(async () => {
    const directRuntime = directChatV2Runtime;
    if (directRuntime?.enabled && directRuntime.history) {
      const nextUnread = { ...unreadMapRef.current };
      for (const peer of Object.keys(nextUnread)) {
        const peerKey = peer.toLowerCase();
        if (!isWalletAddress(peer) || !directChatV2HistoryCaughtUpRef.current[peerKey]) continue;
        const messages = Object.entries(messagesByContactRef.current).find(
          ([contact]) => contact.toLowerCase() === peerKey
        )?.[1] ?? [];
        const latestIncoming = messages.reduce<ChatMessage | null>((latest, message) => {
          if (message.direction !== 'incoming' || message.directV2?.finality !== 'finalized') return latest;
          if (!latest?.directV2) return message;
          return BigInt(message.directV2.messageId) > BigInt(latest.directV2.messageId) ? message : latest;
        }, null);
        if (!latestIncoming) continue;
        try {
          const unreadCount = await directRuntime.history.markVisible(
            peer,
            latestIncoming,
            messagesByContactRef.current
          );
          if (!directRuntime.isCurrent()) return;
          if (unreadCount > 0) nextUnread[peerKey] = true;
          else delete nextUnread[peerKey];
        } catch {
          // Leave the unread marker intact when the finalized cursor cannot be proven.
        }
      }
      if (directRuntime.isCurrent()) {
        unreadMapRef.current = nextUnread;
        setUnreadMap(nextUnread);
      }
    }

    const groupRuntime = groupChatV2Runtime;
    if (groupRuntime?.enabled) {
      const nextUnread = { ...unreadGroupMapRef.current };
      for (const groupKey of Object.keys(nextUnread)) {
        const groupId = Number(groupKey);
        const latestAnchor = groupChatV2LatestIncomingRef.current[groupKey];
        if (
          !Number.isSafeInteger(groupId) ||
          groupId <= 0 ||
          !latestAnchor ||
          !groupChatV2DiscoveryCaughtUpRef.current[groupKey]
        ) {
          continue;
        }
        const latestIncoming = (messagesByGroupRef.current[groupKey] ?? []).find((message) =>
          message.direction === 'incoming' &&
          message.groupV2?.finality === 'finalized' &&
          message.groupV2.messageId === latestAnchor.messageId.toString()
        );
        if (!latestIncoming) continue;
        try {
          const { scope, context } = getGroupChatV2ReadCursorContext(groupId);
          const cursor = await groupRuntime.readCursors.advanceVisible(scope, latestIncoming, context);
          if (!groupRuntime.isCurrent()) return;
          groupChatV2ReadCursorRef.current[groupKey] = cursor;
          if (latestAnchor.messageId > BigInt(cursor.lastReadMessageId)) nextUnread[groupKey] = true;
          else delete nextUnread[groupKey];
        } catch {
          // Leave the unread marker intact when the finalized cursor cannot be proven.
        }
      }
      if (groupRuntime.isCurrent()) {
        unreadGroupMapRef.current = nextUnread;
        setUnreadGroupMap(nextUnread);
      }
    }
  }, [
    directChatV2Runtime,
    getGroupChatV2ReadCursorContext,
    groupChatV2Runtime,
    setUnreadGroupMap,
    setUnreadMap
  ]);
  const markAllConversationsAsRead = useCallback(() => {
    markAllLegacyConversationsAsRead();
    void markAllV2ConversationsAsRead();
  }, [markAllLegacyConversationsAsRead, markAllV2ConversationsAsRead]);

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
    getMemoSigner,
    getMemoSignerForAccount,
    parseEncryptedChatMessagePayload
  } = useChatMemoCrypto({
    encodeMemoForActiveSignerRef,
    getMemoSignerRef,
    getOwnerReadSigner: getOwnerMemoReadSigner,
    memoAesRecoveryAttemptedRef,
    ownerWalletAddress,
    setOnboardStatus,
    setWalletAesHealth,
    walletAesHealthByAddress
  });
  const getWispPortalSwapSigner = useCallback(async () => {
    const signer = await getOwnerFundsSigner(true);
    return {
      signer,
      cacheKey: ownerWalletAddress.trim().toLowerCase()
    };
  }, [getOwnerFundsSigner, ownerWalletAddress]);
  const runWispPortalSwapTransactionFlow = runOwnerFundsTransactionFlow;
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
    setWalletBalanceRefreshNonce,
    shieldVaultTokenBalanceWei,
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
  const wispSpendableBalanceWei = wispMaxBalanceWei === null
    ? null
    : resolveLegacyRecoverySpendableAmount({
        balanceWei: wispMaxBalanceWei,
        direction: swapDirection,
        tokenFeeWei: swapTokenFeeAmount
      });
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
  const wispRecoveryMaxAmountWei = wispSpendableBalanceWei === null
    ? null
    : swapDirection === 'shield' || shieldVaultTokenBalanceWei === null
      ? wispSpendableBalanceWei
      : wispSpendableBalanceWei < shieldVaultTokenBalanceWei
        ? wispSpendableBalanceWei
        : shieldVaultTokenBalanceWei;
  const wispRecoveryCanSubmit = canSwapRewardTokens &&
    parsedSwapAmount !== null &&
    wispRecoveryMaxAmountWei !== null &&
    (!isLegacyUnshieldDirection(swapDirection) || (swapFeeWei !== null && swapTokenFeeAmount !== null)) &&
    parsedSwapAmount <= wispRecoveryMaxAmountWei;
  const wispRecoveryFeeLabel = swapDirection === 'legacy-unshield-earlier'
    ? swapFeeWei === null || swapTokenFeeAmount === null
      ? 'Read at confirmation'
      : `${formatTokenAmount(swapTokenFeeAmount, legacyPrivateRewardTokenDecimals, 6)} pWISP preferred; otherwise approved WISP or ${formatCotiAmount(swapFeeWei)} COTI`
    : swapFeeWei === null
      ? 'Read at confirmation'
      : `${formatCotiAmount(swapFeeWei)} COTI`;
  const wispRecoveryLiquidityLabel = swapDirection === 'shield'
    ? 'Not applicable'
    : shieldVaultTokenBalanceWei === null
      ? 'Loading...'
      : `${formatTokenAmount(shieldVaultTokenBalanceWei, rewardTokenDecimals, 6)} ${rewardTokenSymbol}`;
  const handleWispMaxAmount = useCallback(() => {
    if (wispRecoveryMaxAmountWei === null) {
      setError('Unable to read the selected WISP balance. Refresh and try again.');
      return;
    }
    setError('');
    setSwapAmountInput(formatTokenAmount(wispRecoveryMaxAmountWei, swapInputDecimals, swapInputDecimals));
  }, [
    setSwapAmountInput,
    swapInputDecimals,
    wispRecoveryMaxAmountWei
  ]);

  const {
    groupRequiredFeeCacheRef,
    groupTokenFeeCacheRef,
    resetGroupFeeCaches
  } = useAppFeeResolvers({
    setTradeRequiredFeeWei
  });

  const {
    fetchOnChainNicknames,
    getNicknameMaxLength,
    loadMyNicknameFromChain,
    resolveConversationBlockRange,
    resolveTradeSnapshotForOffer,
    saveMyNicknameOnChain
  } = useAppChainLookups({
    directChatV2Runtime,
    directChatV2Selected: DIRECT_CHAT_V2_DEPLOYMENT_CONFIG.status !== 'inactive',
    directTradeV2Runtime,
    directTradeV2Contracts: DIRECT_TRADE_V2_SUPPORTED_CONTRACTS,
    loadMyNicknameFromChainRef,
    myNickname,
    nicknameMaxBytes,
    onChainNicknameCacheRef,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    setContacts,
    setError,
    setMyNickname,
    setNicknameMaxBytes,
    setTradeSnapshotsById,
    tradeSnapshotsById,
    walletAddress
  });
  useActiveTradeOfferSnapshots({
    activeMessages,
    privateTermsEnabled: hasAesReady && Boolean(directTradeV2Runtime?.isCurrent()),
    supportedEscrowContracts: DIRECT_TRADE_V2_SUPPORTED_CONTRACTS,
    resolveTradeSnapshotForOffer,
    setTradeSnapshotsById
  });
  const revealEmbeddedDirectTradeTerms = useCallback(async (
    offer: TradeOfferMessagePayload
  ): Promise<void> => {
    if (
      !hasAesReady ||
      !directTradeV2Runtime?.isCurrent() ||
      !isSupportedDirectTradeV2Escrow(offer.escrowContract, DIRECT_TRADE_V2_SUPPORTED_CONTRACTS)
    ) {
      throw new Error('Unlock privacy before revealing Direct offer terms.');
    }
    if (processingTradeActionId) return;
    const tradeKey = buildTradeSnapshotKey(offer.tradeId, offer.escrowContract);
    setProcessingTradeActionId(tradeKey);
    setError('');
    try {
      await resolveTradeSnapshotForOffer(offer, { allowPrivatePrompt: true });
    } catch (cause) {
      const message = getProviderErrorMessage(cause, 'Direct offer terms could not be revealed.');
      setError(message);
      throw cause;
    } finally {
      setProcessingTradeActionId((current) => current === tradeKey ? '' : current);
    }
  }, [
    directTradeV2Runtime,
    hasAesReady,
    processingTradeActionId,
    resolveTradeSnapshotForOffer,
    setError,
    setProcessingTradeActionId
  ]);
  const {
    applyStateBackupPayload
  } = useStateBackupSync({
    chainId,
    lastReadAllTs,
    lastReadAllTsRef,
    readStateSyncEnabled: readStateFeaturesEnabled,
    setLastReadAllTs,
    setUnreadGroupMap,
    setUnreadMap,
    unreadGroupMapRef,
    unreadMapRef,
    walletAddress
  });

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
    automaticLegacySyncEnabled: !directChatV2Runtime?.enabled,
    applyStateBackupPayload,
    chainId,
    contacts,
    currentWalletKeyRef,
    decryptMemoPlaintextWithRecovery,
    fetchOnChainNicknames,
    getMemoSigner,
    getMemoSignerForAccount,
    hasAesReady,
    lastReadAllTsRef,
    lastReadByContactRef,
    messagesByContact,
    notificationSuppressedContactAddressSet,
    parseEncryptedChatMessagePayload,
    pinnedContactStateRef,
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
    legacyEnabled: !directChatV2Runtime?.enabled,
    onChainNicknameCacheRef,
    readableWalletAccountKeys,
    readableWalletAccounts,
    setContacts,
    setDirectRealtimeStatus,
    setMyNickname,
    syncConversationHistoryRef,
    walletAddress
  });
  const markLatestDirectV2MessageVisible = useCallback(async (message: ChatMessage) => {
    const runtime = directChatV2Runtime;
    const peer = activeContactRef.current?.trim() ?? '';
    if (
      !runtime?.enabled ||
      !runtime.history ||
      !isWalletAddress(peer) ||
      !directChatV2HistoryCaughtUpRef.current[peer.toLowerCase()] ||
      message.directV2?.finality !== 'finalized'
    ) {
      throw new Error('Direct Chat V2 visibility is not finalized and caught up yet.');
    }
    const unreadCount = await runtime.history.markVisible(
      peer,
      message,
      messagesByContactRef.current
    );
    if (
      !runtime.isCurrent() ||
      activeContactRef.current?.trim().toLowerCase() !== peer.toLowerCase()
    ) {
      return;
    }
    setUnreadMap((previous) => {
      const peerKey = peer.toLowerCase();
      const next = { ...previous };
      if (unreadCount > 0) next[peerKey] = true;
      else delete next[peerKey];
      unreadMapRef.current = next;
      return next;
    });
  }, [directChatV2Runtime, setUnreadMap]);
  const markLatestGroupV2MessageVisible = useCallback(async (message: ChatMessage) => {
    const runtime = groupChatV2Runtime;
    const selectedGroupId = activeGroupIdRef.current;
    if (
      !runtime?.enabled ||
      selectedGroupId === null ||
      message.groupV2?.finality !== 'finalized' ||
      message.groupV2.groupId !== String(selectedGroupId) ||
      !groupChatV2DiscoveryCaughtUpRef.current[String(selectedGroupId)]
    ) {
      throw new Error('Group Chat V2 visibility is not finalized and caught up yet.');
    }
    const { scope, context } = getGroupChatV2ReadCursorContext(selectedGroupId);
    const cursor = await runtime.readCursors.advanceVisible(scope, message, context);
    if (!runtime.isCurrent() || activeGroupIdRef.current !== selectedGroupId) return;
    const groupKey = String(selectedGroupId);
    groupChatV2ReadCursorRef.current[groupKey] = cursor;
    const latestIncoming = groupChatV2LatestIncomingRef.current[groupKey];
    setUnreadGroupMap((previous) => {
      const next = { ...previous };
      if (latestIncoming && latestIncoming.messageId > BigInt(cursor.lastReadMessageId)) {
        next[groupKey] = true;
      } else {
        delete next[groupKey];
      }
      unreadGroupMapRef.current = next;
      return next;
    });
  }, [getGroupChatV2ReadCursorContext, groupChatV2Runtime, setUnreadGroupMap]);
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
    onLatestDirectMessageVisible: markLatestDirectV2MessageVisible,
    onLatestGroupMessageVisible: markLatestGroupV2MessageVisible,
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
    legacyEnabled: !groupChatV2Runtime?.enabled,
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
    legacyEnabled: !groupChatV2Runtime?.enabled,
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
    revokeJoinCodeForActiveGroup,
    transferAdminToMember
  } = useGroupAdminActions({
    activeGroupId,
    activeGroupIdRef,
    activeGroupMeta,
    activateGroup,
    currentWalletKeyRef,
    generatedGroupInviteCode,
    generatedGroupJoinCodeHash,
    groupChatV2Session: groupChatV2Runtime?.enabled ? groupChatV2Runtime.session : null,
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
  });
  const { sendGroupImageMessage, sendGroupMessage } = useGroupMessageActions({
    activeGroupId,
    activeGroupIdRef,
    clearImageAttachmentStatus,
    currentWalletKeyRef,
    groupChatV2Session: groupChatV2Runtime?.enabled ? groupChatV2Runtime.session : null,
    getGroupChatV2ImageSessionToken:
      groupChatV2Runtime?.enabled ? getGroupChatV2ImageSessionToken : null,
    isGroupChatV2ScopeCurrent,
    messageInput,
    replyingToMessage,
    sendingGroupMessage,
    setError,
    setMessageInput,
    setMessagesByGroup,
    setReplyingToMessage,
    setSendingGroupMessage,
    setWalletBalanceRefreshNonce,
    setUploadingImage,
    showImageAttachmentStatus,
    uploadingImage,
    walletAddress
  });
  const { syncConversationStateFromInput } = useConversationPreferenceActions({
    directChatV2Session: directChatV2Runtime?.enabled ? directChatV2Runtime.session : null,
    setError,
    walletAddress
  });
  const {
    handleAddContact,
    removeContact,
    toggleConversationHiddenForContact
  } = useContactActions({
    activeContact,
    browserWalletLiteMode: browserWalletLiteMode && directChatV2Runtime?.enabled !== true,
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
  });
  const savePrivateContactName = useCallback(async (contactAddress: string, savedName: string) => {
    const runtime = directChatV2Runtime;
    if (!runtime?.enabled || !runtime.isCurrent()) {
      setError('Private contact names require the upgraded ChainWhisper Chat V2 deployment.');
      return false;
    }
    try {
      const current = await runtime.session.readContactSettings(contactAddress);
      const confirmed = await runtime.session.setContactSettings(contactAddress, {
        savedName,
        hidden: current.settings.hidden
      });
      const addressKey = contactAddress.toLowerCase();
      setContacts((previous) => previous.map((contact) =>
        contact.address.toLowerCase() === addressKey
          ? {
              ...contact,
              savedName: confirmed.exists ? confirmed.settings.savedName : '',
              hidden: confirmed.exists ? confirmed.settings.hidden : false,
              muted: undefined
            }
          : contact
      ));
      setError('');
      return true;
    } catch (error) {
      setError(getProviderErrorMessage(error, 'Private contact name update failed.'));
      return false;
    }
  }, [directChatV2Runtime, setContacts, setError]);
  const { sendReactionToMessage } = useMessageReactionActions({
    activeSignerSource,
    getReactionsForMessage,
    sendingReaction,
    setError,
    setReactionPickerMessageId,
    setSendingReaction,
    submitChatReactionV1: chatReactionsV1Enabled ? submitChatReactionV1 : null,
    unavailableReason: chatReactionsV1RuntimeError || chatReactionsV1SyncError
  });

  const {
    sendDirectImageMessage,
    sendMessage,
    sendTipToActiveContact,
    sendTipToActiveGroupMember
  } = useDirectMessageActions({
    activeContact,
    activeContactRef,
    activeLinkedTradeContext,
    clearImageAttachmentStatus,
    currentWalletKeyRef,
    directMessageMaxLength,
    directChatV2WriteCoordinator: directChatV2Runtime?.coordinator ?? null,
    getDirectChatV2ImageSessionToken:
      directChatV2Runtime?.enabled ? getDirectChatV2ImageSessionToken : null,
    isDirectChatV2WriteScopeCurrent: () => directChatV2Runtime?.isCurrent() ?? false,
    messageInput,
    replyingToMessage,
    requestChainWhisperFundingAfterError,
    sendingRef,
    setError,
    setMessageInput,
    setReplyingToMessage,
    setSending,
    setTipAmountInput,
    setTipping,
    setWalletBalanceRefreshNonce,
    setUploadingImage,
    showImageAttachmentStatus,
    tipNativeBalanceWei,
    tipping,
    uploadingImage,
    walletAddress
  });
  const sendMessageForSideEffects = useCallback(async (...args: Parameters<typeof sendMessage>) => {
    await sendMessage(...args);
  }, [sendMessage]);
  const {
    confirmation: inChatTradeConfirmation,
    requestConfirmation: requestInChatTradeConfirmation,
    resolveConfirmation: resolveInChatTradeConfirmation
  } = useTradeActionConfirmationState();

  const {
    acceptTradeOffer,
    cancelTradeOffer,
    createTradeOffer,
    declineTradeOffer,
    prepareCounterTrade
  } = useInChatTradeActions({
    activeContact,
    creatingTrade,
    currentWalletKeyRef,
    directTradeV2Runtime,
    parsedTradeExpiryHours,
    parsedTradeOfferAmountWei,
    parsedTradeRequestAmountWei,
    processingTradeActionId,
    requestTradeActionConfirmation: requestInChatTradeConfirmation,
    resolveTradeSnapshotForOffer,
    selectedTradeOfferToken,
    selectedTradeRequestToken,
    sendingRef,
    setCreatingTrade,
    setError,
    setProcessingTradeActionId,
    setReplyingToMessage,
    setTipComposerOpen,
    setWalletBalanceRefreshNonce,
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

  const groupChatV2DiscoveryState = groupChatV2Runtime?.enabled && hasAesReady
    ? groupChatV2DiscoveryView?.runtime === groupChatV2Runtime ? groupChatV2DiscoveryView.state : 'loading'
    : undefined;
  const groupChatV2Refreshing = Boolean(groupChatV2Runtime?.enabled && hasAesReady && (
    (groupChatV2DiscoveryView?.runtime === groupChatV2Runtime && groupChatV2DiscoveryView.refreshing) ||
    activeGroupMessageLoadPhase
  ));
  const directChatV2Refreshing = Boolean(directChatV2Runtime?.enabled && ownerAesReady &&
    directChatV2RefreshView?.runtime === directChatV2Runtime &&
    directChatV2RefreshView.peer === activeContact?.trim().toLowerCase() &&
    directChatV2RefreshView.refreshing);
  const forceSyncAllData = async () => {
    if (!walletAddress || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    if (directChatV2Runtime?.enabled) directChatV2RefreshRef.current?.();
    else syncConversationHistory({ deep: true }).catch(() => {});
    if (groupChatV2Runtime?.enabled) refreshGroupChatV2();
    else syncGroupData({ deep: true }).catch(() => {});
  };

  useEffect(() => {
    setContacts([]);
    setConversationStateSyncPendingByContact({});
    setPersistedContactOrder([]);
    setActiveContact(null);
    setShowHiddenContacts(false);
  }, [browserOwnerDataScopeKey]);

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
    setGeneratedGroupJoinCode(null);
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
  }, [browserOwnerDataScopeKey, resetGroupFeeCaches]);

  useEffect(() => {
    let cancelled = false;

    const hydrateNickname = async () => {
      if (!browserOwnerDataScopeKey) {
        if (!cancelled) {
          setMyNickname('');
        }
        return;
      }

      getNicknameMaxLength().catch(() => {});

      try {
        const resolvedNickname = await loadMyNicknameFromChain(browserOwnerDataScopeKey);
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
  }, [browserOwnerDataScopeKey]);

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
    if (!browserOwnerDataScopeKey) {
      nextOnboardStatus = 'Not onboarded';
    } else {
      const cachedOnboardInfo = sessionOnboardInfo[browserOwnerDataScopeKey];
      if (cachedOnboardInfo?.aesKey) {
        nextOnboardStatus = 'Privacy ready';
      }
    }

    if (onboardStatus !== nextOnboardStatus) {
      setOnboardStatus(nextOnboardStatus);
    }
  }, [browserOwnerDataScopeKey, onboardStatus, sessionOnboardInfo, setOnboardStatus]);

  useEffect(() => {
    if (!isConnected) {
      setActiveMobileView('contacts');
    }
  }, [isConnected]);

  const { navigationPath, navigateToInternalAppLink, navigateToPage } = useAppNavigation({ activePage, setActivePage });
  const dexAppPair = currentDexAppPair(dexAppScope, selectedTradingPair);
  const currentMarketReference = useCurrentDexMarketReference(activePage === 'dex', dexAppScope.candidate, dexAppPair);

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
    activeContact,
    activeGroupId,
    activeLinkedTradeContext,
    currentWalletKeyRef,
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
    walletAddress,
    walletSessionEpochRef: walletHandoffEpochRef
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
  }, [activePage]);

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
    const nextWallet = browserOwnerDataScopeKey;

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
    browserOwnerDataScopeKey
  ]);

  useEffect(() => {
    setReactionPickerMessageId(null);
    setTipComposerOpen(false);
    setTipAmountInput('');
  }, [activeThreadKey, setReactionPickerMessageId, setTipAmountInput, setTipComposerOpen]);

  useEffect(() => {
    setTipNativeBalanceWei(ownerNativeBalanceWei);
  }, [ownerNativeBalanceWei, setTipNativeBalanceWei]);

  useRewardTokenMetrics({
    activeSwapVaultContractAddress,
    chainId,
    currentSwapDirectionEnabled,
    getMemoSigner,
    groupRequiredFeeCacheRef,
    groupTokenFeeCacheRef,
    hasAesReady,
    refreshNonce: walletBalanceRefreshNonce,
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
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (next) {
      try {
        initPersistentAudio();
      } catch {}
      void requestChainWhisperBrowserNotificationPermission();
    } else {
      stopNotificationSound();
    }
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
      isPrivateGroup={Boolean(activeGroupMeta?.isPrivate)}
      supportsEncryptedPrivateTitle={Boolean(groupChatV2Runtime?.enabled)}
      consentOnlyAdminTransfer={Boolean(groupChatV2Runtime?.enabled)}
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
      isPrivateGroup={Boolean(activeGroupMeta?.isPrivate)}
      supportsEncryptedPrivateTitle={Boolean(groupChatV2Runtime?.enabled)}
      consentOnlyAdminTransfer={Boolean(groupChatV2Runtime?.enabled)}
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
    ) => activateBrowserWalletSessionGuarded(walletId, options),
    [activateBrowserWalletSessionGuarded]
  );
  const toggleChatReadCursorCloud = useCallback(
    () => chatReadCursorCloud.enabled
      ? chatReadCursorCloud.disableAndDelete()
      : chatReadCursorCloud.authorize(),
    [
      chatReadCursorCloud.authorize,
      chatReadCursorCloud.disableAndDelete,
      chatReadCursorCloud.enabled
    ]
  );
  const walletUtilityNetworkMismatch = chainId !== null && chainId !== COTI_NETWORK.chainIdDecimal;
  const openDirectTradeNotification = useCallback((item: (typeof directTradeNotificationItems)[number]) => {
    if (!directTradeNotificationScope) return;
    const contractAddress = item.contractAddress ?? directTradeNotificationScope.contractAddress;
    if (!isSupportedDirectTradeV2Escrow(contractAddress, directTradeNotificationScope.supportedContracts, directTradeNotificationScope.contractAddress)) return;
    setChatWalletMenuOpen(false);
    markDirectTradeNotificationRead(item.id);
    ensureContactAndOpenTradeChat(item.contactAddress, {
      source: 'terminal',
      terminalPath: buildTradeTerminalPath(
        Number(item.tradeId),
        undefined,
        contractAddress
      ),
      escrowContract: contractAddress,
      tradeId: Number(item.tradeId)
    });
  }, [
    directTradeNotificationItems,
    directTradeNotificationScope,
    ensureContactAndOpenTradeChat,
    markDirectTradeNotificationRead,
    setChatWalletMenuOpen
  ]);
  const walletUtilityMenu = (
    <WalletUtilityMenu
      activeNetworkId={COTI_NETWORK.id}
      networkSelectionLocked={CHAINWHISPER_NETWORK_SELECTION_LOCKED}
      walletChainId={chainId}
      networkSwitching={networkSwitching}
      onSelectNetwork={(networkId) => {
        setChatWalletMenuOpen(false);
        void handleSelectNetwork(networkId);
      }}
      notifications={directTradeNotificationItems}
      unreadCount={directTradeNotificationUnreadCount}
      soundEnabled={soundEnabled}
      onToggleSound={handleToggleSound}
      onOpenNotification={openDirectTradeNotification}
      onMarkAllRead={() => markDirectTradeNotificationRead()}
      onClearNotifications={clearDirectTradeNotifications}
      onOpenHelp={() => {
        setChatWalletMenuOpen(false);
        openCurrentAppHelp();
      }}
    />
  );
  const {
    chatPreferredBrowserWalletOption,
    chatWalletHeaderControl,
    unlockPrivacy
  } = useChatWalletHeaderControl({
    activateBrowserWalletSession: activateBrowserWalletSessionWithBootstrap,
    browserWalletSession,
    chatWalletMenuOpen,
    connectingMethod,
    connectingWalletLabel,
    copyWithFeedback,
    currentInjectedWalletOption,
    disconnectWallet,
    injectedWalletOptions,
    isMobileLayout: isMobileNav,
    lastCopiedKey,
    ownerAesReady,
    onToggleReadCursorCloud: toggleChatReadCursorCloud,
    preferredBrowserWalletId,
    readCursorCloudConfigured: chatReadCursorCloud.configured,
    readCursorCloudStatus: chatReadCursorCloud.status,
    setChatWalletMenuOpen,
    setError,
    walletAesHealth: walletAesHealthByAddress[walletAddress.trim().toLowerCase()] ?? null,
    walletAddress,
    utilityMenu: walletUtilityMenu,
    utilityMenuBadgeCount: directTradeNotificationUnreadCount,
    utilityMenuWarning: walletUtilityNetworkMismatch
  });
  const getSharedWalletSigner = useCallback<WalletSessionActions['getSigner']>(
    (requirePrivacy, options) => getOwnerFundsSigner(requirePrivacy, {
      refreshPrivacy: options?.refreshAes
    }),
    [getOwnerFundsSigner]
  );
  const getCurrentDexQuoteCapability = useCallback(
    async (expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal), options?: { refreshAes?: boolean }) => {
      const lease = captureBrowserWalletSignerLease();
      const { issueCurrentDexQuoteCapability } = await import('./features/wallet/currentDexQuoteCapability');
      return issueCurrentDexQuoteCapability({
        assertLeaseCurrent: async (currentLease) => assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
          setSessionOnboardInfo(previous => mergeLeaseScopedOnboardInfo(previous, cacheKey, onboardInfo, assertCurrent));
        },
        expectedChainId,
        expectedOwnerAddress: lease.address,
        lease,
        refreshPrivacy: options?.refreshAes,
        sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease, setSessionOnboardInfo]
  );
  const getCurrentDexPoolFundingCapability = useCallback(
    async (expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal), options?: WalletSessionDexOptions) => {
      const lease = captureBrowserWalletSignerLease();
      const { issueCurrentDexPoolFundingCapability } = await import('./features/wallet/currentDexPoolFundingCapability');
      return issueCurrentDexPoolFundingCapability({
        candidate: options?.candidate,
        assertLeaseCurrent: async (currentLease) => assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
          setSessionOnboardInfo(previous => mergeLeaseScopedOnboardInfo(previous, cacheKey, onboardInfo, assertCurrent));
        },
        expectedChainId,
        expectedOwnerAddress: lease.address,
        lease,
        refreshPrivacy: options?.refreshAes,
        sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease, setSessionOnboardInfo]
  );
  const getCurrentDexPoolPositionCapability = useCallback(
    async (expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal), options?: WalletSessionDexOptions) => {
      const lease = captureBrowserWalletSignerLease();
      const { issueCurrentDexPoolPositionCapability } = await import('./features/wallet/currentDexPoolPositionCapability');
      return issueCurrentDexPoolPositionCapability({
        candidate: options?.candidate,
        assertLeaseCurrent: async (currentLease) => assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
          setSessionOnboardInfo(previous => mergeLeaseScopedOnboardInfo(previous, cacheKey, onboardInfo, assertCurrent));
        },
        expectedChainId, expectedOwnerAddress: lease.address, lease,
        refreshPrivacy: options?.refreshAes, sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease, setSessionOnboardInfo]
  );
  const getCurrentDexLimitCapability = useCallback(
    async (expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal), options?: WalletSessionDexOptions) => {
      const lease = captureBrowserWalletSignerLease();
      const { issueCurrentDexLimitCapability } = await import('./features/wallet/currentDexLimitCapability');
      return issueCurrentDexLimitCapability({
        candidate: options?.candidate,
        selectedPair: options?.selectedPair,
        assertLeaseCurrent: async (currentLease) => assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
          setSessionOnboardInfo(previous => mergeLeaseScopedOnboardInfo(previous, cacheKey, onboardInfo, assertCurrent));
        },
        expectedChainId, expectedOwnerAddress: lease.address, lease,
        refreshPrivacy: options?.refreshAes, sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease, setSessionOnboardInfo]
  );
  const getCurrentSharedDexTokenFundsCapability = useCallback(
    async (expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal), options?: { candidate?: CurrentCheapDexCandidateKey }) => {
      const lease = captureBrowserWalletSignerLease();
      const onboardInfo = ownerTradeOnboardInfoRef.current;
      const key = onboardInfo[lease.address.toLowerCase()]?.aesKey;
      const assertCurrent = () => {
        assertBrowserWalletSignerLeaseSnapshotCurrent(lease);
        if (!key || ownerTradeOnboardInfoRef.current[lease.address.toLowerCase()]?.aesKey !== key) {
          throw new Error('Owner privacy changed. Check beta funds again.');
        }
      };
      const { issueCurrentSharedDexTokenFundsCapability } = await import('./features/wallet/currentSharedDexTokenFundsCapability');
      return issueCurrentSharedDexTokenFundsCapability({
        assertLeaseCurrent: async () => assertCurrent(), assertLeaseSnapshotCurrent: assertCurrent,
        expectedChainId, expectedOwnerAddress: lease.address, lease, sessionOnboardInfo: onboardInfo, candidate: options?.candidate
      });
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease]
  );
  const getCurrentDexReceiptCapability = useCallback(
    async (expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal), options?: { refreshAes?: boolean }) => {
      const lease = captureBrowserWalletSignerLease();
      const { issueCurrentDexReceiptCapability } = await import('./features/wallet/currentDexReceiptCapability');
      return issueCurrentDexReceiptCapability({
        assertLeaseCurrent: async (currentLease) => assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
          setSessionOnboardInfo(previous => mergeLeaseScopedOnboardInfo(previous, cacheKey, onboardInfo, assertCurrent));
        },
        expectedChainId,
        expectedOwnerAddress: lease.address,
        lease,
        refreshPrivacy: options?.refreshAes,
        sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease, setSessionOnboardInfo]
  );
  const getCurrentDexSubmissionCapability = useCallback(
    async (expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal), options?: Pick<WalletSessionDexOptions, 'candidate' | 'nativePoolProfile'>) => {
      if (options?.nativePoolProfile) throw new Error('Native Pool App integration awaits final local acceptance.');
      const lease = captureBrowserWalletSignerLease();
      const { issueCurrentDexSubmissionCapability } = await import('./features/wallet/currentDexSubmissionCapability');
      return issueCurrentDexSubmissionCapability({
        admission: null,
        candidate: options?.candidate,
        nativePoolProfile: options?.nativePoolProfile,
        // Match chat/OTC: provider events revoke this lease synchronously.
        // Repeated contract reads must not poll the wallet extension.
        assertLeaseCurrent: async (currentLease) => assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        expectedChainId,
        expectedOwnerAddress: lease.address,
        lease,
        sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [assertBrowserWalletSignerLeaseSnapshotCurrent, captureBrowserWalletSignerLease]
  );
  const getPrivateLiquidityCapability = useCallback(
    async (
      requirePrivacy: boolean,
      expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal),
      options?: { refreshAes?: boolean }
    ) => {
      const lease = captureBrowserWalletSignerLease();
      return issuePrivateLiquidityMetaMaskCapability({
        assertLeaseCurrent: async (currentLease) =>
          assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
          setSessionOnboardInfo((previous) => mergeLeaseScopedOnboardInfo(
            previous,
            cacheKey,
            onboardInfo,
            assertCurrent
          ));
        },
        expectedChainId,
        expectedOwnerAddress: lease.address,
        lease,
        refreshPrivacy: options?.refreshAes,
        requirePrivacy,
        sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [
      assertBrowserWalletSignerLeaseCurrent,
      assertBrowserWalletSignerLeaseSnapshotCurrent,
      captureBrowserWalletSignerLease,
      setSessionOnboardInfo
    ]
  );
  const getOtcV2Capability = useCallback(
    async (
      requirePrivacy: boolean,
      expectedChainId = BigInt(COTI_NETWORK.chainIdDecimal)
    ) => {
      const lease = captureBrowserWalletSignerLease();
      return issueOtcV2MetaMaskCapability({
        assertLeaseCurrent: async (currentLease) =>
          assertBrowserWalletSignerLeaseSnapshotCurrent(currentLease),
        assertLeaseSnapshotCurrent: assertBrowserWalletSignerLeaseSnapshotCurrent,
        commitOnboardInfo: ({ assertCurrent, onboardInfo, walletAddress: cacheKey }) => {
          setSessionOnboardInfo((previous) => mergeLeaseScopedOnboardInfo(
            previous,
            cacheKey,
            onboardInfo,
            assertCurrent
          ));
        },
        expectedChainId,
        expectedOwnerAddress: lease.address,
        lease,
        requirePrivacy,
        sessionOnboardInfo: ownerTradeOnboardInfoRef.current
      });
    },
    [
      assertBrowserWalletSignerLeaseCurrent,
      assertBrowserWalletSignerLeaseSnapshotCurrent,
      captureBrowserWalletSignerLease,
      setSessionOnboardInfo
    ]
  );
  const otcV2ActionRuntimeDependenciesRef = useRef({
    getOtcV2Capability,
    runOwnerFundsTransactionFlow
  });
  otcV2ActionRuntimeDependenciesRef.current = {
    getOtcV2Capability,
    runOwnerFundsTransactionFlow
  };
  useEffect(() => {
    let disposed = false;
    let createdRuntime: OtcV2ActionRuntime | null = null;
    setOtcV2ActionRuntime(null);
    setOtcV2ActionSetupError('');
    if (!otcV2Runtime || !otcV2Runtime.isCurrent()) {
      return () => { disposed = true; };
    }
    void import('./lib/otcV2ActionRuntime').then(async (runtimeModule) => {
      if (disposed) return;
      createdRuntime = await runtimeModule.createOtcV2ActionRuntimeFromCatalog({
        catalog: OTC_V2_DEPLOYMENT_CATALOG,
        history: otcV2Runtime,
        getOwnerCapability: (requirePrivacy) => otcV2ActionRuntimeDependenciesRef.current.getOtcV2Capability(
          requirePrivacy,
          BigInt(OTC_V2_DEPLOYMENT_CATALOG.status === 'active'
            ? OTC_V2_DEPLOYMENT_CATALOG.chainId
            : COTI_NETWORK.chainIdDecimal)
        ),
        runOwnerTransactionFlow: (operation) =>
          otcV2ActionRuntimeDependenciesRef.current.runOwnerFundsTransactionFlow(operation)
      });
      if (!disposed) setOtcV2ActionRuntime(createdRuntime);
      else createdRuntime.close();
    }).catch((cause) => {
      createdRuntime?.close();
      if (!disposed) {
        setOtcV2ActionRuntime(null);
        setOtcV2ActionSetupError(`P2P order setup: ${getProviderErrorMessage(cause, 'Verified order actions are unavailable.')}`);
      }
    });
    return () => {
      disposed = true;
      createdRuntime?.close();
    };
  }, [otcV2Runtime]);
  const sharedWalletActions = useMemo<WalletSessionActions>(
    () => ({
      connectBrowserWallet: (walletId?: string, options = {}) =>
        activateBrowserWalletSessionWithBootstrap(walletId, {
          forceAccountPicker: options.forceAccountPicker,
          forceFreshPrivacy: options.forceFreshPrivacy,
          preparePrivacy: options.preparePrivacy
        }),
      disconnect: disconnectWallet,
      getOwnerSigner: getOwnerFundsSigner,
      getCurrentDexQuoteCapability,
      getCurrentDexPoolFundingCapability,
      getCurrentDexPoolPositionCapability,
      getCurrentDexLimitCapability,
      getCurrentDexReceiptCapability,
      getCurrentSharedDexTokenFundsCapability,
      getCurrentDexSubmissionCapability,
      getOtcV2Capability,
      getPrivateLiquidityCapability,
      getSigner: getSharedWalletSigner,
      runWalletTransactionFlow: runSharedWalletTransactionFlow,
      unlockPrivacy: (options = {}) => runSharedWalletTransactionFlow(() =>
        getSharedWalletSigner(true, {
          refreshAes: options.forceFreshPrivacy
        })
      )
    }),
    [
      activateBrowserWalletSessionWithBootstrap,
      disconnectWallet,
      getOwnerFundsSigner,
      getOtcV2Capability,
      getPrivateLiquidityCapability,
      getCurrentDexReceiptCapability,
      getCurrentSharedDexTokenFundsCapability,
      getCurrentDexSubmissionCapability,
      getCurrentDexQuoteCapability,
      getCurrentDexPoolFundingCapability,
      getCurrentDexPoolPositionCapability,
      getCurrentDexLimitCapability,
      getSharedWalletSigner,
      runSharedWalletTransactionFlow
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
      chainId,
      onWalletAesHealthChange: setWalletAesHealth,
      otcV2ActionRuntime,
      otcV2Runtime,
      otcV2RuntimeError: otcV2HistorySetupError || otcV2ActionSetupError,
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
      chainId,
      chatPreferredBrowserWalletOption?.label,
      currentInjectedWalletOption?.id,
      currentInjectedWalletOption?.label,
      otcV2ActionRuntime,
      otcV2Runtime,
      otcV2HistorySetupError,
      otcV2ActionSetupError,
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
    chatReactionsV1Enabled,
    directChatV2RepliesEnabled:
      activeSignerSource === 'metamask' && directChatV2Runtime?.enabled === true,
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

  const activeWalletControl =
    activePage === 'chat' || activePage === 'swap' || activePage === 'trades' || activePage === 'dex' || activePage === 'treasury'
      ? chatWalletHeaderControl
      : null;

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
      onOpenHelp={activeWalletControl ? undefined : openCurrentAppHelp}
      onCloseMobileLinks={() => setMobileLinksOpen(false)}
      debugControl={headerDebugControl}
      links={links}
      brandActions={brandActions}
      homeControl={headerHomeAction}
      appNavigationControl={appHeaderNavigationControl}
      walletControl={walletControl}
      subtitle={subtitle}
      showSoundToggle={showSoundToggle && !walletControl}
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
  const chatWorkspace = (
    <>
      <div className={`app-root${isConnected ? '' : ' app-root-readiness'}`}>
        {isConnected ? (
          <ContactsSidebar
            nicknameEditorRef={nicknameEditorRef}
            nicknameMaxBytes={nicknameMaxBytes}
            hasAesReady={hasAesReady}
            canSavePublicName={
              activeSignerSource === 'metamask' && directChatV2Runtime?.enabled === true
            }
            walletAddress={walletAddress}
            onNicknameInputChange={setMyNickname}
            onSaveNickname={handleSaveNickname}
            hasUnreadConversations={hasUnreadConversations}
            readStateActionsDisabled={!readStateFeaturesEnabled}
            walletPromptSensitiveActionsTitle={browserWalletLiteModeTitle}
            onMarkAllConversationsAsRead={markAllConversationsAsRead}
            onForceSync={handleForceSync}
            syncingHistory={directChatV2Runtime?.enabled ? directChatV2Refreshing : syncingHistory}
            syncingGroups={groupChatV2Runtime?.enabled ? groupChatV2Refreshing : syncingGroups}
            groupDiscoveryState={groupChatV2DiscoveryState}
            onOpenNewChat={handleOpenNewChat}
            showHiddenContacts={showHiddenContacts}
            onToggleShowHiddenContacts={handleToggleShowHiddenContacts}
            hiddenContactsCount={hiddenContactsCount}
            hiddenContactsLabel={hiddenContactsLabel}
            contactGroupPanelRatio={contactGroupPanelRatio}
            visibleSortedContacts={visibleSortedContacts}
            contactsListEmptyMessage={contactsListEmptyMessage}
            activeContact={activeContact}
            isConversationStateSyncPending={isConversationStateSyncPending}
            conversationMetadataActionsDisabled={browserWalletLiteMode && directChatV2Runtime?.enabled !== true}
            messagesByContact={messagesByContact}
            lastCopiedKey={lastCopiedKey}
            unreadMap={readStateFeaturesEnabled || directChatV2Runtime?.enabled ? unreadMap : {}}
            onCopyWithFeedback={copyWithFeedback}
            onActivateContact={activateContact}
            onRemoveContact={removeContact}
            sortedGroupInvites={sortedGroupInvites}
            onAcceptGroupInvite={handleAcceptGroupInvite}
            onDeclineGroupInvite={handleDeclineGroupInvite}
            processingGroupAction={processingGroupAction}
            sortedGroups={sortedGroups}
            activeGroupId={activeGroupId}
            messagesByGroup={messagesByGroup}
            unreadGroupMap={readStateFeaturesEnabled || groupChatV2Runtime?.enabled ? unreadGroupMap : {}}
            onActivateGroup={activateGroup}
            onPrefetchGroup={prefetchGroupBeforeOpen}
            error={error || (groupChatV2HistoryUnavailable ? 'Group history unavailable. Refresh to retry.' : '')}
          />
        ) : null}

        <main className="chat-panel">
          <h1 className="app-visually-hidden">Encrypted Chat</h1>
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
                error={walletConnectionError}
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
                onTransferAdmin={transferAdminToMember}
                adminTransferEnabled={Boolean(groupChatV2Runtime?.enabled)}
                desktopJoinCodeList={desktopJoinCodeList}
                desktopInviteMenu={desktopInviteMenu}
                mobileInviteTools={mobileInviteTools}
                desktopGroupActions={desktopGroupActions}
                mobileGroupActions={mobileGroupActions}
                isMobileNav={isMobileNav}
                syncingGroups={groupChatV2Runtime?.enabled ? groupChatV2Refreshing : syncingGroups}
                mobileGroupOptionsOpen={mobileGroupOptionsOpen}
                onToggleMobileGroupOptions={() => setMobileGroupOptionsOpen((previous) => !previous)}
                onRefreshGroup={() => {
                  if (groupChatV2Runtime?.enabled) refreshGroupChatV2();
                  else syncGroupData({ deep: true }).catch(() => {});
                }}
                chatMessagesRef={setChatMessagesContainerRef}
                activeGroupMessages={visibleActiveGroupMessages}
                messageLoadPhase={activeGroupMessageLoadPhase}
                groupEpochSyncRequired={
                  groupChatV2EpochSyncRequest?.groupId === activeGroupId
                }
                groupEpochSyncPending={synchronizingGroupChatV2Epoch}
                onSynchronizeGroupEpoch={() => {
                  void synchronizeGroupChatV2Epoch();
                }}
                isReactionOnlyMessage={isReactionOnlyMessage}
                getReactionsForMessage={getReactionsForMessage}
                reactionPickerMessageId={reactionPickerMessageId}
                onToggleReactionPicker={(messageId) => {
                  if (browserWalletLiteMode && !chatReactionsV1Enabled) {
                    return;
                  }
                  setReactionPickerMessageId((previous) => (previous === messageId ? null : messageId));
                }}
                sendingReaction={sendingReaction}
                onSendReaction={sendReactionToMessage}
                walletPromptSensitiveActionsDisabled={browserWalletLiteMode && directChatV2Runtime?.enabled !== true}
                walletPromptSensitiveActionsTitle={browserWalletLiteModeTitle}
                chatReactionsV1Enabled={chatReactionsV1Enabled}
                groupChatV2RepliesEnabled={
                  activeSignerSource === 'metamask' && groupChatV2Runtime?.enabled === true
                }
                replyingToMessage={replyingToMessage}
                onReplyToMessage={(message) => {
                  if (browserWalletLiteMode && (
                    !groupChatV2Runtime?.enabled || !message.groupV2
                  )) {
                    setError('Group Chat V2 can reply only to authenticated new-protocol messages.');
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
                promptEstimate={groupChatV2Runtime?.enabled ? {
                  tone: 'ok',
                  label: buildGroupChatV2PromptEstimateMessage(
                    replyingToMessage ? 'this reply' : 'this group message'
                  )
                } : null}
                onOpenInternalAppLink={navigateToInternalAppLink}
              />
            ) : activeContact ? (
              <DirectChatPanel
                activeContact={activeContact!}
                activeContactMeta={activeContactMeta}
                isSelfChat={isSelfChat}
                activeConversationHidden={activeConversationHidden}
                activeConversationStateSyncPending={activeConversationStateSyncPending}
                walletPromptSensitiveActionsDisabled={browserWalletLiteMode}
                walletPromptSensitiveActionsTitle={browserWalletLiteModeTitle}
                chatReactionsV1Enabled={chatReactionsV1Enabled}
                directChatV2RepliesEnabled={
                  activeSignerSource === 'metamask' && directChatV2Runtime?.enabled === true
                }
                pendingNativeCreditLabel={
                  directChatV2NativeCredit !== null && directChatV2NativeCredit > 0n
                    ? `${formatCotiAmount(directChatV2NativeCredit)} COTI tips`
                    : ''
                }
                withdrawingNativeCredit={withdrawingDirectChatV2NativeCredit}
                onWithdrawNativeCredit={() => {
                  void withdrawDirectChatV2NativeCredit();
                }}
                directChatV2KeyRotationEnabled={
                  activeSignerSource === 'metamask' && directChatV2Runtime?.enabled === true
                }
                rotatingDirectChatV2Key={rotatingDirectChatV2Key}
                onRotateDirectChatV2Key={() => {
                  void rotateDirectChatV2Key();
                }}
                onToggleConversationHidden={() => {
                  toggleConversationHiddenForContact(activeContact!).catch(() => {});
                }}
                onSaveContactName={(name) => savePrivateContactName(activeContact!, name)}
                onLoadFullConversationHistory={() => {
                  if (directChatV2Runtime?.enabled) directChatV2RefreshRef.current?.();
                  else void loadFullConversationHistory();
                }}
                syncingHistory={directChatV2Runtime?.enabled ? directChatV2Refreshing : syncingHistory}
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
                supportedTradeEscrowContracts={DIRECT_TRADE_V2_SUPPORTED_CONTRACTS}
                linkedTradeContext={activeLinkedTradeContext}
                linkedTradeContextShareCopied={lastCopiedKey === activeLinkedTradeContextCopyKey}
                walletAddress={walletAddress}
                privacyUnlocked={hasAesReady}
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
                onRevealTradeTerms={
                  hasAesReady && directTradeV2Runtime?.isCurrent()
                    ? revealEmbeddedDirectTradeTerms
                    : undefined
                }
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
                nativeTipsOnly={directChatV2Runtime?.enabled === true}
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
              <div className="chat-placeholder chat-placeholder-state" aria-labelledby="chat-empty-title">
                <div className="chat-placeholder-card">
                  <span>Private messaging</span>
                  <h2 id="chat-empty-title">{hasAesReady ? 'Start a conversation' : 'Unlock private chat'}</h2>
                  <p>{hasAesReady ? 'Add a contact, create a group or use an invitation code.' : 'Unlock privacy to view messages and start a conversation.'}</p>
                  <button type="button" onClick={hasAesReady ? handleOpenNewChat : unlockPrivacy}>
                    {hasAesReady ? 'New chat' : 'Unlock privacy'}
                  </button>
                </div>
              </div>
            )}
          </Suspense>
          </AppErrorBoundary>
        </main>
      </div>

      {isConnected ? (
        <MobileBottomNav activeMobileView={activeMobileView} isConnected onSelectView={setActiveMobileView} />
      ) : null}

      {showQuickActionsModal ? (
        <Suspense fallback={null}>
          <QuickActionsModal
            isOpen={showQuickActionsModal}
            onClose={() => setShowQuickActionsModal(false)}
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
      <TradeActionConfirmModal
        confirmation={inChatTradeConfirmation}
        onCancel={() => resolveInChatTradeConfirmation(false)}
        onConfirm={() => resolveInChatTradeConfirmation(true)}
      />
    </>
  );

  if (activePage === 'home') {
    return (
      <div className="app-shell app-shell-landing app-shell-home">
        {renderAppHeader({ links: COTI_ECOSYSTEM_LINKS })}
        <HomePage
          networkName={COTI_NETWORK.shortName}
          onLaunchChat={() => navigateToPage('chat')}
          onOpenSwap={() => navigateToPage('swap')}
          onOpenPrivateTvl={() => navigateToPage('treasury')}
          onPrefetchChat={preloadChatPage}
          onPrefetchSwap={preloadSwapPage}
          onPrefetchTrades={preloadTradesPage}
          onPrefetchPrivateTvl={preloadPrivateTvlPage}
          onOpenTrades={() => navigateToPage('trades')}
        />
      </div>
    );
  }

  if (activePage === 'trades') {
    return (
      <div
        className={`app-shell app-shell-wallet app-shell-trades${mobileTradingScrolled ? ' mobile-trading-scrolled' : ''}`}
      >
        {renderAppHeader({
          walletControl: activeWalletControl,
          subtitle: 'DEX & P2P',
          showSoundToggle: true
        })}
        <AppErrorBoundary
          onOpenHelp={openGenericErrorHelp}
          resetKey={appHelpLaunchContext ? `${appHelpLaunchContext.origin}:${appHelpLaunchContext.topicId ?? ''}` : ''}
        >
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="standalone-trades-shell" label="Loading Trading" />
            }
          >
            <P2PTradingPage
              isMobileNav={isMobileNav}
              renderTradingHeader={p2pMarket => <TradingProductSwitch
                activeProduct="p2p"
                p2pMarket={p2pMarket}
                onNavigate={product => navigateToPage(product === 'dex' ? 'dex' : 'trades')}
                priceDisplayInverted={tradingPriceDisplayInverted}
                onPriceDisplayInvertedChange={setTradingPriceDisplayInverted}
              />}
              priceDisplayInverted={tradingPriceDisplayInverted}
              onPriceDisplayInvertedChange={setTradingPriceDisplayInverted}
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

  if (activePage === 'dex') {
    const showDexAgent = navigationPath === '/dex/agent';
    return (
      <div
        className={`app-shell app-shell-wallet app-shell-dex-v2${showDexAgent ? ' app-shell-trades app-shell-dex-agent' : ''}${mobileTradingScrolled ? ' mobile-trading-scrolled' : ''}`}
        data-dex-candidate={dexAppScope.key}
        data-dex-core={dexAppScope.candidate.core}
        data-dex-graph={dexAppScope.candidate.graph}
      >
        {renderAppHeader({
          walletControl: activeWalletControl,
          subtitle: 'Private DEX',
          showSoundToggle: true
        })}
        <TradingProductSwitch
          activeProduct="dex"
          dexCandidate={dexAppScope.key === 'cheap-exit' || dexAppScope.key === 'cheap-history' ? dexAppScope.candidate : undefined}
          marketReference={currentMarketReference}
          onNavigate={(product) => navigateToPage(product === 'dex' ? 'dex' : 'trades')}
          selectedPair={selectedTradingPair}
          onSelectedPairChange={setSelectedTradingPair}
          priceDisplayInverted={tradingPriceDisplayInverted}
          onPriceDisplayInvertedChange={setTradingPriceDisplayInverted}
        />
        <AppErrorBoundary onOpenHelp={openGenericErrorHelp}>
          <Suspense fallback={<RouteLoadingFallback shellClassName="dex-v2-loading-shell" label={showDexAgent ? 'Loading Trade Agent' : 'Loading Private DEX'} />}>
            {showDexAgent ? (
              <P2PTradingPage
                isMobileNav={isMobileNav}
                priceDisplayInverted={tradingPriceDisplayInverted}
                onPriceDisplayInvertedChange={setTradingPriceDisplayInverted}
                sharedWalletSession={sharedTradeWalletSession}
                appHelpLaunchContext={appHelpLaunchContext}
                onAppHelpLaunchConsumed={() => setAppHelpLaunchContext(null)}
                onOpenAppHelp={(reason) => openAppHelp({ origin: 'otc', reason })}
                onOpenInternalAppLink={navigateToInternalAppLink}
                onOpenTradeConversation={ensureContactAndOpenTradeChat}
              />
            ) : (
              <DexV2Page
                swapCandidate={dexAppScope.key}
                marketReference={currentMarketReference}
                dailyPriceConfig={currentNativeDexDailyPriceConfig(dexAppScope.candidate, dexAppPair)}
                onPriceDisplayInvertedChange={setTradingPriceDisplayInverted}
                priceDisplayInverted={tradingPriceDisplayInverted}
                selectedPair={dexAppPair}
                sharedWalletSession={sharedTradeWalletSession}
                onOpenAgent={() => navigateToInternalAppLink('/dex/agent')}
                onNavigateMode={(mode) => navigateToInternalAppLink(mode === 'swap' ? '/dex' : `/dex/${mode}`)}
              />
            )}
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  if (activePage === 'swap') {
    return (
      <div className="app-shell app-shell-wallet app-shell-swap">
        {renderAppHeader({
          walletControl: activeWalletControl,
          subtitle: 'Privacy Portal',
          showSoundToggle: true
        })}
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
                canEarlierLegacyUnshield: canEarlierLegacyUnshieldTokens,
                publicSymbol: rewardTokenSymbol,
                privateSymbol: wispCurrentPrivateTokenSymbol,
                legacyPrivateSymbol: legacyPrivateRewardTokenSymbol,
                inputSymbol: swapInputSymbol,
                feeLabel: wispRecoveryFeeLabel,
                liquidityLabel: wispRecoveryLiquidityLabel,
                contractUrl: wispBridgeContractUrl,
                legacyContractUrl: legacySwapVaultContractUrl,
                busy: swappingTokens,
                actionStage: swapActionStage,
                canSubmit: wispRecoveryCanSubmit,
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
      <div className="app-shell app-shell-wallet app-shell-landing">
        {renderAppHeader({
          subtitle: 'Private TVL',
          walletControl: activeWalletControl,
          showSoundToggle: true
        })}
        <AppErrorBoundary onOpenHelp={openGenericErrorHelp}>
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="treasury-shell" label="Loading COTI Private TVL" variant="treasury" />
            }
          >
            <PrivateTvlPage isCompactLayout={isMobileNav} />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  return (
    <div className={`app-shell app-shell-wallet app-shell-chat${isConnected ? '' : ' app-shell-chat-readiness'} mobile-view-${activeMobileView}`}>
      {renderAppHeader({
        debugControl,
        brandActions: chatBrandActions,
        walletControl: activeWalletControl,
        subtitle: 'Chat',
        showSoundToggle: true
      })}
      {chatWorkspace}
    </div>
  );
}
