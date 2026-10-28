import { useEffect, useState } from 'react';
import type { JsonRpcSigner } from '@coti-io/coti-ethers';
import {
  buildTradeCustomTokenInfoKey,
  getVerifiedEcosystemToken,
  VERIFIED_ECOSYSTEM_TOKENS,
  type TradeCustomTokenInfo
} from '../../../lib/appHelpers';
import {
  readCurrentPrivateErc20BalanceWei,
  readLegacyPrivateRewardBalanceWei
} from '../../../lib/appChain';
import {
  COTI_NETWORK,
  ERC20_TOKEN_ABI,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  isWalletAddress,
  LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS,
  loadCotiEthersModule,
  loadCotiReadProvider,
  normalizeTokenDecimals,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  shortenAddress
} from '../../../lib/appShared';
import type { WalletWatchedToken } from './useWalletTokenWatchlist';

type UseOwnerWalletBalancesArgs = {
  chainId: number | null;
  getOwnerReadSigner: (requirePrivacy: boolean) => Promise<JsonRpcSigner>;
  ownerAesReady: boolean;
  ownerWalletAddress: string;
  refreshNonce: number;
  includeCustomTokens?: boolean;
  watchedTokens?: readonly WalletWatchedToken[];
};

const EMPTY_WATCHED_TOKENS: readonly WalletWatchedToken[] = [];

type OwnerPrivateBalanceReaders = {
  readCurrentPrivateBalance?: typeof readCurrentPrivateErc20BalanceWei;
  readLegacyPrivateBalance?: typeof readLegacyPrivateRewardBalanceWei;
};

export const loadOwnerPrivateTokenBalances = async ({
  getOwnerReadSigner,
  ownerWalletAddress,
  readCurrentPrivateBalance = readCurrentPrivateErc20BalanceWei,
  readLegacyPrivateBalance = readLegacyPrivateRewardBalanceWei
}: {
  getOwnerReadSigner: (requirePrivacy: boolean) => Promise<JsonRpcSigner>;
  ownerWalletAddress: string;
} & OwnerPrivateBalanceReaders): Promise<{
  legacyPrivateBalanceWei: bigint | null;
  ownerPrivateSigner: JsonRpcSigner;
  privateBalanceWei: bigint | null;
}> => {
  const ownerPrivateSigner = await getOwnerReadSigner(true);
  const privateBalanceWei = await readCurrentPrivateBalance(
    PRIVATE_REWARD_TOKEN_ADDRESS,
    ownerWalletAddress,
    ownerPrivateSigner
  ).catch(() => null);
  const legacyPrivateBalanceWei = await readLegacyPrivateBalance(
    ownerWalletAddress,
    ownerPrivateSigner
  ).catch(() => null);
  return {
    legacyPrivateBalanceWei,
    ownerPrivateSigner,
    privateBalanceWei
  };
};

