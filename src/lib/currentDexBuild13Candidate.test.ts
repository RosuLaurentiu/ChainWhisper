import { expect, test } from 'vitest';
import { STAGED_BUILD13_DEX_CANDIDATE as candidate } from './currentDexBuild13Candidate';
import { STAGED_GAP_DEX_CANDIDATE as legacy } from './currentDexGapCandidate';
import { selectCurrentDexCandidate } from './selectedCurrentDexCandidate';
import { currentHistoryDexDailyPriceConfig, HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS } from './currentDexHistoryDailyPriceTestnet';
import { usesPackedPoolInputs } from './currentDexPoolFunding';
import { usesPackedLimitInputs } from './currentDexLimit';
import { hasCurrentReferenceSourceLayout } from './currentDexReferenceSourceLayout';
import { usesTransactionScopedPoolSnapshots } from './currentDexSnapshotAdmission';

test('build 13 selects six exact markets with their verified price recorders', () => {
  expect(selectCurrentDexCandidate(undefined)).toBe(candidate);
  expect(selectCurrentDexCandidate(candidate.graph)).toBe(candidate);
  expect(() => selectCurrentDexCandidate(legacy.graph)).toThrow();
  expect(usesPackedPoolInputs(candidate)).toBe(true);
  expect(usesPackedLimitInputs(candidate)).toBe(true);
  expect(hasCurrentReferenceSourceLayout(candidate.graph)).toBe(true);
  expect(usesTransactionScopedPoolSnapshots(candidate)).toBe(true);
  expect(usesTransactionScopedPoolSnapshots({ ...candidate, packageSha256: legacy.packageSha256 })).toBe(false);
  const manifests = HISTORY_TESTNET_DEX_DAILY_PRICE_MANIFESTS;
  expect(manifests.map(({canonicalId}) => canonicalId)).toEqual(['1', '2', '3', '4', '5', '6']);
  for (const manifest of manifests) {
    expect(currentHistoryDexDailyPriceConfig(candidate, manifest.symbols)).toMatchObject({status: 'active', manifest});
    expect(currentHistoryDexDailyPriceConfig(legacy, manifest.symbols)).toEqual({status: 'inactive'});
  }
});
