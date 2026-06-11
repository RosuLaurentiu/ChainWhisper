import { describe, expect, it } from 'vitest';
import type { TradeAssetPayload, TradeSnapshot } from './appShared';
import {
  formatTradeRatioLabel,
  groupWalletTradesByPerspective,
  hasPartialTradeFill,
  resolveRecurringPriceDeskDisplay,
  resolveTradePriceRatioDisplay,
  resolveTradeOrderSummary,
  resolveTradePerspective,
  ZERO_TRADE_TAKER_ADDRESS
} from './tradePerspective';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';

const asset = (symbol: string): TradeAssetPayload => ({
  kind: 'erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 18,
  amount: '1000000000000000000'
});

const trade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: overrides.tradeId ?? 1,
  maker,
  taker,
  offer: asset('AAA'),
  request: asset('BBB'),
  createdAt: 1,
  expiresAt: 2,
  status: 'open',
  ...overrides
});

describe('resolveTradePerspective', () => {
  it('labels maker perspective as send offer and receive request', () => {
    const perspective = resolveTradePerspective(trade(), maker);
    expect(perspective.role).toBe('maker');
    expect(perspective.offerSide).toMatchObject({ label: 'You send', tone: 'send' });
    expect(perspective.requestSide).toMatchObject({ label: 'You receive', tone: 'receive' });
  });

  it('labels taker perspective as send request and receive offer', () => {
    const perspective = resolveTradePerspective(trade(), taker);
    expect(perspective.role).toBe('taker');
    expect(perspective.offerSide).toMatchObject({ label: 'You receive', tone: 'receive' });
    expect(perspective.requestSide).toMatchObject({ label: 'You send', tone: 'send' });
    expect(perspective.needsAction).toBe(true);
  });

  it('allows any connected non-maker wallet to view an open public trade as taker', () => {
    const perspective = resolveTradePerspective(trade({ taker: ZERO_TRADE_TAKER_ADDRESS }), other);
    expect(perspective.role).toBe('open-taker');
    expect(perspective.canAccept).toBe(true);
    expect(perspective.requestSide).toMatchObject({ label: 'You send', tone: 'send' });
  });

  it('labels maker terms when no wallet role is known', () => {
    const perspective = resolveTradePerspective(trade(), '');
    expect(perspective.role).toBe('unknown');
    expect(perspective.offerSide).toMatchObject({ label: 'Maker sends', tone: 'send' });
    expect(perspective.requestSide).toMatchObject({ label: 'Maker wants', tone: 'receive' });
  });
});

