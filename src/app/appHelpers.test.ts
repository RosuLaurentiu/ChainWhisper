import { describe, expect, it } from 'vitest';
import { formatTradeAgentFeeLabel } from './appHelpers';

describe('formatTradeAgentFeeLabel', () => {
  it('rounds the display estimate up to a whole WISP', () => {
    expect(
      formatTradeAgentFeeLabel({
        feeAmountWei: '650966400',
        feeRecipient: '0xbf01185A70CDfEF1858659836D57BFf085ebed55',
        feeTokenAddress: '0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8',
        feeTokenDecimals: 6,
        feeTokenSymbol: 'WISP',
        quoteSource: 'test'
      })
    ).toBe('651 WISP');
  });
});
