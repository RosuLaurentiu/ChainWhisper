import { describe, expect, it } from 'vitest';
import {
  materializePrivateLiquidityHistory,
  type DecryptedPrivateLiquidityPositionReceipt,
  type DecryptedPrivateLiquidityTraderReceipt,
  type PrivateLiquidityEventProvenance,
  type PrivateLiquiditySwapMarker
} from './privateLiquidityHistory';

const CONTRACT = '0x0000000000000000000000000000000000000100';
const OTHER_CONTRACT = '0x0000000000000000000000000000000000000200';
const VIEWER = '0x0000000000000000000000000000000000000030';
const OTHER = '0x0000000000000000000000000000000000000040';
const PAIR_KEY = `0x${'11'.repeat(32)}`;
const BLOCK_HASH = `0x${'22'.repeat(32)}`;
const TRANSACTION_HASH = `0x${'33'.repeat(32)}`;

const provenance = (
  logIndex: number,
  overrides: Partial<PrivateLiquidityEventProvenance> = {}
): PrivateLiquidityEventProvenance => ({
  chainId: '2632500',
  contractAddress: CONTRACT,
  blockNumber: '100',
  blockHash: BLOCK_HASH,
  transactionHash: TRANSACTION_HASH,
  transactionIndex: 2,
  logIndex,
  ...overrides
});

const marker = (
  overrides: Partial<PrivateLiquiditySwapMarker> = {}
): PrivateLiquiditySwapMarker => ({
  provenance: provenance(8),
  swapId: '5',
  trader: VIEWER,
  pairKey: PAIR_KEY,
  direction: 'base-to-quote',
  candidateCount: 3,
  ...overrides
});

const traderReceipt = (
  overrides: Partial<DecryptedPrivateLiquidityTraderReceipt> = {}
): DecryptedPrivateLiquidityTraderReceipt => ({
  provenance: provenance(7),
  swapId: '5',
  recipient: VIEWER,
  pairKey: PAIR_KEY,
  direction: 'base-to-quote',
  inputAmount: '12',
  outputAmount: '111',
  unusedInputAmount: '8',
  ...overrides
});

const positionReceipt = (
  positionId: string,
  logIndex: number,
  baseAmount: string,
  quoteAmount: string,
  overrides: Partial<DecryptedPrivateLiquidityPositionReceipt> = {}
): DecryptedPrivateLiquidityPositionReceipt => ({
  provenance: provenance(logIndex),
  positionId,
  swapId: '5',
  recipient: VIEWER,
  direction: 'base-to-quote',
  baseAmount,
  quoteAmount,
  ...overrides
});

