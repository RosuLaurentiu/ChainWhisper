import { STAGED_SHARED_HISTORY_DEX_CANDIDATE, type CurrentCheapDexCandidate, type CurrentCheapDexCandidateKey } from './dexV2Deployment';
import { CurrentPoolProofMismatch } from './currentDexPoolProofError';

type Widen<T> = T extends string ? string : T extends number ? number
  : T extends object ? { readonly [K in keyof T]: Widen<T[K]> } : T;
export type PreparedDexCandidate = Widen<typeof STAGED_SHARED_HISTORY_DEX_CANDIDATE>;

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
export const resolvePreparedDexScope = (supplied: CurrentCheapDexCandidate | CurrentCheapDexCandidateKey = 'cheap-history'):
Readonly<{ key: CurrentCheapDexCandidateKey; candidate: PreparedDexCandidate }> => {
  const candidate = STAGED_SHARED_HISTORY_DEX_CANDIDATE;
  if (typeof supplied === 'string' ? supplied === 'cheap-history' : exactDescriptor(supplied, candidate)) {
    return Object.freeze({ key: 'cheap-history' as const, candidate });
  }
  throw new CurrentPoolProofMismatch('Prepared Pool candidate changed.');
};
