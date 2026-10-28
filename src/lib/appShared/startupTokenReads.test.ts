import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchRequest, Interface, type JsonRpcProvider } from '@coti-io/coti-ethers';
import { CONFIGURED_COTI_NETWORK } from '../chainWhisperNetworks';

const hooks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  effectDeps: [] as Array<readonly unknown[] | undefined>,
  callbacks: [] as Array<{ callback: unknown; deps: readonly unknown[] }>,
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0, refIndex: 0, effectIndex: 0, callbackIndex: 0,
  values: [] as unknown[],
  cleanups: [] as Array<void | (() => void)>
}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: <T,>(callback: T, deps: readonly unknown[]) => {
    const index = hooks.callbackIndex++, previous = hooks.callbacks[index];
    if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      hooks.callbacks[index] = { callback, deps };
    }
    return hooks.callbacks[index].callback as T;
  },
  useMemo: <T,>(factory: () => T, _deps: readonly unknown[]) => factory(),
  useRef: <T,>(current: T) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current }) as { current: T };
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = hooks.effectIndex++, previous = hooks.effectDeps[index];
    if (!deps || !previous || deps.length !== previous.length || deps.some((value, i) => !Object.is(value, previous[i]))) {
      hooks.effects.push(effect);
    }
    hooks.effectDeps[index] = deps;
  },
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.values[index], (value: T | ((previous: T) => T)) => {
      hooks.values[index] = typeof value === 'function'
        ? (value as (previous: T) => T)(hooks.values[index] as T) : value;
    }];
  }
}));
vi.mock('../appHelpers', async importOriginal => ({
  ...await importOriginal<typeof import('../appHelpers')>(),
  // Same public/private token counts as the selected startup catalog; no chain access.
  VERIFIED_ECOSYSTEM_TOKENS: Array.from({ length: 10 }, (_, index) => ({
    address: `0x${(index + 16).toString(16).padStart(40, '0')}`,
    kind: index < 4 ? 'erc20' : 'private-erc20', symbol: `T${index}`, decimals: 6
  }))
}));

