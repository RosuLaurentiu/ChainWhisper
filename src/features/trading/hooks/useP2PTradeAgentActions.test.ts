import { describe, expect, it } from 'vitest';
import { RECURRING_OTC_CONTRACT_ADDRESS, type TradeSnapshot } from '../../../lib/appShared';
import { resolveTradeAgentOpenOrderSnapshot } from './useP2PTradeAgentActions';

const recurringOrder = {
  tradeId: 5,
  escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
} as TradeSnapshot;

describe('resolveTradeAgentOpenOrderSnapshot', () => {
  it('reuses the cached recurring order selected by the agent', () => {
    expect(
      resolveTradeAgentOpenOrderSnapshot(
        {
          type: 'open_order',
          label: 'Open order',
          tradeId: 5,
          escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
        },
        [recurringOrder]
      )
    ).toBe(recurringOrder);
  });

  it('does not reuse an order with the same contract-local id from another escrow', () => {
    expect(
      resolveTradeAgentOpenOrderSnapshot(
        {
          type: 'open_order',
          label: 'Open order',
          tradeId: 5,
          escrowContract: RECURRING_OTC_CONTRACT_ADDRESS
        },
        [{ ...recurringOrder, escrowContract: '0x1111111111111111111111111111111111111111' }]
      )
    ).toBeNull();
  });

  it('requires an unambiguous cached contract when the agent omits the escrow', () => {
    expect(
      resolveTradeAgentOpenOrderSnapshot(
        { type: 'open_order', label: 'Open order', tradeId: 5 },
        [recurringOrder, { ...recurringOrder, escrowContract: '0x1111111111111111111111111111111111111111' }]
      )
    ).toBeNull();
  });
});
