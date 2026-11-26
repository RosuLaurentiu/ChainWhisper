import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { STAGED_GAP_DEX_CANDIDATE as previous } from './currentDexGapCandidate';
import { STAGED_BUILD13_DEX_CANDIDATE as current } from './currentDexBuild13Candidate';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as oldHistory } from './currentDexHistoryCandidate';
import { STAGED_LOW_RPC_DEX_CANDIDATE as trial } from './lowRpcDexTrialCandidate';
import { STAGED_REFERENCE_DEX_CANDIDATE as reference } from './currentDexReferenceCandidate';
import { STAGED_POOL_INPUT_DEX_CANDIDATE as poolInputs } from './currentDexPoolInputCandidate';
import { STAGED_LIMIT_INPUT_DEX_CANDIDATE as limitInputs } from './currentDexLimitInputCandidate';
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
import { createCurrentAttemptBoundary, type CurrentTransport } from './currentDexSubmission';

describe('fixed current App candidate selection', () => {
  it('copies the captured public data exactly and keeps native admission held', () => {
    expect(readFileSync(new URL('./lowRpcDexTrialCandidate.ts', import.meta.url), 'utf8')).toBe(
      readFileSync(new URL('../../reports/low-rpc-trial-2026-11-05/public-binding/currentDexLowRpcCandidate.ts', import.meta.url), 'utf8'));
    expect(trial.graph).toBe('7c63020b4eead20603e63c580e3155af8974b4eb5cf0a2b2eb2ea8c796a10eb9');
    expect(trial.packageSha256).toBe('2c5f6db37d33d0d88159e6f65fcbd5461e67262b3303f5cae5ea124df4d6d41d');
    expect(trial.protocol.coreAbiSha256).toBe('077457e4b1931295614909fa8553b6629e8244b76dcbf60553667ac8eb9dfa98');
    expect(trial.readyToSign).toBe(false); expect(trial.nativeScope.connectedAppWalletHeld).toBe(true);
    expect(trial.tokenMetadata).toHaveLength(4); expect(trial.pairs).toHaveLength(6);
  });
  it('uses only an unset default or the exact current graph', () => {
    expect(selectCurrentDexCandidate(undefined)).toBe(current); expect(selectCurrentDexCandidate(current.graph)).toBe(current);
    for (const candidate of [previous, oldHistory, trial, reference, poolInputs, limitInputs])
      expect(() => selectCurrentDexCandidate(candidate.graph)).toThrow('Unknown current DEX target');
    for (const target of ['', 'unknown', null, true]) expect(() => selectCurrentDexCandidate(target)).toThrow('Unknown current DEX target');
    expect(isFixedCurrentDexCandidate(current)).toBe(true);
    expect(isFixedCurrentDexCandidate({...current,core:trial.core})).toBe(false);
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
    expect(() => currentCheapDexCandidateKey(oldHistory)).toThrow('reviewed candidate');
    expect(() => resolvePreparedDexScope(oldHistory)).toThrow('candidate changed');
    expect(() => resolvePreparedDexScope(trial)).toThrow('candidate changed');
  });
  it('admits fixed binding reuse only for both exact graph/package/Core identities', () => {
    expect(isFixedCurrentDexCandidate(undefined)).toBe(false);
    for (const c of [current]) {
      expect(isFixedCurrentDexCandidate(c)).toBe(true);
      for (const field of ['graph', 'packageSha256', 'core'] as const)
        expect(isFixedCurrentDexCandidate({ ...c, [field]: field === 'core' ? '0x' + '00'.repeat(20) : '00'.repeat(32) })).toBe(false);
    }
    for (const c of [previous, oldHistory, trial, reference, poolInputs, limitInputs]) expect(isFixedCurrentDexCandidate(c)).toBe(false);
    expect(isFixedCurrentDexCandidate({ ...current, packageSha256: trial.packageSha256 })).toBe(false);
  });
  it('admits proved packed Pool actions only when their exact candidate is selected', () => {
    expect(readFileSync(new URL('./currentDexPoolInputCandidate.ts', import.meta.url), 'utf8')).toBe(
      readFileSync(new URL('../../reports/pool-input-signatures-2026-11-12/poolInputDexCandidate.ts', import.meta.url), 'utf8'));
    expect(poolInputs.readyToSign).toBe(false);
    const actions = [
      ...(['creation', 'top-up'] as const).map(mode => () => assertCurrentPoolFundingNativeAdmission(current, mode)),
      () => assertCurrentPoolPositionNativeAdmission(current, 'snapshot'),
      ...(['preview', 'withdrawal'] as const).map(phase => () => assertCurrentPoolPositionNativeAdmission(current, 'withdraw', false, phase))
    ];
    for (const action of actions) expect(action).not.toThrow();
    for(const old of [poolInputs,limitInputs])expect(()=>assertCurrentPoolFundingNativeAdmission(old,'top-up')).toThrow();
    for (const field of ['core', 'packageSha256'] as const) {
      const changed = { ...current, [field]: field === 'core' ? '0x' + '00'.repeat(20) : '00'.repeat(32) };
      expect(() => assertCurrentPoolFundingNativeAdmission(changed as never, 'top-up')).toThrow();
      expect(() => assertCurrentPoolPositionNativeAdmission(changed as never, 'withdraw', false, 'preview')).toThrow();
    }
  });
  it('admits proved packed Limit phases only on the exact selected candidate', () => {
    expect(readFileSync(new URL('./currentDexLimitInputCandidate.ts', import.meta.url), 'utf8')).toBe(
      readFileSync(new URL('../../reports/limit-input-signatures-2026-11-12/limitInputDexCandidate.ts', import.meta.url), 'utf8'));
    expect(limitInputs.readyToSign).toBe(false);
    expect(limitInputs.pairs).toHaveLength(6);
    for (const phase of ['limit-create', 'limit-snapshot'] as const)
      expect(() => assertCurrentLimitNativeAdmission('cheap-history', phase)).not.toThrow();
    for (const action of ['refresh', 'claim', 'pause', 'resume', 'close', 'topup', 'reprice'] as const) {
      expect(currentLimitOwnerNativeAdmission('cheap-history')[action]).toBe(true);
      expect(() => assertCurrentLimitNativeAdmission('cheap-history', 'limit-owner', action)).not.toThrow();
    }
    expect(() => assertCurrentLimitNativeAdmission('cheap-history', 'limit-owner')).toThrow();
  });
  it('rejects trial sends without a live browser lease before storage or wallet access', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }, transport = { send: vi.fn(), assertCurrent: vi.fn() };
    const boundary = createCurrentAttemptBoundary({ storage, c: trial, core: trial.core, owner: trial.core, chainId: 7082400n,
      transport: transport as unknown as CurrentTransport, attest: vi.fn(), now: () => 1n });
    await expect(boundary.sendCurrent('quote', { to: trial.core, from: trial.core, chainId: 7082400n, data: '0x', value: 0n }, undefined, vi.fn(), vi.fn())).rejects.toThrow('requires the current browser wallet lease');
    expect(storage.getItem).not.toHaveBeenCalled(); expect(transport.send).not.toHaveBeenCalled();
  });
});
