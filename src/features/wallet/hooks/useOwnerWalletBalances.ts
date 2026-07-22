import { useEffect, useState } from 'react';
import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
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
  createCotiBrowserProvider,
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
  shortenAddress,
  type Eip1193Provider
} from '../../../lib/appShared';

type UseOwnerWalletBalancesArgs = {
  browserProvider: Eip1193Provider | null;
  chainId: number | null;
  getConnectedProvider: () => Eip1193Provider | null;
  ownerAesKey: string;
  ownerAesReady: boolean;
  ownerWalletAddress: string;
  refreshNonce: number;
};

export default function useOwnerWalletBalances({
  browserProvider,
  chainId,
  getConnectedProvider,
  ownerAesKey,
  ownerAesReady,
  ownerWalletAddress,
  refreshNonce
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
      setOwnerTokenBalancesLoading(true);
      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
        const rewardBalanceRaw = await rewardTokenContract.balanceOf(ownerWalletAddress).catch(() => null);
        const ownerWalletKey = ownerWalletAddress.trim().toLowerCase();
        const builtInTokenAddressSet = new Set([
          REWARD_TOKEN_ADDRESS.toLowerCase(),
          PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase(),
          LEGACY_PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
        ]);
        const customTokenRequests = VERIFIED_ECOSYSTEM_TOKENS.filter(
          (token) => !builtInTokenAddressSet.has(token.address.toLowerCase())
        );
        let ownerPrivateSigner: JsonRpcSigner | null = null;
        let privateBalanceWei: bigint | null = null;
        let legacyPrivateBalanceWei: bigint | null = null;

        if (ownerAesReady) {
          try {
            const ownerAesKeyForRead = ownerAesKey.trim();
            const provider = browserProvider ?? getConnectedProvider();
            if (!ownerAesKeyForRead || !provider) {
              throw new Error('Owner privacy is locked.');
            }
            const cotiBrowserProvider = await createCotiBrowserProvider(provider);
            const signer = await cotiBrowserProvider.getSigner(ownerWalletAddress, {
              aesKey: ownerAesKeyForRead
            } as OnboardInfo);
            signer.disableAutoOnboard();
            ownerPrivateSigner = signer;
            privateBalanceWei = await readCurrentPrivateErc20BalanceWei(
              PRIVATE_REWARD_TOKEN_ADDRESS,
              ownerWalletAddress,
              signer
            ).catch(() => null);
            legacyPrivateBalanceWei = await readLegacyPrivateRewardBalanceWei(
              ownerWalletAddress,
              signer
            ).catch(() => null);
          } catch {
            privateBalanceWei = null;
            legacyPrivateBalanceWei = null;
          }
        }
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
                  ownerPrivateSigner !== null
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

              const balanceRaw = await tokenContract.balanceOf(ownerWalletAddress).catch(() => null);
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
    browserProvider,
    chainId,
    getConnectedProvider,
    ownerAesKey,
    ownerAesReady,
    ownerWalletAddress,
    refreshNonce
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
