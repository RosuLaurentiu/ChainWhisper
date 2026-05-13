import { describe, expect, it } from 'vitest';
import {
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../lib/appShared';
import { ZERO_TRADE_TAKER_ADDRESS } from '../lib/tradePerspective';
import { __mergeTradeSnapshotEnrichmentForTest } from './useP2PTradeData';

const maker = '0x1111111111111111111111111111111111111111';
const filler = '0x2222222222222222222222222222222222222222';

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

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing);

    expect(merged.privateFillReceipts).toHaveLength(1);
    expect(merged.walletHasFill).toBe(true);
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

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing);

    expect(merged.walletHasFill).toBe(true);
    expect(merged.recurringOrder?.privateExecutions).toHaveLength(1);
    expect(merged.recurringOrder?.makerPrivateInventory?.baseInventory).toBe('9000000');
  });
});
