import { describe, expect, it, vi } from 'vitest';
import {
  createDexV2PublicReadProvider,
  loadDexV2Runtime
} from './useDexV2Runtime';

describe('useDexV2Runtime foundations', () => {
  it('permits only the exact read-only RPC surface and binds each response ID', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(request);
      return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x6c0f60' });
    });
    const provider = createDexV2PublicReadProvider({
      rpcUrl: 'https://rpc.example/',
      fetcher: fetcher as typeof fetch
    });
    await expect(provider.request({ method: 'eth_chainId' })).resolves.toBe('0x6c0f60');
    await expect(provider.request({ method: 'eth_sendTransaction', params: [] })).rejects.toThrow(/read-only/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requests[0]).toEqual({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
    const options = fetcher.mock.calls[0][1] as RequestInit;
    expect(options.credentials).toBe('omit');
    expect(options.cache).toBe('no-store');
    expect(options.referrerPolicy).toBe('no-referrer');
  });

  it('rejects malformed, mismatched, and RPC-error responses', async () => {
    for (const payload of [
      { jsonrpc: '2.0', id: 2, result: '0x1' },
      { jsonrpc: '2.0', id: 1, error: { code: -1 } },
      { jsonrpc: '1.0', id: 1, result: '0x1' }
    ]) {
      const provider = createDexV2PublicReadProvider({
        rpcUrl: 'https://rpc.example/',
        fetcher: vi.fn(async () => Response.json(payload)) as unknown as typeof fetch
      });
      await expect(provider.request({ method: 'eth_chainId' })).rejects.toThrow(/response is invalid/);
    }
  });

  it('does not construct a provider or touch the network for inactive and invalid configurations', async () => {
    const fetcher = vi.fn();
    const assertCurrent = vi.fn();
    await expect(loadDexV2Runtime({
      config: { status: 'inactive' },
      fetcher: fetcher as typeof fetch,
      assertCurrent
    })).resolves.toEqual({ status: 'inactive' });
    await expect(loadDexV2Runtime({
      config: { status: 'invalid', error: 'rejected' },
      fetcher: fetcher as typeof fetch,
      assertCurrent
    })).resolves.toEqual({ status: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(assertCurrent).not.toHaveBeenCalled();
  });
});
