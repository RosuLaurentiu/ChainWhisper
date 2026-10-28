import { describe, expect, it } from 'vitest';
import {
  createTradeHistoryV2LedgerState,
  projectTradeHistoryV2Rows,
  type TradeHistoryV2Observation,
  type TradeHistoryV2RangePage
} from './tradeHistoryV2Ledger';
import {
  createTradeHistoryV2SyncState,
  syncTradeHistoryV2Range,
  type TradeHistoryV2CanonicalBlock,
  type TradeHistoryV2SyncDependencies,
  type TradeHistoryV2SyncScope
} from './tradeHistoryV2Sync';

const CONTRACT = '0x1000000000000000000000000000000000000001';
const MAKER = '0x3000000000000000000000000000000000000003';
const FILLER = '0x4000000000000000000000000000000000000004';
const bytes32 = (value: number | bigint): string => `0x${value.toString(16).padStart(64, '0')}`;
const scope: TradeHistoryV2SyncScope = {
  chainId: '7082400',
  contractAddress: CONTRACT,
  deploymentBlock: '100'
};

const observation = (blockNumber: bigint, amount = '10'): TradeHistoryV2Observation => ({
  schema: 1,
  protocol: 'standard-v2',
  order: { chainId: scope.chainId, contractAddress: CONTRACT, orderId: '1' },
  sequence: '1',
  maker: MAKER,
  participant: FILLER,
  side: 'fill',
  source: 'public-event',
  amounts: { offerAmount: amount, requestAmount: (BigInt(amount) * 2n).toString() },
  log: {
    blockNumber: blockNumber.toString(),
    blockHash: bytes32(blockNumber),
    transactionHash: bytes32(blockNumber + 1_000n),
    transactionIndex: 0,
    logIndex: 0
  }
});

const dependencies = ({
  latest = 120n,
  hashOffset = 0n,
  pageObservations,
  afterReadHashOffset
}: {
  latest?: bigint;
  hashOffset?: bigint;
  pageObservations?: (fromBlock: bigint, toBlock: bigint) => readonly TradeHistoryV2Observation[];
  afterReadHashOffset?: bigint;
} = {}): TradeHistoryV2SyncDependencies => {
  let rangeRead = false;
  const block = (blockNumber: string): TradeHistoryV2CanonicalBlock => {
    const number = BigInt(blockNumber);
    const offset = rangeRead && afterReadHashOffset !== undefined ? afterReadHashOffset : hashOffset;
    return { number: number.toString(), hash: bytes32(number + offset) };
  };
  return {
    getLatestBlockNumber: async () => latest.toString(),
    readCanonicalBlock: async (_chainId, blockNumber) => block(blockNumber),
    readCompleteRange: async ({ fromBlock, toBlock }): Promise<TradeHistoryV2RangePage> => {
      const from = BigInt(fromBlock);
      const to = BigInt(toBlock);
      const result = {
        schema: 1 as const,
        chainId: scope.chainId,
        contractAddress: CONTRACT,
        fromBlock,
        toBlock,
        fromBlockHash: bytes32(from + hashOffset),
        toBlockHash: bytes32(to + hashOffset),
        observations: pageObservations?.(from, to) ?? []
      };
      rangeRead = true;
      return result;
    }
  };
};

