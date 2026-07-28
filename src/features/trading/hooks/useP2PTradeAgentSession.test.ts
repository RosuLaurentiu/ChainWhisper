import { describe, expect, it } from 'vitest';
import { shouldLoadTradeAgentFeeEstimate } from './useP2PTradeAgentSession';

describe('shouldLoadTradeAgentFeeEstimate', () => {
  it('does not call the payment endpoint while App Help is active', () => {
    expect(shouldLoadTradeAgentFeeEstimate('agent', 'help')).toBe(false);
  });

  it('loads the non-binding estimate only on the Trade Agent tab', () => {
    expect(shouldLoadTradeAgentFeeEstimate('agent', 'trade')).toBe(true);
    expect(shouldLoadTradeAgentFeeEstimate('public', 'trade')).toBe(false);
    expect(shouldLoadTradeAgentFeeEstimate(null, 'trade')).toBe(false);
  });

  it('keeps Agent Setup free of Trade Agent estimates', () => {
    expect(shouldLoadTradeAgentFeeEstimate('agent', 'setup')).toBe(false);
  });
});
