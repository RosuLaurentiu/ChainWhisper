import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../lib/appShared/core';
import { GroupChatV2EpochEnvelopeSyncRequiredError } from '../../../lib/groupChatV2Chain';
import type { GroupChatV2Runtime } from '../../../lib/groupChatV2Runtime';
import type { GroupChatV2HistorySyncResult } from '../../../lib/groupChatV2HistoryRuntime';
import useGroupChatV2History from './useGroupChatV2History';

// Existing local hook-test pattern: state, dependencies and effect cleanup,
// with no DOM, provider, privacy material or network.
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as {
  value?: unknown; deps?: readonly unknown[]; cleanup?: () => void
}[], effects: [] as (() => void)[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useRef: (initial: unknown) => {
      const i = hooks.index++;
      return (hooks.slots[i] ??= { value: { current: initial } }).value;
    },
    useState: (initial: unknown) => {
      const i = hooks.index++;
      hooks.slots[i] ??= { value: initial };
      return [hooks.slots[i].value, (value: unknown) => {
        hooks.slots[i].value = typeof value === 'function' ? value(hooks.slots[i].value) : value;
      }];
    },
    useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
      const i = hooks.index++, old = hooks.slots[i];
      if (!old || deps.some((dep, index) => !Object.is(dep, old.deps?.[index]))) {
        hooks.slots[i] = { deps, cleanup: old?.cleanup };
        hooks.effects.push(() => { hooks.slots[i].cleanup?.(); hooks.slots[i].cleanup = effect(); });
      }
    }
  };
});
vi.mock('../../../lib/groupMessageSync', () => ({
  mergeGroupMessageEntries: (existing: ChatMessage[], entries: ChatMessage[]) => [...existing, ...entries]
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const page = (nextBlock = 111n, groupId = 4n): GroupChatV2HistorySyncResult => ({
  groupId, entries: [], resetConversation: false, safeHead: 110n,
  checkpoint: { groupId, nextBlock, lastMessageId: 0n, boundaryBlockNumber: nextBlock - 1n,
    boundaryBlockHash: `0x${'11'.repeat(32)}` }
});
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
function fixture() {
  const sync = vi.fn(async (groupId: bigint, accept?: (value: GroupChatV2HistorySyncResult) => boolean) => {
    const result = page(111n, groupId); accept?.(result); return result;
  });
  const current = { value: true };
  const runtime = { enabled: true, isCurrent: () => current.value, history: { sync } } as unknown as Extract<GroupChatV2Runtime, { enabled: true }>;
  const onLoadStart = vi.fn(), onLoadEnd = vi.fn();
  const args = { runtime, activeGroupId: 4 as number | null, activeGroupIdRef: { current: 4 as number | null },
    hasAesReady: true, refreshNonce: 0, setMessagesByGroup: vi.fn(), setEpochSyncRequest: vi.fn(),
    onLoadStart, onLoadEnd };
  const Render = (effects = true) => {
    hooks.index = 0;
    const result = useGroupChatV2History(args);
    if (effects) hooks.effects.splice(0).forEach(effect => effect());
    return result;
  };
  const unmount = () => { hooks.slots.forEach(slot => slot.cleanup?.()); hooks.effects = []; };
  return { args, sync, current, onLoadStart, onLoadEnd, render: Render, unmount };
}

beforeEach(async () => {
  hooks.index = 0; hooks.slots = []; hooks.effects = [];
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  await import('../../../lib/groupMessageSync');
});
afterEach(() => { hooks.slots.forEach(slot => slot.cleanup?.()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Group V2 history loading and availability', () => {
  it('brackets a deferred initial read once and does not flash loading on background polls', async () => {
    const f = fixture(), waiting = deferred<GroupChatV2HistorySyncResult>();
    f.sync.mockImplementationOnce(async (_id, accept) => { const result = await waiting.promise; accept?.(result); return result; });
    f.render(); await flush();
    expect(f.onLoadStart).toHaveBeenCalledExactlyOnceWith(4);
    expect(f.onLoadEnd).not.toHaveBeenCalled();
    waiting.resolve(page()); await flush();
    expect(f.onLoadEnd).toHaveBeenCalledExactlyOnceWith(4);
    expect(f.render().historyUnavailable).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.sync).toHaveBeenCalledTimes(2);
    expect(f.onLoadStart).toHaveBeenCalledOnce();
    expect(f.onLoadEnd).toHaveBeenCalledOnce();
  });

  it('retains loading while more pages remain', async () => {
    const f = fixture(), waiting = deferred<GroupChatV2HistorySyncResult>();
    f.sync.mockResolvedValueOnce(page(100n)).mockImplementationOnce(() => waiting.promise);
    f.render(); await flush();
    expect(f.sync).toHaveBeenCalledTimes(2);
    expect(f.onLoadStart).toHaveBeenCalledOnce();
    expect(f.onLoadEnd).not.toHaveBeenCalled();
    waiting.resolve(page()); await flush();
    expect(f.onLoadEnd).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('returns only scoped unavailable state for failure and clears it after a successful retry', async () => {
    const f = fixture();
    f.sync.mockRejectedValueOnce(new Error('provider payload must stay private'));
    f.render(); await flush();
    expect(f.render()).toEqual({ historyUnavailable: true });
    expect(f.onLoadEnd).toHaveBeenCalledExactlyOnceWith(4);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.render().historyUnavailable).toBe(false);
    expect(f.onLoadStart).toHaveBeenCalledOnce();
  });

  it('ends loading and retains the exact key-sync-required path without a retry timer', async () => {
    const f = fixture();
    f.sync.mockRejectedValueOnce(new GroupChatV2EpochEnvelopeSyncRequiredError(4n, 2n));
    f.render(); await flush();
    expect(f.args.setEpochSyncRequest).toHaveBeenCalledWith({ groupId: 4, epoch: 2n });
    expect(f.render().historyUnavailable).toBe(false);
    expect(f.onLoadEnd).toHaveBeenCalledExactlyOnceWith(4);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.sync).toHaveBeenCalledOnce();
  });

  it('rejects a deferred old view without clearing the new Group loading phase', async () => {
    const f = fixture(), old = deferred<GroupChatV2HistorySyncResult>(), next = deferred<GroupChatV2HistorySyncResult>();
    f.sync.mockImplementationOnce(async (_id, accept) => { const result = await old.promise; accept?.(result); return result; })
      .mockImplementationOnce(() => next.promise);
    f.render(); await flush();
    f.args.activeGroupId = 5; f.args.activeGroupIdRef.current = 5;
    f.render(); await flush();
    old.resolve(page()); await flush();
    expect(f.onLoadStart.mock.calls).toEqual([[4], [5]]);
    expect(f.onLoadEnd).not.toHaveBeenCalled();
    expect(f.args.setMessagesByGroup).not.toHaveBeenCalled();
    next.resolve(page(111n, 5n)); await flush();
    expect(f.onLoadEnd).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('scopes failure to the runtime and refresh and cancels old completion on manual refresh', async () => {
    const f = fixture(); f.sync.mockRejectedValueOnce(new Error('read unavailable'));
    f.render(); await flush(); expect(f.render().historyUnavailable).toBe(true);
    const old = deferred<GroupChatV2HistorySyncResult>(), next = deferred<GroupChatV2HistorySyncResult>();
    f.sync.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => next.promise);
    f.args.refreshNonce++; expect(f.render(false).historyUnavailable).toBe(false);
    f.render(); await flush();
    f.args.refreshNonce++; f.render(); await flush();
    const ends = f.onLoadEnd.mock.calls.length;
    old.resolve(page()); await flush();
    expect(f.onLoadEnd).toHaveBeenCalledTimes(ends);
    next.resolve(page()); await flush();
    expect(f.onLoadEnd).toHaveBeenCalledTimes(ends + 1);
    expect(f.render().historyUnavailable).toBe(false);
  });

  it('cleans up an unfinished current load once and ignores its later result', async () => {
    const f = fixture(), waiting = deferred<GroupChatV2HistorySyncResult>();
    f.sync.mockImplementationOnce(() => waiting.promise);
    f.render(); await flush(); f.unmount();
    expect(f.onLoadEnd).toHaveBeenCalledExactlyOnceWith(4);
    waiting.resolve(page()); await flush();
    expect(f.onLoadEnd).toHaveBeenCalledOnce();
  });

  it('ignores old runtime failure and completion for the same Group after a wallet scope replacement', async () => {
    const f = fixture(), old = deferred<GroupChatV2HistorySyncResult>(), next = deferred<GroupChatV2HistorySyncResult>();
    f.sync.mockImplementationOnce(async () => { await old.promise; throw new Error('old runtime failed'); })
      .mockImplementationOnce(() => next.promise);
    f.render(); await flush();
    f.current.value = false;
    f.args.runtime = { ...f.args.runtime, isCurrent: () => true };
    expect(f.render(false).historyUnavailable).toBe(false);
    f.render(); await flush();
    old.resolve(page()); await flush();
    expect(f.onLoadStart.mock.calls).toEqual([[4], [4]]);
    expect(f.onLoadEnd).not.toHaveBeenCalled();
    expect(f.render().historyUnavailable).toBe(false);
    next.resolve(page()); await flush();
    expect(f.onLoadEnd).toHaveBeenCalledExactlyOnceWith(4);
  });
});
