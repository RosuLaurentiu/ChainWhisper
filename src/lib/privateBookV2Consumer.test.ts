import { describe, expect, it } from 'vitest';
import { buildPrivateBookV2FillAction, getPrivateBookV2OwnerBudget, getPrivateBookV2Projection } from './privateBookV2Consumer';
import { PRIVATE_BOOK_V2_RUNTIME_HASH } from './privateBookV2Actions';
import type { PrivateBookV2ProjectedSnapshot } from './oneOffTradeV2Snapshot';

const maker = `0x${'11'.repeat(20)}`;
const snapshot = (): PrivateBookV2ProjectedSnapshot => ({
  tradeId: 7, status: 'open', maker, taker: `0x${'00'.repeat(20)}`,
  offer: { kind: 'private-erc20', symbol: 'A', decimals: 0, amount: '1' },
  request: { kind: 'private-erc20', symbol: 'B', decimals: 0, amount: '2' },
  createdAt: 1, expiresAt: 0,
  v2: { protocol: 'private-v2', chainId: '7082400', contractAddress: maker, revision: '2', privateMode: 'fully-private' },
  privateBook: { runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH, priceTerms: { offerAmount: '1', requestAmount: '2' }, fillBehavior: 'remaining-at-reviewed-price',
    ownerBudget: { orderId: '7', sequence: '2', recipient: maker, totalOfferAmount: '100', totalRequestAmount: '200', remainingOfferAmount: '60' } }
});

describe('private book consumer bindings', () => {
  it('keeps the maximum independent of price unit size', () => {
    expect(buildPrivateBookV2FillAction(snapshot(), 20n).terms).toMatchObject({ mode: 'private-pair', maxRequestAmount: 20n });
  });
  it('does not admit old/changed projection or closed state', () => {
    const item = snapshot();
    expect(() => getPrivateBookV2Projection({ ...item, offer: { ...item.offer, amount: '9' } })).toThrow(/projection/);
    expect(() => getPrivateBookV2Projection({ ...item, privateBook: { ...item.privateBook, runtimeBytecodeHash: 'old' } } as PrivateBookV2ProjectedSnapshot)).toThrow(/projection/);
    expect(() => buildPrivateBookV2FillAction({ ...item, status: 'cancelled' }, 20n)).toThrow(/Refresh/);
    expect(() => buildPrivateBookV2FillAction({ ...item, privateBook: undefined } as unknown as PrivateBookV2ProjectedSnapshot, 20n)).toThrow(/Refresh/);
  });
  it('rejects payments that cannot buy one base unit', () => {
    expect(() => buildPrivateBookV2FillAction(snapshot(), 1n)).toThrow(/one offer unit/);
  });
  it('keeps maker capacity isolated by recipient, order and revision', () => {
    const item = snapshot();
    expect(getPrivateBookV2OwnerBudget(item, maker)?.remainingOfferAmount).toBe('60');
    expect(getPrivateBookV2OwnerBudget(item, `0x${'22'.repeat(20)}`)).toBeUndefined();
    for (const override of [{ orderId: '8' }, { sequence: '3' }, { recipient: `0x${'22'.repeat(20)}` }]) {
      const changed: PrivateBookV2ProjectedSnapshot = { ...item, privateBook: { ...item.privateBook, ownerBudget: { ...item.privateBook.ownerBudget!, ...override } } };
      expect(getPrivateBookV2OwnerBudget(changed, maker)).toBeUndefined();
    }
  });
});
