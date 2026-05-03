import { describe, expect, it } from 'vitest';
import {
  collectGroupIdsFromLogs,
  collectLatestGroupRemovalEvents,
  mergeGroupSyncOptions,
  resolveActiveGroupBackfillPlan,
  resolveGroupCursorRange,
  resolveGroupIdFromEvent,
  resolveGroupPrefetchPlan,
  resolveRealtimeGroupSyncOptions,
  resolveTrackedGroupMessageLoad,
  trackedGroupMessageLoadsMatch
} from './groupSyncPlan';

const COTI_CHAIN_ID = 2632500;

describe('mergeGroupSyncOptions', () => {
  it('keeps overview-only sync scoped when no active message work is pending', () => {
    expect(mergeGroupSyncOptions({ overviewOnly: true, background: true })).toMatchObject({
      activeMessagesOnly: false,
      background: true,
      deep: false,
      overviewOnly: true
    });
  });

  it('keeps deep active-message backfills scoped to the active group', () => {
    expect(mergeGroupSyncOptions({ activeMessagesOnly: true, deep: true, background: true })).toMatchObject({
      activeMessagesOnly: true,
      background: true,
      deep: true,
      overviewOnly: false
    });
  });

  it('lets a full deep sync override narrower active-message work', () => {
    expect(
      mergeGroupSyncOptions(
        { activeMessagesOnly: true, deep: true, background: true },
        { deep: true, background: true }
      )
    ).toMatchObject({
      activeMessagesOnly: false,
      deep: true,
      overviewOnly: false
    });
  });
});

describe('resolveGroupCursorRange', () => {
  it('skips active-message queries when the group cursor is already caught up', () => {
    expect(
      resolveGroupCursorRange({
        latestBlock: 200,
        lastActivityBlock: 150,
        previousSyncedBlock: 180,
        initialLookbackBlocks: 50
      })
    ).toEqual({
      advanceToBlock: 200,
      fromBlock: 201,
      shouldQuery: false,
      toBlock: 200
    });
  });

  it('uses a narrow incremental range after the previous cursor', () => {
    expect(
      resolveGroupCursorRange({
        latestBlock: 200,
        lastActivityBlock: 190,
        previousSyncedBlock: 180,
        initialLookbackBlocks: 50
      })
    ).toMatchObject({
      fromBlock: 181,
      shouldQuery: true,
      toBlock: 200
    });
  });

  it('uses a deep range for active group backfill without needing overview sync', () => {
    expect(
      resolveGroupCursorRange({
        deep: true,
        latestBlock: 200,
        lastActivityBlock: 190,
        previousSyncedBlock: 180,
        initialLookbackBlocks: 50
      })
    ).toMatchObject({
      fromBlock: 0,
      shouldQuery: true,
      toBlock: 200
    });
  });

  it('uses a recent bounded range for first-open wide loads', () => {
    expect(
      resolveGroupCursorRange({
        latestBlock: 500,
        lastActivityBlock: 460,
        initialLookbackBlocks: 120,
        wideLoad: true
      })
    ).toMatchObject({
      fromBlock: 340,
      shouldQuery: true,
      toBlock: 500
    });
  });
});

describe('resolveTrackedGroupMessageLoad', () => {
  it('tracks active-message initial loads when the active group has no local messages', () => {
    expect(
      resolveTrackedGroupMessageLoad({
        activeGroupId: 5,
        activeGroupMessageCount: 0,
        options: { activeMessagesOnly: true, background: true }
      })
    ).toEqual({ groupId: 5, phase: 'initial' });
  });

  it('tracks active-message history loads after messages are already present', () => {
    expect(
      resolveTrackedGroupMessageLoad({
        activeGroupId: 5,
        activeGroupMessageCount: 3,
        options: { activeMessagesOnly: true, background: true }
      })
    ).toEqual({ groupId: 5, phase: 'history' });
  });

  it('treats deep active-group sync as history work', () => {
    expect(
      resolveTrackedGroupMessageLoad({
        activeGroupId: 5,
        activeGroupMessageCount: 0,
        options: { deep: true, background: true }
      })
    ).toEqual({ groupId: 5, phase: 'history' });
  });

  it('does not track overview-only or prefetch sync work', () => {
    expect(
      resolveTrackedGroupMessageLoad({
        activeGroupId: 5,
        activeGroupMessageCount: 0,
        options: { overviewOnly: true, background: true }
      })
    ).toBeNull();
    expect(
      resolveTrackedGroupMessageLoad({
        activeGroupId: 5,
        activeGroupMessageCount: 0,
        options: { prefetchGroupId: 5, background: true }
      })
    ).toBeNull();
  });

  it('matches tracked loads by group id so pending sync can keep the indicator alive', () => {
    expect(
      trackedGroupMessageLoadsMatch(
        { groupId: 5, phase: 'initial' },
        { groupId: 5, phase: 'history' }
      )
    ).toBe(true);
    expect(
      trackedGroupMessageLoadsMatch(
        { groupId: 5, phase: 'history' },
        { groupId: 6, phase: 'history' }
      )
    ).toBe(false);
  });
});

