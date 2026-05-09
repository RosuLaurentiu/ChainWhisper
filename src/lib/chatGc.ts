import {
  CHAT_CONTRACT_ADDRESS,
  COTI_NETWORK,
  isWalletAddress,
  parseSubmitMemoPayload,
  TEXT_DECODER,
  TEXT_ENCODER,
  toSafeNumber,
  type RecentPeerMeta,
  type SubmitMemoPayload
} from './appShared';

export const CHAT_GC_MAX_CHUNK_CELLS = 3;
export const CHAT_GC_MAX_SINGLE_MESSAGE_CELLS = 64;
export const CHAT_GC_MAX_CHUNKS_PER_MESSAGE = 64;
export const CHAT_GC_RECENT_CONVERSATION_LIMIT = 50;
export const CHAT_GC_THREAD_PAGE_SIZE = 40;
export const CHAT_GC_DEEP_THREAD_PAGE_SIZE = 120;
export const CHAT_GC_CHUNK_PLAINTEXT_BYTES = 16;

export type ChatGcMessageView = {
  id: string;
  idNumber: number;
  from: string;
  to: string;
  blockNumber: number;
  timestamp: number;
  chunkCount: number;
  valueSent: bigint;
  feeTaken: bigint;
  ciphertext: unknown;
};

export type ChatGcConversationRef = RecentPeerMeta & {
  messageId: string;
};

export const normalizeChatGcMessageId = (value: unknown): string => {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value)).toString();
  }
  const raw = String(value ?? '').trim();
  if (/^\d+$/.test(raw)) {
    return raw.replace(/^0+(?=\d)/, '');
  }
  return '';
};

export const buildChatGcMessageKey = (
  messageId: unknown,
  chainId = COTI_NETWORK.chainIdDecimal,
  contractAddress = CHAT_CONTRACT_ADDRESS
): string => {
  const normalizedMessageId = normalizeChatGcMessageId(messageId);
  return normalizedMessageId
    ? `chatgc:${chainId}:${contractAddress.trim().toLowerCase()}:${normalizedMessageId}`
    : '';
};

export const isChatGcMessageKey = (value?: string): boolean =>
  /^chatgc:\d+:0x[a-f0-9]{40}:\d+$/.test(value?.trim().toLowerCase() ?? '');

export const splitUtf8SafeChunks = (value: string, maxBytes = CHAT_GC_CHUNK_PLAINTEXT_BYTES): string[] => {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of Array.from(value)) {
    const charBytes = TEXT_ENCODER.encode(char).length;
    if (charBytes > maxBytes) {
      if (current) {
        chunks.push(current);
        current = '';
        currentBytes = 0;
      }
      chunks.push(char);
      continue;
    }

    if (current && currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }

    current += char;
    currentBytes += charBytes;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [''];
};

export const submitMemoPayloadToTuple = (payload: SubmitMemoPayload): readonly [readonly [bigint[]], readonly string[]] =>
  [[payload.ciphertextValue], payload.signature] as const;

export const encryptedInputToSubmitMemoTuple = (
  encryptedInput: unknown
): readonly [readonly [bigint[]], readonly string[]] => submitMemoPayloadToTuple(parseSubmitMemoPayload(encryptedInput));

export const encryptedInputCellCount = (encryptedInput: unknown): number =>
  parseSubmitMemoPayload(encryptedInput).ciphertextValue.length;

export const isLikelySingleSubmitSizeError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /chunk|too\s*large|plaintext|64|cell|SingleMessage|invalid length/i.test(message);
};

const toBigIntValue = (value: unknown): bigint => {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.max(0, Math.floor(value)));
  }
  try {
    return BigInt(String(value ?? '0'));
  } catch {
    return 0n;
  }
};

export const parseChatGcMessageView = (raw: unknown): ChatGcMessageView | null => {
  if (!raw) {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const idRaw = Array.isArray(raw) ? raw[0] : source.id;
  const from = String(Array.isArray(raw) ? raw[1] : source.from ?? '').trim();
  const to = String(Array.isArray(raw) ? raw[2] : source.to ?? '').trim();
  if (!isWalletAddress(from) || !isWalletAddress(to)) {
    return null;
  }

  const id = normalizeChatGcMessageId(idRaw);
  if (!id) {
    return null;
  }

  return {
    id,
    idNumber: toSafeNumber(idRaw),
    from,
    to,
    blockNumber: toSafeNumber(Array.isArray(raw) ? raw[3] : source.blockNumber),
    timestamp: toSafeNumber(Array.isArray(raw) ? raw[4] : source.timestamp),
    chunkCount: Math.max(1, toSafeNumber(Array.isArray(raw) ? raw[5] : source.chunkCount)),
    valueSent: toBigIntValue(Array.isArray(raw) ? raw[6] : source.valueSent),
    feeTaken: toBigIntValue(Array.isArray(raw) ? raw[7] : source.feeTaken),
    ciphertext: Array.isArray(raw) ? raw[8] : source.ciphertext
  };
};

export const parseChatGcConversationRefs = (raw: unknown): ChatGcConversationRef[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const refs: ChatGcConversationRef[] = [];
  for (const entry of raw) {
    const source = entry as Record<string, unknown>;
    const peer = String(Array.isArray(entry) ? entry[0] : source.peer ?? '').trim();
    if (!isWalletAddress(peer)) {
      continue;
    }

    const key = peer.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    const messageId = normalizeChatGcMessageId(Array.isArray(entry) ? entry[1] : source.messageId);
    const lastBlock = toSafeNumber(Array.isArray(entry) ? entry[2] : source.blockNumber);
    const lastTime = toSafeNumber(Array.isArray(entry) ? entry[3] : source.timestamp);
    if (!messageId || (lastBlock <= 0 && lastTime <= 0)) {
      continue;
    }

    seen.add(key);
    refs.push({
      address: peer,
      lastBlock,
      lastTime,
      messageId
    });
  }

  return refs.sort((left, right) => {
    if (left.lastBlock !== right.lastBlock) {
      return right.lastBlock - left.lastBlock;
    }
    return right.lastTime - left.lastTime;
  });
};

export const decodeUtf8Bytes = (bytes: Uint8Array): string => TEXT_DECODER.decode(bytes);
