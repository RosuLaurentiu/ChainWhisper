import type { BrowserProvider, OnboardInfo } from '@coti-io/coti-ethers';
import { unzlibSync, zlibSync } from 'fflate';

declare global {
  interface Window {
    ethereum?: InjectedEthereumProvider;
  }
}

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  connect?: () => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
};

export type InjectedEthereumProvider = Eip1193Provider & {
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isFrame?: boolean;
  isPhantom?: boolean;
  isBackpack?: boolean;
  isOKXWallet?: boolean;
  isTally?: boolean;
  providers?: InjectedEthereumProvider[];
};

export type InjectedWalletOption = {
  id: string;
  label: string;
  provider: InjectedEthereumProvider;
};

export type Contact = {
  address: string;
  name?: string;
  muted?: boolean;
  hidden?: boolean;
};

export type ConversationPreferenceState = {
  muted?: boolean;
  hidden?: boolean;
};

export type ChatMessage = {
  id: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  senderAddress?: string;
  isSystem?: boolean;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
  reactionToTxHash?: string;
  reactionToBlockNumber?: number;
  reactionToLogIndex?: number;
  reactionEmoji?: string;
  timestamp?: number;
  blockNumber?: number;
  logIndex?: number;
  txHash?: string;
  deliveryState?: 'pending' | 'sent' | 'failed';
};

export type HistoryEntry = {
  id: string;
  contact: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
  reactionToTxHash?: string;
  reactionToBlockNumber?: number;
  reactionToLogIndex?: number;
  reactionEmoji?: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp?: number;
};

export type ConversationLog = {
  blockNumber: number;
  index: number;
  transactionHash: string;
  args?: Record<string, unknown>;
};

export type ConversationBlockRange = {
  firstBlock: number;
  lastBlock: number;
};

export type RecentPeerMeta = {
  address: string;
  lastBlock: number;
  lastTime: number;
};

export type GroupSummary = {
  id: number;
  admin: string;
  title: string;
  isPrivate: boolean;
  createdAt: number;
  memberCount: number;
  members: string[];
  lastBlock: number;
  lastTimestamp: number;
};

export type GroupInvite = {
  groupId: number;
  inviter: string;
  expiresAt: number;
  expired: boolean;
  title?: string;
  admin?: string;
  isPrivate?: boolean;
};

export type ActiveGroupJoinCode = {
  groupId: number;
  codeHash: string;
  code?: string;
  creator: string;
  expiresAt: number;
  usesLeft: number;
};

export type LegacyGroupInviteCodePayload = {
  version: 1;
  groupId: number;
  expiresAt: number;
  inviter?: string;
};

export type GroupJoinCodePayload = {
  version: 2;
  groupId: number;
  code: string;
  expiresAt: number;
  inviter?: string;
};

export type GroupInviteCodePayload = LegacyGroupInviteCodePayload | GroupJoinCodePayload;

export type GroupMessageEntry = {
  id: string;
  groupId: number;
  direction: 'incoming' | 'outgoing';
  text: string;
  senderAddress?: string;
  isSystem?: boolean;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
  reactionToTxHash?: string;
  reactionToBlockNumber?: number;
  reactionToLogIndex?: number;
  reactionEmoji?: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp?: number;
};

export type GroupFeeModeSelection = 'coti' | 'token';
export type SwapDirection = 'shield' | 'unshield';
export type SwapFeeModeSelection = 'token' | 'coti';

export const BURNER_WALLET_STORAGE_KEY = 'coti-chat-burner-wallet';
export const BURNER_WALLET_STORAGE_PROBE_KEY = 'coti-chat-burner-wallet-probe';
export const BURNER_WALLET_STORAGE_VERSION = 2;
export const BURNER_WALLET_VAULT_VERSION = 1;
export const BURNER_PIN_MIN_LENGTH = 5;
export const LEGACY_BURNER_PIN_MIN_LENGTH = 4;
export const BURNER_PIN_PBKDF2_ITERATIONS = 250000;
export const AUTO_SYNC_INTERVAL_MS = 30000;
export const WS_HEALTHCHECK_TTL_MS = 12000;
export const WS_RETRY_COOLDOWN_MS = 15000;
export const REALTIME_SYNC_DEBOUNCE_MS = 250;
export const REALTIME_SYNC_BURST_THROTTLE_MS = 1500;
export const REALTIME_SYNC_FALLBACK_INTERVAL_MS = 5000;
export const READ_STATE_BACKUP_DEBOUNCE_MS = 2500;
export const READ_STATE_BACKUP_MIN_INTERVAL_MS = 45000;
export const INITIAL_SYNC_LOOKBACK_BLOCKS = 2500;
export const HISTORY_PAGINATION_BLOCK_WINDOW = 10000;
export const SELF_BACKUP_RESTORE_BLOCK_WINDOW = 20000;
export const FAST_CONTACT_PREVIEW_BATCH_SIZE = 8;
export const FAST_CONTACT_PREVIEW_BLOCK_LOOKBACK = 24;
export const AUTO_STATE_BACKUP_BLOCK_DISTANCE = 18000;
export const AUTO_STATE_BACKUP_RETRY_BLOCKS = 3000;
export const GROUP_SUBMIT_GAS_BUFFER = 700_000n;
export const GROUP_SUBMIT_GAS_LIMIT_MAX = 8_000_000n;
export const DEFAULT_GROUP_JOIN_CODE_MAX_USES = 1;
export const DEFAULT_GROUP_JOIN_CODE_MULTI_USES = 10;
export const BURNER_ONBOARD_TIMEOUT_MS = 45000;
export const DEFAULT_NICKNAME_MAX_BYTES = 42;
export const NICKNAME_DELIMITER = '\u001f';
export const REPLY_DELIMITER = '\u001e';
export const PROFILE_METADATA_PREFIX = '\u2063';
export const REPLY_METADATA_PREFIX = '\u2064';
export const CONTACT_NAME_METADATA_PREFIX = '\u2065';
export const REACTION_METADATA_PREFIX = '\u2066';
export const CONVERSATION_STATE_METADATA_PREFIX = '\u2062';
export const LEGACY_CONVERSATION_STATE_METADATA_PREFIX = '\u2067';
export const CONVERSATION_STATE_METADATA_PREFIXES = [
  CONVERSATION_STATE_METADATA_PREFIX,
  LEGACY_CONVERSATION_STATE_METADATA_PREFIX
] as const;
export const CONTACT_NAME_ENCODING_ZERO = '\u200b';
export const CONTACT_NAME_ENCODING_ONE = '\u200c';
export const LEGACY_PROFILE_METADATA_PREFIX = '[nick:';
export const LEGACY_REPLY_METADATA_PREFIX = '[reply:';
export const LEGACY_PROFILE_PREFIX = '[[coti-profile:v1]]';
export const LEGACY_PROFILE_PLAIN_PREFIX = '[[coti-nick:v1]]';
export const IMAGE_MESSAGE_PREFIX = '[[coti-image:v1]]';
export const TIP_NOTICE_PREFIX = '[[coti-tip:v1]]';
export const TRADE_OFFER_MESSAGE_PREFIX = '[[coti-trade-offer:v1]]';
export const TRADE_RESPONSE_MESSAGE_PREFIX = '[[coti-trade-response:v1]]';
export const STATE_BACKUP_PREFIX = '[[coti-state:v1]]';
export const STATE_BACKUP_COMPRESSED_PREFIX = 'z:';
export const READ_CURSOR_PREFIX = '[[coti-read:v1]]';
export const STATE_BACKUP_VERSION = 1;
export const MAX_REPLY_PREVIEW_LENGTH = 28;
export const MAX_MESSAGE_LENGTH = 2000;
export const COPY_FEEDBACK_DURATION_MS = 1400;
export const GROUP_REMOVAL_NOTICE_AUTO_DISMISS_MS = 9000;
export const COTI_WEI = 10n ** 18n;
export const MIN_BURNER_TOP_UP_WEI = 1_000_000_000_000_000n;
export const TEXT_ENCODER = new TextEncoder();
export const TEXT_DECODER = new TextDecoder();
const MEMO_RAW_PREFIX = '[[coti-memo-raw:v1]]';
const MEMO_COMPRESSED_PREFIX = '[[coti-memo-z:v1]]';
export const REPLY_METADATA_PREFIX_REGEX = new RegExp(REPLY_METADATA_PREFIX, 'g');
const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });

