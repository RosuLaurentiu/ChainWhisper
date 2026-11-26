// A proved data mismatch is different from an unavailable RPC, SDK or wallet lease.
export class CurrentPoolProofMismatch extends Error {
  override name = 'CurrentPoolProofMismatch';
}
export const requireCurrentPoolProof = (ok: boolean, message: string): void => {
  if (!ok) throw new CurrentPoolProofMismatch(message);
};
// Persist fixed check identifiers only, never arbitrary RPC/SDK text or private values.
export const currentPoolVerificationFailures = Object.freeze({
  'snapshot-financial-state': 'Prepared snapshot changed financial state.',
  'top-up-accounting': 'Prepared management snapshot accounting changed.',
  'top-up-proof': 'Top-up final private accounting is unavailable.',
  'top-up-receipt': 'Pool top-up management receipt changed before snapshot acceptance.',
  'snapshot-wallet-state': 'Prepared snapshot changed wallet balances/allowances.',
  'snapshot-envelope': 'Prepared Pool snapshot event differs from stored owner envelopes.',
  'snapshot-private-values': 'Invalid prepared shared-Pool private values.',
  'snapshot-shares': 'Prepared Pool private share state changed.',
  'snapshot-context': 'Position view differs from its authenticated snapshot.',
  'snapshot-call': 'Prepared snapshot call changed.',
  'snapshot-order': 'Prepared snapshot predates review.',
  'snapshot-receipt': 'Prepared snapshot canonical receipt changed.',
  'snapshot-final-receipt': 'Prepared snapshot canonical receipt changed after position reads.',
  'transaction': 'Current DEX mined transaction changed.',
  'gas-cap': 'Current-mode mined gas cap changed.',
  'block': 'Current DEX mined block changed.',
  'inclusion': 'Current DEX canonical transaction inclusion changed. Do not resend.',
  'receipt-recheck': 'Current native receipt changed after private verification.',
  'pool-proof': 'Pool verification failed. Its exact check was not retained.',
});
export type CurrentPoolVerificationFailure = keyof typeof currentPoolVerificationFailures;
export const isCurrentPoolVerificationFailure = (value: unknown): value is CurrentPoolVerificationFailure =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(currentPoolVerificationFailures, value);
// CW-140.02: an error may carry its fixed code (`poolVerificationCode`). Without one, the exact message selects the
// code. currentDexPoolProofError.test.ts fails when a mapped message no longer occurs in the App source, so a
// reworded check cannot silently fall back to 'pool-proof'.
export const currentPoolVerificationFailure = (error: unknown): CurrentPoolVerificationFailure => {
  const coded = error && typeof error === 'object' ? (error as { poolVerificationCode?: unknown }).poolVerificationCode : undefined;
  if (isCurrentPoolVerificationFailure(coded)) return coded;
  return (Object.entries(currentPoolVerificationFailures).find(([, message]) => error instanceof Error && error.message === message)?.[0] as CurrentPoolVerificationFailure | undefined) ?? 'pool-proof';
};
// CW-140.02: the only hold reasons that the owner-reviewed release of a held top-up snapshot accepts
// (currentDexPoolPositionSubmission.ts, inspectPending). Every other reason keeps its manual reconciliation.
export const CURRENT_REVIEWABLE_TOP_UP_FAILURES: readonly CurrentPoolVerificationFailure[] = Object.freeze(['pool-proof', 'snapshot-financial-state']);
export const isReviewableTopUpFailure = (failure: unknown) =>
  isCurrentPoolVerificationFailure(failure) && CURRENT_REVIEWABLE_TOP_UP_FAILURES.includes(failure);
export const currentPoolVerificationMessage = (failure: unknown) => isCurrentPoolVerificationFailure(failure)
  ? currentPoolVerificationFailures[failure] : 'The original verification reason was not retained.';
export const isKnownCurrentPoolProofMismatch = (error: unknown) => error instanceof CurrentPoolProofMismatch ||
  (error instanceof Error && (new Set([
    'Current DEX mined transaction changed.', 'Current-mode mined gas cap changed.', 'Current DEX mined block changed.',
    'Current DEX canonical transaction inclusion changed. Do not resend.', 'Current native receipt changed after private verification.'
  ]).has(error.message) || error.message.startsWith('Wallet returned a transaction outside the reviewed DEX call. Mismatch: ')));
