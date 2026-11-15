import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import binding from './currentP2PBinding.json';

// This test follows the complete local evidence chain: files under APP/reports and ChainWhisper Contracts V2.
// The App repository alone does not contain them, so `npm run test:ci` excludes this file. `npm test` runs it.
describe('contextual trade balance admission evidence chain', () => {
  it('binds the adopted packed graph to complete native producers and preserves original financial/disclosure records', () => {
    const readProof = (ref: { path: string; sha256: string }) => {
      const bytes = readFileSync(new URL('../../../' + ref.path, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sha256);
      return JSON.parse(bytes.toString('utf8'));
    };
    const q = binding.repairQualification;
    const qualification = readProof({ path: 'APP/reports/p2p-input-signatures-2026-11-12/QUALIFICATION.json', sha256: q.proofSha256 });
    expect(qualification.status).toBe(q.status);
    expect(qualification.targets).toEqual(q.targets);
    expect(qualification.changedActionProofs).toEqual(q.changedActionProofs);
    expect(qualification.reusedEvidence).toEqual(q.reusedEvidence);
    readProof(qualification.candidate); readProof(qualification.sourceCompatibility); readProof(qualification.previousFinancialQualification);
    const previous = readProof(qualification.previousSelectedBinding), native = readProof(qualification.deployment);
    expect(q.previousSelectedBindingSha256).toBe(qualification.previousSelectedBinding.sha256);
    expect(q.previousQualificationSha256).toBe(previous.repairQualification.proofSha256);
    expect(q.compatibilityProofSha256).toBe(qualification.sourceCompatibility.sha256);
    expect(q.deploymentProofSha256).toBe(binding.sourceRecordSha256);
    expect(native.signingStarts).toBe(29);
    expect(native.status).toBe('VERIFIED_DEPLOYED_CONFIGURED_NOT_APP_ADMITTED');
    for (const component of native.components) expect(binding.components.find(item => item.contract === component.name)).toMatchObject({
      address: component.address.toLowerCase(), runtimeBytecodeHash: component.runtimeHash,
      deploymentBlock: String(component.blockNumber), deploymentBlockHash: component.blockHash });
    for (const key of ['privateCounterProofs', 'publicBookLinkProofs', 'bookBudgetProof', 'tradeBalanceProofs', 'retainedBooks', 'retainedLinks', 'registeredTokens'] as const)
      expect(binding[key]).toEqual(previous[key]);
    expect(binding.components.find(item => item.protocol === 'direct-v2')).toEqual(previous.components.find((item: { protocol?: string }) => item.protocol === 'direct-v2'));
    const producers = new Map(qualification.nativeProofs.map((ref: { path: string; sha256: string }) => [ref.sha256, readProof(ref)]));
    for (const action of q.changedActionProofs) {
      const proof = producers.get(action.proofSha256) as { candidateSha256: string; authorityClosed: boolean;
        observed: { noPending: boolean }; measurements: { selector: string; privateInputPreparation: { count: number } }[] };
      expect(proof.candidateSha256).toBe(q.candidateSha256);
      expect(proof.authorityClosed && proof.observed.noPending).toBe(true);
      expect(proof.measurements.find(item => item.selector === action.selector)?.privateInputPreparation.count).toBe(action.protocol === 'link-v2' ? 3 : 1);
    }
  });
});