const originalGetUrl = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl).getUrlFunc;
const metadata = new Interface(['function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)']);
let provider: JsonRpcProvider;
let nativeBalance: bigint;
let requests: Array<{ method: string; selector?: string; token?: string }>;
let mountOwner: (includeCustomTokens: boolean) => void;
let mountComposer: (enabled: boolean) => ReturnType<typeof vi.fn>;
let mountP2P: (sessionKey?: string, privateToken?: string) => ReturnType<typeof import('../../features/trading/hooks/useP2PTradeTokenData').default>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  hooks.effects = []; hooks.values = []; hooks.cleanups = [];
  hooks.effectDeps = []; hooks.callbacks = []; hooks.refs = [];
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
  requests = [];
  nativeBalance = 42n;
  // Only the HTTP boundary is replaced; run the installed SDK and our real paced queue.
  FetchRequest.registerGetUrl(async request => {
    const payload = JSON.parse(new TextDecoder().decode(request.body!));
    const selector = payload.params?.[0]?.data?.slice(0, 10);
    requests.push({ method: payload.method, selector, token: payload.params?.[0]?.to?.toLowerCase() });
    await new Promise(resolve => setTimeout(resolve, 20));
    let result: string;
    if (payload.method === 'eth_chainId') result = `0x${CONFIGURED_COTI_NETWORK.chainIdDecimal.toString(16)}`;
    else if (payload.method === 'eth_getBalance') result = `0x${nativeBalance.toString(16)}`;
    else if (selector === '0x95d89b41') result = metadata.encodeFunctionResult('symbol', ['TOKEN']);
    else if (selector === '0x313ce567') result = metadata.encodeFunctionResult('decimals', [6]);
    else if (selector === '0x70a08231') result = metadata.encodeFunctionResult('balanceOf', [7n]);
    else throw new Error(`Unexpected local fixture method: ${payload.method}`);
    return { statusCode: 200, statusMessage: 'OK', headers: {},
      body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result })) };
  });
  const core = await import('./core');
  const starting = core.loadCotiHttpProvider();
  await vi.runAllTimersAsync();
  provider = await starting;
  const owner = (await import('../../features/wallet/hooks/useOwnerWalletBalances')).default;
  const composer = (await import('../../features/trading/hooks/useTradeCustomTokenInfoLoader')).default;
  const p2p = (await import('../../features/trading/hooks/useP2PTradeTokenData')).default;
  const getLockedSigner = async () => { throw new Error('Locked fixture must not request a signer'); };
  mountP2P = (sessionKey = 'owner:provider-1:locked', privateToken = '') => {
    hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
    hooks.effects = [];
    return p2p({ balanceRefreshSessionKey: sessionKey,
    getTradeSigner: getLockedSigner,
    tradeOfferCustomTokenAddress: privateToken, tradeOfferTokenSelection: privateToken ? 'custom-private' : 'native',
    tradeRequestCustomTokenAddress: '', tradeRequestTokenSelection: 'native',
    tradeFeeEscrowContract: '0x0000000000000000000000000000000000000002', tradeRequiredFeeOverrideWei: 0n,
    walletAddress: '0x0000000000000000000000000000000000000001', walletKey: 'owner', walletHasAes: false });
  };
  mountOwner = includeCustomTokens => owner({ chainId: CONFIGURED_COTI_NETWORK.chainIdDecimal,
    ownerWalletAddress: '0x0000000000000000000000000000000000000001', ownerAesReady: false,
    getOwnerReadSigner: async () => { throw new Error('Locked fixture must not request a signer'); },
    refreshNonce: 0, includeCustomTokens });
  mountComposer = enabled => {
    const setInfo = vi.fn();
    composer({ enabled, chainId: CONFIGURED_COTI_NETWORK.chainIdDecimal, hasAesReady: false,
      walletAddress: '0x0000000000000000000000000000000000000001', watchedTokens: [],
      getMemoSignerRef: { current: async () => { throw new Error('Locked fixture must not request a signer'); } },
      normalizedTradeOfferCustomTokenAddress: '', normalizedTradeRequestCustomTokenAddress: '',
      setCustomTradeTokenInfoByAddress: setInfo, setSessionOnboardInfo: vi.fn(), walletBalanceRefreshNonce: 0,
      tradeCustomOfferTokenKind: 'erc20', tradeCustomRequestTokenKind: 'erc20',
      tradeOfferTokenSelection: 'native', tradeRequestTokenSelection: 'native' });
    return setInfo;
  };
  requests = [];
});
afterEach(() => {
  for (const cleanup of hooks.cleanups) cleanup?.();
  provider?.destroy();
  FetchRequest.registerGetUrl(originalGetUrl);
  vi.useRealTimers();
});
const runEffects = () => { hooks.cleanups.push(...hooks.effects.map(effect => effect())); };
const metadataRequests = () => requests.filter(request =>
  request.selector === '0x95d89b41' || request.selector === '0x313ce567');
const catalogMetadataRequests = () => metadataRequests().filter(request => /^0x0{38}1[0-9]$/i.test(request.token ?? ''));

const ownerAddress = '0x0000000000000000000000000000000000000044';
const zeroPage = (ids: string[]) => ({ orderIds: ids, tradeIds: ids, nextOffset: '0' });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
};
const nativeAsset = { assetType: 'native' as const };
const standardView = (tradeId: string) => ({ tradeId, maker: ownerAddress, offerAsset: nativeAsset, requestAsset: nativeAsset });
const privateView = (orderId: string) => ({ orderId, maker: ownerAddress, offerAsset: nativeAsset, requestAsset: nativeAsset });
const directView = (tradeId: string) => ({ tradeId, maker: ownerAddress, taker: ownerAddress, offerAsset: nativeAsset, requestAsset: nativeAsset });

