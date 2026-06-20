import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import {
  getNormalizedOfferAssetKey,
  listNormalizedOffersForPair,
  normalizeStandardPublicOtcOffer,
  normalizeStandardPublicOtcOffers,
  quoteBestFillFromNormalizedOffers
} from './otcOfferNormalization';
import { ZERO_TRADE_TAKER_ADDRESS } from './tradePerspective';

const asset = (
  symbol: string,
  amount: string,
  decimals = 6,
  tokenAddress = `0x${symbol.replace(/[^a-fA-F0-9]/gu, '').padEnd(40, '1').slice(0, 40)}`
): TradeAssetPayload => ({
  kind: symbol === 'COTI' ? 'native' : 'erc20',
  tokenAddress: symbol === 'COTI' ? undefined : tokenAddress,
  symbol,
  decimals,
  amount
});

const trade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot =>
  ({
    tradeId: 7,
    escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
    maker: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    taker: ZERO_TRADE_TAKER_ADDRESS,
    offer: asset('WISP', '100000000'),
    request: asset('COTI', '2000000000000000000', 18),
    createdAt: 100,
    expiresAt: 200,
    status: 'open',
    isPublic: true,
    ...overrides
  }) as TradeSnapshot;

describe('OTC offer normalization', () => {
  it('normalizes open standard public offers into comparable fillable offers', () => {
    const result = normalizeStandardPublicOtcOffer(
      trade({
        fillState: {
          filledOfferAmount: '25000000',
          filledRequestAmount: '500000000000000000',
          remainingOfferAmount: '75000000',
          remainingRequestAmount: '1500000000000000000'
        }
      })
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) {
      throw new Error(result.reason);
    }

    expect(result.offer).toMatchObject({
      sourceContract: TRADE_ESCROW_CONTRACT_ADDRESS,
      sourceType: 'standard',
      id: 7n,
      tradeId: 7,
      maker: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      isPublic: true,
      hiddenAmount: false,
      fillKind: 'partialFill'
    });
    expect(result.offer.givesToken).toMatchObject({ symbol: 'WISP', decimals: 6 });
    expect(result.offer.wantsToken).toMatchObject({ symbol: 'COTI', decimals: 18 });
    expect(result.offer.givesAmount).toBe(75_000_000n);
    expect(result.offer.wantsAmount).toBe(1_500_000_000_000_000_000n);
    expect(result.offer.price).toBe(20_000_000_000_000_000n);
  });

  it('skips non-fillable or non-standard offers with explicit reasons', () => {
    expect(normalizeStandardPublicOtcOffer(trade({ status: 'accepted' }))).toEqual({ ok: false, reason: 'not-open' });
    expect(normalizeStandardPublicOtcOffer(trade({ escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS }))).toEqual({
      ok: false,
      reason: 'unsupported-source'
    });
    expect(
      normalizeStandardPublicOtcOffer(
        trade({
          escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
          recurringOrder: {
            orderId: 1,
            selectedSide: 'buy',
            mode: 'public',
            recurringStatus: 'active',
            baseAsset: asset('WISP', '1000000'),
            quoteAsset: asset('COTI', '1000000000000000000', 18),
            buyTerms: { baseAmount: '1000000', quoteAmount: '1000000000000000000' },
            sellTerms: { baseAmount: '1000000', quoteAmount: '1200000000000000000' },
            publicBaseInventory: '1000000',
            publicQuoteInventory: '1000000000000000000',
            buySideOpen: true,
            sellSideOpen: true,
            hasPrivateBaseInventory: false,
            hasPrivateQuoteInventory: false,
            executionCount: 0
          }
        })
      )
    ).toEqual({ ok: false, reason: 'unsupported-source' });
    expect(normalizeStandardPublicOtcOffer(trade({ isPublic: false }))).toEqual({ ok: false, reason: 'not-public' });
    expect(normalizeStandardPublicOtcOffer(trade({ hasAccessHash: true }))).toEqual({ ok: false, reason: 'not-public' });
    expect(normalizeStandardPublicOtcOffer(trade({ taker: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }))).toEqual({
      ok: false,
      reason: 'not-open-to-anyone'
    });
    expect(normalizeStandardPublicOtcOffer(trade({ hiddenLiquidity: true }))).toEqual({
      ok: false,
      reason: 'hidden-amount'
    });
    expect(normalizeStandardPublicOtcOffer(trade({ offer: asset('WISP', '0') }))).toEqual({
      ok: false,
      reason: 'invalid-amount'
    });
    expect(normalizeStandardPublicOtcOffer(trade({ offer: asset('WISP', '1'), request: asset('WISP', '2') }))).toEqual({
      ok: false,
      reason: 'same-token'
    });
  });

  it('lists normalized offers for a pair by best price first', () => {
    const cheap = trade({
      tradeId: 1,
      offer: asset('COTI', '100000000000000000000', 18),
      request: asset('USDC.e', '90000000'),
      createdAt: 50
    });
    const expensive = trade({
      tradeId: 2,
      offer: asset('COTI', '100000000000000000000', 18),
      request: asset('USDC.e', '110000000'),
      createdAt: 60
    });
    const otherPair = trade({
      tradeId: 3,
      offer: asset('WISP', '1000000'),
      request: asset('USDC.e', '1000000')
    });

    const offers = normalizeStandardPublicOtcOffers([expensive, otherPair, cheap]);
    const pairOffers = listNormalizedOffersForPair(offers, {
      buyToken: cheap.offer,
      payToken: cheap.request
    });

    expect(pairOffers.map((offer) => offer.tradeId)).toEqual([1, 2]);
    expect(pairOffers.map((offer) => offer.price)).toEqual([900_000_000_000_000_000n, 1_100_000_000_000_000_000n]);
  });

  it('quotes a simple multi-offer best fill route', () => {
    const cheap = trade({
      tradeId: 1,
      offer: asset('COTI', '100000000000000000000', 18),
      request: asset('USDC.e', '90000000'),
      createdAt: 50
    });
    const expensive = trade({
      tradeId: 2,
      offer: asset('COTI', '100000000000000000000', 18),
      request: asset('USDC.e', '110000000'),
      createdAt: 60
    });
    const offers = normalizeStandardPublicOtcOffers([expensive, cheap]);

    const quote = quoteBestFillFromNormalizedOffers({
      offers,
      buyToken: cheap.offer,
      payToken: cheap.request,
      buyAmount: 150_000_000_000_000_000_000n
    });

    expect(quote.complete).toBe(true);
    expect(quote.legs.map((leg) => [leg.offer.tradeId, leg.buyAmount, leg.payAmount])).toEqual([
      [1, 100_000_000_000_000_000_000n, 90_000_000n],
      [2, 50_000_000_000_000_000_000n, 55_000_000n]
    ]);
    expect(quote.filledBuyAmount).toBe(150_000_000_000_000_000_000n);
    expect(quote.totalPayAmount).toBe(145_000_000n);
    expect(quote.averagePrice).toBe(966_666_666_666_666_667n);
  });

  it('reports incomplete fills and max-price exclusions', () => {
    const cheap = trade({
      tradeId: 1,
      offer: asset('COTI', '100000000000000000000', 18),
      request: asset('USDC.e', '90000000')
    });
    const expensive = trade({
      tradeId: 2,
      offer: asset('COTI', '100000000000000000000', 18),
      request: asset('USDC.e', '110000000')
    });
    const unrelated = trade({
      tradeId: 3,
      offer: asset('WISP', '1000000'),
      request: asset('USDC.e', '1000000')
    });
    const offers = normalizeStandardPublicOtcOffers([cheap, expensive, unrelated]);

    const quote = quoteBestFillFromNormalizedOffers({
      offers,
      buyToken: cheap.offer,
      payToken: cheap.request,
      buyAmount: 150_000_000_000_000_000_000n,
      maxPrice: 1_000_000_000_000_000_000n
    });

    expect(quote.complete).toBe(false);
    expect(quote.legs.map((leg) => leg.offer.tradeId)).toEqual([1]);
    expect(quote.excluded.map((excluded) => [excluded.offer.tradeId, excluded.reason])).toEqual([
      [2, 'above-max-price'],
      [3, 'pair-mismatch']
    ]);
  });

  it('uses stable token keys for native and token assets', () => {
    expect(getNormalizedOfferAssetKey(asset('COTI', '1', 18))).toBe('native:coti');
    expect(getNormalizedOfferAssetKey(asset('USDC.e', '1', 6, '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD'))).toBe(
      'erc20:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    );
  });
});
