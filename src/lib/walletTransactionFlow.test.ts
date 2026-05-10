import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Eip1193Provider } from './appShared';
import {
  beginWalletTransactionFlow,
  clearWalletTransactionFlow,
  clearWalletTransactionFlowMemoryForTest,
  clearWalletTransactionFlowsForTest,
  endWalletTransactionFlow,
  isWalletTransactionFlowActive,
  runWalletTransactionFlow
} from './walletTransactionFlow';

const createProvider = (): Eip1193Provider => ({
  request: async () => null
});

const createTestStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
};

describe('walletTransactionFlow', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      sessionStorage: createTestStorage()
    });
    clearWalletTransactionFlowsForTest();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('keeps a wallet transaction flow active from session storage after an in-memory reset', () => {
    const provider = { ...createProvider(), isMetaMask: true } as Eip1193Provider;
    const input = {
      chainId: 2632500,
      provider,
      walletAddress: '0x0000000000000000000000000000000000000001'
    };
    const flow = beginWalletTransactionFlow(input);

    clearWalletTransactionFlowMemoryForTest();
    expect(isWalletTransactionFlowActive(input)).toBe(true);

    endWalletTransactionFlow(flow);
    expect(isWalletTransactionFlowActive(input)).toBe(false);
  });

  it('expires stale session-backed wallet transaction flows', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-10T00:00:00.000Z'));
      const provider = { ...createProvider(), isMetaMask: true } as Eip1193Provider;
      const input = {
        chainId: 2632500,
        provider,
        walletAddress: '0x0000000000000000000000000000000000000001'
      };
      beginWalletTransactionFlow(input);
      clearWalletTransactionFlowMemoryForTest();

      vi.setSystemTime(new Date('2026-05-10T00:11:00.000Z'));
      expect(isWalletTransactionFlowActive(input)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears wallet flows for every chain when chain id is omitted', () => {
    const provider = { ...createProvider(), isMetaMask: true } as Eip1193Provider;
    const walletAddress = '0x0000000000000000000000000000000000000001';
    beginWalletTransactionFlow({ chainId: 2632500, provider, walletAddress });
    beginWalletTransactionFlow({ chainId: 2632501, provider, walletAddress });

    clearWalletTransactionFlowMemoryForTest();
    expect(isWalletTransactionFlowActive({ chainId: 2632500, provider, walletAddress })).toBe(true);

    clearWalletTransactionFlow({ provider, walletAddress });

    expect(isWalletTransactionFlowActive({ chainId: 2632500, provider, walletAddress })).toBe(false);
    expect(isWalletTransactionFlowActive({ chainId: 2632501, provider, walletAddress })).toBe(false);
  });
});
