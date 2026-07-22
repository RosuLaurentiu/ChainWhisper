import type { BrowserProvider, OnboardInfo } from '@coti-io/coti-ethers';
import { unzlibSync, zlibSync } from 'fflate';
import { TEXT_DECODER, TEXT_ENCODER } from '../byteEncoding';
import {
  GROUP_ACTION_ERROR_MESSAGE_BY_SELECTOR,
  GROUP_CREATE_ERROR_MESSAGE_BY_SELECTOR,
  GROUP_JOIN_ERROR_MESSAGE_BY_SELECTOR
} from './contracts';

export * from './contracts';
export * from './groupMetadata';
export * from './identity';
export {
  decodeBase64Url,
  decodeBase64UrlBytes,
  encodeBase64Url,
  encodeBase64UrlBytes,
  TEXT_DECODER,
  TEXT_ENCODER
} from '../byteEncoding';

declare global {
  interface Window {
    ethereum?: InjectedEthereumProvider;
    __cotiAnnouncedEthereumProviders?: InjectedEthereumProvider[];
    __cotiAnnouncedEthereumProviderInfo?: InjectedEthereumProviderInfoEntry[];
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
  isCipher?: boolean;
  isCipherTrade?: boolean;
  isCipherWallet?: boolean;
  isCypher?: boolean;
  isCypherTrade?: boolean;
  isCypherWallet?: boolean;
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

export type InjectedEthereumProviderInfo = {
  name?: string;
  rdns?: string;
  uuid?: string;
};

type InjectedEthereumProviderInfoEntry = {
  provider: InjectedEthereumProvider;
  info: InjectedEthereumProviderInfo;
};

export type InjectedWalletOption = {
  id: string;
  label: string;
  provider: InjectedEthereumProvider;
};

export const rememberInjectedWalletProvider = (
  provider?: InjectedEthereumProvider | null,
  info?: InjectedEthereumProviderInfo | null
): void => {
  if (typeof window === 'undefined' || !provider) {
    return;
  }

  const providers = window.__cotiAnnouncedEthereumProviders ?? [];
  if (!providers.includes(provider)) {
    window.__cotiAnnouncedEthereumProviders = [...providers, provider];
  }

  if (!info) {
    return;
  }

  const providerInfo = window.__cotiAnnouncedEthereumProviderInfo ?? [];
  const existingIndex = providerInfo.findIndex((entry) => entry.provider === provider);
  if (existingIndex >= 0) {
    window.__cotiAnnouncedEthereumProviderInfo = providerInfo.map((entry, index) =>
      index === existingIndex ? { provider, info } : entry
    );
    return;
  }

  window.__cotiAnnouncedEthereumProviderInfo = [...providerInfo, { provider, info }];
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

export type WalletAccountRole = 'chainwhisper' | 'owner';

export type ChatMessage = {
  id: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  senderAddress?: string;
  accountAddress?: string;
  accountRole?: WalletAccountRole;
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
  tradeReference?: TradeMessageReferencePayload;
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
  accountAddress?: string;
  accountRole?: WalletAccountRole;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
  reactionToTxHash?: string;
  reactionToBlockNumber?: number;
  reactionToLogIndex?: number;
  reactionEmoji?: string;
  tradeReference?: TradeMessageReferencePayload;
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

export type GroupMessageEntry = {
  id: string;
  groupId: number;
  direction: 'incoming' | 'outgoing';
  text: string;
  senderAddress?: string;
  accountAddress?: string;
  accountRole?: WalletAccountRole;
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
export type SwapDirection = 'shield' | 'unshield' | 'legacy-unshield';
export type SwapFeeModeSelection = 'token' | 'coti';

export const BURNER_WALLET_STORAGE_KEY = 'coti-chat-burner-wallet';
export const BURNER_WALLET_STORAGE_PROBE_KEY = 'coti-chat-burner-wallet-probe';
export const BURNER_WALLET_STORAGE_VERSION = 2;
export const BURNER_OWNER_AES_WALLET_STORAGE_VERSION = 1;
export const BURNER_OWNER_AES_WALLET_STORAGE_SCHEME = 'owner-aes-gcm-v1';
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
export const TRADE_REFERENCE_METADATA_PREFIX = '~cwtr~';
export const LEGACY_TRADE_REFERENCE_METADATA_PREFIX = '\u2068';
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
export const BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI = 5_000_000_000_000_000n;
export const BURNER_TOP_UP_MIN_MESSAGE_TARGET = 1;
export const BURNER_TOP_UP_MAX_MESSAGE_TARGET = 200;
export const BURNER_TOP_UP_DEFAULT_MESSAGE_TARGET = 50;
const MEMO_RAW_PREFIX = '[[coti-memo-raw:v1]]';
const MEMO_COMPRESSED_PREFIX = '[[coti-memo-z:v1]]';
export const REPLY_METADATA_PREFIX_REGEX = new RegExp(REPLY_METADATA_PREFIX, 'g');
const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });
const MEMO_BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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

const decodeUtf8Strict = (bytes: Uint8Array): string | null => {
  try {
    return UTF8_FATAL_DECODER.decode(bytes);
  } catch {
    return null;
  }
};

const isPlausibleMemoPlaintext = (value: string): boolean => {
  if (value.includes('\uFFFD')) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint > 0xffff) {
      index += 1;
    }

    if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) {
      return false;
    }
  }

  return true;
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
  onboardInfo?: OnboardInfo;
  recoveryDefault?: boolean;
  recoveryProfileId?: number;
  recoveryProfileVersion?: string;
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

export type OwnerAesBurnerWalletRecord = {
  version: number;
  scheme: typeof BURNER_OWNER_AES_WALLET_STORAGE_SCHEME;
  ownerAddress: string;
  iv: string;
  ciphertext: string;
};

export type LegacyBurnerWalletVaultRecord = {
  wallets: BurnerWalletRecord[];
  activeWalletId?: string;
};

export type BurnerWalletStorageState =
  | { kind: 'none' }
  | { kind: 'legacy'; record: BurnerWalletRecord }
  | { kind: 'legacy-vault'; record: LegacyBurnerWalletVaultRecord }
  | { kind: 'encrypted'; record: EncryptedBurnerWalletRecord }
  | { kind: 'owner-aes'; record: OwnerAesBurnerWalletRecord };

export type BurnerInitMode = 'generate' | 'import' | 'stored';
export type SignerSource = 'burner' | 'metamask';
export type BurnerPinMode = 'set' | 'unlock';
export type BurnerInitResult = 'connected' | 'needs-funding' | 'imported' | 'failed';
export type SensitiveAction = 'reveal-backup' | 'link-pin-account';
export type MobileView = 'contacts' | 'chat';
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
  hiddenLiquidity?: boolean;
  accessSecret?: string;
};