const isAsciiOnly = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) {
      return false;
    }
  }
  return true;
};

const repairUtf8MojibakeSegments = (value: string): string => {
  let repaired = '';
  let changed = false;
  let index = 0;

  while (index < value.length) {
    const nextCodeUnit = value.charCodeAt(index);
    if (nextCodeUnit > 0xff) {
      repaired += value[index];
      index += 1;
      continue;
    }

    let rawSegment = '';
    const rawBytes: number[] = [];
    while (index < value.length) {
      const segmentCodeUnit = value.charCodeAt(index);
      if (segmentCodeUnit > 0xff) {
        break;
      }
      rawSegment += value[index];
      rawBytes.push(segmentCodeUnit);
      index += 1;
    }

    if (rawBytes.some((byte) => byte >= 0x80)) {
      try {
        const repairedSegment = UTF8_FATAL_DECODER.decode(new Uint8Array(rawBytes));
        if (repairedSegment && repairedSegment !== rawSegment) {
          repaired += repairedSegment;
          changed = true;
          continue;
        }
      } catch {
      }
    }

    repaired += rawSegment;
  }

  return changed ? repaired : value;
};
export const EXTERNAL_REPLY_TXHASH_REGEX = /^\[r:(0x[a-fA-F0-9]{64})\]\s*/;
export const DEFAULT_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🫡', '🤯', '🌭', '✍️', '🤷‍♂️', '🤪', '💯'] as const;
export const REACTION_HIDDEN_NIBBLE_SYMBOLS = [
  '\uFE00',
  '\uFE01',
  '\uFE02',
  '\uFE03',
  '\uFE04',
  '\uFE05',
  '\uFE06',
  '\uFE07',
  '\uFE08',
  '\uFE09',
  '\uFE0A',
  '\uFE0B',
  '\uFE0C',
  '\uFE0D',
  '\uFE0E',
  '\uFE0F'
] as const;
export const REACTION_HIDDEN_NIBBLE_LOOKUP = new Map<string, number>(
  REACTION_HIDDEN_NIBBLE_SYMBOLS.map((symbol, index) => [symbol, index] as const)
);
export const debugLog = (...args: unknown[]): void => {
  if (import.meta.env.DEV) {
    console.debug(...args);
  }
};

export type BurnerWalletRecord = {
  id?: string;
  address?: string;
  name?: string;
  privateKey: string;
  mnemonic?: string;
};

export type BurnerWalletVault = {
  version: number;
  wallets: BurnerWalletRecord[];
  activeWalletId: string;
};

export type EncryptedBurnerWalletRecord = {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
};

export type LegacyBurnerWalletVaultRecord = {
  wallets: BurnerWalletRecord[];
  activeWalletId?: string;
};

export type BurnerWalletStorageState =
  | { kind: 'none' }
  | { kind: 'legacy'; record: BurnerWalletRecord }
  | { kind: 'legacy-vault'; record: LegacyBurnerWalletVaultRecord }
  | { kind: 'encrypted'; record: EncryptedBurnerWalletRecord };

export type BurnerInitMode = 'generate' | 'import' | 'stored';
export type SignerSource = 'burner' | 'metamask';
export type BurnerPinMode = 'set' | 'unlock';
export type BurnerInitResult = 'connected' | 'needs-funding' | 'imported' | 'failed';
export type SensitiveAction = 'reveal-backup';
export type MobileView = 'wallets' | 'contacts' | 'chat';
export type TipTokenSelection = 'coti' | 'wisp' | 'pwisp';
export type TradeAssetKind = 'native' | 'erc20' | 'private-erc20';
export type TradeFeeModeSelection = 'coti' | 'token';
export type TradeMessageAction = 'accepted' | 'declined' | 'cancelled' | 'countered';
export type TradeOnChainStatus = 'open' | 'accepted' | 'cancelled' | 'declined' | 'expired' | 'unknown';

export type TradeAssetPayload = {
  kind: TradeAssetKind;
  tokenAddress?: string;
  symbol: string;
  decimals: number;
  amount: string;
  custom?: boolean;
};

export type TradeOfferMessagePayload = {
  version: 1 | 2;
  tradeId: number;
  escrowContract: string;
  maker: string;
  taker: string;
  offer?: TradeAssetPayload;
  request?: TradeAssetPayload;
  createdAt: number;
  expiresAt: number;
  parentTradeId?: number;
};

export type TradeResponseMessagePayload = {
  version: 1;
  tradeId: number;
  action: TradeMessageAction;
  actor: string;
  createdAt: number;
  counterTradeId?: number;
};

export type TradeSnapshot = {
  tradeId: number;
  maker: string;
  taker: string;
  offer: TradeAssetPayload;
  request: TradeAssetPayload;
  createdAt: number;
  expiresAt: number;
  status: TradeOnChainStatus;
};

export type PendingBurnerInit = {
  mode: BurnerInitMode;
  seedOrPrivateKey?: string;
  walletId?: string;
};

export type SyncConversationOptions = {
  deep?: boolean;
  contactsOnly?: boolean;
  previewPerContact?: boolean;
  updateHead?: boolean;
  lookbackBlocks?: number;
  background?: boolean;
  fromBlock?: number;
  toBlock?: number;
};

export type SyncGroupOptions = {
  deep?: boolean;
  background?: boolean;
  overviewOnly?: boolean;
};

export type StateBackupPayload = {
  version: number;
  updatedAt: number;
  lastReadAllTs?: number;
  // Legacy fields kept optional for backward compatibility while parsing old backups.
  nickname?: string;
  contacts?: Contact[];
  readState?: BackupReadStateEntry[];
  unreadContacts?: string[];
};

export type ReadCursorPayload = {
  peer: string;
  lastReadTs: number;
  lastReadBlock?: number;
};

export type BackupReadStateEntry = {
  address: string;
  lastReadTs: number;
};

export type BackupLocalStateOptions = {
  force?: boolean;
  background?: boolean;
};

export type SubmitMemoPayload = {
  ciphertextValue: bigint[];
  signature: string[];
};

export type MessageReactionPayload = {
  targetTxHash?: string;
  targetBlockNumber?: number;
  targetLogIndex?: number;
  emoji: string;
};

export const COTI_NETWORK = {
  chainIdHex: '0x282b34',
  chainIdDecimal: 2632500,
  chainName: 'COTI',
  rpcUrl: 'https://mainnet.coti.io/rpc',
  wsUrl: 'wss://mainnet.coti.io/ws',
  nativeCurrency: {
    name: 'COTI',
    symbol: 'COTI',
    decimals: 18
  },
  blockExplorerUrl: 'https://mainnet.cotiscan.io'
};
export const TIP_NATIVE_TOKEN_SYMBOL = COTI_NETWORK.nativeCurrency.symbol;
export const TIP_NATIVE_TOKEN_DECIMALS = COTI_NETWORK.nativeCurrency.decimals;