export default function useOwnerWalletBalances({
  chainId,
  getOwnerReadSigner,
  ownerAesReady,
  ownerWalletAddress,
  refreshNonce,
  includeCustomTokens = true,
  watchedTokens = EMPTY_WATCHED_TOKENS
}: UseOwnerWalletBalancesArgs) {
  const [ownerNativeBalanceWei, setOwnerNativeBalanceWei] = useState<bigint | null>(null);
  const [ownerRewardTokenBalanceWei, setOwnerRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [ownerPrivateRewardTokenBalanceWei, setOwnerPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [ownerLegacyPrivateRewardTokenBalanceWei, setOwnerLegacyPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [ownerPrivateRewardBalanceLocked, setOwnerPrivateRewardBalanceLocked] = useState(false);
  const [ownerTokenBalancesLoading, setOwnerTokenBalancesLoading] = useState(false);
  const [ownerCustomTradeTokenInfoByAddress, setOwnerCustomTradeTokenInfoByAddress] = useState<
    Record<string, TradeCustomTokenInfo>
  >({});

  useEffect(() => {
    let cancelled = false;

    if (!ownerWalletAddress || !isWalletAddress(ownerWalletAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setOwnerNativeBalanceWei(null);
      return;
    }

    const loadOwnerNativeBalance = async () => {
      try {
        const readProvider = await loadCotiReadProvider(true);
        if (cancelled) return;
        const nativeBalance = (await readProvider.getBalance(ownerWalletAddress)) as bigint;
        if (!cancelled) {
          setOwnerNativeBalanceWei(nativeBalance);
        }
      } catch {
        if (!cancelled) {
          setOwnerNativeBalanceWei(null);
        }
      }
    };

    loadOwnerNativeBalance().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [chainId, ownerWalletAddress, refreshNonce]);

  useEffect(() => {
    let cancelled = false;

    if (!ownerWalletAddress || !isWalletAddress(ownerWalletAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setOwnerRewardTokenBalanceWei(null);
      setOwnerPrivateRewardTokenBalanceWei(null);
      setOwnerLegacyPrivateRewardTokenBalanceWei(null);
      setOwnerPrivateRewardBalanceLocked(false);
      setOwnerTokenBalancesLoading(false);
      setOwnerCustomTradeTokenInfoByAddress({});
      return;
    }

    const loadOwnerTokenBalances = async () => {
      let ownerPrivateSigner: JsonRpcSigner | null = null;
      setOwnerTokenBalancesLoading(true);
      setOwnerCustomTradeTokenInfoByAddress((previous) => Object.fromEntries(
        Object.entries(previous).map(([key, entry]) => [
          key,
          entry.kind === 'private-erc20'
            ? {
                ...entry,
                aesReady: ownerAesReady,
                balanceWei: null,
                loading: true,
                privateBalanceState: { status: 'locked' as const }
              }
            : entry
        ])
      ));
      try {
        const cotiEthers = await loadCotiEthersModule();
        if (cancelled) return;
        const readProvider = await loadCotiReadProvider(true);
        if (cancelled) return;
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const rewardBalanceRaw = await rewardTokenContract.balanceOf(ownerWalletAddress).catch(() => null);
        if (cancelled) return;
        const ownerWalletKey = ownerWalletAddress.trim().toLowerCase();
        const builtInTokenAddressSet = new Set([
          REWARD_TOKEN_ADDRESS.toLowerCase(),
          PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase(),
          LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
        ]);
        const customTokenRequests = includeCustomTokens ? Array.from(
          new Map(
            [
              ...VERIFIED_ECOSYSTEM_TOKENS.map((token) => ({
                address: token.address,
                kind: token.kind,
                symbol: token.symbol
              })),
              ...watchedTokens
                .filter((token) => token.chainId === chainId)
                .map((token) => ({
                  address: token.tokenAddress,
                  kind: token.kind,
                  symbol: shortenAddress(token.tokenAddress)
                }))
            ]
              .filter((token) => !builtInTokenAddressSet.has(token.address.toLowerCase()))
              .map((token) => [`${token.kind}:${token.address.toLowerCase()}`, token] as const)
          ).values()
        ) : [];
        let privateBalanceWei: bigint | null = null;
        let legacyPrivateBalanceWei: bigint | null = null;

        if (ownerAesReady) {
          try {
            const privateBalances = await loadOwnerPrivateTokenBalances({
              getOwnerReadSigner,
              ownerWalletAddress
            });
            ownerPrivateSigner = privateBalances.ownerPrivateSigner;
            privateBalanceWei = privateBalances.privateBalanceWei;
            legacyPrivateBalanceWei = privateBalances.legacyPrivateBalanceWei;
          } catch {
            privateBalanceWei = null;
            legacyPrivateBalanceWei = null;
          }
        }
        if (cancelled) return;
        const ownerCustomEntries = await Promise.all(
          customTokenRequests.map(async (token): Promise<TradeCustomTokenInfo> => {
            const fallbackTokenSymbol = getVerifiedEcosystemToken(token.address)?.symbol ?? shortenAddress(token.address);
            try {
              const tokenAbi = token.kind === 'private-erc20' ? PRIVATE_ERC20_TOKEN_VNEXT_ABI : ERC20_TOKEN_ABI;
              const tokenContract = new cotiEthers.Contract(token.address, tokenAbi, readProvider);
              const [symbolRaw, decimalsRaw] = await Promise.all([
                tokenContract.symbol().catch(() => null),
                tokenContract.decimals().catch(() => null)
              ]);
              const symbol =
                typeof symbolRaw === 'string' && symbolRaw.trim().length > 0
                  ? symbolRaw.trim().slice(0, 24)
                  : fallbackTokenSymbol;
              const decimals = normalizeTokenDecimals(Number(decimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS));

              if (token.kind === 'private-erc20') {
                const balanceWei =
                  ownerPrivateSigner !== null && !cancelled
                    ? await readCurrentPrivateErc20BalanceWei(
                        token.address,
                        ownerWalletAddress,
                        ownerPrivateSigner
                      ).catch(() => null)
                    : null;
                return {
                  kind: token.kind,
                  address: token.address.trim().toLowerCase(),
                  symbol,
                  decimals,
                  balanceWei,
                  loading: false,
                  walletKey: ownerWalletKey,
                  aesReady: ownerAesReady,
                  privateBalanceState:
                    typeof balanceWei === 'bigint'
                      ? { status: 'ready', balanceWei }
                      : ownerPrivateSigner
                        ? { status: 'decrypt-failed' }
                        : { status: 'locked' },
                  error: ownerPrivateSigner ? undefined : 'Unlock privacy to read this private token balance.'
                };
              }

              const balanceRaw = cancelled ? null : await tokenContract.balanceOf(ownerWalletAddress).catch(() => null);
              return {
                kind: token.kind,
                address: token.address.trim().toLowerCase(),
                symbol,
                decimals,
                balanceWei: typeof balanceRaw === 'bigint' ? balanceRaw : null,
                loading: false,
                walletKey: ownerWalletKey
              };
            } catch {
              return {
                kind: token.kind,
                address: token.address.trim().toLowerCase(),
                symbol: fallbackTokenSymbol,
                decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
                balanceWei: null,
                loading: false,
                walletKey: ownerWalletKey,
                aesReady: token.kind === 'private-erc20' ? ownerAesReady : undefined,
                privateBalanceState: token.kind === 'private-erc20' ? { status: 'unsupported' } : undefined,
                error: 'Unable to load token metadata.'
              };
            }
          })
        );

        if (!cancelled) {
          setOwnerRewardTokenBalanceWei(typeof rewardBalanceRaw === 'bigint' ? rewardBalanceRaw : null);
          setOwnerPrivateRewardTokenBalanceWei(privateBalanceWei);
          setOwnerLegacyPrivateRewardTokenBalanceWei(legacyPrivateBalanceWei);
          setOwnerPrivateRewardBalanceLocked(!ownerAesReady);
          setOwnerCustomTradeTokenInfoByAddress(
            Object.fromEntries(
              ownerCustomEntries.map((entry) => [buildTradeCustomTokenInfoKey(entry.kind, entry.address), entry])
            )
          );
        }
      } catch {
        if (!cancelled) {
          setOwnerRewardTokenBalanceWei(null);
          setOwnerPrivateRewardTokenBalanceWei(null);
          setOwnerLegacyPrivateRewardTokenBalanceWei(null);
          setOwnerPrivateRewardBalanceLocked(!ownerAesReady);
          setOwnerCustomTradeTokenInfoByAddress({});
        }
      } finally {
        if (!cancelled) {
          setOwnerTokenBalancesLoading(false);
        }
      }
    };

    loadOwnerTokenBalances().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    chainId,
    getOwnerReadSigner,
    includeCustomTokens,
    ownerAesReady,
    ownerWalletAddress,
    refreshNonce,
    watchedTokens
  ]);

  return {
    ownerCustomTradeTokenInfoByAddress,
    ownerLegacyPrivateRewardTokenBalanceWei,
    ownerNativeBalanceWei,
    ownerPrivateRewardBalanceLocked,
    ownerPrivateRewardTokenBalanceWei,
    ownerRewardTokenBalanceWei,
    ownerTokenBalancesLoading
  };
}