export type TradeMessageReferencePayload = {
  version: 1;
  tradeId: number;
  escrowContract: string;
  terminalPath: string;
};

export type TradeFillStatePayload = {
  remainingOfferAmount: string;
  remainingRequestAmount: string;
  filledOfferAmount: string;
  filledRequestAmount: string;
};

export type WalletTradeFillPayload = {
  offerAmountReceived: string;
  requestAmountPaid: string;
};

export type WalletTradeFillEventPayload = {
  fillIndex: number;
  filler: string;
  offerAmount: string;
  requestAmount: string;
  txHash?: string;
  blockNumber?: number;
  logIndex?: number;
};

export type DirectTradeTermsMetadataPayload = {
  hasTermsPayload?: boolean;
  hasMakerAccessSecret?: boolean;
  hasTakerAccessSecret?: boolean;
  hasMakerTermsPayload?: boolean;
  hasCounterpartyTermsPayload?: boolean;
  offerAmountPrivate?: boolean;
  requestAmountPrivate?: boolean;
  publicAmountCaveat?: boolean;
};

export type PrivateTradeMakerProgressPayload = {
  initialOfferAmount?: string;
  remainingOfferAmount: string;
  filledOfferAmount?: string;
};

export type PrivateTradeFillReceiptPayload = {
  fillIndex: number;
  filler: string;
  offerAmount?: string;
  requestAmount?: string;
  remainingOfferAmount?: string;
  txHash?: string;
  blockNumber?: number;
};

