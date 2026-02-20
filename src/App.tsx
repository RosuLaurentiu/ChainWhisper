import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatImage from './components/ChatImage';
import { parseImageTag } from './lib/imagePull';
import type { BrowserProvider, JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';
import { unzlibSync, zlibSync } from 'fflate';

declare global {
  interface Window {
    ethereum?: InjectedEthereumProvider;
  }
}

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  connect?: () => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
};

type InjectedEthereumProvider = Eip1193Provider & {
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
  providers?: InjectedEthereumProvider[];
};

type Contact = {
  address: string;
  name?: string;
};

type ChatMessage = {
  id: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  timestamp?: number;
  blockNumber?: number;
  logIndex?: number;
  txHash?: string;
  deliveryState?: 'pending' | 'sent' | 'failed';
};

type HistoryEntry = {
  id: string;
  contact: string;
  direction: 'incoming' | 'outgoing';
  text: string;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp?: number;
};

const BURNER_WALLET_STORAGE_KEY = 'coti-chat-burner-wallet';
const BURNER_WALLET_STORAGE_PROBE_KEY = 'coti-chat-burner-wallet-probe';
const BURNER_WALLET_STORAGE_VERSION = 2;
const BURNER_WALLET_VAULT_VERSION = 1;
const BURNER_PIN_MIN_LENGTH = 5;
const LEGACY_BURNER_PIN_MIN_LENGTH = 4;
const BURNER_PIN_PBKDF2_ITERATIONS = 250000;
const AUTO_SYNC_INTERVAL_MS = 30000;
const WS_HEALTHCHECK_TTL_MS = 12000;
const WS_RETRY_COOLDOWN_MS = 15000;
const REALTIME_SYNC_DEBOUNCE_MS = 250;
const REALTIME_SYNC_BURST_THROTTLE_MS = 1500;
const REALTIME_SYNC_FALLBACK_INTERVAL_MS = 5000;
const READ_STATE_BACKUP_DEBOUNCE_MS = 2500;
const READ_STATE_BACKUP_MIN_INTERVAL_MS = 45000;
const INITIAL_SYNC_LOOKBACK_BLOCKS = 2500;
const HISTORY_PAGINATION_BLOCK_WINDOW = 10000;
const SELF_BACKUP_RESTORE_BLOCK_WINDOW = 20000;
const AUTO_STATE_BACKUP_BLOCK_DISTANCE = 18000;
const AUTO_STATE_BACKUP_RETRY_BLOCKS = 3000;
const BURNER_ONBOARD_TIMEOUT_MS = 45000;
const DEFAULT_NICKNAME_MAX_BYTES = 42;
const NICKNAME_DELIMITER = '\u001f';
const REPLY_DELIMITER = '\u001e';
const PROFILE_METADATA_PREFIX = '\u2063';
const REPLY_METADATA_PREFIX = '\u2064';
const CONTACT_NAME_METADATA_PREFIX = '\u2065';
const CONTACT_NAME_ENCODING_ZERO = '\u200b';
const CONTACT_NAME_ENCODING_ONE = '\u200c';
const LEGACY_PROFILE_METADATA_PREFIX = '[nick:';
const LEGACY_REPLY_METADATA_PREFIX = '[reply:';
const LEGACY_PROFILE_PREFIX = '[[coti-profile:v1]]';
const LEGACY_PROFILE_PLAIN_PREFIX = '[[coti-nick:v1]]';
const IMAGE_MESSAGE_PREFIX = '[[coti-image:v1]]';
const STATE_BACKUP_PREFIX = '[[coti-state:v1]]';
const STATE_BACKUP_COMPRESSED_PREFIX = 'z:';
const READ_CURSOR_PREFIX = '[[coti-read:v1]]';
const STATE_BACKUP_VERSION = 1;
const MAX_REPLY_PREVIEW_LENGTH = 28;
const MAX_MESSAGE_LENGTH = 2000;
const COTI_WEI = 10n ** 18n;
const MIN_BURNER_TOP_UP_WEI = 1_000_000_000_000_000n;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const REPLY_METADATA_PREFIX_REGEX = new RegExp(REPLY_METADATA_PREFIX, 'g');
const EXTERNAL_REPLY_TXHASH_REGEX = /^\[r:(0x[a-fA-F0-9]{64})\]\s*/;
const debugLog = (...args: unknown[]): void => {
  if (import.meta.env.DEV) {
    console.debug(...args);
  }
};

type BurnerWalletRecord = {
  id?: string;
  address?: string;
  name?: string;
  privateKey: string;
  mnemonic?: string;
};

type BurnerWalletVault = {
  version: number;
  wallets: BurnerWalletRecord[];
  activeWalletId: string;
};

type EncryptedBurnerWalletRecord = {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
};

type LegacyBurnerWalletVaultRecord = {
  wallets: BurnerWalletRecord[];
  activeWalletId?: string;
};

type BurnerWalletStorageState =
  | { kind: 'none' }
  | { kind: 'legacy'; record: BurnerWalletRecord }
  | { kind: 'legacy-vault'; record: LegacyBurnerWalletVaultRecord }
  | { kind: 'encrypted'; record: EncryptedBurnerWalletRecord };

type BurnerInitMode = 'generate' | 'import' | 'stored';
type SignerSource = 'burner' | 'metamask';
type BurnerPinMode = 'set' | 'unlock';
type BurnerInitResult = 'connected' | 'needs-funding' | 'imported' | 'failed';
type SensitiveAction = 'reveal-backup';
type MobileView = 'wallets' | 'contacts' | 'chat';

type PendingBurnerInit = {
  mode: BurnerInitMode;
  seedOrPrivateKey?: string;
  walletId?: string;
};

type SyncConversationOptions = {
  deep?: boolean;
  contactsOnly?: boolean;
  previewPerContact?: boolean;
  updateHead?: boolean;
  lookbackBlocks?: number;
  background?: boolean;
  fromBlock?: number;
  toBlock?: number;
};

type StateBackupPayload = {
  version: number;
  updatedAt: number;
  lastReadAllTs?: number;
  // Legacy fields kept optional for backward compatibility while parsing old backups.
  nickname?: string;
  contacts?: Contact[];
  readState?: BackupReadStateEntry[];
  unreadContacts?: string[];
};

type ReadCursorPayload = {
  peer: string;
  lastReadTs: number;
  lastReadBlock?: number;
};

type BackupReadStateEntry = {
  address: string;
  lastReadTs: number;
};

type BackupLocalStateOptions = {
  force?: boolean;
  background?: boolean;
};

type SubmitMemoPayload = {
  ciphertextValue: bigint[];
  signature: string[];
};

