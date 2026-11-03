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
let tokenBalance: bigint;
let metadataSymbol: string;
let holdTokenRead: ((token: string, selector: string) => Promise<void> | undefined) | undefined;
let signerRequests: ReturnType<typeof vi.fn<() => Promise<never>>>;
let requests: Array<{ method: string; selector?: string; token?: string }>;
let mountOwner: (includeCustomTokens: boolean) => { ownerCustomTradeTokenInfoByAddress: Record<string, unknown> };
let mountComposer: (enabled: boolean) => ReturnType<typeof vi.fn>;
let mountP2P: (sessionKey?: string, privateToken?: string, overrides?: {
  walletKey?: string; walletHasAes?: boolean;
}) => ReturnType<typeof import('../../features/trading/hooks/useP2PTradeTokenData').default>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  hooks.effects = []; hooks.values = []; hooks.cleanups = [];
  hooks.effectDeps = []; hooks.callbacks = []; hooks.refs = [];
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
  requests = [];
  nativeBalance = 42n;
  tokenBalance = 7n;
  metadataSymbol = 'TOKEN';
  holdTokenRead = undefined;
  // Only the HTTP boundary is replaced; run the installed SDK and our real paced queue.
  FetchRequest.registerGetUrl(async request => {
    const payload = JSON.parse(new TextDecoder().decode(request.body!));
    const selector = payload.params?.[0]?.data?.slice(0, 10);
    requests.push({ method: payload.method, selector, token: payload.params?.[0]?.to?.toLowerCase() });
    await holdTokenRead?.(payload.params?.[0]?.to?.toLowerCase() ?? '', selector ?? '');
    await new Promise(resolve => setTimeout(resolve, 20));
    let result: string;
    if (payload.method === 'eth_chainId') result = `0x${CONFIGURED_COTI_NETWORK.chainIdDecimal.toString(16)}`;
    else if (payload.method === 'eth_getBalance') result = `0x${nativeBalance.toString(16)}`;
    else if (selector === '0x95d89b41') result = metadata.encodeFunctionResult('symbol', [metadataSymbol]);
    else if (selector === '0x313ce567') result = metadata.encodeFunctionResult('decimals', [6]);
    else if (selector === '0x70a08231') result = metadata.encodeFunctionResult('balanceOf', [tokenBalance]);
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
  signerRequests = vi.fn(async () => { throw new Error('Locked fixture must not request a signer'); });
  mountP2P = (sessionKey = 'owner:provider-1:locked', privateToken = '', overrides = {}) => {
    hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
    hooks.effects = [];
    return p2p({ balanceRefreshSessionKey: sessionKey,
    getTradeSigner: signerRequests,
    tradeOfferCustomTokenAddress: privateToken, tradeOfferTokenSelection: privateToken ? 'custom-private' : 'native',
    tradeRequestCustomTokenAddress: '', tradeRequestTokenSelection: 'native',
    tradeFeeEscrowContract: '0x0000000000000000000000000000000000000002', tradeRequiredFeeOverrideWei: 0n,
    walletAddress: '0x0000000000000000000000000000000000000001', walletKey: 'owner', walletHasAes: false,
    ...overrides });
  };
  mountOwner = includeCustomTokens => {
    hooks.stateIndex = hooks.refIndex = hooks.effectIndex = hooks.callbackIndex = 0;
    hooks.effects = [];
    return owner({ chainId: CONFIGURED_COTI_NETWORK.chainIdDecimal,
      ownerWalletAddress: '0x0000000000000000000000000000000000000001', ownerAesReady: false,
      getOwnerReadSigner: async () => { throw new Error('Locked fixture must not request a signer'); },
      refreshNonce: 0, includeCustomTokens });
  };
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
const privateBookView = (orderId: string) => ({
  orderId, maker: ownerAddress, status: 'open' as const, mode: 'private-pair' as const,
  offerAsset: { assetType: 'native' as const, token: `0x${'00'.repeat(20)}`, publicAmount: '0' },
  requestAsset: { assetType: 'native' as const, token: `0x${'00'.repeat(20)}`, publicAmount: '0' },
  fillPolicy: { partialFillsAllowed: false, minPartialFillBps: '0', maxFills: '0' },
  priceTerms: { offerAmount: '1', requestAmount: '2' }, offerLocked: true,
  offerTokenCodeHash: `0x${'00'.repeat(32)}`, requestTokenCodeHash: `0x${'00'.repeat(32)}`,
  pairKey: `0x${'00'.repeat(32)}`, createdAt: '1', expiresAt: '0', revision: '1', fillCount: '0',
  rootOrderId: orderId, replacementOrderId: '0', replacesOrderId: '0'
});
const directView = (tradeId: string) => ({ tradeId, maker: ownerAddress, taker: ownerAddress, offerAsset: nativeAsset, requestAsset: nativeAsset });

const makeOneOffRuntime = async () => {
  const { CURRENT_P2P_BINDING } = await import('../currentP2PBinding');
  const runtime = {
    isCurrent: () => true,
    deployments: CURRENT_P2P_BINDING.deployments,
    listStandard: vi.fn(async (scope: string) => zeroPage(
      scope === 'open' ? ['901'] : scope === 'maker' ? ['101'] : []
    )),
    readStandard: vi.fn(async (tradeId: string) => standardView(tradeId)),
    privateBook: {
      ownerAddress: ownerAddress,
      budgetVisibilityAvailable: false,
      list: vi.fn(async (scope: string) => zeroPage(
        scope === 'open' ? ['902'] : scope === 'maker' ? ['102'] : []
      )),
      read: vi.fn(async (orderId: string) => privateBookView(orderId)),
      readAccount: vi.fn(async (orderId: string) => ({ orderId, sequence: '1', totalOfferAmount: '99', totalRequestAmount: '198', remainingOfferAmount: '99' }))
    },
    listDirect: vi.fn(async (scope: string) => zeroPage(scope === 'maker' ? ['104'] : [])),
    readDirect: vi.fn(async (tradeId: string) => directView(tradeId))
  };
  return { runtime };
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

const flushHookEffects = async () => {
  runEffects();
  await vi.runAllTimersAsync();
};

describe('P2P display metadata through the real token loader', () => {
  const token = { address: '0x0000000000000000000000000000000000000077', kind: 'erc20' as const };
  const tokenKey = `erc20:${token.address}`;

  it('publishes display metadata without requesting a held owner balance', async () => {
    const balance = deferred<void>();
    holdTokenRead = (address, selector) => address === token.address && selector === '0x70a08231'
      ? balance.promise : undefined;
    const data = mountP2P();
    let settled = false;
    const loading = data.loadCustomTokenInfo(token, { silent: true, metadataOnly: true }).then(() => { settled = true; });
    // Stop before the SDK timeout. A blocked balance cannot pass by timing out.
    await vi.advanceTimersByTimeAsync(2_000);
    try {
      expect(settled).toBe(true);
      expect(requests.filter(request => request.selector === '0x70a08231')).toEqual([]);
      expect((hooks.values[0] as Record<string, object>)[tokenKey]).toMatchObject({ symbol: 'TOKEN', decimals: 6, balanceWei: null });
    } finally {
      balance.resolve();
      await vi.runAllTimersAsync();
      await loading;
    }
  });

  it('coalesces identical display reads and reuses metadata while explicit balance refresh stays fresh', async () => {
    const data = mountP2P();
    const first = data.loadCustomTokenInfo(token, { metadataOnly: true });
    const duplicate = data.loadCustomTokenInfo(token, { metadataOnly: true });
    await vi.runAllTimersAsync();
    await Promise.all([first, duplicate]);
    expect(metadataRequests()).toHaveLength(2);
    requests = [];
    const displayAgain = data.loadCustomTokenInfo(token, { metadataOnly: true });
    await vi.runAllTimersAsync(); await displayAgain;
    expect(requests).toEqual([]);

    tokenBalance = 13n;
    const refresh = data.loadCustomTokenInfo(token);
    await vi.runAllTimersAsync(); await refresh;
    expect((hooks.values[0] as Record<string, { balanceWei: bigint }>)[tokenKey].balanceWei).toBe(13n);
    tokenBalance = 19n;
    const refreshAgain = data.loadCustomTokenInfo(token);
    await vi.runAllTimersAsync(); await refreshAgain;
    expect((hooks.values[0] as Record<string, { balanceWei: bigint }>)[tokenKey].balanceWei).toBe(19n);
    expect(requests.filter(request => request.selector === '0x70a08231')).toHaveLength(2);
    requests = [];
    const displayAfterRefresh = data.loadCustomTokenInfo(token, { metadataOnly: true });
    await vi.runAllTimersAsync(); await displayAfterRefresh;
    expect((hooks.values[0] as Record<string, { balanceWei: bigint }>)[tokenKey].balanceWei).toBe(19n);
    expect(requests).toEqual([]);
  });

  it.each(['wallet', 'provider', 'chain', 'privacy'] as const)('does not reuse completed metadata after a %s scope change', async change => {
    const first = mountP2P().loadCustomTokenInfo(token, { metadataOnly: true });
    await vi.runAllTimersAsync(); await first;
    requests = [];
    const current = mountP2P(change === 'provider' ? 'owner:provider-2:locked'
      : change === 'chain' ? 'owner:chain-2:locked' : undefined, '', {
      walletKey: change === 'wallet' ? 'other-owner' : 'owner', walletHasAes: change === 'privacy'
    });
    runEffects();
    const next = current.loadCustomTokenInfo(token, { metadataOnly: true });
    await vi.runAllTimersAsync(); await next;
    expect(metadataRequests().filter(request => request.token === token.address)).toHaveLength(2);
    expect((hooks.values[0] as Record<string, object>)[tokenKey]).toMatchObject({ symbol: 'TOKEN', decimals: 6 });
  });

  it.each(['wallet', 'provider', 'chain', 'privacy'] as const)('rejects late metadata after a %s scope change', async change => {
    const metadataGate = deferred<void>();
    holdTokenRead = (address, selector) => address === token.address && selector === '0x95d89b41'
      ? metadataGate.promise : undefined;
    const loading = mountP2P().loadCustomTokenInfo(token, { silent: true, metadataOnly: true });
    await vi.advanceTimersByTimeAsync(1_100);
    mountP2P(change === 'provider' ? 'owner:provider-2:locked'
      : change === 'chain' ? 'owner:chain-2:locked' : undefined, '', {
      walletKey: change === 'wallet' ? 'other-owner' : 'owner', walletHasAes: change === 'privacy'
    });
    runEffects();
    metadataGate.resolve();
    await vi.runAllTimersAsync(); await loading;
    expect((hooks.values[0] as Record<string, object>)[tokenKey]).toBeUndefined();
  });

  it('preserves an existing private amount and disclosure state without a signer request', async () => {
    const data = mountP2P(undefined, '', { walletHasAes: true });
    const privateToken = { ...token, kind: 'private-erc20' as const };
    const privateKey = `private-erc20:${token.address}`;
    const entry = { ...privateToken, symbol: 'KNOWN', decimals: 6, balanceWei: 29n,
      privateBalanceState: { status: 'ready', balanceWei: 29n }, aesReady: true, walletKey: 'owner', loading: false };
    hooks.values[0] = { [privateKey]: entry };
    const loading = data.loadCustomTokenInfo(privateToken, { metadataOnly: true });
    await vi.runAllTimersAsync(); await loading;
    expect((hooks.values[0] as Record<string, object>)[privateKey]).toMatchObject({
      balanceWei: 29n, aesReady: true, privateBalanceState: { status: 'ready', balanceWei: 29n }
    });
    expect(requests.filter(request => request.selector === '0x70a08231')).toEqual([]);
    expect(signerRequests).not.toHaveBeenCalled();
  });

  it('does not carry another wallet private amount into a metadata-only entry', async () => {
    const data = mountP2P();
    const privateToken = { ...token, kind: 'private-erc20' as const };
    const privateKey = `private-erc20:${token.address}`;
    hooks.values[0] = { [privateKey]: { ...privateToken, symbol: 'OLD', decimals: 6, balanceWei: 29n,
      privateBalanceState: { status: 'ready', balanceWei: 29n }, aesReady: true, walletKey: 'prior-owner', loading: false } };
    const loading = data.loadCustomTokenInfo(privateToken, { metadataOnly: true });
    await vi.runAllTimersAsync(); await loading;
    expect((hooks.values[0] as Record<string, object>)[privateKey]).toMatchObject({
      walletKey: 'owner', balanceWei: null, aesReady: false, privateBalanceState: { status: 'locked' }
    });
  });
});

describe('startup token reads at the shared paced HTTP boundary', () => {
  it('reuses successful metadata across fallback refreshes while balance reads remain fresh', async () => {
    const data = mountP2P(); runEffects();
    await vi.runAllTimersAsync();
    requests = [];
    for (const amount of [43n, 44n, 45n]) {
      await vi.advanceTimersByTimeAsync(500);
      nativeBalance = amount; tokenBalance = amount + 1n;
      const refresh = data.refreshWalletBalances({ reason: 'interval', silent: true });
      await vi.runAllTimersAsync(); await refresh;
      expect(hooks.values[1]).toBe(amount);
      expect(hooks.values[2]).toBe(amount + 1n);
    }
    expect(metadataRequests()).toEqual([]);
    expect(requests.filter(request => request.method === 'eth_getBalance')).toHaveLength(3);
    expect(requests.filter(request => request.selector === '0x70a08231')).toHaveLength(3);
  });

  it('retries fallback metadata on an ordinary refresh instead of caching it as successful', async () => {
    metadataSymbol = '';
    const data = mountP2P(); runEffects();
    await vi.runAllTimersAsync();
    requests = []; metadataSymbol = 'RECOVERED';
    await vi.advanceTimersByTimeAsync(500);
    const refresh = data.refreshWalletBalances({ reason: 'focus', silent: true });
    await vi.runAllTimersAsync(); await refresh;
    expect(metadataRequests().length).toBeGreaterThan(0);
    expect(hooks.values[5]).toBe('RECOVERED');
    requests = [];
    await vi.advanceTimersByTimeAsync(500);
    const again = data.refreshWalletBalances({ reason: 'interval', silent: true });
    await vi.runAllTimersAsync(); await again;
    expect(metadataRequests()).toEqual([]);
  });

  it('does not downgrade a queued manual balance refresh when a fallback arrives', async () => {
    const data = mountP2P(); runEffects(); await vi.runAllTimersAsync();
    const { REWARD_TOKEN_ADDRESS } = await import('./core');
    const held = deferred<void>(); let heldOnce = false;
    holdTokenRead = (address, selector) => {
      if (!heldOnce && address === REWARD_TOKEN_ADDRESS.toLowerCase() && selector === '0x70a08231') {
        heldOnce = true; return held.promise;
      }
    };
    requests = []; await vi.advanceTimersByTimeAsync(500);
    const initial = data.refreshWalletBalances({ reason: 'interval', silent: true });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(heldOnce).toBe(true);
    const manual = data.refreshWalletBalances({ reason: 'manual' });
    const interval = data.refreshWalletBalances({ reason: 'interval', silent: true });
    held.resolve(); await vi.runAllTimersAsync(); await Promise.all([initial, manual, interval]);
    expect(metadataRequests().length).toBeGreaterThan(0);
    expect(requests.filter(request => request.method === 'eth_getBalance')).toHaveLength(2);
  });

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

  it.each(['manual', 'trade-action', 'wallet-action'] as const)('still reads fresh balances and token metadata for an explicit P2P %s refresh', async reason => {
    const data = mountP2P(); runEffects();
    await vi.runAllTimersAsync();
    requests = [];
    nativeBalance = 43n;
    // An explicit refresh must not reuse the completed connect pass.
    await vi.advanceTimersByTimeAsync(500);
    const refreshing = data.refreshWalletBalances({ reason });
    await vi.runAllTimersAsync();
    await refreshing;
    expect(hooks.values[1]).toBe(43n);
    expect(metadataRequests().some(request => request.token === '0x0000000000000000000000000000000000000014')).toBe(true);
  });

  it.each(['wallet', 'session', 'privacy'] as const)('rejects old primary balances after a deferred %s replacement', async change => {
    const data = mountP2P(); runEffects(); await vi.runAllTimersAsync();
    const { REWARD_TOKEN_ADDRESS } = await import('./core');
    const held = deferred<void>(); let heldOnce = false;
    holdTokenRead = (address, selector) => {
      if (!heldOnce && address === REWARD_TOKEN_ADDRESS.toLowerCase() && selector === '0x70a08231') {
        heldOnce = true; return held.promise;
      }
    };
    await vi.advanceTimersByTimeAsync(500);
    const refresh = data.refreshWalletBalances({ reason: 'interval', silent: true });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(heldOnce).toBe(true);
    mountP2P(change === 'session' ? 'owner:provider-2:locked' : undefined, '', {
      walletKey: change === 'wallet' ? 'other-owner' : 'owner', walletHasAes: change === 'privacy'
    });
    hooks.values[1] = 999n; hooks.values[2] = 888n;
    held.resolve(); await vi.runAllTimersAsync(); await refresh;
    expect(hooks.values[1]).toBe(999n);
    expect(hooks.values[2]).toBe(888n);
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
    const current = mountOwner(true);
    expect(Object.keys(current.ownerCustomTradeTokenInfoByAddress)).toHaveLength(10);
  });
});

describe('current-contract owner discovery', () => {
  it('finishes public discovery before it starts owner inventory reads', async () => {
    const { runtime } = await makeOneOffRuntime();
    const open = deferred<ReturnType<typeof zeroPage>>();
    runtime.listStandard.mockImplementation(async scope => scope === 'open' ? open.promise : zeroPage(['101']));
    await mountOneOff(runtime); runEffects(); await vi.runAllTimersAsync();
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toEqual(['open']);
    expect(runtime.privateBook.list.mock.calls.map(([scope]) => scope)).toEqual(['open']);
    expect(runtime.listDirect).not.toHaveBeenCalled();
    expect((hooks.values[0] as { openPrivateIds: Set<string> }).openPrivateIds.has('902')).toBe(true);
    open.resolve(zeroPage(['901'])); await vi.runAllTimersAsync();
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toEqual(['open', 'maker', 'filler']);
    expect(runtime.listDirect).toHaveBeenCalled();
  });

  it('releases public loading while an owner source remains pending and keeps the verified public rows', async () => {
    const { runtime } = await makeOneOffRuntime();
    const owner = deferred<ReturnType<typeof zeroPage>>();
    runtime.listStandard.mockImplementation(async scope => scope === 'maker' ? owner.promise
      : zeroPage(scope === 'open' ? ['901'] : []));
    await mountOneOff(runtime); runEffects(); await vi.runAllTimersAsync();
    const partial = await mountOneOff(runtime);
    expect(partial.oneOffV2PublicDiscoverySettled).toBe(true);
    expect(partial.loadingPublicOneOffV2Trades).toBe(false);
    expect(partial.oneOffV2DiscoverySettled).toBe(false);
    expect(partial.loadingOneOffV2Trades).toBe(true);
    expect((hooks.values[0] as { openStandardIds: Set<string> }).openStandardIds.has('901')).toBe(true);
    owner.resolve(zeroPage(['101'])); await vi.runAllTimersAsync();
    const raw = hooks.values[0] as { standardViews: Array<{ tradeId: string }> };
    expect(raw.standardViews.map(view => view.tradeId).sort()).toEqual(['101', '901']);
  });

  it('keeps prior participant rows through a public refresh and removes superseded participants after owner completion', async () => {
    const { runtime } = await makeOneOffRuntime();
    const first = await mountOneOff(runtime); await flushHookEffects();
    const owner = deferred<ReturnType<typeof zeroPage>>();
    runtime.listStandard.mockImplementation(async scope => scope === 'maker' ? owner.promise
      : zeroPage(scope === 'open' ? ['901'] : []));
    first.refreshOneOffV2Trades(); await mountOneOff(runtime); runEffects(); await vi.runAllTimersAsync();
    let raw = hooks.values[0] as { standardViews: Array<{ tradeId: string }>; participantStandardIds: Set<string> };
    expect(raw.participantStandardIds.has('101')).toBe(true);
    expect(raw.standardViews.map(view => view.tradeId)).toContain('101');
    owner.resolve(zeroPage(['201'])); await vi.runAllTimersAsync();
    raw = hooks.values[0] as typeof raw;
    expect([...raw.participantStandardIds]).toEqual(['201']);
    expect(raw.standardViews.map(view => view.tradeId).sort()).toEqual(['201', '901']);
  });

  it('settles a failed public attempt and continues owner recovery discovery', async () => {
    const { runtime } = await makeOneOffRuntime();
    runtime.listStandard.mockImplementation(async scope => {
      if (scope === 'open') throw new Error('Public page unavailable');
      return zeroPage(scope === 'maker' ? ['101'] : []);
    });
    await mountOneOff(runtime); await flushHookEffects();
    const result = await mountOneOff(runtime);
    expect(result.oneOffV2PublicDiscoverySettled).toBe(true);
    expect(result.oneOffV2DiscoverySettled).toBe(true);
    expect(result.oneOffV2TradesError).toContain('Public page unavailable');
    const raw = hooks.values[0] as { participantStandardIds: Set<string>; directViews: Array<{ tradeId: string }> };
    expect(raw.participantStandardIds.has('101')).toBe(true);
    expect(raw.directViews.map(view => view.tradeId)).toContain('104');
  });

  it('reuses the current public order read when the same order is in owner inventory', async () => {
    const { runtime } = await makeOneOffRuntime();
    runtime.listStandard.mockImplementation(async scope => zeroPage(scope === 'filler' ? [] : ['901']));
    runtime.privateBook.list.mockImplementation(async scope => zeroPage(scope === 'filler' ? [] : ['902']));
    await mountOneOff(runtime); await flushHookEffects();
    expect(runtime.readStandard).toHaveBeenCalledExactlyOnceWith('901');
    expect(runtime.privateBook.read).toHaveBeenCalledExactlyOnceWith('902');
    const raw = hooks.values[0] as { openStandardIds: Set<string>; participantStandardIds: Set<string> };
    expect(raw.openStandardIds.has('901')).toBe(true);
    expect(raw.participantStandardIds.has('901')).toBe(true);
  });

  it('publishes amount-free current rows before private hydration and rejects a disposed late result', async () => {
    const { runtime } = await makeOneOffRuntime();
    const account = deferred<{ orderId: string; sequence: string; totalOfferAmount: string; totalRequestAmount: string; remainingOfferAmount: string }>();
    const active = Object.assign(runtime, { privateBook: { ...runtime.privateBook, readAccount: vi.fn(async () => account.promise) } });
    await mountOneOff(active, false, async () => {}, true);
    await flushHookEffects();
    await mountOneOff(active, false, async () => {}, true);
    await flushHookEffects();
    const partial = hooks.values[0] as { privateBookViews: Array<{ orderId: string }>; privateAccounts: object };
    expect(partial.privateBookViews.map(row => row.orderId)).toContain('102');
    expect(partial.privateAccounts).toEqual({});
    expect(hooks.values[1]).toBe(false);
    expect(active.privateBook.readAccount).toHaveBeenCalledOnce();
    hooks.cleanups.forEach(cleanup => cleanup?.());
    account.resolve({ orderId: '102', sequence: '2', totalOfferAmount: '99', totalRequestAmount: '198', remainingOfferAmount: '99' });
    await vi.runAllTimersAsync();
    expect(hooks.values[0]).toBe(partial);
    expect(partial.privateAccounts).toEqual({});
  });

  it('skips global one-off books but keeps current participant reads', async () => {
    const { runtime } = await makeOneOffRuntime();
    await mountOneOff(runtime, false);
    await flushHookEffects();

    const raw = hooks.values[0] as {
      openStandardIds: Set<string>; openPrivateIds: Set<string>; participantStandardIds: Set<string>;
      directViews: Array<{ tradeId: string }>;
    };
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).not.toContain('open');
    expect(runtime.privateBook.list.mock.calls.map(([scope]) => scope)).not.toContain('open');
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(runtime.privateBook.list.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'filler']);
    expect(runtime.listDirect.mock.calls.map(([scope]) => scope)).toEqual(['maker', 'taker']);
    expect(raw.openStandardIds.size).toBe(0);
    expect(raw.openPrivateIds.size).toBe(0);
    expect(raw.participantStandardIds.has('101')).toBe(true);
    expect(raw.directViews.map(view => view.tradeId)).toContain('104');
    expect(hooks.values[1]).toBe(false);
    expect(hooks.values[2]).toBe('');
  });

  it('keeps default one-off Offers discovery enabled', async () => {
    const { runtime } = await makeOneOffRuntime();
    await mountOneOff(runtime);
    await flushHookEffects();

    const raw = hooks.values[0] as { openStandardIds: Set<string>; openPrivateIds: Set<string> };
    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toContain('open');
    expect(runtime.privateBook.list.mock.calls.map(([scope]) => scope)).toContain('open');
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

    expect(runtime.listStandard.mock.calls.map(([scope]) => scope)).toEqual(['open']);
    expect(runtime.readStandard).not.toHaveBeenCalled();
    const privateReadsBeforeDisposal = runtime.privateBook.read.mock.calls.length;
    hooks.cleanups.forEach(cleanup => cleanup?.());
    openList.resolve(zeroPage(['999']));
    await vi.runAllTimersAsync();

    expect(runtime.readStandard).not.toHaveBeenCalled();
    expect(runtime.privateBook.read).toHaveBeenCalledTimes(privateReadsBeforeDisposal);
    expect(runtime.readDirect).not.toHaveBeenCalled();
    expect(ensureTokenInfo).not.toHaveBeenCalled();
  });

});
