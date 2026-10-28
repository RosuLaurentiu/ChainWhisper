import { describe, expect, it } from 'vitest';
import { assertCounterTradeV2ModeAdmission } from './counterTradeV2';

describe('independent public and private Counter funding', () => {
  it('does not let public admission release private funding', () => {
    expect(() => assertCounterTradeV2ModeAdmission({ publicOnly: true }, true)).toThrow(/Private counteroffers are not enabled/);
    expect(() => assertCounterTradeV2ModeAdmission({ publicOnly: true }, false)).not.toThrow();
  });
  it('keeps both funding modes stopped in recovery', () => {
    for (const privatePair of [false, true]) {
      expect(() => assertCounterTradeV2ModeAdmission({ recoveryOnly: true }, privatePair)).toThrow(/Counter trading is not enabled/);
    }
  });
});
