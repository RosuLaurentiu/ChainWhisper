import { FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from './components/AppHeader';
import ContactsSidebar from './components/ContactsSidebar';
import GroupActionControls from './components/GroupActionControls';
import { ActiveJoinCodeList, GroupInviteMenu } from './components/GroupInviteTools';
import MobileBottomNav from './components/MobileBottomNav';
import WalletSidebar from './components/WalletSidebar';
import { useBurnerWallet } from './hooks/useBurnerWallet';
import { useStateBackupSync } from './hooks/useStateBackupSync';
import { useWalletOnboarding } from './hooks/useWalletOnboarding';
import {
  buildMessageReferenceKey,
  buildMessageReferenceKeys,
  buildTradeCustomTokenInfoKey,
  DEFAULT_TRADE_EXPIRY_HOURS,
  getOnChainFailureMessage,
  isCustomTradeTokenSelection,
  messageReferencesMatch,
  type PendingTradeCounterContext,
  parseSharedTxReference,
  resolveTradePresetKind,
  sanitizeOutgoingMessagePlainText,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from './lib/appHelpers';
import {
  fetchTradeSnapshotById,
  readPrivateTokenBalanceWei
} from './lib/appChain';
import { submitGroupMemo } from './lib/groupChatChain';
import {
  acceptTradeOnChain,
  cancelTradeOnChain,
  closeCounterTradeOnChain,
  createTradeOnChain,
  declineTradeOnChain
} from './lib/tradeActions';
import {
  createGroupJoinCode,
  fetchActiveJoinCodesForAdmin,
  hasActiveLegacyGroupInvite,
  joinWithGroupCode,
  revokeGroupJoinCode
} from './lib/groupJoinCodes';
import {
  submitDirectMemo,
  submitHiddenContactNameMemo,
  submitHiddenConversationStateMemo
} from './lib/directChatChain';
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
} from './lib/groupActions';
import {
  fetchOnChainNicknames as fetchOnChainNicknamesLookup,
  getNicknameMaxLength as getNicknameMaxLengthLookup,
  loadMyNicknameFromChain as loadMyNicknameFromChainLookup,
  resolveConversationBlockRange as resolveConversationBlockRangeLookup,
  resolveRecentPeersWithMeta as resolveRecentPeersWithMetaLookup,
  saveMyNicknameOnChain as saveMyNicknameOnChainLookup
} from './lib/appLookup';
import {
  getStoredGroupRemovalNoticeMarker as getStoredGroupRemovalNoticeMarkerStorage,
  setStoredGroupRemovalNoticeMarker as setStoredGroupRemovalNoticeMarkerStorage
} from './lib/appStorage';
import { deriveTradeComposerModel } from './lib/tradeComposer';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  ActiveGroupJoinCode,
  applyConversationPreferenceStateToContact,
  AUTO_STATE_BACKUP_BLOCK_DISTANCE,
  AUTO_STATE_BACKUP_RETRY_BLOCKS,
  AUTO_SYNC_INTERVAL_MS,
  buildMessageWithReactionPayload,
  buildMessageWithReplyPayload,
  buildTradeOfferMessagePayload,
  buildTradeResponseMessagePayload,
  BURNER_PIN_MIN_LENGTH,
  BurnerWalletRecord,
  calculateTopUpAmount,
  CHAT_CONTRACT_ABI,
  CHAT_CONTRACT_ADDRESS,
  ChatMessage,
  Contact,
  ConversationBlockRange,
  ConversationLog,
  ConversationPreferenceState,
  COPY_FEEDBACK_DURATION_MS,
  COTI_NETWORK,
  createCotiBrowserProvider,
  debugLog,
  decodeMemoPlaintext,
  encodeCompactMemoPlaintext,
  DEFAULT_GROUP_JOIN_CODE_MULTI_USES,
  DEFAULT_NICKNAME_MAX_BYTES,
  encodeMemoPlaintext,
  ERC20_TOKEN_ABI,
  extractUserCiphertext,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  FAST_CONTACT_PREVIEW_BATCH_SIZE,
  FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK,
  formatCotiAmount,
  formatGroupMembershipEventText,
  formatTokenAmount,
  getCotiWsLastHealthyAt,
  getGroupActionErrorMessage,
  getGroupCreateErrorMessage,
  getGroupJoinErrorMessage,
  getMessageDisplayText,
  getProviderErrorMessage,
  GROUP_ADMIN_BURN_ADDRESS,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_REMOVAL_NOTICE_AUTO_DISMISS_MS,
  GroupFeeModeSelection,
  GroupInvite,
  GroupMessageEntry,
  GroupSummary,
  hasInsufficientFundsError,
  HISTORY_PAGINATION_BLOCK_WINDOW,
  HistoryEntry,
  IMAGE_MESSAGE_PREFIX,
  INITIAL_SYNC_LOOKBACK_BLOCKS,
  isProviderActionRejected,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  loadCotiWsProvider,
  MAX_MESSAGE_LENGTH,
  mergeOnboardInfo,
  markCotiWsHealthyNow,
  mergeUniqueContacts,
  MobileView,
  normalizeContactName,
  normalizeConversationPreferenceState,
  normalizeLastReadAllTs,
  normalizeMessagesByContact,
  normalizeReactionEmoji,
  normalizeTokenDecimals,
  parseChatMessagePayload,
  parseGroupInviteCode,
  parseGroupJoinCodeFromPayload,
  parseReadCursorText,
  parseTradeOfferMessagePayload,
  parseStateBackupText,
  parseStoredGroupTitle,
  parseSubmitMemoPayload,
  parseTokenAmountInput,
  parseWalletAddressListInput,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
  PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  RecentPeerMeta,
  resetCotiWsProvider,
  REWARD_TOKEN_ADDRESS,
  sanitizeTokenAmountInput,
  shortenAddress,
  sortMessagesChronologically,
  StateBackupPayload,
  SWAP_VAULT_CONTRACT_ABI,
  SWAP_VAULT_CONTRACT_ADDRESS,
  SwapDirection,
  SwapFeeModeSelection,
  SyncConversationOptions,
  SyncGroupOptions,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TipTokenSelection,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  TradeAssetPayload,
  TradeFeeModeSelection,
  TradeOfferMessagePayload,
  TradeSnapshot,
  toSafeNumber,
  trimReplyPreview,
  WHISPER_REWARDS_ABI,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS,
} from './lib/appShared';

const BurnerImportModal = lazy(() => import('./components/BurnerImportModal'));
const BurnerPinModal = lazy(() => import('./components/BurnerPinModal'));
const DirectChatPanel = lazy(() => import('./components/DirectChatPanel'));
const GroupChatPanel = lazy(() => import('./components/GroupChatPanel'));
const QuickActionsModal = lazy(() => import('./components/QuickActionsModal'));
const TradeComposerPanel = lazy(() => import('./components/TradeComposerPanel'));

const INITIAL_VISIBLE_THREAD_MESSAGE_COUNT = 160;
const VISIBLE_THREAD_MESSAGE_CHUNK = 120;
const BACKGROUND_DEEP_SYNC_DELAY_MS = 500;

