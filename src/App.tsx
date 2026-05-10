import { FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AppErrorBoundary from './components/AppErrorBoundary';
import AppHeader from './components/AppHeader';
import ContactsSidebar from './components/ContactsSidebar';
import GroupActionControls from './components/GroupActionControls';
import HomePage from './components/HomePage';
import { ActiveJoinCodeList, GroupInviteMenu } from './components/GroupInviteTools';
import MobileBottomNav from './components/MobileBottomNav';
import { readChatComposerText } from './components/chatComposeText';
import useBlockTimestampCache from './hooks/useBlockTimestampCache';
import { useBurnerWallet } from './hooks/useBurnerWallet';
import useChatWalletHeaderControl from './hooks/useChatWalletHeaderControl';
import useDirectConversationSync from './hooks/useDirectConversationSync';
import useGroupAdminActions from './hooks/useGroupAdminActions';
import useInChatTradeActions from './hooks/useInChatTradeActions';
import { useNotificationSound } from './hooks/useNotificationSound';
import useImageAttachmentStatus from './hooks/useImageAttachmentStatus';
import { useStateBackupSync } from './hooks/useStateBackupSync';
import { useStoredWalletPreference } from './hooks/useStoredWalletPreference';
import { useWalletOnboarding } from './hooks/useWalletOnboarding';
import {
  buildMessageReferenceKey,
  buildMessageReferenceKeys,
  buildTradeCustomTokenInfoKey,
  DEFAULT_TRADE_EXPIRY_HOURS,
  getVerifiedEcosystemToken,
  getOnChainFailureMessage,
  isCustomTradeTokenSelection,
  messageReferencesMatch,
  parseSharedTxReference,
  resolveTradePresetKind,
  sanitizeOutgoingMessagePlainText,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from './lib/appHelpers';
import {
  fetchTradeSnapshotById,
  readCurrentPrivateErc20BalanceWei,
  readLegacyPrivateRewardBalanceWei
} from './lib/appChain';
import {
  buildWalletAesHealthState,
  getOrRecoverAesForWallet,
  type WalletAesHealthState
} from './lib/cotiAesUnlock';
import { COTI_ECOSYSTEM_LINKS } from './lib/ecosystemLinks';
import { submitGroupMemo } from './lib/groupChatChain';
import { runWalletTransactionFlow } from './lib/walletTransactionFlow';
import {
  submitDirectMemo,
  submitHiddenContactNameMemo,
  submitHiddenConversationStateMemo
} from './lib/directChatChain';
import {
  fetchOnChainNicknames as fetchOnChainNicknamesLookup,
  getNicknameMaxLength as getNicknameMaxLengthLookup,
  loadMyNicknameFromChain as loadMyNicknameFromChainLookup,
  resolveConversationBlockRange as resolveConversationBlockRangeLookup,
  saveMyNicknameOnChain as saveMyNicknameOnChainLookup
} from './lib/appLookup';
import {
  getStoredGroupRemovalNoticeMarker as getStoredGroupRemovalNoticeMarkerStorage,
  getPreferredBrowserWalletId,
  setStoredGroupRemovalNoticeMarker as setStoredGroupRemovalNoticeMarkerStorage
} from './lib/appStorage';
import { sendChatImageAttachment } from './lib/chatImageAttachment';
import { deriveTradeComposerModel } from './lib/tradeComposer';
import { mergeDirectSyncOptions } from './lib/directSyncPlan';
import { syncActiveGroupMessagesFast, type GroupMessageSyncContract } from './lib/groupMessageSync';
import {
  collectGroupIdsFromLogs,
  collectLatestGroupRemovalEvents,
  mergeGroupSyncOptions,
  resolveActiveGroupBackfillPlan,
  resolveGroupPrefetchPlan,
  resolveRealtimeGroupSyncOptions,
  resolveTrackedGroupMessageLoad,
  trackedGroupMessageLoadsMatch,
  type GroupMessageLoadPhase
} from './lib/groupSyncPlan';
import {
  hasSessionAesKey,
  resolveWalletBlockedActionLabel,
  type SharedWalletSession,
  type WalletSessionActions
} from './lib/walletSession';
import {
  getPathForAppPage,
  resolveAppRouteFromLocation,
  resolveNavigationPathFromLocation,
  type AppPage
} from './shell/routing';
import { getAppWalletPolicy } from './shell/walletPolicy';
import { attachWsDisconnectListeners } from './shell/realtimeConnection';
import { useAppShellStore } from './state/appShellStore';
import { useChatUiStore } from './state/chatUiStore';
import { useGroupUiStore } from './state/groupUiStore';
import { useInChatTradeStore } from './state/inChatTradeStore';
import { useTokenToolsStore } from './state/tokenToolsStore';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  AUTO_SYNC_INTERVAL_MS,
  BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI,
  buildTradeSnapshotKey,
  buildMessageWithReactionPayload,
  buildMessageWithReplyPayload,
  BURNER_PIN_MIN_LENGTH,
  BurnerWalletRecord,
  calculateEstimatedBurnerTopUpAmount,
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  ChatMessage,
  Contact,
  ConversationBlockRange,
  ConversationPreferenceState,
  COPY_FEEDBACK_DURATION_MS,
  COTI_NETWORK,
  createCotiBrowserProvider,
  decodeMemoPlaintextStrict,
  encodeCompactMemoPlaintext,
  DEFAULT_GROUP_JOIN_CODE_MULTI_USES,
  DEFAULT_NICKNAME_MAX_BYTES,
  encodeMemoPlaintext,
  ERC20_TOKEN_ABI,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  formatCotiAmount,
  formatTokenAmount,
  getCotiWsLastHealthyAt,
  getGroupActionErrorMessage,
  getMessageDisplayText,
  getProviderErrorMessage,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_REMOVAL_NOTICE_AUTO_DISMISS_MS,
  GroupInvite,
  GroupSummary,
  hasInsufficientFundsError,
  IMAGE_MESSAGE_PREFIX,
  INITIAL_SYNC_LOOKBACK_BLOCKS,
  isProviderActionRejected,
  isWalletAddress,
  LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
  LEGACY_SWAP_VAULT_CONTRACT_ADDRESS,
  loadCotiEthersModule,
  loadCotiReadProvider,
  loadCotiWsProvider,
  MAX_MESSAGE_LENGTH,
  mergeOnboardInfo,
  markCotiWsHealthyNow,
  normalizeContactName,
  normalizeConversationPreferenceState,
  normalizeLastReadAllTs,
  normalizeReactionEmoji,
  normalizeTokenDecimals,
  parseChatMessagePayload,
  parseTradeOfferMessagePayload,
  parseStoredGroupTitle,
  parseSubmitMemoPayload,
  parseTokenAmountInput,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  resetCotiWsProvider,
  REWARD_TOKEN_ADDRESS,
  sanitizeTokenAmountInput,
  shortenAddress,
  SWAP_VAULT_CONTRACT_ABI,
  SWAP_VAULT_CONTRACT_ADDRESS,
  SyncConversationOptions,
  SyncGroupOptions,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TipTokenSelection,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  TradeAssetPayload,
  TradeOfferMessagePayload,
  TradeSnapshot,
  toSafeNumber,
  trimReplyPreview,
  WHISPER_REWARDS_ABI,
  WHISPER_SHIELD_ENABLED,
  WHISPER_SHIELD_LEGACY_UNSHIELD_ENABLED,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS,
} from './lib/appShared';

const BurnerBackupModal = lazy(() => import('./components/BurnerBackupModal'));
const BurnerImportModal = lazy(() => import('./components/BurnerImportModal'));
const BurnerPinModal = lazy(() => import('./components/BurnerPinModal'));
const QuickActionsModal = lazy(() => import('./components/QuickActionsModal'));
const TopUpModal = lazy(() => import('./components/TopUpModal'));
let directChatPanelModulePromise: Promise<typeof import('./components/DirectChatPanel')> | null = null;
let groupChatPanelModulePromise: Promise<typeof import('./components/GroupChatPanel')> | null = null;
let p2pTradingPageModulePromise: Promise<typeof import('./components/P2PTradingPage')> | null = null;
let tokenSwapPageModulePromise: Promise<typeof import('./components/TokenSwapPage')> | null = null;
let treasuryPageModulePromise: Promise<typeof import('./components/TreasuryPage')> | null = null;
let treasuryDataModulePromise: Promise<typeof import('./lib/treasuryData')> | null = null;
const loadDirectChatPanel = () => {
  directChatPanelModulePromise ??= import('./components/DirectChatPanel');
  return directChatPanelModulePromise;
};
const loadGroupChatPanel = () => {
  groupChatPanelModulePromise ??= import('./components/GroupChatPanel');
  return groupChatPanelModulePromise;
};
const loadP2PTradingPage = () => {
  p2pTradingPageModulePromise ??= import('./components/P2PTradingPage');
  return p2pTradingPageModulePromise;
};
const loadTokenSwapPage = () => {
  tokenSwapPageModulePromise ??= import('./components/TokenSwapPage');
  return tokenSwapPageModulePromise;
};
const loadTreasuryPage = () => {
  treasuryPageModulePromise ??= import('./components/TreasuryPage');
  return treasuryPageModulePromise;
};
const preloadTreasuryDashboardData = () => {
  treasuryDataModulePromise ??= import('./lib/treasuryData');
  void treasuryDataModulePromise.then(({ preloadDashboardData }) => preloadDashboardData()).catch(() => {});
};
const preloadTreasuryPage = () => {
  void loadTreasuryPage();
  preloadTreasuryDashboardData();
};
const preloadChatPage = () => {
  void loadDirectChatPanel();
  void loadGroupChatPanel();
};
const preloadTradesPage = () => {
  void loadP2PTradingPage();
};
const preloadSwapPage = () => {
  void loadTokenSwapPage();
};
const DirectChatPanel = lazy(loadDirectChatPanel);
const GroupChatPanel = lazy(loadGroupChatPanel);
const P2PTradingPage = lazy(loadP2PTradingPage);
const TokenSwapPage = lazy(loadTokenSwapPage);
const TreasuryPage = lazy(loadTreasuryPage);
const TradeComposerPanel = lazy(() => import('./components/TradeComposerPanel'));

function RouteLoadingFallback({
  label,
  shellClassName,
  variant = 'standard'
}: {
  label: string;
  shellClassName: string;
  variant?: 'standard' | 'treasury';
}) {
  const rowCount = variant === 'treasury' ? 4 : 3;

  return (
    <main className={shellClassName}>
      <section className={`route-loading route-loading-${variant}`} role="status" aria-live="polite" aria-label={label}>
        <div className="route-loading-header">
          <span className="inline-spinner" aria-hidden="true" />
          <span>{label}</span>
        </div>
        <div className="route-loading-lines" aria-hidden="true">
          {Array.from({ length: rowCount }, (_, index) => (
            <span key={`route-loading-line-${index}`} />
          ))}
        </div>
      </section>
    </main>
  );
}

const INITIAL_VISIBLE_THREAD_MESSAGE_COUNT = 160;
const VISIBLE_THREAD_MESSAGE_CHUNK = 120;
const BACKGROUND_DEEP_SYNC_DELAY_MS = 500;
const GROUP_MESSAGE_PREFETCH_LIMIT = 6;
const GROUP_MESSAGE_PREFETCH_BATCH_SIZE = 2;

const isInChatTradeOffer = (offer: TradeOfferMessagePayload): boolean =>
  !offer.hiddenLiquidity &&
  offer.escrowContract.toLowerCase() !== PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

export default function App() {
  const MOBILE_NAV_BREAKPOINT_PX = 920;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversationStateSyncPendingByContact, setConversationStateSyncPendingByContact] = useState<
    Record<string, boolean>
  >({});
  const [activeContact, setActiveContact] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
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
    quickActionTab,
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
    swapFeeModeSelection,
    swapDirection,
    swapAmountInput,
    swappingTokens,
    swapStatusMessage,
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
    setShieldVaultTokenBalanceWei,
    setRewardTokenBalanceWei,
    setPrivateRewardTokenBalanceWei,
    setRewardTokenSymbol,
    setPrivateRewardTokenSymbol,
    setRewardTokenDecimals,
    setPrivateRewardTokenDecimals,
    setSwapFeeWei,
    setSwapTokenFeeAmount,
    setGroupFeeModeSelection,
    setSwapFeeModeSelection,
    setSwapDirection,
    setSwapAmountInput,
    setSwappingTokens,
    setSwapStatusMessage,
    setLoadingTopUpQuote,
    setLoadingRewardBalances
  } = useTokenToolsStore();
  const [legacyPrivateRewardTokenBalanceWei, setLegacyPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
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
  const GROUP_REMOVAL_NOTICE_MARKERS_STORAGE_KEY = 'coti-chat-group-removal-notice-markers-v1';
  const {
    beginConnectSoundSuppression,
    endConnectSoundSuppression,
    initPersistentAudio,
    isConnectSoundSuppressed,
    playNotificationSound,
    stopNotificationSound
  } = useNotificationSound(soundEnabled);
  const [error, setError] = useState<string>('');
  const [tradeHeaderWalletControl, setTradeHeaderWalletControl] = useState<ReactNode>(null);
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
  const [chatAppWalletMenuOpen, setChatAppWalletMenuOpen] = useState(false);
  const [isMobileNav, setIsMobileNav] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_NAV_BREAKPOINT_PX : false
  );
  useEffect(() => {
    setGroupInviteTtlInput((previous) => {
      const normalized = previous.trim();
      if (!normalized || normalized === '168') {
        return '8';
      }
      return previous;
    });
  }, [setGroupInviteTtlInput]);
  const topHeaderRef = useRef<HTMLElement | null>(null);
  const nicknameEditorRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatComposerRef = useRef<HTMLDivElement | null>(null);
  const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const groupRemovalNoticeTimeoutRef = useRef<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const pendingJumpTargetIdRef = useRef<string | null>(null);
  const pendingForcedBottomAnchorThreadKeyRef = useRef<string | null>(null);
  const suppressNextBottomAnchorRef = useRef(false);
  const previousThreadMetricsRef = useRef<{ key: string | null; length: number; lastMessageId: string | null }>({
    key: null,
    length: 0,
    lastMessageId: null
  });
  const previousActiveContactForScrollRef = useRef<string | null>(null);
  const previousLastMessageIdForScrollRef = useRef<string | null>(null);
  const previousThreadMessageCountForScrollRef = useRef(0);
  const previousVisibleThreadMessageCountForScrollRef = useRef(0);
  const lastObservedScrollHeightRef = useRef<number>(0);
  const stickToBottomRef = useRef(true);
  const sendingRef = useRef(false);
  const previousWalletAddressRef = useRef<string>('');
  const postConnectDataSyncRunIdRef = useRef(0);
  const pinnedContactStateRef = useRef<Map<string, { muted?: boolean; hidden?: boolean }>>(new Map());
  const tradeRequiredFeeCacheRef = useRef<bigint | null>(null);
  const tradeRequiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const [visibleThreadMessageCount, setVisibleThreadMessageCount] = useState(0);
  const [chatMessagesViewportVersion, setChatMessagesViewportVersion] = useState(0);
  const { blockTimestampCacheRef, resetBlockTimestampCache, resolveBlockTimestampMap } = useBlockTimestampCache();
  const setChatMessagesContainerRef = useCallback((node: HTMLDivElement | null) => {
    const previousNode = chatMessagesRef.current;
    chatMessagesRef.current = node;
    if (node && previousNode !== node) {
      setChatMessagesViewportVersion((current) => current + 1);
    }
  }, []);

  useEffect(() => {
    lastReadAllTsRef.current = normalizeLastReadAllTs(lastReadAllTs);
  }, [lastReadAllTs]);

  const prevUnreadRef = useRef<Record<string, boolean>>({});
  const prevUnreadGroupRef = useRef<Record<string, boolean>>({});
  const notificationSuppressedContactAddressSet = useMemo(
    () =>
      new Set(
        contacts
          .filter((contact) => contact.muted || contact.hidden)
          .map((contact) => contact.address.trim().toLowerCase())
          .filter((address) => isWalletAddress(address))
      ),
    [contacts]
  );
  useEffect(() => {
    unreadMapRef.current = unreadMap || {};
  }, [unreadMap]);
  useEffect(() => {
    unreadGroupMapRef.current = unreadGroupMap || {};
  }, [unreadGroupMap]);

  useEffect(() => {
    if (notificationSuppressedContactAddressSet.size === 0) {
      return;
    }

    setUnreadMap((previous) => {
      if (Object.keys(previous).length === 0) {
        return previous;
      }

      let changed = false;
      const nextUnread = { ...previous };
      for (const address of Object.keys(nextUnread)) {
        if (notificationSuppressedContactAddressSet.has(address.toLowerCase())) {
          delete nextUnread[address];
          changed = true;
        }
      }

      if (!changed) {
        return previous;
      }

      unreadMapRef.current = nextUnread;
      return nextUnread;
    });
  }, [notificationSuppressedContactAddressSet, setUnreadMap]);

  useEffect(() => {
    const prevContacts = prevUnreadRef.current || {};
    const nextContacts = unreadMap || {};
    const prevGroups = prevUnreadGroupRef.current || {};
    const nextGroups = unreadGroupMap || {};
    const hasNewUnread = (
      next: Record<string, boolean>,
      previous: Record<string, boolean>,
      suppressedKeys?: Set<string>
    ) => {
      for (const key of Object.keys(next)) {
        if (suppressedKeys?.has(key.toLowerCase())) {
          continue;
        }
        if (next[key] && !previous[key]) {
          return true;
        }
      }
      return false;
    };

    const shouldPlaySound =
      hasNewUnread(nextContacts, prevContacts, notificationSuppressedContactAddressSet) ||
      hasNewUnread(nextGroups, prevGroups);
    if (shouldPlaySound && !isConnectSoundSuppressed()) {
      playNotificationSound();
    }

    prevUnreadRef.current = { ...nextContacts };
    prevUnreadGroupRef.current = { ...nextGroups };
  }, [
    unreadMap,
    unreadGroupMap,
    soundEnabled,
    notificationSuppressedContactAddressSet,
    isConnectSoundSuppressed,
    playNotificationSound
  ]);

  useEffect(() => {
    return () => {
      endConnectSoundSuppression();
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
        copyFeedbackTimeoutRef.current = null;
      }
    };
  }, [endConnectSoundSuppression]);

  const requiredFeeCacheRef = useRef<bigint | null>(null);
  const requiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const groupRequiredFeeCacheRef = useRef<bigint | null>(null);
  const groupRequiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const groupTokenFeeCacheRef = useRef<bigint | null>(null);
  const groupTokenFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const nicknameMaxBytesRequestRef = useRef<Promise<number> | null>(null);
  const nicknameMaxBytesLoadedRef = useRef(false);
  const submitSelectorRef = useRef<string | null>(null);
  const groupSubmitSelectorRef = useRef<string | null>(null);
  const onChainNicknameCacheRef = useRef<Record<string, string | null>>({});
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
  const resolveConversationBlockRangeRef = useRef<
    (contract: unknown, me: string, peer: string) => Promise<ConversationBlockRange | null>
  >(async () => null);
  const resolveSubmitSelectorRef = useRef<() => Promise<string>>(async () => {
    throw new Error('Submit selector is not ready yet.');
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
  const resolveRequiredFeeForSendRef = useRef<() => Promise<bigint>>(async () => {
    throw new Error('Fee quote is not ready yet.');
  });
  const resetBurnerSessionRef = useRef<() => void>(() => {});
  const schedulePostUnlockRefresh = useCallback(() => {
    window.setTimeout(() => {
      try {
        syncConversationHistoryRef.current({
          contactsOnly: true,
          previewPerContact: true,
          updateHead: true,
          background: true
        }).catch(() => {});
      } catch {}
    }, 300);
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
    disconnectWallet,
    ensureCotiNetwork,
    getConnectedProvider,
    injectedWalletOptions,
    preferredInjectedWalletOption,
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
    walletAddress
  } = useWalletOnboarding({
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
  const {
    beginBurnerPinFlow,
    beginRevealBurnerBackup,
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
    closeBurnerBackup,
    closeBurnerPinModal,
    importBurnerWallet,
    initializingBurner,
    openChangeBurnerPin,
    resetBurnerSession,
    savedBurnerWalletCount,
    setBurnerBalanceWei,
    setBurnerImportInput,
    setBurnerPinInput,
    setShowBurnerImportModal,
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
    currentWalletKeyRef,
    ensureCotiNetwork,
    loadMyNicknameFromChainRef,
    preferredInjectedWalletOption,
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
  const browserWalletLiteModeTitle = 'Use the app wallet for this chat feature.';
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
  const activeMessages = useMemo(() => {
    if (!activeContact) {
      return [];
    }
    return messagesByContact[activeContact.toLowerCase()] ?? [];
  }, [activeContact, messagesByContact]);
  const activeGroupMeta = useMemo(
    () => (activeGroupId !== null ? groups.find((group) => group.id === activeGroupId) ?? null : null),
    [groups, activeGroupId]
  );
  const activeGroupParticipants = useMemo(() => {
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
  }, [activeGroupMeta, walletAddress, myNickname, contacts]);
  const activeGroupMemberCount = activeGroupParticipants.length > 0 ? activeGroupParticipants.length : activeGroupMeta?.memberCount ?? 0;
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
  }, [isActiveGroupAdmin, activeGroupId, groupRenameInput, activeGroupMeta]);
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
  useEffect(() => {
    const previousThread = previousThreadMetricsRef.current;
    const nextThreadKey = activeThreadKey;
    const nextThreadLength = activeThreadMessages.length;
    const nextThreadLastMessageId = activeThreadLastMessageId;

    setVisibleThreadMessageCount((current) => {
      if (!nextThreadKey) {
        return 0;
      }
      if (previousThread.key !== nextThreadKey) {
        messageElementRefs.current = {};
        pendingJumpTargetIdRef.current = null;
        pendingForcedBottomAnchorThreadKeyRef.current = nextThreadKey;
        return Math.min(nextThreadLength, INITIAL_VISIBLE_THREAD_MESSAGE_COUNT);
      }

      if (nextThreadLength <= current) {
        return nextThreadLength;
      }

      const latestMessageChanged = previousThread.lastMessageId !== nextThreadLastMessageId;
      if (!latestMessageChanged) {
        if (current < INITIAL_VISIBLE_THREAD_MESSAGE_COUNT) {
          return Math.min(nextThreadLength, INITIAL_VISIBLE_THREAD_MESSAGE_COUNT);
        }
        return current;
      }

      if (
        current < INITIAL_VISIBLE_THREAD_MESSAGE_COUNT &&
        previousThread.length <= INITIAL_VISIBLE_THREAD_MESSAGE_COUNT
      ) {
        return Math.min(nextThreadLength, INITIAL_VISIBLE_THREAD_MESSAGE_COUNT);
      }

      return Math.min(current, nextThreadLength);
    });

    previousThreadMetricsRef.current = {
      key: nextThreadKey,
      length: nextThreadLength,
      lastMessageId: nextThreadLastMessageId
    };
  }, [activeThreadKey, activeThreadMessages.length, activeThreadLastMessageId]);
  const visibleActiveMessages = useMemo(() => {
    if (activeMessages.length <= visibleThreadMessageCount) {
      return activeMessages;
    }
    return activeMessages.slice(-visibleThreadMessageCount);
  }, [activeMessages, visibleThreadMessageCount]);
  const visibleActiveGroupMessages = useMemo(() => {
    if (activeGroupMessages.length <= visibleThreadMessageCount) {
      return activeGroupMessages;
    }
    return activeGroupMessages.slice(-visibleThreadMessageCount);
  }, [activeGroupMessages, visibleThreadMessageCount]);
  const activeThreadMessageReferenceLookup = useMemo(() => {
    const lookup = new Map<string, string>();

    for (const message of activeThreadMessages) {
      const canonicalKey = buildMessageReferenceKey({
        txHash: message.txHash,
        blockNumber: message.blockNumber,
        logIndex: message.logIndex
      });
      if (!canonicalKey) {
        continue;
      }

      for (const key of buildMessageReferenceKeys({
        txHash: message.txHash,
        blockNumber: message.blockNumber,
        logIndex: message.logIndex
      })) {
        if (!lookup.has(key)) {
          lookup.set(key, canonicalKey);
        }
      }
    }

    return lookup;
  }, [activeThreadMessages]);
  const isReactionOnlyMessage = useCallback(
    (message: ChatMessage): boolean =>
      Boolean(
        !message.isSystem &&
          buildMessageReferenceKey({
            txHash: message.reactionToTxHash,
            blockNumber: message.reactionToBlockNumber,
            logIndex: message.reactionToLogIndex
          }) &&
          message.reactionEmoji &&
          (message.text ?? '').trim().length === 0
      ),
    []
  );
  const activeThreadReactions = useMemo(() => {
    const ownAddress = walletAddress.trim().toLowerCase();
    const peerAddress = activeContact?.trim().toLowerCase() ?? '';
    const byTarget = new Map<string, Map<string, Set<string>>>();

    for (const message of activeThreadMessages) {
      if (message.deliveryState === 'failed') {
        continue;
      }

      const targetReferenceKeyCandidates = buildMessageReferenceKeys({
        txHash: message.reactionToTxHash,
        blockNumber: message.reactionToBlockNumber,
        logIndex: message.reactionToLogIndex
      });
      const targetReferenceKey =
        targetReferenceKeyCandidates.map((key) => activeThreadMessageReferenceLookup.get(key)).find(Boolean) ??
        targetReferenceKeyCandidates[0] ??
        '';
      const normalizedEmoji = normalizeReactionEmoji(message.reactionEmoji ?? '');
      if (!targetReferenceKey || !normalizedEmoji) {
        continue;
      }

      let reactorKey = '';
      const senderAddress = message.senderAddress?.trim().toLowerCase() ?? '';
      if (isWalletAddress(senderAddress)) {
        reactorKey = senderAddress;
      } else if (activeGroupId === null) {
        const fallbackDirectSender = message.direction === 'outgoing' ? ownAddress : peerAddress;
        if (isWalletAddress(fallbackDirectSender)) {
          reactorKey = fallbackDirectSender;
        }
      }

      if (!reactorKey) {
        reactorKey = `${message.direction}:${message.id}`;
      }

      let byEmoji = byTarget.get(targetReferenceKey);
      if (!byEmoji) {
        byEmoji = new Map<string, Set<string>>();
        byTarget.set(targetReferenceKey, byEmoji);
      }

      let reactors = byEmoji.get(normalizedEmoji);
      if (!reactors) {
        reactors = new Set<string>();
        byEmoji.set(normalizedEmoji, reactors);
      }

      reactors.add(reactorKey);
    }

    const summarized = new Map<string, Array<{ emoji: string; count: number; reactedByMe: boolean }>>();
    for (const [targetTxHash, byEmoji] of byTarget.entries()) {
      const rows = Array.from(byEmoji.entries())
        .map(([emoji, reactors]) => ({
          emoji,
          count: reactors.size,
          reactedByMe: ownAddress.length > 0 && reactors.has(ownAddress)
        }))
        .sort((left, right) => {
          if (left.count !== right.count) {
            return right.count - left.count;
          }
          return left.emoji.localeCompare(right.emoji);
        });

      summarized.set(targetTxHash, rows);
    }

    return summarized;
  }, [activeThreadMessages, activeContact, activeGroupId, activeThreadMessageReferenceLookup, walletAddress]);
  const getReactionsForMessage = useCallback(
    (message: ChatMessage): Array<{ emoji: string; count: number; reactedByMe: boolean }> => {
      const messageReferenceKeyCandidates = buildMessageReferenceKeys({
        txHash: message.txHash,
        blockNumber: message.blockNumber,
        logIndex: message.logIndex
      });
      const messageReferenceKey =
        messageReferenceKeyCandidates.map((key) => activeThreadMessageReferenceLookup.get(key)).find(Boolean) ??
        messageReferenceKeyCandidates[0] ??
        '';
      if (!messageReferenceKey) {
        return [];
      }

      return activeThreadReactions.get(messageReferenceKey) ?? [];
    },
    [activeThreadMessageReferenceLookup, activeThreadReactions]
  );
  const sortedContacts = useMemo(() => {
    const persistedOrderIndex = new Map<string, number>();
    for (let index = 0; index < persistedContactOrder.length; index += 1) {
      persistedOrderIndex.set(persistedContactOrder[index], index);
    }

    const withIndex = contacts.map((contact, index) => {
      const key = contact.address.toLowerCase();
      const messages = messagesByContact[key] ?? [];
      const latestTimestamp = messages.reduce((max, message) => {
        const value = message.timestamp ?? 0;
        return value > max ? value : max;
      }, 0);

      return {
        contact,
        index,
        messageCount: messages.length,
        latestTimestamp
      };
    });

    withIndex.sort((a, b) => {
      if (a.latestTimestamp !== b.latestTimestamp) {
        return b.latestTimestamp - a.latestTimestamp;
      }

      if (a.messageCount !== b.messageCount) {
        return b.messageCount - a.messageCount;
      }

      const aPersistedOrder = persistedOrderIndex.get(a.contact.address.toLowerCase());
      const bPersistedOrder = persistedOrderIndex.get(b.contact.address.toLowerCase());
      if (typeof aPersistedOrder === 'number' && typeof bPersistedOrder === 'number' && aPersistedOrder !== bPersistedOrder) {
        return aPersistedOrder - bPersistedOrder;
      }
      if (typeof aPersistedOrder === 'number') {
        return -1;
      }
      if (typeof bPersistedOrder === 'number') {
        return 1;
      }

      return a.index - b.index;
    });

    return withIndex.map((item) => item.contact);
  }, [contacts, messagesByContact, persistedContactOrder]);
  const visibleSortedContacts = useMemo(
    () =>
      sortedContacts.filter((contact) => {
        return showHiddenContacts ? !!contact.hidden : !contact.hidden;
      }),
    [sortedContacts, showHiddenContacts]
  );
  const hiddenContactsCount = useMemo(
    () => contacts.reduce((count, contact) => (contact.hidden ? count + 1 : count), 0),
    [contacts]
  );
  const hiddenContactsLabel = hiddenContactsCount === 1 ? '1 hidden chat' : `${hiddenContactsCount} hidden chats`;
  const contactsListEmptyMessage = showHiddenContacts
    ? 'No hidden conversations yet.'
    : contacts.length > 0 && hiddenContactsCount === contacts.length
      ? 'All contacts are hidden. Open hidden chats to restore one.'
      : 'No contacts yet.';
  const sortedGroups = useMemo(
    () =>
      [...groups].sort((left, right) => {
        if (left.lastTimestamp !== right.lastTimestamp) {
          return right.lastTimestamp - left.lastTimestamp;
        }
        return left.id - right.id;
      }),
    [groups]
  );
  const sortedGroupInvites = useMemo(
    () => [...groupInvites].sort((left, right) => left.expiresAt - right.expiresAt || left.groupId - right.groupId),
    [groupInvites]
  );
  const contactGroupPanelRatio = useMemo(() => {
    const contactCount = Math.max(visibleSortedContacts.length, 1);
    const groupCount = Math.max(sortedGroups.length + sortedGroupInvites.length, 1);
    const total = contactCount + groupCount;

    const contactsPanelFlex = Math.max(0.9, Math.min(2.1, (contactCount / total) * 3));
    const groupsPanelFlex = Math.max(0.9, Math.min(2.1, (groupCount / total) * 3));

    return { contactsPanelFlex, groupsPanelFlex };
  }, [visibleSortedContacts.length, sortedGroups.length, sortedGroupInvites.length]);
  const hasUnreadConversations = useMemo(
    () =>
      readStateFeaturesEnabled &&
      (Object.values(unreadMap).some((isUnread) => Boolean(isUnread)) ||
        Object.values(unreadGroupMap).some((isUnread) => Boolean(isUnread))),
    [readStateFeaturesEnabled, unreadMap, unreadGroupMap]
  );
  const estimatedMessagesLeft = useMemo(() => {
    if (burnerBalanceWei === null || BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI <= 0n) {
      return null;
    }

    return burnerBalanceWei / BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI;
  }, [burnerBalanceWei]);
  const activeContactMeta = useMemo(
    () => contacts.find((contact) => contact.address.toLowerCase() === activeContact?.toLowerCase()),
    [contacts, activeContact]
  );
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
  const activeConversationStateSyncPending = useMemo(
    () => isConversationStateSyncPending(activeContact),
    [activeContact, isConversationStateSyncPending]
  );
  const activeConversationMuted = Boolean(activeContactMeta?.muted);
  const activeConversationHidden = Boolean(activeContactMeta?.hidden);
  const isSelfChat = useMemo(
    () => Boolean(activeContact && walletAddress && activeContact.toLowerCase() === walletAddress.toLowerCase()),
    [activeContact, walletAddress]
  );
  const hasAesReady = useMemo(
    () => {
      const walletKey = walletAddress.trim().toLowerCase();
      return (
        hasSessionAesKey(walletAddress, sessionOnboardInfo) &&
        walletAesHealthByAddress[walletKey]?.status !== 'key-mismatch'
      );
    },
    [walletAddress, sessionOnboardInfo, walletAesHealthByAddress]
  );
  const canManageActiveGroupJoinCodes = useMemo(() => {
    if (activeGroupId === null) {
      return false;
    }
    if (!isActiveGroupAdmin || !hasAesReady) {
      return false;
    }
    return chainId === COTI_NETWORK.chainIdDecimal;
  }, [activeGroupId, isActiveGroupAdmin, hasAesReady, chainId]);
  useEffect(() => {
    if (!canManageActiveGroupJoinCodes && groupInviteMenuView !== 'invite') {
      setGroupInviteMenuView('invite');
    }
  }, [canManageActiveGroupJoinCodes, groupInviteMenuView]);
  const hasSavedBurnerWallet = savedBurnerWalletCount > 0;
  const findContactNameForWalletAddress = (address?: string): string | undefined => {
    if (!address) {
      return undefined;
    }

    const normalizedAddress = address.toLowerCase();
    const contactName = contacts.find((contact) => contact.address.toLowerCase() === normalizedAddress)?.name;
    if (contactName) {
      return contactName;
    }

    const onChainNickname = onChainNicknameCacheRef.current[normalizedAddress];
    return onChainNickname ?? undefined;
  };
  const getBurnerWalletDisplayName = (walletRecord: BurnerWalletRecord): string => {
    const recordAddress = walletRecord.address?.toLowerCase();
    const currentWalletKey = walletAddress.trim().toLowerCase();
    if (recordAddress && recordAddress === currentWalletKey) {
      const ownNickname = normalizeContactName(myNickname);
      if (ownNickname) {
        return ownNickname;
      }
    }
    return findContactNameForWalletAddress(walletRecord.address) ?? (walletRecord.address ? shortenAddress(walletRecord.address) : 'Unnamed');
  };
  const handleSwitchActiveBurnerWallet = useCallback(
    (walletIdOrAddress: string) => {
      const walletSelector = walletIdOrAddress.trim();
      const walletSelectorKey = walletSelector.toLowerCase();
      const selectedWalletRecord = burnerWallets.find(
        (walletRecord) =>
          walletRecord.id === walletSelector || walletRecord.address?.toLowerCase() === walletSelectorKey
      );
      const selectedWalletKey = selectedWalletRecord?.address?.toLowerCase() ?? '';
      const currentWalletKey = walletAddress.trim().toLowerCase();
      const selectorIsCurrentAddress = isWalletAddress(walletSelector) && walletSelectorKey === currentWalletKey;
      if (
        !walletSelector ||
        (activeSignerSource === 'burner' && (selectorIsCurrentAddress || selectedWalletKey === currentWalletKey))
      ) {
        return;
      }

      switchActiveBurnerWallet(walletSelector).catch(() => {});
    },
    [activeSignerSource, burnerWallets, switchActiveBurnerWallet, walletAddress]
  );
  const findBurnerWalletDefaultNameForAddress = (address: string): string | undefined => {
    const normalizedAddress = address.toLowerCase();
    const currentWalletKey = walletAddress.trim().toLowerCase();
    if (normalizedAddress === currentWalletKey) {
      const ownNickname = normalizeContactName(myNickname);
      if (ownNickname) {
        return ownNickname;
      }
    }
    const walletIndex = burnerWallets.findIndex(
      (walletRecord) => walletRecord.address?.toLowerCase() === normalizedAddress
    );

    if (walletIndex < 0) {
      return undefined;
    }

    return getBurnerWalletDisplayName(burnerWallets[walletIndex]);
  };
  const canShieldTokens = WHISPER_SHIELD_ENABLED && Boolean(SWAP_VAULT_CONTRACT_ADDRESS);
  const canUnshieldTokens =
    WHISPER_SHIELD_LEGACY_UNSHIELD_ENABLED && Boolean(LEGACY_SWAP_VAULT_CONTRACT_ADDRESS);
  const currentSwapDirectionEnabled = swapDirection === 'shield' ? canShieldTokens : canUnshieldTokens;
  const activeSwapVaultContractAddress =
    swapDirection === 'unshield' ? LEGACY_SWAP_VAULT_CONTRACT_ADDRESS : SWAP_VAULT_CONTRACT_ADDRESS;
  const swapPrivateRewardTokenBalanceWei =
    swapDirection === 'unshield' ? legacyPrivateRewardTokenBalanceWei : privateRewardTokenBalanceWei;
  const swapPrivateRewardTokenSymbol =
    swapDirection === 'unshield'
      ? `${legacyPrivateRewardTokenSymbol || FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL} (old)`
      : privateRewardTokenSymbol;
  const swapPrivateRewardTokenDecimals =
    swapDirection === 'unshield' ? legacyPrivateRewardTokenDecimals : privateRewardTokenDecimals;
  const swapInputDecimals = swapDirection === 'shield' ? rewardTokenDecimals : swapPrivateRewardTokenDecimals;

  useEffect(() => {
    if (swapDirection === 'shield' && !canShieldTokens && canUnshieldTokens) {
      setSwapDirection('unshield');
    }
  }, [canShieldTokens, canUnshieldTokens, setSwapDirection, swapDirection]);

  const tokenToolsSummary = useMemo(() => {
    if (loadingRewardBalances) {
      return 'Loading balances...';
    }
    const publicBalance =
      rewardTokenBalanceWei !== null ? formatTokenAmount(rewardTokenBalanceWei, rewardTokenDecimals, 4) : '--';
    const privateBalance =
      swapPrivateRewardTokenBalanceWei !== null
        ? formatTokenAmount(swapPrivateRewardTokenBalanceWei, swapPrivateRewardTokenDecimals, 4)
        : hasAesReady
          ? '--'
          : 'AES';
    return `${rewardTokenSymbol} ${publicBalance} | ${swapPrivateRewardTokenSymbol} ${privateBalance}`;
  }, [
    loadingRewardBalances,
    rewardTokenSymbol,
    swapPrivateRewardTokenSymbol,
    rewardTokenBalanceWei,
    swapPrivateRewardTokenBalanceWei,
    rewardTokenDecimals,
    swapPrivateRewardTokenDecimals,
    hasAesReady
  ]);
  const parsedSwapAmount = useMemo(
    () => parseTokenAmountInput(swapAmountInput, swapInputDecimals),
    [swapAmountInput, swapInputDecimals]
  );
  const swapInputSymbol = swapDirection === 'shield' ? rewardTokenSymbol : swapPrivateRewardTokenSymbol;
  const canSwapRewardTokens =
    currentSwapDirectionEnabled &&
    !swappingTokens &&
    !!walletAddress &&
    onCotiNetwork &&
    hasAesReady &&
    parsedSwapAmount !== null &&
    parsedSwapAmount > 0n;
  const swapBlockedActionLabel = resolveWalletBlockedActionLabel({
    hasAesReady,
    onCotiNetwork,
    walletAddress
  });
  const swapButtonLabel = swappingTokens
    ? 'Swapping...'
    : !currentSwapDirectionEnabled
      ? swapDirection === 'shield'
        ? 'Shield paused'
        : 'Legacy unshield unavailable'
      : swapBlockedActionLabel
        ? swapBlockedActionLabel
        : parsedSwapAmount === null || parsedSwapAmount <= 0n
          ? `Enter ${swapInputSymbol} amount`
          : swapDirection === 'shield'
            ? `Shield to ${swapPrivateRewardTokenSymbol}`
            : `Unshield to ${rewardTokenSymbol}`;
  const topUpAmountLabel = useMemo(() => {
    if (topUpAmountWei !== null) {
      return `${formatCotiAmount(topUpAmountWei, 3)} COTI`;
    }
    return '--';
  }, [topUpAmountWei]);
  const activeTipTokenSymbol =
    tipTokenSelection === 'coti'
      ? TIP_NATIVE_TOKEN_SYMBOL
      : tipTokenSelection === 'wisp'
        ? rewardTokenSymbol
        : privateRewardTokenSymbol;
  const activeTipTokenDecimals =
    tipTokenSelection === 'coti'
      ? TIP_NATIVE_TOKEN_DECIMALS
      : tipTokenSelection === 'wisp'
        ? rewardTokenDecimals
        : privateRewardTokenDecimals;
  const activeTipTokenBalanceWei =
    tipTokenSelection === 'coti'
      ? tipNativeBalanceWei
      : tipTokenSelection === 'wisp'
        ? rewardTokenBalanceWei
        : privateRewardTokenBalanceWei;
  const parsedTipAmountWei = useMemo(
    () => parseTokenAmountInput(tipAmountInput, activeTipTokenDecimals),
    [tipAmountInput, activeTipTokenDecimals]
  );
  const tipAmountWeiFromInput = parsedTipAmountWei !== null && parsedTipAmountWei > 0n ? parsedTipAmountWei : 0n;
  const tipAmountExceedsBalance =
    activeTipTokenBalanceWei !== null &&
    tipAmountWeiFromInput > 0n &&
    tipAmountWeiFromInput > activeTipTokenBalanceWei;
  const tipAmountSummaryLabel =
    tipAmountWeiFromInput > 0n
      ? `${formatTokenAmount(tipAmountWeiFromInput, activeTipTokenDecimals, 6)} ${activeTipTokenSymbol}`
      : `0 ${activeTipTokenSymbol}`;
  const tipBalanceSummaryLabel =
    activeTipTokenBalanceWei !== null
      ? `${formatTokenAmount(activeTipTokenBalanceWei, activeTipTokenDecimals, 6)} ${activeTipTokenSymbol}`
      : '--';
  const canSendTipFromComposer =
    !tipping &&
    !sending &&
    !!activeContact &&
    !isSelfChat &&
    tipAmountWeiFromInput > 0n &&
    activeTipTokenBalanceWei !== null &&
    !tipAmountExceedsBalance;
  const canSendGroupTipFromComposer =
    !tipping &&
    !sendingGroupMessage &&
    !!activeGroupId &&
    !!selectedGroupTipRecipient &&
    tipAmountWeiFromInput > 0n &&
    activeTipTokenBalanceWei !== null &&
    !tipAmountExceedsBalance;
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
        selfTradeMessage: 'P2P trades are only available in private chats with another wallet.'
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
  const activeTradeOffers = useMemo(
    () =>
      activeMessages
        .map((message) => parseTradeOfferMessagePayload(message.text))
        .filter((message): message is TradeOfferMessagePayload => message !== null && isInChatTradeOffer(message)),
    [activeMessages]
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
  useEffect(() => {
    const customTokenRequests = Array.from(
      new Map(
        [
          isCustomTradeTokenSelection(tradeOfferTokenSelection) && isWalletAddress(normalizedTradeOfferCustomTokenAddress)
            ? {
                key: buildTradeCustomTokenInfoKey(tradeCustomOfferTokenKind, normalizedTradeOfferCustomTokenAddress),
                address: normalizedTradeOfferCustomTokenAddress.trim().toLowerCase(),
                kind: tradeCustomOfferTokenKind
              }
            : null,
          isWalletAddress(tradeOfferTokenSelection)
            ? {
                key: buildTradeCustomTokenInfoKey(
                  getVerifiedEcosystemToken(tradeOfferTokenSelection)?.kind ?? 'erc20',
                  tradeOfferTokenSelection
                ),
                address: tradeOfferTokenSelection.trim().toLowerCase(),
                kind: getVerifiedEcosystemToken(tradeOfferTokenSelection)?.kind ?? 'erc20'
              }
            : null,
          isCustomTradeTokenSelection(tradeRequestTokenSelection) && isWalletAddress(normalizedTradeRequestCustomTokenAddress)
            ? {
                key: buildTradeCustomTokenInfoKey(tradeCustomRequestTokenKind, normalizedTradeRequestCustomTokenAddress),
                address: normalizedTradeRequestCustomTokenAddress.trim().toLowerCase(),
                kind: tradeCustomRequestTokenKind
              }
            : null,
          isWalletAddress(tradeRequestTokenSelection)
            ? {
                key: buildTradeCustomTokenInfoKey(
                  getVerifiedEcosystemToken(tradeRequestTokenSelection)?.kind ?? 'erc20',
                  tradeRequestTokenSelection
                ),
                address: tradeRequestTokenSelection.trim().toLowerCase(),
                kind: getVerifiedEcosystemToken(tradeRequestTokenSelection)?.kind ?? 'erc20'
              }
            : null
        ]
          .filter(
            (
              entry
            ): entry is {
              key: string;
              address: string;
              kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;
            } => entry !== null
          )
          .map((entry) => [entry.key, entry] as const)
      ).values()
    );

    if (customTokenRequests.length === 0) {
      return;
    }

    let cancelled = false;

    setCustomTradeTokenInfoByAddress((previous) => {
      const next = { ...previous };
      const walletKey = walletAddress.trim().toLowerCase();
      for (const request of customTokenRequests) {
        const previousEntry = previous[request.key];
        next[request.key] = {
          kind: request.kind,
          address: request.address,
          symbol: previousEntry?.symbol ?? shortenAddress(request.address),
          decimals: previousEntry?.decimals ?? FALLBACK_REWARD_TOKEN_DECIMALS,
          balanceWei: previousEntry?.balanceWei ?? null,
          loading: true,
          walletKey,
          aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
          error: undefined
        };
      }
      return next;
    });

    const loadCustomTokens = async () => {
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const walletKey = walletAddress.trim().toLowerCase();
      const signerBundle =
        walletKey && customTokenRequests.some((request) => request.kind === 'private-erc20')
          ? await getMemoSigner()
              .then((result) => result)
              .catch(() => null)
          : null;
      const nextEntries = await Promise.all(
        customTokenRequests.map(async (request) => {
          try {
            const tokenAbi = request.kind === 'private-erc20' ? PRIVATE_ERC20_TOKEN_VNEXT_ABI : ERC20_TOKEN_ABI;
            const tokenContract = new cotiEthers.Contract(request.address, tokenAbi, readProvider);
            const [symbolRaw, decimalsRaw] = await Promise.all([
              tokenContract.symbol().catch(() => null),
              tokenContract.decimals().catch(() => null)
            ]);
            let balanceWei: bigint | null = null;
            let error: string | undefined;

            if (walletKey) {
              if (request.kind === 'private-erc20') {
                if (!signerBundle) {
                  error = 'Unlock your AES key to read this private token balance.';
                } else {
                  balanceWei = await readCurrentPrivateErc20BalanceWei(
                    request.address,
                    walletAddress,
                    signerBundle.signer
                  ).catch(() => null);
                }
              } else {
                balanceWei = await tokenContract.balanceOf(walletAddress).catch(() => null);
              }
            }

            return {
              kind: request.kind,
              address: request.address,
              symbol:
                typeof symbolRaw === 'string' && symbolRaw.trim().length > 0
                  ? symbolRaw.trim().slice(0, 24)
                  : shortenAddress(request.address),
              decimals: normalizeTokenDecimals(Number(decimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)),
              balanceWei: typeof balanceWei === 'bigint' ? balanceWei : null,
              loading: false,
              walletKey,
              aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
              error
            } satisfies TradeCustomTokenInfo;
          } catch {
            return {
              kind: request.kind,
              address: request.address,
              symbol: shortenAddress(request.address),
              decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
              balanceWei: null,
              loading: false,
              walletKey,
              aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
              error: 'Unable to load token metadata.'
            } satisfies TradeCustomTokenInfo;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setCustomTradeTokenInfoByAddress((previous) => {
        const next = { ...previous };
        for (const entry of nextEntries) {
          next[buildTradeCustomTokenInfoKey(entry.kind, entry.address)] = entry;
        }
        return next;
      });

      if (signerBundle) {
        const nextOnboardInfo = signerBundle.signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [signerBundle.cacheKey]: mergeOnboardInfo(previous[signerBundle.cacheKey], nextOnboardInfo)
        }));
      }
    };

    loadCustomTokens().catch(() => {
      if (cancelled) {
        return;
      }
      setCustomTradeTokenInfoByAddress((previous) => {
        const next = { ...previous };
        const walletKey = walletAddress.trim().toLowerCase();
        for (const request of customTokenRequests) {
          next[request.key] = {
            kind: request.kind,
            address: request.address,
            symbol: shortenAddress(request.address),
            decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
            balanceWei: null,
            loading: false,
            walletKey,
            aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
            error: 'Unable to load token metadata.'
          };
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    normalizedTradeOfferCustomTokenAddress,
    normalizedTradeRequestCustomTokenAddress,
    tradeCustomOfferTokenKind,
    tradeCustomRequestTokenKind,
    tradeOfferTokenSelection,
    tradeRequestTokenSelection,
    walletAddress,
    hasAesReady,
    topUpMetricsNonce
  ]);
  useEffect(() => {
    if (!TRADE_ESCROW_CONTRACT_ADDRESS || !isWalletAddress(TRADE_ESCROW_CONTRACT_ADDRESS)) {
      tradeRequiredFeeCacheRef.current = null;
      tradeRequiredFeeRequestRef.current = null;
      setTradeRequiredFeeWei(null);
      return;
    }

    let cancelled = false;

    const loadTradeFees = async () => {
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
      const nativeFeeRaw = await contract.feeAmount().catch(() => null);

      if (cancelled) {
        return;
      }

      const nativeFee = typeof nativeFeeRaw === 'bigint' ? nativeFeeRaw : null;
      tradeRequiredFeeCacheRef.current = nativeFee;
      setTradeRequiredFeeWei(nativeFee);
    };

    loadTradeFees().catch(() => {
      if (!cancelled) {
        setTradeRequiredFeeWei(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!TRADE_ESCROW_CONTRACT_ADDRESS || !isWalletAddress(TRADE_ESCROW_CONTRACT_ADDRESS) || activeTradeOffers.length === 0) {
      return;
    }

    let cancelled = false;

    const loadTradeSnapshots = async () => {
      const nextSnapshots = await Promise.all(
        Array.from(
          new Map(
            activeTradeOffers.map((offer) => [
              buildTradeSnapshotKey(offer.tradeId, offer.escrowContract),
              offer
            ])
          ).values()
        ).map(async (offer) => {
          try {
            return await fetchTradeSnapshotById(offer.tradeId, {
              rewardTokenSymbol,
              rewardTokenDecimals,
              privateRewardTokenSymbol,
              privateRewardTokenDecimals,
              escrowContract: offer.escrowContract,
              accessSecret: offer.accessSecret
            });
          } catch {
            return null;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setTradeSnapshotsById((previous) => {
        const next = { ...previous };
        for (const snapshot of nextSnapshots) {
          if (!snapshot) {
            continue;
          }
          next[buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract)] = snapshot;
        }
        return next;
      });
    };

    loadTradeSnapshots().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeTradeOffers, privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]);
  const groupRemovalNoticeMarkerStorage = {
    groupRemovalNoticeMarkersLoadedRef,
    groupRemovalNoticeMarkersRef,
    storageKey: GROUP_REMOVAL_NOTICE_MARKERS_STORAGE_KEY
  };
  const getStoredGroupRemovalNoticeMarker = (walletKey: string, groupId: number): string | undefined =>
    getStoredGroupRemovalNoticeMarkerStorage(walletKey, groupId, groupRemovalNoticeMarkerStorage);

  const setStoredGroupRemovalNoticeMarker = (walletKey: string, groupId: number, marker: string): void =>
    setStoredGroupRemovalNoticeMarkerStorage(walletKey, groupId, marker, groupRemovalNoticeMarkerStorage);

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

  const swapRewardTokens = async () => {
    setError('');
    setSwapStatusMessage('');

    const requestedWalletAddress = walletAddress.trim();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }
    if (!onCotiNetwork) {
      setError('Switch to the COTI network first.');
      return;
    }
    if (!currentSwapDirectionEnabled || !activeSwapVaultContractAddress) {
      setError(swapDirection === 'shield' ? 'Shield deposits are paused.' : 'Legacy unshield is unavailable.');
      return;
    }

    const amount = parseTokenAmountInput(swapAmountInput, swapInputDecimals);
    if (amount === null || amount <= 0n) {
      setError(`Enter a valid ${swapInputSymbol} amount.`);
      return;
    }
    const selectedSwapPaymentMode = swapFeeModeSelection === 'coti' ? 1 : 0;
    if (swapDirection === 'unshield') {
      if (swapPrivateRewardTokenBalanceWei === null) {
        setError(`Unable to read ${swapPrivateRewardTokenSymbol} balance. Wait for balances to load and try again.`);
        return;
      }
      if (swapPrivateRewardTokenBalanceWei < amount) {
        setError(
          `Insufficient ${swapPrivateRewardTokenSymbol} balance. Available ${formatTokenAmount(
            swapPrivateRewardTokenBalanceWei,
            swapPrivateRewardTokenDecimals,
            6
          )}, requested ${formatTokenAmount(amount, swapPrivateRewardTokenDecimals, 6)}.`
        );
        return;
      }
    }

    try {
      setSwappingTokens(true);
      await runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const swapContract = new cotiEthers.Contract(activeSwapVaultContractAddress, SWAP_VAULT_CONTRACT_ABI, signer);
      const publicTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, signer);

      const [resolvedSwapFeeWei, resolvedSwapTokenFee] = (await Promise.all([
        swapFeeWei !== null ? Promise.resolve(swapFeeWei) : swapContract.swapFeeWei(),
        swapTokenFeeAmount !== null ? Promise.resolve(swapTokenFeeAmount) : swapContract.getTokenFeeAmount()
      ])) as [bigint, bigint];
      setSwapFeeWei(resolvedSwapFeeWei);
      setSwapTokenFeeAmount(resolvedSwapTokenFee);

      let swapPaymentMode = selectedSwapPaymentMode;
      let usedAutoCotiMode = false;
      if (
        swapDirection === 'unshield' &&
        swapPaymentMode === 0 &&
        swapPrivateRewardTokenBalanceWei !== null &&
        resolvedSwapTokenFee > 0n
      ) {
        // If amount is greater than (private balance - token fee), switch to COTI mode
        // so the swap can use native fee directly.
        if (swapPrivateRewardTokenBalanceWei >= resolvedSwapTokenFee) {
          const maxUnshieldAfterPrivateFee = swapPrivateRewardTokenBalanceWei - resolvedSwapTokenFee;
          if (amount > maxUnshieldAfterPrivateFee) {
            swapPaymentMode = 1;
            usedAutoCotiMode = true;
          }
        }
      }

      let txReceipt:
        | {
            logs?: Array<{ topics?: string[]; data?: string }>;
          }
        | null
        | undefined;
      if (swapDirection === 'shield') {
        // Token-preferred mode may collect a public fee fallback, while COTI mode only needs swap amount approval.
        const requiredApproval = swapPaymentMode === 0 ? amount + resolvedSwapTokenFee : amount;
        const allowance = (await publicTokenContract.allowance(
          requestedWalletAddress,
          activeSwapVaultContractAddress
        )) as bigint;
        if (allowance < requiredApproval) {
          const approveTx = await publicTokenContract.approve(activeSwapVaultContractAddress, requiredApproval);
          await approveTx.wait();
        }
      }

      const canExecuteWithZeroValue =
        swapPaymentMode === 0 &&
        (await (async (): Promise<boolean> => {
          try {
            if (swapDirection === 'shield') {
              await swapContract.shieldWithMode.estimateGas(amount, swapPaymentMode, { value: 0n });
            } else {
              await swapContract.unshieldWithMode.estimateGas(amount, swapPaymentMode, { value: 0n });
            }
            return true;
          } catch {
            return false;
          }
        })());

      const executeSwapTx = async (value: bigint) => {
        if (swapDirection === 'shield') {
          const tx = await swapContract.shieldWithMode(amount, swapPaymentMode, { value });
          return tx.wait();
        }
        const tx = await swapContract.unshieldWithMode(amount, swapPaymentMode, { value });
        return tx.wait();
      };

      const initialTxValue =
        swapPaymentMode === 1 ? resolvedSwapFeeWei : canExecuteWithZeroValue ? 0n : resolvedSwapFeeWei;
      let usedNativeFallbackRetry = false;
      try {
        txReceipt = await executeSwapTx(initialTxValue);
      } catch (initialSwapError) {
        const canRetryWithNativeFee =
          swapPaymentMode === 0 &&
          initialTxValue === 0n &&
          resolvedSwapFeeWei > 0n &&
          !isProviderActionRejected(initialSwapError);
        if (!canRetryWithNativeFee) {
          throw initialSwapError;
        }

        usedNativeFallbackRetry = true;
        txReceipt = await executeSwapTx(resolvedSwapFeeWei);
      }

      let feePaidMethod: 'native' | 'public' | 'private' | null = null;
      let feePaidAmount: bigint | null = null;
      if (txReceipt?.logs?.length) {
        for (const receiptLog of txReceipt.logs) {
          if (!Array.isArray(receiptLog.topics) || typeof receiptLog.data !== 'string') {
            continue;
          }
          try {
            const parsedLog = swapContract.interface.parseLog({
              topics: receiptLog.topics,
              data: receiptLog.data
            });
            if (!parsedLog || parsedLog.name !== 'SwapFeePaid') {
              continue;
            }
            const rawMethod = parsedLog.args[2];
            const rawAmount = parsedLog.args[3];
            const methodValue =
              typeof rawMethod === 'bigint'
                ? Number(rawMethod)
                : typeof rawMethod === 'number'
                  ? rawMethod
                  : Number(rawMethod);
            feePaidMethod =
              methodValue === 0
                ? 'native'
                : methodValue === 1
                  ? 'public'
                  : methodValue === 2
                    ? 'private'
                    : null;
            feePaidAmount =
              typeof rawAmount === 'bigint'
                ? rawAmount
                : /^\d+$/.test(String(rawAmount).trim())
                  ? BigInt(String(rawAmount).trim())
                  : null;
            break;
          } catch {
          }
        }
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      setSwapAmountInput('');
      setTopUpMetricsNonce((previous) => previous + 1);
      const swapDirectionStatus = swapDirection === 'shield' ? 'Swapped to private token.' : 'Swapped to public token.';
      const feeStatus =
        feePaidMethod === 'native'
          ? feePaidAmount !== null
            ? ` Fee paid with COTI (${formatCotiAmount(feePaidAmount)} COTI).`
            : ' Fee paid with COTI.'
          : feePaidMethod === 'public'
            ? feePaidAmount !== null
              ? ` Fee paid with ${rewardTokenSymbol} (${formatTokenAmount(feePaidAmount, rewardTokenDecimals, 6)} ${rewardTokenSymbol}).`
              : ` Fee paid with ${rewardTokenSymbol}.`
              : feePaidMethod === 'private'
                ? feePaidAmount !== null
                  ? ` Fee paid with ${swapPrivateRewardTokenSymbol} (${formatTokenAmount(feePaidAmount, swapPrivateRewardTokenDecimals, 6)} ${swapPrivateRewardTokenSymbol}).`
                  : ` Fee paid with ${swapPrivateRewardTokenSymbol}.`
                : '';
      const fallbackStatus = usedNativeFallbackRetry ? ' Used COTI fee fallback after token/private fee attempt failed.' : '';
      const autoModeStatus = usedAutoCotiMode
        ? ` Auto-switched fee mode to COTI because amount exceeded ${swapPrivateRewardTokenSymbol} balance minus token fee.`
        : '';
      setSwapStatusMessage(`${swapDirectionStatus}${feeStatus}${fallbackStatus}${autoModeStatus}`);
      });
    } catch (swapError) {
      const message = getProviderErrorMessage(swapError, 'Swap failed.');
      setError(message);
      setSwapStatusMessage('');
    } finally {
      setSwappingTokens(false);
    }
  };

  const scrollChatToBottom = () => {
    const container = chatMessagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  };

  const isNearBottom = (container: HTMLDivElement): boolean =>
    container.scrollHeight - (container.scrollTop + container.clientHeight) <= 140;

  const jumpToReferencedMessage = (
    replyToMessageId?: string,
    replyToText?: string,
    replyToTxHash?: string,
    replyToBlockNumber?: number,
    replyToLogIndex?: number
  ) => {
    const referencePool = activeGroupId !== null ? activeGroupMessages : activeMessages;
    if (referencePool.length === 0) {
      return;
    }

    let targetId = replyToMessageId;
    if (!targetId) {
      const matchedByReference = referencePool.find((message) =>
        messageReferencesMatch(
          {
            txHash: message.txHash,
            blockNumber: message.blockNumber,
            logIndex: message.logIndex
          },
          {
            txHash: replyToTxHash,
            blockNumber: replyToBlockNumber,
            logIndex: replyToLogIndex
          }
        )
      );
      targetId = matchedByReference?.id;
    }

    if (!targetId && replyToText) {
      const targetPreview = trimReplyPreview(replyToText);
      const matched = referencePool.find((message) => trimReplyPreview(getMessageDisplayText(message.text)) === targetPreview);
      targetId = matched?.id;
    }

    if (!targetId) {
      return;
    }

    const targetElement = messageElementRefs.current[targetId];
    if (!targetElement) {
      const targetIndex = referencePool.findIndex((message) => message.id === targetId);
      if (targetIndex >= 0) {
        pendingJumpTargetIdRef.current = targetId;
        setVisibleThreadMessageCount((current) =>
          Math.max(current, referencePool.length - targetIndex + 12)
        );
      }
      return;
    }

    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(targetId);

    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId((previous) => (previous === targetId ? null : previous));
      highlightTimeoutRef.current = null;
    }, 1800);
  };

  const getReplyReferenceFallbackLabel = (message: ChatMessage): string => {
    if (message.replyToText) {
      return message.replyToText;
    }

    if (typeof message.replyToBlockNumber === 'number' && typeof message.replyToLogIndex === 'number') {
      return `Ref ${message.replyToBlockNumber.toString(36)}:${message.replyToLogIndex.toString(36)}`;
    }

    const sharedReference = parseSharedTxReference(message.replyToTxHash);
    if (sharedReference) {
      return `Ref ${sharedReference.blockNumber.toString(36)}:${sharedReference.txHashPrefix.slice(0, 6)}`;
    }

    if (message.replyToTxHash) {
      return `Tx ${shortenAddress(message.replyToTxHash)}`;
    }

    return 'Reply';
  };

  useEffect(() => {
    const targetId = pendingJumpTargetIdRef.current;
    if (!targetId) {
      return;
    }

    const targetElement = messageElementRefs.current[targetId];
    if (!targetElement) {
      return;
    }

    pendingJumpTargetIdRef.current = null;
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(targetId);

    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedMessageId((previous) => (previous === targetId ? null : previous));
      highlightTimeoutRef.current = null;
    }, 1800);
  }, [activeThreadKey, setHighlightedMessageId, visibleThreadMessageCount]);

  const handleMessageInputChange = useCallback((value: string) => {
    setMessageInput(sanitizeOutgoingMessagePlainText(value).slice(0, MAX_MESSAGE_LENGTH));
  }, [setMessageInput]);

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

  const toggleConversationMuteForContact = async (address: string) => {
    if (browserWalletLiteMode) {
      setError('Use the app wallet to sync muted or hidden conversations.');
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
      setError('Use the app wallet to sync muted or hidden conversations.');
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

  const copyAddressToClipboard = useCallback(async (value: string): Promise<boolean> => {
    setError('');

    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      try {
        const tempInput = document.createElement('textarea');
        tempInput.value = value;
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.focus();
        tempInput.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(tempInput);
        if (!copied) {
          throw new Error('Clipboard copy command was rejected.');
        }
        return true;
      } catch {
        setError('Could not copy address to clipboard.');
        return false;
      }
    }
  }, []);

  const copyWithFeedback = useCallback(async (value: string, feedbackKey: string) => {
    const copied = await copyAddressToClipboard(value);
    if (!copied) {
      return;
    }

    setLastCopiedKey(feedbackKey);
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
      copyFeedbackTimeoutRef.current = null;
    }

    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setLastCopiedKey((previous) => (previous === feedbackKey ? null : previous));
      copyFeedbackTimeoutRef.current = null;
    }, COPY_FEEDBACK_DURATION_MS);
  }, [copyAddressToClipboard, setLastCopiedKey]);

  const markConversationAsRead = useCallback((contactAddress?: string | null) => {
    if (!readStateFeaturesEnabled) {
      return;
    }

    if (!contactAddress) {
      return;
    }

    const normalizedAddress = contactAddress.trim().toLowerCase();
    if (!isWalletAddress(normalizedAddress)) {
      return;
    }

    const localMessages = messagesByContact[normalizedAddress] ?? [];
    let latestIncomingFromLocal = 0;
    for (const message of localMessages) {
      if (message.direction !== 'incoming' || typeof message.timestamp !== 'number') {
        continue;
      }
      const ts = Number(message.timestamp);
      if (ts > latestIncomingFromLocal) {
        latestIncomingFromLocal = ts;
      }
    }

    const readAtTs = Math.max(Math.floor(Date.now() / 1000), latestIncomingFromLocal);
    const previousContactReadTs = lastReadByContactRef.current[normalizedAddress] ?? 0;
    if (readAtTs > previousContactReadTs) {
      lastReadByContactRef.current = {
        ...lastReadByContactRef.current,
        [normalizedAddress]: readAtTs
      };
    }

    const previousUnread = unreadMapRef.current || {};
    if (!previousUnread[normalizedAddress]) {
      return;
    }

    const nextUnread = { ...previousUnread };
    delete nextUnread[normalizedAddress];
    unreadMapRef.current = nextUnread;
    setUnreadMap(nextUnread);

    if (
      Object.keys(nextUnread).length === 0 &&
      Object.keys(unreadGroupMapRef.current || {}).length === 0 &&
      readAtTs > lastReadAllTsRef.current
    ) {
      lastReadAllTsRef.current = readAtTs;
      setLastReadAllTs((previous) => (readAtTs > previous ? readAtTs : previous));
    }
  }, [messagesByContact, readStateFeaturesEnabled, setLastReadAllTs, setUnreadMap]);
  const markGroupConversationAsRead = useCallback((groupId?: number | null) => {
    if (!readStateFeaturesEnabled) {
      return;
    }

    if (!Number.isFinite(groupId) || (groupId ?? 0) <= 0) {
      return;
    }

    const normalizedGroupId = Math.floor(groupId as number);
    const groupKey = String(normalizedGroupId);
    const localMessages = messagesByGroup[groupKey] ?? [];
    let latestIncomingFromLocal = 0;
    for (const message of localMessages) {
      if (message.direction !== 'incoming' || typeof message.timestamp !== 'number') {
        continue;
      }
      const ts = Number(message.timestamp);
      if (ts > latestIncomingFromLocal) {
        latestIncomingFromLocal = ts;
      }
    }

    const groupSummary = groupsRef.current.find((group) => group.id === normalizedGroupId);
    const latestFromSummary = groupSummary ? toSafeNumber(groupSummary.lastTimestamp) : 0;
    const readAtTs = Math.max(Math.floor(Date.now() / 1000), latestIncomingFromLocal, latestFromSummary);
    const previousGroupReadTs = lastReadByGroupRef.current[groupKey] ?? 0;
    if (readAtTs > previousGroupReadTs) {
      lastReadByGroupRef.current = {
        ...lastReadByGroupRef.current,
        [groupKey]: readAtTs
      };
    }

    const previousUnread = unreadGroupMapRef.current || {};
    if (!previousUnread[groupKey]) {
      return;
    }

    const nextUnread = { ...previousUnread };
    delete nextUnread[groupKey];
    unreadGroupMapRef.current = nextUnread;
    setUnreadGroupMap(nextUnread);

    if (
      Object.keys(nextUnread).length === 0 &&
      Object.keys(unreadMapRef.current || {}).length === 0 &&
      readAtTs > lastReadAllTsRef.current
    ) {
      lastReadAllTsRef.current = readAtTs;
      setLastReadAllTs((previous) => (readAtTs > previous ? readAtTs : previous));
    }
  }, [messagesByGroup, readStateFeaturesEnabled, setLastReadAllTs, setUnreadGroupMap]);
  const markAllConversationsAsRead = useCallback(() => {
    if (!readStateFeaturesEnabled) {
      return;
    }

    const previousUnreadContacts = unreadMapRef.current || {};
    const previousUnreadGroups = unreadGroupMapRef.current || {};
    const unreadAddresses = Object.keys(previousUnreadContacts).filter((address) => isWalletAddress(address));
    const unreadGroupKeys = Object.keys(previousUnreadGroups).filter(
      (groupKey) => Number.isFinite(Number(groupKey)) && Number(groupKey) > 0
    );
    if (unreadAddresses.length === 0 && unreadGroupKeys.length === 0) {
      return;
    }

    const nowTs = Math.floor(Date.now() / 1000);
    const nextReadByContact = { ...lastReadByContactRef.current };
    const nextReadByGroup = { ...lastReadByGroupRef.current };
    let nextGlobalReadTs = Math.max(lastReadAllTsRef.current, nowTs);

    for (const address of unreadAddresses) {
      const localMessages = messagesByContact[address] ?? [];
      let latestIncomingFromLocal = 0;
      for (const message of localMessages) {
        if (message.direction !== 'incoming' || typeof message.timestamp !== 'number') {
          continue;
        }
        const ts = Number(message.timestamp);
        if (ts > latestIncomingFromLocal) {
          latestIncomingFromLocal = ts;
        }
      }

      const readAtTs = Math.max(nowTs, latestIncomingFromLocal);
      const previousContactReadTs = nextReadByContact[address] ?? 0;
      if (readAtTs > previousContactReadTs) {
        nextReadByContact[address] = readAtTs;
      }
      if (readAtTs > nextGlobalReadTs) {
        nextGlobalReadTs = readAtTs;
      }
    }

    for (const groupKey of unreadGroupKeys) {
      const localMessages = messagesByGroup[groupKey] ?? [];
      let latestIncomingFromLocal = 0;
      for (const message of localMessages) {
        if (message.direction !== 'incoming' || typeof message.timestamp !== 'number') {
          continue;
        }
        const ts = Number(message.timestamp);
        if (ts > latestIncomingFromLocal) {
          latestIncomingFromLocal = ts;
        }
      }

      const groupId = Number(groupKey);
      const summary = groupsRef.current.find((group) => group.id === groupId);
      const latestFromSummary = summary ? toSafeNumber(summary.lastTimestamp) : 0;
      const readAtTs = Math.max(nowTs, latestIncomingFromLocal, latestFromSummary);
      const previousGroupReadTs = nextReadByGroup[groupKey] ?? 0;
      if (readAtTs > previousGroupReadTs) {
        nextReadByGroup[groupKey] = readAtTs;
      }
      if (readAtTs > nextGlobalReadTs) {
        nextGlobalReadTs = readAtTs;
      }
    }

    lastReadByContactRef.current = nextReadByContact;
    lastReadByGroupRef.current = nextReadByGroup;
    unreadMapRef.current = {};
    unreadGroupMapRef.current = {};
    setUnreadMap({});
    setUnreadGroupMap({});

    if (nextGlobalReadTs > lastReadAllTsRef.current) {
      lastReadAllTsRef.current = nextGlobalReadTs;
      setLastReadAllTs((previous) => (nextGlobalReadTs > previous ? nextGlobalReadTs : previous));
    }
  }, [messagesByContact, messagesByGroup, readStateFeaturesEnabled, setLastReadAllTs, setUnreadGroupMap, setUnreadMap]);

  useEffect(() => {
    if (!activeContact) {
      return;
    }

    const pageVisible =
      typeof document !== 'undefined' &&
      !document.hidden &&
      (typeof document.hasFocus === 'function' ? document.hasFocus() : true);
    if (!pageVisible) {
      return;
    }

    markConversationAsRead(activeContact);
  }, [activeContact, markConversationAsRead, messagesByContact]);
  useEffect(() => {
    if (activeGroupId === null) {
      return;
    }

    const pageVisible =
      typeof document !== 'undefined' &&
      !document.hidden &&
      (typeof document.hasFocus === 'function' ? document.hasFocus() : true);
    if (!pageVisible) {
      return;
    }

    markGroupConversationAsRead(activeGroupId);
  }, [activeGroupId, markGroupConversationAsRead, messagesByGroup, groups]);

  const activateContact = useCallback((contactAddress: string) => {
    activeGroupIdRef.current = null;
    setActiveGroupId(null);
    setActiveContact(contactAddress);
    markConversationAsRead(contactAddress);
    if (isMobileNav) {
      setActiveMobileView('chat');
    }
  }, [isMobileNav, markConversationAsRead, setActiveMobileView]);

  const getMemoSigner = async () => {
    if (activeSignerSource === 'metamask') {
      const provider = getConnectedProvider();
      if (!provider) {
        throw new Error('Wallet provider not detected. Connect without burner first.');
      }

      if (!walletAddress) {
        throw new Error('Connect your wallet first.');
      }

      if (chainId !== COTI_NETWORK.chainIdDecimal) {
        throw new Error('Switch to COTI network first.');
      }

      const cacheKey = walletAddress.toLowerCase();
      const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
      let signer = signerCacheRef.current[cacheKey];
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(walletAddress, cachedOnboardInfo);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
      } else if (cachedOnboardInfo) {
        signer.setUserOnboardInfo(cachedOnboardInfo);
      }

      signer.disableAutoOnboard();

      let onboardInfo = signer.getUserOnboardInfo();
      if (!onboardInfo?.aesKey) {
        if (cachedOnboardInfo) {
          signer.setUserOnboardInfo(cachedOnboardInfo);
          onboardInfo = signer.getUserOnboardInfo();
        }
      }

      if (!onboardInfo?.aesKey) {
        const aesHealth = walletAesHealthByAddress[cacheKey];
        const repairMismatch = aesHealth?.status === 'key-mismatch' || aesHealth?.status === 'repair-needed';
        await getOrRecoverAesForWallet({
          allowUnrecoverableReset: repairMismatch,
          forceFreshAes: repairMismatch,
          forceLegacyRefresh: repairMismatch,
          forceRefresh: repairMismatch,
          provider,
          signer,
          walletAddress
        });
        onboardInfo = signer.getUserOnboardInfo();
      }

      if (!onboardInfo?.aesKey) {
        throw new Error('AES key unavailable. Complete the privacy unlock signature once.');
      }

      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
      }));
      setWalletAesHealth(walletAddress, buildWalletAesHealthState({
        status: 'ready-unverified',
        walletAddress
      }));

      setOnboardStatus('AES key ready');
      return { signer, cacheKey };
    }

    const signer = burnerWalletRef.current;
    if (!signer) {
      throw new Error('Burner wallet not initialized.');
    }

    const cacheKey = signer.address.toLowerCase();
    const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
    if (cachedOnboardInfo) {
      signer.setUserOnboardInfo(cachedOnboardInfo);
    }

    let onboardInfo = signer.getUserOnboardInfo();
    if (!onboardInfo?.aesKey) {
      await signer.generateOrRecoverAes();
      onboardInfo = signer.getUserOnboardInfo();
    }

    if (!onboardInfo?.aesKey) {
      throw new Error('AES key unavailable in this session. Please sign to enable encryption.');
    }

    setSessionOnboardInfo((previous) => ({
      ...previous,
      [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
    }));

    setOnboardStatus('AES key ready');

    return { signer, cacheKey };
  };
  getMemoSignerRef.current = getMemoSigner;

  const encodeMemoForActiveSigner = (plain: string): string => {
    return activeSignerSource === 'metamask' ? encodeCompactMemoPlaintext(plain) : encodeMemoPlaintext(plain);
  };
  encodeMemoForActiveSignerRef.current = encodeMemoForActiveSigner;

  const decodeDecryptedMemoPlaintext = (decrypted: string | bigint): string => {
    const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
    const plain = decodeMemoPlaintextStrict(raw);
    if (plain === null) {
      throw new Error('Decrypted memo is not a valid ChainWhisper payload.');
    }
    return plain;
  };

  const tryRecoverRegisteredMemoAes = async (
    signer: Wallet | JsonRpcSigner,
    cacheKey: string,
    previousError: unknown
  ): Promise<boolean> => {
    if (activeSignerSource !== 'metamask' || memoAesRecoveryAttemptedRef.current[cacheKey]) {
      return false;
    }

    memoAesRecoveryAttemptedRef.current[cacheKey] = true;
    void signer;
    const currentHealth = walletAesHealthByAddress[cacheKey]?.status;
    const message =
      previousError instanceof Error
        ? previousError.message
        : 'The AES key did not decrypt existing wallet data.';
    if (currentHealth !== 'ready') {
      setWalletAesHealth(cacheKey, buildWalletAesHealthState({
        message,
        status: 'repair-needed',
        walletAddress: cacheKey
      }));
      setOnboardStatus('Privacy key needs refresh');
    } else {
      setOnboardStatus('AES key ready');
    }
    return false;
  };

  const decryptMemoPlaintextWithRecovery = async (
    signer: Wallet | JsonRpcSigner,
    cacheKey: string,
    ciphertext: unknown
  ): Promise<string> => {
    try {
      const decrypted = await signer.decryptValue(ciphertext as never);
      const plain = decodeDecryptedMemoPlaintext(decrypted);
      setWalletAesHealth(cacheKey, buildWalletAesHealthState({
        status: 'ready',
        walletAddress: cacheKey
      }));
      return plain;
    } catch (firstError) {
      const recovered = await tryRecoverRegisteredMemoAes(signer, cacheKey, firstError);
      if (!recovered) {
        throw firstError;
      }

      const decrypted = await signer.decryptValue(ciphertext as never);
      const plain = decodeDecryptedMemoPlaintext(decrypted);
      setWalletAesHealth(cacheKey, buildWalletAesHealthState({
        status: 'ready',
        walletAddress: cacheKey
      }));
      return plain;
    }
  };

  const parseEncryptedChatMessagePayload = async (
    signer: Wallet | JsonRpcSigner,
    cacheKey: string,
    ciphertext: unknown
  ): Promise<ReturnType<typeof parseChatMessagePayload>> => {
    const plain = await decryptMemoPlaintextWithRecovery(signer, cacheKey, ciphertext);
    return parseChatMessagePayload(plain);
  };

  const resolveSubmitSelector = async (): Promise<string> => {
    if (submitSelectorRef.current) {
      return submitSelectorRef.current;
    }

    const cotiEthers = await loadCotiEthersModule();
    const selector = new cotiEthers.Interface(CHAT_CONTRACT_ABI).getFunction('submit')?.selector;
    if (!selector) {
      throw new Error('Unable to resolve submit selector.');
    }

    submitSelectorRef.current = selector;
    return selector;
  };
  resolveSubmitSelectorRef.current = resolveSubmitSelector;

  const resolveGroupSubmitSelector = async (): Promise<string> => {
    if (groupSubmitSelectorRef.current) {
      return groupSubmitSelectorRef.current;
    }

    const cotiEthers = await loadCotiEthersModule();
    const selector = new cotiEthers.Interface(GROUP_CHAT_CONTRACT_ABI).getFunction('submitGroupMessageWithMode')?.selector;
    if (!selector) {
      throw new Error('Unable to resolve group submit selector for fee mode.');
    }

    groupSubmitSelectorRef.current = selector;
    return selector;
  };

  const resolveRequiredFeeForSend = async (): Promise<bigint> => {
    if (requiredFeeCacheRef.current !== null && requiredFeeCacheRef.current > 0n) {
      return requiredFeeCacheRef.current;
    }

    if (requiredFeeWei !== null && requiredFeeWei > 0n) {
      requiredFeeCacheRef.current = requiredFeeWei;
      return requiredFeeWei;
    }

    if (!requiredFeeRequestRef.current) {
      requiredFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.feeAmount()) as bigint;
        requiredFeeCacheRef.current = resolvedFee;
        setRequiredFeeWei(resolvedFee);
        return resolvedFee;
      })();
    }

    try {
      return await requiredFeeRequestRef.current;
    } finally {
      requiredFeeRequestRef.current = null;
    }
  };
  resolveRequiredFeeForSendRef.current = resolveRequiredFeeForSend;

  const resolveRequiredFeeForGroupSend = async (): Promise<bigint> => {
    if (groupRequiredFeeCacheRef.current !== null && groupRequiredFeeCacheRef.current > 0n) {
      return groupRequiredFeeCacheRef.current;
    }

    if (!groupRequiredFeeRequestRef.current) {
      groupRequiredFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.feeAmount()) as bigint;
        groupRequiredFeeCacheRef.current = resolvedFee;
        return resolvedFee;
      })();
    }

    try {
      return await groupRequiredFeeRequestRef.current;
    } finally {
      groupRequiredFeeRequestRef.current = null;
    }
  };

  const resolveRequiredTokenFeeForGroupSend = async (): Promise<bigint> => {
    if (groupTokenFeeCacheRef.current !== null) {
      return groupTokenFeeCacheRef.current;
    }

    if (!groupTokenFeeRequestRef.current) {
      groupTokenFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.tokenFeeAmount()) as bigint;
        groupTokenFeeCacheRef.current = resolvedFee;
        return resolvedFee;
      })();
    }

    try {
      return await groupTokenFeeRequestRef.current;
    } finally {
      groupTokenFeeRequestRef.current = null;
    }
  };

  const resolveRequiredFeeForTradeCreate = async (): Promise<bigint> => {
    if (tradeRequiredFeeCacheRef.current !== null) {
      setTradeRequiredFeeWei(tradeRequiredFeeCacheRef.current);
      return tradeRequiredFeeCacheRef.current;
    }

    if (!tradeRequiredFeeRequestRef.current) {
      tradeRequiredFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.feeAmount()) as bigint;
        tradeRequiredFeeCacheRef.current = resolvedFee;
        setTradeRequiredFeeWei(resolvedFee);
        return resolvedFee;
      })();
    }

    try {
      return await tradeRequiredFeeRequestRef.current;
    } finally {
      tradeRequiredFeeRequestRef.current = null;
    }
  };

  const resolveTradeSnapshotForOffer = async (offerMessage: TradeOfferMessagePayload): Promise<TradeSnapshot> => {
    const tradeKey = buildTradeSnapshotKey(offerMessage.tradeId, offerMessage.escrowContract);
    const existingSnapshot = tradeSnapshotsById[tradeKey];
    if (existingSnapshot) {
      return existingSnapshot;
    }

    const nextSnapshot = await fetchTradeSnapshotById(offerMessage.tradeId, {
      rewardTokenSymbol,
      rewardTokenDecimals,
      privateRewardTokenSymbol,
      privateRewardTokenDecimals,
      escrowContract: offerMessage.escrowContract,
      accessSecret: offerMessage.accessSecret
    });
    setTradeSnapshotsById((previous) => ({
      ...previous,
      [tradeKey]: nextSnapshot
    }));
    return nextSnapshot;
  };

  const getNicknameMaxLength = async (): Promise<number> =>
    getNicknameMaxLengthLookup({
      nicknameMaxBytesLoadedRef,
      nicknameMaxBytesRequestRef,
      nicknameMaxBytes,
      setNicknameMaxBytes
    });

  const fetchOnChainNicknames = async (addresses: string[]): Promise<Map<string, string>> =>
    fetchOnChainNicknamesLookup(addresses, {
      onChainNicknameCacheRef,
      getNicknameMaxLength
    });

  const saveMyNicknameOnChain = async (overrideNickname?: string): Promise<boolean> => {
    return runSharedWalletTransactionFlow(() =>
      saveMyNicknameOnChainLookup({
        walletAddress,
        nickname: myNickname,
        overrideNickname,
        getNicknameMaxLength,
        onChainNicknameCacheRef,
        getMemoSigner,
        setMyNickname,
        setContacts,
        setSessionOnboardInfo,
        setError
      })
    );
  };

  const loadMyNicknameFromChain = async (
    targetAddress: string,
    fallbackNickname?: string
  ): Promise<string> => loadMyNicknameFromChainLookup(targetAddress, fallbackNickname, fetchOnChainNicknames);
  loadMyNicknameFromChainRef.current = loadMyNicknameFromChain;

  const resolveConversationBlockRange = async (
    contract: unknown,
    me: string,
    peer: string
  ): Promise<ConversationBlockRange | null> => resolveConversationBlockRangeLookup(contract, me, peer);
  resolveConversationBlockRangeRef.current = resolveConversationBlockRange;
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
    walletAddress
  });

  useEffect(() => {
    syncConversationHistoryRef.current = syncConversationHistory;
  }, [syncConversationHistory]);
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
    loadActiveJoinCodesForGroup,
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
  const sendDirectImageMessage = async (file: File) => {
    const targetContact = activeContact;
    const replyTarget = browserWalletLiteMode ? null : replyingToMessage;
    await sendChatImageAttachment({
      clearImageAttachmentStatus,
      failureFallbackMessage: 'Failed to send image.',
      file,
      isTargetCurrent: () => activeContactRef.current === targetContact,
      kind: 'direct',
      missingTargetMessage: 'Select a contact first.',
      sendImageTag: (imageTag) => sendMessage(imageTag, replyTarget),
      setError,
      setUploadingImage,
      showImageAttachmentStatus,
      targetChangedMessage: 'Conversation changed while the image was uploading. Please attach the image again.',
      targetMissing: !targetContact,
      uploadingImage
    });
  };

  const sendGroupImageMessage = async (file: File) => {
    const targetGroupId = activeGroupId;
    const replyTarget = browserWalletLiteMode ? null : replyingToMessage;
    await sendChatImageAttachment({
      clearImageAttachmentStatus,
      failureFallbackMessage: 'Failed to send group image.',
      file,
      isTargetCurrent: () => activeGroupIdRef.current === targetGroupId,
      kind: 'group',
      missingTargetMessage: 'Select a group first.',
      sendImageTag: (imageTag) => sendGroupMessage(imageTag, replyTarget),
      setError,
      setUploadingImage,
      showImageAttachmentStatus,
      targetChangedMessage: 'Group changed while the image was uploading. Please attach the image again.',
      targetMissing: targetGroupId === null,
      uploadingImage
    });
  };

  const sendGroupMessage = async (overrideMessageText?: string, overrideReplyTarget?: ChatMessage | null) => {
    setError('');

    if (sendingGroupMessage) {
      return;
    }
    if (activeGroupId === null) {
      setError('Select a group first.');
      return;
    }

    const plainText = sanitizeOutgoingMessagePlainText(overrideMessageText ?? messageInput).trim();
    if (!plainText) {
      setError('Enter a message first.');
      return;
    }
    if (plainText.length > MAX_MESSAGE_LENGTH) {
      setError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }
    if (plainText.startsWith(IMAGE_MESSAGE_PREFIX)) {
      setError('Image messages are disabled for security reasons.');
      return;
    }
    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    const groupId = activeGroupId;
    const groupKey = String(groupId);
    const replyTarget = browserWalletLiteMode ? null : overrideReplyTarget ?? replyingToMessage;
    const replyingPreviewText = replyTarget ? getMessageDisplayText(replyTarget.text) : undefined;
    const localMessageId = `local-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const localMessageTimestamp = Math.floor(Date.now() / 1000);

    try {
      setSendingGroupMessage(true);
      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: [
          ...(previous[groupKey] ?? []),
          {
            id: localMessageId,
            direction: 'outgoing',
            text: plainText,
            senderAddress: requestedWalletAddress,
            replyToMessageId: replyTarget?.id,
            replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
            replyToTxHash: replyTarget?.txHash,
            replyToBlockNumber: replyTarget?.blockNumber,
            replyToLogIndex: replyTarget?.logIndex,
            timestamp: localMessageTimestamp,
            deliveryState: 'pending'
          }
        ]
      }));

      await runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const selector = await resolveGroupSubmitSelector();
      const paymentMode = groupFeeModeSelection === 'token' ? 1 : 0;
      const requiredFee = paymentMode === 0 ? await resolveRequiredFeeForGroupSend() : 0n;
      const requiredTokenFee = paymentMode === 1 ? await resolveRequiredTokenFeeForGroupSend() : 0n;

      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyTarget?.txHash,
        replyTarget?.blockNumber,
        replyTarget?.logIndex,
        true
      );
      const submittedTx = await submitGroupMemo({
        signer,
        groupId,
        plainText: plainTextWithReply,
        selector,
        paymentMode,
        requestedWalletAddress,
        requiredFee,
        requiredTokenFee,
        privateRewardTokenBalanceWei,
        encodeMemo: encodeMemoForActiveSigner
      });
      const submittedTxHash = submittedTx.txHash;
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: (previous[groupKey] ?? []).map((message) =>
          message.id === localMessageId
            ? {
                ...message,
                txHash: submittedTxHash || undefined
              }
            : message
        )
      }));

      const receipt = await submittedTx.wait();
      if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
        throw new Error('Transaction failed on-chain.');
      }

      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: (previous[groupKey] ?? []).map((message) =>
          message.id === localMessageId
            ? {
                ...message,
                deliveryState: 'sent',
                txHash: submittedTxHash || undefined
              }
            : message
        )
      }));

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      if (typeof overrideMessageText === 'undefined') {
        setMessageInput('');
      }
      setReplyingToMessage(null);
      await syncGroupData({ background: true, activeMessagesOnly: true });
      setTopUpMetricsNonce((previous) => previous + 1);
      });
    } catch (sendError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const message = getGroupActionErrorMessage(sendError, getOnChainFailureMessage(sendError, 'Failed to send group message.'));
      setError(message);
      setMessagesByGroup((previous) => ({
        ...previous,
        [groupKey]: (previous[groupKey] ?? []).map((messageRecord) =>
          messageRecord.id === localMessageId
            ? {
                ...messageRecord,
                deliveryState: 'failed'
              }
            : messageRecord
        )
      }));
    } finally {
      setSendingGroupMessage(false);
    }
  };

  const sendHiddenContactNameToContact = async (contactAddress: string, contactName: string): Promise<string> => {
    const normalizedAddress = contactAddress.trim();
    const normalizedContactName = normalizeContactName(contactName)?.slice(0, 42);
    if (!isWalletAddress(normalizedAddress)) {
      throw new Error('Invalid contact address.');
    }
    if (!normalizedContactName) {
      throw new Error('Contact name cannot be empty.');
    }

    return runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const selector = await resolveSubmitSelector();
      const requiredFee = await resolveRequiredFeeForSend();
      const { txHash } = await submitHiddenContactNameMemo({
        signer,
        contactAddress: normalizedAddress,
        contactName: normalizedContactName,
        selector,
        requiredFee,
        encodeMemo: encodeMemoForActiveSigner
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      return txHash;
    });
  };

  const syncContactNameAliasFromInput = async (contactAddress: string, contactName: string): Promise<void> => {
    if (browserWalletLiteMode) {
      return;
    }

    const normalizedAddress = contactAddress.trim();
    const normalizedContactName = normalizeContactName(contactName)?.slice(0, 42);
    if (!isWalletAddress(normalizedAddress) || !normalizedContactName) {
      return;
    }

    if (!walletAddress || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    if (normalizedAddress.toLowerCase() === walletAddress.toLowerCase()) {
      return;
    }

    try {
      await sendHiddenContactNameToContact(normalizedAddress, normalizedContactName);
      syncConversationHistory({
        contactsOnly: true,
        previewPerContact: true,
        updateHead: true
      }).catch(() => {});
      setTopUpMetricsNonce((previous) => previous + 1);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Failed to sync contact name alias.';
      setError(`Saved locally, but alias sync failed: ${message}`);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        const shouldTopUp = window.confirm(
          'Burner wallet has insufficient funds. Do you want to top up now with your wallet?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithWallet();
        }
      }
    }
  };

  const sendHiddenConversationStateToContact = async (
    contactAddress: string,
    state: ConversationPreferenceState,
    visibleNotice = ''
  ): Promise<string> => {
    const normalizedAddress = contactAddress.trim();
    const normalizedState = normalizeConversationPreferenceState(state);
    if (!isWalletAddress(normalizedAddress)) {
      throw new Error('Invalid contact address.');
    }
    if (!normalizedState) {
      throw new Error('Conversation state is empty.');
    }

    return runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const selector = await resolveSubmitSelector();
      const requiredFee = await resolveRequiredFeeForSend();
      const normalizedVisibleNotice = visibleNotice.replace(/\r?\n/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
      const submittedTx = await submitHiddenConversationStateMemo({
        signer,
        contactAddress: normalizedAddress,
        state: normalizedState,
        visibleNotice: normalizedVisibleNotice,
        selector,
        requiredFee,
        encodeMemo: encodeMemoForActiveSigner
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await submittedTx.wait();

      return submittedTx.txHash;
    });
  };

  const syncConversationStateFromInput = async (
    contactAddress: string,
    state: ConversationPreferenceState,
    visibleNotice = ''
  ): Promise<boolean> => {
    if (browserWalletLiteMode) {
      setError('Use the app wallet to sync muted or hidden conversations.');
      return false;
    }

    const normalizedAddress = contactAddress.trim();
    const normalizedState = normalizeConversationPreferenceState(state);
    if (!isWalletAddress(normalizedAddress) || !normalizedState) {
      return false;
    }

    if (!walletAddress || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return false;
    }

    if (normalizedAddress.toLowerCase() === walletAddress.toLowerCase()) {
      return false;
    }

    try {
      const normalizedVisibleNotice = visibleNotice.replace(/\r?\n/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
      await sendHiddenConversationStateToContact(normalizedAddress, normalizedState, normalizedVisibleNotice);
      syncConversationHistory({ updateHead: true, skipContactStateUpdate: true }).catch(() => {});
      setTopUpMetricsNonce((previous) => previous + 1);
      return true;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Failed to sync conversation state.';
      setError(`Conversation state sync failed. No local change was applied: ${message}`);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        const shouldTopUp = window.confirm(
          'Burner wallet has insufficient funds. Do you want to top up now with your wallet?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithWallet();
        }
      }
      return false;
    }
  };

  const sendReactionToMessage = async (targetMessage: ChatMessage, emojiInput: string) => {
    setError('');

    if (browserWalletLiteMode) {
      setError('Use the app wallet to send reactions.');
      return;
    }

    if (sendingReaction) {
      return;
    }

    const normalizedEmoji = normalizeReactionEmoji(emojiInput);
    if (!normalizedEmoji) {
      setError('Choose a valid emoji reaction.');
      return;
    }

    const targetTxHash = targetMessage.txHash?.trim().toLowerCase() ?? '';
    const targetReferenceKeyCandidates = buildMessageReferenceKeys({
      txHash: targetMessage.txHash,
      blockNumber: targetMessage.blockNumber,
      logIndex: targetMessage.logIndex
    });
    if (targetReferenceKeyCandidates.length === 0) {
      setError('Wait for the message to confirm on-chain before adding a reaction.');
      return;
    }

    const targetReferenceKey =
      targetReferenceKeyCandidates.map((key) => activeThreadMessageReferenceLookup.get(key)).find(Boolean) ??
      targetReferenceKeyCandidates[0] ??
      '';
    const existingReactions = targetReferenceKey ? activeThreadReactions.get(targetReferenceKey) ?? [] : [];
    const alreadyReactedWithEmoji = existingReactions.some(
      (reaction) => reaction.emoji === normalizedEmoji && reaction.reactedByMe
    );
    if (alreadyReactedWithEmoji) {
      setError('You already sent this reaction.');
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    const threadGroupId = activeGroupId;
    const threadContactAddress = activeContact;
    if (threadGroupId === null && !threadContactAddress) {
      setError('Open a chat first.');
      return;
    }

    const localMessageId =
      threadGroupId !== null
        ? `local-group-reaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        : `local-reaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const localMessageTimestamp = Math.floor(Date.now() / 1000);
    const reactionMemoText = buildMessageWithReactionPayload(
      targetTxHash,
      normalizedEmoji,
      '',
      targetMessage.blockNumber,
      targetMessage.logIndex,
      threadGroupId !== null
    );

    try {
      setSendingReaction(true);
      setReactionPickerMessageId(null);

      await runSharedWalletTransactionFlow(async () => {
      if (threadGroupId !== null) {
        const groupKey = String(threadGroupId);
        setMessagesByGroup((previous) => ({
          ...previous,
          [groupKey]: [
            ...(previous[groupKey] ?? []),
            {
              id: localMessageId,
              direction: 'outgoing',
              text: '',
              senderAddress: requestedWalletAddress,
              reactionToTxHash: targetTxHash,
              reactionToBlockNumber: targetMessage.blockNumber,
              reactionToLogIndex: targetMessage.logIndex,
              reactionEmoji: normalizedEmoji,
              timestamp: localMessageTimestamp,
              deliveryState: 'pending'
            }
          ]
        }));

        const { signer, cacheKey } = await getMemoSigner();
        const selector = await resolveGroupSubmitSelector();
        const paymentMode = groupFeeModeSelection === 'token' ? 1 : 0;
        const requiredFee = paymentMode === 0 ? await resolveRequiredFeeForGroupSend() : 0n;
        const requiredTokenFee = paymentMode === 1 ? await resolveRequiredTokenFeeForGroupSend() : 0n;
        const submittedTx = await submitGroupMemo({
          signer,
          groupId: threadGroupId,
          plainText: reactionMemoText,
          selector,
          paymentMode,
          requestedWalletAddress,
          requiredFee,
          requiredTokenFee,
          privateRewardTokenBalanceWei,
          encodeMemo: encodeMemoForActiveSigner
        });
        const submittedTxHash = submittedTx.txHash;

        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        setMessagesByGroup((previous) => ({
          ...previous,
          [groupKey]: (previous[groupKey] ?? []).map((message) =>
            message.id === localMessageId
              ? {
                ...message,
                txHash: submittedTxHash || undefined
              }
              : message
          )
        }));

        const receipt = await submittedTx.wait();
        if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
          throw new Error('Transaction failed on-chain.');
        }

        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        setMessagesByGroup((previous) => ({
          ...previous,
          [groupKey]: (previous[groupKey] ?? []).map((message) =>
            message.id === localMessageId
              ? {
                  ...message,
                  deliveryState: 'sent',
                  txHash: submittedTxHash || undefined
                }
              : message
          )
        }));

        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));

        await syncGroupData({ background: true, activeMessagesOnly: true });
      } else if (threadContactAddress) {
        const contactKey = threadContactAddress.toLowerCase();
        setMessagesByContact((previous) => ({
          ...previous,
          [contactKey]: [
            ...(previous[contactKey] ?? []),
            {
              id: localMessageId,
              direction: 'outgoing',
              text: '',
              senderAddress: requestedWalletAddress,
              reactionToTxHash: targetTxHash,
              reactionToBlockNumber: targetMessage.blockNumber,
              reactionToLogIndex: targetMessage.logIndex,
              reactionEmoji: normalizedEmoji,
              timestamp: localMessageTimestamp,
              deliveryState: 'pending'
            }
          ]
        }));

        const { signer, cacheKey } = await getMemoSigner();
        const selector = await resolveSubmitSelector();
        const requiredFee = await resolveRequiredFeeForSend();
        const submittedTx = await submitDirectMemo({
          signer,
          contactAddress: threadContactAddress,
          plainText: reactionMemoText,
          selector,
          requiredFee,
          encodeMemo: encodeMemoForActiveSigner
        });
        const submittedTxHash = submittedTx.txHash;

        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        setMessagesByContact((previous) => ({
          ...previous,
          [contactKey]: (previous[contactKey] ?? []).map((message) =>
            message.id === localMessageId
              ? {
                ...message,
                txHash: submittedTxHash || undefined
              }
              : message
          )
        }));

        const receipt = await submittedTx.wait();
        if (!receipt || Number((receipt as { status?: number | bigint }).status ?? 0) !== 1) {
          throw new Error('Transaction failed on-chain.');
        }

        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }

        setMessagesByContact((previous) => ({
          ...previous,
          [contactKey]: (previous[contactKey] ?? []).map((message) =>
            message.id === localMessageId
              ? {
                  ...message,
                  deliveryState: 'sent',
                  txHash: submittedTxHash || undefined
                }
              : message
          )
        }));

        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));

        syncConversationHistory({ background: true, activeContactOnly: true }).catch(() => {});
      }

      if (activeSignerSource === 'burner') {
        setTopUpMetricsNonce((previous) => previous + 1);
      }
      });
    } catch (reactionError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const message =
        threadGroupId !== null
          ? getGroupActionErrorMessage(reactionError, getOnChainFailureMessage(reactionError, 'Failed to send reaction.'))
          : reactionError instanceof Error
            ? getOnChainFailureMessage(reactionError, reactionError.message)
            : getOnChainFailureMessage(reactionError, 'Failed to send reaction.');
      setError(message);

      if (threadGroupId !== null) {
        const groupKey = String(threadGroupId);
        setMessagesByGroup((previous) => ({
          ...previous,
          [groupKey]: (previous[groupKey] ?? []).map((messageRecord) =>
            messageRecord.id === localMessageId
              ? {
                  ...messageRecord,
                  deliveryState: 'failed'
                }
              : messageRecord
          )
        }));
      } else if (threadContactAddress) {
        const contactKey = threadContactAddress.toLowerCase();
        setMessagesByContact((previous) => ({
          ...previous,
          [contactKey]: (previous[contactKey] ?? []).map((messageRecord) =>
            messageRecord.id === localMessageId
              ? {
                  ...messageRecord,
                  deliveryState: 'failed'
                }
              : messageRecord
          )
        }));
      }

      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        const shouldTopUp = window.confirm(
          'Burner wallet has insufficient funds. Do you want to top up now with your wallet?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithWallet();
        }
      }
    } finally {
      setSendingReaction(false);
    }
  };

  const sendMessage = async (overrideMessageText?: string, overrideReplyTarget?: ChatMessage | null) => {
    setError('');

    if (sendingRef.current) {
      return;
    }

    const plainText = sanitizeOutgoingMessagePlainText(overrideMessageText ?? messageInput).trim();
    if (!plainText) {
      setError('Enter a message first.');
      return;
    }

    if (plainText.length > MAX_MESSAGE_LENGTH) {
      setError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
      return;
    }

    if (plainText.startsWith(IMAGE_MESSAGE_PREFIX)) {
      setError('Image messages are disabled for security reasons.');
      return;
    }

    if (!activeContact) {
      setError('Select a contact first.');
      return;
    }
    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    const contactAddress = activeContact;
    const contactKey = contactAddress.toLowerCase();
    const replyTarget = browserWalletLiteMode ? null : overrideReplyTarget ?? replyingToMessage;
    const replyingPreviewText = replyTarget ? getMessageDisplayText(replyTarget.text) : undefined;
    const localMessageId = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const localMessageTimestamp = Math.floor(Date.now() / 1000);

    try {
      sendingRef.current = true;
      setSending(true);
      setMessagesByContact((previous) => ({
        ...previous,
        [contactKey]: [
          ...(previous[contactKey] ?? []),
          {
            id: localMessageId,
            direction: 'outgoing',
            text: plainText,
            replyToMessageId: replyTarget?.id,
            replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
            replyToTxHash: replyTarget?.txHash,
            replyToBlockNumber: replyTarget?.blockNumber,
            replyToLogIndex: replyTarget?.logIndex,
            timestamp: localMessageTimestamp,
            deliveryState: 'pending'
          }
        ]
      }));

      await runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const selector = await resolveSubmitSelector();
      const requiredFee = await resolveRequiredFeeForSend();
      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyTarget?.txHash,
        replyTarget?.blockNumber,
        replyTarget?.logIndex,
        false
      );
      const submittedTx = await submitDirectMemo({
        signer,
        contactAddress,
        plainText: plainTextWithReply,
        selector,
        requiredFee,
        encodeMemo: encodeMemoForActiveSigner
      });
      const submittedTxHash = submittedTx.txHash;
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setMessagesByContact((previous) => {
        const existing = previous[contactKey] ?? [];
        const normalizedSubmittedTxHash = submittedTxHash.trim().toLowerCase();
        const hasConfirmedTwinByTxHash =
          normalizedSubmittedTxHash.length > 0 &&
          existing.some(
            (message) =>
              !message.id.startsWith('local-') &&
              message.direction === 'outgoing' &&
              typeof message.txHash === 'string' &&
              message.txHash.toLowerCase() === normalizedSubmittedTxHash
          );

        const localMessageRecord = existing.find((message) => message.id === localMessageId);
        const hasConfirmedTwinByContent =
          !hasConfirmedTwinByTxHash &&
          Boolean(
            localMessageRecord &&
              existing.some((message) => {
                if (message.id.startsWith('local-') || message.direction !== 'outgoing') {
                  return false;
                }
                return (
                  message.text === localMessageRecord.text &&
                  (message.replyToText ?? '') === (localMessageRecord.replyToText ?? '') &&
                  messageReferencesMatch(
                    {
                      txHash: message.replyToTxHash,
                      blockNumber: message.replyToBlockNumber,
                      logIndex: message.replyToLogIndex
                    },
                    {
                      txHash: localMessageRecord.replyToTxHash,
                      blockNumber: localMessageRecord.replyToBlockNumber,
                      logIndex: localMessageRecord.replyToLogIndex
                    }
                  )
                );
              })
          );

        if (hasConfirmedTwinByTxHash || hasConfirmedTwinByContent) {
          return {
            ...previous,
            [contactKey]: existing.filter((message) => message.id !== localMessageId)
          };
        }

        return {
          ...previous,
          [contactKey]: existing.map((message) =>
            message.id === localMessageId
              ? {
                  ...message,
                  txHash: submittedTxHash || undefined
                }
              : message
          )
        };
      });

      const receipt = await submittedTx.wait();
      if (
        !receipt ||
        Number((receipt as { status?: number | bigint }).status ?? 0) !== 1
      ) {
        throw new Error('Transaction failed on-chain.');
      }

      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setMessagesByContact((previous) => ({
        ...previous,
        [contactKey]: (previous[contactKey] ?? []).map((message) =>
          message.id === localMessageId
            ? {
                ...message,
                deliveryState: 'sent',
                txHash: submittedTxHash || undefined
              }
            : message
        )
      }));

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      if (typeof overrideMessageText === 'undefined') {
        setMessageInput('');
      }
      setReplyingToMessage(null);
      syncConversationHistory({ background: true, activeContactOnly: true }).catch(() => {});
      if (activeSignerSource === 'burner') {
        setTopUpMetricsNonce((previous) => previous + 1);
      }
      });
    } catch (sendError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const message =
        sendError instanceof Error
          ? getOnChainFailureMessage(sendError, sendError.message)
          : getOnChainFailureMessage(sendError, 'Failed to send message.');
      setError(message);
      setMessagesByContact((previous) => ({
        ...previous,
        [contactKey]: (previous[contactKey] ?? []).map((messageRecord) =>
          messageRecord.id === localMessageId
            ? {
                ...messageRecord,
                deliveryState: 'failed'
              }
            : messageRecord
        )
      }));

      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        const shouldTopUp = window.confirm(
          'Burner wallet has insufficient funds. Do you want to top up now with your wallet?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithWallet();
        }
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

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
    replyingToMessage,
    runWalletTransactionFlow: runSharedWalletTransactionFlow,
    resolveRequiredFeeForTradeCreate,
    resolveTradeSnapshotForOffer,
    selectedTradeOfferToken,
    selectedTradeRequestToken,
    sendMessage,
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
    topUpBurnerWithWallet,
    tradeComposerValidationMessage,
    tradeCounterContext,
    tradeCounterParentId,
    walletAddress
  });
  const sendTipToRecipient = async (
    recipientInput: string,
    tipToken: TipTokenSelection,
    tipAmount: bigint,
    options?: {
      missingRecipientMessage?: string;
      invalidRecipientMessage?: string;
    }
  ) => {
    setError('');

    if (sendingRef.current || tipping) {
      return;
    }

    const recipient = recipientInput.trim();
    if (!recipient) {
      setError(options?.missingRecipientMessage ?? 'Select a recipient first.');
      return;
    }

    if (!isWalletAddress(recipient)) {
      setError(options?.invalidRecipientMessage ?? 'Invalid recipient address.');
      return;
    }

    if (walletAddress && recipient.toLowerCase() === walletAddress.toLowerCase()) {
      setError('Cannot tip your own wallet.');
      return;
    }

    if (tipAmount <= 0n) {
      setError('Enter a tip amount above zero.');
      return;
    }

    const tokenAddress = tipToken === 'wisp' ? REWARD_TOKEN_ADDRESS : PRIVATE_REWARD_TOKEN_ADDRESS;
    const tokenSymbol =
      tipToken === 'coti'
        ? TIP_NATIVE_TOKEN_SYMBOL
        : tipToken === 'wisp'
          ? rewardTokenSymbol
          : privateRewardTokenSymbol;
    const tokenDecimals =
      tipToken === 'coti'
        ? TIP_NATIVE_TOKEN_DECIMALS
        : tipToken === 'wisp'
          ? rewardTokenDecimals
          : privateRewardTokenDecimals;
    const tokenBalanceWei =
      tipToken === 'coti' ? tipNativeBalanceWei : tipToken === 'wisp' ? rewardTokenBalanceWei : privateRewardTokenBalanceWei;

    if (tokenBalanceWei === null) {
      setError(`Unable to read ${tokenSymbol} balance. Wait for balances to load and try again.`);
      return;
    }

    if (tipAmount > tokenBalanceWei) {
      setError(
        `Insufficient ${tokenSymbol} balance. Available ${formatTokenAmount(tokenBalanceWei, tokenDecimals, 6)} ${tokenSymbol}.`
      );
      return;
    }

    let transferSucceeded = false;
    try {
      setTipping(true);
      await runSharedWalletTransactionFlow(async () => {
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      let requiredFeeForTipNotice: bigint | null = null;

      if (tipToken === 'coti') {
        requiredFeeForTipNotice = await resolveRequiredFeeForSend();
        if (tokenBalanceWei < tipAmount + requiredFeeForTipNotice) {
          throw new Error(
            `Insufficient COTI balance. Keep at least ${formatTokenAmount(requiredFeeForTipNotice, TIP_NATIVE_TOKEN_DECIMALS, 6)} COTI for the tip note fee.`
          );
        }
      } else {
        const tipTokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
        const tx = await tipTokenContract.transfer(recipient, tipAmount);
        await tx.wait();
        transferSucceeded = true;
      }

      setTopUpMetricsNonce((previous) => previous + 1);
      if (tipToken === 'wisp') {
        setRewardTokenBalanceWei((previous) =>
          previous === null ? previous : previous > tipAmount ? previous - tipAmount : 0n
        );
      } else {
        setPrivateRewardTokenBalanceWei((previous) =>
          previous === null ? previous : previous > tipAmount ? previous - tipAmount : 0n
        );
      }

      const selector = await resolveSubmitSelector();
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const requiredFee = requiredFeeForTipNotice ?? (await resolveRequiredFeeForSend());
      const tipNoticeText = `[TIP] You received ${formatTokenAmount(tipAmount, tokenDecimals, 6)} ${tokenSymbol}.`;
      const encodedTipMemo = encodeMemoForActiveSigner(tipNoticeText);
      const encryptedTipMemo = await signer.encryptValue(encodedTipMemo, CHAT_CONTRACT_ADDRESS, selector);
      const submitTipMemoPayload = parseSubmitMemoPayload(encryptedTipMemo);
      const tipMemoTuple = [[submitTipMemoPayload.ciphertextValue], submitTipMemoPayload.signature] as const;
      const nativeValue = tipToken === 'coti' ? requiredFee + tipAmount : requiredFee;
      const tipMemoTx = await contract.submit(recipient, tipMemoTuple, { value: nativeValue });
      await tipMemoTx.wait();
      if (tipToken === 'coti') {
        setTipNativeBalanceWei((previous) =>
          previous === null ? previous : previous > nativeValue ? previous - nativeValue : 0n
        );
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
      syncConversationHistory({ background: true, activeContactOnly: true }).catch(() => {});
      setTipAmountInput('');
      });
    } catch (tipError) {
      const rawMessage = tipError instanceof Error ? tipError.message : '';
      const message = rawMessage || (transferSucceeded ? 'Tip sent, but notification message failed.' : 'Failed to send tip.');
      setError(transferSucceeded ? `Tip sent, but notification failed: ${message}` : message);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        const shouldTopUp = window.confirm(
          'Burner wallet has insufficient funds. Do you want to top up now with your wallet?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithWallet();
        }
      }
    } finally {
      setTipping(false);
    }
  };

  const sendTipToActiveContact = async (
    tipToken: TipTokenSelection,
    tipAmount: bigint
  ) => {
    await sendTipToRecipient(activeContact ?? '', tipToken, tipAmount, {
      missingRecipientMessage: 'Select a contact first.',
      invalidRecipientMessage: 'Invalid contact address.'
    });
  };

  const sendTipToActiveGroupMember = async (
    tipToken: TipTokenSelection,
    tipAmount: bigint
  ) => {
    await sendTipToRecipient(groupTipRecipientAddress, tipToken, tipAmount, {
      missingRecipientMessage: 'Select a group member first.',
      invalidRecipientMessage: 'Invalid group member address.'
    });
  };

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
    groupRequiredFeeCacheRef.current = null;
    groupRequiredFeeRequestRef.current = null;
    groupTokenFeeCacheRef.current = null;
    groupTokenFeeRequestRef.current = null;
    groupSubmitSelectorRef.current = null;
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
  }, [walletAddress]);

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
  }, [activeGroupId, walletAddress, hasAesReady, isActiveGroupAdmin, chainId, activeGroupMeta?.lastBlock, loadActiveJoinCodesForGroup]);

  useEffect(() => {
    setUnreadMap({});
    setUnreadGroupMap({});
    unreadMapRef.current = {};
    unreadGroupMapRef.current = {};
    setLastReadAllTs(0);
    prevUnreadRef.current = {};
    prevUnreadGroupRef.current = {};
    lastReadAllTsRef.current = 0;
    lastReadByContactRef.current = {};
    lastReadByGroupRef.current = {};
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress || !isWalletAddress(walletAddress)) {
      return;
    }

    const nextOrder = sortedContacts.map((contact) => contact.address.toLowerCase());
    const sameLength = persistedContactOrder.length === nextOrder.length;
    const sameOrder = sameLength && persistedContactOrder.every((value, index) => value === nextOrder[index]);
    if (sameOrder) {
      return;
    }

    setPersistedContactOrder(nextOrder);
  }, [walletAddress, sortedContacts, persistedContactOrder]);

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
    if (!walletAddress) {
      setOnboardStatus('Not onboarded');
      return;
    }

    const cachedOnboardInfo = sessionOnboardInfo[walletAddress.toLowerCase()];
    if (cachedOnboardInfo?.aesKey) {
      setOnboardStatus('AES key ready');
      return;
    }

    setOnboardStatus('Signature required');
  }, [walletAddress, sessionOnboardInfo]);

  useEffect(() => {
    if (!isConnected) {
      setActiveMobileView('contacts');
    }
  }, [isConnected]);

  const navigateToPage = useCallback((page: AppPage) => {
    setActivePage(page);
    if (typeof window !== 'undefined') {
      const nextPath = getPathForAppPage(page);
      const currentPath = resolveNavigationPathFromLocation();
      const nextHash = '';
      if (
        currentPath !== nextPath ||
        window.location.hash !== nextHash ||
        new URLSearchParams(window.location.search).has('p')
      ) {
        const nextUrl = new URL(window.location.href);
        nextUrl.pathname = nextPath;
        nextUrl.searchParams.delete('p');
        nextUrl.hash = nextHash;
        window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      }
    }
  }, []);

  const navigateToInternalAppLink = useCallback((href: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(href, window.location.origin);
    } catch {
      return;
    }

    if (targetUrl.origin !== window.location.origin) {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = targetUrl.pathname;
    nextUrl.search = targetUrl.search;
    nextUrl.hash = targetUrl.hash;
    window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    setActivePage(resolveAppRouteFromLocation().page);
  }, []);

  useEffect(() => {
    const syncPageWithLocation = () => {
      const nextRoute = resolveAppRouteFromLocation();
      setActivePage(nextRoute.page);

      const currentPath = resolveNavigationPathFromLocation();
      const canonicalPath =
        nextRoute.page === 'trades' && currentPath.toLowerCase().startsWith('/trades')
          ? currentPath
          : getPathForAppPage(nextRoute.page);
      const canonicalHash = nextRoute.page === 'trades' ? window.location.hash : '';
      if (
        currentPath !== canonicalPath ||
        window.location.hash !== canonicalHash ||
        new URLSearchParams(window.location.search).has('p')
      ) {
        const nextUrl = new URL(window.location.href);
        nextUrl.pathname = canonicalPath;
        nextUrl.searchParams.delete('p');
        nextUrl.hash = canonicalHash;
        window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      }
    };

    syncPageWithLocation();
    window.addEventListener('popstate', syncPageWithLocation);
    window.addEventListener('hashchange', syncPageWithLocation);
    return () => {
      window.removeEventListener('popstate', syncPageWithLocation);
      window.removeEventListener('hashchange', syncPageWithLocation);
    };
  }, []);

  useEffect(() => {
    setMobileLinksOpen(false);
    setChatWalletMenuOpen(false);
    if (activePage !== 'trades') {
      setTradeHeaderWalletControl(null);
    }
    if (activePage !== 'chat') {
      setShowQuickActionsModal(false);
      setMobileGroupOptionsOpen(false);
    }
    if (activePage !== 'chat' && activePage !== 'trades' && activePage !== 'swap') {
      setShowTopUpModal(false);
      setShowBurnerImportModal(false);
      closeBurnerPinModal();
    }
  }, [activePage, closeBurnerPinModal, setShowBurnerImportModal]);

  useEffect(() => {
    if (activePage === 'trades' && activeMobileView === 'contacts') {
      setActiveMobileView('chat');
    }
  }, [activeMobileView, activePage]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.title =
      activePage === 'home'
        ? 'ChainWhisper'
        : activePage === 'chat'
          ? 'Encrypted Chat | ChainWhisper'
          : activePage === 'swap'
            ? 'Whisper Shield | ChainWhisper'
          : activePage === 'trades'
            ? 'P2P Escrow | ChainWhisper'
            : 'Treasury Data | ChainWhisper';
  }, [activePage]);

  useEffect(() => {
    if (!mobileLinksOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (topHeaderRef.current?.contains(target)) {
        return;
      }

      setMobileLinksOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [mobileLinksOpen]);

  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth <= MOBILE_NAV_BREAKPOINT_PX;
      setIsMobileNav(isMobile);
      if (!isMobile) {
        setMobileLinksOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

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
    if (!isConnected || !activeThreadKey) {
      return;
    }

    const container = chatMessagesRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      stickToBottomRef.current = isNearBottom(container);
      if (container.scrollTop > 120) {
        return;
      }

      if (visibleThreadMessageCount < activeThreadMessages.length) {
        setVisibleThreadMessageCount((current) => {
          const next = Math.min(activeThreadMessages.length, current + VISIBLE_THREAD_MESSAGE_CHUNK);
          if (next > current) {
            suppressNextBottomAnchorRef.current = true;
          }
          return next;
        });
        return;
      }

      if (activeContact) {
        loadOlderMessagesForActiveContact().catch(() => {});
      }
    };

    stickToBottomRef.current = isNearBottom(container);
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [
    isConnected,
    activeThreadKey,
    activeContact,
    walletAddress,
    hasAesReady,
    activeThreadMessages.length,
    visibleThreadMessageCount,
    chatMessagesViewportVersion,
    loadOlderMessagesForActiveContact
  ]);

  useEffect(() => {
    return () => {
      if (groupRemovalNoticeTimeoutRef.current !== null) {
        window.clearTimeout(groupRemovalNoticeTimeoutRef.current);
      }
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const activeContactChanged = previousActiveContactForScrollRef.current !== activeThreadKey;
    const currentMessageCount = activeThreadMessages.length;
    const currentLastMessageId = currentMessageCount > 0 ? activeThreadMessages[currentMessageCount - 1].id : null;
    const latestMessageChanged = previousLastMessageIdForScrollRef.current !== currentLastMessageId;
    const threadMessageCountChanged = previousThreadMessageCountForScrollRef.current !== currentMessageCount;
    const visibleThreadMessageCountChanged =
      previousVisibleThreadMessageCountForScrollRef.current !== visibleThreadMessageCount;
    const forceBottomAnchor = pendingForcedBottomAnchorThreadKeyRef.current === activeThreadKey;
    if (activeContactChanged) {
      stickToBottomRef.current = true;
      previousActiveContactForScrollRef.current = activeThreadKey;
      if (
        pendingForcedBottomAnchorThreadKeyRef.current &&
        pendingForcedBottomAnchorThreadKeyRef.current !== activeThreadKey
      ) {
        pendingForcedBottomAnchorThreadKeyRef.current = null;
      }
    }
    previousLastMessageIdForScrollRef.current = currentLastMessageId;
    previousThreadMessageCountForScrollRef.current = currentMessageCount;
    previousVisibleThreadMessageCountForScrollRef.current = visibleThreadMessageCount;

    if (
      suppressNextBottomAnchorRef.current &&
      visibleThreadMessageCountChanged &&
      !forceBottomAnchor &&
      !activeContactChanged &&
      !latestMessageChanged &&
      !threadMessageCountChanged
    ) {
      suppressNextBottomAnchorRef.current = false;
      return;
    }
    suppressNextBottomAnchorRef.current = false;

    if (
      !forceBottomAnchor &&
      !activeContactChanged &&
      ((!latestMessageChanged && !threadMessageCountChanged && !visibleThreadMessageCountChanged) ||
        !stickToBottomRef.current)
    ) {
      return;
    }

    let cancelled = false;

    const scrollToBottomAfterLayout = () => {
      if (cancelled) {
        return;
      }

      pendingForcedBottomAnchorThreadKeyRef.current = null;
      scrollChatToBottom();
      window.setTimeout(() => {
        if (!cancelled) {
          scrollChatToBottom();
        }
      }, 0);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottomAfterLayout);
    });

    return () => {
      cancelled = true;
    };
  }, [activeThreadKey, activeThreadMessages, visibleThreadMessageCount, chatMessagesViewportVersion]);

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container) {
      return;
    }

    const handleImageLoad = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.tagName !== 'IMG') {
        return;
      }

      const lastMessage = activeThreadMessages.length > 0 ? activeThreadMessages[activeThreadMessages.length - 1] : null;
      const lastMessageElement = lastMessage ? messageElementRefs.current[lastMessage.id] : null;
      const imageInLatestMessage = Boolean(lastMessageElement && target && lastMessageElement.contains(target));
      if (!stickToBottomRef.current && !imageInLatestMessage) {
        return;
      }

      requestAnimationFrame(() => {
        scrollChatToBottom();
        window.setTimeout(() => {
          scrollChatToBottom();
        }, 0);
      });
    };

    container.addEventListener('load', handleImageLoad, true);
    return () => {
      container.removeEventListener('load', handleImageLoad, true);
    };
  }, [activeThreadKey, activeThreadMessages, chatMessagesViewportVersion]);

  useEffect(() => {
    const container = chatMessagesRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    lastObservedScrollHeightRef.current = container.scrollHeight;
    const observer = new ResizeObserver(() => {
      const nextHeight = container.scrollHeight;
      if (nextHeight === lastObservedScrollHeightRef.current) {
        return;
      }

      lastObservedScrollHeightRef.current = nextHeight;
      if (!stickToBottomRef.current) {
        return;
      }

      requestAnimationFrame(() => {
        scrollChatToBottom();
        window.setTimeout(() => {
          scrollChatToBottom();
        }, 0);
      });
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [activeThreadKey, chatMessagesViewportVersion]);

  useEffect(() => {
    const previousWallet = previousWalletAddressRef.current;
    const nextWallet = walletAddress.trim().toLowerCase();

    if (previousWallet !== nextWallet) {
      postConnectDataSyncRunIdRef.current += 1;
      stickToBottomRef.current = true;
      previousActiveContactForScrollRef.current = null;
      previousLastMessageIdForScrollRef.current = null;
      previousThreadMessageCountForScrollRef.current = 0;
      previousVisibleThreadMessageCountForScrollRef.current = 0;
      pendingForcedBottomAnchorThreadKeyRef.current = null;
      resetConversationHistoryCaches();
      suppressNextBottomAnchorRef.current = false;
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
    setHighlightedMessageId,
    setReplyingToMessage,
    walletAddress
  ]);

  useEffect(() => {
    setReactionPickerMessageId(null);
    setTipComposerOpen(false);
    setTipAmountInput('');
  }, [activeThreadKey, setReactionPickerMessageId, setTipAmountInput, setTipComposerOpen]);

  useEffect(() => {
    if (!isConnected || !activeThreadKey) {
      return;
    }

    stickToBottomRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollChatToBottom();
      });
    });
  }, [isConnected, activeThreadKey, chatMessagesViewportVersion]);

  useEffect(() => {
    let cancelled = false;

    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      setTopUpAmountWei(null);
      setBurnerBalanceWei(null);
      setLoadingTopUpQuote(false);
      return;
    }

    const loadTopUpAmount = async () => {
      setTopUpAmountWei(calculateEstimatedBurnerTopUpAmount(topUpMessageTarget));
      setLoadingTopUpQuote(true);
      try {
        const readProvider = await loadCotiReadProvider(true);
        const burnerBalance = (await readProvider.getBalance(burnerAddress)) as bigint;
        if (!cancelled) {
          setBurnerBalanceWei(burnerBalance);
        }
      } catch {
        if (!cancelled) {
          setBurnerBalanceWei(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingTopUpQuote(false);
        }
      }
    };

    loadTopUpAmount().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [burnerAddress, topUpMessageTarget, topUpMetricsNonce]);

  useEffect(() => {
    let cancelled = false;
    const signerAddress = (activeSignerSource === 'burner' ? burnerAddress : walletAddress).trim();

    if (!signerAddress || !isWalletAddress(signerAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setTipNativeBalanceWei(null);
      return;
    }

    const loadTipNativeBalance = async () => {
      try {
        const readProvider = await loadCotiReadProvider(true);
        const nativeBalance = (await readProvider.getBalance(signerAddress)) as bigint;
        if (!cancelled) {
          setTipNativeBalanceWei(nativeBalance);
        }
      } catch {
        if (!cancelled) {
          setTipNativeBalanceWei(null);
        }
      }
    };

    loadTipNativeBalance().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeSignerSource, burnerAddress, walletAddress, chainId, topUpMetricsNonce, tipComposerOpen]);

  useEffect(() => {
    let cancelled = false;

    if (!currentSwapDirectionEnabled || !activeSwapVaultContractAddress) {
      setSwapFeeWei(null);
      setSwapTokenFeeAmount(null);
      setShieldVaultTokenBalanceWei(null);
      return () => {
        cancelled = true;
      };
    }

    const loadShieldVaultReserve = async () => {
      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const swapVaultContract = new cotiEthers.Contract(
          activeSwapVaultContractAddress,
          SWAP_VAULT_CONTRACT_ABI,
          readProvider
        );
        const [rewardSymbolRaw, rewardDecimalsRaw, swapFeeRaw, swapTokenFeeRaw, shieldVaultTokenBalanceRaw] =
          await Promise.all([
            rewardTokenContract.symbol().catch(() => null),
            rewardTokenContract.decimals().catch(() => null),
            swapVaultContract.swapFeeWei().catch(() => null),
            swapVaultContract.getTokenFeeAmount().catch(() => null),
            rewardTokenContract.balanceOf(activeSwapVaultContractAddress).catch(() => null)
          ]);

        if (cancelled) {
          return;
        }

        if (typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim()) {
          setRewardTokenSymbol(rewardSymbolRaw.trim().slice(0, 12));
        }
        if (typeof rewardDecimalsRaw === 'number' || typeof rewardDecimalsRaw === 'bigint') {
          setRewardTokenDecimals(normalizeTokenDecimals(Number(rewardDecimalsRaw)));
        }
        setSwapFeeWei(typeof swapFeeRaw === 'bigint' ? swapFeeRaw : null);
        setSwapTokenFeeAmount(typeof swapTokenFeeRaw === 'bigint' ? swapTokenFeeRaw : null);
        setShieldVaultTokenBalanceWei(
          typeof shieldVaultTokenBalanceRaw === 'bigint' ? shieldVaultTokenBalanceRaw : null
        );
      } catch {
        if (!cancelled) {
          setShieldVaultTokenBalanceWei(null);
        }
      }
    };

    loadShieldVaultReserve().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeSwapVaultContractAddress, currentSwapDirectionEnabled, topUpMetricsNonce]);

  useEffect(() => {
    let cancelled = false;
    const requestedWalletAddress = walletAddress.trim();

    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setRewardTokenBalanceWei(null);
      setPrivateRewardTokenBalanceWei(null);
      setLegacyPrivateRewardTokenBalanceWei(null);
      setGroupRewardsContractAddress('');
      setGroupRewardsPaused(null);
      setRewardsContractPaused(null);
      setRewardsCallerAllowed(null);
      setRewardsPublicPerInteractionWei(null);
      setRewardsPublicReserveWei(null);
      setSwapFeeWei(null);
      setSwapTokenFeeAmount(null);
      setLoadingRewardBalances(false);
      return;
    }

    const loadRewardBalances = async () => {
      setLoadingRewardBalances(true);
      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const privateTokenContract = new cotiEthers.Contract(PRIVATE_REWARD_TOKEN_ADDRESS, PRIVATE_ERC20_TOKEN_VNEXT_ABI, readProvider);
        const legacyPrivateTokenContract = new cotiEthers.Contract(
          LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
          PRIVATE_TOKEN_BALANCE_ABI,
          readProvider
        );
        const groupContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const swapVaultContract =
          currentSwapDirectionEnabled && activeSwapVaultContractAddress
            ? new cotiEthers.Contract(activeSwapVaultContractAddress, SWAP_VAULT_CONTRACT_ABI, readProvider)
            : null;

        const [
          rewardBalanceRaw,
          rewardSymbolRaw,
          rewardDecimalsRaw,
          privateSymbolRaw,
          privateDecimalsRaw,
          legacyPrivateSymbolRaw,
          legacyPrivateDecimalsRaw,
          groupNativeFeeRaw,
          groupTokenFeeRaw,
          rewardsContractRaw,
          rewardsPausedRaw,
          swapFeeRaw,
          swapTokenFeeRaw
        ] = await Promise.all([
          rewardTokenContract.balanceOf(requestedWalletAddress).catch(() => null),
          rewardTokenContract.symbol().catch(() => null),
          rewardTokenContract.decimals().catch(() => null),
          privateTokenContract.symbol().catch(() => null),
          privateTokenContract.decimals().catch(() => null),
          legacyPrivateTokenContract.symbol().catch(() => null),
          legacyPrivateTokenContract.decimals().catch(() => null),
          groupContract.feeAmount().catch(() => null),
          groupContract.tokenFeeAmount().catch(() => null),
          groupContract.rewardsContract().catch(() => null),
          groupContract.rewardsPaused().catch(() => null),
          swapVaultContract ? swapVaultContract.swapFeeWei().catch(() => null) : Promise.resolve(null),
          swapVaultContract ? swapVaultContract.getTokenFeeAmount().catch(() => null) : Promise.resolve(null)
        ]);

        let privateBalanceWei: bigint | null = null;
        let legacyPrivateBalanceWei: bigint | null = null;
        if (hasAesReady) {
          try {
            const { signer, cacheKey } = await getMemoSigner();
            privateBalanceWei = await readCurrentPrivateErc20BalanceWei(
              PRIVATE_REWARD_TOKEN_ADDRESS,
              requestedWalletAddress,
              signer
            ).catch(() => null);
            legacyPrivateBalanceWei = await readLegacyPrivateRewardBalanceWei(
              requestedWalletAddress,
              signer
            ).catch(() => null);

            const nextOnboardInfo = signer.getUserOnboardInfo();
            setSessionOnboardInfo((previous) => ({
              ...previous,
              [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
            }));
          } catch {
            privateBalanceWei = null;
            legacyPrivateBalanceWei = null;
          }
        }

        const nextRewardBalance = typeof rewardBalanceRaw === 'bigint' ? rewardBalanceRaw : null;
        const nextGroupNativeFee = typeof groupNativeFeeRaw === 'bigint' ? groupNativeFeeRaw : null;
        const nextGroupTokenFee = typeof groupTokenFeeRaw === 'bigint' ? groupTokenFeeRaw : null;
        const nextRewardsContractAddress =
          typeof rewardsContractRaw === 'string' && isWalletAddress(rewardsContractRaw)
            ? rewardsContractRaw
            : '';
        const nextRewardsPaused = typeof rewardsPausedRaw === 'boolean' ? rewardsPausedRaw : null;
        let nextRewardsContractPaused: boolean | null = null;
        let nextRewardsCallerAllowed: boolean | null = null;
        let nextRewardsPublicPerInteractionWei: bigint | null = null;
        let nextRewardsPublicReserveWei: bigint | null = null;
        if (nextRewardsContractAddress) {
          const rewardsContract = new cotiEthers.Contract(nextRewardsContractAddress, WHISPER_REWARDS_ABI, readProvider);
          const [
            rewardsContractPausedRaw,
            rewardsCallerAllowedRaw,
            rewardsPublicPerInteractionRaw,
            rewardsPublicReserveRaw
          ] = await Promise.all([
            rewardsContract.paused().catch(() => null),
            rewardsContract.allowedInteractionContracts(GROUP_CHAT_CONTRACT_ADDRESS).catch(() => null),
            rewardsContract.publicRewardAmount().catch(() => null),
            rewardTokenContract.balanceOf(nextRewardsContractAddress).catch(() => null)
          ]);
          nextRewardsContractPaused =
            typeof rewardsContractPausedRaw === 'boolean' ? rewardsContractPausedRaw : null;
          nextRewardsCallerAllowed =
            typeof rewardsCallerAllowedRaw === 'boolean' ? rewardsCallerAllowedRaw : null;
          nextRewardsPublicPerInteractionWei =
            typeof rewardsPublicPerInteractionRaw === 'bigint' ? rewardsPublicPerInteractionRaw : null;
          nextRewardsPublicReserveWei = typeof rewardsPublicReserveRaw === 'bigint' ? rewardsPublicReserveRaw : null;
        }
        const nextSwapFee = typeof swapFeeRaw === 'bigint' ? swapFeeRaw : null;
        const nextSwapTokenFee = typeof swapTokenFeeRaw === 'bigint' ? swapTokenFeeRaw : null;
        const resolvedRewardSymbol =
          typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim()
            ? rewardSymbolRaw.trim().slice(0, 12)
            : FALLBACK_REWARD_TOKEN_SYMBOL;
        const resolvedPrivateSymbol =
          typeof privateSymbolRaw === 'string' && privateSymbolRaw.trim()
            ? privateSymbolRaw.trim().slice(0, 12)
            : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL;
        const resolvedLegacyPrivateSymbol =
          typeof legacyPrivateSymbolRaw === 'string' && legacyPrivateSymbolRaw.trim()
            ? legacyPrivateSymbolRaw.trim().slice(0, 12)
            : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL;
        const resolvedRewardDecimals =
          typeof rewardDecimalsRaw === 'number' || typeof rewardDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(rewardDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        const resolvedPrivateDecimals =
          typeof privateDecimalsRaw === 'number' || typeof privateDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(privateDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        const resolvedLegacyPrivateDecimals =
          typeof legacyPrivateDecimalsRaw === 'number' || typeof legacyPrivateDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(legacyPrivateDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;

        if (!cancelled) {
          setRewardTokenBalanceWei(nextRewardBalance);
          setPrivateRewardTokenBalanceWei(privateBalanceWei);
          setLegacyPrivateRewardTokenBalanceWei(legacyPrivateBalanceWei);
          setRewardTokenSymbol(resolvedRewardSymbol);
          setPrivateRewardTokenSymbol(resolvedPrivateSymbol);
          setLegacyPrivateRewardTokenSymbol(resolvedLegacyPrivateSymbol);
          setRewardTokenDecimals(resolvedRewardDecimals);
          setPrivateRewardTokenDecimals(resolvedPrivateDecimals);
          setLegacyPrivateRewardTokenDecimals(resolvedLegacyPrivateDecimals);
          setGroupRewardsContractAddress(nextRewardsContractAddress);
          setGroupRewardsPaused(nextRewardsPaused);
          setRewardsContractPaused(nextRewardsContractPaused);
          setRewardsCallerAllowed(nextRewardsCallerAllowed);
          setRewardsPublicPerInteractionWei(nextRewardsPublicPerInteractionWei);
          setRewardsPublicReserveWei(nextRewardsPublicReserveWei);
          setSwapFeeWei(nextSwapFee);
          setSwapTokenFeeAmount(nextSwapTokenFee);
          if (nextGroupNativeFee !== null) {
            groupRequiredFeeCacheRef.current = nextGroupNativeFee;
          }
          if (nextGroupTokenFee !== null) {
            groupTokenFeeCacheRef.current = nextGroupTokenFee;
          }
        }
      } catch {
        if (!cancelled) {
          setRewardTokenBalanceWei(null);
          setPrivateRewardTokenBalanceWei(null);
          setLegacyPrivateRewardTokenBalanceWei(null);
          setGroupRewardsContractAddress('');
          setGroupRewardsPaused(null);
          setRewardsContractPaused(null);
          setRewardsCallerAllowed(null);
          setRewardsPublicPerInteractionWei(null);
          setRewardsPublicReserveWei(null);
          setSwapFeeWei(null);
          setSwapTokenFeeAmount(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingRewardBalances(false);
        }
      }
    };

    loadRewardBalances().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    activeSwapVaultContractAddress,
    chainId,
    currentSwapDirectionEnabled,
    hasAesReady,
    topUpMetricsNonce,
    walletAddress
  ]);

  useEffect(() => {
    requiredFeeCacheRef.current = requiredFeeWei;
  }, [requiredFeeWei]);

  useEffect(() => {
    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      return;
    }

    let cancelled = false;
    let unsubscribeBlocks: (() => void) | null = null;
    let lastRefreshAt = 0;
    const bumpTopUpMetrics = () => {
      const now = Date.now();
      if (now - lastRefreshAt < AUTO_SYNC_INTERVAL_MS) {
        return;
      }

      lastRefreshAt = now;
      setTopUpMetricsNonce((previous) => previous + 1);
    };

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        bumpTopUpMetrics();
      }
    }, AUTO_SYNC_INTERVAL_MS);

    loadCotiWsProvider()
      .then(async (wsProvider) => {
        if (cancelled) {
          return;
        }

        if (Date.now() - getCotiWsLastHealthyAt() > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        markCotiWsHealthyNow();

        const providerWithEvents = wsProvider as unknown as {
          on?: (event: string, listener: (...args: unknown[]) => void) => void;
          off?: (event: string, listener: (...args: unknown[]) => void) => void;
        };

        const handleBlock = () => {
          if (!cancelled) {
            bumpTopUpMetrics();
          }
        };

        providerWithEvents.on?.('block', handleBlock);
        unsubscribeBlocks = () => {
          providerWithEvents.off?.('block', handleBlock);
        };
      })
      .catch(() => {
        // Keep interval-only fallback.
      });

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      unsubscribeBlocks?.();
    };
  }, [burnerAddress]);

  useEffect(() => {
    if (!walletAddress || chainId !== COTI_NETWORK.chainIdDecimal) {
      setDirectRealtimeStatus('idle');
      return;
    }

    if (!hasAesReady) {
      setDirectRealtimeStatus('idle');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeWsDisconnect: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let deepConversationSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;
    let pendingRealtimeSyncOptions: SyncConversationOptions | null = null;

    const mergeRealtimeSyncOptions = (options?: SyncConversationOptions): void => {
      pendingRealtimeSyncOptions = mergeDirectSyncOptions(
        { background: true, ...(options ?? {}) },
        pendingRealtimeSyncOptions
      );
    };

    const dispatchRealtimeSync = () => {
      if (cancelled) {
        return;
      }

      const nextOptions = pendingRealtimeSyncOptions;
      pendingRealtimeSyncOptions = null;
      lastRealtimeSyncDispatchAt = Date.now();
      syncConversationHistoryRef.current({
        background: true,
        ...(nextOptions ?? {})
      }).catch(() => {});
    };

    const scheduleRealtimeSync = (options?: SyncConversationOptions) => {
      mergeRealtimeSyncOptions(options);
      if (cancelled) {
        return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
        !isSyncingConversationHistoryRef.current &&
        realtimeSyncTimerId === null;
      if (canDispatchImmediately) {
        dispatchRealtimeSync();
        return;
      }

      if (realtimeSyncTimerId !== null) {
        return;
      }

      const nextDelay = Math.max(
        REALTIME_SYNC_DEBOUNCE_MS,
        REALTIME_SYNC_BURST_THROTTLE_MS - elapsedSinceLastDispatch
      );
      realtimeSyncTimerId = window.setTimeout(() => {
        realtimeSyncTimerId = null;
        if (!cancelled) {
          dispatchRealtimeSync();
        }
      }, nextDelay);
    };

    const clearPollFallback = () => {
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }

      if (wsReconnectIntervalId !== null) {
        window.clearInterval(wsReconnectIntervalId);
        wsReconnectIntervalId = null;
      }
    };

    const startReconnectFallback = () => {
      if (cancelled) {
        return;
      }

      setDirectRealtimeStatus('reconnecting');
      if (pollIntervalId === null) {
        pollIntervalId = window.setInterval(() => {
          scheduleRealtimeSync();
        }, REALTIME_SYNC_FALLBACK_INTERVAL_MS);
      }

      if (wsReconnectIntervalId === null) {
        wsReconnectIntervalId = window.setInterval(() => {
          if (wsReconnectInFlight || cancelled) {
            return;
          }

          wsReconnectInFlight = true;
          setupRealtimeSubscription()
            .catch(() => {})
            .finally(() => {
              wsReconnectInFlight = false;
            });
        }, WS_RETRY_COOLDOWN_MS);
      }
    };

    const handleRealtimeDisconnect = () => {
      if (cancelled) {
        return;
      }

      unsubscribe?.();
      unsubscribe = null;
      scheduleRealtimeSync();
      resetCotiWsProvider().catch(() => {});
      startReconnectFallback();
    };

    const setupRealtimeSubscription = async () => {
      try {
        if (cancelled) {
          return;
        }

        const cotiEthers = await loadCotiEthersModule();
        const wsProvider = await loadCotiWsProvider();
        if (Date.now() - getCotiWsLastHealthyAt() > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        markCotiWsHealthyNow();
        const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, wsProvider);

        const incomingFilter = contract.filters.MessageSubmitted(null, walletAddress, null);
        const outgoingFilter = contract.filters.MessageSubmitted(null, null, walletAddress);
        const nicknameFilter = contract.filters.NicknameSet();
        const resolveDirectRealtimeSyncOptions = (_messageId: unknown, recipient: unknown, from: unknown): SyncConversationOptions => {
          const activeContactKey = activeContactRef.current?.trim().toLowerCase() ?? '';
          const recipientKey = String(recipient ?? '').trim().toLowerCase();
          const fromKey = String(from ?? '').trim().toLowerCase();
          if (
            activeContactKey &&
            isWalletAddress(activeContactKey) &&
            (recipientKey === activeContactKey || fromKey === activeContactKey)
          ) {
            return { activeContactOnly: true };
          }

          return {
            contactsOnly: true,
            previewPerContact: true,
            updateHead: true
          };
        };
        const handleMessageSubmitted = (messageId: unknown, recipient: unknown, from: unknown) => {
          scheduleRealtimeSync(resolveDirectRealtimeSyncOptions(messageId, recipient, from));
        };
        const handleNicknameSet = (user: unknown, nickname: unknown) => {
          const userAddress = String(user ?? '').trim().toLowerCase();
          if (!isWalletAddress(userAddress)) {
            return;
          }

          const normalizedNickname = normalizeContactName(String(nickname ?? '').replace(/\r?\n/g, '')) ?? null;
          onChainNicknameCacheRef.current[userAddress] = normalizedNickname;
          if (normalizedNickname && userAddress === walletAddress.toLowerCase()) {
            setMyNickname(normalizedNickname);
          }

          setContacts((previous) =>
            previous.map((contact) =>
              contact.address.toLowerCase() === userAddress
                ? {
                    ...contact,
                    name: normalizedNickname ?? undefined
                  }
                : contact
            )
          );
        };

        contract.on(incomingFilter, handleMessageSubmitted);
        contract.on(outgoingFilter, handleMessageSubmitted);
        contract.on(nicknameFilter, handleNicknameSet);
        unsubscribeWsDisconnect?.();
        unsubscribeWsDisconnect = attachWsDisconnectListeners(wsProvider, handleRealtimeDisconnect);

        if (cancelled) {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          contract.off(incomingFilter, handleMessageSubmitted);
          contract.off(outgoingFilter, handleMessageSubmitted);
          contract.off(nicknameFilter, handleNicknameSet);
          return;
        }

        unsubscribe = () => {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          contract.off(incomingFilter, handleMessageSubmitted);
          contract.off(outgoingFilter, handleMessageSubmitted);
          contract.off(nicknameFilter, handleNicknameSet);
        };

        clearPollFallback();
        setDirectRealtimeStatus('connected');
      } catch {
        await resetCotiWsProvider();
        startReconnectFallback();
      }
    };

    const initialConversationSync = syncConversationHistoryRef.current({
      contactsOnly: true,
      previewPerContact: true,
      updateHead: true
    }).catch(() => {});
    const walletKey = walletAddress.trim().toLowerCase();
    initialConversationSync.finally(() => {
      if (
        cancelled ||
        !isWalletAddress(walletKey) ||
        conversationDeepBackfillDoneRef.current[walletKey]
      ) {
        return;
      }

      deepConversationSyncTimerId = window.setTimeout(() => {
        deepConversationSyncTimerId = null;
        if (cancelled || conversationDeepBackfillDoneRef.current[walletKey]) {
          return;
        }

        conversationDeepBackfillDoneRef.current[walletKey] = true;
        syncConversationHistoryRef.current({ background: true, deep: true }).catch(() => {
          delete conversationDeepBackfillDoneRef.current[walletKey];
        });
      }, BACKGROUND_DEEP_SYNC_DELAY_MS);
    });
    setupRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      setDirectRealtimeStatus('idle');
      clearPollFallback();
      if (deepConversationSyncTimerId !== null) {
        window.clearTimeout(deepConversationSyncTimerId);
      }
      if (realtimeSyncTimerId !== null) {
        window.clearTimeout(realtimeSyncTimerId);
      }
      unsubscribe?.();
    };
  }, [chainId, hasAesReady, isSyncingConversationHistoryRef, setDirectRealtimeStatus, walletAddress]);

  useEffect(() => {
    if (!walletAddress || chainId !== COTI_NETWORK.chainIdDecimal || !hasAesReady) {
      setGroupRealtimeStatus('idle');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeWsDisconnect: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let deepGroupSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;
    let pendingRealtimeSyncOptions: SyncGroupOptions | null = null;

    const mergeRealtimeSyncOptions = (options?: SyncGroupOptions): void => {
      pendingRealtimeSyncOptions = mergeGroupSyncOptions(
        { background: true, ...(options ?? {}) },
        pendingRealtimeSyncOptions
      );
    };

    const dispatchRealtimeSync = () => {
      if (cancelled) {
        return;
      }

      const nextOptions = pendingRealtimeSyncOptions;
      pendingRealtimeSyncOptions = null;
      lastRealtimeSyncDispatchAt = Date.now();
      syncGroupDataRef.current({
        background: true,
        ...(nextOptions ?? {})
      }).catch(() => {});
    };

    const scheduleRealtimeSync = (options?: SyncGroupOptions) => {
      mergeRealtimeSyncOptions(options);
      if (cancelled) {
        return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
        !syncGroupDataInFlightRef.current &&
        realtimeSyncTimerId === null;
      if (canDispatchImmediately) {
        dispatchRealtimeSync();
        return;
      }

      if (realtimeSyncTimerId !== null) {
        return;
      }

      const nextDelay = Math.max(
        REALTIME_SYNC_DEBOUNCE_MS,
        REALTIME_SYNC_BURST_THROTTLE_MS - elapsedSinceLastDispatch
      );
      realtimeSyncTimerId = window.setTimeout(() => {
        realtimeSyncTimerId = null;
        dispatchRealtimeSync();
      }, nextDelay);
    };

    const clearPollFallback = () => {
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }

      if (wsReconnectIntervalId !== null) {
        window.clearInterval(wsReconnectIntervalId);
        wsReconnectIntervalId = null;
      }
    };

    const startReconnectFallback = () => {
      if (cancelled) {
        return;
      }

      setGroupRealtimeStatus('reconnecting');
      if (pollIntervalId === null) {
        pollIntervalId = window.setInterval(() => {
          scheduleRealtimeSync();
        }, REALTIME_SYNC_FALLBACK_INTERVAL_MS);
      }

      if (wsReconnectIntervalId === null) {
        wsReconnectIntervalId = window.setInterval(() => {
          if (wsReconnectInFlight || cancelled) {
            return;
          }

          wsReconnectInFlight = true;
          setupGroupRealtimeSubscription()
            .catch(() => {})
            .finally(() => {
              wsReconnectInFlight = false;
            });
        }, WS_RETRY_COOLDOWN_MS);
      }
    };

    const handleRealtimeDisconnect = () => {
      if (cancelled) {
        return;
      }

      unsubscribe?.();
      unsubscribe = null;
      scheduleRealtimeSync();
      resetCotiWsProvider().catch(() => {});
      startReconnectFallback();
    };

    const setupGroupRealtimeSubscription = async () => {
      try {
        if (cancelled) {
          return;
        }

        const cotiEthers = await loadCotiEthersModule();
        const wsProvider = await loadCotiWsProvider();
        if (Date.now() - getCotiWsLastHealthyAt() > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        markCotiWsHealthyNow();

        const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, wsProvider);
        const handleOverviewEvent = () => scheduleRealtimeSync({ overviewOnly: true });
        const handleMessageEvent = (groupIdValue: unknown) => {
          scheduleRealtimeSync(resolveRealtimeGroupSyncOptions(groupIdValue, activeGroupIdRef.current));
        };

        const createdFilter = contract.filters.GroupCreated(null, walletAddress);
        const memberAddedFilter = contract.filters.GroupMemberAdded(null, walletAddress);
        const memberRemovedFilter = contract.filters.GroupMemberRemoved(null, walletAddress);
        const memberLeftFilter = contract.filters.GroupMemberLeft(null, walletAddress);
        const inviteCreatedFilter = contract.filters.GroupInviteCreated(null, walletAddress, null);
        const inviteAcceptedFilter = contract.filters.GroupInviteAccepted(null, walletAddress, null);
        const inviteDeclinedFilter = contract.filters.GroupInviteDeclined(null, walletAddress, null);
        const inviteRevokedFilter = contract.filters.GroupInviteRevoked(null, walletAddress, null);
        const joinedWithCodeFilter = contract.filters.GroupJoinedWithCode(null, walletAddress, null);
        const joinCodeCreatedFilter = contract.filters.GroupJoinCodeCreated(null, null, walletAddress);
        const joinCodeRevokedFilter = contract.filters.GroupJoinCodeRevoked(null, null, walletAddress);
        const submittedFilter = contract.filters.GroupMessageSubmitted(null, walletAddress);
        const deliveredFilter = contract.filters.GroupMessageDelivered(null, null, walletAddress);

        contract.on(createdFilter, handleOverviewEvent);
        contract.on(memberAddedFilter, handleOverviewEvent);
        contract.on(memberRemovedFilter, handleOverviewEvent);
        contract.on(memberLeftFilter, handleOverviewEvent);
        contract.on(inviteCreatedFilter, handleOverviewEvent);
        contract.on(inviteAcceptedFilter, handleOverviewEvent);
        contract.on(inviteDeclinedFilter, handleOverviewEvent);
        contract.on(inviteRevokedFilter, handleOverviewEvent);
        contract.on(joinedWithCodeFilter, handleOverviewEvent);
        contract.on(joinCodeCreatedFilter, handleOverviewEvent);
        contract.on(joinCodeRevokedFilter, handleOverviewEvent);
        contract.on(submittedFilter, handleMessageEvent);
        contract.on(deliveredFilter, handleMessageEvent);
        unsubscribeWsDisconnect?.();
        unsubscribeWsDisconnect = attachWsDisconnectListeners(wsProvider, handleRealtimeDisconnect);

        if (cancelled) {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          contract.off(createdFilter, handleOverviewEvent);
          contract.off(memberAddedFilter, handleOverviewEvent);
          contract.off(memberRemovedFilter, handleOverviewEvent);
          contract.off(memberLeftFilter, handleOverviewEvent);
          contract.off(inviteCreatedFilter, handleOverviewEvent);
          contract.off(inviteAcceptedFilter, handleOverviewEvent);
          contract.off(inviteDeclinedFilter, handleOverviewEvent);
          contract.off(inviteRevokedFilter, handleOverviewEvent);
          contract.off(joinedWithCodeFilter, handleOverviewEvent);
          contract.off(joinCodeCreatedFilter, handleOverviewEvent);
          contract.off(joinCodeRevokedFilter, handleOverviewEvent);
          contract.off(submittedFilter, handleMessageEvent);
          contract.off(deliveredFilter, handleMessageEvent);
          return;
        }

        unsubscribe = () => {
          unsubscribeWsDisconnect?.();
          unsubscribeWsDisconnect = null;
          contract.off(createdFilter, handleOverviewEvent);
          contract.off(memberAddedFilter, handleOverviewEvent);
          contract.off(memberRemovedFilter, handleOverviewEvent);
          contract.off(memberLeftFilter, handleOverviewEvent);
          contract.off(inviteCreatedFilter, handleOverviewEvent);
          contract.off(inviteAcceptedFilter, handleOverviewEvent);
          contract.off(inviteDeclinedFilter, handleOverviewEvent);
          contract.off(inviteRevokedFilter, handleOverviewEvent);
          contract.off(joinedWithCodeFilter, handleOverviewEvent);
          contract.off(joinCodeCreatedFilter, handleOverviewEvent);
          contract.off(joinCodeRevokedFilter, handleOverviewEvent);
          contract.off(submittedFilter, handleMessageEvent);
          contract.off(deliveredFilter, handleMessageEvent);
        };
        clearPollFallback();
        setGroupRealtimeStatus('connected');
      } catch {
        await resetCotiWsProvider();
        startReconnectFallback();
      }
    };

    const initialGroupSync = syncGroupDataRef.current({ background: true, overviewOnly: true }).catch(() => {});
    initialGroupSync.finally(() => {
      if (cancelled || groupsRef.current.length > 0 || groupInvitesRef.current.length > 0) {
        return;
      }

      deepGroupSyncTimerId = window.setTimeout(() => {
        deepGroupSyncTimerId = null;
        if (cancelled) {
          return;
        }

        syncGroupDataRef.current({ background: true, deep: true, overviewOnly: true }).catch(() => {});
      }, BACKGROUND_DEEP_SYNC_DELAY_MS);
    });
    setupGroupRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      setGroupRealtimeStatus('idle');
      clearPollFallback();
      if (deepGroupSyncTimerId !== null) {
        window.clearTimeout(deepGroupSyncTimerId);
      }
      if (realtimeSyncTimerId !== null) {
        window.clearTimeout(realtimeSyncTimerId);
      }
      unsubscribe?.();
    };
  }, [walletAddress, chainId, hasAesReady]);

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
  }, [activeGroupId, walletAddress, hasAesReady, chainId]);

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
        onSendTradeOffer={() => {
          createTradeOffer().catch(() => {});
        }}
        generalError={tradeComposerFieldErrors.general}
        validationMessage={tradeComposerValidationMessage || undefined}
      />
    </Suspense>
  ) : null;
  const {
    chatPreferredBrowserWalletOption,
    chatWalletHeaderControl,
    chatWarmAppWallet
  } = useChatWalletHeaderControl({
    activeSignerSource,
    appWallet: burnerWalletRef.current,
    activateBrowserWalletSession,
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
    isConnected,
    isMobileLayout: isMobileNav,
    lastCopiedKey,
    loadingTopUpQuote,
    onCotiNetwork,
    openChangeBurnerPin,
    preferredBrowserWalletId,
    preferredInjectedWalletOption,
    setChatAppWalletMenuOpen,
    setChatWalletMenuOpen,
    setError,
    setShowBurnerImportModal,
    setShowTopUpModal,
    topUpAmountLabel,
    topUpAmountWei,
    walletAesHealth: walletAesHealthByAddress[walletAddress.trim().toLowerCase()] ?? null,
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
        activateBrowserWalletSession(walletId, {
          forceAccountPicker: options.forceAccountPicker,
          forceFreshPrivacy: options.forceFreshPrivacy,
          preparePrivacy: options.preparePrivacy
        }),
      disconnect: disconnectWallet,
      generateAppWallet: () => beginBurnerPinFlow('generate'),
      importAppWallet: () => {
        setShowBurnerImportModal(true);
      },
      runWalletTransactionFlow: runSharedWalletTransactionFlow,
      switchAppWallet: (walletIdOrAddress: string) => Promise.resolve(handleSwitchActiveBurnerWallet(walletIdOrAddress)),
      unlockPrivacy: (options = {}) => {
        if (activeSignerSource === 'metamask') {
          return activateBrowserWalletSession(currentInjectedWalletOption?.id ?? preferredBrowserWalletId, {
            forceFreshPrivacy: options.forceFreshPrivacy,
            preparePrivacy: true
          });
        }
        return beginBurnerPinFlow('stored');
      }
    }),
    [
      activateBrowserWalletSession,
      activeSignerSource,
      beginBurnerPinFlow,
      currentInjectedWalletOption?.id,
      disconnectWallet,
      handleSwitchActiveBurnerWallet,
      preferredBrowserWalletId,
      runSharedWalletTransactionFlow,
      setShowBurnerImportModal
    ]
  );
  const sharedTradeWalletSession = useMemo<SharedWalletSession>(
    () => ({
      actions: sharedWalletActions,
      activeSignerSource,
      browserProvider: activeProvider ?? browserWalletSession?.provider ?? null,
      browserWalletId: currentInjectedWalletOption?.id ?? browserWalletSession?.walletId ?? preferredBrowserWalletId,
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
      walletAddress
    }),
    [
      activeProvider,
      activeSignerSource,
      browserWalletSession?.provider,
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
      walletAddress
    ]
  );
  // --- Stable callbacks for ContactsSidebar ---
  const saveMyNicknameOnChainRef = useRef(saveMyNicknameOnChain);
  saveMyNicknameOnChainRef.current = saveMyNicknameOnChain;
  const handleSaveNickname = useCallback(() => { saveMyNicknameOnChainRef.current().catch(() => {}); }, []);

  const forceSyncAllDataRef = useRef(forceSyncAllData);
  forceSyncAllDataRef.current = forceSyncAllData;
  const handleForceSync = useCallback(() => { forceSyncAllDataRef.current().catch(() => {}); }, []);

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
  const handleAcceptGroupInvite = useCallback((groupId: number) => { acceptGroupInviteRef.current(groupId).catch(() => {}); }, []);

  const declineGroupInviteRef = useRef(declineGroupInvite);
  declineGroupInviteRef.current = declineGroupInvite;
  const handleDeclineGroupInvite = useCallback((groupId: number) => { declineGroupInviteRef.current(groupId).catch(() => {}); }, []);

  // --- Stable callbacks for DirectChatPanel ---
  const handleCancelReply = useCallback(() => setReplyingToMessage(null), [setReplyingToMessage]);

  const handleToggleTipComposer = useCallback(() => {
    setTradeComposerOpen(false);
    setTipComposerOpen((previous) => !previous);
  }, [setTipComposerOpen, setTradeComposerOpen]);

  const handleTipAmountInputChange = useCallback(
    (value: string) => setTipAmountInput(sanitizeTokenAmountInput(value)),
    [setTipAmountInput]
  );

  const handleToggleTradeComposer = useCallback(() => {
    setTipComposerOpen(false);
    setTradeComposerOpen((previous) => {
      const nextOpen = !previous;
      if (nextOpen && tradeCounterParentId === null) {
        setTradeCounterContext(null);
        setTradeOfferAmountInput('');
        setTradeRequestAmountInput('');
        setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      }
      if (!nextOpen) {
        setTradeCounterParentId(null);
        setTradeCounterContext(null);
      }
      return nextOpen;
    });
  }, [
    setTipComposerOpen,
    setTradeComposerOpen,
    setTradeCounterContext,
    setTradeCounterParentId,
    setTradeExpiryHoursInput,
    setTradeOfferAmountInput,
    setTradeRequestAmountInput,
    tradeCounterParentId
  ]);

  const sendDirectImageMessageRef = useRef(sendDirectImageMessage);
  sendDirectImageMessageRef.current = sendDirectImageMessage;
  const handleSendImage = useCallback((file: File) => { sendDirectImageMessageRef.current(file).catch(() => {}); }, []);

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const handleSendMessage = useCallback(() => { sendMessageRef.current().catch(() => {}); }, []);

  const handleToggleReactionPicker = useCallback((messageId: string) => {
    if (browserWalletLiteMode) return;
    setReactionPickerMessageId((previous) => (previous === messageId ? null : messageId));
  }, [browserWalletLiteMode, setReactionPickerMessageId]);

  const handleReplyToMessage = useCallback((message: ChatMessage) => {
    if (browserWalletLiteMode) {
      setError('Use the app wallet to send replies.');
      return;
    }
    setReplyingToMessage(message);
  }, [browserWalletLiteMode, setReplyingToMessage]);

  const tipSendStateRef = useRef({ tipTokenSelection, tipAmountWeiFromInput });
  tipSendStateRef.current = { tipTokenSelection, tipAmountWeiFromInput };
  const sendTipToActiveContactRef = useRef(sendTipToActiveContact);
  sendTipToActiveContactRef.current = sendTipToActiveContact;
  const handleSendTip = useCallback(() => {
    const { tipTokenSelection: token, tipAmountWeiFromInput: amount } = tipSendStateRef.current;
    sendTipToActiveContactRef.current(token, amount).catch(() => {});
  }, []);

  const activePageWalletPolicy = getAppWalletPolicy(activePage);
  const activeChatWalletControl =
    activePageWalletPolicy.walletControlKind === 'chat' ? chatWalletHeaderControl : null;
  const activeTradeWalletControl =
    activePageWalletPolicy.walletControlKind === 'trades' ? tradeHeaderWalletControl : null;

  const headerHomeAction =
    activePage !== 'home' ? (
      <button
        type="button"
        className="header-icon-btn"
        onClick={() => navigateToPage('home')}
        aria-label="Back to home"
        title="Back to home"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          focusable="false"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="currentColor"
            d="M12 3.2 3.5 10v10.3h6.2v-5.8h4.6v5.8h6.2V10L12 3.2Zm0 2.6 6 4.8v7.7h-1.7v-5.8H7.7v5.8H6V10.6l6-4.8Z"
          />
        </svg>
      </button>
    ) : null;
  const appHeaderNavigationControl = useMemo(() => {
    const appNavItems: Array<{ page: AppPage; label: string; onPrefetch?: () => void }> = [
      { page: 'chat', label: 'Chat', onPrefetch: preloadChatPage },
      { page: 'trades', label: 'Trades', onPrefetch: preloadTradesPage },
      { page: 'swap', label: 'Shield', onPrefetch: preloadSwapPage },
      { page: 'treasury', label: 'Treasury', onPrefetch: preloadTreasuryPage }
    ];

    return (
      <nav className="app-header-nav" aria-label="ChainWhisper apps">
        {appNavItems.map((item) => (
          <button
            key={item.page}
            type="button"
            className={activePage === item.page ? 'active' : undefined}
            aria-current={activePage === item.page ? 'page' : undefined}
            onClick={() => navigateToPage(item.page)}
            onFocus={item.onPrefetch}
            onMouseEnter={item.onPrefetch}
          >
            {item.label}
          </button>
        ))}
      </nav>
    );
  }, [activePage, navigateToPage]);
  const chatRealtimeReconnecting =
    activePage === 'chat' &&
    (directRealtimeStatus === 'reconnecting' || groupRealtimeStatus === 'reconnecting');
  const realtimeConnectionIndicator = chatRealtimeReconnecting ? (
    <span className="realtime-status-pill" role="status" aria-live="polite">
      <span className="realtime-status-dot" aria-hidden="true" />
      Reconnecting...
    </span>
  ) : null;
  const chatBrandActions =
    realtimeConnectionIndicator || headerHomeAction ? (
      <>
        {realtimeConnectionIndicator}
        {headerHomeAction}
      </>
    ) : null;
  const walletSessionModals = (
    <>
      {showBurnerImportModal ? (
        <Suspense fallback={null}>
          <BurnerImportModal
            isOpen={showBurnerImportModal}
            initializingBurner={initializingBurner}
            burnerImportInput={burnerImportInput}
            onBurnerImportInputChange={setBurnerImportInput}
            error={error}
            onClose={() => setShowBurnerImportModal(false)}
            onImport={importBurnerWallet}
          />
        </Suspense>
      ) : null}

      {showBurnerPinModal ? (
        <Suspense fallback={null}>
          <BurnerPinModal
            isOpen={showBurnerPinModal}
            burnerPinMode={burnerPinMode}
            burnerPinInput={burnerPinInput}
            onBurnerPinInputChange={setBurnerPinInput}
            pinMinLength={BURNER_PIN_MIN_LENGTH}
            error={error}
            initializingBurner={initializingBurner}
            onClose={closeBurnerPinModal}
            onSubmit={submitBurnerPinAndInitialize}
          />
        </Suspense>
      ) : null}

      {showBurnerMnemonic && burnerMnemonicBackup ? (
        <Suspense fallback={null}>
          <BurnerBackupModal isOpen={showBurnerMnemonic} mnemonic={burnerMnemonicBackup} onClose={closeBurnerBackup} />
        </Suspense>
      ) : null}

      {showTopUpModal ? (
        <Suspense fallback={null}>
          <TopUpModal
            isOpen={showTopUpModal}
            initializingBurner={initializingBurner}
            loadingTopUpQuote={loadingTopUpQuote}
            burnerAddress={burnerAddress}
            topUpAmountWei={topUpAmountWei}
            topUpMessageTarget={topUpMessageTarget}
            onTopUpMessageTargetChange={setTopUpMessageTarget}
            burnerBalanceWei={burnerBalanceWei}
            estimatedMessagesLeft={estimatedMessagesLeft}
            topUpAmountLabel={topUpAmountLabel}
            onTopUpBurnerWithWallet={topUpBurnerWithWallet}
            onClose={() => setShowTopUpModal(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
  const chatWorkspace = (
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
          <AppErrorBoundary fallback={<div className="chat-placeholder">Something went wrong. <button type="button" onClick={() => window.location.reload()}>Reload</button></div>}>
          <Suspense fallback={<div className="chat-placeholder">Loading conversation...</div>}>
            {!isConnected ? (
              <div className="chat-placeholder chat-placeholder-state" role="status" aria-live="polite">
                <strong>Wallet needed</strong>
                <p>Use the header wallet control to connect or unlock your app wallet.</p>
              </div>
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
                    setError('Use the app wallet to send replies.');
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
                walletAddress={walletAddress}
                processingTradeActionId={processingTradeActionId}
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
                maxMessageLength={MAX_MESSAGE_LENGTH}
                onMessageInputChange={handleMessageInputChange}
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
            quickActionTab={quickActionTab}
            onSelectTab={setQuickActionTab}
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
      <div className="app-shell app-shell-landing">
        <AppHeader
          headerRef={topHeaderRef}
          mobileLinksOpen={mobileLinksOpen}
          isMobileNav={isMobileNav}
          soundEnabled={soundEnabled}
          onToggleMobileLinksOpen={() => setMobileLinksOpen((previous) => !previous)}
          onToggleSound={handleToggleSound}
          onCloseMobileLinks={() => setMobileLinksOpen(false)}
          links={COTI_ECOSYSTEM_LINKS}
          appNavigationControl={appHeaderNavigationControl}
        />
        <HomePage
          onLaunchChat={() => navigateToPage('chat')}
          onOpenSwap={() => navigateToPage('swap')}
          onOpenTreasury={() => navigateToPage('treasury')}
          onPrefetchChat={preloadChatPage}
          onPrefetchSwap={preloadSwapPage}
          onPrefetchTrades={preloadTradesPage}
          onPrefetchTreasury={preloadTreasuryPage}
          onOpenTrades={() => navigateToPage('trades')}
          isConnected={isConnected}
        />
      </div>
    );
  }

  if (activePage === 'trades') {
    return (
      <div className="app-shell app-shell-trades">
        <AppHeader
          headerRef={topHeaderRef}
          mobileLinksOpen={mobileLinksOpen}
          isMobileNav={isMobileNav}
          soundEnabled={soundEnabled}
          onToggleMobileLinksOpen={() => setMobileLinksOpen((previous) => !previous)}
          onToggleSound={handleToggleSound}
          onCloseMobileLinks={() => setMobileLinksOpen(false)}
          brandActions={headerHomeAction}
          appNavigationControl={appHeaderNavigationControl}
          walletControl={activeTradeWalletControl}
          subtitle="P2P Trades"
          showSoundToggle
        />
        <AppErrorBoundary>
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="standalone-trades-shell" label="Loading trades" />
            }
          >
            <P2PTradingPage
              isMobileNav={isMobileNav}
              sharedWalletSession={sharedTradeWalletSession}
              onDisconnectWallet={disconnectWallet}
              onHeaderWalletControlChange={setTradeHeaderWalletControl}
            />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  if (activePage === 'swap') {
    return (
      <div className="app-shell app-shell-swap">
        <AppHeader
          headerRef={topHeaderRef}
          mobileLinksOpen={mobileLinksOpen}
          isMobileNav={isMobileNav}
          soundEnabled={soundEnabled}
          onToggleMobileLinksOpen={() => setMobileLinksOpen((previous) => !previous)}
          onToggleSound={handleToggleSound}
          onCloseMobileLinks={() => setMobileLinksOpen(false)}
          brandActions={headerHomeAction}
          appNavigationControl={appHeaderNavigationControl}
          walletControl={activeChatWalletControl}
          subtitle="Shield"
          showSoundToggle
        />
        {walletSessionModals}
        <AppErrorBoundary>
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="swap-page-shell" label="Loading Shield" />
            }
          >
            <TokenSwapPage
              tokenToolsSummary={tokenToolsSummary}
              shieldVaultTokenBalanceWei={shieldVaultTokenBalanceWei}
              rewardTokenDecimals={rewardTokenDecimals}
              rewardTokenSymbol={rewardTokenSymbol}
              privateRewardTokenSymbol={swapPrivateRewardTokenSymbol}
              swapAmountInput={swapAmountInput}
              onSwapAmountInputChange={(value) => setSwapAmountInput(sanitizeTokenAmountInput(value))}
              swappingTokens={swappingTokens}
              swapInputSymbol={swapInputSymbol}
              swapDirection={swapDirection}
              onSwapDirectionChange={setSwapDirection}
              swapFeeModeSelection={swapFeeModeSelection}
              onSwapFeeModeChange={setSwapFeeModeSelection}
              loadingRewardBalances={loadingRewardBalances}
              swapFeeWei={swapFeeWei}
              swapTokenFeeAmount={swapTokenFeeAmount}
              walletAddress={walletAddress}
              onCotiNetwork={onCotiNetwork}
              hasAesReady={hasAesReady}
              canShieldTokens={canShieldTokens}
              canUnshieldTokens={canUnshieldTokens}
              currentSwapDirectionEnabled={currentSwapDirectionEnabled}
              onRefreshRewardBalances={() => setTopUpMetricsNonce((previous) => previous + 1)}
              canSwapRewardTokens={canSwapRewardTokens}
              swapButtonLabel={swapButtonLabel}
              onSwapRewardTokens={swapRewardTokens}
              swapStatusMessage={swapStatusMessage}
              error={error}
            />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  if (activePage === 'treasury') {
    return (
      <div className="app-shell app-shell-landing">
        <AppHeader
          headerRef={topHeaderRef}
          mobileLinksOpen={mobileLinksOpen}
          isMobileNav={isMobileNav}
          soundEnabled={soundEnabled}
          onToggleMobileLinksOpen={() => setMobileLinksOpen((previous) => !previous)}
          onToggleSound={handleToggleSound}
          onCloseMobileLinks={() => setMobileLinksOpen(false)}
          brandActions={headerHomeAction}
          appNavigationControl={appHeaderNavigationControl}
          subtitle="Treasury"
          showSoundToggle
        />
        <AppErrorBoundary>
          <Suspense
            fallback={
              <RouteLoadingFallback shellClassName="treasury-shell" label="Loading Treasury Data" variant="treasury" />
            }
          >
            <TreasuryPage isCompactLayout={isMobileNav} />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  return (
    <div className={`app-shell mobile-view-${activeMobileView}`}>
      <AppHeader
        headerRef={topHeaderRef}
        mobileLinksOpen={mobileLinksOpen}
        isMobileNav={isMobileNav}
        soundEnabled={soundEnabled}
        onToggleMobileLinksOpen={() => setMobileLinksOpen((previous) => !previous)}
        onToggleSound={handleToggleSound}
        onCloseMobileLinks={() => setMobileLinksOpen(false)}
        debugControl={debugControl}
        brandActions={chatBrandActions}
        appNavigationControl={appHeaderNavigationControl}
        walletControl={activeChatWalletControl}
        subtitle="Chat"
        showSoundToggle
      />
      {walletSessionModals}
      {chatWorkspace}
    </div>
  );
}