const makeOneOffRuntime = async () => {
  const { CURRENT_P2P_BINDING } = await import('../currentP2PBinding');
  const standard = CURRENT_P2P_BINDING.deployments['standard-v2'];
  const retainedCalls: string[] = [];
  const retained = {
    isCurrent: () => true,
    deployments: { 'standard-v2': standard },
    listStandard: vi.fn(async (scope: string) => {
      retainedCalls.push(scope);
      return zeroPage(scope === 'maker' ? ['103'] : []);
    }),
    readStandard: vi.fn(async (tradeId: string) => standardView(tradeId))
  };
  const runtime = {
    isCurrent: () => true,
    deployments: CURRENT_P2P_BINDING.deployments,
    retainedDeployments: [standard],
    forReference: vi.fn(async () => retained),
    listStandard: vi.fn(async (scope: string) => zeroPage(
      scope === 'open' ? ['901'] : scope === 'maker' ? ['101'] : []
    )),
    readStandard: vi.fn(async (tradeId: string) => standardView(tradeId)),
    listPrivateTrade: vi.fn(async (scope: string) => zeroPage(
      scope === 'open' ? ['902'] : scope === 'maker' ? ['102'] : []
    )),
    readPrivateTrade: vi.fn(async (orderId: string) => privateView(orderId)),
    listDirect: vi.fn(async (scope: string) => zeroPage(scope === 'maker' ? ['104'] : [])),
    readDirect: vi.fn(async (tradeId: string) => directView(tradeId))
  };
  return { runtime, retained, retainedCalls };
};

const makeRecurringRuntime = async () => {
  const { CURRENT_P2P_BINDING } = await import('../currentP2PBinding');
  const runtime = {
    isCurrent: () => true,
    deployments: CURRENT_P2P_BINDING.deployments,
    listRecurring: vi.fn(async (scope: string) => zeroPage(scope === 'active' ? ['911'] : scope === 'maker' ? ['201'] : [])),
    listPrivateRecurring: vi.fn(async (scope: string) => zeroPage(scope === 'active' ? ['912'] : scope === 'maker' ? ['202'] : [])),
    readRecurring: vi.fn(async (orderId: string) => ({ orderId, maker: ownerAddress, baseAsset: nativeAsset, quoteAsset: nativeAsset })),
    readPrivateRecurring: vi.fn(async (orderId: string) => ({ orderId, maker: ownerAddress, baseToken: ownerAddress, quoteToken: ownerAddress }))
  };
  return runtime;
};

const mountOneOff = async (runtime: object, includePublicDiscovery?: boolean, ensureTokenInfo = async () => {}, privateReadsEnabled = false) => {
  const useOneOffTradeV2Data = (await import('../../features/trading/hooks/useOneOffTradeV2Data')).default;
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
  hooks.effects = [];
  // The existing harness calls the hook directly so it can run and flush its effects.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useOneOffTradeV2Data({
    runtime, walletAddress: ownerAddress, dataScopeKey: 'current-test-scope', privateReadsEnabled,
    tokenInfoByKey: {}, ensureTokenInfo, includePublicDiscovery
  } as never);
};

const mountRecurring = async (runtime: object, includePublicDiscovery?: boolean) => {
  const useRecurringTradeV2Data = (await import('../../features/trading/hooks/useRecurringTradeV2Data')).default;
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
  hooks.effects = [];
  // The existing harness calls the hook directly so it can run and flush its effects.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useRecurringTradeV2Data({
    runtime, walletAddress: ownerAddress, dataScopeKey: 'current-test-scope', privateReadsEnabled: false,
    tokenInfoByKey: {}, ensureTokenInfo: async () => {}, includePublicDiscovery
  } as never);
};

const flushHookEffects = async () => {
  runEffects();
  await vi.runAllTimersAsync();
};

