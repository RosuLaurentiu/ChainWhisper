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
    ? `MetaMask short mode: ${subject} would likely need about ${pluralizePrompt(estimate.estimatedEncryptionPrompts, 'encryption prompt')} plus 1 transaction approval in multipart mode. Shorten it or switch to the app wallet.`
    : `MetaMask short mode: ${subject} should fit single-send mode: about ${pluralizePrompt(estimate.estimatedEncryptionPrompts, 'encryption prompt')} plus 1 transaction approval.`;
