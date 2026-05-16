import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
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

  it('does not render zero-amount parent closure rows as fills', () => {
    const rows = buildTradeTransactionHistoryRows(
      [
        trade({
          tradeId: 1,
          status: 'cancelled',
          counterParentTradeId: 5,
          fillState: {
            remainingOfferAmount: '0',
            remainingRequestAmount: '0',
            filledOfferAmount: '0',
            filledRequestAmount: '0'
          }
        })
      ],
      maker
    );

    expect(rows).toEqual([]);
  });

  it('still uses original offer terms for accepted fills when no fill-state detail is indexed', () => {
    const [row] = buildTradeTransactionHistoryRows([trade({ fillState: undefined })], maker);

    expect(row.bought).toMatchObject({ symbol: 'BBB', amount: '1000000', visible: true });
    expect(row.sold).toMatchObject({ symbol: 'AAA', amount: '1000000', visible: true });
  });

  it('keeps accepted Direct counters in history even before private terms are revealed', () => {
    const rows = buildTradeTransactionHistoryRows(
      [
        trade({
          tradeId: 2,
          escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
          counterParentTradeId: 1,
          offer: asset('pAAA', '0'),
          request: asset('pBBB', '0'),
          fillState: {
            remainingOfferAmount: '0',
            remainingRequestAmount: '0',
            filledOfferAmount: '0',
            filledRequestAmount: '0'
          }
        })
      ],
      maker
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: 'maker',
      sourceKind: 'direct',
      amountVisibility: 'private-hidden'
    });
    expect(rows[0].bought).toMatchObject({ symbol: 'pBBB', visible: false });
    expect(rows[0].sold).toMatchObject({ symbol: 'pAAA', visible: false });
  });

  it('keeps accepted Direct transactions after private terms are revealed even with zero fill state', () => {
    const [row] = buildTradeTransactionHistoryRows(
      [
        trade({
          tradeId: 4,
          escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
          counterParentTradeId: 3,
          offer: asset('HOTDOG', '200000000'),
          request: asset('pWISP', '1000000'),
          fillState: {
            remainingOfferAmount: '0',
            remainingRequestAmount: '0',
            filledOfferAmount: '0',
            filledRequestAmount: '0'
          },
          acceptedTxHash: '0xaccepted'
        })
      ],
      maker
    );

    expect(row).toMatchObject({
      role: 'maker',
      sourceKind: 'direct',
      amountVisibility: 'private-revealed',
      txHash: '0xaccepted'
    });
    expect(row.bought).toMatchObject({ symbol: 'pWISP', amount: '1000000', visible: true });
    expect(row.sold).toMatchObject({ symbol: 'HOTDOG', amount: '200000000', visible: true });
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
      detail: 'P2P OTC #4 opened',
      actor: maker,
      timestamp: 123
    });
  });

  it('adds visible edit linkage for replacement offers', () => {
    const rows = buildTradeLifecycleHistoryRows(
      trade({
        tradeId: 5,
        status: 'open',
        replacesTradeId: 2,
        replacementTradeId: 8
      })
    );

    expect(rows.map((row) => `${row.action}:${row.detail}`)).toEqual([
      'created:P2P OTC #5 opened',
      'edited:Replaces P2P OTC #2',
      'replaced:Replaced by P2P OTC #8'
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
      detail: 'P2P OTC #1 cancelled'
    });
    expect(recurringRows[recurringRows.length - 1]).toMatchObject({
      action: 'cancelled',
      label: 'Closed',
      detail: 'Recurring OTC #7 closed'
    });
  });

  it('adds precise parent-counter lifecycle rows without implying a zero fill', () => {
    const rows = buildTradeLifecycleHistoryRows(
      trade({
        tradeId: 1,
        status: 'accepted',
        counterParentTradeId: 5,
        acceptedTxHash: '0xabc'
      })
    );

    expect(rows.map((row) => `${row.action}:${row.detail}`)).toEqual([
      'created:P2P OTC #1 opened',
      'accepted:P2P OTC #5 settled this parent offer'
    ]);
    expect(rows[1]).toMatchObject({
      label: 'Counter accepted',
      relatedTradeId: 5,
      txHash: '0xabc'
    });
  });

  it('adds an accepted lifecycle tx row for the accepted counter itself', () => {
    const rows = buildTradeLifecycleHistoryRows(
      trade({
        tradeId: 4,
        status: 'accepted',
        counterParentTradeId: 1,
        acceptedTxHash: '0xdef'
      })
    );

    expect(rows.map((row) => `${row.action}:${row.detail}`)).toEqual([
      'created:P2P OTC #4 opened',
      'accepted:P2P OTC #4 accepted as counter to P2P OTC #1'
    ]);
    expect(rows[1]).toMatchObject({
      label: 'Counter accepted',
      relatedTradeId: 1,
      txHash: '0xdef'
    });
  });
});
