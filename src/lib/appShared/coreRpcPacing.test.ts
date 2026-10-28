import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchRequest, type FetchGetUrlFunc, type JsonRpcProvider } from '@coti-io/coti-ethers';
import { CONFIGURED_COTI_NETWORK } from '../chainWhisperNetworks';
import { createPacedCotiRpc } from './cotiRpcPacing';

const originalGetUrl = new FetchRequest(CONFIGURED_COTI_NETWORK.rpcUrl).getUrlFunc;
let provider: JsonRpcProvider | undefined;
let status = 200;
let inFlight = 0;
let maximumInFlight = 0;
let calls: Array<{ at: number; batch: boolean; methods: string[] }> = [];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  status = 200;
  inFlight = 0;
  maximumInFlight = 0;
  calls = [];
  // Only HTTP is replaced. Exercise the installed COTI provider and FetchRequest.
  FetchRequest.registerGetUrl(async (request) => {
    const body = JSON.parse(new TextDecoder().decode(request.body!));
    const items = Array.isArray(body) ? body : [body];
    calls.push({ at: performance.now(), batch: Array.isArray(body), methods: items.map((v) => v.method) });
    maximumInFlight = Math.max(maximumInFlight, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inFlight--;
    const replies = items.map((v) => ({ jsonrpc: '2.0', id: v.id,
      result: v.method === 'eth_chainId' ? `0x${CONFIGURED_COTI_NETWORK.chainIdDecimal.toString(16)}` : '0x123' }));
    return { statusCode: status, statusMessage: status === 200 ? 'OK' : 'Forbidden', headers: {},
      body: new TextEncoder().encode(JSON.stringify(Array.isArray(body) ? replies : replies[0])) };
  });
});

afterEach(() => {
  provider?.destroy();
  provider = undefined;
  FetchRequest.registerGetUrl(originalGetUrl);
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

  it('expires a startup identity read behind an oversized burst even when every response is fast', async () => {
    await start();
    // Leave headroom for each sent response; only the excess queued work expires.
    await vi.advanceTimersByTimeAsync(100);
    const before = calls.length;
    const burst = Promise.allSettled(Array.from({ length: 64 }, (_, index) =>
      provider!.send('eth_getCode', [`0x${(index + 16).toString(16).padStart(40, '0')}`, 'latest'])));
    const identity = provider!.send('eth_chainId', []).catch((error: Error & {
      queueTiming?: { ahead: number; completed: number; waitedMs: number; transportMs: number; pacingMs: number }
    }) => error);
    await vi.runAllTimersAsync();
    await burst;
    const error = await identity;
    expect(error.message).toContain('expired in queue');
    expect(error.queueTiming).toBeDefined();
    expect(Object.keys(error.queueTiming).sort()).toEqual([
      'ahead', 'budgetMs', 'completed', 'nextStartMs', 'pacingMs', 'transportMs', 'waitedMs'
    ]);
    expect(error.queueTiming.ahead).toBeGreaterThanOrEqual(64);
    expect(error.queueTiming.completed).toBeGreaterThan(50);
    expect(error.queueTiming.transportMs).toBeLessThan(2_000);
    expect(error.queueTiming.pacingMs).toBeGreaterThan(25_000);
    expect(calls.slice(before).every(call => call.methods[0] === 'eth_getCode')).toBe(true);
    expect(maximumInFlight).toBe(1);
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
      ahead: 1, completed: 1, waitedMs: 1_900, transportMs: 1_900, pacingMs: 0, nextStartMs: 0
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

  it('paces concurrent callers as individual RPCs with only one request in flight', async () => {
    await start();
    const results = Promise.all(['eth_blockNumber', 'eth_gasPrice', 'eth_blockNumber'].map((method) => provider!.send(method, [])));
    await vi.runAllTimersAsync();
    expect(await results).toEqual(['0x123', '0x123', '0x123']);
    expect(maximumInFlight).toBe(1);
    expect(calls.every((call) => !call.batch)).toBe(true);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(500);
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
    const first = request.clone().send();
    await vi.runAllTimersAsync();
    await first;
    const expired = request.clone();
    expired.timeout = 100;
    const cancelled = request.clone();
    const waiting = Promise.allSettled([expired.send(), cancelled.send()]);
    cancelled.cancel();
    await vi.runAllTimersAsync();
    expect((await waiting).every((v) => v.status === 'rejected')).toBe(true);
    expect(calls).toHaveLength(1);
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
