import { describe, expect, it } from 'vitest';
import {
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { buildTradeLifecycleHistoryRows, buildTradeTransactionHistoryRows } from './tradeHistory';
import { ZERO_TRADE_TAKER_ADDRESS } from './tradePerspective';

const maker = '0x1111111111111111111111111111111111111111';
const taker = '0x2222222222222222222222222222222222222222';
const filler = '0x3333333333333333333333333333333333333333';

const asset = (symbol: string, amount = '1000000'): TradeAssetPayload => ({
  kind: symbol.startsWith('p') ? 'private-erc20' : 'erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 6,
  amount
});

const trade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: 1,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker,
  offer: asset('AAA'),
  request: asset('BBB'),
  createdAt: 1,
  expiresAt: 0,
  status: 'accepted',
  ...overrides
});

describe('buildTradeTransactionHistoryRows', () => {
  it('builds visible taker buy/sell history with counterparty identity', () => {
    const [row] = buildTradeTransactionHistoryRows(
      [
        trade({
          acceptedTxHash: '0xabc',
          walletFillState: {
            offerAmountReceived: '700000',
            requestAmountPaid: '1400000'
          }
        })
      ],
      taker
    );

    expect(row).toMatchObject({
      contractAddress: TRADE_ESCROW_CONTRACT_ADDRESS,
      localId: 1,
      role: 'taker',
      sourceKind: 'standard',
      counterparty: maker,
      amountVisibility: 'public',
      txHash: '0xabc'
    });
    expect(row.bought).toMatchObject({ symbol: 'AAA', amount: '700000', visible: true });
    expect(row.sold).toMatchObject({ symbol: 'BBB', amount: '1400000', visible: true });
    expect(row.tokenFlows.map((flow) => `${flow.asset.symbol}:${flow.action}`)).toEqual(['AAA:bought', 'BBB:sold']);
    expect(row.timestamp).toBeUndefined();
  });

  it('uses private receipts so makers can see who filled hidden orders after reveal', () => {
    const [row] = buildTradeTransactionHistoryRows(
      [
        trade({
          taker: ZERO_TRADE_TAKER_ADDRESS,
          hiddenLiquidity: true,
          offer: asset('pAAA'),
          request: asset('pBBB'),
          privateFillReceipts: [
            {
              fillIndex: 1,
              filler,
              offerAmount: '500000',
              requestAmount: '1000000',
              remainingOfferAmount: '500000',
              txHash: '0xdef',
              blockNumber: 123
            }
          ]
        })
      ],
      maker
    );

    expect(row).toMatchObject({
      role: 'maker',
      sourceKind: 'private',
      counterparty: filler,
      amountVisibility: 'private-revealed',
      blockNumber: 123,
      sequence: 1
    });
    expect(row.bought).toMatchObject({ symbol: 'pBBB', amount: '1000000', visible: true });
    expect(row.sold).toMatchObject({ symbol: 'pAAA', amount: '500000', visible: true });
    expect(row.tokenFlows.map((flow) => `${flow.asset.symbol}:${flow.action}`)).toEqual(['pAAA:sold', 'pBBB:bought']);
    expect(row.timestamp).toBeUndefined();
  });

  it('keeps private recurring history amount-hidden until wallet receipts reveal amounts', () => {
    const [row] = buildTradeTransactionHistoryRows(
      [
        trade({
          tradeId: 7,
          taker: ZERO_TRADE_TAKER_ADDRESS,
          recurringOrder: {
            orderId: 7,
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
            executionCount: 1,
            privateExecutions: [
              {
                fillIndex: 1,
                side: 'sell',
                filler,
                txHash: '0xfeed'
              }
            ]
          }
        })
      ],
      filler
    );

    expect(row).toMatchObject({
      role: 'filler',
      sourceKind: 'recurring',
      counterparty: maker,
      amountVisibility: 'private-hidden',
      sequence: 1
    });
    expect(row.bought.visible).toBe(false);
    expect(row.sold.visible).toBe(false);
    expect(row.tokenFlows.map((flow) => `${flow.asset.symbol}:${flow.action}`)).toEqual(['pAAA:bought', 'BBB:sold']);
    expect(row.timestamp).toBeUndefined();
  });

  it('shows wallet-filtered public recurring executions even while the order stays active', () => {
    const [row] = buildTradeTransactionHistoryRows(
      [
        trade({
          tradeId: 3,
          taker: ZERO_TRADE_TAKER_ADDRESS,
          status: 'open',
          recurringOrder: {
            orderId: 3,
            selectedSide: 'sell',
            mode: 'public',
            recurringStatus: 'active',
            baseAsset: asset('AAA'),
            quoteAsset: asset('BBB'),
            buyTerms: { baseAmount: '1000000', quoteAmount: '2000000' },
            sellTerms: { baseAmount: '1000000', quoteAmount: '2500000' },
            publicBaseInventory: '10000000',
            publicQuoteInventory: '20000000',
            buySideOpen: true,
            sellSideOpen: true,
            hasPrivateBaseInventory: false,
            hasPrivateQuoteInventory: false,
            executionCount: 1,
            publicExecutions: [
              {
                fillIndex: 1,
                side: 'buy',
                filler,
                baseAmount: '3000000',
                quoteAmount: '6000000',
                txHash: '0xbeef',
                blockNumber: 456
              }
            ]
          }
        })
      ],
      filler
    );

    expect(row).toMatchObject({
      role: 'filler',
      sourceKind: 'recurring',
      counterparty: maker,
      amountVisibility: 'public',
      txHash: '0xbeef',
      blockNumber: 456,
      sequence: 1
    });
    expect(row.bought).toMatchObject({ symbol: 'BBB', amount: '6000000', visible: true });
    expect(row.sold).toMatchObject({ symbol: 'AAA', amount: '3000000', visible: true });
    expect(row.timestamp).toBeUndefined();
  });

  it('keeps wallet fill history visible while a public offer remains active', () => {
    const [row] = buildTradeTransactionHistoryRows(
      [
        trade({
          taker: ZERO_TRADE_TAKER_ADDRESS,
          status: 'open',
          fillState: {
            remainingOfferAmount: '300000',
            remainingRequestAmount: '600000',
            filledOfferAmount: '700000',
            filledRequestAmount: '1400000'
          },
          walletHasFill: true,
          walletFillState: {
            offerAmountReceived: '250000',
            requestAmountPaid: '500000'
          }
        })
      ],
      filler
    );

    expect(row).toMatchObject({
      role: 'filler',
      sourceKind: 'standard',
      counterparty: maker,
      amountVisibility: 'public'
    });
    expect(row.bought).toMatchObject({ symbol: 'AAA', amount: '250000', visible: true });
    expect(row.sold).toMatchObject({ symbol: 'BBB', amount: '500000', visible: true });
  });
});

