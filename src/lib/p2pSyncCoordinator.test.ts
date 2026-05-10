import { describe, expect, it } from 'vitest';
import { mergeP2PSyncRequests, shouldUseSilentP2PSync, type P2PSyncRequest } from './p2pSyncCoordinator';

describe('p2p sync coordinator helpers', () => {
  it('coalesces sync domains while preserving latest route target and signer', () => {
    const firstSigner = { id: 'first' };
    const secondSigner = { id: 'second' };
    const first: P2PSyncRequest<typeof firstSigner> = {
      domains: new Set(['balances', 'public-trades']),
      reason: 'focus',
      signer: firstSigner,
      tradeId: 1
    };
    const merged = mergeP2PSyncRequests(first, {
      domains: new Set(['wallet-trades', 'trade-detail']),
      escrowContract: '0x0000000000000000000000000000000000000002',
      reason: 'chain-event',
      signer: secondSigner,
      tradeId: 2
    });

    expect([...merged.domains].sort()).toEqual(['balances', 'public-trades', 'trade-detail', 'wallet-trades']);
    expect(merged.reason).toBe('chain-event');
    expect(merged.signer).toBe(secondSigner);
    expect(merged.tradeId).toBe(2);
    expect(merged.escrowContract).toBe('0x0000000000000000000000000000000000000002');
  });

  it('keeps automatic sync quiet and reserves visible refresh for manual requests', () => {
    expect(shouldUseSilentP2PSync('focus')).toBe(true);
    expect(shouldUseSilentP2PSync('interval')).toBe(true);
    expect(shouldUseSilentP2PSync('chain-event')).toBe(true);
    expect(shouldUseSilentP2PSync('wallet-action')).toBe(true);
    expect(shouldUseSilentP2PSync('manual')).toBe(false);
  });
});
