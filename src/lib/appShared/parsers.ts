import {
  base64ToBytes,
  bytesToBase64
} from '../byteEncoding';
import {
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
  EXTERNAL_REPLY_TXHASH_REGEX,
  formatCotiAmount,
  formatTipNoticeText,
  IMAGE_MESSAGE_PREFIX,
  isShortAddress,
  isWalletAddress,
  LEGACY_PROFILE_METADATA_PREFIX,
  LEGACY_PROFILE_PLAIN_PREFIX,
  LEGACY_PROFILE_PREFIX,
  LEGACY_REPLY_METADATA_PREFIX,
  MAX_REPLY_PREVIEW_LENGTH,
  MessageReactionPayload,
  NICKNAME_DELIMITER,
  normalizeContactName,
  parseTipNoticePayload,
  parseTokenTipNotice,
  PROFILE_METADATA_PREFIX,
  REACTION_HIDDEN_NIBBLE_LOOKUP,
  REACTION_METADATA_PREFIX,
  RecentPeerMeta,
  REPLY_DELIMITER,
  REPLY_METADATA_PREFIX,
  REPLY_METADATA_PREFIX_REGEX,
  shortenAddress,
  SubmitMemoPayload,
  TEXT_DECODER,
  TEXT_ENCODER,
  TradeMessageReferencePayload,
  toSafeNumber
} from './core';
import {
  formatTradeOfferDisplayText,
  formatTradeResponseDisplayText,
  parseMessageTradeReferencePayload,
  parseTradeOfferMessagePayload,
  parseTradeResponseMessagePayload
} from './tradeMessages';