export type RecurringTradeSide = 'buy' | 'sell';
export type RecurringTradeMode = 'public' | 'fully-private' | 'hybrid-private';
export type RecurringTradeStatus = 'active' | 'paused' | 'cancelled' | 'unknown';

export type RecurringTradeTermsPayload = {
  baseAmount: string;
  quoteAmount: string;
};

export type RecurringPrivateInventoryPayload = {
  baseInventory?: string;
  quoteInventory?: string;
};

export type RecurringPrivateExecutionPayload = {
  fillIndex: number;
  side: RecurringTradeSide;
  filler: string;
  baseAmount?: string;
  quoteAmount?: string;
  remainingBaseInventory?: string;
  remainingQuoteInventory?: string;
  txHash?: string;
  blockNumber?: number;
};

export type RecurringTradeSnapshotPayload = {
  orderId: number;
  selectedSide: RecurringTradeSide;
  mode: RecurringTradeMode;
  recurringStatus: RecurringTradeStatus;
  baseAsset: TradeAssetPayload;
  quoteAsset: TradeAssetPayload;
  buyTerms: RecurringTradeTermsPayload;
  sellTerms: RecurringTradeTermsPayload;
  publicBaseInventory: string;
  publicQuoteInventory: string;
  buySideOpen: boolean;
  sellSideOpen: boolean;
  hasPrivateBaseInventory: boolean;
  hasPrivateQuoteInventory: boolean;
  executionCount: number;
  makerPrivateInventory?: RecurringPrivateInventoryPayload;
  privateExecutions?: RecurringPrivateExecutionPayload[];
  publicExecutions?: RecurringPrivateExecutionPayload[];
};

export type TradeResponseMessagePayload = {
  version: 1;
  tradeId: number;
  escrowContract?: string;
  action: TradeMessageAction;
  actor: string;
  createdAt: number;
  counterTradeId?: number;
};

export type TradeSnapshot = {
  tradeId: number;
  escrowContract?: string;
  maker: string;
  taker: string;
  offer: TradeAssetPayload;
  request: TradeAssetPayload;
  createdAt: number;
  expiresAt: number;
  status: TradeOnChainStatus;
  isPublic?: boolean;
  hasAccessHash?: boolean;
  accessHash?: string;
  parentTradeId?: number;
  counterParentEscrow?: string;
  counterParentTradeId?: number;
  replacementTradeId?: number;
  replacesTradeId?: number;
  fillState?: TradeFillStatePayload;
  walletFillState?: WalletTradeFillPayload;
  walletFillEvents?: WalletTradeFillEventPayload[];
  acceptedTxHash?: string;
  hiddenLiquidity?: boolean;
  directTermsMetadata?: DirectTradeTermsMetadataPayload;
  walletHasFill?: boolean;
  makerPrivateProgress?: PrivateTradeMakerProgressPayload;
  privateFillReceipts?: PrivateTradeFillReceiptPayload[];
  recurringOrder?: RecurringTradeSnapshotPayload;
  accountAddress?: string;
  accountRole?: WalletAccountRole;
  accountMatches?: Array<{
    address: string;
    role: WalletAccountRole;
  }>;
};

export type PendingBurnerInit = {
  mode: BurnerInitMode;
  seedOrPrivateKey?: string;
  walletId?: string;
};

export type SyncConversationOptions = {
  deep?: boolean;
  contactsOnly?: boolean;
  activeContactOnly?: boolean;
  previewPerContact?: boolean;
  updateHead?: boolean;
  lookbackBlocks?: number;
  background?: boolean;
  fromBlock?: number;
  toBlock?: number;
  skipContactStateUpdate?: boolean;
};

