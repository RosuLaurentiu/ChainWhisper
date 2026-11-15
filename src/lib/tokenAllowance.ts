export const MAX_TOKEN_ALLOWANCE = (1n << 256n) - 1n;
export type TokenApprovalMode = 'exact' | 'unlimited';
const uint = (value: bigint) => {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_TOKEN_ALLOWANCE) throw new Error('Invalid token allowance amount.');
};

// These admitted private tokens support atomic increases and a true max sentinel.
export const planTokenAllowance = (current: bigint, required: bigint, mode: TokenApprovalMode = 'exact') => {
  uint(current); uint(required);
  if (required === 0n || mode !== 'exact' && mode !== 'unlimited') throw new Error('Invalid token approval policy.');
  const target = mode === 'unlimited' ? MAX_TOKEN_ALLOWANCE : required;
  if (current >= target) return null;
  return Object.freeze({ method: current === 0n ? 'approve' as const : 'increaseAllowance' as const,
    value: target - current, target });
};

export const remainingTokenAllowance = (before: bigint, spent: bigint) => {
  uint(before); uint(spent);
  if (spent > before) throw new Error('Token debit exceeds its allowance.');
  return before === MAX_TOKEN_ALLOWANCE ? before : before - spent;
};