export {
  base64ToBytes,
  bytesToBase64,
  toArrayBuffer
} from '../byteEncoding';
export * from './stateBackup';
export * from './tradeMessages';

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

  if (memo && typeof memo === 'object' && 'userCiphertext' in memo) {
    return { value: toBigIntArray((memo as { userCiphertext: unknown }).userCiphertext) };
  }

  if (memo && typeof memo === 'object' && 'value' in memo) {
    return { value: toBigIntArray((memo as { value: unknown }).value) };
  }

  if (Array.isArray(memo)) {
    if (memo.every((item) => typeof item === 'bigint' || typeof item === 'number' || typeof item === 'string')) {
      return { value: toBigIntArray(memo) };
    }
    if (memo.length > 1) {
      return { value: toBigIntArray(memo[1]) };
    }
    if (memo.length === 1) {
      return extractUserCiphertext(memo[0]);
    }
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

const EXTERNAL_REPLY_REFERENCE_REGEX = /^\[r2:([A-Za-z0-9\-_]+)\]\s*/;
const COMPACT_MESSAGE_REFERENCE_REGEX = /^([0-9a-z]+)-([0-9a-z]+)$/i;
const SHARED_TX_REFERENCE_PREFIX_BYTES = 4;
const SHARED_TX_REFERENCE_PREFIX_BASE64_LENGTH = 6;
const SHARED_TX_REFERENCE_REGEX = new RegExp(
  `^x([0-9a-z]+)-([A-Za-z0-9\\-_]{${SHARED_TX_REFERENCE_PREFIX_BASE64_LENGTH}})$`
);

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

export const encodeCompactSharedTxReference = (txHash?: string, blockNumber?: number): string | undefined => {
  const normalizedTxHash = txHash?.trim().toLowerCase() ?? '';
  if (!/^0x[a-f0-9]{64}$/.test(normalizedTxHash) || !isSafeMessageReferencePart(blockNumber)) {
    return undefined;
  }

  const prefixHexLength = SHARED_TX_REFERENCE_PREFIX_BYTES * 2;
  const prefixHex = normalizedTxHash.slice(2, 2 + prefixHexLength);
  const prefixBytes = new Uint8Array(SHARED_TX_REFERENCE_PREFIX_BYTES);
  for (let index = 0; index < prefixHex.length; index += 2) {
    const nextByte = Number.parseInt(prefixHex.slice(index, index + 2), 16);
    if (!Number.isFinite(nextByte) || nextByte < 0 || nextByte > 255) {
      return undefined;
    }
    prefixBytes[index / 2] = nextByte;
  }

  return `x${blockNumber.toString(36)}-${bytesToBase64Url(prefixBytes)}`;
};

export const decodeCompactSharedTxReference = (
  encodedChunk: string
): { blockNumber: number; txHashPrefix: string; normalizedReference: string } | undefined => {
  const match = encodedChunk.trim().match(SHARED_TX_REFERENCE_REGEX);
  if (!match) {
    return undefined;
  }

  const blockNumber = Number.parseInt(match[1], 36);
  if (!isSafeMessageReferencePart(blockNumber)) {
    return undefined;
  }

  const txHashPrefix = match[2];
  return {
    blockNumber,
    txHashPrefix,
    normalizedReference: `x${match[1].toLowerCase()}-${txHashPrefix}`
  };
};

export const buildMessageWithReplyPayload = (
  plainText: string,
  replyToText?: string,
  replyToTxHash?: string,
  replyToBlockNumber?: number,
  replyToLogIndex?: number,
  preferSharedReference = false
): string => {
  const sharedTxReference = encodeCompactSharedTxReference(replyToTxHash, replyToBlockNumber);
  const compactReference = encodeCompactMessageReference(replyToBlockNumber, replyToLogIndex);
  const preferredReference = preferSharedReference
    ? sharedTxReference ?? compactReference
    : compactReference ?? sharedTxReference;
  const externalReplyPrefix = preferredReference
    ? `[r2:${preferredReference}] `
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
  const sharedTxReference = encodeCompactSharedTxReference(targetTxHash, targetBlockNumber);
  if (sharedTxReference) {
    return `@${sharedTxReference}`;
  }

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
    const sharedTxReference = decodeCompactSharedTxReference(encodedChunk.slice(1));
    if (sharedTxReference) {
      return {
        targetTxHash: sharedTxReference.normalizedReference,
        targetBlockNumber: sharedTxReference.blockNumber
      };
    }

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
  targetLogIndex?: number,
  preferSharedReference = false
): string => {
  const normalizedTxHash = targetTxHash.trim().toLowerCase();
  const normalizedEmoji = normalizeReactionEmoji(emoji);
  const encodedTargetReference = preferSharedReference
    ? encodeCompactSharedTxReference(normalizedTxHash, targetBlockNumber)
      ? `@${encodeCompactSharedTxReference(normalizedTxHash, targetBlockNumber)}`
      : encodeCompactReactionTargetReference(normalizedTxHash, targetBlockNumber, targetLogIndex)
    : encodeCompactMessageReference(targetBlockNumber, targetLogIndex)
      ? `@${encodeCompactMessageReference(targetBlockNumber, targetLogIndex)}`
      : encodeCompactReactionTargetReference(normalizedTxHash, targetBlockNumber, targetLogIndex);
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
    const sharedTxReference = decodeCompactSharedTxReference(compactReferenceMatch[1]);
    if (sharedTxReference) {
      replyToTxHash = sharedTxReference.normalizedReference;
      replyToBlockNumber = sharedTxReference.blockNumber;
      workingText = workingText.slice(compactReferenceMatch[0].length);
    } else {
      const decodedReference = decodeCompactMessageReference(compactReferenceMatch[1]);
      if (decodedReference) {
        replyToBlockNumber = decodedReference.blockNumber;
        replyToLogIndex = decodedReference.logIndex;
        workingText = workingText.slice(compactReferenceMatch[0].length);
      }
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
  tradeReference?: TradeMessageReferencePayload;
} => {
  const conversationStateParsed = parseConversationStatePayload(text);
  const contactNameParsed = parseContactNamePayload(conversationStateParsed.cleanText);
  const profileParsed = parseMessageProfilePayload(contactNameParsed.cleanText);
  const reactionParsed = parseMessageReactionPayload(profileParsed.cleanText);
  const tradeReferenceParsed = parseMessageTradeReferencePayload(reactionParsed.cleanText);
  const replyParsed = parseMessageReplyPayload(tradeReferenceParsed.cleanText);

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
    embeddedReaction: reactionParsed.reaction,
    tradeReference: tradeReferenceParsed.tradeReference
  };
};

export const getMessageDisplayText = (text: string, direction?: 'incoming' | 'outgoing'): string => {
  if (text.startsWith(IMAGE_MESSAGE_PREFIX)) {
    return '[Image disabled for security]';
  }

  const parsedTradeOffer = parseTradeOfferMessagePayload(text);
  if (parsedTradeOffer) {
    return formatTradeOfferDisplayText(parsedTradeOffer, direction);
  }

  const parsedTradeResponse = parseTradeResponseMessagePayload(text);
  if (parsedTradeResponse) {
    return formatTradeResponseDisplayText(parsedTradeResponse, direction);
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