export type SyncGroupOptions = {
  deep?: boolean;
  background?: boolean;
  overviewOnly?: boolean;
  activeMessagesOnly?: boolean;
  wideLoad?: boolean;
  prefetchGroupId?: number;
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

export type CotiEthersModule = typeof import('@coti-io/coti-ethers');
export type CotiWsProvider = InstanceType<CotiEthersModule['WebSocketProvider']>;
export type CotiHttpProvider = InstanceType<CotiEthersModule['JsonRpcProvider']>;
export type CotiReadProvider = CotiWsProvider | CotiHttpProvider;
let cotiEthersModulePromise: Promise<CotiEthersModule> | null = null;
let cotiWsProviderPromise: Promise<CotiWsProvider> | null = null;
let cotiHttpProviderPromise: Promise<CotiHttpProvider> | null = null;
let cotiWsLastHealthyAt = 0;

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
  const providerPromise = cotiWsProviderPromise;
  if (!providerPromise) {
    return;
  }
  cotiWsProviderPromise = null;

  try {
    const wsProvider = await providerPromise;
    const providerWithDestroy = wsProvider as unknown as { destroy?: () => void };
    providerWithDestroy.destroy?.();
  } catch {
  }
};

export const loadCotiReadProvider = async (_preferWebSocket = true): Promise<CotiReadProvider> =>
  // Realtime hooks own the shared socket lifecycle; reads must survive socket resets and polling fallback.
  loadCotiHttpProvider();

const getRememberedInjectedWalletProviderInfo = (
  provider: InjectedEthereumProvider
): InjectedEthereumProviderInfo | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.__cotiAnnouncedEthereumProviderInfo?.find((entry) => entry.provider === provider)?.info;
};

const normalizeWalletIdentityText = (...values: Array<string | undefined>): string =>
  values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const isCipherTradeProvider = (
  provider: InjectedEthereumProvider,
  info?: InjectedEthereumProviderInfo
): boolean => {
  if (
    provider.isCipherTrade ||
    provider.isCipherWallet ||
    provider.isCipher ||
    provider.isCypherTrade ||
    provider.isCypherWallet ||
    provider.isCypher
  ) {
    return true;
  }

  const identityText = normalizeWalletIdentityText(info?.name, info?.rdns, info?.uuid);
  return (
    identityText.includes('ciphertrade') ||
    identityText.includes('cipherwallet') ||
    identityText.includes('cyphertrade') ||
    identityText.includes('cypherwallet')
  );
};

