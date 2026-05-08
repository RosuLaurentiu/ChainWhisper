import { describe, expect, it } from 'vitest';
import { shouldRouteTradeThroughDirectEscrow } from './tradeActions';

describe('tradeActions routing', () => {
  it('routes every non-public one-off offer and counter through Direct escrow', () => {
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: true })).toBe(false);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: false })).toBe(true);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: true, parentTradeId: 3 })).toBe(true);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: true, parentTradeId: 3, hidePrivateLiquidity: true })).toBe(true);
    expect(shouldRouteTradeThroughDirectEscrow({ isPublic: false, hidePrivateLiquidity: true })).toBe(false);
  });
});
