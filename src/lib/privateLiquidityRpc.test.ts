import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrivateLiquidityHttpProvider } from './privateLiquidityRpc';

const shared = vi.hoisted(() => ({ send: vi.fn(), load: vi.fn() }));
vi.mock('./appShared/core', () => ({
  COTI_NETWORK: { rpcUrl: 'https://testnet.coti.io/rpc' },
  loadCotiHttpProvider: shared.load
}));
beforeEach(() => {
  shared.send.mockReset().mockResolvedValue('0x123');
  shared.load.mockReset().mockResolvedValue({ send: shared.send });
});
const create = () => createPrivateLiquidityHttpProvider({ rpcUrl: 'https://testnet.coti.io/rpc' });

describe('privateLiquidityRpc', () => {
  it.each(['eth_blockNumber', 'eth_call', 'eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getLogs', 'eth_getTransactionReceipt'])(
    'delegates read-only %s to the admitted shared provider', async method => {
      const provider = create();
      await expect(provider.request({ method, params: ['fixture'] })).resolves.toBe('0x123');
      expect(shared.load).toHaveBeenCalledTimes(1);
      expect(shared.send).toHaveBeenCalledWith(method, ['fixture']);
      expect(Object.isFrozen(provider)).toBe(true);
    });

  it('uses an empty parameter list when omitted', async () => {
    await create().request({ method: 'eth_chainId' });
    expect(shared.send).toHaveBeenCalledWith('eth_chainId', []);
  });

  it.each(['not-a-url', 'https://mainnet.coti.io/rpc', 'https://user:secret@testnet.coti.io/rpc', 'https://other.invalid/rpc'])(
    'rejects an invalid or different endpoint without a fallback: %s', endpoint => {
      expect(() => createPrivateLiquidityHttpProvider({ rpcUrl: endpoint })).toThrow(/RPC/);
      expect(shared.load).not.toHaveBeenCalled();
    });

  it.each(['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_getBalance', 'bad-method'])(
    'rejects unsupported %s before acquiring the provider', async method => {
      await expect(create().request({ method, params: [] })).rejects.toThrow(/malformed/);
      expect(shared.load).not.toHaveBeenCalled();
    });

  it('rejects object parameters before acquiring the provider', async () => {
    await expect(create().request({ method: 'eth_call', params: {} })).rejects.toThrow(/malformed/);
    expect(shared.load).not.toHaveBeenCalled();
  });

  it.each(['HTTP 403', 'HTTP 429', 'request timeout'])('retains the safe local %s stop', async reason => {
    const message = `COTI RPC reads stopped after ${reason}. No automatic retry.`;
    shared.send.mockRejectedValue(new Error(message));
    await expect(create().request({ method: 'eth_blockNumber' })).rejects.toThrow(message);
    expect(shared.send).toHaveBeenCalledTimes(1);
  });

  it('retains only numeric RPC codes and hides upstream data', async () => {
    shared.send.mockRejectedValue({ message: 'secret upstream detail', payload: 'private params',
      code: 'UNKNOWN_ERROR', info: { error: { code: -32002, message: 'secret response' } } });
    await expect(create().request({ method: 'eth_getCode' })).rejects.toThrow(
      'Private-liquidity JSON-RPC read failed (code -32002).');
    expect(shared.send).toHaveBeenCalledTimes(1);
  });

  it('sanitizes failed shared-provider admission without creating another client', async () => {
    shared.load.mockRejectedValue(new Error('secret transport detail'));
    await expect(create().request({ method: 'eth_chainId' })).rejects.toThrow('Private-liquidity JSON-RPC read failed.');
    expect(shared.load).toHaveBeenCalledTimes(1);
    expect(shared.send).not.toHaveBeenCalled();
  });
});
