import { describe, expect, it } from 'vitest';
import type { OtcTradeHistoryV2Runtime } from '../../../lib/otcTradeHistoryV2Runtime';
import {
  loadCompleteVerifiedOtcHistory,
  shouldDisplayVerifiedOtcHistoryRows,
  shouldPreserveVerifiedOtcHistoryRows
} from './useOtcTradeHistoryV2Data';

const runtime = (current = true): OtcTradeHistoryV2Runtime => ({
  isCurrent: () => current
} as OtcTradeHistoryV2Runtime);

describe('shouldPreserveVerifiedOtcHistoryRows', () => {
  it('retains verified rows only for a transient failure in the same live runtime', () => {
    const failedRuntime = runtime();

    expect(shouldPreserveVerifiedOtcHistoryRows({
      activeRuntime: failedRuntime,
      failedRuntime
    })).toBe(true);
    expect(shouldPreserveVerifiedOtcHistoryRows({
      activeRuntime: runtime(),
      failedRuntime
    })).toBe(false);
    const closedRuntime = runtime(false);
    expect(shouldPreserveVerifiedOtcHistoryRows({
      activeRuntime: closedRuntime,
      failedRuntime: closedRuntime
    })).toBe(false);
  });

  it('keeps verified rows through a same-scope runtime replacement but never across account or network scope', () => {
    expect(shouldDisplayVerifiedOtcHistoryRows({
      activeScopeKey: 'candidate:7082400:0xowner',
      verifiedScopeKey: 'candidate:7082400:0xowner'
    })).toBe(true);
    expect(shouldDisplayVerifiedOtcHistoryRows({
      activeScopeKey: 'candidate:7082400:0xother',
      verifiedScopeKey: 'candidate:7082400:0xowner'
    })).toBe(false);
    expect(shouldDisplayVerifiedOtcHistoryRows({
      activeScopeKey: 'candidate:1:0xowner',
      verifiedScopeKey: 'candidate:7082400:0xowner'
    })).toBe(false);
    expect(shouldDisplayVerifiedOtcHistoryRows({
      activeScopeKey: '',
      verifiedScopeKey: 'candidate:7082400:0xowner'
    })).toBe(false);
  });

  it('publishes portfolio rows only after every backfill page is complete', async () => {
    let page = 0;
    let publishedEarly = false;
    const rows = [{ key: 'final-row' }] as never;
    const lifecycleEvents = [{ kind: 'lifecycle' }] as never;
    const backfillRuntime = {
      isCurrent: () => true,
      sync: async () => ({ hasMore: ++page < 3 }),
      rows: () => {
        if (page < 3) publishedEarly = true;
        return rows;
      },
      lifecycleEvents: () => lifecycleEvents
    } as unknown as OtcTradeHistoryV2Runtime;
    let pauses = 0;

    const complete = await loadCompleteVerifiedOtcHistory({
      runtime: backfillRuntime,
      pauseBetweenPages: async () => { pauses += 1; }
    });

    expect(page).toBe(3);
    expect(pauses).toBe(2);
    expect(publishedEarly).toBe(false);
    expect(complete).toEqual({ rows, lifecycleEvents });
  });

  it('does not publish rows if the wallet runtime changes during pagination', async () => {
    let current = true;
    let rowsRead = false;
    const backfillRuntime = {
      isCurrent: () => current,
      sync: async () => ({ hasMore: true }),
      rows: () => {
        rowsRead = true;
        return [];
      },
      lifecycleEvents: () => []
    } as unknown as OtcTradeHistoryV2Runtime;

    await expect(loadCompleteVerifiedOtcHistory({
      runtime: backfillRuntime,
      pauseBetweenPages: async () => { current = false; }
    })).rejects.toThrow(/changed during backfill/i);
    expect(rowsRead).toBe(false);
  });

  it('scans and publishes only the requested deployment, not cached legacy history', async () => {
    const book = '0x1111111111111111111111111111111111111111';
    const old = '0x2222222222222222222222222222222222222222';
    const requested: unknown[] = [];
    const currentRow = { order: { contractAddress: book } };
    const currentEvent = { contractAddress: book };
    const scopedRuntime = {
      isCurrent: () => true,
      sync: async (contracts: unknown) => { requested.push(contracts); return { hasMore: false }; },
      rows: () => [currentRow, { order: { contractAddress: old } }],
      lifecycleEvents: () => [currentEvent, { contractAddress: old }]
    } as unknown as OtcTradeHistoryV2Runtime;
    const result = await loadCompleteVerifiedOtcHistory({ runtime: scopedRuntime, contractAddresses: [book] });
    expect(requested).toEqual([[book]]);
    expect(result).toEqual({ rows: [currentRow], lifecycleEvents: [currentEvent] });
  });
});
