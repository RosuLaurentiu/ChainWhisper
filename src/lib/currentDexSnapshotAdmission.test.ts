import { describe, expect, it } from 'vitest';
import { usesTransactionScopedPoolSnapshots } from './currentDexSnapshotAdmission';
import { STAGED_LIMIT_INPUT_DEX_CANDIDATE as limitInput } from './currentDexLimitInputCandidate';
import { STAGED_BUILD13_DEX_CANDIDATE as build13 } from './currentDexBuild13Candidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as retired } from './currentDexHistoryCandidate';
import { selectCurrentDexCandidate } from './selectedCurrentDexCandidate';

describe('transaction-scoped Pool snapshot admission', () => {
  it('admits the exact 7bed and build 13 identities, and so the selected candidate', () => {
    expect(usesTransactionScopedPoolSnapshots(limitInput)).toBe(true);
    expect(usesTransactionScopedPoolSnapshots(build13)).toBe(true);
    expect(selectCurrentDexCandidate(undefined)).toBe(build13);
    expect(usesTransactionScopedPoolSnapshots(selectCurrentDexCandidate(undefined))).toBe(true);
    // The pinned identities. A new graph needs its own evidence before it joins this list.
    expect([limitInput.graph, build13.graph]).toEqual([
      '7bed7a981b80d29863ddf103997808f8e71baf63375b1dd502419d78fba00f4c',
      '5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239']);
  });
  it('rejects a changed graph or package of an admitted candidate', () => {
    for (const admitted of [limitInput, build13]) {
      expect(usesTransactionScopedPoolSnapshots({ graph: admitted.graph, packageSha256: '00'.repeat(32) })).toBe(false);
      expect(usesTransactionScopedPoolSnapshots({ graph: '00'.repeat(32), packageSha256: admitted.packageSha256 })).toBe(false);
    }
    expect(usesTransactionScopedPoolSnapshots({ graph: build13.graph, packageSha256: limitInput.packageSha256 })).toBe(false);
    expect(usesTransactionScopedPoolSnapshots({ graph: limitInput.graph, packageSha256: build13.packageSha256 })).toBe(false);
  });
  it('rejects the retired history candidate', () => {
    expect(usesTransactionScopedPoolSnapshots(retired)).toBe(false);
  });
});
