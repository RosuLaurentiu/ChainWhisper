import { describe, expect, it } from 'vitest';
import { STAGED_SHARED_HISTORY_DEX_CANDIDATE as history } from './currentDexHistoryCandidate';
import { STAGED_EXIT_PREVIEW_DEX_CANDIDATE as b2aa } from './currentDexExitCandidate';
import { assertCurrentD06AppAuthority } from './currentDexC1SwapPolicy';
import { currentCheapDexGasCaps } from './currentDexSubmission';
import { CURRENT_EXIT_SWAP_FIXED_GAS_PRICE } from './currentDexExitSwapPolicy';
import { currentNativeSigningBudget, currentNativeSwapCheckpoint,
  currentNativeSwapChargeGasPrice, recordCurrentNativeSwapHash, restoreCurrentNativeSwapCheckpoint,
  usesCurrentNativeSwapChecks, validateCurrentNativeSwapCheckpoint } from './currentDexNativeSwapPolicy';
import { CURRENT_NATIVE_FIXED_GAS_PRICE } from './currentDexExitSwapPolicy';

const hash = (byte: string) => `0x${byte.repeat(32)}`;
const owner = `0x${'12'.repeat(20)}`;

describe('7b67 history swap technical integration', () => {
  it('selects current history phase caps and preserves unapproved App holds', () => {
    expect(usesCurrentNativeSwapChecks(history)).toBe(true);
    expect(currentCheapDexGasCaps(history)['cheap-async']).toEqual({ quote: 110_000_000n, accept: 35_000_000n,
      cancel: 30_000_000n, recover: 50_000_000n });
    expect(currentCheapDexGasCaps(history)['fast-pool']).toEqual({ quote: 110_000_000n, accept: 110_000_000n });

    const scope = { principal: owner, destination: owner, profile: 'cheap-async' as const,
      inputToken: history.tokenMetadata[0].address, outputToken: history.tokenMetadata[1].address, maximumInput: 1_000_000n };
    expect(() => assertCurrentD06AppAuthority(history.graph, scope)).toThrow('signing hold');
    expect(() => assertCurrentD06AppAuthority(b2aa.graph)).toThrow('connected App-wallet hold');
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
    expect(() => validateCurrentNativeSwapCheckpoint(saved, owner, b2aa)).toThrow();
    expect(() => validateCurrentNativeSwapCheckpoint({ ...saved, charges: saved.charges.map((row, i) =>
      i === 0 ? { ...row, gasPrice: '52000000' } : row) }, owner, history)).toThrow();
    expect(() => validateCurrentNativeSwapCheckpoint({ ...saved, charges: saved.charges.map((row, i) =>
      i === 0 ? { ...row, gasCap: '100000000' } : row) }, owner, history)).toThrow();
  });

  it('preserves b2aa 52M charges and legacy fee-less charges', () => {
    const scope = `quote:${hash('41')}`, signer = {};
    const budget = currentNativeSigningBudget(signer, owner, () => 100n, b2aa);
    budget.commit('quote', scope, 110_000_000n, scope, 21);
    recordCurrentNativeSwapHash(signer, 21, scope.slice(6), hash('42'));
    const saved = currentNativeSwapCheckpoint(signer);
    expect(saved.charges[0].gasPrice).toBe(String(CURRENT_EXIT_SWAP_FIXED_GAS_PRICE));
    expect(() => validateCurrentNativeSwapCheckpoint(saved, owner, b2aa)).not.toThrow();

    const legacy = { ...saved, committedWei: '5500000000000000',
      charges: saved.charges.map(({ gasPrice: _gasPrice, ...row }) => row) };
    expect(() => validateCurrentNativeSwapCheckpoint(legacy, owner, b2aa)).not.toThrow();
    expect(currentNativeSwapChargeGasPrice(legacy.charges[0])).toBe(CURRENT_NATIVE_FIXED_GAS_PRICE);
  });
});