describe('startup token reads at the shared paced HTTP boundary', () => {
  it('keeps the catalog metadata producer bounded while retaining every token', async () => {
    const pending = new Set<number>();
    let peak = 0;
    type Payload = { id: number; method: string; params?: Array<{ to?: string; data?: string }> };
    await provider.on('debug', (event: {
      action: string; payload?: Payload | Payload[]; result?: Array<{ id: number }>
    }) => {
      if (event.action === 'sendRpcPayload' && event.payload) {
        for (const payload of Array.isArray(event.payload) ? event.payload : [event.payload]) {
          const call = payload.params?.[0];
          if (payload.method === 'eth_call' && /^0x0{38}1[0-9]$/i.test(call?.to ?? '') &&
            ['0x95d89b41', '0x313ce567'].includes(call?.data?.slice(0, 10) ?? '')) {
            pending.add(payload.id);
            peak = Math.max(peak, pending.size);
          }
        }
      }
      if (event.action === 'receiveRpcResult') {
        for (const result of event.result ?? []) pending.delete(result.id);
      }
    });

    mountP2P(); runEffects();
    await vi.runAllTimersAsync();

    expect(peak).toBeLessThanOrEqual(2);
    expect(pending.size).toBe(0);
    expect(catalogMetadataRequests()).toHaveLength(20);
    expect(metadataRequests()).toHaveLength(24); // Catalog plus both built-in tokens.
    expect(Object.keys(hooks.values[0] as object)).toHaveLength(10);
  });

  it('loads a selected catalog token once across the two startup consumers', async () => {
    mountP2P(undefined, '0x0000000000000000000000000000000000000014'); runEffects();
    await vi.runAllTimersAsync();

    const duplicateMetadata = metadataRequests().filter((request, index, all) =>
      all.findIndex(other => other.token === request.token && other.selector === request.selector) !== index);
    expect(duplicateMetadata).toEqual([]);
    expect(catalogMetadataRequests()).toHaveLength(20);
    expect(metadataRequests()).toHaveLength(24);
    expect(Object.keys(hooks.values[0] as object)).toHaveLength(10);
  });

  it('does not produce the remaining catalog reads after its startup effect is disposed', async () => {
    mountP2P(); runEffects();
    for (const cleanup of hooks.cleanups) cleanup?.();
    await vi.runAllTimersAsync();

    // A started token may finish. No later catalog token may be produced.
    expect(catalogMetadataRequests().length).toBeLessThanOrEqual(2);
  });

  it('finishes a fresh catalog pass after a provider session changes during startup', async () => {
    mountP2P(); runEffects();
    await vi.advanceTimersByTimeAsync(1_100);
    for (const cleanup of hooks.cleanups) cleanup?.();
    requests = [];
    mountP2P('owner:provider-2:locked'); runEffects();
    await vi.runAllTimersAsync();

    const catalogReads = catalogMetadataRequests();
    expect(new Set(catalogReads.map(request => request.token)).size).toBe(10);
    expect(catalogReads.length).toBeGreaterThanOrEqual(20);
    expect(catalogReads.length).toBeLessThanOrEqual(22); // At most one old token was already started.
    expect(Object.keys(hooks.values[0] as object)).toHaveLength(10);
  });

  it('does not repeat metadata when the P2P connect and token-list loaders overlap', async () => {
    mountP2P(); runEffects();
    await vi.runAllTimersAsync();
    const duplicateMetadata = metadataRequests().filter((request, index, all) =>
      all.findIndex(other => other.token === request.token && other.selector === request.selector) !== index);
    expect(duplicateMetadata).toEqual([]);
    const entries = Object.values(hooks.values[0] as Record<string, { balanceWei: bigint | null; privateBalanceState?: { status: string } }>);
    expect(entries).toHaveLength(10);
    expect(entries.filter(entry => entry.privateBalanceState).every(entry =>
      entry.privateBalanceState?.status === 'locked' && entry.balanceWei === null)).toBe(true);
    expect(hooks.values[1]).toBe(42n);
  });

  it('still reads fresh balances and token metadata for an explicit P2P refresh', async () => {
    const data = mountP2P(); runEffects();
    await vi.runAllTimersAsync();
    requests = [];
    nativeBalance = 43n;
    // An explicit refresh must not reuse the completed connect pass.
    await vi.advanceTimersByTimeAsync(500);
    const refreshing = data.refreshWalletBalances({ reason: 'manual' });
    await vi.runAllTimersAsync();
    await refreshing;
    expect(hooks.values[1]).toBe(43n);
    expect(metadataRequests().some(request => request.token === '0x0000000000000000000000000000000000000014')).toBe(true);
  });

  it.each(['', '0x0000000000000000000000000000000000000077'])(
    'reads known and selected custom tokens again for a new wallet-provider session (%s)', async (privateToken) => {
    mountP2P(undefined, privateToken); runEffects();
    await vi.runAllTimersAsync();
    requests = [];
    await vi.advanceTimersByTimeAsync(500);
    mountP2P('owner:provider-2:locked', privateToken); runEffects();
    await vi.runAllTimersAsync();
    expect(metadataRequests().some(request => request.token === '0x0000000000000000000000000000000000000014')).toBe(true);
    if (privateToken) expect(metadataRequests().some(request => request.token === privateToken)).toBe(true);
    expect(Object.keys(hooks.values[0] as object)).toHaveLength(privateToken ? 11 : 10);
  });

  it('loads requested built-in balances without an unused ecosystem sweep', async () => {
    mountOwner(false); runEffects();
    await vi.runAllTimersAsync();
    expect(metadataRequests()).toEqual([]);
    expect(hooks.values[0]).toBe(42n);
    expect(hooks.values[1]).toBe(7n);
    expect(hooks.values[2]).toBeNull();
  });

  it('does not enqueue token reads for an inactive Chat composer consumer', async () => {
    const setInfo = mountComposer(false); runEffects();
    await vi.runAllTimersAsync();
    expect(requests).toEqual([]);
    const update = setInfo.mock.calls[setInfo.mock.calls.length - 1][0];
    expect(update({ previousPrivateToken: { balanceWei: 9n } })).toEqual({});
  });

  it('does not enqueue owner reads after its startup effect was disposed', async () => {
    mountOwner(true); runEffects();
    for (const cleanup of hooks.cleanups) cleanup?.();
    await vi.runAllTimersAsync();
    expect(requests).toEqual([]);
  });

  it('does not enqueue composer reads after its startup effect was disposed', async () => {
    mountComposer(true); runEffects();
    for (const cleanup of hooks.cleanups) cleanup?.();
    await vi.runAllTimersAsync();
    expect(requests).toEqual([]);
  });

  it('still reads active composer metadata and keeps private balances locked', async () => {
    const setInfo = mountComposer(true); runEffects();
    await vi.runAllTimersAsync();
    expect(metadataRequests()).toHaveLength(20);
    const update = setInfo.mock.calls[setInfo.mock.calls.length - 1][0];
    const entries = Object.values(update({})) as Array<{ decimals: number; kind: string; balanceWei: bigint | null }>;
    expect(entries).toHaveLength(10);
    expect(entries.every(entry => entry.decimals === 6)).toBe(true);
    expect(entries.filter(entry => entry.kind === 'private-erc20').every(entry => entry.balanceWei === null)).toBe(true);
    expect(entries.filter(entry => entry.kind === 'erc20').every(entry => entry.balanceWei === 7n)).toBe(true);
  });

  it('still loads custom balances when the owner consumer requests them', async () => {
    mountOwner(true); runEffects();
    await vi.runAllTimersAsync();
    expect(metadataRequests()).toHaveLength(20);
    expect(Object.keys(hooks.values[6] as object)).toHaveLength(10);
  });
});

