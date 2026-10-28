import { describe, expect, it, vi } from 'vitest';
import type { TradeOfferMessagePayload, TradeSnapshot } from '../../../lib/appShared';
import { loadActiveTradeOfferSnapshots } from './useActiveTradeOfferSnapshots';

const offer = Object.freeze({
  tradeId: 3,
  escrowContract: '0x1111111111111111111111111111111111111111'
}) as TradeOfferMessagePayload;

const snapshot = Object.freeze({
  tradeId: 3,
  escrowContract: offer.escrowContract
}) as TradeSnapshot;

describe('loadActiveTradeOfferSnapshots', () => {
  it('hydrates the current and retained escrow but skips unknown addresses', async () => {
    const retained = { ...offer, escrowContract: '0x2222222222222222222222222222222222222222' };
    const unknown = { ...offer, escrowContract: '0x3333333333333333333333333333333333333333' };
    const resolve = vi.fn(async (value: TradeOfferMessagePayload) => ({ ...snapshot, escrowContract: value.escrowContract }));
    const result = await loadActiveTradeOfferSnapshots({ offers: [offer, retained, unknown], privateTermsEnabled: false,
      supportedEscrowContracts: [offer.escrowContract, retained.escrowContract], resolveTradeSnapshotForOffer: resolve });
    expect(result.map(value => value.escrowContract)).toEqual([offer.escrowContract, retained.escrowContract]);
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it('automatically enables participant-private terms after privacy unlock', async () => {
    const resolveTradeSnapshotForOffer = vi.fn(async () => snapshot);

    await expect(loadActiveTradeOfferSnapshots({
      offers: [offer],
      privateTermsEnabled: true,
      resolveTradeSnapshotForOffer
    })).resolves.toEqual([snapshot]);

    expect(resolveTradeSnapshotForOffer).toHaveBeenCalledWith(offer, {
      allowPrivatePrompt: true
    });
  });

  it('keeps the initial chat-card discovery amount-free while privacy is locked', async () => {
    const resolveTradeSnapshotForOffer = vi.fn(async () => snapshot);

    await expect(loadActiveTradeOfferSnapshots({
      offers: [offer],
      privateTermsEnabled: false,
      resolveTradeSnapshotForOffer
    })).resolves.toEqual([snapshot]);

    expect(resolveTradeSnapshotForOffer).toHaveBeenCalledWith(offer, {
      allowPrivatePrompt: false
    });
  });

  it('deduplicates the same embedded trade and leaves failed cards out of the update', async () => {
    const resolveTradeSnapshotForOffer = vi.fn(async () => {
      throw new Error('temporary participant read failure');
    });

    await expect(loadActiveTradeOfferSnapshots({
      offers: [offer, offer],
      privateTermsEnabled: true,
      resolveTradeSnapshotForOffer
    })).resolves.toEqual([]);

    expect(resolveTradeSnapshotForOffer).toHaveBeenCalledOnce();
  });

  it('does not hydrate a retired escrow card through the active testnet runtime', async () => {
    const resolveTradeSnapshotForOffer = vi.fn(async () => snapshot);

    await expect(loadActiveTradeOfferSnapshots({
      offers: [offer],
      privateTermsEnabled: true,
      supportedEscrowContract: '0x2222222222222222222222222222222222222222',
      resolveTradeSnapshotForOffer
    })).resolves.toEqual([]);

    expect(resolveTradeSnapshotForOffer).not.toHaveBeenCalled();
  });

  it('serializes wallet-bound snapshot reads instead of fanning them into MetaMask', async () => {
    let active = 0;
    let maxActive = 0;
    const secondOffer = Object.freeze({ ...offer, tradeId: 4 }) as TradeOfferMessagePayload;
    const resolveTradeSnapshotForOffer = vi.fn(async (current: TradeOfferMessagePayload) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return Object.freeze({ ...snapshot, tradeId: current.tradeId }) as TradeSnapshot;
    });

    await expect(loadActiveTradeOfferSnapshots({
      offers: [offer, secondOffer],
      privateTermsEnabled: true,
      resolveTradeSnapshotForOffer
    })).resolves.toHaveLength(2);

    expect(maxActive).toBe(1);
  });
});
