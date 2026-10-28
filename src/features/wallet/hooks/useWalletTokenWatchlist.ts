import { useCallback, useEffect, useState } from 'react';
import {
  COTI_NETWORK,
  ERC20_TOKEN_ABI,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI
} from '../../../lib/appShared';
import { getVerifiedEcosystemToken } from '../../../lib/appHelpers';

export type WalletWatchedTokenKind = 'erc20' | 'private-erc20';

export type WalletWatchedToken = {
  chainId: number;
  kind: WalletWatchedTokenKind;
  tokenAddress: string;
};

export type ValidatedWalletWatchedToken = WalletWatchedToken & {
  decimals: number;
  symbol: string;
};

const WATCHLIST_STORAGE_PREFIX = 'chainwhisper.wallet-token-watchlist.v1';
const MAX_WATCHED_TOKENS = 64;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PRIVATE_ERC20_INTERFACE_ID = '0x479eaff4';
const ERC165_ABI = ['function supportsInterface(bytes4 interfaceId) view returns (bool)'] as const;

const normalizeWalletAddress = (value: string): string =>
  isWalletAddress(value) && value.trim().toLowerCase() !== ZERO_ADDRESS
    ? value.trim().toLowerCase()
    : '';

const normalizeTokenAddress = normalizeWalletAddress;

export const buildWalletTokenWatchlistStorageKey = (walletAddress: string): string => {
  const walletKey = normalizeWalletAddress(walletAddress);
  return walletKey ? `${WATCHLIST_STORAGE_PREFIX}:${walletKey}` : '';
};

const normalizeWatchedToken = (value: unknown): WalletWatchedToken | null => {
  const candidate = value as Partial<WalletWatchedToken> | null;
  const tokenAddress = normalizeTokenAddress(candidate?.tokenAddress ?? '');
  if (
    !candidate ||
    !Number.isSafeInteger(candidate.chainId) ||
    Number(candidate.chainId) <= 0 ||
    (candidate.kind !== 'erc20' && candidate.kind !== 'private-erc20') ||
    !tokenAddress
  ) {
    return null;
  }
  return {
    chainId: Number(candidate.chainId),
    kind: candidate.kind,
    tokenAddress
  };
};

export const readWalletTokenWatchlist = ({
  chainId,
  storage,
  walletAddress
}: {
  chainId: number | null;
  storage?: Pick<Storage, 'getItem'> | null;
  walletAddress: string;
}): WalletWatchedToken[] => {
  if (!Number.isSafeInteger(chainId) || Number(chainId) <= 0) return [];
  const storageKey = buildWalletTokenWatchlistStorageKey(walletAddress);
  if (!storageKey || !storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? '[]') as unknown;
    if (!Array.isArray(parsed) || parsed.length > MAX_WATCHED_TOKENS) return [];
    const tokens = new Map<string, WalletWatchedToken>();
    for (const value of parsed) {
      const token = normalizeWatchedToken(value);
      if (!token || token.chainId !== chainId) continue;
      const key = `${token.kind}:${token.tokenAddress}`;
      tokens.set(key, token);
    }
    return Array.from(tokens.values());
  } catch {
    return [];
  }
};

export const writeWalletTokenWatchlist = ({
  storage,
  tokens,
  walletAddress
}: {
  storage?: Pick<Storage, 'setItem'> | null;
  tokens: readonly WalletWatchedToken[];
  walletAddress: string;
}): void => {
  const storageKey = buildWalletTokenWatchlistStorageKey(walletAddress);
  if (!storageKey || !storage) return;
  const normalized = new Map<string, WalletWatchedToken>();
  for (const value of tokens.slice(0, MAX_WATCHED_TOKENS)) {
    const token = normalizeWatchedToken(value);
    if (!token) continue;
    normalized.set(`${token.chainId}:${token.kind}:${token.tokenAddress}`, token);
  }
  storage.setItem(storageKey, JSON.stringify(Array.from(normalized.values())));
};

