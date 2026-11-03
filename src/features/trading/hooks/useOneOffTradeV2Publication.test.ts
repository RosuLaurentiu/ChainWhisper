import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useOneOffTradeV2Data from './useOneOffTradeV2Data';
import useOtcTradeHistoryV2Data from './useOtcTradeHistoryV2Data';
import type { OtcTradeHistoryV2Runtime } from '../../../lib/otcTradeHistoryV2Runtime';
import { CURRENT_P2P_BINDING } from '../../../lib/currentP2PBinding';
import { shouldDeferBrowserRuntimeStartup, type BrowserRuntimeInitialDiscovery } from '../../../lib/browserWalletRuntimeScope';
import type { OtcV2ActionRuntime } from '../../../lib/otcV2ActionRuntime';
import type { TradeTokenInfoRequest } from './useP2PTradeTokenData';
import { buildTradeCustomTokenInfoKey } from '../../../lib/appHelpers';
import { useLinkTradeV2Activity } from '../components/LinkTradeV2Activity';
import { useCounterTradeV2Activity } from '../components/CounterTradeV2Activity';

// Use the existing hook-test pattern to exercise effects and cleanup without a wallet or DOM.
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
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const owner = `0x${'44'.repeat(20)}`;
const page = (ids: string[] = []) => ({ tradeIds: ids, orderIds: ids, nextOffset: '0' });
const standard = { tradeId: '1', maker: owner, status: 'open',
  offerAsset: { assetType: 'native', token: owner, amount: '10' }, requestAsset: { assetType: 'native', token: owner, amount: '20' },
  fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', minRequestAmount: '0', maxRequestAmountPerWallet: '0', oneFillPerWallet: false },
  createdAt: '10', expiresAt: '0', rootTradeId: '1', revision: '1', remainingOfferAmount: '10', remainingRequestAmount: '20',
  filledOfferAmount: '0', filledRequestAmount: '0', replacementTradeId: '0', replacesTradeId: '0' };
const bookOrder = { orderId: '2', maker: owner, status: 'open', mode: 'private-pair',
  offerAsset: { assetType: 'native', token: owner, publicAmount: '0' },
  requestAsset: { assetType: 'native', token: owner, publicAmount: '0' },
  fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' },
  priceTerms: { offerAmount: '1', requestAmount: '2' }, offerLocked: true,
  offerTokenCodeHash: `0x${'00'.repeat(32)}`, requestTokenCodeHash: `0x${'00'.repeat(32)}`,
  pairKey: `0x${'00'.repeat(32)}`, createdAt: '10', expiresAt: '0', revision: '1', fillCount: '0',
  rootOrderId: '2', replacementOrderId: '0', replacesOrderId: '0' };
