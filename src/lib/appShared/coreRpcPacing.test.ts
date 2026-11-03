import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbiCoder, Contract, FetchRequest, type FetchGetUrlFunc, type JsonRpcProvider } from '@coti-io/coti-ethers';
import { CONFIGURED_COTI_NETWORK } from '../chainWhisperNetworks';
import { createPacedCotiRpc } from './cotiRpcPacing';
import { createBrowserWalletRuntimeReadGuard } from '../browserWalletRuntimeScope';

const originalGetUrl = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl).getUrlFunc;
let provider: JsonRpcProvider | undefined;
let status = 200;
let inFlight = 0;
let maximumInFlight = 0;
let calls: Array<{ at: number; batch: boolean; methods: string[] }> = [];
let reportedChainId = CONFIGURED_COTI_NETWORK.chainIdDecimal;
let callResult = '0x123';
let transportHold: Promise<void> | undefined;
type RpcInput = { id: number; method: string; params: unknown[] };
let rpcInputs: RpcInput[] = [];
let rpcReply: ((input: RpcInput) => unknown) | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  status = 200;
  inFlight = 0;
  maximumInFlight = 0;
  calls = [];
  reportedChainId = CONFIGURED_COTI_NETWORK.chainIdDecimal;
  callResult = '0x123';
  transportHold = undefined;
  rpcInputs = [];
  rpcReply = undefined;
  // Only HTTP is replaced. Exercise the installed COTI provider and FetchRequest.
  FetchRequest.registerGetUrl(async (request) => {
    const body = JSON.parse(new TextDecoder().decode(request.body!));
    const items = Array.isArray(body) ? body : [body];
    rpcInputs.push(...items);
    calls.push({ at: performance.now(), batch: Array.isArray(body), methods: items.map((v) => v.method) });
    maximumInFlight = Math.max(maximumInFlight, ++inFlight);
    await transportHold;
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight--;
    const replies = items.map((v) => rpcReply ? rpcReply(v) : ({ jsonrpc: '2.0', id: v.id,
      result: v.method === 'eth_chainId' ? `0x${reportedChainId.toString(16)}`
        : v.method === 'eth_call' ? callResult : '0x123' }));
    return { statusCode: status, statusMessage: status === 200 ? 'OK' : 'Forbidden', headers: {},
      body: new TextEncoder().encode(JSON.stringify(Array.isArray(body) ? replies : replies[0])) };
  });
});

