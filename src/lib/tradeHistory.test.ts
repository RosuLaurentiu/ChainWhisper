import { describe, expect, it } from 'vitest';
import {
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from './appShared';
import { buildTradeTransactionHistoryRows } from './tradeHistory';
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
      blockNumber: 123
    });
    expect(row.bought).toMatchObject({ symbol: 'pBBB', amount: '1000000', visible: true });
    expect(row.sold).toMatchObject({ symbol: 'pAAA', amount: '500000', visible: true });
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
      amountVisibility: 'private-hidden'
    });
    expect(row.bought.visible).toBe(false);
    expect(row.sold.visible).toBe(false);
  });
});

