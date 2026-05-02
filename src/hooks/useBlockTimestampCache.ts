import { useCallback, useRef } from 'react';

type BlockTimestampProvider = {
  getBlock: (blockNumber: number) => Promise<{ timestamp?: unknown } | null | undefined>;
};

export default function useBlockTimestampCache() {
  const blockTimestampCacheRef = useRef<Map<number, number>>(new Map());

  const resetBlockTimestampCache = useCallback(() => {
    blockTimestampCacheRef.current = new Map();
  }, []);

  const resolveBlockTimestampMap = useCallback(
    async (readProvider: BlockTimestampProvider, blockNumbers: Iterable<number>): Promise<Map<number, number>> => {
      const timestampMap = new Map<number, number>();
      const timestampCache = blockTimestampCacheRef.current;
      const uniqueBlockNumbers = Array.from(new Set(blockNumbers));

      await Promise.all(
        uniqueBlockNumbers.map(async (blockNumber) => {
          const cachedTimestamp = timestampCache.get(blockNumber);
          if (typeof cachedTimestamp === 'number') {
            timestampMap.set(blockNumber, cachedTimestamp);
            return;
          }

          const block = await readProvider.getBlock(blockNumber);
          if (block?.timestamp) {
            const timestamp = Number(block.timestamp);
            timestampMap.set(blockNumber, timestamp);
            timestampCache.set(blockNumber, timestamp);
          }
        })
      );

      return timestampMap;
    },
    []
  );

  return {
    blockTimestampCacheRef,
    resetBlockTimestampCache,
    resolveBlockTimestampMap
  };
}
