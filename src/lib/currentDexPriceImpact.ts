import { parseUnits } from '@coti-io/coti-ethers';
import { isVerifiedCurrentDexMarketReference, type CurrentDexMarketReference } from './currentDexMarketReference';
import type { TradeActionConfirmModel } from './tradeActionConfirm';

// Display only. Exact reviewed amounts; approximate public Pool price. No protection or send authority.
export function currentDexPriceImpact({ model, reference, pair, inputIndex, now }: {
  model: TradeActionConfirmModel | null; reference?: CurrentDexMarketReference;
  pair: readonly [string,string]; inputIndex: 0 | 1; now: bigint;
}): string {
  if (!model || !reference || reference.status !== 'available' || !isVerifiedCurrentDexMarketReference(reference) ||
      reference.pair[0] !== pair[0] || reference.pair[1] !== pair[1]) return 'Unavailable';
  const at = BigInt(reference.sampledAt);
  if (now < at || now - at > 120n) return 'Unavailable';
  const amount = (label: string, token: string) => {
    const rows = model.summaryRows.filter(row => row.label === label);
    if (rows.length !== 1 || !rows[0].value.endsWith(` ${token}`)) throw new Error('Quote amount unavailable.');
    const value = rows[0].value.slice(0, -token.length - 1);
    if (!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) throw new Error('Quote amount unavailable.');
    const atoms = parseUnits(value, 18);
    if (atoms <= 0n || atoms >= 1n << 256n) throw new Error('Quote amount unavailable.');
    return atoms;
  };
  try {
    const input = amount('You pay', pair[inputIndex]), output = amount('You receive', pair[1 - inputIndex]);
    const numerator = inputIndex === 0 ? reference.rateNumerator : reference.rateDenominator;
    const denominator = inputIndex === 0 ? reference.rateDenominator : reference.rateNumerator;
    const expected = input * numerator, difference = expected - output * denominator;
    if (difference === 0n) return '≈ 0.00% (matches reference)';
    const absolute = difference < 0n ? -difference : difference;
    const bps = absolute * 10000n / expected;
    const percent = bps === 0n ? '<0.01' : `${bps / 100n}.${(bps % 100n).toString().padStart(2, '0')}`;
    return `≈ ${percent}% ${difference > 0n ? 'worse' : 'better'}`;
  } catch { return 'Unavailable'; }
}
