import { formatUnits, parseUnits } from '@coti-io/coti-ethers';
import { isVerifiedCurrentDexMarketReference, type CurrentDexMarketReference } from './currentDexMarketReference';
import type { TradeActionConfirmModel } from './tradeActionConfirm';

function exactTokenUnits(model: TradeActionConfirmModel, label: string, token: string): bigint {
  const rows = model.summaryRows.filter(row => row.label === label);
  if (rows.length !== 1 || !rows[0].value.endsWith(` ${token}`)) throw new Error('Quote amount unavailable.');
  const value = rows[0].value.slice(0, -token.length - 1);
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) throw new Error('Quote amount unavailable.');
  const atoms = parseUnits(value, 18);
  if (atoms <= 0n || atoms >= 1n << 256n) throw new Error('Quote amount unavailable.');
  return atoms;
}

// Display only. Exact reviewed amounts; approximate public Pool price. No protection or send authority.
export function currentDexPriceImpact({ model, reference, pair, inputIndex, now }: {
  model: TradeActionConfirmModel | null; reference?: CurrentDexMarketReference;
  pair: readonly [string,string]; inputIndex: 0 | 1; now: bigint;
}): string {
  if (!model || !reference || reference.status !== 'available' || !isVerifiedCurrentDexMarketReference(reference) ||
      reference.pair[0] !== pair[0] || reference.pair[1] !== pair[1]) return 'Unavailable';
  const at = BigInt(reference.sampledAt);
  if (now < at || now - at > 120n) return 'Unavailable';
  try {
    const input = exactTokenUnits(model, 'You pay', pair[inputIndex]), output = exactTokenUnits(model, 'You receive', pair[1 - inputIndex]);
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

// Display only. This uses reviewed Quote rows and has no protection or send authority.
export function currentDexQuoteAveragePrice({ model, pair, inputIndex, priceDisplayInverted }: {
  model: TradeActionConfirmModel | null; pair: readonly [string, string]; inputIndex: 0 | 1; priceDisplayInverted: boolean;
}): string {
  if (!model) return 'Unavailable';
  try {
    const paid = exactTokenUnits(model, 'You pay', pair[inputIndex]);
    const received = exactTokenUnits(model, 'You receive', pair[1 - inputIndex]);
    const baseIndex = priceDisplayInverted ? 1 : 0;
    const base = baseIndex === inputIndex ? paid : received;
    const quote = baseIndex === inputIndex ? received : paid;
    return `${formatUnits(quote * 10n ** 8n / base, 8)} ${pair[1 - baseIndex]} per ${pair[baseIndex]} (rounded down)`;
  } catch { return 'Unavailable'; }
}