export const CHAT_CONTRACT_ADDRESS = '0xF4cab1599aafBBB68677682354B7c1760bCF6c48';
export const GROUP_ADMIN_BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';
export const REWARD_TOKEN_ADDRESS = '0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8';
export const PRIVATE_REWARD_TOKEN_ADDRESS = '0x922B39AC9FD4ccb5E5a9de0694C8189DC2D214E8';
export const SWAP_VAULT_CONTRACT_ADDRESS = '0x5C35CD3659991051F4Fb04F2C4120643739b7BdE';
export const FALLBACK_REWARD_TOKEN_SYMBOL = 'TOKEN';
export const FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL = 'PTOKEN';
export const FALLBACK_REWARD_TOKEN_DECIMALS = 6;
export const PRIVATE_TOKEN_MAX_PLAINTEXT_BALANCE = (1n << 64n) - 1n;
export const MAX_ERC20_APPROVAL = (1n << 256n) - 1n;
export const CHAT_CONTRACT_ABI = [
  'function submit(address recipient, ((uint256[] value), bytes[] signature) memo) payable',
  'function setMyNickname(string name)',
  'function nicknames(address account) view returns (string)',
  'function getConversationBlockRange(address me, address peer) view returns (uint256 firstBlock, uint256 lastBlock)',
  'function getFirstBlockForConversation(address me, address peer) view returns (uint256)',
  'function getLastBlockForConversation(address me, address peer) view returns (uint256)',
  'function getRecentPeers(address user) view returns (address[100])',
  'function getRecentPeersWithMeta(address user) view returns (address[100] peers, uint256[100] lastBlocks, uint256[100] lastTimes)',
  'function maxRecentPeers() view returns (uint256)',
  'function getLastMessageTime(address me, address peer) view returns (uint256)',
  'function NICKNAME_MAX_BYTES() view returns (uint256)',
  'function feeAmount() view returns (uint256)',
  'event NicknameSet(address indexed user, string nickname)',
  'event MessageSubmitted(address indexed recipient, address indexed from, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForRecipient, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForSender)'
] as const;

export const GROUP_CHAT_CONTRACT_ADDRESS = '0xE175ec590CE13FB6349f1CAd8b7e9D5d21eaa32b';
export const GROUP_CHAT_CONTRACT_ABI = [
  'error AlreadyGroupMember()',
  'error GroupPaused()',
  'error GroupTooLarge()',
  'error InsufficientFee()',
  'error InvalidAddress()',
  'error InvalidGroup()',
  'error InvalidGroupTitle()',
  'error NotGroupMember()',
  'error OnlyGroupAdmin()',
  'error InvalidJoinCode()',
  'error JoinCodeExhausted()',
  'error JoinCodeExpired()',
  'error JoinCodeNotFound()',
  'error JoinCodeProofExpired()',
  'error InvalidJoinCodeProof()',
  'function feeAmount() view returns (uint256)',
  'function tokenFeeAmount() view returns (uint256)',
  'function publicFeeToken() view returns (address)',
  'function privateFeeToken() view returns (address)',
  'function rewardsContract() view returns (address)',
  'function rewardsPaused() view returns (bool)',
  'function INVITE_TTL_DEFAULT() view returns (uint64)',
  'function INVITE_TTL_MAX() view returns (uint64)',
  'function JOIN_CODE_TTL_MAX() view returns (uint64)',
  'function JOIN_CODE_MAX_USES() view returns (uint32)',
  'function nextGroupId() view returns (uint256)',
  'function createGroup(string title, address[] initialMembers) returns (uint256 groupId)',
  'function addMembers(uint256 groupId, address[] accounts)',
  'function inviteMembers(uint256 groupId, address[] accounts, uint64 inviteTtlSeconds)',
  'function createJoinCode(uint256 groupId, bytes32 codeHash, address codeSigner, uint64 ttlSeconds, uint32 maxUses, ((uint256[] value), bytes[] signature) encryptedCode)',
  'function getJoinCode(uint256 groupId, bytes32 codeHash) view returns (bool active, address creator, address signer, uint64 expiresAt, uint32 usesLeft, bool expired)',
  'function getJoinCodeForAdmin(uint256 groupId, bytes32 codeHash) returns (((uint256[] value) ciphertext, (uint256[] value) userCiphertext) codeForAdmin)',
  'function getActiveJoinCodeHashesPage(uint256 groupId, uint256 offset, uint256 limit) view returns (bytes32[] hashes, uint256 nextOffset)',
  'function joinWithCode(uint256 groupId, bytes32 codeHash, uint64 signatureDeadline, bytes signature)',
  'function revokeJoinCode(uint256 groupId, bytes32 codeHash)',
  'function acceptInvite(uint256 groupId)',
  'function declineInvite(uint256 groupId)',
  'function setGroupAdmin(uint256 groupId, address newAdmin)',
  'function setGroupTitle(uint256 groupId, string nextTitle)',
  'function leaveGroup(uint256 groupId)',
  'function disbandGroup(uint256 groupId)',
  'function removeMember(uint256 groupId, address account)',
  'function getInvite(uint256 groupId, address account) view returns (bool pending, address inviter, uint64 expiresAt, bool expired)',
  'function getGroupInfo(uint256 groupId) view returns (address admin, uint64 createdAt, uint32 memberCount, string title, uint256 lastBlock, uint256 lastTimestamp)',
  'function lastMessageBlockForGroup(uint256 groupId) view returns (uint256)',
  'function getGroupMembers(uint256 groupId) view returns (address[])',
  'function getGroupsForMemberPage(address account, uint256 cursor, uint256 limit) view returns (uint256[] groupIds, uint256 nextCursor)',
  'function isMember(uint256 groupId, address account) view returns (bool)',
  'function submitGroupMessage(uint256 groupId, ((uint256[] value), bytes[] signature) encryptedMessage) payable',
  'function submitGroupMessageWithMode(uint256 groupId, ((uint256[] value), bytes[] signature) encryptedMessage, uint8 paymentMode) payable',
  'event GroupCreated(uint256 indexed groupId, address indexed admin, string title)',
  'event GroupMemberAdded(uint256 indexed groupId, address indexed account)',
  'event GroupMemberRemoved(uint256 indexed groupId, address indexed account)',
  'event GroupMemberLeft(uint256 indexed groupId, address indexed account)',
  'event GroupInviteCreated(uint256 indexed groupId, address indexed account, address indexed inviter, uint64 expiresAt)',
  'event GroupInviteAccepted(uint256 indexed groupId, address indexed account, address indexed inviter)',
  'event GroupInviteDeclined(uint256 indexed groupId, address indexed account, address indexed inviter)',
  'event GroupInviteRevoked(uint256 indexed groupId, address indexed account, address indexed revokedBy)',
  'event GroupJoinCodeCreated(uint256 indexed groupId, bytes32 indexed codeHash, address indexed creator, address signer, uint64 expiresAt, uint32 usesLeft)',
  'event GroupJoinCodeRevoked(uint256 indexed groupId, bytes32 indexed codeHash, address indexed revokedBy)',
  'event GroupJoinedWithCode(uint256 indexed groupId, address indexed account, bytes32 indexed codeHash, address creator)',
  'event GroupMessageSubmitted(uint256 indexed groupId, address indexed from, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForSender, uint256 valueSent, uint256 feeTaken)',
  'event GroupMessageDelivered(uint256 indexed groupId, address indexed from, address indexed recipient, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForRecipient)'
] as const;

