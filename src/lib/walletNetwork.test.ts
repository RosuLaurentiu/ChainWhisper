import { describe, expect, it, vi } from 'vitest';
import { COTI_NETWORK, type Eip1193Provider } from './appShared';
import { ensureProviderOnCotiNetwork } from './walletNetwork';

const createProvider = (chainId: string | number, switchError?: unknown) => {
  const methods: string[] = [];
  let switchFailure = switchError;
  const provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      methods.push(method);
      if (method === 'eth_chainId') {
        return chainId;
      }
      if (method === 'wallet_switchEthereumChain' && switchFailure) {
        const error = switchFailure;
        switchFailure = undefined;
        throw error;
      }
      return null;
    })
  } as unknown as Eip1193Provider;
  return { methods, provider };
};

describe('ensureProviderOnCotiNetwork', () => {
  it('does not request a switch when the wallet is already on COTI', async () => {
    const { methods, provider } = createProvider(COTI_NETWORK.chainIdHex);

    await ensureProviderOnCotiNetwork(provider);

    expect(methods).toEqual(['eth_chainId']);
  });

  it('switches when the wallet is on another chain', async () => {
    const { methods, provider } = createProvider('0x1');

    await ensureProviderOnCotiNetwork(provider);

    expect(methods).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
    expect(provider.request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: COTI_NETWORK.chainIdHex }]
    });
  });

  it('adds COTI when the wallet does not know the chain', async () => {
    const { methods, provider } = createProvider('0x1', { code: 4902 });

    await ensureProviderOnCotiNetwork(provider);

    expect(methods).toEqual([
      'eth_chainId',
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
      'wallet_switchEthereumChain'
    ]);
  });
});
