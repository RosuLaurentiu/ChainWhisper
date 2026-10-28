import { describe, expect, it, vi } from 'vitest';
import { COTI_NETWORK, type Eip1193Provider } from './appShared';
import { COTI_TESTNET_NETWORK } from './chainWhisperNetworks';
import {
  ensureProviderOnCotiNetwork,
  ensureProviderOnNetwork,
  ensureProviderOnNetworkAndVerifyOwner
} from './walletNetwork';

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
  it('re-verifies the exact owner and chain after network selection', async () => {
    const owner = '0x0000000000000000000000000000000000000004';
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return [owner];
        if (method === 'eth_chainId') return COTI_NETWORK.chainIdHex;
        throw new Error(`Unexpected method: ${method}`);
      })
    } as unknown as Eip1193Provider;

    await expect(
      ensureProviderOnNetworkAndVerifyOwner(provider, COTI_NETWORK, owner.toUpperCase())
    ).resolves.toBe(COTI_NETWORK.chainIdDecimal);
    expect(provider.request).toHaveBeenCalledWith({ method: 'eth_accounts' });
  });

  it('fails closed if the wallet account changes during network selection', async () => {
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) =>
        method === 'eth_accounts'
          ? ['0x0000000000000000000000000000000000000005']
          : COTI_NETWORK.chainIdHex
      )
    } as unknown as Eip1193Provider;

    await expect(ensureProviderOnNetworkAndVerifyOwner(
      provider,
      COTI_NETWORK,
      '0x0000000000000000000000000000000000000004'
    )).rejects.toThrow('Wallet account changed');
  });

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

  it('can explicitly add and switch to canonical COTI testnet', async () => {
    const { provider } = createProvider(COTI_NETWORK.chainIdHex, { code: 4902 });

    await ensureProviderOnNetwork(provider, COTI_TESTNET_NETWORK);

    expect(provider.request).toHaveBeenCalledWith({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x6c11a0',
        chainName: 'COTI Testnet',
        rpcUrls: ['https://testnet.coti.io/rpc'],
        blockExplorerUrls: ['https://testnet.cotiscan.io'],
        nativeCurrency: { name: 'COTI', symbol: 'COTI', decimals: 18 }
      }]
    });
    expect(provider.request).toHaveBeenLastCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x6c11a0' }]
    });
  });
});
