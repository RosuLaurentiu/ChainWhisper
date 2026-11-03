import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OtcTradeHistoryV2Runtime } from '../../../lib/otcTradeHistoryV2Runtime';
import {
  default as useOtcTradeHistoryV2Data,
  loadVerifiedOtcHistoryPage,
  shouldDisplayVerifiedOtcHistoryRows,
  shouldPreserveVerifiedOtcHistoryRows
} from './useOtcTradeHistoryV2Data';
import { isP2PParticipantReadPassPending, shouldLoadP2PTradeHistory } from '../components/P2PTradingPage.helpers';
import { shouldDeferBrowserRuntimeStartup } from '../../../lib/browserWalletRuntimeScope';

// Reuse the local state/effect harness pattern from the DEX hook tests.
const hooks = vi.hoisted(() => ({ enabled: false, index: 0,
  slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[] }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual,
    useRef: (initial: unknown) => !hooks.enabled ? actual.useRef(initial)
      : (hooks.slots[hooks.index++] ??= { value: { current: initial } }).value,
    useState: (initial: unknown) => {
      if (!hooks.enabled) return actual.useState(initial);
      const index = hooks.index++;
      hooks.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks.slots[index].value, (next: unknown) => {
        hooks.slots[index].value = typeof next === 'function' ? next(hooks.slots[index].value) : next;
      }];
    },
    useCallback: (callback: () => unknown, deps: readonly unknown[]) => {
      if (!hooks.enabled) return actual.useCallback(callback, deps);
      const index = hooks.index++, previous = hooks.slots[index];
      if (!previous || deps.some((dep, key) => !Object.is(dep, previous.deps?.[key]))) hooks.slots[index] = { value: callback, deps };
      return hooks.slots[index].value;
    },
    useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
      if (!hooks.enabled) return actual.useEffect(effect, deps);
      const index = hooks.index++, previous = hooks.slots[index];
      if (!previous || deps.some((dep, key) => !Object.is(dep, previous.deps?.[key]))) {
        hooks.slots[index] = { deps, cleanup: previous?.cleanup };
        hooks.effects.push(() => {
          hooks.slots[index].cleanup?.();
          hooks.slots[index].cleanup = effect() || undefined;
        });
      }
    }
  };
});
afterEach(() => {
  hooks.slots.forEach(slot => slot.cleanup?.());
  hooks.enabled = false; hooks.index = 0; hooks.slots = []; hooks.effects = [];
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('candidate canonical History coverage marker', () => {
  const contracts = ['0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'];
  const attribute = 'data-p2p-canonical-history';
  const fixture = () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'coti-testnet-candidate');
    const attributes = new Map<string, string>();
    const setAttribute = vi.fn((name: string, value: string) => { attributes.set(name, value); });
    const removeAttribute = vi.fn((name: string) => { attributes.delete(name); });
    vi.stubGlobal('document', { documentElement: { setAttribute, removeAttribute } });
    vi.stubGlobal('window', { setTimeout });
    const sync = vi.fn<(contracts?: readonly string[], mode?: 'latest' | 'older') => Promise<{ hasMore: boolean }>>(async () => ({ hasMore: false }));
    const rows = [{ key: 'private-row-id', source: 'public-event', order: { contractAddress: contracts[0] } }];
    const isCurrent = vi.fn(() => true);
    const current = { isCurrent, sync, rows: () => rows, lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
    const marker = () => JSON.parse(attributes.get(attribute) ?? 'null');
    return { attributes, setAttribute, removeAttribute, sync, rows, isCurrent, current, marker };
  };
  const RenderCoverage = (current: OtcTradeHistoryV2Runtime | null, enabled = true,
    scope = 'candidate:owner-session-secret') => {
    hooks.enabled = true;
    hooks.index = 0;
    const result = useOtcTradeHistoryV2Data(current, scope, contracts, true, enabled);
    hooks.effects.splice(0).forEach(effect => effect());
    return result;
  };

  it('distinguishes committed partial pages from guarded complete coverage without private payload', async () => {
    const source = fixture();
    let release!: (value: { hasMore: boolean }) => void;
    const held = new Promise<{ hasMore: boolean }>(resolve => { release = resolve; });
    source.sync.mockResolvedValueOnce({ hasMore: true }).mockImplementationOnce(() => held);
    RenderCoverage(source.current);
    expect(source.marker()?.state).toBe('loading');
    await vi.waitFor(() => expect(source.marker()?.state).toBe('partial'));
    expect(source.marker()).toEqual({ state: 'partial', requestedContractAddresses: contracts,
      privateReadsEnabled: true, sampledAt: expect.any(Number) });
    const partial = RenderCoverage(source.current);
    expect(partial.otcTradeHistoryV2Rows).toEqual(source.rows);
    expect(partial.loadingOtcTradeHistoryV2).toBe(false);
    expect(partial.hasMoreOtcTradeHistoryV2).toBe(true);
    expect(source.sync).toHaveBeenCalledTimes(1);
    partial.loadOlderOtcTradeHistoryV2(); partial.loadOlderOtcTradeHistoryV2();
    RenderCoverage(source.current);
    expect(source.sync).toHaveBeenCalledTimes(2);
    expect(source.sync.mock.calls).toEqual([[contracts, 'latest'], [contracts, 'older']]);
    release({ hasMore: false });
    await vi.waitFor(() => expect(source.marker()?.state).toBe('complete'));
    expect(RenderCoverage(source.current).loadingOtcTradeHistoryV2).toBe(false);
    const payload = source.setAttribute.mock.calls.map(([, value]) => value).join('');
    expect(payload).not.toMatch(/owner-session-secret|private-row-id|amount|cipher|key/i);
    expect(source.sync).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable and deferred without reads, then resumes and removes completed state on cleanup', async () => {
    const source = fixture();
    RenderCoverage(null);
    expect(source.marker()?.state).toBe('unavailable');
    RenderCoverage(source.current, false);
    expect(source.marker()?.state).toBe('deferred');
    expect(source.sync).not.toHaveBeenCalled();
    RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('complete'));
    RenderCoverage(null);
    expect(source.marker()?.state).toBe('unavailable');
    hooks.slots.forEach(slot => slot.cleanup?.());
    expect(source.attributes.has(attribute)).toBe(false);
  });

  it('does not let a cancelled read overwrite the next scope or leave completed state after cleanup', async () => {
    const source = fixture();
    let release!: (value: { hasMore: boolean }) => void;
    source.sync.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    RenderCoverage(source.current);
    RenderCoverage(null, true, 'candidate:replacement-session-secret');
    expect(source.marker()?.state).toBe('unavailable');
    release({ hasMore: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(source.marker()?.state).toBe('unavailable');
    expect(source.setAttribute.mock.calls.some(([, value]) => JSON.parse(value).state === 'complete')).toBe(false);
    hooks.slots.forEach(slot => slot.cleanup?.());
    expect(source.attributes.has(attribute)).toBe(false);
  });

  it('reports failure without error content and keeps the existing hook error', async () => {
    const source = fixture();
    source.sync.mockRejectedValueOnce(new Error('private error payload'));
    RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('error'));
    expect(RenderCoverage(source.current).otcTradeHistoryV2Error).toContain('private error payload');
    expect(source.attributes.get(attribute)).not.toContain('private error payload');
    expect(source.sync).toHaveBeenCalledOnce();
  });

  it('retains a verified page on an older error, retries one page, then refreshes latest', async () => {
    const source = fixture();
    source.sync.mockResolvedValueOnce({ hasMore: true }).mockRejectedValueOnce(new Error('Older page unavailable'));
    RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('partial'));
    const first = RenderCoverage(source.current);
    first.loadOlderOtcTradeHistoryV2(); first.loadOlderOtcTradeHistoryV2(); RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('error'));
    const failed = RenderCoverage(source.current);
    expect(failed.otcTradeHistoryV2Rows).toEqual(source.rows);
    expect(failed.hasMoreOtcTradeHistoryV2).toBe(true);
    expect(failed.completeOtcTradeHistoryV2).toBe(false);
    expect(source.sync).toHaveBeenCalledTimes(2);
    failed.loadOlderOtcTradeHistoryV2(); RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('complete'));
    const complete = RenderCoverage(source.current);
    expect(complete.hasMoreOtcTradeHistoryV2).toBe(false);
    complete.loadOlderOtcTradeHistoryV2(); RenderCoverage(source.current);
    expect(source.sync).toHaveBeenCalledTimes(3);
    complete.refreshOtcTradeHistoryV2(); complete.refreshOtcTradeHistoryV2(); RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.sync).toHaveBeenCalledTimes(4));
    expect(source.sync.mock.calls.map(call => call[1])).toEqual(['latest', 'older', 'older', 'latest']);
  });

  it('rejects a previous scope older callback and an in-flight older result after scope replacement', async () => {
    const source = fixture(); source.sync.mockResolvedValueOnce({ hasMore: true });
    RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('partial'));
    const previous = RenderCoverage(source.current);
    let finish!: (value: { hasMore: boolean }) => void;
    source.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    previous.loadOlderOtcTradeHistoryV2(); RenderCoverage(source.current);
    RenderCoverage(null, true, 'new-owner');
    previous.loadOlderOtcTradeHistoryV2();
    expect(source.sync).toHaveBeenCalledTimes(2);
    finish({ hasMore: false }); await Promise.resolve(); await Promise.resolve();
    const next = RenderCoverage(null, true, 'new-owner');
    expect(next.otcTradeHistoryV2Rows).toEqual([]); expect(next.hasMoreOtcTradeHistoryV2).toBe(false);
    expect(source.marker()?.state).toBe('unavailable');
  });

  it('coalesces refreshes during an older read into one later latest page without overlapping reads', async () => {
    const source = fixture(); source.sync.mockResolvedValueOnce({ hasMore: true });
    RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('partial'));
    let finish!: (value: { hasMore: boolean }) => void;
    source.sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    RenderCoverage(source.current).loadOlderOtcTradeHistoryV2(); RenderCoverage(source.current);
    const pending = RenderCoverage(source.current);
    pending.refreshOtcTradeHistoryV2(); pending.refreshOtcTradeHistoryV2();
    RenderCoverage(source.current); expect(source.sync).toHaveBeenCalledTimes(2);
    finish({ hasMore: false });
    await vi.waitFor(() => {
      RenderCoverage(source.current); expect(source.sync).toHaveBeenCalledTimes(3);
    });
    await vi.waitFor(() => expect(source.marker()?.state).toBe('complete'));
    expect(source.sync.mock.calls.map(call => call[1])).toEqual(['latest', 'older', 'latest']);
  });

  it('clears a queued refresh after page failure and waits for a later explicit refresh', async () => {
    const source = fixture(); source.sync.mockResolvedValueOnce({ hasMore: true });
    RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('partial'));
    let reject!: (cause: Error) => void;
    source.sync.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    RenderCoverage(source.current).loadOlderOtcTradeHistoryV2(); RenderCoverage(source.current);
    RenderCoverage(source.current).refreshOtcTradeHistoryV2();
    reject(new Error('RPC page unavailable'));
    await vi.waitFor(() => expect(source.marker()?.state).toBe('error'));
    await Promise.resolve();
    const failed = RenderCoverage(source.current);
    expect(source.sync).toHaveBeenCalledTimes(2);
    expect(failed.otcTradeHistoryV2Rows).toEqual(source.rows);
    expect(failed.otcTradeHistoryV2Error).toBe('RPC page unavailable');
    failed.refreshOtcTradeHistoryV2(); RenderCoverage(source.current);
    await vi.waitFor(() => expect(source.marker()?.state).toBe('complete'));
    expect(source.sync.mock.calls.map(call => call[1])).toEqual(['latest', 'older', 'latest']);
  });

  it('isolates failed diagnostic writes and cleanup from the read result', async () => {
    const source = fixture();
    source.setAttribute.mockImplementation(() => { throw new Error('observer write failed'); });
    source.removeAttribute.mockImplementation(() => { throw new Error('observer cleanup failed'); });
    expect(() => RenderCoverage(source.current)).not.toThrow();
    await vi.waitFor(() => expect(RenderCoverage(source.current).otcTradeHistoryV2Rows).toEqual(source.rows));
    expect(RenderCoverage(source.current).otcTradeHistoryV2Error).toBe('');
    expect(() => hooks.slots.forEach(slot => slot.cleanup?.())).not.toThrow();
    expect(source.sync).toHaveBeenCalledOnce();
  });

  it('does not publish the marker in a production build', async () => {
    const source = fixture();
    vi.stubEnv('MODE', 'production');
    RenderCoverage(source.current);
    await vi.waitFor(() => expect(RenderCoverage(source.current).otcTradeHistoryV2Rows).toEqual(source.rows));
    expect(source.setAttribute).not.toHaveBeenCalled();
    expect(source.removeAttribute).not.toHaveBeenCalled();
  });
});

