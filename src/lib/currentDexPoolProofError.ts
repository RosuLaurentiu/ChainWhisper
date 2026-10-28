// A proved data mismatch is different from an unavailable RPC, SDK or wallet lease.
export class CurrentPoolProofMismatch extends Error {
  override name = 'CurrentPoolProofMismatch';
}
export const isKnownCurrentPoolProofMismatch = (error: unknown) => error instanceof CurrentPoolProofMismatch ||
  (error instanceof Error && (new Set([
    'Current DEX mined transaction changed.', 'Current-mode mined gas cap changed.', 'Current DEX mined block changed.',
    'Current DEX canonical transaction inclusion changed. Do not resend.', 'Current native receipt changed after private verification.'
  ]).has(error.message) || error.message.startsWith('Wallet returned a transaction outside the reviewed DEX call. Mismatch: ')));