describe('privateLiquidityHistory', () => {
  it('joins exact trader and contributing-position receipts to one canonical swap marker', () => {
    const result = materializePrivateLiquidityHistory({
      viewer: VIEWER,
      markers: [marker()],
      traderReceipts: [traderReceipt()],
      positionReceipts: [
        positionReceipt('1', 1, '5', '50'),
        positionReceipt('2', 3, '7', '61'),
        positionReceipt('3', 5, '0', '0')
      ]
    });

    expect(result.traderRows).toHaveLength(1);
    expect(result.traderRows[0]).toMatchObject({
      swapId: '5',
      inputAmount: '12',
      outputAmount: '111',
      unusedInputAmount: '8',
      candidateCount: 3
    });
    expect(result.positionRows.map((row) => [row.positionId, row.baseAmount, row.quoteAmount])).toEqual([
      ['1', '5', '50'],
      ['2', '7', '61']
    ]);
    expect(result.positionTotals).toEqual([
      {
        positionKey: `private-liquidity-v1:2632500:${CONTRACT}:1`,
        positionId: '1',
        fillCount: 1,
        baseReceived: '5',
        basePaid: '0',
        quoteReceived: '0',
        quotePaid: '50'
      },
      {
        positionKey: `private-liquidity-v1:2632500:${CONTRACT}:2`,
        positionId: '2',
        fillCount: 1,
        baseReceived: '7',
        basePaid: '0',
        quoteReceived: '0',
        quotePaid: '61'
      }
    ]);
  });

  it('aggregates both directions without treating zero evaluation receipts as fills', () => {
    const secondTransaction = `0x${'44'.repeat(32)}`;
    const result = materializePrivateLiquidityHistory({
      viewer: VIEWER,
      markers: [
        marker({ trader: OTHER }),
        marker({
          provenance: provenance(9, {
            blockNumber: '101',
            blockHash: `0x${'55'.repeat(32)}`,
            transactionHash: secondTransaction
          }),
          swapId: '6',
          direction: 'quote-to-base',
          trader: OTHER
        })
      ],
      traderReceipts: [],
      positionReceipts: [
        positionReceipt('1', 1, '5', '50'),
        positionReceipt('1', 2, '3', '33', {
          provenance: provenance(2, {
            blockNumber: '101',
            blockHash: `0x${'55'.repeat(32)}`,
            transactionHash: secondTransaction
          }),
          swapId: '6',
          direction: 'quote-to-base'
        }),
        positionReceipt('2', 3, '0', '0')
      ]
    });

    expect(result.positionTotals).toEqual([
      {
        positionKey: `private-liquidity-v1:2632500:${CONTRACT}:1`,
        positionId: '1',
        fillCount: 2,
        baseReceived: '5',
        basePaid: '3',
        quoteReceived: '33',
        quotePaid: '50'
      }
    ]);
  });

  it('isolates identical swap and position IDs by exact chain and contract', () => {
    const otherMarker = marker({
      provenance: provenance(8, { contractAddress: OTHER_CONTRACT })
    });
    const result = materializePrivateLiquidityHistory({
      viewer: VIEWER,
      markers: [marker(), otherMarker],
      traderReceipts: [
        traderReceipt(),
        traderReceipt({ provenance: provenance(7, { contractAddress: OTHER_CONTRACT }) })
      ],
      positionReceipts: []
    });
    expect(result.traderRows).toHaveLength(2);
    expect(result.traderRows[0].key).not.toBe(result.traderRows[1].key);
  });

  it('ignores valid receipts encrypted for another participant', () => {
    const result = materializePrivateLiquidityHistory({
      viewer: VIEWER,
      markers: [marker({ trader: OTHER })],
      traderReceipts: [traderReceipt({ recipient: OTHER })],
      positionReceipts: [positionReceipt('1', 1, '5', '50', { recipient: OTHER })]
    });
    expect(result.traderRows).toEqual([]);
    expect(result.positionRows).toEqual([]);
    expect(result.positionTotals).toEqual([]);
  });

  it('fails closed on missing or mismatched same-transaction authority', () => {
    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [marker()],
        traderReceipts: [
          traderReceipt({
            provenance: provenance(7, { transactionHash: `0x${'66'.repeat(32)}` })
          })
        ],
        positionReceipts: []
      })
    ).toThrow(/no exact same-transaction swap marker/);
    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [marker()],
        traderReceipts: [traderReceipt({ direction: 'quote-to-base' })],
        positionReceipts: []
      })
    ).toThrow(/does not match its swap marker/);
    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [marker()],
        traderReceipts: [],
        positionReceipts: [positionReceipt('1', 1, '5', '0')]
      })
    ).toThrow(/two positive amounts or two zero amounts/);
  });

  it('rejects duplicate physical logs and duplicate scoped swap markers', () => {
    const duplicateMarker = marker();
    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [duplicateMarker, duplicateMarker],
        traderReceipts: [],
        positionReceipts: []
      })
    ).toThrow(/Duplicate private-liquidity event/);

    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [marker(), marker({ provenance: provenance(9) })],
        traderReceipts: [],
        positionReceipts: []
      })
    ).toThrow(/Duplicate private-liquidity swap marker/);
  });

  it('requires exactly one viewer trader receipt and one receipt per position', () => {
    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [marker()],
        traderReceipts: [],
        positionReceipts: []
      })
    ).toThrow(/missing its exact trader receipt/);

    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [marker()],
        traderReceipts: [traderReceipt(), traderReceipt({ provenance: provenance(6) })],
        positionReceipts: []
      })
    ).toThrow(/more than one viewer trader receipt/);

    expect(() =>
      materializePrivateLiquidityHistory({
        viewer: VIEWER,
        markers: [marker()],
        traderReceipts: [traderReceipt()],
        positionReceipts: [
          positionReceipt('1', 1, '5', '50'),
          positionReceipt('1', 2, '5', '50')
        ]
      })
    ).toThrow(/more than one receipt for the same position/);
  });

  it('recomputes from the supplied canonical snapshot so orphan removal cannot leave stale totals', () => {
    const canonical = materializePrivateLiquidityHistory({
      viewer: VIEWER,
      markers: [marker({ trader: OTHER })],
      traderReceipts: [],
      positionReceipts: [positionReceipt('1', 1, '5', '50')]
    });
    expect(canonical.positionTotals[0]?.baseReceived).toBe('5');

    const afterReorg = materializePrivateLiquidityHistory({
      viewer: VIEWER,
      markers: [],
      traderReceipts: [],
      positionReceipts: []
    });
    expect(afterReorg.positionRows).toEqual([]);
    expect(afterReorg.positionTotals).toEqual([]);
  });
});
