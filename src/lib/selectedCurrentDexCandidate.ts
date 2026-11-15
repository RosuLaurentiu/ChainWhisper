import { STAGED_GAP_DEX_CANDIDATE as current } from './currentDexGapCandidate';

export const selectCurrentDexCandidate = (target: unknown) => {
  if (target === undefined) return current;
  if (target === current.graph) return current;
  throw new Error('Unknown current DEX target.');
};
export const STAGED_SHARED_HISTORY_DEX_CANDIDATE = selectCurrentDexCandidate(import.meta.env.VITE_LOW_RPC_TRIAL);
type Identity = Readonly<{ graph: string; packageSha256: string; core: string }>;
export const isFixedCurrentDexCandidate = (candidate: Identity | undefined): boolean => !!candidate &&
  candidate.graph === current.graph && candidate.packageSha256 === current.packageSha256 && candidate.core.toLowerCase() === current.core.toLowerCase();