describe('groupWalletTradesByPerspective', () => {
  it('groups wallet trades by action, active offers, and history', () => {
    const needsAction = trade({ tradeId: 1, taker });
    const myActiveOffer = trade({ tradeId: 2, maker: taker, taker: ZERO_TRADE_TAKER_ADDRESS });
    const history = trade({ tradeId: 3, maker: taker, status: 'accepted' });

    expect(groupWalletTradesByPerspective([needsAction, myActiveOffer, history], taker)).toEqual({
      needsAction: [needsAction],
      myActiveOffers: [myActiveOffer],
      history: [history]
    });
  });

  it('keeps partially filled maker trades active without duplicating them in history', () => {
    const partialMakerTrade = trade({
      tradeId: 4,
      maker: taker,
      taker: ZERO_TRADE_TAKER_ADDRESS,
      fillState: {
        remainingOfferAmount: '500000000000000000',
        remainingRequestAmount: '500000000000000000',
        filledOfferAmount: '500000000000000000',
        filledRequestAmount: '500000000000000000'
      }
    });

    expect(hasPartialTradeFill(partialMakerTrade)).toBe(true);
    expect(groupWalletTradesByPerspective([partialMakerTrade], taker)).toEqual({
      needsAction: [],
      myActiveOffers: [partialMakerTrade],
      history: []
    });
  });

  it('shows wallet-scoped public partial fills in history even before the trade is fully filled', () => {
    const fillerPartialTrade = trade({
      tradeId: 5,
      maker,
      taker: ZERO_TRADE_TAKER_ADDRESS,
      fillState: {
        remainingOfferAmount: '750000000000000000',
        remainingRequestAmount: '750000000000000000',
        filledOfferAmount: '250000000000000000',
        filledRequestAmount: '250000000000000000'
      }
    });

    expect(groupWalletTradesByPerspective([fillerPartialTrade], taker)).toEqual({
      needsAction: [],
      myActiveOffers: [],
      history: [fillerPartialTrade]
    });
  });

  it('shows filler-indexed hidden orders in wallet history even while open', () => {
    const privateFillTrade = trade({
      tradeId: 6,
      maker,
      taker: ZERO_TRADE_TAKER_ADDRESS,
      hiddenLiquidity: true,
      walletHasFill: true
    });

    expect(groupWalletTradesByPerspective([privateFillTrade], taker)).toEqual({
      needsAction: [],
      myActiveOffers: [],
      history: [privateFillTrade]
    });
  });

  it('shows Direct counters addressed to the wallet as received offers', () => {
    const directCounter = trade({
      tradeId: 8,
      maker,
      taker,
      escrowContract: '0x9999999999999999999999999999999999999999',
      counterParentTradeId: 3,
      counterParentEscrow: '0x8888888888888888888888888888888888888888',
      isPublic: false
    });

    expect(groupWalletTradesByPerspective([directCounter], taker)).toEqual({
      needsAction: [directCounter],
      myActiveOffers: [],
      history: []
    });
  });

  it('keeps active maker recurring orders out of history even once they have executions', () => {
    const makerRecurringTrade = trade({
      tradeId: 7,
      maker: taker,
      taker: ZERO_TRADE_TAKER_ADDRESS,
      recurringOrder: {
        orderId: 7,
        selectedSide: 'sell',
        mode: 'hybrid-private',
        recurringStatus: 'active',
        baseAsset: asset('AAA'),
        quoteAsset: asset('BBB'),
        buyTerms: { baseAmount: '1000000000000000000', quoteAmount: '1000000000000000000' },
        sellTerms: { baseAmount: '1000000000000000000', quoteAmount: '1000000000000000000' },
        publicBaseInventory: '0',
        publicQuoteInventory: '0',
        buySideOpen: true,
        sellSideOpen: true,
        hasPrivateBaseInventory: true,
        hasPrivateQuoteInventory: false,
        executionCount: 2
      }
    });

    expect(groupWalletTradesByPerspective([makerRecurringTrade], taker)).toEqual({
      needsAction: [],
      myActiveOffers: [makerRecurringTrade],
      history: []
    });
  });

  it('moves inactive maker recurring orders into history', () => {
    const inactiveRecurringTrade = trade({
      tradeId: 9,
      maker: taker,
      taker: ZERO_TRADE_TAKER_ADDRESS,
      recurringOrder: {
        orderId: 9,
        selectedSide: 'sell',
        mode: 'hybrid-private',
        recurringStatus: 'cancelled',
        baseAsset: asset('AAA'),
        quoteAsset: asset('BBB'),
        buyTerms: { baseAmount: '1000000000000000000', quoteAmount: '1000000000000000000' },
        sellTerms: { baseAmount: '1000000000000000000', quoteAmount: '1000000000000000000' },
        publicBaseInventory: '0',
        publicQuoteInventory: '0',
        buySideOpen: false,
        sellSideOpen: false,
        hasPrivateBaseInventory: false,
        hasPrivateQuoteInventory: false,
        executionCount: 2
      }
    });

    expect(groupWalletTradesByPerspective([inactiveRecurringTrade], taker)).toEqual({
      needsAction: [],
      myActiveOffers: [],
      history: [inactiveRecurringTrade]
    });
  });
});

