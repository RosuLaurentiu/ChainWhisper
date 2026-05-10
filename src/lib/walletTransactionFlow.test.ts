import { beforeEach, describe, expect, it } from 'vitest';
import type { Eip1193Provider } from './appShared';
import {
  beginWalletTransactionFlow,
  clearWalletTransactionFlowsForTest,
  endWalletTransactionFlow,
  isWalletTransactionFlowActive,
  runWalletTransactionFlow
} from './walletTransactionFlow';

const createProvider = (): Eip1193Provider => ({
  request: async () => null
});

describe('walletTransactionFlow', () => {
  beforeEach(() => {
    clearWalletTransactionFlowsForTest();
  });

  it('tracks active wallet transaction flows by wallet provider and chain', () => {
    const provider = createProvider();
    const flow = beginWalletTransactionFlow({
      chainId: 2632500,
      provider,
      walletAddress: '0x0000000000000000000000000000000000000001'
    });

    expect(isWalletTransactionFlowActive()).toBe(true);
    expect(
      isWalletTransactionFlowActive({
        chainId: 2632500,
        provider,
        walletAddress: '0x0000000000000000000000000000000000000001'
      })
    ).toBe(true);
    expect(
      isWalletTransactionFlowActive({
        chainId: 2632500,
        provider,
        walletAddress: '0x0000000000000000000000000000000000000002'
      })
    ).toBe(false);

    endWalletTransactionFlow(flow);
    expect(isWalletTransactionFlowActive()).toBe(false);
  });

  it('supports nested transaction flows for the same wallet session', () => {
    const provider = createProvider();
    const input = {
      chainId: 2632500,
      provider,
      walletAddress: '0x0000000000000000000000000000000000000001'
    };
    const first = beginWalletTransactionFlow(input);
    const second = beginWalletTransactionFlow(input);

    endWalletTransactionFlow(first);
    expect(isWalletTransactionFlowActive(input)).toBe(true);

    endWalletTransactionFlow(second);
    expect(isWalletTransactionFlowActive(input)).toBe(false);
  });

  it('clears the active flow after success or failure', async () => {
    const provider = createProvider();
    const input = {
      chainId: 2632500,
      provider,
      walletAddress: '0x0000000000000000000000000000000000000001'
    };

    await expect(runWalletTransactionFlow(input, async () => 'done')).resolves.toBe('done');
    expect(isWalletTransactionFlowActive(input)).toBe(false);

    await expect(
      runWalletTransactionFlow(input, async () => {
        throw new Error('rejected');
      })
    ).rejects.toThrow('rejected');
    expect(isWalletTransactionFlowActive(input)).toBe(false);
  });
});
