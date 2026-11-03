import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LinkActivity, { useLinkTradeV2Activity } from './LinkTradeV2Activity';
import CounterActivity, { useCounterTradeV2Activity } from './CounterTradeV2Activity';

vi.mock('./LinkTradeV2OwnerControls', () => ({ default: () => null }));
vi.mock('./CounterTradeV2Controls', () => ({ CounterTradeV2ParticipantControls: () => null }));
// Reuse the App's hook-test pattern; no wallet or browser is needed.
const hooks = vi.hoisted(() => ({ index: 0, slots: [] as {
  value?: unknown; deps?: readonly unknown[]; cleanup?: () => void
}[], effects: [] as (() => void)[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const memo = (factory: () => unknown, deps: readonly unknown[]) => {
    const i = hooks.index++, previous = hooks.slots[i];
    if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]))) hooks.slots[i] = { value: factory(), deps };
    return hooks.slots[i].value;
  };
  return { ...actual,
    useRef: (initial: unknown) => (hooks.slots[hooks.index++] ??= { value: { current: initial } }).value,
    useState: (initial: unknown) => {
      const i = hooks.index++; hooks.slots[i] ??= { value: initial };
      return [hooks.slots[i].value, (value: unknown) => {
        hooks.slots[i].value = typeof value === 'function' ? value(hooks.slots[i].value) : value;
      }];
    },
    useMemo: memo,
    useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
    useEffect: (effect: () => (() => void) | undefined, deps: readonly unknown[]) => {
      const i = hooks.index++, previous = hooks.slots[i];
      if (!previous || deps.some((dep, n) => !Object.is(dep, previous.deps?.[n]))) {
        hooks.slots[i] = { deps, cleanup: previous?.cleanup };
        hooks.effects.push(() => { hooks.slots[i].cleanup?.(); hooks.slots[i].cleanup = effect(); });
      }
    }
  };
});
const owner = `0x${'11'.repeat(20)}`;
const snapshot = { orders: [], history: [], complete: false, fromBlock: '2951', throughBlock: '4998', safeHead: '4998', phase: 'scan' as const };
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => { hooks.slots.forEach(slot => slot.cleanup?.()); vi.unstubAllGlobals(); });

describe.each(['link', 'counter'] as const)('%s recent activity UI', kind => {
  const useActivity = kind === 'link' ? useLinkTradeV2Activity : useCounterTradeV2Activity;
  const fixture = () => {
    const runtime = { ownerAddress: owner, syncActivity: vi.fn(async (_onProgress?: (value: typeof snapshot) => void, _mode?: 'latest' | 'older') => snapshot) };
    const args = { runtime: runtime as never, ownerAddress: owner, enabled: true, ensureTokenInfo: async () => {} };
    const useRender = () => {
      hooks.index = 0;
      const result = useActivity(args);
      hooks.effects.splice(0).forEach(effect => effect());
      return result;
    };
    return { runtime, args, render: useRender };
  };
  it('loads one window, then keeps Refresh latest and Load older distinct', async () => {
    const f = fixture(); f.render(); await flush();
    const activity = f.render();
    expect(activity.snapshot).toEqual(snapshot); expect(activity.busy).toBe(false);
    expect(f.runtime.syncActivity).toHaveBeenCalledOnce();
    expect(f.runtime.syncActivity.mock.calls[0][1]).toBe('latest');
    await activity.loadOlder();
    expect(f.runtime.syncActivity.mock.calls[1][1]).toBe('older');
    await f.render().refresh();
    expect(f.runtime.syncActivity.mock.calls[2][1]).toBe('latest');
  });
  it('retains the committed snapshot and stops after a failed older read', async () => {
    const f = fixture(); f.render(); await flush();
    f.runtime.syncActivity.mockRejectedValueOnce(new Error('RPC unavailable'));
    await f.render().loadOlder();
    const activity = f.render();
    expect(activity.snapshot).toEqual(snapshot); expect(activity.error).toMatch(/could not refresh/);
    expect(f.runtime.syncActivity).toHaveBeenCalledTimes(2);
  });
  it('rejects a late private result across lock and unlock with the same runtime', async () => {
    const f = fixture();
    let resolve!: (value: typeof snapshot) => void;
    const held = new Promise<typeof snapshot>(done => { resolve = done; });
    f.runtime.syncActivity.mockImplementationOnce(() => held);
    f.render(); await flush();
    f.args.enabled = false; expect(f.render().snapshot).toBeUndefined();
    f.args.enabled = true; f.render(); await flush();
    resolve({ ...snapshot, safeHead: 'private-stale' }); await flush();
    expect(f.render().snapshot?.safeHead).toBe('4998');
    expect(f.runtime.syncActivity).toHaveBeenCalledTimes(2);
  });
  it('shows accessible older/refresh controls and incomplete active-order coverage', () => {
    const Component = kind === 'link' ? LinkActivity : CounterActivity;
    const props = { activity: { snapshot, busy: false, error: '', refresh: async () => {}, loadOlder: async () => {} },
      runtime: { ownerAddress: owner }, lifecycle: 'active', activeFilter: 'all', tokenInfoByKey: {}, ensureTokenInfo: async () => {},
      search: '', pairFilter: 'all', typeFilter: 'all', sortMode: 'newest', confirmFunding: async () => {}, runWalletFlow: async () => {},
      onBusyChange: () => {}, actionInProgress: false };
    const html = renderToStaticMarkup(<Component {...props as unknown as Parameters<typeof LinkActivity>[0] & Parameters<typeof CounterActivity>[0]} />);
    expect(html).toContain('Refresh latest'); expect(html).toContain('Load older');
    expect(html).toContain('History is incomplete.'); expect(html).not.toMatch(/No (shared trades|counter-offers)/);
    expect(html).toContain('2951'); expect(html).toContain('4998');
  });
  it('loads older on a near-bottom scroll, with no load at mount', () => {
    const Component = kind === 'link' ? LinkActivity : CounterActivity;
    const loadOlder = vi.fn(), addEventListener = vi.fn(), removeEventListener = vi.fn();
    vi.stubGlobal('window', { innerHeight: 800, addEventListener, removeEventListener });
    const props = { activity: { snapshot, busy: false, error: '', refresh: async () => {}, loadOlder },
      runtime: { ownerAddress: owner }, lifecycle: 'history', activeFilter: 'all', tokenInfoByKey: {}, ensureTokenInfo: async () => {},
      search: '', pairFilter: 'all', typeFilter: 'all', sortMode: 'newest', confirmFunding: async () => {}, runWalletFlow: async () => {},
      onBusyChange: () => {}, actionInProgress: false };
    renderToStaticMarkup(<Component {...props as unknown as Parameters<typeof LinkActivity>[0] & Parameters<typeof CounterActivity>[0]} />);
    (hooks.slots[0].value as { current: unknown }).current = { getBoundingClientRect: () => ({ top: 850, bottom: 860 }) };
    hooks.effects.splice(0).forEach(effect => effect());
    expect(loadOlder).not.toHaveBeenCalled();
    const scroll = addEventListener.mock.calls.find(([event]) => event === 'scroll')![1] as () => void;
    scroll(); expect(loadOlder).toHaveBeenCalledOnce();
  });
});
