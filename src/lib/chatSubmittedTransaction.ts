/**
 * A chat transaction that the wallet broadcast, but whose receipt the App could
 * not read. The message can still confirm on COTI, so callers must not mark it
 * failed and must not send it again. History reconciles it by transaction hash.
 */
export class ChatTransactionUnconfirmedError extends Error {
  readonly code = 'CHAT_TRANSACTION_UNCONFIRMED' as const;
  readonly txHash: string;

  constructor(message: string, txHash: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ChatTransactionUnconfirmedError';
    this.txHash = txHash.toLowerCase();
    if (options && 'cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false });
    }
  }
}

const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/u;

/** Returns the broadcast hash when the error proves only that confirmation is unknown. */
export const getSubmittedChatTransactionHash = (error: unknown): string | null => {
  if (!(error instanceof ChatTransactionUnconfirmedError)) return null;
  return TRANSACTION_HASH_PATTERN.test(error.txHash) ? error.txHash : null;
};

/**
 * Native ethers wait errors that prove an outcome keep their meaning: a
 * replacement is reconciled by the caller and CALL_EXCEPTION is a reverted
 * receipt. Every other wait failure leaves the broadcast transaction unknown.
 */
export const wrapNativeChatTransactionWait = (
  nativeWait: () => Promise<unknown>,
  txHash: string,
  message: string
): (() => Promise<unknown>) => async () => {
  try {
    return await nativeWait();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'TRANSACTION_REPLACED' || code === 'CALL_EXCEPTION') throw error;
    const detail = error instanceof Error && error.message ? error.message : message;
    throw new ChatTransactionUnconfirmedError(detail, txHash, { cause: error });
  }
};

export const CHAT_MESSAGE_SUBMITTED_NOTICE =
  'Message submitted. COTI has not confirmed it yet. It will appear when history shows the transaction. Do not send it again.';
