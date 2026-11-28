import { describe, expect, it } from 'vitest';
import { describedByIds } from './a11y';

describe('describedByIds', () => {
  it('joins the ids that are set', () => {
    expect(describedByIds('terms-help', 'amount-error')).toBe('terms-help amount-error');
  });

  it('leaves out values that are not set', () => {
    const locked = false;
    const error = '';

    expect(describedByIds(locked && 'terms-help', error && 'amount-error', 'expiry-error')).toBe('expiry-error');
  });

  it('returns no attribute value when no id is set', () => {
    expect(describedByIds(false, undefined, null, '')).toBeUndefined();
  });
});