const getInjectedWalletProviderId = (
  provider: InjectedEthereumProvider,
  info?: InjectedEthereumProviderInfo
): string => {
  if (isCipherTradeProvider(provider, info)) {
    return 'ciphertrade';
  }
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

export const getInjectedWalletLabel = (
  provider: InjectedEthereumProvider,
  info?: InjectedEthereumProviderInfo
): string => {
  if (isCipherTradeProvider(provider, info)) {
    return 'CipherTrade';
  }
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
  const announcedProviders = window.__cotiAnnouncedEthereumProviders ?? [];
  if (!injected && announcedProviders.length === 0) {
    return [];
  }

  const candidates = [
    ...announcedProviders,
    ...(injected ? (Array.isArray(injected.providers) && injected.providers.length > 0 ? injected.providers : [injected]) : [])
  ];
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
    const providerInfo = getRememberedInjectedWalletProviderInfo(provider);
    const baseId = getInjectedWalletProviderId(provider, providerInfo);
    const duplicateCount = optionCounts.get(baseId) ?? 0;
    optionCounts.set(baseId, duplicateCount + 1);
    const label = getInjectedWalletLabel(provider, providerInfo);
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

export const isProviderRequestAlreadyPending = (error: unknown): boolean => {
  const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = rawMessage.toLowerCase();
  const codeCandidate = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return codeCandidate === -32002 || normalized.includes('already pending');
};

export const getProviderErrorMessage = (error: unknown, fallbackMessage: string): string => {
  const rawMessage = error instanceof Error ? error.message : '';
  const codeCandidate = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const code = typeof codeCandidate === 'number' ? codeCandidate : null;

  if (isProviderRequestAlreadyPending(error)) {
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

export const bytesEqual = (left?: Uint8Array | null, right?: Uint8Array | null): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

export const onboardInfoEqual = (left?: OnboardInfo, right?: OnboardInfo): boolean =>
  (left?.aesKey ?? null) === (right?.aesKey ?? null) &&
  (left?.txHash ?? null) === (right?.txHash ?? null) &&
  bytesEqual(left?.rsaKey?.publicKey, right?.rsaKey?.publicKey) &&
  bytesEqual(left?.rsaKey?.privateKey, right?.rsaKey?.privateKey);

export const mergeOnboardInfoByAddress = (
  previous: Record<string, OnboardInfo>,
  cacheKey: string,
  onboardInfo?: OnboardInfo
): Record<string, OnboardInfo> => {
  if (!cacheKey || !onboardInfo) {
    return previous;
  }

  const merged = mergeOnboardInfo(previous[cacheKey], onboardInfo);
  if (onboardInfoEqual(previous[cacheKey], merged)) {
    return previous;
  }

  return {
    ...previous,
    [cacheKey]: merged
  };
};

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

export const decodeMemoPlaintextStrict = (raw: string): string | null => {
  if (raw.startsWith(MEMO_RAW_PREFIX)) {
    const plain = repairUtf8MojibakeSegments(raw.slice(MEMO_RAW_PREFIX.length));
    return isPlausibleMemoPlaintext(plain) ? plain : null;
  }

  if (raw.startsWith(MEMO_COMPRESSED_PREFIX)) {
    try {
      const encodedCompressed = raw.slice(MEMO_COMPRESSED_PREFIX.length);
      const compressedBytes = base64ToBytes(encodedCompressed);
      const inflatedBytes = unzlibSync(compressedBytes);
      const plain = decodeUtf8Strict(inflatedBytes);
      return plain !== null && isPlausibleMemoPlaintext(plain) ? plain : null;
    } catch {
      return null;
    }
  }

  if (raw === '') {
    return '';
  }

  if (raw.trim() === raw && raw.length % 4 === 0 && MEMO_BASE64_REGEX.test(raw)) {
    try {
      const plain = decodeUtf8Strict(base64ToBytes(raw));
      if (plain !== null && isPlausibleMemoPlaintext(plain)) {
        return plain;
      }
    } catch {
    }
  }

  const legacyPlain = repairUtf8MojibakeSegments(raw);
  return isPlausibleMemoPlaintext(legacyPlain) ? legacyPlain : null;
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

export type TradeExpiryUrgency = 'none' | 'low' | 'medium' | 'high' | 'expired';

export const formatExpiryCountdown = (expiresAt: number): { label: string; urgency: TradeExpiryUrgency } => {
  if (expiresAt <= 0) return { label: 'No expiration', urgency: 'none' };
  const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) return { label: 'Expired', urgency: 'expired' };
  const hours = secondsLeft / 3600;
  let label: string;
  if (secondsLeft >= 86400) {
    label = `in ${Math.floor(secondsLeft / 86400)}d ${Math.floor((secondsLeft % 86400) / 3600)}h`;
  } else if (secondsLeft >= 3600) {
    label = `in ${Math.floor(hours)}h ${Math.floor((secondsLeft % 3600) / 60)}m`;
  } else {
    label = `in ${Math.floor(secondsLeft / 60)}m`;
  }
  const urgency: TradeExpiryUrgency = hours > 24 ? 'low' : hours > 1 ? 'medium' : 'high';
  return { label: `Expires ${label}`, urgency };
};

export const calculateEstimatedBurnerTopUpAmount = (messageTarget: number): bigint => {
  const safeMessageTarget = Math.max(
    BURNER_TOP_UP_MIN_MESSAGE_TARGET,
    Math.min(BURNER_TOP_UP_MAX_MESSAGE_TARGET, Math.floor(messageTarget))
  );
  return BURNER_TOP_UP_ESTIMATED_COTI_PER_MESSAGE_WEI * BigInt(safeMessageTarget);
};

export const formatCotiAmount = (weiAmount: bigint, precision = 6): string => {
  const whole = weiAmount / COTI_WEI;
  const safePrecision = Math.max(0, Math.min(18, Math.floor(precision)));
  const fraction =
    safePrecision > 0
      ? (weiAmount % COTI_WEI)
          .toString()
          .padStart(18, '0')
          .slice(0, safePrecision)
          .replace(/0+$/, '')
      : '';
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