afterEach(() => {
  provider?.destroy();
  provider = undefined;
  FetchRequest.registerGetUrl(originalGetUrl);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function start() {
  const { loadCotiHttpProvider } = await import('./core');
  const starting = loadCotiHttpProvider();
  await vi.runAllTimersAsync();
  provider = await starting;
  const ready = provider.send('eth_blockNumber', []);
  await vi.runAllTimersAsync();
  await ready;
  return loadCotiHttpProvider;
}

describe('shared browser HTTP RPC pacing', () => {
  it.each([0, 334, 500])('starts the %dms comparison on the selected view without a P2P detour', async interval => {
    vi.stubEnv('MODE', 'coti-testnet-candidate'); vi.stubEnv('VITE_RPC_COMPARISON', String(interval));
    vi.stubGlobal('location', { hostname: 'localhost' });
    const attributes = new Map<string, string>();
    let changed = () => {};
    const observe = vi.fn();
    vi.stubGlobal('document', { documentElement: {
      setAttribute: (key: string, value: string) => { attributes.set(key, value); },
      getAttribute: (key: string) => attributes.get(key) ?? null
    } });
    vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { changed = callback; } observe = observe; });
    const { loadCotiHttpProvider, loadCotiStartupReadProvider } = await import('./core');
    const pending = loadCotiHttpProvider(); await vi.advanceTimersByTimeAsync(1_000); provider = await pending;
    expect(observe).toHaveBeenCalledOnce();
    const queue = () => JSON.parse(attributes.get('data-coti-rpc-queue')!);
    expect(queue().comparison.timingStartedAt).toBeNull();
    const setupStarts = queue().started;
    attributes.set('data-coti-read-view', JSON.stringify({ page: 'dex', privateReadsEnabled: false }));
    changed();
    expect(queue().comparison.timingStartedAt).toBeNull();
    attributes.set('data-coti-read-view', JSON.stringify({ page: 'dex', privateReadsEnabled: true }));
    changed();
    expect(queue().comparison).toMatchObject({ timingStartedAt: Date.now(), startedBeforeTiming: setupStarts });
    attributes.set('data-coti-read-view', JSON.stringify({ page: 'trades', privateReadsEnabled: true }));
    attributes.set('data-p2p-canonical-history', JSON.stringify({ state: 'loading', privateReadsEnabled: true }));
    changed();
    expect(queue().comparison).toMatchObject({ timingStartedAt: Date.now(), startedBeforeTiming: setupStarts });
    attributes.set('data-p2p-canonical-history', JSON.stringify({ state: 'complete', privateReadsEnabled: true }));
    changed();
    expect(queue()).toMatchObject({ stopped: false, comparison: { reason: null } });
    const starts = calls.length;
    const otherPriority = loadCotiStartupReadProvider();
    await vi.advanceTimersByTimeAsync(1_000);
    const startupProvider = await otherPriority;
    expect(calls.length).toBeGreaterThan(starts);
    startupProvider.destroy();
    attributes.set('data-p2p-canonical-history', JSON.stringify({ state: 'error', privateReadsEnabled: true }));
    changed();
    expect(queue()).toMatchObject({ stopped: true, comparison: { reason: 'history-error' } });
    attributes.set('data-p2p-canonical-history', JSON.stringify({ state: 'complete', privateReadsEnabled: true }));
    changed();
    const stoppedStarts = calls.length;
    const blocked = provider.send('eth_blockNumber', []).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await blocked).toBeInstanceOf(Error);
    expect(calls).toHaveLength(stoppedStarts);
  });

  it.each([[0, 2000], [334, 600], [500, 600]] as const)('caps %dms comparison setup and unlocked work together at %d physical starts', async (interval, limit) => {
    const starts: number[] = [];
    const transport = vi.fn(async () => { starts.push(performance.now()); return { statusCode: 200, statusMessage: 'OK', headers: {},
      body: new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"result":"0x1"}') }; });
    const snapshots: Array<{ started: number; comparison?: { startedBeforeTiming: number | null; reason: string | null } }> = [];
    const paced = createPacedCotiRpc(transport, value => snapshots.push(value), true, interval);
    const request = new FetchRequest('https://example.invalid'); request.timeout = 400_000;
    const setup = Array.from({ length: 20 }, () => paced(request));
    await vi.advanceTimersByTimeAsync(10_000); await Promise.all(setup);
    paced.beginComparison();
    const rest = Promise.allSettled(Array.from({ length: limit - 20 + 1 }, (_, i) => i % 2 ? paced(request) : paced.foreground(request)));
    await vi.runAllTimersAsync();
    expect((await rest).filter(value => value.status === 'fulfilled')).toHaveLength(limit - 20);
    expect(transport).toHaveBeenCalledTimes(limit);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(interval);
    expect(snapshots[snapshots.length - 1]).toMatchObject({ started: limit, comparison: { startedBeforeTiming: 20, reason: 'request-limit' } });
    await expect(paced(request)).rejects.toThrow(/comparison stopped/);
    expect(transport).toHaveBeenCalledTimes(limit);
  });

  it('starts the five-minute comparison deadline only at privacy readiness and cannot restart it', async () => {
    const transport = vi.fn(async () => ({ statusCode: 200, statusMessage: 'OK', headers: {},
      body: new TextEncoder().encode('{"result":"0x1"}') }));
    const paced = createPacedCotiRpc(transport, undefined, true);
    const request = new FetchRequest('https://example.invalid'); request.timeout = 400_000;
    await paced(request); await vi.advanceTimersByTimeAsync(400_000);
    await paced(request);
    paced.beginComparison(); await vi.advanceTimersByTimeAsync(299_999);
    paced.beginComparison(); await vi.advanceTimersByTimeAsync(1);
    await expect(paced(request)).rejects.toThrow(/time-limit/);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(['transport', 'http', 'rpc', 'malformed'])('stops all comparison reads after a %s failure', async failure => {
    const transport = vi.fn(async () => {
      if (failure === 'transport') throw new Error('offline');
      return { statusCode: failure === 'http' ? 503 : 200, statusMessage: 'test', headers: {},
        body: new TextEncoder().encode(failure === 'malformed' ? '{' : '{"error":{"code":-32000,"message":"failed"}}') };
    });
    const paced = createPacedCotiRpc(transport, undefined, true);
    const request = new FetchRequest('https://example.invalid'); request.timeout = 10_000;
    const results = Promise.allSettled([paced(request), paced.foreground(request)]);
    await vi.runAllTimersAsync();
    expect((await results).every(value => value.status === 'rejected')).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each(['selector', 'non-call', 'private data', 'malformed'] as const)('retains safe comparison RPC context for %s and still stops without retry', async kind => {
    const snapshots: unknown[] = [];
    const transport = vi.fn(async () => ({ statusCode: 200, statusMessage: 'OK',
      headers: { 'X-Request-ID': 'request-123' },
      body: new TextEncoder().encode(kind === 'malformed' ? '{private-response-body' : JSON.stringify({ jsonrpc: '2.0', id: 99,
        error: { code: kind === 'selector' || kind === 'non-call' ? -32000 : 'private-code', message: 'private-response-message',
          data: kind === 'selector' || kind === 'non-call' ? '0xdeadbeef' : '0xdeadbeef' + 'ab'.repeat(32) } })) }));
    const paced = createPacedCotiRpc(transport, snapshot => snapshots.push(snapshot), true);
    const request = new FetchRequest('https://provider.invalid/private-path?key=private-key');
    request.body = kind === 'non-call'
      ? { jsonrpc: '2.0', id: 99, method: 'eth_blockNumber', params: [] }
      : { jsonrpc: '2.0', id: 99, method: 'eth_call',
        params: [{ to: 'private-address', data: '0x12345678' + 'cd'.repeat(64) }, 'latest'] };
    const rejected = paced.foreground(request).catch(error => error);
    await vi.runAllTimersAsync();
    expect((await rejected).message).toMatch(/Comparison RPC failure/);
    const final = snapshots[snapshots.length - 1];
    expect(final).toMatchObject({ stopped: true, started: 1,
      failure: { kind: 'rpc', method: kind === 'non-call' ? 'eth_blockNumber' : 'eth_call', category: 'foreground',
        provider: 'provider.invalid', status: 200, headers: { 'x-request-id': 'request-123' } } });
    if (kind === 'non-call') {
      expect(final).toMatchObject({ failure: { rpcCode: -32000 } });
      expect(JSON.stringify(final)).not.toMatch(/callSelector|revertSelector/);
    } else expect(final).toMatchObject({ failure: { callSelector: '0x12345678' } });
    if (kind === 'selector') expect(final).toMatchObject({ failure: { rpcCode: -32000, revertSelector: '0xdeadbeef' } });
    else if (kind !== 'non-call') expect(JSON.stringify(final)).not.toMatch(/rpcCode|revertSelector/);
    expect(JSON.stringify(snapshots)).not.toMatch(/private-|params|abcdabcd|abababab|cdcdcdcd/);
    await expect(paced(request)).rejects.toThrow(/comparison stopped/);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('rejects a late physical result after the absolute comparison deadline', async () => {
    const transport = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 310_000));
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new TextEncoder().encode('{"result":"0x1"}') };
    });
    const paced = createPacedCotiRpc(transport, undefined, true, 500);
    const request = new FetchRequest('https://example.invalid'); request.timeout = 400_000;
    paced.beginComparison();
    const result = paced(request).catch(error => error);
    await vi.advanceTimersByTimeAsync(300_000);
    const later = paced(request).catch(error => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await later).toMatchObject({ message: expect.stringMatching(/time-limit/) });
    expect(await result).toMatchObject({ message: expect.stringMatching(/time-limit/) });
    expect(transport).toHaveBeenCalledOnce();
  });

  it('lets the guarded Limit history reader skip an expected denial through the installed SDK', async () => {
    vi.stubEnv('MODE', 'coti-testnet-candidate'); vi.stubEnv('VITE_RPC_COMPARISON', '0');
    vi.stubGlobal('location', { hostname: 'localhost' });
    const attributes = new Map<string, string>();
    vi.stubGlobal('document', { documentElement: {
      setAttribute: (key: string, value: string) => { attributes.set(key, value); },
      getAttribute: (key: string) => attributes.get(key) ?? null
    } });
    vi.stubGlobal('MutationObserver', class { observe() {} });
    await start();
    const { sendCotiScopedRead } = await import('./core');
    const { currentLimitFillHistoryAbi: abi, readCurrentLimitFillHistoryPage,
      SHARED_RECEIPT_LIMIT_FILL_HISTORY_GRAPH: graph } = await import('../currentDexLimitFillHistory');
    const coder = AbiCoder.defaultAbiCoder(), hash = `0x${'55'.repeat(32)}`;
    const owner = `0x${'22'.repeat(20)}`, engine = `0x${'11'.repeat(20)}`;
    const sdkErrors = vi.spyOn(provider!, 'getRpcError');
    rpcReply = input => {
      if (input.method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id: input.id,
        result: { number: input.params[0], hash, timestamp: input.params[0] === '0x64' ? '0x3e8' : '0x3e3' } };
      expect(input.method).toBe('eth_call');
      const [action, record] = abi.decodeFunctionData('limitFillHistory', (input.params[0] as { data: string }).data);
      if (action === 1n && record === 1n) return { jsonrpc: '2.0', id: input.id,
        error: { code: 3, message: 'execution reverted', data: abi.getError('ReceiptAccessDenied')!.selector } };
      const value = action === 0n ? coder.encode(['uint256'], [2n])
        : coder.encode(['uint256', 'uint256', 'tuple(uint256 ciphertextHigh,uint256 ciphertextLow)[3]', 'uint256'],
          [95n, 995n, [[1n, 7n], [1n, 5n], [1n, 10n]], 1n]);
      return { jsonrpc: '2.0', id: input.id, result: abi.encodeFunctionResult('limitFillHistory', [value]) };
    };
    const guard = createBrowserWalletRuntimeReadGuard(() => {});
    const result = readCurrentLimitFillHistoryPage({ graph, owner, engine,
      poolTokens: [`0x${'33'.repeat(20)}`, `0x${'44'.repeat(20)}`], head: { number: 100n, hash, timestamp: 1000n },
      rpc: (method, params) => sendCotiScopedRead(provider!, guard, method, params), assertCurrent: guard.assertCurrent,
      attest: () => {}, decrypt: cipher => BigInt(cipher.ciphertextLow), decryptBool: cipher => cipher === 1n
    }).then(page => ({ page }), error => ({ error }));
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ page: { complete: true, count: 2n, nextBefore: 0n,
      fills: [{ record: 0n, positionId: 7n, sold: 5n, received: 10n }] } });
    expect(sdkErrors).toHaveBeenCalledOnce();
    expect(sdkErrors.mock.results[0].value).toMatchObject({ code: 'CALL_EXCEPTION', data: '0x26abae6e' });
    expect(JSON.parse(attributes.get('data-coti-rpc-queue')!)).toMatchObject({ stopped: false, comparison: { reason: null } });
    expect(maximumInFlight).toBe(1);
  });

  it.each(['unscoped', 'positive id', 'method', 'selector', 'count action', 'refresh action', 'extra calldata',
    'bad owner', 'unpinned block', 'request batch', 'reply batch', 'wrong id', 'wrong version', 'error and result',
    'other code', 'other revert', 'revert arguments', 'http status'] as const)('keeps the Limit history comparison stop for %s', async fault => {
    const request = new FetchRequest('https://example.invalid');
    const payload = { jsonrpc: '2.0', id: -1, method: 'eth_call', params: [
      { from: `0x${'22'.repeat(20)}`, to: `0x${'11'.repeat(20)}`,
        data: '0x397d0465' + '0'.repeat(63) + '1' + '0'.repeat(64) },
      { blockHash: `0x${'55'.repeat(32)}`, requireCanonical: true }
    ] as unknown[] };
    const call = payload.params[0] as { data: string; from: string };
    if (fault === 'positive id') payload.id = 1;
    if (fault === 'method') payload.method = 'eth_estimateGas';
    if (fault === 'selector') call.data = '0x12345678' + call.data.slice(10);
    if (fault === 'count action' || fault === 'refresh action') call.data = '0x397d0465' + '0'.repeat(63) +
      (fault === 'count action' ? '0' : '2') + '0'.repeat(64);
    if (fault === 'extra calldata') call.data += '00';
    if (fault === 'bad owner') call.from = 'invalid';
    if (fault === 'unpinned block') payload.params[1] = 'latest';
    request.body = fault === 'request batch' ? [payload] : payload;
    const reply: Record<string, unknown> = { jsonrpc: fault === 'wrong version' ? '1.0' : '2.0',
      id: fault === 'wrong id' ? -2 : payload.id,
      error: { code: fault === 'other code' ? -32000 : 3, message: 'execution reverted',
        data: fault === 'other revert' ? '0xdeadbeef' : '0x26abae6e' + (fault === 'revert arguments' ? '00' : '') } };
    if (fault === 'error and result') reply.result = '0x';
    const transport = vi.fn(async () => ({ statusCode: fault === 'http status' ? 503 : 200, statusMessage: 'test',
      headers: {}, body: new TextEncoder().encode(JSON.stringify(fault === 'reply batch' ? [reply] : reply)) }));
    const paced = createPacedCotiRpc(transport, undefined, true, 0);
    const guard = createBrowserWalletRuntimeReadGuard(() => {});
    const result = (fault === 'unscoped' ? paced(request) : paced(request, undefined, guard.signal, guard.assertCurrent))
      .catch(error => error);
    await vi.runAllTimersAsync();
    expect((await result).message).toMatch(/Comparison (RPC|HTTP) failure/);
    await expect(paced(request)).rejects.toThrow(/comparison stopped/);
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([403, 429])('preserves HTTP %s and prevents installed-SDK retry during comparison', async code => {
    const transport = vi.fn(async () => ({ statusCode: code, statusMessage: 'blocked', headers: {}, body: new Uint8Array() }));
    const paced = createPacedCotiRpc(transport, undefined, true);
    const request = new FetchRequest('https://example.invalid'); request.getUrlFunc = paced;
    const results = Promise.allSettled([request.send(), request.clone().send()]);
    await vi.runAllTimersAsync();
    for (const result of await results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason.message).toContain(`HTTP ${code}`);
    }
    expect(transport).toHaveBeenCalledOnce();
  });

  it('removes a disposed unsent read without consuming its physical start slot', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const starts: Array<{ id: number; at: number }> = [];
    const paced = createPacedCotiRpc(async request => {
      const { id } = JSON.parse(new TextDecoder().decode(request.body!));
      starts.push({ id, at: performance.now() });
      if (id === 0) await held;
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new Uint8Array() };
    });
    const request = (id: number) => {
      const value = new FetchRequest('https://example.invalid'); value.timeout = 10_000;
      value.body = { id, method: 'eth_getBalance', params: [] }; return value;
    };
    const first = paced(request(0));
    const oldScope = createBrowserWalletRuntimeReadGuard(() => {});
    const obsolete = oldScope.run(() => paced(request(1), undefined, oldScope.signal)).catch(error => error);
    oldScope.close();
    const current = paced(request(2));
    release();
    await vi.runAllTimersAsync(); await Promise.all([first, current]);
    expect((await obsolete).message).toMatch(/replaced/);
    expect(starts).toEqual([{ id: 0, at: 0 }, { id: 2, at: 0 }]);
  });

  it('settles and removes queued expiry while older physical transport remains pending', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const transport = vi.fn(async () => {
      await held; return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new Uint8Array() };
    });
    const snapshots: Array<{ queuedEssential: number; stopped: boolean; inFlight: boolean }> = [];
    const paced = createPacedCotiRpc(transport, snapshot => snapshots.push(snapshot));
    const request = new FetchRequest('https://example.invalid'); request.timeout = 10_000;
    const first = paced(request);
    const short = request.clone(); short.timeout = 1_000;
    let state = 'pending';
    const expired = paced(short).catch(error => { state = error.code; return error; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state).toBe('COTI_RPC_QUEUE_EXPIRED');
    expect((await expired).queueTiming).toMatchObject({ waitedMs: 1_000, budgetMs: 1_000, completed: 0 });
    expect(snapshots[snapshots.length - 1]).toMatchObject({ queuedEssential: 0, stopped: false, inFlight: true });
    expect(transport).toHaveBeenCalledOnce();
    release(); await vi.runAllTimersAsync(); await first;
  });

  it('removes a disposed read during pacing and lets the current read use the next start', async () => {
    const starts: number[] = [];
    const paced = createPacedCotiRpc(async () => {
      starts.push(performance.now());
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new TextEncoder().encode('{"result":"0x1"}') };
    }, undefined, true, 500);
    const request = new FetchRequest('https://example.invalid'); request.timeout = 10_000;
    await paced(request);
    const old = createBrowserWalletRuntimeReadGuard(() => {});
    const obsolete = paced(request, undefined, old.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    old.close();
    const current = paced(request);
    await vi.runAllTimersAsync(); await current;
    expect((await obsolete).message).toMatch(/replaced/);
    expect(starts).toEqual([0, 500]);
  });

  it('cancels only scoped unsent SDK reads and preserves another consumer and in-flight transport', async () => {
    await start();
    const core = await import('./core');
    let release!: () => void;
    transportHold = new Promise<void>(resolve => { release = resolve; });
    const originalPacedTransport = provider!._getConnection().getUrlFunc;
    // The shared pacer captured this installed-SDK HTTP boundary before startup.
    const old = createBrowserWalletRuntimeReadGuard(() => {});
    const startsBefore = calls.length;
    const running = core.sendCotiScopedRead(provider!, old, 'eth_blockNumber', []).catch(error => error);
    await vi.advanceTimersByTimeAsync(500);
    const queued = core.sendCotiScopedRead(provider!, old, 'eth_getStorageAt', [`0x${'11'.repeat(20)}`, '0x0',
      { blockHash: `0x${'22'.repeat(32)}`, requireCanonical: true }]).catch(error => error);
    old.close();
    const current = createBrowserWalletRuntimeReadGuard(() => {});
    const next = core.sendCotiScopedRead(provider!, current, 'eth_getTransactionReceipt', ['current']);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.length - startsBefore).toBe(1);
    expect(inFlight).toBe(1);
    expect(await queued).toMatchObject({ message: expect.stringMatching(/replaced/) });
    release();
    await vi.runAllTimersAsync();
    expect(await running).toMatchObject({ message: expect.stringMatching(/replaced/) });
    await next;
    expect(calls.slice(startsBefore).flatMap(call => call.methods)).toEqual(['eth_blockNumber', 'eth_getTransactionReceipt']);
    expect(provider!._getConnection().getUrlFunc).toBe(originalPacedTransport);
    expect(maximumInFlight).toBe(1);
  });

  it('preserves each supported raw method, params and response ID on admitted SDK connections', async () => {
    await start();
    const core = await import('./core');
    const starting = core.loadCotiStartupReadProvider();
    await vi.runAllTimersAsync();
    const startup = await starting;
    try {
      const inputs = [
        { method: 'eth_chainId', params: [] },
        { method: 'eth_blockNumber', params: [] },
        { method: 'eth_getBlockByNumber', params: ['0x10', false] },
        { method: 'eth_getCode', params: ['address', { blockHash: 'hash', requireCanonical: true }] },
        { method: 'eth_getStorageAt', params: [`0x${'11'.repeat(20)}`, '0x00', { blockHash: `0x${'22'.repeat(32)}`, requireCanonical: true }] },
        { method: 'eth_call', params: [{ to: 'address', data: '0x12345678' }, 'latest'] },
        { method: 'eth_getLogs', params: [{ fromBlock: '0x1', toBlock: '0x10', topics: [] }] },
        { method: 'eth_getTransactionReceipt', params: ['transaction'] },
        { method: 'eth_getTransactionByHash', params: [`0x${'33'.repeat(32)}`] }
      ];
      rpcReply = input => ({ jsonrpc: '2.0', id: input.id, result: { method: input.method, params: input.params } });
      rpcInputs = []; calls = [];
      const guard = createBrowserWalletRuntimeReadGuard(() => {});
      const reads = inputs.map((input, index) => core.sendCotiScopedRead(index % 2 ? startup : provider!, guard,
        input.method, input.params));
      await vi.runAllTimersAsync();
      expect(await Promise.all(reads)).toEqual(inputs);
      expect(new Set(rpcInputs.map(input => input.id)).size).toBe(inputs.length);
      expect(rpcInputs.every(input => input.id < 0)).toBe(true);
      expect(calls.every(call => !call.batch)).toBe(true);
      expect(maximumInFlight).toBe(1);
      for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(20);
      const before = calls.length;
      await expect(core.sendCotiScopedRead(provider!, guard, 'eth_sendRawTransaction', ['signed'])).rejects.toThrow(/Unsupported/);
      expect(calls.length).toBe(before);
    } finally { startup.destroy(); }
  });

  it.each([[], ['not-a-hash'], [123], [`0x${'11'.repeat(31)}`], [`0x${'11'.repeat(32)}`, 'extra']])('rejects malformed scoped transaction parameters %j before transport', async (...params) => {
    await start(); const { sendCotiScopedRead } = await import('./core'); const starts = calls.length;
    await expect(sendCotiScopedRead(provider!, createBrowserWalletRuntimeReadGuard(() => {}), 'eth_getTransactionByHash', params)).rejects.toThrow(/Invalid scoped/);
    expect(calls).toHaveLength(starts);
  });

  it.each(['destination', 'slot', 'wide-slot', 'block', 'canonical', 'extra'] as const)('rejects malformed scoped storage %s before transport', async fault => {
    await start(); const core = await import('./core');
    const params: unknown[] = [`0x${'11'.repeat(20)}`, '0x0', { blockHash: `0x${'22'.repeat(32)}`, requireCanonical: true }];
    if (fault === 'destination') params[0] = 'invalid';
    if (fault === 'slot') params[1] = -1;
    if (fault === 'wide-slot') params[1] = `0x${'1'.repeat(65)}`;
    if (fault === 'block') params[2] = 'latest';
    if (fault === 'canonical') params[2] = { blockHash: `0x${'22'.repeat(32)}`, requireCanonical: false };
    if (fault === 'extra') params.push('extra');
    const starts = calls.length;
    await expect(core.sendCotiScopedRead(provider!, createBrowserWalletRuntimeReadGuard(() => {}), 'eth_getStorageAt', params)).rejects.toThrow(/Invalid scoped/);
    expect(calls).toHaveLength(starts);
  });

  it.each(['wrong-id', 'missing-result', 'duplicate-id'])('rejects %s SDK HTTP responses', async mode => {
    await start();
    const { sendCotiScopedRead } = await import('./core');
    rpcReply = input => mode === 'wrong-id' ? { jsonrpc: '2.0', id: input.id - 1, result: 'unrelated' }
      : mode === 'missing-result' ? { jsonrpc: '2.0', id: input.id }
      : [{ jsonrpc: '2.0', id: input.id, result: 'first' }, { jsonrpc: '2.0', id: input.id, result: 'second' }];
    const read = sendCotiScopedRead(provider!, createBrowserWalletRuntimeReadGuard(() => {}), 'eth_blockNumber', [])
      .catch(error => error);
    await vi.runAllTimersAsync();
    expect(await read).toMatchObject({ code: 'BAD_DATA' });
  });

  it('uses installed SDK revert decoding and preserves its error code', async () => {
    await start();
    const { sendCotiScopedRead } = await import('./core');
    rpcReply = input => ({ jsonrpc: '2.0', id: input.id,
      error: { code: -32000, message: 'execution reverted', data: '0x' } });
    const read = sendCotiScopedRead(provider!, createBrowserWalletRuntimeReadGuard(() => {}), 'eth_call', [{
      to: '0x1111111111111111111111111111111111111111', data: '0x12345678'
    }, 'latest']).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await read).toMatchObject({ code: 'CALL_EXCEPTION', action: 'call', data: '0x' });
  });

  it('refuses a connection that no longer uses the admitted shared queue', async () => {
    await start();
    const { sendCotiScopedRead } = await import('./core');
    const connection = provider!._getConnection();
    const unpaced = vi.fn(async () => { throw new Error('Unpaced transport must not run.'); });
    connection.getUrlFunc = unpaced;
    const getConnection = vi.spyOn(provider!, '_getConnection').mockReturnValue(connection);
    const before = calls.length;
    try {
      await expect(sendCotiScopedRead(provider!, createBrowserWalletRuntimeReadGuard(() => {}), 'eth_blockNumber', []))
        .rejects.toThrow(/shared RPC queue/);
      expect(unpaced).not.toHaveBeenCalled();
      expect(calls.length).toBe(before);
    } finally { getConnection.mockRestore(); }
  });

  it('checks the lease again before a queued SDK request reaches physical transport', async () => {
    await start();
    const { sendCotiScopedRead } = await import('./core');
    let release!: () => void;
    transportHold = new Promise<void>(resolve => { release = resolve; });
    const running = provider!.send('eth_blockNumber', []);
    await vi.advanceTimersByTimeAsync(0);
    let current = true;
    const old = createBrowserWalletRuntimeReadGuard(() => { if (!current) throw new Error('Session changed'); });
    const before = calls.length;
    const obsolete = sendCotiScopedRead(provider!, old, 'eth_getCode', ['old', 'latest']).catch(error => error);
    current = false;
    const next = sendCotiScopedRead(provider!, createBrowserWalletRuntimeReadGuard(() => {}), 'eth_blockNumber', []);
    release();
    await vi.runAllTimersAsync(); await Promise.all([running, next]);
    expect(await obsolete).toMatchObject({ message: 'Session changed' });
    expect(calls.slice(before).flatMap(call => call.methods)).toEqual(['eth_blockNumber']);
  });

  it('rejects an obsolete bootstrap result without cancelling the shared provider for another consumer', async () => {
    const { loadCotiHttpProvider, sendCotiScopedRead } = await import('./core');
    const old = createBrowserWalletRuntimeReadGuard(() => {});
    const obsolete = old.run(loadCotiHttpProvider).catch(error => error);
    old.close();
    const current = createBrowserWalletRuntimeReadGuard(() => {});
    const ready = current.run(loadCotiHttpProvider);
    await vi.runAllTimersAsync();
    provider = await ready;
    expect((await obsolete).message).toMatch(/replaced/);
    expect(provider.destroyed).toBe(false);
    const read = sendCotiScopedRead(provider, current, 'eth_blockNumber', []);
    await vi.runAllTimersAsync();
    expect(await read).toBe('0x123');
    expect(calls.flatMap(call => call.methods)).toEqual(['eth_chainId', 'eth_blockNumber']);
  });

  it('shares dynamic chain checks within four-getter windows without parallel physical reads', async () => {
    await start();
    calls = [];
    callResult = `0x${'1'.padStart(64, '0')}`;
    const contract = new Contract('0x1111111111111111111111111111111111111111',
      ['function probe(uint256) view returns (uint256)'], provider);
    for (const offset of [0, 4]) {
      const pending = Promise.all(Array.from({ length: 4 }, (_, index) => contract.probe(offset + index)));
      await vi.runAllTimersAsync();
      expect(await pending).toEqual([1n, 1n, 1n, 1n]);
    }
    const methods = calls.flatMap(call => call.methods);
    expect(methods.filter(method => method === 'eth_call')).toHaveLength(8);
    expect(methods.filter(method => method === 'eth_chainId')).toHaveLength(2);
    expect(calls.every(call => !call.batch)).toBe(true);
    expect(maximumInFlight).toBe(1);
    for (let index = 1; index < calls.length; index++) {
      expect(calls[index].at - calls[index - 1].at).toBeGreaterThanOrEqual(20);
    }
  });

  it('rejects every getter in a window when the RPC changes chain', async () => {
    await start();
    reportedChainId++;
    callResult = `0x${'1'.padStart(64, '0')}`;
    const contract = new Contract('0x1111111111111111111111111111111111111111',
      ['function probe(uint256) view returns (uint256)'], provider);
    const pending = Promise.allSettled(Array.from({ length: 4 }, (_, index) => contract.probe(index)));
    await vi.runAllTimersAsync();
    const results = await pending;
    expect(results.every(result => result.status === 'rejected' &&
      result.reason.code === 'NETWORK_ERROR')).toBe(true);
  });

  it.each([
    ['coti-testnet-candidate', false, true],
    ['production', false, false],
    ['development', true, true]
  ] as const)('keeps numeric queue observation scoped to %s, development=%s', async (mode, development, observed) => {
    vi.stubEnv('MODE', mode);
    vi.stubEnv('DEV', development);
    const setAttribute = vi.fn();
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    await start();
    expect(maximumInFlight).toBe(1);
    if (!observed) {
      expect(setAttribute).not.toHaveBeenCalled();
      return;
    }
    expect(setAttribute).toHaveBeenCalled();
    const [attribute, encoded] = setAttribute.mock.calls[setAttribute.mock.calls.length - 1];
    expect(attribute).toBe('data-coti-rpc-queue');
    const snapshot = JSON.parse(encoded);
    expect(Object.keys(snapshot).sort()).toEqual([
      'sampledAt', 'queuedEssential', 'queuedBackground', 'inFlight',
      'started', 'completed', 'transportMs', 'pacingMs', 'stopped'
    ].sort());
    expect(Object.values(snapshot).every(value => typeof value === 'number' || typeof value === 'boolean')).toBe(true);
  });

  it('shares the aggregate queue with Private Liquidity and DEX price read adapters', async () => {
    await start();
    const fetcher = vi.fn(async () => { throw new Error('Independent fetch must not run.'); });
    vi.stubGlobal('fetch', fetcher);
    const { createPrivateLiquidityHttpProvider } = await import('../privateLiquidityRpc');
    const first = createPrivateLiquidityHttpProvider({ rpcUrl: CONFIGURED_COTI_NETWORK.rpcUrl });
    const second = createPrivateLiquidityHttpProvider({ rpcUrl: CONFIGURED_COTI_NETWORK.rpcUrl });
    const results = Promise.allSettled([
      provider!.send('eth_getCode', ['shared', 'latest']),
      first.request({ method: 'eth_getCode', params: ['liquidity', 'latest'] }),
      second.request({ method: 'eth_call', params: [{ to: 'price-store', data: '0x12345678' }, 'latest'] })
    ]);
    await vi.runAllTimersAsync();
    expect((await results).every(result => result.status === 'fulfilled')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(maximumInFlight).toBe(1);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(20);
  });

  it.each([403, 429])('stops Private Liquidity, DEX prices and other shared readers after HTTP %s', async blockedStatus => {
    await start();
    const fetcher = vi.fn(async () => { throw new Error('Independent fetch must not run.'); });
    vi.stubGlobal('fetch', fetcher);
    const { createPrivateLiquidityHttpProvider } = await import('../privateLiquidityRpc');
    const adapter = createPrivateLiquidityHttpProvider({ rpcUrl: CONFIGURED_COTI_NETWORK.rpcUrl });
    status = blockedStatus;
    const failed = adapter.request({ method: 'eth_blockNumber', params: [] }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(String(await failed)).toContain(`HTTP ${blockedStatus}`);
    const before = calls.length;
    status = 200;
    const replacement = createPrivateLiquidityHttpProvider({ rpcUrl: CONFIGURED_COTI_NETWORK.rpcUrl });
    const stopped = Promise.allSettled([
      provider!.send('eth_blockNumber', []), replacement.request({ method: 'eth_blockNumber', params: [] })
    ]);
    await vi.runAllTimersAsync();
    expect((await stopped).every(result => result.status === 'rejected')).toBe(true);
    expect(calls.length).toBe(before);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('admits explicitly foreground code and feature reads ahead of ordinary balances and metadata', async () => {
    const started: number[] = [];
    const paced = createPacedCotiRpc(async request => {
      const item = JSON.parse(new TextDecoder().decode(request.body!));
      started.push(item.id);
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new TextEncoder().encode(JSON.stringify({ id: item.id })) };
    });
    const make = (id: number, method: string) => {
      const request = new FetchRequest('https://example.invalid');
      request.timeout = 100_000;
      request.body = { id, method, params: method === 'eth_call' ? [{ data: '0x70955607' }] : [] };
      return request;
    };
    const background = Array.from({ length: 20 }, (_, i) => paced(make(i, i % 2 === 0 ? 'eth_getCode' : 'eth_getBalance')));
    const code = paced.foreground(make(100, 'eth_getCode'));
    const feature = paced.foreground(make(101, 'eth_call'));
    await vi.runAllTimersAsync();
    const replies = await Promise.all([...background, code, feature]);
    expect(started.slice(0, 3)).toEqual([0, 100, 101]);
    expect(replies.map(reply => JSON.parse(new TextDecoder().decode(reply.body!)).id)).toEqual([
      ...Array.from({ length: 20 }, (_, i) => i), 100, 101
    ]);
  });

  it('shares one aggregate transport and sticky failure stop across normal and foreground SDK providers', async () => {
    await start();
    const core = await import('./core');
    const starting = core.loadCotiStartupReadProvider();
    await vi.runAllTimersAsync();
    const foreground = await starting;
    try {
      const reads = Promise.all([
        provider!.send('eth_getCode', ['normal', 'latest']),
        foreground.send('eth_getCode', ['startup', 'latest'])
      ]);
      await vi.runAllTimersAsync(); await reads;
      expect(maximumInFlight).toBe(1);
      for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(20);
      status = 403;
      const failed = foreground.send('eth_getCode', ['startup', 'latest']).catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(String(await failed)).toContain('HTTP 403');
      const before = calls.length;
      status = 200;
      const stopped = provider!.send('eth_getCode', ['normal-after-stop', 'latest']).catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(String(await stopped)).toContain('HTTP 403');
      expect(calls.length).toBe(before);
    } finally { foreground.destroy(); }
  });

  it('gives both ordinary essential reads and backfill bounded turns during foreground admission', async () => {
    const started: number[] = [];
    const paced = createPacedCotiRpc(async request => {
      const item = JSON.parse(new TextDecoder().decode(request.body!)); started.push(item.id);
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new Uint8Array() };
    });
    const make = (id: number, method: string) => {
      const request = new FetchRequest('https://example.invalid'); request.timeout = 100_000;
      request.body = { id, method, params: [] }; return request;
    };
    const reads = [paced(make(0, 'eth_getLogs')), paced(make(1, 'eth_getBalance')), paced(make(2, 'eth_getLogs')),
      ...Array.from({ length: 12 }, (_, i) => paced.foreground(make(i + 100, 'eth_getCode')))];
    await vi.runAllTimersAsync(); await Promise.all(reads);
    expect(started.slice(0, 4)).toEqual([0, 100, 101, 102]);
    expect(started.indexOf(2)).toBeLessThanOrEqual(4);
    expect(started.indexOf(1)).toBeLessThanOrEqual(5);
  });

  it('reports physical transport and pacing separately without retaining RPC data', async () => {
    const samples: Array<Record<string, unknown>> = [];
    const paced = createPacedCotiRpc(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new Uint8Array() };
    }, snapshot => samples.push({ ...snapshot }));
    const request = new FetchRequest('https://example.invalid/private-path');
    request.body = JSON.stringify({ method: 'eth_call', params: [{ to: 'private-address', data: 'private-input' }] });
    const reads = Promise.all([paced(request), paced(request)]);
    await vi.runAllTimersAsync();
    await reads;
    expect(samples[samples.length - 1]).toMatchObject({ queuedEssential: 0, queuedBackground: 0,
      inFlight: false, started: 2, completed: 2, transportMs: 400, pacingMs: 0, stopped: false });
    expect(samples.some(sample => sample.inFlight === true && sample.started === 1)).toBe(true);
    expect(JSON.stringify(samples)).not.toMatch(/private-path|private-address|private-input|eth_call/);
    expect(Object.keys(samples[samples.length - 1]).sort()).toEqual([
      'completed', 'inFlight', 'pacingMs', 'queuedBackground', 'queuedEssential',
      'sampledAt', 'started', 'stopped', 'transportMs'
    ].sort());
  });

  it('reports a stopped transport once and an observer cannot interfere with RPC execution', async () => {
    const snapshots: Array<{ stopped: boolean; started: number }> = [];
    const transport = vi.fn(async () => ({ statusCode: 403, statusMessage: 'Forbidden', headers: {}, body: new Uint8Array() }));
    const paced = createPacedCotiRpc(transport, snapshot => { snapshots.push(snapshot); throw new Error('observer'); });
    const rejected = paced(new FetchRequest('https://example.invalid')).catch(error => error);
    await vi.runAllTimersAsync();
    expect(await rejected).toBeInstanceOf(Error);
    expect((await rejected).message).toMatch(/HTTP 403/);
    const next = paced(new FetchRequest('https://example.invalid')).catch(error => error);
    await vi.runAllTimersAsync();
    expect((await next).message).toMatch(/HTTP 403/);
    expect(transport).toHaveBeenCalledOnce();
    expect(snapshots[snapshots.length - 1]).toMatchObject({ stopped: true, started: 1 });
  });

  it.each([403, 429])('retains bounded safe context for HTTP %s without payloads or retry', async statusCode => {
    const snapshots: unknown[] = [];
    const transport = vi.fn(async () => ({ statusCode, statusMessage: 'private-response-text',
      headers: { 'X-Request-ID': 'request-123', 'Retry-After': '10', 'cf-ray': 'ray-42-FRA',
        authorization: 'private-auth', 'x-correlation-id': 'bad\nprivate-header' },
      body: new TextEncoder().encode('private-response-body') }));
    const paced = createPacedCotiRpc(transport, snapshot => snapshots.push(snapshot));
    const request = new FetchRequest('https://provider.invalid/private-path?key=private-key');
    request.body = { method: 'eth_call', params: [{ to: 'private-address', data: 'private-input' }], id: 99 };
    const failure = await paced.foreground(request).catch(error => error);
    expect(failure.rpcFailure).toMatchObject({ kind: 'http', method: 'eth_call', category: 'foreground',
      provider: 'provider.invalid', status: statusCode, queuedMs: 0, physicalMs: 0,
      headers: { 'x-request-id': 'request-123', 'retry-after': '10', 'cf-ray': 'ray-42-FRA' } });
    expect(JSON.stringify(snapshots)).not.toMatch(/private-|bad|params|authorization/);
    await expect(paced(request)).rejects.toBe(failure);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('does not report a timed-out underlying transport as completed before it settles', async () => {
    const snapshots: Array<{ inFlight: boolean; completed: number; stopped: boolean; transportMs: number }> = [];
    let settle!: (response: Awaited<ReturnType<FetchGetUrlFunc>>) => void;
    const held = new Promise<Awaited<ReturnType<FetchGetUrlFunc>>>(resolve => { settle = resolve; });
    const paced = createPacedCotiRpc(() => held, snapshot => snapshots.push(snapshot));
    const request = new FetchRequest('https://example.invalid');
    request.timeout = 1000;
    const result = paced(request).catch(error => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).code).toBe('TIMEOUT');
    expect(snapshots[snapshots.length - 1]).toMatchObject({ inFlight: true, completed: 0, stopped: true, transportMs: 1000 });
    settle({ statusCode: 200, statusMessage: 'OK', headers: {}, body: new Uint8Array() });
    await vi.runAllTimersAsync();
    expect(snapshots[snapshots.length - 1]).toMatchObject({ inFlight: false, completed: 1, stopped: true, transportMs: 1000 });
  });

  it('settles an explicit chain identity read as the first operation after provider creation', async () => {
    const { loadCotiHttpProvider } = await import('./core');
    const starting = loadCotiHttpProvider();
    await vi.runAllTimersAsync();
    provider = await starting;
    let state: unknown = 'pending';
    void provider.send('eth_chainId', []).then(
      result => { state = result; },
      error => { state = error; }
    );
    await vi.runAllTimersAsync();
    expect(state).toBe(`0x${CONFIGURED_COTI_NETWORK.chainIdDecimal.toString(16)}`);
    expect(maximumInFlight).toBe(1);
  });

  it('admits startup identity ahead of 64 queued background reads without parallel physical requests', async () => {
    await start();
    const before = calls.length;
    const burst = Promise.allSettled(Array.from({ length: 64 }, (_, index) =>
      provider!.send('eth_getCode', [`0x${(index + 16).toString(16).padStart(40, '0')}`, 'latest'])));
    const identity = provider!.send('eth_chainId', []).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    await burst;
    expect(await identity).toBe(`0x${CONFIGURED_COTI_NETWORK.chainIdDecimal.toString(16)}`);
    const started = calls.slice(before);
    expect(started.findIndex(call => call.methods[0] === 'eth_chainId')).toBeLessThanOrEqual(1);
    for (let i = 1; i < started.length; i++) expect(started[i].at - started[i - 1].at).toBeGreaterThanOrEqual(20);
    expect(maximumInFlight).toBe(1);
  });

  it('gives queued backfill a turn after at most three essential reads and keeps RPC IDs distinct', async () => {
    const started: number[] = [];
    const transport = vi.fn(async (request: FetchRequest) => {
      const body = JSON.parse(new TextDecoder().decode(request.body!));
      started.push(body.id);
      return { statusCode: 200, statusMessage: 'OK', headers: {},
        body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x1' })) };
    });
    const paced = createPacedCotiRpc(transport);
    const send = (id: number, method: string) => {
      const request = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl);
      request.timeout = 100_000;
      request.body = { jsonrpc: '2.0', id, method, params: [] };
      return paced(request);
    };
    const work = [send(0, 'eth_getLogs'), send(1, 'eth_getLogs'),
      ...Array.from({ length: 8 }, (_, i) => send(i + 2, 'eth_getTransactionReceipt'))];
    await vi.runAllTimersAsync();
    const replies = await Promise.all(work);
    expect(started.indexOf(1)).toBeGreaterThan(1);
    expect(started.indexOf(1)).toBeLessThanOrEqual(4);
    expect(replies.map(reply => JSON.parse(new TextDecoder().decode(reply.body ?? new Uint8Array())).id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(transport).toHaveBeenCalledTimes(10);
  });

  it('admits chain identity ahead of the actual immutable deployment metadata selectors', async () => {
    const { id } = await import('@coti-io/coti-ethers');
    const started: number[] = [];
    const transport = vi.fn(async (request: FetchRequest) => {
      const body = JSON.parse(new TextDecoder().decode(request.body!)); started.push(body.id);
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new Uint8Array() };
    });
    const paced = createPacedCotiRpc(transport);
    const calls = Array.from({ length: 64 }, (_, index) => {
      const request = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl); request.timeout = 100_000;
      request.body = { jsonrpc: '2.0', id: index, method: 'eth_call', params: [{
        to: '0x1111111111111111111111111111111111111111',
        data: index % 2 === 0 ? id('contractVersion()').slice(0, 10) : `${id('supportsFeature(bytes32)').slice(0, 10)}${'00'.repeat(32)}`
      }, 'latest'] };
      return paced(request);
    });
    const identity = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl); identity.timeout = 30_000;
    identity.body = { jsonrpc: '2.0', id: 100, method: 'eth_chainId', params: [] };
    calls.push(paced(identity));
    const settled = Promise.allSettled(calls);
    await vi.runAllTimersAsync();
    expect((await settled).every(result => result.status === 'fulfilled')).toBe(true);
    expect(started.indexOf(100)).toBeLessThanOrEqual(1);
  });

  it('counts only the preceding transport time after a request entered the queue', async () => {
    const transport = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 2_000));
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new Uint8Array() };
    });
    const paced = createPacedCotiRpc(transport);
    const first = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl);
    first.timeout = 10_000;
    const running = paced(first);
    await vi.advanceTimersByTimeAsync(100);
    const short = first.clone(); short.timeout = 1_000;
    const waiting = paced(short).catch((error: Error & { queueTiming?: unknown }) => error);
    await vi.runAllTimersAsync();
    await running;
    const failure = await waiting;
    if (!(failure instanceof Error)) throw new Error('Expected the queued read to fail.');
    expect(failure.queueTiming).toMatchObject({
      ahead: 1, completed: 0, waitedMs: 1_000, transportMs: 1_000, pacingMs: 0, nextStartMs: 0
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it('bounds a stalled transport, stops queued/future reads and ignores its late result', async () => {
    let finish!: (response: Awaited<ReturnType<FetchGetUrlFunc>>) => void;
    const pending = new Promise<Awaited<ReturnType<FetchGetUrlFunc>>>(resolve => { finish = resolve; });
    const transport = vi.fn(() => pending);
    const paced = createPacedCotiRpc(transport);
    const request = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl);
    request.timeout = 1_000;
    let firstState = 'pending', queuedState = 'pending';
    void paced(request).then(() => { firstState = 'success'; }, (error: { code?: string }) => { firstState = error.code ?? 'error'; });
    void paced(request.clone()).then(() => { queuedState = 'success'; }, (error: Error) => { queuedState = error.message; });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(firstState).toBe('TIMEOUT');
    expect(queuedState).toContain('reads stopped');
    expect(transport).toHaveBeenCalledOnce();
    finish({ statusCode: 200, statusMessage: 'OK', headers: {}, body: new TextEncoder().encode('late result') });
    await vi.runAllTimersAsync();
    expect(firstState).toBe('TIMEOUT');
    const later = paced(request.clone()).catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await later).toContain('reads stopped');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('keeps the failure stop when the SDK transport reports TIMEOUT before the queue deadline', async () => {
    const snapshots: unknown[] = [];
    const transport = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      throw Object.assign(new Error('request timeout'), { code: 'TIMEOUT' });
    });
    const paced = createPacedCotiRpc(transport, snapshot => snapshots.push(snapshot));
    const request = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl);
    request.timeout = 30_000;
    const failed = Promise.allSettled([paced(request), paced(request.clone())]);
    await vi.runAllTimersAsync();
    expect((await failed).every(result => result.status === 'rejected')).toBe(true);
    expect(snapshots[snapshots.length - 1]).toMatchObject({ requestTimeout: {
      queuedMs: 0, budgetMs: 30_000, remainingMs: 30_000, physicalMs: 1_000, source: 'sdk'
    } });
    expect(transport).toHaveBeenCalledOnce();
    const later = paced(request.clone()).catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await later).toContain('reads stopped');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('gives a healthy admitted read its physical timeout after a long queue wait', async () => {
    const budgets: number[] = [];
    const snapshots: Array<{ started: number; completed: number; transportMs: number; stopped: boolean }> = [];
    const paced = createPacedCotiRpc(async request => {
      budgets.push(request.timeout);
      await new Promise(resolve => setTimeout(resolve, 20));
      return { statusCode: 200, statusMessage: 'OK', headers: {}, body: new TextEncoder().encode('{"result":"0x1"}') };
    }, snapshot => snapshots.push(snapshot), true, 500);
    const request = new FetchRequest('https://example.invalid'); request.timeout = 100_000;
    const preceding = Promise.all(Array.from({ length: 60 }, () => paced(request.clone())));
    await vi.advanceTimersByTimeAsync(1);
    const short = request.clone(); short.timeout = 30_000;
    const result = paced(short).catch(error => error);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(budgets).toHaveLength(61);
    expect(budgets[60]).toBe(30_000);
    await vi.runAllTimersAsync(); await preceding;
    expect(await result).toMatchObject({ statusCode: 200 });
    expect(snapshots[snapshots.length - 1]).toMatchObject({ started: 61, completed: 61, transportMs: 1_220, stopped: false });
    const next = paced(request);
    await vi.runAllTimersAsync();
    expect(await next).toMatchObject({ statusCode: 200 });
  });

  it('dispatches normal callers without an imposed gap while retaining one request in flight', async () => {
    await start();
    calls = [];
    const began = performance.now();
    const results = Promise.all(['eth_blockNumber', 'eth_gasPrice', 'eth_blockNumber'].map((method) => provider!.send(method, [])));
    await vi.runAllTimersAsync();
    expect(await results).toEqual(['0x123', '0x123', '0x123']);
    expect(maximumInFlight).toBe(1);
    expect(calls.every((call) => !call.batch)).toBe(true);
    expect(performance.now() - began).toBeLessThan(100);
    expect(calls.map(call => call.at - began)).toEqual([0, 20, 40]);
  });

  it.each([false, true])('measures installed-SDK reads with per-read network acquisition %s', async acquireNetwork => {
    await start();
    const before = calls.length;
    for (let index = 0; index < 4; index++) {
      if (acquireNetwork) {
        const network = provider!.getNetwork();
        await vi.runAllTimersAsync();
        await network;
      }
      const read = provider!.send('eth_blockNumber', []);
      await vi.runAllTimersAsync();
      await read;
    }
    const methods = calls.slice(before).flatMap(call => call.methods);
    console.info('Local SDK request trace', { acquireNetwork, methods });
    expect(methods.filter(method => method === 'eth_blockNumber')).toHaveLength(4);
    expect(methods.filter(method => method === 'eth_chainId')).toHaveLength(acquireNetwork ? 4 : 0);
  });

  it.each([403, 429])('stops queued and future reads after HTTP %s without SDK retries', async (code) => {
    await start();
    status = code;
    const before = calls.length;
    const failed = Promise.allSettled(['eth_blockNumber', 'eth_gasPrice'].map((method) => provider!.send(method, [])));
    await vi.runAllTimersAsync();
    expect((await failed).every((v) => v.status === 'rejected')).toBe(true);
    expect(calls.length - before).toBe(1);
    const later = provider!.send('eth_blockNumber', []).catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await later).toContain(`HTTP ${code}`);
    expect(calls.length - before).toBe(1);
  });

  it('keeps the 403 stop when failed startup clears the provider cache', async () => {
    status = 403;
    const { loadCotiHttpProvider } = await import('./core');
    const failed = loadCotiHttpProvider().catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await failed).toContain('403');
    status = 200;
    const again = loadCotiHttpProvider().catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await again).toContain('HTTP 403');
    expect(calls).toHaveLength(1);
  });

  it('does not send queued reads that expired or were cancelled', async () => {
    const request = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl);
    request.getUrlFunc = createPacedCotiRpc(request.getUrlFunc);
    request.body = { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] };
    let release!: () => void;
    transportHold = new Promise<void>(resolve => { release = resolve; });
    const first = request.clone().send();
    const expired = request.clone();
    expired.timeout = 100;
    const cancelled = request.clone();
    const waiting = Promise.allSettled([expired.send(), cancelled.send()]);
    cancelled.cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect((await waiting).every((v) => v.status === 'rejected')).toBe(true);
    expect(calls).toHaveLength(1);
    release();
    await vi.runAllTimersAsync(); await first;
    const next = request.clone().send();
    await vi.runAllTimersAsync();
    expect((await next).statusCode).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('refuses an HTTP redirect without another request', async () => {
    const request = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl);
    request.getUrlFunc = createPacedCotiRpc(request.getUrlFunc);
    request.body = { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] };
    status = 302;
    const result = request.send().catch((error: Error) => error.message);
    await vi.runAllTimersAsync();
    expect(await result).toContain('redirect refused');
    expect(calls).toHaveLength(1);
  });
});
