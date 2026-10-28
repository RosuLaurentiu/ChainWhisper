import { describe, expect, it } from 'vitest';
import {
  aggregateTradeHistoryV2Rows,
  buildTradeHistoryV2OrderKey,
  createTradeHistoryV2LedgerState,
  getTradeHistoryV2LedgerRevision,
  normalizeTradeHistoryV2Observation,
  projectTradeHistoryV2Rows,
  replaceTradeHistoryV2Range,
  type TradeHistoryV2Observation,
  type TradeHistoryV2RangePage
} from './tradeHistoryV2Ledger';

const CONTRACT_A = '0x1000000000000000000000000000000000000001';
const CONTRACT_B = '0x2000000000000000000000000000000000000002';
const MAKER = '0x3000000000000000000000000000000000000003';
const FILLER = '0x4000000000000000000000000000000000000004';
const OUTSIDER = '0x5000000000000000000000000000000000000005';
const bytes32 = (value: number): string => `0x${value.toString(16).padStart(64, '0')}`;

const observation = (
  overrides: Partial<TradeHistoryV2Observation> = {}
): TradeHistoryV2Observation => ({
  schema: 1,
  protocol: 'standard-v2',
  order: { chainId: '7082400', contractAddress: CONTRACT_A, orderId: '1' },
  sequence: '1',
  maker: MAKER,
  participant: FILLER,
  side: 'fill',
  source: 'public-event',
  amounts: { offerAmount: '10', requestAmount: '20' },
  log: {
    blockNumber: '100',
    blockHash: bytes32(100),
    transactionHash: bytes32(1000),
    transactionIndex: 0,
    logIndex: 0
  },
  ...overrides
});

const page = (
  observations: readonly TradeHistoryV2Observation[],
  overrides: Partial<TradeHistoryV2RangePage> = {}
): TradeHistoryV2RangePage => ({
  schema: 1,
  chainId: '7082400',
  contractAddress: CONTRACT_A,
  fromBlock: '90',
  toBlock: '110',
  fromBlockHash: bytes32(90),
  toBlockHash: bytes32(110),
  observations,
  ...overrides
});

