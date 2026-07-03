import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ABI,
  loadCotiEthersModule,
  loadCotiReadProvider,
  type TradeSnapshot
} from '../../../lib/appShared';
import {
  buildTradeLifecycleHistoryRows,
  buildTradeTransactionHistoryRows,
  type TradeTransactionHistoryRow
} from '../../../lib/tradeHistory';

type BlockTimestampProvider = {
  getBlock: (blockNumber: number) => Promise<{ timestamp?: unknown } | null | undefined>;
};

type ResolveBlockTimestampMap = (
  readProvider: BlockTimestampProvider,
  blockNumbers: Iterable<number>
) => Promise<Map<number, number>>;

type HistoryHydrationState = {
  historyLifecycleTxHashes: Record<string, string>;
  historyTransactionTxHashes: Record<string, string>;
  historyTransactionTimestamps: Record<string, number>;
  setHistoryLifecycleTxHashes: Dispatch<SetStateAction<Record<string, string>>>;
  setHistoryTransactionTxHashes: Dispatch<SetStateAction<Record<string, string>>>;
  setHistoryTransactionTimestamps: Dispatch<SetStateAction<Record<string, number>>>;
};

type UseTradeTerminalHistoryHydrationOptions = HistoryHydrationState & {
  resolveBlockTimestampMap: ResolveBlockTimestampMap;
  targetTrade: TradeSnapshot | null;
  walletAddress: string;
};

type HistoryEventContract = {
  filters: Record<string, ((...args: unknown[]) => unknown) | undefined>;
  queryFilter: (filter: unknown, fromBlock: number, toBlock: string) => Promise<unknown[]>;
};