describe('buildTradeLifecycleHistoryRows', () => {
  it('adds creation metadata for a standard offer', () => {
    const [row] = buildTradeLifecycleHistoryRows(trade({ tradeId: 4, createdAt: 123 }));

    expect(row).toMatchObject({
      localId: 4,
      sourceKind: 'standard',
      action: 'created',
      label: 'Created',
      detail: 'Offer #4 opened',
      actor: maker,
      timestamp: 123
    });
  });

  it('adds visible edit linkage for replacement offers', () => {
    const rows = buildTradeLifecycleHistoryRows(
      trade({
        tradeId: 5,
        replacesTradeId: 2,
        replacementTradeId: 8
      })
    );

    expect(rows.map((row) => `${row.action}:${row.detail}`)).toEqual([
      'created:Offer #5 opened',
      'edited:Replaces Offer #2',
      'replaced:Replaced by Offer #8'
    ]);
  });

  it('adds cancellation lifecycle rows where the snapshot exposes cancellation', () => {
    const standardRows = buildTradeLifecycleHistoryRows(trade({ status: 'cancelled' }));
    const recurringRows = buildTradeLifecycleHistoryRows(
      trade({
        tradeId: 7,
        recurringOrder: {
          orderId: 7,
          selectedSide: 'sell',
          mode: 'public',
          recurringStatus: 'cancelled',
          baseAsset: asset('AAA'),
          quoteAsset: asset('BBB'),
          buyTerms: { baseAmount: '1000000', quoteAmount: '2000000' },
          sellTerms: { baseAmount: '1000000', quoteAmount: '2500000' },
          publicBaseInventory: '0',
          publicQuoteInventory: '0',
          buySideOpen: false,
          sellSideOpen: false,
          hasPrivateBaseInventory: false,
          hasPrivateQuoteInventory: false,
          executionCount: 0
        }
      })
    );

    expect(standardRows[standardRows.length - 1]).toMatchObject({
      action: 'cancelled',
      label: 'Cancelled',
      detail: 'Offer #1 cancelled'
    });
    expect(recurringRows[recurringRows.length - 1]).toMatchObject({
      action: 'cancelled',
      label: 'Closed',
      detail: 'Order #7 closed'
    });
  });
});
