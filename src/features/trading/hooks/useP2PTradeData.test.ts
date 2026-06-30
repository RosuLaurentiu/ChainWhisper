import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import { ZERO_TRADE_TAKER_ADDRESS } from '../../../lib/tradePerspective';
import {
  __detailSnapshotMatchesRouteForTest,
  __mergePublicTradeRefreshForTest,
  __mergeTradeSnapshotEnrichmentForTest,
  __stripWalletScopedTradeSnapshotForTest
} from './useP2PTradeData';

const maker = '0x1111111111111111111111111111111111111111';
const filler = '0x2222222222222222222222222222222222222222';
const otherFiller = '0x3333333333333333333333333333333333333333';

const asset = (symbol: string, amount = '1000000'): TradeAssetPayload => ({
  kind: symbol.startsWith('p') ? 'private-erc20' : 'erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 6,
  amount
});

const standardTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: 1,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker: ZERO_TRADE_TAKER_ADDRESS,
  offer: asset('pAAA'),
  request: asset('BBB'),
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  hiddenLiquidity: true,
  ...overrides
});

const recurringTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: 3,
  escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
  maker,
  taker: ZERO_TRADE_TAKER_ADDRESS,
  offer: asset('pAAA'),
  request: asset('BBB'),
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  hiddenLiquidity: true,
  recurringOrder: {
    orderId: 3,
    selectedSide: 'sell',
    mode: 'hybrid-private',
    recurringStatus: 'active',
    baseAsset: asset('pAAA'),
    quoteAsset: asset('BBB'),
    buyTerms: { baseAmount: '1000000', quoteAmount: '2000000' },
    sellTerms: { baseAmount: '1000000', quoteAmount: '2500000' },
    publicBaseInventory: '0',
    publicQuoteInventory: '0',
    buySideOpen: true,
    sellSideOpen: true,
    hasPrivateBaseInventory: true,
    hasPrivateQuoteInventory: false,
    executionCount: 1
  },
  ...overrides
});

