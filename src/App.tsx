import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserProvider, JsonRpcSigner, OnboardInfo, Wallet } from '@coti-io/coti-ethers';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  connect?: () => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
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

const CONTACTS_STORAGE_KEY = 'coti-chat-contacts';
const ACTIVE_CONTACT_STORAGE_KEY = 'coti-chat-active-contact';
const BURNER_WALLET_STORAGE_KEY = 'coti-chat-burner-wallet';
const BURNER_WALLET_STORAGE_VERSION = 2;
const BURNER_WALLET_VAULT_VERSION = 1;
const BURNER_PIN_MIN_LENGTH = 5;
const LEGACY_BURNER_PIN_MIN_LENGTH = 4;
const BURNER_PIN_PBKDF2_ITERATIONS = 250000;
const PROFILE_STORAGE_KEY = 'coti-chat-profile';
const PROFILE_SHARED_STORAGE_KEY = 'coti-chat-profile-shared';
const AUTO_SYNC_INTERVAL_MS = 30000;
const INITIAL_SYNC_LOOKBACK_BLOCKS = 2500;
const HISTORY_PAGINATION_BLOCK_WINDOW = 10000;
const SELF_BACKUP_RESTORE_BLOCK_WINDOW = 20000;
const GRADUAL_CONTACT_DISCOVERY_BLOCK_WINDOW = 50000;
const GRADUAL_CONTACT_DISCOVERY_WINDOWS_PER_TICK = 2;
const GRADUAL_CONTACT_DISCOVERY_DELAY_MS = 120;
const NICKNAME_DELIMITER = '\u001f';
const REPLY_DELIMITER = '\u001e';
const PROFILE_METADATA_PREFIX = '\u2063';
const REPLY_METADATA_PREFIX = '\u2064';
const LEGACY_PROFILE_METADATA_PREFIX = '[nick:';
const LEGACY_REPLY_METADATA_PREFIX = '[reply:';
const LEGACY_PROFILE_PREFIX = '[[coti-profile:v1]]';
const LEGACY_PROFILE_PLAIN_PREFIX = '[[coti-nick:v1]]';
const IMAGE_MESSAGE_PREFIX = '[[coti-image:v1]]';
const STATE_BACKUP_PREFIX = '[[coti-state:v1]]';
const STATE_BACKUP_VERSION = 1;
const MAX_REPLY_PREVIEW_LENGTH = 28;
const COTI_WEI = 10n ** 18n;
const MIN_BURNER_TOP_UP_WEI = 1_000_000_000_000_000n;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const PROFILE_METADATA_PREFIX_REGEX = new RegExp(PROFILE_METADATA_PREFIX, 'g');
const REPLY_METADATA_PREFIX_REGEX = new RegExp(REPLY_METADATA_PREFIX, 'g');
const EXTERNAL_REPLY_TXHASH_REGEX = /^\[r:(0x[a-fA-F0-9]{64})\]\s*/;

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

type BurnerWalletStorageState =
  | { kind: 'none' }
  | { kind: 'legacy'; record: BurnerWalletRecord }
  | { kind: 'encrypted'; record: EncryptedBurnerWalletRecord };

type UserProfile = {
  nickname: string;
};

type BurnerInitMode = 'generate' | 'import' | 'stored';
type SignerSource = 'burner' | 'metamask';
type BurnerPinMode = 'set' | 'unlock';
type BurnerInitResult = 'connected' | 'needs-funding' | 'failed';
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
  background?: boolean;
  fromBlock?: number;
  toBlock?: number;
};

type StateBackupPayload = {
  version: number;
  updatedAt: number;
  nickname: string;
  contacts: Contact[];
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

const CHAT_CONTRACT_ADDRESS = '0x81DEfBfba1cdc5AF972566342F4935853E02923d';
const CHAT_CONTRACT_ABI = [
  'function submit(address recipient, ((uint256[] value), bytes[] signature) memo) payable',
  'function feeAmount() view returns (uint256)',
  'event MessageSubmitted(address indexed recipient, address indexed from, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForRecipient, ((uint256[] value) ciphertext, (uint256[] value) userCiphertext) messageForSender)'
] as const;

type CotiEthersModule = typeof import('@coti-io/coti-ethers');
type CotiWsProvider = InstanceType<CotiEthersModule['WebSocketProvider']>;
type CotiHttpProvider = InstanceType<CotiEthersModule['JsonRpcProvider']>;
type CotiReadProvider = CotiWsProvider | CotiHttpProvider;
let cotiEthersModulePromise: Promise<CotiEthersModule> | null = null;
let cotiWsProviderPromise: Promise<CotiWsProvider> | null = null;
let cotiHttpProviderPromise: Promise<CotiHttpProvider> | null = null;

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
    try {
      const wsProvider = await loadCotiWsProvider();
      await wsProvider.getBlockNumber();
      return wsProvider;
    } catch {
      await resetCotiWsProvider();
    }
  }

  return loadCotiHttpProvider();
};

const shortenAddress = (address: string): string => `${address.slice(0, 6)}...${address.slice(-4)}`;

const isWalletAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value.trim());
const normalizeContactName = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const scopedStorageKey = (baseKey: string, walletAddress?: string | null): string => {
  const scope = walletAddress?.trim().toLowerCase();
  return `${baseKey}:${scope && isWalletAddress(scope) ? scope : 'global'}`;
};

const normalizeChainId = (chainId: string | number): number => {
  if (typeof chainId === 'number') return chainId;
  return chainId.startsWith('0x') ? parseInt(chainId, 16) : Number(chainId);
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

const mergeUniqueContacts = (existing: Contact[], discoveredAddresses: string[]): Contact[] => {
  const byLower = new Map<string, Contact>();

  for (const contact of existing) {
    byLower.set(contact.address.toLowerCase(), contact);
  }

  for (const address of discoveredAddresses) {
    if (isWalletAddress(address)) {
      const lower = address.toLowerCase();
      if (!byLower.has(lower)) {
        byLower.set(lower, { address });
      }
    }
  }

  return Array.from(byLower.values());
};

const normalizeContactsForBackup = (contacts: Contact[]): Contact[] => {
  const deduped = new Map<string, Contact>();

  for (const contact of contacts) {
    const address = contact.address.trim();
    if (!isWalletAddress(address)) {
      continue;
    }

    const key = address.toLowerCase();
    const name = normalizeContactName(contact.name ?? '');
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, { address, name });
      continue;
    }

    if (!existing.name && name) {
      deduped.set(key, { ...existing, name });
    }
  }

  return Array.from(deduped.values()).sort((left, right) => left.address.localeCompare(right.address));
};