export const removeWalletTokenFromWatchlist = (
  tokens: readonly WalletWatchedToken[],
  { kind, tokenAddress }: Pick<WalletWatchedToken, 'kind' | 'tokenAddress'>
): WalletWatchedToken[] => {
  const normalizedTokenAddress = normalizeTokenAddress(tokenAddress);
  if (!normalizedTokenAddress) return [...tokens];
  return tokens.filter(
    (token) => token.kind !== kind || token.tokenAddress !== normalizedTokenAddress
  );
};

export type WalletTokenValidationRuntime = {
  getCode: (tokenAddress: string) => Promise<string>;
  readPublicToken: (
    tokenAddress: string,
    accountAddress: string
  ) => Promise<{ balanceReadable: boolean; decimals: unknown; symbol: unknown }>;
  readPrivateToken: (
    tokenAddress: string,
    accountAddress: string
  ) => Promise<{
    balanceReadable: boolean;
    decimals: unknown;
    encryptionAddress: unknown;
    interfaceSupported: unknown;
    symbol: unknown;
  }>;
};

const loadWalletTokenValidationRuntime = async (): Promise<WalletTokenValidationRuntime> => {
  const [cotiEthers, readProvider] = await Promise.all([
    loadCotiEthersModule(),
    loadCotiReadProvider(true)
  ]);
  return {
    getCode: (tokenAddress) => readProvider.getCode(tokenAddress),
    readPublicToken: async (tokenAddress, accountAddress) => {
      const contract = new cotiEthers.Contract(tokenAddress, ERC20_TOKEN_ABI, readProvider);
      const [symbol, decimals, balance] = await Promise.all([
        contract.symbol(),
        contract.decimals(),
        contract.balanceOf(accountAddress)
      ]);
      return { balanceReadable: typeof balance === 'bigint', decimals, symbol };
    },
    readPrivateToken: async (tokenAddress, accountAddress) => {
      const contract = new cotiEthers.Contract(
        tokenAddress,
        [...PRIVATE_ERC20_TOKEN_VNEXT_ABI, ...ERC165_ABI],
        readProvider
      );
      const [symbol, decimals, interfaceSupported, encryptionAddress, balance] = await Promise.all([
        contract.symbol(),
        contract.decimals(),
        contract.supportsInterface(PRIVATE_ERC20_INTERFACE_ID),
        contract.accountEncryptionAddress(accountAddress),
        contract['balanceOf(address)'](accountAddress)
      ]);
      return {
        balanceReadable: balance !== null && balance !== undefined,
        decimals,
        encryptionAddress,
        interfaceSupported,
        symbol
      };
    }
  };
};

export const validateWalletWatchedToken = async ({
  accountAddress,
  chainId,
  kind,
  runtime,
  tokenAddress
}: {
  accountAddress: string;
  chainId: number | null;
  kind: WalletWatchedTokenKind;
  runtime?: WalletTokenValidationRuntime;
  tokenAddress: string;
}): Promise<ValidatedWalletWatchedToken> => {
  if (chainId !== COTI_NETWORK.chainIdDecimal) {
    throw new Error('Switch to COTI Mainnet before adding a token.');
  }
  const normalizedAccountAddress = normalizeWalletAddress(accountAddress);
  const normalizedTokenAddress = normalizeTokenAddress(tokenAddress);
  if (!normalizedAccountAddress) {
    throw new Error('Connect MetaMask or CipherTrade before adding a token.');
  }
  if (!normalizedTokenAddress) {
    throw new Error('Enter a valid nonzero token contract address.');
  }
  if (getVerifiedEcosystemToken(normalizedTokenAddress)) {
    throw new Error('This token is already included in the connected wallet view.');
  }

  const validationRuntime = runtime ?? await loadWalletTokenValidationRuntime();
  const code = await validationRuntime.getCode(normalizedTokenAddress).catch(() => '0x');
  if (!code || /^0x0*$/i.test(code)) {
    throw new Error('No token contract is deployed at this address on COTI Mainnet.');
  }

  const metadata = kind === 'private-erc20'
    ? await validationRuntime.readPrivateToken(normalizedTokenAddress, normalizedAccountAddress).catch(() => null)
    : await validationRuntime.readPublicToken(normalizedTokenAddress, normalizedAccountAddress).catch(() => null);
  if (!metadata) {
    throw new Error(`This contract does not expose the supported ${kind === 'private-erc20' ? 'COTI private-token' : 'ERC-20'} surface.`);
  }
  const symbol = typeof metadata.symbol === 'string' ? metadata.symbol.trim() : '';
  const decimals = typeof metadata.decimals === 'bigint'
    ? Number(metadata.decimals)
    : typeof metadata.decimals === 'number'
      ? metadata.decimals
      : Number.NaN;
  if (!symbol || symbol.length > 24 || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error('Token metadata is missing or outside the supported symbol/decimals bounds.');
  }
  if (!metadata.balanceReadable) {
    throw new Error('The token balance read surface is unavailable for the connected wallet.');
  }
  if (kind === 'private-erc20') {
    const privateMetadata = metadata as Awaited<ReturnType<WalletTokenValidationRuntime['readPrivateToken']>>;
    if (privateMetadata.interfaceSupported !== true) {
      throw new Error('This contract does not support the latest COTI PrivateERC20 interface.');
    }
    if (typeof privateMetadata.encryptionAddress !== 'string' || !isWalletAddress(privateMetadata.encryptionAddress)) {
      throw new Error('This private token does not expose its account encryption-address mapping.');
    }
  }

  return {
    chainId,
    kind,
    tokenAddress: normalizedTokenAddress,
    decimals,
    symbol
  };
};