describe('owner-only V2 history discovery', () => {
  it('publishes verified current rows while retained discovery is pending', async () => {
    const { runtime, retained } = await makeOneOffRuntime();
    runtime.readStandard.mockImplementation(async tradeId => ({ ...standardView(tradeId),
      offerAsset: { assetType: 'native', amount: '1' }, requestAsset: { assetType: 'native', amount: '2' },
      status: 'open', revision: '1', createdAt: '1', expiresAt: '0', replacementTradeId: '0', replacesTradeId: '0' } as never));
    const older = deferred<ReturnType<typeof zeroPage>>();
    retained.listStandard.mockImplementation(async scope => scope === 'maker' ? older.promise : zeroPage([]));
    await mountOneOff(runtime, false);
    await flushHookEffects();
    const partial = await mountOneOff(runtime, false);
    expect(partial.myOneOffV2Trades.map(row => row.tradeId)).toContain(101);
    expect(partial.loadingOneOffV2Trades).toBe(true);
    expect(partial.oneOffV2TradesError).toBe('');
    expect(retained.listStandard).toHaveBeenCalledExactlyOnceWith('maker', 0n, 100n);
    older.resolve(zeroPage(['103']));
    await vi.runAllTimersAsync();
    const complete = await mountOneOff(runtime, false);
    expect(complete.myOneOffV2Trades.map(row => row.tradeId)).toContain(101);
    expect(complete.loadingOneOffV2Trades).toBe(false);
    expect((hooks.values[0] as { retainedTrades: unknown[] }).retainedTrades).toHaveLength(1);
  });

  it('keeps verified current rows and an error when retained discovery fails', async () => {
    const { runtime, retained } = await makeOneOffRuntime();
    retained.listStandard.mockRejectedValueOnce(new Error('Retained discovery unavailable.'));
    await mountOneOff(runtime, false);
    await flushHookEffects();
    const raw = hooks.values[0] as { standardViews: Array<{ tradeId: string }> };
    expect(raw.standardViews.map(row => row.tradeId)).toContain('101');
    expect(hooks.values[1]).toBe(false);
    expect(hooks.values[2]).toBe('Retained discovery unavailable.');
  });

  it('publishes amount-free current rows before private hydration and rejects a disposed late result', async () => {
    const { runtime } = await makeOneOffRuntime();
    runtime.retainedDeployments = [];
    const account = deferred<{ orderId: string; totalOfferAmount: string }>();
    const active = Object.assign(runtime, { readPrivateTradeAccount: vi.fn(async () => account.promise) });
    await mountOneOff(active, false, async () => {}, true);
    await flushHookEffects();
    const partial = hooks.values[0] as { privateViews: Array<{ orderId: string }>; privateAccounts: object };
    expect(partial.privateViews.map(row => row.orderId)).toContain('102');
    expect(partial.privateAccounts).toEqual({});
    expect(hooks.values[1]).toBe(true);
    expect(active.readPrivateTradeAccount).toHaveBeenCalledOnce();
    hooks.cleanups.forEach(cleanup => cleanup?.());
    account.resolve({ orderId: '102', totalOfferAmount: '99' });
    await vi.runAllTimersAsync();
    expect(hooks.values[0]).toBe(partial);
    expect(partial.privateAccounts).toEqual({});
  });

  it('skips global one-off books but keeps participant and retained owner reads', async () => {
    const { runtime, retained, retainedCalls } = await makeOneOffRuntime();
    await mountOneOff(runtime, false);
    await flushHookEffects();

    const raw = hooks.values[0] as {
      openStandardIds: Set<string>; openPrivateIds: Set<string>; participantStandardIds: Set<string>;
      directViews: Array<{ tradeId: string }>; retainedTrades: unknown[];
    };
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).not.toContain('open');
    expect(runtime.listPrivateTrade.mock.calls.map(([scope]) => scope)).not.toContain('open');
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(runtime.listPrivateTrade.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(runtime.listDirect.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'taker']);
    expect(raw.openStandardIds.size).toBe(0);
    expect(raw.openPrivateIds.size).toBe(0);
    expect(raw.participantStandardIds.has('101')).toBe(true);
    expect(raw.directViews.map(view => view.tradeId)).toContain('104');
    expect(retained.listStandard.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(retainedCalls).toEqual(['maker', 'filler']);
    expect(raw.retainedTrades).toHaveLength(1);
    expect(hooks.values[1]).toBe(false);
    expect(hooks.values[2]).toBe('');
  });

  it('keeps default one-off Offers discovery enabled', async () => {
    const { runtime } = await makeOneOffRuntime();
    await mountOneOff(runtime);
    await flushHookEffects();

    const raw = hooks.values[0] as { openStandardIds: Set<string>; openPrivateIds: Set<string> };
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toContain('open');
    expect(runtime.listPrivateTrade.mock.calls.map(([scope]) => scope)).toContain('open');
    expect(raw.openStandardIds.has('901')).toBe(true);
    expect(raw.openPrivateIds.has('902')).toBe(true);
    expect(hooks.values[1]).toBe(false);
    expect(hooks.values[2]).toBe('');
  });

  it('does not start one-off details after a disposed global list read resolves', async () => {
    const { runtime } = await makeOneOffRuntime();
    const openList = deferred<ReturnType<typeof zeroPage>>();
    const ensureTokenInfo = vi.fn(async () => {});
    runtime.listStandard.mockImplementation(async (scope) => scope === 'open' ? openList.promise : zeroPage([]));
    await mountOneOff(runtime, true, ensureTokenInfo);
    runEffects();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toContain('maker');
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toContain('filler');
    expect(runtime.readStandard).not.toHaveBeenCalled();
    hooks.cleanups.forEach(cleanup => cleanup?.());
    openList.resolve(zeroPage(['999']));
    await vi.runAllTimersAsync();

    expect(runtime.readStandard).not.toHaveBeenCalled();
    expect(runtime.readPrivateTrade).not.toHaveBeenCalled();
    expect(runtime.readDirect).not.toHaveBeenCalled();
    expect(ensureTokenInfo).not.toHaveBeenCalled();
  });

  it('skips global recurring books but keeps participant reads', async () => {
    const runtime = await makeRecurringRuntime();
    await mountRecurring(runtime, false);
    await flushHookEffects();

    const raw = hooks.values[0] as {
      activePublicIds: Set<string>; activePrivateIds: Set<string>;
      participantPublicIds: Set<string>; participantPrivateIds: Set<string>;
    };
    expect(runtime.listRecurring.mock.calls.map(([scope]) => scope)).not.toContain('active');
    expect(runtime.listPrivateRecurring.mock.calls.map(([scope]) => scope)).not.toContain('active');
    expect(runtime.listRecurring.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(runtime.listPrivateRecurring.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(raw.activePublicIds.size).toBe(0);
    expect(raw.activePrivateIds.size).toBe(0);
    expect(raw.participantPublicIds.has('201')).toBe(true);
    expect(raw.participantPrivateIds.has('202')).toBe(true);
    expect(runtime.readRecurring).toHaveBeenCalledWith('201');
    expect(runtime.readPrivateRecurring).toHaveBeenCalledWith('202');
    expect(hooks.values[1]).toBe(false);
    expect(hooks.values[2]).toBe('');
  });

  it('keeps default recurring Offers discovery enabled', async () => {
    const runtime = await makeRecurringRuntime();
    await mountRecurring(runtime);
    await flushHookEffects();

    const raw = hooks.values[0] as { activePublicIds: Set<string>; activePrivateIds: Set<string> };
    expect(runtime.listRecurring.mock.calls.map(([scope]) => scope)).toContain('active');
    expect(runtime.listPrivateRecurring.mock.calls.map(([scope]) => scope)).toContain('active');
    expect(raw.activePublicIds.has('911')).toBe(true);
    expect(raw.activePrivateIds.has('912')).toBe(true);
    expect(hooks.values[1]).toBe(false);
    expect(hooks.values[2]).toBe('');
  });

  it('does not start recurring details after a disposed global list read resolves', async () => {
    const runtime = await makeRecurringRuntime();
    const activeList = deferred<ReturnType<typeof zeroPage>>();
    runtime.listRecurring.mockImplementation(async (scope) => scope === 'active' ? activeList.promise : zeroPage([]));
    await mountRecurring(runtime, true);
    runEffects();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.listRecurring.mock.calls.map(([scope]) => scope)).toContain('maker');
    expect(runtime.listRecurring.mock.calls.map(([scope]) => scope)).toContain('filler');
    expect(runtime.readRecurring).not.toHaveBeenCalled();
    hooks.cleanups.forEach(cleanup => cleanup?.());
    activeList.resolve(zeroPage(['999']));
    await vi.runAllTimersAsync();

    expect(runtime.readRecurring).not.toHaveBeenCalled();
    expect(runtime.readPrivateRecurring).not.toHaveBeenCalled();
  });
});
