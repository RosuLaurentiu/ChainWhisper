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
});
