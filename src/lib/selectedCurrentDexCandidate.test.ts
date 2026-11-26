import { describe, expect, it } from 'vitest';
import { STAGED_BUILD13_DEX_CANDIDATE as current } from './currentDexBuild13Candidate';
import { assertCurrentLimitNativeAdmission, currentLimitOwnerNativeAdmission } from './currentDexLimit';
import { assertCurrentPoolFundingNativeAdmission } from './currentDexPoolSubmission';
import { assertCurrentPoolPositionNativeAdmission } from './currentDexPoolPositionSubmission';
import { selectCurrentDexCandidate, STAGED_SHARED_HISTORY_DEX_CANDIDATE as selected,
  isFixedCurrentDexCandidate } from './selectedCurrentDexCandidate';
import { resolveCurrentCheapDexCandidate, currentCheapDexCandidateKey, rejectUnprovenNativeAdmission } from './dexV2Deployment';
import { resolveCurrentDexAppCandidate } from './currentDexAppScope';
import { resolvePreparedDexScope } from './currentDexPreparedScope';
import { readCurrentDexDisplay } from './currentDexDisplay';
import { CURRENT_BROWSER_DEX_GRAPH, CURRENT_BROWSER_DEX_CORE, isCurrentDexBrowserSigner } from './currentDexBrowserPolicy';
import { SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH } from './currentDexLimitFillHistory';
import { currentNativeDexDailyPriceConfig } from './currentDexNativeDailyPriceTestnet';

// decision-034: the App keeps only build 13. The earlier descriptors (9c2c gap, 958e history, 7c63 low-RPC,
// cc7e reference, d456 Pool input and 7bed Limit input) were removed; changed identities stand for them here.
const other = { ...current, graph: '11'.repeat(32), packageSha256: '22'.repeat(32), core: `0x${'33'.repeat(20)}` };
const removedGraphs = [
  '9c2cb36f958dc21ef11bf7d91ebf0373904a3d741edd6bf9eeae25752960631e', '958eea2faf9aec536df3318d5b770acec1da36efa1665cfc11a0c788d97f8fdf',
  '7c63020b4eead20603e63c580e3155af8974b4eb5cf0a2b2eb2ea8c796a10eb9', 'cc7eb662c644c10bef875d2a72524095848a236155005a32377b10a7c0c13e44',
  'd4564ccf9f449b00f25c980e26250163c3c27d4114cc8cedca7234d447603d59', '7bed7a981b80d29863ddf103997808f8e71baf63375b1dd502419d78fba00f4c',
  other.graph];

describe('fixed current App candidate selection', () => {
  it('uses only an unset default or the exact current graph', () => {
    expect(selectCurrentDexCandidate(undefined)).toBe(current); expect(selectCurrentDexCandidate(current.graph)).toBe(current);
    for (const graph of removedGraphs) expect(() => selectCurrentDexCandidate(graph)).toThrow('Unknown current DEX target');
    for (const target of ['', 'unknown', null, true]) expect(() => selectCurrentDexCandidate(target)).toThrow('Unknown current DEX target');
    expect(isFixedCurrentDexCandidate(current)).toBe(true);
    expect(isFixedCurrentDexCandidate({ ...current, core: other.core })).toBe(false);
  });
  it('uses one selected target for App, prepared scope, display, history and browser identity', () => {
    expect(selected).toBe(selectCurrentDexCandidate(import.meta.env.VITE_LOW_RPC_TRIAL));
    expect(resolveCurrentCheapDexCandidate('cheap-history')).toBe(selected);
    expect(resolveCurrentDexAppCandidate('coti-testnet-candidate').candidate).toBe(selected);
    expect(resolvePreparedDexScope('cheap-history').candidate).toBe(selected);
    expect(currentCheapDexCandidateKey(selected)).toBe('cheap-history'); expect(readCurrentDexDisplay(selected).pairs).toHaveLength(6);
    expect(CURRENT_BROWSER_DEX_GRAPH).toBe(selected.graph); expect(CURRENT_BROWSER_DEX_CORE).toBe(selected.core);
    expect(SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH).toBe(selected.graph);
    expect(() => rejectUnprovenNativeAdmission()).toThrow('submission admission is absent');
    expect(isCurrentDexBrowserSigner({}, current.graph, current.core)).toBe(false);
    expect(currentNativeDexDailyPriceConfig(current)).toEqual({ status: 'inactive' });
    expect(() => currentCheapDexCandidateKey(other)).toThrow('reviewed candidate');
    expect(() => resolvePreparedDexScope(other)).toThrow('candidate changed');
  });
  it('admits fixed binding reuse only for both exact graph/package/Core identities', () => {
    expect(isFixedCurrentDexCandidate(undefined)).toBe(false);
    expect(isFixedCurrentDexCandidate(current)).toBe(true);
    for (const field of ['graph', 'packageSha256', 'core'] as const)
      expect(isFixedCurrentDexCandidate({ ...current, [field]: other[field] })).toBe(false);
    expect(isFixedCurrentDexCandidate(other)).toBe(false);
  });
  it('admits proved packed Pool actions only when their exact candidate is selected', () => {
    const actions = [
      ...(['creation', 'top-up'] as const).map(mode => () => assertCurrentPoolFundingNativeAdmission(current, mode)),
      () => assertCurrentPoolPositionNativeAdmission(current, 'snapshot'),
      ...(['preview', 'withdrawal'] as const).map(phase => () => assertCurrentPoolPositionNativeAdmission(current, 'withdraw', false, phase))
    ];
    for (const action of actions) expect(action).not.toThrow();
    expect(() => assertCurrentPoolFundingNativeAdmission(other, 'top-up')).toThrow();
    for (const field of ['core', 'packageSha256'] as const) {
      const changed = { ...current, [field]: other[field] };
      expect(() => assertCurrentPoolFundingNativeAdmission(changed as never, 'top-up')).toThrow();
      expect(() => assertCurrentPoolPositionNativeAdmission(changed as never, 'withdraw', false, 'preview')).toThrow();
    }
  });
  it('admits proved packed Limit phases only on the exact selected candidate', () => {
    for (const phase of ['limit-create', 'limit-snapshot'] as const)
      expect(() => assertCurrentLimitNativeAdmission('cheap-history', phase)).not.toThrow();
    for (const action of ['refresh', 'claim', 'pause', 'resume', 'close', 'topup', 'reprice'] as const) {
      expect(currentLimitOwnerNativeAdmission('cheap-history')[action]).toBe(true);
      expect(() => assertCurrentLimitNativeAdmission('cheap-history', 'limit-owner', action)).not.toThrow();
    }
    expect(() => assertCurrentLimitNativeAdmission('cheap-history', 'limit-owner')).toThrow();
  });
});
