import { describe, expect, it, vi } from 'vitest';
import {
  canEditPublicTrade,
  buildTradeAssetExplorerUrl,
  filterAndSortTradeDesk,
  getMakerPrivateProgressSummary,
  getRecurringTerminalSideState,
  getTradeCompletionSummary,
  getTradeDisplayTerms,
  getTradeTermsVisibility,
  hasHydratedDirectTradeTerms,
  getTradePairFilterOptions,
  isHiddenLiquidityTrade,
  loadStoredPrivateTradeLiquidity,
  loadStoredTradeAccessSecrets,
  matchesTradeSearch,
  shouldBlockFillAboveVisibleLiquidity,
  shouldRecoverMakerTradePayload,
  storePrivateTradeLiquidity,
  storeTradeAccessSecrets
} from './p2pTradeView';
import { DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, type TradeSnapshot } from './appShared';

const token = (symbol: string, amount: string, tokenAddress = `0x${symbol.padEnd(40, '1').slice(0, 40)}`) => ({
  amount,
  decimals: 6,
  kind: 'erc20' as const,
  symbol,
  tokenAddress
});

const baseTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot =>
  ({
    tradeId: 7,
    escrowContract: '0x1111111111111111111111111111111111111111',
    maker: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    taker: '0x0000000000000000000000000000000000000000',
    offer: token('WISP', '1000000'),
    request: token('COTI', '2000000', '0x2222222222222222222222222222222222222222'),
    createdAt: 1_700_000_000,
    expiresAt: 1_700_003_600,
    isPublic: true,
    status: 'open',
    ...overrides
  }) as TradeSnapshot;

