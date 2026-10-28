import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { readCurrentPrivateErc20BalanceWei } from '../../../lib/appChain';
import {
  buildTradeCustomTokenInfoKey,
  getVerifiedEcosystemToken,
  isCustomTradeTokenSelection,
  VERIFIED_ECOSYSTEM_TOKENS,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../../../lib/appHelpers';
import {
  COTI_NETWORK,
  ERC20_TOKEN_ABI,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfo,
  normalizeTokenDecimals,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  shortenAddress,
  type TradeAssetPayload
} from '../../../lib/appShared';
import type { WalletWatchedToken } from '../../wallet/hooks/useWalletTokenWatchlist';

type MemoSignerBundle = {
  signer: JsonRpcSigner;
  cacheKey: string;
};

type CustomTokenKind = Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;

type UseTradeCustomTokenInfoLoaderArgs = {
  enabled?: boolean;
  chainId: number | null;
  getMemoSignerRef: MutableRefObject<() => Promise<MemoSignerBundle>>;
  hasAesReady: boolean;
  normalizedTradeOfferCustomTokenAddress: string;
  normalizedTradeRequestCustomTokenAddress: string;
  setCustomTradeTokenInfoByAddress: Dispatch<SetStateAction<Record<string, TradeCustomTokenInfo>>>;
  setSessionOnboardInfo: Dispatch<SetStateAction<Record<string, OnboardInfo>>>;
  walletBalanceRefreshNonce: number;
  tradeCustomOfferTokenKind: CustomTokenKind;
  tradeCustomRequestTokenKind: CustomTokenKind;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeRequestTokenSelection: TradeTokenPresetKey;
  walletAddress: string;
  watchedTokens?: readonly WalletWatchedToken[];
};

const EMPTY_WATCHED_TOKENS: readonly WalletWatchedToken[] = [];

export default function useTradeCustomTokenInfoLoader({
  enabled = true,
  chainId,
  getMemoSignerRef,
  hasAesReady,
  normalizedTradeOfferCustomTokenAddress,
  normalizedTradeRequestCustomTokenAddress,
  setCustomTradeTokenInfoByAddress,
  setSessionOnboardInfo,
  walletBalanceRefreshNonce,
  tradeCustomOfferTokenKind,
  tradeCustomRequestTokenKind,
  tradeOfferTokenSelection,
  tradeRequestTokenSelection,
  walletAddress,
  watchedTokens = EMPTY_WATCHED_TOKENS
}: UseTradeCustomTokenInfoLoaderArgs) {
  useEffect(() => {
    if (!enabled) {
      setCustomTradeTokenInfoByAddress(previous => Object.keys(previous).length ? {} : previous);
      return;
    }
    const verifiedTokenRequests =
      walletAddress.trim() && chainId === COTI_NETWORK.chainIdDecimal
        ? VERIFIED_ECOSYSTEM_TOKENS.map((token) => ({
            key: buildTradeCustomTokenInfoKey(token.kind, token.address),
            address: token.address.trim().toLowerCase(),
            kind: token.kind
          }))
        : [];
    const customTokenRequests = Array.from(
      new Map(
        [
          ...verifiedTokenRequests,
          ...watchedTokens
            .filter((token) => token.chainId === chainId)
            .map((token) => ({
              key: buildTradeCustomTokenInfoKey(token.kind, token.tokenAddress),
              address: token.tokenAddress.trim().toLowerCase(),
              kind: token.kind
            })),
          isCustomTradeTokenSelection(tradeOfferTokenSelection) && isWalletAddress(normalizedTradeOfferCustomTokenAddress)
            ? {
                key: buildTradeCustomTokenInfoKey(tradeCustomOfferTokenKind, normalizedTradeOfferCustomTokenAddress),
                address: normalizedTradeOfferCustomTokenAddress.trim().toLowerCase(),
                kind: tradeCustomOfferTokenKind
              }
            : null,
          isWalletAddress(tradeOfferTokenSelection)
            ? {
                key: buildTradeCustomTokenInfoKey(
                  getVerifiedEcosystemToken(tradeOfferTokenSelection)?.kind ?? 'erc20',
                  tradeOfferTokenSelection
                ),
                address: tradeOfferTokenSelection.trim().toLowerCase(),
                kind: getVerifiedEcosystemToken(tradeOfferTokenSelection)?.kind ?? 'erc20'
              }
            : null,
          isCustomTradeTokenSelection(tradeRequestTokenSelection) && isWalletAddress(normalizedTradeRequestCustomTokenAddress)
            ? {
                key: buildTradeCustomTokenInfoKey(tradeCustomRequestTokenKind, normalizedTradeRequestCustomTokenAddress),
                address: normalizedTradeRequestCustomTokenAddress.trim().toLowerCase(),
                kind: tradeCustomRequestTokenKind
              }
            : null,
          isWalletAddress(tradeRequestTokenSelection)
            ? {
                key: buildTradeCustomTokenInfoKey(
                  getVerifiedEcosystemToken(tradeRequestTokenSelection)?.kind ?? 'erc20',
                  tradeRequestTokenSelection
                ),
                address: tradeRequestTokenSelection.trim().toLowerCase(),
                kind: getVerifiedEcosystemToken(tradeRequestTokenSelection)?.kind ?? 'erc20'
              }
            : null
        ]
          .filter(
            (
              entry
            ): entry is {
              key: string;
              address: string;
              kind: CustomTokenKind;
            } => entry !== null
          )
          .map((entry) => [entry.key, entry] as const)
      ).values()
    );

    if (customTokenRequests.length === 0) {
      return;
    }

    let cancelled = false;

    setCustomTradeTokenInfoByAddress((previous) => {
      const next = { ...previous };
      const walletKey = walletAddress.trim().toLowerCase();
      for (const request of customTokenRequests) {
        const previousEntry = previous[request.key];
        const fallbackTokenSymbol = getVerifiedEcosystemToken(request.address)?.symbol ?? shortenAddress(request.address);
        next[request.key] = {
          kind: request.kind,
          address: request.address,
          symbol: (() => {
            const previousSymbol = previousEntry?.symbol?.trim();
            return previousSymbol && previousSymbol !== shortenAddress(request.address)
              ? previousSymbol
              : fallbackTokenSymbol;
          })(),
          decimals: previousEntry?.decimals ?? FALLBACK_REWARD_TOKEN_DECIMALS,
          balanceWei: request.kind === 'private-erc20' ? null : previousEntry?.balanceWei ?? null,
          loading: true,
          walletKey,
          aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
          privateBalanceState: request.kind === 'private-erc20' ? { status: 'locked' } : undefined,
          error: undefined
        };
      }
      return next;
    });

    const loadCustomTokens = async () => {
      const cotiEthers = await loadCotiEthersModule();
      if (cancelled) return;
      const readProvider = await loadCotiReadProvider(true);
      if (cancelled) return;
      const walletKey = walletAddress.trim().toLowerCase();
      const signerBundle =
        walletKey && hasAesReady && customTokenRequests.some((request) => request.kind === 'private-erc20')
          ? await getMemoSignerRef.current()
              .then((result) => result)
              .catch(() => null)
          : null;
      if (cancelled) return;
      const nextEntries = await Promise.all(
        customTokenRequests.map(async (request) => {
          const fallbackTokenSymbol = getVerifiedEcosystemToken(request.address)?.symbol ?? shortenAddress(request.address);
          try {
            const tokenAbi = request.kind === 'private-erc20' ? PRIVATE_ERC20_TOKEN_VNEXT_ABI : ERC20_TOKEN_ABI;
            const tokenContract = new cotiEthers.Contract(request.address, tokenAbi, readProvider);
            const [symbolRaw, decimalsRaw] = await Promise.all([
              tokenContract.symbol().catch(() => null),
              tokenContract.decimals().catch(() => null)
            ]);
            let balanceWei: bigint | null = null;
            let error: string | undefined;

            if (walletKey && !cancelled) {
              if (request.kind === 'private-erc20') {
                if (!signerBundle) {
                  error = 'Unlock privacy to read this private token balance.';
                } else {
                  balanceWei = await readCurrentPrivateErc20BalanceWei(
                    request.address,
                    walletAddress,
                    signerBundle.signer
                  ).catch(() => null);
                }
              } else {
                balanceWei = await tokenContract.balanceOf(walletAddress).catch(() => null);
              }
            }

            return {
              kind: request.kind,
              address: request.address,
              symbol:
                typeof symbolRaw === 'string' && symbolRaw.trim().length > 0
                  ? symbolRaw.trim().slice(0, 24)
                  : fallbackTokenSymbol,
              decimals: normalizeTokenDecimals(Number(decimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)),
              balanceWei: typeof balanceWei === 'bigint' ? balanceWei : null,
              loading: false,
              walletKey,
              aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
              privateBalanceState:
                request.kind === 'private-erc20'
                  ? typeof balanceWei === 'bigint'
                    ? { status: 'ready', balanceWei }
                    : signerBundle
                      ? { status: 'decrypt-failed' }
                      : { status: 'locked' }
                  : undefined,
              error
            } satisfies TradeCustomTokenInfo;
          } catch {
            return {
              kind: request.kind,
              address: request.address,
              symbol: fallbackTokenSymbol,
              decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
              balanceWei: null,
              loading: false,
              walletKey,
              aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
              privateBalanceState: request.kind === 'private-erc20' ? { status: 'unsupported' } : undefined,
              error: 'Unable to load token metadata.'
            } satisfies TradeCustomTokenInfo;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setCustomTradeTokenInfoByAddress((previous) => {
        const next = { ...previous };
        for (const entry of nextEntries) {
          next[buildTradeCustomTokenInfoKey(entry.kind, entry.address)] = entry;
        }
        return next;
      });

      if (signerBundle) {
        const nextOnboardInfo = signerBundle.signer.getUserOnboardInfo();
        setSessionOnboardInfo((previous) => ({
          ...previous,
          [signerBundle.cacheKey]: mergeOnboardInfo(previous[signerBundle.cacheKey], nextOnboardInfo)
        }));
      }
    };

    loadCustomTokens().catch(() => {
      if (cancelled) {
        return;
      }
      setCustomTradeTokenInfoByAddress((previous) => {
        const next = { ...previous };
        const walletKey = walletAddress.trim().toLowerCase();
        for (const request of customTokenRequests) {
          const fallbackTokenSymbol = getVerifiedEcosystemToken(request.address)?.symbol ?? shortenAddress(request.address);
          next[request.key] = {
            kind: request.kind,
            address: request.address,
            symbol: fallbackTokenSymbol,
            decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
            balanceWei: null,
            loading: false,
            walletKey,
            aesReady: request.kind === 'private-erc20' ? hasAesReady : undefined,
            privateBalanceState: request.kind === 'private-erc20' ? { status: 'unsupported' } : undefined,
            error: 'Unable to load token metadata.'
          };
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    chainId,
    getMemoSignerRef,
    hasAesReady,
    normalizedTradeOfferCustomTokenAddress,
    normalizedTradeRequestCustomTokenAddress,
    setCustomTradeTokenInfoByAddress,
    setSessionOnboardInfo,
    walletBalanceRefreshNonce,
    tradeCustomOfferTokenKind,
    tradeCustomRequestTokenKind,
    tradeOfferTokenSelection,
    tradeRequestTokenSelection,
    walletAddress,
    watchedTokens
  ]);
}