describe('tradeHistoryV2Sync', () => {
  it('reconstructs the same finalized history from chain logs in a fresh runtime after reload', async () => {
    const rebuildFromChain = async () => {
      let state = createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState());
      let expectedRevision = 0;
      let hasMore = true;
      while (hasMore) {
        const result = await syncTradeHistoryV2Range({
          previous: state,
          scope,
          confirmationDepth: 5n,
          maxBlockSpan: 10n,
          overlapBlocks: 2n,
          dependencies: dependencies({
            pageObservations: (from, to) => from <= 108n && to >= 108n ? [observation(108n, '12')] : []
          }),
          expectedRevision
        });
        state = result.state;
        hasMore = result.hasMore;
        expectedRevision += result.status === 'up-to-date' ? 0 : 1;
      }
      return {
        state,
        rows: projectTradeHistoryV2Rows({ state: state.ledger, viewerAddress: MAKER })
      };
    };

    const beforeReload = await rebuildFromChain();
    const afterReload = await rebuildFromChain();

    expect(afterReload.state).not.toBe(beforeReload.state);
    expect(afterReload.rows).toEqual(beforeReload.rows);
    expect(afterReload.rows).toHaveLength(1);
    expect(afterReload.rows[0].amounts).toEqual({ offerAmount: '12', requestAmount: '24' });
    expect(Object.values(afterReload.state.checkpointsByScope)).toEqual([
      { blockNumber: '115', blockHash: bytes32(115) }
    ]);
  });

  it('reads one bounded finalized page and advances an exact block-hash checkpoint', async () => {
    const result = await syncTradeHistoryV2Range({
      previous: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({ pageObservations: (from) => [observation(from)] }),
      expectedRevision: 0
    });
    expect(result).toMatchObject({
      status: 'page-applied',
      safeHead: '115',
      hasMore: true,
      reorged: false,
      page: { fromBlock: '100', toBlock: '109' }
    });
    expect(Object.values(result.state.checkpointsByScope)).toEqual([
      { blockNumber: '109', blockHash: bytes32(109) }
    ]);
    expect(projectTradeHistoryV2Rows({ state: result.state.ledger, viewerAddress: MAKER })).toHaveLength(1);
  });

  it('uses bounded overlap on the next page and atomically replaces overlapping observations', async () => {
    const first = await syncTradeHistoryV2Range({
      previous: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({ pageObservations: () => [observation(108n)] }),
      expectedRevision: 0
    });
    const second = await syncTradeHistoryV2Range({
      previous: first.state,
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({ pageObservations: () => [observation(108n, '12')] }),
      expectedRevision: 1
    });
    expect(second.page).toEqual({ fromBlock: '108', toBlock: '115' });
    expect(second.hasMore).toBe(false);
    expect(projectTradeHistoryV2Rows({ state: second.state.ledger, viewerAddress: MAKER })[0].amounts).toEqual({
      offerAmount: '12',
      requestAmount: '24'
    });
  });

  it('clears only the affected scope and restarts bounded replay after a checkpoint reorg', async () => {
    const first = await syncTradeHistoryV2Range({
      previous: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({ pageObservations: () => [observation(108n)] }),
      expectedRevision: 0
    });
    const replay = await syncTradeHistoryV2Range({
      previous: first.state,
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({
        hashOffset: 10_000n,
        pageObservations: (from) => [
          {
            ...observation(from, '15'),
            log: {
              ...observation(from).log,
              blockHash: bytes32(from + 10_000n),
              transactionHash: bytes32(from + 20_000n)
            }
          }
        ]
      }),
      expectedRevision: 1
    });
    expect(replay.status).toBe('reorg-replay');
    expect(replay.reorged).toBe(true);
    expect(replay.page).toEqual({ fromBlock: '100', toBlock: '109' });
    expect(projectTradeHistoryV2Rows({ state: replay.state.ledger, viewerAddress: MAKER })[0].amounts.offerAmount).toBe('15');
  });

  it('fails safe by replaying when the finalized head rolls behind the stored checkpoint', async () => {
    const first = await syncTradeHistoryV2Range({
      previous: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({ pageObservations: () => [observation(108n)] }),
      expectedRevision: 0
    });
    const replay = await syncTradeHistoryV2Range({
      previous: first.state,
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({ latest: 108n }),
      expectedRevision: 1
    });
    expect(replay.reorged).toBe(true);
    expect(replay.status).toBe('reorg-replay');
    expect(replay.page).toEqual({ fromBlock: '100', toBlock: '103' });
    expect(replay.state.ledger.observationsByPhysicalKey).toEqual({});
  });

  it('rejects a range whose boundary hash changes during the provider read', async () => {
    const previous = createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState());
    await expect(syncTradeHistoryV2Range({
      previous,
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies({ afterReadHashOffset: 1n }),
      expectedRevision: 0
    })).rejects.toThrow(/changed while/i);
    expect(previous.ledger.observationsByPhysicalKey).toEqual({});
  });

  it('advances across complete empty ranges and rejects unsafe range policies', async () => {
    const result = await syncTradeHistoryV2Range({
      previous: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 16n,
      overlapBlocks: 0n,
      dependencies: dependencies(),
      expectedRevision: 0
    });
    expect(result.page).toEqual({ fromBlock: '100', toBlock: '115' });
    expect(result.hasMore).toBe(false);
    expect(result.state.ledger.observationsByPhysicalKey).toEqual({});
    await expect(syncTradeHistoryV2Range({
      previous: result.state,
      scope,
      confirmationDepth: 0n,
      maxBlockSpan: 10n,
      overlapBlocks: 0n,
      dependencies: dependencies(),
      expectedRevision: 1
    })).rejects.toThrow(/confirmation depth/i);
    await expect(syncTradeHistoryV2Range({
      previous: result.state,
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 10n,
      dependencies: dependencies(),
      expectedRevision: 1
    })).rejects.toThrow(/overlap/i);
  });

  it('fails closed when the wallet/chain lease changes during an async read', async () => {
    let calls = 0;
    await expect(syncTradeHistoryV2Range({
      previous: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
      scope,
      confirmationDepth: 5n,
      maxBlockSpan: 10n,
      overlapBlocks: 2n,
      dependencies: dependencies(),
      expectedRevision: 0,
      shouldContinue: () => ++calls < 3
    })).rejects.toThrow(/scope changed/i);
  });
});