describe('selected participant pass and automatic broad History', () => {
  const scope = 'candidate:7082400:owner';
  const source = { busy: true, error: '', snapshot: undefined as { complete: boolean } | undefined };
  const defaults = { view: 'mine', privacyReady: true, setupPending: false, setupError: '',
    selectedTrade: false, ownerDiscoverySettled: true, publicDiscoverySettled: true, source };
  const ownerRuntime = { isCurrent: () => true };
  const RenderHistory = (current: OtcTradeHistoryV2Runtime, options: typeof defaults = defaults, dataScopeKey = scope) => {
    hooks.enabled = true; hooks.index = 0;
    const pending = isP2PParticipantReadPassPending({ selected: options.view === 'mine',
      privacyReady: options.privacyReady, setupPending: options.setupPending, setupError: options.setupError,
      sources: [options.source] });
    const enabled = shouldLoadP2PTradeHistory({ ...options, setupFailed: Boolean(options.setupError), participantReadPassPending: pending });
    const result = useOtcTradeHistoryV2Data(current, dataScopeKey, undefined, options.privacyReady, enabled);
    hooks.effects.splice(0).forEach(effect => effect());
    const foregroundPending = pending || options.view === 'mine' && options.privacyReady && result.initialOtcTradeHistoryV2Pending;
    const backgroundDeferred = shouldDeferBrowserRuntimeStartup({ selected: options.view === 'mine', scopeKey: dataScopeKey,
      runtime: ownerRuntime, setupFailed: Boolean(options.setupError), initialDiscovery: { scopeKey: dataScopeKey, runtime: ownerRuntime },
      activeReadPass: { scopeKey: dataScopeKey, pending: foregroundPending } });
    return { ...result, historyEnabled: enabled, backgroundDeferred };
  };
  const fixture = () => {
    const rows = [{ key: 'verified-row', source: 'public-event', order: { contractAddress: 'current' } }];
    const sync = vi.fn(async () => ({ hasMore: false }));
    const current = { isCurrent: () => true, sync, rows: () => rows, lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
    return { rows, sync, current };
  };

  it.each(['partial', 'complete', 'error'] as const)('keeps initial canonical foreground after participants settle and releases on %s', async boundary => {
    vi.stubGlobal('window', { setTimeout });
    let releaseFirst!: (value: { hasMore: boolean }) => void, failFirst!: (error: Error) => void;
    let releaseNext!: (value: { hasMore: boolean }) => void;
    const first = new Promise<{ hasMore: boolean }>((resolve, reject) => { releaseFirst = resolve; failFirst = reject; });
    const next = new Promise<{ hasMore: boolean }>(resolve => { releaseNext = resolve; });
    const sync = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next);
    const current = { isCurrent: () => true, sync, rows: () => [], lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
    const settled = { ...defaults, source: { busy: false, error: '', snapshot: { complete: true } } };
    try {
      expect(RenderHistory(current).backgroundDeferred).toBe(true);
      expect(sync).not.toHaveBeenCalled();
      const initial = RenderHistory(current, settled);
      expect(initial.historyEnabled).toBe(true);
      expect(initial.initialOtcTradeHistoryV2Pending).toBe(true);
      expect(initial.backgroundDeferred).toBe(true);
      expect(sync).toHaveBeenCalledOnce();
      if (boundary === 'error') failFirst(new Error('History unavailable'));
      else releaseFirst({ hasMore: boundary === 'partial' });
      await vi.waitFor(() => expect(RenderHistory(current, settled).backgroundDeferred).toBe(false));
      expect(RenderHistory(current, settled).initialOtcTradeHistoryV2Pending).toBe(false);
      if (boundary === 'partial') {
        expect(RenderHistory(current, settled).loadingOtcTradeHistoryV2).toBe(false);
        expect(sync).toHaveBeenCalledTimes(1);
        RenderHistory(current, settled).loadOlderOtcTradeHistoryV2();
        RenderHistory(current, settled);
        expect(sync).toHaveBeenCalledTimes(2);
        releaseNext({ hasMore: false });
        await vi.waitFor(() => expect(RenderHistory(current, settled).loadingOtcTradeHistoryV2).toBe(false));
      } else {
        expect(RenderHistory(current, settled).loadingOtcTradeHistoryV2).toBe(false);
        expect(sync).toHaveBeenCalledOnce();
      }
      expect(RenderHistory(current, settled).otcTradeHistoryV2Error).toBe(boundary === 'error' ? 'History unavailable' : '');
    } finally { releaseFirst({ hasMore: false }); releaseNext({ hasMore: false }); }
  });

  it('does not restore initial priority on an empty same-scope warm refresh and rejects late old-scope completion', async () => {
    let releaseOld!: (value: { hasMore: boolean }) => void, releaseNew!: (value: { hasMore: boolean }) => void;
    const oldRead = new Promise<{ hasMore: boolean }>(resolve => { releaseOld = resolve; });
    const newRead = new Promise<{ hasMore: boolean }>(resolve => { releaseNew = resolve; });
    const sync = vi.fn().mockResolvedValueOnce({ hasMore: false }).mockReturnValueOnce(oldRead).mockReturnValue(newRead);
    const current = { isCurrent: () => true, sync, rows: () => [], lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
    const settled = { ...defaults, source: { busy: false, error: '', snapshot: { complete: true } } };
    try {
      RenderHistory(current, settled);
      await vi.waitFor(() => expect(RenderHistory(current, settled).loadingOtcTradeHistoryV2).toBe(false));
      RenderHistory(current, settled).refreshOtcTradeHistoryV2();
      RenderHistory(current, settled);
      expect(RenderHistory(current, settled).initialOtcTradeHistoryV2Pending).toBe(false);
      expect(RenderHistory(current, settled).backgroundDeferred).toBe(false);
      RenderHistory(current, settled, 'new-owner-scope');
      expect(RenderHistory(current, settled, 'new-owner-scope').initialOtcTradeHistoryV2Pending).toBe(true);
      releaseOld({ hasMore: false });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(RenderHistory(current, settled, 'new-owner-scope').initialOtcTradeHistoryV2Pending).toBe(true);
      expect(RenderHistory(current, { ...settled, privacyReady: false }, 'new-owner-scope').backgroundDeferred).toBe(false);
      expect(RenderHistory(current, { ...settled, view: 'public' }, 'new-owner-scope').backgroundDeferred).toBe(false);
      releaseNew({ hasMore: false });
      await vi.waitFor(() => expect(RenderHistory(current, settled, 'new-owner-scope').loadingOtcTradeHistoryV2).toBe(false));
      expect(RenderHistory(current, settled, 'new-owner-scope').initialOtcTradeHistoryV2Pending).toBe(false);
    } finally { releaseOld({ hasMore: false }); releaseNew({ hasMore: false }); }
  });

  it('does not start broad History after one-off settles while the first participant render has no snapshot', async () => {
    const { current, sync } = fixture();
    RenderHistory(current, { ...defaults, source: { ...source, busy: false } });
    await Promise.resolve();
    expect(sync).not.toHaveBeenCalled();
  });

  it.each(['settled', 'incomplete', 'error', 'setup-error', 'left', 'locked'] as const)('resumes the automatic loader after the existing participant boundary: %s', async boundary => {
    const { current, sync, rows } = fixture();
    RenderHistory(current);
    expect(sync).not.toHaveBeenCalled();
    const released: typeof defaults = { ...defaults, source: { busy: false, error: '', snapshot: { complete: boundary === 'settled' } } };
    if (boundary === 'error') released.source = { busy: false, error: 'Participant failed.', snapshot: undefined };
    if (boundary === 'setup-error') { released.setupError = 'Setup failed.'; released.source = source; }
    if (boundary === 'left') { released.view = 'public'; released.source = source; }
    if (boundary === 'locked') { released.privacyReady = false; released.source = source; }
    RenderHistory(current, released);
    await vi.waitFor(() => expect(RenderHistory(current, released).otcTradeHistoryV2Rows).toEqual(rows));
    expect(sync).toHaveBeenCalledOnce();
  });

  it('keeps selected-trade History and recovery enabled during a participant pass', async () => {
    const { current, sync, rows } = fixture();
    const selected = { ...defaults, selectedTrade: true, ownerDiscoverySettled: false };
    RenderHistory(current, selected);
    await vi.waitFor(() => expect(RenderHistory(current, selected).otcTradeHistoryV2Rows).toEqual(rows));
    expect(sync).toHaveBeenCalledOnce();
  });

  it('keeps an admitted canonical page through a later participant older-page load without another latest sync', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let checkpoint = 0;
    const sync = vi.fn(async () => {
      const before = checkpoint;
      if (before === 1) await held;
      checkpoint++;
      return { hasMore: before === 1 };
    });
    const current = { isCurrent: () => true, sync,
      rows: () => [{ key: `verified-${checkpoint}`, source: 'public-event', order: { contractAddress: 'current' } }],
      lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
    const settled = { ...defaults, source: { busy: false, error: '', snapshot: { complete: false } } };
    const olderLoading = { ...settled, source: { ...settled.source, busy: true } };
    RenderHistory(current, settled);
    await vi.waitFor(() => expect(RenderHistory(current, settled).otcTradeHistoryV2Rows[0]?.key).toBe('verified-1'));
    const previous = RenderHistory(current, settled);
    previous.refreshOtcTradeHistoryV2();
    RenderHistory(current, settled);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(RenderHistory(current, olderLoading).otcTradeHistoryV2Rows).toEqual(previous.otcTradeHistoryV2Rows);
    expect(RenderHistory(current, olderLoading).backgroundDeferred).toBe(true);
    release();
    await vi.waitFor(() => expect(checkpoint).toBe(2));
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(RenderHistory(current, olderLoading).otcTradeHistoryV2Rows[0]?.key).toBe('verified-2'));
    RenderHistory(current, settled);
    expect(RenderHistory(current, settled).otcTradeHistoryV2Rows[0]?.key).toBe('verified-2');
    expect(sync).toHaveBeenCalledTimes(2);
    expect(checkpoint).toBe(2);
  });

  it('still defers a new explicit canonical refresh while later participant work is busy', async () => {
    const { current, sync, rows } = fixture();
    const settled = { ...defaults, source: { busy: false, error: '', snapshot: { complete: false } } };
    const busy = { ...settled, source: { ...settled.source, busy: true } };
    RenderHistory(current, settled);
    await vi.waitFor(() => expect(RenderHistory(current, settled).otcTradeHistoryV2Rows).toEqual(rows));
    const previous = RenderHistory(current, busy);
    expect(sync).toHaveBeenCalledOnce();
    previous.refreshOtcTradeHistoryV2();
    expect(RenderHistory(current, busy).otcTradeHistoryV2Rows).toEqual(rows);
    expect(RenderHistory(current, busy).backgroundDeferred).toBe(true);
    expect(sync).toHaveBeenCalledOnce();
    RenderHistory(current, settled);
    await vi.waitFor(() => expect(RenderHistory(current, settled).loadingOtcTradeHistoryV2).toBe(false));
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it.each(['scope', 'runtime', 'privacy'] as const)('invalidates an admitted read during participant work after %s replacement', async boundary => {
    let release!: (value: { hasMore: boolean }) => void;
    const held = new Promise<{ hasMore: boolean }>(resolve => { release = resolve; });
    const source = fixture(); source.sync.mockReturnValueOnce(held);
    let releaseNext!: (value: { hasMore: boolean }) => void;
    const nextHeld = new Promise<{ hasMore: boolean }>(resolve => { releaseNext = resolve; });
    if (boundary === 'privacy') source.sync.mockReturnValueOnce(nextHeld);
    const settled = { ...defaults, source: { busy: false, error: '', snapshot: { complete: false } } };
    const busy = { ...settled, source: { ...settled.source, busy: true } };
    RenderHistory(source.current, settled);
    RenderHistory(source.current, busy);
    const nextRuntime = boundary === 'runtime' ? { ...source.current } : source.current;
    const nextScope = boundary === 'scope' ? 'replacement-owner-scope' : scope;
    const nextOptions = boundary === 'privacy' ? { ...busy, privacyReady: false } : busy;
    RenderHistory(nextRuntime, nextOptions, nextScope);
    release({ hasMore: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(RenderHistory(nextRuntime, nextOptions, nextScope).otcTradeHistoryV2Rows).toEqual([]);
    if (boundary !== 'privacy') {
      RenderHistory(source.current, busy);
      expect(source.sync).toHaveBeenCalledOnce();
      RenderHistory(nextRuntime, nextOptions, nextScope);
    }
    const resumed = { ...nextOptions, source: settled.source };
    RenderHistory(nextRuntime, resumed, nextScope);
    releaseNext({ hasMore: false });
    await vi.waitFor(() => expect(RenderHistory(nextRuntime, resumed, nextScope).loadingOtcTradeHistoryV2).toBe(false));
    expect(source.sync).toHaveBeenCalledTimes(2);
  });
});

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

  it('publishes one verified page and leaves older history for an explicit request', async () => {
    let page = 0;
    const rows = [{ key: 'final-row' }] as never;
    const lifecycleEvents = [{ kind: 'lifecycle' }] as never;
    const backfillRuntime = {
      isCurrent: () => true,
      sync: async () => ({ hasMore: ++page < 3 }),
      rows: () => rows,
      lifecycleEvents: () => lifecycleEvents
    } as unknown as OtcTradeHistoryV2Runtime;
    const partial = await loadVerifiedOtcHistoryPage({ runtime: backfillRuntime });
    expect(page).toBe(1);
    expect(partial).toEqual({ rows, lifecycleEvents, hasMore: true });
  });

  it('uses older mode only for an explicit older page', async () => {
    let page = 0;
    const rows = [{ key: 'verified-page-row' }] as never;
    const modes: unknown[] = [];
    const backfillRuntime = { isCurrent: () => true,
      sync: async (_contracts: unknown, mode: unknown) => { modes.push(mode); return { hasMore: ++page === 1 }; },
      rows: () => rows, lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
    expect(await loadVerifiedOtcHistoryPage({ runtime: backfillRuntime })).toMatchObject({ rows, hasMore: true });
    expect(await loadVerifiedOtcHistoryPage({ runtime: backfillRuntime, mode: 'older' })).toMatchObject({ rows, hasMore: false });
    expect(modes).toEqual(['latest', 'older']);
  });

  it('does not publish rows if the wallet runtime changes during pagination', async () => {
    let current = true;
    let rowsRead = false;
    const backfillRuntime = {
      isCurrent: () => current,
      sync: async () => { current = false; return { hasMore: true }; },
      rows: () => {
        rowsRead = true;
        return [];
      },
      lifecycleEvents: () => []
    } as unknown as OtcTradeHistoryV2Runtime;

    await expect(loadVerifiedOtcHistoryPage({ runtime: backfillRuntime })).rejects.toThrow(/changed before portfolio publication/i);
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
    const result = await loadVerifiedOtcHistoryPage({ runtime: scopedRuntime, contractAddresses: [book] });
    expect(requested).toEqual([[book]]);
    expect(result).toEqual({ rows: [currentRow], lifecycleEvents: [currentEvent], hasMore: false });
  });
});
