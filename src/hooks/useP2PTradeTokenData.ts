import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  ERC20_TOKEN_ABI,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  PRIVATE_ERC20_TOKEN_VNEXT_ABI,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  normalizeTokenDecimals,
  shortenAddress,
  type TradeAssetPayload
} from '../lib/appShared';
import {
  readOtcEscrowFeeAmount,
  resolveOtcFeeEscrowContractConfig,
  readCurrentPrivateErc20BalanceWei,
  readPrivateTokenAccountEncryptionAddress
} from '../lib/appChain';
import {
  VERIFIED_ECOSYSTEM_TOKENS,
  buildTradeCustomTokenInfoKey,
  getVerifiedEcosystemToken,
  resolveTradePresetKind,
  type PrivateTokenBalanceState,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import { getWalletTransactionFlowState } from '../lib/walletTransactionFlow';

type TradeSigner = JsonRpcSigner | Wallet;
type TradeTokenKind = Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;
type TradeTokenInfoRequest = {
  address: string;
  kind: TradeTokenKind;
};

type ReloadPrivateBalancesResult = {
  failedTokenAddresses: string[];
  readyTokenAddresses: string[];
};

const shouldHoldBalanceReadForWalletFlow = (silent: boolean): boolean => {
  const flowState = getWalletTransactionFlowState();
  return flowState === 'memory-active' || (flowState === 'stored-handoff' && silent);
};

export type WalletBalanceRefreshReason =
  | 'connect'
  | 'focus'
  | 'interval'
  | 'unlock'
  | 'trade-action'
  | 'manual';

export type WalletBalanceRefreshOptions = {
  reason?: WalletBalanceRefreshReason;
  silent?: boolean;
  signer?: TradeSigner;
};

type UseP2PTradeTokenDataArgs = {
  balanceRefreshSessionKey: string;
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  tradeOfferCustomTokenAddress: string;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeRequestCustomTokenAddress: string;
  tradeRequestTokenSelection: TradeTokenPresetKey;
  tradeFeeEscrowContract: string;
  walletAddress: string;
  walletHasAes: boolean;
  walletKey: string;
};

const LOCKED_PRIVATE_BALANCE_STATE: PrivateTokenBalanceState = { status: 'locked' };

export const resolveBalanceWeiAfterRefresh = (
  previous: bigint | null,
  next: bigint | null,
  silent: boolean
): bigint | null => (next !== null ? next : silent ? previous : null);

export const resolvePrivateBalanceStateAfterRefresh = (
  previous: PrivateTokenBalanceState,
  next: PrivateTokenBalanceState
): PrivateTokenBalanceState => {
  return next.status !== 'ready' && previous.status === 'ready' ? previous : next;
};

export const resolvePrivateBalanceWeiAfterRefresh = (
  previous: bigint | null,
  next: PrivateTokenBalanceState
): bigint | null => {
  if (next.status === 'ready') {
    return next.balanceWei;
  }
  return previous;
};

export const resolvePrivateBalanceAesReady = ({
  signer,
  walletHasAes
}: {
  signer?: TradeSigner;
  walletHasAes: boolean;
}): boolean => walletHasAes || Boolean(signer);

export const shouldRefreshPrivateTokenInfoForWallet = ({
  tokenKind,
  existing,
  walletHasAes
}: {
  tokenKind: TradeTokenKind;
  existing?: Pick<TradeCustomTokenInfo, 'aesReady' | 'loading'>;
  walletHasAes: boolean;
}): boolean =>
  tokenKind === 'private-erc20' &&
  !existing?.loading &&
  Boolean(existing?.aesReady) !== walletHasAes;

type UseP2PTradeTokenDataResult = {
  clearWalletBalances: () => void;
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  loadWalletBalances: () => Promise<void>;
  nativeBalanceWei: bigint | null;
  privateRewardTokenBalanceState: PrivateTokenBalanceState;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  reloadPrivateBalancesWithUnlockedSigner: (signer: TradeSigner) => Promise<ReloadPrivateBalancesResult>;
  refreshWalletBalances: (options?: WalletBalanceRefreshOptions) => Promise<void>;
  refreshCurrentPrivateTokenInfos: () => Promise<void>;
  resolveRequiredFeeForTradeCreate: (escrowContract?: string | null) => Promise<bigint>;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  tradeRequiredFeeWei: bigint | null;
};

export default function useP2PTradeTokenData({
  balanceRefreshSessionKey,
  getTradeSigner,
  tradeOfferCustomTokenAddress,
  tradeOfferTokenSelection,
  tradeRequestCustomTokenAddress,
  tradeRequestTokenSelection,
  tradeFeeEscrowContract,
  walletAddress,
  walletHasAes,
  walletKey
}: UseP2PTradeTokenDataArgs): UseP2PTradeTokenDataResult {
  const [customTradeTokenInfoByAddress, setCustomTradeTokenInfoByAddress] = useState<Record<string, TradeCustomTokenInfo>>({});
  const [nativeBalanceWei, setNativeBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenBalanceWei, setRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [privateRewardTokenBalanceWei, setPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [privateRewardTokenBalanceState, setPrivateRewardTokenBalanceState] =
    useState<PrivateTokenBalanceState>(LOCKED_PRIVATE_BALANCE_STATE);
  const [rewardTokenSymbol, setRewardTokenSymbol] = useState(FALLBACK_REWARD_TOKEN_SYMBOL);
  const [privateRewardTokenSymbol, setPrivateRewardTokenSymbol] = useState(FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL);
  const [rewardTokenDecimals, setRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [privateRewardTokenDecimals, setPrivateRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [tradeRequiredFeeWeiByEscrow, setTradeRequiredFeeWeiByEscrow] = useState<Record<string, bigint>>({});
  const feeRequestRef = useRef<Record<string, Promise<bigint>>>({});
  const balanceRefreshRef = useRef<Promise<void> | null>(null);
  const balanceRefreshQueuedRef = useRef<WalletBalanceRefreshOptions | null>(null);
  const latestWalletKeyRef = useRef(walletKey);
  const latestBalanceRefreshSessionKeyRef = useRef(balanceRefreshSessionKey);
  useEffect(() => {
    latestWalletKeyRef.current = walletKey;
  }, [walletKey]);
  useEffect(() => {
    latestBalanceRefreshSessionKeyRef.current = balanceRefreshSessionKey;
  }, [balanceRefreshSessionKey]);

  const clearWalletBalances = useCallback(() => {
    setNativeBalanceWei(null);
    setRewardTokenBalanceWei(null);
    setPrivateRewardTokenBalanceWei(null);
    setPrivateRewardTokenBalanceState(LOCKED_PRIVATE_BALANCE_STATE);
    setCustomTradeTokenInfoByAddress({});
  }, []);

  const activeFeeEscrowConfig = resolveOtcFeeEscrowContractConfig(tradeFeeEscrowContract);
  const activeFeeEscrowKey = activeFeeEscrowConfig.address.toLowerCase();
  const tradeRequiredFeeWei = tradeRequiredFeeWeiByEscrow[activeFeeEscrowKey] ?? null;

  const resolveRequiredFeeForTradeCreate = useCallback(
    async (escrowContract?: string | null): Promise<bigint> => {
      const config = resolveOtcFeeEscrowContractConfig(escrowContract ?? tradeFeeEscrowContract);
      const feeKey = config.address.toLowerCase();
      const cachedFee = tradeRequiredFeeWeiByEscrow[feeKey];
      if (cachedFee !== undefined) {
        return cachedFee;
      }

      if (!feeRequestRef.current[feeKey]) {
        feeRequestRef.current[feeKey] = readOtcEscrowFeeAmount(config.address);
      }

      try {
        const fee = await feeRequestRef.current[feeKey];
        setTradeRequiredFeeWeiByEscrow((previous) => ({ ...previous, [feeKey]: fee }));
        return fee;
      } finally {
        delete feeRequestRef.current[feeKey];
      }
    },
    [tradeFeeEscrowContract, tradeRequiredFeeWeiByEscrow]
  );

  const resolveCurrentPrivateTokenRequests = useCallback((): TradeTokenInfoRequest[] => {
    const tokensByKey = new Map<string, TradeTokenInfoRequest>();
    tokensByKey.set(buildTradeCustomTokenInfoKey('private-erc20', PRIVATE_REWARD_TOKEN_ADDRESS), {
      address: PRIVATE_REWARD_TOKEN_ADDRESS,
      kind: 'private-erc20'
    });
    for (const token of VERIFIED_ECOSYSTEM_TOKENS) {
      if (token.kind === 'private-erc20') {
        tokensByKey.set(buildTradeCustomTokenInfoKey(token.kind, token.address), {
          address: token.address,
          kind: 'private-erc20'
        });
      }
    }

    const requestedTokens = [
      {
        address: tradeOfferCustomTokenAddress,
        kind: resolveTradePresetKind(tradeOfferTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20'
      },
      {
        address: tradeRequestCustomTokenAddress,
        kind: resolveTradePresetKind(tradeRequestTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20'
      }
    ].filter(
      (token): token is TradeTokenInfoRequest =>
        token.kind === 'private-erc20' && Boolean(token.address.trim()) && isWalletAddress(token.address.trim())
    );

    for (const token of requestedTokens) {
      tokensByKey.set(buildTradeCustomTokenInfoKey(token.kind, token.address), token);
    }

    return Array.from(tokensByKey.values());
  }, [
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection
  ]);

  const readCurrentPrivateBalanceState = useCallback(
    async (
      tokenAddress: string,
      signer: TradeSigner,
      options?: { aesReady?: boolean }
    ): Promise<PrivateTokenBalanceState> => {
      const aesReady = options?.aesReady ?? walletHasAes;
      if (!walletAddress || !aesReady || !isWalletAddress(tokenAddress)) {
        return { status: 'locked' };
      }

      const encryptionAddress = await readPrivateTokenAccountEncryptionAddress(tokenAddress, walletAddress).catch(
        () => null
      );
      if (!encryptionAddress || encryptionAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return { status: 'setup-needed' };
      }

      const balanceWei = await readCurrentPrivateErc20BalanceWei(tokenAddress, walletAddress, signer).catch(
        () => null
      );
      return balanceWei === null ? { status: 'decrypt-failed' } : { status: 'ready', balanceWei };
    },
    [walletAddress, walletHasAes]
  );

  const loadPrimaryWalletBalances = useCallback(async (options?: WalletBalanceRefreshOptions) => {
    const silent = Boolean(options?.silent);
    const requestWalletKey = walletKey;
    const requestSessionKey = balanceRefreshSessionKey;
    const readProvider = await loadCotiReadProvider(true);
    const cotiEthers = await loadCotiEthersModule();
    const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
    const privateTokenContract = new cotiEthers.Contract(PRIVATE_REWARD_TOKEN_ADDRESS, PRIVATE_ERC20_TOKEN_VNEXT_ABI, readProvider);

    const [rewardSymbolRaw, rewardDecimalsRaw, privateSymbolRaw, privateDecimalsRaw] = await Promise.all([
      rewardTokenContract.symbol().catch(() => null),
      rewardTokenContract.decimals().catch(() => null),
      privateTokenContract.symbol().catch(() => null),
      privateTokenContract.decimals().catch(() => null)
    ]);

    setRewardTokenSymbol(
      typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim() ? rewardSymbolRaw.trim().slice(0, 12) : FALLBACK_REWARD_TOKEN_SYMBOL
    );
    setPrivateRewardTokenSymbol(
      typeof privateSymbolRaw === 'string' && privateSymbolRaw.trim()
        ? privateSymbolRaw.trim().slice(0, 12)
        : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL
    );
    setRewardTokenDecimals(normalizeTokenDecimals(Number(rewardDecimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)));
    setPrivateRewardTokenDecimals(normalizeTokenDecimals(Number(privateDecimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)));

    if (latestWalletKeyRef.current !== requestWalletKey) {
      return;
    }
    if (latestBalanceRefreshSessionKeyRef.current !== requestSessionKey) {
      return;
    }

    if (!walletAddress || !isWalletAddress(walletAddress)) {
      clearWalletBalances();
      return;
    }

    const [nativeBalanceRaw, rewardBalanceRaw] = await Promise.all([
      readProvider.getBalance(walletAddress).catch(() => null),
      rewardTokenContract.balanceOf(walletAddress).catch(() => null)
    ]);
    setNativeBalanceWei((previous) =>
      resolveBalanceWeiAfterRefresh(previous, typeof nativeBalanceRaw === 'bigint' ? nativeBalanceRaw : null, silent)
    );
    setRewardTokenBalanceWei((previous) =>
      resolveBalanceWeiAfterRefresh(previous, typeof rewardBalanceRaw === 'bigint' ? rewardBalanceRaw : null, silent)
    );

    if (latestWalletKeyRef.current !== requestWalletKey) {
      return;
    }
    if (latestBalanceRefreshSessionKeyRef.current !== requestSessionKey) {
      return;
    }

    const aesReady = resolvePrivateBalanceAesReady({
      signer: options?.signer,
      walletHasAes
    });
    if (aesReady) {
      const signer = options?.signer ?? (await getTradeSigner(false).catch(() => null));
      const privateBalanceState =
        signer !== null
          ? await readCurrentPrivateBalanceState(PRIVATE_REWARD_TOKEN_ADDRESS, signer)
          : { status: 'locked' as const };
      setPrivateRewardTokenBalanceState((previous) =>
        resolvePrivateBalanceStateAfterRefresh(previous, privateBalanceState)
      );
      setPrivateRewardTokenBalanceWei((previous) =>
        resolvePrivateBalanceWeiAfterRefresh(previous, privateBalanceState)
      );
    } else if (!silent) {
      setPrivateRewardTokenBalanceState((previous) =>
        previous.status === 'ready' ? previous : { status: 'locked' }
      );
      setPrivateRewardTokenBalanceWei((previous) => previous);
    }
  }, [
    balanceRefreshSessionKey,
    clearWalletBalances,
    getTradeSigner,
    readCurrentPrivateBalanceState,
    walletAddress,
    walletHasAes,
    walletKey
  ]);

  const loadCustomTokenInfo = useCallback(
    async (token: TradeTokenInfoRequest, options?: { aesReady?: boolean; signer?: TradeSigner; silent?: boolean }) => {
      const normalizedAddress = token.address.trim();
      if (!isWalletAddress(normalizedAddress)) {
        return;
      }
      const requestWalletKey = walletKey;
      const requestSessionKey = balanceRefreshSessionKey;
      const aesReady = options?.aesReady ?? walletHasAes;
      if (latestWalletKeyRef.current !== requestWalletKey) {
        return;
      }
      if (latestBalanceRefreshSessionKeyRef.current !== requestSessionKey) {
        return;
      }
      const silent = Boolean(options?.silent);

      const tokenKey = buildTradeCustomTokenInfoKey(token.kind, normalizedAddress);
      const verifiedTokenSymbol = getVerifiedEcosystemToken(normalizedAddress)?.symbol;
      const fallbackTokenSymbol = verifiedTokenSymbol ?? shortenAddress(normalizedAddress);
      if (!silent) {
        setCustomTradeTokenInfoByAddress((previous) => ({
          ...previous,
          [tokenKey]: {
            kind: token.kind,
            address: normalizedAddress,
            symbol: (() => {
              const previousSymbol = previous[tokenKey]?.symbol?.trim();
              return previousSymbol && previousSymbol !== shortenAddress(normalizedAddress)
                ? previousSymbol
                : fallbackTokenSymbol;
            })(),
            decimals: previous[tokenKey]?.decimals ?? FALLBACK_REWARD_TOKEN_DECIMALS,
            balanceWei: previous[tokenKey]?.balanceWei ?? null,
            loading: true,
            walletKey,
            aesReady:
              token.kind === 'private-erc20'
                ? aesReady || previous[tokenKey]?.privateBalanceState?.status === 'ready'
                : undefined,
            privateBalanceState:
              token.kind === 'private-erc20'
                ? previous[tokenKey]?.privateBalanceState?.status === 'ready'
                  ? previous[tokenKey]?.privateBalanceState
                  : aesReady
                    ? { status: 'setup-pending' }
                    : { status: 'locked' }
                : undefined
          }
        }));
      }

      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const tokenAbi = token.kind === 'private-erc20' ? PRIVATE_ERC20_TOKEN_VNEXT_ABI : ERC20_TOKEN_ABI;
        const tokenContract = new cotiEthers.Contract(normalizedAddress, tokenAbi, readProvider);
        const [symbolRaw, decimalsRaw] = await Promise.all([
          tokenContract.symbol().catch(() => null),
          tokenContract.decimals().catch(() => null)
        ]);
        const symbol =
          typeof symbolRaw === 'string' && symbolRaw.trim() ? symbolRaw.trim().slice(0, 16) : fallbackTokenSymbol;
        const decimals =
          typeof decimalsRaw === 'number' || typeof decimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(decimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        let balanceWei: bigint | null = null;
        let privateBalanceState: PrivateTokenBalanceState | undefined;
        if (walletAddress) {
          if (token.kind === 'private-erc20') {
            const signer = options?.signer ?? (aesReady ? await getTradeSigner(false).catch(() => null) : null);
            privateBalanceState =
              signer !== null
                ? await readCurrentPrivateBalanceState(normalizedAddress, signer, { aesReady })
                : { status: 'locked' };
            balanceWei = privateBalanceState.status === 'ready' ? privateBalanceState.balanceWei : null;
          } else {
            const rawBalance = await tokenContract.balanceOf(walletAddress).catch(() => null);
            balanceWei = typeof rawBalance === 'bigint' ? rawBalance : null;
          }
        }

        if (latestWalletKeyRef.current !== requestWalletKey) {
          return;
        }
        if (latestBalanceRefreshSessionKeyRef.current !== requestSessionKey) {
          return;
        }

        setCustomTradeTokenInfoByAddress((previous) => {
          const previousEntry = previous[tokenKey];
          const nextPrivateBalanceState =
            token.kind === 'private-erc20' && privateBalanceState
              ? resolvePrivateBalanceStateAfterRefresh(
                  previousEntry?.privateBalanceState ?? LOCKED_PRIVATE_BALANCE_STATE,
                  privateBalanceState
                )
              : privateBalanceState;
          return {
            ...previous,
            [tokenKey]: {
              kind: token.kind,
              address: normalizedAddress,
              symbol,
              decimals,
              balanceWei:
                token.kind === 'private-erc20' && nextPrivateBalanceState
                  ? resolvePrivateBalanceWeiAfterRefresh(previousEntry?.balanceWei ?? null, nextPrivateBalanceState)
                  : resolveBalanceWeiAfterRefresh(previousEntry?.balanceWei ?? null, balanceWei, silent),
              loading: false,
              walletKey,
              aesReady:
                token.kind === 'private-erc20'
                  ? aesReady || nextPrivateBalanceState?.status === 'ready'
                  : undefined,
              privateBalanceState: nextPrivateBalanceState
            }
          };
        });
      } catch {
        if (latestWalletKeyRef.current !== requestWalletKey) {
          return;
        }
        if (latestBalanceRefreshSessionKeyRef.current !== requestSessionKey) {
          return;
        }
        if (silent) {
          return;
        }
        setCustomTradeTokenInfoByAddress((previous) => {
          const previousEntry = previous[tokenKey];
          if (token.kind === 'private-erc20' && previousEntry?.privateBalanceState?.status === 'ready') {
            return {
              ...previous,
              [tokenKey]: {
                ...previousEntry,
                aesReady: true,
                error: 'Unable to refresh token.',
                loading: false,
                walletKey
              }
            };
          }
          return {
            ...previous,
            [tokenKey]: {
              kind: token.kind,
              address: normalizedAddress,
              symbol: fallbackTokenSymbol,
              decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
              balanceWei: null,
              loading: false,
              error: 'Unable to load token.',
              walletKey,
              aesReady: token.kind === 'private-erc20' ? aesReady : undefined,
              privateBalanceState: token.kind === 'private-erc20' ? { status: 'unsupported' } : undefined
            }
          };
        });
      }
    },
    [balanceRefreshSessionKey, getTradeSigner, readCurrentPrivateBalanceState, walletAddress, walletHasAes, walletKey]
  );

  const reloadPrivateBalancesWithUnlockedSigner = useCallback(
    async (signer: TradeSigner): Promise<ReloadPrivateBalancesResult> => {
      const requestWalletKey = walletKey;
      if (!walletAddress || !isWalletAddress(walletAddress)) {
        return { failedTokenAddresses: [], readyTokenAddresses: [] };
      }

      const tokens = resolveCurrentPrivateTokenRequests();
      const cotiEthers = await loadCotiEthersModule();
      const readProvider = await loadCotiReadProvider(true);
      const tokenResults = await Promise.all(
        tokens.map(async (token) => {
          const normalizedAddress = token.address.trim();
          const fallbackTokenSymbol = getVerifiedEcosystemToken(normalizedAddress)?.symbol ?? shortenAddress(normalizedAddress);
          const tokenContract = new cotiEthers.Contract(normalizedAddress, PRIVATE_ERC20_TOKEN_VNEXT_ABI, readProvider);
          const [symbolRaw, decimalsRaw] = await Promise.all([
            tokenContract.symbol().catch(() => null),
            tokenContract.decimals().catch(() => null)
          ]);
          const symbol =
            typeof symbolRaw === 'string' && symbolRaw.trim()
              ? symbolRaw.trim().slice(0, 16)
              : fallbackTokenSymbol;
          const decimals =
            typeof decimalsRaw === 'number' || typeof decimalsRaw === 'bigint'
              ? normalizeTokenDecimals(Number(decimalsRaw))
              : FALLBACK_REWARD_TOKEN_DECIMALS;
          const privateBalanceState = await readCurrentPrivateBalanceState(normalizedAddress, signer, {
            aesReady: true
          }).catch((): PrivateTokenBalanceState => ({ status: 'unsupported' }));
          return {
            address: normalizedAddress,
            balanceWei: privateBalanceState.status === 'ready' ? privateBalanceState.balanceWei : null,
            decimals,
            privateBalanceState,
            symbol
          };
        })
      );

      if (latestWalletKeyRef.current !== requestWalletKey) {
        return { failedTokenAddresses: [], readyTokenAddresses: [] };
      }

      setCustomTradeTokenInfoByAddress((previous) => {
        const next = { ...previous };
        for (const result of tokenResults) {
          const tokenKey = buildTradeCustomTokenInfoKey('private-erc20', result.address);
          next[tokenKey] = {
            kind: 'private-erc20',
            address: result.address,
            symbol: result.symbol,
            decimals: result.decimals,
            balanceWei: result.balanceWei,
            loading: false,
            walletKey,
            aesReady: true,
            privateBalanceState: result.privateBalanceState
          };
        }
        return next;
      });

      const privateRewardResult = tokenResults.find(
        (result) => result.address.toLowerCase() === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()
      );
      if (privateRewardResult) {
        setPrivateRewardTokenSymbol(privateRewardResult.symbol);
        setPrivateRewardTokenDecimals(privateRewardResult.decimals);
        setPrivateRewardTokenBalanceState((previous) =>
          resolvePrivateBalanceStateAfterRefresh(previous, privateRewardResult.privateBalanceState)
        );
        setPrivateRewardTokenBalanceWei((previous) =>
          resolvePrivateBalanceWeiAfterRefresh(previous, privateRewardResult.privateBalanceState)
        );
      }

      return {
        failedTokenAddresses: tokenResults
          .filter((result) => result.privateBalanceState.status === 'decrypt-failed')
          .map((result) => result.address),
        readyTokenAddresses: tokenResults
          .filter((result) => result.privateBalanceState.status === 'ready')
          .map((result) => result.address)
      };
    },
    [readCurrentPrivateBalanceState, resolveCurrentPrivateTokenRequests, walletAddress, walletKey]
  );

  const refreshWalletBalances = useCallback(
    async (options?: WalletBalanceRefreshOptions): Promise<void> => {
      if (shouldHoldBalanceReadForWalletFlow(Boolean(options?.silent))) {
        return;
      }
      if (balanceRefreshRef.current) {
        balanceRefreshQueuedRef.current = {
          ...(balanceRefreshQueuedRef.current ?? {}),
          ...(options ?? {}),
          silent: Boolean(balanceRefreshQueuedRef.current?.silent ?? options?.silent)
        };
        return balanceRefreshRef.current;
      }

      const refreshRequest = (async () => {
        let nextOptions: WalletBalanceRefreshOptions | undefined = options;
        do {
          const currentOptions = nextOptions;
          balanceRefreshQueuedRef.current = null;
          await loadPrimaryWalletBalances(currentOptions);
          const privateTokenRequests = resolveCurrentPrivateTokenRequests();
          await Promise.all(
            privateTokenRequests.map((token) =>
              loadCustomTokenInfo(token, {
                aesReady: resolvePrivateBalanceAesReady({
                  signer: currentOptions?.signer,
                  walletHasAes
                }),
                signer: currentOptions?.signer,
                silent: Boolean(currentOptions?.silent)
              }).catch(() => {})
            )
          );
          nextOptions = balanceRefreshQueuedRef.current ?? undefined;
        } while (nextOptions);
      })();

      balanceRefreshRef.current = refreshRequest;
      try {
        await refreshRequest;
      } finally {
        if (balanceRefreshRef.current === refreshRequest) {
          balanceRefreshRef.current = null;
        }
      }
    },
    [loadCustomTokenInfo, loadPrimaryWalletBalances, resolveCurrentPrivateTokenRequests, walletHasAes]
  );

  const loadWalletBalances = useCallback(
    async (): Promise<void> => refreshWalletBalances({ reason: 'manual' }),
    [refreshWalletBalances]
  );

  useEffect(() => {
    resolveRequiredFeeForTradeCreate().catch(() => {});
  }, [resolveRequiredFeeForTradeCreate]);

  useEffect(() => {
    clearWalletBalances();
  }, [clearWalletBalances, walletKey]);

  useEffect(() => {
    if (shouldHoldBalanceReadForWalletFlow(false)) {
      return;
    }
    refreshWalletBalances({ reason: 'connect', silent: false }).catch(() => {});
  }, [refreshWalletBalances]);

  useEffect(() => {
    if (getWalletTransactionFlowState() === 'memory-active') {
      return;
    }
    const requestedTokens = [
      {
        address: tradeOfferCustomTokenAddress,
        kind: resolveTradePresetKind(tradeOfferTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20'
      },
      {
        address: tradeRequestCustomTokenAddress,
        kind: resolveTradePresetKind(tradeRequestTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20'
      }
    ].filter(
      (token): token is TradeTokenInfoRequest => Boolean(token.address.trim()) && isWalletAddress(token.address.trim())
    );

    for (const token of requestedTokens) {
      const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
      const existing = customTradeTokenInfoByAddress[key];
      const shouldRefreshPrivateBalance = shouldRefreshPrivateTokenInfoForWallet({
        tokenKind: token.kind,
        existing,
        walletHasAes
      });
      if (!existing || existing.walletKey !== walletKey || shouldRefreshPrivateBalance) {
        loadCustomTokenInfo(token, { silent: false }).catch(() => {});
      }
    }
  }, [
    customTradeTokenInfoByAddress,
    loadCustomTokenInfo,
    tradeOfferCustomTokenAddress,
    tradeOfferTokenSelection,
    tradeRequestCustomTokenAddress,
    tradeRequestTokenSelection,
    walletHasAes,
    walletKey
  ]);

  useEffect(() => {
    if (getWalletTransactionFlowState() === 'memory-active') {
      return;
    }
    for (const token of VERIFIED_ECOSYSTEM_TOKENS) {
      const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
      const existing = customTradeTokenInfoByAddress[key];
      const shouldRefreshPrivateBalance = shouldRefreshPrivateTokenInfoForWallet({
        tokenKind: token.kind,
        existing,
        walletHasAes
      });
      if (!existing || existing.walletKey !== walletKey || shouldRefreshPrivateBalance) {
        loadCustomTokenInfo(token, { silent: false }).catch(() => {});
      }
    }
  }, [customTradeTokenInfoByAddress, loadCustomTokenInfo, walletHasAes, walletKey]);

  const refreshCurrentPrivateTokenInfos = useCallback(async () => {
    await Promise.all(
      resolveCurrentPrivateTokenRequests().map((token) => loadCustomTokenInfo(token, { silent: true }).catch(() => {}))
    );
  }, [loadCustomTokenInfo, resolveCurrentPrivateTokenRequests]);

  return {
    clearWalletBalances,
    customTradeTokenInfoByAddress,
    loadWalletBalances,
    nativeBalanceWei,
    privateRewardTokenBalanceState,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    reloadPrivateBalancesWithUnlockedSigner,
    refreshWalletBalances,
    refreshCurrentPrivateTokenInfos,
    resolveRequiredFeeForTradeCreate,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    tradeRequiredFeeWei
  };
}
