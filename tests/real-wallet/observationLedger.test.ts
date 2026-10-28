import { describe, expect, it } from 'vitest';
import {
  consumeObservationLedger,
  createObservationLedgerCursor,
  sealObservationLedgerCursor
} from './observationLedger';

describe('real-wallet observation ledger', () => {
  it('consumes every observation exactly once and seals at the final count', () => {
    const first = consumeObservationLedger({
      beforeCount: 0,
      cursor: createObservationLedgerCursor(),
      observations: ['connect', 'chain']
    });
    expect(first.entries).toEqual(['connect', 'chain']);

    const second = consumeObservationLedger({
      beforeCount: 2,
      cursor: first.cursor,
      observations: ['connect', 'chain', 'attest']
    });
    expect(second.entries).toEqual(['attest']);
    expect(sealObservationLedgerCursor({ currentCount: 3, cursor: second.cursor })).toEqual({
      nextIndex: 3,
      sealed: true
    });
  });

  it('rejects skipped, regressed, post-seal, and unmeasured final observations', () => {
    const cursor = consumeObservationLedger({
      beforeCount: 0,
      cursor: createObservationLedgerCursor(),
      observations: ['measured']
    }).cursor;

    expect(() =>
      consumeObservationLedger({ beforeCount: 2, cursor, observations: ['measured', 'extra'] })
    ).toThrow(/between phases/i);
    expect(() =>
      consumeObservationLedger({ beforeCount: 1, cursor, observations: [] })
    ).toThrow(/regressed/i);
    expect(() => sealObservationLedgerCursor({ currentCount: 2, cursor })).toThrow(/unmeasured/i);

    const sealed = sealObservationLedgerCursor({ currentCount: 1, cursor });
    expect(() =>
      consumeObservationLedger({ beforeCount: 1, cursor: sealed, observations: ['measured'] })
    ).toThrow(/already sealed/i);
  });
});
