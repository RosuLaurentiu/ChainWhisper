import { describe, expect, it, vi } from 'vitest';
import type { CotiReadProvider } from './appShared/core';
import { waitForPublicTransactionReceipt } from './publicTransactionReceipt';

const HASH = `0x${'ab'.repeat(32)}`;

describe('waitForPublicTransactionReceipt', () => {
  it('polls only the supplied public provider until the known hash is confirmed', async () => {
    const receipt = { status: 1, transactionHash: HASH };
    const getTransactionReceipt = vi.fn()
      .mockRejectedValueOnce(new Error('temporary RPC error'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(receipt);

    await expect(waitForPublicTransactionReceipt({
      transactionHash: HASH.toUpperCase().replace('0X', '0x'),
      label: 'Test action',
      pollIntervalMs: 0,
      readProvider: { getTransactionReceipt } as unknown as CotiReadProvider,
      timeoutMs: 1_000
    })).resolves.toBe(receipt);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(3);
    expect(getTransactionReceipt).toHaveBeenCalledWith(HASH);
  });

  it('rejects malformed hashes and invalid polling policy before an RPC call', async () => {
    const getTransactionReceipt = vi.fn();
    const readProvider = { getTransactionReceipt } as unknown as CotiReadProvider;
    await expect(waitForPublicTransactionReceipt({
      transactionHash: '0x12',
      label: 'Test action',
      readProvider
    })).rejects.toThrow(/hash is invalid/);
    await expect(waitForPublicTransactionReceipt({
      transactionHash: HASH,
      label: '',
      readProvider
    })).rejects.toThrow(/configuration/);
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });
});
