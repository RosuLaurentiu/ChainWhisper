import { unzlibSync, zlibSync } from 'fflate';
import {
  BackupReadStateEntry,
  BURNER_PIN_PBKDF2_ITERATIONS,
  BURNER_WALLET_STORAGE_KEY,
  BURNER_WALLET_STORAGE_VERSION,
  BURNER_WALLET_VAULT_VERSION,
  BurnerWalletRecord,
  BurnerWalletStorageState,
  BurnerWalletVault,
  ChatMessage,
  Contact,
  CONTACT_NAME_ENCODING_ONE,
  CONTACT_NAME_ENCODING_ZERO,
  CONTACT_NAME_METADATA_PREFIX,
  CONVERSATION_STATE_METADATA_PREFIX,
  CONVERSATION_STATE_METADATA_PREFIXES,
  ConversationBlockRange,
  ConversationPreferenceState,
  DEFAULT_REACTION_EMOJIS,
  EncryptedBurnerWalletRecord,
  EXTERNAL_REPLY_TXHASH_REGEX,
  formatCotiAmount,
  formatTipNoticeText,
  IMAGE_MESSAGE_PREFIX,
  isBurnerStorageAvailable,
  isShortAddress,
  isWalletAddress,
  LEGACY_PROFILE_METADATA_PREFIX,
  LEGACY_PROFILE_PLAIN_PREFIX,
  LEGACY_PROFILE_PREFIX,
  LEGACY_REPLY_METADATA_PREFIX,
  loadCotiEthersModule,
  MAX_REPLY_PREVIEW_LENGTH,
  MessageReactionPayload,
  NICKNAME_DELIMITER,
  normalizeContactName,
  parseTipNoticePayload,
  parseTokenTipNotice,
  PROFILE_METADATA_PREFIX,
  REACTION_HIDDEN_NIBBLE_LOOKUP,
  REACTION_METADATA_PREFIX,
  READ_CURSOR_PREFIX,
  ReadCursorPayload,
  RecentPeerMeta,
  REPLY_DELIMITER,
  REPLY_METADATA_PREFIX,
  REPLY_METADATA_PREFIX_REGEX,
  shortenAddress,
  STATE_BACKUP_COMPRESSED_PREFIX,
  STATE_BACKUP_PREFIX,
  STATE_BACKUP_VERSION,
  StateBackupPayload,
  SubmitMemoPayload,
  TEXT_DECODER,
  TEXT_ENCODER,
  toSafeNumber
} from './core';

export const parseConversationBlockRange = (rangeRaw: unknown): ConversationBlockRange | null => {
  if (!rangeRaw) {
    return null;
  }

  let firstBlockRaw: unknown;
  let lastBlockRaw: unknown;

  if (Array.isArray(rangeRaw)) {
    firstBlockRaw = rangeRaw[0];
    lastBlockRaw = rangeRaw[1];
  } else if (typeof rangeRaw === 'object') {
    const parsed = rangeRaw as { firstBlock?: unknown; lastBlock?: unknown };
    firstBlockRaw = parsed.firstBlock;
    lastBlockRaw = parsed.lastBlock;
  }

  const lastBlock = toSafeNumber(lastBlockRaw);
  if (lastBlock <= 0) {
    return null;
  }

  const firstBlock = Math.max(0, Math.min(toSafeNumber(firstBlockRaw), lastBlock));
  return {
    firstBlock,
    lastBlock
  };
};

export const parseRecentPeersWithMetaResult = (raw: unknown): RecentPeerMeta[] => {
  if (!raw) {
    return [];
  }

  let peersRaw: unknown;
  let lastBlocksRaw: unknown;
  let lastTimesRaw: unknown;

  if (Array.isArray(raw)) {
    peersRaw = raw[0];
    lastBlocksRaw = raw[1];
    lastTimesRaw = raw[2];
  } else if (typeof raw === 'object') {
    const parsed = raw as { peers?: unknown; lastBlocks?: unknown; lastTimes?: unknown };
    peersRaw = parsed.peers;
    lastBlocksRaw = parsed.lastBlocks;
    lastTimesRaw = parsed.lastTimes;
  }

  const peers = Array.isArray(peersRaw) ? peersRaw : [];
  const lastBlocks = Array.isArray(lastBlocksRaw) ? lastBlocksRaw : [];
  const lastTimes = Array.isArray(lastTimesRaw) ? lastTimesRaw : [];

  const seen = new Set<string>();
  const result: RecentPeerMeta[] = [];
  for (let index = 0; index < peers.length; index += 1) {
    const address = String(peers[index] ?? '').trim();
    if (!isWalletAddress(address)) {
      continue;
    }

    const key = address.toLowerCase();
    if (key === '0x0000000000000000000000000000000000000000' || seen.has(key)) {
      continue;
    }

    const lastBlock = Math.max(0, toSafeNumber(lastBlocks[index]));
    const lastTime = Math.max(0, toSafeNumber(lastTimes[index]));
    if (lastBlock <= 0 && lastTime <= 0) {
      continue;
    }

    seen.add(key);
    result.push({ address, lastBlock, lastTime });
  }

  result.sort((left, right) => {
    if (left.lastBlock !== right.lastBlock) {
      return right.lastBlock - left.lastBlock;
    }
    return right.lastTime - left.lastTime;
  });
  return result;
};

