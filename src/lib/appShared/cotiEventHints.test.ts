import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketProvider } from '@coti-io/coti-ethers';
import { createCotiEventHintSubscriber } from './cotiEventHints';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const makeSocket = () => {
  const events = new Map<string, Set<() => void>>();
  const handlers: Array<{ event: unknown; listener: (log?: unknown) => void }> = [];
  let rpcId = 0;
  const socket = {
    ackMode: 'success' as 'success' | 'reject' | 'silent', heartbeatOn: true,
    handlers,
    websocket: {
      addEventListener: (event: string, listener: () => void) => { if (!events.has(event)) events.set(event, new Set()); events.get(event)!.add(listener); },
      removeEventListener: (event: string, listener: () => void) => events.get(event)?.delete(listener)
    },
    close: () => events.get('close')?.forEach(listener => listener()),
    getNetwork: vi.fn(async () => ({ chainId: 7082400n })),
    emitDebug: (event: unknown) => handlers.filter(item => item.event === 'debug').forEach(item => item.listener(event)),
    on: vi.fn(async (event: unknown, listener: (log?: unknown) => void) => {
      handlers.push({ event, listener });
      if (event === 'block' && socket.heartbeatOn) void Promise.resolve().then(() => listener(1));
      if (event && typeof event === 'object') {
        const id = ++rpcId;
        socket.emitDebug({ action: 'sendRpcPayload', payload: { id, method: 'eth_subscribe', params: ['logs', event] } });
        await Promise.resolve();
        if (socket.ackMode !== 'silent') socket.emitDebug({ action: 'receiveRpcResult', result: [{ id,
          ...(socket.ackMode === 'success' ? { result: `subscription-${id}` } : { error: { code: -32601, message: 'denied' } }) }] });
      }
    }),
    off: vi.fn(async () => {})
  };
  return socket;
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('shared COTI socket event hints', () => {
  it('matches the installed SDK debug shapes and distinguishes listener installation from subscription ACK', async () => {
    const debug: Array<{ action: string; payload?: unknown; result?: unknown }> = [];
    let subscription: { id: number; method: string; params: unknown[] } | undefined;
    const wire = {
      readyState: 1,
      onopen: null as (() => Promise<void>) | null,
      onmessage: null as ((event: { data: string }) => void) | null,
      close: () => {},
      send: (data: string) => {
        const rpc = JSON.parse(data);
        if (rpc.method === 'eth_subscribe') { subscription = rpc; return; }
        void Promise.resolve().then(() => wire.onmessage?.({ data: JSON.stringify({
          jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'eth_chainId' ? '0x6c11a0' : true
        }) }));
      }
    };
    const provider = new WebSocketProvider(wire as never, { name: 'local-fixture', chainId: 7082400 });
    void wire.onopen?.();
    await provider.on('debug', event => debug.push(event));
    const filter = { address: [ADDRESS] }, listener = vi.fn();
    await provider.on(filter, listener);
    await vi.advanceTimersByTimeAsync(20);
    expect(subscription?.method).toBe('eth_subscribe');
    expect(subscription?.params).toEqual(['logs', { address: [ADDRESS], topics: [] }]);
    expect(debug.some(event => event.action === 'sendRpcPayload' &&
      (event.payload as { id?: number })?.id === subscription?.id)).toBe(true);
    expect(debug.some(event => event.action === 'receiveRpcResult' &&
      (Array.isArray(event.result) ? event.result : [event.result]).some(item => item?.id === subscription?.id))).toBe(false);
    wire.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: subscription!.id, result: 'local-subscription' }) });
    await vi.advanceTimersByTimeAsync(20);
    expect(debug.some(event => event.action === 'receiveRpcResult' && Array.isArray(event.result) &&
      event.result.some(item => item.id === subscription!.id && item.result === 'local-subscription'))).toBe(true);
    await provider.off(filter, listener); await vi.advanceTimersByTimeAsync(20); await provider.destroy();
  });

  it('shares one socket, registers exact addresses, ignores late hints and removes only owned listeners', async () => {
    const socket = makeSocket(), loadProvider = vi.fn(async () => socket), resetProvider = vi.fn(async () => {});
    const subscribe = createCotiEventHintSubscriber({ loadProvider, resetProvider, chainId: 7082400n });
    const first = vi.fn(), second = vi.fn(), status = vi.fn();
    const stopFirst = await subscribe({ address: ADDRESS, onHint: first, onStatus: status });
    const stopSecond = await subscribe({ address: OTHER, onHint: second });
    await flush();
    expect(loadProvider).toHaveBeenCalledOnce();
    expect(socket.handlers.filter(item => typeof item.event === 'object').map(item => item.event)).toEqual([
      { address: [ADDRESS], topics: undefined }, { address: [OTHER], topics: undefined }
    ]);
    expect(status.mock.calls.map(([value]) => value)).toEqual(['reconnecting', 'connected']);
    const firstLog = socket.handlers.find(item => typeof item.event === 'object')!;
    firstLog.listener({ untrusted: true });
    expect(first).toHaveBeenCalledOnce();
    stopFirst(); firstLog.listener({ late: true });
    expect(first).toHaveBeenCalledOnce();
    expect(resetProvider).not.toHaveBeenCalled();
    stopSecond();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('registers a subscriber added while another log registration is pending', async () => {
    const socket = makeSocket();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const originalOn = socket.on.getMockImplementation()!;
    socket.on.mockImplementation(async (event: unknown, listener: (log?: unknown) => void) => {
      await originalOn(event, listener);
      if (typeof event === 'object' && socket.handlers.filter(item => typeof item.event === 'object').length === 1) await gate;
    });
    const subscribe = createCotiEventHintSubscriber({ loadProvider: async () => socket, resetProvider: async () => {}, chainId: 7082400n });
    const first = await subscribe({ address: ADDRESS, onHint: vi.fn() }); await flush();
    const second = await subscribe({ address: OTHER, onHint: vi.fn() });
    release(); await flush();
    expect(socket.handlers.filter(item => typeof item.event === 'object')).toHaveLength(2);
    first(); second();
  });

  it.each(['reject', 'silent'] as const)('keeps fallback active for a %s subscription ACK', async mode => {
    const socket = makeSocket(); socket.ackMode = mode;
    const resetProvider = vi.fn(async () => {}), status = vi.fn();
    const subscribe = createCotiEventHintSubscriber({ loadProvider: async () => socket, resetProvider,
      chainId: 7082400n, setupMs: 1_000 });
    const stop = await subscribe({ address: ADDRESS, onHint: vi.fn(), onStatus: status }); await flush();
    expect(status.mock.calls.some(([value]) => value === 'connected')).toBe(false);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(resetProvider).toHaveBeenCalledOnce();
    stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('requires a successful matching ACK and actual heartbeat before reporting connected', async () => {
    const socket = makeSocket(); socket.heartbeatOn = false;
    const status = vi.fn();
    const subscribe = createCotiEventHintSubscriber({ loadProvider: async () => socket, resetProvider: async () => {}, chainId: 7082400n });
    const stop = await subscribe({ address: ADDRESS, onHint: vi.fn(), onStatus: status }); await flush();
    expect(status.mock.calls.map(([value]) => value)).toEqual(['reconnecting']);
    socket.handlers.find(item => item.event === 'block')!.listener(2);
    expect(status.mock.calls.map(([value]) => value)).toEqual(['reconnecting', 'connected']);
    socket.handlers.find(item => item.event === 'block')!.listener(3);
    expect(status).toHaveBeenCalledTimes(2); stop();
  });

  it('ignores an ACK after disposal and socket generation replacement', async () => {
    const old = makeSocket(); old.ackMode = 'silent';
    const next = makeSocket(), status = vi.fn();
    const loadProvider = vi.fn().mockResolvedValueOnce(old).mockResolvedValue(next);
    const subscribe = createCotiEventHintSubscriber({ loadProvider, resetProvider: async () => {}, chainId: 7082400n });
    const stop = await subscribe({ address: ADDRESS, onHint: vi.fn(), onStatus: status }); await flush();
    expect(status.mock.calls.map(([value]) => value)).toEqual(['reconnecting']);
    stop();
    old.emitDebug({ action: 'receiveRpcResult', result: [{ id: 1, result: 'late' }] });
    await flush(); expect(status).toHaveBeenCalledOnce();
    const nextStatus = vi.fn();
    const stopNext = await subscribe({ address: ADDRESS, onHint: vi.fn(), onStatus: nextStatus }); await flush();
    old.emitDebug({ action: 'receiveRpcResult', result: [{ id: 1, result: 'late-again' }] });
    await flush(); expect(status).toHaveBeenCalledOnce();
    expect(nextStatus.mock.calls.map(([value]) => value)).toEqual(['reconnecting', 'connected']); stopNext();
  });

  it('reports socket loss, reconnects once per cooldown and rejects the old socket hints', async () => {
    const old = makeSocket(), next = makeSocket();
    const loadProvider = vi.fn().mockResolvedValueOnce(old).mockResolvedValue(next);
    const resetProvider = vi.fn(async () => {}), status = vi.fn(), onHint = vi.fn();
    const subscribe = createCotiEventHintSubscriber({ loadProvider, resetProvider, chainId: 7082400n, retryMs: 60_000 });
    const stop = await subscribe({ address: ADDRESS, onHint, onStatus: status }); await flush();
    const oldLog = old.handlers.find(item => typeof item.event === 'object')!;
    old.close(); old.close();
    oldLog.listener({}); expect(onHint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999); expect(loadProvider).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(loadProvider).toHaveBeenCalledTimes(2);
    expect(resetProvider).toHaveBeenCalledOnce();
    expect(status.mock.calls.map(([value]) => value)).toEqual(['reconnecting', 'connected', 'reconnecting', 'connected']);
    next.handlers.find(item => typeof item.event === 'object')!.listener({});
    expect(onHint).toHaveBeenCalledOnce(); stop();
  });

  it('falls back when heartbeat is absent and bounds a pending setup without a retry burst', async () => {
    const socket = makeSocket(), resetProvider = vi.fn(async () => {});
    const loadProvider = vi.fn().mockResolvedValueOnce(socket).mockImplementation(() => new Promise(() => {}));
    const status = vi.fn();
    const subscribe = createCotiEventHintSubscriber({ loadProvider, resetProvider, chainId: 7082400n,
      healthMs: 1_000, retryMs: 60_000, setupMs: 2_000 });
    const stop = await subscribe({ address: ADDRESS, onHint: vi.fn(), onStatus: status }); await flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(status.mock.calls[status.mock.calls.length - 1]).toEqual(['reconnecting']);
    await vi.advanceTimersByTimeAsync(62_000);
    expect(loadProvider).toHaveBeenCalledTimes(2);
    expect(resetProvider).toHaveBeenCalledTimes(2);
    stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses wildcard addresses and a socket for a different chain', async () => {
    const socket = makeSocket(); socket.getNetwork.mockResolvedValue({ chainId: 1n });
    const resetProvider = vi.fn(async () => {}), status = vi.fn();
    const subscribe = createCotiEventHintSubscriber({ loadProvider: async () => socket, resetProvider, chainId: 7082400n });
    await expect(subscribe({ address: [], onHint: vi.fn() })).rejects.toThrow('exact contract addresses');
    const stop = await subscribe({ address: ADDRESS, onHint: vi.fn(), onStatus: status }); await flush();
    expect(socket.on).not.toHaveBeenCalled();
    expect(status.mock.calls.every(([value]) => value === 'reconnecting')).toBe(true);
    expect(resetProvider).toHaveBeenCalledOnce(); stop();
  });
});
