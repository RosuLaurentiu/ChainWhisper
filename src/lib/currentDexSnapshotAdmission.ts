import { STAGED_BUILD13_DEX_CANDIDATE } from './currentDexBuild13Candidate';

// A plain snapshot of an active Pool claim is verified from its own transaction: the exact call, the unique event,
// the owner, and the stored owner envelopes. It is not compared with a financial baseline from before the wallet
// request, because that interval contains unrelated swaps and C1 activity. This is correct only for a graph whose
// snapshot call writes snapshot output and context only and moves no token.
// Evidence for graph 7bed: reports/pool-snapshot-verification-2026-11-14 (CW-009.03.03).
// Evidence for graph 9c2c: reports/pool-snapshot-gap-graph-2026-11-16 (CW-089). PositionCommands, SharedPoolClaims,
// PoolOwner and SharedPoolMath have the same source and the same runtime bytecode as on 7bed; the Core differs in two
// constructor values only (factory runtime hash and library commitments). A new graph needs its own evidence.
// Build 13 retains the checked snapshot runtime, ABI and storage layout of the 9e6c donor.
// decision-034: only build 13 is admitted; the 7bed descriptor was removed with the old candidate modules.
export const usesTransactionScopedPoolSnapshots = (candidate: Readonly<{ graph: string; packageSha256: string }>): boolean =>
  candidate.graph === STAGED_BUILD13_DEX_CANDIDATE.graph && candidate.packageSha256 === STAGED_BUILD13_DEX_CANDIDATE.packageSha256;