describe('__mergeTradeSnapshotEnrichmentForTest', () => {
  it('recognizes a clicked desk snapshot as the active terminal route', () => {
    const snapshot = recurringTrade({ tradeId: 7 });

    expect(__detailSnapshotMatchesRouteForTest(snapshot, 7, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(true);
    expect(__detailSnapshotMatchesRouteForTest(snapshot, 8, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(false);
    expect(__detailSnapshotMatchesRouteForTest(snapshot, 7, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(false);
  });

  it('keeps revealed one-off private receipts when a lighter refresh arrives', () => {
    const existing = standardTrade({
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xaaa'
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({ privateFillReceipts: undefined, walletHasFill: false });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.privateFillReceipts).toHaveLength(1);
    expect(merged.walletHasFill).toBe(true);
  });

  it('does not preserve one-off private reveal data after wallet-switch stripping', () => {
    const existing = standardTrade({
      makerPrivateProgress: {
        initialOfferAmount: '10000000',
        remainingOfferAmount: '9000000'
      },
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xaaa'
        }
      ],
      walletFillState: {
        offerAmountReceived: '1000000',
        requestAmountPaid: '2500000'
      },
      walletHasFill: true
    });
    const incoming = standardTrade({
      makerPrivateProgress: undefined,
      privateFillReceipts: undefined,
      walletFillState: undefined,
      walletHasFill: false
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(
      incoming,
      __stripWalletScopedTradeSnapshotForTest(existing),
      otherFiller
    );

    expect(merged.makerPrivateProgress).toBeUndefined();
    expect(merged.privateFillReceipts).toBeUndefined();
    expect(merged.walletFillState).toBeUndefined();
    expect(merged.walletHasFill).toBeUndefined();
  });

  it('preserves current-wallet indexed fill details when a lighter refresh arrives', () => {
    const existing = standardTrade({
      walletFillState: {
        offerAmountReceived: '1000000',
        requestAmountPaid: '2500000'
      },
      walletHasFill: true
    });
    const incoming = standardTrade({
      walletFillState: undefined,
      walletHasFill: false
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.walletFillState).toEqual({
      offerAmountReceived: '1000000',
      requestAmountPaid: '2500000'
    });
    expect(merged.walletHasFill).toBe(true);
  });

  it('preserves only the current filler receipts when a lighter one-off refresh arrives', () => {
    const existing = standardTrade({
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xaaa'
        },
        {
          fillIndex: 2,
          filler: otherFiller,
          offerAmount: '2000000',
          requestAmount: '5000000',
          txHash: '0xbbb'
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({ privateFillReceipts: undefined, walletHasFill: false });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, otherFiller);

    expect(merged.privateFillReceipts).toEqual([
      expect.objectContaining({
        fillIndex: 2,
        filler: otherFiller
      })
    ]);
    expect(merged.walletHasFill).toBe(true);
  });

  it('keeps the current public desk when a silent refresh returns a transient empty result', () => {
    const existing = [
      standardTrade({ tradeId: 4, createdAt: 4 }),
      recurringTrade({ tradeId: 2, createdAt: 2 })
    ];

    const merged = __mergePublicTradeRefreshForTest([], existing, true);

    expect(merged).toBe(existing);
  });

  it('allows an explicit public desk refresh to accept an empty result after retry attempts', () => {
    const existing = [standardTrade({ tradeId: 4, createdAt: 4 })];

    const merged = __mergePublicTradeRefreshForTest([], existing, false);

    expect(merged).toEqual([]);
  });

  it('keeps recurring execution history when a lighter refresh arrives', () => {
    const existing = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: [
          {
            fillIndex: 1,
            side: 'sell',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2500000',
            txHash: '0xbbb'
          }
        ],
        makerPrivateInventory: {
          baseInventory: '9000000'
        }
      }
    });
    const incoming = recurringTrade({
      walletHasFill: false,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: []
      }
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, maker);

    expect(merged.walletHasFill).toBe(true);
    expect(merged.recurringOrder?.privateExecutions).toHaveLength(1);
    expect(merged.recurringOrder?.makerPrivateInventory?.baseInventory).toBe('9000000');
  });

  it('preserves only current-wallet recurring history when a lighter refresh arrives', () => {
    const existing = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: [
          {
            fillIndex: 1,
            side: 'sell',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2500000',
            txHash: '0xaaa'
          },
          {
            fillIndex: 2,
            side: 'buy',
            filler: otherFiller,
            baseAmount: '2000000',
            quoteAmount: '4000000',
            txHash: '0xbbb'
          }
        ],
        publicExecutions: [
          {
            fillIndex: 3,
            side: 'sell',
            filler,
            baseAmount: '3000000',
            quoteAmount: '7500000',
            txHash: '0xccc'
          },
          {
            fillIndex: 4,
            side: 'buy',
            filler: otherFiller,
            baseAmount: '4000000',
            quoteAmount: '8000000',
            txHash: '0xddd'
          }
        ],
        makerPrivateInventory: {
          baseInventory: '9000000',
          quoteInventory: '5000000'
        }
      }
    });
    const incoming = recurringTrade({
      walletHasFill: false,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: [],
        publicExecutions: []
      }
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, otherFiller);

    expect(merged.walletHasFill).toBe(true);
    expect(merged.recurringOrder?.makerPrivateInventory).toBeUndefined();
    expect(merged.recurringOrder?.privateExecutions).toEqual([
      expect.objectContaining({
        fillIndex: 2,
        filler: otherFiller
      })
    ]);
    expect(merged.recurringOrder?.publicExecutions).toEqual([
      expect.objectContaining({
        fillIndex: 4,
        filler: otherFiller
      })
    ]);
  });

  it('strips wallet-scoped private reveal data before a wallet switch can reuse it', () => {
    const stripped = __stripWalletScopedTradeSnapshotForTest(
      recurringTrade({
        walletFillState: {
          offerAmountReceived: '1000000',
          requestAmountPaid: '2500000'
        },
        walletHasFill: true,
        makerPrivateProgress: {
          initialOfferAmount: '10000000',
          remainingOfferAmount: '9000000'
        },
        privateFillReceipts: [
          {
            fillIndex: 1,
            filler,
            offerAmount: '1000000',
            requestAmount: '2500000'
          }
        ],
        recurringOrder: {
          ...recurringTrade().recurringOrder!,
          makerPrivateInventory: {
            baseInventory: '9000000'
          },
          privateExecutions: [
            {
              fillIndex: 1,
              side: 'sell',
              filler,
              baseAmount: '1000000',
              quoteAmount: '2500000'
            }
          ],
          publicExecutions: [
            {
              fillIndex: 2,
              side: 'buy',
              filler,
              baseAmount: '1000000',
              quoteAmount: '2000000'
            }
          ]
        }
      })
    );

    expect(stripped.walletHasFill).toBeUndefined();
    expect(stripped.walletFillState).toBeUndefined();
    expect(stripped.makerPrivateProgress).toBeUndefined();
    expect(stripped.privateFillReceipts).toBeUndefined();
    expect(stripped.recurringOrder?.makerPrivateInventory).toBeUndefined();
    expect(stripped.recurringOrder?.privateExecutions).toBeUndefined();
    expect(stripped.recurringOrder?.publicExecutions).toBeUndefined();
  });

  it('strips hydrated Direct trade amounts when switching wallets', () => {
    const stripped = __stripWalletScopedTradeSnapshotForTest(
      standardTrade({
        escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
        offer: asset('pWISP', '1200000'),
        request: asset('HOTDOG', '2400000'),
        fillState: {
          filledOfferAmount: '0',
          filledRequestAmount: '0',
          remainingOfferAmount: '1200000',
          remainingRequestAmount: '2400000'
        },
        hiddenLiquidity: false
      })
    );

    expect(stripped.offer.amount).toBe('0');
    expect(stripped.request.amount).toBe('0');
    expect(stripped.fillState).toBeUndefined();
    expect(stripped.hiddenLiquidity).toBe(true);
  });
});
