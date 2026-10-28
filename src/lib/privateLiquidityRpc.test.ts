import { describe, expect, it, vi } from 'vitest';
import { createPrivateLiquidityHttpProvider } from './privateLiquidityRpc';

const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

describe('privateLiquidityRpc', () => {
  it('allows the bounded log query used by the canonical pool indexer', async () => {
    const calls: string[] = [];
    const provider = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        calls.push(body.method);
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });
    await expect(provider.request({
      method: 'eth_getLogs',
      params: [{ address: '0x0000000000000000000000000000000000000001' }]
    })).resolves.toEqual([]);
    expect(calls).toEqual(['eth_getLogs']);
  });
  it('sends one credential-free no-store JSON-RPC request and validates its identity', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({ jsonrpc: '2.0', id: request.id, result: '0x6c0a50' });
    });
    const provider = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher
    });
    await expect(provider.request({ method: 'eth_chainId', params: [] })).resolves.toBe('0x6c0a50');
    expect(fetcher).toHaveBeenCalledWith('https://testnet.coti.io/rpc', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error'
    }));
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_chainId',
      params: []
    });
    expect(Object.isFrozen(provider)).toBe(true);
  });

  it.each([
    [{ jsonrpc: '2.0', id: 2, result: '0x1' }, /failed validation/],
    [{ jsonrpc: '2.0', id: 1, error: { message: 'secret remote detail' } }, /was rejected/],
    [{ jsonrpc: '1.0', id: 1, result: '0x1' }, /failed validation/],
    [{ jsonrpc: '2.0', id: 1 }, /failed validation/]
  ])('rejects malformed or error JSON-RPC envelopes without surfacing remote detail', async (body, expected) => {
    const provider = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher: async () => response(body)
    });
    await expect(provider.request({ method: 'eth_chainId', params: [] })).rejects.toThrow(expected);
  });

  it('reports only a numeric RPC rejection code and never the remote message', async () => {
    const provider = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher: async () => response({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32002, message: 'secret upstream detail' }
      })
    });
    const failure = await provider.request({ method: 'eth_getCode', params: [] }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'Private-liquidity JSON-RPC response was rejected (code -32002).'
    );
    expect((failure as Error).message).not.toContain('secret upstream detail');
  });

  it('rejects invalid request/configuration and transport failures', async () => {
    expect(() => createPrivateLiquidityHttpProvider({
      rpcUrl: 'not-a-url'
    })).toThrow(/valid RPC URL/);
    expect(() => createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      timeoutMs: 999
    })).toThrow(/configuration/);
    const provider = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher: async () => { throw new Error('network secret'); },
      retryDelayMs: 0
    });
    await expect(provider.request({ method: 'eth_chainId', params: [] }))
      .rejects.toThrow('Private-liquidity JSON-RPC transport failed.');
    await expect(provider.request({ method: 'eth_sendTransaction', params: [] }))
      .rejects.toThrow(/request is malformed/);
    await expect(provider.request({ method: 'bad-method', params: [] }))
      .rejects.toThrow(/request is malformed/);
  });

  it('recovers from a transient network failure without changing the logical request identity', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetcher.mock.calls.length === 1) throw new Error('temporary disconnect');
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({ jsonrpc: '2.0', id: request.id, result: '0x6001' });
    });
    const provider = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher,
      retryDelayMs: 0
    });

    await expect(provider.request({ method: 'eth_getCode', params: ['0x1', 'latest'] }))
      .resolves.toBe('0x6001');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][1]?.body)).toBe(String(fetcher.mock.calls[1][1]?.body));
  });

  it('serializes concurrent reads so one attestation cannot storm the RPC endpoint', async () => {
    let active = 0;
    let maximumActive = 0;
    const observedIds: number[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      observedIds.push(request.id);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return response({ jsonrpc: '2.0', id: request.id, result: '0x1' });
    });
    const provider = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher,
      retryDelayMs: 0
    });

    await expect(Promise.all(Array.from({ length: 12 }, () =>
      provider.request({ method: 'eth_blockNumber', params: [] })
    ))).resolves.toEqual(Array.from({ length: 12 }, () => '0x1'));
    expect(maximumActive).toBe(1);
    expect(observedIds).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it('retries a temporary HTTP status but never retries a JSON-RPC rejection', async () => {
    const temporary = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return temporary.mock.calls.length === 1
        ? response({ unavailable: true }, 503)
        : response({ jsonrpc: '2.0', id: request.id, result: '0x6c0a50' });
    });
    const recovered = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher: temporary,
      retryDelayMs: 0
    });
    await expect(recovered.request({ method: 'eth_chainId', params: [] }))
      .resolves.toBe('0x6c0a50');
    expect(temporary).toHaveBeenCalledTimes(2);

    const rejected = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response({ jsonrpc: '2.0', id: request.id, error: { message: 'private detail' } });
    });
    const deterministic = createPrivateLiquidityHttpProvider({
      rpcUrl: 'https://testnet.coti.io/rpc',
      fetcher: rejected,
      retryDelayMs: 0
    });
    await expect(deterministic.request({ method: 'eth_call', params: [] }))
      .rejects.toThrow(/was rejected/);
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});