describe('group prefetch and backfill planning', () => {
  it('builds a prefetch plan keyed by wallet, group, and last block', () => {
    expect(
      resolveGroupPrefetchPlan({
        chainId: COTI_CHAIN_ID,
        groups: [{ id: 7, lastBlock: 120, lastTimestamp: 99 }],
        hasAesReady: true,
        prefetchedKeys: {},
        requestedGroupId: 7,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: ' 0xABC '
      })
    ).toEqual({
      cacheKey: '0xabc:7:120',
      options: {
        background: true,
        prefetchGroupId: 7,
        wideLoad: true
      }
    });
  });

  it('falls back to timestamp or zero when prefetch group block metadata is unavailable', () => {
    expect(
      resolveGroupPrefetchPlan({
        chainId: COTI_CHAIN_ID,
        groups: [{ id: 7, lastTimestamp: 44 }],
        hasAesReady: true,
        prefetchedKeys: {},
        requestedGroupId: 7,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xabc'
      })?.cacheKey
    ).toBe('0xabc:7:44');

    expect(
      resolveGroupPrefetchPlan({
        chainId: COTI_CHAIN_ID,
        groups: [],
        hasAesReady: true,
        prefetchedKeys: {},
        requestedGroupId: 7,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xabc'
      })?.cacheKey
    ).toBe('0xabc:7:0');
  });

  it('skips duplicate or unavailable prefetch work', () => {
    expect(
      resolveGroupPrefetchPlan({
        chainId: COTI_CHAIN_ID,
        groups: [{ id: 7, lastBlock: 120 }],
        hasAesReady: true,
        prefetchedKeys: { '0xabc:7:120': true },
        requestedGroupId: 7,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xabc'
      })
    ).toBeNull();

    expect(
      resolveGroupPrefetchPlan({
        chainId: 1,
        groups: [{ id: 7, lastBlock: 120 }],
        hasAesReady: true,
        prefetchedKeys: {},
        requestedGroupId: 7,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xabc'
      })
    ).toBeNull();
  });

  it('plans first-open active-group sync with a wide fast pass and deep backfill', () => {
    expect(
      resolveActiveGroupBackfillPlan({
        activeGroupId: 7,
        chainId: COTI_CHAIN_ID,
        completedBackfillKeys: {},
        hasAesReady: true,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xABC',
        walletAddressValid: true
      })
    ).toEqual({
      cacheKey: '0xabc:7',
      fastOptions: {
        background: true,
        activeMessagesOnly: true,
        wideLoad: true
      },
      deepOptions: {
        background: true,
        activeMessagesOnly: true,
        deep: true
      }
    });
  });

  it('plans later active-group sync without repeating the deep backfill', () => {
    expect(
      resolveActiveGroupBackfillPlan({
        activeGroupId: 7,
        chainId: COTI_CHAIN_ID,
        completedBackfillKeys: { '0xabc:7': true },
        hasAesReady: true,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xABC',
        walletAddressValid: true
      })
    ).toEqual({
      cacheKey: '0xabc:7',
      fastOptions: {
        background: true,
        activeMessagesOnly: true,
        wideLoad: false
      },
      deepOptions: undefined
    });
  });

  it('skips active-group backfill planning when wallet, AES, network, or group id is invalid', () => {
    expect(
      resolveActiveGroupBackfillPlan({
        activeGroupId: 0,
        chainId: COTI_CHAIN_ID,
        completedBackfillKeys: {},
        hasAesReady: true,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xabc',
        walletAddressValid: true
      })
    ).toBeNull();

    expect(
      resolveActiveGroupBackfillPlan({
        activeGroupId: 7,
        chainId: COTI_CHAIN_ID,
        completedBackfillKeys: {},
        hasAesReady: true,
        requiredChainId: COTI_CHAIN_ID,
        walletAddress: '0xabc',
        walletAddressValid: false
      })
    ).toBeNull();
  });
});

describe('group sync event helpers', () => {
  it('extracts group ids from direct event args and event-like values', () => {
    expect(resolveGroupIdFromEvent(12)).toBe(12);
    expect(resolveGroupIdFromEvent({ args: { groupId: 34 } })).toBe(34);
    expect(resolveGroupIdFromEvent({ args: { groupId: 0 } })).toBe(0);
  });

  it('collects unique overview group ids from invite, member, and join-code style logs', () => {
    expect(
      collectGroupIdsFromLogs([
        { args: { groupId: 1 } },
        { args: { groupId: 2 } },
        { args: { groupId: 1 } },
        { args: { groupId: '3' } },
        { args: { groupId: 0 } }
      ])
    ).toEqual([1, 2, 3]);
  });

  it('keeps the latest removal marker per group for member-change notices', () => {
    const result = collectLatestGroupRemovalEvents([
      { args: { groupId: 7 }, blockNumber: 10, index: 1, transactionHash: '0xaaa' },
      { args: { groupId: 7 }, blockNumber: 10, index: 3, transactionHash: '0xbbb' },
      { args: { groupId: 8 }, blockNumber: 11, index: 1, transactionHash: '0xccc' },
      { args: { groupId: 0 }, blockNumber: 12, index: 1, transactionHash: '0xddd' }
    ]);

    expect(result.groupIds).toEqual([7, 8]);
    expect(result.eventByGroupId.get(7)).toEqual({
      blockNumber: 10,
      logIndex: 3,
      marker: '10:3:0xbbb'
    });
    expect(result.eventByGroupId.get(8)?.marker).toBe('11:1:0xccc');
  });

  it('routes realtime messages for the active group to active-message sync', () => {
    expect(resolveRealtimeGroupSyncOptions({ args: { groupId: 5 } }, 5)).toEqual({ activeMessagesOnly: true });
  });

  it('routes realtime messages for inactive groups to overview sync', () => {
    expect(resolveRealtimeGroupSyncOptions({ args: { groupId: 6 } }, 5)).toEqual({ overviewOnly: true });
  });

  it('keeps unknown realtime group ids scoped to the active group when one is open', () => {
    expect(resolveRealtimeGroupSyncOptions({ args: {} }, 5)).toEqual({ activeMessagesOnly: true });
  });
});
