import { useCallback, useEffect, useRef, useState } from 'react';
import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import {
  ERC20_TOKEN_ABI,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
  REWARD_TOKEN_ADDRESS,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  normalizeTokenDecimals,
  shortenAddress,
  type TradeAssetPayload
} from '../lib/appShared';
import { readPrivateTokenBalanceWei } from '../lib/appChain';
import {
  VERIFIED_ECOSYSTEM_TOKENS,
  buildTradeCustomTokenInfoKey,
  resolveTradePresetKind,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../lib/appHelpers';

type TradeSigner = JsonRpcSigner | Wallet;
type TradeTokenKind = Extract<TradeAssetPayload['kind'], 'erc20' | 'private-erc20'>;
type TradeTokenInfoRequest = {
  address: string;
  kind: TradeTokenKind;
};

type UseP2PTradeTokenDataArgs = {
  getTradeSigner: (requireAes: boolean) => Promise<TradeSigner>;
  tradeOfferCustomTokenAddress: string;
  tradeOfferTokenSelection: TradeTokenPresetKey;
  tradeRequestCustomTokenAddress: string;
  tradeRequestTokenSelection: TradeTokenPresetKey;
  walletAddress: string;
  walletHasAes: boolean;
  walletKey: string;
};

type UseP2PTradeTokenDataResult = {
  clearWalletBalances: () => void;
  customTradeTokenInfoByAddress: Record<string, TradeCustomTokenInfo>;
  loadWalletBalances: () => Promise<void>;
  nativeBalanceWei: bigint | null;
  privateRewardTokenBalanceWei: bigint | null;
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  resolveRequiredFeeForTradeCreate: () => Promise<bigint>;
  rewardTokenBalanceWei: bigint | null;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
  tradeRequiredFeeWei: bigint | null;
};

export default function useP2PTradeTokenData({
  getTradeSigner,
  tradeOfferCustomTokenAddress,
  tradeOfferTokenSelection,
  tradeRequestCustomTokenAddress,
  tradeRequestTokenSelection,
  walletAddress,
  walletHasAes,
  walletKey
}: UseP2PTradeTokenDataArgs): UseP2PTradeTokenDataResult {
  const [customTradeTokenInfoByAddress, setCustomTradeTokenInfoByAddress] = useState<Record<string, TradeCustomTokenInfo>>({});
  const [nativeBalanceWei, setNativeBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenBalanceWei, setRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [privateRewardTokenBalanceWei, setPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenSymbol, setRewardTokenSymbol] = useState(FALLBACK_REWARD_TOKEN_SYMBOL);
  const [privateRewardTokenSymbol, setPrivateRewardTokenSymbol] = useState(FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL);
  const [rewardTokenDecimals, setRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [privateRewardTokenDecimals, setPrivateRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [tradeRequiredFeeWei, setTradeRequiredFeeWei] = useState<bigint | null>(null);
  const feeRequestRef = useRef<Promise<bigint> | null>(null);

  const clearWalletBalances = useCallback(() => {
    setNativeBalanceWei(null);
    setRewardTokenBalanceWei(null);
    setPrivateRewardTokenBalanceWei(null);
  }, []);

  const resolveRequiredFeeForTradeCreate = useCallback(async (): Promise<bigint> => {
    if (tradeRequiredFeeWei !== null) {
      return tradeRequiredFeeWei;
    }

    if (!feeRequestRef.current) {
      feeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
        return (await readContract.feeAmount()) as bigint;
      })();
    }

    try {
      const fee = await feeRequestRef.current;
      setTradeRequiredFeeWei(fee);
      return fee;
    } finally {
      feeRequestRef.current = null;
    }
  }, [tradeRequiredFeeWei]);

  const loadWalletBalances = useCallback(async () => {
    const readProvider = await loadCotiReadProvider(true);
    const cotiEthers = await loadCotiEthersModule();
    const rewardTokenContract = new cotiEthers.Contract(REWARD_TOKEN_ADDRESS, ERC20_TOKEN_ABI, readProvider);
    const privateTokenContract = new cotiEthers.Contract(PRIVATE_REWARD_TOKEN_ADDRESS, PRIVATE_TOKEN_BALANCE_ABI, readProvider);

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

    if (!walletAddress || !isWalletAddress(walletAddress)) {
      clearWalletBalances();
      return;
    }

    const [nativeBalanceRaw, rewardBalanceRaw] = await Promise.all([
      readProvider.getBalance(walletAddress).catch(() => null),
      rewardTokenContract.balanceOf(walletAddress).catch(() => null)
    ]);
    setNativeBalanceWei(typeof nativeBalanceRaw === 'bigint' ? nativeBalanceRaw : null);
    setRewardTokenBalanceWei(typeof rewardBalanceRaw === 'bigint' ? rewardBalanceRaw : null);

    if (walletHasAes) {
      const signer = await getTradeSigner(false).catch(() => null);
      const privateBalance =
        signer !== null ? await readPrivateTokenBalanceWei(PRIVATE_REWARD_TOKEN_ADDRESS, walletAddress, signer, true).catch(() => null) : null;
      setPrivateRewardTokenBalanceWei(privateBalance);
    } else {
      setPrivateRewardTokenBalanceWei(null);
    }
  }, [clearWalletBalances, getTradeSigner, walletAddress, walletHasAes]);

  const loadCustomTokenInfo = useCallback(
    async (token: TradeTokenInfoRequest) => {
      const normalizedAddress = token.address.trim();
      if (!isWalletAddress(normalizedAddress)) {
        return;
      }

      const tokenKey = buildTradeCustomTokenInfoKey(token.kind, normalizedAddress);
      setCustomTradeTokenInfoByAddress((previous) => ({
        ...previous,
        [tokenKey]: {
          kind: token.kind,
          address: normalizedAddress,
          symbol: shortenAddress(normalizedAddress),
          decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
          balanceWei: null,
          loading: true,
          walletKey,
          aesReady: token.kind === 'private-erc20' ? walletHasAes : undefined
        }
      }));

      try {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const tokenAbi = token.kind === 'private-erc20' ? PRIVATE_TOKEN_BALANCE_ABI : ERC20_TOKEN_ABI;
        const tokenContract = new cotiEthers.Contract(normalizedAddress, tokenAbi, readProvider);
        const [symbolRaw, decimalsRaw] = await Promise.all([
          tokenContract.symbol().catch(() => null),
          tokenContract.decimals().catch(() => null)
        ]);
        const symbol =
          typeof symbolRaw === 'string' && symbolRaw.trim() ? symbolRaw.trim().slice(0, 16) : shortenAddress(normalizedAddress);
        const decimals =
          typeof decimalsRaw === 'number' || typeof decimalsRaw === 'bigint'
            ? normalizeTokenDecimals(Number(decimalsRaw))
            : FALLBACK_REWARD_TOKEN_DECIMALS;
        let balanceWei: bigint | null = null;
        if (walletAddress) {
          if (token.kind === 'private-erc20') {
            const signer = walletHasAes ? await getTradeSigner(false).catch(() => null) : null;
            balanceWei =
              signer !== null ? await readPrivateTokenBalanceWei(normalizedAddress, walletAddress, signer, true).catch(() => null) : null;
          } else {
            const rawBalance = await tokenContract.balanceOf(walletAddress).catch(() => null);
            balanceWei = typeof rawBalance === 'bigint' ? rawBalance : null;
          }
        }

        setCustomTradeTokenInfoByAddress((previous) => ({
          ...previous,
          [tokenKey]: {
            kind: token.kind,
            address: normalizedAddress,
            symbol,
            decimals,
            balanceWei,
            loading: false,
            walletKey,
            aesReady: token.kind === 'private-erc20' ? walletHasAes : undefined
          }
        }));
      } catch {
        setCustomTradeTokenInfoByAddress((previous) => ({
          ...previous,
          [tokenKey]: {
            kind: token.kind,
            address: normalizedAddress,
            symbol: shortenAddress(normalizedAddress),
            decimals: FALLBACK_REWARD_TOKEN_DECIMALS,
            balanceWei: null,
            loading: false,
            error: 'Unable to load token.',
            walletKey,
            aesReady: token.kind === 'private-erc20' ? walletHasAes : undefined
          }
        }));
      }
    },
    [getTradeSigner, walletAddress, walletHasAes, walletKey]
  );

  useEffect(() => {
    resolveRequiredFeeForTradeCreate().catch(() => {});
  }, [resolveRequiredFeeForTradeCreate]);

  useEffect(() => {
    loadWalletBalances().catch(() => {});
  }, [loadWalletBalances]);

  useEffect(() => {
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
      const shouldRefreshPrivateBalance =
        token.kind === 'private-erc20' && existing?.aesReady !== walletHasAes && !existing?.loading;
      if (!existing || existing.walletKey !== walletKey || shouldRefreshPrivateBalance) {
        loadCustomTokenInfo(token).catch(() => {});
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
    for (const token of VERIFIED_ECOSYSTEM_TOKENS) {
      const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
      const existing = customTradeTokenInfoByAddress[key];
      const shouldRefreshPrivateBalance =
        token.kind === 'private-erc20' && existing?.aesReady !== walletHasAes && !existing?.loading;
      if (!existing || existing.walletKey !== walletKey || shouldRefreshPrivateBalance) {
        loadCustomTokenInfo(token).catch(() => {});
      }
    }
  }, [customTradeTokenInfoByAddress, loadCustomTokenInfo, walletHasAes, walletKey]);

  return {
    clearWalletBalances,
    customTradeTokenInfoByAddress,
    loadWalletBalances,
    nativeBalanceWei,
    privateRewardTokenBalanceWei,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    resolveRequiredFeeForTradeCreate,
    rewardTokenBalanceWei,
    rewardTokenDecimals,
    rewardTokenSymbol,
    tradeRequiredFeeWei
  };
}
