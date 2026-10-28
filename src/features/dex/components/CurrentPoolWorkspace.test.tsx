import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CurrentPoolWorkspace, { CURRENT_POOL_SPREADS, currentPoolFractionWitness, currentPoolIntent } from './CurrentPoolWorkspace';

describe('current shared-Pool form inputs', () => {
  it('uses seven approved classes with exact coprime price and spread witnesses', () => {
    expect(CURRENT_POOL_SPREADS).toEqual(['0.1', '0.3', '0.5', '1', '2', '5', '10']);
    for (let classId = 0; classId < 7; classId++) {
      const intent = currentPoolIntent('9007199254740993', '50', '1.25', classId, '0.5');
      expect(intent.classId).toBe(BigInt(classId));
      expect(intent.budgets).toEqual([9007199254740993n, 50n]);
      for (const start of [0, 4]) {
        const [n, d, u, v] = intent.terms.slice(start, start + 4);
        expect(n * u - d * v).toBe(1n);
        for (const value of [n, d, u, v]) expect(value >= 0n && value < 1n << 128n).toBe(true);
      }
      expect(intent.terms.slice(0, 2)).toEqual([5n, 4n]);
      expect(intent.terms.slice(8)).toEqual([1n, 200n]);
    }
  });
  it('supports integer and reciprocal fractions without signed or rounded limbs', () => {
    for (const [n, d] of [[1n, 1n], [2n, 1n], [1n, 2n], [(1n << 128n) - 1n, 1n]]) {
      const [, , u, v] = currentPoolFractionWitness(n, d);
      expect(n * u - d * v).toBe(1n);
      expect(u >= 0n && v >= 0n).toBe(true);
    }
    expect(currentPoolIntent('100', '50', '2', 1, '0').terms.slice(8)).toEqual([0n, 1n]);
    expect(currentPoolIntent('100', '50', '2', 1, '100').terms.slice(8)).toEqual([1n, 1n]);
  });
  it('rejects invalid amount, price, class and tolerance before wallet calls', () => {
    for (const [budget0, budget1, price, spread, tolerance] of [
      ['0', '50', '2', 1, '1'], ['100', '1.5', '2', 1, '1'], ['100', '50', '0', 1, '1'],
      ['100', '50', '2', 7, '1'], ['100', '50', '2', 1, '101'], ['100', '50', '2', 1, '-1']
    ] as const) expect(() => currentPoolIntent(budget0, budget1, price, spread, tolerance)).toThrow();
    expect(() => currentPoolFractionWitness(2n, 4n)).toThrow();
  });
  it('renders token inputs with no enabled writer or public reserve state while disconnected', () => {
    const markup = renderToStaticMarkup(<CurrentPoolWorkspace />);
    expect(markup).toContain('Current private Pool creation');
    expect(markup).toContain('Deposit amounts');
    expect(markup).toContain('Your shares belong to a position NFT');
    expect(markup).toContain('Maximum spend');
    expect(markup).not.toContain('Aggregate');
    expect(markup).not.toContain('Custom total spread');
    expect(markup).toMatch(/disabled=""[^>]*>Review deposit/);
  });
});
