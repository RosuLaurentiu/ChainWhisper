import { TEXT_ENCODER } from './appShared';
import { CHAT_GC_MAX_SINGLE_MESSAGE_CELLS, splitUtf8SafeChunks } from './chatGc';

export const METAMASK_SINGLE_SEND_MAX_ESTIMATED_CHUNKS = 4;
export const ESTIMATED_BYTES_PER_ENCRYPTION_PROMPT = 8;

export type ChatWalletPromptEstimate = {
  plaintextBytes: number;
  encodedBytes: number;
  encryptedChunkCount: number;
  estimatedEncryptedCellCount: number;
  estimatedEncryptionPrompts: number;
  estimatedTransactionApprovals: number;
  estimatedWalletPrompts: number;
  likelyMultipart: boolean;
};

const estimateEncryptedCellCount = (encodedByteCount: number): number =>
  Math.max(1, Math.ceil(encodedByteCount / ESTIMATED_BYTES_PER_ENCRYPTION_PROMPT));

export const estimateChatWalletPromptLoad = (
  plainText: string,
  encodeMemo: (plain: string) => string
): ChatWalletPromptEstimate => {
  const plaintextBytes = TEXT_ENCODER.encode(plainText).length;
  const encodedBytes = TEXT_ENCODER.encode(encodeMemo(plainText)).length;
  const chunks = splitUtf8SafeChunks(plainText);
  const encryptedChunkCount = chunks.length;
  const estimatedEncryptedCellCount = estimateEncryptedCellCount(encodedBytes);
  const likelyMultipart = estimatedEncryptedCellCount > CHAT_GC_MAX_SINGLE_MESSAGE_CELLS;
  const estimatedMultipartEncryptionPrompts = chunks.reduce((total, chunk) => {
    const chunkEncodedBytes = TEXT_ENCODER.encode(encodeMemo(chunk)).length;
    return total + estimateEncryptedCellCount(chunkEncodedBytes);
  }, 0);
  const estimatedEncryptionPrompts = likelyMultipart
    ? estimatedMultipartEncryptionPrompts
    : estimatedEncryptedCellCount;
  const estimatedTransactionApprovals = 1;

  return {
    plaintextBytes,
    encodedBytes,
    encryptedChunkCount,
    estimatedEncryptedCellCount,
    estimatedEncryptionPrompts,
    estimatedTransactionApprovals,
    estimatedWalletPrompts: estimatedEncryptionPrompts + estimatedTransactionApprovals,
    likelyMultipart
  };
};

const pluralizePrompt = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`;

export const buildMetaMaskPromptEstimateMessage = (
  estimate: ChatWalletPromptEstimate,
  subject = 'this message'
): string =>
  estimate.likelyMultipart
    ? `Legacy chat estimate: ${subject} would likely need about ${pluralizePrompt(estimate.estimatedEncryptionPrompts, 'encryption prompt')} plus 1 transaction approval. Chat V2 sends locally encrypted messages with one wallet transaction.`
    : `Legacy wallet short mode: ${subject} should fit single-send mode: about ${pluralizePrompt(estimate.estimatedEncryptionPrompts, 'encryption prompt')} plus 1 transaction approval.`;

export type DirectChatV2PromptConversationState =
  | 'checking'
  | 'existing'
  | 'new'
  | 'unavailable';

export const buildDirectChatV2PromptEstimateMessage = (
  subject = 'this message',
  conversationState: DirectChatV2PromptConversationState = 'checking'
): string => {
  if (conversationState === 'existing') {
    return `After privacy unlock, Chat V2 estimates 1 wallet transaction for ${subject}. Encryption uses the shared chat key locally (0 COTI private-input confirmations).`;
  }
  if (conversationState === 'new') {
    return `After privacy unlock, a new Chat V2 conversation estimates 2 wallet transactions total: 1 one-time setup + 1 send for ${subject}. The contract creates the shared key (0 COTI private-input confirmations).`;
  }
  if (conversationState === 'unavailable') {
    return 'Chat V2 is still initializing, so its wallet estimate is not available yet. The legacy ChatGC encryption-prompt estimate does not apply.';
  }
  return `Checking whether this Chat V2 conversation is already set up. After privacy unlock: an existing chat needs 1 wallet transaction for ${subject}; a new chat needs 2 total (setup + send). Both use 0 COTI private-input confirmations.`;
};

export const buildGroupChatV2PromptEstimateMessage = (
  subject = 'this group message'
): string =>
  `After privacy unlock, Group Chat V2 estimates 1 wallet transaction for ${subject}. Encryption uses the shared group key locally (0 COTI private-input confirmations).`;

export type DirectTradeV2OfferAssetKind = 'native' | 'erc20' | 'private-erc20' | 'unknown';

export const buildDirectTradeV2PromptEstimateMessage = ({
  offerAssetKind,
  offerSymbol = 'the offered token'
}: {
  offerAssetKind: DirectTradeV2OfferAssetKind;
  offerSymbol?: string;
}): string => {
  const symbol = offerSymbol.trim() || 'the offered token';
  if (offerAssetKind === 'private-erc20') {
    return `Direct Trade V2 estimates 2 packed COTI private-input confirmations plus 1 offer transaction. If ${symbol} is not yet approved for this escrow, its one-time private-token approval adds 1 COTI confirmation and 1 wallet transaction. The escrow event creates the chat card, so there is no separate chat-notification transaction.`;
  }
  if (offerAssetKind === 'erc20') {
    return `Direct Trade V2 estimates 1 offer transaction. If ${symbol} is not yet approved for this escrow, its one-time token approval adds 1 wallet transaction. The escrow event creates the chat card, so there is no separate chat-notification transaction.`;
  }
  if (offerAssetKind === 'native') {
    return 'Direct Trade V2 estimates 1 offer transaction. Native COTI needs no token approval, and the escrow event creates the chat card with no separate chat-notification transaction.';
  }
  return 'Direct Trade V2 estimates 1 offer transaction for public terms or 2 packed COTI private-input confirmations plus 1 offer transaction for private terms. A one-time token approval may add a transaction. The escrow event creates the chat card with no separate chat-notification transaction.';
};
