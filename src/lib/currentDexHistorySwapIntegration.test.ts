import { describe, expect, it } from 'vitest';
import { selectCurrentDexCandidate } from './selectedCurrentDexCandidate';
import { assertCurrentD06AppAuthority } from './currentDexC1SwapPolicy';
import { currentCheapDexGasCaps } from './currentDexSubmission';
import { currentNativeSigningBudget, currentNativeSwapCheckpoint, recordCurrentNativeSwapHash, restoreCurrentNativeSwapCheckpoint, usesCurrentNativeSwapChecks, validateCurrentNativeSwapCheckpoint } from './currentDexNativeSwapPolicy';

const hash = (byte: string) => `0x${byte.repeat(32)}`;
const owner = `0x${'12'.repeat(20)}`;
// The swap policy binds to the selected current candidate. decision-034 removed the earlier descriptors;
// a changed identity stands for them.
const history = selectCurrentDexCandidate(undefined);
const other = { ...history, graph: '11'.repeat(32), packageSha256: '22'.repeat(32), core: `0x${'33'.repeat(20)}` };

describe('selected candidate swap technical integration', () => {
  it('selects current history phase caps and preserves unapproved App holds', () => {
    expect(usesCurrentNativeSwapChecks(history)).toBe(true);
    expect(currentCheapDexGasCaps(history)['cheap-async']).toEqual({ quote: 110_000_000n, accept: 35_000_000n,
      cancel: 30_000_000n, recover: 50_000_000n });
    expect(currentCheapDexGasCaps(history)['fast-pool']).toEqual({ quote: 110_000_000n, accept: 110_000_000n });

    const scope = { principal: owner, destination: owner, profile: 'cheap-async' as const,
      inputToken: history.tokenMetadata[0].address, outputToken: history.tokenMetadata[1].address, maximumInput: 1_000_000n };
    expect(() => assertCurrentD06AppAuthority(history.graph, scope)).toThrow('signing hold');
    expect(() => assertCurrentD06AppAuthority(other.graph)).toThrow('connected App-wallet hold');
  });

  it('captures and restores exact Quote and Accept charges at 50Mwei', () => {
    const signer = {}, scope = `quote:${hash('11')}`;
    const budget = currentNativeSigningBudget(signer, owner, () => 100n, history);
    budget.commit('quote', scope, 110_000_000n, scope, 7);
    recordCurrentNativeSwapHash(signer, 7, scope.slice(6), hash('21'));
    budget.commit('accept', `accept:${scope}`, 35_000_000n, scope, 8);
    recordCurrentNativeSwapHash(signer, 8, hash('22'), hash('23'));

    const saved = currentNativeSwapCheckpoint(signer);
    expect(() => validateCurrentNativeSwapCheckpoint(saved, owner, history)).not.toThrow();
    expect(saved.charges.map(row => [row.phase, row.gasCap, row.gasPrice, row.nonce, row.hash])).toEqual([
      ['quote', '110000000', '50000000', 7, hash('21')],
      ['accept', '35000000', '50000000', 8, hash('23')]
    ]);
    expect(saved.committedWei).toBe('7250000000000000');

    const restored = {};
    restoreCurrentNativeSwapCheckpoint(restored, owner, history, saved);
    expect(currentNativeSwapCheckpoint(restored)).toEqual(saved);
    expect(currentNativeSigningBudget(restored, owner, () => 101n, history).snapshot()).toMatchObject({
      signingStarts: 2, committedWei: 7_250_000_000_000_000n
    });
  });

  it('rejects mixed owner, candidate, fee and phase-cap reservations', () => {
    const signer = {}, scope = `quote:${hash('31')}`;
    const budget = currentNativeSigningBudget(signer, owner, () => 100n, history);
    budget.commit('quote', scope, 110_000_000n, scope, 12);
    recordCurrentNativeSwapHash(signer, 12, scope.slice(6), hash('32'));
    budget.commit('accept', `accept:${scope}`, 35_000_000n, scope, 13);
    recordCurrentNativeSwapHash(signer, 13, hash('33'), hash('34'));
    const saved = currentNativeSwapCheckpoint(signer);

    expect(() => validateCurrentNativeSwapCheckpoint(saved, `0x${'13'.repeat(20)}`, history)).toThrow();
    expect(() => validateCurrentNativeSwapCheckpoint(saved, owner, other)).toThrow();
    expect(() => currentNativeSigningBudget({}, owner, () => 100n, other)).toThrow('identity changed');
    expect(() => validateCurrentNativeSwapCheckpoint({ ...saved, charges: saved.charges.map((row, i) =>
      i === 0 ? { ...row, gasPrice: '52000000' } : row) }, owner, history)).toThrow();
    expect(() => validateCurrentNativeSwapCheckpoint({ ...saved, charges: saved.charges.map((row, i) =>
      i === 0 ? { ...row, gasCap: '100000000' } : row) }, owner, history)).toThrow();
  });

});
