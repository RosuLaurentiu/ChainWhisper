import { describe, expect, it } from 'vitest';
import { shouldRouteTradeThroughPartyEscrow } from './tradeActions';

describe('tradeActions routing', () => {
  it('routes every non-public one-off offer and counter through Party escrow', () => {
    expect(shouldRouteTradeThroughPartyEscrow({ isPublic: true })).toBe(false);
    expect(shouldRouteTradeThroughPartyEscrow({ isPublic: false })).toBe(true);
    expect(shouldRouteTradeThroughPartyEscrow({ isPublic: true, parentTradeId: 3 })).toBe(true);
    expect(shouldRouteTradeThroughPartyEscrow({ isPublic: false, hidePrivateLiquidity: true })).toBe(false);
  });
});