const flush = async () => {
  // Drain the existing Offers render boundary as well as its read promises.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await new Promise<void>(resolve => setTimeout(resolve, 0));
};
function fixture() {
  const runtime = { isCurrent: () => true, deployments: CURRENT_P2P_BINDING.deployments,
    listStandard: vi.fn(async (scope: string) => page(scope === 'maker' ? ['1'] : [])),
    readStandard: vi.fn(async () => standard),
    privateBook: { ownerAddress: owner, budgetVisibilityAvailable: false,
      list: vi.fn(async () => page()), read: vi.fn(async () => bookOrder),
      readAccount: vi.fn(async () => ({ orderId: '2', sequence: '1', totalOfferAmount: '123456789', totalRequestAmount: '246913578', remainingOfferAmount: '123456789' })) },
    listDirect: vi.fn(async () => page()), readDirect: vi.fn()
  } as unknown as OtcV2ActionRuntime;
  const args = { runtime: runtime as OtcV2ActionRuntime | null, walletAddress: owner, dataScopeKey: 'candidate:7082400', privateReadsEnabled: false,
    tokenInfoByKey: {}, ensureTokenInfo: (async () => {}) as (request: TradeTokenInfoRequest) => Promise<void>, onInitialDiscoverySettled: vi.fn(),
    includePublicDiscovery: true };
  const Render = () => {
    hooks.index = 0;
    const result = useOneOffTradeV2Data(args);
    hooks.effects.splice(0).forEach(effect => effect());
    return result;
  };
  return { runtime, args, render: Render };
}
beforeEach(() => { hooks.index = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => { hooks.slots.forEach(slot => slot.cleanup?.()); });

it('keeps a held owner pass through Offers to My trades without repeating or discarding it', async () => {
  const f = fixture(), held = deferred<ReturnType<typeof page>>();
  vi.mocked(f.runtime.listStandard).mockImplementation(async scope => scope === 'maker' ? held.promise : page());
  f.render(); await flush(); await flush();
  const ownerCalls = () => [vi.mocked(f.runtime.listStandard).mock.calls.filter(([scope]) => scope !== 'open').length,
    vi.mocked(f.runtime.privateBook!.list).mock.calls.filter(([scope]) => scope !== 'open').length,
    vi.mocked(f.runtime.listDirect).mock.calls.length];
  try {
    expect(ownerCalls()).toEqual([2, 2, 2]);
    expect(f.render().oneOffV2PublicDiscoverySettled).toBe(true);
    f.args.includePublicDiscovery = false;
    f.render(); await flush();
    expect(ownerCalls()).toEqual([2, 2, 2]);
    expect(f.render().loadingPublicOneOffV2Trades).toBe(false);
    held.resolve(page(['1'])); await flush(); f.render(); await flush();
    const complete = f.render();
    expect(complete.loadingOneOffV2Trades).toBe(false);
    expect(complete.oneOffV2DiscoverySettled).toBe(true);
    expect(complete.myOneOffV2Trades.map(row => row.tradeId)).toEqual([1]);
    expect(f.runtime.readStandard).toHaveBeenCalledOnce();
  } finally { held.resolve(page()); await flush(); }
});

it('loads public Offers on route entry without restarting the pending My trades pass', async () => {
  const f = fixture(), ownerHeld = deferred<ReturnType<typeof page>>(), publicHeld = deferred<ReturnType<typeof page>>();
  f.args.includePublicDiscovery = false;
  vi.mocked(f.runtime.listStandard).mockImplementation(async scope => scope === 'maker' ? ownerHeld.promise
    : scope === 'open' ? publicHeld.promise : page());
  f.render(); await flush();
  try {
    expect(vi.mocked(f.runtime.listStandard).mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    f.args.includePublicDiscovery = true;
    f.render(); await flush();
    expect(f.render().loadingPublicOneOffV2Trades).toBe(true);
    expect(vi.mocked(f.runtime.listStandard).mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler', 'open']);
    f.args.includePublicDiscovery = false; f.render();
    ownerHeld.resolve(page(['1'])); await flush(); f.render(); await flush();
    expect(f.render().loadingOneOffV2Trades).toBe(false);
    expect(f.render().myOneOffV2Trades.map(row => row.tradeId)).toEqual([1]);
    publicHeld.resolve(page()); await flush(); f.render();
    expect(f.render().loadingPublicOneOffV2Trades).toBe(false);
    expect(vi.mocked(f.runtime.listStandard).mock.calls.filter(([scope]) => scope === 'maker')).toHaveLength(1);
    f.args.includePublicDiscovery = true; f.render(); await flush();
    expect(f.render().oneOffV2PublicDiscoverySettled).toBe(true);
    expect(vi.mocked(f.runtime.listStandard).mock.calls.filter(([scope]) => scope === 'maker')).toHaveLength(1);
  } finally { ownerHeld.resolve(page()); publicHeld.resolve(page()); await flush(); }
});

it('starts owner discovery on Offers exit and skips late public views until Offers is entered again', async () => {
  const f = fixture(), publicHeld = deferred<ReturnType<typeof page>>();
  vi.mocked(f.runtime.listStandard).mockImplementation(async scope => scope === 'open' ? publicHeld.promise : page(scope === 'maker' ? ['1'] : []));
  vi.mocked(f.runtime.readStandard).mockImplementation(async id => ({ ...standard, tradeId: String(id) }) as never);
  f.render(); await flush();
  try {
    expect(vi.mocked(f.runtime.listStandard).mock.calls.map(([scope]) => scope)).toEqual(['open']);
    f.args.includePublicDiscovery = false; f.render(); await flush();
    expect(f.render().myOneOffV2Trades.map(row => row.tradeId)).toEqual([1]);
    expect(f.render().loadingOneOffV2Trades).toBe(false);
    publicHeld.resolve(page(['9'])); await flush();
    expect(vi.mocked(f.runtime.readStandard).mock.calls.map(([id]) => String(id))).toEqual(['1']);
    expect(f.render().loadingPublicOneOffV2Trades).toBe(false);
    expect(f.render().oneOffV2PublicDiscoverySettled).toBe(false);
    f.args.includePublicDiscovery = true; f.render(); await flush();
    expect(f.render().oneOffV2PublicDiscoverySettled).toBe(true);
    expect(vi.mocked(f.runtime.listStandard).mock.calls.filter(([scope]) => scope === 'maker')).toHaveLength(1);
    expect(vi.mocked(f.runtime.listStandard).mock.calls.filter(([scope]) => scope === 'open')).toHaveLength(2);
    expect(vi.mocked(f.runtime.readStandard).mock.calls.map(([id]) => String(id))).toEqual(['1', '9']);
    f.args.includePublicDiscovery = false; f.render();
    expect(f.render().activeOneOffV2Trades.map(row => row.tradeId)).toContain(9);
    f.args.walletAddress = `0x${'55'.repeat(20)}`;
    expect(f.render().activeOneOffV2Trades).toEqual([]);
  } finally { publicHeld.resolve(page()); await flush(); }
});

it.each(['wallet', 'runtime', 'disposed'])('rejects held public and owner continuations after %s changes', async change => {
  const f = fixture(), ownerHeld = deferred<ReturnType<typeof page>>(), publicHeld = deferred<ReturnType<typeof page>>();
  f.args.includePublicDiscovery = false;
  vi.mocked(f.runtime.listStandard).mockImplementation(async scope => scope === 'maker' ? ownerHeld.promise
    : scope === 'open' ? publicHeld.promise : page());
  f.render(); await flush();
  f.args.includePublicDiscovery = true; f.render(); await flush();
  // New-scope requests can finish; only the already issued old reads remain held.
  vi.mocked(f.runtime.listStandard).mockResolvedValue(page());
  if (change === 'wallet') f.args.walletAddress = `0x${'55'.repeat(20)}`;
  if (change === 'runtime') f.args.runtime = { ...f.runtime };
  if (change === 'disposed') Object.assign(f.runtime, { isCurrent: () => false });
  f.render(); await flush();
  const calls = vi.mocked(f.runtime.listStandard).mock.calls.length;
  publicHeld.resolve(page(['9']));
  ownerHeld.resolve({ ...page(['1']), nextOffset: '100' });
  await flush();
  expect(f.runtime.listStandard).toHaveBeenCalledTimes(calls);
  expect(f.runtime.readStandard).not.toHaveBeenCalled();
  expect(f.render().activeOneOffV2Trades).toEqual([]);
  expect(f.render().myOneOffV2Trades).toEqual([]);
  expect(f.render().loadingOneOffV2Trades).toBe(false);
  if (change === 'disposed') {
    expect(f.render().oneOffV2DiscoverySettled).toBe(false);
    expect(f.render().oneOffV2TradesError).toContain('no longer current');
    expect(f.args.onInitialDiscoverySettled).not.toHaveBeenCalled();
  }
});

it.each(['runtime', 'refresh'])('does not clear a pending replacement owner pass after %s changes', async change => {
  const f = fixture(), oldRead = deferred<ReturnType<typeof page>>(), newRead = deferred<ReturnType<typeof page>>();
  f.args.includePublicDiscovery = false;
  vi.mocked(f.runtime.listStandard).mockImplementation(async scope => scope === 'maker' ? oldRead.promise : page());
  f.render(); await flush();
  vi.mocked(f.runtime.listStandard).mockImplementation(async scope => scope === 'maker' ? newRead.promise : page());
  if (change === 'runtime') f.args.runtime = { ...f.runtime };
  else f.render().refreshOneOffV2Trades();
  f.render(); await flush();
  try {
    oldRead.resolve(page(['1'])); await flush();
    expect(f.render().loadingOneOffV2Trades).toBe(true);
    expect(f.render().oneOffV2DiscoverySettled).toBe(false);
    expect(f.render().myOneOffV2Trades).toEqual([]);
    expect(f.render().oneOffV2TradesError).toBe('');
    newRead.resolve(page()); await flush();
    expect(f.render().loadingOneOffV2Trades).toBe(false);
    expect(f.render().oneOffV2DiscoverySettled).toBe(true);
  } finally { oldRead.resolve(page()); newRead.resolve(page()); await flush(); }
});

it('continues the same public owner-list scan when privacy becomes ready', async () => {
  const f = fixture(), held = deferred<ReturnType<typeof page>>();
  vi.mocked(f.runtime.listDirect).mockImplementation(() => held.promise);
  f.render(); await flush();
  const before = vi.mocked(f.runtime.listDirect).mock.calls.length;
  f.args.privateReadsEnabled = true;
  f.args.ensureTokenInfo = async () => {};
  f.render(); await flush();
  const after = vi.mocked(f.runtime.listDirect).mock.calls.length;
  held.resolve(page()); await flush();
  expect(before).toBe(2);
  expect(after).toBe(2);
});

it.each(['superseded', 'rpc-failure'])('keeps owner discovery while metadata callback changes during a held %s read', async outcome => {
  const f = fixture(), held = deferred<void>();
  const offered = `0x${'22'.repeat(20)}`, requested = `0x${'33'.repeat(20)}`;
  vi.mocked(f.runtime.readStandard).mockResolvedValue({ ...standard,
    offerAsset: { assetType: 'erc20', token: offered, amount: '10' },
    requestAsset: { assetType: 'erc20', token: requested, amount: '20' } } as never);
  const oldLoader = vi.fn(async () => { await held.promise; if (outcome === 'rpc-failure') throw new Error('metadata RPC failed'); });
  f.args.ensureTokenInfo = oldLoader;
  f.render(); await flush();
  const ownerCalls = vi.mocked(f.runtime.listStandard).mock.calls.length;
  expect(oldLoader).toHaveBeenCalledTimes(2);
  const latestLoader = vi.fn(async (token: TradeTokenInfoRequest) => {
    f.args.tokenInfoByKey = { ...f.args.tokenInfoByKey, [buildTradeCustomTokenInfoKey(token.kind, token.address)]: {
      kind: token.kind, address: token.address, symbol: 'CURRENT', decimals: 6,
      balanceWei: null, loading: false, walletKey: owner } };
  });
  f.args.privateReadsEnabled = true; f.args.ensureTokenInfo = latestLoader;
  f.render(); held.resolve(); await flush();
  const state = f.render();
  expect(vi.mocked(f.runtime.listStandard).mock.calls.length).toBe(ownerCalls);
  if (outcome === 'superseded') {
    expect(latestLoader).toHaveBeenCalledTimes(2);
    expect(state.myOneOffV2Trades.map(row => row.offer.symbol)).toEqual(['CURRENT']);
  } else {
    expect(latestLoader).not.toHaveBeenCalled();
    expect(state.oneOffV2TradesError).toContain('metadata RPC failed');
  }
});

it.each(['success', 'failure'])('defers My trades backfill until initial owner discovery settles with %s', async outcome => {
  const f = fixture(), held = deferred<ReturnType<typeof page>>();
  vi.mocked(f.runtime.listDirect).mockImplementation(async () => {
    const result = await held.promise;
    if (outcome === 'failure') throw new Error('Direct source failed');
    return result;
  });
  const sync = vi.fn(async () => ({ hasMore: false }));
  let initialDiscovery: BrowserRuntimeInitialDiscovery<OtcV2ActionRuntime> | null = null;
  f.args.onInitialDiscoverySettled.mockImplementation(runtime => { initialDiscovery = { scopeKey: 'owner:private', runtime }; });
  const coldWorkDeferred = () => shouldDeferBrowserRuntimeStartup({ selected: true, scopeKey: 'owner:private',
    runtime: f.runtime, setupFailed: false, initialDiscovery });
  const historyRuntime = { isCurrent: () => true, sync, rows: () => [], lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
  const Render = () => {
    hooks.index = 0;
    const oneOff = useOneOffTradeV2Data(f.args);
    const history = useOtcTradeHistoryV2Data(historyRuntime, 'candidate:7082400:owner', undefined, false,
      Boolean(oneOff.oneOffV2DiscoverySettled));
    hooks.effects.splice(0).forEach(effect => effect());
    return { oneOff, history };
  };
  Render(); await flush();
  try {
    const state = Render();
    expect(state.oneOff.myOneOffV2Trades).toHaveLength(1);
    expect(sync).not.toHaveBeenCalled();
    expect(state.oneOff.oneOffV2DiscoverySettled).toBe(false);
    expect(coldWorkDeferred()).toBe(true);
    expect(state.history.loadingOtcTradeHistoryV2).toBe(true);
    held.resolve(page()); await flush();
    expect(Render().oneOff.oneOffV2DiscoverySettled).toBe(true);
    expect(f.args.onInitialDiscoverySettled).toHaveBeenCalledExactlyOnceWith(f.runtime);
    expect(coldWorkDeferred()).toBe(false);
    await flush();
    expect(sync).toHaveBeenCalledOnce();
    expect(Render().history.loadingOtcTradeHistoryV2).toBe(false);
    if (outcome === 'failure') expect(Render().oneOff.oneOffV2TradesError).toContain('Direct');
  } finally { held.resolve(page()); await flush(); }
});

it.each(['wallet', 'network', 'runtime'])('does not reuse initial-discovery settlement after %s changes', async change => {
  const f = fixture();
  f.render(); await flush();
  expect(f.render().oneOffV2DiscoverySettled).toBe(true);
  if (change === 'wallet') f.args.walletAddress = `0x${'55'.repeat(20)}`;
  if (change === 'network') f.args.dataScopeKey = 'candidate:2632500';
  if (change === 'runtime') f.args.runtime = { ...f.runtime };
  expect(f.render().oneOffV2DiscoverySettled).toBe(false);
  await flush();
  expect(f.render().oneOffV2DiscoverySettled).toBe(true);
});

it('keeps public discovery settled through unlock and notifies a new consumer without reading lists again', async () => {
  const f = fixture(); f.render(); await flush();
  expect(f.render().oneOffV2DiscoverySettled).toBe(true);
  const before = vi.mocked(f.runtime.listDirect).mock.calls.length;
  f.args.privateReadsEnabled = true;
  const consumer = vi.fn(); f.args.onInitialDiscoverySettled = consumer;
  expect(f.render().oneOffV2DiscoverySettled).toBe(true); await flush();
  expect(consumer).toHaveBeenCalledExactlyOnceWith(f.runtime);
  expect(vi.mocked(f.runtime.listDirect).mock.calls.length).toBe(before);
  f.render().refreshOneOffV2Trades(); f.render(); await flush();
  expect(vi.mocked(f.runtime.listDirect).mock.calls.length).toBe(before + 2);
});

it('hydrates current private accounts on unlock without reloading their public IDs', async () => {
  const f = fixture();
  vi.mocked(f.runtime.privateBook!.list).mockImplementation(async scope => page(scope === 'maker' ? ['2'] : []));
  const readAccount = vi.fn(async () => ({ orderId: '2', sequence: '1', totalOfferAmount: '123456789', totalRequestAmount: '246913578', remainingOfferAmount: '123456789' }));
  Object.assign(f.runtime, { privateBook: { ...f.runtime.privateBook!, readAccount } });
  f.render(); await flush(); f.render();
  expect(readAccount).not.toHaveBeenCalled();
  const publicCalls = vi.mocked(f.runtime.privateBook!.list).mock.calls.length;
  f.args.privateReadsEnabled = true; f.render(); await flush(); f.render();
  expect(readAccount).toHaveBeenCalledOnce();
  expect((hooks.slots[0].value as { privateAccounts: Record<string, unknown> }).privateAccounts['2']).toBeDefined();
  expect(vi.mocked(f.runtime.privateBook!.list).mock.calls.length).toBe(publicCalls);
  f.args.privateReadsEnabled = false; f.render();
  expect((hooks.slots[0].value as { privateAccounts: object }).privateAccounts).toEqual({});
});

it.each(['pending', 'previously-published'])('rejects current Direct private amounts from the old Refresh generation: %s', async state => {
  const f = fixture(), first = deferred<object>(), next = deferred<object>();
  const view = { tradeId: '3', maker: owner, taker: owner, amountMode: 'private',
    offerAsset: { assetType: 'native', token: owner }, requestAsset: { assetType: 'native', token: owner },
    createdAt: '10', expiresAt: '0', status: 'open', parentTradeId: '0', rootTradeId: '3',
    counterDepth: '0', activeCounterTradeId: '0', replacementTradeId: '0', replacesTradeId: '0' };
  vi.mocked(f.runtime.listStandard).mockResolvedValue(page());
  vi.mocked(f.runtime.listDirect).mockImplementation(async scope => page(scope === 'maker' ? ['3'] : []));
  let privateCalls = 0;
  vi.mocked(f.runtime.readDirect).mockImplementation(async (_id, privateRead) => !privateRead ? view as never
    : (++privateCalls === 1 ? first.promise : next.promise) as never);
  f.args.privateReadsEnabled = true; f.render(); await flush(); f.render(); await flush();
  expect(privateCalls).toBe(1);
  if (state === 'previously-published') {
    first.resolve({ ...view, offerAmount: '123456789', requestAmount: '246913578' }); await flush();
    expect(JSON.stringify(f.render().myOneOffV2Trades)).toContain('123456789');
  }
  f.render().refreshOneOffV2Trades();
  expect(JSON.stringify(f.render().myOneOffV2Trades)).not.toContain('123456789');
  first.resolve({ ...view, offerAmount: '123456789', requestAmount: '246913578' }); await flush();
  expect(JSON.stringify(f.render().myOneOffV2Trades)).not.toContain('123456789');
  next.resolve({ ...view, offerAmount: '222', requestAmount: '444' }); await flush(); f.render(); await flush();
  expect(JSON.stringify(f.render().myOneOffV2Trades)).toContain('222');
});

it('starts an explicitly selected order History while other owner discovery is still pending', async () => {
  const f = fixture(), held = deferred<ReturnType<typeof page>>();
  vi.mocked(f.runtime.listDirect).mockReturnValue(held.promise);
  const sync = vi.fn(async () => ({ hasMore: false }));
  const historyRuntime = { isCurrent: () => true, sync, rows: () => [], lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
  let selectedContract: string | undefined;
  const Render = () => {
    hooks.index = 0;
    const oneOff = useOneOffTradeV2Data(f.args);
    const history = useOtcTradeHistoryV2Data(historyRuntime, 'candidate:7082400:owner', selectedContract ? [selectedContract] : undefined,
      false, Boolean(selectedContract) || oneOff.oneOffV2DiscoverySettled);
    hooks.effects.splice(0).forEach(effect => effect());
    return { oneOff, history };
  };
  Render(); await flush();
  try {
    expect(sync).not.toHaveBeenCalled();
    selectedContract = CURRENT_P2P_BINDING.deployments['standard-v2'].contractAddress;
    Render(); await flush();
    expect(Render().oneOff.oneOffV2DiscoverySettled).toBe(false);
    expect(sync).toHaveBeenCalledExactlyOnceWith([selectedContract], 'latest');
  } finally { held.resolve(page()); await flush(); }
});

it('allows independent History after owner-reader setup fails without a discovery attempt', async () => {
  const f = fixture(); f.args.runtime = null;
  const sync = vi.fn(async () => ({ hasMore: false }));
  const historyRuntime = { isCurrent: () => true, sync, rows: () => [], lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
  let setupError = '';
  const Render = () => {
    hooks.index = 0;
    const oneOff = useOneOffTradeV2Data(f.args);
    useOtcTradeHistoryV2Data(historyRuntime, 'candidate:7082400:owner', undefined, false,
      oneOff.oneOffV2DiscoverySettled || Boolean(setupError));
    hooks.effects.splice(0).forEach(effect => effect());
  };
  Render(); await flush(); expect(sync).not.toHaveBeenCalled();
  setupError = 'Order reader setup failed';
  Render(); await flush(); expect(sync).toHaveBeenCalledOnce();
});

it('removes verified private History immediately when privacy locks during runtime replacement', async () => {
  let privacyReady = true;
  let runtime: OtcTradeHistoryV2Runtime | null = { isCurrent: () => true,
    sync: async () => ({ hasMore: false }),
    rows: () => [{ key: 'private-row' }], lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
  const Render = () => {
    hooks.index = 0;
    const result = useOtcTradeHistoryV2Data(runtime, 'candidate:7082400:owner', undefined, privacyReady);
    hooks.effects.splice(0).forEach(effect => effect());
    return result;
  };
  Render(); await flush();
  expect(Render().otcTradeHistoryV2Rows).toHaveLength(1);
  privacyReady = false;
  runtime = null;
  expect(Render().otcTradeHistoryV2Rows).toEqual([]);
});

it('does not republish decrypted receipt amounts from a still-cached runtime after privacy locks', async () => {
  let privacyReady = true;
  const runtime = { isCurrent: () => true, sync: async () => ({ hasMore: false }),
    rows: () => [{ key: 'private-row', source: 'participant-receipt', amountState: 'available', amounts: { offerAmount: '123456789' } },
      { key: 'public-row', source: 'public-event', amountState: 'available', amounts: { offerAmount: '25' } }],
    lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
  const Render = () => {
    hooks.index = 0;
    const result = useOtcTradeHistoryV2Data(runtime, 'candidate:7082400:owner', undefined, privacyReady);
    hooks.effects.splice(0).forEach(effect => effect());
    return result;
  };
  Render(); await flush();
  expect(Render().otcTradeHistoryV2Rows[0].amounts).toEqual({ offerAmount: '123456789' });
  privacyReady = false;
  expect(Render().otcTradeHistoryV2Rows).toEqual([]);
  await flush();
  expect(Render().otcTradeHistoryV2Rows[0]).toMatchObject({ source: 'private-marker', amountState: 'unavailable', amounts: {} });
  expect(Render().otcTradeHistoryV2Rows[0].amounts).toEqual({});
  expect(Render().otcTradeHistoryV2Rows[1].amounts).toEqual({ offerAmount: '25' });
  expect(JSON.stringify(Render().otcTradeHistoryV2Rows)).not.toContain('123456789');
});

it('keeps verified History visible while an explicit older page waits, then reports its failure', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout });
  try {
    let reject!: (cause: Error) => void;
    const held = new Promise<{ hasMore: boolean }>((_resolve, fail) => { reject = fail; });
    let pageNumber = 0;
    const runtime = { isCurrent: () => true, sync: async () => ++pageNumber === 1 ? { hasMore: true } : held,
      rows: () => [{ key: 'verified-page-row' }], lifecycleEvents: () => [] } as unknown as OtcTradeHistoryV2Runtime;
    const Render = () => {
      hooks.index = 0;
      const result = useOtcTradeHistoryV2Data(runtime, 'candidate:7082400:owner');
      hooks.effects.splice(0).forEach(effect => effect());
      return result;
    };
    Render(); await vi.advanceTimersByTimeAsync(50);
    expect(Render().otcTradeHistoryV2Rows).toHaveLength(1);
    expect(Render().loadingOtcTradeHistoryV2).toBe(false);
    expect(pageNumber).toBe(1);
    Render().loadOlderOtcTradeHistoryV2(); Render();
    expect(Render().loadingOtcTradeHistoryV2).toBe(true);
    reject(new Error('Later History source failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(Render().otcTradeHistoryV2Rows).toHaveLength(1);
    expect(Render().loadingOtcTradeHistoryV2).toBe(false);
    expect(Render().otcTradeHistoryV2Error).toContain('Later History source failed');
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it('publishes verified Standard rows while current Direct discovery is held and keeps coverage incomplete', async () => {
  const f = fixture(), held = deferred<ReturnType<typeof page>>();
  vi.mocked(f.runtime.listDirect).mockImplementation(() => held.promise);
  f.render(); await flush();
  try {
    const state = f.render();
    expect(state.myOneOffV2Trades.map(row => row.tradeId)).toEqual([1]);
    expect(state.loadingOneOffV2Trades).toBe(true);
  } finally { held.resolve(page()); await flush(); }
});

it.each(['pending', 'failure'])('publishes the first current Direct order while a later order is %s', async outcome => {
  const f = fixture(), later = deferred<object>();
  const view = { tradeId: '3', maker: owner, taker: owner, amountMode: 'public', offerAmount: '1', requestAmount: '2',
    offerAsset: { assetType: 'native', token: owner }, requestAsset: { assetType: 'native', token: owner },
    createdAt: '10', expiresAt: '0', status: 'open', parentTradeId: '0', replacementTradeId: '0', replacesTradeId: '0' };
  vi.mocked(f.runtime.listStandard).mockResolvedValue(page());
  vi.mocked(f.runtime.listDirect).mockImplementation(async scope => page(scope === 'maker' ? ['3', '4'] : []));
  vi.mocked(f.runtime.readDirect).mockImplementation(async id => {
    if (String(id) === '3') return view as never;
    await later.promise;
    if (outcome === 'failure') throw new Error('Later Direct order failed');
    return { ...view, tradeId: '4' } as never;
  });
  f.render(); await flush();
  try {
    expect(f.render().myOneOffV2Trades.map(row => row.tradeId)).toEqual([3]);
    expect(f.render().loadingOneOffV2Trades).toBe(true);
    later.resolve({}); await flush();
    const state = f.render();
    expect(state.myOneOffV2Trades.some(row => row.tradeId === 3)).toBe(true);
    if (outcome === 'failure') expect(state.oneOffV2TradesError).toContain('Later Direct order failed');
  } finally { later.resolve({}); await flush(); }
});

it.each(['wallet', 'network', 'privacy', 'dispose'])('rejects later Direct row publication after %s changes', async change => {
  const f = fixture(), later = deferred<object>();
  const view = { tradeId: '3', maker: owner, taker: owner, amountMode: 'public', offerAmount: '1', requestAmount: '2',
    offerAsset: { assetType: 'native', token: owner }, requestAsset: { assetType: 'native', token: owner },
    createdAt: '10', expiresAt: '0', status: 'open', parentTradeId: '0', replacementTradeId: '0', replacesTradeId: '0' };
  vi.mocked(f.runtime.listDirect).mockImplementation(async scope => page(scope === 'maker' ? ['3', '4'] : []));
  vi.mocked(f.runtime.readDirect).mockImplementation(async id => String(id) === '3' ? view as never : later.promise as never);
  f.render(); await flush();
  expect(f.render().myOneOffV2Trades.some(row => row.tradeId === 3)).toBe(true);
  if (change === 'wallet') f.args.walletAddress = `0x${'55'.repeat(20)}`;
  if (change === 'network') f.args.dataScopeKey = 'candidate:2632500';
  if (change === 'privacy') f.args.privateReadsEnabled = true;
  if (change === 'dispose') hooks.slots.forEach(slot => slot.cleanup?.());
  else { f.args.runtime = null; f.render(); }
  later.resolve({ ...view, tradeId: '4' }); await flush();
  expect((hooks.slots[0].value as { directViews: { tradeId: string }[] }).directViews.some(row => row.tradeId === '4')).toBe(false);
});

it('keeps verified Standard rows when current Direct fails and reports incomplete discovery', async () => {
  const f = fixture();
  vi.mocked(f.runtime.listDirect).mockRejectedValue(new Error('Direct source unavailable'));
  f.render(); await flush();
  const state = f.render();
  expect(state.myOneOffV2Trades.map(row => row.tradeId)).toEqual([1]);
  expect(state.loadingOneOffV2Trades).toBe(false);
  expect(state.oneOffV2TradesError).toContain('Direct');
});

it.each(['wallet', 'network', 'privacy', 'dispose'])('rejects late current rows after %s changes', async change => {
  const f = fixture(), held = deferred<typeof standard>();
  vi.mocked(f.runtime.readStandard).mockReturnValue(held.promise as never);
  f.render(); await flush();
  if (change === 'wallet') f.args.walletAddress = `0x${'55'.repeat(20)}`;
  if (change === 'network') f.args.dataScopeKey = 'candidate:2632500';
  if (change === 'privacy') f.args.privateReadsEnabled = true;
  if (change === 'dispose') hooks.slots.forEach(slot => slot.cleanup?.());
  else { f.args.runtime = null; f.render(); }
  held.resolve(standard); await flush();
  expect((hooks.slots[0].value as { standardViews: unknown[] }).standardViews).toEqual([]);
  expect(f.args.onInitialDiscoverySettled).not.toHaveBeenCalled();
});

it.each(['wallet', 'network', 'privacy', 'dispose'])('rejects late private account totals after %s changes', async change => {
  const f = fixture(), account = deferred<{ orderId: string; sequence: string; totalOfferAmount: string; totalRequestAmount: string; remainingOfferAmount: string }>();
  const readAccount = vi.fn(() => account.promise);
  Object.assign(f.runtime, { privateBook: { ...f.runtime.privateBook!, readAccount } });
  vi.mocked(f.runtime.privateBook!.list).mockImplementation(async scope => page(scope === 'maker' ? ['2'] : []));
  f.args.privateReadsEnabled = true;
  f.render(); await flush(); f.render(); await flush();
  expect(readAccount).toHaveBeenCalledOnce();
  if (change === 'wallet') f.args.walletAddress = `0x${'55'.repeat(20)}`;
  if (change === 'network') f.args.dataScopeKey = 'candidate:2632500';
  if (change === 'privacy') f.args.privateReadsEnabled = false;
  if (change === 'dispose') hooks.slots.forEach(slot => slot.cleanup?.());
  else { f.args.runtime = null; f.render(); }
  account.resolve({ orderId: '2', sequence: '1', totalOfferAmount: '123456789', totalRequestAmount: '246913578', remainingOfferAmount: '123456789' });
  await flush();
  expect((hooks.slots[0].value as { privateAccounts: object }).privateAccounts).toEqual({});
});

it.each(['wallet', 'network', 'privacy', 'dispose'])('rejects a manual private reveal after %s changes', async change => {
  const f = fixture(), revealed = deferred<object>();
  const view = { tradeId: '3', maker: owner, taker: owner, amountMode: 'public', offerAmount: '1', requestAmount: '2',
    offerAsset: { assetType: 'native', token: owner }, requestAsset: { assetType: 'native', token: owner } };
  vi.mocked(f.runtime.listDirect).mockImplementation(async scope => page(scope === 'maker' ? ['3'] : []));
  vi.mocked(f.runtime.readDirect).mockImplementation(async (_id, privateAmounts) => privateAmounts ? revealed.promise as never : view as never);
  f.args.privateReadsEnabled = true;
  f.render(); await flush();
  const reading = f.render().revealDirectTrade('3');
  if (change === 'wallet') f.args.walletAddress = `0x${'55'.repeat(20)}`;
  if (change === 'network') f.args.dataScopeKey = 'candidate:2632500';
  if (change === 'privacy') f.args.privateReadsEnabled = false;
  if (change === 'dispose') hooks.slots.forEach(slot => slot.cleanup?.());
  else { f.args.runtime = null; f.render(); }
  const rejected = expect(reading).rejects.toThrow(/session changed/);
  revealed.resolve({ ...view, offerAmount: '123456789', requestAmount: '987654321' });
  await rejected;
  expect(JSON.stringify(hooks.slots[0].value)).not.toContain('123456789');
});

it.each(['Shared', 'Counter'])('publishes current %s progress and ignores progress after disposal', async kind => {
  const snapshot = { orders: [], history: [], complete: false, safeHead: '50', phase: 'scan' as const };
  const held = deferred<typeof snapshot>();
  let publish!: (value: typeof snapshot) => void;
  const runtime = { ownerAddress: owner, syncActivity: vi.fn(async (onProgress: typeof publish) => {
    publish = onProgress; publish(snapshot); return held.promise;
  }) };
  const useActivity = kind === 'Shared' ? useLinkTradeV2Activity : useCounterTradeV2Activity;
  const ensureTokenInfo = async () => {};
  const Render = () => {
    hooks.index = 0;
    const result = useActivity({ runtime: runtime as never, ownerAddress: owner, enabled: true, ensureTokenInfo });
    hooks.effects.splice(0).forEach(effect => effect());
    return result;
  };
  Render(); await flush();
  expect(Render().snapshot).toEqual(snapshot);
  expect(Render().busy).toBe(true);
  hooks.slots.forEach(slot => slot.cleanup?.());
  publish({ ...snapshot, safeHead: '999' });
  held.resolve(snapshot); await flush();
  expect(Render().snapshot?.safeHead).toBe('50');
});


