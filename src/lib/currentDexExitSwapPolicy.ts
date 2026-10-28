import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE } from './currentDexExitCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE } from './currentDexHistoryCandidate';
import type { CurrentCheapDexIdentity } from './dexV2Deployment';

// Technical bounds for the accepted b2aa test-token cases. These bounds grant
// no connected-wallet authority and do not include operator work transactions.
export const CURRENT_EXIT_SWAP_LIMITS = Object.freeze({
  maximumInput: 20_000_000n, maximumToleranceBps: 50,
  normalSeconds: 900n
});
// Signed user phase caps, distinct from receipt gas and from operator work.
// Fast: c1-service/automatic-native-1; async: partial13, stale16 and op11 recovery.
export const CURRENT_EXIT_SWAP_GAS_CAPS = Object.freeze({
  'fast-pool': Object.freeze({ quote: 110_000_000n, accept: 110_000_000n }),
  'cheap-async': Object.freeze({ quote: 110_000_000n, accept: 35_000_000n,
    cancel: 30_000_000n, recover: 50_000_000n })
});
export const isCurrentExitSwapCandidate = (candidate: Pick<CurrentCheapDexIdentity, 'graph'>) =>
  candidate.graph === STAGED_EXIT_PREVIEW_DEX_CANDIDATE.graph;
// Accounting joins and shared user ceilings do not grant signing authority or new native proof.
export const usesCurrentSwapAccounting = (candidate: Pick<CurrentCheapDexIdentity, 'graph'>) =>
  isCurrentExitSwapCandidate(candidate) || candidate.graph === STAGED_SHARED_HISTORY_DEX_CANDIDATE.graph;

// Fixed signing fees. Candidate identity and phase authority are checked by the
// caller. The b2aa fee does not change historical fa71/d06 or Pool policy.
export const CURRENT_NATIVE_FIXED_GAS_PRICE = 50_000_000n;
export const CURRENT_EXIT_SWAP_FIXED_GAS_PRICE = 52_000_000n;
export const currentSwapFixedGasPrice = (candidate: Pick<CurrentCheapDexIdentity, 'graph'>) =>
  isCurrentExitSwapCandidate(candidate) ? CURRENT_EXIT_SWAP_FIXED_GAS_PRICE : CURRENT_NATIVE_FIXED_GAS_PRICE;
