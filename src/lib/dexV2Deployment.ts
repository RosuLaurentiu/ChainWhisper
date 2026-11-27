import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './selectedCurrentDexCandidate';
export { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './selectedCurrentDexCandidate';
// Exact shared-Pool trial deployment: unsigned package 1efdd9c5..., confirmed journal of 33 rows.
// This is a read identity only. It does not admit a transaction.
// Staged identity only. This record does not change the active deployment or admit writes.
type WidenCandidate<T> = T extends string ? string : T extends number ? number
  : T extends object ? { readonly [K in keyof T]: WidenCandidate<T[K]> } : T;
export type CurrentCheapDexCandidate = WidenCandidate<typeof STAGED_SHARED_HISTORY_DEX_CANDIDATE>;
export type CurrentCheapDexIdentity = Readonly<{ graph: string; packageSha256: string; core: string }>;
// decision-034 (owner, 2026-11-26): the App uses one contract version, the current build 13 graph.
export type CurrentCheapDexCandidateKey = 'cheap-history';
export const resolveCurrentCheapDexCandidate = (key: CurrentCheapDexCandidateKey): CurrentCheapDexCandidate => {
  if (key !== 'cheap-history') throw new Error('Unknown current DEX candidate.');
  return STAGED_SHARED_HISTORY_DEX_CANDIDATE;
};
const sameIdentity = (identity: CurrentCheapDexIdentity, c: CurrentCheapDexIdentity) =>
  identity.graph === c.graph && identity.packageSha256 === c.packageSha256 && identity.core.toLowerCase() === c.core.toLowerCase();
export const currentCheapDexCandidateKey = (identity: CurrentCheapDexIdentity): CurrentCheapDexCandidateKey => {
  if (sameIdentity(identity, STAGED_SHARED_HISTORY_DEX_CANDIDATE)) return 'cheap-history';
  throw new Error('Current DEX graph, package and Core do not match a reviewed candidate.');
};
export const currentCheapDexStages = (identity: CurrentCheapDexIdentity = STAGED_SHARED_HISTORY_DEX_CANDIDATE): Readonly<{
  workCalls: number; ready: number; funded: number; settled: number; released: number
}> => {
  currentCheapDexCandidateKey(identity);
  return STAGED_SHARED_HISTORY_DEX_CANDIDATE.protocol.stages;
};
export const currentCheapDexQuoteProtocol = (candidate: CurrentCheapDexIdentity) => {
  currentCheapDexCandidateKey(candidate);
  return STAGED_SHARED_HISTORY_DEX_CANDIDATE.protocol.name;
};
// decision-034: the current graph has no general native App submission admission (it has 4 work calls).
// Each proved phase is admitted at its own call site; any other phase stops here.
export const rejectUnprovenNativeAdmission = (): never => {
  throw new Error('Successor DEX native App submission admission is absent.');
};
export const currentCheapDexOwnerActionEligible = (candidate: CurrentCheapDexIdentity | undefined, stage: number | undefined, action: 'cancel' | 'recover') => {
  const stages = currentCheapDexStages(candidate);
  return action === 'cancel' ? Number.isInteger(stage) && stage! >= 1 && stage! <= stages.ready : stage === stages.funded;
};
