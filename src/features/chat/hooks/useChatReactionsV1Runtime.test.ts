import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useChatReactionsV1Runtime from './useChatReactionsV1Runtime';
import type { ChatReactionsV1Runtime } from '../../../lib/chatReactionsV1Runtime';

const hooks = vi.hoisted(() => ({
  states: [] as any[], refs: [] as any[], effects: [] as any[], commits: [] as Array<() => void>,
  stateIndex: 0, refIndex: 0, effectIndex: 0,
  sources: [] as any[]
}));
vi.mock('react', () => ({
  useMemo: (read: () => unknown) => read(),
  useCallback: (callback: unknown) => callback,
  useRef: (value: unknown) => hooks.refs[hooks.refIndex++] ??= { current: value },
  useState: (value: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = typeof value === 'function' ? value() : value;
    return [hooks.states[index], (next: any) => {
      hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next;
    }];
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.effectIndex++;
    const old = hooks.effects[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) {
      hooks.commits.push(() => { old?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() }; });
    }
  }
}));
vi.mock('../../../lib/chatReactionsV1Messages', () => ({
  collectChatReactionSources: () => hooks.sources,
  retainPendingChatReactionStates: ({ pendingStates }: any) => pendingStates
}));
const Render = (runtime: ChatReactionsV1Runtime | null, deferSync: boolean) => {
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = 0;
  const view = useChatReactionsV1Runtime({ runtime, deferSync, activeThreadMessages: [] });
  hooks.commits.splice(0).forEach(commit => commit());
  return view;
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.commits = [];
  hooks.sources = [{ kind: 'direct', chainId: '1', contractAddress: 'chat', conversationId: 'selected', messageId: '1', blockNumber: '1', blockHash: 'hash', transactionHash: 'tx', logIndex: 0 }];
  vi.useFakeTimers(); vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  hooks.effects.forEach(effect => effect.cleanup?.());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('does not start synchronization or a polling timer for an empty selection', async () => {
  hooks.sources = [];
  const sync = vi.fn();
  Render({ sync } as unknown as ChatReactionsV1Runtime, false);
  await vi.advanceTimersByTimeAsync(24_000);
  expect(sync).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps writes unavailable until the selected sources have completed a canonical sync', async () => {
  let finish!: (value: unknown) => void;
  const sync = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const runtime = { sync } as unknown as ChatReactionsV1Runtime;
  expect(Render(runtime, true).enabled).toBe(false);
  expect(sync).not.toHaveBeenCalled();
  expect(Render(runtime, false).enabled).toBe(false);
  finish({ states: [], safeHeadBlock: '10' }); await flush();
  expect(Render(runtime, false).enabled).toBe(true);
  hooks.sources = [{ ...hooks.sources[0], messageId: '2', blockNumber: '2' }];
  expect(Render(runtime, false).enabled).toBe(false);
});

it.each([true, false])('rejects writes before first sync when deferred is %s', async (deferred) => {
  const setReaction = vi.fn().mockResolvedValue({ event: { stateKey: 'reaction' } });
  const runtime = { sync: vi.fn(() => new Promise(() => {})), setReaction } as unknown as ChatReactionsV1Runtime;
  const view = Render(runtime, deferred);
  await expect(view.submitReaction({
    source: hooks.sources[0], emoji: '👍', active: true, operationId: 'operation'
  })).rejects.toThrow();
  expect(setReaction).not.toHaveBeenCalled();
});

it('sends after sync and rejects callbacks from a changed or deferred view', async () => {
  const setReaction = vi.fn().mockResolvedValue({ event: { stateKey: 'reaction' } });
  const sync = vi.fn().mockResolvedValue({ states: [], safeHeadBlock: '10' });
  const runtime = { sync, setReaction } as unknown as ChatReactionsV1Runtime;
  const input = { source: hooks.sources[0], emoji: '👍', active: false, operationId: 'operation' };
  Render(runtime, false); await flush();
  const ready = Render(runtime, false);
  expect(ready.enabled).toBe(true);
  await ready.submitReaction(input);
  expect(setReaction).toHaveBeenCalledOnce();

  Render(runtime, true);
  await expect(ready.submitReaction(input)).rejects.toThrow();
  Render(runtime, false); await flush();
  const resumed = Render(runtime, false);
  hooks.sources = [{ ...hooks.sources[0], messageId: '2', blockNumber: '2' }];
  expect(Render(runtime, false).enabled).toBe(false);
  await expect(resumed.submitReaction(input)).rejects.toThrow();
  hooks.sources = [input.source];
  Render(runtime, false); await flush();
  const priorRuntime = Render(runtime, false);
  Render({ sync } as unknown as ChatReactionsV1Runtime, false);
  await expect(priorRuntime.submitReaction(input)).rejects.toThrow();
  expect(setReaction).toHaveBeenCalledOnce();
});

it('invalidates the read guard and hides old totals when the selected source changes', async () => {
  const sync = vi.fn().mockResolvedValue({ states: [{ stateKey: 'old' }], safeHeadBlock: '10' });
  const runtime = { sync } as unknown as ChatReactionsV1Runtime;
  Render(runtime, false); await flush();
  const guard = sync.mock.calls[0][1];
  expect(guard()).toBe(true);
  hooks.sources = [{ ...hooks.sources[0], messageId: '2', blockNumber: '2' }];
  expect(Render(runtime, false).states).toEqual([]);
  expect(guard()).toBe(false);
  await flush();
  expect(sync).toHaveBeenCalledTimes(2);
});

it('pauses an admitted reaction reader without closing it or losing accepted states, then resumes', async () => {
  const state = { stateKey: 'verified' };
  const sync = vi.fn().mockResolvedValue({ states: [state], safeHeadBlock: 10n });
  const close = vi.fn();
  const runtime = { sync, close } as unknown as ChatReactionsV1Runtime;
  Render(runtime, true);
  await vi.advanceTimersByTimeAsync(24_000);
  expect(sync).not.toHaveBeenCalled();
  Render(runtime, false); await flush();
  expect(sync).toHaveBeenCalledTimes(1);
  expect(Render(runtime, true).states).toEqual([state]);
  await vi.advanceTimersByTimeAsync(24_000);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(Render(runtime, true).states).toEqual([state]);
  Render(runtime, false); await flush();
  expect(sync).toHaveBeenCalledTimes(2);
  expect(close).not.toHaveBeenCalled();
});

it('rejects a late paused read and clears private projection when the owner runtime changes', async () => {
  let finish!: (value: unknown) => void;
  const old = { sync: vi.fn(() => new Promise(resolve => { finish = resolve; })) } as unknown as ChatReactionsV1Runtime;
  const next = { sync: vi.fn().mockResolvedValue({ states: [], safeHeadBlock: 11n }) } as unknown as ChatReactionsV1Runtime;
  Render(old, false);
  Render(old, true);
  finish({ states: [{ stateKey: 'obsolete' }], safeHeadBlock: 10n }); await flush();
  expect(Render(old, true).states).toEqual([]);
  Render(next, true);
  expect(Render(next, true).states).toEqual([]);
  expect(next.sync).not.toHaveBeenCalled();
  Render(next, false); await flush();
  expect(next.sync).toHaveBeenCalledTimes(1);
});
