import { STAGED_PREPARED_DEX_CANDIDATE, STAGED_EXIT_PREVIEW_DEX_CANDIDATE, STAGED_SHARED_HISTORY_DEX_CANDIDATE, type CurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';

type Widen<T> = T extends string ? string : T extends number ? number
  : T extends object ? { readonly [K in keyof T]: Widen<T[K]> } : T;
export type PreparedDexCandidate = Widen<typeof STAGED_PREPARED_DEX_CANDIDATE | typeof STAGED_EXIT_PREVIEW_DEX_CANDIDATE | typeof STAGED_SHARED_HISTORY_DEX_CANDIDATE>;

// Compare every own field. JSON serialization can omit fields or call toJSON.
const exactDescriptor = (supplied: unknown, expected: unknown): boolean => {
  if (supplied === expected) return true;
  if (!supplied || !expected || typeof supplied !== 'object' || typeof expected !== 'object') return false;
  if (Array.isArray(supplied) !== Array.isArray(expected)) return false;
  if (Object.getPrototypeOf(supplied) !== Object.getPrototypeOf(expected)) return false;
  const keys = Reflect.ownKeys(expected);
  return Reflect.ownKeys(supplied).length === keys.length && keys.every(key => {
    const actual = Object.getOwnPropertyDescriptor(supplied, key);
    const wanted = Object.getOwnPropertyDescriptor(expected, key);
    return !!actual && !!wanted && 'value' in actual && 'value' in wanted &&
      exactDescriptor(actual.value, wanted.value);
  });
};

/** Exact public scope only. This does not admit a candidate for signing. */
export const resolvePreparedDexScope = (supplied: CurrentCheapDexCandidate | CurrentCheapDexCandidateKey = 'cheap-prepared'):
Readonly<{ key: CurrentCheapDexCandidateKey; candidate: PreparedDexCandidate }> => {
  for (const [key, candidate] of [
    ['cheap-prepared', STAGED_PREPARED_DEX_CANDIDATE],
    ['cheap-exit', STAGED_EXIT_PREVIEW_DEX_CANDIDATE],
    ['cheap-history', STAGED_SHARED_HISTORY_DEX_CANDIDATE]
  ] as const) {
    if (typeof supplied === 'string' ? supplied === key : exactDescriptor(supplied, candidate)) {
      return Object.freeze({ key, candidate });
    }
  }
  throw new CurrentPoolProofMismatch('Prepared Pool candidate changed.');
};
