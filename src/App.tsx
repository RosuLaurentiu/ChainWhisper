import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from './components/AppHeader';
import BurnerImportModal from './components/BurnerImportModal';
import BurnerPinModal from './components/BurnerPinModal';
import ContactsSidebar from './components/ContactsSidebar';
import DirectChatPanel from './components/DirectChatPanel';
import GroupChatPanel from './components/GroupChatPanel';
import MobileBottomNav from './components/MobileBottomNav';
import QuickActionsModal from './components/QuickActionsModal';
import TradeComposerPanel, { type TradeComposerTokenOption } from './components/TradeComposerPanel';
import WalletSidebar from './components/WalletSidebar';
import { useBurnerWallet } from './hooks/useBurnerWallet';
import { useStateBackupSync } from './hooks/useStateBackupSync';
import { useWalletOnboarding } from './hooks/useWalletOnboarding';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  ActiveGroupJoinCode,
  applyConversationPreferenceStateToContact,
  AUTO_STATE_BACKUP_BLOCK_DISTANCE,
  AUTO_STATE_BACKUP_RETRY_BLOCKS,
  AUTO_SYNC_INTERVAL_MS,
  buildMessageWithContactNamePayload,
  buildMessageWithConversationStatePayload,
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
  CONTACT_NAME_ENCODING_ONE,
  CONTACT_NAME_ENCODING_ZERO,
  CONTACT_NAME_METADATA_PREFIX,
  CONVERSATION_STATE_METADATA_PREFIX,
  ConversationBlockRange,
  ConversationLog,
  ConversationPreferenceState,
  COPY_FEEDBACK_DURATION_MS,
  COTI_NETWORK,
  createCotiBrowserProvider,
  debugLog,
  decodeMemoPlaintext,
  encodeCompactMemoPlaintext,
  DEFAULT_GROUP_JOIN_CODE_MAX_USES,
  DEFAULT_GROUP_JOIN_CODE_MULTI_USES,
  DEFAULT_NICKNAME_MAX_BYTES,
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
  getProviderErrorMessage,
  GROUP_ADMIN_BURN_ADDRESS,
  GROUP_CHAT_CONTRACT_ABI,
  GROUP_CHAT_CONTRACT_ADDRESS,
  GROUP_JOIN_CODE_ALPHABET,
  GROUP_JOIN_CODE_PROOF_DOMAIN,
  GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS,
  GROUP_JOIN_CODE_SIGNER_KEY_PREFIX,
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
  isProviderActionRejected,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  loadCotiWsProvider,
  MAX_ERC20_APPROVAL,
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
  NICKNAME_DELIMITER,
  parseChatMessagePayload,
  parseConversationBlockRange,
  parseGroupInviteCode,
  parseGroupJoinCodeFromPayload,
  parseGroupJoinCodeState,
  parseReadCursorText,
  parseRecentPeersWithMetaResult,
  parseTradeOfferMessagePayload,
  parseStateBackupText,
  parseStoredGroupTitle,
  parseSubmitMemoPayload,
  parseTokenAmountInput,
  parseWalletAddressListInput,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_ERC20_TOKEN_ABI,
  PRIVATE_TOKEN_BALANCE_ABI,
  PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
  PROFILE_METADATA_PREFIX,
  REACTION_METADATA_PREFIX,
  REPLY_DELIMITER,
  REPLY_METADATA_PREFIX,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  RecentPeerMeta,
  resetCotiWsProvider,
  REWARD_TOKEN_ADDRESS,
  LEGACY_CONVERSATION_STATE_METADATA_PREFIX,
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

type MessageReferenceCandidate = {
  txHash?: string;
  blockNumber?: number;
  logIndex?: number;
};

type TradeTokenPresetKey = 'coti' | 'wisp' | 'pwisp' | 'custom-public' | 'custom-private';

type ResolvedTradeToken = Omit<TradeAssetPayload, 'amount'>;

type TradeCustomTokenInfo = {
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;
  address: string;
  symbol: string;
  decimals: number;
  balanceWei: bigint | null;
  loading: boolean;
  error?: string;
  walletKey?: string;
};

type TradeComposerFieldErrors = {
  general?: string;
  fee?: string;
  offerAsset?: string;
  requestAsset?: string;
  offerAmount?: string;
  requestAmount?: string;
  expiry?: string;
};

type PendingTradeCounterContext = {
  offer: TradeOfferMessagePayload;
  sourceMessage: ChatMessage;
};

const DEFAULT_TRADE_EXPIRY_HOURS = '24';
const TRADE_STATUS_OPEN = 1;
const TRADE_STATUS_ACCEPTED = 2;
const TRADE_STATUS_CANCELLED = 3;
const TRADE_STATUS_DECLINED = 4;
const TRADE_ASSET_TYPE_NATIVE = 0;
const TRADE_ASSET_TYPE_ERC20 = 1;
const TRADE_ASSET_TYPE_PRIVATE_ERC20 = 2;

const resolveTradeSnapshotStatus = (statusRaw: unknown, expiresAt: number): TradeSnapshot['status'] => {
  const status = Number(statusRaw);
  if (status === TRADE_STATUS_OPEN) {
    return expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) ? 'expired' : 'open';
  }
  if (status === TRADE_STATUS_ACCEPTED) {
    return 'accepted';
  }
  if (status === TRADE_STATUS_CANCELLED) {
    return 'cancelled';
  }
  if (status === TRADE_STATUS_DECLINED) {
    return 'declined';
  }
  return 'unknown';
};

const isCustomTradeTokenSelection = (selection: TradeTokenPresetKey): boolean =>
  selection === 'custom-public' || selection === 'custom-private';

const resolveTradePresetKind = (selection: TradeTokenPresetKey): TradeAssetPayload['kind'] => {
  if (selection === 'coti') {
    return 'native';
  }
  return selection === 'pwisp' || selection === 'custom-private' ? 'private-erc20' : 'erc20';
};

const buildTradeCustomTokenInfoKey = (
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>,
  address: string
): string => `${kind}:${address.trim().toLowerCase()}`;

const resolveTradeAssetTypeValue = (kind: TradeAssetPayload['kind']): number => {
  if (kind === 'native') {
    return TRADE_ASSET_TYPE_NATIVE;
  }
  return kind === 'private-erc20' ? TRADE_ASSET_TYPE_PRIVATE_ERC20 : TRADE_ASSET_TYPE_ERC20;
};

const SHARED_TX_REFERENCE_PREFIX_BYTES = 4;
const SHARED_TX_REFERENCE_PREFIX_BASE64_LENGTH = 6;
const SHARED_TX_REFERENCE_REGEX = new RegExp(
  `^x([0-9a-z]+)-([A-Za-z0-9\\-_]{${SHARED_TX_REFERENCE_PREFIX_BASE64_LENGTH}})$`
);

