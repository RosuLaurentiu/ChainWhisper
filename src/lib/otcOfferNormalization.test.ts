import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
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
import {
  quoteBestSingleOtcSwap,
  type OtcSwapInputMode
} from './otcSwapQuote';
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

  it('quotes the best single one-off order without combining compatible offers', () => {
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

    const quote = quoteBestSingleOtcSwap({
      trades: [expensive, cheap],
      sellToken: cheap.request,
      buyToken: cheap.offer,
      inputMode: 'buy',
      inputAmountWei: 150_000_000_000_000_000_000n
    });

    expect(quote.compatibleCount).toBe(2);
    expect(quote.otherCompatibleCount).toBe(1);
    expect(quote.best?.tradeId).toBe(1);
    expect(quote.best?.estimatedSellAmountWei).toBe(135_000_000n);
    expect(quote.best?.complete).toBe(false);
    expect(quote.best?.terminalPrefill).toMatchObject({ kind: 'standard', inputSide: 'buy' });
  });

  it('quotes a linked private one-off order from opened terminal data without making it a normal public candidate', () => {
    const privateTrade = trade({
      tradeId: 7,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      hiddenLiquidity: true,
      isPublic: false,
      offer: asset('p.COTI', '2500000000000000000', 18, '0x2222222222222222222222222222222222222222'),
      request: asset('p.gCOTI', '10000000000000000000', 18, '0x3333333333333333333333333333333333333333')
    });

    const strictQuote = quoteBestSingleOtcSwap({
      trades: [privateTrade],
      sellToken: privateTrade.request,
      buyToken: privateTrade.offer,
      inputMode: 'sell',
      inputAmountWei: 10_000_000_000_000_000_000n
    });
    expect(strictQuote.best).toBeNull();

    const linkedQuote = quoteBestSingleOtcSwap({
      includePrivateOtcQuotes: true,
      trades: [privateTrade],
      sellToken: privateTrade.request,
      buyToken: privateTrade.offer,
      inputMode: 'sell',
      inputAmountWei: 10_000_000_000_000_000_000n
    });

    expect(linkedQuote.best).toMatchObject({
      tradeId: 7,
      sourceType: 'standard',
      availability: { kind: 'terminal' },
      terminalPrefill: { kind: 'standard', inputSide: 'pay' }
    });
    expect(linkedQuote.best?.estimatedSellAmountWei).toBe(10_000_000_000_000_000_000n);
    expect(linkedQuote.best?.estimatedBuyAmountWei).toBe(2_500_000_000_000_000_000n);
  });

  it('selects the best bid and ask from mixed one-off and recurring public orders', () => {
    const one = 1_000_000_000_000_000_000n;
    const base = (amount: bigint | string = '0') =>
      asset('p.gCOTI', amount.toString(), 18, '0x1111111111111111111111111111111111111111');
    const quote = (amount: bigint | string = '0') =>
      asset('p.COTI', amount.toString(), 18, '0x2222222222222222222222222222222222222222');
    const oneOffBid = trade({
      tradeId: 7,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      hiddenLiquidity: true,
      offer: quote(one / 4n),
      request: base(one)
    });
    const recurringMarket = trade({
      tradeId: 5,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      recurringOrder: {
        orderId: 5,
        selectedSide: 'buy',
        mode: 'public',
        recurringStatus: 'active',
        baseAsset: base(),
        quoteAsset: quote(),
        buyTerms: { baseAmount: one.toString(), quoteAmount: (one / 5n).toString() },
        sellTerms: { baseAmount: one.toString(), quoteAmount: ((one * 3n) / 10n).toString() },
        publicBaseInventory: (one * 10n).toString(),
        publicQuoteInventory: (one * 3n).toString(),
        buySideOpen: true,
        sellSideOpen: true,
        hasPrivateBaseInventory: false,
        hasPrivateQuoteInventory: false,
        executionCount: 0
      }
    });

    const sellBaseQuote = quoteBestSingleOtcSwap({
      includePrivateOtcQuotes: true,
      trades: [recurringMarket, oneOffBid],
      sellToken: base(),
      buyToken: quote(),
      inputMode: 'sell',
      inputAmountWei: one
    });
    const buyBaseQuote = quoteBestSingleOtcSwap({
      includePrivateOtcQuotes: true,
      trades: [recurringMarket, oneOffBid],
      sellToken: quote(),
      buyToken: base(),
      inputMode: 'buy',
      inputAmountWei: one
    });

    expect(sellBaseQuote.best).toMatchObject({ tradeId: 7, sourceType: 'standard' });
    expect(sellBaseQuote.best?.estimatedBuyAmountWei).toBe(one / 4n);
    expect(buyBaseQuote.best).toMatchObject({ tradeId: 5, sourceType: 'recurring', recurringSide: 'sell' });
    expect(buyBaseQuote.best?.estimatedSellAmountWei).toBe((one * 3n) / 10n);
  });

  const recurringQuoteCases: Array<[OtcSwapInputMode, 'buy' | 'sell', 'buy' | 'sell', string, string]> = [
    ['sell', 'buy', 'sell', 'WISP', 'COTI'],
    ['buy', 'sell', 'buy', 'COTI', 'WISP']
  ];

  it.each(recurringQuoteCases)('quotes recurring orders for %s input using the matching terminal side', (inputMode, fillSide, displayAction, sellSymbol, buySymbol) => {
    const recurringTrade = trade({
      tradeId: 5,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      recurringOrder: {
        orderId: 5,
        selectedSide: 'buy',
        mode: 'public',
        recurringStatus: 'active',
        baseAsset: asset('WISP', '1000000'),
        quoteAsset: asset('COTI', '1000000000000000000', 18),
        buyTerms: { baseAmount: '1000000', quoteAmount: '1000000000000000000' },
        sellTerms: { baseAmount: '1000000', quoteAmount: '1200000000000000000' },
        publicBaseInventory: '5000000',
        publicQuoteInventory: '6000000000000000000',
        buySideOpen: true,
        sellSideOpen: true,
        hasPrivateBaseInventory: false,
        hasPrivateQuoteInventory: false,
        executionCount: 0
      }
    });
    const sell = sellSymbol === 'WISP' ? recurringTrade.recurringOrder!.baseAsset : recurringTrade.recurringOrder!.quoteAsset;
    const buy = buySymbol === 'WISP' ? recurringTrade.recurringOrder!.baseAsset : recurringTrade.recurringOrder!.quoteAsset;

    const quote = quoteBestSingleOtcSwap({
      trades: [recurringTrade],
      sellToken: sell,
      buyToken: buy,
      inputMode,
      inputAmountWei: inputMode === 'sell' ? 1_000_000n : 1_000_000_000_000_000_000n
    });

    expect(quote.best).toMatchObject({
      sourceType: 'recurring',
      recurringSide: fillSide,
      terminalPrefill: {
        kind: 'recurring',
        displayAction,
        fillSide
      }
    });
  });

  it('marks private recurring liquidity as terminal-checked while preserving price estimates', () => {
    const recurringTrade = trade({
      tradeId: 8,
      escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
      recurringOrder: {
        orderId: 8,
        selectedSide: 'buy',
        mode: 'fully-private',
        recurringStatus: 'active',
        baseAsset: asset('p.WISP', '1000000', 6, '0xabc0000000000000000000000000000000000000'),
        quoteAsset: asset('HOTDOG', '1000000000', 6, '0xdef0000000000000000000000000000000000000'),
        buyTerms: { baseAmount: '1000000', quoteAmount: '8000000' },
        sellTerms: { baseAmount: '1000000', quoteAmount: '10000000' },
        publicBaseInventory: '0',
        publicQuoteInventory: '0',
        buySideOpen: true,
        sellSideOpen: true,
        hasPrivateBaseInventory: true,
        hasPrivateQuoteInventory: true,
        executionCount: 0
      }
    });

    const quote = quoteBestSingleOtcSwap({
      trades: [recurringTrade],
      sellToken: recurringTrade.recurringOrder!.baseAsset,
      buyToken: recurringTrade.recurringOrder!.quoteAsset,
      inputMode: 'sell',
      inputAmountWei: 1_000_000n
    });

    expect(quote.best?.availability).toEqual({ kind: 'terminal' });
    expect(quote.best?.estimatedBuyAmountWei).toBe(8_000_000n);
    expect(quote.best?.complete).toBe(false);
  });
});
