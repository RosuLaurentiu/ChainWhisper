import { describe, expect, it, vi } from 'vitest';
import {
  CHAINWHISPER_NETWORK_OPTIONS,
  CHAINWHISPER_NETWORK_STORAGE_KEY,
  COTI_MAINNET_NETWORK,
  COTI_TESTNET_NETWORK,
  getChainWhisperCotiNetwork,
  readStoredChainWhisperNetworkId,
  resolveConfiguredChainWhisperNetworkId,
  storeChainWhisperNetworkId
} from './chainWhisperNetworks';

describe('chainWhisperNetworks', () => {
  it('pins the canonical COTI mainnet and testnet metadata', () => {
    expect(COTI_MAINNET_NETWORK).toMatchObject({
      chainIdHex: '0x282b34',
      chainIdDecimal: 2632500,
      rpcUrl: 'https://mainnet.coti.io/rpc',
      blockExplorerUrl: 'https://mainnet.cotiscan.io'
    });
    expect(COTI_TESTNET_NETWORK).toMatchObject({
      chainIdHex: '0x6c11a0',
      chainIdDecimal: 7082400,
      rpcUrl: 'https://testnet.coti.io/rpc',
      blockExplorerUrl: 'https://testnet.cotiscan.io'
    });
    expect(getChainWhisperCotiNetwork('coti-testnet')).toBe(COTI_TESTNET_NETWORK);
  });

  it('lists Ethereum and Avalanche only as non-selectable future networks', () => {
    expect(CHAINWHISPER_NETWORK_OPTIONS.map(({ id, status }) => [id, status])).toEqual([
      ['coti-mainnet', 'available'],
      ['coti-testnet', 'available'],
      ['ethereum-coming-soon', 'coming-soon'],
      ['avalanche-coming-soon', 'coming-soon']
    ]);
  });

  it('persists only an allowlisted versioned COTI environment choice', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value))
    };
    expect(readStoredChainWhisperNetworkId(storage)).toBe('coti-mainnet');
    storeChainWhisperNetworkId('coti-testnet', storage);
    expect(storage.setItem).toHaveBeenCalledWith(CHAINWHISPER_NETWORK_STORAGE_KEY, 'coti-testnet');
    expect(readStoredChainWhisperNetworkId(storage)).toBe('coti-testnet');
    values.set(CHAINWHISPER_NETWORK_STORAGE_KEY, 'ethereum-coming-soon');
    expect(readStoredChainWhisperNetworkId(storage)).toBe('coti-mainnet');
    expect(() => storeChainWhisperNetworkId('ethereum-coming-soon' as never, storage)).toThrow(
      'Unsupported ChainWhisper network'
    );
  });

  it('fails closed to mainnet when storage reads are unavailable', () => {
    expect(readStoredChainWhisperNetworkId({
      getItem: () => { throw new Error('blocked'); }
    })).toBe('coti-mainnet');
  });

  it('lets an explicit build network override a stale browser preference', () => {
    const staleMainnetStorage = {
      getItem: vi.fn(() => 'coti-mainnet')
    };
    expect(resolveConfiguredChainWhisperNetworkId({
      configuredNetworkId: 'coti-testnet',
      storage: staleMainnetStorage
    })).toBe('coti-testnet');
    expect(staleMainnetStorage.getItem).not.toHaveBeenCalled();
  });

  it('uses the stored preference only when the build is not network-locked', () => {
    expect(resolveConfiguredChainWhisperNetworkId({
      configuredNetworkId: undefined,
      storage: { getItem: () => 'coti-testnet' }
    })).toBe('coti-testnet');
    expect(resolveConfiguredChainWhisperNetworkId({
      configuredNetworkId: 'not-a-network',
      storage: { getItem: () => 'coti-mainnet' }
    })).toBe('coti-mainnet');
  });
});
