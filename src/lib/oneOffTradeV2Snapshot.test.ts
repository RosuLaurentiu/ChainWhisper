import { describe, expect, it } from 'vitest';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';
import {
  projectDirectTradeV2Snapshot,
  projectPrivateTradeV2Snapshot,
  projectPrivateBookV2Snapshot,
  projectStandardTradeV2Snapshot
} from './oneOffTradeV2Snapshot';
import { PRIVATE_BOOK_V2_RUNTIME_HASH, type PrivateBookV2OrderView } from './privateBookV2Actions';
import type { AttestedTradeHistoryV2Deployment } from './tradeHistoryV2Chain';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const deployment = (protocol: 'standard-v2' | 'private-v2' | 'direct-v2') => ({
  protocol,
  chainId: '7082400',
  contractAddress: address(protocol === 'standard-v2' ? '11' : protocol === 'private-v2' ? '22' : '33')
}) as never;
const token = (kind: 'erc20' | 'private-erc20') => ({
  symbol: kind === 'erc20' ? 'PUB' : 'PRIV', decimals: 18
});

describe('one-off OTC V2 snapshot projection', () => {
  const bookView = (): PrivateBookV2OrderView => ({ orderId: '8', maker: address('44'), status: 'open', mode: 'private-pair', offerAsset: { assetType: 'private-erc20', token: address('55'), publicAmount: '0' }, requestAsset: { assetType: 'private-erc20', token: address('66'), publicAmount: '0' }, priceTerms: { offerAmount: '3', requestAmount: '2' }, fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' }, createdAt: '10', expiresAt: '0', revision: '3', fillCount: '2', rootOrderId: '8', replacementOrderId: '0', replacesOrderId: '0', pairKey: `0x${'11'.repeat(32)}`, offerLocked: true, offerTokenCodeHash: `0x${'22'.repeat(32)}`, requestTokenCodeHash: `0x${'33'.repeat(32)}` });
  const bookDeployment = { protocol: 'private-v2', chainId: '7082400', contractAddress: address('22'), runtimeBytecodeHash: PRIVATE_BOOK_V2_RUNTIME_HASH } as AttestedTradeHistoryV2Deployment;
  const account = { orderId: '8', sequence: '3', totalOfferAmount: '100', totalRequestAmount: '67', remainingOfferAmount: '60' };
  it('projects only the explicitly published original budget, never the owner remaining balance', () => {
    const view = { ...bookView(), publicBudget: { visible: true, amount: '100' } };
    const published = projectPrivateBookV2Snapshot({ view, deployment: bookDeployment, resolveTokenMetadata: token, viewer: address('77') });
    expect(published.privateBook.publicOfferBudget).toBe('100');
    expect(published.offer.amount).toBe('3'); expect(published.request.amount).toBe('2');
    const hidden = projectPrivateBookV2Snapshot({ view: { ...view, publicBudget: { visible: false, amount: '0' } }, deployment: bookDeployment, resolveTokenMetadata: token, viewer: address('44'), account });
    expect(hidden.privateBook.publicOfferBudget).toBeUndefined();
  });
  it.each([PRIVATE_BOOK_V2_RUNTIME_HASH, CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash])('keeps price public and budget maker-only for %s', (runtimeBytecodeHash) => {
    const common = { view: bookView(), deployment: { ...bookDeployment, runtimeBytecodeHash }, resolveTokenMetadata: token };
    const publicCard = projectPrivateBookV2Snapshot({ ...common, viewer: address('77') });
    const makerCard = projectPrivateBookV2Snapshot({ ...common, viewer: address('44'), account });
    expect(publicCard.offer.amount).toBe('3'); expect(publicCard.request.amount).toBe('2');
    expect(makerCard.offer).toEqual(publicCard.offer); expect(makerCard.request).toEqual(publicCard.request);
    expect(makerCard.privateBook.ownerBudget).toMatchObject({ ...account, recipient: address('44') });
    expect(publicCard.privateBook.ownerBudget).toBeUndefined();
    expect(makerCard.makerPrivateProgress).toBeUndefined(); expect(makerCard.fillState).toBeUndefined();
    expect(makerCard.status).toBe('open'); expect(makerCard.isPublic).toBe(true);
  });
  it('rejects stale/cross-order/cross-maker budget projection and an older runtime', () => {
    const common = { view: bookView(), deployment: bookDeployment, resolveTokenMetadata: token, viewer: address('44') };
    for (const invalid of [{ ...account, orderId: '9' }, { ...account, sequence: '2' }, { ...account, remainingOfferAmount: '101' }, { ...account, totalRequestAmount: '99' }]) expect(() => projectPrivateBookV2Snapshot({ ...common, account: invalid })).toThrow();
    expect(() => projectPrivateBookV2Snapshot({ ...common, viewer: address('77'), account })).toThrow(/another maker/);
    expect(() => projectPrivateBookV2Snapshot({ ...common, deployment: { ...bookDeployment, runtimeBytecodeHash: 'old' } })).toThrow(/promoted runtime/);
  });
  it('does not infer fills from cancelled capacity or hide a public hybrid budget', () => {
    const view = { ...bookView(), status: 'cancelled' as const };
    const projected = projectPrivateBookV2Snapshot({ view, deployment: bookDeployment, resolveTokenMetadata: token, viewer: address('44'), account: { ...account, remainingOfferAmount: '0' } });
    expect(projected.makerPrivateProgress).toBeUndefined(); expect(projected.status).toBe('cancelled');
    const hybrid = projectPrivateBookV2Snapshot({ view: { ...bookView(), mode: 'public-offer-private-request', offerAsset: { assetType: 'erc20', token: address('55'), publicAmount: '100' } }, deployment: bookDeployment, resolveTokenMetadata: token, viewer: address('77') });
    expect(hybrid.offer.amount).toBe('3'); expect(hybrid.privateBook.publicOfferBudget).toBe('100');
  });
  it('projects exact Standard V2 fill progress and revision', () => {
    const snapshot = projectStandardTradeV2Snapshot({
      deployment: deployment('standard-v2'),
      resolveTokenMetadata: token,
      view: {
        tradeId: '7', maker: address('44'), status: 'open',
        offerAsset: { assetType: 'erc20', token: address('55'), amount: '100' },
        requestAsset: { assetType: 'erc20', token: address('66'), amount: '200' },
        fillPolicy: { partialFillsAllowed: true, minPartialFillBps: '1000', minRequestAmount: '10', maxRequestAmountPerWallet: '100', oneFillPerWallet: false },
        createdAt: '10', expiresAt: '0', rootTradeId: '7',
        remainingOfferAmount: '75', remainingRequestAmount: '150', filledOfferAmount: '25', filledRequestAmount: '50',
        revision: '2', replacementTradeId: '0', replacesTradeId: '0'
      }
    });
    expect(snapshot.v2).toMatchObject({ protocol: 'standard-v2', revision: '2' });
    expect(snapshot.fillState).toEqual({
      remainingOfferAmount: '75', remainingRequestAmount: '150', filledOfferAmount: '25', filledRequestAmount: '50'
    });
  });

  it('keeps private outsider amounts hidden and materializes an authorized participant snapshot', () => {
    const view = {
      orderId: '8', maker: address('44'), status: 'open' as const, mode: 'fully-private' as const,
      offerAsset: { assetType: 'private-erc20' as const, token: address('55'), publicAmount: '0' },
      requestAsset: { assetType: 'private-erc20' as const, token: address('66'), publicAmount: '0' },
      fillPolicy: { partialFillsAllowed: true, minPartialFillBps: '1000', maxFills: '5' },
      createdAt: '10', expiresAt: '0', revision: '3', fillCount: '1', rootOrderId: '8', replacementOrderId: '0', replacesOrderId: '0'
    };
    const hidden = projectPrivateTradeV2Snapshot({ view, deployment: deployment('private-v2'), resolveTokenMetadata: token });
    const visible = projectPrivateTradeV2Snapshot({
      view, deployment: deployment('private-v2'), resolveTokenMetadata: token,
      account: { orderId: '8', sequence: '2', totalOfferAmount: '100', totalRequestAmount: '200', remainingOfferAmount: '60' }
    });
    expect(hidden.offer.amount).toBe('0');
    expect(visible.offer.amount).toBe('100');
    expect(visible.makerPrivateProgress).toMatchObject({ remainingOfferAmount: '60', filledOfferAmount: '40' });
  });

  it('projects participant-only Direct V2 private terms without inventing undisclosed amounts', () => {
    const baseView = {
      tradeId: '9', maker: address('44'), taker: address('77'), status: 'open' as const,
      amountMode: 'private' as const,
      offerAsset: { assetType: 'private-erc20' as const, token: address('55') },
      requestAsset: { assetType: 'private-erc20' as const, token: address('66') },
      createdAt: '10', expiresAt: '0', parentTradeId: '0', rootTradeId: '9', counterDepth: '0',
      activeCounterTradeId: '0', replacementTradeId: '0', replacesTradeId: '0'
    };
    const hidden = projectDirectTradeV2Snapshot({ view: baseView, deployment: deployment('direct-v2'), resolveTokenMetadata: token });
    const visible = projectDirectTradeV2Snapshot({
      view: { ...baseView, offerAmount: '10', requestAmount: '20' },
      deployment: deployment('direct-v2'), resolveTokenMetadata: token
    });
    expect(hidden.offer.amount).toBe('0');
    expect(hidden.directTermsMetadata?.hasTermsPayload).toBe(false);
    expect(visible.offer.amount).toBe('10');
    expect(visible.directTermsMetadata?.hasTermsPayload).toBe(true);
  });
});
