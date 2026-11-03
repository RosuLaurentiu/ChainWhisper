import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOwnerTradeV2ReadRunner,
  waitForOwnerTradeV2Receipt,
  type OwnerTradeV2CapabilityBinding
} from './ownerTradeV2Capability';

describe('owner OTC V2 read runner', () => {
  it('keeps public reads off the browser-wallet signer when a read provider exists', () => {
    const signer = Object.freeze({ label: 'wallet-signer' });
    const readProvider = Object.freeze({ label: 'public-read-provider' });
    const binding = { signer, readProvider } as unknown as OwnerTradeV2CapabilityBinding;

    expect(getOwnerTradeV2ReadRunner(binding)).toBe(readProvider);
  });

  it('retains the signer fallback for isolated legacy test capabilities', () => {
    const signer = Object.freeze({ label: 'wallet-signer' });
    const binding = { signer } as unknown as OwnerTradeV2CapabilityBinding;

    expect(getOwnerTradeV2ReadRunner(binding)).toBe(signer);
  });
});

describe('owner OTC V2 receipt finality', () => {
  afterEach(() => vi.useRealTimers());
  const hash = `0x${'ab'.repeat(32)}`;
  const blockHash = `0x${'cd'.repeat(32)}`;
  const receipt = { blockNumber: 100, blockHash };
  const fixture = () => {
    const send = vi.fn(async (method: string): Promise<unknown> => method === 'eth_blockNumber'
      ? '0x69' : { number: '0x64', hash: blockHash });
    const getTransactionReceipt = vi.fn(async () => receipt);
    const binding = { readProvider: { send, getTransactionReceipt } } as unknown as OwnerTradeV2CapabilityBinding;
    return { binding, send, getTransactionReceipt };
  };

  it('waits until the receipt block is inside the selected safe head', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.send.mockResolvedValueOnce('0x68');
    const result = waitForOwnerTradeV2Receipt(f.binding, hash, { finalityLagBlocks: 5n, pollIntervalMs: 10, timeoutMs: 100 });
    const done = vi.fn();
    void result.then(done);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBe(receipt);
    expect(f.send).toHaveBeenLastCalledWith('eth_getBlockByNumber', ['0x64', false]);
  });

  it('keeps the default first-receipt behavior for other callers', async () => {
    const f = fixture();
    await expect(waitForOwnerTradeV2Receipt(f.binding, hash)).resolves.toBe(receipt);
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects a receipt whose block is no longer canonical', async () => {
    const f = fixture();
    f.send.mockResolvedValueOnce('0x69').mockResolvedValueOnce({ number: '0x64', hash });
    await expect(waitForOwnerTradeV2Receipt(f.binding, hash, { finalityLagBlocks: 5n })).rejects.toThrow(/reorganized/);
  });

  it('stops on a finality read failure without another receipt attempt', async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error('read stopped'));
    await expect(waitForOwnerTradeV2Receipt(f.binding, hash, { finalityLagBlocks: 5n })).rejects.toThrow('read stopped');
    expect(f.getTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it.each(['0x00', '-1', '0x10000000000000000', null])('rejects invalid finality head %s', async latest => {
    const f = fixture();
    f.send.mockResolvedValueOnce(latest as string);
    await expect(waitForOwnerTradeV2Receipt(f.binding, hash, { finalityLagBlocks: 5n })).rejects.toThrow(/finality head/);
  });

  it('keeps the existing finite timeout when the receipt remains immature', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.send.mockResolvedValue('0x68');
    const result = waitForOwnerTradeV2Receipt(f.binding, hash, { finalityLagBlocks: 5n, pollIntervalMs: 10, timeoutMs: 20 });
    const rejected = expect(result).rejects.toThrow(/confirmation timed out/);
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(f.getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it.each([-1n, 1n << 64n, 5, '5', null])('rejects invalid depth %s before polling', async depth => {
    const f = fixture();
    await expect(waitForOwnerTradeV2Receipt(f.binding, hash, { finalityLagBlocks: depth as bigint })).rejects.toThrow(/finality/);
    expect(f.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