export default function useWalletTokenWatchlist({
  chainId,
  walletAddress
}: {
  chainId: number | null;
  walletAddress: string;
}) {
  const [watchedTokens, setWatchedTokens] = useState<WalletWatchedToken[]>([]);
  const walletScopeKey = normalizeWalletAddress(walletAddress);

  useEffect(() => {
    setWatchedTokens(readWalletTokenWatchlist({
      chainId,
      storage: typeof window === 'undefined' ? null : window.localStorage,
      walletAddress: walletScopeKey
    }));
  }, [chainId, walletScopeKey]);

  const addWatchedToken = useCallback(async ({
    kind,
    tokenAddress
  }: {
    kind: WalletWatchedTokenKind;
    tokenAddress: string;
  }): Promise<ValidatedWalletWatchedToken> => {
    const validated = await validateWalletWatchedToken({
      accountAddress: walletScopeKey,
      chainId,
      kind,
      tokenAddress
    });
    const key = `${validated.kind}:${validated.tokenAddress}`;
    if (watchedTokens.some((token) => `${token.kind}:${token.tokenAddress}` === key)) {
      return validated;
    }
    if (watchedTokens.length >= MAX_WATCHED_TOKENS) {
      throw new Error(`ChainWhisper supports up to ${MAX_WATCHED_TOKENS} custom tokens per account.`);
    }
    const next = [...watchedTokens, {
      chainId: validated.chainId,
      kind: validated.kind,
      tokenAddress: validated.tokenAddress
    }];
    writeWalletTokenWatchlist({
      storage: typeof window === 'undefined' ? null : window.localStorage,
      tokens: next,
      walletAddress: walletScopeKey
    });
    setWatchedTokens(next);
    return validated;
  }, [chainId, walletScopeKey, watchedTokens]);

  const removeWatchedToken = useCallback(({
    kind,
    tokenAddress
  }: {
    kind: WalletWatchedTokenKind;
    tokenAddress: string;
  }): void => {
    const normalizedTokenAddress = normalizeTokenAddress(tokenAddress);
    if (!normalizedTokenAddress) return;
    setWatchedTokens((previous) => {
      const next = removeWalletTokenFromWatchlist(previous, { kind, tokenAddress: normalizedTokenAddress });
      writeWalletTokenWatchlist({
        storage: typeof window === 'undefined' ? null : window.localStorage,
        tokens: next,
        walletAddress: walletScopeKey
      });
      return next;
    });
  }, [walletScopeKey]);

  return { addWatchedToken, removeWatchedToken, watchedTokens };
}