export type ParsedGroupJoinCodeState = {
  active: boolean;
  creator: string;
  signer?: string;
  expiresAt: number;
  usesLeft: number;
  expired: boolean;
};

export const parseGroupJoinCodeState = (joinCodeRaw: unknown): ParsedGroupJoinCodeState | null => {
  if (!joinCodeRaw) {
    return null;
  }

  if (typeof joinCodeRaw === 'object' && !Array.isArray(joinCodeRaw)) {
    const parsed = joinCodeRaw as {
      active?: unknown;
      creator?: unknown;
      signer?: unknown;
      expiresAt?: unknown;
      usesLeft?: unknown;
      expired?: unknown;
    };
    return {
      active: Boolean(parsed.active),
      creator: typeof parsed.creator === 'string' ? parsed.creator : '',
      signer: typeof parsed.signer === 'string' ? parsed.signer : '',
      expiresAt: toSafeNumber(parsed.expiresAt),
      usesLeft: toSafeNumber(parsed.usesLeft),
      expired: Boolean(parsed.expired)
    };
  }

  if (Array.isArray(joinCodeRaw)) {
    const hasSignerField = joinCodeRaw.length >= 6 && typeof joinCodeRaw[2] === 'string';
    const expiresAtIndex = hasSignerField ? 3 : 2;
    const usesLeftIndex = hasSignerField ? 4 : 3;
    const expiredIndex = hasSignerField ? 5 : 4;
    return {
      active: Boolean(joinCodeRaw[0]),
      creator: typeof joinCodeRaw[1] === 'string' ? joinCodeRaw[1] : '',
      signer: hasSignerField && typeof joinCodeRaw[2] === 'string' ? joinCodeRaw[2] : '',
      expiresAt: toSafeNumber(joinCodeRaw[expiresAtIndex]),
      usesLeft: toSafeNumber(joinCodeRaw[usesLeftIndex]),
      expired: Boolean(joinCodeRaw[expiredIndex])
    };
  }

  return null;
};

