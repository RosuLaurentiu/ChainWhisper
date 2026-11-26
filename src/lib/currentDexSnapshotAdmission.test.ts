import { describe, expect, it } from 'vitest';
import { usesTransactionScopedPoolSnapshots } from './currentDexSnapshotAdmission';
import { STAGED_BUILD13_DEX_CANDIDATE as build13 } from './currentDexBuild13Candidate';
import { selectCurrentDexCandidate } from './selectedCurrentDexCandidate';

describe('transaction-scoped Pool snapshot admission', () => {
  it('admits the exact build 13 identity, and so the selected candidate', () => {
    expect(usesTransactionScopedPoolSnapshots(build13)).toBe(true);
    expect(selectCurrentDexCandidate(undefined)).toBe(build13);
    expect(usesTransactionScopedPoolSnapshots(selectCurrentDexCandidate(undefined))).toBe(true);
    // The pinned identities. A new graph needs its own evidence before it joins this list.
    expect(build13.graph).toBe('5045070b8faad2caab781e2981ad3300b7d916016b7a1d354fe59b12a1d1c239');
  });
  it('rejects a changed graph or package of an admitted candidate', () => {
    expect(usesTransactionScopedPoolSnapshots({ graph: build13.graph, packageSha256: '00'.repeat(32) })).toBe(false);
    expect(usesTransactionScopedPoolSnapshots({ graph: '00'.repeat(32), packageSha256: build13.packageSha256 })).toBe(false);
  });
  it('rejects the removed 7bed graph, which had its own snapshot evidence', () => {
    expect(usesTransactionScopedPoolSnapshots({ graph: '7bed7a981b80d29863ddf103997808f8e71baf63375b1dd502419d78fba00f4c',
      packageSha256: build13.packageSha256 })).toBe(false);
  });
});
