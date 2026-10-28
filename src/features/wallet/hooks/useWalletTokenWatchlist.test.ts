import { describe, expect, it } from 'vitest';
import { COTI_NETWORK } from '../../../lib/appShared';
import {
  buildWalletTokenWatchlistStorageKey,
  readWalletTokenWatchlist,
  removeWalletTokenFromWatchlist,
  validateWalletWatchedToken,
  writeWalletTokenWatchlist,
  type WalletTokenValidationRuntime,
  type WalletWatchedToken
} from './useWalletTokenWatchlist';

const walletAddress = '0x1111111111111111111111111111111111111111';
const tokenAddress = '0x3333333333333333333333333333333333333333';

const createStorage = () => {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); }
  };
};

const buildRuntime = (
  overrides: Partial<WalletTokenValidationRuntime> = {}
): WalletTokenValidationRuntime => ({
  getCode: async () => '0x6001600055',
  readPublicToken: async () => ({ balanceReadable: true, decimals: 6, symbol: 'CUSTOM' }),
  readPrivateToken: async () => ({
    balanceReadable: true,
    decimals: 6,
    encryptionAddress: walletAddress,
    interfaceSupported: true,
    symbol: 'p.CUSTOM'
  }),
  ...overrides
});

describe('wallet token watch list', () => {
  it('removes only the selected token kind and address', () => {
    const tokens: WalletWatchedToken[] = [
      { chainId: COTI_NETWORK.chainIdDecimal, kind: 'private-erc20', tokenAddress },
      { chainId: COTI_NETWORK.chainIdDecimal, kind: 'erc20', tokenAddress },
      {
        chainId: COTI_NETWORK.chainIdDecimal,
        kind: 'private-erc20',
        tokenAddress: '0x4444444444444444444444444444444444444444'
      }
    ];

    expect(removeWalletTokenFromWatchlist(tokens, {
      kind: 'private-erc20',
      tokenAddress
    })).toEqual(tokens.slice(1));
  });

  it('stores only public token descriptors in a wallet-scoped key', () => {
    const storage = createStorage();
    const unsafeInput = {
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'private-erc20',
      tokenAddress,
      aesKey: 'must-not-persist',
      balanceWei: '99',
      password: 'must-not-persist',
      privateKey: 'must-not-persist',
      seed: 'must-not-persist'
    } as unknown as WalletWatchedToken;

    writeWalletTokenWatchlist({ storage, tokens: [unsafeInput], walletAddress });

    const stored = storage.entries.get(buildWalletTokenWatchlistStorageKey(walletAddress));
    expect(JSON.parse(stored ?? 'null')).toEqual([{
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'private-erc20',
      tokenAddress
    }]);
    expect(stored).not.toMatch(/aes|balance|password|privateKey|seed/i);
    expect(readWalletTokenWatchlist({
      chainId: COTI_NETWORK.chainIdDecimal,
      storage,
      walletAddress
    })).toEqual([{
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'private-erc20',
      tokenAddress
    }]);
    expect(readWalletTokenWatchlist({
      chainId: COTI_NETWORK.chainIdDecimal,
      storage,
      walletAddress: '0x2222222222222222222222222222222222222222'
    })).toEqual([]);
  });

  it('validates deployed bounded public ERC-20 metadata before adding', async () => {
    await expect(validateWalletWatchedToken({
      accountAddress: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'erc20',
      runtime: buildRuntime(),
      tokenAddress
    })).resolves.toEqual({
      chainId: COTI_NETWORK.chainIdDecimal,
      decimals: 6,
      kind: 'erc20',
      symbol: 'CUSTOM',
      tokenAddress
    });

    await expect(validateWalletWatchedToken({
      accountAddress: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'erc20',
      runtime: buildRuntime({ getCode: async () => '0x' }),
      tokenAddress
    })).rejects.toThrow('No token contract');

    await expect(validateWalletWatchedToken({
      accountAddress: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'erc20',
      runtime: buildRuntime({
        readPublicToken: async () => ({ balanceReadable: true, decimals: 255, symbol: 'CUSTOM' })
      }),
      tokenAddress
    })).rejects.toThrow('metadata');
  });

  it('requires the latest COTI private-token interface and account read surface', async () => {
    await expect(validateWalletWatchedToken({
      accountAddress: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'private-erc20',
      runtime: buildRuntime(),
      tokenAddress
    })).resolves.toMatchObject({ kind: 'private-erc20', symbol: 'p.CUSTOM' });

    await expect(validateWalletWatchedToken({
      accountAddress: walletAddress,
      chainId: COTI_NETWORK.chainIdDecimal,
      kind: 'private-erc20',
      runtime: buildRuntime({
        readPrivateToken: async () => ({
          balanceReadable: true,
          decimals: 6,
          encryptionAddress: walletAddress,
          interfaceSupported: false,
          symbol: 'p.CUSTOM'
        })
      }),
      tokenAddress
    })).rejects.toThrow('latest COTI PrivateERC20');
  });
});