const COTI_NETWORK = {
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

const CHAT_CONTRACT_ADDRESS = '0x3b7151a7B7F1ccEB9b2325A27f99B24b6479d2D7';
const CHAT_CONTRACT_ABI = [
  'function submit(address recipient, ((uint256[] value), bytes[] signature) memo) payable',
  'function setMyNickname(string name)',
  'function nicknames(address account) view returns (string)',
  'function getLastBlockForConversation(address me, address peer) view returns (uint256)',
  'function getLastMessageTime(address me, address peer) view returns (uint256)',
  'function NICKNAME_MAX_BYTES() view returns (uint256)',
  'function feeAmount() view returns (uint256)',
  'event NicknameSet(address indexed user, string nickname)',
  'event MessageSubmitted(address indexed recipient, address indexed from, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForRecipient, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForSender)'
] as const;

type CotiEthersModule = typeof import('@coti-io/coti-ethers');
type CotiWsProvider = InstanceType<CotiEthersModule['WebSocketProvider']>;
type CotiHttpProvider = InstanceType<CotiEthersModule['JsonRpcProvider']>;
type CotiReadProvider = CotiWsProvider | CotiHttpProvider;
let cotiEthersModulePromise: Promise<CotiEthersModule> | null = null;
let cotiWsProviderPromise: Promise<CotiWsProvider> | null = null;
let cotiHttpProviderPromise: Promise<CotiHttpProvider> | null = null;
let cotiWsLastHealthyAt = 0;
let cotiWsBackoffUntil = 0;

const loadCotiEthersModule = (): Promise<CotiEthersModule> => {
  if (!cotiEthersModulePromise) {
    cotiEthersModulePromise = import('@coti-io/coti-ethers');
  }

  return cotiEthersModulePromise;
};

const loadCotiWsProvider = async (): Promise<CotiWsProvider> => {
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

const loadCotiHttpProvider = async (): Promise<CotiHttpProvider> => {
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

const resetCotiWsProvider = async (): Promise<void> => {
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

const loadCotiReadProvider = async (preferWebSocket = true): Promise<CotiReadProvider> => {
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

const shortenAddress = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`;

const isWalletAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value.trim());
const isShortAddress = (value: string): boolean => /^0x[a-fA-F0-9]{4}\.\.\.[a-fA-F0-9]{4}$/.test(value.trim());
const normalizeContactName = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeChainId = (chainId: string | number): number => {
  if (typeof chainId === 'number') return chainId;
  return chainId.startsWith('0x') ? parseInt(chainId, 16) : Number(chainId);
};

const getMetaMaskProvider = (): InjectedEthereumProvider | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const injected = window.ethereum;
  if (!injected) {
    return null;
  }

  const candidates =
    Array.isArray(injected.providers) && injected.providers.length > 0 ? injected.providers : [injected];

  const explicitMetaMask = candidates.find((candidate) => candidate.isMetaMask && !candidate.isBraveWallet);
  if (explicitMetaMask) {
    return explicitMetaMask;
  }

  if (injected.isMetaMask && !injected.isBraveWallet) {
    return injected;
  }

  return candidates.find((candidate) => candidate.isMetaMask) ?? (injected.isMetaMask ? injected : null);
};

const getProviderErrorMessage = (error: unknown, fallbackMessage: string): string => {
  const rawMessage = error instanceof Error ? error.message : '';
  const normalized = rawMessage.toLowerCase();
  const codeCandidate = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const code = typeof codeCandidate === 'number' ? codeCandidate : null;

  if (code === -32002 || normalized.includes('already pending')) {
    return 'A MetaMask request is already pending. Open MetaMask and approve or reject it first.';
  }

  if (code === 4001) {
    return 'The MetaMask request was rejected.';
  }

  return rawMessage || fallbackMessage;
};

const createCotiBrowserProvider = async (ethereum: Eip1193Provider): Promise<BrowserProvider> => {
  const cotiEthers = await loadCotiEthersModule();
  return new cotiEthers.BrowserProvider(ethereum, {
    name: COTI_NETWORK.chainName,
    chainId: COTI_NETWORK.chainIdDecimal
  });
};

const mergeOnboardInfo = (previous?: OnboardInfo, next?: OnboardInfo): OnboardInfo => ({
  aesKey: next?.aesKey ?? previous?.aesKey,
  rsaKey: next?.rsaKey ?? previous?.rsaKey,
  txHash: next?.txHash ?? previous?.txHash
});

const encodeMemoPlaintext = (plain: string): string => {
  const bytes = TEXT_ENCODER.encode(plain);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
};

const decodeMemoPlaintext = (raw: string): string => {
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

const formatMessageTimestamp = (timestamp?: number): string => {
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

const calculateTopUpAmount = (requiredFee: bigint, multiplier: number): bigint => {
  const safeMultiplier = Math.max(1, Math.floor(multiplier));
  return requiredFee > 0n ? requiredFee * BigInt(safeMultiplier) : MIN_BURNER_TOP_UP_WEI * BigInt(safeMultiplier);
};

const formatCotiAmount = (weiAmount: bigint): string => {
  const whole = weiAmount / COTI_WEI;
  const fraction = (weiAmount % COTI_WEI).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
};

const hasInsufficientFundsError = (message: string): boolean =>
  /insufficient funds|exceeds balance|not enough funds|account balance is 0/i.test(message);

const normalizeImportInput = (value: string): string => value.replace(/\r?\n/g, ' ').trim();

const normalizeMnemonicInput = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ');

const normalizePrivateKeyInput = (value: string): string | null => {
  const compact = value.replace(/\s+/g, '');
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(compact)) {
    return null;
  }

  return compact.startsWith('0x') ? compact : `0x${compact}`;
};

const looksLikePrivateKeyInput = (value: string): boolean => {
  const compact = value.replace(/\s+/g, '');
  return compact.startsWith('0x') || /^[a-fA-F0-9]+$/.test(compact);
};

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
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

const isBurnerStorageAvailable = (): boolean => {
  try {
    const probeValue = `${Date.now()}`;
    window.localStorage.setItem(BURNER_WALLET_STORAGE_PROBE_KEY, probeValue);
    window.localStorage.removeItem(BURNER_WALLET_STORAGE_PROBE_KEY);
    return true;
  } catch {
    return false;
  }
};

const toSafeNumber = (value: unknown): number => {
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

const toBigIntArray = (value: unknown): bigint[] => {
  const parseSingle = (item: unknown): bigint[] => {
    if (typeof item === 'bigint') return [item];
    if (typeof item === 'number') return [BigInt(item)];

    if (typeof item === 'string') {
      const parts = item
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      return parts.map((part) => BigInt(part));
    }

    if (item && typeof item === 'object' && 'toString' in item) {
      const asString = String(item);
      const parts = asString
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      return parts.map((part) => BigInt(part));
    }

    return [];
  };

  if (Array.isArray(value)) {
    return value.flatMap((item) => parseSingle(item));
  }

  if (value && typeof value === 'object' && 'value' in value) {
    return toBigIntArray((value as { value: unknown }).value);
  }

  return parseSingle(value);
};

const extractUserCiphertext = (memo: unknown): { value: bigint[] } | null => {
  if (!memo) {
    return null;
  }

  if (Array.isArray(memo) && memo.length > 1) {
    return { value: toBigIntArray(memo[1]) };
  }

  if (memo && typeof memo === 'object' && 'userCiphertext' in memo) {
    return { value: toBigIntArray((memo as { userCiphertext: unknown }).userCiphertext) };
  }

  return null;
};

const parseSubmitMemoPayload = (encryptedMemo: unknown): SubmitMemoPayload => {
  if (
    typeof encryptedMemo !== 'object' ||
    encryptedMemo === null ||
    !('ciphertext' in encryptedMemo) ||
    !('signature' in encryptedMemo)
  ) {
    throw new Error('Encrypted memo format mismatch for submit().');
  }

  const ciphertext = (encryptedMemo as { ciphertext: unknown }).ciphertext;
  const signature = (encryptedMemo as { signature: unknown }).signature;
  const ciphertextValue =
    ciphertext && typeof ciphertext === 'object' && 'value' in ciphertext
      ? toBigIntArray((ciphertext as { value: unknown }).value)
      : [];
  if (!Array.isArray(signature)) {
    throw new Error('Encrypted memo format mismatch for submit().');
  }

  return {
    ciphertextValue,
    signature: signature as string[]
  };
};

const mergeUniqueContacts = (existing: Contact[], discoveredAddresses: string[]): Contact[] => {
  const fullByLower = new Map<string, Contact>();

  const upsertFull = (addressValue: string, incomingName?: string): void => {
    const address = addressValue.trim();
    if (!isWalletAddress(address)) {
      return;
    }

    const key = address.toLowerCase();
    const name = normalizeContactName(incomingName ?? '');
    const existingContact = fullByLower.get(key);
    if (!existingContact) {
      fullByLower.set(key, name ? { address, name } : { address });
      return;
    }

    const existingName = normalizeContactName(existingContact.name ?? '');
    if (!existingName && name) {
      fullByLower.set(key, { ...existingContact, name });
    }
  };

  for (const contact of existing) {
    upsertFull(contact.address, contact.name);
  }

  for (const address of discoveredAddresses) {
    upsertFull(address);
  }

  const shortToFull = new Map<string, string | null>();
  for (const fullAddress of fullByLower.keys()) {
    const short = shortenAddress(fullAddress).toLowerCase();
    const existingMatch = shortToFull.get(short);
    if (typeof existingMatch === 'undefined') {
      shortToFull.set(short, fullAddress);
    } else if (existingMatch !== fullAddress) {
      shortToFull.set(short, null);
    }
  }

  const unresolvedByLower = new Map<string, Contact>();
  const upsertUnresolved = (addressValue: string, incomingName?: string): void => {
    const address = addressValue.trim();
    if (!address) {
      return;
    }

    const key = address.toLowerCase();
    const name = normalizeContactName(incomingName ?? '');
    const existingContact = unresolvedByLower.get(key);
    if (!existingContact) {
      unresolvedByLower.set(key, name ? { address, name } : { address });
      return;
    }

    const existingName = normalizeContactName(existingContact.name ?? '');
    if (!existingName && name) {
      unresolvedByLower.set(key, { ...existingContact, name });
    }
  };

  for (const contact of existing) {
    const rawAddress = contact.address.trim();
    if (!rawAddress || isWalletAddress(rawAddress)) {
      continue;
    }

    const lowerAddress = rawAddress.toLowerCase();
    if (isShortAddress(lowerAddress)) {
      const resolvedFull = shortToFull.get(lowerAddress);
      if (resolvedFull && isWalletAddress(resolvedFull)) {
        const shortName = normalizeContactName(contact.name ?? '');
        if (shortName) {
          const resolvedContact = fullByLower.get(resolvedFull);
          if (resolvedContact && !normalizeContactName(resolvedContact.name ?? '')) {
            fullByLower.set(resolvedFull, { ...resolvedContact, name: shortName });
          }
        }
        continue;
      }
    }

    upsertUnresolved(rawAddress, contact.name);
  }

  return [...fullByLower.values(), ...unresolvedByLower.values()];
};

const normalizeBackupAddressToken = (value: unknown): string | null => {
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) {
    return null;
  }

  if (isWalletAddress(token) || isShortAddress(token)) {
    return token;
  }

  return null;
};

const normalizeReadStateEntries = (value: unknown): BackupReadStateEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const maxTsByAddress = new Map<string, number>();
  for (const item of value) {
    const entry =
      Array.isArray(item) && item.length >= 2
        ? { address: item[0], lastReadTs: item[1] }
        : item && typeof item === 'object'
          ? {
              address: (item as { address?: unknown; p?: unknown }).address ?? (item as { p?: unknown }).p,
              lastReadTs: (item as { lastReadTs?: unknown; t?: unknown }).lastReadTs ?? (item as { t?: unknown }).t
            }
          : null;
    if (!entry) {
      continue;
    }

    const address = normalizeBackupAddressToken(entry.address);
    const lastReadTs = toSafeNumber(entry.lastReadTs);
    if (!address || !Number.isFinite(lastReadTs) || lastReadTs <= 0) {
      continue;
    }

    const existing = maxTsByAddress.get(address) ?? 0;
    if (lastReadTs > existing) {
      maxTsByAddress.set(address, lastReadTs);
    }
  }

  return Array.from(maxTsByAddress.entries())
    .map(([address, lastReadTs]) => ({ address, lastReadTs }))
    .sort((left, right) => left.address.localeCompare(right.address));
};

const normalizeLastReadAllTs = (value: unknown): number => {
  const normalized = Math.floor(toSafeNumber(value));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }
  return normalized;
};

const deriveLegacyLastReadAllTs = (entries: BackupReadStateEntry[]): number => {
  let latest = 0;
  for (const entry of entries) {
    if (entry.lastReadTs > latest) {
      latest = entry.lastReadTs;
    }
  }
  return latest;
};

const buildStateBackupPayload = (lastReadAllTs = 0): StateBackupPayload => {
  return {
    version: STATE_BACKUP_VERSION,
    updatedAt: Math.floor(Date.now() / 1000),
    lastReadAllTs: normalizeLastReadAllTs(lastReadAllTs) || undefined
  };
};

const buildStateBackupText = (payload: StateBackupPayload): string => {
  // Compact format: {v, u, g} to minimize on-chain size.
  const normalizedLastReadAllTs = normalizeLastReadAllTs(payload.lastReadAllTs);
  const compactBase = {
    v: payload.version,
    u: payload.updatedAt
  };
  const compact =
    normalizedLastReadAllTs > 0
      ? { ...compactBase, g: normalizedLastReadAllTs }
      : compactBase;

  const rawJson = JSON.stringify(compact);
  try {
    const compressedBytes = zlibSync(TEXT_ENCODER.encode(rawJson), { level: 9 });
    const encodedCompressed = bytesToBase64(compressedBytes);
    const compressedPayload = `${STATE_BACKUP_COMPRESSED_PREFIX}${encodedCompressed}`;
    if (compressedPayload.length < rawJson.length) {
      return `${STATE_BACKUP_PREFIX}${compressedPayload}`;
    }
  } catch {
  }

  return `${STATE_BACKUP_PREFIX}${rawJson}`;
};

const parseStateBackupText = (text: string): StateBackupPayload | null => {
  if (!text.startsWith(STATE_BACKUP_PREFIX)) {
    return null;
  }

  try {
    let rawPayload = text.slice(STATE_BACKUP_PREFIX.length).trim();
    if (!rawPayload) {
      return null;
    }

    if (rawPayload.startsWith(STATE_BACKUP_COMPRESSED_PREFIX)) {
      const encodedCompressed = rawPayload.slice(STATE_BACKUP_COMPRESSED_PREFIX.length);
      if (!encodedCompressed) {
        return null;
      }

      const compressedBytes = base64ToBytes(encodedCompressed);
      const inflatedBytes = unzlibSync(compressedBytes);
      rawPayload = TEXT_DECODER.decode(inflatedBytes).trim();
      if (!rawPayload) {
        return null;
      }
    }

    const parsed = JSON.parse(rawPayload) as any;

    // Current compact format: {v, u, g}
    if (parsed && typeof parsed === 'object' && parsed.v === STATE_BACKUP_VERSION) {
      const updatedAt = typeof parsed.u === 'number' ? parsed.u : 0;
      const legacyReadState = normalizeReadStateEntries(parsed.r);
      const explicitReadAllTs = normalizeLastReadAllTs(parsed.g);
      const fallbackReadAllTs = deriveLegacyLastReadAllTs(legacyReadState);
      return {
        version: STATE_BACKUP_VERSION,
        updatedAt,
        lastReadAllTs: explicitReadAllTs || fallbackReadAllTs || undefined
      };
    }

    // Fallback to legacy full-object format.
    if (parsed && typeof parsed === 'object' && parsed.version === STATE_BACKUP_VERSION) {
      const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
      const legacyReadState = normalizeReadStateEntries((parsed as any).readState ?? (parsed as any).r);
      const explicitReadAllTs = normalizeLastReadAllTs((parsed as any).lastReadAllTs ?? (parsed as any).g);
      const fallbackReadAllTs = deriveLegacyLastReadAllTs(legacyReadState);
      return {
        version: STATE_BACKUP_VERSION,
        updatedAt,
        lastReadAllTs: explicitReadAllTs || fallbackReadAllTs || undefined
      };
    }

    return null;
  } catch {
    return null;
  }
};

const parseReadCursorText = (text: string): ReadCursorPayload | null => {
  if (!text.startsWith(READ_CURSOR_PREFIX)) {
    return null;
  }

  try {
    const rawPayload = text.slice(READ_CURSOR_PREFIX.length).trim();
    if (!rawPayload) {
      return null;
    }

    const parsed = JSON.parse(rawPayload) as { p?: unknown; t?: unknown; b?: unknown };
    const peer = typeof parsed.p === 'string' ? parsed.p.trim().toLowerCase() : '';
    if (!isWalletAddress(peer)) {
      return null;
    }

    const lastReadTs = toSafeNumber(parsed.t);
    const lastReadBlock = toSafeNumber(parsed.b);
    if (!lastReadTs || !Number.isFinite(lastReadTs)) {
      return null;
    }

    return {
      peer,
      lastReadTs,
      lastReadBlock: lastReadBlock > 0 ? lastReadBlock : undefined
    };
  } catch {
    return null;
  }
};

const createStateBackupFingerprint = (lastReadAllTs = 0): string =>
  JSON.stringify({
    g: normalizeLastReadAllTs(lastReadAllTs)
  });

const sortMessagesChronologically = (messages: ChatMessage[]): ChatMessage[] => {
  const next = [...messages];

  next.sort((left, right) => {
    const leftHasBlock = typeof left.blockNumber === 'number';
    const rightHasBlock = typeof right.blockNumber === 'number';

    if (leftHasBlock && rightHasBlock) {
      const blockDiff = (left.blockNumber as number) - (right.blockNumber as number);
      if (blockDiff !== 0) {
        return blockDiff;
      }

      const logDiff = (left.logIndex ?? 0) - (right.logIndex ?? 0);
      if (logDiff !== 0) {
        return logDiff;
      }
    }

    const leftTimestamp = left.timestamp ?? 0;
    const rightTimestamp = right.timestamp ?? 0;
    if (leftTimestamp !== rightTimestamp) {
      return leftTimestamp - rightTimestamp;
    }

    return left.id.localeCompare(right.id);
  });

  return next;
};

const normalizeMessagesByContact = (messagesByContact: Record<string, ChatMessage[]>): Record<string, ChatMessage[]> => {
  const next: Record<string, ChatMessage[]> = {};

  for (const [contactKey, messages] of Object.entries(messagesByContact)) {
    next[contactKey] = sortMessagesChronologically(messages);
  }

  return next;
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

const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;

const getSecureWebCrypto = (): { webCrypto: Crypto; subtle: SubtleCrypto } => {
  const webCrypto = globalThis.crypto;
  const subtle = webCrypto?.subtle;
  if (webCrypto && subtle) {
    return { webCrypto, subtle };
  }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error('Browser encryption requires HTTPS. Open the app using an https:// URL.');
  }

  throw new Error('Web Crypto API is unavailable in this browser.');
};

const createBurnerWalletId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const createBurnerWalletVault = async (
  records: BurnerWalletRecord[],
  preferredActiveWalletId?: string
): Promise<BurnerWalletVault> => {
  const cotiEthers = await loadCotiEthersModule();
  const normalizedWallets: BurnerWalletRecord[] = [];
  const seenPrivateKeys = new Set<string>();

  for (const walletRecord of records) {
    const privateKey = walletRecord.privateKey.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      continue;
    }

    const dedupeKey = privateKey.toLowerCase();
    if (seenPrivateKeys.has(dedupeKey)) {
      continue;
    }

    seenPrivateKeys.add(dedupeKey);
    normalizedWallets.push({
      id: walletRecord.id?.trim() || createBurnerWalletId(),
      address: new cotiEthers.Wallet(privateKey).address,
      name: normalizeContactName(typeof walletRecord.name === 'string' ? walletRecord.name : ''),
      privateKey,
      mnemonic: walletRecord.mnemonic?.trim() || undefined
    });
  }

  if (normalizedWallets.length === 0) {
    throw new Error('No valid burner wallets found in storage.');
  }

  const activeWallet =
    normalizedWallets.find((walletRecord) => walletRecord.id === preferredActiveWalletId) ?? normalizedWallets[0];

  return {
    version: BURNER_WALLET_VAULT_VERSION,
    wallets: normalizedWallets,
    activeWalletId: activeWallet.id as string
  };
};

const upsertBurnerWalletInVault = async (
  vault: BurnerWalletVault,
  walletRecord: BurnerWalletRecord
): Promise<BurnerWalletVault> => {
  const normalizedVault = await createBurnerWalletVault(vault.wallets, vault.activeWalletId);
  const incomingPrivateKey = walletRecord.privateKey.trim().toLowerCase();
  const existingWallet = normalizedVault.wallets.find(
    (existingWalletRecord) => existingWalletRecord.privateKey.toLowerCase() === incomingPrivateKey
  );

  if (existingWallet) {
    return {
      ...normalizedVault,
      wallets: normalizedVault.wallets.map((existingWalletRecord) =>
        existingWalletRecord.id === existingWallet.id
          ? {
              ...existingWalletRecord,
              name: normalizeContactName(typeof walletRecord.name === 'string' ? walletRecord.name : '') ?? existingWalletRecord.name,
              mnemonic: walletRecord.mnemonic?.trim() || existingWalletRecord.mnemonic
            }
          : existingWalletRecord
      ),
      activeWalletId: existingWallet.id as string
    };
  }

  const cotiEthers = await loadCotiEthersModule();
  const privateKey = walletRecord.privateKey.trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error('Invalid burner wallet private key format.');
  }

  const createdWallet: BurnerWalletRecord = {
    id: createBurnerWalletId(),
    address: new cotiEthers.Wallet(privateKey).address,
    name: normalizeContactName(typeof walletRecord.name === 'string' ? walletRecord.name : ''),
    privateKey,
    mnemonic: walletRecord.mnemonic?.trim() || undefined
  };

  return {
    ...normalizedVault,
    wallets: [...normalizedVault.wallets, createdWallet],
    activeWalletId: createdWallet.id as string
  };
};

const parseBurnerWalletStorageState = (): BurnerWalletStorageState => {
  try {
    const raw = window.localStorage.getItem(BURNER_WALLET_STORAGE_KEY);
    if (!raw) {
      return { kind: 'none' };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { kind: 'none' };
    }

    const encryptedCandidate = parsed as {
      version?: unknown;
      salt?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
      iterations?: unknown;
    };

    const hasEncryptedShape =
      typeof encryptedCandidate.salt === 'string' &&
      typeof encryptedCandidate.iv === 'string' &&
      typeof encryptedCandidate.ciphertext === 'string';
    if (hasEncryptedShape) {
      const salt = encryptedCandidate.salt as string;
      const iv = encryptedCandidate.iv as string;
      const ciphertext = encryptedCandidate.ciphertext as string;
      const parsedIterations =
        typeof encryptedCandidate.iterations === 'number'
          ? encryptedCandidate.iterations
          : typeof encryptedCandidate.iterations === 'string'
            ? Number(encryptedCandidate.iterations)
            : Number.NaN;
      const iterations =
        Number.isFinite(parsedIterations) && parsedIterations > 0
          ? Math.floor(parsedIterations)
          : BURNER_PIN_PBKDF2_ITERATIONS;
      const version =
        typeof encryptedCandidate.version === 'number' && Number.isFinite(encryptedCandidate.version)
          ? Math.floor(encryptedCandidate.version)
          : BURNER_WALLET_STORAGE_VERSION;
      return {
        kind: 'encrypted',
        record: {
          version,
          salt,
          iv,
          ciphertext,
          iterations
        }
      };
    }

    const legacyVaultCandidate = parsed as {
      wallets?: unknown;
      activeWalletId?: unknown;
    };
    if (Array.isArray(legacyVaultCandidate.wallets)) {
      return {
        kind: 'legacy-vault',
        record: {
          wallets: legacyVaultCandidate.wallets as BurnerWalletRecord[],
          activeWalletId:
            typeof legacyVaultCandidate.activeWalletId === 'string'
              ? legacyVaultCandidate.activeWalletId
              : undefined
        }
      };
    }

    const legacyCandidate = parsed as { privateKey?: unknown; mnemonic?: unknown };
    const privateKey = typeof legacyCandidate.privateKey === 'string' ? legacyCandidate.privateKey.trim() : '';
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      return { kind: 'none' };
    }

    const mnemonic = typeof legacyCandidate.mnemonic === 'string' ? legacyCandidate.mnemonic.trim() : undefined;
    return {
      kind: 'legacy',
      record: { privateKey, mnemonic }
    };
  } catch {
    return { kind: 'none' };
  }
};

const deriveBurnerPinKey = async (
  pin: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[]
): Promise<CryptoKey> => {
  const { subtle } = getSecureWebCrypto();
  const pinMaterial = await subtle.importKey('raw', TEXT_ENCODER.encode(pin), 'PBKDF2', false, [
    'deriveKey'
  ]);

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256'
    },
    pinMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
};

const encryptBurnerWalletVault = async (vault: BurnerWalletVault, pin: string): Promise<EncryptedBurnerWalletRecord> => {
  const { webCrypto, subtle } = getSecureWebCrypto();
  const salt = webCrypto.getRandomValues(new Uint8Array(16));
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBurnerPinKey(pin, salt, BURNER_PIN_PBKDF2_ITERATIONS, ['encrypt']);

  const payload = JSON.stringify(vault);
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    TEXT_ENCODER.encode(payload)
  );

  return {
    version: BURNER_WALLET_STORAGE_VERSION,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iterations: BURNER_PIN_PBKDF2_ITERATIONS
  };
};

const decryptBurnerWalletVault = async (
  encryptedRecord: EncryptedBurnerWalletRecord,
  pin: string
): Promise<BurnerWalletVault> => {
  const salt = base64ToBytes(encryptedRecord.salt);
  const iv = base64ToBytes(encryptedRecord.iv);
  const ciphertext = base64ToBytes(encryptedRecord.ciphertext);
  const key = await deriveBurnerPinKey(pin, salt, encryptedRecord.iterations, ['decrypt']);
  const { subtle } = getSecureWebCrypto();

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext)
  );
  const rawPayload = TEXT_DECODER.decode(decrypted);
  const parsed = JSON.parse(rawPayload) as unknown;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid burner wallet payload.');
  }

  const asVault = parsed as { version?: unknown; wallets?: unknown; activeWalletId?: unknown };
  if (asVault.version === BURNER_WALLET_VAULT_VERSION && Array.isArray(asVault.wallets)) {
    return createBurnerWalletVault(
      asVault.wallets as BurnerWalletRecord[],
      typeof asVault.activeWalletId === 'string' ? asVault.activeWalletId : undefined
    );
  }

  const legacyRecord = parsed as { privateKey?: unknown; mnemonic?: unknown };
  const privateKey = typeof legacyRecord.privateKey === 'string' ? legacyRecord.privateKey.trim() : '';
  if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error('Invalid burner wallet private key format.');
  }

  return createBurnerWalletVault([
    {
      privateKey,
      mnemonic: typeof legacyRecord.mnemonic === 'string' ? legacyRecord.mnemonic.trim() : undefined
    }
  ]);
};

const loadBurnerWalletVaultFromStorage = async (pin: string): Promise<BurnerWalletVault> => {
  const storageState = parseBurnerWalletStorageState();
  if (storageState.kind === 'none') {
    throw new Error('No saved burner wallet found. Generate or import one first.');
  }

  if (storageState.kind === 'legacy') {
    return createBurnerWalletVault([storageState.record]);
  }

  if (storageState.kind === 'legacy-vault') {
    return createBurnerWalletVault(storageState.record.wallets, storageState.record.activeWalletId);
  }

  if (!pin.trim()) {
    throw new Error('Enter PIN to unlock burner wallet.');
  }

  try {
    return await decryptBurnerWalletVault(storageState.record, pin);
  } catch {
    throw new Error('Invalid PIN or corrupted burner wallet data.');
  }
};

const saveEncryptedBurnerWalletVault = async (vault: BurnerWalletVault, pin: string): Promise<void> => {
  if (!isBurnerStorageAvailable()) {
    throw new Error('Browser storage is unavailable. Disable private browsing or storage restrictions, then try again.');
  }
  const encrypted = await encryptBurnerWalletVault(vault, pin);
  try {
    window.localStorage.setItem(BURNER_WALLET_STORAGE_KEY, JSON.stringify(encrypted));
  } catch {
    throw new Error('Failed to persist wallet data in browser storage.');
  }
};


const trimReplyPreview = (text: string): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return '';
  }

  if (singleLine.length <= MAX_REPLY_PREVIEW_LENGTH) {
    return singleLine;
  }

  return `${singleLine.slice(0, MAX_REPLY_PREVIEW_LENGTH - 1)}…`;
};

const buildMessageWithReplyPayload = (plainText: string, replyToText?: string, replyToTxHash?: string): string => {
  const externalReplyPrefix = /^0x[a-fA-F0-9]{64}$/.test(replyToTxHash ?? '') ? `[r:${replyToTxHash}] ` : '';
  const preview = trimReplyPreview((replyToText ?? '').replace(REPLY_METADATA_PREFIX_REGEX, '').replace(/\]/g, ''));
  if (!preview) {
    return `${externalReplyPrefix}${plainText}`;
  }

  return `${externalReplyPrefix}${REPLY_METADATA_PREFIX}${preview}${REPLY_METADATA_PREFIX}<: ${plainText}`;
};

const encodeHiddenContactName = (contactName: string): string => {
  const bytes = TEXT_ENCODER.encode(contactName);
  let encoded = '';
  for (const byte of bytes) {
    for (let bitIndex = 7; bitIndex >= 0; bitIndex -= 1) {
      encoded += byte & (1 << bitIndex) ? CONTACT_NAME_ENCODING_ONE : CONTACT_NAME_ENCODING_ZERO;
    }
  }
  return encoded;
};

const decodeHiddenContactName = (encodedChunk: string): string | undefined => {
  if (!encodedChunk || encodedChunk.length % 8 !== 0) {
    return undefined;
  }

  const bytes = new Uint8Array(encodedChunk.length / 8);
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    let nextByte = 0;
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      const character = encodedChunk[byteIndex * 8 + bitIndex];
      if (character !== CONTACT_NAME_ENCODING_ZERO && character !== CONTACT_NAME_ENCODING_ONE) {
        return undefined;
      }
      if (character === CONTACT_NAME_ENCODING_ONE) {
        nextByte |= 1 << (7 - bitIndex);
      }
    }
    bytes[byteIndex] = nextByte;
  }

  const decoded = TEXT_DECODER.decode(bytes);
  return normalizeContactName(decoded)?.slice(0, 42);
};

const buildMessageWithContactNamePayload = (plainText: string, contactName?: string): string => {
  const normalizedContactName = normalizeContactName(contactName ?? '')?.slice(0, 42);
  if (!normalizedContactName) {
    return plainText;
  }
  const encodedContactName = encodeHiddenContactName(normalizedContactName);
  return `${CONTACT_NAME_METADATA_PREFIX}${encodedContactName}${CONTACT_NAME_METADATA_PREFIX}${plainText}`;
};

const parseContactNamePayload = (text: string): { cleanText: string; contactName?: string } => {
  if (!text.startsWith(CONTACT_NAME_METADATA_PREFIX)) {
    return { cleanText: text };
  }
  const metadataEnd = text.indexOf(CONTACT_NAME_METADATA_PREFIX, CONTACT_NAME_METADATA_PREFIX.length);
  if (metadataEnd <= CONTACT_NAME_METADATA_PREFIX.length) {
    return { cleanText: text };
  }
  const nameChunk = text.slice(CONTACT_NAME_METADATA_PREFIX.length, metadataEnd);
  const contactName =
    decodeHiddenContactName(nameChunk) ??
    normalizeContactName(nameChunk.trim())?.slice(0, 42);
  const remaining = text.slice(metadataEnd + CONTACT_NAME_METADATA_PREFIX.length);
  return { cleanText: remaining, contactName };
};

const parseMessageReplyPayload = (text: string): {
  cleanText: string;
  replyToText?: string;
  replyToMessageId?: string;
  replyToTxHash?: string;
} => {
  let workingText = text;
  let replyToTxHash: string | undefined;
  const externalMatch = workingText.match(EXTERNAL_REPLY_TXHASH_REGEX);
  if (externalMatch) {
    replyToTxHash = externalMatch[1];
    workingText = workingText.slice(externalMatch[0].length);
  }

  if (workingText.startsWith(REPLY_METADATA_PREFIX)) {
    const metadataEnd = workingText.indexOf(REPLY_METADATA_PREFIX, REPLY_METADATA_PREFIX.length);
    if (metadataEnd > REPLY_METADATA_PREFIX.length) {
      const metadataChunk = workingText.slice(REPLY_METADATA_PREFIX.length, metadataEnd);
      const previewChunk = trimReplyPreview(metadataChunk);
      const remainingRaw = workingText.slice(metadataEnd + REPLY_METADATA_PREFIX.length);
      const remaining = remainingRaw.startsWith('<: ')
        ? remainingRaw.slice(3)
        : remainingRaw.startsWith(': ')
          ? remainingRaw.slice(2)
          : remainingRaw;
      return {
        cleanText: remaining,
        replyToText: previewChunk || undefined,
        replyToTxHash
      };
    }
  }

  if (workingText.startsWith(LEGACY_REPLY_METADATA_PREFIX)) {
    const metadataEnd = workingText.indexOf(']', LEGACY_REPLY_METADATA_PREFIX.length);
    if (metadataEnd > LEGACY_REPLY_METADATA_PREFIX.length) {
      const metadataChunk = workingText.slice(LEGACY_REPLY_METADATA_PREFIX.length, metadataEnd);
      const separatorIndex = metadataChunk.indexOf('|');
      const hasLegacyIdChunk = separatorIndex > 0;
      const rawReplyId = hasLegacyIdChunk ? metadataChunk.slice(0, separatorIndex).trim() : '';
      const rawPreview = hasLegacyIdChunk ? metadataChunk.slice(separatorIndex + 1) : metadataChunk;
      const previewChunk = trimReplyPreview(rawPreview);
      const replyToMessageId = hasLegacyIdChunk && /^[a-zA-Z0-9-]+$/.test(rawReplyId) ? rawReplyId : undefined;
      const remainingRaw = workingText.slice(metadataEnd + 1);
      const remaining = remainingRaw.startsWith(' ') ? remainingRaw.slice(1) : remainingRaw;

      return {
        cleanText: remaining,
        replyToText: previewChunk || undefined,
        replyToMessageId,
        replyToTxHash
      };
    }
  }

  if (!workingText.startsWith(REPLY_DELIMITER)) {
    return { cleanText: workingText, replyToTxHash };
  }

  const delimiterEnd = workingText.indexOf(REPLY_DELIMITER, REPLY_DELIMITER.length);
  if (delimiterEnd < 0) {
    return { cleanText: workingText, replyToTxHash };
  }

  const previewChunk = trimReplyPreview(workingText.slice(REPLY_DELIMITER.length, delimiterEnd));
  const remainingRaw = workingText.slice(delimiterEnd + REPLY_DELIMITER.length);
  const remaining = remainingRaw.startsWith('<: ')
    ? remainingRaw.slice(3)
    : remainingRaw.startsWith(': ')
      ? remainingRaw.slice(2)
      : remainingRaw;

  return {
    cleanText: remaining,
    replyToText: previewChunk || undefined,
    replyToTxHash
  };
};

const parseMessageProfilePayload = (text: string): { cleanText: string; nickname?: string } => {
  if (text.startsWith(PROFILE_METADATA_PREFIX)) {
    const metadataEnd = text.indexOf(PROFILE_METADATA_PREFIX, PROFILE_METADATA_PREFIX.length);
    if (metadataEnd > PROFILE_METADATA_PREFIX.length) {
      const nicknameChunk = text.slice(PROFILE_METADATA_PREFIX.length, metadataEnd).trim();
      const nickname = normalizeContactName(nicknameChunk)?.slice(0, 42);
      const remaining = text.slice(metadataEnd + PROFILE_METADATA_PREFIX.length);
      return {
        cleanText: remaining,
        nickname
      };
    }
  }

  if (text.startsWith(LEGACY_PROFILE_METADATA_PREFIX)) {
    const metadataEnd = text.indexOf(']', LEGACY_PROFILE_METADATA_PREFIX.length);
    if (metadataEnd > LEGACY_PROFILE_METADATA_PREFIX.length) {
      const nicknameChunk = text.slice(LEGACY_PROFILE_METADATA_PREFIX.length, metadataEnd).trim();
      const nickname = normalizeContactName(nicknameChunk)?.slice(0, 42);
      const remainingRaw = text.slice(metadataEnd + 1);
      const remaining = remainingRaw.startsWith(' ') ? remainingRaw.slice(1) : remainingRaw;
      return {
        cleanText: remaining,
        nickname
      };
    }
  }

  if (text.startsWith(NICKNAME_DELIMITER)) {
    const delimiterEnd = text.indexOf(NICKNAME_DELIMITER, NICKNAME_DELIMITER.length);
    if (delimiterEnd < 0) {
      return { cleanText: text };
    }

    const nicknameChunk = text.slice(NICKNAME_DELIMITER.length, delimiterEnd).trim();
    const nickname = normalizeContactName(nicknameChunk)?.slice(0, 42);
    const remainingRaw = text.slice(delimiterEnd + NICKNAME_DELIMITER.length);
    const remaining = remainingRaw.startsWith(': ') ? remainingRaw.slice(2) : remainingRaw;
    return {
      cleanText: remaining,
      nickname
    };
  }

  if (text.startsWith(LEGACY_PROFILE_PLAIN_PREFIX)) {
    const newlineIndex = text.indexOf('\n');
    if (newlineIndex < 0) {
      return { cleanText: text };
    }

    const nicknameChunk = text.slice(LEGACY_PROFILE_PLAIN_PREFIX.length, newlineIndex).trim();
    const nickname = normalizeContactName(nicknameChunk)?.slice(0, 42);
    const remaining = text.slice(newlineIndex + 1);
    return {
      cleanText: remaining,
      nickname
    };
  }

  if (!text.startsWith(LEGACY_PROFILE_PREFIX)) {
    return { cleanText: text };
  }

  const newlineIndex = text.indexOf('\n');
  if (newlineIndex < 0) {
    return { cleanText: text };
  }

  const jsonChunk = text.slice(LEGACY_PROFILE_PREFIX.length, newlineIndex).trim();
  const remaining = text.slice(newlineIndex + 1);
  try {
    const parsed = JSON.parse(jsonChunk) as { nick?: unknown };
    const nickname = typeof parsed.nick === 'string' ? normalizeContactName(parsed.nick)?.slice(0, 42) : undefined;
    return {
      cleanText: remaining,
      nickname
    };
  } catch {
    return { cleanText: text };
  }
};

const parseChatMessagePayload = (text: string): {
  cleanText: string;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  embeddedNickname?: string;
  embeddedContactName?: string;
} => {
  const contactNameParsed = parseContactNamePayload(text);
  const profileParsed = parseMessageProfilePayload(contactNameParsed.cleanText);
  const replyParsed = parseMessageReplyPayload(profileParsed.cleanText);

  return {
    cleanText: replyParsed.cleanText,
    replyToMessageId: replyParsed.replyToMessageId,
    replyToText: replyParsed.replyToText,
    replyToTxHash: replyParsed.replyToTxHash,
    embeddedNickname: profileParsed.nickname,
    embeddedContactName: contactNameParsed.contactName
  };
};

const getMessageDisplayText = (text: string): string => {
  if (text.startsWith(IMAGE_MESSAGE_PREFIX)) {
    return '[Image disabled for security]';
  }

  return text;
};

export default function App() {
  const MOBILE_NAV_BREAKPOINT_PX = 920;
    // Telegram bot link
    const telegramBotLink = 'https://t.me/CipherTrade_bot';
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newContact, setNewContact] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [activeContact, setActiveContact] = useState<string | null>(null);
  const [editingContactAddress, setEditingContactAddress] = useState<string | null>(null);
  const [editingContactName, setEditingContactName] = useState('');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('Disconnected');
  const [burnerMnemonicBackup, setBurnerMnemonicBackup] = useState('');
  const [showBurnerMnemonic, setShowBurnerMnemonic] = useState(false);
  const [burnerImportInput, setBurnerImportInput] = useState('');
  const [burnerWallets, setBurnerWallets] = useState<BurnerWalletRecord[]>([]);
  const [activeBurnerWalletId, setActiveBurnerWalletId] = useState('');
  const [showBurnerImportModal, setShowBurnerImportModal] = useState(false);
  const [burnerStorageBlocked, setBurnerStorageBlocked] = useState<boolean>(() => !isBurnerStorageAvailable());
  const [showBurnerPinModal, setShowBurnerPinModal] = useState(false);
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
  const [persistedContactOrder, setPersistedContactOrder] = useState<string[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, boolean>>({});
  const [lastReadAllTs, setLastReadAllTs] = useState(0);
  const lastReadAllTsRef = useRef(0);
  const lastReadByContactRef = useRef<Record<string, number>>({});
  const unreadMapRef = useRef<Record<string, boolean>>({});
  const SOUND_ENABLED_STORAGE_KEY = 'coti-chat-sound-enabled';
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
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [syncingData, setSyncingData] = useState(false);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [topUpAmountWei, setTopUpAmountWei] = useState<bigint | null>(null);
  const [requiredFeeWei, setRequiredFeeWei] = useState<bigint | null>(null);
  const [burnerBalanceWei, setBurnerBalanceWei] = useState<bigint | null>(null);
  const [topUpMultiplier, setTopUpMultiplier] = useState(20);
  const [loadingTopUpQuote, setLoadingTopUpQuote] = useState(false);
  const [topUpMetricsNonce, setTopUpMetricsNonce] = useState(0);
  const [backingUpState, setBackingUpState] = useState(false);
  const [error, setError] = useState<string>('');
  const [activeMobileView, setActiveMobileView] = useState<MobileView>('wallets');
  const [mobileLinksOpen, setMobileLinksOpen] = useState(false);
  const [isMobileNav, setIsMobileNav] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_NAV_BREAKPOINT_PX : false
  );
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

  const prevUnreadRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    unreadMapRef.current = unreadMap || {};
  }, [unreadMap]);

  useEffect(() => {
    const prev = prevUnreadRef.current || {};
    const next = unreadMap || {};
    for (const k of Object.keys(next)) {
      if (next[k] && !prev[k]) {
        if (!suppressSoundOnConnectRef.current) {
          playNotificationSound();
        }
        break;
      }
    }
    prevUnreadRef.current = { ...next };
  }, [unreadMap, soundEnabled]);

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
  const oldestLoadedBlockByContactRef = useRef<Record<string, number>>({});
  const hasOlderHistoryByContactRef = useRef<Record<string, boolean>>({});
  const loadingOlderHistoryRef = useRef(false);
  const blockTimestampCacheRef = useRef<Map<number, number>>(new Map());
  const requiredFeeCacheRef = useRef<bigint | null>(null);
  const requiredFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const nicknameMaxBytesRequestRef = useRef<Promise<number> | null>(null);
  const nicknameMaxBytesLoadedRef = useRef(false);
  const submitSelectorRef = useRef<string | null>(null);
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

  useEffect(() => {
    currentWalletKeyRef.current = walletAddress.trim().toLowerCase();
  }, [walletAddress]);

  const isConnected = useMemo(() => walletAddress.length > 0, [walletAddress]);
  const onCotiNetwork = useMemo(() => chainId === COTI_NETWORK.chainIdDecimal, [chainId]);
  const activeMessages = useMemo(() => {
    if (!activeContact) {
      return [];
    }
    return messagesByContact[activeContact.toLowerCase()] ?? [];
  }, [activeContact, messagesByContact]);
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
  const activeContactMeta = useMemo(
    () => contacts.find((contact) => contact.address.toLowerCase() === activeContact?.toLowerCase()),
    [contacts, activeContact]
  );
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
  const hasSavedBurnerWallet = useMemo(
    () => !burnerStorageBlocked && parseBurnerWalletStorageState().kind !== 'none',
    [burnerWallets, burnerStorageBlocked]
  );
  const findContactNameForWalletAddress = (address?: string): string | undefined => {
    if (!address) {
      return undefined;
    }

    return contacts.find((contact) => contact.address.toLowerCase() === address.toLowerCase())?.name;
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
  const estimatedMessagesLeft = useMemo(() => {
    if (requiredFeeWei === null || burnerBalanceWei === null || requiredFeeWei <= 0n) {
      return null;
    }

    return burnerBalanceWei / requiredFeeWei;
  }, [requiredFeeWei, burnerBalanceWei]);
  const isStatusConnected = useMemo(() => /^connected/i.test(status.trim()), [status]);
  const isAesConnected = useMemo(() => onboardStatus === 'AES key ready', [onboardStatus]);

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
      void (async () => {
        try {
          setMyNickname(await loadMyNicknameFromChain(connectedAddress));
          await restoreStateFromChainSelfBackupWithRetry(connectedAddress, 4, 900);
          await syncConversationHistoryRef.current({
            contactsOnly: true,
            previewPerContact: true,
            updateHead: true,
            background: true
          });
          await syncConversationHistoryRef.current({ deep: true, background: true });
          await restoreStateFromChainSelfBackupWithRetry(connectedAddress, 4, 900);
        } catch {
          // Post-onboarding sync failures should not block a successful burner unlock.
        } finally {
          runPostConnectDataSyncUntilApplied(connectedAddress).catch(() => {});
        }
      })();
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

    const nextPinMode: BurnerPinMode = mode === 'stored' && storageState.kind === 'encrypted' ? 'unlock' : 'set';

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
      // performing a delayed re-sync. This avoids the need for a manual
      // refresh in some environments where state updates race.
      setTimeout(() => {
        try {
          syncConversationHistoryRef.current({ deep: true }).catch(() => {});
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
    if (!activeContact) {
      return;
    }

    let targetId = replyToMessageId;
    if (!targetId && replyToTxHash) {
      const normalizedReplyTxHash = replyToTxHash.toLowerCase();
      const matchedByTxHash = activeMessages.find((message) => message.txHash?.toLowerCase() === normalizedReplyTxHash);
      targetId = matchedByTxHash?.id;
    }

    if (!targetId && replyToText) {
      const targetPreview = trimReplyPreview(replyToText);
      const matched = activeMessages.find((message) => trimReplyPreview(getMessageDisplayText(message.text)) === targetPreview);
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
    const normalizedAddress = address.toLowerCase();
    const hasConversationHistory = (messagesByContact[normalizedAddress]?.length ?? 0) > 0;

    if (hasConversationHistory) {
      const confirmed = window.confirm(
        'This contact has conversation history. Remove it from contacts anyway? Messages will stay in local history.'
      );
      if (!confirmed) {
        return;
      }
    }

    setContacts((previous) =>
      previous.filter((contact) => contact.address.toLowerCase() !== normalizedAddress)
    );

    if (activeContact?.toLowerCase() === normalizedAddress) {
      setActiveContact(null);
    }

    if (editingContactAddress?.toLowerCase() === normalizedAddress) {
      cancelRenameContact();
    }
  };

  const copyAddressToClipboard = async (address: string) => {
    setError('');

    try {
      await navigator.clipboard.writeText(address);
    } catch {
      try {
        const tempInput = document.createElement('textarea');
        tempInput.value = address;
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.focus();
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      } catch {
        setError('Could not copy address to clipboard.');
      }
    }
  };

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

    if (Object.keys(nextUnread).length === 0 && readAtTs > lastReadAllTsRef.current) {
      lastReadAllTsRef.current = readAtTs;
      setLastReadAllTs((previous) => (readAtTs > previous ? readAtTs : previous));
    }
  }, [messagesByContact]);

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

  const activateContact = useCallback((contactAddress: string) => {
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
      setMyNickname(await loadMyNicknameFromChain(selected));
      await restoreStateFromChainSelfBackupWithRetry(selected, 4, 900);
      await syncConversationHistory({
        contactsOnly: true,
        previewPerContact: true,
        updateHead: true
      });
      await syncConversationHistory({ deep: true });
      await restoreStateFromChainSelfBackupWithRetry(selected, 4, 900);
      runPostConnectDataSyncUntilApplied(selected).catch(() => {});
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
      const latestSelfConversationBlock = toSafeNumber(
        await contract.getLastBlockForConversation(targetAddress, targetAddress)
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
        const headBlock = Math.min(latestBlock, latestSelfConversationBlock);
        const headLogs = await contract.queryFilter(selfFilter, headBlock, headBlock);
        await tryDecodeBackupLogs(headLogs as Array<{ blockNumber: number; index: number; args?: Record<string, unknown> }>);
      }

      let windowEnd = latestBlock;
      while (windowEnd >= 0 && !latestPayload) {
        const windowStart = Math.max(0, windowEnd - SELF_BACKUP_RESTORE_BLOCK_WINDOW + 1);
        const windowLogs = await contract.queryFilter(selfFilter, windowStart, windowEnd);
        await tryDecodeBackupLogs(windowLogs as Array<{ blockNumber: number; index: number; args?: Record<string, unknown> }>);

        if (windowStart === 0) {
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

  const restoreStateFromChainSelfBackupWithRetry = async (
    address?: string,
    attempts = 3,
    retryDelayMs = 800
  ): Promise<boolean> => {
    for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
      const restored = await restoreStateFromChainSelfBackup(address);
      if (restored) {
        return true;
      }

      if (attemptIndex < attempts - 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, retryDelayMs);
        });
      }
    }
    return false;
  };

  const runPostConnectDataSyncUntilApplied = async (address: string): Promise<void> => {
    const targetAddress = address.trim().toLowerCase();
    if (!isWalletAddress(targetAddress)) {
      return;
    }

    const runId = ++postConnectDataSyncRunIdRef.current;

    for (let attemptIndex = 0; attemptIndex < 10; attemptIndex += 1) {
      if (runId !== postConnectDataSyncRunIdRef.current) {
        return;
      }

      if (currentWalletKeyRef.current !== targetAddress) {
        return;
      }

      const restored = await restoreStateFromChainSelfBackupWithRetry(targetAddress, 3, 700);
      if (restored) {
        return;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1200);
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
      if (!options?.background) {
        setBackingUpState(true);
      }

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
      if (!options?.background) {
        setBackingUpState(false);
      }
    }
  };

  const syncConversationHistory = async (options?: SyncConversationOptions) => {
    setError('');
    debugLog('[sync] start', { walletAddress, options, hasAesReady, chainId });

    if (!walletAddress) {
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

      const walletKey = walletAddress.toLowerCase();
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

      const incomingFilter = contract.filters.MessageSubmitted(walletAddress, null);
      const outgoingFilter = contract.filters.MessageSubmitted(null, walletAddress);

      const [incomingLogs, outgoingLogs] = await Promise.all([
        contract.queryFilter(incomingFilter, fromBlock, toBlock),
        contract.queryFilter(outgoingFilter, fromBlock, toBlock)
      ]);

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

      const discoveredContacts = new Set<string>();
      const discoveredNicknames = new Map<string, string>();
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
              if (messageText.trim().length === 0 && parsedMessage.embeddedContactName) {
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
            if (messageText.trim().length === 0 && parsedMessage.embeddedContactName) {
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
              if (parsedMessage.embeddedContactName) {
                discoveredNicknames.set(contactKey, parsedMessage.embeddedContactName);
              }
              if (messageText.trim().length === 0 && parsedMessage.embeddedContactName) {
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
            if (parsedMessage.embeddedContactName) {
              discoveredNicknames.set(recipient.toLowerCase(), parsedMessage.embeddedContactName);
            }
            if (messageText.trim().length === 0 && parsedMessage.embeddedContactName) {
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
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          timestamp: blockTimestampMap.get(log.blockNumber)
        });
      }

      if (shouldLoadContactPreviews) {
        entries.push(...previewByContact.values());
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
          hasOlderHistoryByContactRef.current[contactKey] = true;
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
                  (candidate.replyToTxHash ?? '') !== (entry.replyToTxHash ?? '')
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
                replyToMessageId: entry.replyToMessageId,
                replyToText: entry.replyToText,
                replyToTxHash: entry.replyToTxHash,
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
      const nicknameLookupAddresses = Array.from(new Set([...Array.from(discoveredContacts), ...contacts.map((c) => c.address)]));
      const onChainNicknames = await fetchOnChainNicknames(nicknameLookupAddresses);

      setContacts((previous) => {
        const mergedContacts = mergeUniqueContacts(previous, Array.from(discoveredContacts));

        if (discoveredNicknames.size === 0) {
          if (onChainNicknames.size === 0) {
            return mergedContacts;
          }

          return mergedContacts.map((contact) => {
            if (contact.name) {
              return contact;
            }

            const onChainNickname = onChainNicknames.get(contact.address.toLowerCase());
            if (!onChainNickname) {
              return contact;
            }

            return {
              ...contact,
              name: onChainNickname
            };
          });
        }

        return mergedContacts.map((contact) => {
          if (contact.name) {
            return contact;
          }

          const key = contact.address.toLowerCase();
          const nickname = discoveredNicknames.get(key) ?? onChainNicknames.get(key);
          if (nickname) {
            return { ...contact, name: nickname };
          }

          return contact;
        });
      });

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
          const shouldUnread = latestMessageTime > effectiveReadTs && !(address === activeKey && pageVisible);
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

    const walletKey = walletAddress.toLowerCase();
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
      const conversationLastBlock = toSafeNumber(
        await contract.getLastBlockForConversation(walletAddress, contactAddress)
      );
      if (conversationLastBlock <= 0) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }
      const cappedConversationLastBlock = Math.min(latestBlock, conversationLastBlock);

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
      if (toBlock < 0) {
        hasOlderHistoryByContactRef.current[contactKey] = false;
        return;
      }

      const fromBlock = Math.max(0, toBlock - HISTORY_PAGINATION_BLOCK_WINDOW + 1);

      const incomingFilter = contract.filters.MessageSubmitted(walletAddress, contactAddress);
      const outgoingFilter = contract.filters.MessageSubmitted(contactAddress, walletAddress);
      const [incomingLogs, outgoingLogs] = await Promise.all([
        contract.queryFilter(incomingFilter, fromBlock, toBlock),
        contract.queryFilter(outgoingFilter, fromBlock, toBlock)
      ]);

      oldestLoadedBlockByContactRef.current[contactKey] = fromBlock;
      if (fromBlock === 0) {
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
            if (messageText.trim().length === 0 && parsedMessage.embeddedContactName) {
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
            if (parsedMessage.embeddedContactName) {
              discoveredNicknames.set(recipient.toLowerCase(), parsedMessage.embeddedContactName);
            }
            if (messageText.trim().length === 0 && parsedMessage.embeddedContactName) {
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
              replyToMessageId: entry.replyToMessageId,
              replyToText: entry.replyToText,
              replyToTxHash: entry.replyToTxHash,
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

      const onChainNicknames = await fetchOnChainNicknames([contactAddress]);
      const onChainNicknameForContact = onChainNicknames.get(contactKey);

      if (discoveredNicknames.size > 0 || onChainNicknameForContact) {
        setContacts((previous) =>
          previous.map((contact) => {
            if (contact.name) {
              return contact;
            }

            const nickname =
              discoveredNicknames.get(contact.address.toLowerCase()) ??
              onChainNicknames.get(contact.address.toLowerCase());
            if (!nickname) {
              return contact;
            }

            return {
              ...contact,
              name: nickname
            };
          })
        );
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
      if (activeSignerSource === 'burner') {
        setTopUpMetricsNonce((previous) => previous + 1);
      }
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

  const loadFullConversationHistory = async () => {
    if (syncingHistoryRef.current) {
      return;
    }

    await syncConversationHistory({ deep: true });
  };

  const syncDataFromChainBackup = async () => {
    if (syncingData) {
      return;
    }

    setError('');
    setSyncingData(true);
    try {
      await restoreStateFromChainSelfBackupWithRetry(undefined, 4, 900);
    } finally {
      setSyncingData(false);
    }
  };

  const saveProfileStateOnChain = async () => {
    setError('');
    await backupLocalStateToSelf();
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
    setPersistedContactOrder([]);
    setActiveContact(null);
  }, [walletAddress]);

  useEffect(() => {
    setUnreadMap({});
    unreadMapRef.current = {};
    setLastReadAllTs(0);
    prevUnreadRef.current = {};
    lastReadAllTsRef.current = 0;
    lastReadByContactRef.current = {};
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

    const exists = contacts.some((contact) => contact.address.toLowerCase() === activeContact.toLowerCase());
    if (!exists) {
      setActiveContact(null);
    }
  }, [contacts, activeContact]);

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
  }, [activeContact]);

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
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
      if (readStateBackupTimerRef.current !== null) {
        window.clearTimeout(readStateBackupTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const activeContactChanged = previousActiveContactForScrollRef.current !== activeContact;
    const currentLastMessageId = activeMessages.length > 0 ? activeMessages[activeMessages.length - 1].id : null;
    const latestMessageChanged = previousLastMessageIdForScrollRef.current !== currentLastMessageId;
    if (activeContactChanged) {
      stickToBottomRef.current = true;
      previousActiveContactForScrollRef.current = activeContact;
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
  }, [activeContact, activeMessages]);

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

      const lastMessage = activeMessages.length > 0 ? activeMessages[activeMessages.length - 1] : null;
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
  }, [activeContact, activeMessages]);

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
  }, [activeContact]);

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
      blockTimestampCacheRef.current = new Map();
    }

    previousWalletAddressRef.current = nextWallet;
  }, [walletAddress]);

  useEffect(() => {
    if (!isConnected || !activeContact) {
      return;
    }

    stickToBottomRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollChatToBottom();
      });
    });
  }, [isConnected, activeContact]);

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

        if (Date.now() - cotiWsLastHealthyAt > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        cotiWsLastHealthyAt = Date.now();

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
        if (Date.now() - cotiWsLastHealthyAt > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        cotiWsLastHealthyAt = Date.now();
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

  return (
    <div className={`app-shell mobile-view-${activeMobileView}`}>
      <header className="top-header" ref={topHeaderRef}>
        <div className="top-header-brand">
          <div className="top-header-section top-header-branding">
            <span className="top-header-brand-title">ChainWhisper</span>
            <span className="top-header-brand-subtitle">powered by COTI</span>
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
            <strong className={isStatusConnected ? 'status-with-dot' : undefined}>
              {status}
              {isStatusConnected ? <span className="status-dot" aria-hidden="true" /> : null}
            </strong>
          </div>
          <div className="meta-row">
            <span>AES</span>
            <strong className={isAesConnected ? 'status-with-dot' : undefined}>
              {onboardStatus}
              {isAesConnected ? <span className="status-dot" aria-hidden="true" /> : null}
            </strong>
          </div>
          <div className="meta-row">
            <span>Address</span>
            {walletAddress ? (
              <button
                type="button"
                className="burner-address-btn"
                onClick={() => copyAddressToClipboard(walletAddress)}
                title={walletAddress}
              >
                {shortenAddress(walletAddress)}
              </button>
            ) : (
              <strong>—</strong>
            )}
          </div>
        </div>

        <div className="wallet-meta">
          <div className="wallet-section-group">
            <button
              className="connect-btn"
              onClick={() => {
                beginBurnerPinFlow('generate').catch(() => {});
              }}
              type="button"
              disabled={initializingBurner || burnerStorageBlocked}
            >
              {initializingBurner ? 'Initializing Wallet...' : 'Generate Wallet'}
            </button>

            <button
              className="connect-btn"
              onClick={() => {
                beginBurnerPinFlow('stored').catch(() => {});
              }}
              type="button"
              disabled={initializingBurner || burnerStorageBlocked || !hasSavedBurnerWallet}
            >
              Connect Wallet
            </button>

            <button
              className="connect-btn"
              onClick={() => setShowBurnerImportModal(true)}
              type="button"
              disabled={initializingBurner || burnerStorageBlocked}
            >
              Import Wallet
            </button>

            <button
              className="connect-btn"
              onClick={openChangeBurnerPin}
              type="button"
              disabled={initializingBurner || !burnerRecordRef.current}
            >
              Change PIN
            </button>
          </div>

          <div className="wallet-section-group wallet-section-group-metamask">
            <button
              className="connect-btn"
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

            <button className="connect-btn" onClick={disconnectWallet} type="button" disabled={!isConnected || connectingMethod !== null}>
              Disconnect
            </button>
          </div>
          {burnerStorageBlocked ? (
            <p className="error">
              Browser storage is blocked. Disable private mode or storage restrictions to persist wallets.
            </p>
          ) : null}
        </div>

        <div className="wallet-meta">
          {burnerWallets.length > 0 ? (
            <>
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
            </>
          ) : null}
        </div>

        <div className="wallet-meta topup-meta">
          <button
            className="connect-btn"
            onClick={topUpBurnerWithMetaMask}
            type="button"
            disabled={initializingBurner || !burnerAddress}
          >
            Top Up with MetaMask
          </button>
          <div className="meta-row">
            <span>Top up scale</span>
            <strong>x{topUpMultiplier}</strong>
          </div>
          <input
            className="topup-slider"
            type="range"
            min={1}
            max={100}
            step={1}
            value={topUpMultiplier}
            onChange={(event) => setTopUpMultiplier(Number(event.target.value))}
            aria-label="Top up multiplier"
          />
          <p>Approx messages per top up: {topUpMultiplier}</p>
          <div className="meta-row">
            <span>Wallet balance</span>
            <strong>
              {loadingTopUpQuote
                ? 'Calculating...'
                : burnerBalanceWei !== null
                  ? `${formatCotiAmount(burnerBalanceWei)} COTI`
                  : '—'}
            </strong>
          </div>
          <div className="meta-row">
            <span>Messages left</span>
            <strong>
              {loadingTopUpQuote
                ? 'Calculating...'
                : estimatedMessagesLeft !== null
                  ? estimatedMessagesLeft.toString()
                  : '—'}
            </strong>
          </div>
          <div className="meta-row">
            <span>Top up amount</span>
            <strong>
              {loadingTopUpQuote
                ? 'Calculating...'
                : topUpAmountWei !== null
                  ? `${formatCotiAmount(topUpAmountWei)} COTI`
                  : '—'}
            </strong>
          </div>
        </div>

        {burnerNeedsFunding ? <p className="error">Burner needs funding before onboarding.</p> : null}
        {burnerMnemonicBackup ? (
          <div className="wallet-meta">
            <div className="meta-row">
              <span>Burner backup</span>
              <button
                type="button"
                className="burner-address-btn"
                onClick={beginRevealBurnerBackup}
              >
                {showBurnerMnemonic ? 'Hide phrase' : 'Show phrase'}
              </button>
            </div>
            <p className="wallet-reminder">
              Reminder: Save your seed phrase securely offline. You need it to recover this wallet.
            </p>
            {showBurnerMnemonic ? <p>{burnerMnemonicBackup}</p> : null}
          </div>
        ) : null}

      </aside>

      {isConnected ? (
      <aside className="contacts-sidebar">
        <div className="contact-profile-card">
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="contact"
              onClick={() => {
                saveProfileStateOnChain().catch(() => {});
              }}
              disabled={!hasAesReady || backingUpState}
            >
              {backingUpState ? 'Saving on chain...' : 'Save on chain'}
            </button>
            <button
              type="button"
              className="contact"
              onClick={() => {
                syncDataFromChainBackup().catch(() => {});
              }}
              disabled={!hasAesReady || syncingData || syncingHistory}
            >
              {syncingData ? 'Syncing...' : 'Sync Data'}
            </button>
          </div>
        </div>

        <form className="contact-form" onSubmit={handleAddContact}>
          <input
            value={newContactName}
            onChange={(event) => setNewContactName(event.target.value)}
            placeholder="Contact name (optional)"
            aria-label="Contact name"
          />
          <input
            value={newContact}
            onChange={(event) => setNewContact(event.target.value)}
            placeholder="0x... wallet address"
            aria-label="Wallet address"
          />
          <button type="submit">Save Contact</button>
        </form>

        <ul className="contacts-list">
          {sortedContacts.map((contact) => {
            const isActive = activeContact?.toLowerCase() === contact.address.toLowerCase();
            const isEditing = editingContactAddress?.toLowerCase() === contact.address.toLowerCase();
            const hasName = Boolean(contact.name?.trim());
            const hasConversation = (messagesByContact[contact.address.toLowerCase()]?.length ?? 0) > 0;
            return (
              <li key={contact.address}>
                <div
                  className={isActive ? 'contact-card active' : 'contact-card'}
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
                            className="contact-copy contact-copy-secondary"
                            onClick={(event) => {
                              event.stopPropagation();
                              copyAddressToClipboard(contact.address);
                            }}
                            title="Copy address"
                          >
                            {shortenAddress(contact.address)}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="contact-copy"
                          onClick={(event) => {
                            event.stopPropagation();
                            copyAddressToClipboard(contact.address);
                          }}
                          title="Copy address"
                        >
                          {shortenAddress(contact.address)}
                        </button>
                      )}
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
                          aria-label="Rename contact"
                          title="Rename"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="contact-icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeContact(contact.address);
                          }}
                          aria-label="Remove contact"
                          title="Remove"
                        >
                          🗑
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
          })}
        </ul>

        {error ? <p className="error">{error}</p> : null}
      </aside>
      ) : null}

      <main className="chat-panel">
        {!isConnected ? (
          <div className="chat-placeholder">Connect a wallet to view contacts and start messaging.</div>
        ) : activeContact ? (
          <div className="chat-shell">
            <div className="chat-header">
              <strong>
                {isSelfChat
                  ? `${activeContactMeta?.name ? `${activeContactMeta.name} (${shortenAddress(activeContact)})` : shortenAddress(activeContact)} (self)`
                  : `${activeContactMeta?.name ? `${activeContactMeta.name} (${shortenAddress(activeContact)})` : shortenAddress(activeContact)}`}
              </strong>
              <button
                type="button"
                className="contact"
                onClick={loadFullConversationHistory}
                disabled={syncingHistory || syncingData}
              >
                {syncingHistory ? 'Syncing...' : 'Sync History'}
              </button>
            </div>

            <div
              className="chat-messages"
              ref={chatMessagesRef}
              onClick={() => markConversationAsRead(activeContact)}
            >
              {loadingOlderHistory ? <p className="chat-empty">Loading older messages...</p> : null}
              {activeMessages.length === 0 ? (
                <p className="chat-empty">No messages yet.</p>
              ) : (
                activeMessages.map((message) => {
                  const messageDisplayText = getMessageDisplayText(message.text);
                  const parsedImageTag = parseImageTag(message.text);
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
                        <button
                          type="button"
                          className="message-reply-action"
                          onClick={() => setReplyingToMessage(message)}
                          aria-label="Reply to this message"
                          title="Reply"
                        >
                          ↩
                        </button>
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

            <div className="chat-compose">
              {replyingToMessage ? (
                <div className="chat-replying">
                  <span>Replying to: {trimReplyPreview(getMessageDisplayText(replyingToMessage.text))}</span>
                  <button type="button" onClick={() => setReplyingToMessage(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}
              <div
                ref={chatComposerRef}
                className="chat-compose-editor"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline={isMobileNav}
                aria-label="Message"
                data-placeholder="Type a message"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !isMobileNav) {
                    event.preventDefault();
                    sendMessage().catch(() => {});
                  }
                }}
                onInput={(event) => {
                  const raw = event.currentTarget.textContent ?? '';
                  const normalized = raw.replace(/\r/g, '');
                  const nextValue = isMobileNav ? normalized : normalized.replace(/\n/g, '');
                  const capped = nextValue.slice(0, MAX_MESSAGE_LENGTH);
                  if (capped !== raw) {
                    event.currentTarget.textContent = capped;
                  }
                  setMessageInput(capped);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  sendMessage().catch(() => {});
                }}
                disabled={sending}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        ) : (
          <div className="chat-placeholder">Select a contact to start messaging.</div>
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

      {showBurnerImportModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!initializingBurner) {
              setShowBurnerImportModal(false);
            }
          }}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Import Burner Wallet</h3>
            <input
              value={burnerImportInput}
              onChange={(event) => setBurnerImportInput(event.target.value)}
              placeholder="Mnemonic phrase or 0x private key"
              aria-label="Import burner wallet"
            />
            {error ? <p className="error">{error}</p> : null}
            <div className="modal-actions">
              <button
                type="button"
                className="connect-btn"
                onClick={() => setShowBurnerImportModal(false)}
                disabled={initializingBurner}
              >
                Cancel
              </button>
              <button type="button" className="connect-btn" onClick={importBurnerWallet} disabled={initializingBurner}>
                {initializingBurner ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showBurnerPinModal ? (
        <div className="modal-backdrop" onClick={closeBurnerPinModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>{burnerPinMode === 'set' ? 'Set PIN' : 'Unlock Wallet'}</h3>
            {error ? <p className="error">{error}</p> : null}
            <input
              value={burnerPinInput}
              name={burnerPinMode === 'set' ? 'pin-new' : 'pin-unlock'}
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]*"
              data-form-type="other"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              onChange={(event) => setBurnerPinInput(event.target.value)}
              placeholder={burnerPinMode === 'set' ? `Choose PIN (${BURNER_PIN_MIN_LENGTH}+ digits)` : 'Enter PIN'}
              aria-label="Wallet PIN"
              type="password"
            />
            <div className="modal-actions">
              <button type="button" className="connect-btn" onClick={closeBurnerPinModal} disabled={initializingBurner}>
                Cancel
              </button>
              <button
                type="button"
                className="connect-btn"
                onClick={() => {
                  submitBurnerPinAndInitialize().catch(() => {});
                }}
                disabled={initializingBurner}
              >
                {initializingBurner ? 'Please wait...' : burnerPinMode === 'set' ? 'Save & Connect' : 'Unlock'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
