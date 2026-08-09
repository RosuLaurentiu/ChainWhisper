import { describe, expect, it } from 'vitest';
import {
  buildTradeAgentConversationTurns,
  calculateTradeAgentRecurringReferencePrices
} from './tradeAgent';

describe('Trade Agent conversation context', () => {
  it('keeps useful conversation turns without intro or status rows', () => {
    expect(buildTradeAgentConversationTurns([
      { id: 'intro', role: 'assistant', text: 'Intro' },
      { id: '1', role: 'user', text: 'Draft recurring private liquidity at 50% around Carbon.' },
      { id: '2', role: 'status', text: 'Paid' },
      { id: '3', role: 'assistant', text: 'Which pair direction?' }
    ])).toEqual([
      { role: 'user', text: 'Draft recurring private liquidity at 50% around Carbon.' },
      { role: 'assistant', text: 'Which pair direction?' }
    ]);
  });

  it('calculates recurring buy below and sell above the supplied market price', () => {
    expect(calculateTradeAgentRecurringReferencePrices({ marketPrice: 0.25, percentage: 50 })).toEqual({
      buyPrice: '0.125',
      sellPrice: '0.375'
    });
  });
});