const buildStateBackupPayload = (nickname: string, contacts: Contact[]): StateBackupPayload => ({
  version: STATE_BACKUP_VERSION,
  updatedAt: Math.floor(Date.now() / 1000),
  nickname: nickname.slice(0, 42),
  contacts: normalizeContactsForBackup(contacts)
});

const buildStateBackupText = (payload: StateBackupPayload): string => `${STATE_BACKUP_PREFIX}${JSON.stringify(payload)}`;

const parseStateBackupText = (text: string): StateBackupPayload | null => {
  if (!text.startsWith(STATE_BACKUP_PREFIX)) {
    return null;
  }

  try {
    const rawPayload = text.slice(STATE_BACKUP_PREFIX.length).trim();
    if (!rawPayload) {
      return null;
    }

    const parsed = JSON.parse(rawPayload) as Partial<StateBackupPayload>;
    if (parsed.version !== STATE_BACKUP_VERSION) {
      return null;
    }

    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
    const nickname = typeof parsed.nickname === 'string' ? parsed.nickname.slice(0, 42) : '';
    const contacts = Array.isArray(parsed.contacts)
      ? normalizeContactsForBackup(parsed.contacts as Contact[])
      : [];

    return {
      version: STATE_BACKUP_VERSION,
      updatedAt,
      nickname,
      contacts
    };
  } catch {
    return null;
  }
};

