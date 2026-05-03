import { describe, expect, it } from 'vitest';
import {
  mergeDirectSyncOptions,
  resolveDirectSyncRange,
  resolveKnownEarliestMessageBlock,
  resolveOlderDirectHistoryRange
} from './directSyncPlan';

describe('mergeDirectSyncOptions', () => {
  it('lets deep sync override narrower pending contact work', () => {
    expect(
      mergeDirectSyncOptions(
        { deep: true, background: false },
        { contactsOnly: true, previewPerContact: true, lookbackBlocks: 50, background: true }
      )
    ).toMatchObject({
      background: false,
      contactsOnly: false,
      deep: true,
      previewPerContact: false,
      updateHead: true
    });
  });

  it('widens pending incremental ranges without turning contacts-only into full sync', () => {
    expect(
      mergeDirectSyncOptions(
        { contactsOnly: true, previewPerContact: true, fromBlock: 100, toBlock: 120, lookbackBlocks: 25 },
        { contactsOnly: true, fromBlock: 110, toBlock: 115, lookbackBlocks: 10, background: true }
      )
    ).toMatchObject({
      background: true,
      contactsOnly: true,
      fromBlock: 100,
      lookbackBlocks: 25,
      previewPerContact: true,
      toBlock: 120
    });
  });

  it('keeps active-contact realtime work narrow unless broader contact work is pending', () => {
    expect(
      mergeDirectSyncOptions(
        { activeContactOnly: true },
        { background: true }
      )
    ).toMatchObject({
      activeContactOnly: true,
      background: true,
      contactsOnly: false,
      previewPerContact: false
    });

    expect(
      mergeDirectSyncOptions(
        { activeContactOnly: true },
        { contactsOnly: true, previewPerContact: true, background: true }
      )
    ).toMatchObject({
      activeContactOnly: false,
      contactsOnly: true,
      previewPerContact: true
    });
  });
});

describe('resolveDirectSyncRange', () => {
  it('uses a deep sync from genesis to the latest block', () => {
    expect(
      resolveDirectSyncRange({
        initialLookbackBlocks: 500,
        latestBlock: 1_000,
        options: { deep: true }
      })
    ).toEqual({
      fromBlock: 0,
      shouldQuery: true,
      toBlock: 1_000
    });
  });

  it('uses a narrow update after the last synced block', () => {
    expect(
      resolveDirectSyncRange({
        initialLookbackBlocks: 500,
        lastSyncedBlock: 900,
        latestBlock: 1_000,
        options: { updateHead: true }
      })
    ).toEqual({
      fromBlock: 901,
      shouldQuery: true,
      toBlock: 1_000
    });
  });

  it('skips queries when an explicit range is already caught up', () => {
    expect(
      resolveDirectSyncRange({
        initialLookbackBlocks: 500,
        latestBlock: 1_000,
        options: { fromBlock: 1_010, toBlock: 1_020 }
      })
    ).toEqual({
      fromBlock: 1_010,
      shouldQuery: false,
      toBlock: 1_000
    });
  });
});

describe('resolveOlderDirectHistoryRange', () => {
  it('loads the previous page before the known earliest cached block', () => {
    expect(
      resolveOlderDirectHistoryRange({
        conversationFirstBlock: 100,
        conversationLastBlock: 1_000,
        historyWindowBlocks: 200,
        knownEarliestBlock: 650,
        latestBlock: 1_200
      })
    ).toEqual({
      fromBlock: 450,
      hasReachedStart: false,
      shouldQuery: true,
      toBlock: 649
    });
  });

  it('falls back to the earliest local message block when no cursor is cached', () => {
    expect(resolveKnownEarliestMessageBlock([{ blockNumber: 500 }, {}, { blockNumber: 440 }])).toBe(440);
    expect(
      resolveOlderDirectHistoryRange({
        conversationFirstBlock: 100,
        conversationLastBlock: 1_000,
        historyWindowBlocks: 200,
        knownMessages: [{ blockNumber: 500 }, {}, { blockNumber: 440 }],
        latestBlock: 1_200
      })
    ).toMatchObject({
      fromBlock: 240,
      shouldQuery: true,
      toBlock: 439
    });
  });

  it('marks history exhausted when the next page would precede the conversation start', () => {
    expect(
      resolveOlderDirectHistoryRange({
        conversationFirstBlock: 100,
        conversationLastBlock: 1_000,
        historyWindowBlocks: 200,
        knownEarliestBlock: 100,
        latestBlock: 1_200
      })
    ).toMatchObject({
      hasReachedStart: true,
      shouldQuery: false
    });
  });
});
