import { describe, expect, it } from 'vitest';
import { resolveBoundTransactionChain } from './boundTransactionChain';

describe('resolveBoundTransactionChain', () => {
  const expected = 7_082_400n;

  it('uses the attested chain only when the wallet response omits it', () => {
    expect(resolveBoundTransactionChain(undefined, expected, 'Test')).toBe(expected);
    expect(resolveBoundTransactionChain(null, expected, 'Test')).toBe(expected);
  });

  it('normalizes explicit bigint, decimal, number, and hex response chains', () => {
    expect(resolveBoundTransactionChain(expected, expected, 'Test')).toBe(expected);
    expect(resolveBoundTransactionChain(expected.toString(), expected, 'Test')).toBe(expected);
    expect(resolveBoundTransactionChain(Number(expected), expected, 'Test')).toBe(expected);
    expect(resolveBoundTransactionChain(`0x${expected.toString(16)}`, expected, 'Test')).toBe(expected);
  });

  it('returns an explicit different chain so the exact envelope comparison rejects it', () => {
    expect(resolveBoundTransactionChain(1n, expected, 'Test')).toBe(1n);
  });

  it('rejects malformed, negative, and invalid expected chains', () => {
    expect(() => resolveBoundTransactionChain('not-a-chain', expected, 'Test'))
      .toThrow('transaction chain must be an unsigned integer');
    expect(() => resolveBoundTransactionChain(-1n, expected, 'Test'))
      .toThrow('transaction chain is out of range');
    expect(() => resolveBoundTransactionChain(undefined, 0n, 'Test'))
      .toThrow('expected chain is out of range');
  });
});