const createStateBackupFingerprint = (nickname: string, contacts: Contact[]): string =>
  JSON.stringify({
    nickname: nickname.slice(0, 42),
    contacts: normalizeContactsForBackup(contacts)
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

const loadStoredContacts = (walletAddress?: string | null): Contact[] => {
  try {
    const scopedKey = scopedStorageKey(CONTACTS_STORAGE_KEY, walletAddress);
    const raw = window.localStorage.getItem(scopedKey);
    if (!raw) {
      if (walletAddress) {
        return [];
      }

      const legacyRaw = window.localStorage.getItem(CONTACTS_STORAGE_KEY);
      if (!legacyRaw) {
        return [];
      }

      return parseStoredContactsValue(legacyRaw);
    }

    return parseStoredContactsValue(raw);
  } catch {
    return [];
  }
};

const parseStoredContactsPayload = (raw: string): Contact[] => {
  const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const deduped = new Map<string, Contact>();

    for (const item of parsed) {
      if (typeof item === 'string') {
        const address = item.trim();
        if (isWalletAddress(address)) {
          const key = address.toLowerCase();
          if (!deduped.has(key)) {
            deduped.set(key, { address });
          }
        }
        continue;
      }

      if (item && typeof item === 'object' && 'address' in item) {
        const address = typeof item.address === 'string' ? item.address.trim() : '';
        if (!isWalletAddress(address)) {
          continue;
        }

        const key = address.toLowerCase();
        const name = normalizeContactName(typeof item.name === 'string' ? item.name : '');
        const existing = deduped.get(key);
        if (!existing) {
          deduped.set(key, { address, name });
        } else if (!existing.name && name) {
          deduped.set(key, { ...existing, name });
        }
      }
    }

    return Array.from(deduped.values());
};

const parseStoredContactsValue = (raw: string): Contact[] => {
  try {
    return parseStoredContactsPayload(raw);
  } catch {
    return [];
  }
};

const loadStoredActiveContact = (walletAddress?: string | null): string | null => {
  try {
    const scopedKey = scopedStorageKey(ACTIVE_CONTACT_STORAGE_KEY, walletAddress);
    const scopedStored = window.localStorage.getItem(scopedKey);
    if (scopedStored && isWalletAddress(scopedStored)) {
      return scopedStored;
    }

    if (!walletAddress) {
      const legacyStored = window.localStorage.getItem(ACTIVE_CONTACT_STORAGE_KEY);
      if (legacyStored && isWalletAddress(legacyStored)) {
        return legacyStored;
      }
    }

    return null;
  } catch {
    return null;
  }
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

const createBurnerWalletId = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
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

    if (
      encryptedCandidate.version === BURNER_WALLET_STORAGE_VERSION &&
      typeof encryptedCandidate.salt === 'string' &&
      typeof encryptedCandidate.iv === 'string' &&
      typeof encryptedCandidate.ciphertext === 'string' &&
      typeof encryptedCandidate.iterations === 'number'
    ) {
      return {
        kind: 'encrypted',
        record: {
          version: encryptedCandidate.version,
          salt: encryptedCandidate.salt,
          iv: encryptedCandidate.iv,
          ciphertext: encryptedCandidate.ciphertext,
          iterations: encryptedCandidate.iterations
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
  const pinMaterial = await window.crypto.subtle.importKey('raw', TEXT_ENCODER.encode(pin), 'PBKDF2', false, [
    'deriveKey'
  ]);

  return window.crypto.subtle.deriveKey(
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
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBurnerPinKey(pin, salt, BURNER_PIN_PBKDF2_ITERATIONS, ['encrypt']);

  const payload = JSON.stringify(vault);
  const encrypted = await window.crypto.subtle.encrypt(
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

  const decrypted = await window.crypto.subtle.decrypt(
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
  const encrypted = await encryptBurnerWalletVault(vault, pin);
  window.localStorage.setItem(BURNER_WALLET_STORAGE_KEY, JSON.stringify(encrypted));
};

const loadStoredProfile = (walletAddress?: string | null): UserProfile => {
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(PROFILE_STORAGE_KEY, walletAddress));
    if (!raw) {
      return { nickname: '' };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return { nickname: '' };
    }

    const record = parsed as { nickname?: unknown };
    return {
      nickname: typeof record.nickname === 'string' ? record.nickname : ''
    };
  } catch {
    return { nickname: '' };
  }
};

const loadSharedNicknameContacts = (walletAddress?: string | null): Record<string, boolean> => {
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(PROFILE_SHARED_STORAGE_KEY, walletAddress));
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') {
        result[key.toLowerCase()] = value;
      }
    }

    return result;
  } catch {
    return {};
  }
};

const buildMessageWithProfilePayload = (plainText: string, nickname: string, shouldShare: boolean): string => {
  const normalizedNickname = nickname
    .replace(/\u001f/g, '')
    .replace(PROFILE_METADATA_PREFIX_REGEX, '')
    .replace(/\]/g, '')
    .trim();
  if (!shouldShare || !normalizedNickname) {
    return plainText;
  }

  return `${PROFILE_METADATA_PREFIX}${normalizedNickname}${PROFILE_METADATA_PREFIX}${plainText}`;
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
      const replyToMessageId = hasLegacyIdChunk && /^[a-zA-Z0-9\-]+$/.test(rawReplyId) ? rawReplyId : undefined;
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
  const [contacts, setContacts] = useState<Contact[]>(() => loadStoredContacts());
  const [newContact, setNewContact] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [activeContact, setActiveContact] = useState<string | null>(() => loadStoredActiveContact());
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
  const [burnerWalletLabelInput, setBurnerWalletLabelInput] = useState('');
  const [showBurnerImportModal, setShowBurnerImportModal] = useState(false);
  const [showBurnerPinModal, setShowBurnerPinModal] = useState(false);
  const [burnerPinMode, setBurnerPinMode] = useState<BurnerPinMode>('unlock');
  const [burnerPinInput, setBurnerPinInput] = useState('');
  const [pendingBurnerInit, setPendingBurnerInit] = useState<PendingBurnerInit | null>(null);
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<SensitiveAction | null>(null);
  const [initializingBurner, setInitializingBurner] = useState(false);
  const [burnerNeedsFunding, setBurnerNeedsFunding] = useState(false);
  const [myNickname, setMyNickname] = useState('');
  const [sharedNicknameContacts, setSharedNicknameContacts] = useState<Record<string, boolean>>({});
  const [activeSignerSource, setActiveSignerSource] = useState<SignerSource>('burner');
  const [connectionMethod, setConnectionMethod] = useState<'metamask' | null>(null);
  const [connectingMethod, setConnectingMethod] = useState<'metamask' | null>(null);
  const [onboardStatus, setOnboardStatus] = useState<string>('Not onboarded');
  const [sessionOnboardInfo, setSessionOnboardInfo] = useState<Record<string, OnboardInfo>>({});
  const [messageInput, setMessageInput] = useState('');
  const [messagesByContact, setMessagesByContact] = useState<Record<string, ChatMessage[]>>({});
  const [sending, setSending] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [deepSyncingHistory, setDeepSyncingHistory] = useState(false);
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
  const signerCacheRef = useRef<Record<string, JsonRpcSigner>>({});
  const sendingRef = useRef(false);
  const syncingHistoryRef = useRef(false);
  const pendingSyncOptionsRef = useRef<SyncConversationOptions | null>(null);
  const previousWalletAddressRef = useRef<string>('');
  const lastSyncedBlockRef = useRef<Record<string, number>>({});
  const oldestLoadedBlockByContactRef = useRef<Record<string, number>>({});
  const hasOlderHistoryByContactRef = useRef<Record<string, boolean>>({});
  const loadingOlderHistoryRef = useRef(false);
  const blockTimestampCacheRef = useRef<Map<number, number>>(new Map());
  const requiredFeeCacheRef = useRef<bigint | null>(null);
  const backupInFlightRef = useRef(false);
  const initialDeepContactSyncDoneRef = useRef<Record<string, boolean>>({});
  const gradualContactDiscoveryInFlightRef = useRef<Record<string, boolean>>({});
  const gradualContactDiscoveryCursorRef = useRef<Record<string, number>>({});
  const gradualContactDiscoveryTimerRef = useRef<number | null>(null);
  const lastAppliedStateBackupTsRef = useRef<Record<string, number>>({});
  const lastBackedUpStateFingerprintRef = useRef<Record<string, string>>({});
  const syncConversationHistoryRef = useRef<(options?: SyncConversationOptions) => Promise<void>>(async () => {});

  const isConnected = useMemo(() => walletAddress.length > 0, [walletAddress]);
  const onCotiNetwork = useMemo(() => chainId === COTI_NETWORK.chainIdDecimal, [chainId]);
  const activeMessages = useMemo(() => {
    if (!activeContact) {
      return [];
    }
    return messagesByContact[activeContact.toLowerCase()] ?? [];
  }, [activeContact, messagesByContact]);
  const sortedContacts = useMemo(() => {
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

      return a.index - b.index;
    });

    return withIndex.map((item) => item.contact);
  }, [contacts, messagesByContact]);
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
  const activeBurnerWalletMeta = burnerWallets.find((walletRecord) => walletRecord.id === burnerWalletSelectionValue);
  const findContactNameForWalletAddress = (address?: string): string | undefined => {
    if (!address) {
      return undefined;
    }

    return contacts.find((contact) => contact.address.toLowerCase() === address.toLowerCase())?.name;
  };
  const findBurnerWalletNameForAddress = (address?: string): string | undefined => {
    if (!address) {
      return undefined;
    }

    return burnerWallets.find((walletRecord) => walletRecord.address?.toLowerCase() === address.toLowerCase())?.name;
  };
  const getBurnerWalletDisplayName = (walletRecord: BurnerWalletRecord, index: number): string =>
    walletRecord.name ?? findContactNameForWalletAddress(walletRecord.address) ?? `Wallet ${index + 1}`;
  const findBurnerWalletDefaultNameForAddress = (address: string): string | undefined => {
    const normalizedAddress = address.toLowerCase();
    const walletIndex = burnerWallets.findIndex(
      (walletRecord) => walletRecord.address?.toLowerCase() === normalizedAddress
    );

    if (walletIndex < 0) {
      return undefined;
    }

    return getBurnerWalletDisplayName(burnerWallets[walletIndex], walletIndex);
  };
  const activeBurnerWalletDisplayName = activeBurnerWalletMeta
    ? getBurnerWalletDisplayName(
        activeBurnerWalletMeta,
        Math.max(
          burnerWallets.findIndex((walletRecord) => walletRecord.id === activeBurnerWalletMeta.id),
          0
        )
      )
    : '';
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
      return activeProviderRef.current ?? activeProvider ?? window.ethereum ?? null;
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
    const normalizedSeed = seedOrPrivateKey?.trim() ?? '';
    const cotiEthers = await loadCotiEthersModule();

    if (mode === 'import') {
      if (normalizedSeed.length === 0) {
        throw new Error('Enter a mnemonic phrase or private key.');
      }

      if (/^0x[a-fA-F0-9]{64}$/.test(normalizedSeed)) {
        return { record: { privateKey: normalizedSeed } };
      }

      const importedWallet = cotiEthers.Wallet.fromPhrase(normalizedSeed);
      return {
        record: {
          privateKey: importedWallet.privateKey,
          mnemonic: normalizedSeed
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
        setShowBurnerMnemonic(mode === 'generate');
      } else {
        setBurnerMnemonicBackup('');
        setShowBurnerMnemonic(false);
      }

      const burnerBalance = (await rpcProvider.getBalance(burnerWallet.address)) as bigint;
      if (burnerBalance <= 0n) {
        setBurnerNeedsFunding(true);
        setStatus('Burner wallet created. Fund it, then connect burner wallet.');
        setOnboardStatus('Funding required');
        return 'needs-funding';
      }

      const cacheKey = burnerWallet.address.toLowerCase();
      const cachedOnboardInfo = sessionOnboardInfo[cacheKey];
      if (cachedOnboardInfo) {
        burnerWallet.setUserOnboardInfo(cachedOnboardInfo);
      }

      setOnboardStatus('Onboarding...');
      await burnerWallet.generateOrRecoverAes();
      const onboardInfo = burnerWallet.getUserOnboardInfo();

      if (!onboardInfo?.aesKey) {
        throw new Error('AES key unavailable for burner wallet.');
      }

      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
      }));
      setOnboardStatus('AES key ready');
      setStatus('Connected (Burner)');
      await restoreStateFromChainSelfBackup(burnerWallet.address);
      await syncConversationHistoryRef.current();
      runInitialDeepContactDiscovery(burnerWallet.address).catch(() => {});
      return 'connected';
    } catch (burnerError) {
      const message = burnerError instanceof Error ? burnerError.message : 'Failed to initialize burner wallet.';
      if (message.includes('Account balance is 0 so user cannot be onboarded')) {
        setBurnerNeedsFunding(true);
        setStatus('Burner needs funding');
        return 'needs-funding';
      } else {
        setStatus('Disconnected');
      }
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
    if (initResult === 'connected' || initResult === 'needs-funding') {
      setShowBurnerPinModal(false);
      setPendingBurnerInit(null);
      setBurnerPinInput('');

      if (pending.mode === 'import') {
        setShowBurnerImportModal(false);
      }

      if (initResult === 'connected' && burnerPinMode === 'unlock' && pin.length < BURNER_PIN_MIN_LENGTH) {
        setStatus(`Connected. Please update PIN to at least ${BURNER_PIN_MIN_LENGTH} digits.`);
        setPendingBurnerInit(null);
        setBurnerPinMode('set');
        setBurnerPinInput('');
        setShowBurnerPinModal(true);
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

  const saveActiveBurnerWalletLabel = async () => {
    setError('');

    if (!activeBurnerWalletMeta?.id) {
      setError('No active burner wallet selected.');
      return;
    }

    if (!burnerPinRef.current) {
      setError('Unlock burner wallet before updating wallet label.');
      return;
    }

    const normalizedName = normalizeContactName(burnerWalletLabelInput);
    const updatedWallets = burnerWallets.map((walletRecord) =>
      walletRecord.id === activeBurnerWalletMeta.id
        ? {
            ...walletRecord,
            name: normalizedName
          }
        : walletRecord
    );

    const nextVault = await createBurnerWalletVault(updatedWallets, activeBurnerWalletMeta.id);
    await saveEncryptedBurnerWalletVault(nextVault, burnerPinRef.current);
    setBurnerWallets(nextVault.wallets);
    if (burnerRecordRef.current?.id === activeBurnerWalletMeta.id) {
      burnerRecordRef.current = {
        ...burnerRecordRef.current,
        name: normalizedName
      };
    }
    if (activeBurnerWalletMeta.address && normalizedName) {
      setContacts((previous) =>
        previous.map((contact) =>
          contact.address.toLowerCase() === activeBurnerWalletMeta.address?.toLowerCase()
            ? { ...contact, name: normalizedName }
            : contact
        )
      );
    }
    setStatus('Burner wallet label updated.');
  };

  const topUpBurnerWithMetaMask = async () => {
    setError('');

    const burnerAddress = burnerWalletRef.current?.address ?? (activeSignerSource === 'burner' ? walletAddress : '');

    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      setError('Initialize burner wallet first.');
      return;
    }

    const provider = window.ethereum;
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
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
        const requiredFee = (await readContract.feeAmount()) as bigint;
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
      const message = fundError instanceof Error ? fundError.message : 'Failed to top up burner wallet.';
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
    const name = normalizeContactName(newContactName) ?? findBurnerWalletDefaultNameForAddress(address);
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
      return;
    }

    setContacts((previous) => [...previous, { address, name }]);
    setNewContact('');
    setNewContactName('');
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

    setSharedNicknameContacts((previous) => {
      if (!(normalizedAddress in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[normalizedAddress];
      return next;
    });

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

  const onboardAddressAes = async (address: string, provider: Eip1193Provider) => {
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

    const onboardInfo = signer.getUserOnboardInfo();
    const aesKey = onboardInfo?.aesKey ?? '';
    if (!aesKey) {
      throw new Error('AES key was not returned during onboarding.');
    }

    setSessionOnboardInfo((previous) => ({
      ...previous,
      [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
    }));

    setOnboardStatus('AES key ready');
  };

  const connectAndOnboard = async () => {
    setError('');
    setConnectingMethod('metamask');

    const provider = window.ethereum;
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
      await restoreStateFromChainSelfBackup(selected);
      await syncConversationHistory();
      runInitialDeepContactDiscovery(selected).catch(() => {});
    } catch (connectionError) {
      const message = connectionError instanceof Error ? connectionError.message : 'Failed to connect wallet.';
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

  const resolveRequiredFeeForSend = async (): Promise<bigint> => {
    if (requiredFeeCacheRef.current !== null && requiredFeeCacheRef.current > 0n) {
      return requiredFeeCacheRef.current;
    }

    if (requiredFeeWei !== null && requiredFeeWei > 0n) {
      requiredFeeCacheRef.current = requiredFeeWei;
      return requiredFeeWei;
    }

    const cotiEthers = await loadCotiEthersModule();
    const readProvider = await loadCotiReadProvider(true);
    const readContract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
    const resolvedFee = (await readContract.feeAmount()) as bigint;
    requiredFeeCacheRef.current = resolvedFee;
    setRequiredFeeWei(resolvedFee);
    return resolvedFee;
  };

  const applyStateBackupPayload = (
    walletKey: string,
    payload: StateBackupPayload,
    discoveredNicknames?: Map<string, string>
  ) => {
    const currentBackupTs = lastAppliedStateBackupTsRef.current[walletKey] ?? 0;
    if (payload.updatedAt <= currentBackupTs) {
      return;
    }

    const snapshotContacts = normalizeContactsForBackup(payload.contacts);
    const snapshotNickname = payload.nickname.slice(0, 42);
    const snapshotContactsByKey = new Map<string, Contact>();
    for (const contact of snapshotContacts) {
      snapshotContactsByKey.set(contact.address.toLowerCase(), contact);
    }

    setContacts((previous) => {
      const merged = mergeUniqueContacts(
        previous,
        snapshotContacts.map((contact) => contact.address)
      );

      return merged.map((contact) => {
        const key = contact.address.toLowerCase();
        const snapshotName = normalizeContactName(snapshotContactsByKey.get(key)?.name ?? '');
        const existingName = normalizeContactName(contact.name ?? '');
        const discoveredName = normalizeContactName(discoveredNicknames?.get(key) ?? '');
        const name = snapshotName ?? existingName ?? discoveredName;

        if (!name) {
          return {
            ...contact,
            name: undefined
          };
        }

        return {
          ...contact,
          name
        };
      });
    });

    setMyNickname(snapshotNickname);
    lastAppliedStateBackupTsRef.current[walletKey] = payload.updatedAt;
    lastBackedUpStateFingerprintRef.current[walletKey] = createStateBackupFingerprint(
      snapshotNickname,
      snapshotContacts
    );
  };

  const restoreStateFromChainSelfBackup = async (address?: string) => {
    const targetAddress = (address ?? walletAddress).trim();
    if (!isWalletAddress(targetAddress)) {
      return;
    }

    try {
      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, readProvider);
      const latestBlock = await readProvider.getBlockNumber();
      const selfFilter = contract.filters.MessageSubmitted(targetAddress, targetAddress);

      let latestPayload: StateBackupPayload | null = null;
      let latestNonEmptyNickname: string | undefined;

      let windowEnd = latestBlock;
      while (windowEnd >= 0 && (!latestPayload || !latestNonEmptyNickname)) {
        const windowStart = Math.max(0, windowEnd - SELF_BACKUP_RESTORE_BLOCK_WINDOW + 1);
        const windowLogs = await contract.queryFilter(selfFilter, windowStart, windowEnd);

        if (windowLogs.length > 0) {
          const sortedLogs = [...windowLogs].sort((left, right) => {
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
                  if (!latestPayload) {
                    latestPayload = parsed;
                  }

                  const parsedNickname = normalizeContactName(parsed.nickname ?? '')?.slice(0, 42);
                  if (parsedNickname && !latestNonEmptyNickname) {
                    latestNonEmptyNickname = parsedNickname;
                  }

                  if (latestPayload && latestNonEmptyNickname) {
                    break;
                  }
                }
              } catch {
              }
            }

            if (latestPayload && latestNonEmptyNickname) {
              break;
            }
          }
        }

        if (windowStart === 0) {
          break;
        }

        windowEnd = windowStart - 1;
      }

      if (!latestPayload) {
        return;
      }

      const latestPayloadNickname = normalizeContactName(latestPayload.nickname ?? '')?.slice(0, 42);
      const resolvedNickname = latestPayloadNickname ?? latestNonEmptyNickname ?? '';
      const payloadToApply: StateBackupPayload =
        resolvedNickname === latestPayload.nickname.slice(0, 42)
          ? latestPayload
          : {
              ...latestPayload,
              nickname: resolvedNickname
            };

      applyStateBackupPayload(targetAddress.toLowerCase(), payloadToApply);

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
    } catch {
    }
  };

  const backupLocalStateToSelf = async (snapshotNickname: string, snapshotContacts: Contact[]) => {
    if (backupInFlightRef.current) {
      return;
    }

    if (!walletAddress || !isWalletAddress(walletAddress)) {
      return;
    }

    const walletKey = walletAddress.toLowerCase();
    const nextFingerprint = createStateBackupFingerprint(snapshotNickname, snapshotContacts);
    if (lastBackedUpStateFingerprintRef.current[walletKey] === nextFingerprint) {
      return;
    }

    try {
      backupInFlightRef.current = true;
      setBackingUpState(true);

      const { signer, cacheKey } = await getMemoSigner();
      const cotiEthers = await loadCotiEthersModule();
      const memoContractInterface = new cotiEthers.Interface(CHAT_CONTRACT_ABI);
      const selector = memoContractInterface.getFunction('submit')?.selector;
      if (!selector) {
        throw new Error('Unable to resolve submit selector.');
      }

      const payload = buildStateBackupPayload(snapshotNickname, snapshotContacts);
      const backupText = buildStateBackupText(payload);
      const encodedMemo = encodeMemoPlaintext(backupText);
      const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
      if (
        typeof encryptedMemo !== 'object' ||
        encryptedMemo === null ||
        typeof encryptedMemo.ciphertext !== 'object' ||
        encryptedMemo.ciphertext === null ||
        !('value' in encryptedMemo.ciphertext) ||
        !Array.isArray(encryptedMemo.signature)
      ) {
        throw new Error('Encrypted memo format mismatch for submit().');
      }

      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const requiredFee = await resolveRequiredFeeForSend();
      const memoTuple = [[encryptedMemo.ciphertext.value], encryptedMemo.signature] as const;
      await contract.submit(walletAddress, memoTuple, { value: requiredFee });

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
      setBackingUpState(false);
    }
  };

  const syncConversationHistory = async (options?: SyncConversationOptions) => {
    setError('');

    if (!walletAddress) {
      return;
    }

    if (syncingHistoryRef.current) {
      const pending = pendingSyncOptionsRef.current;
      pendingSyncOptionsRef.current = {
        ...pending,
        ...options,
        deep: Boolean(options?.deep || pending?.deep),
        contactsOnly: Boolean(options?.contactsOnly || pending?.contactsOnly),
        previewPerContact: Boolean(options?.previewPerContact || pending?.previewPerContact),
        background: Boolean((options?.background ?? true) && (pending?.background ?? true)),
        fromBlock:
          typeof options?.fromBlock === 'number' && typeof pending?.fromBlock === 'number'
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
      const entries: HistoryEntry[] = [];
      const previewByContact = new Map<string, HistoryEntry>();
      let latestStateBackup:
        | {
            payload: StateBackupPayload;
            blockNumber: number;
            logIndex: number;
          }
        | null = null;

      for (const log of incomingLogs) {
        const args = (log as { args?: Record<string, unknown> }).args;
        const from = String(args?.from ?? '');
        if (!isWalletAddress(from)) {
          continue;
        }

        if (from.toLowerCase() === walletKey) {
          const selfCiphertext = extractUserCiphertext(args?.messageForRecipient);
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
            } catch {
            }
          }
          continue;
        }

        discoveredContacts.add(from);

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
              const parsed = parseMessageProfilePayload(decodeMemoPlaintext(raw));
              const replyParsed = parseMessageReplyPayload(parsed.cleanText);
              messageText = replyParsed.cleanText;
              replyToMessageId = replyParsed.replyToMessageId;
              replyToText = replyParsed.replyToText;
              replyToTxHash = replyParsed.replyToTxHash;
              if (parsed.nickname) {
                discoveredNicknames.set(contactKey, parsed.nickname);
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
            const parsed = parseMessageProfilePayload(decodeMemoPlaintext(raw));
            const replyParsed = parseMessageReplyPayload(parsed.cleanText);
            messageText = replyParsed.cleanText;
            replyToMessageId = replyParsed.replyToMessageId;
            replyToText = replyParsed.replyToText;
            replyToTxHash = replyParsed.replyToTxHash;
            if (parsed.nickname) {
              discoveredNicknames.set(from.toLowerCase(), parsed.nickname);
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
              const parsed = parseMessageProfilePayload(decodeMemoPlaintext(raw));
              const replyParsed = parseMessageReplyPayload(parsed.cleanText);
              messageText = replyParsed.cleanText;
              replyToMessageId = replyParsed.replyToMessageId;
              replyToText = replyParsed.replyToText;
              replyToTxHash = replyParsed.replyToTxHash;
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
            const parsed = parseMessageProfilePayload(decodeMemoPlaintext(raw));
            const replyParsed = parseMessageReplyPayload(parsed.cleanText);
            messageText = replyParsed.cleanText;
            replyToMessageId = replyParsed.replyToMessageId;
            replyToText = replyParsed.replyToText;
            replyToTxHash = replyParsed.replyToTxHash;
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
      setContacts((previous) => {
        const mergedContacts = mergeUniqueContacts(previous, Array.from(discoveredContacts));

        if (discoveredNicknames.size === 0) {
          return mergedContacts;
        }

        return mergedContacts.map((contact) => {
          if (contact.name) {
            return contact;
          }

          const nickname = discoveredNicknames.get(contact.address.toLowerCase());
          if (!nickname) {
            return contact;
          }

          return {
            ...contact,
            name: nickname
          };
        });
      });

      if (latestStateBackup) {
        applyStateBackupPayload(walletKey, latestStateBackup.payload, discoveredNicknames);
      }

      if (!options?.contactsOnly && typeof options?.toBlock !== 'number') {
        lastSyncedBlockRef.current[walletKey] = latestBlock;
      }

      if (!activeContact && discoveredContacts.size > 0) {
        setActiveContact(Array.from(discoveredContacts)[0]);
      }

      const nextOnboardInfo = signer.getUserOnboardInfo();
      setSessionOnboardInfo((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], nextOnboardInfo)
      }));
    } catch (syncError) {
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

  const runInitialDeepContactDiscovery = async (address?: string) => {
    const targetAddress = (address ?? walletAddress).trim().toLowerCase();
    if (!isWalletAddress(targetAddress)) {
      return;
    }

    if (initialDeepContactSyncDoneRef.current[targetAddress] || gradualContactDiscoveryInFlightRef.current[targetAddress]) {
      return;
    }

    gradualContactDiscoveryInFlightRef.current[targetAddress] = true;

    try {
      const readProvider = await loadCotiReadProvider(false);
      let cursor =
        typeof gradualContactDiscoveryCursorRef.current[targetAddress] === 'number'
          ? (gradualContactDiscoveryCursorRef.current[targetAddress] as number)
          : await readProvider.getBlockNumber();

      const runTick = async () => {
        if (!isWalletAddress(targetAddress)) {
          gradualContactDiscoveryInFlightRef.current[targetAddress] = false;
          return;
        }

        for (
          let iteration = 0;
          iteration < GRADUAL_CONTACT_DISCOVERY_WINDOWS_PER_TICK && cursor >= 0;
          iteration += 1
        ) {
          const fromBlock = Math.max(0, cursor - GRADUAL_CONTACT_DISCOVERY_BLOCK_WINDOW + 1);
          await syncConversationHistoryRef.current({
            contactsOnly: true,
            previewPerContact: true,
            background: true,
            fromBlock,
            toBlock: cursor
          });
          cursor = fromBlock - 1;
          gradualContactDiscoveryCursorRef.current[targetAddress] = cursor;
        }

        if (cursor < 0) {
          gradualContactDiscoveryInFlightRef.current[targetAddress] = false;
          initialDeepContactSyncDoneRef.current[targetAddress] = true;
          return;
        }

        gradualContactDiscoveryTimerRef.current = window.setTimeout(() => {
          runTick().catch(() => {
            gradualContactDiscoveryInFlightRef.current[targetAddress] = false;
          });
        }, GRADUAL_CONTACT_DISCOVERY_DELAY_MS);
      };

      await runTick();
    } catch {
      gradualContactDiscoveryInFlightRef.current[targetAddress] = false;
      initialDeepContactSyncDoneRef.current[targetAddress] = false;
    }
  };

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
            : latestBlock + 1;

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

            const parsed = parseMessageProfilePayload(plain);
            const replyParsed = parseMessageReplyPayload(parsed.cleanText);
            messageText = replyParsed.cleanText;
            replyToMessageId = replyParsed.replyToMessageId;
            replyToText = replyParsed.replyToText;
            replyToTxHash = replyParsed.replyToTxHash;
            if (parsed.nickname) {
              discoveredNicknames.set(from.toLowerCase(), parsed.nickname);
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
              if (backupPayload) {
                continue;
              }
            }

            const parsed = parseMessageProfilePayload(plain);
            const replyParsed = parseMessageReplyPayload(parsed.cleanText);
            messageText = replyParsed.cleanText;
            replyToMessageId = replyParsed.replyToMessageId;
            replyToText = replyParsed.replyToText;
            replyToTxHash = replyParsed.replyToTxHash;
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

      if (discoveredNicknames.size > 0) {
        setContacts((previous) =>
          previous.map((contact) => {
            if (contact.name) {
              return contact;
            }

            const nickname = discoveredNicknames.get(contact.address.toLowerCase());
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

    if (plainText.startsWith(IMAGE_MESSAGE_PREFIX)) {
      setError('Image messages are disabled for security reasons.');
      return;
    }

    if (!activeContact) {
      setError('Select a contact first.');
      return;
    }

    const contactKey = activeContact.toLowerCase();
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
      const memoContractInterface = new cotiEthers.Interface(CHAT_CONTRACT_ABI);
      const selector = memoContractInterface.getFunction('submit')?.selector;
      if (!selector) {
        throw new Error('Unable to resolve submit selector.');
      }

      const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, signer);
      const requiredFee = await resolveRequiredFeeForSend();

      const shouldShareProfile = Boolean(myNickname.trim()) && !sharedNicknameContacts[contactKey];
      const plainTextWithReply = buildMessageWithReplyPayload(
        plainText,
        replyingPreviewText,
        replyingToMessage?.txHash
      );
      const sendEncryptedMemo = async (textToSend: string): Promise<string> => {
        const encodedMemo = encodeMemoPlaintext(textToSend);
        const encryptedMemo = await signer.encryptValue(encodedMemo, CHAT_CONTRACT_ADDRESS, selector);
        if (
          typeof encryptedMemo !== 'object' ||
          encryptedMemo === null ||
          typeof encryptedMemo.ciphertext !== 'object' ||
          encryptedMemo.ciphertext === null ||
          !('value' in encryptedMemo.ciphertext) ||
          !Array.isArray(encryptedMemo.signature)
        ) {
          throw new Error('Encrypted memo format mismatch for submit().');
        }

        const memoTuple = [[encryptedMemo.ciphertext.value], encryptedMemo.signature] as const;
        const tx = await contract.submit(activeContact, memoTuple, { value: requiredFee });
        return typeof tx?.hash === 'string' ? tx.hash : '';
      };

      let sentWithProfile = false;
      let submittedTxHash = '';
      if (shouldShareProfile) {
        const plainTextWithProfile = buildMessageWithProfilePayload(plainTextWithReply, myNickname, true);
        submittedTxHash = await sendEncryptedMemo(plainTextWithProfile);
        sentWithProfile = true;
      } else {
        submittedTxHash = await sendEncryptedMemo(plainTextWithReply);
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

      if (sentWithProfile) {
        setSharedNicknameContacts((previous) => ({
          ...previous,
          [contactKey]: true
        }));
      }

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

  const loadLatestIncomingMessage = async () => {
    await syncConversationHistory();
  };

  const loadFullConversationHistory = async () => {
    if (syncingHistoryRef.current) {
      return;
    }

    setDeepSyncingHistory(true);
    try {
      await syncConversationHistory({ deep: true });
    } finally {
      setDeepSyncingHistory(false);
    }
  };
  useEffect(() => {
    try {
      window.localStorage.setItem(scopedStorageKey(CONTACTS_STORAGE_KEY, walletAddress), JSON.stringify(contacts));
    } catch {
    }
  }, [contacts, walletAddress]);

  useEffect(() => {
    setContacts(loadStoredContacts(walletAddress));
    setActiveContact(loadStoredActiveContact(walletAddress));
  }, [walletAddress]);

  useEffect(() => {
    const scopedProfile = loadStoredProfile(walletAddress);
    setMyNickname(scopedProfile.nickname);
    setSharedNicknameContacts(loadSharedNicknameContacts(walletAddress));
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
    try {
      window.localStorage.setItem(
        scopedStorageKey(PROFILE_STORAGE_KEY, walletAddress),
        JSON.stringify({ nickname: myNickname })
      );
    } catch {
    }
  }, [walletAddress, myNickname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        scopedStorageKey(PROFILE_SHARED_STORAGE_KEY, walletAddress),
        JSON.stringify(sharedNicknameContacts)
      );
    } catch {
    }
  }, [walletAddress, sharedNicknameContacts]);

  useEffect(() => {
    if (!contacts.length) {
      setActiveContact(null);
      return;
    }

    if (!activeContact) {
      setActiveContact(contacts[0].address);
      return;
    }

    const exists = contacts.some((contact) => contact.address.toLowerCase() === activeContact.toLowerCase());
    if (!exists) {
      setActiveContact(contacts[0].address);
    }
  }, [contacts, activeContact]);

  useEffect(() => {
    try {
      const scopedKey = scopedStorageKey(ACTIVE_CONTACT_STORAGE_KEY, walletAddress);
      if (!activeContact) {
        window.localStorage.removeItem(scopedKey);
      } else {
        window.localStorage.setItem(scopedKey, activeContact);
      }
    } catch {
    }
  }, [activeContact, walletAddress]);

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
      if (container.scrollTop > 120) {
        return;
      }

      loadOlderMessagesForActiveContact().catch(() => {});
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [isConnected, activeContact, walletAddress, hasAesReady, messagesByContact]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollChatToBottom();
    });
  }, [activeContact, activeMessages.length]);

  useEffect(() => {
    const previousWallet = previousWalletAddressRef.current;
    const nextWallet = walletAddress.trim().toLowerCase();

    if (previousWallet !== nextWallet) {
      if (gradualContactDiscoveryTimerRef.current !== null) {
        window.clearTimeout(gradualContactDiscoveryTimerRef.current);
        gradualContactDiscoveryTimerRef.current = null;
      }
      setMessagesByContact({});
      setReplyingToMessage(null);
      setHighlightedMessageId(null);
      lastSyncedBlockRef.current = {};
      oldestLoadedBlockByContactRef.current = {};
      hasOlderHistoryByContactRef.current = {};
      blockTimestampCacheRef.current = new Map();
      gradualContactDiscoveryInFlightRef.current = {};
      gradualContactDiscoveryCursorRef.current = {};
      initialDeepContactSyncDoneRef.current = {};
    }

    previousWalletAddressRef.current = nextWallet;
  }, [walletAddress]);

  useEffect(() => {
    if (!activeBurnerWalletMeta) {
      setBurnerWalletLabelInput('');
      return;
    }

    setBurnerWalletLabelInput(activeBurnerWalletMeta.name ?? findContactNameForWalletAddress(activeBurnerWalletMeta.address) ?? '');
  }, [activeBurnerWalletMeta, contacts]);

  useEffect(() => {
    if (burnerWallets.length === 0) {
      return;
    }

    setContacts((previous) => {
      let changed = false;
      const next = previous.map((contact) => {
        const burnerWalletName = findBurnerWalletNameForAddress(contact.address);
        if (!burnerWalletName || contact.name === burnerWalletName) {
          return contact;
        }

        changed = true;
        return {
          ...contact,
          name: burnerWalletName
        };
      });

      return changed ? next : previous;
    });
  }, [burnerWallets]);

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

    const intervalId = window.setInterval(() => {
      setTopUpMetricsNonce((previous) => previous + 1);
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
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

    const setupRealtimeSubscription = async () => {
      try {
        if (cancelled) {
          return;
        }

        const cotiEthers = await loadCotiEthersModule();
        const wsProvider = await loadCotiWsProvider();
        await wsProvider.getBlockNumber();
        const contract = new cotiEthers.Contract(CHAT_CONTRACT_ADDRESS, CHAT_CONTRACT_ABI, wsProvider);

        const incomingFilter = contract.filters.MessageSubmitted(walletAddress, null);
        const outgoingFilter = contract.filters.MessageSubmitted(null, walletAddress);
        const handleMessageSubmitted = () => {
          if (!cancelled) {
            syncConversationHistoryRef.current().catch(() => {});
          }
        };

        contract.on(incomingFilter, handleMessageSubmitted);
        contract.on(outgoingFilter, handleMessageSubmitted);

        if (cancelled) {
          contract.off(incomingFilter, handleMessageSubmitted);
          contract.off(outgoingFilter, handleMessageSubmitted);
          return;
        }

        unsubscribe = () => {
          contract.off(incomingFilter, handleMessageSubmitted);
          contract.off(outgoingFilter, handleMessageSubmitted);
        };
      } catch {
        await resetCotiWsProvider();
        if (!cancelled) {
          pollIntervalId = window.setInterval(() => {
            syncConversationHistoryRef.current().catch(() => {});
          }, AUTO_SYNC_INTERVAL_MS);
        }
      }
    };

    syncConversationHistoryRef.current().catch(() => {});
    setupRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
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
          <div className="top-header-section">COTI Chat</div>
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
        </div>
        <nav
          id="top-navigation-links-desktop"
          className="top-header-links top-header-links-desktop"
          aria-label="Top navigation"
          style={{ display: isMobileNav ? 'none' : 'flex' }}
        >
          <a href={telegramBotLink} target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>@CipherTrade_bot</a>
          <a href="https://bridge.coti.io/bridge" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>COTI Bridge</a>
          <a href="https://coti.carbondefi.xyz/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>CarbonDeFi</a>
          <a href="https://nexus.hyperlane.xyz/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>Hyperlane Bridge</a>
          <a href="https://app.houdiniswap.com/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>Houdini Swap</a>
          <a href="https://app.chainport.io/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>ChainPort</a>
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
          <a href={telegramBotLink} target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>@CipherTrade_bot</a>
          <a href="https://bridge.coti.io/bridge" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>COTI Bridge</a>
          <a href="https://coti.carbondefi.xyz/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>CarbonDeFi</a>
          <a href="https://nexus.hyperlane.xyz/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>Hyperlane Bridge</a>
          <a href="https://app.houdiniswap.com/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>Houdini Swap</a>
          <a href="https://app.chainport.io/" target="_blank" rel="noreferrer" onClick={() => setMobileLinksOpen(false)}>ChainPort</a>
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
            <div className="meta-row">
              <span>Wallet Actions</span>
            </div>
            <button
              className="connect-btn"
              onClick={() => {
                beginBurnerPinFlow('generate').catch(() => {});
              }}
              type="button"
              disabled={initializingBurner}
            >
              {initializingBurner ? 'Initializing Wallet...' : 'Generate Wallet'}
            </button>

            <button
              className="connect-btn"
              onClick={() => {
                beginBurnerPinFlow('stored').catch(() => {});
              }}
              type="button"
              disabled={initializingBurner}
            >
              Connect Wallet
            </button>

            <button className="connect-btn" onClick={() => setShowBurnerImportModal(true)} type="button" disabled={initializingBurner}>
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
        </div>

        <div className="wallet-meta">
          {burnerWallets.length > 0 ? (
            <>
              <div className="meta-row">
                <span>Active wallet</span>
                <strong>{activeBurnerWalletDisplayName}</strong>
              </div>
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
                    : `Wallet ${index + 1}`;
                  const optionName = getBurnerWalletDisplayName(walletRecord, index);
                  return (
                    <option key={walletRecord.id ?? `${walletRecord.privateKey}-${index}`} value={walletRecord.id ?? ''}>
                      {`${optionName} (${optionAddress})`}
                    </option>
                  );
                })}
              </select>
              <input
                value={burnerWalletLabelInput}
                onChange={(event) => setBurnerWalletLabelInput(event.target.value.slice(0, 42))}
                placeholder="Wallet label (optional)"
                aria-label="Wallet label"
              />
              <button
                type="button"
                className="connect-btn"
                onClick={() => {
                  saveActiveBurnerWalletLabel().catch((labelError) => {
                    const message = labelError instanceof Error ? labelError.message : 'Failed to update wallet label.';
                    setError(message);
                  });
                }}
                disabled={initializingBurner || !activeBurnerWalletMeta}
              >
                Save Wallet Label
              </button>
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
            {showBurnerMnemonic ? <p>{burnerMnemonicBackup}</p> : null}
          </div>
        ) : null}

      </aside>

      {isConnected ? (
      <aside className="contacts-sidebar">
        <div className="contact-profile-card">
          <span className="contact-profile-label">My nickname</span>
          <div
            ref={nicknameEditorRef}
            className="contact-profile-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="false"
            aria-label="My nickname"
            data-placeholder="Choose nickname"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            onInput={(event) => {
              const raw = event.currentTarget.textContent ?? '';
              const singleLine = raw.replace(/\r?\n/g, '').slice(0, 42);
              if (singleLine !== raw) {
                event.currentTarget.textContent = singleLine;
              }
              setMyNickname(singleLine);
            }}
          />
          <button
            type="button"
            className="contact"
            onClick={() => {
              backupLocalStateToSelf(myNickname, contacts).catch(() => {});
            }}
            disabled={!hasAesReady || backingUpState}
          >
            {backingUpState ? 'Saving on chain...' : 'Save on chain'}
          </button>
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
                  onClick={() => {
                    setActiveContact(contact.address);
                    if (isMobileNav) {
                      setActiveMobileView('chat');
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActiveContact(contact.address);
                      if (isMobileNav) {
                        setActiveMobileView('chat');
                      }
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
                          className="contact-copy contact-copy-secondary"
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
                      <span aria-label="Has conversation" title="Has conversation">
                        💬
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
                disabled={syncingHistory || deepSyncingHistory}
              >
                {deepSyncingHistory ? 'Deep Syncing...' : 'Deep Sync'}
              </button>
              <button
                type="button"
                className="contact"
                onClick={loadLatestIncomingMessage}
                disabled={syncingHistory || deepSyncingHistory}
              >
                {deepSyncingHistory ? 'Deep Syncing...' : syncingHistory ? 'Syncing...' : 'Sync History'}
              </button>
            </div>

            <div className="chat-messages" ref={chatMessagesRef}>
              {loadingOlderHistory ? <p className="chat-empty">Loading older messages...</p> : null}
              {activeMessages.length === 0 ? (
                <p className="chat-empty">No messages yet.</p>
              ) : (
                activeMessages.map((message) => (
                  <div
                    key={message.id}
                    className={message.direction === 'outgoing' ? 'message-row outgoing' : 'message-row incoming'}
                  >
                    {(() => {
                      const messageDisplayText = getMessageDisplayText(message.text);
                      const deliveryLabel =
                        message.deliveryState === 'pending'
                          ? 'Sending…'
                          : message.deliveryState === 'sent'
                            ? 'Sent'
                            : message.deliveryState === 'failed'
                              ? 'Failed'
                              : '';

                      return (
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
                      {messageDisplayText ? <div>{messageDisplayText}</div> : null}
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
                      );
                    })()}
                  </div>
                ))
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
                aria-multiline="false"
                aria-label="Message"
                data-placeholder="Type a message"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage().catch(() => {});
                  }
                }}
                onInput={(event) => {
                  const raw = event.currentTarget.textContent ?? '';
                  const singleLine = raw.replace(/\r?\n/g, '');
                  if (singleLine !== raw) {
                    event.currentTarget.textContent = singleLine;
                  }
                  setMessageInput(singleLine);
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
            <h3>{burnerPinMode === 'set' ? 'Set Burner PIN' : 'Unlock Burner Wallet'}</h3>
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
              aria-label="Burner PIN"
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
