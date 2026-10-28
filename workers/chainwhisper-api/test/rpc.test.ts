import { describe, expect, it } from 'vitest';
import { parseAbi } from 'viem';
import {
  HttpContractReader,
  RpcContractRevertedError,
  RpcUnavailableError
} from '../src/rpc';

const abi = parseAbi(['function value() view returns (uint256)']);
const address = '0x1111111111111111111111111111111111111111';

describe('Worker JSON-RPC classification', () => {
  it('distinguishes contract reverts from upstream failures', async () => {
    const reverted = new HttpContractReader(
      'https://rpc.example',
      (async () => Response.json({
        jsonrpc: '2.0',
        id: 1,
        error: { code: 3, message: 'execution reverted', data: '0xd69b5379' }
      })) as typeof fetch
    );
    await expect(reverted.readContract({
      address,
      abi,
      functionName: 'value'
    })).rejects.toBeInstanceOf(RpcContractRevertedError);

    const unavailable = new HttpContractReader(
      'https://rpc.example',
      (async () => new Response('upstream unavailable', { status: 503 })) as typeof fetch
    );
    await expect(unavailable.readContract({
      address,
      abi,
      functionName: 'value'
    })).rejects.toBeInstanceOf(RpcUnavailableError);
  });

  it('serializes concurrent reads and retries only transient transport statuses', async () => {
    const calls: Array<{ id: number; method: string }> = [];
    let active = 0;
    let maximumActive = 0;
    let firstAttempt = true;
    const reader = new HttpContractReader(
      'https://rpc.example',
      (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string };
        calls.push({ id: body.id, method: body.method });
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        if (firstAttempt) {
          firstAttempt = false;
          return new Response('busy', { status: 503 });
        }
        return Response.json({ jsonrpc: '2.0', id: body.id, result: '0x1' });
      }) as typeof fetch,
      5_000,
      { maxAttempts: 2, retryDelayMs: 0 }
    );

    await expect(Promise.all([
      reader.request('eth_chainId', []),
      reader.request('eth_blockNumber', [])
    ])).resolves.toEqual(['0x1', '0x1']);
    expect(maximumActive).toBe(1);
    expect(calls).toEqual([
      { id: 1, method: 'eth_chainId' },
      { id: 1, method: 'eth_chainId' },
      { id: 2, method: 'eth_blockNumber' }
    ]);
  });

  it('does not retry deterministic JSON-RPC errors or contract reverts', async () => {
    let unavailableCalls = 0;
    const unavailable = new HttpContractReader(
      'https://rpc.example',
      (async () => {
        unavailableCalls += 1;
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32602, message: 'invalid params' }
        });
      }) as typeof fetch,
      5_000,
      { maxAttempts: 3, retryDelayMs: 0 }
    );
    await expect(unavailable.request('eth_getCode', [])).rejects.toBeInstanceOf(RpcUnavailableError);
    expect(unavailableCalls).toBe(1);

    let revertCalls = 0;
    const reverted = new HttpContractReader(
      'https://rpc.example',
      (async () => {
        revertCalls += 1;
        return Response.json({
          jsonrpc: '2.0',
          id: 1,
          error: { code: 3, message: 'execution reverted' }
        });
      }) as typeof fetch,
      5_000,
      { maxAttempts: 3, retryDelayMs: 0 }
    );
    await expect(reverted.request('eth_call', [])).rejects.toBeInstanceOf(RpcContractRevertedError);
    expect(revertCalls).toBe(1);
  });

  it('retries only the explicit COTI transient-overload JSON-RPC response', async () => {
    let calls = 0;
    const reader = new HttpContractReader(
      'https://rpc.example',
      (async (_input, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { id: number };
        return calls === 1
          ? Response.json({
              jsonrpc: '2.0',
              id: body.id,
              error: {
                code: -32002,
                message: 'RPC endpoint returned too many errors, retrying soon.'
              }
            })
          : Response.json({ jsonrpc: '2.0', id: body.id, result: '0x1' });
      }) as typeof fetch,
      5_000,
      { maxAttempts: 2, retryDelayMs: 0 }
    );

    await expect(reader.request('eth_blockNumber', [])).resolves.toBe('0x1');
    expect(calls).toBe(2);
  });
});
