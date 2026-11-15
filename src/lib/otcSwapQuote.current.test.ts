import { describe, expect, it } from 'vitest';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';
import { projectPrivateBookV2Snapshot, projectStandardTradeV2Snapshot } from './oneOffTradeV2Snapshot';
import { quoteBestSingleOtcSwap } from './otcSwapQuote';
import type { AttestedTradeHistoryV2Deployment } from './tradeHistoryV2Chain';
import type { TradeSnapshot } from './appShared/core';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const deployment = (protocol: 'standard-v2' | 'private-v2') => ({
  ...CURRENT_P2P_BINDING.deployments[protocol], protocol, chainId: CURRENT_P2P_BINDING.chainId
}) as AttestedTradeHistoryV2Deployment;
const token = () => ({ symbol: 'TEST', decimals: 6 });
const book = (owner = false) => projectPrivateBookV2Snapshot({
  deployment: deployment('private-v2'), resolveTokenMetadata: token, viewer: address(owner ? '44' : '77'),
  view: { orderId: '3', maker: address('44'), status: 'open', mode: 'private-pair',
    offerAsset: { assetType: 'private-erc20', token: address('55'), publicAmount: '0' },
    requestAsset: { assetType: 'private-erc20', token: address('66'), publicAmount: '0' },
    priceTerms: { offerAmount: '3', requestAmount: '2' }, publicBudget: { visible: false, amount: '0' },
    fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' },
    createdAt: '10', expiresAt: '0', revision: '3', fillCount: '0', rootOrderId: '3',
    replacementOrderId: '0', replacesOrderId: '0', pairKey: `0x${'11'.repeat(32)}`, offerLocked: true,
    offerTokenCodeHash: `0x${'22'.repeat(32)}`, requestTokenCodeHash: `0x${'33'.repeat(32)}` },
  ...(owner ? { account: { orderId: '3', sequence: '3', totalOfferAmount: '300',
    totalRequestAmount: '200', remainingOfferAmount: '240' } } : {})
});
const quote = (trade: TradeSnapshot) => quoteBestSingleOtcSwap({ includePrivateOtcQuotes: true,
  trades: [trade], inputAmountWei: 0n, inputMode: 'buy', buyToken: trade.offer, sellToken: trade.request });

describe('current P2P Offers quote admission', () => {
  it('lists the current private Book public price with a hidden budget and no amount input', () => {
    const snapshot = book(), result = quote(snapshot);
    expect(result.candidates).toHaveLength(1);
    expect(result.best).toMatchObject({ tradeId: 3, escrowContract: snapshot.escrowContract,
      availability: { kind: 'terminal' }, price: 666666666666666667n });
    expect(snapshot.privateBook.ownerBudget).toBeUndefined();
    expect(snapshot.privateBook.publicOfferBudget).toBeUndefined();
    const owner = quote(book(true));
    expect(owner.best?.price).toBe(result.best?.price);
    expect(owner.best?.availability).toEqual({ kind: 'terminal' });
  });

  it('uses the current Standard remaining amounts rather than its original budget', () => {
    const snapshot = projectStandardTradeV2Snapshot({ deployment: deployment('standard-v2'), resolveTokenMetadata: token,
      view: { tradeId: '8', maker: address('44'), status: 'open',
        offerAsset: { assetType: 'erc20', token: address('55'), amount: '100' },
        requestAsset: { assetType: 'erc20', token: address('66'), amount: '200' },
        createdAt: '10', expiresAt: '0', revision: '2', replacementTradeId: '0', replacesTradeId: '0',
        remainingOfferAmount: '60', remainingRequestAmount: '120', filledOfferAmount: '40', filledRequestAmount: '80'
      } as Parameters<typeof projectStandardTradeV2Snapshot>[0]['view'] });
    expect(quote(snapshot).best?.availability).toEqual({ kind: 'known', maxBuyAmountWei: 60n, maxSellAmountWei: 120n });
  });

  it('rejects wrong-chain, cross-contract and unbound current trade identities', () => {
    const snapshot = book();
    for (const changed of [
      { ...snapshot, v2: { ...snapshot.v2!, chainId: '7' } },
      { ...snapshot, escrowContract: address('99') },
      { ...snapshot, v2: { ...snapshot.v2!, contractAddress: address('99') } },
      { ...snapshot, escrowContract: CURRENT_P2P_BINDING.deployments['link-v2'].contractAddress,
        v2: { ...snapshot.v2!, protocol: 'link-v2' as never, contractAddress: CURRENT_P2P_BINDING.deployments['link-v2'].contractAddress } },
      { ...snapshot, v2: undefined }
    ]) expect(quote(changed).candidates).toHaveLength(0);
  });

  it('keeps cancelled offers out and matches only the counterparty token direction', () => {
    const snapshot = book();
    expect(quote({ ...snapshot, status: 'cancelled' }).candidates).toHaveLength(0);
    expect(quoteBestSingleOtcSwap({ includePrivateOtcQuotes: true, trades: [snapshot], inputAmountWei: 0n,
      inputMode: 'buy', buyToken: snapshot.request, sellToken: snapshot.offer }).candidates).toHaveLength(0);
  });
});