export const TRADE_ESCROW_CONTRACT_ADDRESS = '0x57D00e9B8689bDA8E1BD0524bE05d0869D20F899';
export const TRADE_ESCROW_CONTRACT_ABI = [
  'function feeRecipient() view returns (address)',
  'function feeAmount() view returns (uint256)',
  'function tokenFeeAmount() view returns (uint256)',
  'function publicFeeToken() view returns (address)',
  'function privateFeeToken() view returns (address)',
  'function nextTradeId() view returns (uint256)',
  'function createTrade((uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, address taker, uint64 expiresAt, uint8 feeMode) payable returns (uint256 tradeId)',
  'function acceptTrade(uint256 tradeId) payable',
  'function cancelTrade(uint256 tradeId)',
  'function declineTrade(uint256 tradeId)',
  'function getTrade(uint256 tradeId) view returns (address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt)',
  'event TradeOpened(uint256 indexed tradeId, address indexed maker, address indexed taker, uint8 offerAssetType, address offerToken, uint256 offerAmount, uint8 requestAssetType, address requestToken, uint256 requestAmount, uint64 createdAt, uint64 expiresAt)',
  'event TradeAccepted(uint256 indexed tradeId, address indexed taker)',
  'event TradeCancelled(uint256 indexed tradeId, address indexed maker)',
  'event TradeDeclined(uint256 indexed tradeId, address indexed taker)'
] as const;

export const ERC20_TOKEN_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)'
] as const;

export const PRIVATE_TOKEN_BALANCE_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function balanceOf() returns (uint256)'
] as const;

export const PRIVATE_ERC20_TOKEN_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function balanceOf() returns (uint256)',
  'function allowance(address account, bool isSpender) returns (uint256)',
  'function approve(address spender, (uint256 ciphertext, bytes signature) value) returns (bool)',
  'function transfer(address to, (uint256 ciphertext, bytes signature) value) returns (uint256)'
] as const;

export const SWAP_VAULT_CONTRACT_ABI = [
  'function shieldWithMode(uint256 amount, uint8 paymentMode) payable',
  'function unshieldWithMode(uint256 amount, uint8 paymentMode) payable',
  'function swapFeeWei() view returns (uint256)',
  'function getTokenFeeAmount() view returns (uint256)',
  'event SwapFeePaid(address indexed payer, address indexed receiver, uint8 indexed method, uint256 amount)'
] as const;

export const WHISPER_REWARDS_ABI = [
  'function rewardInteraction(address user)',
  'function paused() view returns (bool)',
  'function allowedInteractionContracts(address) view returns (bool)',
  'function publicRewardAmount() view returns (uint64)',
  'function privateRewardAmount() view returns (uint64)'
] as const;

export const GROUP_JOIN_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0x569d6b43': 'You are already a member of this group.',
  '0xc377608f': 'Group actions are currently paused on-chain. Try again later.',
  '0x6ebf9e18': 'This group has reached its member limit.',
  '0x5b5c465a': 'The invite or join-code TTL is above the contract limit.',
  '0xcecadadb': 'Join code max uses exceeds the contract limit.',
  '0xdb140e40': 'This group no longer exists.',
  '0x873c1c39': 'Invalid group code format.',
  '0x5c47db1b': 'This group code has no remaining uses.',
  '0x6763c1d5': 'This group code has expired.',
  '0x7fb3f362': 'This group code is no longer active. Ask for a new code.'
};
export const GROUP_CREATE_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0x0e03abe4': 'Group title is too long after encryption. Use a shorter title and try again.'
};
export const GROUP_ACTION_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0x569d6b43': 'That wallet is already a member of this group.',
  '0xc377608f': 'Group actions are currently paused on-chain. Try again later.',
  '0x6ebf9e18': 'This group has reached its member limit.',
  '0x025dbdd4': 'Insufficient group fee. In token mode, ensure you have PWISP or approve WISP.',
  '0x5b5c465a': 'The invite or join-code TTL is above the contract limit.',
  '0xcecadadb': 'Join code max uses exceeds the contract limit.',
  '0xe6c4247b': 'Invalid wallet address.',
  '0x25114f49': 'Only the group admin can perform this action.',
  '0x27ce6509': 'You are not a member of this group.',
  '0xdb140e40': 'This group no longer exists.',
  '0x0e03abe4': 'Group title is too long after encryption. Use a shorter title and try again.'
};

export type CotiEthersModule = typeof import('@coti-io/coti-ethers');
export type CotiWsProvider = InstanceType<CotiEthersModule['WebSocketProvider']>;
export type CotiHttpProvider = InstanceType<CotiEthersModule['JsonRpcProvider']>;
export type CotiReadProvider = CotiWsProvider | CotiHttpProvider;
let cotiEthersModulePromise: Promise<CotiEthersModule> | null = null;
let cotiWsProviderPromise: Promise<CotiWsProvider> | null = null;
let cotiHttpProviderPromise: Promise<CotiHttpProvider> | null = null;
let cotiWsLastHealthyAt = 0;
let cotiWsBackoffUntil = 0;

export const getCotiWsLastHealthyAt = (): number => cotiWsLastHealthyAt;
export const markCotiWsHealthyNow = (): void => {
  cotiWsLastHealthyAt = Date.now();
};

export const loadCotiEthersModule = (): Promise<CotiEthersModule> => {
  if (!cotiEthersModulePromise) {
    cotiEthersModulePromise = import('@coti-io/coti-ethers');
  }

  return cotiEthersModulePromise;
};

export const loadCotiWsProvider = async (): Promise<CotiWsProvider> => {
  if (!cotiWsProviderPromise) {
    cotiWsProviderPromise = loadCotiEthersModule().then((cotiEthers) =>
      new cotiEthers.WebSocketProvider(COTI_NETWORK.wsUrl, {
        name: COTI_NETWORK.chainName,
        chainId: COTI_NETWORK.chainIdDecimal
      })
    );
  }

  return cotiWsProviderPromise;
};

export const loadCotiHttpProvider = async (): Promise<CotiHttpProvider> => {
  if (!cotiHttpProviderPromise) {
    cotiHttpProviderPromise = loadCotiEthersModule().then(
      (cotiEthers) =>
        new cotiEthers.JsonRpcProvider(COTI_NETWORK.rpcUrl, {
          name: COTI_NETWORK.chainName,
          chainId: COTI_NETWORK.chainIdDecimal
        })
    );
  }

  return cotiHttpProviderPromise;
};

export const resetCotiWsProvider = async (): Promise<void> => {
  if (!cotiWsProviderPromise) {
    return;
  }

  try {
    const wsProvider = await cotiWsProviderPromise;
    const providerWithDestroy = wsProvider as unknown as { destroy?: () => void };
    providerWithDestroy.destroy?.();
  } catch {
  } finally {
    cotiWsProviderPromise = null;
  }
};

export const loadCotiReadProvider = async (preferWebSocket = true): Promise<CotiReadProvider> => {
  if (preferWebSocket) {
    const now = Date.now();
    if (now < cotiWsBackoffUntil) {
      return loadCotiHttpProvider();
    }

    try {
      const wsProvider = await loadCotiWsProvider();
      if (now - cotiWsLastHealthyAt > WS_HEALTHCHECK_TTL_MS) {
        await wsProvider.getBlockNumber();
      }
      cotiWsLastHealthyAt = Date.now();
      return wsProvider;
    } catch {
      cotiWsLastHealthyAt = 0;
      cotiWsBackoffUntil = Date.now() + WS_RETRY_COOLDOWN_MS;
      await resetCotiWsProvider();
    }
  }

  return loadCotiHttpProvider();
};