describe('p2pTradeView helpers', () => {
  it('uses remaining amounts for partially filled open trades', () => {
    const trade = baseTrade({
      fillState: {
        filledOfferAmount: '250000',
        filledRequestAmount: '500000',
        remainingOfferAmount: '750000',
        remainingRequestAmount: '1500000'
      }
    });

    expect(getTradeDisplayTerms(trade)).toMatchObject({
      offer: { amount: '750000' },
      request: { amount: '1500000' },
      usingRemaining: true
    });
    expect(getTradeCompletionSummary(trade)).toMatchObject({
      percent: 25,
      percentLabel: '25% filled'
    });
  });

  it('keeps private liquidity amounts hidden from normal completion helpers', () => {
    const privateTrade = baseTrade({
      hiddenLiquidity: true,
      makerPrivateProgress: {
        filledOfferAmount: '250000',
        initialOfferAmount: '1000000',
        remainingOfferAmount: '750000'
      }
    });

    expect(getTradeCompletionSummary(privateTrade)).toBeNull();
    expect(getMakerPrivateProgressSummary(privateTrade)).toMatchObject({
      percent: 25,
      filledLabel: '0.25 WISP filled',
      remainingLabel: '0.75 WISP remaining',
      paymentAmountLabel: '2 COTI',
      paymentFilledAmountLabel: '0.5 COTI',
      paymentRemainingAmountLabel: '1.5 COTI'
    });
  });

  it('does not block hidden-liquidity fills by the public remaining amount', () => {
    const privateTrade = baseTrade({
      hiddenLiquidity: true,
      offer: token('HOTDOG', '1000000000'),
      request: token('pWISP', '20000000'),
      fillState: {
        filledOfferAmount: '0',
        filledRequestAmount: '0',
        remainingOfferAmount: '0',
        remainingRequestAmount: '0'
      }
    });
    const visibleTrade = baseTrade({
      fillState: {
        filledOfferAmount: '0',
        filledRequestAmount: '0',
        remainingOfferAmount: '1000000',
        remainingRequestAmount: '2000000'
      }
    });

    expect(shouldBlockFillAboveVisibleLiquidity(privateTrade, 21_000_000n)).toBe(false);
    expect(shouldBlockFillAboveVisibleLiquidity(visibleTrade, 2_000_001n)).toBe(true);
  });

  it('infers private maker fill progress from filled and remaining amounts', () => {
    const privateTrade = baseTrade({
      hiddenLiquidity: true,
      makerPrivateProgress: {
        filledOfferAmount: '7000',
        remainingOfferAmount: '993000'
      }
    });

    expect(getMakerPrivateProgressSummary(privateTrade)).toMatchObject({
      percent: 0.7,
      percentLabel: '0.7% filled',
      filledLabel: '0.007 WISP filled',
      remainingLabel: '0.993 WISP remaining',
      totalLabel: '1 WISP total',
      paymentAmountLabel: '2 COTI',
      paymentFilledAmountLabel: '0.014 COTI',
      paymentRemainingAmountLabel: '1.986 COTI'
    });
  });

  it('presents returned private liquidity as an unfilled cancelled order', () => {
    const cancelledPrivateTrade = baseTrade({
      hiddenLiquidity: true,
      status: 'cancelled',
      makerPrivateProgress: {
        filledOfferAmount: '1000000',
        initialOfferAmount: '1000000',
        remainingOfferAmount: '0'
      }
    });

    expect(getMakerPrivateProgressSummary(cancelledPrivateTrade)).toMatchObject({
      percent: 0,
      filledLabel: '0 WISP filled',
      remainingLabel: '0 WISP remaining',
      totalLabel: '1 WISP total',
      paymentAmountLabel: '2 COTI',
      paymentFilledAmountLabel: '0 COTI',
      paymentRemainingAmountLabel: '0 COTI',
      hasFills: false
    });
  });

  it('uses revealed private fill receipts for hidden payment progress when request terms are not public', () => {
    const acceptedPrivateTrade = baseTrade({
      hiddenLiquidity: true,
      status: 'accepted',
      offer: token('HOTDOG', '100000000'),
      request: token('pWISP', '0'),
      makerPrivateProgress: {
        filledOfferAmount: '100000000',
        initialOfferAmount: '100000000',
        remainingOfferAmount: '0'
      },
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          offerAmount: '100000000',
          requestAmount: '2000000'
        }
      ]
    });

    expect(getMakerPrivateProgressSummary(acceptedPrivateTrade)).toMatchObject({
      percent: 100,
      filledLabel: '100 HOTDOG filled',
      remainingLabel: '0 HOTDOG remaining',
      paymentAmountLabel: '2 pWISP',
      paymentFilledAmountLabel: '2 pWISP',
      paymentRemainingAmountLabel: '0 pWISP',
      hasFills: true
    });
  });

  it('treats Direct OTC counters as private terms instead of hidden liquidity', () => {
    const directCounter = baseTrade({
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      counterParentTradeId: 4,
      isPublic: false,
      hiddenLiquidity: true,
      offer: token('pWISP', '0'),
      request: token('HOTDOG', '0')
    });
    const hydratedDirectCounter = {
      ...directCounter,
      offer: token('pWISP', '1200000'),
      request: token('HOTDOG', '2400000')
    };
    const priceOnlyDirectCounter = {
      ...directCounter,
      offer: token('pWISP', '1200000'),
      request: token('HOTDOG', '0')
    };

    expect(getTradeTermsVisibility(directCounter)).toBe('direct-private-terms');
    expect(isHiddenLiquidityTrade(directCounter)).toBe(false);
    expect(hasHydratedDirectTradeTerms(directCounter)).toBe(false);
    expect(hasHydratedDirectTradeTerms(priceOnlyDirectCounter)).toBe(false);
    expect(hasHydratedDirectTradeTerms(hydratedDirectCounter)).toBe(true);
    expect(getTradeCompletionSummary(directCounter)).toBeNull();
    expect(getMakerPrivateProgressSummary(directCounter)).toBeNull();
  });

  it('still recovers maker payloads for unhydrated Direct trades even when the link secret is already known', () => {
    const maker = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const directCounter = baseTrade({
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      maker,
      taker: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      counterParentTradeId: 4,
      hasAccessHash: true,
      offer: token('pWISP', '0'),
      request: token('HOTDOG', '0')
    });
    const hydratedDirectCounter = {
      ...directCounter,
      offer: token('pWISP', '1200000'),
      request: token('HOTDOG', '2400000')
    };

    expect(shouldRecoverMakerTradePayload(directCounter, maker, true)).toBe(true);
    expect(shouldRecoverMakerTradePayload({ ...directCounter, hasAccessHash: false }, maker, false)).toBe(true);
    expect(shouldRecoverMakerTradePayload(hydratedDirectCounter, maker, true)).toBe(false);
    expect(shouldRecoverMakerTradePayload(directCounter, directCounter.taker, true)).toBe(false);
  });

  it('still recovers hidden maker payloads when known link secrets do not include private terms', () => {
    const maker = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hiddenTrade = baseTrade({
      hiddenLiquidity: true,
      maker,
      hasAccessHash: true,
      offer: token('pWISP', '10000000'),
      request: token('pCOTI', '0')
    });
    const hydratedHiddenTrade = {
      ...hiddenTrade,
      request: token('pCOTI', '5000000')
    };

    expect(shouldRecoverMakerTradePayload(hiddenTrade, maker, true)).toBe(true);
    expect(shouldRecoverMakerTradePayload(hydratedHiddenTrade, maker, true)).toBe(false);
  });

  it('matches search by trade identity and token fields', () => {
    const trade = baseTrade({ counterParentTradeId: 12 });

    expect(matchesTradeSearch(trade, 'wisp')).toBe(true);
    expect(matchesTradeSearch(trade, '12')).toBe(true);
    expect(matchesTradeSearch(trade, 'missing')).toBe(false);
  });

  it('builds Cotiscan token links through the indexed address page', () => {
    expect(buildTradeAssetExplorerUrl(token('HOTDOG', '1', '0x5085Ea0611A9C49316972C57390ca25C9CF236AB'))).toBe(
      'https://mainnet.cotiscan.io/address/0x5085Ea0611A9C49316972C57390ca25C9CF236AB'
    );
  });

  it('allows editing only unfilled open public maker trades', () => {
    const trade = baseTrade();

    expect(canEditPublicTrade(trade, trade.maker.toLowerCase())).toBe(true);
    expect(canEditPublicTrade({ ...trade, isPublic: false }, trade.maker.toLowerCase())).toBe(false);
    expect(
      canEditPublicTrade(
        {
          ...trade,
          fillState: {
            filledOfferAmount: '1',
            filledRequestAmount: '2',
            remainingOfferAmount: '999999',
            remainingRequestAmount: '1999998'
          }
        },
        trade.maker.toLowerCase()
      )
    ).toBe(false);
  });

  it('filters malformed browser-stored trade secrets and private liquidity', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      }
    });

    storage.set('coti-trade-access-secrets-v1', JSON.stringify({
      '7': `0x${'a'.repeat(64)}`,
      bad: `0x${'b'.repeat(64)}`,
      '0x1111111111111111111111111111111111111111:7': `0x${'c'.repeat(64)}`,
      '0x1111111111111111111111111111111111111111:8': 'nope'
    }));
    storage.set('coti-private-trade-liquidity-v1', JSON.stringify({
      '0x1111111111111111111111111111111111111111:9': '999'
    }));
    storePrivateTradeLiquidity(
      {
        '0x1111111111111111111111111111111111111111:7': '123:456',
        '0x1111111111111111111111111111111111111111:8': '0',
        '0x1111111111111111111111111111111111111111:9': '123:0',
        bad: '456'
      },
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );

    expect(loadStoredTradeAccessSecrets()).toEqual({
      '0x1111111111111111111111111111111111111111:7': `0x${'c'.repeat(64)}`
    });
    expect(storage.has('coti-trade-access-secrets-v1')).toBe(false);
    storeTradeAccessSecrets({
      '0x1111111111111111111111111111111111111111:7': `0x${'c'.repeat(64)}`
    });
    expect(storage.has('coti-trade-access-secrets-v1')).toBe(false);
    expect(loadStoredPrivateTradeLiquidity('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toEqual({
      '0x1111111111111111111111111111111111111111:7': '123:456'
    });
    expect(storage.has('coti-private-trade-liquidity-v1')).toBe(false);
    expect(loadStoredPrivateTradeLiquidity('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toEqual({});

    vi.unstubAllGlobals();
  });

  it('filters desk trades by pair, type, and access', () => {
    const recurring = baseTrade({
      tradeId: 9,
      offer: token('pWISP', '1000000'),
      request: token('COTI', '100'),
      recurringOrder: {
        orderId: 9,
        selectedSide: 'buy',
        mode: 'hybrid-private',
        recurringStatus: 'active',
        baseAsset: token('pWISP', '1000000'),
        quoteAsset: token('COTI', '100'),
        buyTerms: { baseAmount: '1000000', quoteAmount: '100' },
        sellTerms: { baseAmount: '1000000', quoteAmount: '120' },
        publicBaseInventory: '0',
        publicQuoteInventory: '100',
        buySideOpen: true,
        sellSideOpen: false,
        hasPrivateBaseInventory: true,
        hasPrivateQuoteInventory: false,
        executionCount: 2
      }
    });
    const direct = baseTrade({
      tradeId: 10,
      taker: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      offer: token('COTI', '100'),
      request: token('WISP', '1000000'),
      isPublic: false
    });
    const privateLink = baseTrade({ tradeId: 11, isPublic: false, hasAccessHash: true, hiddenLiquidity: true });
    const privateLinkVisibleTerms = baseTrade({ tradeId: 13, isPublic: false, hasAccessHash: true });
    const trades = [baseTrade(), recurring, direct, privateLink, privateLinkVisibleTerms];

    expect(getTradePairFilterOptions(trades).map((option) => option.label)).toEqual(['All pairs', 'pWISP/COTI', 'WISP/COTI']);
    expect(filterAndSortTradeDesk(trades, { type: 'recurring' })).toEqual([recurring]);
    expect(filterAndSortTradeDesk(trades, { type: 'private' }).map((trade) => trade.tradeId)).toEqual([11, 9]);
    expect(filterAndSortTradeDesk(trades, { type: 'private-liquidity' }).map((trade) => trade.tradeId)).toEqual([11, 9]);
    expect(filterAndSortTradeDesk(trades, { type: 'private-link' }).map((trade) => trade.tradeId)).toEqual([13, 11]);
    expect(filterAndSortTradeDesk(trades, { type: 'direct' })).toEqual([direct]);
    expect(filterAndSortTradeDesk([baseTrade({ tradeId: 12, counterParentTradeId: 4 }), ...trades], { type: 'counter' }).map((trade) => trade.tradeId)).toEqual([12]);
    expect(filterAndSortTradeDesk(trades, { access: 'direct' })).toEqual([direct]);
    expect(filterAndSortTradeDesk(trades, { access: 'private-link' }).map((trade) => trade.tradeId)).toEqual([13, 11]);
    expect(filterAndSortTradeDesk(trades, { pair: 'COTI/PWISP' })).toEqual([recurring]);
  });

  it('sorts desk trades by newest, oldest, expiring, and activity', () => {
    const old = baseTrade({ tradeId: 1, createdAt: 100, expiresAt: 900 });
    const newest = baseTrade({ tradeId: 2, createdAt: 300, expiresAt: 800 });
    const expiring = baseTrade({ tradeId: 3, createdAt: 200, expiresAt: 500 });
    const activeRecurring = baseTrade({
      tradeId: 4,
      createdAt: 150,
      expiresAt: 0,
      recurringOrder: {
        orderId: 4,
        selectedSide: 'sell',
        mode: 'public',
        recurringStatus: 'active',
        baseAsset: token('WISP', '1000000'),
        quoteAsset: token('COTI', '100'),
        buyTerms: { baseAmount: '1000000', quoteAmount: '100' },
        sellTerms: { baseAmount: '1000000', quoteAmount: '120' },
        publicBaseInventory: '1000000',
        publicQuoteInventory: '100',
        buySideOpen: true,
        sellSideOpen: true,
        hasPrivateBaseInventory: false,
        hasPrivateQuoteInventory: false,
        executionCount: 4
      }
    });
    const trades = [old, newest, expiring, activeRecurring];

    expect(filterAndSortTradeDesk(trades, { sort: 'newest' }).map((trade) => trade.tradeId)).toEqual([2, 3, 4, 1]);
    expect(filterAndSortTradeDesk(trades, { sort: 'oldest' }).map((trade) => trade.tradeId)).toEqual([1, 4, 3, 2]);
    expect(filterAndSortTradeDesk(trades, { sort: 'expiring' }).map((trade) => trade.tradeId)).toEqual([3, 2, 1, 4]);
    expect(filterAndSortTradeDesk(trades, { sort: 'most-active' }).map((trade) => trade.tradeId)[0]).toBe(4);
  });

  it('derives recurring terminal side availability from buy and sell inventory', () => {
    const recurring = baseTrade({
      recurringOrder: {
        orderId: 7,
        selectedSide: 'buy',
        mode: 'public',
        recurringStatus: 'active',
        baseAsset: token('WISP', '1000000'),
        quoteAsset: token('COTI', '100'),
        buyTerms: { baseAmount: '1000000', quoteAmount: '100' },
        sellTerms: { baseAmount: '1000000', quoteAmount: '120' },
        publicBaseInventory: '0',
        publicQuoteInventory: '100',
        buySideOpen: true,
        sellSideOpen: false,
        hasPrivateBaseInventory: false,
        hasPrivateQuoteInventory: false,
        executionCount: 0
      }
    });

    expect(getRecurringTerminalSideState(recurring, 'sell')).toMatchObject({
      isOpen: true,
      actionLabel: 'Sell WISP'
    });
    expect(getRecurringTerminalSideState(recurring, 'buy')).toMatchObject({
      isOpen: false,
      disabledLabel: 'No sell liquidity'
    });
  });
});
