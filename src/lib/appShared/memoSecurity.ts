export const MAX_CHAT_MEMO_PLAINTEXT_BYTES = 16 * 1024;
export const MAX_CHAT_MEMO_CIPHERTEXT_CELLS = MAX_CHAT_MEMO_PLAINTEXT_BYTES / 8;

// Historical self-backups could include per-contact read state. Keep a larger,
// still-bounded allowance for those wallet-authored compatibility payloads.
export const MAX_STATE_BACKUP_PLAINTEXT_BYTES = 256 * 1024;
export const MAX_STATE_BACKUP_CIPHERTEXT_CELLS = 64 * 1024;

export type MemoSecurityLimits = Readonly<{
  maxCiphertextCells: number;
  maxPlaintextBytes: number;
}>;

export const CHAT_MEMO_SECURITY_LIMITS: MemoSecurityLimits = {
  maxCiphertextCells: MAX_CHAT_MEMO_CIPHERTEXT_CELLS,
  maxPlaintextBytes: MAX_CHAT_MEMO_PLAINTEXT_BYTES
};

export const STATE_BACKUP_MEMO_SECURITY_LIMITS: MemoSecurityLimits = {
  maxCiphertextCells: MAX_STATE_BACKUP_CIPHERTEXT_CELLS,
  maxPlaintextBytes: MAX_STATE_BACKUP_PLAINTEXT_BYTES
};

const getCiphertextCellCount = (ciphertext: unknown): number | null => {
  if (!ciphertext || typeof ciphertext !== 'object' || !('value' in ciphertext)) {
    return null;
  }

  const value = (ciphertext as { value?: unknown }).value;
  return Array.isArray(value) ? value.length : null;
};

export class MemoCiphertextLimitError extends Error {
  constructor() {
    super('Encrypted memo exceeds the supported ciphertext size.');
    this.name = 'MemoCiphertextLimitError';
  }
}

export const assertMemoCiphertextCellLimit = (ciphertext: unknown, maxCells: number): void => {
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) {
    throw new RangeError('The ciphertext cell limit must be a non-negative safe integer.');
  }

  const cellCount = getCiphertextCellCount(ciphertext);
  if (cellCount === null || cellCount > maxCells) {
    throw new MemoCiphertextLimitError();
  }
};

export const decryptMemoWithCellLimit = async <T>(
  ciphertext: unknown,
  maxCells: number,
  decrypt: () => Promise<T>
): Promise<T> => {
  assertMemoCiphertextCellLimit(ciphertext, maxCells);
  return decrypt();
};