describe('tradeHistoryV2Ledger', () => {
  it('uses JSON-safe full chain/contract/order identity without JS number truncation', () => {
    const largeOrderId = ((1n << 255n) + 123n).toString();
    const normalized = normalizeTradeHistoryV2Observation(
      observation({ order: { chainId: '7082400', contractAddress: CONTRACT_A, orderId: largeOrderId } })
    );
    expect(normalized.order.orderId).toBe(largeOrderId);
    expect(JSON.parse(JSON.stringify(normalized)).order.orderId).toBe(largeOrderId);
    expect(
      buildTradeHistoryV2OrderKey(normalized.order)
    ).not.toBe(
      buildTradeHistoryV2OrderKey({ ...normalized.order, contractAddress: CONTRACT_B })
    );
    expect(
      buildTradeHistoryV2OrderKey(normalized.order)
    ).not.toBe(
      buildTradeHistoryV2OrderKey({ ...normalized.order, chainId: '2632500' })
    );
  });

  it('projects exact public fills and aggregates amounts per exact order', () => {
    let state = createTradeHistoryV2LedgerState();
    state = replaceTradeHistoryV2Range({
      previous: state,
      page: page([
        observation(),
        observation({
          sequence: '2',
          amounts: { offerAmount: '7', requestAmount: '14' },
          log: {
            blockNumber: '101',
            blockHash: bytes32(101),
            transactionHash: bytes32(1001),
            transactionIndex: 1,
            logIndex: 4
          }
        })
      ]),
      expectedRevision: 0
    });
    const rows = projectTradeHistoryV2Rows({ state, viewerAddress: MAKER });
    expect(rows.map((row) => row.sequence)).toEqual(['1', '2']);
    expect(rows.map((row) => row.amountState)).toEqual(['available', 'available']);
    expect(aggregateTradeHistoryV2Rows(rows)).toEqual([
      expect.objectContaining({
        executionCount: '2',
        exactExecutionCount: '2',
        hiddenExecutionCount: '0',
        offerAmount: '17',
        requestAmount: '34'
      })
    ]);
  });

  it('selects only the viewer-bound private receipt and never reveals maker inventory to a filler', () => {
    const marker = observation({
      protocol: 'private-recurring-v2',
      side: 'buy',
      source: 'private-marker',
      amounts: {},
      log: { ...observation().log, logIndex: 0 }
    });
    const makerReceipt = observation({
      protocol: 'private-recurring-v2',
      side: 'buy',
      source: 'participant-receipt',
      recipient: MAKER,
      amounts: { baseAmount: '4', quoteAmount: '8' },
      postState: { baseInventory: '100', quoteInventory: '200' },
      log: { ...observation().log, logIndex: 1 }
    });
    const fillerReceipt = observation({
      protocol: 'private-recurring-v2',
      side: 'buy',
      source: 'participant-receipt',
      recipient: FILLER,
      amounts: { baseAmount: '4', quoteAmount: '8' },
      log: { ...observation().log, logIndex: 2 }
    });
    const state = replaceTradeHistoryV2Range({
      previous: createTradeHistoryV2LedgerState(),
      page: page([marker, makerReceipt, fillerReceipt]),
      expectedRevision: 0
    });
    const makerRows = projectTradeHistoryV2Rows({ state, viewerAddress: MAKER });
    const fillerRows = projectTradeHistoryV2Rows({ state, viewerAddress: FILLER });
    expect(makerRows).toHaveLength(1);
    expect(makerRows[0]).toMatchObject({ source: 'participant-receipt', amounts: { baseAmount: '4', quoteAmount: '8' } });
    expect(fillerRows).toHaveLength(1);
    expect(fillerRows[0]).toMatchObject({ source: 'participant-receipt', amounts: { baseAmount: '4', quoteAmount: '8' } });
    expect(fillerRows[0]).not.toHaveProperty('postState');
    expect(projectTradeHistoryV2Rows({ state, viewerAddress: OUTSIDER })).toEqual([]);
  });

  it('keeps a private execution hidden when no exact participant receipt is available', () => {
    const state = replaceTradeHistoryV2Range({
      previous: createTradeHistoryV2LedgerState(),
      page: page([
        observation({
          protocol: 'private-v2',
          source: 'private-marker',
          amounts: {}
        })
      ]),
      expectedRevision: 0
    });
    const rows = projectTradeHistoryV2Rows({ state, viewerAddress: FILLER });
    expect(rows).toEqual([
      expect.objectContaining({ amountState: 'unavailable', amounts: {}, source: 'private-marker' })
    ]);
    expect(aggregateTradeHistoryV2Rows(rows)[0]).toMatchObject({
      executionCount: '1',
      exactExecutionCount: '0',
      hiddenExecutionCount: '1',
      offerAmount: '0',
      requestAmount: '0'
    });
  });

  it('atomically replaces an orphaned block range and removes the old fork observation', () => {
    let state = replaceTradeHistoryV2Range({
      previous: createTradeHistoryV2LedgerState(),
      page: page([observation()]),
      expectedRevision: 0
    });
    const replacement = observation({
      amounts: { offerAmount: '9', requestAmount: '18' },
      log: {
        ...observation().log,
        blockHash: bytes32(999),
        transactionHash: bytes32(1999)
      }
    });
    state = replaceTradeHistoryV2Range({
      previous: state,
      page: page([replacement], { fromBlockHash: bytes32(900), toBlockHash: bytes32(999) }),
      expectedRevision: 1
    });
    expect(Object.values(state.observationsByPhysicalKey)).toHaveLength(1);
    expect(projectTradeHistoryV2Rows({ state, viewerAddress: MAKER })[0].amounts).toEqual({
      offerAmount: '9',
      requestAmount: '18'
    });
    expect(getTradeHistoryV2LedgerRevision({ state, chainId: '7082400', contractAddress: CONTRACT_A })).toBe(2);
  });

  it('rejects stale page commits, cross-scope observations, and conflicting physical identities', () => {
    const state = replaceTradeHistoryV2Range({
      previous: createTradeHistoryV2LedgerState(),
      page: page([observation()]),
      expectedRevision: 0
    });
    expect(() => replaceTradeHistoryV2Range({ previous: state, page: page([]), expectedRevision: 0 })).toThrow(/stale/i);
    expect(() => replaceTradeHistoryV2Range({
      previous: createTradeHistoryV2LedgerState(),
      page: page([observation({ order: { chainId: '2632500', contractAddress: CONTRACT_A, orderId: '1' } })]),
      expectedRevision: 0
    })).toThrow(/different chain or contract/i);
    const samePhysicalDifferentPayload = observation({ amounts: { offerAmount: '11', requestAmount: '22' } });
    expect(() => replaceTradeHistoryV2Range({
      previous: createTradeHistoryV2LedgerState(),
      page: page([observation(), samePhysicalDifferentPayload]),
      expectedRevision: 0
    })).toThrow(/conflicting/i);
  });

  it('fails closed on partial exact amounts rather than displaying an inferred second side', () => {
    expect(() => normalizeTradeHistoryV2Observation(
      observation({
        protocol: 'private-v2',
        source: 'public-event',
        amounts: { requestAmount: '20' }
      })
    )).toThrow(/both economic amounts/i);
    expect(() => normalizeTradeHistoryV2Observation(
      observation({ source: 'private-marker', amounts: { offerAmount: '10' } })
    )).toThrow(/must not expose amounts/i);
  });
});