const mergeEntries = <T,>(
  current: Record<string, T>,
  entries: Iterable<readonly [string, T]>
): Record<string, T> => {
  let changed = false;
  const next = { ...current };
  for (const [key, value] of entries) {
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  return changed ? next : current;
};

const getHistoryAbi = (sourceKind: TradeTransactionHistoryRow['sourceKind']) =>
  sourceKind === 'recurring'
    ? RECURRING_OTC_CONTRACT_ABI
    : sourceKind === 'direct'
      ? DIRECT_TRADE_ESCROW_CONTRACT_ABI
      : sourceKind === 'private'
        ? PRIVATE_TRADE_ESCROW_CONTRACT_ABI
        : TRADE_ESCROW_CONTRACT_ABI;

export default function useTradeTerminalHistoryHydration({
  historyLifecycleTxHashes,
  historyTransactionTimestamps,
  historyTransactionTxHashes,
  resolveBlockTimestampMap,
  setHistoryLifecycleTxHashes,
  setHistoryTransactionTimestamps,
  setHistoryTransactionTxHashes,
  targetTrade,
  walletAddress
}: UseTradeTerminalHistoryHydrationOptions) {
  useEffect(() => {
    if (!targetTrade) {
      return;
    }

    const lifecycleRowsNeedingTx = buildTradeLifecycleHistoryRows(targetTrade).filter(
      (row) => !row.txHash && !historyLifecycleTxHashes[row.key]
    );
    if (!lifecycleRowsNeedingTx.length) {
      return;
    }

    let cancelled = false;
    loadCotiEthersModule()
      .then(async (cotiEthers) => {
        const readProvider = await loadCotiReadProvider(true);
        const txByRowKey = new Map<string, string>();
        const blockNumberByRowKey = new Map<string, number>();

        await Promise.all(
          lifecycleRowsNeedingTx.map(async (row) => {
            try {
              const eventId =
                row.action === 'replaced' && typeof row.relatedTradeId === 'number'
                  ? row.relatedTradeId
                  : row.localId;
              const eventName =
                row.action === 'cancelled'
                  ? row.sourceKind === 'recurring'
                    ? 'RecurringOrderCancelled'
                    : row.sourceKind === 'direct'
                      ? 'DirectTradeCancelled'
                      : 'TradeCancelled'
                  : row.sourceKind === 'recurring'
                    ? 'RecurringOrderOpened'
                    : row.sourceKind === 'direct'
                      ? 'DirectTradeOpened'
                      : row.sourceKind === 'private'
                        ? 'PrivateOrderOpened'
                        : 'TradeOpened';
              const contract = new cotiEthers.Contract(row.contractAddress, getHistoryAbi(row.sourceKind), readProvider) as HistoryEventContract;
              const filterFactory = contract.filters[eventName];
              if (!filterFactory) {
                return;
              }
              const filterArgs =
                row.action === 'cancelled'
                  ? row.sourceKind === 'recurring'
                    ? [BigInt(eventId)]
                    : [BigInt(eventId), null]
                  : [BigInt(eventId), null, null];
              const logs = await contract.queryFilter(filterFactory(...filterArgs), 0, 'latest');
              const latestLog = logs[logs.length - 1] as
                | {
                    transactionHash?: unknown;
                    blockNumber?: unknown;
                  }
                | undefined;
              if (typeof latestLog?.transactionHash === 'string' && latestLog.transactionHash) {
                txByRowKey.set(row.key, latestLog.transactionHash);
              }
              if (typeof latestLog?.blockNumber === 'number') {
                blockNumberByRowKey.set(row.key, latestLog.blockNumber);
              }
            } catch {
              // Transaction links are opportunistic; history stays readable without them.
            }
          })
        );

        const timestampByBlockNumber = blockNumberByRowKey.size
          ? await resolveBlockTimestampMap(readProvider, blockNumberByRowKey.values())
          : new Map<number, number>();
        return {
          txByRowKey,
          timestampByRowKey: new Map(
            Array.from(blockNumberByRowKey.entries())
              .map(([rowKey, blockNumber]) => [rowKey, timestampByBlockNumber.get(blockNumber)] as const)
              .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number')
          )
        };
      })
      .then((result) => {
        if (cancelled || !result) {
          return;
        }
        if (result.txByRowKey.size > 0) {
          setHistoryLifecycleTxHashes((current) => mergeEntries(current, result.txByRowKey.entries()));
        }
        if (result.timestampByRowKey.size > 0) {
          setHistoryTransactionTimestamps((current) => mergeEntries(current, result.timestampByRowKey.entries()));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    historyLifecycleTxHashes,
    resolveBlockTimestampMap,
    setHistoryLifecycleTxHashes,
    setHistoryTransactionTimestamps,
    targetTrade
  ]);

  useEffect(() => {
    if (!targetTrade || !walletAddress) {
      return;
    }

    const rowsNeedingTx = buildTradeTransactionHistoryRows([targetTrade], walletAddress).filter(
      (row) => !row.txHash && !historyTransactionTxHashes[row.key]
    );
    if (!rowsNeedingTx.length) {
      return;
    }

    let cancelled = false;
    loadCotiEthersModule()
      .then(async (cotiEthers) => {
        const readProvider = await loadCotiReadProvider(true);
        const contractCache = new Map<string, HistoryEventContract>();
        const getHistoryContract = (row: TradeTransactionHistoryRow): HistoryEventContract => {
          const cacheKey = `${row.sourceKind}:${row.contractAddress.toLowerCase()}`;
          const cached = contractCache.get(cacheKey);
          if (cached) {
            return cached;
          }
          const contract = new cotiEthers.Contract(row.contractAddress, getHistoryAbi(row.sourceKind), readProvider) as HistoryEventContract;
          contractCache.set(cacheKey, contract);
          return contract;
        };
        const queryLatestHistoryEvent = async (
          row: TradeTransactionHistoryRow,
          eventName: string,
          args: unknown[]
        ): Promise<{ transactionHash?: unknown; blockNumber?: unknown } | null> => {
          const contract = getHistoryContract(row);
          const filterFactory = contract.filters[eventName];
          if (!filterFactory) {
            return null;
          }
          const logs = await contract.queryFilter(filterFactory(...args), 0, 'latest');
          return (logs[logs.length - 1] as { transactionHash?: unknown; blockNumber?: unknown } | undefined) ?? null;
        };

        const txByRowKey = new Map<string, string>();
        const blockNumberByRowKey = new Map<string, number>();

        await Promise.all(
          rowsNeedingTx.map(async (row) => {
            try {
              const localId = BigInt(row.localId);
              const fillerArg = row.role === 'filler' ? walletAddress : null;
              const takerArg = row.role === 'taker' ? walletAddress : null;
              const eventQueries =
                row.sourceKind === 'recurring'
                  ? [
                      { name: 'RecurringOrderExecuted', args: [localId, fillerArg] },
                      { name: 'PrivateRecurringFillReceipt', args: [localId, walletAddress, null] }
                    ]
                  : row.sourceKind === 'direct'
                    ? [
                        { name: 'DirectTradeAccepted', args: [localId, takerArg] },
                        { name: 'DirectTradeFilled', args: [localId] }
                      ]
                    : row.sourceKind === 'private'
                      ? [
                          { name: 'PrivateOrderFilled', args: [localId, fillerArg] },
                          { name: 'TradeAccepted', args: [localId, takerArg] },
                          { name: 'TradeFilled', args: [localId] }
                        ]
                      : [
                          { name: 'TradePartiallyFilled', args: [localId, fillerArg] },
                          { name: 'TradeAccepted', args: [localId, takerArg] },
                          { name: 'TradeFilled', args: [localId] }
                        ];

              for (const eventQuery of eventQueries) {
                const latestLog = await queryLatestHistoryEvent(row, eventQuery.name, eventQuery.args);
                if (typeof latestLog?.transactionHash === 'string' && latestLog.transactionHash) {
                  txByRowKey.set(row.key, latestLog.transactionHash);
                  if (typeof latestLog.blockNumber === 'number') {
                    blockNumberByRowKey.set(row.key, latestLog.blockNumber);
                  }
                  return;
                }
              }
            } catch {
              // Transaction links are opportunistic; the indexed history row remains readable without them.
            }
          })
        );

        const timestampByBlockNumber = blockNumberByRowKey.size
          ? await resolveBlockTimestampMap(readProvider, blockNumberByRowKey.values())
          : new Map<number, number>();
        return {
          txByRowKey,
          timestampByRowKey: new Map(
            Array.from(blockNumberByRowKey.entries())
              .map(([rowKey, blockNumber]) => [rowKey, timestampByBlockNumber.get(blockNumber)] as const)
              .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number')
          )
        };
      })
      .then((result) => {
        if (cancelled || !result) {
          return;
        }
        if (result.txByRowKey.size > 0) {
          setHistoryTransactionTxHashes((current) => mergeEntries(current, result.txByRowKey.entries()));
        }
        if (result.timestampByRowKey.size > 0) {
          setHistoryTransactionTimestamps((current) => mergeEntries(current, result.timestampByRowKey.entries()));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    historyTransactionTxHashes,
    resolveBlockTimestampMap,
    setHistoryTransactionTimestamps,
    setHistoryTransactionTxHashes,
    targetTrade,
    walletAddress
  ]);

  useEffect(() => {
    if (!targetTrade || !walletAddress) {
      return;
    }

    const rowsNeedingTimestamp = buildTradeTransactionHistoryRows([targetTrade], walletAddress).filter(
      (row) =>
        historyTransactionTimestamps[row.key] === undefined &&
        (typeof row.blockNumber === 'number' || Boolean(row.txHash ?? historyTransactionTxHashes[row.key]))
    );
    if (!rowsNeedingTimestamp.length) {
      return;
    }

    let cancelled = false;
    loadCotiReadProvider(true)
      .then(async (readProvider) => {
        const blockNumberByRowKey = new Map<string, number>();

        for (const row of rowsNeedingTimestamp) {
          if (typeof row.blockNumber === 'number') {
            blockNumberByRowKey.set(row.key, row.blockNumber);
          }
        }

        await Promise.all(
          rowsNeedingTimestamp.map(async (row) => {
            const txHash = row.txHash ?? historyTransactionTxHashes[row.key];
            if (blockNumberByRowKey.has(row.key) || !txHash) {
              return;
            }
            const receipt = await readProvider.getTransactionReceipt(txHash).catch(() => null);
            if (typeof receipt?.blockNumber === 'number') {
              blockNumberByRowKey.set(row.key, receipt.blockNumber);
            }
          })
        );

        if (blockNumberByRowKey.size === 0) {
          return new Map<string, number>();
        }

        const timestampByBlockNumber = await resolveBlockTimestampMap(readProvider, blockNumberByRowKey.values());
        return new Map(
          Array.from(blockNumberByRowKey.entries())
            .map(([rowKey, blockNumber]) => [rowKey, timestampByBlockNumber.get(blockNumber)] as const)
            .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number')
        );
      })
      .then((timestampByRowKey) => {
        if (cancelled || !timestampByRowKey || timestampByRowKey.size === 0) {
          return;
        }
        setHistoryTransactionTimestamps((current) => mergeEntries(current, timestampByRowKey.entries()));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    historyTransactionTimestamps,
    historyTransactionTxHashes,
    resolveBlockTimestampMap,
    setHistoryTransactionTimestamps,
    targetTrade,
    walletAddress
  ]);
}
