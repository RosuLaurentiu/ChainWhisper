import { describe, expect, it } from 'vitest';
import { extractRawTransactionFromError, isAlreadyKnownTransactionError } from './appLookup';

describe('appLookup transaction error helpers', () => {
  it('detects nested already-known RPC errors', () => {
    expect(
      isAlreadyKnownTransactionError({
        code: 'UNKNOWN_ERROR',
        error: { code: -32000, message: 'already known' }
      })
    ).toBe(true);
  });

  it('extracts raw signed transactions from nested RPC payload params', () => {
    const rawTx = `0x02${'ab'.repeat(80)}`;

    expect(
      extractRawTransactionFromError({
        payload: {
          method: 'eth_sendRawTransaction',
          params: [rawTx]
        }
      })
    ).toBe(rawTx);
  });
});