export const shortenAddress = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`;
export const GROUP_JOIN_CODE_PREFIX = 'coti-group-code-v2:';
export const LEGACY_GROUP_INVITE_CODE_PREFIX = 'coti-group-code-v1:';
export const GROUP_TITLE_METADATA_PREFIX = '[[coti-group:v1]]';
export const GROUP_TITLE_COMPACT_PREFIX = 'cg3:';
export const GROUP_TITLE_ENCRYPTION_VERSION = 3;
export const GROUP_TITLE_KEY_MATERIAL = 'chainwhisper-group-title-aes-v1';
export const GROUP_JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GROUP_JOIN_CODE_LENGTH = 5;
export const GROUP_JOIN_CODE_SIGNER_KEY_PREFIX = 'coti-group-join-key-v1:';
export const GROUP_JOIN_CODE_PROOF_DOMAIN = 'COTI_GROUP_JOIN_CODE_PROOF_V1';
export const GROUP_JOIN_CODE_SIGNATURE_WINDOW_SECONDS = 15 * 60;
export const encodeBase64Url = (value: string): string =>
  btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
export const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(`${normalized}${padding}`);
};
export const encodeBase64UrlBytes = (value: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return encodeBase64Url(binary);
};
export const decodeBase64UrlBytes = (value: string): Uint8Array => {
  const binary = decodeBase64Url(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};
let groupTitleCryptoKeyPromise: Promise<CryptoKey | null> | null = null;
export const loadGroupTitleCryptoKey = (): Promise<CryptoKey | null> => {
  if (!groupTitleCryptoKeyPromise) {
    groupTitleCryptoKeyPromise = (async () => {
      if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
        return null;
      }
      const keySeed = TEXT_ENCODER.encode(GROUP_TITLE_KEY_MATERIAL);
      const keyDigest = await crypto.subtle.digest('SHA-256', keySeed);
      return crypto.subtle.importKey(
        'raw',
        keyDigest,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    })().catch(() => null);
  }
  return groupTitleCryptoKeyPromise;
};
export const encryptGroupTitle = async (plainTitle: string): Promise<{ iv: string; ciphertext: string } | null> => {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    return null;
  }
  const key = await loadGroupTitleCryptoKey();
  if (!key) {
    return null;
  }

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const plainBytes = new Uint8Array(TEXT_ENCODER.encode(plainTitle));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBytes
  );
  return {
    iv: encodeBase64UrlBytes(iv),
    ciphertext: encodeBase64UrlBytes(new Uint8Array(encryptedBuffer))
  };
};
export const decryptGroupTitle = async (ivRaw: string, ciphertextRaw: string): Promise<string | null> => {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
    return null;
  }
  const key = await loadGroupTitleCryptoKey();
  if (!key) {
    return null;
  }

  try {
    const iv = decodeBase64UrlBytes(ivRaw);
    const ciphertext = decodeBase64UrlBytes(ciphertextRaw);
    if (iv.length !== 12 || ciphertext.length === 0) {
      return null;
    }
    const ivBytes = new Uint8Array(iv.length);
    ivBytes.set(iv);
    const ciphertextBytes = new Uint8Array(ciphertext.length);
    ciphertextBytes.set(ciphertext);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      ciphertextBytes
    );
    return normalizeContactName(TEXT_DECODER.decode(new Uint8Array(decryptedBuffer))) ?? null;
  } catch {
    return null;
  }
};
export const generateRandomGroupJoinCode = (): string => {
  const values = new Uint8Array(GROUP_JOIN_CODE_LENGTH);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 256);
    }
  }

  let compactCode = '';
  for (let index = 0; index < values.length; index += 1) {
    compactCode += GROUP_JOIN_CODE_ALPHABET[values[index] % GROUP_JOIN_CODE_ALPHABET.length];
  }

  return compactCode.slice(0, GROUP_JOIN_CODE_LENGTH);
};
export const encodeGroupInviteCode = (payload: GroupInviteCodePayload): string => {
  if (payload.version === 2) {
    return `${payload.groupId}:${payload.code}`;
  }
  const serialized = JSON.stringify(payload);
  return `${GROUP_JOIN_CODE_PREFIX}${encodeBase64Url(serialized)}`;
};
export const parseGroupInviteCode = (input: string): GroupInviteCodePayload | null => {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  try {
    const encodedPayload = raw.startsWith(GROUP_JOIN_CODE_PREFIX)
      ? raw.slice(GROUP_JOIN_CODE_PREFIX.length)
      : raw.startsWith(LEGACY_GROUP_INVITE_CODE_PREFIX)
        ? raw.slice(LEGACY_GROUP_INVITE_CODE_PREFIX.length)
        : raw;
    if (!encodedPayload) {
      return null;
    }

    const decoded = decodeBase64Url(encodedPayload);
    const parsed = JSON.parse(decoded) as {
      version?: unknown;
      groupId?: unknown;
      code?: unknown;
      expiresAt?: unknown;
      inviter?: unknown;
    };
    const version = Number(parsed.version);
    const groupId = Number(parsed.groupId);
    const expiresAtRaw = Number(parsed.expiresAt);
    const expiresAt = Number.isFinite(expiresAtRaw) && expiresAtRaw > 0 ? Math.floor(expiresAtRaw) : 0;
    const inviter = typeof parsed.inviter === 'string' ? parsed.inviter.trim() : undefined;
    if (version === 2) {
      const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
      if (!Number.isFinite(groupId) || groupId <= 0 || !code) {
        return null;
      }

      return {
        version: 2,
        groupId: Math.floor(groupId),
        code,
        expiresAt,
        inviter: inviter && isWalletAddress(inviter) ? inviter : undefined
      };
    }

    if (version === 1 && Number.isFinite(groupId) && groupId > 0 && expiresAt > 0) {
      return {
        version: 1,
        groupId: Math.floor(groupId),
        expiresAt,
        inviter: inviter && isWalletAddress(inviter) ? inviter : undefined
      };
    }
  } catch {
  }

  const delimiterIndex = raw.indexOf(':');
  if (delimiterIndex <= 0 || delimiterIndex >= raw.length - 1) {
    return null;
  }

  const groupId = Number(raw.slice(0, delimiterIndex).trim());
  const code = raw.slice(delimiterIndex + 1).trim();
  if (!Number.isFinite(groupId) || groupId <= 0 || !code) {
    return null;
  }

  return {
    version: 2,
    groupId: Math.floor(groupId),
    code,
    expiresAt: 0
  };
};

export const parseGroupJoinCodeFromPayload = (payload: GroupInviteCodePayload): GroupJoinCodePayload | null => {
  if (payload.version === 2) {
    return {
      version: 2,
      groupId: payload.groupId,
      code: payload.code,
      expiresAt: payload.expiresAt,
      inviter: payload.inviter
    };
  }

  return null;
};
export const encodeStoredGroupTitle = async (title: string, isPrivate: boolean): Promise<string> => {
  const normalizedTitle = normalizeContactName(title);
  if (!normalizedTitle) {
    return '';
  }

  const encryptedPayload = await encryptGroupTitle(normalizedTitle);
  if (!encryptedPayload) {
    throw new Error('Group title encryption is unavailable in this browser.');
  }

  const visibilityFlag = isPrivate ? 'p' : 'u';
  return `${GROUP_TITLE_COMPACT_PREFIX}${visibilityFlag}:${encryptedPayload.iv}:${encryptedPayload.ciphertext}`;
};
export const parseStoredGroupTitle = async (rawTitle: string, groupId?: number): Promise<{ title: string; isPrivate: boolean }> => {
  const normalizedRawTitle = normalizeContactName(rawTitle);
  const fallbackTitle =
    typeof groupId === 'number' && Number.isFinite(groupId) && groupId > 0 ? `Group ${Math.floor(groupId)}` : 'Group';
  const privateFallbackTitle = 'Private group';
  if (!normalizedRawTitle) {
    return {
      title: fallbackTitle,
      isPrivate: false
    };
  }

  if (normalizedRawTitle.startsWith(GROUP_TITLE_COMPACT_PREFIX)) {
    const compactPayload = normalizedRawTitle.slice(GROUP_TITLE_COMPACT_PREFIX.length).trim();
    const firstSeparatorIndex = compactPayload.indexOf(':');
    const secondSeparatorIndex =
      firstSeparatorIndex >= 0 ? compactPayload.indexOf(':', firstSeparatorIndex + 1) : -1;
    const visibilityFlag = firstSeparatorIndex > 0 ? compactPayload.slice(0, firstSeparatorIndex) : '';
    const ivRaw =
      firstSeparatorIndex >= 0 && secondSeparatorIndex > firstSeparatorIndex
        ? compactPayload.slice(firstSeparatorIndex + 1, secondSeparatorIndex)
        : '';
    const ciphertextRaw =
      secondSeparatorIndex >= 0 ? compactPayload.slice(secondSeparatorIndex + 1).trim() : '';
    const isPrivate = visibilityFlag === 'p';
    if (ivRaw && ciphertextRaw) {
      const decryptedTitle = await decryptGroupTitle(ivRaw, ciphertextRaw);
      if (decryptedTitle) {
        return {
          title: decryptedTitle,
          isPrivate
        };
      }
    }
    return {
      title: isPrivate ? privateFallbackTitle : fallbackTitle,
      isPrivate
    };
  }

  if (!normalizedRawTitle.startsWith(GROUP_TITLE_METADATA_PREFIX)) {
    return {
      title: normalizedRawTitle,
      isPrivate: false
    };
  }

  const encodedPayload = normalizedRawTitle.slice(GROUP_TITLE_METADATA_PREFIX.length).trim();
  if (!encodedPayload) {
    return {
      title: fallbackTitle,
      isPrivate: false
    };
  }

  try {
    const decodedPayload = decodeBase64Url(encodedPayload);
    const parsedPayload = JSON.parse(decodedPayload) as {
      version?: unknown;
      title?: unknown;
      private?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
    };
    const isPrivate = Boolean(parsedPayload.private);
    const version = Number(parsedPayload.version);
    const ivRaw = typeof parsedPayload.iv === 'string' ? parsedPayload.iv : '';
    const ciphertextRaw = typeof parsedPayload.ciphertext === 'string' ? parsedPayload.ciphertext : '';
    if (
      version === GROUP_TITLE_ENCRYPTION_VERSION &&
      ivRaw.length > 0 &&
      ciphertextRaw.length > 0
    ) {
      const decryptedTitle = await decryptGroupTitle(ivRaw, ciphertextRaw);
      if (decryptedTitle) {
        return {
          title: decryptedTitle,
          isPrivate
        };
      }
      return {
        title: isPrivate ? privateFallbackTitle : fallbackTitle,
        isPrivate
      };
    }

    const parsedTitle = typeof parsedPayload.title === 'string' ? normalizeContactName(parsedPayload.title) : undefined;
    if (parsedTitle) {
      return {
        title: parsedTitle,
        isPrivate
      };
    }

    return {
      title: isPrivate ? privateFallbackTitle : fallbackTitle,
      isPrivate
    };
  } catch {
    const legacyTitle = normalizeContactName(encodedPayload);
    if (legacyTitle) {
      return {
        title: legacyTitle,
        isPrivate: true
      };
    }

    return {
      title: fallbackTitle,
      isPrivate: false
    };
  }
};
export const formatGroupMembershipEventText = (
  event: 'added' | 'removed' | 'left',
  account?: string
): string => {
  const normalizedAddress = String(account ?? '').trim();
  const memberLabel = isWalletAddress(normalizedAddress) ? shortenAddress(normalizedAddress) : 'A member';
  if (event === 'added') {
    return `[GROUP] ${memberLabel} joined the group.`;
  }
  if (event === 'removed') {
    return `[GROUP] ${memberLabel} was removed from the group.`;
  }
  return `[GROUP] ${memberLabel} left the group.`;
};

export const isWalletAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value.trim());
export const isShortAddress = (value: string): boolean => /^0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}$/.test(value.trim());
export const parseWalletAddressListInput = (value: string): string[] => {
  const seen = new Set<string>();
  const parsed: string[] = [];
  const chunks = value
    .split(/[\s,;\n\r]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  for (const chunk of chunks) {
    if (!isWalletAddress(chunk)) {
      continue;
    }
    const key = chunk.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    parsed.push(chunk);
  }

  return parsed;
};
export const normalizeContactName = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const normalizeChainId = (chainId: string | number): number => {
  if (typeof chainId === 'number') return chainId;
  return chainId.startsWith('0x') ? parseInt(chainId, 16) : Number(chainId);
};

const getInjectedWalletProviderId = (provider: InjectedEthereumProvider): string => {
  if (provider.isRabby) {
    return 'rabby';
  }
  if (provider.isCoinbaseWallet) {
    return 'coinbase-wallet';
  }
  if (provider.isTrust || provider.isTrustWallet) {
    return 'trust-wallet';
  }
  if (provider.isFrame) {
    return 'frame';
  }
  if (provider.isPhantom) {
    return 'phantom';
  }
  if (provider.isBackpack) {
    return 'backpack';
  }
  if (provider.isOKXWallet) {
    return 'okx-wallet';
  }
  if (provider.isTally) {
    return 'tally';
  }
  if (provider.isMetaMask && provider.isBraveWallet) {
    return 'brave-wallet';
  }
  if (provider.isMetaMask) {
    return 'metamask';
  }
  return 'browser-wallet';
};

export const getInjectedWalletLabel = (provider: InjectedEthereumProvider): string => {
  if (provider.isRabby) {
    return 'Rabby';
  }
  if (provider.isCoinbaseWallet) {
    return 'Coinbase Wallet';
  }
  if (provider.isTrust || provider.isTrustWallet) {
    return 'Trust Wallet';
  }
  if (provider.isFrame) {
    return 'Frame';
  }
  if (provider.isPhantom) {
    return 'Phantom';
  }
  if (provider.isBackpack) {
    return 'Backpack';
  }
  if (provider.isOKXWallet) {
    return 'OKX Wallet';
  }
  if (provider.isTally) {
    return 'Taho';
  }
  if (provider.isMetaMask && provider.isBraveWallet) {
    return 'Brave Wallet';
  }
  if (provider.isMetaMask) {
    return 'MetaMask';
  }
  return 'Browser Wallet';
};

export const getInjectedWalletOptions = (): InjectedWalletOption[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  const injected = window.ethereum;
  if (!injected) {
    return [];
  }

  const candidates =
    Array.isArray(injected.providers) && injected.providers.length > 0 ? injected.providers : [injected];
  const uniqueProviders: InjectedEthereumProvider[] = [];
  const seenProviders = new Set<InjectedEthereumProvider>();

  for (const candidate of candidates) {
    if (!candidate || seenProviders.has(candidate)) {
      continue;
    }
    seenProviders.add(candidate);
    uniqueProviders.push(candidate);
  }

  const optionCounts = new Map<string, number>();
  return uniqueProviders.map((provider) => {
    const baseId = getInjectedWalletProviderId(provider);
    const duplicateCount = optionCounts.get(baseId) ?? 0;
    optionCounts.set(baseId, duplicateCount + 1);
    const label = getInjectedWalletLabel(provider);
    const suffix = duplicateCount > 0 ? ` ${duplicateCount + 1}` : '';

    return {
      id: duplicateCount > 0 ? `${baseId}-${duplicateCount + 1}` : baseId,
      label: `${label}${suffix}`,
      provider
    };
  });
};

export const getDefaultInjectedWalletOption = (): InjectedWalletOption | null => {
  const options = getInjectedWalletOptions();
  if (options.length === 0) {
    return null;
  }

  return options.find((option) => option.provider.isMetaMask && !option.provider.isBraveWallet) ?? options[0];
};

export const getInjectedWalletProvider = (walletId: string): InjectedEthereumProvider | null => {
  if (!walletId) {
    return null;
  }

  return getInjectedWalletOptions().find((option) => option.id === walletId)?.provider ?? null;
};

export const getMetaMaskProvider = (): InjectedEthereumProvider | null => {
  const walletOptions = getInjectedWalletOptions();
  return (
    walletOptions.find((option) => option.provider.isMetaMask && !option.provider.isBraveWallet)?.provider ??
    walletOptions.find((option) => option.provider.isMetaMask)?.provider ??
    null
  );
};

export const getProviderErrorMessage = (error: unknown, fallbackMessage: string): string => {
  const rawMessage = error instanceof Error ? error.message : '';
  const normalized = rawMessage.toLowerCase();
  const codeCandidate = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const code = typeof codeCandidate === 'number' ? codeCandidate : null;

  if (code === -32002 || normalized.includes('already pending')) {
    return 'A wallet request is already pending. Open your wallet and approve or reject it first.';
  }

  if (code === 4001) {
    return 'The wallet request was rejected.';
  }

  return rawMessage || fallbackMessage;
};
export const isProviderActionRejected = (error: unknown): boolean => {
  const codeCandidate = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (codeCandidate === 4001 || codeCandidate === 'ACTION_REJECTED') {
    return true;
  }

  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = rawMessage.toLowerCase();
  return normalized.includes('user rejected') || normalized.includes('action rejected') || normalized.includes('denied');
};
export const isHexDataString = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 10 && value.length % 2 === 0 && /^0x[a-fA-F0-9]+$/.test(value);

export const pickLikelyRevertData = (values: string[]): string | null => {
  const valid = values.filter((value) => isHexDataString(value));
  if (valid.length === 0) {
    return null;
  }

  valid.sort((left, right) => left.length - right.length);
  return valid[0] ?? null;
};

export const extractRevertData = (error: unknown): string | null => {
  const candidates: string[] = [];
  const pushCandidate = (value: unknown): void => {
    if (typeof value === 'string') {
      candidates.push(value);
    }
  };

  if (typeof error === 'object' && error !== null) {
    const errorObject = error as {
      data?: unknown;
      revert?: unknown;
      error?: unknown;
      info?: unknown;
      cause?: unknown;
    };

    pushCandidate(errorObject.data);

    if (typeof errorObject.revert === 'object' && errorObject.revert !== null) {
      pushCandidate((errorObject.revert as { data?: unknown }).data);
    }

    if (typeof errorObject.error === 'object' && errorObject.error !== null) {
      pushCandidate((errorObject.error as { data?: unknown }).data);
    }

    if (typeof errorObject.info === 'object' && errorObject.info !== null) {
      const infoObject = errorObject.info as { data?: unknown; error?: unknown };
      pushCandidate(infoObject.data);
      if (typeof infoObject.error === 'object' && infoObject.error !== null) {
        pushCandidate((infoObject.error as { data?: unknown }).data);
      }
    }

    if (typeof errorObject.cause === 'object' && errorObject.cause !== null) {
      pushCandidate((errorObject.cause as { data?: unknown }).data);
    }
  }

  const dataFromObject = pickLikelyRevertData(candidates);
  if (dataFromObject) {
    return dataFromObject.toLowerCase();
  }

  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!rawMessage) {
    return null;
  }

  const dataAttributeMatch = rawMessage.match(/\bdata="(0x[a-fA-F0-9]+)"/);
  if (dataAttributeMatch?.[1] && isHexDataString(dataAttributeMatch[1])) {
    return dataAttributeMatch[1].toLowerCase();
  }

  const inlineHexValues = rawMessage.match(/0x[a-fA-F0-9]{8,}/g) ?? [];
  const dataFromMessage = pickLikelyRevertData(inlineHexValues);
  return dataFromMessage ? dataFromMessage.toLowerCase() : null;
};

export const getGroupJoinErrorMessage = (error: unknown, fallbackMessage: string): string => {
  const revertData = extractRevertData(error);
  if (revertData) {
    const selector = revertData.slice(0, 10).toLowerCase();
    const mappedMessage = GROUP_JOIN_ERROR_MESSAGE_BY_SELECTOR[selector];
    if (mappedMessage) {
      return mappedMessage;
    }
  }

  const providerMessage = getProviderErrorMessage(error, fallbackMessage);
  const normalizedProviderMessage = providerMessage.toLowerCase();
  if (normalizedProviderMessage.includes('unknown custom error') || normalizedProviderMessage.includes('execution reverted')) {
    return fallbackMessage;
  }

  return providerMessage;
};

export const getGroupCreateErrorMessage = (error: unknown, fallbackMessage: string): string => {
  const revertData = extractRevertData(error);
  if (revertData) {
    const selector = revertData.slice(0, 10).toLowerCase();
    const mappedMessage = GROUP_CREATE_ERROR_MESSAGE_BY_SELECTOR[selector];
    if (mappedMessage) {
      return mappedMessage;
    }
  }

  const providerMessage = getProviderErrorMessage(error, fallbackMessage);
  const normalizedProviderMessage = providerMessage.toLowerCase();
  if (normalizedProviderMessage.includes('unknown custom error') || normalizedProviderMessage.includes('execution reverted')) {
    return fallbackMessage;
  }

  return providerMessage;
};
export const getGroupActionErrorMessage = (error: unknown, fallbackMessage: string): string => {
  const revertData = extractRevertData(error);
  if (revertData) {
    const selector = revertData.slice(0, 10).toLowerCase();
    const mappedMessage = GROUP_ACTION_ERROR_MESSAGE_BY_SELECTOR[selector];
    if (mappedMessage) {
      return mappedMessage;
    }
  }

  const providerMessage = getProviderErrorMessage(error, fallbackMessage);
  const normalizedProviderMessage = providerMessage.toLowerCase();
  if (normalizedProviderMessage.includes('unknown custom error') || normalizedProviderMessage.includes('execution reverted')) {
    return fallbackMessage;
  }

  return providerMessage;
};

export const createCotiBrowserProvider = async (ethereum: Eip1193Provider): Promise<BrowserProvider> => {
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.BrowserProvider(ethereum, {
    name: COTI_NETWORK.chainName,
    chainId: COTI_NETWORK.chainIdDecimal
  });
};

export const mergeOnboardInfo = (previous?: OnboardInfo, next?: OnboardInfo): OnboardInfo => ({
  aesKey: next?.aesKey ?? previous?.aesKey,
  rsaKey: next?.rsaKey ?? previous?.rsaKey,
  txHash: next?.txHash ?? previous?.txHash
});

export const encodeMemoPlaintext = (plain: string): string => {
  const bytes = TEXT_ENCODER.encode(plain);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
};

const bytesToBase64 = (value: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const encodeCompactMemoPlaintext = (plain: string): string => {
  const candidates = [encodeMemoPlaintext(plain)];

  if (isAsciiOnly(plain)) {
    candidates.push(`${MEMO_RAW_PREFIX}${plain}`);
  }

  try {
    const compressedBytes = zlibSync(TEXT_ENCODER.encode(plain), { level: 9 });
    candidates.push(`${MEMO_COMPRESSED_PREFIX}${bytesToBase64(compressedBytes)}`);
  } catch {
  }

  let shortest = candidates[0];
  for (const candidate of candidates) {
    if (candidate.length < shortest.length) {
      shortest = candidate;
    }
  }
  return shortest;
};

export const decodeMemoPlaintext = (raw: string): string => {
  if (raw.startsWith(MEMO_RAW_PREFIX)) {
    return repairUtf8MojibakeSegments(raw.slice(MEMO_RAW_PREFIX.length));
  }

  if (raw.startsWith(MEMO_COMPRESSED_PREFIX)) {
    try {
      const encodedCompressed = raw.slice(MEMO_COMPRESSED_PREFIX.length);
      const compressedBytes = base64ToBytes(encodedCompressed);
      const inflatedBytes = unzlibSync(compressedBytes);
      return TEXT_DECODER.decode(inflatedBytes);
    } catch {
      return raw;
    }
  }

  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return TEXT_DECODER.decode(bytes);
  } catch {
    return raw;
  }
};

export const formatMessageTimestamp = (timestamp?: number): string => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '';
  }

  return new Date(timestamp * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const calculateTopUpAmount = (requiredFee: bigint, multiplier: number): bigint => {
  const safeMultiplier = Math.max(0, Math.floor(multiplier));
  return requiredFee > 0n ? requiredFee * BigInt(safeMultiplier) : MIN_BURNER_TOP_UP_WEI * BigInt(safeMultiplier);
};

export const formatCotiAmount = (weiAmount: bigint): string => {
  const whole = weiAmount / COTI_WEI;
  const fraction = (weiAmount % COTI_WEI).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
};

export const normalizeTokenDecimals = (decimals: number): number =>
  Math.max(0, Math.min(30, Number.isFinite(decimals) ? Math.floor(decimals) : 0));

export const formatTokenAmount = (amount: bigint, decimals: number, precision = 6): string => {
  const safeDecimals = normalizeTokenDecimals(decimals);
  if (safeDecimals === 0) {
    return amount.toString();
  }

  const base = 10n ** BigInt(safeDecimals);
  const whole = amount / base;
  const maxPrecision = Math.max(0, Math.min(18, Math.floor(precision)));
  const fractionDigits = Math.min(safeDecimals, maxPrecision);
  if (fractionDigits === 0) {
    return whole.toString();
  }

  const fraction = (amount % base)
    .toString()
    .padStart(safeDecimals, '0')
    .slice(0, fractionDigits)
    .replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
};

export const parseTokenAmountInput = (raw: string, decimals: number): bigint | null => {
  const normalized = raw.trim();
  if (!normalized || normalized === '.') {
    return null;
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  const safeDecimals = normalizeTokenDecimals(decimals);
  const [wholeChunk, fractionChunk = ''] = normalized.split('.');
  if (fractionChunk.length > safeDecimals) {
    return null;
  }

  try {
    const whole = BigInt(wholeChunk);
    const scale = 10n ** BigInt(safeDecimals);
    const paddedFraction = `${fractionChunk}${'0'.repeat(safeDecimals)}`.slice(0, safeDecimals);
    const fraction = safeDecimals > 0 ? BigInt(paddedFraction || '0') : 0n;
    return whole * scale + fraction;
  } catch {
    return null;
  }
};

export const sanitizeTokenAmountInput = (raw: string): string => {
  const normalized = raw.replace(/[^0-9.]/g, '');
  if (!normalized) {
    return '';
  }

  const prefixed = normalized.startsWith('.') ? `0${normalized}` : normalized;
  const separatorIndex = prefixed.indexOf('.');
  if (separatorIndex < 0) {
    return prefixed;
  }

  const wholeChunk = prefixed.slice(0, separatorIndex);
  const fractionChunk = prefixed.slice(separatorIndex + 1).replace(/\./g, '');
  return `${wholeChunk}.${fractionChunk}`;
};

export const parseTipNoticePayload = (text: string): { tipAmountWei: bigint; messageCount: number } | null => {
  if (!text.startsWith(TIP_NOTICE_PREFIX)) {
    return null;
  }

  const raw = text.slice(TIP_NOTICE_PREFIX.length).trim();
  const separatorIndex = raw.indexOf('|');
  if (separatorIndex < 1) {
    return null;
  }

  const weiChunk = raw.slice(0, separatorIndex).trim();
  const countChunk = raw.slice(separatorIndex + 1).trim();
  if (!/^\d+$/.test(weiChunk) || !/^\d+$/.test(countChunk)) {
    return null;
  }

  try {
    const tipAmountWei = BigInt(weiChunk);
    const messageCount = Math.max(0, Number.parseInt(countChunk, 10));
    if (!Number.isFinite(messageCount)) {
      return null;
    }
    return { tipAmountWei, messageCount };
  } catch {
    return null;
  }
};

export const parseTokenTipNotice = (text: string): { amount: string; symbol: string } | null => {
  const tokenTipMatch = text.match(/^\[TIP\]\s*You received\s+([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z0-9._-]{1,24})\.?$/i);
  if (!tokenTipMatch) {
    return null;
  }

  const amount = tokenTipMatch[1];
  const symbol = tokenTipMatch[2].trim().toUpperCase();
  if (!amount || !symbol) {
    return null;
  }

  return {
    amount,
    symbol
  };
};

export const formatTipNoticeText = (
  amountCoti: string,
  messageCount: number,
  direction?: 'incoming' | 'outgoing'
): string => {
  const unit = messageCount === 1 ? 'message' : 'messages';
  if (direction === 'outgoing') {
    return `You tipped ${amountCoti} COTI (${messageCount} ${unit}).`;
  }
  if (direction === 'incoming') {
    return `You received a tip of ${amountCoti} COTI (${messageCount} ${unit}).`;
  }
  return `Tip: ${amountCoti} COTI (${messageCount} ${unit}).`;
};

export const hasInsufficientFundsError = (message: string): boolean =>
  /insufficient funds|exceeds balance|not enough funds|account balance is 0/i.test(message);

export const normalizeImportInput = (value: string): string => value.replace(/\r?\n/g, ' ').trim();

export const normalizeMnemonicInput = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ');

export const normalizePrivateKeyInput = (value: string): string | null => {
  const compact = value.replace(/\s+/g, '');
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(compact)) {
    return null;
  }

  return compact.startsWith('0x') ? compact : `0x${compact}`;
};

export const looksLikePrivateKeyInput = (value: string): boolean => {
  const compact = value.replace(/\s+/g, '');
  return compact.startsWith('0x') || /^[a-fA-F0-9]+$/.test(compact);
};

export async function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
    }
  }
}

export const isBurnerStorageAvailable = (): boolean => {
  try {
    const probeValue = `${Date.now()}`;
    window.localStorage.setItem(BURNER_WALLET_STORAGE_PROBE_KEY, probeValue);
    window.localStorage.removeItem(BURNER_WALLET_STORAGE_PROBE_KEY);
    return true;
  } catch {
    return false;
  }
};

export const toSafeNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    return Number(value > max ? max : value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

