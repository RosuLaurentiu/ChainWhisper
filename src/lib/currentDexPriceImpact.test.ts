import { describe, expect, it } from 'vitest';
import { formatUnits } from '@coti-io/coti-ethers';
import { makeHistoryFixture, HISTORY_FIXTURE_DAY } from '../../tests/fixtures/history.fixture';
import { readCurrentDexDailyPrice } from './currentDexDailyPrice';
import { currentDexMarketReference, isVerifiedCurrentDexMarketReference } from './currentDexMarketReference';
import { currentDexPriceImpact } from './currentDexPriceImpact';
import type { TradeActionConfirmModel } from './tradeActionConfirm';
const now = HISTORY_FIXTURE_DAY * 86400n + 100n;
async function fixture(mode: Parameters<typeof makeHistoryFixture>[0] = 'empty', reverse = false) {
  const f = makeHistoryFixture(mode);
  const snapshot = await readCurrentDexDailyPrice({ provider: f.provider, manifest: f.manifest, finalityLagBlocks: 0, count: 1 });
  const pair: readonly [string,string] = reverse ? [f.manifest.symbols[1], f.manifest.symbols[0]] : f.manifest.symbols;
  return { pair, reference: currentDexMarketReference({ status: 'empty', snapshot }, pair, now) };
}
const model = (pair: readonly [string,string], inputIndex: 0 | 1, input: string, output: string): TradeActionConfirmModel => ({
  title: 'Private Quote', primaryLabel: 'Accept', fundingMoves: [], stats: [], message: 'After fees.',
  summaryRows: [{ label: 'You pay', value: `${input} ${pair[inputIndex]}` }, { label: 'You receive', value: `${output} ${pair[1-inputIndex]}` }]
});
describe('current net Quote price impact display', () => {
  it.each([
    [0, '10', '18', '≈ 10.00% worse'], [1, '10', '4.5', '≈ 10.00% worse'],
    [0, '10', '22', '≈ 10.00% better'], [1, '10', '5.5', '≈ 10.00% better'],
    [0, '10', '20', '≈ 0.00% (matches reference)'],
    [1, '2', '0.9', '≈ 10.00% worse'],
    [0, '10000', '19999', '≈ <0.01% worse'], [0, '10000', '20001', '≈ <0.01% better'],
    [0, '0.000000000000000001', '0.000000000000000001', '≈ 50.00% worse']
  ] as const)('input side %i, paid %s and net %s: %s', async (inputIndex, input, output, expected) => {
    const f = await fixture(); expect(currentDexPriceImpact({ ...f, inputIndex, model: model(f.pair, inputIndex, input, output), now })).toBe(expected);
  });
  it('preserves the economic result with the exact reciprocal pair', async () => {
    const f = await fixture('empty', true);
    expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: model(f.pair, 0, '10', '4.5'), now })).toBe('≈ 10.00% worse');
    expect(currentDexPriceImpact({ ...f, inputIndex: 1, model: model(f.pair, 1, '10', '18'), now })).toBe('≈ 10.00% worse');
  });
  it('keeps uint256-scale amounts exact without floating point', async () => {
    const f = await fixture(), input = 1n << 250n;
    expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: model(f.pair, 0, formatUnits(input, 18), formatUnits(input, 18)), now })).toBe('≈ 50.00% worse');
  });
  it.each(['0', '-1', '1e2', '01.0', '1.0000000000000000001', formatUnits(1n << 256n, 18)])('rejects invalid or no-fill payment %s', async input => {
    const f = await fixture(); expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: model(f.pair, 0, input, '1'), now })).toBe('Unavailable');
  });
  it('rejects missing, duplicate or mismatched private amount rows and zero net output', async () => {
    const f = await fixture(); const m = model(f.pair, 0, '10', '18');
    for (const edited of [{ ...m, summaryRows: [] }, { ...m, summaryRows: [...m.summaryRows, m.summaryRows[0]] },
      model(['wrong', f.pair[1]], 0, '10', '18'), model(f.pair, 0, '10', '0')]) {
      expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: edited, now })).toBe('Unavailable');
    }
  });
  it('accepts only issued reference identity and matching units', async () => {
    const f = await fixture(), m = model(f.pair, 0, '10', '18');
    expect(isVerifiedCurrentDexMarketReference(f.reference)).toBe(true);
    expect(Object.isFrozen(f.reference)).toBe(true);
    if (isVerifiedCurrentDexMarketReference(f.reference)) {
      expect(Object.isFrozen(f.reference.pair)).toBe(true);
      expect(f.reference.rateNumerator).toBe(2n * 10n ** 18n);
      expect(f.reference.rateDenominator).toBe(10n ** 18n);
    }
    expect(currentDexPriceImpact({ ...f, reference: { ...f.reference }, inputIndex: 0, model: m, now })).toBe('Unavailable');
    expect(currentDexPriceImpact({ ...f, pair: [f.pair[1], f.pair[0]], inputIndex: 0, model: m, now })).toBe('Unavailable');
  });
  it('expires at the 120 second bound and rejects future observations', async () => {
    const f = await fixture(), m = model(f.pair, 0, '10', '18');
    expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: m, now: now + 110n })).toBe('≈ 10.00% worse');
    expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: m, now: now + 111n })).toBe('Unavailable');
    expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: m, now: now - 11n })).toBe('Unavailable');
  });
  it.each(['stale', 'suppressed', 'unobserved'] as const)('keeps %s references unavailable even with saved history', async mode => {
    const f = await fixture(mode); expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: model(f.pair, 0, '10', '18'), now })).toBe('Unavailable');
  });
  it('has no pre-Quote impact or inactive reference fallback', async () => {
    const f = await fixture(); expect(currentDexPriceImpact({ ...f, inputIndex: 0, model: null, now })).toBe('Unavailable');
    expect(currentDexPriceImpact({ ...f, reference: undefined, inputIndex: 0, model: model(f.pair, 0, '10', '18'), now })).toBe('Unavailable');
  });
});