export default function App() {
  const MOBILE_NAV_BREAKPOINT_PX = 920;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversationStateSyncPendingByContact, setConversationStateSyncPendingByContact] = useState<
    Record<string, boolean>
  >({});
  const [newContact, setNewContact] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [activeContact, setActiveContact] = useState<string | null>(null);
  const [showHiddenContacts, setShowHiddenContacts] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [editingContactAddress, setEditingContactAddress] = useState<string | null>(null);
  const [editingContactName, setEditingContactName] = useState('');
  const [showQuickActionsModal, setShowQuickActionsModal] = useState(false);
  const [quickActionTab, setQuickActionTab] = useState<'contact' | 'create-group' | 'join-group'>('contact');
  const [myNickname, setMyNickname] = useState('');
  const [nicknameMaxBytes, setNicknameMaxBytes] = useState(DEFAULT_NICKNAME_MAX_BYTES);
  const [messageInput, setMessageInput] = useState('');
  const [messagesByContact, setMessagesByContact] = useState<Record<string, ChatMessage[]>>({});
  const [messagesByGroup, setMessagesByGroup] = useState<Record<string, ChatMessage[]>>({});
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupIsPrivate, setNewGroupIsPrivate] = useState(false);
  const [newGroupMembersInput, setNewGroupMembersInput] = useState('');
  const [groupInviteMembersInput, setGroupInviteMembersInput] = useState('');
  const [groupInviteTtlInput, setGroupInviteTtlInput] = useState('8');
  const [groupJoinCodeMode, setGroupJoinCodeMode] = useState<'single' | 'multi'>('single');
  const [groupJoinCodeMaxUsesInput, setGroupJoinCodeMaxUsesInput] = useState(
    String(DEFAULT_GROUP_JOIN_CODE_MULTI_USES)
  );
  const [generatedGroupInviteCode, setGeneratedGroupInviteCode] = useState('');
  const [generatedGroupJoinCodeHash, setGeneratedGroupJoinCodeHash] = useState('');
  const [activeGroupJoinCodes, setActiveGroupJoinCodes] = useState<ActiveGroupJoinCode[]>([]);
  const [loadingActiveGroupJoinCodes, setLoadingActiveGroupJoinCodes] = useState(false);
  const [revokingGroupJoinCodeHash, setRevokingGroupJoinCodeHash] = useState('');
  const [groupInviteMenuView, setGroupInviteMenuView] = useState<'invite' | 'code'>('invite');
  const [groupJoinCodeInput, setGroupJoinCodeInput] = useState('');
  const [groupRenameOpen, setGroupRenameOpen] = useState(false);
  const [groupRenameInput, setGroupRenameInput] = useState('');
  const [persistedContactOrder, setPersistedContactOrder] = useState<string[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, boolean>>({});
  const [unreadGroupMap, setUnreadGroupMap] = useState<Record<string, boolean>>({});
  const [lastCopiedKey, setLastCopiedKey] = useState<string | null>(null);
  const [lastReadAllTs, setLastReadAllTs] = useState(0);
  const lastReadAllTsRef = useRef(0);
  const lastReadByContactRef = useRef<Record<string, number>>({});
  const lastReadByGroupRef = useRef<Record<string, number>>({});
  const unreadMapRef = useRef<Record<string, boolean>>({});
  const unreadGroupMapRef = useRef<Record<string, boolean>>({});
  const SOUND_ENABLED_STORAGE_KEY = 'coti-chat-sound-enabled';
  const GROUP_REMOVAL_NOTICE_MARKERS_STORAGE_KEY = 'coti-chat-group-removal-notice-markers-v1';
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(SOUND_ENABLED_STORAGE_KEY) : null;
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const NOTIF_SOUND_URL: string | null = (() => {
    try {
      return new URL('./lib/mixkit-long-pop-2358.wav', import.meta.url).href;
    } catch {
      return null;
    }
  })();
  const audioUrlRef = useRef<string | null>(NOTIF_SOUND_URL);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const initPersistentAudio = () => {
    try {
      if (audioElRef.current) return;
      const uri = audioUrlRef.current ?? NOTIF_SOUND_URL ?? null;
      if (!uri) return;
      audioUrlRef.current = uri;
      const a = new Audio(uri);
      a.preload = 'auto';
      a.volume = 1;
      a.loop = false;
      audioElRef.current = a;
      void a.play().catch(() => {});
    } catch {}
  };

  const suppressSoundOnConnectRef = useRef<boolean>(false);
  const suppressSoundReleaseTimerRef = useRef<number | null>(null);
  const connectSoundSuppressionTokenRef = useRef(0);

  const playNotificationSound = () => {
    if (!soundEnabled) return;
    try {
      initPersistentAudio();
      const a = audioElRef.current;
      if (!a) return;
      try {
        a.currentTime = 0;
      } catch {}
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // retry once after a short delay
          try {
            setTimeout(() => {
              try {
                if (audioElRef.current) audioElRef.current.play().catch(() => {});
              } catch {}
            }, 200);
          } catch {}
        });
      }
    } catch {}
  };
  const beginConnectSoundSuppression = (fallbackMs = 9000): number => {
    const nextToken = connectSoundSuppressionTokenRef.current + 1;
    connectSoundSuppressionTokenRef.current = nextToken;
    suppressSoundOnConnectRef.current = true;
    if (suppressSoundReleaseTimerRef.current !== null) {
      window.clearTimeout(suppressSoundReleaseTimerRef.current);
    }
    suppressSoundReleaseTimerRef.current = window.setTimeout(() => {
      if (connectSoundSuppressionTokenRef.current === nextToken) {
        suppressSoundOnConnectRef.current = false;
      }
      suppressSoundReleaseTimerRef.current = null;
    }, fallbackMs);
    return nextToken;
  };
  const endConnectSoundSuppression = (token?: number) => {
    if (typeof token === 'number' && token !== connectSoundSuppressionTokenRef.current) {
      return;
    }
    suppressSoundOnConnectRef.current = false;
    if (suppressSoundReleaseTimerRef.current !== null) {
      window.clearTimeout(suppressSoundReleaseTimerRef.current);
      suppressSoundReleaseTimerRef.current = null;
    }
  };
  const [sending, setSending] = useState(false);
  const [sendingReaction, setSendingReaction] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [topUpAmountWei, setTopUpAmountWei] = useState<bigint | null>(null);
  const [requiredFeeWei, setRequiredFeeWei] = useState<bigint | null>(null);
  const [tipNativeBalanceWei, setTipNativeBalanceWei] = useState<bigint | null>(null);
  const [groupRequiredFeeWei, setGroupRequiredFeeWei] = useState<bigint | null>(null);
  const [groupTokenFeeWei, setGroupTokenFeeWei] = useState<bigint | null>(null);
  const [groupRewardsContractAddress, setGroupRewardsContractAddress] = useState('');
  const [groupRewardsPaused, setGroupRewardsPaused] = useState<boolean | null>(null);
  const [rewardsContractPaused, setRewardsContractPaused] = useState<boolean | null>(null);
  const [rewardsCallerAllowed, setRewardsCallerAllowed] = useState<boolean | null>(null);
  const [rewardsPublicPerInteractionWei, setRewardsPublicPerInteractionWei] = useState<bigint | null>(null);
  const [rewardsPublicReserveWei, setRewardsPublicReserveWei] = useState<bigint | null>(null);
  const [rewardTokenBalanceWei, setRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [privateRewardTokenBalanceWei, setPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenSymbol, setRewardTokenSymbol] = useState(FALLBACK_REWARD_TOKEN_SYMBOL);
  const [privateRewardTokenSymbol, setPrivateRewardTokenSymbol] = useState(FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL);
  const [rewardTokenDecimals, setRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [privateRewardTokenDecimals, setPrivateRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [swapFeeWei, setSwapFeeWei] = useState<bigint | null>(null);
  const [swapTokenFeeAmount, setSwapTokenFeeAmount] = useState<bigint | null>(null);
  const [groupFeeModeSelection, setGroupFeeModeSelection] = useState<GroupFeeModeSelection>('coti');
  const [swapFeeModeSelection, setSwapFeeModeSelection] = useState<SwapFeeModeSelection>('coti');
  const [swapDirection, setSwapDirection] = useState<SwapDirection>('shield');
  const [swapAmountInput, setSwapAmountInput] = useState('');
  const [swappingTokens, setSwappingTokens] = useState(false);
  const [swapStatusMessage, setSwapStatusMessage] = useState('');
  const [loadingTopUpQuote, setLoadingTopUpQuote] = useState(false);
  const [loadingRewardBalances, setLoadingRewardBalances] = useState(false);
  const [tipping, setTipping] = useState(false);
  const [tipComposerOpen, setTipComposerOpen] = useState(false);
  const [tipTokenSelection, setTipTokenSelection] = useState<TipTokenSelection>('coti');
  const [tipAmountInput, setTipAmountInput] = useState('');
  const [tradeComposerOpen, setTradeComposerOpen] = useState(false);
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [processingTradeActionId, setProcessingTradeActionId] = useState('');
  const [tradeFeeModeSelection, setTradeFeeModeSelection] = useState<TradeFeeModeSelection>('coti');
  const [tradeRequiredFeeWei, setTradeRequiredFeeWei] = useState<bigint | null>(null);
  const [tradeTokenFeeWei, setTradeTokenFeeWei] = useState<bigint | null>(null);
  const [tradeOfferTokenSelection, setTradeOfferTokenSelection] = useState<TradeTokenPresetKey>('coti');
  const [tradeRequestTokenSelection, setTradeRequestTokenSelection] = useState<TradeTokenPresetKey>('wisp');
  const [tradeOfferCustomTokenAddress, setTradeOfferCustomTokenAddress] = useState('');
  const [tradeRequestCustomTokenAddress, setTradeRequestCustomTokenAddress] = useState('');
  const [customTradeTokenInfoByAddress, setCustomTradeTokenInfoByAddress] = useState<Record<string, TradeCustomTokenInfo>>({});
  const [tradeOfferAmountInput, setTradeOfferAmountInput] = useState('');
  const [tradeRequestAmountInput, setTradeRequestAmountInput] = useState('');
  const [tradeExpiryHoursInput, setTradeExpiryHoursInput] = useState(DEFAULT_TRADE_EXPIRY_HOURS);
  const [tradeCounterParentId, setTradeCounterParentId] = useState<number | null>(null);
  const [tradeCounterContext, setTradeCounterContext] = useState<PendingTradeCounterContext | null>(null);
  const [tradeSnapshotsById, setTradeSnapshotsById] = useState<Record<string, TradeSnapshot>>({});
  const [groupTipRecipientAddress, setGroupTipRecipientAddress] = useState('');
  const [sendingGroupMessage, setSendingGroupMessage] = useState(false);
  const [processingGroupAction, setProcessingGroupAction] = useState(false);
  const [syncingGroups, setSyncingGroups] = useState(false);
  const [error, setError] = useState<string>('');
  const [activeMobileView, setActiveMobileView] = useState<MobileView>('wallets');
  const [mobileLinksOpen, setMobileLinksOpen] = useState(false);
  const [isMobileNav, setIsMobileNav] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_NAV_BREAKPOINT_PX : false
  );
  const [mobileGroupOptionsOpen, setMobileGroupOptionsOpen] = useState(false);
  useEffect(() => {
    setGroupInviteTtlInput((previous) => {
      const normalized = previous.trim();
      if (!normalized || normalized === '168') {
        return '8';
      }
      return previous;
    });
  }, []);
  const topHeaderRef = useRef<HTMLElement | null>(null);
  const nicknameEditorRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatComposerRef = useRef<HTMLDivElement | null>(null);
  const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const groupRemovalNoticeTimeoutRef = useRef<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const pendingThreadWindowScrollRestoreRef = useRef<{ threadKey: string; previousHeight: number } | null>(null);
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
  const syncingHistoryRef = useRef(false);
  const pendingSyncOptionsRef = useRef<SyncConversationOptions | null>(null);
  const previousWalletAddressRef = useRef<string>('');
  const postConnectDataSyncRunIdRef = useRef(0);
  const lastSyncedBlockRef = useRef<Record<string, number>>({});
  const tradeRequiredFeeCacheRef = useRef<bigint | null>(null);
  const tradeRequiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const tradeTokenFeeCacheRef = useRef<bigint | null>(null);
  const tradeTokenFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const [visibleThreadMessageCount, setVisibleThreadMessageCount] = useState(0);
  const [chatMessagesViewportVersion, setChatMessagesViewportVersion] = useState(0);
  const autoPrefetchedRecentHistoryByContactRef = useRef<Record<string, boolean>>({});
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
  }, [notificationSuppressedContactAddressSet]);

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
    if (shouldPlaySound && !suppressSoundOnConnectRef.current) {
      playNotificationSound();
    }

    prevUnreadRef.current = { ...nextContacts };
    prevUnreadGroupRef.current = { ...nextGroups };
  }, [unreadMap, unreadGroupMap, soundEnabled, notificationSuppressedContactAddressSet]);

  useEffect(() => {
    return () => {
      endConnectSoundSuppression();
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
        copyFeedbackTimeoutRef.current = null;
      }
    };
  }, []);

  const oldestLoadedBlockByContactRef = useRef<Record<string, number>>({});
  const hasOlderHistoryByContactRef = useRef<Record<string, boolean>>({});
  const conversationRangeByContactRef = useRef<Record<string, ConversationBlockRange>>({});
  const loadingOlderHistoryRef = useRef(false);
  const blockTimestampCacheRef = useRef<Map<number, number>>(new Map());
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
  const groupRemovalNoticeSeenRef = useRef<Record<string, Set<number>>>({});
  const groupRemovalNoticeMarkersRef = useRef<Record<string, Record<string, string>>>({});
  const groupRemovalNoticeMarkersLoadedRef = useRef(false);
  const conversationDeepBackfillDoneRef = useRef<Record<string, boolean>>({});
  const groupDeepBackfillDoneRef = useRef<Record<string, boolean>>({});
  const groupsRef = useRef<GroupSummary[]>([]);
  const groupInvitesRef = useRef<GroupInvite[]>([]);
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
  const {
    activeSignerSource,
    chainId,
    connectAndOnboard,
    connectingMethod,
    connectingWalletLabel,
    connectionMethod,
    currentInjectedWalletOption,
    currentWalletKeyRef,
    disconnectWallet,
    ensureCotiNetwork,
    getConnectedProvider,
    injectedWalletOptions,
    onboardStatus,
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
    status,
    walletAddress
  } = useWalletOnboarding({
    clearCachedStateBackupMemo,
    loadMyNicknameFromChainRef,
    resetBurnerSessionRef,
    runPostConnectDataSyncUntilAppliedRef,
    setError,
    setMyNickname
  });
  const {
    activeBurnerWalletId,
    beginBurnerPinFlow,
    beginRevealBurnerBackup,
    burnerAddress,
    burnerBalanceWei,
    burnerImportInput,
    burnerMnemonicBackup,
    burnerNeedsFunding,
    burnerPinInput,
    burnerPinMode,
    burnerRecordRef,
    burnerStorageBlocked,
    burnerWalletRef,
    burnerWalletSelectionValue,
    burnerWallets,
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
    setTopUpMultiplier,
    showBurnerImportModal,
    showBurnerMnemonic,
    showBurnerPinModal,
    submitBurnerPinAndInitialize,
    switchActiveBurnerWallet,
    topUpBurnerWithWallet,
    topUpMetricsNonce,
    topUpMultiplier
  } = useBurnerWallet({
    activeSignerSource,
    currentWalletKeyRef,
    ensureCotiNetwork,
    loadMyNicknameFromChainRef,
    preferredInjectedWalletOption,
    resolveRequiredFeeForSendRef,
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
  }, [walletAddress]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    groupInvitesRef.current = groupInvites;
  }, [groupInvites]);

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);
  useEffect(() => {
    setGeneratedGroupInviteCode('');
    setGeneratedGroupJoinCodeHash('');
  }, [activeGroupId, walletAddress]);
  useEffect(() => {
    setGroupRenameOpen(false);
    setGroupRenameInput('');
  }, [activeGroupId, walletAddress]);

  useEffect(() => {
    setMobileGroupOptionsOpen(false);
    setGroupInviteMenuView('invite');
  }, [activeGroupId, walletAddress, isMobileNav]);

  const isConnected = useMemo(() => walletAddress.length > 0, [walletAddress]);
  const onCotiNetwork = useMemo(() => chainId === COTI_NETWORK.chainIdDecimal, [chainId]);
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
  }, [activeGroupId, activeGroupTipRecipients]);
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
  }, [isActiveGroupAdmin, groupRenameOpen]);
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
        pendingThreadWindowScrollRestoreRef.current = null;
        pendingJumpTargetIdRef.current = null;
        pendingForcedBottomAnchorThreadKeyRef.current = nextThreadKey;
        return Math.min(nextThreadLength, INITIAL_VISIBLE_THREAD_MESSAGE_COUNT);
      }

      if (nextThreadLength <= current) {
        return nextThreadLength;
      }

      const latestMessageChanged = previousThread.lastMessageId !== nextThreadLastMessageId;
      if (!latestMessageChanged) {
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
      Object.values(unreadMap).some((isUnread) => Boolean(isUnread)) ||
      Object.values(unreadGroupMap).some((isUnread) => Boolean(isUnread)),
    [unreadMap, unreadGroupMap]
  );
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
    () => (walletAddress ? Boolean(sessionOnboardInfo[walletAddress.toLowerCase()]?.aesKey) : false),
    [walletAddress, sessionOnboardInfo]
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
  const tokenToolsSummary = useMemo(() => {
    if (loadingRewardBalances) {
      return 'Loading balances...';
    }
    const publicBalance =
      rewardTokenBalanceWei !== null ? formatTokenAmount(rewardTokenBalanceWei, rewardTokenDecimals, 4) : '--';
    const privateBalance =
      privateRewardTokenBalanceWei !== null
        ? formatTokenAmount(privateRewardTokenBalanceWei, privateRewardTokenDecimals, 4)
        : hasAesReady
          ? '--'
          : 'AES';
    return `${rewardTokenSymbol} ${publicBalance} | ${privateRewardTokenSymbol} ${privateBalance}`;
  }, [
    loadingRewardBalances,
    rewardTokenSymbol,
    privateRewardTokenSymbol,
    rewardTokenBalanceWei,
    privateRewardTokenBalanceWei,
    rewardTokenDecimals,
    privateRewardTokenDecimals,
    hasAesReady
  ]);
  const estimatedMessagesLeft = useMemo(() => {
    if (requiredFeeWei === null || burnerBalanceWei === null || requiredFeeWei <= 0n) {
      return null;
    }

    return burnerBalanceWei / requiredFeeWei;
  }, [requiredFeeWei, burnerBalanceWei]);
  const selectedGroupFeeLabel = useMemo(() => {
    if (groupFeeModeSelection === 'token') {
      if (groupTokenFeeWei === null) {
        return `${rewardTokenSymbol} fee: --`;
      }
      return `${rewardTokenSymbol} fee: ${formatTokenAmount(groupTokenFeeWei, rewardTokenDecimals, 4)}`;
    }

    if (groupRequiredFeeWei === null) {
      return 'COTI fee: --';
    }
    return `COTI fee: ${formatCotiAmount(groupRequiredFeeWei)}`;
  }, [groupFeeModeSelection, groupTokenFeeWei, groupRequiredFeeWei, rewardTokenSymbol, rewardTokenDecimals]);
  const parsedSwapAmount = useMemo(
    () => parseTokenAmountInput(swapAmountInput, rewardTokenDecimals),
    [swapAmountInput, rewardTokenDecimals]
  );
  const swapInputSymbol = swapDirection === 'shield' ? rewardTokenSymbol : privateRewardTokenSymbol;
  const canSwapRewardTokens =
    !swappingTokens &&
    !!walletAddress &&
    onCotiNetwork &&
    hasAesReady &&
    parsedSwapAmount !== null &&
    parsedSwapAmount > 0n;
  const swapButtonLabel = swappingTokens
    ? 'Swapping...'
    : !walletAddress
      ? 'Connect wallet'
      : !onCotiNetwork
        ? 'Switch to COTI network'
        : !hasAesReady
          ? 'AES required'
          : parsedSwapAmount === null || parsedSwapAmount <= 0n
            ? `Enter ${swapInputSymbol} amount`
            : swapDirection === 'shield'
              ? `Shield to ${privateRewardTokenSymbol}`
              : `Unshield to ${rewardTokenSymbol}`;
  const topUpAmountLabel = useMemo(() => {
    if (loadingTopUpQuote) {
      return 'Calculating...';
    }
    if (topUpAmountWei !== null) {
      return `${formatCotiAmount(topUpAmountWei)} COTI`;
    }
    return '--';
  }, [loadingTopUpQuote, topUpAmountWei]);
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
    tradeOfferVerifyUrl,
    tradeRequestVerifyUrl,
    parsedTradeExpiryHours,
    tradeOfferMaxInputValue,
    canUseTradeOfferMax,
    tradePreviewLabel,
    tradeRateLabel,
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
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        tipNativeBalanceWei,
        rewardTokenBalanceWei,
        privateRewardTokenBalanceWei,
        tradeRequiredFeeWei,
        tradeTokenFeeWei
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
      tradeRequiredFeeWei,
      tradeTokenFeeWei
    ]
  );
  const activeTradeOffers = useMemo(
    () =>
      activeMessages
        .map((message) => parseTradeOfferMessagePayload(message.text))
        .filter((message): message is TradeOfferMessagePayload => message !== null),
    [activeMessages]
  );
  useEffect(() => {
    setTradeComposerOpen(false);
    setTradeOfferAmountInput('');
    setTradeRequestAmountInput('');
    setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
    setTradeCounterParentId(null);
    setTradeCounterContext(null);
  }, [activeContact]);
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
          isCustomTradeTokenSelection(tradeRequestTokenSelection) && isWalletAddress(normalizedTradeRequestCustomTokenAddress)
            ? {
                key: buildTradeCustomTokenInfoKey(tradeCustomRequestTokenKind, normalizedTradeRequestCustomTokenAddress),
                address: normalizedTradeRequestCustomTokenAddress.trim().toLowerCase(),
                kind: tradeCustomRequestTokenKind
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
            const tokenAbi = request.kind === 'private-erc20' ? PRIVATE_TOKEN_BALANCE_ABI : ERC20_TOKEN_ABI;
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
                  balanceWei = await readPrivateTokenBalanceWei(request.address, walletAddress, signerBundle.signer).catch(
                    () => null
                  );
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
    topUpMetricsNonce
  ]);
  useEffect(() => {
    if (!TRADE_ESCROW_CONTRACT_ADDRESS || !isWalletAddress(TRADE_ESCROW_CONTRACT_ADDRESS)) {
      tradeRequiredFeeCacheRef.current = null;
      tradeRequiredFeeRequestRef.current = null;
      tradeTokenFeeCacheRef.current = null;
      tradeTokenFeeRequestRef.current = null;
      setTradeRequiredFeeWei(null);
      setTradeTokenFeeWei(null);
      return;
    }

    let cancelled = false;

    const loadTradeFees = async () => {
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
      const [nativeFeeRaw, tokenFeeRaw] = await Promise.all([
        contract.feeAmount().catch(() => null),
        contract.tokenFeeAmount().catch(() => null)
      ]);

      if (cancelled) {
        return;
      }

      const nativeFee = typeof nativeFeeRaw === 'bigint' ? nativeFeeRaw : null;
      const tokenFee = typeof tokenFeeRaw === 'bigint' ? tokenFeeRaw : null;
      tradeRequiredFeeCacheRef.current = nativeFee;
      tradeTokenFeeCacheRef.current = tokenFee;
      setTradeRequiredFeeWei(nativeFee);
      setTradeTokenFeeWei(tokenFee);
    };

    loadTradeFees().catch(() => {
      if (!cancelled) {
        setTradeRequiredFeeWei(null);
        setTradeTokenFeeWei(null);
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
        Array.from(new Set(activeTradeOffers.map((offer) => offer.tradeId))).map(async (tradeId) => {
          try {
            return await fetchTradeSnapshotById(tradeId, {
              rewardTokenSymbol,
              rewardTokenDecimals,
              privateRewardTokenSymbol,
              privateRewardTokenDecimals
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
          next[String(snapshot.tradeId)] = snapshot;
        }
        return next;
      });
    };

    loadTradeSnapshots().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeTradeOffers, privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]);
  const isStatusConnected = useMemo(() => /^connected/i.test(status.trim()), [status]);
  const isAesConnected = useMemo(() => onboardStatus === 'AES key ready', [onboardStatus]);
  const rewardsConfigured = Boolean(groupRewardsContractAddress);
  const rewardsEnabled =
    groupRewardsPaused === false && rewardsContractPaused === false && rewardsCallerAllowed === true;
  const rewardsLowReserve = Boolean(
    groupRewardsContractAddress &&
      rewardsPublicReserveWei !== null &&
      rewardsPublicPerInteractionWei !== null &&
      rewardsPublicPerInteractionWei > 0n &&
      rewardsPublicReserveWei < rewardsPublicPerInteractionWei
  );
  const rewardsIndicatorLabel = !rewardsConfigured
    ? 'Rewards not configured on-chain.'
    : groupRewardsPaused === true
      ? 'Rewards paused by group contract.'
      : rewardsContractPaused === true
        ? 'Rewards paused by rewards contract.'
        : rewardsCallerAllowed === false
          ? 'Group contract is not allowed in rewards contract.'
          : rewardsEnabled
            ? 'Rewards enabled.'
            : 'Rewards configured.';

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

    const amount = parseTokenAmountInput(swapAmountInput, rewardTokenDecimals);
    if (amount === null || amount <= 0n) {
      setError(`Enter a valid ${rewardTokenSymbol} amount.`);
      return;
    }
    const selectedSwapPaymentMode = swapFeeModeSelection === 'coti' ? 1 : 0;
    if (swapDirection === 'unshield') {
      if (privateRewardTokenBalanceWei === null) {
        setError(`Unable to read ${privateRewardTokenSymbol} balance. Wait for balances to load and try again.`);
        return;
      }
      if (privateRewardTokenBalanceWei < amount) {
        setError(
          `Insufficient ${privateRewardTokenSymbol} balance. Available ${formatTokenAmount(
            privateRewardTokenBalanceWei,
            privateRewardTokenDecimals,
            6
          )}, requested ${formatTokenAmount(amount, privateRewardTokenDecimals, 6)}.`
        );
        return;
      }
    }

    try {
      setSwappingTokens(true);
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const swapContract = new cotiEthers.Contract(SWAP_VAULT_CONTRACT_ADDRESS, SWAP_VAULT_CONTRACT_ABI, signer);
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
        privateRewardTokenBalanceWei !== null &&
        resolvedSwapTokenFee > 0n
      ) {
        // If amount is greater than (private balance - token fee), switch to COTI mode
        // so the swap can use native fee directly.
        if (privateRewardTokenBalanceWei >= resolvedSwapTokenFee) {
          const maxUnshieldAfterPrivateFee = privateRewardTokenBalanceWei - resolvedSwapTokenFee;
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
          SWAP_VAULT_CONTRACT_ADDRESS
        )) as bigint;
        if (allowance < requiredApproval) {
          const approveTx = await publicTokenContract.approve(SWAP_VAULT_CONTRACT_ADDRESS, requiredApproval);
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
                  ? ` Fee paid with ${privateRewardTokenSymbol} (${formatTokenAmount(feePaidAmount, privateRewardTokenDecimals, 6)} ${privateRewardTokenSymbol}).`
                  : ` Fee paid with ${privateRewardTokenSymbol}.`
                : '';
      const fallbackStatus = usedNativeFallbackRetry ? ' Used COTI fee fallback after token/private fee attempt failed.' : '';
      const autoModeStatus = usedAutoCotiMode
        ? ` Auto-switched fee mode to COTI because amount exceeded ${privateRewardTokenSymbol} balance minus token fee.`
        : '';
      setSwapStatusMessage(`${swapDirectionStatus}${feeStatus}${fallbackStatus}${autoModeStatus}`);
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
  }, [visibleThreadMessageCount, activeThreadKey]);

  const handleMessageInputChange = useCallback((value: string) => {
    setMessageInput(sanitizeOutgoingMessagePlainText(value).slice(0, MAX_MESSAGE_LENGTH));
  }, []);

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
  }, [copyAddressToClipboard]);

  const markConversationAsRead = useCallback((contactAddress?: string | null) => {
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
  }, [messagesByContact]);
  const markGroupConversationAsRead = useCallback((groupId?: number | null) => {
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
  }, [messagesByGroup]);
  const markAllConversationsAsRead = useCallback(() => {
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
  }, [messagesByContact, messagesByGroup]);

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
  }, [isMobileNav, markConversationAsRead]);

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
        throw new Error('AES key unavailable. Use Connect without burner and complete onboarding signature once.');
      }

      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
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
      setGroupRequiredFeeWei(groupRequiredFeeCacheRef.current);
      return groupRequiredFeeCacheRef.current;
    }

    if (!groupRequiredFeeRequestRef.current) {
      groupRequiredFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.feeAmount()) as bigint;
        groupRequiredFeeCacheRef.current = resolvedFee;
        setGroupRequiredFeeWei(resolvedFee);
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
      setGroupTokenFeeWei(groupTokenFeeCacheRef.current);
      return groupTokenFeeCacheRef.current;
    }

    if (!groupTokenFeeRequestRef.current) {
      groupTokenFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.tokenFeeAmount()) as bigint;
        groupTokenFeeCacheRef.current = resolvedFee;
        setGroupTokenFeeWei(resolvedFee);
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

  const resolveRequiredTokenFeeForTradeCreate = async (): Promise<bigint> => {
    if (tradeTokenFeeCacheRef.current !== null) {
      setTradeTokenFeeWei(tradeTokenFeeCacheRef.current);
      return tradeTokenFeeCacheRef.current;
    }

    if (!tradeTokenFeeRequestRef.current) {
      tradeTokenFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
        const resolvedFee = (await readContract.tokenFeeAmount()) as bigint;
        tradeTokenFeeCacheRef.current = resolvedFee;
        setTradeTokenFeeWei(resolvedFee);
        return resolvedFee;
      })();
    }

    try {
      return await tradeTokenFeeRequestRef.current;
    } finally {
      tradeTokenFeeRequestRef.current = null;
    }
  };

  const resolveTradeSnapshotForOffer = async (offerMessage: TradeOfferMessagePayload): Promise<TradeSnapshot> => {
    const existingSnapshot = tradeSnapshotsById[String(offerMessage.tradeId)];
    if (existingSnapshot) {
      return existingSnapshot;
    }

    const nextSnapshot = await fetchTradeSnapshotById(offerMessage.tradeId, {
      rewardTokenSymbol,
      rewardTokenDecimals,
      privateRewardTokenSymbol,
      privateRewardTokenDecimals
    });
    setTradeSnapshotsById((previous) => ({
      ...previous,
      [String(offerMessage.tradeId)]: nextSnapshot
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

  const saveMyNicknameOnChain = async (overrideNickname?: string): Promise<boolean> =>
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
    });

  const loadMyNicknameFromChain = async (
    targetAddress: string,
    fallbackNickname?: string
  ): Promise<string> => loadMyNicknameFromChainLookup(targetAddress, fallbackNickname, fetchOnChainNicknames);
  loadMyNicknameFromChainRef.current = loadMyNicknameFromChain;

  const resolveRecentPeersWithMeta = async (contract: unknown, user: string): Promise<RecentPeerMeta[]> =>
    resolveRecentPeersWithMetaLookup(contract, user);

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

  const syncConversationHistory = async (options?: SyncConversationOptions) => {
    setError('');
    debugLog('[sync] start', { walletAddress, options, hasAesReady, chainId });

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      return;
    }

    if (syncingHistoryRef.current) {
      const pending = pendingSyncOptionsRef.current;
      const mergedDeep = Boolean(options?.deep || pending?.deep);
      const mergedContactsOnly = mergedDeep
        ? false
        : Boolean(options?.contactsOnly || pending?.contactsOnly);
      const mergedPreviewPerContact = mergedContactsOnly
        ? Boolean(options?.previewPerContact || pending?.previewPerContact)
        : false;
      pendingSyncOptionsRef.current = {
        ...pending,
        ...options,
        deep: mergedDeep,
        contactsOnly: mergedContactsOnly,
        previewPerContact: mergedPreviewPerContact,
        updateHead: Boolean(options?.updateHead || pending?.updateHead || mergedDeep),
        lookbackBlocks: mergedDeep
          ? undefined
          : typeof options?.lookbackBlocks === 'number' && typeof pending?.lookbackBlocks === 'number'
            ? Math.max(options.lookbackBlocks, pending.lookbackBlocks)
            : typeof options?.lookbackBlocks === 'number'
              ? options.lookbackBlocks
              : pending?.lookbackBlocks,
        background: Boolean((options?.background ?? true) && (pending?.background ?? true)),
        fromBlock: mergedDeep
          ? undefined
          : typeof options?.fromBlock === 'number' && typeof pending?.fromBlock === 'number'
            ? Math.min(options.fromBlock, pending.fromBlock)
            : typeof options?.fromBlock === 'number'
              ? options.fromBlock
              : pending?.fromBlock,
        toBlock:
          typeof options?.toBlock === 'number' && typeof pending?.toBlock === 'number'
            ? Math.max(options.toBlock, pending.toBlock)
            : typeof options?.toBlock === 'number'
              ? options.toBlock
              : pending?.toBlock
      };
      return;
    }

    try {
      const runInBackground = Boolean(options?.background);
      const shouldLoadContactPreviews = Boolean(options?.contactsOnly && options?.previewPerContact);
      syncingHistoryRef.current = true;
      if (!runInBackground) {
        setSyncingHistory(true);
      }
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const walletKey = requestedWalletKey;
      const lastSyncedBlock = lastSyncedBlockRef.current[walletKey];
      const toBlock = typeof options?.toBlock === 'number' ? Math.min(options.toBlock, latestBlock) : latestBlock;
      const fromBlock =
        typeof options?.fromBlock === 'number'
          ? Math.max(0, options.fromBlock)
          : options?.deep
            ? 0
            : typeof options?.lookbackBlocks === 'number'
              ? Math.max(0, toBlock - Math.max(0, Math.floor(options.lookbackBlocks)))
              : typeof lastSyncedBlock === 'number'
                ? lastSyncedBlock + 1
                : Math.max(0, toBlock - INITIAL_SYNC_LOOKBACK_BLOCKS);

      if (fromBlock > toBlock) {
        return;
      }

      const discoveredContacts = new Set<string>();
      const discoveredNicknames = new Map<string, string>();
      const discoveredConversationStates = new Map<
        string,
        { state: ConversationPreferenceState; blockNumber: number; logIndex: number }
      >();
      const latestIncomingMessageTimeByContact = new Map<string, number>();
      const entries: HistoryEntry[] = [];
      const previewByContact = new Map<string, HistoryEntry>();
      let latestStateBackup:
        | {
            payload: StateBackupPayload;
            blockNumber: number;
            logIndex: number;
          }
        | null = null;

      const trackDiscoveredConversationState = (
        address: string,
        state: ConversationPreferenceState | undefined,
        blockNumber: number,
        logIndex: number
      ) => {
        const normalizedAddress = address.trim().toLowerCase();
        if (!isWalletAddress(normalizedAddress)) {
          return;
        }

        const normalizedState = normalizeConversationPreferenceState(state);
        if (!normalizedState) {
          return;
        }

        const existingState = discoveredConversationStates.get(normalizedAddress);
        const shouldReplace =
          !existingState ||
          blockNumber > existingState.blockNumber ||
          (blockNumber === existingState.blockNumber && logIndex > existingState.logIndex);
        if (shouldReplace) {
          discoveredConversationStates.set(normalizedAddress, {
            state: normalizedState,
            blockNumber,
            logIndex
          });
        }
      };

      const recentPeersWithMeta = await resolveRecentPeersWithMeta(contract, requestedWalletAddress);
      for (const peer of recentPeersWithMeta) {
        discoveredContacts.add(peer.address);
      }

      let incomingLogs: ConversationLog[] = [];
      let outgoingLogs: ConversationLog[] = [];
      const useFastPreviewPath = shouldLoadContactPreviews && recentPeersWithMeta.length > 0;

      if (useFastPreviewPath) {
        const previewCandidates = recentPeersWithMeta.filter(
          (peer) => peer.lastBlock > 0 && peer.lastBlock <= toBlock
        );

        for (
          let batchStart = 0;
          batchStart < previewCandidates.length;
          batchStart += FAST_CONTACT_PREVIEW_BATCH_SIZE
        ) {
          const batch = previewCandidates.slice(batchStart, batchStart + FAST_CONTACT_PREVIEW_BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (peer): Promise<{ incoming: ConversationLog[]; outgoing: ConversationLog[] }> => {
              const headBlock = peer.lastBlock;
              const incomingFilter = contract.filters.MessageSubmitted(requestedWalletAddress, peer.address);
              const outgoingFilter = contract.filters.MessageSubmitted(peer.address, requestedWalletAddress);

              try {
                let [incomingPreviewLogs, outgoingPreviewLogs] = await Promise.all([
                  contract.queryFilter(incomingFilter, headBlock, headBlock),
                  contract.queryFilter(outgoingFilter, headBlock, headBlock)
                ]);

                if (incomingPreviewLogs.length === 0 && outgoingPreviewLogs.length === 0 && headBlock > 0) {
                  const fallbackStart = Math.max(0, headBlock - FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK);
                  [incomingPreviewLogs, outgoingPreviewLogs] = await Promise.all([
                    contract.queryFilter(incomingFilter, fallbackStart, headBlock),
                    contract.queryFilter(outgoingFilter, fallbackStart, headBlock)
                  ]);
                }

                return {
                  incoming: incomingPreviewLogs as ConversationLog[],
                  outgoing: outgoingPreviewLogs as ConversationLog[]
                };
              } catch {
                return { incoming: [], outgoing: [] };
              }
            })
          );

          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }

          for (const result of batchResults) {
            incomingLogs.push(...result.incoming);
            outgoingLogs.push(...result.outgoing);
          }
        }
      } else {
        const incomingFilter = contract.filters.MessageSubmitted(requestedWalletAddress, null);
        const outgoingFilter = contract.filters.MessageSubmitted(null, requestedWalletAddress);
        const [incomingLogsRaw, outgoingLogsRaw] = await Promise.all([
          contract.queryFilter(incomingFilter, fromBlock, toBlock),
          contract.queryFilter(outgoingFilter, fromBlock, toBlock)
        ]);
        incomingLogs = incomingLogsRaw as ConversationLog[];
        outgoingLogs = outgoingLogsRaw as ConversationLog[];
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const blockNumbers = new Set<number>();
      for (const log of incomingLogs) {
        blockNumbers.add(log.blockNumber);
      }
      for (const log of outgoingLogs) {
        blockNumbers.add(log.blockNumber);
      }

      const blockTimestampMap = new Map<number, number>();
      const blockTimestampCache = blockTimestampCacheRef.current;
      await Promise.all(
        Array.from(blockNumbers).map(async (blockNumber) => {
          const cachedTimestamp = blockTimestampCache.get(blockNumber);
          if (typeof cachedTimestamp === 'number') {
            blockTimestampMap.set(blockNumber, cachedTimestamp);
            return;
          }

          const block = await readProvider.getBlock(blockNumber);
          if (block?.timestamp) {
            const timestamp = Number(block.timestamp);
            blockTimestampMap.set(blockNumber, timestamp);
            blockTimestampCache.set(blockNumber, timestamp);
          }
        })
      );

      const updateLatestIncomingMessageTime = (address: string, blockNumber: number): void => {
        const normalizedAddress = address.trim().toLowerCase();
        if (!isWalletAddress(normalizedAddress)) {
          return;
        }

        const blockTimestamp = blockTimestampMap.get(blockNumber);
        if (typeof blockTimestamp !== 'number' || blockTimestamp <= 0) {
          return;
        }

        const existingObserved = latestIncomingMessageTimeByContact.get(normalizedAddress) ?? 0;
        if (blockTimestamp > existingObserved) {
          latestIncomingMessageTimeByContact.set(normalizedAddress, blockTimestamp);
        }
      };

      for (const log of incomingLogs) {
        const args = (log as { args?: Record<string, unknown> }).args;
        const from = String(args?.from ?? '');
        if (!isWalletAddress(from)) {
          continue;
        }

        const isSelfIncoming = from.toLowerCase() === walletKey;
        if (isSelfIncoming) {
          const selfCiphertext = extractUserCiphertext(args?.messageForRecipient);
          let isSystemSelfMessage = false;
          if (selfCiphertext && selfCiphertext.value.length > 0) {
            try {
              const decrypted = await signer.decryptValue(selfCiphertext as never);
              const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
              const plain = decodeMemoPlaintext(raw);
              const backupPayload = parseStateBackupText(plain);
              if (backupPayload) {
                isSystemSelfMessage = true;
                if (
                  !latestStateBackup ||
                  log.blockNumber > latestStateBackup.blockNumber ||
                  (log.blockNumber === latestStateBackup.blockNumber && log.index > latestStateBackup.logIndex)
                ) {
                  latestStateBackup = {
                    payload: backupPayload,
                    blockNumber: log.blockNumber,
                    logIndex: log.index
                  };
                    debugLog('[restore] found state backup', {
                      address: walletKey,
                      nickname: backupPayload.nickname,
                      tx: log.transactionHash,
                      block: log.blockNumber,
                      index: log.index
                    });
                }
              }
              if (parseReadCursorText(plain)) {
                isSystemSelfMessage = true;
              }
            } catch {
            }
          }
          if (isSystemSelfMessage) {
            continue;
          }
        }

        discoveredContacts.add(from);
        updateLatestIncomingMessageTime(from, log.blockNumber);

        if (options?.contactsOnly && !shouldLoadContactPreviews) {
          continue;
        }

        if (shouldLoadContactPreviews) {
          const contactKey = from.toLowerCase();
          const existingPreview = previewByContact.get(contactKey);
          const isNewerPreview =
            !existingPreview ||
            log.blockNumber > existingPreview.blockNumber ||
            (log.blockNumber === existingPreview.blockNumber && log.index > existingPreview.logIndex);

          if (!isNewerPreview) {
            continue;
          }

          const userCiphertext = extractUserCiphertext(args?.messageForRecipient);
          let messageText = '(Unable to decrypt message)';
          let replyToMessageId: string | undefined;
          let replyToText: string | undefined;
          let replyToTxHash: string | undefined;
          let replyToBlockNumber: number | undefined;
          let replyToLogIndex: number | undefined;
          let reactionToTxHash: string | undefined;
          let reactionToBlockNumber: number | undefined;
          let reactionToLogIndex: number | undefined;
          let reactionEmoji: string | undefined;
          if (userCiphertext && userCiphertext.value.length > 0) {
            try {
              const decrypted = await signer.decryptValue(userCiphertext as never);
              const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
              const plain = decodeMemoPlaintext(raw);
              const parsedMessage = parseChatMessagePayload(plain);
              messageText = parsedMessage.cleanText;
              replyToMessageId = parsedMessage.replyToMessageId;
              replyToText = parsedMessage.replyToText;
              replyToTxHash = parsedMessage.replyToTxHash;
              replyToBlockNumber = parsedMessage.replyToBlockNumber;
              replyToLogIndex = parsedMessage.replyToLogIndex;
              reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
              reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
              reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
              reactionEmoji = parsedMessage.embeddedReaction?.emoji;
              if (
                messageText.trim().length === 0 &&
                (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
              ) {
                continue;
              }
              if (parsedMessage.embeddedNickname) {
                discoveredNicknames.set(contactKey, parsedMessage.embeddedNickname);
                debugLog('[sync] discovered nickname', {
                  address: contactKey,
                  nickname: parsedMessage.embeddedNickname,
                  tx: log.transactionHash,
                  block: log.blockNumber,
                  index: log.index
                });
              }
            } catch {
              messageText = '(Unable to decrypt message)';
            }
          }

          previewByContact.set(contactKey, {
            id: `${log.transactionHash}-${log.index}-in`,
            contact: from,
            direction: 'incoming',
            text: messageText,
            replyToMessageId,
            replyToText,
            replyToTxHash,
            replyToBlockNumber,
            replyToLogIndex,
            reactionToTxHash,
            reactionToBlockNumber,
            reactionToLogIndex,
            reactionEmoji,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index,
            timestamp: blockTimestampMap.get(log.blockNumber)
          });
          continue;
        }

        const userCiphertext = extractUserCiphertext(args?.messageForRecipient);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;
        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const decrypted = await signer.decryptValue(userCiphertext as never);
            const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
            const plain = decodeMemoPlaintext(raw);
            const parsedMessage = parseChatMessagePayload(plain);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
            if (parsedMessage.embeddedNickname) {
              discoveredNicknames.set(from.toLowerCase(), parsedMessage.embeddedNickname);
              debugLog('[sync] discovered nickname', {
                address: from.toLowerCase(),
                nickname: parsedMessage.embeddedNickname,
                tx: log.transactionHash,
                block: log.blockNumber,
                index: log.index
              });
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-in`,
          contact: from,
          direction: 'incoming',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      for (const log of outgoingLogs) {
        const args = (log as { args?: Record<string, unknown> }).args;
        const recipient = String(args?.recipient ?? '');
        if (!isWalletAddress(recipient)) {
          continue;
        }

        if (recipient.toLowerCase() === walletKey) {
          const selfCiphertext = extractUserCiphertext(args?.messageForSender);
          if (selfCiphertext && selfCiphertext.value.length > 0) {
            try {
              const decrypted = await signer.decryptValue(selfCiphertext as never);
              const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
              const plain = decodeMemoPlaintext(raw);
              const backupPayload = parseStateBackupText(plain);
              if (backupPayload) {
                if (
                  !latestStateBackup ||
                  log.blockNumber > latestStateBackup.blockNumber ||
                  (log.blockNumber === latestStateBackup.blockNumber && log.index > latestStateBackup.logIndex)
                ) {
                  latestStateBackup = {
                    payload: backupPayload,
                    blockNumber: log.blockNumber,
                    logIndex: log.index
                  };
                }
              }
              if (parseReadCursorText(plain)) {
                continue;
              }
            } catch {
            }
          }
          continue;
        }

        discoveredContacts.add(recipient);

        if (options?.contactsOnly && !shouldLoadContactPreviews) {
          continue;
        }

        if (shouldLoadContactPreviews) {
          const contactKey = recipient.toLowerCase();
          const existingPreview = previewByContact.get(contactKey);
          const isNewerPreview =
            !existingPreview ||
            log.blockNumber > existingPreview.blockNumber ||
            (log.blockNumber === existingPreview.blockNumber && log.index > existingPreview.logIndex);

          if (!isNewerPreview) {
            continue;
          }

          const userCiphertext = extractUserCiphertext(args?.messageForSender);
          let messageText = '(Unable to decrypt message)';
          let replyToMessageId: string | undefined;
          let replyToText: string | undefined;
          let replyToTxHash: string | undefined;
          let replyToBlockNumber: number | undefined;
          let replyToLogIndex: number | undefined;
          let reactionToTxHash: string | undefined;
          let reactionToBlockNumber: number | undefined;
          let reactionToLogIndex: number | undefined;
          let reactionEmoji: string | undefined;
          if (userCiphertext && userCiphertext.value.length > 0) {
            try {
              const decrypted = await signer.decryptValue(userCiphertext as never);
              const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
              const plain = decodeMemoPlaintext(raw);
              const parsedMessage = parseChatMessagePayload(plain);
              messageText = parsedMessage.cleanText;
              replyToMessageId = parsedMessage.replyToMessageId;
              replyToText = parsedMessage.replyToText;
              replyToTxHash = parsedMessage.replyToTxHash;
              replyToBlockNumber = parsedMessage.replyToBlockNumber;
              replyToLogIndex = parsedMessage.replyToLogIndex;
              reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
              reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
              reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
              reactionEmoji = parsedMessage.embeddedReaction?.emoji;
              if (parsedMessage.embeddedContactName) {
                discoveredNicknames.set(contactKey, parsedMessage.embeddedContactName);
              }
              trackDiscoveredConversationState(
                contactKey,
                parsedMessage.embeddedConversationState,
                log.blockNumber,
                log.index
              );
              if (
                messageText.trim().length === 0 &&
                (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
              ) {
                continue;
              }
            } catch {
              messageText = '(Unable to decrypt message)';
            }
          }

          previewByContact.set(contactKey, {
            id: `${log.transactionHash}-${log.index}-out`,
            contact: recipient,
            direction: 'outgoing',
            text: messageText,
            replyToMessageId,
            replyToText,
            replyToTxHash,
            replyToBlockNumber,
            replyToLogIndex,
            reactionToTxHash,
            reactionToBlockNumber,
            reactionToLogIndex,
            reactionEmoji,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index,
            timestamp: blockTimestampMap.get(log.blockNumber)
          });
          continue;
        }

        const userCiphertext = extractUserCiphertext(args?.messageForSender);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;
        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const decrypted = await signer.decryptValue(userCiphertext as never);
            const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
            const plain = decodeMemoPlaintext(raw);
            const parsedMessage = parseChatMessagePayload(plain);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (parsedMessage.embeddedContactName) {
              discoveredNicknames.set(recipient.toLowerCase(), parsedMessage.embeddedContactName);
            }
            trackDiscoveredConversationState(
              recipient.toLowerCase(),
              parsedMessage.embeddedConversationState,
              log.blockNumber,
              log.index
            );
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-out`,
          contact: recipient,
          direction: 'outgoing',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      if (shouldLoadContactPreviews) {
        entries.push(...previewByContact.values());
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (!options?.contactsOnly || shouldLoadContactPreviews) {
        entries.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return a.blockNumber - b.blockNumber;
          }
          return a.logIndex - b.logIndex;
        });

        const earliestBlockByContact = new Map<string, number>();
        for (const entry of entries) {
          const key = entry.contact.toLowerCase();
          const existingEarliest = earliestBlockByContact.get(key);
          if (typeof existingEarliest !== 'number' || entry.blockNumber < existingEarliest) {
            earliestBlockByContact.set(key, entry.blockNumber);
          }
        }

        for (const [contactKey, earliestBlock] of earliestBlockByContact.entries()) {
          const knownEarliest = oldestLoadedBlockByContactRef.current[contactKey];
          if (typeof knownEarliest !== 'number' || earliestBlock < knownEarliest) {
            oldestLoadedBlockByContactRef.current[contactKey] = earliestBlock;
          }
          const knownRange = conversationRangeByContactRef.current[contactKey];
          hasOlderHistoryByContactRef.current[contactKey] =
            typeof knownRange?.firstBlock === 'number' ? earliestBlock > knownRange.firstBlock : true;
        }

        setMessagesByContact((previous) => {
          if (entries.length === 0) {
            return previous;
          }

          const next: Record<string, ChatMessage[]> = { ...previous };
          const existingIdsByContact = new Map<string, Set<string>>();
          const prunedOptimisticByContact = new Set<string>();
          const confirmedOutgoingTxHashesByContact = new Map<string, Set<string>>();

          for (const entry of entries) {
            if (entry.direction !== 'outgoing' || !entry.txHash) {
              continue;
            }

            const key = entry.contact.toLowerCase();
            const existingHashes = confirmedOutgoingTxHashesByContact.get(key);
            if (existingHashes) {
              existingHashes.add(entry.txHash.toLowerCase());
              continue;
            }

            confirmedOutgoingTxHashesByContact.set(key, new Set([entry.txHash.toLowerCase()]));
          }

          for (const entry of entries) {
            const key = entry.contact.toLowerCase();
            if (!prunedOptimisticByContact.has(key)) {
              const confirmedHashes = confirmedOutgoingTxHashesByContact.get(key);
              if (confirmedHashes && confirmedHashes.size > 0) {
                next[key] = (next[key] ?? []).filter((message) => {
                  if (!message.txHash) {
                    return true;
                  }

                  const isOptimistic =
                    message.deliveryState === 'pending' ||
                    message.deliveryState === 'sent' ||
                    message.deliveryState === 'failed';

                  if (!isOptimistic) {
                    return true;
                  }

                  return !confirmedHashes.has(message.txHash.toLowerCase());
                });
              }

              prunedOptimisticByContact.add(key);
            }

            if (entry.direction === 'outgoing') {
              const existingForDedupe = next[key] ?? [];
              let matchedLocalIndex = -1;
              let matchedLocalScore = Number.MAX_SAFE_INTEGER;

              for (let index = 0; index < existingForDedupe.length; index += 1) {
                const candidate = existingForDedupe[index];
                if (
                  !candidate.id.startsWith('local-') ||
                  candidate.direction !== 'outgoing' ||
                  candidate.text !== entry.text ||
                  (candidate.replyToText ?? '') !== (entry.replyToText ?? '') ||
                  !messageReferencesMatch(
                    {
                      txHash: candidate.replyToTxHash,
                      blockNumber: candidate.replyToBlockNumber,
                      logIndex: candidate.replyToLogIndex
                    },
                    {
                      txHash: entry.replyToTxHash,
                      blockNumber: entry.replyToBlockNumber,
                      logIndex: entry.replyToLogIndex
                    }
                  ) ||
                  !messageReferencesMatch(
                    {
                      txHash: candidate.reactionToTxHash,
                      blockNumber: candidate.reactionToBlockNumber,
                      logIndex: candidate.reactionToLogIndex
                    },
                    {
                      txHash: entry.reactionToTxHash,
                      blockNumber: entry.reactionToBlockNumber,
                      logIndex: entry.reactionToLogIndex
                    }
                  ) ||
                  (candidate.reactionEmoji ?? '') !== (entry.reactionEmoji ?? '')
                ) {
                  continue;
                }

                const isOptimisticCandidate =
                  candidate.deliveryState === 'pending' ||
                  candidate.deliveryState === 'sent' ||
                  candidate.deliveryState === 'failed';
                if (!isOptimisticCandidate) {
                  continue;
                }

                const candidateTimestamp = typeof candidate.timestamp === 'number' ? candidate.timestamp : undefined;
                const entryTimestamp = typeof entry.timestamp === 'number' ? entry.timestamp : undefined;
                if (typeof candidateTimestamp === 'number' && typeof entryTimestamp === 'number') {
                  const diff = Math.abs(candidateTimestamp - entryTimestamp);
                  if (diff > 180) {
                    continue;
                  }
                  if (diff < matchedLocalScore) {
                    matchedLocalScore = diff;
                    matchedLocalIndex = index;
                  }
                  continue;
                }

                if (matchedLocalIndex === -1) {
                  matchedLocalIndex = index;
                }
              }

              if (matchedLocalIndex >= 0) {
                const pruned = [...existingForDedupe];
                pruned.splice(matchedLocalIndex, 1);
                next[key] = pruned;
              }
            }

            const existing = next[key] ?? [];
            let existingIds = existingIdsByContact.get(key);
            if (!existingIds) {
              existingIds = new Set(existing.map((message) => message.id));
              existingIdsByContact.set(key, existingIds);
            }

            if (existingIds.has(entry.id)) {
              continue;
            }

            existingIds.add(entry.id);

            next[key] = [
              ...existing,
              {
                id: entry.id,
                direction: entry.direction,
                text: entry.text,
                senderAddress: entry.direction === 'outgoing' ? requestedWalletAddress : entry.contact,
                replyToMessageId: entry.replyToMessageId,
                replyToText: entry.replyToText,
                replyToTxHash: entry.replyToTxHash,
                replyToBlockNumber: entry.replyToBlockNumber,
                replyToLogIndex: entry.replyToLogIndex,
                reactionToTxHash: entry.reactionToTxHash,
                reactionToBlockNumber: entry.reactionToBlockNumber,
                reactionToLogIndex: entry.reactionToLogIndex,
                reactionEmoji: entry.reactionEmoji,
                timestamp: entry.timestamp,
                blockNumber: entry.blockNumber,
                logIndex: entry.logIndex,
                txHash: entry.txHash
              }
            ];
          }

          return normalizeMessagesByContact(next);
        });
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nicknameLookupAddresses = Array.from(
        new Set([...Array.from(discoveredContacts), ...contacts.map((c) => c.address)])
      );
      const onChainNicknames = await fetchOnChainNicknames(nicknameLookupAddresses);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setContacts((previous) => {
        const mergedContacts = mergeUniqueContacts(previous, Array.from(discoveredContacts));

        return mergedContacts.map((contact) => {
          const key = contact.address.toLowerCase();
          const nickname = discoveredNicknames.get(key) ?? onChainNicknames.get(key);
          const discoveredConversationState = discoveredConversationStates.get(key)?.state;

          let nextContact = contact;
          if (nickname && contact.name !== nickname) {
            nextContact = { ...nextContact, name: nickname };
          }

          if (discoveredConversationState) {
            nextContact = applyConversationPreferenceStateToContact(
              nextContact,
              discoveredConversationState
            );
          }
          return nextContact;
        });
      });
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (latestStateBackup) {
        applyStateBackupPayload(
          walletKey,
          latestStateBackup.payload,
          latestStateBackup.blockNumber
        );
      }

      const unreadCandidateAddresses = Array.from(
        new Set([...Array.from(discoveredContacts), ...contacts.map((contact) => contact.address)])
      )
        .map((address) => address.trim().toLowerCase())
        .filter((address) => isWalletAddress(address) && address !== walletKey);

      if (unreadCandidateAddresses.length > 0) {
        const latestTimes = unreadCandidateAddresses.map((address) => {
          const observed = latestIncomingMessageTimeByContact.get(address) ?? 0;
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
          return [address, Math.max(observed, latestIncomingFromLocal)] as const;
        });

        const candidateSet = new Set(unreadCandidateAddresses);
        const activeKey = activeContact?.toLowerCase();
        const pageVisible =
          typeof document !== 'undefined' &&
          !document.hidden &&
          (typeof document.hasFocus === 'function' ? document.hasFocus() : true);
        const globalReadTs = lastReadAllTsRef.current;
        const nextReadByContact = { ...lastReadByContactRef.current };
        let readByContactChanged = false;
        const previousUnread = unreadMapRef.current || {};
        const nextUnread = { ...previousUnread };
        let unreadChanged = false;

        for (const [address, latestMessageTime] of latestTimes) {
          if (address === activeKey && pageVisible && latestMessageTime > 0) {
            const existingReadTs = nextReadByContact[address] ?? 0;
            if (latestMessageTime > existingReadTs) {
              nextReadByContact[address] = latestMessageTime;
              readByContactChanged = true;
            }
          }

          const contactReadTs = nextReadByContact[address] ?? 0;
          const effectiveReadTs = Math.max(globalReadTs, contactReadTs);
          const shouldSuppressNotificationsForContact =
            notificationSuppressedContactAddressSet.has(address);
          const shouldUnread =
            !shouldSuppressNotificationsForContact &&
            latestMessageTime > effectiveReadTs &&
            !(address === activeKey && pageVisible);
          if (shouldUnread) {
            if (!nextUnread[address]) {
              nextUnread[address] = true;
              unreadChanged = true;
            }
          } else if (nextUnread[address]) {
            delete nextUnread[address];
            unreadChanged = true;
          }
        }

        for (const existingKey of Object.keys(nextUnread)) {
          if (!candidateSet.has(existingKey)) {
            delete nextUnread[existingKey];
            unreadChanged = true;
          }
        }

        if (unreadChanged) {
          unreadMapRef.current = nextUnread;
          setUnreadMap(nextUnread);
        }

        if (readByContactChanged) {
          lastReadByContactRef.current = nextReadByContact;
        }
      }

      const knownBackupBlockNumber =
        latestStateBackup?.blockNumber ?? lastStateBackupBlockRef.current[walletKey];
      const lastAutoBackupAttemptBlock = lastAutoBackupAttemptBlockRef.current[walletKey] ?? -AUTO_STATE_BACKUP_RETRY_BLOCKS;
      const blocksSinceAutoBackupAttempt = latestBlock - lastAutoBackupAttemptBlock;
      const hasLocalStateSnapshot =
        normalizeLastReadAllTs(lastReadAllTsRef.current) > 0;
      const shouldAutoBackupForDistance =
        hasLocalStateSnapshot &&
        typeof knownBackupBlockNumber === 'number' &&
        latestBlock - knownBackupBlockNumber >= AUTO_STATE_BACKUP_BLOCK_DISTANCE &&
        blocksSinceAutoBackupAttempt >= AUTO_STATE_BACKUP_RETRY_BLOCKS;

      if (shouldAutoBackupForDistance) {
        lastAutoBackupAttemptBlockRef.current[walletKey] = latestBlock;
        backupLocalStateToSelf({ force: true, background: true }).catch(() => {});
      }

      if ((options?.updateHead || !options?.contactsOnly) && typeof options?.toBlock !== 'number') {
        lastSyncedBlockRef.current[walletKey] = latestBlock;
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

    } catch (syncError) {
      try {
        console.error('[sync] error', syncError);
      } catch {}
      if (!options?.background) {
        const message = syncError instanceof Error ? syncError.message : 'Failed to sync history.';
        setError(message);
      }
    } finally {
      syncingHistoryRef.current = false;
      if (!options?.background) {
        setSyncingHistory(false);
      }

      const pendingOptions = pendingSyncOptionsRef.current;
      pendingSyncOptionsRef.current = null;
      if (pendingOptions) {
        syncConversationHistory(pendingOptions).catch(() => {});
      }
    }
  };

  useEffect(() => {
    syncConversationHistoryRef.current = syncConversationHistory;
  }, [syncConversationHistory]);

  const loadOlderMessagesForActiveContact = async () => {
    if (
      loadingOlderHistoryRef.current ||
      syncingHistoryRef.current ||
      !walletAddress ||
      !activeContact ||
      !hasAesReady
    ) {
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    const walletKey = requestedWalletKey;
    const contactAddress = activeContact.trim();
    if (!isWalletAddress(contactAddress)) {
      return;
    }

    const contactKey = contactAddress.toLowerCase();
    if (hasOlderHistoryByContactRef.current[contactKey] === false) {
      return;
    }

    try {
      loadingOlderHistoryRef.current = true;
      setLoadingOlderHistory(true);
      setError('');

      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const cachedConversationRange = conversationRangeByContactRef.current[contactKey];
      const resolvedConversationRange =
        cachedConversationRange ??
        (await resolveConversationBlockRange(contract, requestedWalletAddress, contactAddress));
      if (!resolvedConversationRange || resolvedConversationRange.lastBlock <= 0) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }
      conversationRangeByContactRef.current[contactKey] = resolvedConversationRange;
      const conversationFirstBlock = Math.max(0, resolvedConversationRange.firstBlock);
      const cappedConversationLastBlock = Math.min(latestBlock, resolvedConversationRange.lastBlock);
      if (cappedConversationLastBlock < conversationFirstBlock) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }

      const knownEarliest = oldestLoadedBlockByContactRef.current[contactKey];
      const knownMessages = messagesByContact[contactKey] ?? [];
      const knownEarliestFromMessages = knownMessages.reduce<number | undefined>((min, message) => {
        if (typeof message.blockNumber !== 'number') {
          return min;
        }

        if (typeof min !== 'number' || message.blockNumber < min) {
          return message.blockNumber;
        }

        return min;
      }, undefined);

      const upperExclusive =
        typeof knownEarliest === 'number'
          ? knownEarliest
          : typeof knownEarliestFromMessages === 'number'
            ? knownEarliestFromMessages
            : cappedConversationLastBlock + 1;

      const toBlock = upperExclusive - 1;
      if (toBlock < conversationFirstBlock) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }

      const fromBlock = Math.max(conversationFirstBlock, toBlock - HISTORY_PAGINATION_BLOCK_WINDOW + 1);

      const incomingFilter = contract.filters.MessageSubmitted(requestedWalletAddress, contactAddress);
      const outgoingFilter = contract.filters.MessageSubmitted(contactAddress, requestedWalletAddress);
      const [incomingLogs, outgoingLogs] = await Promise.all([
        contract.queryFilter(incomingFilter, fromBlock, toBlock),
        contract.queryFilter(outgoingFilter, fromBlock, toBlock)
      ]);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      oldestLoadedBlockByContactRef.current[contactKey] = fromBlock;
      if (fromBlock <= conversationFirstBlock) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
      }

      const blockNumbers = new Set<number>();
      for (const log of incomingLogs) {
        blockNumbers.add(log.blockNumber);
      }
      for (const log of outgoingLogs) {
        blockNumbers.add(log.blockNumber);
      }

      const blockTimestampMap = new Map<number, number>();
      const blockTimestampCache = blockTimestampCacheRef.current;
      await Promise.all(
        Array.from(blockNumbers).map(async (blockNumber) => {
          const cachedTimestamp = blockTimestampCache.get(blockNumber);
          if (typeof cachedTimestamp === 'number') {
            blockTimestampMap.set(blockNumber, cachedTimestamp);
            return;
          }

          const block = await readProvider.getBlock(blockNumber);
          if (block?.timestamp) {
            const timestamp = Number(block.timestamp);
            blockTimestampMap.set(blockNumber, timestamp);
            blockTimestampCache.set(blockNumber, timestamp);
          }
        })
      );
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const entries: HistoryEntry[] = [];
      const discoveredNicknames = new Map<string, string>();

      for (const log of incomingLogs) {
        const args = (log as { args?: Record<string, unknown> }).args;
        const from = String(args?.from ?? '');
        if (!isWalletAddress(from) || from.toLowerCase() !== contactKey) {
          continue;
        }

        const userCiphertext = extractUserCiphertext(args?.messageForRecipient);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;

        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const decrypted = await signer.decryptValue(userCiphertext as never);
            const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
            const plain = decodeMemoPlaintext(raw);
            if (from.toLowerCase() === walletKey) {
              const backupPayload = parseStateBackupText(plain);
              if (backupPayload) {
                continue;
              }
            }

            const parsedMessage = parseChatMessagePayload(plain);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
            if (parsedMessage.embeddedNickname) {
              discoveredNicknames.set(from.toLowerCase(), parsedMessage.embeddedNickname);
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-in`,
          contact: from,
          direction: 'incoming',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      for (const log of outgoingLogs) {
        const args = (log as { args?: Record<string, unknown> }).args;
        const recipient = String(args?.recipient ?? '');
        if (!isWalletAddress(recipient) || recipient.toLowerCase() !== contactKey) {
          continue;
        }

        const userCiphertext = extractUserCiphertext(args?.messageForSender);
        let messageText = '(Unable to decrypt message)';
        let replyToMessageId: string | undefined;
        let replyToText: string | undefined;
        let replyToTxHash: string | undefined;
        let replyToBlockNumber: number | undefined;
        let replyToLogIndex: number | undefined;
        let reactionToTxHash: string | undefined;
        let reactionToBlockNumber: number | undefined;
        let reactionToLogIndex: number | undefined;
        let reactionEmoji: string | undefined;

        if (userCiphertext && userCiphertext.value.length > 0) {
          try {
            const decrypted = await signer.decryptValue(userCiphertext as never);
            const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
            const plain = decodeMemoPlaintext(raw);
            if (recipient.toLowerCase() === walletKey) {
              const backupPayload = parseStateBackupText(plain);
              // self-message logs are also present in incoming logs; skip here to avoid duplicates
              if (backupPayload) {
                continue;
              }
              continue;
            }

            const parsedMessage = parseChatMessagePayload(plain);
            messageText = parsedMessage.cleanText;
            replyToMessageId = parsedMessage.replyToMessageId;
            replyToText = parsedMessage.replyToText;
            replyToTxHash = parsedMessage.replyToTxHash;
            replyToBlockNumber = parsedMessage.replyToBlockNumber;
            replyToLogIndex = parsedMessage.replyToLogIndex;
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
            reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
            reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
            reactionEmoji = parsedMessage.embeddedReaction?.emoji;
            if (parsedMessage.embeddedContactName) {
              discoveredNicknames.set(recipient.toLowerCase(), parsedMessage.embeddedContactName);
            }
            if (
              messageText.trim().length === 0 &&
              (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
            ) {
              continue;
            }
          } catch {
            messageText = '(Unable to decrypt message)';
          }
        }

        entries.push({
          id: `${log.transactionHash}-${log.index}-out`,
          contact: recipient,
          direction: 'outgoing',
          text: messageText,
          replyToMessageId,
          replyToText,
          replyToTxHash,
          replyToBlockNumber,
          replyToLogIndex,
          reactionToTxHash,
          reactionToBlockNumber,
          reactionToLogIndex,
          reactionEmoji,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      if (entries.length > 0) {
        entries.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) {
            return a.blockNumber - b.blockNumber;
          }
          return a.logIndex - b.logIndex;
        });

        setMessagesByContact((previous) => {
          const next: Record<string, ChatMessage[]> = { ...previous };
          const existing = next[contactKey] ?? [];
          const existingIds = new Set(existing.map((message) => message.id));
          const additions: ChatMessage[] = [];

          for (const entry of entries) {
            if (existingIds.has(entry.id)) {
              continue;
            }

            additions.push({
              id: entry.id,
              direction: entry.direction,
              text: entry.text,
              senderAddress: entry.direction === 'outgoing' ? requestedWalletAddress : entry.contact,
              replyToMessageId: entry.replyToMessageId,
              replyToText: entry.replyToText,
              replyToTxHash: entry.replyToTxHash,
              replyToBlockNumber: entry.replyToBlockNumber,
              replyToLogIndex: entry.replyToLogIndex,
              reactionToTxHash: entry.reactionToTxHash,
              reactionToBlockNumber: entry.reactionToBlockNumber,
              reactionToLogIndex: entry.reactionToLogIndex,
              reactionEmoji: entry.reactionEmoji,
              timestamp: entry.timestamp,
              blockNumber: entry.blockNumber,
              logIndex: entry.logIndex,
              txHash: entry.txHash
            });
          }

          if (additions.length === 0) {
            return previous;
          }

          next[contactKey] = [...existing, ...additions];
          return normalizeMessagesByContact(next);
        });
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const onChainNicknames = await fetchOnChainNicknames([contactAddress]);
      const onChainNicknameForContact = onChainNicknames.get(contactKey);
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      if (discoveredNicknames.size > 0 || onChainNicknameForContact) {
        setContacts((previous) =>
          previous.map((contact) => {
            const nickname =
              discoveredNicknames.get(contact.address.toLowerCase()) ??
              onChainNicknames.get(contact.address.toLowerCase());
            if (!nickname || contact.name === nickname) {
              return contact;
            }

            return {
              ...contact,
              name: nickname
            };
          })
        );
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load older history.';
      setError(message);
    } finally {
      loadingOlderHistoryRef.current = false;
      setLoadingOlderHistory(false);
    }
  };

  useEffect(() => {
    if (
      !activeContact ||
      activeGroupId !== null ||
      syncingHistoryRef.current ||
      loadingOlderHistoryRef.current ||
      !walletAddress ||
      !hasAesReady
    ) {
      return;
    }

    const contactAddress = activeContact.trim();
    if (!isWalletAddress(contactAddress)) {
      return;
    }

    const contactKey = contactAddress.toLowerCase();
    if (autoPrefetchedRecentHistoryByContactRef.current[contactKey]) {
      return;
    }

    if (activeMessages.length > 1) {
      return;
    }

    if (hasOlderHistoryByContactRef.current[contactKey] === false && activeMessages.length > 0) {
      return;
    }

    autoPrefetchedRecentHistoryByContactRef.current[contactKey] = true;
    loadOlderMessagesForActiveContact().catch(() => {
      delete autoPrefetchedRecentHistoryByContactRef.current[contactKey];
    });
  }, [activeContact, activeGroupId, activeMessages.length, walletAddress, hasAesReady]);

  const syncGroupData = async (options?: SyncGroupOptions) => {
    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress) || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    if (syncGroupDataInFlightRef.current) {
      const pending = pendingGroupSyncOptionsRef.current;
      pendingGroupSyncOptionsRef.current = {
        deep: Boolean(options?.deep || pending?.deep),
        background: Boolean((options?.background ?? true) && (pending?.background ?? true)),
        overviewOnly: pending ? Boolean(options?.overviewOnly && pending.overviewOnly) : Boolean(options?.overviewOnly)
      };
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
      const groupIdFromArgs = (value: unknown): number => {
        const parsed = toSafeNumber(value);
        return parsed > 0 ? parsed : 0;
      };

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

        for (const log of [
          ...inviteCreatedLogs,
          ...inviteAcceptedForMeLogs,
          ...inviteDeclinedLogs,
          ...inviteRevokedLogs
        ]) {
          const args = (log as { args?: Record<string, unknown> }).args;
          const groupId = groupIdFromArgs(args?.groupId);
          if (groupId > 0) {
            knownGroupIds.add(groupId);
          }
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

        for (const log of memberRemovedLogs) {
          const args = (log as { args?: Record<string, unknown> }).args;
          const groupId = groupIdFromArgs(args?.groupId);
          if (groupId > 0) {
            removedGroupIdsForWallet.add(groupId);
            const nextEvent = {
              blockNumber: log.blockNumber,
              logIndex: log.index,
              marker: `${log.blockNumber}:${log.index}:${log.transactionHash.toLowerCase()}`
            };
            const existingEvent = removedGroupEventById.get(groupId);
            if (
              !existingEvent ||
              nextEvent.blockNumber > existingEvent.blockNumber ||
              (nextEvent.blockNumber === existingEvent.blockNumber && nextEvent.logIndex > existingEvent.logIndex)
            ) {
              removedGroupEventById.set(groupId, nextEvent);
            }
          }
        }

        for (const log of [
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
        ]) {
          const args = (log as { args?: Record<string, unknown> }).args;
          const groupId = groupIdFromArgs(args?.groupId);
          if (groupId > 0) {
            knownGroupIds.add(groupId);
          }
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
          delete groupMessageLastSyncedBlockRef.current[messageSyncKey];
        }
      }

      if (selectedActiveGroupId !== null && !nextGroups.some((group) => group.id === selectedActiveGroupId)) {
        setActiveGroupId(null);
      }

      groupOverviewLastSyncedBlockRef.current[walletKey] = latestBlock;
      const latestIncomingByGroup = new Map<string, number>();

      if (!options?.overviewOnly && selectedActiveGroupId !== null) {
        const groupId = selectedActiveGroupId;
        const groupMessageSyncKey = `${walletKey}:${groupId}`;
        const previousGroupMessageBlock = groupMessageLastSyncedBlockRef.current[groupMessageSyncKey];
        const activeGroupLastMessageBlock = toSafeNumber(
          await contract.lastMessageBlockForGroup(groupId).catch(() => null)
        );
        if (currentWalletKeyRef.current !== requestedWalletKey) {
          return;
        }
        const hasNewGroupActivity =
          Boolean(options?.deep) ||
          typeof previousGroupMessageBlock !== 'number' ||
          activeGroupLastMessageBlock <= 0 ||
          activeGroupLastMessageBlock > previousGroupMessageBlock;

        if (!hasNewGroupActivity) {
          groupMessageLastSyncedBlockRef.current[groupMessageSyncKey] = latestBlock;
          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }
        }

        const groupFromBlock = options?.deep
          ? 0
          : typeof previousGroupMessageBlock === 'number'
            ? previousGroupMessageBlock + 1
            : Math.max(0, latestBlock - INITIAL_SYNC_LOOKBACK_BLOCKS);

        if (hasNewGroupActivity && groupFromBlock <= latestBlock) {
          const [incomingLogs, outgoingLogs, memberAddedLogs, memberRemovedLogsForGroup, memberLeftLogs] = await Promise.all([
            contract.queryFilter(contract.filters.GroupMessageDelivered(groupId, null, requestedWalletAddress), groupFromBlock, latestBlock),
            contract.queryFilter(contract.filters.GroupMessageSubmitted(groupId, requestedWalletAddress), groupFromBlock, latestBlock),
            contract.queryFilter(contract.filters.GroupMemberAdded(groupId, null), groupFromBlock, latestBlock),
            contract.queryFilter(contract.filters.GroupMemberRemoved(groupId, null), groupFromBlock, latestBlock),
            contract.queryFilter(contract.filters.GroupMemberLeft(groupId, null), groupFromBlock, latestBlock)
          ]);
          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }

          const blockNumbers = new Set<number>();
          for (const log of incomingLogs) {
            blockNumbers.add(log.blockNumber);
          }
          for (const log of outgoingLogs) {
            blockNumbers.add(log.blockNumber);
          }
          for (const log of memberAddedLogs) {
            blockNumbers.add(log.blockNumber);
          }
          for (const log of memberRemovedLogsForGroup) {
            blockNumbers.add(log.blockNumber);
          }
          for (const log of memberLeftLogs) {
            blockNumbers.add(log.blockNumber);
          }

          const blockTimestampMap = new Map<number, number>();
          const blockTimestampCache = blockTimestampCacheRef.current;
          await Promise.all(
            Array.from(blockNumbers).map(async (blockNumber) => {
              const cachedTimestamp = blockTimestampCache.get(blockNumber);
              if (typeof cachedTimestamp === 'number') {
                blockTimestampMap.set(blockNumber, cachedTimestamp);
                return;
              }

              const block = await readProvider.getBlock(blockNumber);
              if (block?.timestamp) {
                const timestamp = Number(block.timestamp);
                blockTimestampMap.set(blockNumber, timestamp);
                blockTimestampCache.set(blockNumber, timestamp);
              }
            })
          );
          if (currentWalletKeyRef.current !== requestedWalletKey) {
            return;
          }

          const entries: GroupMessageEntry[] = [];
          for (const log of incomingLogs) {
            const args = (log as { args?: Record<string, unknown> }).args;
            const from = String(args?.from ?? '').trim();
            if (!isWalletAddress(from)) {
              continue;
            }

            const userCiphertext = extractUserCiphertext(args?.messageForRecipient);
            let messageText = '(Unable to decrypt message)';
            let replyToMessageId: string | undefined;
            let replyToText: string | undefined;
            let replyToTxHash: string | undefined;
            let replyToBlockNumber: number | undefined;
            let replyToLogIndex: number | undefined;
            let reactionToTxHash: string | undefined;
            let reactionToBlockNumber: number | undefined;
            let reactionToLogIndex: number | undefined;
            let reactionEmoji: string | undefined;
            if (userCiphertext && userCiphertext.value.length > 0) {
              try {
                const decrypted = await signer.decryptValue(userCiphertext as never);
                const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
                const plain = decodeMemoPlaintext(raw);
                const parsedMessage = parseChatMessagePayload(plain);
                messageText = parsedMessage.cleanText;
                replyToMessageId = parsedMessage.replyToMessageId;
                replyToText = parsedMessage.replyToText;
                replyToTxHash = parsedMessage.replyToTxHash;
                replyToBlockNumber = parsedMessage.replyToBlockNumber;
                replyToLogIndex = parsedMessage.replyToLogIndex;
                reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
                reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
                reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
                reactionEmoji = parsedMessage.embeddedReaction?.emoji;
                if (
                  messageText.trim().length === 0 &&
                  (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
                ) {
                  continue;
                }
              } catch {
                messageText = '(Unable to decrypt message)';
              }
            }

            entries.push({
              id: `${log.transactionHash}-${log.index}-group-in`,
              groupId,
              direction: 'incoming',
              text: messageText,
              senderAddress: from,
              replyToMessageId,
              replyToText,
              replyToTxHash,
              replyToBlockNumber,
              replyToLogIndex,
              reactionToTxHash,
              reactionToBlockNumber,
              reactionToLogIndex,
              reactionEmoji,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.index,
              timestamp: blockTimestampMap.get(log.blockNumber)
            });
          }

          for (const log of outgoingLogs) {
            const args = (log as { args?: Record<string, unknown> }).args;
            const userCiphertext = extractUserCiphertext(args?.messageForSender);
            let messageText = '(Unable to decrypt message)';
            let replyToMessageId: string | undefined;
            let replyToText: string | undefined;
            let replyToTxHash: string | undefined;
            let replyToBlockNumber: number | undefined;
            let replyToLogIndex: number | undefined;
            let reactionToTxHash: string | undefined;
            let reactionToBlockNumber: number | undefined;
            let reactionToLogIndex: number | undefined;
            let reactionEmoji: string | undefined;
            if (userCiphertext && userCiphertext.value.length > 0) {
              try {
                const decrypted = await signer.decryptValue(userCiphertext as never);
                const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
                const plain = decodeMemoPlaintext(raw);
                const parsedMessage = parseChatMessagePayload(plain);
                messageText = parsedMessage.cleanText;
                replyToMessageId = parsedMessage.replyToMessageId;
                replyToText = parsedMessage.replyToText;
                replyToTxHash = parsedMessage.replyToTxHash;
                replyToBlockNumber = parsedMessage.replyToBlockNumber;
                replyToLogIndex = parsedMessage.replyToLogIndex;
                reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
                reactionToBlockNumber = parsedMessage.embeddedReaction?.targetBlockNumber;
                reactionToLogIndex = parsedMessage.embeddedReaction?.targetLogIndex;
                reactionEmoji = parsedMessage.embeddedReaction?.emoji;
                if (
                  messageText.trim().length === 0 &&
                  (parsedMessage.embeddedContactName || parsedMessage.embeddedConversationState)
                ) {
                  continue;
                }
              } catch {
                messageText = '(Unable to decrypt message)';
              }
            }

            entries.push({
              id: `${log.transactionHash}-${log.index}-group-out`,
              groupId,
              direction: 'outgoing',
              text: messageText,
              senderAddress: requestedWalletAddress,
              replyToMessageId,
              replyToText,
              replyToTxHash,
              replyToBlockNumber,
              replyToLogIndex,
              reactionToTxHash,
              reactionToBlockNumber,
              reactionToLogIndex,
              reactionEmoji,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.index,
              timestamp: blockTimestampMap.get(log.blockNumber)
            });
          }

          for (const log of memberAddedLogs) {
            const args = (log as { args?: Record<string, unknown> }).args;
            const account = String(args?.account ?? '').trim();
            entries.push({
              id: `${log.transactionHash}-${log.index}-group-member-added`,
              groupId,
              direction: 'incoming',
              text: formatGroupMembershipEventText('added', account),
              senderAddress: account,
              isSystem: true,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.index,
              timestamp: blockTimestampMap.get(log.blockNumber)
            });
          }

          for (const log of memberRemovedLogsForGroup) {
            const args = (log as { args?: Record<string, unknown> }).args;
            const account = String(args?.account ?? '').trim();
            entries.push({
              id: `${log.transactionHash}-${log.index}-group-member-removed`,
              groupId,
              direction: 'incoming',
              text: formatGroupMembershipEventText('removed', account),
              senderAddress: account,
              isSystem: true,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.index,
              timestamp: blockTimestampMap.get(log.blockNumber)
            });
          }

          for (const log of memberLeftLogs) {
            const args = (log as { args?: Record<string, unknown> }).args;
            const account = String(args?.account ?? '').trim();
            entries.push({
              id: `${log.transactionHash}-${log.index}-group-member-left`,
              groupId,
              direction: 'incoming',
              text: formatGroupMembershipEventText('left', account),
              senderAddress: account,
              isSystem: true,
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.index,
              timestamp: blockTimestampMap.get(log.blockNumber)
            });
          }

          entries.sort((left, right) => {
            if (left.blockNumber !== right.blockNumber) {
              return left.blockNumber - right.blockNumber;
            }
            return left.logIndex - right.logIndex;
          });

          const latestIncomingFromEntries = entries.reduce((max, entry) => {
            if (entry.direction !== 'incoming' || typeof entry.timestamp !== 'number') {
              return max;
            }
            const ts = Number(entry.timestamp);
            return ts > max ? ts : max;
          }, 0);
          if (latestIncomingFromEntries > 0) {
            latestIncomingByGroup.set(String(groupId), latestIncomingFromEntries);
          }

          if (entries.length > 0) {
            if (currentWalletKeyRef.current !== requestedWalletKey) {
              return;
            }
            if (selectedActiveGroupId === groupId) {
              const activeGroupKey = String(groupId);
              const existingGroupMessages = messagesByGroup[activeGroupKey] ?? [];
              if (stickToBottomRef.current || existingGroupMessages.length === 0) {
                pendingForcedBottomAnchorThreadKeyRef.current = `group:${groupId}`;
              }
            }
            setMessagesByGroup((previous) => {
              const groupKey = String(groupId);
              const existing = previous[groupKey] ?? [];
              const confirmedOutgoingTxHashes = new Set(
                entries
                  .filter((entry) => entry.direction === 'outgoing')
                  .map((entry) => entry.txHash.toLowerCase())
              );
              const prunedExisting = existing.filter((message) => {
                if (!message.id.startsWith('local-group-')) {
                  return true;
                }
                if (!message.txHash) {
                  return true;
                }
                return !confirmedOutgoingTxHashes.has(message.txHash.toLowerCase());
              });

              const nextMessages = [...prunedExisting];
              const existingIds = new Set(nextMessages.map((message) => message.id));
              for (const entry of entries) {
                if (existingIds.has(entry.id)) {
                  continue;
                }

                existingIds.add(entry.id);
                nextMessages.push({
                  id: entry.id,
                  direction: entry.direction,
                  text: entry.text,
                  senderAddress: entry.senderAddress,
                  isSystem: entry.isSystem,
                  replyToMessageId: entry.replyToMessageId,
                  replyToText: entry.replyToText,
                  replyToTxHash: entry.replyToTxHash,
                  replyToBlockNumber: entry.replyToBlockNumber,
                  replyToLogIndex: entry.replyToLogIndex,
                  reactionToTxHash: entry.reactionToTxHash,
                  reactionToBlockNumber: entry.reactionToBlockNumber,
                  reactionToLogIndex: entry.reactionToLogIndex,
                  reactionEmoji: entry.reactionEmoji,
                  timestamp: entry.timestamp,
                  blockNumber: entry.blockNumber,
                  logIndex: entry.logIndex,
                  txHash: entry.txHash
                });
              }

              return {
                ...previous,
                [groupKey]: sortMessagesChronologically(nextMessages)
              };
            });
          }
        }

        groupMessageLastSyncedBlockRef.current[groupMessageSyncKey] = latestBlock;
      }
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

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
        const { signer, cacheKey } = await getMemoSigner();
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
        const nextOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
        }));
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
    [walletAddress, hasAesReady, isActiveGroupAdmin, chainId]
  );

  const revokeJoinCodeForActiveGroup = async (
    codeHashInput: string,
    displayCode?: string
  ) => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await revokeGroupJoinCode({
        signer,
        groupId: activeGroupId,
        codeHash: normalizedCodeHash
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

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
  };

  const createGroup = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await createGroupOnChain({
        signer,
        title,
        isPrivate: newGroupIsPrivate,
        initialMembers
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

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
  };

  const inviteMembersToActiveGroup = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await inviteMembersToGroupOnChain({
        signer,
        groupId: activeGroupId,
        accounts,
        ttlSeconds: ttlParsed
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      setGroupInviteMembersInput('');
      await syncGroupData({ deep: true });
    } catch (inviteError) {
      const message = getGroupActionErrorMessage(inviteError, 'Failed to send invites.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  };

  const generateJoinCodeForActiveGroup = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      const nextJoinCode = await createGroupJoinCode({
        groupId: activeGroupId,
        signer,
        requestedWalletAddress,
        ttlSeconds,
        groupJoinCodeMode,
        groupJoinCodeMaxUsesInput
      });
      setGeneratedGroupInviteCode(nextJoinCode.generatedGroupInviteCode);
      setGeneratedGroupJoinCodeHash(nextJoinCode.codeHash);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      loadActiveJoinCodesForGroup(activeGroupId, { silent: true }).catch(() => {});
      await syncGroupData({ background: true });
    } catch (joinCodeError) {
      const message = getGroupActionErrorMessage(joinCodeError, 'Failed to create join code.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  };

  const revokeGeneratedJoinCodeForActiveGroup = async () => {
    setError('');

    if (!/^0x[a-fA-F0-9]{64}$/.test(generatedGroupJoinCodeHash)) {
      setError('No generated join code is available to revoke in this session.');
      return;
    }

    const generatedJoinCode = parseGroupInviteCode(generatedGroupInviteCode);
    const displayCode = generatedJoinCode && generatedJoinCode.version === 2 ? generatedJoinCode.code : undefined;
    await revokeJoinCodeForActiveGroup(generatedGroupJoinCodeHash, displayCode);
  };

  const joinGroupWithCode = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await joinWithGroupCode({
        signer,
        parsedJoinCode,
        chainId,
        nowTs
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

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
  };

  const removeMemberFromActiveGroup = async (account: string) => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await removeMemberFromGroupOnChain({
        signer,
        groupId: activeGroupId,
        account
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await syncGroupData({ deep: true });
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : 'Failed to remove member.';
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  };

  const beginRenameActiveGroup = () => {
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
  };

  const cancelRenameActiveGroup = () => {
    setGroupRenameOpen(false);
    setGroupRenameInput('');
  };

  const renameActiveGroup = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await renameGroupOnChain({
        signer,
        groupId,
        title: nextTitle,
        isPrivate: Boolean(activeGroupMeta?.isPrivate)
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      cancelRenameActiveGroup();
      await syncGroupData({ deep: true });
    } catch (renameError) {
      const message = getGroupActionErrorMessage(renameError, 'Failed to rename group.');
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  };

  const leaveActiveGroup = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await leaveGroupOnChain({
        signer,
        groupId
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

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
  };

  const handoffAdminAndLeaveActiveGroup = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await handoffAdminAndLeaveGroupOnChain({
        signer,
        groupId
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

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
  };

  const disbandActiveGroup = async () => {
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
      const { signer, cacheKey } = await getMemoSigner();
      await disbandGroupOnChain({
        signer,
        groupId
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

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
  };

  const acceptGroupInvite = async (groupId: number) => {
    setError('');
    try {
      setProcessingGroupAction(true);
      const { signer, cacheKey } = await getMemoSigner();
      await acceptGroupInviteOnChain({
        signer,
        groupId
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await syncGroupData({ deep: true });
      activateGroup(groupId);
    } catch (acceptError) {
      const message = acceptError instanceof Error ? acceptError.message : 'Failed to accept invite.';
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  };

  const declineGroupInvite = async (groupId: number) => {
    setError('');
    try {
      setProcessingGroupAction(true);
      const { signer, cacheKey } = await getMemoSigner();
      await declineGroupInviteOnChain({
        signer,
        groupId
      });

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await syncGroupData({ deep: true });
    } catch (declineError) {
      const message = declineError instanceof Error ? declineError.message : 'Failed to decline invite.';
      setError(message);
    } finally {
      setProcessingGroupAction(false);
    }
  };

  const sendGroupMessage = async (overrideMessageText?: string) => {
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
    const replyingPreviewText = replyingToMessage ? getMessageDisplayText(replyingToMessage.text) : undefined;
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
            replyToMessageId: replyingToMessage?.id,
            replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
            replyToTxHash: replyingToMessage?.txHash,
            replyToBlockNumber: replyingToMessage?.blockNumber,
            replyToLogIndex: replyingToMessage?.logIndex,
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

      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyingToMessage?.txHash,
        replyingToMessage?.blockNumber,
        replyingToMessage?.logIndex,
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

      setMessageInput('');
      setReplyingToMessage(null);
      await syncGroupData({ background: true });
      setTopUpMetricsNonce((previous) => previous + 1);
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
  };

  const syncContactNameAliasFromInput = async (contactAddress: string, contactName: string): Promise<void> => {
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
  };

  const syncConversationStateFromInput = async (
    contactAddress: string,
    state: ConversationPreferenceState,
    visibleNotice = ''
  ): Promise<boolean> => {
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
      syncConversationHistory({ updateHead: true }).catch(() => {});
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

    if (sendingReaction) {
      return;
    }

    const normalizedEmoji = normalizeReactionEmoji(emojiInput);
    if (!normalizedEmoji) {
      setError('Choose a valid emoji reaction.');
      return;
    }

    const targetTxHash = targetMessage.txHash?.trim().toLowerCase() ?? '';
    if (!/^0x[a-f0-9]{64}$/.test(targetTxHash)) {
      setError('Wait for the message to confirm on-chain before adding a reaction.');
      return;
    }

    const targetReferenceKeyCandidates = buildMessageReferenceKeys({
      txHash: targetMessage.txHash,
      blockNumber: targetMessage.blockNumber,
      logIndex: targetMessage.logIndex
    });
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

        await syncGroupData({ background: true });
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

        syncConversationHistory({ background: true }).catch(() => {});
      }

      if (activeSignerSource === 'burner') {
        setTopUpMetricsNonce((previous) => previous + 1);
      }
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
    const replyTarget = overrideReplyTarget ?? replyingToMessage;
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

      setMessageInput('');
      setReplyingToMessage(null);
      syncConversationHistory().catch(() => {});
      if (activeSignerSource === 'burner') {
        setTopUpMetricsNonce((previous) => previous + 1);
      }
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

  const createTradeOffer = async (overrideReplyTarget?: ChatMessage | null) => {
    setError('');

    if (sendingRef.current || tipping || creatingTrade) {
      return;
    }

    if (tradeComposerValidationMessage) {
      setError(tradeComposerValidationMessage);
      return;
    }

    if (!activeContact || !selectedTradeOfferToken || !selectedTradeRequestToken) {
      setError('Select a contact and valid trade tokens first.');
      return;
    }

    if (parsedTradeOfferAmountWei === null || parsedTradeOfferAmountWei <= 0n) {
      setError(`Enter a valid ${selectedTradeOfferToken.symbol} amount to send.`);
      return;
    }

    if (parsedTradeRequestAmountWei === null || parsedTradeRequestAmountWei <= 0n) {
      setError(`Enter a valid ${selectedTradeRequestToken.symbol} amount to receive.`);
      return;
    }

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    const pendingCounterContext = tradeCounterContext;
    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress)) {
      setError('Connect a wallet first.');
      return;
    }

    try {
      setCreatingTrade(true);
      if (pendingCounterContext) {
        setProcessingTradeActionId(String(pendingCounterContext.offer.tradeId));
      }
      const { signer, cacheKey } = await getMemoSigner();
      const nativeFeeWei =
        tradeFeeModeSelection === 'coti' ? await resolveRequiredFeeForTradeCreate() : 0n;
      const tokenFeeAmount =
        tradeFeeModeSelection === 'token' ? await resolveRequiredTokenFeeForTradeCreate() : 0n;

      if (pendingCounterContext) {
        const parentSnapshot = await resolveTradeSnapshotForOffer(pendingCounterContext.offer);
        const isParentMaker = pendingCounterContext.offer.maker.toLowerCase() === requestedWalletKey;
        const isParentTaker = pendingCounterContext.offer.taker.toLowerCase() === requestedWalletKey;

        if (!isParentMaker && !isParentTaker) {
          throw new Error('You are no longer a participant in the original trade.');
        }

        const parentTradeStatus = await closeCounterTradeOnChain({
          signer,
          tradeId: pendingCounterContext.offer.tradeId,
          actorRole: isParentMaker ? 'maker' : 'taker'
        });

        setTradeSnapshotsById((previous) => ({
          ...previous,
          [String(pendingCounterContext.offer.tradeId)]: {
            ...(previous[String(pendingCounterContext.offer.tradeId)] ?? parentSnapshot),
            status: parentTradeStatus
          }
        }));
        setTradeCounterContext(null);

        const counterOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], counterOnboardInfo)
        }));
      }

      const expiresAt = Math.floor(Date.now() / 1000) + parsedTradeExpiryHours * 3600;
      const { tradeId } = await createTradeOnChain({
        signer,
        makerAddress: requestedWalletAddress,
        takerAddress: activeContact,
        offerAsset: selectedTradeOfferToken,
        offerAmountWei: parsedTradeOfferAmountWei,
        requestAsset: selectedTradeRequestToken,
        requestAmountWei: parsedTradeRequestAmountWei,
        expiresAt,
        feeMode: tradeFeeModeSelection,
        nativeFeeWei,
        tokenFeeAmount
      });

      const createdAt = Math.floor(Date.now() / 1000);
      const tradeMessagePayload: TradeOfferMessagePayload = {
        version: 2,
        tradeId,
        escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
        maker: requestedWalletAddress,
        taker: activeContact,
        createdAt,
        expiresAt,
        parentTradeId: tradeCounterParentId ?? undefined
      };

      setTradeSnapshotsById((previous) => ({
        ...previous,
        [String(tradeId)]: {
          tradeId,
          maker: requestedWalletAddress,
          taker: activeContact,
          offer: {
            ...selectedTradeOfferToken,
            amount: parsedTradeOfferAmountWei.toString()
          },
          request: {
            ...selectedTradeRequestToken,
            amount: parsedTradeRequestAmountWei.toString()
          },
          createdAt,
          expiresAt,
          status: 'open'
        }
      }));

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }

      setTopUpMetricsNonce((previous) => previous + 1);
      setTradeOfferAmountInput('');
      setTradeRequestAmountInput('');
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeCounterParentId(null);
      setTradeCounterContext(null);
      setTradeComposerOpen(false);
      await sendMessage(buildTradeOfferMessagePayload(tradeMessagePayload), overrideReplyTarget ?? replyingToMessage);
    } catch (tradeError) {
      if (currentWalletKeyRef.current !== requestedWalletKey) {
        return;
      }
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to create trade offer.');
      setError(message);
      if (activeSignerSource === 'burner' && hasInsufficientFundsError(message)) {
        const shouldTopUp = window.confirm(
          'Burner wallet has insufficient funds. Do you want to top up now with your wallet?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithWallet();
        }
      }
    } finally {
      setCreatingTrade(false);
      if (pendingCounterContext) {
        setProcessingTradeActionId('');
      }
    }
  };

  const acceptTradeOffer = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    setError('');

    if (processingTradeActionId || !walletAddress || !isWalletAddress(walletAddress)) {
      return;
    }

    try {
      setProcessingTradeActionId(String(offer.tradeId));
      const snapshot = await resolveTradeSnapshotForOffer(offer);
      const requestAsset = snapshot.request;
      const { signer, cacheKey } = await getMemoSigner();
      const { acceptedTxHash } = await acceptTradeOnChain({
        signer,
        ownerAddress: walletAddress,
        tradeId: offer.tradeId,
        requestAsset
      });

      setTradeSnapshotsById((previous) => ({
        ...previous,
        [String(offer.tradeId)]: {
          ...(previous[String(offer.tradeId)] ?? snapshot),
          status: 'accepted',
          acceptedTxHash
        }
      }));
      setTopUpMetricsNonce((previous) => previous + 1);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await sendMessage(
        buildTradeResponseMessagePayload({
          version: 1,
          tradeId: offer.tradeId,
          action: 'accepted',
          actor: walletAddress,
          createdAt: Math.floor(Date.now() / 1000)
        }),
        sourceMessage
      );
    } catch (tradeError) {
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to accept trade.');
      setError(message);
    } finally {
      setProcessingTradeActionId('');
    }
  };

  const declineTradeOffer = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    setError('');

    if (processingTradeActionId) {
      return;
    }

    try {
      setProcessingTradeActionId(String(offer.tradeId));
      const snapshot = await resolveTradeSnapshotForOffer(offer);
      const { signer, cacheKey } = await getMemoSigner();
      await declineTradeOnChain({
        signer,
        tradeId: offer.tradeId
      });

      setTradeSnapshotsById((previous) => ({
        ...previous,
        [String(offer.tradeId)]: {
          ...(previous[String(offer.tradeId)] ?? snapshot),
          status: 'declined'
        }
      }));
      setTopUpMetricsNonce((previous) => previous + 1);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await sendMessage(
        buildTradeResponseMessagePayload({
          version: 1,
          tradeId: offer.tradeId,
          action: 'declined',
          actor: walletAddress,
          createdAt: Math.floor(Date.now() / 1000)
        }),
        sourceMessage
      );
    } catch (tradeError) {
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to refuse trade.');
      setError(message);
    } finally {
      setProcessingTradeActionId('');
    }
  };

  const cancelTradeOffer = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    setError('');

    if (processingTradeActionId) {
      return;
    }

    try {
      setProcessingTradeActionId(String(offer.tradeId));
      const snapshot = await resolveTradeSnapshotForOffer(offer);
      const { signer, cacheKey } = await getMemoSigner();
      await cancelTradeOnChain({
        signer,
        tradeId: offer.tradeId
      });

      setTradeSnapshotsById((previous) => ({
        ...previous,
        [String(offer.tradeId)]: {
          ...(previous[String(offer.tradeId)] ?? snapshot),
          status: 'cancelled'
        }
      }));
      setTopUpMetricsNonce((previous) => previous + 1);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      await sendMessage(
        buildTradeResponseMessagePayload({
          version: 1,
          tradeId: offer.tradeId,
          action: 'cancelled',
          actor: walletAddress,
          createdAt: Math.floor(Date.now() / 1000)
        }),
        sourceMessage
      );
    } catch (tradeError) {
      const message =
        tradeError instanceof Error
          ? getOnChainFailureMessage(tradeError, tradeError.message)
          : getOnChainFailureMessage(tradeError, 'Failed to cancel trade.');
      setError(message);
    } finally {
      setProcessingTradeActionId('');
    }
  };

  const prepareCounterTrade = async (offer: TradeOfferMessagePayload, sourceMessage: ChatMessage) => {
    const applyAssetSelection = (
      asset: TradeAssetPayload,
      onSelectionChange: (value: TradeTokenPresetKey) => void,
      onCustomAddressChange: (value: string) => void,
      onAmountInputChange: (value: string) => void
    ) => {
      if (asset.kind === 'native') {
        onSelectionChange('coti');
        onCustomAddressChange('');
      } else if (asset.kind === 'private-erc20' && asset.tokenAddress?.toLowerCase() === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
        onSelectionChange('pwisp');
        onCustomAddressChange('');
      } else if (asset.tokenAddress?.toLowerCase() === REWARD_TOKEN_ADDRESS.toLowerCase()) {
        onSelectionChange('wisp');
        onCustomAddressChange('');
      } else {
        onSelectionChange(asset.kind === 'private-erc20' ? 'custom-private' : 'custom-public');
        onCustomAddressChange(asset.tokenAddress ?? '');
      }

      try {
        onAmountInputChange(formatTokenAmount(BigInt(asset.amount), asset.decimals, 6));
      } catch {
        onAmountInputChange('');
      }
    };

    const snapshot = await resolveTradeSnapshotForOffer(offer);

    applyAssetSelection(
      snapshot.request,
      setTradeOfferTokenSelection,
      setTradeOfferCustomTokenAddress,
      setTradeOfferAmountInput
    );
    applyAssetSelection(
      snapshot.offer,
      setTradeRequestTokenSelection,
      setTradeRequestCustomTokenAddress,
      setTradeRequestAmountInput
    );
    setTradeCounterParentId(offer.tradeId);
    setTradeCounterContext({ offer, sourceMessage });
    setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
    setReplyingToMessage(sourceMessage);
    setTipComposerOpen(false);
    setTradeComposerOpen(true);
  };

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
        const tx = await signer.sendTransaction({
          to: recipient,
          value: tipAmount
        });
        await tx.wait();
      } else {
        const tipTokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
        const tx = await tipTokenContract.transfer(recipient, tipAmount);
        await tx.wait();
      }
      transferSucceeded = true;

      setTopUpMetricsNonce((previous) => previous + 1);
      if (tipToken === 'coti') {
        setTipNativeBalanceWei((previous) =>
          previous === null ? previous : previous > tipAmount ? previous - tipAmount : 0n
        );
      } else if (tipToken === 'wisp') {
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
      const tipMemoTx = await contract.submit(recipient, tipMemoTuple, { value: requiredFee });
      await tipMemoTx.wait();
      if (tipToken === 'coti') {
        setTipNativeBalanceWei((previous) =>
          previous === null ? previous : previous > requiredFee ? previous - requiredFee : 0n
        );
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
      syncConversationHistory().catch(() => {});
      setTipAmountInput('');
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

  const loadFullConversationHistory = async () => {
    if (syncingHistoryRef.current) {
      return;
    }

    await syncConversationHistory({ deep: true });
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
    setGroupRequiredFeeWei(null);
    setGroupTokenFeeWei(null);
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
      setActiveMobileView('wallets');
    }
  }, [isConnected]);

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
  }, [activeContact, activeGroupId]);

  useEffect(() => {
    if (!chatComposerRef.current) {
      return;
    }

    const nextValue = messageInput;
    if ((chatComposerRef.current.textContent ?? '') !== nextValue) {
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
        const previousHeight = container.scrollHeight;
        setVisibleThreadMessageCount((current) => {
          const next = Math.min(activeThreadMessages.length, current + VISIBLE_THREAD_MESSAGE_CHUNK);
          if (next > current) {
            suppressNextBottomAnchorRef.current = true;
            pendingThreadWindowScrollRestoreRef.current = {
              threadKey: activeThreadKey,
              previousHeight
            };
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
    chatMessagesViewportVersion
  ]);

  useEffect(() => {
    const pendingRestore = pendingThreadWindowScrollRestoreRef.current;
    const container = chatMessagesRef.current;
    if (!pendingRestore || !container || pendingRestore.threadKey !== activeThreadKey) {
      return;
    }

    pendingThreadWindowScrollRestoreRef.current = null;
    requestAnimationFrame(() => {
      const delta = container.scrollHeight - pendingRestore.previousHeight;
      if (delta > 0) {
        container.scrollTop += delta;
      }
    });
  }, [activeThreadKey, visibleThreadMessageCount, chatMessagesViewportVersion]);

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
      autoPrefetchedRecentHistoryByContactRef.current = {};
      suppressNextBottomAnchorRef.current = false;
      setMessagesByContact({});
      setReplyingToMessage(null);
      setHighlightedMessageId(null);
      lastSyncedBlockRef.current = {};
      oldestLoadedBlockByContactRef.current = {};
      hasOlderHistoryByContactRef.current = {};
      conversationRangeByContactRef.current = {};
      blockTimestampCacheRef.current = new Map();
    }

    previousWalletAddressRef.current = nextWallet;
  }, [walletAddress]);

  useEffect(() => {
    setReactionPickerMessageId(null);
    setTipComposerOpen(false);
    setTipAmountInput('');
  }, [activeThreadKey]);

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
      setRequiredFeeWei(null);
      setBurnerBalanceWei(null);
      setLoadingTopUpQuote(false);
      return;
    }

    const loadTopUpAmount = async () => {
      setLoadingTopUpQuote(true);
      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
        const [requiredFee, burnerBalance] = (await Promise.all([
          readContract.feeAmount(),
          readProvider.getBalance(burnerAddress)
        ])) as [bigint, bigint];
        if (!cancelled) {
          setRequiredFeeWei(requiredFee);
          setBurnerBalanceWei(burnerBalance);
          setTopUpAmountWei(calculateTopUpAmount(requiredFee, topUpMultiplier));
        }
      } catch {
        if (!cancelled) {
          setTopUpAmountWei(null);
          setRequiredFeeWei(null);
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
  }, [burnerAddress, topUpMultiplier, topUpMetricsNonce]);

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
    const requestedWalletAddress = walletAddress.trim();

    if (!requestedWalletAddress || !isWalletAddress(requestedWalletAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setRewardTokenBalanceWei(null);
      setPrivateRewardTokenBalanceWei(null);
      setGroupRequiredFeeWei(null);
      setGroupTokenFeeWei(null);
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
        const privateTokenContract = new cotiEthers.Contract(PRIVATE_REWARD_TOKEN_ADDRESS, PRIVATE_TOKEN_BALANCE_ABI, readProvider);
        const groupContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const swapVaultContract = new cotiEthers.Contract(SWAP_VAULT_CONTRACT_ADDRESS, SWAP_VAULT_CONTRACT_ABI, readProvider);
        const privateTokenInterface = new cotiEthers.Interface(PRIVATE_TOKEN_BALANCE_ABI);

        const [
          rewardBalanceRaw,
          rewardSymbolRaw,
          rewardDecimalsRaw,
          privateSymbolRaw,
          privateDecimalsRaw,
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
          groupContract.feeAmount().catch(() => null),
          groupContract.tokenFeeAmount().catch(() => null),
          groupContract.rewardsContract().catch(() => null),
          groupContract.rewardsPaused().catch(() => null),
          swapVaultContract.swapFeeWei().catch(() => null),
          swapVaultContract.getTokenFeeAmount().catch(() => null)
        ]);

        let privateBalanceWei: bigint | null = null;
        if (hasAesReady) {
          try {
            const { signer, cacheKey } = await getMemoSigner();
            let encryptedPrivateBalanceRaw: unknown = null;
            try {
              const privateBalanceByAddressCallData = privateTokenInterface.encodeFunctionData('balanceOf(address)', [
                requestedWalletAddress
              ]);
              const privateBalanceByAddressRawResult = await readProvider.call({
                to: PRIVATE_REWARD_TOKEN_ADDRESS,
                from: requestedWalletAddress,
                data: privateBalanceByAddressCallData
              });
              const decodedPrivateBalanceByAddress = privateTokenInterface.decodeFunctionResult(
                'balanceOf(address)',
                privateBalanceByAddressRawResult
              );
              encryptedPrivateBalanceRaw = decodedPrivateBalanceByAddress?.[0] ?? null;
            } catch {
              encryptedPrivateBalanceRaw = null;
            }
            if (encryptedPrivateBalanceRaw === null) {
              // Fallback for older private token variants exposing user-bound balanceOf().
              const privateBalanceCallData = privateTokenInterface.encodeFunctionData('balanceOf()', []);
              const privateBalanceRawResult = await readProvider.call({
                to: PRIVATE_REWARD_TOKEN_ADDRESS,
                from: requestedWalletAddress,
                data: privateBalanceCallData
              });
              const decodedPrivateBalance = privateTokenInterface.decodeFunctionResult('balanceOf()', privateBalanceRawResult);
              encryptedPrivateBalanceRaw = decodedPrivateBalance?.[0] ?? null;
            }
            if (encryptedPrivateBalanceRaw !== null) {
              const decrypted = await signer.decryptValue(encryptedPrivateBalanceRaw as never);
              const decryptedAsBigint =
                typeof decrypted === 'bigint'
                  ? decrypted
                  : /^\d+$/.test(String(decrypted).trim())
                    ? BigInt(String(decrypted).trim())
                    : null;
              privateBalanceWei =
                decryptedAsBigint !== null &&
                decryptedAsBigint <= PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
                  ? decryptedAsBigint
                  : null;
            }

            const nextOnboardInfo = signer.getUserOnboardInfo();
            setSessionOnboardInfo((previous) => ({
              ...previous,
              [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
            }));
          } catch {
            privateBalanceWei = null;
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
        const resolvedRewardDecimals =
          typeof rewardDecimalsRaw === 'number' || typeof rewardDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(rewardDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        const resolvedPrivateDecimals =
          typeof privateDecimalsRaw === 'number' || typeof privateDecimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(privateDecimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;

        if (!cancelled) {
          setRewardTokenBalanceWei(nextRewardBalance);
          setPrivateRewardTokenBalanceWei(privateBalanceWei);
          setRewardTokenSymbol(resolvedRewardSymbol);
          setPrivateRewardTokenSymbol(resolvedPrivateSymbol);
          setRewardTokenDecimals(resolvedRewardDecimals);
          setPrivateRewardTokenDecimals(resolvedPrivateDecimals);
          setGroupRequiredFeeWei(nextGroupNativeFee);
          setGroupTokenFeeWei(nextGroupTokenFee);
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
          setGroupRequiredFeeWei(null);
          setGroupTokenFeeWei(null);
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
  }, [walletAddress, chainId, hasAesReady, topUpMetricsNonce]);

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
      return;
    }

    if (!hasAesReady) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let deepConversationSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;

    const dispatchRealtimeSync = () => {
      lastRealtimeSyncDispatchAt = Date.now();
      syncConversationHistoryRef.current({ background: true }).catch(() => {});
    };

    const scheduleRealtimeSync = () => {
      if (cancelled) {
        return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
        !syncingHistoryRef.current &&
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

        const incomingFilter = contract.filters.MessageSubmitted(walletAddress, null);
        const outgoingFilter = contract.filters.MessageSubmitted(null, walletAddress);
        const nicknameFilter = contract.filters.NicknameSet();
        const handleMessageSubmitted = () => scheduleRealtimeSync();
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

        if (cancelled) {
          contract.off(incomingFilter, handleMessageSubmitted);
          contract.off(outgoingFilter, handleMessageSubmitted);
          contract.off(nicknameFilter, handleNicknameSet);
          return;
        }

        unsubscribe = () => {
          contract.off(incomingFilter, handleMessageSubmitted);
          contract.off(outgoingFilter, handleMessageSubmitted);
          contract.off(nicknameFilter, handleNicknameSet);
        };

        clearPollFallback();
      } catch {
        await resetCotiWsProvider();
        if (!cancelled) {
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
        }
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
      clearPollFallback();
      if (deepConversationSyncTimerId !== null) {
        window.clearTimeout(deepConversationSyncTimerId);
      }
      if (realtimeSyncTimerId !== null) {
        window.clearTimeout(realtimeSyncTimerId);
      }
      unsubscribe?.();
    };
  }, [walletAddress, chainId, hasAesReady]);

  useEffect(() => {
    if (!walletAddress || chainId !== COTI_NETWORK.chainIdDecimal || !hasAesReady) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let deepGroupSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;
    let pendingRealtimeSyncOptions: SyncGroupOptions | null = null;

    const mergeRealtimeSyncOptions = (options?: SyncGroupOptions): void => {
      const pending = pendingRealtimeSyncOptions;
      pendingRealtimeSyncOptions = {
        background: true,
        deep: Boolean(options?.deep || pending?.deep),
        overviewOnly: pending ? Boolean(options?.overviewOnly && pending.overviewOnly) : Boolean(options?.overviewOnly)
      };
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

    const parseGroupIdFromEvent = (value: unknown): number => {
      const direct = toSafeNumber(value);
      if (direct > 0) {
        return direct;
      }

      if (value && typeof value === 'object') {
        const maybeArgs = (value as { args?: Record<string, unknown> }).args;
        const parsedFromArgs = toSafeNumber(maybeArgs?.groupId);
        if (parsedFromArgs > 0) {
          return parsedFromArgs;
        }
      }

      return 0;
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
          const eventGroupId = parseGroupIdFromEvent(groupIdValue);
          const selectedActiveGroupId = activeGroupIdRef.current;
          if (selectedActiveGroupId !== null && (eventGroupId <= 0 || eventGroupId === selectedActiveGroupId)) {
            scheduleRealtimeSync();
            return;
          }

          scheduleRealtimeSync({ overviewOnly: true });
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

        if (cancelled) {
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
      } catch {
        await resetCotiWsProvider();
        if (!cancelled) {
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
        }
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
    if (activeGroupId === null || !walletAddress || !hasAesReady || chainId !== COTI_NETWORK.chainIdDecimal) {
      return;
    }

    const walletKey = walletAddress.trim().toLowerCase();
    if (!isWalletAddress(walletKey)) {
      return;
    }

    const groupBackfillKey = `${walletKey}:${activeGroupId}`;
    syncGroupDataRef.current({ background: true }).catch(() => {});
    if (!groupDeepBackfillDoneRef.current[groupBackfillKey]) {
      const timerId = window.setTimeout(() => {
        groupDeepBackfillDoneRef.current[groupBackfillKey] = true;
        syncGroupDataRef.current({ background: true, deep: true }).catch(() => {
          delete groupDeepBackfillDoneRef.current[groupBackfillKey];
        });
      }, BACKGROUND_DEEP_SYNC_DELAY_MS);
      return () => {
        window.clearTimeout(timerId);
      };
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
      try {
        localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, String(next));
      } catch {}
      if (next) {
        try {
          initPersistentAudio();
        } catch {}
      } else {
        try {
          if (audioUrlRef.current) {
            try {
              if (audioUrlRef.current.startsWith('blob:')) {
                URL.revokeObjectURL(audioUrlRef.current);
              }
            } catch {}
            audioUrlRef.current = null;
          }
          if (audioElRef.current) {
            audioElRef.current.pause();
            audioElRef.current.src = '';
            audioElRef.current = null;
          }
        } catch {}
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
      includeRefresh
      syncingGroups={syncingGroups}
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
      onRefresh={() => {
        syncGroupData({ deep: true }).catch(() => {});
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
      />

      <div className="app-root">
        <WalletSidebar
          isConnected={isConnected}
          onCotiNetwork={onCotiNetwork}
          chainId={chainId}
          status={status}
          isStatusConnected={isStatusConnected}
          onboardStatus={onboardStatus}
          isAesConnected={isAesConnected}
          walletAddress={walletAddress}
          lastCopiedKey={lastCopiedKey}
          onCopyWithFeedback={copyWithFeedback}
          hasSavedBurnerWallet={hasSavedBurnerWallet}
          initializingBurner={initializingBurner}
          burnerStorageBlocked={burnerStorageBlocked}
          hasActiveBurnerRecord={Boolean(burnerRecordRef.current)}
          onUnlockBurnerWallet={() => {
            beginBurnerPinFlow('stored').catch(() => {});
          }}
          onChangeBurnerPin={openChangeBurnerPin}
          onGenerateBurnerWallet={() => {
            beginBurnerPinFlow('generate').catch(() => {});
          }}
          onOpenBurnerImportModal={() => setShowBurnerImportModal(true)}
          injectedWalletOptions={injectedWalletOptions}
          preferredInjectedWalletOption={preferredInjectedWalletOption}
          currentInjectedWalletOption={currentInjectedWalletOption}
          activeSignerSource={activeSignerSource}
          connectionMethod={connectionMethod}
          connectingMethod={connectingMethod}
          connectingWalletLabel={connectingWalletLabel}
          savedBurnerWalletCount={savedBurnerWalletCount}
          burnerWallets={burnerWallets}
          currentBurnerWalletId={activeBurnerWalletId}
          getBurnerWalletDisplayName={getBurnerWalletDisplayName}
          onConnectInjectedWallet={connectAndOnboard}
          onSwitchBurnerWallet={switchActiveBurnerWallet}
          onDisconnectWallet={disconnectWallet}
          burnerWalletSelectionValue={burnerWalletSelectionValue}
          burnerAddress={burnerAddress}
          topUpAmountWei={topUpAmountWei}
          topUpMultiplier={topUpMultiplier}
          onTopUpMultiplierChange={setTopUpMultiplier}
          loadingTopUpQuote={loadingTopUpQuote}
          burnerBalanceWei={burnerBalanceWei}
          estimatedMessagesLeft={estimatedMessagesLeft}
          topUpAmountLabel={topUpAmountLabel}
          onTopUpBurnerWithWallet={topUpBurnerWithWallet}
          tokenToolsSummary={tokenToolsSummary}
          groupRewardsContractAddress={groupRewardsContractAddress}
          rewardsEnabled={rewardsEnabled}
          rewardsIndicatorLabel={rewardsIndicatorLabel}
          rewardsPublicReserveWei={rewardsPublicReserveWei}
          rewardsPublicPerInteractionWei={rewardsPublicPerInteractionWei}
          rewardTokenDecimals={rewardTokenDecimals}
          rewardTokenSymbol={rewardTokenSymbol}
          privateRewardTokenSymbol={privateRewardTokenSymbol}
          rewardsLowReserve={rewardsLowReserve}
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
          canSwapRewardTokens={canSwapRewardTokens}
          swapButtonLabel={swapButtonLabel}
          onSwapRewardTokens={swapRewardTokens}
          swapStatusMessage={swapStatusMessage}
          burnerNeedsFunding={burnerNeedsFunding}
          burnerMnemonicBackup={burnerMnemonicBackup}
          showBurnerMnemonic={showBurnerMnemonic}
          onBeginRevealBurnerBackup={beginRevealBurnerBackup}
        />

      {isConnected ? (
        <ContactsSidebar
          nicknameEditorRef={nicknameEditorRef}
          nicknameMaxBytes={nicknameMaxBytes}
          hasAesReady={hasAesReady}
          walletAddress={walletAddress}
          onNicknameInputChange={setMyNickname}
          onSaveNickname={() => {
            saveMyNicknameOnChain().catch(() => {});
          }}
          hasUnreadConversations={hasUnreadConversations}
          onMarkAllConversationsAsRead={markAllConversationsAsRead}
          onForceSync={() => {
            forceSyncAllData().catch(() => {});
          }}
          syncingHistory={syncingHistory}
          syncingGroups={syncingGroups}
          onOpenNewChat={() => {
            setQuickActionTab('contact');
            setShowQuickActionsModal(true);
          }}
          showHiddenContacts={showHiddenContacts}
          onToggleShowHiddenContacts={() => setShowHiddenContacts((previous) => !previous)}
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
          messagesByContact={messagesByContact}
          lastCopiedKey={lastCopiedKey}
          unreadMap={unreadMap}
          onCopyWithFeedback={copyWithFeedback}
          onActivateContact={activateContact}
          onStartRenameContact={startRenameContact}
          onRemoveContact={removeContact}
          onSaveRenamedContact={saveRenamedContact}
          onCancelRenameContact={cancelRenameContact}
          sortedGroupInvites={sortedGroupInvites}
          onAcceptGroupInvite={(groupId) => {
            acceptGroupInvite(groupId).catch(() => {});
          }}
          onDeclineGroupInvite={(groupId) => {
            declineGroupInvite(groupId).catch(() => {});
          }}
          processingGroupAction={processingGroupAction}
          sortedGroups={sortedGroups}
          activeGroupId={activeGroupId}
          messagesByGroup={messagesByGroup}
          unreadGroupMap={unreadGroupMap}
          onActivateGroup={activateGroup}
          error={error}
        />
      ) : null}

      <main className="chat-panel">
        <Suspense fallback={<div className="chat-placeholder">Loading conversation...</div>}>
          {!isConnected ? (
            <div className="chat-placeholder">Connect a wallet to view contacts and start messaging.</div>
          ) : activeGroupId !== null ? (
            <GroupChatPanel
              activeGroupId={activeGroupId}
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
              isReactionOnlyMessage={isReactionOnlyMessage}
              getReactionsForMessage={getReactionsForMessage}
              reactionPickerMessageId={reactionPickerMessageId}
              onToggleReactionPicker={(messageId) =>
                setReactionPickerMessageId((previous) => (previous === messageId ? null : messageId))
              }
              sendingReaction={sendingReaction}
              onSendReaction={sendReactionToMessage}
              replyingToMessage={replyingToMessage}
              onReplyToMessage={setReplyingToMessage}
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
              groupFeeModeSelection={groupFeeModeSelection}
              onToggleGroupFeeMode={() => {
                setGroupFeeModeSelection((previous) => (previous === 'coti' ? 'token' : 'coti'));
              }}
              selectedGroupFeeLabel={selectedGroupFeeLabel}
              sendingGroupMessage={sendingGroupMessage}
              composerRef={chatComposerRef}
              onSendMessage={() => {
                sendGroupMessage().catch(() => {});
              }}
              maxMessageLength={MAX_MESSAGE_LENGTH}
              onMessageInputChange={handleMessageInputChange}
            />
          ) : activeContact ? (
            <DirectChatPanel
              activeContact={activeContact}
              activeContactMeta={activeContactMeta}
              isSelfChat={isSelfChat}
              activeConversationMuted={activeConversationMuted}
              activeConversationHidden={activeConversationHidden}
              activeConversationStateSyncPending={activeConversationStateSyncPending}
              onToggleConversationMute={() => {
                toggleConversationMuteForContact(activeContact).catch(() => {});
              }}
              onLoadFullConversationHistory={loadFullConversationHistory}
              syncingHistory={syncingHistory}
              chatMessagesRef={setChatMessagesContainerRef}
              markConversationAsRead={markConversationAsRead}
              loadingOlderHistory={loadingOlderHistory}
              activeMessages={visibleActiveMessages}
              isReactionOnlyMessage={isReactionOnlyMessage}
              reactionPickerMessageId={reactionPickerMessageId}
              onToggleReactionPicker={(messageId) =>
                setReactionPickerMessageId((previous) => (previous === messageId ? null : messageId))
              }
              sendingReaction={sendingReaction}
              onSendReaction={sendReactionToMessage}
              onReplyToMessage={setReplyingToMessage}
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
              onCancelReply={() => setReplyingToMessage(null)}
              tipComposerOpen={tipComposerOpen}
              onToggleTipComposer={() => {
                setTradeComposerOpen(false);
                setTipComposerOpen((previous) => !previous);
              }}
              tipping={tipping}
              tipTokenSelection={tipTokenSelection}
              onTipTokenSelectionChange={setTipTokenSelection}
              rewardTokenSymbol={rewardTokenSymbol}
              privateRewardTokenSymbol={privateRewardTokenSymbol}
              tipAmountInput={tipAmountInput}
              onTipAmountInputChange={(value) => setTipAmountInput(sanitizeTokenAmountInput(value))}
              activeTipTokenSymbol={activeTipTokenSymbol}
              tipAmountWeiFromInput={tipAmountWeiFromInput}
              canSendTipFromComposer={canSendTipFromComposer}
              tipAmountExceedsBalance={tipAmountExceedsBalance}
              tipAmountSummaryLabel={tipAmountSummaryLabel}
              tipBalanceSummaryLabel={tipBalanceSummaryLabel}
              onSendTip={() => {
                sendTipToActiveContact(tipTokenSelection, tipAmountWeiFromInput).catch(() => {});
              }}
              tradeComposerOpen={tradeComposerOpen}
              tradeComposerContent={tradeComposerContent}
              onToggleTradeComposer={() => {
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
              }}
              composerRef={chatComposerRef}
              isMobileNav={isMobileNav}
              onSendMessage={() => {
                sendMessage().catch(() => {});
              }}
              maxMessageLength={MAX_MESSAGE_LENGTH}
              onMessageInputChange={handleMessageInputChange}
              sending={sending}
              tipToggleDisabled={tipping || sending || !activeContact || isSelfChat}
              tipToggleTitle={tipComposerOpen ? 'Hide tip options' : 'Open tip options'}
              tradeToggleDisabled={creatingTrade || tipping || sending || !activeContact || isSelfChat}
              tradeToggleTitle={tradeComposerOpen ? 'Hide trade options' : 'Open trade offer'}
            />
          ) : (
            <div className="chat-placeholder">Select a contact or group to start messaging.</div>
          )}
        </Suspense>
      </main>

      </div>

      <MobileBottomNav
        activeMobileView={activeMobileView}
        isConnected={isConnected}
        onSelectView={setActiveMobileView}
      />

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
    </div>
  );
}