describe('resolveTradeOrderSummary', () => {
  it('describes the maker view as a sell order', () => {
    const summary = resolveTradeOrderSummary(trade(), maker);
    expect(summary.actionLabel).toBe('Sell AAA');
    expect(summary.directionLabel).toBe('Sell AAA for BBB');
    expect(summary.primarySide).toMatchObject({ label: 'You sell', role: 'offer', tone: 'send' });
    expect(summary.secondarySide).toMatchObject({ label: 'You buy', role: 'payment', tone: 'receive' });
    expect(summary.ratioLabel).toBe('1 BBB/AAA');
  });

  it('describes the taker view as a buy order with payment first', () => {
    const summary = resolveTradeOrderSummary(trade({ taker: ZERO_TRADE_TAKER_ADDRESS }), other);
    expect(summary.actionLabel).toBe('Buy AAA');
    expect(summary.directionLabel).toBe('Buy AAA with BBB');
    expect(summary.primarySide).toMatchObject({ label: 'You sell', role: 'payment', tone: 'send' });
    expect(summary.secondarySide).toMatchObject({ label: 'You buy', role: 'offer', tone: 'receive' });
  });

  it('formats reversible ratios without exposing totals', () => {
    const base = asset('AAA');
    const quote = { ...asset('BBB'), amount: '2500000000000000000' };
    expect(formatTradeRatioLabel(base, quote)).toBe('2.5 BBB/AAA');
    expect(formatTradeRatioLabel(quote, base)).toBe('0.4 AAA/BBB');
  });
});

describe('price display helpers', () => {
  it('defaults one-off ratios to the smaller displayed ratio', () => {
    const base = asset('AAA');
    const quote = { ...asset('BBB'), amount: '2500000000000000000' };

    const display = resolveTradePriceRatioDisplay({ baseAsset: base, quoteAsset: quote });

    expect(display).toMatchObject({
      label: '0.4 AAA/BBB',
      basisLabel: 'AAA/BBB',
      nextBasisLabel: 'BBB/AAA',
      isReversed: true
    });
  });

  it('toggles one-off ratios back to the inverse basis', () => {
    const base = asset('AAA');
    const quote = { ...asset('BBB'), amount: '2500000000000000000' };

    const display = resolveTradePriceRatioDisplay({ baseAsset: base, quoteAsset: quote, toggleInverse: true });

    expect(display).toMatchObject({
      label: '2.5 BBB/AAA',
      basisLabel: 'BBB/AAA',
      nextBasisLabel: 'AAA/BBB',
      isReversed: false
    });
  });

  it('shows recurring forward prices as buy and sell for the base asset', () => {
    const display = resolveRecurringPriceDeskDisplay({
      terms: {
        baseAsset: { ...asset('AAA'), amount: '10000000000000000000' },
        quoteAsset: asset('BBB'),
        buyTerms: {
          baseAmount: '10000000000000000000',
          quoteAmount: '1000000000000000000'
        },
        sellTerms: {
          baseAmount: '10000000000000000000',
          quoteAmount: '2000000000000000000'
        }
      }
    });

    expect(display).toMatchObject({
      basisLabel: 'BBB/AAA',
      displayBuySide: { label: 'Buy AAA', priceLabel: '0.1 BBB/AAA' },
      displaySellSide: { label: 'Sell AAA', priceLabel: '0.2 BBB/AAA' },
      makerBuySide: { label: 'Buy AAA', priceLabel: '0.1 BBB/AAA' },
      makerSellSide: { label: 'Sell AAA', priceLabel: '0.2 BBB/AAA' }
    });
  });

  it('shows recurring inverse prices as buy and sell for the quote asset with a valid spread', () => {
    const display = resolveRecurringPriceDeskDisplay({
      terms: {
        baseAsset: { ...asset('AAA'), amount: '10000000000000000000' },
        quoteAsset: asset('BBB'),
        buyTerms: {
          baseAmount: '10000000000000000000',
          quoteAmount: '1000000000000000000'
        },
        sellTerms: {
          baseAmount: '10000000000000000000',
          quoteAmount: '2000000000000000000'
        }
      },
      toggleInverse: true
    });

    const buyPrice = Number(display.displayBuySide.priceLabel.match(/\d+(?:\.\d+)?/)?.[0] ?? 'NaN');
    const sellPrice = Number(display.displaySellSide.priceLabel.match(/\d+(?:\.\d+)?/)?.[0] ?? 'NaN');

    expect(display).toMatchObject({
      basisLabel: 'AAA/BBB',
      displayBuySide: { label: 'Sell AAA', priceLabel: '5 AAA/BBB' },
      displaySellSide: { label: 'Buy AAA', priceLabel: '10 AAA/BBB' },
      makerBuySide: { label: 'Buy AAA', priceLabel: '10 AAA/BBB' },
      makerSellSide: { label: 'Sell AAA', priceLabel: '5 AAA/BBB' }
    });
    expect(buyPrice).toBeLessThanOrEqual(sellPrice);
  });
});