export const toBigIntArray = (value: unknown): bigint[] => {
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

export const extractUserCiphertext = (memo: unknown): { value: bigint[] } | null => {
  if (!memo) {
    return null;
  }

  if (Array.isArray(memo)) {
    if (memo.length > 1) {
      return { value: toBigIntArray(memo[1]) };
    }
    if (memo.length === 1) {
      return extractUserCiphertext(memo[0]);
    }
  }

  if (memo && typeof memo === 'object' && 'userCiphertext' in memo) {
    return { value: toBigIntArray((memo as { userCiphertext: unknown }).userCiphertext) };
  }

  // Some providers/ABI decoders wrap single tuple returns as { outputName: tuple } or { 0: tuple }.
  if (memo && typeof memo === 'object' && 'codeForAdmin' in memo) {
    return extractUserCiphertext((memo as { codeForAdmin: unknown }).codeForAdmin);
  }
  if (memo && typeof memo === 'object' && 0 in memo) {
    return extractUserCiphertext((memo as { 0: unknown })[0]);
  }

  return null;
};

export const parseSubmitMemoPayload = (encryptedMemo: unknown): SubmitMemoPayload => {
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

export const normalizeConversationPreferenceState = (
  state: ConversationPreferenceState | null | undefined
): ConversationPreferenceState | undefined => {
  if (!state) {
    return undefined;
  }

  const normalized: ConversationPreferenceState = {};
  if (typeof state.muted === 'boolean') {
    normalized.muted = state.muted;
  }
  if (typeof state.hidden === 'boolean') {
    normalized.hidden = state.hidden;
  }

  if (typeof normalized.muted !== 'boolean' && typeof normalized.hidden !== 'boolean') {
    return undefined;
  }

  return normalized;
};

export const applyConversationPreferenceStateToContact = (
  contact: Contact,
  state: ConversationPreferenceState | null | undefined
): Contact => {
  const normalizedState = normalizeConversationPreferenceState(state);
  if (!normalizedState) {
    return contact;
  }

  const nextMuted =
    typeof normalizedState.muted === 'boolean' ? normalizedState.muted : contact.muted;
  const nextHidden =
    typeof normalizedState.hidden === 'boolean' ? normalizedState.hidden : contact.hidden;
  if (contact.muted === nextMuted && contact.hidden === nextHidden) {
    return contact;
  }

  const nextContact: Contact = { ...contact };
  if (typeof nextMuted === 'boolean') {
    nextContact.muted = nextMuted;
  }
  if (typeof nextHidden === 'boolean') {
    nextContact.hidden = nextHidden;
  }
  return nextContact;
};

export const mergeUniqueContacts = (existing: Contact[], discoveredAddresses: string[]): Contact[] => {
  const fullByLower = new Map<string, Contact>();

  const upsertFull = (incomingContact: Contact): void => {
    const address = incomingContact.address.trim();
    if (!isWalletAddress(address)) {
      return;
    }

    const key = address.toLowerCase();
    const normalizedName = normalizeContactName(incomingContact.name ?? '');
    const normalizedState = normalizeConversationPreferenceState({
      muted: incomingContact.muted,
      hidden: incomingContact.hidden
    });
    const existingContact = fullByLower.get(key);
    if (!existingContact) {
      const nextContact: Contact = normalizedName ? { address, name: normalizedName } : { address };
      if (normalizedState && typeof normalizedState.muted === 'boolean') {
        nextContact.muted = normalizedState.muted;
      }
      if (normalizedState && typeof normalizedState.hidden === 'boolean') {
        nextContact.hidden = normalizedState.hidden;
      }
      fullByLower.set(key, nextContact);
      return;
    }

    let nextContact = existingContact;
    const existingName = normalizeContactName(existingContact.name ?? '');
    if (!existingName && normalizedName) {
      nextContact = { ...nextContact, name: normalizedName };
    }
    if (normalizedState) {
      nextContact = applyConversationPreferenceStateToContact(nextContact, normalizedState);
    }
    if (nextContact !== existingContact) {
      fullByLower.set(key, nextContact);
    }
  };

  for (const contact of existing) {
    upsertFull(contact);
  }

  for (const address of discoveredAddresses) {
    upsertFull({ address });
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
  const upsertUnresolved = (incomingContact: Contact): void => {
    const address = incomingContact.address.trim();
    if (!address) {
      return;
    }

    const key = address.toLowerCase();
    const normalizedName = normalizeContactName(incomingContact.name ?? '');
    const normalizedState = normalizeConversationPreferenceState({
      muted: incomingContact.muted,
      hidden: incomingContact.hidden
    });
    const existingContact = unresolvedByLower.get(key);
    if (!existingContact) {
      const nextContact: Contact = normalizedName ? { address, name: normalizedName } : { address };
      if (normalizedState && typeof normalizedState.muted === 'boolean') {
        nextContact.muted = normalizedState.muted;
      }
      if (normalizedState && typeof normalizedState.hidden === 'boolean') {
        nextContact.hidden = normalizedState.hidden;
      }
      unresolvedByLower.set(key, nextContact);
      return;
    }

    let nextContact = existingContact;
    const existingName = normalizeContactName(existingContact.name ?? '');
    if (!existingName && normalizedName) {
      nextContact = { ...nextContact, name: normalizedName };
    }
    if (normalizedState) {
      nextContact = applyConversationPreferenceStateToContact(nextContact, normalizedState);
    }
    if (nextContact !== existingContact) {
      unresolvedByLower.set(key, nextContact);
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
        const shortState = normalizeConversationPreferenceState({
          muted: contact.muted,
          hidden: contact.hidden
        });
        const resolvedContact = fullByLower.get(resolvedFull);
        if (resolvedContact) {
          let nextResolvedContact = resolvedContact;
          if (shortName && !normalizeContactName(resolvedContact.name ?? '')) {
            nextResolvedContact = { ...nextResolvedContact, name: shortName };
          }
          if (shortState) {
            nextResolvedContact = applyConversationPreferenceStateToContact(
              nextResolvedContact,
              shortState
            );
          }
          if (nextResolvedContact !== resolvedContact) {
            fullByLower.set(resolvedFull, nextResolvedContact);
          }
        }
        continue;
      }
    }

    upsertUnresolved(contact);
  }

  return [...fullByLower.values(), ...unresolvedByLower.values()];
};

export const normalizeBackupAddressToken = (value: unknown): string | null => {
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) {
    return null;
  }

  if (isWalletAddress(token) || isShortAddress(token)) {
    return token;
  }

  return null;
};

export const normalizeReadStateEntries = (value: unknown): BackupReadStateEntry[] => {
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

export const normalizeLastReadAllTs = (value: unknown): number => {
  const normalized = Math.floor(toSafeNumber(value));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }
  return normalized;
};

export const deriveLegacyLastReadAllTs = (entries: BackupReadStateEntry[]): number => {
  let latest = 0;
  for (const entry of entries) {
    if (entry.lastReadTs > latest) {
      latest = entry.lastReadTs;
    }
  }
  return latest;
};

export const buildStateBackupPayload = (lastReadAllTs = 0): StateBackupPayload => {
  return {
    version: STATE_BACKUP_VERSION,
    updatedAt: Math.floor(Date.now() / 1000),
    lastReadAllTs: normalizeLastReadAllTs(lastReadAllTs) || undefined
  };
};

export const buildStateBackupText = (payload: StateBackupPayload): string => {
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

export const parseStateBackupText = (text: string): StateBackupPayload | null => {
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

export const parseReadCursorText = (text: string): ReadCursorPayload | null => {
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

export const createStateBackupFingerprint = (lastReadAllTs = 0): string =>
  JSON.stringify({
    g: normalizeLastReadAllTs(lastReadAllTs)
  });

export const sortMessagesChronologically = (messages: ChatMessage[]): ChatMessage[] => {
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

export const normalizeMessagesByContact = (messagesByContact: Record<string, ChatMessage[]>): Record<string, ChatMessage[]> => {
  const next: Record<string, ChatMessage[]> = {};

  for (const [contactKey, messages] of Object.entries(messagesByContact)) {
    next[contactKey] = sortMessagesChronologically(messages);
  }

  return next;
};


export const bytesToBase64 = (value: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index]);
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const toArrayBuffer = (value: Uint8Array): ArrayBuffer =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;

export const getSecureWebCrypto = (): { webCrypto: Crypto; subtle: SubtleCrypto } => {
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

export const createBurnerWalletId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const createBurnerWalletVault = async (
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

export const upsertBurnerWalletInVault = async (
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

export const parseBurnerWalletStorageState = (): BurnerWalletStorageState => {
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

export const deriveBurnerPinKey = async (
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

export const encryptBurnerWalletVault = async (vault: BurnerWalletVault, pin: string): Promise<EncryptedBurnerWalletRecord> => {
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

export const decryptBurnerWalletVault = async (
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

export const loadBurnerWalletVaultFromStorage = async (pin: string): Promise<BurnerWalletVault> => {
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

export const saveEncryptedBurnerWalletVault = async (vault: BurnerWalletVault, pin: string): Promise<void> => {
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


export const trimReplyPreview = (text: string): string => {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return '';
  }

  if (singleLine.length <= MAX_REPLY_PREVIEW_LENGTH) {
    return singleLine;
  }

  return `${singleLine.slice(0, MAX_REPLY_PREVIEW_LENGTH - 1)}…`;
};

const EXTERNAL_REPLY_REFERENCE_REGEX = /^\[r2:([0-9a-z]+-[0-9a-z]+)\]\s*/i;
const COMPACT_MESSAGE_REFERENCE_REGEX = /^([0-9a-z]+)-([0-9a-z]+)$/i;

const isSafeMessageReferencePart = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const encodeCompactMessageReference = (
  blockNumber?: number,
  logIndex?: number
): string | undefined => {
  if (!isSafeMessageReferencePart(blockNumber) || !isSafeMessageReferencePart(logIndex)) {
    return undefined;
  }

  return `${blockNumber.toString(36)}-${logIndex.toString(36)}`;
};

export const decodeCompactMessageReference = (
  encodedChunk: string
): { blockNumber: number; logIndex: number } | undefined => {
  const match = encodedChunk.trim().match(COMPACT_MESSAGE_REFERENCE_REGEX);
  if (!match) {
    return undefined;
  }

  const blockNumber = Number.parseInt(match[1], 36);
  const logIndex = Number.parseInt(match[2], 36);
  if (!isSafeMessageReferencePart(blockNumber) || !isSafeMessageReferencePart(logIndex)) {
    return undefined;
  }

  return { blockNumber, logIndex };
};

export const buildMessageWithReplyPayload = (
  plainText: string,
  replyToText?: string,
  replyToTxHash?: string,
  replyToBlockNumber?: number,
  replyToLogIndex?: number
): string => {
  const compactReference = encodeCompactMessageReference(replyToBlockNumber, replyToLogIndex);
  const externalReplyPrefix = compactReference
    ? `[r2:${compactReference}] `
    : /^0x[a-fA-F0-9]{64}$/.test(replyToTxHash ?? '')
      ? `[r:${replyToTxHash}] `
      : '';
  const preview = trimReplyPreview((replyToText ?? '').replace(REPLY_METADATA_PREFIX_REGEX, '').replace(/\]/g, ''));
  if (!preview) {
    return `${externalReplyPrefix}${plainText}`;
  }

  return `${externalReplyPrefix}${REPLY_METADATA_PREFIX}${preview}${REPLY_METADATA_PREFIX}<: ${plainText}`;
};

export const normalizeReactionEmoji = (value: string): string | undefined => {
  const compact = value.replace(/\s+/g, '');
  if (!compact) {
    return undefined;
  }

  const symbols = Array.from(compact);
  if (symbols.length > 16) {
    return undefined;
  }

  return symbols.join('');
};

const bytesToBase64Url = (value: Uint8Array): string => {
  return bytesToBase64(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const DEFAULT_REACTION_EMOJI_INDEX = new Map<string, number>(
  DEFAULT_REACTION_EMOJIS.map((emoji, index) => [emoji, index] as const)
);

const base64UrlToBytes = (value: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) {
    return undefined;
  }

  try {
    const paddingLength = (4 - (value.length % 4)) % 4;
    const paddedBase64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat(paddingLength)}`;
    return base64ToBytes(paddedBase64);
  } catch {
    return undefined;
  }
};

export const encodeCompactReactionTargetTxHash = (targetTxHash: string): string | undefined => {
  const normalized = targetTxHash.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    return undefined;
  }

  const hex = normalized.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    const nextByte = Number.parseInt(hex.slice(index, index + 2), 16);
    if (!Number.isFinite(nextByte) || nextByte < 0 || nextByte > 255) {
      return undefined;
    }
    bytes[index / 2] = nextByte;
  }

  return `~${bytesToBase64Url(bytes)}`;
};

export const decodeCompactReactionTargetTxHash = (encodedChunk: string): string | undefined => {
  if (encodedChunk.startsWith('~')) {
    const bytes = base64UrlToBytes(encodedChunk.slice(1));
    if (!bytes || bytes.length !== 32) {
      return undefined;
    }

    let hex = '';
    for (const nextByte of bytes) {
      hex += nextByte.toString(16).padStart(2, '0');
    }
    return `0x${hex}`;
  }

  const symbols = Array.from(encodedChunk);
  if (symbols.length !== 64) {
    return undefined;
  }

  let hex = '';
  for (const symbol of symbols) {
    const nibbleValue = REACTION_HIDDEN_NIBBLE_LOOKUP.get(symbol);
    if (nibbleValue === undefined) {
      return undefined;
    }
    hex += nibbleValue.toString(16);
  }

  return `0x${hex}`;
};

export const encodeCompactReactionTargetReference = (
  targetTxHash: string,
  targetBlockNumber?: number,
  targetLogIndex?: number
): string | undefined => {
  const compactReference = encodeCompactMessageReference(targetBlockNumber, targetLogIndex);
  if (compactReference) {
    return `@${compactReference}`;
  }

  return encodeCompactReactionTargetTxHash(targetTxHash);
};

export const decodeCompactReactionTargetReference = (
  encodedChunk: string
): { targetTxHash?: string; targetBlockNumber?: number; targetLogIndex?: number } | undefined => {
  if (encodedChunk.startsWith('@')) {
    const decodedReference = decodeCompactMessageReference(encodedChunk.slice(1));
    if (!decodedReference) {
      return undefined;
    }

    return {
      targetBlockNumber: decodedReference.blockNumber,
      targetLogIndex: decodedReference.logIndex
    };
  }

  const targetTxHash = decodeCompactReactionTargetTxHash(encodedChunk);
  if (!targetTxHash) {
    return undefined;
  }

  return { targetTxHash };
};

export const encodeCompactReactionEmoji = (emoji: string): string | undefined => {
  const normalizedEmoji = normalizeReactionEmoji(emoji);
  if (!normalizedEmoji) {
    return undefined;
  }

  const defaultEmojiIndex = DEFAULT_REACTION_EMOJI_INDEX.get(normalizedEmoji);
  if (defaultEmojiIndex !== undefined) {
    return `!${defaultEmojiIndex.toString(36)}`;
  }

  return bytesToBase64Url(TEXT_ENCODER.encode(normalizedEmoji));
};

export const decodeCompactReactionEmoji = (encodedChunk: string): string | undefined => {
  if (encodedChunk.startsWith('!')) {
    const defaultEmojiIndex = Number.parseInt(encodedChunk.slice(1), 36);
    if (!Number.isFinite(defaultEmojiIndex) || defaultEmojiIndex < 0 || defaultEmojiIndex >= DEFAULT_REACTION_EMOJIS.length) {
      return undefined;
    }
    return DEFAULT_REACTION_EMOJIS[defaultEmojiIndex];
  }

  const bytes = base64UrlToBytes(encodedChunk);
  if (!bytes || bytes.length === 0) {
    return undefined;
  }

  try {
    return normalizeReactionEmoji(TEXT_DECODER.decode(bytes));
  } catch {
    return undefined;
  }
};

export const encodeHiddenMetadata = (value: string): string => {
  const bytes = TEXT_ENCODER.encode(value);
  let encoded = '';
  for (const byte of bytes) {
    for (let bitIndex = 7; bitIndex >= 0; bitIndex -= 1) {
      encoded += byte & (1 << bitIndex) ? CONTACT_NAME_ENCODING_ONE : CONTACT_NAME_ENCODING_ZERO;
    }
  }
  return encoded;
};

export const decodeHiddenMetadata = (encodedChunk: string): string | undefined => {
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

  return TEXT_DECODER.decode(bytes);
};

export const buildMessageWithReactionPayload = (
  targetTxHash: string,
  emoji: string,
  plainText = '',
  targetBlockNumber?: number,
  targetLogIndex?: number
): string => {
  const normalizedTxHash = targetTxHash.trim().toLowerCase();
  const normalizedEmoji = normalizeReactionEmoji(emoji);
  const encodedTargetReference = encodeCompactReactionTargetReference(normalizedTxHash, targetBlockNumber, targetLogIndex);
  const encodedEmoji = normalizedEmoji ? encodeCompactReactionEmoji(normalizedEmoji) : undefined;
  if (!encodedTargetReference || !normalizedEmoji) {
    return plainText;
  }

  const sanitizedFallbackText = plainText.split(REACTION_METADATA_PREFIX).join('').trim();
  if (encodedEmoji) {
    return `${REACTION_METADATA_PREFIX}${encodedTargetReference}.${encodedEmoji}${REACTION_METADATA_PREFIX}${sanitizedFallbackText}`;
  }

  const visibleFallbackText = sanitizedFallbackText || normalizedEmoji;
  return `${REACTION_METADATA_PREFIX}${encodedTargetReference}${REACTION_METADATA_PREFIX}${visibleFallbackText}`;
};

export const parseMessageReactionPayload = (text: string): { cleanText: string; reaction?: MessageReactionPayload } => {
  if (!text.startsWith(REACTION_METADATA_PREFIX)) {
    return { cleanText: text };
  }

  const metadataEnd = text.indexOf(REACTION_METADATA_PREFIX, REACTION_METADATA_PREFIX.length);
  if (metadataEnd <= REACTION_METADATA_PREFIX.length) {
    return { cleanText: text };
  }

  const metadataChunk = text.slice(REACTION_METADATA_PREFIX.length, metadataEnd);
  const remaining = text.slice(metadataEnd + REACTION_METADATA_PREFIX.length);
  const compactMetadataSeparatorIndex = metadataChunk.indexOf('.');
  if (compactMetadataSeparatorIndex > 0) {
    const compactTarget = decodeCompactReactionTargetReference(metadataChunk.slice(0, compactMetadataSeparatorIndex));
    const compactEmoji = decodeCompactReactionEmoji(metadataChunk.slice(compactMetadataSeparatorIndex + 1));
    if (compactTarget && compactEmoji) {
      return {
        cleanText: remaining,
        reaction: {
          targetTxHash: compactTarget.targetTxHash,
          targetBlockNumber: compactTarget.targetBlockNumber,
          targetLogIndex: compactTarget.targetLogIndex,
          emoji: compactEmoji
        }
      };
    }
  }

  const compactTarget = decodeCompactReactionTargetReference(metadataChunk);
  if (compactTarget) {
    const remainingEmoji = normalizeReactionEmoji(remaining);
    if (!remainingEmoji) {
      return { cleanText: remaining };
    }
    return {
      cleanText: '',
      reaction: {
        targetTxHash: compactTarget.targetTxHash,
        targetBlockNumber: compactTarget.targetBlockNumber,
        targetLogIndex: compactTarget.targetLogIndex,
        emoji: remainingEmoji
      }
    };
  }

  const decodedMetadataChunk = decodeHiddenMetadata(metadataChunk);
  const metadataValue = decodedMetadataChunk ?? metadataChunk;
  const separatorIndex = metadataValue.indexOf('|');
  if (separatorIndex <= 0) {
    return { cleanText: text };
  }

  const targetTxHash = metadataValue.slice(0, separatorIndex).trim().toLowerCase();
  const emojiChunk = metadataValue.slice(separatorIndex + 1);
  const emoji = normalizeReactionEmoji(emojiChunk);
  if (!/^0x[a-f0-9]{64}$/.test(targetTxHash) || !emoji) {
    return { cleanText: text };
  }

  const normalizedRemainingReaction = normalizeReactionEmoji(remaining);
  const cleanText =
    normalizedRemainingReaction && normalizedRemainingReaction === emoji ? '' : remaining;
  return {
    cleanText,
    reaction: {
      targetTxHash,
      emoji
    }
  };
};

export const encodeHiddenContactName = (contactName: string): string => {
  return encodeHiddenMetadata(contactName);
};

export const decodeHiddenContactName = (encodedChunk: string): string | undefined => {
  const decoded = decodeHiddenMetadata(encodedChunk);
  if (!decoded) {
    return undefined;
  }
  return normalizeContactName(decoded)?.slice(0, 42);
};

export const buildMessageWithContactNamePayload = (plainText: string, contactName?: string): string => {
  const normalizedContactName = normalizeContactName(contactName ?? '')?.slice(0, 42);
  if (!normalizedContactName) {
    return plainText;
  }
  const encodedContactName = encodeHiddenContactName(normalizedContactName);
  return `${CONTACT_NAME_METADATA_PREFIX}${encodedContactName}${CONTACT_NAME_METADATA_PREFIX}${plainText}`;
};

export const parseContactNamePayload = (text: string): { cleanText: string; contactName?: string } => {
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

export const parseBooleanFlag = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return undefined;
};

export const parseConversationPreferenceStateValue = (rawValue: string): ConversationPreferenceState | undefined => {
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) {
    return undefined;
  }

  // Compact v2 payload: one character encoding both flags.
  if (/^[0-3]$/.test(normalizedValue)) {
    const code = Number.parseInt(normalizedValue, 10);
    return {
      muted: (code & 0b10) === 0b10,
      hidden: (code & 0b01) === 0b01
    };
  }

  try {
    const parsed = JSON.parse(normalizedValue) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    const muted = parseBooleanFlag(parsed.m ?? parsed.muted);
    const hidden = parseBooleanFlag(parsed.h ?? parsed.hidden);
    if (typeof muted !== 'boolean' && typeof hidden !== 'boolean') {
      return undefined;
    }

    // State payload is treated as a full snapshot.
    return {
      muted: muted ?? false,
      hidden: hidden ?? false
    };
  } catch {
    return undefined;
  }
};

export const buildMessageWithConversationStatePayload = (
  plainText: string,
  state: ConversationPreferenceState
): string => {
  const normalizedState = normalizeConversationPreferenceState(state);
  if (!normalizedState) {
    return plainText;
  }

  const muted = normalizedState.muted ?? false;
  const hidden = normalizedState.hidden ?? false;

  // Compact v2 payload: single character (0..3) instead of JSON.
  const compactStateCode = String((muted ? 0b10 : 0) | (hidden ? 0b01 : 0));
  const serializedPayload = compactStateCode;
  const encodedPayload = encodeHiddenMetadata(serializedPayload);
  const sanitizedPlainText = CONVERSATION_STATE_METADATA_PREFIXES.reduce(
    (currentText, marker) => currentText.split(marker).join(''),
    plainText
  ).trim();
  if (!sanitizedPlainText) {
    return `${CONVERSATION_STATE_METADATA_PREFIX}${encodedPayload}${CONVERSATION_STATE_METADATA_PREFIX}`;
  }
  // Place visible text first for better compatibility with apps that don't parse metadata.
  return `${sanitizedPlainText}${CONVERSATION_STATE_METADATA_PREFIX}${encodedPayload}${CONVERSATION_STATE_METADATA_PREFIX}`;
};

export const parseConversationStatePayloadWithPrefix = (
  text: string,
  prefix: string
): { cleanText: string; conversationState: ConversationPreferenceState } | undefined => {
  // Legacy format: <prefix><metadata><prefix><visible-text>
  if (text.startsWith(prefix)) {
    const metadataEnd = text.indexOf(prefix, prefix.length);
    if (metadataEnd > prefix.length) {
      const metadataChunk = text.slice(prefix.length, metadataEnd);
      const decodedChunk = decodeHiddenMetadata(metadataChunk) ?? metadataChunk;
      const conversationState = parseConversationPreferenceStateValue(decodedChunk);
      if (conversationState) {
        const remaining = text.slice(metadataEnd + prefix.length);
        return {
          cleanText: remaining,
          conversationState
        };
      }
    }
  }

  // Current format: <visible-text><prefix><metadata><prefix>
  const metadataEnd = text.lastIndexOf(prefix);
  if (metadataEnd <= 0) {
    return undefined;
  }

  const metadataStart = text.lastIndexOf(prefix, metadataEnd - 1);
  if (metadataStart < 0 || metadataStart === metadataEnd) {
    return undefined;
  }

  const metadataChunk = text.slice(metadataStart + prefix.length, metadataEnd);
  const decodedChunk = decodeHiddenMetadata(metadataChunk) ?? metadataChunk;
  const conversationState = parseConversationPreferenceStateValue(decodedChunk);
  if (!conversationState) {
    return undefined;
  }

  const cleanText = `${text.slice(0, metadataStart)}${text.slice(metadataEnd + prefix.length)}`.trim();
  return {
    cleanText,
    conversationState
  };
};

export const parseConversationStatePayload = (
  text: string
): { cleanText: string; conversationState?: ConversationPreferenceState } => {
  for (const prefix of CONVERSATION_STATE_METADATA_PREFIXES) {
    const parsed = parseConversationStatePayloadWithPrefix(text, prefix);
    if (parsed) {
      return parsed;
    }
  }
  return { cleanText: text };
};

export const parseMessageReplyPayload = (text: string): {
  cleanText: string;
  replyToText?: string;
  replyToMessageId?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
} => {
  let workingText = text;
  let replyToTxHash: string | undefined;
  let replyToBlockNumber: number | undefined;
  let replyToLogIndex: number | undefined;
  const compactReferenceMatch = workingText.match(EXTERNAL_REPLY_REFERENCE_REGEX);
  if (compactReferenceMatch) {
    const decodedReference = decodeCompactMessageReference(compactReferenceMatch[1]);
    if (decodedReference) {
      replyToBlockNumber = decodedReference.blockNumber;
      replyToLogIndex = decodedReference.logIndex;
      workingText = workingText.slice(compactReferenceMatch[0].length);
    }
  }

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
        replyToTxHash,
        replyToBlockNumber,
        replyToLogIndex
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
        replyToTxHash,
        replyToBlockNumber,
        replyToLogIndex
      };
    }
  }

  if (!workingText.startsWith(REPLY_DELIMITER)) {
    return { cleanText: workingText, replyToTxHash, replyToBlockNumber, replyToLogIndex };
  }

  const delimiterEnd = workingText.indexOf(REPLY_DELIMITER, REPLY_DELIMITER.length);
  if (delimiterEnd < 0) {
    return { cleanText: workingText, replyToTxHash, replyToBlockNumber, replyToLogIndex };
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
    replyToTxHash,
    replyToBlockNumber,
    replyToLogIndex
  };
};

export const parseMessageProfilePayload = (text: string): { cleanText: string; nickname?: string } => {
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

export const parseChatMessagePayload = (text: string): {
  cleanText: string;
  replyToMessageId?: string;
  replyToText?: string;
  replyToTxHash?: string;
  replyToBlockNumber?: number;
  replyToLogIndex?: number;
  embeddedNickname?: string;
  embeddedContactName?: string;
  embeddedConversationState?: ConversationPreferenceState;
  embeddedReaction?: MessageReactionPayload;
} => {
  const conversationStateParsed = parseConversationStatePayload(text);
  const contactNameParsed = parseContactNamePayload(conversationStateParsed.cleanText);
  const profileParsed = parseMessageProfilePayload(contactNameParsed.cleanText);
  const reactionParsed = parseMessageReactionPayload(profileParsed.cleanText);
  const replyParsed = parseMessageReplyPayload(reactionParsed.cleanText);

  return {
    cleanText: replyParsed.cleanText,
    replyToMessageId: replyParsed.replyToMessageId,
    replyToText: replyParsed.replyToText,
    replyToTxHash: replyParsed.replyToTxHash,
    replyToBlockNumber: replyParsed.replyToBlockNumber,
    replyToLogIndex: replyParsed.replyToLogIndex,
    embeddedNickname: profileParsed.nickname,
    embeddedContactName: contactNameParsed.contactName,
    embeddedConversationState: conversationStateParsed.conversationState,
    embeddedReaction: reactionParsed.reaction
  };
};

export const getMessageDisplayText = (text: string, direction?: 'incoming' | 'outgoing'): string => {
  if (text.startsWith(IMAGE_MESSAGE_PREFIX)) {
    return '[Image disabled for security]';
  }

  const parsedTipPayload = parseTipNoticePayload(text);
  if (parsedTipPayload) {
    return formatTipNoticeText(
      formatCotiAmount(parsedTipPayload.tipAmountWei),
      parsedTipPayload.messageCount,
      direction
    );
  }

  const parsedTokenTip = parseTokenTipNotice(text);
  if (parsedTokenTip) {
    if (direction === 'outgoing') {
      return `You tipped ${parsedTokenTip.amount} ${parsedTokenTip.symbol}.`;
    }
    return `You received ${parsedTokenTip.amount} ${parsedTokenTip.symbol}.`;
  }

  const legacyTipMatch = text.match(/^\[TIP\]\s*You received\s+([0-9]+(?:\.[0-9]+)?)\s+COTI\s+\((\d+)\s+messages?\)\.?$/i);
  if (legacyTipMatch) {
    const amountCoti = legacyTipMatch[1];
    const messageCount = Number.parseInt(legacyTipMatch[2], 10);
    if (Number.isFinite(messageCount) && messageCount >= 0) {
      return formatTipNoticeText(amountCoti, messageCount, direction);
    }
  }

  return text;
};

