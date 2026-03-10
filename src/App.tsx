import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatImage from './components/ChatImage';
import BurnerImportModal from './components/BurnerImportModal';
import BurnerPinModal from './components/BurnerPinModal';
import DirectChatCompose from './components/DirectChatCompose';
import GroupChatCompose from './components/GroupChatCompose';
import QuickActionsModal from './components/QuickActionsModal';
import { parseImageTag } from './lib/imagePull';
import AppFavicon from './assets/favicon.png';
import type { JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import {
  ActiveGroupJoinCode,
  applyConversationPreferenceStateToContact,
  AUTO_STATE_BACKUP_BLOCK_DISTANCE,
  AUTO_STATE_BACKUP_RETRY_BLOCKS,
  AUTO_SYNC_INTERVAL_MS,
  BackupLocalStateOptions,
  buildMessageWithContactNamePayload,
  buildMessageWithConversationStatePayload,
  buildMessageWithReactionPayload,
  buildMessageWithReplyPayload,
  buildStateBackupPayload,
  buildStateBackupText,
  BURNER_ONBOARD_TIMEOUT_MS,
  BURNER_PIN_MIN_LENGTH,
  BurnerInitMode,
  BurnerInitResult,
  BurnerPinMode,
  BurnerWalletRecord,
  BurnerWalletVault,
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
  createBurnerWalletVault,
  createCotiBrowserProvider,
  createStateBackupFingerprint,
  debugLog,
  decodeMemoPlaintext,
  DEFAULT_GROUP_JOIN_CODE_MAX_USES,
  DEFAULT_GROUP_JOIN_CODE_MULTI_USES,
  DEFAULT_NICKNAME_MAX_BYTES,
  DEFAULT_REACTION_EMOJIS,
  Eip1193Provider,
  encodeGroupInviteCode,
  encodeMemoPlaintext,
  encodeStoredGroupTitle,
  ERC20_TOKEN_ABI,
  extractUserCiphertext,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  FAST_CONTACT_PREVIEW_BATCH_SIZE,
  FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK,
  formatCotiAmount,
  formatGroupMembershipEventText,
  formatMessageTimestamp,
  formatTokenAmount,
  generateRandomGroupJoinCode,
  getCotiWsLastHealthyAt,
  getGroupActionErrorMessage,
  getGroupCreateErrorMessage,
  getGroupJoinErrorMessage,
  getMessageDisplayText,
  getMetaMaskProvider,
  getProviderErrorMessage,
  GROUP_ADMIN_BURN_ADDRESS,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_JOIN_CODE_CACHE_STORAGE_KEY,
  GROUP_REMOVAL_NOTICE_AUTO_DISMISS_MS,
  GROUP_SUBMIT_GAS_BUFFER,
  GROUP_SUBMIT_GAS_LIMIT_MAX,
  GroupFeeModeSelection,
  GroupInvite,
  GroupJoinCodePayload,
  GroupMessageEntry,
  GroupSummary,
  hasInsufficientFundsError,
  HISTORY_PAGINATION_BLOCK_WINDOW,
  HistoryEntry,
  IMAGE_MESSAGE_PREFIX,
  INITIAL_SYNC_LOOKBACK_BLOCKS,
  isBurnerStorageAvailable,
  isProviderActionRejected,
  isWalletAddress,
  LEGACY_BURNER_PIN_MIN_LENGTH,
  loadBurnerWalletVaultFromStorage,
  loadCotiEthersModule,
  loadCotiReadProvider,
  loadCotiWsProvider,
  looksLikePrivateKeyInput,
  MAX_ERC20_APPROVAL,
  MAX_MESSAGE_LENGTH,
  mergeOnboardInfo,
  markCotiWsHealthyNow,
  mergeUniqueContacts,
  MobileView,
  normalizeChainId,
  normalizeContactName,
  normalizeConversationPreferenceState,
  normalizeImportInput,
  normalizeLastReadAllTs,
  normalizeMessagesByContact,
  normalizeMnemonicInput,
  normalizePrivateKeyInput,
  normalizeReactionEmoji,
  normalizeTokenDecimals,
  parseBurnerWalletStorageState,
  parseChatMessagePayload,
  parseConversationBlockRange,
  parseGroupInviteCode,
  parseGroupJoinCodeFromPayload,
  parseGroupJoinCodeState,
  parseReadCursorText,
  parseRecentPeersWithMetaResult,
  parseStateBackupText,
  parseStoredGroupTitle,
  parseSubmitMemoPayload,
  parseTokenAmountInput,
  parseWalletAddressListInput,
  PendingBurnerInit,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
  PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  READ_STATE_BACKUP_DEBOUNCE_MS,
  READ_STATE_BACKUP_MIN_INTERVAL_MS,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  RecentPeerMeta,
  resetCotiWsProvider,
  REWARD_TOKEN_ADDRESS,
  sanitizeTokenAmountInput,
  saveEncryptedBurnerWalletVault,
  SELF_BACKUP_RESTORE_BLOCK_WINDOW,
  SensitiveAction,
  shortenAddress,
  SignerSource,
  sortMessagesChronologically,
  StateBackupPayload,
  SubmitMemoPayload,
  SWAP_VAULT_CONTRACT_ABI,
  SWAP_VAULT_CONTRACT_ADDRESS,
  SwapDirection,
  SwapFeeModeSelection,
  SyncConversationOptions,
  SyncGroupOptions,
  TIP_NATIVE_TOKEN_DECIMALS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TipTokenSelection,
  toSafeNumber,
  trimReplyPreview,
  upsertBurnerWalletInVault,
  withTimeout,
  WHISPER_REWARDS_ABI,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS,
} from './lib/appShared';

export default function App() {
  const MOBILE_NAV_BREAKPOINT_PX = 920;
    // Telegram bot link
    const telegramBotLink = 'https://t.me/CipherTrade_bot';
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
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('Disconnected');
  const [burnerMnemonicBackup, setBurnerMnemonicBackup] = useState('');
  const [showBurnerMnemonic, setShowBurnerMnemonic] = useState(false);
  const [burnerImportInput, setBurnerImportInput] = useState('');
  const [burnerWallets, setBurnerWallets] = useState<BurnerWalletRecord[]>([]);
  const [savedBurnerWalletCount, setSavedBurnerWalletCount] = useState(0);
  const [activeBurnerWalletId, setActiveBurnerWalletId] = useState('');
  const [showBurnerImportModal, setShowBurnerImportModal] = useState(false);
  const [burnerStorageBlocked, setBurnerStorageBlocked] = useState<boolean>(() => !isBurnerStorageAvailable());
  const [showBurnerPinModal, setShowBurnerPinModal] = useState(false);
  const [showQuickActionsModal, setShowQuickActionsModal] = useState(false);
  const [quickActionTab, setQuickActionTab] = useState<'contact' | 'create-group' | 'join-group'>('contact');
  const [burnerPinMode, setBurnerPinMode] = useState<BurnerPinMode>('unlock');
  const [burnerPinInput, setBurnerPinInput] = useState('');
  const [pendingBurnerInit, setPendingBurnerInit] = useState<PendingBurnerInit | null>(null);
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<SensitiveAction | null>(null);
  const [initializingBurner, setInitializingBurner] = useState(false);
  const [burnerNeedsFunding, setBurnerNeedsFunding] = useState(false);
  const [myNickname, setMyNickname] = useState('');
  const [nicknameMaxBytes, setNicknameMaxBytes] = useState(DEFAULT_NICKNAME_MAX_BYTES);
  const [activeSignerSource, setActiveSignerSource] = useState<SignerSource>('burner');
  const [connectionMethod, setConnectionMethod] = useState<'metamask' | null>(null);
  const [connectingMethod, setConnectingMethod] = useState<'metamask' | null>(null);
  const [onboardStatus, setOnboardStatus] = useState<string>('Not onboarded');
  const [sessionOnboardInfo, setSessionOnboardInfo] = useState<Record<string, OnboardInfo>>({});
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
  const [sending, setSending] = useState(false);
  const [sendingReaction, setSendingReaction] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [topUpAmountWei, setTopUpAmountWei] = useState<bigint | null>(null);
  const [requiredFeeWei, setRequiredFeeWei] = useState<bigint | null>(null);
  const [burnerBalanceWei, setBurnerBalanceWei] = useState<bigint | null>(null);
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
  const [topUpMultiplier, setTopUpMultiplier] = useState(0);
  const [loadingTopUpQuote, setLoadingTopUpQuote] = useState(false);
  const [loadingRewardBalances, setLoadingRewardBalances] = useState(false);
  const [topUpMetricsNonce, setTopUpMetricsNonce] = useState(0);
  const [tipping, setTipping] = useState(false);
  const [tipComposerOpen, setTipComposerOpen] = useState(false);
  const [tipTokenSelection, setTipTokenSelection] = useState<TipTokenSelection>('coti');
  const [tipAmountInput, setTipAmountInput] = useState('');
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
  const [showTokenTools, setShowTokenTools] = useState(false);
  const [showBackupTools, setShowBackupTools] = useState(false);
  useEffect(() => {
    setGroupInviteTtlInput((previous) => {
      const normalized = previous.trim();
      if (!normalized || normalized === '168') {
        return '8';
      }
      return previous;
    });
  }, []);
  const [activeProvider, setActiveProvider] = useState<Eip1193Provider | null>(null);
  const topHeaderRef = useRef<HTMLElement | null>(null);
  const activeProviderRef = useRef<Eip1193Provider | null>(null);
  const burnerWalletRef = useRef<Wallet | null>(null);
  const burnerRecordRef = useRef<BurnerWalletRecord | null>(null);
  const burnerPinRef = useRef<string>('');
  const nicknameEditorRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatComposerRef = useRef<HTMLDivElement | null>(null);
  const messageElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const groupRemovalNoticeTimeoutRef = useRef<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const previousActiveContactForScrollRef = useRef<string | null>(null);
  const previousLastMessageIdForScrollRef = useRef<string | null>(null);
  const lastObservedScrollHeightRef = useRef<number>(0);
  const stickToBottomRef = useRef(true);
  const signerCacheRef = useRef<Record<string, JsonRpcSigner>>({});
  const sendingRef = useRef(false);
  const syncingHistoryRef = useRef(false);
  const pendingSyncOptionsRef = useRef<SyncConversationOptions | null>(null);
  const previousWalletAddressRef = useRef<string>('');
  const currentWalletKeyRef = useRef<string>('');
  const postConnectDataSyncRunIdRef = useRef(0);
  const lastSyncedBlockRef = useRef<Record<string, number>>({});
  const refreshBurnerStorageStatus = useCallback(() => {
    setBurnerStorageBlocked(!isBurnerStorageAvailable());
  }, []);

  useEffect(() => {
    lastReadAllTsRef.current = normalizeLastReadAllTs(lastReadAllTs);
  }, [lastReadAllTs]);

  useEffect(() => {
    refreshBurnerStorageStatus();
    const onVisibilityOrFocus = () => {
      refreshBurnerStorageStatus();
    };
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    return () => {
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
  }, [refreshBurnerStorageStatus]);

  useEffect(() => {
    let cancelled = false;

    const syncSavedBurnerWalletCount = async () => {
      if (burnerStorageBlocked) {
        if (!cancelled) {
          setSavedBurnerWalletCount(0);
        }
        return;
      }

      const storageState = parseBurnerWalletStorageState();
      if (storageState.kind === 'none') {
        if (!cancelled) {
          setSavedBurnerWalletCount(0);
        }
        return;
      }

      if (storageState.kind === 'legacy') {
        if (!cancelled) {
          setSavedBurnerWalletCount(1);
        }
        return;
      }

      if (storageState.kind === 'legacy-vault') {
        if (!cancelled) {
          setSavedBurnerWalletCount(storageState.record.wallets.length);
        }
        return;
      }

      const currentPin = burnerPinRef.current.trim();
      if (currentPin.length >= LEGACY_BURNER_PIN_MIN_LENGTH) {
        try {
          const vault = await loadBurnerWalletVaultFromStorage(currentPin);
          if (!cancelled) {
            setSavedBurnerWalletCount(vault.wallets.length);
          }
          return;
        } catch {
        }
      }

      if (!cancelled) {
        setSavedBurnerWalletCount(Math.max(burnerWallets.length, 1));
      }
    };

    syncSavedBurnerWalletCount().catch(() => {
      if (!cancelled) {
        setSavedBurnerWalletCount(burnerWallets.length);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [burnerStorageBlocked, burnerWallets, walletAddress]);

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
    const prev = previousWalletAddressRef.current || '';
    const next = (walletAddress || '').trim();
    if (!prev && next) {
      // user just connected a wallet; suppress immediate notification sound briefly
      suppressSoundOnConnectRef.current = true;
      setTimeout(() => {
        suppressSoundOnConnectRef.current = false;
      }, 1200);
    }
    previousWalletAddressRef.current = next;
  }, [walletAddress]);

  useEffect(() => {
    return () => {
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
  const backupInFlightRef = useRef(false);
  const onChainNicknameCacheRef = useRef<Record<string, string | null>>({});
  const lastAppliedStateBackupTsRef = useRef<Record<string, number>>({});
  const lastBackedUpStateFingerprintRef = useRef<Record<string, string>>({});
  const cachedStateBackupMemoRef = useRef<Record<string, { fingerprint: string; memo: SubmitMemoPayload }>>({});
  const lastStateBackupBlockRef = useRef<Record<string, number>>({});
  const lastAutoBackupAttemptBlockRef = useRef<Record<string, number>>({});
  const readStateBackupTimerRef = useRef<number | null>(null);
  const lastReadStateBackupSubmittedAtRef = useRef(0);
  const syncConversationHistoryRef = useRef<(options?: SyncConversationOptions) => Promise<void>>(async () => {});
  const syncGroupDataRef = useRef<(options?: SyncGroupOptions) => Promise<void>>(async () => {});
  const syncGroupDataInFlightRef = useRef(false);
  const pendingGroupSyncOptionsRef = useRef<SyncGroupOptions | null>(null);
  const groupOverviewLastSyncedBlockRef = useRef<Record<string, number>>({});
  const groupMessageLastSyncedBlockRef = useRef<Record<string, number>>({});
  const groupRemovalNoticeSeenRef = useRef<Record<string, Set<number>>>({});
  const groupRemovalNoticeMarkersRef = useRef<Record<string, Record<string, string>>>({});
  const groupRemovalNoticeMarkersLoadedRef = useRef(false);
  const groupJoinCodeCacheRef = useRef<Record<string, Record<string, Record<string, string>>>>({});
  const groupJoinCodeCacheLoadedRef = useRef(false);
  const conversationDeepBackfillDoneRef = useRef<Record<string, boolean>>({});
  const groupDeepBackfillDoneRef = useRef<Record<string, boolean>>({});
  const groupsRef = useRef<GroupSummary[]>([]);
  const groupInvitesRef = useRef<GroupInvite[]>([]);
  const activeGroupIdRef = useRef<number | null>(null);

  useEffect(() => {
    currentWalletKeyRef.current = walletAddress.trim().toLowerCase();
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
  }, [activeGroupId, walletAddress, isMobileNav]);

  useEffect(() => {
    if (swapStatusMessage) {
      setShowTokenTools(true);
    }
  }, [swapStatusMessage]);

  useEffect(() => {
    if (showBurnerMnemonic) {
      setShowBackupTools(true);
    }
  }, [showBurnerMnemonic]);

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
  const isReactionOnlyMessage = useCallback(
    (message: ChatMessage): boolean =>
      Boolean(
        !message.isSystem &&
          message.reactionToTxHash &&
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

      const targetTxHash = message.reactionToTxHash?.trim().toLowerCase() ?? '';
      const normalizedEmoji = normalizeReactionEmoji(message.reactionEmoji ?? '');
      if (!/^0x[a-f0-9]{64}$/.test(targetTxHash) || !normalizedEmoji) {
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

      let byEmoji = byTarget.get(targetTxHash);
      if (!byEmoji) {
        byEmoji = new Map<string, Set<string>>();
        byTarget.set(targetTxHash, byEmoji);
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
  }, [activeThreadMessages, activeContact, activeGroupId, walletAddress]);
  const getReactionsForMessage = useCallback(
    (message: ChatMessage): Array<{ emoji: string; count: number; reactedByMe: boolean }> => {
      const txHash = message.txHash?.trim().toLowerCase() ?? '';
      if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
        return [];
      }

      return activeThreadReactions.get(txHash) ?? [];
    },
    [activeThreadReactions]
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
        return showHiddenContacts ? Boolean(contact.hidden) : !Boolean(contact.hidden);
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
  const burnerAddress = burnerWalletRef.current?.address ?? (activeSignerSource === 'burner' ? walletAddress : '');
  const burnerWalletSelectionValue = activeBurnerWalletId || burnerRecordRef.current?.id || '';
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

  const ensureGroupRemovalNoticeMarkersLoaded = (): void => {
    if (groupRemovalNoticeMarkersLoadedRef.current) {
      return;
    }
    groupRemovalNoticeMarkersLoadedRef.current = true;
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const raw = window.localStorage.getItem(GROUP_REMOVAL_NOTICE_MARKERS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return;
      }

      const normalized: Record<string, Record<string, string>> = {};
      for (const [walletKey, markerMap] of Object.entries(parsed)) {
        if (!isWalletAddress(walletKey) || !markerMap || typeof markerMap !== 'object' || Array.isArray(markerMap)) {
          continue;
        }
        const nextMarkerMap: Record<string, string> = {};
        for (const [groupId, marker] of Object.entries(markerMap)) {
          if (!/^\d+$/.test(groupId) || typeof marker !== 'string' || marker.length === 0) {
            continue;
          }
          nextMarkerMap[groupId] = marker;
        }
        if (Object.keys(nextMarkerMap).length > 0) {
          normalized[walletKey] = nextMarkerMap;
        }
      }
      groupRemovalNoticeMarkersRef.current = normalized;
    } catch {
    }
  };

  const getStoredGroupRemovalNoticeMarker = (walletKey: string, groupId: number): string | undefined => {
    ensureGroupRemovalNoticeMarkersLoaded();
    return groupRemovalNoticeMarkersRef.current[walletKey]?.[String(groupId)];
  };

  const setStoredGroupRemovalNoticeMarker = (walletKey: string, groupId: number, marker: string): void => {
    ensureGroupRemovalNoticeMarkersLoaded();
    const walletMarkers =
      groupRemovalNoticeMarkersRef.current[walletKey] ??
      (groupRemovalNoticeMarkersRef.current[walletKey] = {});
    walletMarkers[String(groupId)] = marker;
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        GROUP_REMOVAL_NOTICE_MARKERS_STORAGE_KEY,
        JSON.stringify(groupRemovalNoticeMarkersRef.current)
      );
    } catch {
    }
  };

  const ensureGroupJoinCodeCacheLoaded = (): void => {
    if (groupJoinCodeCacheLoadedRef.current) {
      return;
    }
    groupJoinCodeCacheLoadedRef.current = true;
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(GROUP_JOIN_CODE_CACHE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return;
      }

      const normalized: Record<string, Record<string, Record<string, string>>> = {};
      for (const [walletKey, byGroupRaw] of Object.entries(parsed)) {
        if (!isWalletAddress(walletKey) || !byGroupRaw || typeof byGroupRaw !== 'object' || Array.isArray(byGroupRaw)) {
          continue;
        }

        const nextByGroup: Record<string, Record<string, string>> = {};
        for (const [groupIdKey, byHashRaw] of Object.entries(byGroupRaw)) {
          if (!/^\d+$/.test(groupIdKey) || !byHashRaw || typeof byHashRaw !== 'object' || Array.isArray(byHashRaw)) {
            continue;
          }

          const nextByHash: Record<string, string> = {};
          for (const [codeHashKey, codeRaw] of Object.entries(byHashRaw)) {
            if (!/^0x[a-fA-F0-9]{64}$/.test(codeHashKey) || typeof codeRaw !== 'string') {
              continue;
            }
            const normalizedCode = codeRaw.trim().toUpperCase();
            if (!normalizedCode) {
              continue;
            }
            nextByHash[codeHashKey.toLowerCase()] = normalizedCode;
          }

          if (Object.keys(nextByHash).length > 0) {
            nextByGroup[groupIdKey] = nextByHash;
          }
        }

        if (Object.keys(nextByGroup).length > 0) {
          normalized[walletKey] = nextByGroup;
        }
      }

      groupJoinCodeCacheRef.current = normalized;
    } catch {
    }
  };

  const persistGroupJoinCodeCache = (): void => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        GROUP_JOIN_CODE_CACHE_STORAGE_KEY,
        JSON.stringify(groupJoinCodeCacheRef.current)
      );
    } catch {
    }
  };

  const getStoredGroupJoinCodeForHash = (
    walletKey: string,
    groupId: number,
    codeHash: string
  ): string | undefined => {
    ensureGroupJoinCodeCacheLoaded();
    return groupJoinCodeCacheRef.current[walletKey]?.[String(groupId)]?.[codeHash.toLowerCase()];
  };

  const setStoredGroupJoinCodeForHash = (
    walletKey: string,
    groupId: number,
    codeHash: string,
    code: string
  ): void => {
    if (!isWalletAddress(walletKey) || !Number.isFinite(groupId) || groupId <= 0 || !/^0x[a-fA-F0-9]{64}$/.test(codeHash)) {
      return;
    }
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      return;
    }

    ensureGroupJoinCodeCacheLoaded();
    const byGroup =
      groupJoinCodeCacheRef.current[walletKey] ?? (groupJoinCodeCacheRef.current[walletKey] = {});
    const byHash = byGroup[String(groupId)] ?? (byGroup[String(groupId)] = {});
    byHash[codeHash.toLowerCase()] = normalizedCode;
    persistGroupJoinCodeCache();
  };

  const deleteStoredGroupJoinCodeForHash = (
    walletKey: string,
    groupId: number,
    codeHash: string
  ): void => {
    if (!isWalletAddress(walletKey) || !Number.isFinite(groupId) || groupId <= 0 || !/^0x[a-fA-F0-9]{64}$/.test(codeHash)) {
      return;
    }

    ensureGroupJoinCodeCacheLoaded();
    const byGroup = groupJoinCodeCacheRef.current[walletKey];
    if (!byGroup) {
      return;
    }
    const byHash = byGroup[String(groupId)];
    if (!byHash || !byHash[codeHash.toLowerCase()]) {
      return;
    }

    delete byHash[codeHash.toLowerCase()];
    if (Object.keys(byHash).length === 0) {
      delete byGroup[String(groupId)];
    }
    if (Object.keys(byGroup).length === 0) {
      delete groupJoinCodeCacheRef.current[walletKey];
    }
    persistGroupJoinCodeCache();
  };

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

  const setConnectedProvider = (provider: Eip1193Provider | null) => {
    activeProviderRef.current = provider;
    setActiveProvider(provider);
  };

  const getConnectedProvider = (): Eip1193Provider | null => {
    if (connectionMethod === 'metamask') {
      return activeProviderRef.current ?? activeProvider ?? getMetaMaskProvider();
    }

    return activeProviderRef.current ?? activeProvider ?? null;
  };

  const createCotiRpcProvider = async () => {
    const cotiEthers = await loadCotiEthersModule();
    return new cotiEthers.JsonRpcProvider(COTI_NETWORK.rpcUrl, {
      name: COTI_NETWORK.chainName,
      chainId: COTI_NETWORK.chainIdDecimal
    });
  };

  const buildBurnerRecord = async (
    mode: BurnerInitMode,
    seedOrPrivateKey?: string,
    pin?: string,
    preferredWalletId?: string
  ): Promise<{ record: BurnerWalletRecord; vault?: BurnerWalletVault }> => {
    const normalizedSeed = normalizeImportInput(seedOrPrivateKey ?? '');
    const cotiEthers = await loadCotiEthersModule();

    if (mode === 'import') {
      if (normalizedSeed.length === 0) {
        throw new Error('Enter a mnemonic phrase or private key.');
      }

      const normalizedPrivateKey = normalizePrivateKeyInput(normalizedSeed);
      if (normalizedPrivateKey) {
        return { record: { privateKey: normalizedPrivateKey } };
      }

      if (looksLikePrivateKeyInput(normalizedSeed)) {
        throw new Error('Invalid private key. Use exactly 64 hex characters (optionally prefixed with 0x).');
      }

      const normalizedMnemonic = normalizeMnemonicInput(normalizedSeed);
      let importedWallet: { privateKey: string };
      try {
        importedWallet = cotiEthers.Wallet.fromPhrase(normalizedMnemonic);
      } catch {
        throw new Error('Invalid mnemonic phrase.');
      }
      return {
        record: {
          privateKey: importedWallet.privateKey,
          mnemonic: normalizedMnemonic
        }
      };
    }

    if (mode === 'stored') {
      const vault = await loadBurnerWalletVaultFromStorage(pin?.trim() ?? '');
      const selectedWallet =
        vault.wallets.find((walletRecord) => walletRecord.id === preferredWalletId) ??
        vault.wallets.find((walletRecord) => walletRecord.id === vault.activeWalletId) ??
        vault.wallets[0];

      if (!selectedWallet) {
        throw new Error('No saved burner wallet found. Generate or import one first.');
      }

      return {
        record: selectedWallet,
        vault: {
          ...vault,
          activeWalletId: selectedWallet.id as string
        }
      };
    }

    const createdWallet = cotiEthers.Wallet.createRandom();
    return {
      record: {
        privateKey: createdWallet.privateKey,
        mnemonic: createdWallet.mnemonic?.phrase
      }
    };
  };

  const initializeBurnerWallet = async (
    mode: BurnerInitMode,
    seedOrPrivateKey?: string,
    pin?: string,
    preferredWalletId?: string
  ): Promise<BurnerInitResult> => {
    setError('');
    setInitializingBurner(true);
    setBurnerNeedsFunding(false);
    let aesOnboardingComplete = false;
    let walletPersisted = false;

    try {
      const storageState = parseBurnerWalletStorageState();
      const sessionPin = pin?.trim() ?? burnerPinRef.current;

      const buildResult = await buildBurnerRecord(mode, seedOrPrivateKey, sessionPin, preferredWalletId);
      let burnerRecord = buildResult.record;
      let burnerVault: BurnerWalletVault;

      if (mode === 'stored') {
        if (!buildResult.vault) {
          throw new Error('No saved burner wallet found. Generate or import one first.');
        }
        burnerVault = buildResult.vault;
      } else if (storageState.kind === 'none') {
        burnerVault = await createBurnerWalletVault([burnerRecord]);
      } else {
        const existingVault = await loadBurnerWalletVaultFromStorage(sessionPin);
        burnerVault = await upsertBurnerWalletInVault(existingVault, burnerRecord);
      }

      if (sessionPin.length < BURNER_PIN_MIN_LENGTH) {
        throw new Error(`PIN must be at least ${BURNER_PIN_MIN_LENGTH} digits.`);
      }

      await saveEncryptedBurnerWalletVault(burnerVault, sessionPin);
      walletPersisted = true;
      if (mode === 'import') {
        const normalizedImportedPrivateKey = buildResult.record.privateKey.trim().toLowerCase();
        const persistedVault = await loadBurnerWalletVaultFromStorage(sessionPin);
        const importedWalletPersisted = persistedVault.wallets.some(
          (walletRecord) => walletRecord.privateKey.trim().toLowerCase() === normalizedImportedPrivateKey
        );
        if (!importedWalletPersisted) {
          throw new Error('Imported wallet was not found in persistent storage after saving.');
        }
      }

      const activeWalletRecord =
        burnerVault.wallets.find((walletRecord) => walletRecord.id === burnerVault.activeWalletId) ??
        burnerVault.wallets[0];
      if (!activeWalletRecord) {
        throw new Error('No valid burner wallet was found after unlock.');
      }

      burnerRecord = activeWalletRecord;
      setBurnerWallets(burnerVault.wallets);
      setActiveBurnerWalletId(burnerVault.activeWalletId);

      if (sessionPin.length >= BURNER_PIN_MIN_LENGTH) {
        burnerPinRef.current = sessionPin;
      }

      const cotiEthers = await loadCotiEthersModule();
      const rpcProvider = await createCotiRpcProvider();
      const burnerWallet = new cotiEthers.Wallet(burnerRecord.privateKey, rpcProvider);

      burnerWalletRef.current = burnerWallet;
      burnerRecordRef.current = {
        ...burnerRecord,
        address: burnerWallet.address
      };
      setWalletAddress(burnerWallet.address);
      setChainId(COTI_NETWORK.chainIdDecimal);
      setStatus('Connecting burner wallet...');
      setActiveSignerSource('burner');
      setConnectionMethod(null);
      setConnectedProvider(null);
      setBurnerImportInput('');

      if (burnerRecord.mnemonic) {
        setBurnerMnemonicBackup(burnerRecord.mnemonic);
        setShowBurnerMnemonic(false);
      } else {
        setBurnerMnemonicBackup('');
        setShowBurnerMnemonic(false);
      }

      const burnerBalance = (await withTimeout(
        rpcProvider.getBalance(burnerWallet.address) as Promise<bigint>,
        BURNER_ONBOARD_TIMEOUT_MS,
        'Timed out while reading burner wallet balance.'
      )) as bigint;
      if (burnerBalance <= 0n) {
        setBurnerNeedsFunding(true);
        setStatus('Burner wallet created. Fund it, then connect burner wallet.');
        setOnboardStatus('Funding required');
        setShowBurnerPinModal(false);
        setPendingBurnerInit(null);
        setPendingSensitiveAction(null);
        setBurnerPinInput('');
        return 'needs-funding';
      }

      const cacheKey = burnerWallet.address.toLowerCase();
      const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
      if (cachedOnboardInfo) {
        burnerWallet.setUserOnboardInfo(cachedOnboardInfo);
      }

      setOnboardStatus('Onboarding...');
      await withTimeout(
        burnerWallet.generateOrRecoverAes(),
        BURNER_ONBOARD_TIMEOUT_MS,
        'Timed out while preparing burner wallet encryption keys. Try again.'
      );
      const onboardInfo = burnerWallet.getUserOnboardInfo();

      if (!onboardInfo?.aesKey) {
        throw new Error('AES key unavailable for burner wallet.');
      }

      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
      }));
      aesOnboardingComplete = true;
      setOnboardStatus('AES key ready');
      setStatus('Connected');
      setShowBurnerPinModal(false);
      setPendingBurnerInit(null);
      setPendingSensitiveAction(null);
      setBurnerPinInput('');
      const connectedAddress = burnerWallet.address;
      const connectedWalletKey = connectedAddress.toLowerCase();
      window.setTimeout(() => {
        void (async () => {
          try {
            const nickname = await loadMyNicknameFromChain(connectedAddress);
            if (currentWalletKeyRef.current !== connectedWalletKey) {
              return;
            }
            setMyNickname(nickname);
          } catch {
            // Post-onboarding sync failures should not block a successful burner unlock.
          } finally {
            if (currentWalletKeyRef.current === connectedWalletKey) {
              runPostConnectDataSyncUntilApplied(connectedAddress).catch(() => {});
            }
          }
        })();
      }, 0);
      return 'connected';
    } catch (burnerError) {
      if (aesOnboardingComplete) {
        setOnboardStatus('AES key ready');
        setStatus('Connected');
        setShowBurnerPinModal(false);
        setPendingBurnerInit(null);
        setPendingSensitiveAction(null);
        setBurnerPinInput('');
        return 'connected';
      }

      const message = burnerError instanceof Error ? burnerError.message : 'Failed to initialize burner wallet.';
      if (message.includes('Account balance is 0 so user cannot be onboarded')) {
        setBurnerNeedsFunding(true);
        setStatus('Burner needs funding');
        return 'needs-funding';
      }
      if (mode === 'import' && walletPersisted) {
        setStatus('Wallet imported. Connect saved wallet to finish setup.');
        setError(message);
        setOnboardStatus('Not onboarded');
        return 'imported';
      }
      setStatus('Disconnected');
      setError(message);
      setOnboardStatus('Not onboarded');
      return 'failed';
    } finally {
      setInitializingBurner(false);
    }
  };

  const closeBurnerPinModal = () => {
    if (initializingBurner) {
      return;
    }

    setShowBurnerPinModal(false);
    setPendingBurnerInit(null);
    setPendingSensitiveAction(null);
    setBurnerPinInput('');
  };

  const beginRevealBurnerBackup = () => {
    if (!burnerMnemonicBackup) {
      return;
    }

    if (showBurnerMnemonic) {
      setShowBurnerMnemonic(false);
      return;
    }

    setError('');
    setPendingBurnerInit(null);
    setPendingSensitiveAction('reveal-backup');
    setBurnerPinMode('unlock');
    setBurnerPinInput('');
    setShowBurnerPinModal(true);
  };

  const beginBurnerPinFlow = async (mode: BurnerInitMode, seedOrPrivateKey?: string) => {
    setError('');
    refreshBurnerStorageStatus();
    if (!isBurnerStorageAvailable()) {
      setError('Browser storage is unavailable. Wallet persistence requires local storage access.');
      return;
    }

    const storageState = parseBurnerWalletStorageState();
    if (mode === 'stored' && storageState.kind === 'none') {
      setError('No saved burner wallet found. Generate or import one first.');
      return;
    }

    if (mode === 'stored' && storageState.kind === 'encrypted' && burnerPinRef.current) {
      await initializeBurnerWallet('stored', undefined, burnerPinRef.current, activeBurnerWalletId || undefined);
      return;
    }

    const nextPinMode: BurnerPinMode = storageState.kind === 'encrypted' ? 'unlock' : 'set';

    setPendingBurnerInit({ mode, seedOrPrivateKey, walletId: activeBurnerWalletId || undefined });
    setBurnerPinMode(nextPinMode);
    setBurnerPinInput('');
    setShowBurnerPinModal(true);
  };

  const submitBurnerPinAndInitialize = async () => {
    setError('');

    const pending = pendingBurnerInit;
    if (!pending) {
      if (pendingSensitiveAction === 'reveal-backup') {
        const pinForReveal = burnerPinInput.trim();
        if (pinForReveal.length < LEGACY_BURNER_PIN_MIN_LENGTH) {
          setError(`PIN must be at least ${LEGACY_BURNER_PIN_MIN_LENGTH} digits.`);
          return;
        }

        try {
          await loadBurnerWalletVaultFromStorage(pinForReveal);
          burnerPinRef.current = pinForReveal;
          setShowBurnerMnemonic(true);
          setShowBurnerPinModal(false);
          setPendingSensitiveAction(null);
          setBurnerPinInput('');
        } catch {
          setError('Invalid PIN. Unable to reveal burner backup.');
        }
        return;
      }

      if (burnerPinMode !== 'set') {
        return;
      }

      const pinForUpdate = burnerPinInput.trim();
      if (pinForUpdate.length < BURNER_PIN_MIN_LENGTH) {
        setError(`PIN must be at least ${BURNER_PIN_MIN_LENGTH} digits.`);
        return;
      }

      if (!burnerRecordRef.current || burnerWallets.length === 0) {
        setError('Connect burner wallet first, then change PIN.');
        return;
      }

      const vaultForPinUpdate = await createBurnerWalletVault(
        burnerWallets,
        activeBurnerWalletId || burnerRecordRef.current.id || burnerWallets[0]?.id
      );
      await saveEncryptedBurnerWalletVault(vaultForPinUpdate, pinForUpdate);
      burnerPinRef.current = pinForUpdate;
      setShowBurnerPinModal(false);
      setBurnerPinInput('');
      setStatus('Burner PIN updated.');
      return;
    }

    const pin = burnerPinInput.trim();
    const minimumPinLength = burnerPinMode === 'unlock' ? LEGACY_BURNER_PIN_MIN_LENGTH : BURNER_PIN_MIN_LENGTH;
    if (pin.length < minimumPinLength) {
      setError(`PIN must be at least ${minimumPinLength} digits.`);
      return;
    }

    const initResult = await initializeBurnerWallet(pending.mode, pending.seedOrPrivateKey, pin, pending.walletId);
    if (initResult === 'connected' || initResult === 'needs-funding' || initResult === 'imported') {
      setShowBurnerPinModal(false);
      setPendingBurnerInit(null);
      setPendingSensitiveAction(null);
      setBurnerPinInput('');

      if (pending.mode === 'import') {
        setShowBurnerImportModal(false);
      }

      // Ensure UI updates (contacts/nicknames) after import/connect by
      // performing a delayed lightweight refresh after wallet state settles.
      setTimeout(() => {
        try {
          syncConversationHistoryRef.current({
            contactsOnly: true,
            previewPerContact: true,
            updateHead: true,
            background: true
          }).catch(() => {});
        } catch {}
      }, 300);

      if (initResult === 'connected' && burnerPinMode === 'unlock' && pin.length < BURNER_PIN_MIN_LENGTH) {
        setStatus(`Connected. PIN is legacy; update it to ${BURNER_PIN_MIN_LENGTH}+ digits from Change PIN.`);
      }
    }
  };

  const openChangeBurnerPin = () => {
    if (!burnerRecordRef.current) {
      setError('Connect burner wallet first, then change PIN.');
      return;
    }

    setError('');
    setPendingBurnerInit(null);
    setBurnerPinMode('set');
    setBurnerPinInput('');
    setShowBurnerPinModal(true);
  };

  const importBurnerWallet = async () => {
    await beginBurnerPinFlow('import', burnerImportInput);
  };

  const switchActiveBurnerWallet = async (walletId: string) => {
    setError('');
    setActiveBurnerWalletId(walletId);

    if (!walletId) {
      return;
    }

    if (!burnerPinRef.current) {
      setPendingBurnerInit({ mode: 'stored', walletId });
      setBurnerPinMode('unlock');
      setBurnerPinInput('');
      setShowBurnerPinModal(true);
      return;
    }

    await initializeBurnerWallet('stored', undefined, burnerPinRef.current, walletId);
  };

  const topUpBurnerWithMetaMask = async () => {
    setError('');

    const burnerAddress = burnerWalletRef.current?.address ?? (activeSignerSource === 'burner' ? walletAddress : '');

    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      setError('Initialize burner wallet first.');
      return;
    }

    const provider = getMetaMaskProvider();
    if (!provider) {
      setError('MetaMask not detected. Please install MetaMask to top up burner wallet.');
      return;
    }

    try {
      setStatus('Top up in progress...');
      await provider.request({ method: 'eth_requestAccounts' });
      await ensureCotiNetwork(provider);

      const browserProvider = await createCotiBrowserProvider(provider);
      const funderSigner = await browserProvider.getSigner();
      let topUpAmount = topUpAmountWei;
      if (topUpAmount === null) {
        const requiredFee = await resolveRequiredFeeForSend();
        topUpAmount = calculateTopUpAmount(requiredFee, topUpMultiplier);
      }

      if (topUpAmount === null) {
        throw new Error('Unable to calculate top-up amount.');
      }
      if (topUpAmount <= 0n) {
        throw new Error('Choose a top-up amount greater than zero.');
      }

      const tx = await funderSigner.sendTransaction({
        to: burnerAddress,
        value: topUpAmount
      });
      await tx.wait();

      setBurnerBalanceWei((previous) => (previous !== null ? previous + topUpAmount : previous));
      setTopUpMetricsNonce((previous) => previous + 1);

      if (burnerPinRef.current) {
        await initializeBurnerWallet('stored', undefined, burnerPinRef.current);
      } else {
        setStatus('Burner topped up. Unlock burner wallet to continue.');
      }
    } catch (fundError) {
      const message = getProviderErrorMessage(fundError, 'Failed to top up burner wallet.');
      setError(message);
      setStatus('Burner needs funding');
    }
  };

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

  const jumpToReferencedMessage = (replyToMessageId?: string, replyToText?: string, replyToTxHash?: string) => {
    const referencePool = activeGroupId !== null ? activeGroupMessages : activeMessages;
    if (referencePool.length === 0) {
      return;
    }

    let targetId = replyToMessageId;
    if (!targetId && replyToTxHash) {
      const normalizedReplyTxHash = replyToTxHash.toLowerCase();
      const matchedByTxHash = referencePool.find((message) => message.txHash?.toLowerCase() === normalizedReplyTxHash);
      targetId = matchedByTxHash?.id;
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

    const nextMuted = !Boolean(targetContact.muted);
    const nextHidden = Boolean(targetContact.hidden);
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

    const nextMuted = Boolean(targetContact.muted);
    const nextHidden = !Boolean(targetContact.hidden);
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

  const ensureCotiNetwork = async (provider: Eip1193Provider) => {
    if (!provider) {
      throw new Error('Wallet provider is not available.');
    }

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: COTI_NETWORK.chainIdHex }]
      });
    } catch (switchError) {
      const errorWithCode = switchError as { code?: number; message?: string };

      if (errorWithCode.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: COTI_NETWORK.chainIdHex,
              chainName: COTI_NETWORK.chainName,
              rpcUrls: [COTI_NETWORK.rpcUrl],
              blockExplorerUrls: [COTI_NETWORK.blockExplorerUrl],
              nativeCurrency: COTI_NETWORK.nativeCurrency
            }
          ]
        });
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: COTI_NETWORK.chainIdHex }]
        });
      } else {
        throw new Error(errorWithCode.message ?? 'Could not switch to the COTI network.');
      }
    }
  };

  const refreshWalletState = async (providerOverride?: Eip1193Provider | null) => {
    const provider = providerOverride ?? getConnectedProvider();
    if (!provider) {
      return;
    }

    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    const selected = accounts[0] ?? '';
    setWalletAddress(selected);

    if (selected) {
      const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
      setChainId(normalizeChainId(currentChain));
      setStatus('Connected');
    } else {
      setChainId(null);
      setStatus('Disconnected');
    }
  };

  const onboardAddressAes = async (address: string, provider: Eip1193Provider): Promise<OnboardInfo> => {
    if (!provider) {
      throw new Error('Wallet provider is not available.');
    }

    setOnboardStatus('Onboarding...');
    await ensureCotiNetwork(provider);

    const browserProvider = await createCotiBrowserProvider(provider);

    const cacheKey = address.toLowerCase();
    const signer = await browserProvider.getSigner(address, sessionOnboardInfo[cacheKey]);
    signer.disableAutoOnboard();
    signerCacheRef.current[cacheKey] = signer;

    await signer.generateOrRecoverAes();

    const rawOnboardInfo = signer.getUserOnboardInfo();
    const onboardInfo = mergeOnboardInfo(undefined, rawOnboardInfo);
    const aesKey = onboardInfo.aesKey ?? '';
    if (!aesKey) {
      throw new Error('AES key was not returned during onboarding.');
    }

    setSessionOnboardInfo((previous) => ({
      ...previous,
      [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
    }));

    setOnboardStatus('AES key ready');
    return onboardInfo;
  };

  const connectAndOnboard = async () => {
    setError('');
    setConnectingMethod('metamask');

    const provider = getMetaMaskProvider();
    if (!provider) {
      setError('MetaMask not detected. Please install MetaMask.');
      setConnectingMethod(null);
      return;
    }

    try {
      setStatus('Connecting...');
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      const selected = accounts[0] ?? '';

      if (!selected) {
        throw new Error('No wallet account selected.');
      }

      setConnectedProvider(provider);
      setConnectionMethod('metamask');
      setActiveSignerSource('metamask');
      setWalletAddress(selected);

      await onboardAddressAes(selected, provider);
      const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
      setChainId(normalizeChainId(currentChain));
      setStatus('Connected (MetaMask)');
      const selectedWalletKey = selected.toLowerCase();
      window.setTimeout(() => {
        void (async () => {
          try {
            const nickname = await loadMyNicknameFromChain(selected);
            if (currentWalletKeyRef.current !== selectedWalletKey) {
              return;
            }
            setMyNickname(nickname);
          } catch {
            // Post-connect sync should not block successful connection.
          } finally {
            if (currentWalletKeyRef.current === selectedWalletKey) {
              runPostConnectDataSyncUntilApplied(selected).catch(() => {});
            }
          }
        })();
      }, 0);
    } catch (connectionError) {
      const message = getProviderErrorMessage(connectionError, 'Failed to connect wallet.');
      setError(message);
      setStatus('Disconnected');
      setOnboardStatus('Not onboarded');
    } finally {
      setConnectingMethod(null);
    }
  };

  const disconnectWallet = async () => {
    setError('');

    burnerWalletRef.current = null;
    burnerRecordRef.current = null;
    setBurnerNeedsFunding(false);
    setBurnerWallets([]);
    setActiveBurnerWalletId('');

    const provider = getConnectedProvider();

    try {
      if (connectionMethod === 'metamask' && provider) {
        await provider.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }]
        });
      }
    } catch {
    }

    setWalletAddress('');
    setChainId(null);
    setStatus('Disconnected');
    setActiveSignerSource('burner');
    setConnectionMethod(null);
    setOnboardStatus('Not onboarded');
    setSessionOnboardInfo({});
    setConnectedProvider(null);
    burnerPinRef.current = '';
    signerCacheRef.current = {};
    cachedStateBackupMemoRef.current = {};
  };

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

  const ensureGroupTokenFeeAllowance = async (
    signer: Wallet | JsonRpcSigner,
    ownerAddress: string,
    tokenFeeAmount: bigint
  ): Promise<void> => {
    if (tokenFeeAmount <= 0n) {
      return;
    }

    // If private balance can already cover fee, no public-token approval is needed.
    if (privateRewardTokenBalanceWei !== null && privateRewardTokenBalanceWei >= tokenFeeAmount) {
      return;
    }

    const cotiEthers = await loadCotiEthersModule();
    const groupContract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
    const publicFeeTokenRaw = await groupContract.publicFeeToken().catch(() => null);
    const publicFeeTokenAddress =
      typeof publicFeeTokenRaw === 'string' && isWalletAddress(publicFeeTokenRaw)
        ? publicFeeTokenRaw
        : REWARD_TOKEN_ADDRESS;
    const publicFeeTokenContract = new cotiEthers.Contract(publicFeeTokenAddress, ERC20_TOKEN_ABI, signer);
    const allowanceRaw = await publicFeeTokenContract
      .allowance(ownerAddress, GROUP_CHAT_CONTRACT_ADDRESS)
      .catch(() => null);
    const allowance = typeof allowanceRaw === 'bigint' ? allowanceRaw : 0n;
    if (allowance >= tokenFeeAmount) {
      return;
    }

    const approveTx = await publicFeeTokenContract.approve(GROUP_CHAT_CONTRACT_ADDRESS, MAX_ERC20_APPROVAL);
    await approveTx.wait();
  };

  const resolveGroupSubmitGasLimit = async (
    contract: unknown,
    groupId: number,
    memoTuple: unknown,
    paymentMode: number,
    requiredFee: bigint
  ): Promise<bigint | null> => {
    try {
      const submitWithMode = (contract as { submitGroupMessageWithMode?: unknown }).submitGroupMessageWithMode as
        | {
            estimateGas?: (
              groupIdArg: number,
              memoTupleArg: unknown,
              paymentModeArg: number,
              overrides: { value: bigint }
            ) => Promise<bigint>;
          }
        | undefined;
      const estimated =
        submitWithMode?.estimateGas &&
        (await submitWithMode.estimateGas(groupId, memoTuple, paymentMode, {
          value: requiredFee
        }));
      if (typeof estimated !== 'bigint' || estimated <= 0n) {
        return null;
      }
      const padded = estimated + GROUP_SUBMIT_GAS_BUFFER;
      return padded > GROUP_SUBMIT_GAS_LIMIT_MAX ? GROUP_SUBMIT_GAS_LIMIT_MAX : padded;
    } catch {
      return null;
    }
  };

  const getNicknameMaxLength = async (): Promise<number> => {
    if (nicknameMaxBytesLoadedRef.current) {
      return nicknameMaxBytes;
    }

    if (!nicknameMaxBytesRequestRef.current) {
      nicknameMaxBytesRequestRef.current = (async () => {
        try {
          const cotiEthers = await loadCotiEthersModule();
          const readProvider = await loadCotiReadProvider(true);
          const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
          const onChainMax = toSafeNumber(await readContract.NICKNAME_MAX_BYTES());
          if (onChainMax > 0) {
            setNicknameMaxBytes(onChainMax);
            nicknameMaxBytesLoadedRef.current = true;
            return onChainMax;
          }
        } catch {
        }

        return nicknameMaxBytes;
      })();
    }

    try {
      return await nicknameMaxBytesRequestRef.current;
    } finally {
      nicknameMaxBytesRequestRef.current = null;
    }
  };

  const fetchOnChainNicknames = async (addresses: string[]): Promise<Map<string, string>> => {
    const uniqueAddresses = Array.from(
      new Set(
        addresses
          .map((address) => address.trim().toLowerCase())
          .filter((address) => isWalletAddress(address))
      )
    );
    if (uniqueAddresses.length === 0) {
      return new Map();
    }

    const cache = onChainNicknameCacheRef.current;
    const uncachedAddresses = uniqueAddresses.filter(
      (address) => !Object.prototype.hasOwnProperty.call(cache, address)
    );
    if (uncachedAddresses.length > 0) {
      const maxLength = await getNicknameMaxLength();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      await Promise.all(
        uncachedAddresses.map(async (address) => {
          try {
            const raw = await readContract.nicknames(address);
            const normalized = normalizeContactName(String(raw ?? '').replace(/\r?\n/g, ''))?.slice(0, maxLength) ?? null;
            cache[address] = normalized;
          } catch {
            delete cache[address];
          }
        })
      );
    }

    const resolved = new Map<string, string>();
    for (const address of uniqueAddresses) {
      const cached = cache[address];
      if (typeof cached === 'string' && cached) {
        resolved.set(address, cached);
      }
    }
    return resolved;
  };

  const saveMyNicknameOnChain = async (overrideNickname?: string): Promise<boolean> => {
    const address = walletAddress.trim().toLowerCase();
    if (!isWalletAddress(address)) {
      return false;
    }

    const maxLength = await getNicknameMaxLength();
    const nextNickname = normalizeContactName(
      (typeof overrideNickname === 'string' ? overrideNickname : myNickname).replace(/\r?\n/g, '')
    )?.slice(0, maxLength);
    if (!nextNickname) {
      return false;
    }

    const cachedNickname = onChainNicknameCacheRef.current[address];
    if (cachedNickname === nextNickname) {
      return true;
    }

    try {
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const tx = await contract.setMyNickname(nextNickname);
      await tx.wait();

      onChainNicknameCacheRef.current[address] = nextNickname;
      setMyNickname(nextNickname);
      setContacts((previous) =>
        previous.map((contact) =>
          contact.address.toLowerCase() === address ? { ...contact, name: nextNickname } : contact
        )
      );

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
      return true;
    } catch (nicknameError) {
      const message = nicknameError instanceof Error ? nicknameError.message : 'Failed to save nickname on chain.';
      setError(message);
      return false;
    }
  };

  const loadMyNicknameFromChain = async (
    targetAddress: string,
    fallbackNickname?: string
  ): Promise<string> => {
    if (!isWalletAddress(targetAddress)) {
      return normalizeContactName(fallbackNickname ?? '') ?? '';
    }

    const lowerTargetAddress = targetAddress.toLowerCase();
    try {
      const names = await fetchOnChainNicknames([lowerTargetAddress]);
      const fromChain = names.get(lowerTargetAddress);
      if (fromChain) {
        return fromChain;
      }
    } catch {
    }

    return normalizeContactName(fallbackNickname ?? '') ?? '';
  };

  const resolveRecentPeersWithMeta = async (contract: unknown, user: string): Promise<RecentPeerMeta[]> => {
    if (!isWalletAddress(user)) {
      return [];
    }

    const getRecentPeersWithMetaFn = (contract as { getRecentPeersWithMeta?: (userArg: string) => Promise<unknown> })
      .getRecentPeersWithMeta;
    if (!getRecentPeersWithMetaFn) {
      return [];
    }

    try {
      const recentPeersRaw = await getRecentPeersWithMetaFn(user);
      const userKey = user.toLowerCase();
      return parseRecentPeersWithMetaResult(recentPeersRaw).filter((peer) => peer.address.toLowerCase() !== userKey);
    } catch {
      return [];
    }
  };

  const resolveConversationBlockRange = async (
    contract: unknown,
    me: string,
    peer: string
  ): Promise<ConversationBlockRange | null> => {
    if (!isWalletAddress(me) || !isWalletAddress(peer)) {
      return null;
    }

    const getConversationBlockRangeFn = (contract as {
      getConversationBlockRange?: (meArg: string, peerArg: string) => Promise<unknown>;
    }).getConversationBlockRange;
    if (getConversationBlockRangeFn) {
      try {
        const rangeRaw = await getConversationBlockRangeFn(me, peer);
        const parsed = parseConversationBlockRange(rangeRaw);
        if (parsed) {
          return parsed;
        }
      } catch {
      }
    }

    const getLastBlockForConversationFn = (contract as {
      getLastBlockForConversation?: (meArg: string, peerArg: string) => Promise<unknown>;
    }).getLastBlockForConversation;
    if (!getLastBlockForConversationFn) {
      return null;
    }

    try {
      const lastBlock = toSafeNumber(await getLastBlockForConversationFn(me, peer));
      if (lastBlock <= 0) {
        return null;
      }

      const getFirstBlockForConversationFn = (contract as {
        getFirstBlockForConversation?: (meArg: string, peerArg: string) => Promise<unknown>;
      }).getFirstBlockForConversation;
      const firstBlockRaw = getFirstBlockForConversationFn
        ? await getFirstBlockForConversationFn(me, peer).catch(() => 0)
        : 0;
      const firstBlock = Math.max(0, Math.min(toSafeNumber(firstBlockRaw), lastBlock));
      return { firstBlock, lastBlock };
    } catch {
      return null;
    }
  };

  const applyStateBackupPayload = (
    walletKey: string,
    payload: StateBackupPayload,
    backupBlockNumber?: number
  ) => {
    const currentBackupTs = lastAppliedStateBackupTsRef.current[walletKey] ?? 0;
    if (payload.updatedAt < currentBackupTs) {
      return;
    }

    const snapshotLastReadAllTs = normalizeLastReadAllTs(payload.lastReadAllTs);

    if (snapshotLastReadAllTs > lastReadAllTsRef.current) {
      lastReadAllTsRef.current = snapshotLastReadAllTs;
      setLastReadAllTs((previous) => (snapshotLastReadAllTs > previous ? snapshotLastReadAllTs : previous));
      setUnreadMap((previous) => {
        if (Object.keys(previous).length === 0) {
          return previous;
        }
        unreadMapRef.current = {};
        return {};
      });
      setUnreadGroupMap((previous) => {
        if (Object.keys(previous).length === 0) {
          return previous;
        }
        unreadGroupMapRef.current = {};
        return {};
      });
    }

    lastAppliedStateBackupTsRef.current[walletKey] = payload.updatedAt;
    lastBackedUpStateFingerprintRef.current[walletKey] = createStateBackupFingerprint(snapshotLastReadAllTs);
    if (typeof backupBlockNumber === 'number' && Number.isFinite(backupBlockNumber)) {
      lastStateBackupBlockRef.current[walletKey] = backupBlockNumber;
      lastAutoBackupAttemptBlockRef.current[walletKey] = backupBlockNumber;
    }
    debugLog('[apply] applied state backup', {
      walletKey,
      updatedAt: payload.updatedAt,
      lastReadAllTs: snapshotLastReadAllTs
    });
  };

  const restoreStateFromChainSelfBackup = async (address?: string): Promise<boolean> => {
    const targetAddress = (address ?? walletAddress).trim();
    if (!isWalletAddress(targetAddress)) {
      return false;
    }

    try {
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      const selfFilter = contract.filters.MessageSubmitted(targetAddress, targetAddress);
      const selfConversationRange = await resolveConversationBlockRange(contract, targetAddress, targetAddress);
      if (!selfConversationRange || selfConversationRange.lastBlock <= 0) {
        return false;
      }
      const latestSelfConversationBlock = Math.min(latestBlock, selfConversationRange.lastBlock);
      const earliestSelfConversationBlock = Math.max(
        0,
        Math.min(selfConversationRange.firstBlock, latestSelfConversationBlock)
      );

      let latestPayload: StateBackupPayload | null = null;
      let latestPayloadBlockNumber: number | undefined;

      const tryDecodeBackupLogs = async (
        logs: Array<{
          blockNumber: number;
          index: number;
          args?: Record<string, unknown>;
        }>
      ) => {
        if (logs.length === 0 || latestPayload) {
          return;
        }

        const sortedLogs = [...logs].sort((left, right) => {
          if (left.blockNumber !== right.blockNumber) {
            return right.blockNumber - left.blockNumber;
          }

          return right.index - left.index;
        });

        for (const log of sortedLogs) {
          const args = (log as { args?: Record<string, unknown> }).args;
          const ciphertextCandidates = [
            extractUserCiphertext(args?.messageForSender),
            extractUserCiphertext(args?.messageForRecipient)
          ];

          for (const candidate of ciphertextCandidates) {
            if (!candidate || candidate.value.length === 0) {
              continue;
            }

            try {
              const decrypted = await signer.decryptValue(candidate as never);
              const raw = typeof decrypted === 'string' ? decrypted : decrypted.toString();
              const plain = decodeMemoPlaintext(raw);
              const parsed = parseStateBackupText(plain);
              if (parsed) {
                latestPayload = parsed;
                latestPayloadBlockNumber = log.blockNumber;
                return;
              }
            } catch {
            }
          }
        }
      };

      if (latestSelfConversationBlock > 0) {
        const headBlock = latestSelfConversationBlock;
        const headLogs = await contract.queryFilter(selfFilter, headBlock, headBlock);
        await tryDecodeBackupLogs(headLogs as Array<{ blockNumber: number; index: number; args?: Record<string, unknown> }>);
      }

      let windowEnd = latestSelfConversationBlock;
      while (windowEnd >= earliestSelfConversationBlock && !latestPayload) {
        const windowStart = Math.max(earliestSelfConversationBlock, windowEnd - SELF_BACKUP_RESTORE_BLOCK_WINDOW + 1);
        const windowLogs = await contract.queryFilter(selfFilter, windowStart, windowEnd);
        await tryDecodeBackupLogs(windowLogs as Array<{ blockNumber: number; index: number; args?: Record<string, unknown> }>);

        if (windowStart <= earliestSelfConversationBlock) {
          break;
        }

        windowEnd = windowStart - 1;
      }

      const resolvedLatestPayload = latestPayload as StateBackupPayload | null;
      if (!resolvedLatestPayload) {
        return false;
      }
      applyStateBackupPayload(targetAddress.toLowerCase(), resolvedLatestPayload, latestPayloadBlockNumber);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
      return true;
    } catch {
      return false;
    }
  };

  const runPostConnectDataSyncUntilApplied = async (address: string): Promise<void> => {
    const targetAddress = address.trim().toLowerCase();
    if (!isWalletAddress(targetAddress)) {
      return;
    }

    const runId = ++postConnectDataSyncRunIdRef.current;

    for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
      if (runId !== postConnectDataSyncRunIdRef.current) {
        return;
      }

      if (currentWalletKeyRef.current !== targetAddress) {
        return;
      }

      if (normalizeLastReadAllTs(lastReadAllTsRef.current) > 0) {
        return;
      }

      const restored = await restoreStateFromChainSelfBackup(targetAddress);
      if (restored) {
        return;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1500);
      });
    }
  };

  const backupLocalStateToSelf = async (options?: BackupLocalStateOptions) => {
    if (backupInFlightRef.current) {
      return;
    }

    if (!walletAddress || !isWalletAddress(walletAddress)) {
      return;
    }

    const walletKey = walletAddress.toLowerCase();

    try {
      backupInFlightRef.current = true;

      const { signer, cacheKey } = await getMemoSigner();
      const selector = await resolveSubmitSelector();

      const snapshotLastReadAllTs = normalizeLastReadAllTs(lastReadAllTsRef.current);
      const payload = buildStateBackupPayload(snapshotLastReadAllTs);
      const nextFingerprint = createStateBackupFingerprint(snapshotLastReadAllTs);
      if (!options?.force && lastBackedUpStateFingerprintRef.current[walletKey] === nextFingerprint) {
        return;
      }
      const backupText = buildStateBackupText(payload);
      const encodedMemo = encodeMemoPlaintext(backupText);
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const requiredFee = await resolveRequiredFeeForSend();
      const cachedMemoEntry = cachedStateBackupMemoRef.current[walletKey];
      const hasReusableMemo = cachedMemoEntry?.fingerprint === nextFingerprint;

      const buildMemoPayload = async (): Promise<SubmitMemoPayload> => {
        const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
        return parseSubmitMemoPayload(encryptedMemo);
      };

      let memoPayload = hasReusableMemo ? cachedMemoEntry.memo : await buildMemoPayload();
      if (!hasReusableMemo) {
        cachedStateBackupMemoRef.current[walletKey] = { fingerprint: nextFingerprint, memo: memoPayload };
      }

      const submitWithMemoPayload = async (payloadToSubmit: SubmitMemoPayload): Promise<void> => {
        const memoTuple = [[payloadToSubmit.ciphertextValue], payloadToSubmit.signature] as const;
        await contract.submit(walletAddress, memoTuple, { value: requiredFee });
      };

      try {
        await submitWithMemoPayload(memoPayload);
      } catch (submitError) {
        if (!hasReusableMemo) {
          throw submitError;
        }

        memoPayload = await buildMemoPayload();
        cachedStateBackupMemoRef.current[walletKey] = { fingerprint: nextFingerprint, memo: memoPayload };
        await submitWithMemoPayload(memoPayload);
      }

      // Apply the backup payload locally so local state and localStorage update immediately
      try {
        applyStateBackupPayload(walletKey, payload);
      } catch (e) {}

      lastBackedUpStateFingerprintRef.current[walletKey] = nextFingerprint;
      lastAppliedStateBackupTsRef.current[walletKey] = payload.updatedAt;

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
    } catch {
    } finally {
      backupInFlightRef.current = false;
    }
  };

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
          let reactionToTxHash: string | undefined;
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
              reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
            reactionToTxHash,
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
        let reactionToTxHash: string | undefined;
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
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
          reactionToTxHash,
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
          let reactionToTxHash: string | undefined;
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
              reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
            reactionToTxHash,
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
        let reactionToTxHash: string | undefined;
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
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
          reactionToTxHash,
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
                  (candidate.replyToTxHash ?? '') !== (entry.replyToTxHash ?? '') ||
                  (candidate.reactionToTxHash ?? '') !== (entry.reactionToTxHash ?? '') ||
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
                reactionToTxHash: entry.reactionToTxHash,
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
        let reactionToTxHash: string | undefined;
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
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
          reactionToTxHash,
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
        let reactionToTxHash: string | undefined;
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
            reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
          reactionToTxHash,
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
              reactionToTxHash: entry.reactionToTxHash,
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

      if (fromBlock <= toBlock) {
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

        const groupIdFromArgs = (value: unknown): number => {
          const parsed = toSafeNumber(value);
          return parsed > 0 ? parsed : 0;
        };

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

      if (knownGroupIds.size === 0 && options?.deep) {
        const nextGroupId = toSafeNumber(await contract.nextGroupId());
        const cappedGroupId = Math.min(nextGroupId, 250);
        for (let groupId = 1; groupId < cappedGroupId; groupId += 1) {
          knownGroupIds.add(groupId);
        }
      }

      if (knownGroupIds.size === 0 && !options?.deep) {
        return;
      }

      const nowTs = Math.floor(Date.now() / 1000);
      const nextGroups: GroupSummary[] = [];
      const nextInvites: GroupInvite[] = [];
      await Promise.all(
        Array.from(knownGroupIds).map(async (groupId) => {
          if (!Number.isFinite(groupId) || groupId <= 0) {
            return;
          }

          const [memberRaw, inviteRaw] = await Promise.all([
            contract.isMember(groupId, requestedWalletAddress).catch(() => false),
            contract.getInvite(groupId, requestedWalletAddress).catch(() => null)
          ]);

          const isMember = Boolean(memberRaw);
          const invitePending = Boolean(
            inviteRaw && typeof inviteRaw === 'object' ? (inviteRaw as { pending?: unknown }).pending : null
          ) ||
            (Array.isArray(inviteRaw) ? Boolean(inviteRaw[0]) : false);
          const inviteInviter = inviteRaw && typeof inviteRaw === 'object'
            ? String((inviteRaw as { inviter?: unknown }).inviter ?? '')
            : Array.isArray(inviteRaw)
              ? String(inviteRaw[1] ?? '')
              : '';
          const inviteExpiresAt = inviteRaw && typeof inviteRaw === 'object'
            ? toSafeNumber((inviteRaw as { expiresAt?: unknown }).expiresAt)
            : Array.isArray(inviteRaw)
              ? toSafeNumber(inviteRaw[2])
              : 0;
          const inviteExpired = inviteRaw && typeof inviteRaw === 'object'
            ? Boolean((inviteRaw as { expired?: unknown }).expired)
            : Array.isArray(inviteRaw)
              ? Boolean(inviteRaw[3])
              : inviteExpiresAt > 0 && inviteExpiresAt <= nowTs;

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
            const membersRaw = await contract.getGroupMembers(groupId).catch(() => []);
            const members = Array.isArray(membersRaw)
              ? membersRaw
                  .map((addressValue) => String(addressValue ?? '').trim())
                  .filter((addressValue) => isWalletAddress(addressValue))
              : [];

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

      const previousGroups = groupsRef.current;
      const nextGroupIdSet = new Set(nextGroups.map((group) => group.id));
      const removedGroupsForWallet = previousGroups.filter((group) => !nextGroupIdSet.has(group.id));
      const removalNoticeSeenGroupIds =
        groupRemovalNoticeSeenRef.current[walletKey] ??
        (groupRemovalNoticeSeenRef.current[walletKey] = new Set<number>());
      const removedNowGroupIds = Array.from(removedGroupIdsForWallet).filter(
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
        const groupFromBlock = options?.deep
          ? 0
          : typeof previousGroupMessageBlock === 'number'
            ? previousGroupMessageBlock + 1
            : Math.max(0, latestBlock - INITIAL_SYNC_LOOKBACK_BLOCKS);

        if (groupFromBlock <= latestBlock) {
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
            let reactionToTxHash: string | undefined;
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
                reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
              reactionToTxHash,
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
            let reactionToTxHash: string | undefined;
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
                reactionToTxHash = parsedMessage.embeddedReaction?.targetTxHash;
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
              reactionToTxHash,
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
                  reactionToTxHash: entry.reactionToTxHash,
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
        chainId !== COTI_NETWORK.chainIdDecimal
      ) {
        setActiveGroupJoinCodes([]);
        setLoadingActiveGroupJoinCodes(false);
        return;
      }

      try {
        setLoadingActiveGroupJoinCodes(true);
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const contract = new cotiEthers.Contract(
          GROUP_CHAT_CONTRACT_ADDRESS,
          GROUP_CHAT_CONTRACT_ABI,
          readProvider
        );
        const latestBlock = await readProvider.getBlockNumber();
        if (
          currentWalletKeyRef.current !== requestedWalletKey ||
          activeGroupIdRef.current !== groupId
        ) {
          return;
        }

        const [createdLogs, revokedLogs] = await Promise.all([
          contract.queryFilter(contract.filters.GroupJoinCodeCreated(groupId, null, null), 0, latestBlock),
          contract.queryFilter(contract.filters.GroupJoinCodeRevoked(groupId, null, null), 0, latestBlock)
        ]);
        if (
          currentWalletKeyRef.current !== requestedWalletKey ||
          activeGroupIdRef.current !== groupId
        ) {
          return;
        }

        type JoinCodeLifecycleEvent = {
          kind: 'created' | 'revoked';
          codeHash: string;
          creator?: string;
          blockNumber: number;
          logIndex: number;
        };

        const lifecycleEvents: JoinCodeLifecycleEvent[] = [];
        for (const log of createdLogs) {
          const args = (log as { args?: Record<string, unknown> }).args;
          const codeHash = String(args?.codeHash ?? '').trim().toLowerCase();
          if (!/^0x[a-f0-9]{64}$/.test(codeHash)) {
            continue;
          }
          const creatorCandidate = String(args?.creator ?? '').trim();
          lifecycleEvents.push({
            kind: 'created',
            codeHash,
            creator: isWalletAddress(creatorCandidate) ? creatorCandidate : undefined,
            blockNumber: log.blockNumber,
            logIndex: log.index
          });
        }

        for (const log of revokedLogs) {
          const args = (log as { args?: Record<string, unknown> }).args;
          const codeHash = String(args?.codeHash ?? '').trim().toLowerCase();
          if (!/^0x[a-f0-9]{64}$/.test(codeHash)) {
            continue;
          }
          lifecycleEvents.push({
            kind: 'revoked',
            codeHash,
            blockNumber: log.blockNumber,
            logIndex: log.index
          });
        }

        lifecycleEvents.sort((left, right) => {
          if (left.blockNumber !== right.blockNumber) {
            return left.blockNumber - right.blockNumber;
          }
          return left.logIndex - right.logIndex;
        });

        const activeByHash = new Map<string, { creator?: string }>();
        for (const event of lifecycleEvents) {
          if (event.kind === 'created') {
            activeByHash.set(event.codeHash, { creator: event.creator });
            continue;
          }
          activeByHash.delete(event.codeHash);
        }

        const nowTs = Math.floor(Date.now() / 1000);
        const nextActiveCodes: ActiveGroupJoinCode[] = [];
        await Promise.all(
          Array.from(activeByHash.entries()).map(async ([codeHash, metadata]) => {
            const joinCodeRaw = await contract.getJoinCode(groupId, codeHash).catch(() => null);
            const joinCodeState = parseGroupJoinCodeState(joinCodeRaw);
            if (!joinCodeState || !joinCodeState.active) {
              return;
            }

            const expiresAt = toSafeNumber(joinCodeState.expiresAt);
            const isExpired = joinCodeState.expired || (expiresAt > 0 && expiresAt <= nowTs);
            const usesLeft = Math.max(0, toSafeNumber(joinCodeState.usesLeft));
            if (isExpired || usesLeft <= 0) {
              return;
            }

            const creator =
              isWalletAddress(joinCodeState.creator) ? joinCodeState.creator : metadata.creator ?? '';
            nextActiveCodes.push({
              groupId,
              codeHash,
              code: getStoredGroupJoinCodeForHash(requestedWalletKey, groupId, codeHash),
              creator,
              expiresAt,
              usesLeft
            });
          })
        );
        if (
          currentWalletKeyRef.current !== requestedWalletKey ||
          activeGroupIdRef.current !== groupId
        ) {
          return;
        }

        nextActiveCodes.sort((left, right) => {
          const leftExpiry = left.expiresAt > 0 ? left.expiresAt : Number.MAX_SAFE_INTEGER;
          const rightExpiry = right.expiresAt > 0 ? right.expiresAt : Number.MAX_SAFE_INTEGER;
          if (leftExpiry !== rightExpiry) {
            return leftExpiry - rightExpiry;
          }
          if (left.usesLeft !== right.usesLeft) {
            return right.usesLeft - left.usesLeft;
          }
          return left.codeHash.localeCompare(right.codeHash);
        });

        setActiveGroupJoinCodes(nextActiveCodes);
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
    [walletAddress, chainId]
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

    const requestedWalletAddress = walletAddress.trim();
    const requestedWalletKey = requestedWalletAddress.toLowerCase();
    try {
      setProcessingGroupAction(true);
      setRevokingGroupJoinCodeHash(normalizedCodeHash);
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const tx = await contract.revokeJoinCode(activeGroupId, normalizedCodeHash);
      await tx.wait();

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));

      if (generatedGroupJoinCodeHash.trim().toLowerCase() === normalizedCodeHash) {
        setGeneratedGroupInviteCode('');
        setGeneratedGroupJoinCodeHash('');
      }

      if (isWalletAddress(requestedWalletAddress)) {
        deleteStoredGroupJoinCodeForHash(requestedWalletKey, activeGroupId, normalizedCodeHash);
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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const encodedTitle = await encodeStoredGroupTitle(title, newGroupIsPrivate);
      const tx = await contract.createGroup(encodedTitle, initialMembers);
      await tx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const inviteTtlMaxRaw = await contract.INVITE_TTL_MAX().catch(() => null);
      const inviteTtlMax = toSafeNumber(inviteTtlMaxRaw);
      if (inviteTtlMax > 0 && ttlParsed > inviteTtlMax) {
        setError(`Invite TTL exceeds on-chain max (${Math.floor(inviteTtlMax / 3600)}h).`);
        return;
      }
      const tx = await contract.inviteMembers(activeGroupId, accounts, ttlParsed);
      await tx.wait();

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
    const requestedWalletKey = requestedWalletAddress.toLowerCase();

    const code = generateRandomGroupJoinCode();
    let expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    try {
      setProcessingGroupAction(true);
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const codeHash = cotiEthers.keccak256(cotiEthers.toUtf8Bytes(code));
      const joinCodeTtlMaxRaw = await contract.JOIN_CODE_TTL_MAX().catch(() => null);
      const joinCodeTtlMax = toSafeNumber(joinCodeTtlMaxRaw);
      if (joinCodeTtlMax > 0 && ttlSeconds > joinCodeTtlMax) {
        setError(`Join-code TTL exceeds on-chain max (${Math.floor(joinCodeTtlMax / 3600)}h).`);
        return;
      }
      let maxUses = DEFAULT_GROUP_JOIN_CODE_MAX_USES;
      if (groupJoinCodeMode === 'multi') {
        const requestedMultiUses = Math.floor(Number(groupJoinCodeMaxUsesInput));
        if (!Number.isFinite(requestedMultiUses) || requestedMultiUses < 2) {
          setError('Multi-use codes require a max uses value of at least 2.');
          return;
        }
        const contractMaxUsesRaw = await contract.JOIN_CODE_MAX_USES().catch(() => null);
        const contractMaxUses = toSafeNumber(contractMaxUsesRaw);
        if (contractMaxUses <= 1) {
          setError('Multi-use join codes are not available on this contract.');
          return;
        }
        if (requestedMultiUses > contractMaxUses) {
          setError(`Max uses exceeds the on-chain limit (${contractMaxUses}).`);
          return;
        }
        maxUses = requestedMultiUses;
      }

      const tx = await contract.createJoinCode(
        activeGroupId,
        codeHash,
        ttlSeconds,
        maxUses
      );
      await tx.wait();

      const joinCodeRaw = await contract.getJoinCode(activeGroupId, codeHash).catch(() => null);
      const joinCodeState = parseGroupJoinCodeState(joinCodeRaw);
      if (joinCodeState && joinCodeState.expiresAt > 0) {
        expiresAt = joinCodeState.expiresAt;
      }

      const inviterAddress = requestedWalletAddress;
      const payload: GroupJoinCodePayload = {
        version: 2,
        groupId: activeGroupId,
        code,
        expiresAt,
        inviter: isWalletAddress(inviterAddress) ? inviterAddress : undefined
      };
      setGeneratedGroupInviteCode(encodeGroupInviteCode(payload));
      setGeneratedGroupJoinCodeHash(codeHash);
      if (isWalletAddress(requestedWalletAddress)) {
        setStoredGroupJoinCodeForHash(requestedWalletKey, activeGroupId, codeHash, code);
      }

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
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, readProvider);
        const inviteRaw = await contract.getInvite(parsedCode.groupId, requestedWalletAddress).catch(() => null);

        const pending = Boolean(
          inviteRaw && typeof inviteRaw === 'object' ? (inviteRaw as { pending?: unknown }).pending : null
        ) ||
          (Array.isArray(inviteRaw) ? Boolean(inviteRaw[0]) : false);
        const inviteExpiresAt = inviteRaw && typeof inviteRaw === 'object'
          ? toSafeNumber((inviteRaw as { expiresAt?: unknown }).expiresAt)
          : Array.isArray(inviteRaw)
            ? toSafeNumber(inviteRaw[2])
            : 0;
        const inviteExpired = inviteRaw && typeof inviteRaw === 'object'
          ? Boolean((inviteRaw as { expired?: unknown }).expired)
          : Array.isArray(inviteRaw)
            ? Boolean(inviteRaw[3])
            : inviteExpiresAt > 0 && inviteExpiresAt <= nowTs;

        if (!pending || inviteExpired) {
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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const normalizedCode = parsedJoinCode.code.trim().toUpperCase();
      if (!normalizedCode) {
        setError('Invalid group code.');
        return;
      }

      const codeHash = cotiEthers.keccak256(cotiEthers.toUtf8Bytes(normalizedCode));
      const [isAlreadyMemberRaw, joinCodeRaw] = await Promise.all([
        contract.isMember(parsedJoinCode.groupId, requestedWalletAddress).catch(() => false),
        contract.getJoinCode(parsedJoinCode.groupId, codeHash).catch(() => null)
      ]);

      if (isAlreadyMemberRaw) {
        setError('You are already a member of this group.');
        return;
      }

      const joinCodeState = parseGroupJoinCodeState(joinCodeRaw);
      if (!joinCodeState || !joinCodeState.active) {
        setError('This group code is no longer active. Ask for a new code.');
        return;
      }
      if (joinCodeState.expired || (joinCodeState.expiresAt > 0 && joinCodeState.expiresAt <= nowTs)) {
        setError('This group code has expired.');
        return;
      }
      if (joinCodeState.usesLeft <= 0) {
        setError('This group code has no remaining uses.');
        return;
      }

      const tx = await contract.joinWithCode(parsedJoinCode.groupId, normalizedCode);
      await tx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const tx = await contract.removeMember(activeGroupId, account);
      await tx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const encodedTitle = await encodeStoredGroupTitle(nextTitle, Boolean(activeGroupMeta?.isPrivate));
      const tx = await contract.setGroupTitle(groupId, encodedTitle);
      await tx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const tx = await contract.leaveGroup(groupId);
      await tx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const burnMember = await contract.isMember(groupId, burnAddress).catch(() => false);
      if (!burnMember) {
        const addTx = await contract.addMembers(groupId, [burnAddress]);
        await addTx.wait();
      }

      const transferTx = await contract.setGroupAdmin(groupId, burnAddress);
      await transferTx.wait();

      const leaveTx = await contract.leaveGroup(groupId);
      await leaveTx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const tx = await contract.disbandGroup(groupId);
      await tx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const tx = await contract.acceptInvite(groupId);
      await tx.wait();

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
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const tx = await contract.declineInvite(groupId);
      await tx.wait();

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

    const plainText = (overrideMessageText ?? messageInput).trim();
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
            timestamp: localMessageTimestamp,
            deliveryState: 'pending'
          }
        ]
      }));

      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const selector = await resolveGroupSubmitSelector();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const paymentMode = groupFeeModeSelection === 'token' ? 1 : 0;
      const requiredFee = paymentMode === 0 ? await resolveRequiredFeeForGroupSend() : 0n;
      if (paymentMode === 1) {
        const requiredTokenFee = await resolveRequiredTokenFeeForGroupSend();
        await ensureGroupTokenFeeAllowance(signer, requestedWalletAddress, requiredTokenFee);
      }

      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyingToMessage?.txHash
      );
      const encodedMemo = encodeMemoPlaintext(plainTextWithReply);
      const encryptedMemo = await signer.encryptValue(encodedMemo, GROUP_CHAT_CONTRACT_ADDRESS, selector);
      const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
      const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
      const gasLimitOverride = await resolveGroupSubmitGasLimit(
        contract,
        groupId,
        memoTuple,
        paymentMode,
        requiredFee
      );
      const tx = await contract.submitGroupMessageWithMode(
        groupId,
        memoTuple,
        paymentMode,
        gasLimitOverride !== null
          ? {
              value: requiredFee,
              gasLimit: gasLimitOverride
            }
          : { value: requiredFee }
      );
      const submittedTxHash = typeof tx?.hash === 'string' ? tx.hash : '';
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
      const message = getGroupActionErrorMessage(sendError, 'Failed to send group message.');
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
    const cotiEthers = await loadCotiEthersModule();
    const selector = await resolveSubmitSelector();
    const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
    const requiredFee = await resolveRequiredFeeForSend();
    const hiddenAliasPayload = buildMessageWithContactNamePayload('', normalizedContactName);
    const encodedMemo = encodeMemoPlaintext(hiddenAliasPayload);
    const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
    const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
    const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
    const tx = await contract.submit(normalizedAddress, memoTuple, { value: requiredFee });

    const nextOnboardInfo = signer.getUserOnboardInfo();
    setSessionOnboardInfo((previous) => ({
      ...previous,
      [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
    }));

    return typeof tx?.hash === 'string' ? tx.hash : '';
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
          'Burner wallet has insufficient funds. Do you want to top up now with MetaMask?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithMetaMask();
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
    const cotiEthers = await loadCotiEthersModule();
    const selector = await resolveSubmitSelector();
    const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
    const requiredFee = await resolveRequiredFeeForSend();
    const normalizedVisibleNotice = visibleNotice.replace(/\r?\n/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
    const hiddenStatePayload = buildMessageWithConversationStatePayload(normalizedVisibleNotice, normalizedState);
    const encodedMemo = encodeMemoPlaintext(hiddenStatePayload);
    const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
    const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
    const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
    const tx = await contract.submit(normalizedAddress, memoTuple, { value: requiredFee });
    const waitableTx = tx as { hash?: unknown; wait?: () => Promise<unknown> };
    const txHash = typeof waitableTx.hash === 'string' ? waitableTx.hash : '';

    const nextOnboardInfo = signer.getUserOnboardInfo();
    setSessionOnboardInfo((previous) => ({
      ...previous,
      [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
    }));

    if (typeof waitableTx.wait === 'function') {
      await waitableTx.wait();
    }

    return txHash;
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
          'Burner wallet has insufficient funds. Do you want to top up now with MetaMask?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithMetaMask();
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

    const existingReactions = activeThreadReactions.get(targetTxHash) ?? [];
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
    const reactionMemoText = buildMessageWithReactionPayload(targetTxHash, normalizedEmoji);

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
              reactionEmoji: normalizedEmoji,
              timestamp: localMessageTimestamp,
              deliveryState: 'pending'
            }
          ]
        }));

        const { signer, cacheKey } = await getMemoSigner();
        const cotiEthers = await loadCotiEthersModule();
        const selector = await resolveGroupSubmitSelector();
        const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
        const paymentMode = groupFeeModeSelection === 'token' ? 1 : 0;
        const requiredFee = paymentMode === 0 ? await resolveRequiredFeeForGroupSend() : 0n;
        if (paymentMode === 1) {
          const requiredTokenFee = await resolveRequiredTokenFeeForGroupSend();
          await ensureGroupTokenFeeAllowance(signer, requestedWalletAddress, requiredTokenFee);
        }
        const encodedMemo = encodeMemoPlaintext(reactionMemoText);
        const encryptedMemo = await signer.encryptValue(encodedMemo, GROUP_CHAT_CONTRACT_ADDRESS, selector);
        const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
        const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
        const gasLimitOverride = await resolveGroupSubmitGasLimit(
          contract,
          threadGroupId,
          memoTuple,
          paymentMode,
          requiredFee
        );
        const tx = await contract.submitGroupMessageWithMode(threadGroupId, memoTuple, paymentMode, {
          value: requiredFee,
          ...(gasLimitOverride !== null ? { gasLimit: gasLimitOverride } : {})
        });
        const submittedTxHash = typeof tx?.hash === 'string' ? tx.hash : '';

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
              reactionEmoji: normalizedEmoji,
              timestamp: localMessageTimestamp,
              deliveryState: 'pending'
            }
          ]
        }));

        const { signer, cacheKey } = await getMemoSigner();
        const cotiEthers = await loadCotiEthersModule();
        const selector = await resolveSubmitSelector();
        const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
        const requiredFee = await resolveRequiredFeeForSend();
        const encodedMemo = encodeMemoPlaintext(reactionMemoText);
        const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
        const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
        const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
        const tx = await contract.submit(threadContactAddress, memoTuple, { value: requiredFee });
        const submittedTxHash = typeof tx?.hash === 'string' ? tx.hash : '';

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
          ? getGroupActionErrorMessage(reactionError, 'Failed to send reaction.')
          : reactionError instanceof Error
            ? reactionError.message
            : 'Failed to send reaction.';
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
          'Burner wallet has insufficient funds. Do you want to top up now with MetaMask?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithMetaMask();
        }
      }
    } finally {
      setSendingReaction(false);
    }
  };

  const sendMessage = async (overrideMessageText?: string) => {
    setError('');

    if (sendingRef.current) {
      return;
    }

    const plainText = (overrideMessageText ?? messageInput).trim();
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
    const replyingPreviewText = replyingToMessage ? getMessageDisplayText(replyingToMessage.text) : undefined;
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
            replyToMessageId: replyingToMessage?.id,
            replyToText: replyingPreviewText ? trimReplyPreview(replyingPreviewText) : undefined,
            replyToTxHash: replyingToMessage?.txHash,
            timestamp: localMessageTimestamp,
            deliveryState: 'pending'
          }
        ]
      }));

      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const selector = await resolveSubmitSelector();
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const requiredFee = await resolveRequiredFeeForSend();
      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyingToMessage?.txHash
      );
      const sendEncryptedMemo = async (textToSend: string): Promise<string> => {
        const encodedMemo = encodeMemoPlaintext(textToSend);
        const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
        const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
        const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
        const tx = await contract.submit(contactAddress, memoTuple, { value: requiredFee });
        return typeof tx?.hash === 'string' ? tx.hash : '';
      };

      const submittedTxHash = await sendEncryptedMemo(plainTextWithReply);
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
                  (message.replyToTxHash ?? '') === (localMessageRecord.replyToTxHash ?? '')
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
                  deliveryState: 'sent',
                  txHash: submittedTxHash || undefined
                }
              : message
          )
        };
      });

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
      const message = sendError instanceof Error ? sendError.message : 'Failed to send message.';
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
          'Burner wallet has insufficient funds. Do you want to top up now with MetaMask?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithMetaMask();
        }
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
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
      const encodedTipMemo = encodeMemoPlaintext(tipNoticeText);
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
          'Burner wallet has insufficient funds. Do you want to top up now with MetaMask?'
        );
        if (shouldTopUp) {
          await topUpBurnerWithMetaMask();
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
    const normalizedWalletAddress = walletAddress.trim();
    const hasReadableState = normalizeLastReadAllTs(lastReadAllTs) > 0;
    const canAutoBackupReadState =
      isWalletAddress(normalizedWalletAddress) &&
      hasAesReady &&
      chainId === COTI_NETWORK.chainIdDecimal &&
      hasReadableState;

    if (!canAutoBackupReadState) {
      if (readStateBackupTimerRef.current !== null) {
        window.clearTimeout(readStateBackupTimerRef.current);
        readStateBackupTimerRef.current = null;
      }
      return;
    }

    if (readStateBackupTimerRef.current !== null) {
      return;
    }

    const now = Date.now();
    const dueAt = Math.max(
      now + READ_STATE_BACKUP_DEBOUNCE_MS,
      lastReadStateBackupSubmittedAtRef.current + READ_STATE_BACKUP_MIN_INTERVAL_MS
    );
    const delay = Math.max(0, dueAt - now);

    readStateBackupTimerRef.current = window.setTimeout(() => {
      readStateBackupTimerRef.current = null;
      lastReadStateBackupSubmittedAtRef.current = Date.now();
      backupLocalStateToSelf({ background: true }).catch(() => {});
    }, delay);
  }, [walletAddress, hasAesReady, chainId, lastReadAllTs]);

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
    if (activeGroupId === null || !walletAddress || chainId !== COTI_NETWORK.chainIdDecimal) {
      setActiveGroupJoinCodes([]);
      setLoadingActiveGroupJoinCodes(false);
      setRevokingGroupJoinCodeHash('');
      return;
    }

    loadActiveJoinCodesForGroup(activeGroupId, { silent: true }).catch(() => {});
  }, [activeGroupId, walletAddress, chainId, activeGroupMeta?.lastBlock, loadActiveJoinCodesForGroup]);

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
    lastReadStateBackupSubmittedAtRef.current = 0;
    if (readStateBackupTimerRef.current !== null) {
      window.clearTimeout(readStateBackupTimerRef.current);
      readStateBackupTimerRef.current = null;
    }
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
      ? Boolean(activeContactRecord.hidden)
      : !Boolean(activeContactRecord.hidden);
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
    if (!isConnected || !activeContact) {
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

      loadOlderMessagesForActiveContact().catch(() => {});
    };

    stickToBottomRef.current = isNearBottom(container);
    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [isConnected, activeContact, walletAddress, hasAesReady]);

  useEffect(() => {
    return () => {
      if (groupRemovalNoticeTimeoutRef.current !== null) {
        window.clearTimeout(groupRemovalNoticeTimeoutRef.current);
      }
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      if (readStateBackupTimerRef.current !== null) {
        window.clearTimeout(readStateBackupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const activeContactChanged = previousActiveContactForScrollRef.current !== activeThreadKey;
    const currentLastMessageId = activeThreadMessages.length > 0 ? activeThreadMessages[activeThreadMessages.length - 1].id : null;
    const latestMessageChanged = previousLastMessageIdForScrollRef.current !== currentLastMessageId;
    if (activeContactChanged) {
      stickToBottomRef.current = true;
      previousActiveContactForScrollRef.current = activeThreadKey;
    }
    previousLastMessageIdForScrollRef.current = currentLastMessageId;

    if (!activeContactChanged && (!latestMessageChanged || !stickToBottomRef.current)) {
      return;
    }

    let cancelled = false;

    const scrollToBottomAfterLayout = () => {
      if (cancelled) {
        return;
      }

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
  }, [activeThreadKey, activeThreadMessages]);

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
  }, [activeThreadKey, activeThreadMessages]);

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
  }, [activeThreadKey]);

  useEffect(() => {
    const previousWallet = previousWalletAddressRef.current;
    const nextWallet = walletAddress.trim().toLowerCase();

    if (previousWallet !== nextWallet) {
      postConnectDataSyncRunIdRef.current += 1;
      stickToBottomRef.current = true;
      previousActiveContactForScrollRef.current = null;
      previousLastMessageIdForScrollRef.current = null;
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
  }, [isConnected, activeThreadKey]);

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

    syncConversationHistoryRef.current({
      contactsOnly: true,
      previewPerContact: true,
      updateHead: true
    }).catch(() => {});
    const walletKey = walletAddress.trim().toLowerCase();
    if (isWalletAddress(walletKey) && !conversationDeepBackfillDoneRef.current[walletKey]) {
      conversationDeepBackfillDoneRef.current[walletKey] = true;
      syncConversationHistoryRef.current({ background: true, deep: true }).catch(() => {
        delete conversationDeepBackfillDoneRef.current[walletKey];
      });
    }
    setupRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      clearPollFallback();
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

    syncGroupDataRef.current({ background: true, overviewOnly: true }).catch(() => {});
    if (groupsRef.current.length === 0 && groupInvitesRef.current.length === 0) {
      syncGroupDataRef.current({ background: true, deep: true, overviewOnly: true }).catch(() => {});
    }
    setupGroupRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      clearPollFallback();
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
      groupDeepBackfillDoneRef.current[groupBackfillKey] = true;
      syncGroupDataRef.current({ background: true, deep: true }).catch(() => {
        delete groupDeepBackfillDoneRef.current[groupBackfillKey];
      });
    }
  }, [activeGroupId, walletAddress, hasAesReady, chainId]);

  useEffect(() => {
    const provider = getConnectedProvider();

    refreshWalletState(provider).catch(() => {
      setError('Unable to read wallet state.');
    });

    if (!provider?.on || !provider?.removeListener) {
      return;
    }

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : [];
      const selected = nextAccounts[0] ?? '';
      setWalletAddress(selected);
      if (!selected) {
        setStatus('Disconnected');
        setChainId(null);
      }
    };

    const handleChainChanged = (newChainId: unknown) => {
      if (typeof newChainId === 'string' || typeof newChainId === 'number') {
        setChainId(normalizeChainId(newChainId));
      }
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [activeProvider, connectionMethod]);

  const renderActiveJoinCodeList = (mobile = false) => {
    const dropdownClassName = mobile
      ? 'group-active-codes-dropdown group-active-codes-dropdown-mobile'
      : 'group-active-codes-dropdown';
    const summaryLabel = loadingActiveGroupJoinCodes
      ? 'Active codes (loading...)'
      : `Active codes ${activeGroupJoinCodes.length}`;

    return (
      <details className={dropdownClassName}>
        <summary>{summaryLabel}</summary>
        {loadingActiveGroupJoinCodes ? (
          <ul className="group-active-codes-list">
            <li className="group-active-code-empty">Loading active codes...</li>
          </ul>
        ) : activeGroupJoinCodes.length === 0 ? (
          <ul className="group-active-codes-list">
            <li className="group-active-code-empty">No active codes found for this group.</li>
          </ul>
        ) : (
          <ul className="group-active-codes-list">
            {activeGroupJoinCodes.map((entry) => {
              const copyValue = entry.code
                ? encodeGroupInviteCode({
                    version: 2,
                    groupId: entry.groupId,
                    code: entry.code,
                    expiresAt: entry.expiresAt,
                    inviter: isWalletAddress(entry.creator) ? entry.creator : undefined
                  })
                : entry.codeHash;
              const copyKey = `group-active-code:${entry.groupId}:${entry.codeHash}`;
              const isRevokingThisCode = revokingGroupJoinCodeHash.toLowerCase() === entry.codeHash.toLowerCase();
              return (
                <li key={`active-join-code:${entry.groupId}:${entry.codeHash}`} className="group-active-code-item">
                  <div className="group-active-code-row">
                    <input
                      className="group-generated-code-value"
                      value={copyValue}
                      readOnly
                      aria-label={entry.code ? 'Active join code' : 'Active join code hash'}
                    />
                    <button
                      type="button"
                      className={
                        lastCopiedKey === copyKey
                          ? 'group-generated-code-copy copied'
                          : 'group-generated-code-copy'
                      }
                      onClick={(event) => {
                        copyWithFeedback(copyValue, copyKey).catch(() => {});
                        const detailsElement = event.currentTarget.closest('details');
                        if (detailsElement instanceof HTMLDetailsElement) {
                          detailsElement.open = false;
                        }
                      }}
                    >
                      {lastCopiedKey === copyKey ? 'Copied' : entry.code ? 'Copy code' : 'Copy hash'}
                    </button>
                    <button
                      type="button"
                      className="contact group-active-code-revoke"
                      onClick={() => {
                        revokeJoinCodeForActiveGroup(entry.codeHash, entry.code).catch(() => {});
                      }}
                      disabled={!isActiveGroupAdmin || processingGroupAction}
                    >
                      {isRevokingThisCode ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                  <div className="group-active-code-meta">
                    <span>
                      {entry.code ? `Uses left: ${entry.usesLeft}` : 'Hash only (code text unavailable).'}
                    </span>
                    <span>
                      {entry.expiresAt > 0 ? `Expires: ${formatMessageTimestamp(entry.expiresAt)}` : 'No expiry set.'}
                    </span>
                    {isWalletAddress(entry.creator) ? (
                      <span>{`Creator: ${shortenAddress(entry.creator)}`}</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    );
  };
  const replyingPreviewText =
    replyingToMessage ? trimReplyPreview(getMessageDisplayText(replyingToMessage.text)) : '';

  return (
    <div className={`app-shell mobile-view-${activeMobileView}`}>
      <header className="top-header" ref={topHeaderRef}>
        <div className="top-header-brand">
          <div className="top-header-section top-header-branding">
            <span className="top-header-brand-logo-shell" aria-hidden="true">
              <img className="top-header-brand-logo" src={AppFavicon} alt="" />
            </span>
            <div className="top-header-brand-copy">
              <span className="top-header-brand-title">ChainWhisper</span>
              <span className="top-header-brand-subtitle">powered by COTI</span>
            </div>
          </div>
          <button
            type="button"
            className="top-header-menu-btn"
            aria-expanded={mobileLinksOpen}
            aria-controls="top-navigation-links-mobile"
            onClick={() => setMobileLinksOpen((previous) => !previous)}
            aria-label="Open links menu"
            style={
              isMobileNav
                ? { display: 'inline-grid', position: 'fixed', top: '8px', right: '20px', zIndex: 120 }
                : { display: 'none' }
            }
          >
            ☰
          </button>
          <button
            type="button"
            className="sound-toggle-btn"
            onClick={() => {
              setSoundEnabled((prev) => {
                const next = !prev;
                try {
                  localStorage.setItem(SOUND_ENABLED_STORAGE_KEY, String(next));
                } catch {}
                if (next) {
                  // user gesture: initialize persistent audio and play once to unlock
                  try {
                    initPersistentAudio();
                  } catch {}
                } else {
                  // disable: revoke any persistent audio URL
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
            }}
            title={soundEnabled ? 'Disable sound' : 'Enable sound'}
            aria-pressed={soundEnabled}
            style={
              isMobileNav
                ? { display: 'inline-grid', position: 'fixed', top: '8px', right: '64px', zIndex: 120 }
                : { marginLeft: 8 }
            }
          >
            {soundEnabled ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
                <path fill="currentColor" d="M12 2a2 2 0 0 0-2 2v1.07A6.002 6.002 0 0 0 6 11v3l-2 2v1h16v-1l-2-2v-3a6.002 6.002 0 0 0-4-5.93V4a2 2 0 0 0-2-2zM7 20a5 5 0 0 0 10 0z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
                <path fill="currentColor" d="M12 2a2 2 0 0 0-2 2v1.07A6.002 6.002 0 0 0 6 11v3l-2 2v1h9.17l3.7 3.7 1.41-1.41L7.41 4 6 5.41 16.59 16H18v-1l-2-2v-3a6.002 6.002 0 0 0-4-5.93V4a2 2 0 0 0-2-2zM7 20a5 5 0 0 0 10 0z" />
              </svg>
            )}
          </button>
          {typeof window !== 'undefined' && window.location.search.includes('debug') ? (
            <button
              type="button"
              className="sound-toggle-btn"
              onClick={() => {
                // simulate an incoming message for testing
                const contactsList = contacts.length ? contacts : [];
                const target = contactsList[0]?.address ?? activeContact ?? '0x' + Math.random().toString(16).slice(2, 10);
                const key = target.toLowerCase();
                const nowId = `sim-${Date.now()}-${Math.random().toString(16).slice(2,6)}`;
                const msg: ChatMessage = { id: nowId, direction: 'incoming', text: 'Simulated incoming', timestamp: Math.floor(Date.now() / 1000) };
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
              🧪
            </button>
          ) : null}
          
        </div>
        <nav
          id="top-navigation-links-desktop"
          className="top-header-links top-header-links-desktop"
          aria-label="Top navigation"
          style={{ display: isMobileNav ? 'none' : 'flex' }}
        >
          <a href={telegramBotLink} target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>@CipherTrade_bot</a>
          <a href="https://pengodefi.app/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>PengoDeFi</a>
          <a href="https://bridge.coti.io/bridge" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>COTI Bridge</a>
          <a href="https://coti.carbondefi.xyz/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>CarbonDeFi</a>
          <a href="https://nexus.hyperlane.xyz/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>Hyperlane Bridge</a>
          <a href="https://app.houdiniswap.com/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>Houdini Swap</a>
          <a href="https://app.chainport.io/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>ChainPort</a>
        </nav>
        <nav
          id="top-navigation-links-mobile"
          className={mobileLinksOpen ? 'top-header-links top-header-links-mobile open' : 'top-header-links top-header-links-mobile'}
          aria-label="Top navigation mobile"
          style={
            isMobileNav && mobileLinksOpen
              ? {
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  gap: '6px',
                  position: 'fixed',
                  top: '50px',
                  right: '20px',
                  width: 'min(240px, calc(100vw - 40px))',
                  zIndex: 130
                }
              : { display: 'none' }
          }
        >
          <a href={telegramBotLink} target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>@CipherTrade_bot</a>
          <a href="https://pengodefi.app/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>PengoDeFi</a>
          <a href="https://bridge.coti.io/bridge" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>COTI Bridge</a>
          <a href="https://coti.carbondefi.xyz/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>CarbonDeFi</a>
          <a href="https://nexus.hyperlane.xyz/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>Hyperlane Bridge</a>
          <a href="https://app.houdiniswap.com/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>Houdini Swap</a>
          <a href="https://app.chainport.io/" target="_blank" rel="noopener noreferrer" onClick={() => setMobileLinksOpen(false)}>ChainPort</a>
        </nav>
      </header>

      <div className="app-root">
      <aside className="sidebar">
        <div className="wallet-meta">
          <div className="meta-row">
            <span>Network</span>
            <strong>{onCotiNetwork ? 'COTI' : chainId ? `Chain ${chainId}` : '—'}</strong>
          </div>
          <div className="meta-row">
            <span>Status</span>
            <strong className={isStatusConnected ? 'status-row-value status-with-dot' : 'status-row-value'} title={status}>
              <span className="status-text">{status}</span>
              {isStatusConnected ? <span className="status-dot" aria-hidden="true" /> : null}
            </strong>
          </div>
          <div className="meta-row">
            <span>AES</span>
            <strong
              className={isAesConnected ? 'status-row-value status-with-dot' : 'status-row-value'}
              title={onboardStatus}
            >
              <span className="status-text">{onboardStatus}</span>
              {isAesConnected ? <span className="status-dot" aria-hidden="true" /> : null}
            </strong>
          </div>
          <div className="meta-row">
            <span>Address</span>
            {walletAddress ? (
              <button
                type="button"
                className={
                  lastCopiedKey === `wallet-address:${walletAddress.toLowerCase()}`
                    ? 'burner-address-btn copied'
                    : 'burner-address-btn'
                }
                onClick={() => {
                  copyWithFeedback(walletAddress, `wallet-address:${walletAddress.toLowerCase()}`).catch(() => {});
                }}
                title={walletAddress}
              >
                {lastCopiedKey === `wallet-address:${walletAddress.toLowerCase()}` ? 'Copied' : shortenAddress(walletAddress)}
              </button>
            ) : (
              <strong>—</strong>
            )}
          </div>
        </div>

        <div className="wallet-meta wallet-actions-card">
          <div className="wallet-section-header">
            <span className="wallet-section-label">Chat wallet</span>
            <span className="wallet-section-hint">
              {hasSavedBurnerWallet ? 'Wallet saved' : 'No wallet saved'}
            </span>
          </div>

          <div className="wallet-section-group">
            {!hasSavedBurnerWallet ? (
              <p className="wallet-section-hint wallet-section-hint-note">
                Generate or import a wallet to enable quick connect.
              </p>
            ) : null}

            <div className="wallet-action-grid">
              {hasSavedBurnerWallet ? (
                <button
                  className="connect-btn wallet-primary-action wallet-action-span-2"
                  onClick={() => {
                    beginBurnerPinFlow('stored').catch(() => {});
                  }}
                  type="button"
                  disabled={initializingBurner || burnerStorageBlocked}
                >
                  Unlock Wallet
                </button>
              ) : null}

              {hasSavedBurnerWallet ? (
                <button
                  className="connect-btn"
                  onClick={openChangeBurnerPin}
                  type="button"
                  disabled={initializingBurner || !burnerRecordRef.current}
                >
                  Change PIN
                </button>
              ) : null}

              <button
                className={hasSavedBurnerWallet ? 'connect-btn' : 'connect-btn wallet-primary-action'}
                onClick={() => {
                  beginBurnerPinFlow('generate').catch(() => {});
                }}
                type="button"
                disabled={initializingBurner || burnerStorageBlocked}
              >
                {initializingBurner ? 'Initializing Wallet...' : 'Generate Wallet'}
              </button>

              <button
                className={hasSavedBurnerWallet ? 'connect-btn' : 'connect-btn wallet-primary-action'}
                onClick={() => setShowBurnerImportModal(true)}
                type="button"
                disabled={initializingBurner || burnerStorageBlocked}
              >
                Import Wallet
              </button>
            </div>
          </div>

          <div className="wallet-inline-action">
            <span className="wallet-section-label wallet-section-label-inline">MetaMask</span>
            <button
              className="connect-btn wallet-inline-btn"
              onClick={connectAndOnboard}
              type="button"
              disabled={connectingMethod !== null}
            >
              {connectingMethod === 'metamask'
                ? 'Connecting MetaMask...'
                : !isConnected || connectionMethod !== 'metamask'
                ? 'Connect with MetaMask'
                : onboardStatus === 'AES key ready'
                  ? 'MetaMask + AES Ready'
                  : 'Sign AES Key'}
            </button>
          </div>

          <div className="wallet-inline-action">
            <span className="wallet-section-label wallet-section-label-inline">Session</span>
            <button
              className="connect-btn wallet-inline-btn"
              onClick={disconnectWallet}
              type="button"
              disabled={!isConnected || connectingMethod !== null}
              title="Disconnects the currently active wallet session."
            >
              Disconnect current wallet
            </button>
          </div>
          {burnerWallets.length > 0 ? (
            <div className="wallet-inline-select">
              <span className="wallet-section-label wallet-section-label-inline">Saved wallets</span>
              <select
                value={burnerWalletSelectionValue}
                onChange={(event) => {
                  switchActiveBurnerWallet(event.target.value).catch((switchError) => {
                    const message = switchError instanceof Error ? switchError.message : 'Failed to switch burner wallet.';
                    setError(message);
                  });
                }}
                aria-label="Select burner wallet"
                disabled={initializingBurner}
              >
                {burnerWallets.map((walletRecord, index) => {
                  const optionAddress = walletRecord.address
                    ? shortenAddress(walletRecord.address)
                    : 'Unknown';
                  const optionName = getBurnerWalletDisplayName(walletRecord);
                  return (
                    <option key={walletRecord.id ?? `${walletRecord.privateKey}-${index}`} value={walletRecord.id ?? ''}>
                      {`${optionName} (${optionAddress})`}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}
          {burnerStorageBlocked ? (
            <p className="error">
              Browser storage is blocked. Disable private mode or storage restrictions to persist wallets.
            </p>
          ) : null}
        </div>

        {isConnected ? (
          <div className="wallet-meta topup-meta">
            <div className="wallet-section-header">
              <span className="wallet-section-label">Funding</span>
              <span className="wallet-section-hint">
                {loadingTopUpQuote
                  ? 'Calculating...'
                  : `${burnerBalanceWei !== null ? formatTokenAmount(burnerBalanceWei, 18, 4) : '--'} COTI | ${
                      estimatedMessagesLeft !== null ? estimatedMessagesLeft.toString() : '--'
                    } msgs left`}
              </span>
            </div>
            <button
              className="connect-btn"
              onClick={topUpBurnerWithMetaMask}
              type="button"
              disabled={initializingBurner || !burnerAddress || topUpAmountWei === null || topUpAmountWei <= 0n}
            >
              Top Up with MetaMask
            </button>
            <input
              className="topup-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={topUpMultiplier}
              onChange={(event) => setTopUpMultiplier(Number(event.target.value))}
              aria-label="Top up multiplier"
            />
            <p className="topup-estimate-line">
              Approx: <strong>{topUpMultiplier}</strong> msgs = <strong>{topUpAmountLabel}</strong>
            </p>
          </div>
        ) : null}

        {isConnected ? (
          <details
            className="wallet-meta wallet-disclosure wallet-rewards-swap-card"
            open={showTokenTools}
            onToggle={(event) => setShowTokenTools(event.currentTarget.open)}
          >
            <summary>
              <span>Whisper rewards</span>
              <span>{tokenToolsSummary}</span>
            </summary>
            <div className="swap-meta wallet-disclosure-body">
            {groupRewardsContractAddress ? (
              <div className="wallet-section-hint wallet-section-hint-note reward-summary">
                <div className="reward-summary-row">
                  <span className="reward-line-label">
                    Contract status
                    <span
                      className={rewardsEnabled ? 'reward-state-dot enabled' : 'reward-state-dot'}
                      title={rewardsIndicatorLabel}
                      aria-label={rewardsIndicatorLabel}
                    />
                  </span>
                  <strong>
                    {rewardsPublicReserveWei !== null
                      ? `${formatTokenAmount(rewardsPublicReserveWei * 2n, rewardTokenDecimals, 6)} ${rewardTokenSymbol}/${privateRewardTokenSymbol}`
                      : '--'}
                  </strong>
                </div>
                <div className="reward-summary-row">
                  <span>Per message</span>
                  <strong>
                    {rewardsPublicPerInteractionWei !== null
                      ? `${formatTokenAmount(rewardsPublicPerInteractionWei * 2n, rewardTokenDecimals, 6)} ${rewardTokenSymbol}/${privateRewardTokenSymbol}`
                      : '--'}
                  </strong>
                </div>
              </div>
            ) : null}
            {!groupRewardsContractAddress ? (
              <p className="wallet-section-hint wallet-section-hint-note">
                Rewards contract info is not available for this session yet.
              </p>
            ) : null}
            {rewardsLowReserve ? (
              <p className="wallet-section-hint wallet-section-hint-note">
                Rewards warning: insufficient public token rewards in rewards contract.
              </p>
            ) : null}
            <div className="wallet-section-divider wallet-section-divider-tight" aria-hidden="true" />
            <div className="wallet-section-header wallet-subsection-header">
              <span className="wallet-section-label">Swap</span>
              <span className="wallet-section-hint">{`${rewardTokenSymbol} <-> ${privateRewardTokenSymbol}`}</span>
            </div>
            <div className="swap-field">
              <label className="swap-label-sr" htmlFor="swap-amount-input">Amount</label>
              <input
                id="swap-amount-input"
                type="text"
                inputMode="decimal"
                value={swapAmountInput}
                onChange={(event) => setSwapAmountInput(sanitizeTokenAmountInput(event.target.value))}
                placeholder={`0.0 ${swapInputSymbol}`}
                disabled={swappingTokens}
              />
            </div>
            <div className="swap-field">
              <span id="swap-direction-label" className="swap-label-sr">
                Swap direction
              </span>
              <div className="swap-pill-switch" role="group" aria-labelledby="swap-direction-label">
                <button
                  type="button"
                  className={swapDirection === 'shield' ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => setSwapDirection('shield')}
                  disabled={swappingTokens}
                  aria-pressed={swapDirection === 'shield'}
                  title={`${rewardTokenSymbol} to ${privateRewardTokenSymbol}`}
                >
                  {`${rewardTokenSymbol} to ${privateRewardTokenSymbol}`}
                </button>
                <button
                  type="button"
                  className={swapDirection === 'unshield' ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => setSwapDirection('unshield')}
                  disabled={swappingTokens}
                  aria-pressed={swapDirection === 'unshield'}
                  title={`${privateRewardTokenSymbol} to ${rewardTokenSymbol}`}
                >
                  {`${privateRewardTokenSymbol} to ${rewardTokenSymbol}`}
                </button>
              </div>
            </div>
            <div className="swap-field">
              <div className="swap-field-label">
                Fee payment
                <span
                  className="swap-info-tip"
                  title={`Token mode tries ${privateRewardTokenSymbol} first, then ${rewardTokenSymbol}, then COTI fallback. COTI mode pays native fee only.`}
                  aria-label="Fee mode info"
                >
                  i
                </span>
              </div>
              <div className="swap-pill-switch" role="group" aria-label="Fee payment mode">
                <button
                  type="button"
                  className={swapFeeModeSelection === 'token' ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => setSwapFeeModeSelection('token')}
                  disabled={swappingTokens}
                  aria-pressed={swapFeeModeSelection === 'token'}
                >
                  Token
                </button>
                <button
                  type="button"
                  className={swapFeeModeSelection === 'coti' ? 'swap-pill-option active' : 'swap-pill-option'}
                  onClick={() => setSwapFeeModeSelection('coti')}
                  disabled={swappingTokens}
                  aria-pressed={swapFeeModeSelection === 'coti'}
                >
                  COTI
                </button>
              </div>
            </div>
            <div className="swap-quote-row">
              <span>Fee quote</span>
              <strong>
                {loadingRewardBalances
                  ? 'Loading...'
                  : `COTI ${swapFeeWei !== null ? formatCotiAmount(swapFeeWei) : '--'} | ${rewardTokenSymbol} ${
                      swapTokenFeeAmount !== null
                        ? formatTokenAmount(swapTokenFeeAmount, rewardTokenDecimals, 6)
                        : '--'
                    }`}
              </strong>
            </div>
            <button
              className="connect-btn swap-action-btn"
              type="button"
              onClick={swapRewardTokens}
              disabled={!canSwapRewardTokens}
            >
              {swapButtonLabel}
            </button>
              {swapStatusMessage ? <p className="wallet-section-hint wallet-section-hint-note swap-status-note">{swapStatusMessage}</p> : null}
            </div>
          </details>
        ) : null}

        {burnerNeedsFunding ? <p className="error">Burner needs funding before onboarding.</p> : null}
        {isConnected && burnerMnemonicBackup ? (
          <details
            className="wallet-meta wallet-disclosure"
            open={showBackupTools}
            onToggle={(event) => setShowBackupTools(event.currentTarget.open)}
          >
            <summary>
              <span>Burner backup</span>
              <span>{showBurnerMnemonic ? 'Phrase visible' : 'Phrase hidden'}</span>
            </summary>
            <div className="wallet-disclosure-body">
              <p className="wallet-reminder">
                Save your seed phrase offline for wallet recovery.
              </p>
              <button
                type="button"
                className="connect-btn wallet-backup-toggle"
                onClick={beginRevealBurnerBackup}
              >
                {showBurnerMnemonic ? 'Hide phrase' : 'Show phrase'}
              </button>
              {showBurnerMnemonic ? <p className="wallet-secret-phrase">{burnerMnemonicBackup}</p> : null}
            </div>
          </details>
        ) : null}

      </aside>

      {isConnected ? (
      <aside className="contacts-sidebar">
        <div className="contact-profile-card contact-profile-card-fixed">
          <span className="contact-profile-label">Name</span>
          <div className="contact-profile-editor-wrap">
            <div
              ref={nicknameEditorRef}
              className="contact-profile-editor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="false"
              aria-label="Name"
              data-placeholder="Choose name"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              onInput={(event) => {
                const raw = event.currentTarget.textContent ?? '';
                const singleLine = raw.replace(/\r?\n/g, '').slice(0, nicknameMaxBytes);
                if (singleLine !== raw) {
                  event.currentTarget.textContent = singleLine;
                }
                setMyNickname(singleLine);
              }}
              onBlur={() => {
                if (!hasAesReady || !walletAddress) {
                  return;
                }

                saveMyNicknameOnChain().catch(() => {});
              }}
            />
            <button
              type="button"
              className="contact-profile-editor-action"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                saveMyNicknameOnChain().catch(() => {});
              }}
              disabled={!hasAesReady || !walletAddress}
            >
              Save
            </button>
          </div>
          <div className="contact-actions-panel">
            <div className="contact-actions-grid">
              <button
                type="button"
                className="contact mark-read-button contact-action-btn"
                onClick={markAllConversationsAsRead}
                disabled={!hasUnreadConversations}
              >
                Mark all as read
              </button>
              <button
                type="button"
                className="contact mark-read-button contact-action-btn"
                onClick={() => {
                  forceSyncAllData().catch(() => {});
                }}
                disabled={syncingHistory || syncingGroups || !hasAesReady}
              >
                {syncingHistory || syncingGroups ? 'Syncing...' : 'Force sync'}
              </button>
              <button
                type="button"
                className="contact mark-read-button contact-action-btn contact-action-btn-primary"
                onClick={() => {
                  setQuickActionTab('contact');
                  setShowQuickActionsModal(true);
                }}
              >
                New chat
              </button>
              <button
                type="button"
                className={
                  showHiddenContacts
                    ? 'contact mark-read-button contact-action-btn contact-action-btn-toggle active'
                    : 'contact mark-read-button contact-action-btn contact-action-btn-toggle'
                }
                onClick={() => setShowHiddenContacts((previous) => !previous)}
                aria-pressed={showHiddenContacts}
                title={
                  showHiddenContacts
                    ? 'Return to your main conversations'
                    : hiddenContactsCount > 0
                      ? `Show ${hiddenContactsLabel}`
                      : 'No hidden chats yet'
                }
                disabled={!showHiddenContacts && hiddenContactsCount === 0}
              >
                {showHiddenContacts
                  ? 'Back to main chats'
                  : hiddenContactsCount > 0
                    ? `Show hidden chats (${hiddenContactsCount})`
                    : 'No hidden chats'}
              </button>
            </div>
          </div>
        </div>

        <div
          className="contact-profile-card contact-profile-card-scroll contact-profile-card-contacts"
          style={{ flexGrow: contactGroupPanelRatio.contactsPanelFlex }}
        >
          <div className="contacts-panel-header">
            <span className="contact-profile-label">Contacts</span>
            {showHiddenContacts ? (
              <span className="contact-view-badge hidden">Hidden view</span>
            ) : hiddenContactsCount > 0 ? (
              <span className="contact-view-badge">{hiddenContactsLabel}</span>
            ) : null}
          </div>
          <ul className="contacts-list contacts-list-scroll contacts-main-list">
          {visibleSortedContacts.length === 0 ? (
            <li className="contacts-empty-state">{contactsListEmptyMessage}</li>
          ) : (
            visibleSortedContacts.map((contact) => {
            const isActive = activeContact?.toLowerCase() === contact.address.toLowerCase();
            const isEditing = editingContactAddress?.toLowerCase() === contact.address.toLowerCase();
            const conversationStatePending = isConversationStateSyncPending(contact.address);
            const hasName = Boolean(contact.name?.trim());
            const hasConversation = (messagesByContact[contact.address.toLowerCase()]?.length ?? 0) > 0;
            const contactCopyKey = `contact:${contact.address.toLowerCase()}`;
            const isContactCopied = lastCopiedKey === contactCopyKey;
              return (
                <li key={contact.address}>
                <div
                  className={
                    conversationStatePending
                      ? isActive
                        ? 'contact-card active syncing'
                        : contact.hidden
                          ? 'contact-card hidden syncing'
                          : 'contact-card syncing'
                      : isActive
                        ? 'contact-card active'
                        : contact.hidden
                          ? 'contact-card hidden'
                          : 'contact-card'
                  }
                  role="button"
                  tabIndex={0}
                  onClick={() => activateContact(contact.address)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      activateContact(contact.address);
                    }
                  }}
                >
                  <div className="contact-top">
                    <div className="contact-main" title={contact.address}>
                      {hasName ? (
                        <>
                          <span className="contact-name-inline">{contact.name}</span>
                          <button
                            type="button"
                            className={isContactCopied ? 'contact-copy contact-copy-secondary copied' : 'contact-copy contact-copy-secondary'}
                            onClick={(event) => {
                              event.stopPropagation();
                              copyWithFeedback(contact.address, contactCopyKey).catch(() => {});
                            }}
                            title={isContactCopied ? 'Copied' : 'Copy address'}
                          >
                            {isContactCopied ? 'Copied' : shortenAddress(contact.address)}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={isContactCopied ? 'contact-copy copied' : 'contact-copy'}
                          onClick={(event) => {
                            event.stopPropagation();
                            copyWithFeedback(contact.address, contactCopyKey).catch(() => {});
                          }}
                          title={isContactCopied ? 'Copied' : 'Copy address'}
                        >
                          {isContactCopied ? 'Copied' : shortenAddress(contact.address)}
                        </button>
                      )}
                      {contact.muted || contact.hidden ? (
                        <span className="contact-state-inline">
                          {contact.muted ? 'Muted' : null}
                          {contact.muted && contact.hidden ? ' | ' : null}
                          {contact.hidden ? 'Hidden' : null}
                        </span>
                      ) : null}
                    </div>
                    {hasConversation ? (
                      <span
                        className="contact-chat-icon"
                        aria-label={unreadMap[contact.address.toLowerCase()] ? 'Unread messages' : 'Has conversation'}
                        title={unreadMap[contact.address.toLowerCase()] ? 'Unread messages' : 'Has conversation'}
                        style={{ marginRight: 6, color: unreadMap[contact.address.toLowerCase()] ? '#e33' : undefined }}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
                          <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4l4 4 4-4h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
                        </svg>
                      </span>
                    ) : null}
                    {!isEditing ? (
                      <>
                        <button
                          type="button"
                          className="contact-icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            startRenameContact(contact.address, contact.name);
                          }}
                          disabled={conversationStatePending}
                          aria-label="Rename contact"
                          title={conversationStatePending ? 'Wait for sync to finish' : 'Rename'}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.42l-2.5-2.5a1 1 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-2.09z"/></svg>
                        </button>
                        <button
                          type="button"
                          className={conversationStatePending ? 'contact-icon loading' : 'contact-icon'}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeContact(contact.address);
                          }}
                          disabled={conversationStatePending}
                          aria-label={
                            conversationStatePending
                              ? 'Conversation update in progress'
                              : contact.hidden
                                ? 'Unhide conversation'
                                : 'Hide conversation'
                          }
                          title={
                            conversationStatePending
                              ? 'Waiting for confirmation...'
                              : contact.hidden
                                ? 'Unhide'
                                : 'Hide'
                          }
                        >
                          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 6h18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M8 6V4h8v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M19 6l-1 14H6L5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {isEditing ? (
                  <div className="contact-rename">
                    <input
                      value={editingContactName}
                      onChange={(event) => setEditingContactName(event.target.value)}
                      placeholder="Enter name"
                      aria-label="Rename contact"
                    />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        saveRenamedContact(contact.address);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        cancelRenameContact();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
                </li>
              );
            })
          )}
          </ul>
        </div>

        <div
          className="contact-profile-card contact-profile-card-scroll contact-profile-card-groups"
          style={{ flexGrow: contactGroupPanelRatio.groupsPanelFlex }}
        >
          <span className="contact-profile-label">Groups</span>

          {sortedGroupInvites.length > 0 ? (
            <>
              <span className="contact-section-label">Invites</span>
              <ul className="contacts-list contacts-list-scroll groups-invites-list">
            {sortedGroupInvites.map((invite) => (
                <li key={`invite-${invite.groupId}`}>
                  <div className="contact-card">
                    <div className="contact-top">
                      <div className="contact-main">
                        <span className="contact-name-inline">
                          {(invite.title ?? `Group ${invite.groupId}`) + ` (#${invite.groupId})` + (invite.isPrivate ? ' · Private' : '')}
                        </span>
                      </div>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                      From: {isWalletAddress(invite.inviter) ? shortenAddress(invite.inviter) : invite.inviter || 'Unknown'} | Exp: {invite.expiresAt > 0 ? formatMessageTimestamp(invite.expiresAt) : 'N/A'}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="contact"
                        onClick={() => {
                          acceptGroupInvite(invite.groupId).catch(() => {});
                        }}
                        disabled={processingGroupAction}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="contact"
                        onClick={() => {
                          declineGroupInvite(invite.groupId).catch(() => {});
                        }}
                        disabled={processingGroupAction}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </li>
              ))}
              </ul>
            </>
          ) : null}

          <ul className="contacts-list contacts-list-scroll groups-main-list">
            {sortedGroups.map((group) => {
              const isActive = activeGroupId === group.id;
              const groupTitle = group.title || `Group ${group.id}`;
              const groupKey = String(group.id);
              const hasConversation = group.lastTimestamp > 0 || (messagesByGroup[groupKey]?.length ?? 0) > 0;
              return (
                <li key={`group-${group.id}`}>
                  <div
                    className={isActive ? 'contact-card active' : 'contact-card'}
                    role="button"
                    tabIndex={0}
                    onClick={() => activateGroup(group.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        activateGroup(group.id);
                      }
                    }}
                  >
                    <div className="contact-top">
                      <div className="contact-main">
                        <span className="contact-name-inline">
                          {groupTitle} (#{group.id}){group.isPrivate ? ' · Private' : ''}
                        </span>
                      </div>
                      {hasConversation ? (
                        <span
                          className="contact-chat-icon"
                          aria-label={unreadGroupMap[groupKey] ? 'Unread group messages' : 'Has group messages'}
                          title={unreadGroupMap[groupKey] ? 'Unread group messages' : 'Has group messages'}
                          style={{ marginRight: 6, color: unreadGroupMap[groupKey] ? '#e33' : undefined }}
                        >
                          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
                            <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4l4 4 4-4h4a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
                          </svg>
                        </span>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                      M: {group.memberCount} | Last: {group.lastTimestamp > 0 ? formatMessageTimestamp(group.lastTimestamp) : 'N/A'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </aside>
      ) : null}

      <main className="chat-panel">
        {!isConnected ? (
          <div className="chat-placeholder">Connect a wallet to view contacts and start messaging.</div>
        ) : activeGroupId !== null ? (
          <div className="chat-shell">
            <div className="chat-header chat-header-group">
              <div className="group-header-meta">
                <div className="group-title-stack">
                  <strong>{(activeGroupMeta?.title ? activeGroupMeta.title : `Group ${activeGroupId}`) + ` (#${activeGroupId})`}</strong>
                  <span className="group-title-badges">
                    <span className="group-title-badge">{activeGroupMeta?.isPrivate ? 'Private' : 'Public'}</span>
                    <span className={isActiveGroupAdmin ? 'group-title-badge admin' : 'group-title-badge'}>
                      {isActiveGroupAdmin ? 'Admin' : 'Member'}
                    </span>
                  </span>
                </div>
                <div className="group-meta-dropdowns">
                  <details className="group-members-dropdown">
                    <summary>
                      Members{' '}
                      {activeGroupMemberCount}
                    </summary>
                    <ul className="group-members-list">
                      {activeGroupParticipants.length > 0 ? (
                        activeGroupParticipants.map((participant) => {
                          const participantCopyKey = `group-member:${participant.address.toLowerCase()}`;
                          const isParticipantCopied = lastCopiedKey === participantCopyKey;
                          return (
                            <li key={participant.key}>
                              <div className="group-member-row">
                                <button
                                  type="button"
                                  className={isParticipantCopied ? 'group-member-copy copied' : 'group-member-copy'}
                                  onClick={(event) => {
                                    copyWithFeedback(participant.address, participantCopyKey).catch(() => {});
                                    const detailsElement = event.currentTarget.closest('details');
                                    if (detailsElement instanceof HTMLDetailsElement) {
                                      detailsElement.open = false;
                                    }
                                  }}
                                  title={isParticipantCopied ? 'Copied' : `Copy ${participant.address}`}
                                >
                                  <span className="group-member-name">
                                    {participant.name ?? participant.shortAddress}
                                    {participant.isSelf ? <span className="group-member-badge">You</span> : null}
                                    {participant.isAdmin ? <span className="group-member-badge">Admin</span> : null}
                                  </span>
                                  <span className="group-member-address">{isParticipantCopied ? 'Copied' : participant.shortAddress}</span>
                                </button>
                                {isActiveGroupAdmin && !participant.isSelf ? (
                                  <button
                                    type="button"
                                    className="group-member-remove"
                                    onClick={() => {
                                      removeMemberFromActiveGroup(participant.address).catch(() => {});
                                    }}
                                    disabled={processingGroupAction}
                                    title={`Remove ${participant.address}`}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })
                      ) : (
                        <li className="group-members-empty">No members loaded yet.</li>
                      )}
                    </ul>
                  </details>
                  {!isMobileNav ? renderActiveJoinCodeList(false) : null}
                </div>
              </div>
              <div className="group-header-controls">
                {isMobileNav ? (
                  <>
                    <button
                      type="button"
                      className="contact group-mobile-refresh-btn group-refresh-button"
                      onClick={() => {
                        syncGroupData({ deep: true }).catch(() => {});
                      }}
                      disabled={syncingGroups}
                    >
                      {syncingGroups ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      type="button"
                      className={mobileGroupOptionsOpen ? 'contact active group-mobile-tools-toggle' : 'contact group-mobile-tools-toggle'}
                      aria-expanded={mobileGroupOptionsOpen}
                      aria-controls="group-mobile-tools-panel"
                      onClick={() => {
                        setMobileGroupOptionsOpen((previous) => !previous);
                      }}
                    >
                      {mobileGroupOptionsOpen ? 'Hide tools' : 'Group tools'}
                    </button>
                  </>
                ) : (
                  <form
                    className="group-header-invite"
                    onSubmit={(event) => {
                      event.preventDefault();
                      inviteMembersToActiveGroup().catch(() => {});
                    }}
                  >
                    <div className="group-header-section-heading">
                      <span className="group-header-section-title">Invite members</span>
                      <span className="group-header-section-subtitle">Wallet addresses + expiry hours</span>
                    </div>
                    <div className="group-header-invite-row">
                      <input
                        value={groupInviteMembersInput}
                        onChange={(event) => setGroupInviteMembersInput(event.target.value)}
                        className="group-header-invite-address"
                        placeholder={canInviteToActiveGroup ? 'Invite wallets (comma/space separated)' : 'Private group: only admin can invite'}
                        aria-label="Invite members"
                        disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
                      />
                      <div className="group-header-invite-ttl-wrap">
                        <input
                          id="group-invite-ttl-hours"
                          value={groupInviteTtlInput}
                          onChange={(event) => setGroupInviteTtlInput(event.target.value.replace(/[^\d]/g, ''))}
                          className="group-header-invite-ttl"
                          placeholder="8"
                          aria-label="Invite and join code timeout in hours"
                          disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
                        />
                      </div>
                      <button
                        className="group-header-primary-btn"
                        type="submit"
                        disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
                      >
                        {processingGroupAction ? 'Sending...' : 'Invite'}
                      </button>
                    </div>
                    <div className="group-join-code-settings">
                      <div className="group-join-code-header">
                        <span className="group-join-code-label">Join code</span>
                        <span className="group-join-code-helper">
                          {groupJoinCodeMode === 'single' ? 'One join per code.' : 'Reusable code with max uses.'}
                        </span>
                      </div>
                      <div className="group-join-code-main">
                        <div className="group-join-code-main-left">
                          <div className="group-join-code-mode">
                            <label
                              className={
                                groupJoinCodeMode === 'single' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'
                              }
                            >
                              <input
                                type="radio"
                                name="group-join-code-mode-desktop"
                                checked={groupJoinCodeMode === 'single'}
                                onChange={() => setGroupJoinCodeMode('single')}
                                disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                              />
                              Single-use
                            </label>
                            <label
                              className={
                                groupJoinCodeMode === 'multi' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'
                              }
                            >
                              <input
                                type="radio"
                                name="group-join-code-mode-desktop"
                                checked={groupJoinCodeMode === 'multi'}
                                onChange={() => setGroupJoinCodeMode('multi')}
                                disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                              />
                              Multi-use
                            </label>
                          </div>
                          {groupJoinCodeMode === 'multi' ? (
                            <label className="group-join-code-max">
                              <span>Max uses</span>
                              <input
                                type="number"
                                min={2}
                                step={1}
                                value={groupJoinCodeMaxUsesInput}
                                onChange={(event) => setGroupJoinCodeMaxUsesInput(event.target.value.replace(/[^\d]/g, ''))}
                                aria-label="Join code max uses"
                                className="group-join-code-max-input"
                                disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                              />
                            </label>
                          ) : (
                            <span className="group-join-code-hint">One join per code.</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="group-join-code-generate group-header-primary-btn"
                          onClick={() => {
                            generateJoinCodeForActiveGroup().catch(() => {});
                          }}
                          disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                        >
                          Create code
                        </button>
                      </div>
                    </div>
                    {generatedGroupInviteCode ? (
                      <>
                        <div className="group-generated-code">
                          <input
                            className="group-generated-code-value"
                            value={generatedGroupInviteCode}
                            readOnly
                            aria-label="Generated join code"
                          />
                          <button
                            type="button"
                            className={
                              lastCopiedKey === `group-code:${generatedGroupInviteCode}`
                                ? 'group-generated-code-copy copied'
                                : 'group-generated-code-copy'
                            }
                            onClick={() => {
                              copyWithFeedback(generatedGroupInviteCode, `group-code:${generatedGroupInviteCode}`).catch(() => {});
                            }}
                          >
                            {lastCopiedKey === `group-code:${generatedGroupInviteCode}` ? 'Copied' : 'Copy code'}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="contact"
                          onClick={() => {
                            revokeGeneratedJoinCodeForActiveGroup().catch(() => {});
                          }}
                          disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin || !generatedGroupJoinCodeHash}
                        >
                          {processingGroupAction ? 'Working...' : 'Revoke code'}
                        </button>
                      </>
                    ) : null}
                  </form>
                )}
              </div>
              {isMobileNav ? (
                mobileGroupOptionsOpen ? (
                  <div id="group-mobile-tools-panel" className="group-mobile-options-panel">
                    <div className="group-mobile-section">
                      <div className="group-mobile-section-header">
                        <span className="group-mobile-section-title">Invite members</span>
                        <span className="group-mobile-section-subtitle">Wallet addresses + expiry hours</span>
                      </div>
                      <div className="group-header-invite group-header-invite-mobile-inline">
                        <input
                          value={groupInviteMembersInput}
                          onChange={(event) => setGroupInviteMembersInput(event.target.value)}
                          className="group-header-invite-address"
                          placeholder={canInviteToActiveGroup ? 'Invite wallets (comma/space separated)' : 'Private group: only admin can invite'}
                          aria-label="Invite members"
                          disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
                        />
                        <div className="group-header-invite-ttl-wrap">
                          <input
                            id="group-invite-ttl-hours-mobile"
                            value={groupInviteTtlInput}
                            onChange={(event) => setGroupInviteTtlInput(event.target.value.replace(/[^\d]/g, ''))}
                            className="group-header-invite-ttl"
                            placeholder="8"
                            aria-label="Invite and join code timeout in hours"
                            disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="contact group-mobile-primary-action group-header-primary-btn"
                        onClick={() => {
                          inviteMembersToActiveGroup().catch(() => {});
                        }}
                        disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
                      >
                        {processingGroupAction ? 'Sending...' : 'Send invites'}
                      </button>
                    </div>

                    <div className="group-mobile-section">
                      <div className="group-mobile-section-header">
                        <span className="group-mobile-section-title">Join code</span>
                        <span className="group-mobile-section-subtitle">Share access token</span>
                      </div>
                      <div className="group-join-code-settings group-join-code-settings-mobile">
                        <div className="group-join-code-main">
                          <div className="group-join-code-main-left">
                            <div className="group-join-code-mode">
                              <label
                                className={
                                  groupJoinCodeMode === 'single' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'
                                }
                              >
                                <input
                                  type="radio"
                                  name="group-join-code-mode-mobile"
                                  checked={groupJoinCodeMode === 'single'}
                                  onChange={() => setGroupJoinCodeMode('single')}
                                  disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                                />
                                Single-use
                              </label>
                              <label
                                className={
                                  groupJoinCodeMode === 'multi' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'
                                }
                              >
                                <input
                                  type="radio"
                                  name="group-join-code-mode-mobile"
                                  checked={groupJoinCodeMode === 'multi'}
                                  onChange={() => setGroupJoinCodeMode('multi')}
                                  disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                                />
                                Multi-use
                              </label>
                            </div>
                            {groupJoinCodeMode === 'multi' ? (
                              <label className="group-join-code-max">
                                <span>Max uses</span>
                                <input
                                  type="number"
                                  min={2}
                                  step={1}
                                  value={groupJoinCodeMaxUsesInput}
                                  onChange={(event) => setGroupJoinCodeMaxUsesInput(event.target.value.replace(/[^\d]/g, ''))}
                                  aria-label="Join code max uses mobile"
                                  className="group-join-code-max-input"
                                  disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                                />
                              </label>
                            ) : (
                              <span className="group-join-code-hint">One join per code.</span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="group-join-code-generate group-header-primary-btn"
                            onClick={() => {
                              generateJoinCodeForActiveGroup().catch(() => {});
                            }}
                            disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                          >
                            Create code
                          </button>
                        </div>
                      </div>
                      {generatedGroupInviteCode ? (
                        <>
                          <div className="group-generated-code group-generated-code-mobile">
                            <input
                              className="group-generated-code-value"
                              value={generatedGroupInviteCode}
                              readOnly
                              aria-label="Generated join code"
                            />
                            <button
                              type="button"
                              className={
                                lastCopiedKey === `group-code:${generatedGroupInviteCode}`
                                  ? 'contact copied'
                                  : 'contact'
                              }
                              onClick={() => {
                                copyWithFeedback(generatedGroupInviteCode, `group-code:${generatedGroupInviteCode}`).catch(() => {});
                              }}
                            >
                              {lastCopiedKey === `group-code:${generatedGroupInviteCode}` ? 'Copied' : 'Copy code'}
                            </button>
                          </div>
                          <button
                            type="button"
                            className="contact"
                            onClick={() => {
                              revokeGeneratedJoinCodeForActiveGroup().catch(() => {});
                            }}
                            disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin || !generatedGroupJoinCodeHash}
                          >
                            {processingGroupAction ? 'Working...' : 'Revoke code'}
                          </button>
                        </>
                      ) : null}
                      {renderActiveJoinCodeList(true)}
                    </div>

                    <div className="group-mobile-section group-mobile-section-actions">
                      <div className="group-mobile-section-header">
                        <span className="group-mobile-section-title">Group actions</span>
                        <span className="group-mobile-section-subtitle">Rename, leave, or close group</span>
                      </div>
                      <div className="group-mobile-options-actions group-mobile-options-actions-secondary">
                        {isActiveGroupAdmin ? (
                          <>
                            {groupRenameOpen ? (
                              <form
                                className="group-rename-form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  renameActiveGroup().catch(() => {});
                                }}
                              >
                                <input
                                  value={groupRenameInput}
                                  onChange={(event) => setGroupRenameInput(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      cancelRenameActiveGroup();
                                    }
                                  }}
                                  placeholder="Group name"
                                  aria-label="Rename group"
                                  autoFocus
                                  disabled={processingGroupAction}
                                />
                                <button
                                  type="submit"
                                  className="contact"
                                  disabled={processingGroupAction || !canSubmitGroupRename}
                                >
                                  {processingGroupAction ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  className="contact"
                                  onClick={cancelRenameActiveGroup}
                                  disabled={processingGroupAction}
                                >
                                  Cancel
                                </button>
                              </form>
                            ) : (
                              <button
                                type="button"
                                className="contact"
                                onClick={beginRenameActiveGroup}
                                disabled={processingGroupAction}
                              >
                                Rename
                              </button>
                            )}
                            <button
                              type="button"
                              className="contact group-danger-button"
                              onClick={() => {
                                handoffAdminAndLeaveActiveGroup().catch(() => {});
                              }}
                              disabled={processingGroupAction}
                            >
                              {processingGroupAction ? 'Working...' : 'Burn & Leave'}
                            </button>
                            <button
                              type="button"
                              className="contact group-danger-button"
                              onClick={() => {
                                disbandActiveGroup().catch(() => {});
                              }}
                              disabled={processingGroupAction}
                            >
                              {processingGroupAction ? 'Working...' : 'Disband'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="contact"
                            onClick={() => {
                              leaveActiveGroup().catch(() => {});
                            }}
                            disabled={processingGroupAction}
                          >
                            {processingGroupAction ? 'Working...' : 'Leave'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null
                ) : (
                  <div className="group-header-actions">
                    {isActiveGroupAdmin ? (
                      <>
                        {groupRenameOpen ? (
                          <form
                            className="group-rename-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              renameActiveGroup().catch(() => {});
                            }}
                          >
                            <input
                              value={groupRenameInput}
                              onChange={(event) => setGroupRenameInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelRenameActiveGroup();
                                }
                              }}
                              placeholder="Group name"
                              aria-label="Rename group"
                              autoFocus
                              disabled={processingGroupAction}
                            />
                            <button
                              type="submit"
                              className="contact"
                              disabled={processingGroupAction || !canSubmitGroupRename}
                            >
                              {processingGroupAction ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className="contact"
                              onClick={cancelRenameActiveGroup}
                              disabled={processingGroupAction}
                            >
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="contact"
                            onClick={beginRenameActiveGroup}
                            disabled={processingGroupAction}
                          >
                            Rename
                          </button>
                        )}
                        <button
                          type="button"
                          className="contact group-danger-button"
                          onClick={() => {
                            handoffAdminAndLeaveActiveGroup().catch(() => {});
                          }}
                          disabled={processingGroupAction}
                        >
                          {processingGroupAction ? 'Working...' : 'Burn & Leave'}
                        </button>
                        <button
                          type="button"
                          className="contact group-danger-button"
                          onClick={() => {
                            disbandActiveGroup().catch(() => {});
                          }}
                          disabled={processingGroupAction}
                        >
                          {processingGroupAction ? 'Working...' : 'Disband'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="contact"
                        onClick={() => {
                          leaveActiveGroup().catch(() => {});
                        }}
                        disabled={processingGroupAction}
                      >
                        {processingGroupAction ? 'Working...' : 'Leave'}
                      </button>
                    )}
                  <button
                    type="button"
                    className="contact group-refresh-button"
                    onClick={() => {
                      syncGroupData({ deep: true }).catch(() => {});
                    }}
                    disabled={syncingGroups}
                  >
                    {syncingGroups ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              )}
            </div>

            <div className="chat-messages" ref={chatMessagesRef}>
              {!activeGroupMessages.some((message) => !isReactionOnlyMessage(message)) ? (
                <p className="chat-empty">No group messages yet.</p>
              ) : (
                activeGroupMessages.map((message) => {
                  const isGroupSystemMessage = Boolean(message.isSystem);
                  if (isReactionOnlyMessage(message)) {
                    return null;
                  }
                  const messageDisplayText = getMessageDisplayText(message.text, message.direction);
                  const parsedImageTag = parseImageTag(message.text);
                  const messageReactions = getReactionsForMessage(message);
                  const reactedEmojiSet = new Set(
                    messageReactions.filter((reaction) => reaction.reactedByMe).map((reaction) => reaction.emoji)
                  );
                  const deliveryLabel =
                    message.deliveryState === 'pending'
                      ? 'Sending...'
                      : message.deliveryState === 'sent'
                        ? 'Sent'
                        : message.deliveryState === 'failed'
                          ? 'Failed'
                          : '';
                  const normalizedSender = message.senderAddress?.trim().toLowerCase() ?? '';
                  const isSelfSender =
                    normalizedSender.length > 0 &&
                    walletAddress.length > 0 &&
                    normalizedSender === walletAddress.trim().toLowerCase();
                  const canCopySenderAddress = Boolean(message.senderAddress && isWalletAddress(message.senderAddress));
                  const senderCopyKey = `message-sender:${message.id}`;
                  const isSenderCopied = lastCopiedKey === senderCopyKey;
                  const senderLabel = isSelfSender
                    ? 'You'
                    : findContactNameForWalletAddress(message.senderAddress) ??
                      (message.senderAddress && isWalletAddress(message.senderAddress)
                        ? shortenAddress(message.senderAddress)
                        : 'Member');
                  const canReplyToGroupMessage = !isGroupSystemMessage;
                  const messageRowClassName = isGroupSystemMessage
                    ? 'message-row system'
                    : message.direction === 'outgoing'
                      ? 'message-row outgoing'
                      : 'message-row incoming';
                  const messageBubbleClassName = [
                    isGroupSystemMessage ? 'message-bubble system' : 'message-bubble',
                    highlightedMessageId === message.id
                      ? 'highlighted'
                      : canReplyToGroupMessage && replyingToMessage?.id === message.id
                        ? 'replying'
                        : ''
                  ]
                    .filter((className) => className.length > 0)
                    .join(' ');

                  return (
                    <div
                      key={message.id}
                      className={messageRowClassName}
                    >
                      <div
                        ref={(node) => {
                          messageElementRefs.current[message.id] = node;
                        }}
                        className={messageBubbleClassName}
                      >
                        {canReplyToGroupMessage ? (
                          <>
                            <button
                              type="button"
                              className="message-react-action"
                              onClick={() =>
                                setReactionPickerMessageId((previous) =>
                                  previous === message.id ? null : message.id
                                )
                              }
                              aria-label="React to this message"
                              title="React"
                              disabled={!message.txHash || sendingReaction}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className="message-reply-action"
                              onClick={() => setReplyingToMessage(message)}
                              aria-label="Reply to this message"
                              title="Reply"
                            >
                              R
                            </button>
                            {reactionPickerMessageId === message.id ? (
                              <div className="message-reaction-picker" role="dialog" aria-label="Pick reaction">
                                {DEFAULT_REACTION_EMOJIS.map((emoji) => (
                                  <button
                                    key={`${message.id}-${emoji}`}
                                    type="button"
                                    onClick={() => {
                                      sendReactionToMessage(message, emoji).catch(() => {});
                                    }}
                                    disabled={sendingReaction || reactedEmojiSet.has(emoji)}
                                    title={reactedEmojiSet.has(emoji) ? `Already reacted with ${emoji}` : `React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {message.direction === 'incoming' && !isGroupSystemMessage ? (
                          canCopySenderAddress ? (
                            <button
                              type="button"
                              className={isSenderCopied ? 'message-sender-copy copied' : 'message-sender-copy'}
                              onClick={() => {
                                copyWithFeedback(message.senderAddress as string, senderCopyKey).catch(() => {});
                              }}
                              title={isSenderCopied ? 'Copied' : `Copy ${message.senderAddress as string}`}
                            >
                              {isSenderCopied ? `${senderLabel} (copied)` : senderLabel}
                            </button>
                          ) : (
                            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>{senderLabel}</div>
                          )
                        ) : null}
                        {message.replyToText || message.replyToTxHash ? (
                          <button
                            type="button"
                            className="message-reply"
                            onClick={() =>
                              jumpToReferencedMessage(message.replyToMessageId, message.replyToText, message.replyToTxHash)
                            }
                            title="Go to replied message"
                          >
                            ↪ {message.replyToText ?? `Tx ${shortenAddress(message.replyToTxHash as string)}`}
                          </button>
                        ) : null}
                        {parsedImageTag ? <ChatImage tag={message.text} parsed={parsedImageTag} /> : messageDisplayText ? <div>{messageDisplayText}</div> : null}
                        {messageReactions.length > 0 ? (
                          <div className="message-reactions">
                            {messageReactions.map((reaction) => (
                              <button
                                key={`${message.id}-${reaction.emoji}`}
                                type="button"
                                className={reaction.reactedByMe ? 'message-reaction-chip active' : 'message-reaction-chip'}
                                onClick={() => {
                                  sendReactionToMessage(message, reaction.emoji).catch(() => {});
                                }}
                                disabled={!message.txHash || sendingReaction || reaction.reactedByMe}
                              >
                                <span>{reaction.emoji}</span>
                                <span>{reaction.count}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {message.timestamp || deliveryLabel ? (
                          <div className="message-meta">
                            {message.timestamp ? <span className="message-time">{formatMessageTimestamp(message.timestamp)}</span> : null}
                            {deliveryLabel ? (
                              <span
                                className={
                                  message.deliveryState === 'failed'
                                    ? 'message-delivery failed'
                                    : message.deliveryState === 'pending'
                                      ? 'message-delivery pending'
                                      : 'message-delivery sent'
                                }
                              >
                                {deliveryLabel}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <GroupChatCompose
              replyPreviewText={replyingPreviewText}
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
              processingGroupAction={processingGroupAction}
              composerRef={chatComposerRef}
              isMobileNav={isMobileNav}
              onSendMessage={() => {
                sendGroupMessage().catch(() => {});
              }}
              maxMessageLength={MAX_MESSAGE_LENGTH}
              onMessageInputChange={setMessageInput}
            />
          </div>
        ) : activeContact ? (
          <div className="chat-shell">
            <div className="chat-header">
              <strong>
                {isSelfChat
                  ? `${activeContactMeta?.name ? `${activeContactMeta.name} (${shortenAddress(activeContact)})` : shortenAddress(activeContact)} (self)`
                  : `${activeContactMeta?.name ? `${activeContactMeta.name} (${shortenAddress(activeContact)})` : shortenAddress(activeContact)}`}
              </strong>
              <div className="chat-header-actions">
                {activeConversationMuted || activeConversationHidden ? (
                  <span className="chat-header-state">
                    {activeConversationMuted ? 'Muted' : null}
                    {activeConversationMuted && activeConversationHidden ? ' | ' : null}
                    {activeConversationHidden ? 'Hidden' : null}
                  </span>
                ) : null}
                {activeConversationStateSyncPending ? (
                  <span className="chat-header-sync" role="status" aria-live="polite" aria-label="Saving conversation">
                    <span className="inline-spinner" aria-hidden="true" />
                  </span>
                ) : null}
                {!isSelfChat ? (
                  <button
                    type="button"
                    className="contact"
                    onClick={() => {
                      toggleConversationMuteForContact(activeContact).catch(() => {});
                    }}
                    disabled={activeConversationStateSyncPending}
                    title={
                      activeConversationStateSyncPending
                        ? 'Waiting for confirmation...'
                        : activeConversationMuted
                          ? 'Unmute conversation'
                          : 'Mute conversation'
                    }
                  >
                    {activeConversationStateSyncPending
                      ? 'Saving...'
                      : activeConversationMuted
                        ? 'Unmute'
                        : 'Mute'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="contact"
                  onClick={loadFullConversationHistory}
                  disabled={syncingHistory}
                >
                  {syncingHistory ? 'Syncing...' : 'Sync History'}
                </button>
              </div>
            </div>

            <div
              className="chat-messages"
              ref={chatMessagesRef}
              onClick={() => markConversationAsRead(activeContact)}
            >
              {loadingOlderHistory ? <p className="chat-empty">Loading older messages...</p> : null}
              {!activeMessages.some((message) => !isReactionOnlyMessage(message)) ? (
                <p className="chat-empty">No messages yet.</p>
              ) : (
                activeMessages.map((message) => {
                  if (isReactionOnlyMessage(message)) {
                    return null;
                  }
                  const messageDisplayText = getMessageDisplayText(message.text, message.direction);
                  const parsedImageTag = parseImageTag(message.text);
                  const messageReactions = getReactionsForMessage(message);
                  const reactedEmojiSet = new Set(
                    messageReactions.filter((reaction) => reaction.reactedByMe).map((reaction) => reaction.emoji)
                  );
                  const deliveryLabel =
                    message.deliveryState === 'pending'
                      ? 'Sending...'
                      : message.deliveryState === 'sent'
                        ? 'Sent'
                        : message.deliveryState === 'failed'
                          ? 'Failed'
                          : '';

                  return (
                    <div
                      key={message.id}
                      className={message.direction === 'outgoing' ? 'message-row outgoing' : 'message-row incoming'}
                    >
                      <div
                        ref={(node) => {
                          messageElementRefs.current[message.id] = node;
                        }}
                        className={
                          highlightedMessageId === message.id
                            ? 'message-bubble highlighted'
                            : replyingToMessage?.id === message.id
                              ? 'message-bubble replying'
                              : 'message-bubble'
                        }
                      >
                        <>
                          <button
                            type="button"
                            className="message-react-action"
                            onClick={() =>
                              setReactionPickerMessageId((previous) =>
                                previous === message.id ? null : message.id
                              )
                            }
                            aria-label="React to this message"
                            title="React"
                            disabled={!message.txHash || sendingReaction}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="message-reply-action"
                            onClick={() => setReplyingToMessage(message)}
                            aria-label="Reply to this message"
                            title="Reply"
                          >
                            R
                          </button>
                          {reactionPickerMessageId === message.id ? (
                            <div className="message-reaction-picker" role="dialog" aria-label="Pick reaction">
                              {DEFAULT_REACTION_EMOJIS.map((emoji) => (
                                <button
                                  key={`${message.id}-${emoji}`}
                                  type="button"
                                  onClick={() => {
                                    sendReactionToMessage(message, emoji).catch(() => {});
                                  }}
                                  disabled={sendingReaction || reactedEmojiSet.has(emoji)}
                                  title={reactedEmojiSet.has(emoji) ? `Already reacted with ${emoji}` : `React with ${emoji}`}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                        {message.replyToText || message.replyToTxHash ? (
                          <button
                            type="button"
                            className="message-reply"
                            onClick={() =>
                              jumpToReferencedMessage(message.replyToMessageId, message.replyToText, message.replyToTxHash)
                            }
                            title="Go to replied message"
                          >
                            ↪ {message.replyToText ?? `Tx ${shortenAddress(message.replyToTxHash as string)}`}
                          </button>
                        ) : null}
                        {parsedImageTag ? <ChatImage tag={message.text} parsed={parsedImageTag} /> : messageDisplayText ? <div>{messageDisplayText}</div> : null}
                        {messageReactions.length > 0 ? (
                          <div className="message-reactions">
                            {messageReactions.map((reaction) => (
                              <button
                                key={`${message.id}-${reaction.emoji}`}
                                type="button"
                                className={reaction.reactedByMe ? 'message-reaction-chip active' : 'message-reaction-chip'}
                                onClick={() => {
                                  sendReactionToMessage(message, reaction.emoji).catch(() => {});
                                }}
                                disabled={!message.txHash || sendingReaction || reaction.reactedByMe}
                              >
                                <span>{reaction.emoji}</span>
                                <span>{reaction.count}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {message.timestamp || deliveryLabel ? (
                          <div className="message-meta">
                            {message.timestamp ? <span className="message-time">{formatMessageTimestamp(message.timestamp)}</span> : null}
                            {deliveryLabel ? (
                              <span
                                className={
                                  message.deliveryState === 'failed'
                                    ? 'message-delivery failed'
                                    : message.deliveryState === 'pending'
                                      ? 'message-delivery pending'
                                      : 'message-delivery sent'
                                }
                              >
                                {deliveryLabel}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <DirectChatCompose
              replyPreviewText={replyingPreviewText}
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
              canSendTipFromComposer={canSendTipFromComposer}
              tipAmountExceedsBalance={tipAmountExceedsBalance}
              tipAmountSummaryLabel={tipAmountSummaryLabel}
              tipBalanceSummaryLabel={tipBalanceSummaryLabel}
              onSendTip={() => {
                sendTipToActiveContact(tipTokenSelection, tipAmountWeiFromInput).catch(() => {});
              }}
              composerRef={chatComposerRef}
              isMobileNav={isMobileNav}
              onSendMessage={() => {
                sendMessage().catch(() => {});
              }}
              maxMessageLength={MAX_MESSAGE_LENGTH}
              onMessageInputChange={setMessageInput}
              sending={sending}
              tipToggleDisabled={tipping || sending || !activeContact || isSelfChat}
              tipToggleTitle={tipComposerOpen ? 'Hide tip options' : 'Open tip options'}
            />
          </div>
        ) : (
          <div className="chat-placeholder">Select a contact or group to start messaging.</div>
        )}
      </main>

      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile sections">
        <button
          type="button"
          className={activeMobileView === 'wallets' ? 'active' : undefined}
          onClick={() => setActiveMobileView('wallets')}
        >
          Wallet
        </button>
        {isConnected ? (
          <>
            <button
              type="button"
              className={activeMobileView === 'contacts' ? 'active' : undefined}
              onClick={() => setActiveMobileView('contacts')}
            >
              Contacts
            </button>
            <button
              type="button"
              className={activeMobileView === 'chat' ? 'active' : undefined}
              onClick={() => setActiveMobileView('chat')}
            >
              Chat
            </button>
          </>
        ) : null}
      </nav>

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

      <BurnerImportModal
        isOpen={showBurnerImportModal}
        initializingBurner={initializingBurner}
        burnerImportInput={burnerImportInput}
        onBurnerImportInputChange={setBurnerImportInput}
        error={error}
        onClose={() => setShowBurnerImportModal(false)}
        onImport={importBurnerWallet}
      />

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
    </div>
  );
}