const isSafeReferencePart = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const buildSharedTxReference = (txHash?: string, blockNumber?: number): string => {
  const normalizedTxHash = txHash?.trim().toLowerCase() ?? '';
  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash) || !isSafeReferencePart(blockNumber)) {
    return '';
  }

  const prefixHexLength = SHARED_TX_REFERENCE_PREFIX_BYTES * 2;
  const prefixHex = normalizedTxHash.slice(2, 2 + prefixHexLength);
  let binary = '';
  for (let index = 0; index < prefixHex.length; index += 2) {
    const nextByte = Number.parseInt(prefixHex.slice(index, index + 2), 16);
    if (!Number.isFinite(nextByte) || nextByte < 0 || nextByte > 255) {
      return '';
    }
    binary += String.fromCharCode(nextByte);
  }

  return `x${blockNumber.toString(36)}-${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
};

const parseSharedTxReference = (
  value?: string
): { normalizedReference: string; blockNumber: number; txHashPrefix: string } | null => {
  const trimmedValue = value?.trim() ?? '';
  const match = trimmedValue.match(SHARED_TX_REFERENCE_REGEX);
  if (!match) {
    return null;
  }

  const blockNumber = Number.parseInt(match[1], 36);
  if (!isSafeReferencePart(blockNumber)) {
    return null;
  }

  const txHashPrefix = match[2].toLowerCase();
  return {
    normalizedReference: `x${match[1].toLowerCase()}-${txHashPrefix}`,
    blockNumber,
    txHashPrefix
  };
};

const buildMessageReferenceKeys = ({ txHash, blockNumber, logIndex }: MessageReferenceCandidate): string[] => {
  const keys = new Set<string>();
  const sharedReference = parseSharedTxReference(txHash);
  if (sharedReference) {
    keys.add(`s:${sharedReference.normalizedReference}`);
  }

  const normalizedTxHash = txHash?.trim().toLowerCase() ?? '';
  if (/^0x[a-f0-9]{64}$/.test(normalizedTxHash)) {
    keys.add(`t:${normalizedTxHash}`);
    const compactSharedReference = buildSharedTxReference(normalizedTxHash, blockNumber);
    if (compactSharedReference) {
      keys.add(`s:${compactSharedReference}`);
    }
  }

  if (isSafeReferencePart(blockNumber) && isSafeReferencePart(logIndex)) {
    keys.add(`b:${blockNumber}:${logIndex}`);
  }

  return Array.from(keys);
};

const buildMessageReferenceKey = (candidate: MessageReferenceCandidate): string => buildMessageReferenceKeys(candidate)[0] ?? '';

const messageReferencesMatch = (left: MessageReferenceCandidate, right: MessageReferenceCandidate): boolean => {
  const leftKeys = buildMessageReferenceKeys(left);
  if (leftKeys.length === 0) {
    return false;
  }

  const rightKeys = new Set(buildMessageReferenceKeys(right));
  return leftKeys.some((key) => rightKeys.has(key));
};

const OUTGOING_HIDDEN_METADATA_CHARACTERS_REGEX = new RegExp(
  `[${[
    CONVERSATION_STATE_METADATA_PREFIX,
    PROFILE_METADATA_PREFIX,
    REPLY_METADATA_PREFIX,
    CONTACT_NAME_METADATA_PREFIX,
    REACTION_METADATA_PREFIX,
    LEGACY_CONVERSATION_STATE_METADATA_PREFIX,
    CONTACT_NAME_ENCODING_ZERO,
    CONTACT_NAME_ENCODING_ONE,
    REPLY_DELIMITER,
    NICKNAME_DELIMITER
  ].join('')}]`,
  'g'
);

const sanitizeOutgoingMessagePlainText = (value: string): string =>
  value.replace(/\r/g, '').replace(OUTGOING_HIDDEN_METADATA_CHARACTERS_REGEX, '');

const isLikelyOutOfGasFailure = (error: unknown): boolean => {
  const receipt = (error as { receipt?: { gasUsed?: bigint; gasLimit?: bigint } } | null)?.receipt;
  const transaction = (error as { transaction?: { gasLimit?: bigint } } | null)?.transaction;
  const gasUsed = receipt?.gasUsed;
  const gasLimit = receipt?.gasLimit ?? transaction?.gasLimit;
  if (typeof gasUsed !== 'bigint' || typeof gasLimit !== 'bigint' || gasLimit <= 0n) {
    return false;
  }

  return gasUsed >= gasLimit - 5_000n;
};

const getOnChainFailureMessage = (error: unknown, fallbackMessage: string): string => {
  if (isLikelyOutOfGasFailure(error)) {
    return 'Transaction ran out of gas on-chain. Try a shorter message, clear any reply, or use a smaller group.';
  }

  return fallbackMessage;
};

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
  const previousActiveContactForScrollRef = useRef<string | null>(null);
  const previousLastMessageIdForScrollRef = useRef<string | null>(null);
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
  const tradeTokenOptions = useMemo<TradeComposerTokenOption[]>(
    () => [
      { value: 'coti', label: `${TIP_NATIVE_TOKEN_SYMBOL} (native)` },
      { value: 'wisp', label: `${rewardTokenSymbol} (public)` },
      { value: 'pwisp', label: `${privateRewardTokenSymbol} (private)` },
      { value: 'custom-public', label: 'Custom public token / CA' },
      { value: 'custom-private', label: 'Custom private token / CA' }
    ],
    [privateRewardTokenSymbol, rewardTokenSymbol]
  );
  const normalizedTradeOfferCustomTokenAddress = tradeOfferCustomTokenAddress.trim();
  const normalizedTradeRequestCustomTokenAddress = tradeRequestCustomTokenAddress.trim();
  const tradeCustomOfferTokenKind =
    resolveTradePresetKind(tradeOfferTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20';
  const tradeCustomRequestTokenKind =
    resolveTradePresetKind(tradeRequestTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20';
  const tradeCustomOfferTokenKey =
    normalizedTradeOfferCustomTokenAddress && isWalletAddress(normalizedTradeOfferCustomTokenAddress)
      ? buildTradeCustomTokenInfoKey(tradeCustomOfferTokenKind, normalizedTradeOfferCustomTokenAddress)
      : '';
  const tradeCustomRequestTokenKey =
    normalizedTradeRequestCustomTokenAddress && isWalletAddress(normalizedTradeRequestCustomTokenAddress)
      ? buildTradeCustomTokenInfoKey(tradeCustomRequestTokenKind, normalizedTradeRequestCustomTokenAddress)
      : '';
  const tradeCustomOfferTokenInfo =
    tradeCustomOfferTokenKey ? customTradeTokenInfoByAddress[tradeCustomOfferTokenKey] : undefined;
  const tradeCustomRequestTokenInfo =
    tradeCustomRequestTokenKey ? customTradeTokenInfoByAddress[tradeCustomRequestTokenKey] : undefined;
  const selectedTradeOfferToken = useMemo<ResolvedTradeToken | null>(() => {
    if (tradeOfferTokenSelection === 'coti') {
      return {
        kind: 'native',
        symbol: TIP_NATIVE_TOKEN_SYMBOL,
        decimals: TIP_NATIVE_TOKEN_DECIMALS
      };
    }

    if (tradeOfferTokenSelection === 'wisp') {
      return {
        kind: 'erc20',
        tokenAddress: REWARD_TOKEN_ADDRESS,
        symbol: rewardTokenSymbol,
        decimals: rewardTokenDecimals
      };
    }

    if (tradeOfferTokenSelection === 'pwisp') {
      return {
        kind: 'private-erc20',
        tokenAddress: PRIVATE_REWARD_TOKEN_ADDRESS,
        symbol: privateRewardTokenSymbol,
        decimals: privateRewardTokenDecimals
      };
    }

    if (!tradeCustomOfferTokenInfo || tradeCustomOfferTokenInfo.error || tradeCustomOfferTokenInfo.loading) {
      return null;
    }

    return {
      kind: tradeCustomOfferTokenInfo.kind,
      tokenAddress: tradeCustomOfferTokenInfo.address,
      symbol: tradeCustomOfferTokenInfo.symbol,
      decimals: tradeCustomOfferTokenInfo.decimals,
      custom: true
    };
  }, [
    tradeOfferTokenSelection,
    tradeCustomOfferTokenInfo,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenSymbol,
    rewardTokenDecimals
  ]);
  const selectedTradeRequestToken = useMemo<ResolvedTradeToken | null>(() => {
    if (tradeRequestTokenSelection === 'coti') {
      return {
        kind: 'native',
        symbol: TIP_NATIVE_TOKEN_SYMBOL,
        decimals: TIP_NATIVE_TOKEN_DECIMALS
      };
    }

    if (tradeRequestTokenSelection === 'wisp') {
      return {
        kind: 'erc20',
        tokenAddress: REWARD_TOKEN_ADDRESS,
        symbol: rewardTokenSymbol,
        decimals: rewardTokenDecimals
      };
    }

    if (tradeRequestTokenSelection === 'pwisp') {
      return {
        kind: 'private-erc20',
        tokenAddress: PRIVATE_REWARD_TOKEN_ADDRESS,
        symbol: privateRewardTokenSymbol,
        decimals: privateRewardTokenDecimals
      };
    }

    if (!tradeCustomRequestTokenInfo || tradeCustomRequestTokenInfo.error || tradeCustomRequestTokenInfo.loading) {
      return null;
    }

    return {
      kind: tradeCustomRequestTokenInfo.kind,
      tokenAddress: tradeCustomRequestTokenInfo.address,
      symbol: tradeCustomRequestTokenInfo.symbol,
      decimals: tradeCustomRequestTokenInfo.decimals,
      custom: true
    };
  }, [
    tradeRequestTokenSelection,
    tradeCustomRequestTokenInfo,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenSymbol,
    rewardTokenDecimals
  ]);
  const selectedTradeOfferBalanceWei = useMemo(() => {
    if (!selectedTradeOfferToken) {
      return null;
    }

    if (selectedTradeOfferToken.kind === 'native') {
      return tipNativeBalanceWei;
    }

    const tokenKey = selectedTradeOfferToken.tokenAddress?.toLowerCase();
    if (!tokenKey) {
      return null;
    }

    if (tokenKey === REWARD_TOKEN_ADDRESS.toLowerCase()) {
      return rewardTokenBalanceWei;
    }

    if (tokenKey === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
      return privateRewardTokenBalanceWei;
    }

    return customTradeTokenInfoByAddress[buildTradeCustomTokenInfoKey(
      selectedTradeOfferToken.kind === 'private-erc20' ? 'private-erc20' : 'erc20',
      tokenKey
    )]?.balanceWei ?? null;
  }, [
    customTradeTokenInfoByAddress,
    privateRewardTokenBalanceWei,
    rewardTokenBalanceWei,
    selectedTradeOfferToken,
    tipNativeBalanceWei
  ]);
  const parsedTradeOfferAmountWei = useMemo(
    () =>
      selectedTradeOfferToken
        ? parseTokenAmountInput(tradeOfferAmountInput, selectedTradeOfferToken.decimals)
        : null,
    [tradeOfferAmountInput, selectedTradeOfferToken]
  );
  const parsedTradeRequestAmountWei = useMemo(
    () =>
      selectedTradeRequestToken
        ? parseTokenAmountInput(tradeRequestAmountInput, selectedTradeRequestToken.decimals)
        : null,
    [tradeRequestAmountInput, selectedTradeRequestToken]
  );
  const tradeOfferAmountSummaryLabel =
    parsedTradeOfferAmountWei !== null && parsedTradeOfferAmountWei > 0n && selectedTradeOfferToken
      ? `${formatTokenAmount(parsedTradeOfferAmountWei, selectedTradeOfferToken.decimals, 6)} ${selectedTradeOfferToken.symbol}`
      : `0 ${selectedTradeOfferToken?.symbol ?? 'TOKEN'}`;
  const tradeRequestAmountSummaryLabel =
    parsedTradeRequestAmountWei !== null && parsedTradeRequestAmountWei > 0n && selectedTradeRequestToken
      ? `${formatTokenAmount(parsedTradeRequestAmountWei, selectedTradeRequestToken.decimals, 6)} ${selectedTradeRequestToken.symbol}`
      : `0 ${selectedTradeRequestToken?.symbol ?? 'TOKEN'}`;
  const tradeOfferBalanceSummaryLabel =
    selectedTradeOfferToken && selectedTradeOfferBalanceWei !== null
      ? `${formatTokenAmount(selectedTradeOfferBalanceWei, selectedTradeOfferToken.decimals, 6)} ${selectedTradeOfferToken.symbol}`
      : '--';
  const tradeOfferVerifyUrl = selectedTradeOfferToken?.tokenAddress
    ? `${COTI_NETWORK.blockExplorerUrl}/token/${selectedTradeOfferToken.tokenAddress}`
    : undefined;
  const tradeRequestVerifyUrl = selectedTradeRequestToken?.tokenAddress
    ? `${COTI_NETWORK.blockExplorerUrl}/token/${selectedTradeRequestToken.tokenAddress}`
    : undefined;
  const parsedTradeExpiryHours = useMemo(() => {
    const normalized = tradeExpiryHoursInput.trim();
    if (!/^\d+$/.test(normalized)) {
      return 0;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [tradeExpiryHoursInput]);
  const tradeComposerFieldErrors = useMemo<TradeComposerFieldErrors>(() => {
    const errors: TradeComposerFieldErrors = {};

    if (!activeContact) {
      errors.general = 'Select a contact first.';
      return errors;
    }
    if (!walletAddress || !isWalletAddress(walletAddress)) {
      errors.general = 'Connect your wallet first.';
      return errors;
    }
    if (isSelfChat) {
      errors.general = 'P2P trades are only available in private chats with another wallet.';
      return errors;
    }
    if (!onCotiNetwork) {
      errors.general = 'Switch to COTI network first.';
      return errors;
    }
    if (!TRADE_ESCROW_CONTRACT_ADDRESS || !isWalletAddress(TRADE_ESCROW_CONTRACT_ADDRESS)) {
      errors.general = 'Trade escrow contract is not configured yet.';
      return errors;
    }
    if (!selectedTradeOfferToken) {
      errors.offerAsset = isCustomTradeTokenSelection(tradeOfferTokenSelection)
        ? 'Load a valid token to send.'
        : 'Select a token to send.';
    }
    if (!selectedTradeRequestToken) {
      errors.requestAsset = isCustomTradeTokenSelection(tradeRequestTokenSelection)
        ? 'Load a valid token to receive.'
        : 'Select a token to receive.';
    }

    if (selectedTradeOfferToken && (parsedTradeOfferAmountWei === null || parsedTradeOfferAmountWei <= 0n)) {
      errors.offerAmount = `Enter a valid ${selectedTradeOfferToken.symbol} amount to send.`;
    }
    if (selectedTradeRequestToken && (parsedTradeRequestAmountWei === null || parsedTradeRequestAmountWei <= 0n)) {
      errors.requestAmount = `Enter a valid ${selectedTradeRequestToken.symbol} amount to receive.`;
    }

    if (
      selectedTradeOfferToken &&
      parsedTradeOfferAmountWei !== null &&
      parsedTradeOfferAmountWei > 0n &&
      selectedTradeOfferToken.kind === 'private-erc20' &&
      parsedTradeOfferAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
    ) {
      errors.offerAmount = `${selectedTradeOfferToken.symbol} private trades are capped at ${formatTokenAmount(
        PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
        selectedTradeOfferToken.decimals,
        6
      )} ${selectedTradeOfferToken.symbol}.`;
    }
    if (
      selectedTradeRequestToken &&
      parsedTradeRequestAmountWei !== null &&
      parsedTradeRequestAmountWei > 0n &&
      selectedTradeRequestToken.kind === 'private-erc20' &&
      parsedTradeRequestAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE
    ) {
      errors.requestAmount = `${selectedTradeRequestToken.symbol} private trades are capped at ${formatTokenAmount(
        PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
        selectedTradeRequestToken.decimals,
        6
      )} ${selectedTradeRequestToken.symbol}.`;
    }

    const offerAmountValid = selectedTradeOfferToken && parsedTradeOfferAmountWei !== null && parsedTradeOfferAmountWei > 0n;
    const requestAmountValid =
      selectedTradeRequestToken && parsedTradeRequestAmountWei !== null && parsedTradeRequestAmountWei > 0n;

    if (selectedTradeOfferToken?.kind === 'native' && offerAmountValid) {
      if (tipNativeBalanceWei === null) {
        errors.offerAmount = 'Unable to read your COTI balance yet.';
      } else {
        const requiredNativeBalance =
          parsedTradeOfferAmountWei + (tradeFeeModeSelection === 'coti' ? tradeRequiredFeeWei ?? 0n : 0n);
        if (requiredNativeBalance > tipNativeBalanceWei) {
          errors.offerAmount = `Need ${formatTokenAmount(requiredNativeBalance, TIP_NATIVE_TOKEN_DECIMALS, 6)} ${TIP_NATIVE_TOKEN_SYMBOL} to cover the send amount and fee.`;
        }
      }
    } else if (selectedTradeOfferToken && offerAmountValid) {
      if (selectedTradeOfferBalanceWei === null) {
        errors.offerAmount = `Unable to read ${selectedTradeOfferToken.symbol} balance yet.`;
      } else if (parsedTradeOfferAmountWei > selectedTradeOfferBalanceWei) {
        errors.offerAmount = `Insufficient ${selectedTradeOfferToken.symbol} balance to send this amount.`;
      }
    }

    if (tradeFeeModeSelection === 'token') {
      if (tradeTokenFeeWei === null) {
        errors.fee = `Loading ${rewardTokenSymbol} fee...`;
      }
    } else {
      if (tradeRequiredFeeWei === null) {
        errors.fee = 'Loading trade fee...';
      } else if (selectedTradeOfferToken?.kind !== 'native') {
        if (tipNativeBalanceWei === null || tipNativeBalanceWei < tradeRequiredFeeWei) {
          errors.fee = `Need ${formatCotiAmount(tradeRequiredFeeWei)} ${TIP_NATIVE_TOKEN_SYMBOL} for the trade fee.`;
        }
      }
    }

    if (parsedTradeExpiryHours < 1 || parsedTradeExpiryHours > 720) {
      errors.expiry = 'Set an expiry between 1 and 720 hours.';
    }

    if (selectedTradeOfferToken && selectedTradeRequestToken && offerAmountValid && requestAmountValid) {
      const offerTokenKey = selectedTradeOfferToken.tokenAddress?.toLowerCase() ?? 'native';
      const requestTokenKey = selectedTradeRequestToken.tokenAddress?.toLowerCase() ?? 'native';
      if (
        selectedTradeOfferToken.kind === selectedTradeRequestToken.kind &&
        offerTokenKey === requestTokenKey &&
        parsedTradeOfferAmountWei === parsedTradeRequestAmountWei
      ) {
        errors.general = 'Choose different send and receive terms.';
      }
    }

    return errors;
  }, [
    activeContact,
    walletAddress,
    isSelfChat,
    onCotiNetwork,
    selectedTradeOfferToken,
    selectedTradeRequestToken,
    tradeOfferTokenSelection,
    tradeRequestTokenSelection,
    parsedTradeOfferAmountWei,
    parsedTradeRequestAmountWei,
    selectedTradeOfferBalanceWei,
    tradeFeeModeSelection,
    tradeRequiredFeeWei,
    tradeTokenFeeWei,
    rewardTokenSymbol,
    parsedTradeExpiryHours,
    tipNativeBalanceWei
  ]);
  const tradeComposerValidationMessage =
    tradeComposerFieldErrors.general ??
    tradeComposerFieldErrors.offerAsset ??
    tradeComposerFieldErrors.requestAsset ??
    tradeComposerFieldErrors.offerAmount ??
    tradeComposerFieldErrors.requestAmount ??
    tradeComposerFieldErrors.fee ??
    tradeComposerFieldErrors.expiry ??
    '';
  const canSendTradeOffer =
    !creatingTrade &&
    !sending &&
    !tipping &&
    tradeComposerValidationMessage.length === 0;
  const tradeOfferMaxAmountWei = useMemo(() => {
    if (!selectedTradeOfferToken) {
      return null;
    }

    let maxAmountWei: bigint | null = null;
    if (selectedTradeOfferToken.kind === 'native') {
      if (tipNativeBalanceWei === null) {
        return null;
      }
      maxAmountWei = tipNativeBalanceWei;
      if (tradeFeeModeSelection === 'coti') {
        if (tradeRequiredFeeWei === null) {
          return null;
        }
        maxAmountWei = maxAmountWei > tradeRequiredFeeWei ? maxAmountWei - tradeRequiredFeeWei : 0n;
      }
    } else {
      if (selectedTradeOfferBalanceWei === null) {
        return null;
      }
      maxAmountWei = selectedTradeOfferBalanceWei;
    }

    if (selectedTradeOfferToken.kind === 'private-erc20' && maxAmountWei > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE) {
      maxAmountWei = PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE;
    }

    return maxAmountWei >= 0n ? maxAmountWei : 0n;
  }, [
    selectedTradeOfferBalanceWei,
    selectedTradeOfferToken,
    tipNativeBalanceWei,
    tradeFeeModeSelection,
    tradeRequiredFeeWei
  ]);
  const tradeOfferMaxInputValue = useMemo(
    () =>
      selectedTradeOfferToken && tradeOfferMaxAmountWei !== null
        ? formatTokenAmount(tradeOfferMaxAmountWei, selectedTradeOfferToken.decimals, 18)
        : '',
    [selectedTradeOfferToken, tradeOfferMaxAmountWei]
  );
  const canUseTradeOfferMax = tradeOfferMaxAmountWei !== null && tradeOfferMaxAmountWei > 0n;
  const tradePreviewLabel =
    selectedTradeOfferToken && selectedTradeRequestToken
      ? `Send ${tradeOfferAmountSummaryLabel} for ${tradeRequestAmountSummaryLabel}`
      : '';
  const tradeRateLabel = useMemo(() => {
    if (
      !selectedTradeOfferToken ||
      !selectedTradeRequestToken ||
      parsedTradeOfferAmountWei === null ||
      parsedTradeRequestAmountWei === null ||
      parsedTradeOfferAmountWei <= 0n ||
      parsedTradeRequestAmountWei <= 0n
    ) {
      return '';
    }

    try {
      const scaledRequestAmount =
        (parsedTradeRequestAmountWei * 10n ** BigInt(selectedTradeOfferToken.decimals)) / parsedTradeOfferAmountWei;
      return `1 ${selectedTradeOfferToken.symbol} ≈ ${formatTokenAmount(
        scaledRequestAmount,
        selectedTradeRequestToken.decimals,
        6
      )} ${selectedTradeRequestToken.symbol}`;
    } catch {
      return '';
    }
  }, [
    parsedTradeOfferAmountWei,
    parsedTradeRequestAmountWei,
    selectedTradeOfferToken,
    selectedTradeRequestToken
  ]);
  const tradeFeeSummaryLabel =
    tradeFeeModeSelection === 'coti'
      ? `Fee: ${tradeRequiredFeeWei !== null ? `${formatCotiAmount(tradeRequiredFeeWei)} ${TIP_NATIVE_TOKEN_SYMBOL}` : '--'}`
      : `Fee: ${
          tradeTokenFeeWei !== null
            ? `${formatTokenAmount(tradeTokenFeeWei, rewardTokenDecimals, 6)} ${rewardTokenSymbol}`
            : `-- ${rewardTokenSymbol}`
        }`;
  const tradeOfferCustomMetaLabel = !normalizedTradeOfferCustomTokenAddress
    ? 'Paste a token contract address.'
    : !isWalletAddress(normalizedTradeOfferCustomTokenAddress)
      ? 'Enter a valid token contract address.'
      : tradeCustomOfferTokenInfo?.loading
        ? 'Loading token metadata...'
        : tradeCustomOfferTokenInfo?.error
          ? tradeCustomOfferTokenInfo.error
          : tradeCustomOfferTokenInfo
            ? `${tradeCustomOfferTokenInfo.symbol} \u2022 ${tradeCustomOfferTokenInfo.decimals} decimals`
            : 'Loading token metadata...';
  const tradeRequestCustomMetaLabel = !normalizedTradeRequestCustomTokenAddress
    ? 'Paste a token contract address.'
    : !isWalletAddress(normalizedTradeRequestCustomTokenAddress)
      ? 'Enter a valid token contract address.'
      : tradeCustomRequestTokenInfo?.loading
        ? 'Loading token metadata...'
        : tradeCustomRequestTokenInfo?.error
          ? tradeCustomRequestTokenInfo.error
          : tradeCustomRequestTokenInfo
            ? `${tradeCustomRequestTokenInfo.symbol} \u2022 ${tradeCustomRequestTokenInfo.decimals} decimals`
            : 'Loading token metadata...';
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
            return await fetchTradeSnapshotById(tradeId);
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

  const decryptPrivateUintValue = async (
    encryptedValue: unknown,
    signer: Wallet | JsonRpcSigner
  ): Promise<bigint | null> => {
    if (encryptedValue === null || encryptedValue === undefined) {
      return null;
    }

    try {
      const decrypted = await signer.decryptValue(encryptedValue as never);
      if (typeof decrypted === 'bigint') {
        return decrypted <= PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE ? decrypted : null;
      }
      if (typeof decrypted === 'string' && /^\d+$/.test(decrypted.trim())) {
        const parsed = BigInt(decrypted.trim());
        return parsed <= PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE ? parsed : null;
      }
    } catch {
    }

    return null;
  };

  const readPrivateTokenBalanceWei = async (
    tokenAddress: string,
    ownerAddress: string,
    signer: Wallet | JsonRpcSigner
  ): Promise<bigint | null> => {
    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const privateTokenInterface = new cotiEthers.Interface(PRIVATE_TOKEN_BALANCE_ABI);

    let encryptedBalanceRaw: unknown = null;
    try {
      const balanceByAddressCallData = privateTokenInterface.encodeFunctionData('balanceOf(address)', [ownerAddress]);
      const balanceByAddressRawResult = await readProvider.call({
        from: ownerAddress,
        to: tokenAddress,
        data: balanceByAddressCallData
      });
      const decodedByAddress = privateTokenInterface.decodeFunctionResult(
        'balanceOf(address)',
        balanceByAddressRawResult
      );
      encryptedBalanceRaw = decodedByAddress?.[0] ?? null;
    } catch {
      encryptedBalanceRaw = null;
    }

    if (encryptedBalanceRaw === null) {
      try {
        const balanceCallData = privateTokenInterface.encodeFunctionData('balanceOf()', []);
        const balanceRawResult = await readProvider.call({
          from: ownerAddress,
          to: tokenAddress,
          data: balanceCallData
        });
        const decodedBalance = privateTokenInterface.decodeFunctionResult('balanceOf()', balanceRawResult);
        encryptedBalanceRaw = decodedBalance?.[0] ?? null;
      } catch {
        encryptedBalanceRaw = null;
      }
    }

    return decryptPrivateUintValue(encryptedBalanceRaw, signer);
  };

  const readPrivateTokenAllowanceWei = async (
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    signer: Wallet | JsonRpcSigner
  ): Promise<bigint | null> => {
    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_ABI);
    const allowanceCallData = privateTokenInterface.encodeFunctionData('allowance', [spenderAddress, true]);
    const allowanceRawResult = await readProvider.call({
      from: ownerAddress,
      to: tokenAddress,
      data: allowanceCallData
    });
    const decodedAllowance = privateTokenInterface.decodeFunctionResult('allowance', allowanceRawResult);
    return decryptPrivateUintValue(decodedAllowance?.[0] ?? null, signer);
  };

  const resolveTradeAssetSnapshot = async (
    assetTypeRaw: unknown,
    tokenAddressRaw: unknown,
    amountRaw: unknown
  ): Promise<TradeAssetPayload> => {
    const assetType = Number(assetTypeRaw);
    const amount = typeof amountRaw === 'bigint' ? amountRaw.toString() : String(amountRaw ?? '0');

    if (assetType === TRADE_ASSET_TYPE_NATIVE) {
      return {
        kind: 'native',
        symbol: TIP_NATIVE_TOKEN_SYMBOL,
        decimals: TIP_NATIVE_TOKEN_DECIMALS,
        amount
      };
    }

    const tokenAddress = String(tokenAddressRaw ?? '').trim();
    const normalizedTokenAddress = isWalletAddress(tokenAddress) ? tokenAddress : '0x0000000000000000000000000000000000000000';
    const lowerTokenAddress = normalizedTokenAddress.toLowerCase();

    if (lowerTokenAddress === REWARD_TOKEN_ADDRESS.toLowerCase()) {
      return {
        kind: 'erc20',
        tokenAddress: normalizedTokenAddress,
        symbol: rewardTokenSymbol,
        decimals: rewardTokenDecimals,
        amount
      };
    }

    if (lowerTokenAddress === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
      return {
        kind: 'private-erc20',
        tokenAddress: normalizedTokenAddress,
        symbol: privateRewardTokenSymbol,
        decimals: privateRewardTokenDecimals,
        amount
      };
    }

    const kind: TradeAssetPayload['kind'] =
      assetType === TRADE_ASSET_TYPE_PRIVATE_ERC20 ? 'private-erc20' : 'erc20';

    try {
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const tokenContract = new cotiEthers.Contract(
        normalizedTokenAddress,
        kind === 'private-erc20' ? PRIVATE_TOKEN_BALANCE_ABI : ERC20_TOKEN_ABI,
        readProvider
      );
      const [symbolRaw, decimalsRaw] = await Promise.all([
        tokenContract.symbol().catch(() => null),
        tokenContract.decimals().catch(() => null)
      ]);

      return {
        kind,
        tokenAddress: normalizedTokenAddress,
        symbol:
          typeof symbolRaw === 'string' && symbolRaw.trim().length > 0
            ? symbolRaw.trim().slice(0, 24)
            : shortenAddress(normalizedTokenAddress),
        decimals: normalizeTokenDecimals(Number(decimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)),
        amount,
        custom: true
      };
    } catch {
      return {
        kind,
        tokenAddress: normalizedTokenAddress,
        symbol: shortenAddress(normalizedTokenAddress),
        decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
        amount,
        custom: true
      };
    }
  };

  const fetchTradeSnapshotById = async (tradeId: number): Promise<TradeSnapshot> => {
    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const contract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
    const tradeRaw = await contract.getTrade(tradeId);
    const maker = String((tradeRaw as { maker?: unknown }).maker ?? tradeRaw?.[0] ?? '').trim();
    const taker = String((tradeRaw as { taker?: unknown }).taker ?? tradeRaw?.[1] ?? '').trim();
    const statusRaw = (tradeRaw as { status?: unknown }).status ?? tradeRaw?.[2];
    const offerAssetRaw = (tradeRaw as { offerAsset?: unknown }).offerAsset ?? tradeRaw?.[3];
    const requestAssetRaw = (tradeRaw as { requestAsset?: unknown }).requestAsset ?? tradeRaw?.[4];
    const createdAt = toSafeNumber((tradeRaw as { createdAt?: unknown }).createdAt ?? tradeRaw?.[5]);
    const expiresAt = toSafeNumber((tradeRaw as { expiresAt?: unknown }).expiresAt ?? tradeRaw?.[6]);
    const offerAssetType = (offerAssetRaw as { assetType?: unknown })?.assetType ?? offerAssetRaw?.[0] ?? 0;
    const offerToken = (offerAssetRaw as { token?: unknown })?.token ?? offerAssetRaw?.[1] ?? '';
    const offerAmount = (offerAssetRaw as { amount?: unknown })?.amount ?? offerAssetRaw?.[2] ?? 0n;
    const requestAssetType = (requestAssetRaw as { assetType?: unknown })?.assetType ?? requestAssetRaw?.[0] ?? 0;
    const requestToken = (requestAssetRaw as { token?: unknown })?.token ?? requestAssetRaw?.[1] ?? '';
    const requestAmount = (requestAssetRaw as { amount?: unknown })?.amount ?? requestAssetRaw?.[2] ?? 0n;

    const [offer, request] = await Promise.all([
      resolveTradeAssetSnapshot(offerAssetType, offerToken, offerAmount),
      resolveTradeAssetSnapshot(requestAssetType, requestToken, requestAmount)
    ]);

    return {
      tradeId,
      maker,
      taker,
      offer,
      request,
      createdAt,
      expiresAt,
      status: resolveTradeSnapshotStatus(statusRaw, expiresAt)
    };
  };

  const resolveTradeSnapshotForOffer = async (offerMessage: TradeOfferMessagePayload): Promise<TradeSnapshot> => {
    const existingSnapshot = tradeSnapshotsById[String(offerMessage.tradeId)];
    if (existingSnapshot) {
      return existingSnapshot;
    }

    const nextSnapshot = await fetchTradeSnapshotById(offerMessage.tradeId);
    setTradeSnapshotsById((previous) => ({
      ...previous,
      [String(offerMessage.tradeId)]: nextSnapshot
    }));
    return nextSnapshot;
  };

  const ensureTradeTokenAllowance = async (
    signer: Wallet | JsonRpcSigner,
    ownerAddress: string,
    tokenAddress: string,
    requiredAmount: bigint,
    kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'> = 'erc20'
  ): Promise<void> => {
    if (requiredAmount <= 0n || !isWalletAddress(tokenAddress)) {
      return;
    }

    if (kind === 'private-erc20') {
      if (requiredAmount > PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE) {
        throw new Error('Private token amount exceeds the maximum plaintext size supported by COTI private ERC-20.');
      }

      const allowance = await readPrivateTokenAllowanceWei(
        tokenAddress,
        ownerAddress,
        TRADE_ESCROW_CONTRACT_ADDRESS,
        signer
      ).catch(() => null);
      if (allowance !== null && allowance >= requiredAmount) {
        return;
      }

      const cotiEthers = await loadCotiEthersModule();
      const privateTokenInterface = new cotiEthers.Interface(PRIVATE_ERC20_TOKEN_ABI);
      const approveSelector = privateTokenInterface.getFunction('approve')?.selector;
      if (!approveSelector) {
        throw new Error('Unable to prepare private token approval.');
      }

      const privateTokenContract = new cotiEthers.Contract(tokenAddress, PRIVATE_ERC20_TOKEN_ABI, signer);
      const encryptedApproval = await signer.encryptValue(
        PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE,
        tokenAddress,
        approveSelector
      );
      const approveTx = await privateTokenContract.approve(TRADE_ESCROW_CONTRACT_ADDRESS, encryptedApproval);
      await approveTx.wait();
      return;
    }

    const cotiEthers = await loadCotiEthersModule();
    const tokenContract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, signer);
    const allowanceRaw = await tokenContract.allowance(ownerAddress, TRADE_ESCROW_CONTRACT_ADDRESS).catch(() => null);
    const allowance = typeof allowanceRaw === 'bigint' ? allowanceRaw : 0n;
    if (allowance >= requiredAmount) {
      return;
    }

    const approveTx = await tokenContract.approve(TRADE_ESCROW_CONTRACT_ADDRESS, MAX_ERC20_APPROVAL);
    await approveTx.wait();
  };

  const ensureTradeFeeTokenAllowance = async (
    signer: Wallet | JsonRpcSigner,
    ownerAddress: string,
    requiredAmount: bigint
  ): Promise<void> => {
    if (requiredAmount <= 0n) {
      return;
    }

    const cotiEthers = await loadCotiEthersModule();
    const tradeContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, signer);
    const publicFeeTokenRaw = await tradeContract.publicFeeToken().catch(() => null);
    const publicFeeTokenAddress =
      typeof publicFeeTokenRaw === 'string' && isWalletAddress(publicFeeTokenRaw)
        ? publicFeeTokenRaw
        : REWARD_TOKEN_ADDRESS;
    await ensureTradeTokenAllowance(signer, ownerAddress, publicFeeTokenAddress, requiredAmount);
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
  loadMyNicknameFromChainRef.current = loadMyNicknameFromChain;

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
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true).catch(() => null);
        const contract = new cotiEthers.Contract(
          GROUP_CHAT_CONTRACT_ADDRESS,
          GROUP_CHAT_CONTRACT_ABI,
          signer
        );
        const activeJoinCodeHashesRaw: unknown[] = [];
        let activeJoinCodeOffset = 0;
        const activeJoinCodePageLimit = 128;
        const activeJoinCodePageMax = 256;
        for (let page = 0; page < activeJoinCodePageMax; page += 1) {
          const pageRaw = await contract
            .getActiveJoinCodeHashesPage(groupId, activeJoinCodeOffset, activeJoinCodePageLimit)
            .catch(() => null);
          if (!pageRaw) {
            break;
          }

          const pageHashesRaw =
            pageRaw && typeof pageRaw === 'object'
              ? (
                (pageRaw as { hashes?: unknown }).hashes ??
                (pageRaw as { 0?: unknown })[0]
              )
              : null;
          const nextOffsetRaw =
            pageRaw && typeof pageRaw === 'object'
              ? (
                (pageRaw as { nextOffset?: unknown }).nextOffset ??
                (pageRaw as { 1?: unknown })[1]
              )
              : null;

          if (Array.isArray(pageHashesRaw)) {
            activeJoinCodeHashesRaw.push(...pageHashesRaw);
          }

          const nextOffset = toSafeNumber(nextOffsetRaw);
          if (nextOffset <= activeJoinCodeOffset) {
            break;
          }
          activeJoinCodeOffset = nextOffset;
        }
        if (
          currentWalletKeyRef.current !== requestedWalletKey ||
          activeGroupIdRef.current !== groupId
        ) {
          return;
        }

        const activeJoinCodeHashes = activeJoinCodeHashesRaw;
        const activeCodeHashes: string[] = [];
        for (const codeHashRaw of activeJoinCodeHashes) {
          const normalizedCodeHash = String(codeHashRaw ?? '').trim().toLowerCase();
          if (!/^0x[a-f0-9]{64}$/.test(normalizedCodeHash)) {
            continue;
          }
          activeCodeHashes.push(normalizedCodeHash);
        }

        const nowTs = Math.floor(Date.now() / 1000);
        const nextActiveCodes: ActiveGroupJoinCode[] = [];
        const getJoinCodeForAdminFunction = contract.getFunction('getJoinCodeForAdmin');
        const groupContractInterface = new cotiEthers.Interface(GROUP_CHAT_CONTRACT_ABI);
        const signerProvider = (signer as { provider?: { call?: (tx: Record<string, unknown>) => Promise<string> } }).provider;
        const joinCodePattern = new RegExp(`^[${GROUP_JOIN_CODE_ALPHABET}]{4,12}$`);
        const normalizeDecryptedJoinCode = (value: unknown): string => {
          const normalized = String(value ?? '').replace(/\0/g, '').trim().toUpperCase();
          if (!normalized) {
            return '';
          }
          if (joinCodePattern.test(normalized)) {
            return normalized;
          }

          const separatorIndex = normalized.indexOf(':');
          if (separatorIndex > 0 && separatorIndex < normalized.length - 1) {
            const suffix = normalized.slice(separatorIndex + 1).trim();
            if (joinCodePattern.test(suffix)) {
              return suffix;
            }
          }

          return '';
        };
        const joinCodeCipherFromCreateTxCache = new Map<string, { value: bigint[] } | null>();
        const readJoinCodeCiphertextFromCreateTx = async (codeHash: string): Promise<{ value: bigint[] } | null> => {
          if (!readProvider?.getTransaction || joinCodeCipherFromCreateTxCache.has(codeHash)) {
            return joinCodeCipherFromCreateTxCache.get(codeHash) ?? null;
          }

          try {
            const createdLogs = await contract
              .queryFilter(contract.filters.GroupJoinCodeCreated(groupId, codeHash, null), 0, 'latest')
              .catch(() => []);
            if (!Array.isArray(createdLogs) || createdLogs.length === 0) {
              joinCodeCipherFromCreateTxCache.set(codeHash, null);
              return null;
            }

            let latestCreatedLog = createdLogs[0];
            for (const log of createdLogs) {
              if (
                log.blockNumber > latestCreatedLog.blockNumber ||
                (log.blockNumber === latestCreatedLog.blockNumber && log.index > latestCreatedLog.index)
              ) {
                latestCreatedLog = log;
              }
            }

            const creationTx = await readProvider.getTransaction(latestCreatedLog.transactionHash).catch(() => null);
            if (!creationTx?.data) {
              joinCodeCipherFromCreateTxCache.set(codeHash, null);
              return null;
            }

            const parsedCreationTx = groupContractInterface.parseTransaction({
              data: creationTx.data,
              value: creationTx.value ?? 0n
            });
            if (!parsedCreationTx || parsedCreationTx.name !== 'createJoinCode' || parsedCreationTx.args.length < 6) {
              joinCodeCipherFromCreateTxCache.set(codeHash, null);
              return null;
            }

            const encryptedCodeArg = parsedCreationTx.args[5] as unknown;
            const encryptedCiphertext =
              encryptedCodeArg && typeof encryptedCodeArg === 'object'
                ? (
                  (encryptedCodeArg as { ciphertext?: unknown }).ciphertext ??
                  (encryptedCodeArg as { 0?: unknown })[0]
                )
                : null;
            const encryptedCiphertextValuesRaw =
              encryptedCiphertext && typeof encryptedCiphertext === 'object'
                ? (
                  (encryptedCiphertext as { value?: unknown }).value ??
                  (encryptedCiphertext as { 0?: unknown })[0]
                )
                : null;
            if (!Array.isArray(encryptedCiphertextValuesRaw) || encryptedCiphertextValuesRaw.length === 0) {
              joinCodeCipherFromCreateTxCache.set(codeHash, null);
              return null;
            }

            const encryptedCiphertextValues = encryptedCiphertextValuesRaw.map((item) => BigInt(item));
            const nextCiphertext = { value: encryptedCiphertextValues };
            joinCodeCipherFromCreateTxCache.set(codeHash, nextCiphertext);
            return nextCiphertext;
          } catch {
            joinCodeCipherFromCreateTxCache.set(codeHash, null);
            return null;
          }
        };
        await Promise.all(
          activeCodeHashes.map(async (codeHash) => {
            const [joinCodeRaw, encryptedCodeRaw] = await Promise.all([
              contract.getJoinCode(groupId, codeHash).catch(() => null),
              (async () => {
                const directStaticCall = (contract as {
                  getJoinCodeForAdmin?: {
                    staticCall?: (targetGroupId: number, targetCodeHash: string) => Promise<unknown>;
                  };
                }).getJoinCodeForAdmin?.staticCall;
                if (directStaticCall) {
                  const directResult = await directStaticCall(groupId, codeHash).catch(() => null);
                  if (directResult) {
                    return directResult;
                  }
                }
                const fallbackResult = await getJoinCodeForAdminFunction.staticCall(groupId, codeHash).catch(() => null);
                if (fallbackResult) {
                  return fallbackResult;
                }

                if (!signerProvider?.call) {
                  return null;
                }
                const encodedCall = groupContractInterface.encodeFunctionData('getJoinCodeForAdmin', [groupId, codeHash]);
                const lowLevelRaw = await signerProvider
                  .call({
                    to: GROUP_CHAT_CONTRACT_ADDRESS,
                    from: requestedWalletAddress,
                    data: encodedCall
                  })
                  .catch(() => null);
                if (!lowLevelRaw || lowLevelRaw === '0x') {
                  return null;
                }
                const decoded = groupContractInterface.decodeFunctionResult('getJoinCodeForAdmin', lowLevelRaw);
                return decoded?.[0] ?? decoded;
              })()
            ]);
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

            let decryptedCode = '';
            const codeCiphertext = extractUserCiphertext(encryptedCodeRaw);
            if (codeCiphertext) {
              try {
                const decrypted = await signer.decryptValue(codeCiphertext as never);
                decryptedCode = normalizeDecryptedJoinCode(decrypted);
              } catch {
              }
            }
            if (!decryptedCode) {
              const fallbackCiphertext = await readJoinCodeCiphertextFromCreateTx(codeHash);
              if (fallbackCiphertext) {
                try {
                  const decrypted = await signer.decryptValue(fallbackCiphertext as never);
                  decryptedCode = normalizeDecryptedJoinCode(decrypted);
                } catch {
                }
              }
            }

            const creator = isWalletAddress(joinCodeState.creator) ? joinCodeState.creator : '';
            nextActiveCodes.push({
              groupId,
              codeHash,
              code: decryptedCode || undefined,
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
      const signerAddress = (await signer.getAddress()).trim();
      if (!isWalletAddress(signerAddress)) {
        setError('Signer address is invalid.');
        return;
      }
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
      const signerAddress = (await signer.getAddress()).trim();
      if (!isWalletAddress(signerAddress)) {
        setError('Signer address is invalid.');
        return;
      }
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

    const code = generateRandomGroupJoinCode();
    let expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    try {
      setProcessingGroupAction(true);
      const { signer, cacheKey } = await getMemoSigner();
      const signerAddress = (await signer.getAddress()).trim();
      if (!isWalletAddress(signerAddress)) {
        setError('Signer address is invalid.');
        return;
      }
      const cotiEthers = await loadCotiEthersModule();
      const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
      const normalizedCode = code.trim().toUpperCase();
      const codeHash = cotiEthers.keccak256(cotiEthers.toUtf8Bytes(normalizedCode));
      const codeSignerPrivateKey = cotiEthers.keccak256(
        cotiEthers.toUtf8Bytes(`${GROUP_JOIN_CODE_SIGNER_KEY_PREFIX}${normalizedCode}`)
      );
      const codeSigner = new cotiEthers.Wallet(codeSignerPrivateKey).address;
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

      const createJoinCodeSelector = new cotiEthers.Interface(GROUP_CHAT_CONTRACT_ABI).getFunction('createJoinCode')?.selector;
      if (!createJoinCodeSelector) {
        setError('Unable to resolve createJoinCode selector.');
        return;
      }
      const encryptedCodeMemo = await signer.encryptValue(
        normalizedCode,
        GROUP_CHAT_CONTRACT_ADDRESS,
        createJoinCodeSelector
      );
      const encryptedCodePayload = parseSubmitMemoPayload(encryptedCodeMemo);
      const encryptedCodeTuple = [[encryptedCodePayload.ciphertextValue], encryptedCodePayload.signature] as const;

      const tx = await contract.createJoinCode(
        activeGroupId,
        codeHash,
        codeSigner,
        ttlSeconds,
        maxUses,
        encryptedCodeTuple
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
        code: normalizedCode,
        expiresAt,
        inviter: isWalletAddress(inviterAddress) ? inviterAddress : undefined
      };
      setGeneratedGroupInviteCode(encodeGroupInviteCode(payload));
      setGeneratedGroupJoinCodeHash(codeHash);

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
      const signerAddress = (await signer.getAddress()).trim();
      if (!isWalletAddress(signerAddress)) {
        setError('Signer address is invalid.');
        return;
      }
      const normalizedCode = parsedJoinCode.code.trim().toUpperCase();
      if (!normalizedCode) {
        setError('Invalid group code.');
        return;
      }

      const codeHash = cotiEthers.keccak256(cotiEthers.toUtf8Bytes(normalizedCode));
      const codeSignerPrivateKey = cotiEthers.keccak256(
        cotiEthers.toUtf8Bytes(`${GROUP_JOIN_CODE_SIGNER_KEY_PREFIX}${normalizedCode}`)
      );
      const codeProofSigner = new cotiEthers.Wallet(codeSignerPrivateKey);
      const derivedCodeSigner = codeProofSigner.address.toLowerCase();
      const [isAlreadyMemberRaw, joinCodeRaw] = await Promise.all([
        contract.isMember(parsedJoinCode.groupId, signerAddress).catch(() => false),
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
      if (joinCodeState.signer && joinCodeState.signer.toLowerCase() !== derivedCodeSigner) {
        setError('This group code is invalid. Ask for a fresh code from the admin.');
        return;
      }

      const signatureDeadline = nowTs + GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS;
      const proofDomainHash = cotiEthers.keccak256(
        cotiEthers.toUtf8Bytes(GROUP_JOIN_CODE_PROOF_DOMAIN)
      );
      const proofDigest = cotiEthers.keccak256(
        cotiEthers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'uint256', 'address', 'uint256', 'bytes32', 'address', 'uint64'],
          [
            proofDomainHash,
            BigInt(chainId ?? COTI_NETWORK.chainIdDecimal),
            GROUP_CHAT_CONTRACT_ADDRESS,
            BigInt(parsedJoinCode.groupId),
            codeHash,
            signerAddress,
            BigInt(signatureDeadline)
          ]
        )
      );
      const proofSignature = await codeProofSigner.signMessage(cotiEthers.getBytes(proofDigest));

      const tx = await contract.joinWithCode(
        parsedJoinCode.groupId,
        codeHash,
        signatureDeadline,
        proofSignature
      );
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
        replyingToMessage?.txHash,
        replyingToMessage?.blockNumber,
        replyingToMessage?.logIndex,
        true
      );
      const encodedMemo = encodeMemoForActiveSigner(plainTextWithReply);
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
                txHash: submittedTxHash || undefined
              }
            : message
        )
      }));

      const receipt = await tx.wait();
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
    const cotiEthers = await loadCotiEthersModule();
    const selector = await resolveSubmitSelector();
    const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
    const requiredFee = await resolveRequiredFeeForSend();
    const hiddenAliasPayload = buildMessageWithContactNamePayload('', normalizedContactName);
    const encodedMemo = encodeMemoForActiveSigner(hiddenAliasPayload);
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
    const cotiEthers = await loadCotiEthersModule();
    const selector = await resolveSubmitSelector();
    const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
    const requiredFee = await resolveRequiredFeeForSend();
    const normalizedVisibleNotice = visibleNotice.replace(/\r?\n/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
    const hiddenStatePayload = buildMessageWithConversationStatePayload(normalizedVisibleNotice, normalizedState);
    const encodedMemo = encodeMemoForActiveSigner(hiddenStatePayload);
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
        const cotiEthers = await loadCotiEthersModule();
        const selector = await resolveGroupSubmitSelector();
        const contract = new cotiEthers.Contract(GROUP_CHAT_CONTRACT_ADDRESS, GROUP_CHAT_CONTRACT_ABI, signer);
        const paymentMode = groupFeeModeSelection === 'token' ? 1 : 0;
        const requiredFee = paymentMode === 0 ? await resolveRequiredFeeForGroupSend() : 0n;
        if (paymentMode === 1) {
          const requiredTokenFee = await resolveRequiredTokenFeeForGroupSend();
          await ensureGroupTokenFeeAllowance(signer, requestedWalletAddress, requiredTokenFee);
        }
        const encodedMemo = encodeMemoForActiveSigner(reactionMemoText);
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
                txHash: submittedTxHash || undefined
              }
              : message
          )
        }));

        const receipt = await tx.wait();
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
        const cotiEthers = await loadCotiEthersModule();
        const selector = await resolveSubmitSelector();
        const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
        const requiredFee = await resolveRequiredFeeForSend();
        const encodedMemo = encodeMemoForActiveSigner(reactionMemoText);
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
                txHash: submittedTxHash || undefined
              }
              : message
          )
        }));

        const receipt = await tx.wait();
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
      const cotiEthers = await loadCotiEthersModule();
      const selector = await resolveSubmitSelector();
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const requiredFee = await resolveRequiredFeeForSend();
      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyTarget?.txHash,
        replyTarget?.blockNumber,
        replyTarget?.logIndex,
        false
      );
      const sendEncryptedMemo = async (textToSend: string): Promise<{ txHash: string; wait: () => Promise<unknown> }> => {
        const encodedMemo = encodeMemoForActiveSigner(textToSend);
        const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
        const submitMemoPayload = parseSubmitMemoPayload(encryptedMemo);
        const memoTuple = [[submitMemoPayload.ciphertextValue], submitMemoPayload.signature] as const;
        const tx = await contract.submit(contactAddress, memoTuple, { value: requiredFee });
        return {
          txHash: typeof tx?.hash === 'string' ? tx.hash : '',
          wait: () => tx.wait()
        };
      };

      const submittedTx = await sendEncryptedMemo(plainTextWithReply);
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
      const cotiEthers = await loadCotiEthersModule();
      const tradeContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, signer);
      const interfaceInstance = new cotiEthers.Interface(TRADE_ESCROW_CONTRACT_ABI);
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

        const closeParentTx = isParentMaker
          ? await tradeContract.cancelTrade(pendingCounterContext.offer.tradeId)
          : await tradeContract.declineTrade(pendingCounterContext.offer.tradeId);
        const closeParentReceipt = await closeParentTx.wait();
        if (
          !closeParentReceipt ||
          Number((closeParentReceipt as { status?: number | bigint }).status ?? 0) !== 1
        ) {
          throw new Error('Failed to close the original trade before sending your counter offer.');
        }

        setTradeSnapshotsById((previous) => ({
          ...previous,
          [String(pendingCounterContext.offer.tradeId)]: {
            ...(previous[String(pendingCounterContext.offer.tradeId)] ?? parentSnapshot),
            status: isParentMaker ? 'cancelled' : 'declined'
          }
        }));
        setTradeCounterContext(null);

        const counterOnboardInfo = signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], counterOnboardInfo)
        }));
      }

      if (selectedTradeOfferToken.kind !== 'native' && selectedTradeOfferToken.tokenAddress) {
        await ensureTradeTokenAllowance(
          signer,
          requestedWalletAddress,
          selectedTradeOfferToken.tokenAddress,
          parsedTradeOfferAmountWei,
          selectedTradeOfferToken.kind
        );
      }

      if (tradeFeeModeSelection === 'token') {
        await ensureTradeFeeTokenAllowance(signer, requestedWalletAddress, tokenFeeAmount);
      }

      const offerAssetTuple = [
        resolveTradeAssetTypeValue(selectedTradeOfferToken.kind),
        selectedTradeOfferToken.tokenAddress ?? '0x0000000000000000000000000000000000000000',
        parsedTradeOfferAmountWei
      ] as const;
      const requestAssetTuple = [
        resolveTradeAssetTypeValue(selectedTradeRequestToken.kind),
        selectedTradeRequestToken.tokenAddress ?? '0x0000000000000000000000000000000000000000',
        parsedTradeRequestAmountWei
      ] as const;
      const expiresAt = Math.floor(Date.now() / 1000) + parsedTradeExpiryHours * 3600;
      const valueToSend =
        (selectedTradeOfferToken.kind === 'native' ? parsedTradeOfferAmountWei : 0n) + nativeFeeWei;
      const createTx = await tradeContract.createTrade(
        offerAssetTuple,
        requestAssetTuple,
        activeContact,
        expiresAt,
        tradeFeeModeSelection === 'coti' ? 0 : 1,
        { value: valueToSend }
      );
      const createReceipt = await createTx.wait();
      if (!createReceipt || Number((createReceipt as { status?: number | bigint }).status ?? 0) !== 1) {
        throw new Error('Trade creation failed on-chain.');
      }

      let tradeId = 0;
      for (const log of (createReceipt as { logs?: unknown[] }).logs ?? []) {
        try {
          const parsedLog = interfaceInstance.parseLog(log as never);
          if (parsedLog?.name === 'TradeOpened') {
            tradeId = toSafeNumber(parsedLog.args?.tradeId ?? parsedLog.args?.[0]);
            break;
          }
        } catch {
        }
      }
      if (tradeId <= 0) {
        const nextTradeIdRaw = await tradeContract.nextTradeId().catch(() => null);
        if (typeof nextTradeIdRaw === 'bigint' && nextTradeIdRaw > 0n) {
          tradeId = Number(nextTradeIdRaw - 1n);
        }
      }
      if (tradeId <= 0) {
        throw new Error('Trade was created, but the trade id could not be resolved.');
      }

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
      const cotiEthers = await loadCotiEthersModule();
      const tradeContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, signer);
      const requestAmountWei = BigInt(requestAsset.amount);

      if (requestAsset.kind !== 'native' && requestAsset.tokenAddress) {
        await ensureTradeTokenAllowance(signer, walletAddress, requestAsset.tokenAddress, requestAmountWei, requestAsset.kind);
      }

      const acceptTx = await tradeContract.acceptTrade(offer.tradeId, {
        value: requestAsset.kind === 'native' ? requestAmountWei : 0n
      });
      const acceptReceipt = await acceptTx.wait();
      if (!acceptReceipt || Number((acceptReceipt as { status?: number | bigint }).status ?? 0) !== 1) {
        throw new Error('Trade acceptance failed on-chain.');
      }

      setTradeSnapshotsById((previous) => ({
        ...previous,
        [String(offer.tradeId)]: {
          ...(previous[String(offer.tradeId)] ?? snapshot),
          status: 'accepted'
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
      const cotiEthers = await loadCotiEthersModule();
      const tradeContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, signer);
      const declineTx = await tradeContract.declineTrade(offer.tradeId);
      const declineReceipt = await declineTx.wait();
      if (!declineReceipt || Number((declineReceipt as { status?: number | bigint }).status ?? 0) !== 1) {
        throw new Error('Trade refusal failed on-chain.');
      }

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
      const cotiEthers = await loadCotiEthersModule();
      const tradeContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, signer);
      const cancelTx = await tradeContract.cancelTrade(offer.tradeId);
      const cancelReceipt = await cancelTx.wait();
      if (!cancelReceipt || Number((cancelReceipt as { status?: number | bigint }).status ?? 0) !== 1) {
        throw new Error('Trade cancellation failed on-chain.');
      }

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

  const renderGroupGeneratedInviteCode = () => {
    if (!generatedGroupInviteCode) {
      return null;
    }

    const generatedCodeCopyKey = `group-code:${generatedGroupInviteCode}`;
    return (
      <div className="group-generated-code-stack">
        <div className="group-generated-code group-generated-code-compact">
          <input className="group-generated-code-value" value={generatedGroupInviteCode} readOnly aria-label="Generated join code" />
          <button
            type="button"
            className={lastCopiedKey === generatedCodeCopyKey ? 'contact group-generated-code-copy copied' : 'contact group-generated-code-copy'}
            onClick={() => {
              copyWithFeedback(generatedGroupInviteCode, generatedCodeCopyKey).catch(() => {});
            }}
          >
            {lastCopiedKey === generatedCodeCopyKey ? 'Copied' : 'Copy code'}
          </button>
        </div>
        <button
          type="button"
          className="contact group-generated-code-revoke-btn"
          onClick={() => {
            revokeGeneratedJoinCodeForActiveGroup().catch(() => {});
          }}
          disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin || !generatedGroupJoinCodeHash}
        >
          {processingGroupAction ? 'Working...' : 'Revoke code'}
        </button>
      </div>
    );
  };

  const renderGroupInviteMembersPanel = () => (
    <form
      className="group-header-invite group-header-invite-compact"
      onSubmit={(event) => {
        event.preventDefault();
        inviteMembersToActiveGroup().catch(() => {});
      }}
    >
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
            value={groupInviteTtlInput}
            onChange={(event) => setGroupInviteTtlInput(event.target.value.replace(/[^\d]/g, ''))}
            className="group-header-invite-ttl"
            placeholder="8"
            aria-label="Invite and join code timeout in hours"
            disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}
          />
        </div>
        <button className="group-header-primary-btn" type="submit" disabled={processingGroupAction || !hasAesReady || !canInviteToActiveGroup}>
          {processingGroupAction ? 'Sending...' : 'Invite'}
        </button>
      </div>
    </form>
  );

  const renderGroupJoinCodePanel = (mobile = false) => {
    const modeInputName = mobile ? 'group-join-code-mode-mobile' : 'group-join-code-mode-desktop';
    return (
      <div className="group-invite-code-panel">
        <div className="group-join-code-settings group-join-code-settings-compact">
          <div className="group-join-code-header">
            <span className="group-join-code-label">Join code</span>
            <span className="group-join-code-helper">
              {groupJoinCodeMode === 'single' ? 'One join per code.' : 'Reusable code with max uses.'}
            </span>
          </div>
          <div className="group-join-code-main">
            <div className="group-join-code-main-left">
              <div className="group-join-code-mode">
                <label className={groupJoinCodeMode === 'single' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'}>
                  <input
                    type="radio"
                    name={modeInputName}
                    checked={groupJoinCodeMode === 'single'}
                    onChange={() => setGroupJoinCodeMode('single')}
                    disabled={processingGroupAction || !hasAesReady || !isActiveGroupAdmin}
                  />
                  Single-use
                </label>
                <label className={groupJoinCodeMode === 'multi' ? 'group-join-code-mode-option active' : 'group-join-code-mode-option'}>
                  <input
                    type="radio"
                    name={modeInputName}
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
              {processingGroupAction ? 'Working...' : 'Create code'}
            </button>
          </div>
        </div>
        {renderGroupGeneratedInviteCode()}
      </div>
    );
  };

  const renderGroupInviteMenu = (mobile = false) => {
    const menuClassName = mobile ? 'group-invite-menu group-invite-menu-mobile' : 'group-invite-menu';
    return (
      <details
        className={menuClassName}
        key={`group-invite-menu:${mobile ? 'mobile' : 'desktop'}:${activeGroupId ?? 'none'}:${walletAddress.trim().toLowerCase()}`}
      >
        <summary>Invite</summary>
        <div className="group-invite-menu-panel">
          {canManageActiveGroupJoinCodes ? (
            <>
              <div className="group-invite-menu-switch" role="tablist" aria-label="Group invite options">
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupInviteMenuView === 'invite'}
                  className={groupInviteMenuView === 'invite' ? 'group-invite-menu-switch-btn active' : 'group-invite-menu-switch-btn'}
                  onClick={() => setGroupInviteMenuView('invite')}
                >
                  Invite
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupInviteMenuView === 'code'}
                  className={groupInviteMenuView === 'code' ? 'group-invite-menu-switch-btn active' : 'group-invite-menu-switch-btn'}
                  onClick={() => setGroupInviteMenuView('code')}
                >
                  Invite code
                </button>
              </div>
              {groupInviteMenuView === 'invite' ? renderGroupInviteMembersPanel() : renderGroupJoinCodePanel(mobile)}
            </>
          ) : (
            renderGroupInviteMembersPanel()
          )}
        </div>
      </details>
    );
  };

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
                    <div className="group-active-code-value" title={copyValue}>
                      {copyValue}
                    </div>
                    <button
                      type="button"
                      className={
                        lastCopiedKey === copyKey
                          ? 'contact group-generated-code-copy copied'
                          : 'contact group-generated-code-copy'
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
  const renderGroupRenameForm = () => (
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
      <button type="submit" className="contact" disabled={processingGroupAction || !canSubmitGroupRename}>
        {processingGroupAction ? 'Saving...' : 'Save'}
      </button>
      <button type="button" className="contact" onClick={cancelRenameActiveGroup} disabled={processingGroupAction}>
        Cancel
      </button>
    </form>
  );
  const mobileGroupActions = isActiveGroupAdmin ? (
    <>
      {groupRenameOpen ? (
        renderGroupRenameForm()
      ) : (
        <button type="button" className="contact" onClick={beginRenameActiveGroup} disabled={processingGroupAction}>
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
  );
  const desktopGroupActions = (
    <>
      {mobileGroupActions}
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
    </>
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
  const tradeComposerContent = (
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
  );

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
            desktopJoinCodeList={!isMobileNav && canManageActiveGroupJoinCodes ? renderActiveJoinCodeList(false) : null}
            desktopInviteMenu={renderGroupInviteMenu(false)}
            mobileInviteTools={
              <>
                {renderGroupInviteMenu(true)}
                {canManageActiveGroupJoinCodes ? renderActiveJoinCodeList(true) : null}
              </>
            }
            desktopGroupActions={desktopGroupActions}
            mobileGroupActions={mobileGroupActions}
            isMobileNav={isMobileNav}
            syncingGroups={syncingGroups}
            mobileGroupOptionsOpen={mobileGroupOptionsOpen}
            onToggleMobileGroupOptions={() => setMobileGroupOptionsOpen((previous) => !previous)}
            onRefreshGroup={() => {
              syncGroupData({ deep: true }).catch(() => {});
            }}
            chatMessagesRef={chatMessagesRef}
            activeGroupMessages={activeGroupMessages}
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
            chatMessagesRef={chatMessagesRef}
            markConversationAsRead={markConversationAsRead}
            loadingOlderHistory={loadingOlderHistory}
            activeMessages={activeMessages}
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
      </main>

      </div>

      <MobileBottomNav
        activeMobileView={activeMobileView}
        isConnected={isConnected}
        onSelectView={setActiveMobileView}
      />

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

