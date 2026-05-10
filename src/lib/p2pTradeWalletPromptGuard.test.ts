import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginP2PTradeWalletPromptFlow,
  clearP2PTradeWalletPromptFlowsForTest,
  endP2PTradeWalletPromptFlow,
  isP2PTradeWalletPromptActive
} from './p2pTradeWalletPromptGuard';
import type { Eip1193Provider } from './appShared';

const createProvider = (): Eip1193Provider => ({
  request: async () => null
});

describe('p2pTradeWalletPromptGuard', () => {
  beforeEach(() => {
    clearP2PTradeWalletPromptFlowsForTest();
  });

  it('tracks active wallet prompt flows by wallet provider and chain', () => {
    const provider = createProvider();
    const flow = beginP2PTradeWalletPromptFlow({
      chainId: 2632500,
      provider,
      walletAddress: '0x0000000000000000000000000000000000000001'
    });

    expect(isP2PTradeWalletPromptActive()).toBe(true);
    expect(
      isP2PTradeWalletPromptActive({
        chainId: 2632500,
        provider,
        walletAddress: '0x0000000000000000000000000000000000000001'
      })
    ).toBe(true);
    expect(
      isP2PTradeWalletPromptActive({
        chainId: 2632500,
        provider,
        walletAddress: '0x0000000000000000000000000000000000000002'
      })
    ).toBe(false);

    endP2PTradeWalletPromptFlow(flow);
    expect(isP2PTradeWalletPromptActive()).toBe(false);
  });

  it('supports nested prompt flows for the same wallet session', () => {
    const provider = createProvider();
    const input = {
      chainId: 2632500,
      provider,
      walletAddress: '0x0000000000000000000000000000000000000001'
    };
    const first = beginP2PTradeWalletPromptFlow(input);
    const second = beginP2PTradeWalletPromptFlow(input);

    endP2PTradeWalletPromptFlow(first);
    expect(isP2PTradeWalletPromptActive(input)).toBe(true);

    endP2PTradeWalletPromptFlow(second);
    expect(isP2PTradeWalletPromptActive(input)).toBe(false);
  });
});
