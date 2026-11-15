import { describe, expect, it } from 'vitest';
import { usesTransactionScopedPoolSnapshots } from './currentDexSnapshotAdmission';
import { STAGED_LIMIT_INPUT_DEX_CANDIDATE as limitInput } from './currentDexLimitInputCandidate';
import { STAGED_GAP_DEX_CANDIDATE as gap } from './currentDexGapCandidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as retired } from './currentDexHistoryCandidate';
import { ARCHIVED_CHEAP_DEX_CANDIDATE as archived, STAGED_EXIT_PREVIEW_DEX_CANDIDATE as exit,
  STAGED_NATIVE_DEX_CANDIDATE as native, STAGED_D06_DEX_CANDIDATE as d06 } from './dexV2Deployment';
import { selectCurrentDexCandidate } from './selectedCurrentDexCandidate';

describe('transaction-scoped Pool snapshot admission', () => {
  it('admits the exact 7bed and gap identities, and so the selected candidate', () => {
    expect(usesTransactionScopedPoolSnapshots(limitInput)).toBe(true);
    expect(usesTransactionScopedPoolSnapshots(gap)).toBe(true);
    expect(selectCurrentDexCandidate(undefined)).toBe(gap);
    expect(usesTransactionScopedPoolSnapshots(selectCurrentDexCandidate(undefined))).toBe(true);
    // The pinned identities. A new graph needs its own evidence before it joins this list.
    expect([limitInput.graph, gap.graph]).toEqual([
      '7bed7a981b80d29863ddf103997808f8e71baf63375b1dd502419d78fba00f4c',
      '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e']);
  });
  it('rejects a changed graph or package of an admitted candidate', () => {
    for (const admitted of [limitInput, gap]) {
      expect(usesTransactionScopedPoolSnapshots({ graph: admitted.graph, packageSha256: '00'.repeat(32) })).toBe(false);
      expect(usesTransactionScopedPoolSnapshots({ graph: '00'.repeat(32), packageSha256: admitted.packageSha256 })).toBe(false);
    }
    expect(usesTransactionScopedPoolSnapshots({ graph: gap.graph, packageSha256: limitInput.packageSha256 })).toBe(false);
    expect(usesTransactionScopedPoolSnapshots({ graph: limitInput.graph, packageSha256: gap.packageSha256 })).toBe(false);
  });
  it.each([['retired history', retired], ['exit', exit], ['archived', archived], ['native', native], ['d06', d06]] as const)(
    'rejects the %s candidate', (_name, candidate) => {
      expect(usesTransactionScopedPoolSnapshots(candidate)).toBe(false);
    });
});
