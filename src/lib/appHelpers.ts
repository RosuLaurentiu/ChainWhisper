import {
  CONTACT_NAME_ENCODING_ONE,
  CONTACT_NAME_ENCODING_ZERO,
  CONTACT_NAME_METADATA_PREFIX,
  CONVERSATION_STATE_METADATA_PREFIX,
  LEGACY_CONVERSATION_STATE_METADATA_PREFIX,
  NICKNAME_DELIMITER,
  PROFILE_METADATA_PREFIX,
  REACTION_METADATA_PREFIX,
  REPLY_DELIMITER,
  REPLY_METADATA_PREFIX,
  extractRevertData,
  getProviderErrorMessage,
  type ChatMessage,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from './appShared';

export type MessageReferenceCandidate = {
  txHash?: string;
  blockNumber?: number;
  logIndex?: number;
};

export type TradeTokenPresetKey = 'coti' | 'wisp' | 'pwisp' | 'custom-public' | 'custom-private';

export type ResolvedTradeToken = Omit<TradeAssetPayload, 'amount'>;

export type TradeCustomTokenInfo = {
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;
  address: string;
  symbol: string;
  decimals: number;
  balanceWei: bigint | null;
  loading: boolean;
  error?: string;
  walletKey?: string;
};

export type TradeComposerFieldErrors = {
  general?: string;
  fee?: string;
  offerAsset?: string;
  requestAsset?: string;
  offerAmount?: string;
  requestAmount?: string;
  expiry?: string;
};

export type PendingTradeCounterContext = {
  offer: TradeOfferMessagePayload;
  sourceMessage: ChatMessage;
};

export const DEFAULT_TRADE_EXPIRY_HOURS = '24';

const TRADE_STATUS_OPEN = 1;
const TRADE_STATUS_ACCEPTED = 2;
const TRADE_STATUS_CANCELLED = 3;
const TRADE_STATUS_DECLINED = 4;
const TRADE_STATUS_EXPIRED = 5;
const TRADE_ASSET_TYPE_NATIVE = 0;
const TRADE_ASSET_TYPE_ERC20 = 1;
const TRADE_ASSET_TYPE_PRIVATE_ERC20 = 2;

const TRADE_ERROR_MESSAGE_BY_SELECTOR: Record<string, string> = {
  '0xfceb320b': 'This trade needs its full private link before it can be accepted.',
  '0x025dbdd4': 'Insufficient escrow fee. Check the required COTI or token fee and try again.',
  '0xe6c4247b': 'Invalid wallet address for this trade action.'
};

export const resolveTradeSnapshotStatus = (statusRaw: unknown, expiresAt: number): TradeSnapshot['status'] => {
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
  if (status === TRADE_STATUS_EXPIRED) {
    return 'expired';
  }
  return 'unknown';
};

export const isCustomTradeTokenSelection = (selection: TradeTokenPresetKey): boolean =>
  selection === 'custom-public' || selection === 'custom-private';

export const resolveTradePresetKind = (selection: TradeTokenPresetKey): TradeAssetPayload['kind'] => {
  if (selection === 'coti') {
    return 'native';
  }
  return selection === 'pwisp' || selection === 'custom-private' ? 'private-erc20' : 'erc20';
};

export const buildTradeCustomTokenInfoKey = (
  kind: Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>,
  address: string
): string => `${kind}:${address.trim().toLowerCase()}`;

export const resolveTradeAssetTypeValue = (kind: TradeAssetPayload['kind']): number => {
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

export const parseSharedTxReference = (
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

export const buildMessageReferenceKeys = ({ txHash, blockNumber, logIndex }: MessageReferenceCandidate): string[] => {
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

export const buildMessageReferenceKey = (candidate: MessageReferenceCandidate): string =>
  buildMessageReferenceKeys(candidate)[0] ?? '';

export const messageReferencesMatch = (left: MessageReferenceCandidate, right: MessageReferenceCandidate): boolean => {
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

export const sanitizeOutgoingMessagePlainText = (value: string): string =>
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

export const getOnChainFailureMessage = (error: unknown, fallbackMessage: string): string => {
  if (isLikelyOutOfGasFailure(error)) {
    return 'Transaction ran out of gas on-chain. Try a shorter message, clear any reply, or use a smaller group.';
  }

  const revertData = extractRevertData(error);
  if (revertData) {
    const mappedMessage = TRADE_ERROR_MESSAGE_BY_SELECTOR[revertData.slice(0, 10).toLowerCase()];
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
