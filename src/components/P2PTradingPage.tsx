import type { JsonRpcSigner, OnboardInfo } from '@coti-io/coti-ethers';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  COTI_NETWORK,
  ERC20_TOKEN_ABI,
  FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL,
  FALLBACK_REWARD_TOKEN_DECIMALS,
  FALLBACK_REWARD_TOKEN_SYMBOL,
  PRIVATE_REWARD_TOKEN_ADDRESS,
  PRIVATE_TOKEN_BALANCE_ABI,
  REWARD_TOKEN_ADDRESS,
  TIP_NATIVE_TOKEN_SYMBOL,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  createCotiBrowserProvider,
  formatCotiAmount,
  formatMessageTimestamp,
  formatTokenAmount,
  formatTradeAssetDisplayText,
  getInjectedWalletOptions,
  getProviderErrorMessage,
  isWalletAddress,
  loadCotiEthersModule,
  loadCotiReadProvider,
  mergeOnboardInfo,
  normalizeChainId,
  normalizeTokenDecimals,
  sanitizeTokenAmountInput,
  shortenAddress,
  withTimeout,
  type Eip1193Provider,
  type TradeAssetPayload,
  type TradeFeeModeSelection,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';
import {
  fetchRecentTradeSnapshots,
  fetchTradeAccessMetadataById,
  fetchTradeSnapshotById,
  fetchWalletTradeSnapshots,
  readPrivateTokenBalanceWei
} from '../lib/appChain';
import {
  DEFAULT_TRADE_EXPIRY_HOURS,
  buildTradeCustomTokenInfoKey,
  getOnChainFailureMessage,
  resolveTradePresetKind,
  type ResolvedTradeToken,
  type TradeCustomTokenInfo,
  type TradeTokenPresetKey
} from '../lib/appHelpers';
import { deriveTradeComposerModel } from '../lib/tradeComposer';
import { acceptTradeOnChain, cancelTradeOnChain, createTradeOnChain, declineTradeOnChain } from '../lib/tradeActions';
import { decodeTradeLink, encodeTradeLink } from '../lib/tradeLinks';
import {
  groupWalletTradesByPerspective,
  isZeroTradeTakerAddress,
  resolveTradePerspective,
  ZERO_TRADE_TAKER_ADDRESS
} from '../lib/tradePerspective';
import TradeComposerPanel from './TradeComposerPanel';
import TradeOfferCard from './TradeOfferCard';

type TradePageView = 'public' | 'create' | 'trade' | 'mine';
type TradeVisibility = 'public' | 'unlisted' | 'direct';
type MyTradeGroupView = 'received' | 'active' | 'history';

type TradeRouteState = {
  view: TradePageView;
  tradeId: number | null;
  accessSecret: string;
  routeError: string;
};

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const WALLET_STATUS_STORAGE_KEY = 'coti-trade-last-wallet-id';
const TRADE_ACCESS_SECRET_STORAGE_KEY = 'coti-trade-access-secrets-v1';
const TRADE_DETAIL_LOAD_TIMEOUT_MS = 18_000;

const normalizeTradePathname = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized || '/';
};

const normalizeTradeSearch = (value: string): string => {
  if (!value.trim()) {
    return '';
  }
  return value.startsWith('?') ? value : `?${value}`;
};

const normalizeTradeHash = (value: string): string => value.replace(/^#/, '').trim();

const normalizeAccessSecret = (value?: string | null): string => {
  const secret = value?.trim() ?? '';
  return /^0x[a-fA-F0-9]{64}$/.test(secret) ? secret : '';
};

const resolveLegacyTradeSecret = (searchValue = '', hashValue = ''): string => {
  const searchSecret = new URLSearchParams(normalizeTradeSearch(searchValue)).get('secret')?.trim() ?? '';
  const normalizedHash = normalizeTradeHash(hashValue);
  const hashSecret =
    normalizedHash.startsWith('secret=')
      ? new URLSearchParams(normalizedHash).get('secret')?.trim() ?? ''
      : normalizedHash;
  return normalizeAccessSecret(searchSecret || hashSecret);
};

const resolveTradeRouteFromParts = (pathnameValue: string, searchValue = '', hashValue = ''): TradeRouteState => {
  const pathname = normalizeTradePathname(pathnameValue);
  const lowerPathname = pathname.toLowerCase();

  if (lowerPathname === '/trades/create') {
    return { view: 'create', tradeId: null, accessSecret: '', routeError: '' };
  }
  if (lowerPathname === '/trades/mine') {
    return { view: 'mine', tradeId: null, accessSecret: '', routeError: '' };
  }
  if (lowerPathname === '/trades/open') {
    return { view: 'trade', tradeId: null, accessSecret: '', routeError: '' };
  }

  const encodedMatch = pathname.match(/^\/trades\/l\/([^/?#]+)$/i);
  if (encodedMatch) {
    let linkCode = encodedMatch[1];
    try {
      linkCode = decodeURIComponent(linkCode);
    } catch {
      return { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade link is not valid.' };
    }
    const decoded = decodeTradeLink(linkCode);
    if (!decoded) {
      return { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade link is not valid.' };
    }
    return {
      view: 'trade',
      tradeId: decoded.tradeId,
      accessSecret: decoded.accessSecret ?? '',
      routeError: ''
    };
  }

  const legacyMatch = pathname.match(/^\/trades\/(\d+)$/i);
  if (legacyMatch) {
    const tradeId = Number.parseInt(legacyMatch[1], 10);
    return Number.isSafeInteger(tradeId) && tradeId > 0
      ? { view: 'trade', tradeId, accessSecret: resolveLegacyTradeSecret(searchValue, hashValue), routeError: '' }
      : { view: 'trade', tradeId: null, accessSecret: '', routeError: 'This trade id is not valid.' };
  }

  return { view: 'public', tradeId: null, accessSecret: '', routeError: '' };
};

const resolveTradeRouteFromLocation = (): TradeRouteState => {
  if (typeof window === 'undefined') {
    return { view: 'public', tradeId: null, accessSecret: '', routeError: '' };
  }

  const redirectedPath = new URLSearchParams(window.location.search).get('p');
  if (redirectedPath) {
    try {
      const redirectedUrl = new URL(redirectedPath, window.location.origin);
      return resolveTradeRouteFromParts(
        redirectedUrl.pathname,
        redirectedUrl.search || window.location.search,
        redirectedUrl.hash || window.location.hash
      );
    } catch {
      return resolveTradeRouteFromParts(redirectedPath, window.location.search, window.location.hash);
    }
  }

  return resolveTradeRouteFromParts(window.location.pathname, window.location.search, window.location.hash);
};

const buildOfferFromSnapshot = (snapshot: TradeSnapshot): TradeOfferMessagePayload => ({
  version: 2,
  tradeId: snapshot.tradeId,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker: snapshot.maker,
  taker: snapshot.taker,
  offer: snapshot.offer,
  request: snapshot.request,
  createdAt: snapshot.createdAt,
  expiresAt: snapshot.expiresAt,
  parentTradeId: snapshot.parentTradeId
});

const isPrivateTradeAsset = (asset?: Pick<TradeAssetPayload, 'kind'> | null): boolean => asset?.kind === 'private-erc20';

const createTradeAccessSecret = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const loadStoredTradeAccessSecrets = (): Record<string, string> => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRADE_ACCESS_SECRET_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([tradeId, secret]) => /^\d+$/.test(tradeId) && typeof secret === 'string' && normalizeAccessSecret(secret)
      )
    ) as Record<string, string>;
  } catch {
    return {};
  }
};

const storeTradeAccessSecrets = (secrets: Record<string, string>): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(TRADE_ACCESS_SECRET_STORAGE_KEY, JSON.stringify(secrets));
};

const sortTrades = (trades: TradeSnapshot[]): TradeSnapshot[] =>
  [...trades].sort((left, right) => {
    if (left.status === 'open' && right.status !== 'open') {
      return -1;
    }
    if (left.status !== 'open' && right.status === 'open') {
      return 1;
    }
    return right.tradeId - left.tradeId;
  });

const resolveTradeLinkInput = (value: string): { tradeId: number; accessSecret?: string } | null => {
  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const decodedDirect = decodeTradeLink(raw);
  if (decodedDirect) {
    return decodedDirect;
  }

  const resolveFromRoute = (pathname: string, search = '', hash = ''): { tradeId: number; accessSecret?: string } | null => {
    const redirectedPath = new URLSearchParams(normalizeTradeSearch(search)).get('p');
    if (redirectedPath) {
      try {
        const redirectedUrl = new URL(redirectedPath, typeof window === 'undefined' ? 'https://chainwhisper.chat' : window.location.origin);
        return resolveFromRoute(redirectedUrl.pathname, redirectedUrl.search || search, redirectedUrl.hash || hash);
      } catch {
        return resolveFromRoute(redirectedPath, search, hash);
      }
    }

    const parsedRoute = resolveTradeRouteFromParts(pathname, search, hash);
    return parsedRoute.view === 'trade' && parsedRoute.tradeId
      ? {
          tradeId: parsedRoute.tradeId,
          accessSecret: parsedRoute.accessSecret || undefined
        }
      : null;
  };

  try {
    const parsedUrl = new URL(raw, typeof window === 'undefined' ? 'https://chainwhisper.chat' : window.location.origin);
    const parsedFromUrl = resolveFromRoute(parsedUrl.pathname, parsedUrl.search, parsedUrl.hash);
    if (parsedFromUrl) {
      return parsedFromUrl;
    }
  } catch {
  }

  if (raw.startsWith('?') || raw.startsWith('p=')) {
    const parsedFromSearch = resolveFromRoute('/', raw.startsWith('?') ? raw : `?${raw}`);
    if (parsedFromSearch) {
      return parsedFromSearch;
    }
  }

  const parsedFromBarePath = resolveFromRoute(raw.startsWith('/') ? raw : `/${raw}`);
  if (parsedFromBarePath) {
    return parsedFromBarePath;
  }

  const legacyIdMatch = raw.match(/^#?(\d+)$/);
  if (legacyIdMatch) {
    const tradeId = Number.parseInt(legacyIdMatch[1], 10);
    return Number.isSafeInteger(tradeId) && tradeId > 0 ? { tradeId } : null;
  }

  return null;
};

const formatTradeListTerms = (trade: TradeSnapshot): string =>
  `${formatTradeAssetDisplayText(trade.offer)} for ${formatTradeAssetDisplayText(trade.request)}`;

const formatTradeRateText = (trade: TradeSnapshot): string => {
  try {
    const offerAmount = BigInt(trade.offer.amount);
    const requestAmount = BigInt(trade.request.amount);
    if (offerAmount <= 0n || requestAmount <= 0n) {
      return 'Rate unavailable';
    }

    const scaledRequest = (requestAmount * 10n ** BigInt(trade.offer.decimals)) / offerAmount;
    return `1 ${trade.offer.symbol} ~= ${formatTokenAmount(scaledRequest, trade.request.decimals, 6)} ${trade.request.symbol}`;
  } catch {
    return 'Rate unavailable';
  }
};

const formatTradeAmountInput = (asset: TradeAssetPayload): string => {
  try {
    return formatTokenAmount(BigInt(asset.amount), asset.decimals, 18);
  } catch {
    return '';
  }
};

const buildTradeAssetExplorerUrl = (asset: TradeAssetPayload): string => {
  const tokenAddress = asset.tokenAddress?.trim();
  return tokenAddress ? `${COTI_NETWORK.blockExplorerUrl}/token/${tokenAddress}` : '';
};

const buildTransactionExplorerUrl = (txHash?: string): string => (txHash ? `${COTI_NETWORK.blockExplorerUrl}/tx/${txHash}` : '');

const matchesTradeSearch = (trade: TradeSnapshot, query: string): boolean => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    String(trade.tradeId),
    trade.status,
    trade.offer.symbol,
    trade.request.symbol,
    `${trade.offer.symbol}/${trade.request.symbol}`,
    `${trade.offer.symbol} / ${trade.request.symbol}`,
    trade.offer.tokenAddress,
    trade.request.tokenAddress,
    trade.maker,
    trade.taker,
    trade.parentTradeId ? String(trade.parentTradeId) : ''
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedQuery));
};

const resolveTradeAssetSelection = (
  asset: TradeAssetPayload
): { selection: TradeTokenPresetKey; customAddress: string } => {
  if (asset.kind === 'native') {
    return { selection: 'coti', customAddress: '' };
  }

  const tokenAddress = asset.tokenAddress?.trim() ?? '';
  if (tokenAddress.toLowerCase() === REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return { selection: 'wisp', customAddress: '' };
  }
  if (tokenAddress.toLowerCase() === PRIVATE_REWARD_TOKEN_ADDRESS.toLowerCase()) {
    return { selection: 'pwisp', customAddress: '' };
  }

  return {
    selection: asset.kind === 'private-erc20' ? 'custom-private' : 'custom-public',
    customAddress: tokenAddress
  };
};

export default function P2PTradingPage() {
  const [route, setRoute] = useState<TradeRouteState>(() => resolveTradeRouteFromLocation());
  const [walletAddress, setWalletAddress] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletError, setWalletError] = useState('');
  const [selectedWalletId, setSelectedWalletId] = useState(
    () => window.localStorage.getItem(WALLET_STATUS_STORAGE_KEY) ?? ''
  );
  const [connectingWalletId, setConnectingWalletId] = useState('');
  const [connectedWalletLabel, setConnectedWalletLabel] = useState('Wallet');
  const [onboardInfoByAddress, setOnboardInfoByAddress] = useState<Record<string, OnboardInfo>>({});
  const [tradeFeeModeSelection, setTradeFeeModeSelection] = useState<TradeFeeModeSelection>('coti');
  const [tradeVisibility, setTradeVisibility] = useState<TradeVisibility>('public');
  const [directTradeRecipient, setDirectTradeRecipient] = useState('');
  const [tradeOfferTokenSelection, setTradeOfferTokenSelection] = useState<TradeTokenPresetKey>('wisp');
  const [tradeRequestTokenSelection, setTradeRequestTokenSelection] = useState<TradeTokenPresetKey>('coti');
  const [tradeOfferCustomTokenAddress, setTradeOfferCustomTokenAddress] = useState('');
  const [tradeRequestCustomTokenAddress, setTradeRequestCustomTokenAddress] = useState('');
  const [tradeOfferAmountInput, setTradeOfferAmountInput] = useState('');
  const [tradeRequestAmountInput, setTradeRequestAmountInput] = useState('');
  const [tradeExpiryHoursInput, setTradeExpiryHoursInput] = useState(DEFAULT_TRADE_EXPIRY_HOURS);
  const [customTradeTokenInfoByAddress, setCustomTradeTokenInfoByAddress] = useState<Record<string, TradeCustomTokenInfo>>({});
  const [nativeBalanceWei, setNativeBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenBalanceWei, setRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [privateRewardTokenBalanceWei, setPrivateRewardTokenBalanceWei] = useState<bigint | null>(null);
  const [rewardTokenSymbol, setRewardTokenSymbol] = useState(FALLBACK_REWARD_TOKEN_SYMBOL);
  const [privateRewardTokenSymbol, setPrivateRewardTokenSymbol] = useState(FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL);
  const [rewardTokenDecimals, setRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [privateRewardTokenDecimals, setPrivateRewardTokenDecimals] = useState(FALLBACK_REWARD_TOKEN_DECIMALS);
  const [tradeRequiredFeeWei, setTradeRequiredFeeWei] = useState<bigint | null>(null);
  const [tradeTokenFeeWei, setTradeTokenFeeWei] = useState<bigint | null>(null);
  const [publicTrades, setPublicTrades] = useState<TradeSnapshot[]>([]);
  const [myTrades, setMyTrades] = useState<TradeSnapshot[]>([]);
  const [detailTrade, setDetailTrade] = useState<TradeSnapshot | null>(null);
  const [loadingPublicTrades, setLoadingPublicTrades] = useState(false);
  const [loadingMyTrades, setLoadingMyTrades] = useState(false);
  const [loadingDetailTrade, setLoadingDetailTrade] = useState(false);
  const [tradeAccessBlocked, setTradeAccessBlocked] = useState(false);
  const [publicTradesError, setPublicTradesError] = useState('');
  const [myTradesError, setMyTradesError] = useState('');
  const [detailTradeError, setDetailTradeError] = useState('');
  const [tradeActionError, setTradeActionError] = useState('');
  const [creatingTrade, setCreatingTrade] = useState(false);
  const [processingTradeActionId, setProcessingTradeActionId] = useState('');
  const [createdTradeId, setCreatedTradeId] = useState<number | null>(null);
  const [createdTradeLink, setCreatedTradeLink] = useState('');
  const [lastCopiedKey, setLastCopiedKey] = useState('');
  const [tradeLinkInput, setTradeLinkInput] = useState('');
  const [tradeSearchInput, setTradeSearchInput] = useState('');
  const [myTradeGroupView, setMyTradeGroupView] = useState<MyTradeGroupView>('received');
  const [knownTradeAccessSecrets, setKnownTradeAccessSecrets] = useState<Record<string, string>>(
    () => loadStoredTradeAccessSecrets()
  );
  const [counterParentTrade, setCounterParentTrade] = useState<TradeSnapshot | null>(null);

  const providerRef = useRef<Eip1193Provider | null>(null);
  const signerCacheRef = useRef<Record<string, JsonRpcSigner>>({});
  const feeRequestRef = useRef<Promise<bigint> | null>(null);
  const tokenFeeRequestRef = useRef<Promise<bigint> | null>(null);
  const counterPanelRef = useRef<HTMLDivElement | null>(null);

  const injectedWalletOptions = useMemo(() => getInjectedWalletOptions(), []);
  const preferredWalletOption =
    injectedWalletOptions.find((option) => option.id === selectedWalletId) ??
    injectedWalletOptions.find((option) => option.provider.isMetaMask && !option.provider.isBraveWallet) ??
    injectedWalletOptions[0] ??
    null;
  const onCotiNetwork = chainId === COTI_NETWORK.chainIdDecimal;
  const walletKey = walletAddress.trim().toLowerCase();
  const walletHasAes = Boolean(walletKey && onboardInfoByAddress[walletKey]?.aesKey);
  const openPublicTradeCount = publicTrades.filter((trade) => trade.status === 'open').length;
  const routeView = route.view;
  const routeTradeId = route.tradeId;
  const routeAccessSecret = route.accessSecret;
  const storedRouteAccessSecret = routeTradeId !== null ? knownTradeAccessSecrets[String(routeTradeId)] ?? '' : '';
  const resolvedRouteAccessSecret = routeAccessSecret || storedRouteAccessSecret;
  const routeError = route.routeError;
  const directTradeRecipientNormalized = directTradeRecipient.trim();
  const directTradeRecipientIsValid =
    directTradeRecipientNormalized.length > 0 && isWalletAddress(directTradeRecipientNormalized);

  const navigateToTradePath = useCallback((path: string) => {
    if (typeof window === 'undefined') {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = path;
    nextUrl.search = '';
    nextUrl.hash = '';
    window.history.pushState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    setRoute(resolveTradeRouteFromLocation());
  }, []);

  const buildTradeShareUrl = useCallback((tradeId: number, accessSecret?: string): string => {
    const code = encodeTradeLink(tradeId, accessSecret);
    const path = `/trades/l/${code}`;
    if (typeof window === 'undefined') {
      return path;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = path;
    nextUrl.search = '';
    nextUrl.hash = '';
    return nextUrl.toString();
  }, []);

  const rememberTradeAccessSecret = useCallback((tradeId: number, accessSecret?: string) => {
    const normalizedSecret = normalizeAccessSecret(accessSecret);
    if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !normalizedSecret) {
      return;
    }

    setKnownTradeAccessSecrets((previous) => {
      if (previous[String(tradeId)] === normalizedSecret) {
        return previous;
      }

      const next = {
        ...previous,
        [String(tradeId)]: normalizedSecret
      };
      storeTradeAccessSecrets(next);
      return next;
    });
  }, []);

  const resolveKnownTradeAccessSecret = useCallback(
    (tradeId: number): string => knownTradeAccessSecrets[String(tradeId)] ?? '',
    [knownTradeAccessSecrets]
  );

  const copyWithFeedback = useCallback(async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setLastCopiedKey(key);
    window.setTimeout(() => {
      setLastCopiedKey((current) => (current === key ? '' : current));
    }, 1400);
  }, []);

  const ensureCotiNetwork = useCallback(async (provider: Eip1193Provider) => {
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: COTI_NETWORK.chainIdHex }]
      });
    } catch (switchError) {
      const errorWithCode = switchError as { code?: number; message?: string };
      if (errorWithCode.code !== 4902) {
        throw new Error(errorWithCode.message ?? 'Could not switch to COTI network.');
      }

      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: COTI_NETWORK.chainIdHex,
            chainName: COTI_NETWORK.chainName,
            rpcUrls: [COTI_NETWORK.rpcUrl],
            blockExplorerUrls: [COTI_NETWORK.blockExplorerUrl],
            nativeCurrency: COTI_NETWORK.nativeCurrency
          }
        ]
      });
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: COTI_NETWORK.chainIdHex }]
      });
    }
  }, []);

  const attachWallet = useCallback(
    async (provider: Eip1193Provider, address: string, walletLabel: string, walletId?: string) => {
      providerRef.current = provider;
      setWalletAddress(address);
      setConnectedWalletLabel(walletLabel);
      if (walletId) {
        setSelectedWalletId(walletId);
        window.localStorage.setItem(WALLET_STATUS_STORAGE_KEY, walletId);
      }
      const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
      setChainId(normalizeChainId(currentChain));
    },
    [onboardInfoByAddress]
  );

  const onboardTradeWalletAes = useCallback(
    async (provider: Eip1193Provider, address: string): Promise<JsonRpcSigner> => {
      await ensureCotiNetwork(provider);

      const cacheKey = address.toLowerCase();
      let signer = signerCacheRef.current[cacheKey];
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(address, onboardInfoByAddress[cacheKey]);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
      } else if (onboardInfoByAddress[cacheKey]) {
        signer.setUserOnboardInfo(onboardInfoByAddress[cacheKey]);
      }

      signer.disableAutoOnboard();
      let onboardInfo = signer.getUserOnboardInfo();
      if (!onboardInfo?.aesKey) {
        await signer.generateOrRecoverAes();
        onboardInfo = signer.getUserOnboardInfo();
      }

      if (!onboardInfo?.aesKey) {
        throw new Error('AES key was not returned during signing.');
      }

      setOnboardInfoByAddress((previous) => ({
        ...previous,
        [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
      }));
      return signer;
    },
    [ensureCotiNetwork, onboardInfoByAddress]
  );

  const connectWallet = useCallback(
    async (walletId?: string) => {
      const walletOption =
        (walletId ? injectedWalletOptions.find((option) => option.id === walletId) ?? null : preferredWalletOption) ??
        preferredWalletOption;
      const provider = walletOption?.provider ?? null;
      const walletLabel = walletOption?.label ?? 'Wallet';

      setWalletError('');
      setTradeActionError('');
      setConnectingWalletId(walletOption?.id ?? 'wallet');

      if (!provider) {
        setWalletError('No browser wallet detected.');
        setConnectingWalletId('');
        return;
      }

      try {
        const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
        const selected = accounts[0] ?? '';
        if (!selected) {
          throw new Error('No wallet account selected.');
        }
        await ensureCotiNetwork(provider);
        await attachWallet(provider, selected, walletLabel, walletOption?.id);
        try {
          await onboardTradeWalletAes(provider, selected);
        } catch (aesError) {
          setWalletError(getProviderErrorMessage(aesError, 'AES signature was not completed.'));
        }
      } catch (error) {
        setWalletError(getProviderErrorMessage(error, 'Failed to connect wallet.'));
      } finally {
        setConnectingWalletId('');
      }
    },
    [attachWallet, ensureCotiNetwork, injectedWalletOptions, onboardTradeWalletAes, preferredWalletOption]
  );

  useEffect(() => {
    if (providerRef.current || walletAddress || connectingWalletId || !preferredWalletOption?.provider?.request) {
      return;
    }

    let cancelled = false;
    const restoreAuthorizedWallet = async () => {
      try {
        const accounts = (await preferredWalletOption.provider.request({ method: 'eth_accounts' })) as string[];
        const selected = accounts[0] ?? '';
        if (cancelled || !selected) {
          return;
        }

        await attachWallet(preferredWalletOption.provider, selected, preferredWalletOption.label, preferredWalletOption.id);
        setWalletError('');
      } catch {
      }
    };

    restoreAuthorizedWallet();
    return () => {
      cancelled = true;
    };
  }, [attachWallet, connectingWalletId, preferredWalletOption, walletAddress]);

  const getTradeSigner = useCallback(
    async (requireAes: boolean): Promise<JsonRpcSigner> => {
      const provider = providerRef.current;
      if (!provider || !walletAddress) {
        throw new Error('Connect a wallet first.');
      }

      if (chainId !== COTI_NETWORK.chainIdDecimal) {
        await ensureCotiNetwork(provider);
        const currentChain = (await provider.request({ method: 'eth_chainId' })) as string | number;
        setChainId(normalizeChainId(currentChain));
      }

      const cacheKey = walletAddress.toLowerCase();
      let signer = signerCacheRef.current[cacheKey];
      if (!signer) {
        const browserProvider = await createCotiBrowserProvider(provider);
        signer = await browserProvider.getSigner(walletAddress, onboardInfoByAddress[cacheKey]);
        signer.disableAutoOnboard();
        signerCacheRef.current[cacheKey] = signer;
      } else if (onboardInfoByAddress[cacheKey]) {
        signer.setUserOnboardInfo(onboardInfoByAddress[cacheKey]);
      }

      signer.disableAutoOnboard();
      if (requireAes && !signer.getUserOnboardInfo()?.aesKey) {
        await signer.generateOrRecoverAes();
      }

      const onboardInfo = signer.getUserOnboardInfo();
      if (onboardInfo?.aesKey) {
        setOnboardInfoByAddress((previous) => ({
          ...previous,
          [cacheKey]: mergeOnboardInfo(previous[cacheKey], onboardInfo)
        }));
      }

      return signer;
    },
    [chainId, connectedWalletLabel, ensureCotiNetwork, onboardInfoByAddress, walletAddress]
  );

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

  const resolveRequiredTokenFeeForTradeCreate = useCallback(async (): Promise<bigint> => {
    if (tradeTokenFeeWei !== null) {
      return tradeTokenFeeWei;
    }

    if (!tokenFeeRequestRef.current) {
      tokenFeeRequestRef.current = (async () => {
        const cotiEthers = await loadCotiEthersModule();
        const readProvider = await loadCotiReadProvider(true);
        const readContract = new cotiEthers.Contract(TRADE_ESCROW_CONTRACT_ADDRESS, TRADE_ESCROW_CONTRACT_ABI, readProvider);
        return (await readContract.tokenFeeAmount()) as bigint;
      })();
    }

    try {
      const tokenFee = await tokenFeeRequestRef.current;
      setTradeTokenFeeWei(tokenFee);
      return tokenFee;
    } finally {
      tokenFeeRequestRef.current = null;
    }
  }, [tradeTokenFeeWei]);

  const refreshPublicTrades = useCallback(async () => {
    setLoadingPublicTrades(true);
    setPublicTradesError('');
    try {
      const snapshots = await fetchRecentTradeSnapshots({
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        limit: 80
      });
      setPublicTrades(sortTrades(snapshots));
    } catch {
      setPublicTradesError('Failed to load public trades.');
    } finally {
      setLoadingPublicTrades(false);
    }
  }, [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]);

  const refreshMyTrades = useCallback(async () => {
    if (!walletAddress) {
      setMyTrades([]);
      return;
    }

    setLoadingMyTrades(true);
    setMyTradesError('');
    try {
      const snapshots = await fetchWalletTradeSnapshots(walletAddress, {
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        limit: 80
      });
      setMyTrades(sortTrades(snapshots));
    } catch {
      setMyTradesError('Failed to load your trades.');
    } finally {
      setLoadingMyTrades(false);
    }
  }, [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol, walletAddress]);

  const mergeTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot) => {
      setDetailTrade((current) => (current?.tradeId === snapshot.tradeId ? snapshot : current));
      setPublicTrades((previous) => {
        const withoutCurrent = previous.filter((trade) => trade.tradeId !== snapshot.tradeId);
        if (snapshot.isPublic && snapshot.status === 'open') {
          return sortTrades([snapshot, ...withoutCurrent]);
        }
        return sortTrades(withoutCurrent);
      });
      if (walletKey && [snapshot.maker.toLowerCase(), snapshot.taker.toLowerCase()].includes(walletKey)) {
        setMyTrades((previous) => {
          const withoutCurrent = previous.filter((trade) => trade.tradeId !== snapshot.tradeId);
          return sortTrades([snapshot, ...withoutCurrent]);
        });
      }
    },
    [walletKey]
  );

  const refreshTradeDetail = useCallback(
    async (tradeId: number): Promise<TradeSnapshot | null> => {
      const snapshot = await fetchTradeSnapshotById(tradeId, {
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals
      });
      mergeTradeSnapshot(snapshot);
      return snapshot;
    },
    [mergeTradeSnapshot, privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]
  );

  const openTrade = useCallback(
    (tradeId: number, accessSecret?: string) => {
      navigateToTradePath(`/trades/l/${encodeTradeLink(tradeId, accessSecret)}`);
    },
    [navigateToTradePath]
  );

  const openTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot, accessSecret?: string) => {
      const knownAccessSecret =
        accessSecret || (snapshot.isPublic === false || snapshot.hasAccessHash ? resolveKnownTradeAccessSecret(snapshot.tradeId) : '');
      setDetailTrade(snapshot);
      openTrade(snapshot.tradeId, knownAccessSecret || undefined);
    },
    [openTrade, resolveKnownTradeAccessSecret]
  );

  const openTradeFromInput = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const parsedLink = resolveTradeLinkInput(tradeLinkInput);
      if (!parsedLink) {
        setDetailTradeError(tradeLinkInput.trim() ? 'Paste a valid trade link, compact code, or trade id.' : '');
        setRoute({ view: 'trade', tradeId: null, accessSecret: '', routeError: '' });
        return;
      }

      setDetailTradeError('');
      rememberTradeAccessSecret(parsedLink.tradeId, parsedLink.accessSecret);
      openTrade(parsedLink.tradeId, parsedLink.accessSecret);
      setTradeLinkInput('');
    },
    [openTrade, rememberTradeAccessSecret, tradeLinkInput]
  );

  const hashTradeAccessSecret = useCallback(async (accessSecret: string): Promise<string> => {
    const cotiEthers = await loadCotiEthersModule();
    return cotiEthers.keccak256(accessSecret);
  }, []);

  const tradeComposerModel = useMemo(
    () =>
      deriveTradeComposerModel({
        activeContact: null,
        walletAddress,
        isSelfChat: false,
        onCotiNetwork,
        creatingTrade,
        sending: false,
        tipping: false,
        tradeFeeModeSelection,
        tradeOfferTokenSelection,
        tradeRequestTokenSelection,
        tradeOfferCustomTokenAddress,
        tradeRequestCustomTokenAddress,
        tradeCustomOfferTokenKind:
          resolveTradePresetKind(tradeOfferTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20',
        tradeCustomRequestTokenKind:
          resolveTradePresetKind(tradeRequestTokenSelection) === 'private-erc20' ? 'private-erc20' : 'erc20',
        customTradeTokenInfoByAddress,
        tradeOfferAmountInput,
        tradeRequestAmountInput,
        tradeExpiryHoursInput,
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        tipNativeBalanceWei: nativeBalanceWei,
        rewardTokenBalanceWei,
        privateRewardTokenBalanceWei,
        tradeRequiredFeeWei,
        tradeTokenFeeWei,
        counterpartyRequired: false
      }),
    [
      creatingTrade,
      customTradeTokenInfoByAddress,
      nativeBalanceWei,
      onCotiNetwork,
      privateRewardTokenBalanceWei,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenBalanceWei,
      rewardTokenDecimals,
      rewardTokenSymbol,
      tradeExpiryHoursInput,
      tradeFeeModeSelection,
      tradeOfferAmountInput,
      tradeOfferCustomTokenAddress,
      tradeOfferTokenSelection,
      tradeRequestAmountInput,
      tradeRequestCustomTokenAddress,
      tradeRequestTokenSelection,
      tradeRequiredFeeWei,
      tradeTokenFeeWei,
      walletAddress
    ]
  );

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

    setRewardTokenSymbol(typeof rewardSymbolRaw === 'string' && rewardSymbolRaw.trim() ? rewardSymbolRaw.trim().slice(0, 12) : FALLBACK_REWARD_TOKEN_SYMBOL);
    setPrivateRewardTokenSymbol(
      typeof privateSymbolRaw === 'string' && privateSymbolRaw.trim()
        ? privateSymbolRaw.trim().slice(0, 12)
        : FALLBACK_PRIVATE_REWARD_TOKEN_SYMBOL
    );
    setRewardTokenDecimals(normalizeTokenDecimals(Number(rewardDecimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)));
    setPrivateRewardTokenDecimals(normalizeTokenDecimals(Number(privateDecimalsRaw ?? FALLBACK_REWARD_TOKEN_DECIMALS)));

    if (!walletAddress || !isWalletAddress(walletAddress)) {
      setNativeBalanceWei(null);
      setRewardTokenBalanceWei(null);
      setPrivateRewardTokenBalanceWei(null);
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
        signer !== null ? await readPrivateTokenBalanceWei(PRIVATE_REWARD_TOKEN_ADDRESS, walletAddress, signer).catch(() => null) : null;
      setPrivateRewardTokenBalanceWei(privateBalance);
    } else {
      setPrivateRewardTokenBalanceWei(null);
    }
  }, [getTradeSigner, walletAddress, walletHasAes]);

  const signAesForCurrentWallet = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || !walletAddress) {
      setWalletError('Connect a wallet first.');
      return;
    }

    setWalletError('');
    setConnectingWalletId('aes');
    try {
      await onboardTradeWalletAes(provider, walletAddress);
      await loadWalletBalances().catch(() => {});
    } catch (error) {
      setWalletError(getProviderErrorMessage(error, 'AES signature was not completed.'));
    } finally {
      setConnectingWalletId('');
    }
  }, [connectedWalletLabel, loadWalletBalances, onboardTradeWalletAes, walletAddress]);

  const loadCustomTokenInfo = useCallback(
    async (token: { address: string; kind: Extract<ResolvedTradeToken['kind'], 'erc20' | 'private-erc20'> }) => {
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
          walletKey
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
              signer !== null ? await readPrivateTokenBalanceWei(normalizedAddress, walletAddress, signer).catch(() => null) : null;
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
            walletKey
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
            walletKey
          }
        }));
      }
    },
    [getTradeSigner, walletAddress, walletHasAes, walletKey]
  );

  const beginCounterTrade = useCallback(
    (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet before countering.');
        return;
      }
      if (snapshot.maker.toLowerCase() === walletKey) {
        setTradeActionError('This is your offer. Cancel it and create a new one to change the terms.');
        return;
      }
      if (snapshot.status !== 'open') {
        setTradeActionError('Only open trades can receive counter offers.');
        return;
      }

      const nextOfferSelection = resolveTradeAssetSelection(snapshot.request);
      const nextRequestSelection = resolveTradeAssetSelection(snapshot.offer);
      setCounterParentTrade(snapshot);
      setTradeVisibility('unlisted');
      setTradeOfferTokenSelection(nextOfferSelection.selection);
      setTradeRequestTokenSelection(nextRequestSelection.selection);
      setTradeOfferCustomTokenAddress(nextOfferSelection.customAddress);
      setTradeRequestCustomTokenAddress(nextRequestSelection.customAddress);
      setTradeOfferAmountInput(formatTradeAmountInput(snapshot.request));
      setTradeRequestAmountInput(formatTradeAmountInput(snapshot.offer));
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      setTradeActionError('');
      openTradeSnapshot(snapshot);
    },
    [openTradeSnapshot, walletAddress, walletKey]
  );

  const clearCounterTrade = useCallback(() => {
    setCounterParentTrade(null);
    setTradeActionError('');
  }, []);

  const createTrade = useCallback(async () => {
    setTradeActionError('');
    setCreatedTradeId(null);
    setCreatedTradeLink('');

    if (tradeComposerModel.tradeComposerValidationMessage) {
      setTradeActionError(tradeComposerModel.tradeComposerValidationMessage);
      return;
    }

    const offerToken = tradeComposerModel.selectedTradeOfferToken;
    const requestToken = tradeComposerModel.selectedTradeRequestToken;
    const offerAmount = tradeComposerModel.parsedTradeOfferAmountWei;
    const requestAmount = tradeComposerModel.parsedTradeRequestAmountWei;
    if (!offerToken || !requestToken || !offerAmount || !requestAmount) {
      setTradeActionError('Complete the trade terms first.');
      return;
    }
    if (tradeVisibility === 'direct') {
      if (!directTradeRecipientIsValid) {
        setTradeActionError('Enter a valid wallet address for the direct trade.');
        return;
      }
      if (directTradeRecipientNormalized.toLowerCase() === walletAddress.toLowerCase()) {
        setTradeActionError('Choose a different wallet for the direct trade.');
        return;
      }
    }

    try {
      setCreatingTrade(true);
      const isCounterTrade = counterParentTrade !== null;
      const accessSecret = tradeVisibility === 'unlisted' || isCounterTrade ? createTradeAccessSecret() : '';
      const accessHash = accessSecret ? await hashTradeAccessSecret(accessSecret) : ZERO_BYTES32;
      const signer = await getTradeSigner(isPrivateTradeAsset(offerToken));
      const nativeFeeWei = tradeFeeModeSelection === 'coti' ? await resolveRequiredFeeForTradeCreate() : 0n;
      const tokenFeeAmount = tradeFeeModeSelection === 'token' ? await resolveRequiredTokenFeeForTradeCreate() : 0n;
      const expiresAt = Math.floor(Date.now() / 1000) + tradeComposerModel.parsedTradeExpiryHours * 3600;
      const takerAddress =
        counterParentTrade?.maker ?? (tradeVisibility === 'direct' ? directTradeRecipientNormalized : ZERO_TRADE_TAKER_ADDRESS);
      const { tradeId } = await createTradeOnChain({
        signer,
        makerAddress: walletAddress,
        takerAddress,
        offerAsset: offerToken,
        offerAmountWei: offerAmount,
        requestAsset: requestToken,
        requestAmountWei: requestAmount,
        expiresAt,
        feeMode: tradeFeeModeSelection,
        nativeFeeWei,
        tokenFeeAmount,
        isPublic: !isCounterTrade && tradeVisibility === 'public',
        accessHash: accessHash !== ZERO_BYTES32 ? accessHash : undefined,
        parentTradeId: counterParentTrade?.tradeId
      });
      const createdAt = Math.floor(Date.now() / 1000);
      const snapshot: TradeSnapshot = {
        tradeId,
        maker: walletAddress,
        taker: takerAddress,
        offer: { ...offerToken, amount: offerAmount.toString() },
        request: { ...requestToken, amount: requestAmount.toString() },
        createdAt,
        expiresAt,
        status: 'open',
        isPublic: !isCounterTrade && tradeVisibility === 'public',
        hasAccessHash: Boolean(accessSecret),
        parentTradeId: counterParentTrade?.tradeId
      };
      const shareUrl = buildTradeShareUrl(tradeId, accessSecret || undefined);
      rememberTradeAccessSecret(tradeId, accessSecret || undefined);
      mergeTradeSnapshot(snapshot);
      setCreatedTradeId(tradeId);
      setCreatedTradeLink(shareUrl);
      setCounterParentTrade(null);
      if (tradeVisibility === 'direct') {
        setDirectTradeRecipient('');
      }
      setTradeOfferAmountInput('');
      setTradeRequestAmountInput('');
      setTradeExpiryHoursInput(DEFAULT_TRADE_EXPIRY_HOURS);
      openTrade(tradeId, accessSecret || undefined);
      await Promise.all([loadWalletBalances(), refreshMyTrades(), tradeVisibility === 'public' ? refreshPublicTrades() : Promise.resolve()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create trade.';
      setTradeActionError(getOnChainFailureMessage(error, message));
    } finally {
      setCreatingTrade(false);
    }
  }, [
    buildTradeShareUrl,
    counterParentTrade,
    directTradeRecipientIsValid,
    directTradeRecipientNormalized,
    getTradeSigner,
    hashTradeAccessSecret,
    loadWalletBalances,
    mergeTradeSnapshot,
    openTrade,
    rememberTradeAccessSecret,
    refreshMyTrades,
    refreshPublicTrades,
    resolveRequiredFeeForTradeCreate,
    resolveRequiredTokenFeeForTradeCreate,
    tradeComposerModel,
    tradeFeeModeSelection,
    tradeVisibility,
    walletAddress
  ]);

  const acceptTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      if (!walletAddress) {
        setTradeActionError('Connect a wallet first.');
        return;
      }

      setTradeActionError('');
      try {
        setProcessingTradeActionId(String(snapshot.tradeId));
        const latestSnapshot = (await refreshTradeDetail(snapshot.tradeId)) ?? snapshot;
        const signer = await getTradeSigner(isPrivateTradeAsset(latestSnapshot.request));
        const { acceptedTxHash } = await acceptTradeOnChain({
          signer,
          ownerAddress: walletAddress,
          tradeId: snapshot.tradeId,
          requestAsset: latestSnapshot.request,
          accessSecret: route.tradeId === snapshot.tradeId && resolvedRouteAccessSecret ? resolvedRouteAccessSecret : undefined
        });
        const nextSnapshot: TradeSnapshot = {
          ...latestSnapshot,
          taker:
            latestSnapshot.taker.toLowerCase() === ZERO_TRADE_TAKER_ADDRESS.toLowerCase()
              ? walletAddress
              : latestSnapshot.taker,
          status: 'accepted',
          acceptedTxHash
        };
        mergeTradeSnapshot(nextSnapshot);
        await Promise.all([loadWalletBalances(), refreshMyTrades(), refreshPublicTrades()]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to accept trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [
      getTradeSigner,
      loadWalletBalances,
      mergeTradeSnapshot,
      refreshMyTrades,
      refreshPublicTrades,
      refreshTradeDetail,
      resolvedRouteAccessSecret,
      route.tradeId,
      walletAddress
    ]
  );

  const cancelTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      setTradeActionError('');
      try {
        setProcessingTradeActionId(String(snapshot.tradeId));
        const signer = await getTradeSigner(false);
        await cancelTradeOnChain({ signer, tradeId: snapshot.tradeId });
        const nextSnapshot: TradeSnapshot = { ...snapshot, status: 'cancelled' };
        mergeTradeSnapshot(nextSnapshot);
        await Promise.all([loadWalletBalances(), refreshMyTrades(), refreshPublicTrades()]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cancel trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [getTradeSigner, loadWalletBalances, mergeTradeSnapshot, refreshMyTrades, refreshPublicTrades]
  );

  const declineTrade = useCallback(
    async (snapshot: TradeSnapshot) => {
      setTradeActionError('');
      try {
        setProcessingTradeActionId(String(snapshot.tradeId));
        const signer = await getTradeSigner(false);
        await declineTradeOnChain({ signer, tradeId: snapshot.tradeId });
        const nextSnapshot: TradeSnapshot = { ...snapshot, status: 'declined' };
        mergeTradeSnapshot(nextSnapshot);
        await refreshMyTrades();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refuse trade.';
        setTradeActionError(getOnChainFailureMessage(error, message));
      } finally {
        setProcessingTradeActionId('');
      }
    },
    [getTradeSigner, mergeTradeSnapshot, refreshMyTrades]
  );

  const renderTradeCard = (snapshot: TradeSnapshot, collapsed = false) => {
    const accessSecret =
      route.tradeId === snapshot.tradeId && resolvedRouteAccessSecret
        ? resolvedRouteAccessSecret
        : resolveKnownTradeAccessSecret(snapshot.tradeId);
    const shareUrl =
      snapshot.isPublic === false && snapshot.hasAccessHash && !accessSecret
        ? undefined
        : buildTradeShareUrl(snapshot.tradeId, accessSecret);
    const shareKey = `trade-link:${snapshot.tradeId}:${accessSecret ? 'secret' : 'public'}`;

    return (
      <TradeOfferCard
        key={snapshot.tradeId}
        offer={buildOfferFromSnapshot(snapshot)}
        snapshot={snapshot}
        currentWalletAddress={walletAddress}
        actionPending={processingTradeActionId === String(snapshot.tradeId)}
        collapsed={collapsed}
        shareUrl={shareUrl}
        shareLabel={accessSecret ? 'Private Link' : 'Share Link'}
        shareCopied={lastCopiedKey === shareKey}
        onCopyShareLink={shareUrl ? () => copyWithFeedback(shareUrl, shareKey).catch(() => {}) : undefined}
        showCounterAction={snapshot.status === 'open'}
        onAccept={() => acceptTrade(snapshot).catch(() => {})}
        onDecline={() => declineTrade(snapshot).catch(() => {})}
        onCounter={() => beginCounterTrade(snapshot)}
        onCancel={() => cancelTrade(snapshot).catch(() => {})}
      />
    );
  };

  useEffect(() => {
    const syncRoute = () => {
      setRoute(resolveTradeRouteFromLocation());
    };
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  useEffect(() => {
    if (routeTradeId !== null && routeAccessSecret) {
      rememberTradeAccessSecret(routeTradeId, routeAccessSecret);
    }
  }, [rememberTradeAccessSecret, routeAccessSecret, routeTradeId]);

  useEffect(() => {
    if (!counterParentTrade) {
      return;
    }

    window.requestAnimationFrame(() => {
      counterPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      counterPanelRef.current?.focus({ preventScroll: true });
    });
  }, [counterParentTrade]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider?.on || !provider?.removeListener) {
      return;
    }

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccounts = Array.isArray(accounts) ? (accounts as string[]) : [];
      const selected = nextAccounts[0] ?? '';
      setWalletAddress(selected);
      if (!selected) {
        setChainId(null);
      }
    };
    const handleChainChanged = (newChainId: unknown) => {
      if (typeof newChainId === 'string' || typeof newChainId === 'number') {
        setChainId(normalizeChainId(newChainId));
      }
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);
    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [walletAddress]);

  useEffect(() => {
    resolveRequiredFeeForTradeCreate().catch(() => {});
    resolveRequiredTokenFeeForTradeCreate().catch(() => {});
  }, [resolveRequiredFeeForTradeCreate, resolveRequiredTokenFeeForTradeCreate]);

  useEffect(() => {
    loadWalletBalances().catch(() => {});
  }, [loadWalletBalances]);

  useEffect(() => {
    refreshPublicTrades().catch(() => {});
  }, [refreshPublicTrades]);

  useEffect(() => {
    refreshMyTrades().catch(() => {});
  }, [refreshMyTrades]);

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
      (token): token is { address: string; kind: Extract<ResolvedTradeToken['kind'], 'erc20' | 'private-erc20'> } =>
        Boolean(token.address.trim()) && isWalletAddress(token.address.trim())
    );

    for (const token of requestedTokens) {
      const key = buildTradeCustomTokenInfoKey(token.kind, token.address);
      const existing = customTradeTokenInfoByAddress[key];
      if (!existing || existing.walletKey !== walletKey) {
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
    walletKey
  ]);

  useEffect(() => {
    if (routeView !== 'trade' || routeTradeId === null) {
      setDetailTrade(null);
      setDetailTradeError(routeError);
      setTradeAccessBlocked(false);
      setLoadingDetailTrade(false);
      return;
    }

    let cancelled = false;
    setLoadingDetailTrade(true);
    setDetailTradeError('');
    setTradeAccessBlocked(false);

    const loadDetail = async () => {
      try {
        const metadata = await withTimeout(
          fetchTradeAccessMetadataById(routeTradeId),
          TRADE_DETAIL_LOAD_TIMEOUT_MS,
          'Timed out while reading trade access.'
        ).catch(() => null);
        if (cancelled) {
          return;
        }

        const snapshot = await withTimeout(
          refreshTradeDetail(routeTradeId),
          TRADE_DETAIL_LOAD_TIMEOUT_MS,
          'Timed out while loading trade.'
        );
        const isParticipant =
          Boolean(walletKey) &&
          [snapshot?.maker.toLowerCase(), snapshot?.taker.toLowerCase()].includes(walletKey);
        const isUnlisted = metadata?.isPublic === false || snapshot?.isPublic === false;
        if (isUnlisted && !resolvedRouteAccessSecret && !isParticipant) {
          setTradeAccessBlocked(true);
          setDetailTrade(null);
          return;
        }
        if (!cancelled) {
          setDetailTrade(snapshot);
        }
      } catch (loadError) {
        if (!cancelled) {
          setDetailTradeError(loadError instanceof Error ? loadError.message : 'Trade was not found on the escrow contract.');
        }
      } finally {
        if (!cancelled) {
          setLoadingDetailTrade(false);
        }
      }
    };

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [refreshTradeDetail, resolvedRouteAccessSecret, routeError, routeTradeId, routeView, walletKey]);

  const tradeComposer = (
    <TradeComposerPanel
      title={counterParentTrade ? `Counter trade #${counterParentTrade.tradeId}` : 'Create trade'}
      metaLabel={
        counterParentTrade
          ? `Linked counter to ${shortenAddress(counterParentTrade.maker)}`
          : tradeVisibility === 'public'
            ? 'Listed escrow trade'
            : tradeVisibility === 'direct'
              ? directTradeRecipientIsValid
                ? `Direct to ${shortenAddress(directTradeRecipientNormalized)}`
                : 'Direct wallet offer'
              : 'Unlisted escrow trade'
      }
      safetyNote={
        counterParentTrade
          ? 'The counter offer is created as a linked private trade for the original maker.'
          : 'Escrow settlement and trade terms are stored on-chain.'
      }
      sendLabel={counterParentTrade ? 'Send Counter' : 'Create Trade'}
      sendingLabel="Creating..."
      sendTitle={counterParentTrade ? 'Create a linked counter trade on chain.' : 'Create the escrow trade on chain.'}
      feeMode={tradeFeeModeSelection}
      onFeeModeChange={setTradeFeeModeSelection}
      feeSummaryLabel={tradeComposerModel.tradeFeeSummaryLabel}
      feeError={tradeComposerModel.tradeComposerFieldErrors.fee}
      offerTokenOptions={tradeComposerModel.tradeTokenOptions}
      requestTokenOptions={tradeComposerModel.tradeTokenOptions}
      offerTokenSelection={tradeOfferTokenSelection}
      onOfferTokenSelectionChange={(value) => setTradeOfferTokenSelection(value as TradeTokenPresetKey)}
      requestTokenSelection={tradeRequestTokenSelection}
      onRequestTokenSelectionChange={(value) => setTradeRequestTokenSelection(value as TradeTokenPresetKey)}
      offerAssetError={tradeComposerModel.tradeComposerFieldErrors.offerAsset}
      requestAssetError={tradeComposerModel.tradeComposerFieldErrors.requestAsset}
      offerCustomAddress={tradeOfferCustomTokenAddress}
      onOfferCustomAddressChange={setTradeOfferCustomTokenAddress}
      requestCustomAddress={tradeRequestCustomTokenAddress}
      onRequestCustomAddressChange={setTradeRequestCustomTokenAddress}
      offerCustomMetaLabel={tradeComposerModel.tradeOfferCustomMetaLabel}
      requestCustomMetaLabel={tradeComposerModel.tradeRequestCustomMetaLabel}
      offerVerifyUrl={tradeComposerModel.tradeOfferVerifyUrl}
      requestVerifyUrl={tradeComposerModel.tradeRequestVerifyUrl}
      offerAmountInput={tradeOfferAmountInput}
      onOfferAmountInputChange={(value) => setTradeOfferAmountInput(sanitizeTokenAmountInput(value))}
      requestAmountInput={tradeRequestAmountInput}
      onRequestAmountInputChange={(value) => setTradeRequestAmountInput(sanitizeTokenAmountInput(value))}
      offerAmountError={tradeComposerModel.tradeComposerFieldErrors.offerAmount}
      requestAmountError={tradeComposerModel.tradeComposerFieldErrors.requestAmount}
      canUseMaxOfferAmount={tradeComposerModel.canUseTradeOfferMax}
      onUseMaxOfferAmount={() => setTradeOfferAmountInput(tradeComposerModel.tradeOfferMaxInputValue)}
      offerAmountSummaryLabel={tradeComposerModel.tradeOfferAmountSummaryLabel}
      requestAmountSummaryLabel={tradeComposerModel.tradeRequestAmountSummaryLabel}
      offerBalanceSummaryLabel={tradeComposerModel.tradeOfferBalanceSummaryLabel}
      onSwapSides={() => {
        const nextOfferToken = tradeRequestTokenSelection;
        const nextRequestToken = tradeOfferTokenSelection;
        const nextOfferCustomAddress = tradeRequestCustomTokenAddress;
        const nextRequestCustomAddress = tradeOfferCustomTokenAddress;
        const nextOfferAmount = tradeRequestAmountInput;
        const nextRequestAmount = tradeOfferAmountInput;
        setTradeOfferTokenSelection(nextOfferToken);
        setTradeRequestTokenSelection(nextRequestToken);
        setTradeOfferCustomTokenAddress(nextOfferCustomAddress);
        setTradeRequestCustomTokenAddress(nextRequestCustomAddress);
        setTradeOfferAmountInput(nextOfferAmount);
        setTradeRequestAmountInput(nextRequestAmount);
      }}
      swapDisabled={creatingTrade}
      tradePreviewLabel={tradeComposerModel.tradePreviewLabel}
      tradeRateLabel={tradeComposerModel.tradeRateLabel}
      expiresHoursInput={tradeExpiryHoursInput}
      onExpiresHoursInputChange={(value) => setTradeExpiryHoursInput(value.replace(/[^0-9]/g, ''))}
      expiryError={tradeComposerModel.tradeComposerFieldErrors.expiry}
      sending={creatingTrade}
      canSend={tradeComposerModel.canSendTradeOffer}
      onSendTradeOffer={() => {
        createTrade().catch(() => {});
      }}
      generalError={tradeComposerModel.tradeComposerFieldErrors.general}
      validationMessage={tradeComposerModel.tradeComposerValidationMessage || undefined}
    />
  );

  const renderTradeOverviewCard = (trade: TradeSnapshot) => {
    const perspective = resolveTradePerspective(trade, walletAddress);
    const canCounter = trade.isPublic === false && walletKey.length > 0 && !perspective.isMaker && trade.status === 'open';
    const accessSecret =
      route.tradeId === trade.tradeId && resolvedRouteAccessSecret
        ? resolvedRouteAccessSecret
        : resolveKnownTradeAccessSecret(trade.tradeId);
    const shareUrl =
      trade.isPublic === false && trade.hasAccessHash && !accessSecret
        ? ''
        : buildTradeShareUrl(trade.tradeId, accessSecret || undefined);
    const shareKey = `offer-trade-link:${trade.tradeId}:${accessSecret ? 'secret' : 'public'}`;
    const pairLabel = `${trade.offer.symbol} / ${trade.request.symbol}`;
    const visibilityLabel =
      trade.isPublic === false
        ? trade.hasAccessHash
          ? accessSecret
            ? 'Private link saved'
            : 'Private link'
          : 'Direct offer'
        : 'Public listing';
    const takerLabel = isZeroTradeTakerAddress(trade.taker) ? 'Any wallet' : shortenAddress(trade.taker);
    const statusLabel =
      trade.status === 'open'
        ? 'Active'
        : trade.status === 'unknown'
          ? 'Unknown'
          : trade.status.charAt(0).toUpperCase() + trade.status.slice(1);
    const statusClassName = `p2p-offer-status-${trade.status}`;
    const offerExplorerUrl = buildTradeAssetExplorerUrl(trade.offer);
    const requestExplorerUrl = buildTradeAssetExplorerUrl(trade.request);
    const acceptedTxExplorerUrl = buildTransactionExplorerUrl(trade.acceptedTxHash);
    const isFinishedTrade = trade.status !== 'open';
    const offerToneClass = `p2p-offer-term-${perspective.offerSide.tone}`;
    const requestToneClass = `p2p-offer-term-${perspective.requestSide.tone}`;

    return (
      <article key={trade.tradeId} className={`p2p-offer-card p2p-offer-card-${trade.status}`}>
        <div className="p2p-offer-card-head">
          <div className="p2p-offer-title">
            <h3 title={formatTradeListTerms(trade)}>{pairLabel}</h3>
            <p>
              #{trade.tradeId}
              <span>{trade.parentTradeId ? `Counter to #${trade.parentTradeId}` : visibilityLabel}</span>
            </p>
          </div>
          <strong className={`p2p-offer-status ${statusClassName}`}>{statusLabel}</strong>
        </div>

        <div className="p2p-offer-terms" aria-label={formatTradeListTerms(trade)}>
          <div className={`p2p-offer-term p2p-offer-term-offered ${offerToneClass}`}>
            <span>{perspective.offerSide.label}</span>
            <strong>{formatTradeAssetDisplayText(trade.offer)}</strong>
            <small>{trade.status === 'open' ? 'Available now' : statusLabel}</small>
            {offerExplorerUrl ? (
              <a className="p2p-offer-token-link" href={offerExplorerUrl} target="_blank" rel="noreferrer">
                Token Explorer
              </a>
            ) : null}
          </div>
          <div className="p2p-offer-term-link" aria-hidden="true">
            for
          </div>
          <div className={`p2p-offer-term p2p-offer-term-requested ${requestToneClass}`}>
            <span>{perspective.requestSide.label}</span>
            <strong>{formatTradeAssetDisplayText(trade.request)}</strong>
            <small>{takerLabel}</small>
            {requestExplorerUrl ? (
              <a className="p2p-offer-token-link" href={requestExplorerUrl} target="_blank" rel="noreferrer">
                Token Explorer
              </a>
            ) : null}
          </div>
        </div>

        <div className="p2p-offer-facts">
          <div>
            <span>Rate</span>
            <strong>{formatTradeRateText(trade)}</strong>
          </div>
          <div>
            <span>Expires</span>
            <strong>{formatMessageTimestamp(trade.expiresAt)}</strong>
          </div>
          <div>
            <span>Access</span>
            <strong>{visibilityLabel}</strong>
          </div>
        </div>

        {isFinishedTrade ? (
          <div className="p2p-offer-parties">
            <div>
              <span>Maker</span>
              <strong>{shortenAddress(trade.maker)}</strong>
            </div>
            <div>
              <span>Taker</span>
              <strong>{isZeroTradeTakerAddress(trade.taker) ? 'Unfilled' : shortenAddress(trade.taker)}</strong>
            </div>
          </div>
        ) : null}

        <div className="p2p-offer-footer">
          {isFinishedTrade ? (
            <>
              <span className="p2p-offer-final-state">
                {statusLabel} trade #{trade.tradeId}
                {acceptedTxExplorerUrl ? ' with on-chain settlement' : ''}
              </span>
              {acceptedTxExplorerUrl ? (
                <a className="p2p-offer-footer-link" href={acceptedTxExplorerUrl} target="_blank" rel="noreferrer">
                  View Tx
                </a>
              ) : null}
            </>
          ) : (
            <>
              <span>{perspective.isMaker ? 'Created by you' : perspective.isTaker ? 'Reserved for you' : 'Ready to open'}</span>
              <div>
                <button type="button" onClick={() => openTradeSnapshot(trade)} title="Open trade">
                  Open
                </button>
                {shareUrl ? (
                  <button
                    type="button"
                    className={lastCopiedKey === shareKey ? 'copied' : undefined}
                    onClick={() => copyWithFeedback(shareUrl, shareKey).catch(() => {})}
                    title={accessSecret ? 'Copy private trade link' : 'Copy trade link'}
                  >
                    {lastCopiedKey === shareKey ? 'Copied' : 'Copy'}
                  </button>
                ) : null}
                {canCounter ? (
                  <button type="button" className="p2p-offer-counter-btn" onClick={() => beginCounterTrade(trade)}>
                    Counter
                  </button>
                ) : null}
                {perspective.isMaker ? (
                  <button
                    type="button"
                    className="p2p-offer-cancel-btn"
                    onClick={() => cancelTrade(trade).catch(() => {})}
                    disabled={processingTradeActionId === String(trade.tradeId)}
                  >
                    {processingTradeActionId === String(trade.tradeId) ? 'Cancelling...' : 'Cancel'}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </article>
    );
  };

  const renderTradeList = (trades: TradeSnapshot[], emptyLabel: string, gridClassName = '') =>
    trades.length > 0 ? (
      <div className={`p2p-offer-grid${gridClassName ? ` ${gridClassName}` : ''}`}>
        {trades.map((trade) => renderTradeOverviewCard(trade))}
      </div>
    ) : (
      <p className="standalone-trade-state">{emptyLabel}</p>
    );
  const walletPrimaryButtonLabel =
    connectingWalletId === 'aes'
      ? 'Signing AES...'
      : connectingWalletId
        ? 'Connecting...'
        : walletAddress && !onCotiNetwork
          ? 'Switch to COTI'
        : walletAddress && !walletHasAes
          ? 'Sign AES Key'
        : walletAddress
            ? shortenAddress(walletAddress)
            : `Connect ${preferredWalletOption?.label ?? 'Wallet'}`;
  const handleWalletPrimaryAction = () => {
    if (walletAddress && !onCotiNetwork) {
      const provider = providerRef.current;
      if (provider) {
        ensureCotiNetwork(provider).catch((error) => {
          setWalletError(getProviderErrorMessage(error, 'Failed to switch network.'));
        });
      }
      return;
    }

    if (walletAddress && !walletHasAes) {
      signAesForCurrentWallet().catch(() => {});
      return;
    }

    if (walletAddress) {
      copyWithFeedback(walletAddress, walletAddressCopyKey).catch(() => {});
      return;
    }

    connectWallet(preferredWalletOption?.id).catch(() => {});
  };
  const walletAddressCopyKey = walletAddress ? `trade-wallet-address:${walletAddress.toLowerCase()}` : '';
  const walletPrimaryButtonClass =
    !walletAddress || !onCotiNetwork || !walletHasAes
      ? 'connect-btn wallet-inline-btn wallet-primary-action'
      : 'connect-btn wallet-inline-btn';
  const walletPrimaryButtonCopied = lastCopiedKey === walletAddressCopyKey;
  const walletPrimaryButtonIsAddress = Boolean(walletAddress && onCotiNetwork && walletHasAes);
  const filteredPublicTrades = useMemo(
    () => publicTrades.filter((trade) => matchesTradeSearch(trade, tradeSearchInput)),
    [publicTrades, tradeSearchInput]
  );
  const filteredMyTrades = useMemo(
    () => myTrades.filter((trade) => matchesTradeSearch(trade, tradeSearchInput)),
    [myTrades, tradeSearchInput]
  );
  const walletTradeGroups = useMemo(
    () => groupWalletTradesByPerspective(filteredMyTrades, walletAddress),
    [filteredMyTrades, walletAddress]
  );
  const receivedOpenTradeOffers = walletTradeGroups.needsAction;
  const myOpenTrades = walletTradeGroups.myActiveOffers;
  const walletTradeHistory = walletTradeGroups.history;
  const myTradeGroupOptions: Array<{
    id: MyTradeGroupView;
    label: string;
    count: number;
    trades: TradeSnapshot[];
    emptyMessage: string;
    emptySearchMessage: string;
  }> = [
    {
      id: 'received',
      label: 'Received Offers',
      count: receivedOpenTradeOffers.length,
      trades: receivedOpenTradeOffers,
      emptyMessage: 'No trade offers waiting for you.',
      emptySearchMessage: 'No received offers match that search.'
    },
    {
      id: 'active',
      label: 'My Active Trades',
      count: myOpenTrades.length,
      trades: myOpenTrades,
      emptyMessage: 'No active trades created by you.',
      emptySearchMessage: 'No trades you created match that search.'
    },
    {
      id: 'history',
      label: 'Trade History',
      count: walletTradeHistory.length,
      trades: walletTradeHistory,
      emptyMessage: 'No completed, cancelled, or declined trades yet.',
      emptySearchMessage: 'No history matches that search.'
    }
  ];
  const selectedMyTradeGroup =
    myTradeGroupOptions.find((group) => group.id === myTradeGroupView) ?? myTradeGroupOptions[0];
  const tradeSearchPlaceholder =
    route.view === 'mine'
      ? 'Search your trades by token, wallet, status, or id'
      : 'Search public offers by token, pair, wallet, status, or id';
  const createdTradeCopyKey = 'created-trade-link';

  return (
    <main className="standalone-trades-shell p2p-trading-shell">
      <section className="p2p-trading-topbar">
        <nav className="p2p-trade-tabs" aria-label="P2P trade views">
          <button type="button" className={route.view === 'public' ? 'active' : undefined} onClick={() => navigateToTradePath('/trades')}>
            <span>Browse Offers</span>
          </button>
          <button
            type="button"
            className={route.view === 'create' ? 'active' : undefined}
            onClick={() => {
              clearCounterTrade();
              navigateToTradePath('/trades/create');
            }}
          >
            <span>Create Trade</span>
          </button>
          <button type="button" className={route.view === 'trade' ? 'active' : undefined} onClick={() => navigateToTradePath('/trades/open')}>
            <span>Open Trade</span>
          </button>
          <button type="button" className={route.view === 'mine' ? 'active' : undefined} onClick={() => navigateToTradePath('/trades/mine')}>
            <span>My Trades</span>
          </button>
        </nav>

        <div className="p2p-wallet-panel">
          <div className="p2p-wallet-compact">
            <button
              type="button"
              className={walletPrimaryButtonCopied ? `${walletPrimaryButtonClass} copied` : walletPrimaryButtonClass}
              onClick={handleWalletPrimaryAction}
              disabled={Boolean(connectingWalletId) || (!walletAddress && !preferredWalletOption)}
              title={walletAddress || undefined}
            >
              {walletPrimaryButtonIsAddress ? (
                <>
                  <span>{walletPrimaryButtonLabel}</span>
                  <small>{walletPrimaryButtonCopied ? 'Copied' : 'Copy'}</small>
                </>
              ) : (
                walletPrimaryButtonLabel
              )}
            </button>
          </div>
        </div>
      </section>

      {route.view !== 'create' ? (
        <section className={`p2p-market-overview p2p-market-overview-${route.view}`}>
          {route.view === 'public' || route.view === 'mine' ? (
            <div className="p2p-stats-strip" aria-label="P2P trading statistics">
              {route.view === 'public' ? (
                <div>
                  <span>Open offers</span>
                  <strong>{loadingPublicTrades ? '--' : openPublicTradeCount}</strong>
                </div>
              ) : null}
              {route.view === 'mine' ? (
                <>
                  <div>
                    <span>Needs action</span>
                    <strong>{receivedOpenTradeOffers.length}</strong>
                  </div>
                  <div>
                    <span>My active</span>
                    <strong>{myOpenTrades.length}</strong>
                  </div>
                  <div>
                    <span>History</span>
                    <strong>{walletTradeHistory.length}</strong>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {route.view === 'public' || route.view === 'mine' ? (
            <label className="p2p-token-search">
              <span>Search trades</span>
              <input
                type="search"
                value={tradeSearchInput}
                onChange={(event) => setTradeSearchInput(event.target.value)}
                placeholder={tradeSearchPlaceholder}
              />
            </label>
          ) : null}

          {route.view === 'trade' ? (
            <form className="p2p-link-open-form p2p-action-open-form" onSubmit={openTradeFromInput}>
              <input
                type="text"
                value={tradeLinkInput}
                onChange={(event) => setTradeLinkInput(event.target.value)}
                placeholder="Paste trade link, compact code, or id"
                aria-label="Trade link, compact code, or trade id"
              />
              <button type="submit">Open Trade</button>
            </form>
          ) : null}

          {walletError || tradeActionError ? <p className="error p2p-market-status">{walletError || tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'public' ? (
        <section className="standalone-trades-section p2p-public-trades-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Directory</p>
              <h2>Open public trades</h2>
            </div>
            <div className="standalone-trades-toolbar">
              <button type="button" className="standalone-trade-secondary-btn" onClick={() => refreshPublicTrades().catch(() => {})}>
                {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
          {publicTradesError ? <p className="standalone-trade-error">{publicTradesError}</p> : null}
          {loadingPublicTrades && publicTrades.length === 0 ? <p className="standalone-trade-state">Loading public trades...</p> : null}
          {!loadingPublicTrades
            ? renderTradeList(
                filteredPublicTrades,
                tradeSearchInput ? 'No public trades match that search.' : 'No open public trades found.',
                'p2p-public-trade-grid'
              )
            : null}
        </section>
      ) : null}

      {route.view === 'create' ? (
        <section className="standalone-trade-create-panel">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Create</p>
              <h2>New trade</h2>
            </div>
            <div className="standalone-trade-visibility" role="group" aria-label="Trade visibility">
              <button
                type="button"
                className={tradeVisibility === 'public' ? 'active' : undefined}
                onClick={() => setTradeVisibility('public')}
                aria-pressed={tradeVisibility === 'public'}
              >
                Public
              </button>
              <button
                type="button"
                className={tradeVisibility === 'unlisted' ? 'active' : undefined}
                onClick={() => setTradeVisibility('unlisted')}
                aria-pressed={tradeVisibility === 'unlisted'}
              >
                Private Link
              </button>
              <button
                type="button"
                className={tradeVisibility === 'direct' ? 'active' : undefined}
                onClick={() => setTradeVisibility('direct')}
                aria-pressed={tradeVisibility === 'direct'}
              >
                Direct
              </button>
            </div>
          </div>
          {tradeVisibility === 'direct' ? (
            <label className="standalone-trade-recipient p2p-direct-recipient">
              <span>Recipient wallet</span>
              <input
                type="text"
                value={directTradeRecipient}
                onChange={(event) => setDirectTradeRecipient(event.target.value)}
                placeholder="0x..."
                aria-invalid={directTradeRecipientNormalized && !directTradeRecipientIsValid ? 'true' : 'false'}
              />
            </label>
          ) : null}
          <div className="standalone-trade-access-summary">
            <span>Access</span>
            <strong>
              {tradeVisibility === 'public'
                ? 'Listed publicly while open'
                : tradeVisibility === 'direct'
                  ? directTradeRecipientIsValid
                    ? `Sent to ${shortenAddress(directTradeRecipientNormalized)}`
                    : 'Visible in the recipient wallet inbox'
                  : 'Full private link required to accept'}
            </strong>
            <p>
              {tradeVisibility === 'direct'
                ? 'Direct trades are not public listings. The recipient can find the offer under received trades.'
                : 'Unlisted trades are not shown in the public directory. On-chain terms remain public to direct contract reads.'}
            </p>
          </div>
          {tradeComposer}
          {createdTradeLink ? (
            <div className="standalone-trade-created">
              <div>
                <span>Trade {createdTradeId ? 'created' : 'ready'}</span>
                <strong>{createdTradeLink.replace(/^https?:\/\//, '')}</strong>
              </div>
              <button
                type="button"
                className={lastCopiedKey === createdTradeCopyKey ? 'copied' : undefined}
                onClick={() => copyWithFeedback(createdTradeLink, createdTradeCopyKey).catch(() => {})}
              >
                {lastCopiedKey === createdTradeCopyKey
                  ? 'Copied'
                  : tradeVisibility === 'unlisted'
                    ? 'Copy Private Link'
                    : tradeVisibility === 'direct'
                      ? 'Copy Trade Link'
                      : 'Copy Link'}
              </button>
            </div>
          ) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'trade' ? (
        <section className="standalone-trades-section standalone-trade-detail-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Trade Window</p>
              <h2>{route.tradeId ? 'Review trade' : 'Open a trade link'}</h2>
            </div>
            <button type="button" className="standalone-trade-secondary-btn" onClick={() => navigateToTradePath('/trades')}>
              Browse Public
            </button>
          </div>
          {counterParentTrade ? (
            <div className="p2p-counter-panel" ref={counterPanelRef} tabIndex={-1}>
              <div className="p2p-counter-panel-head">
                <div>
                  <p className="landing-eyebrow">Counter Offer</p>
                  <h3>Reply with new terms</h3>
                </div>
                <button type="button" className="standalone-trade-secondary-btn" onClick={clearCounterTrade}>
                  Close Counter
                </button>
              </div>
              <p className="p2p-counter-note">
                This creates a linked private trade for the original maker. They can accept it from My Trades or the copied link.
              </p>
              {tradeComposer}
            </div>
          ) : null}
          {createdTradeLink && createdTradeId === route.tradeId ? (
            <div className="standalone-trade-created">
              <div>
                <span>Trade #{createdTradeId}</span>
                <strong>{resolvedRouteAccessSecret ? 'Private link ready' : 'Share link ready'}</strong>
              </div>
              <button
                type="button"
                className={lastCopiedKey === createdTradeCopyKey ? 'copied' : undefined}
                onClick={() => copyWithFeedback(createdTradeLink, createdTradeCopyKey).catch(() => {})}
              >
                {lastCopiedKey === createdTradeCopyKey ? 'Copied' : resolvedRouteAccessSecret ? 'Copy Private Link' : 'Copy Link'}
              </button>
            </div>
          ) : null}
          {route.routeError || detailTradeError ? <p className="standalone-trade-error">{route.routeError || detailTradeError}</p> : null}
          {loadingDetailTrade ? <p className="standalone-trade-state">Loading trade...</p> : null}
          {!loadingDetailTrade && tradeAccessBlocked ? (
            <div className="standalone-trade-state p2p-private-link-state">
              <strong>Private link required</strong>
              <span>Open the full shared link, not only the trade id.</span>
            </div>
          ) : null}
          {!loadingDetailTrade && !tradeAccessBlocked && detailTrade ? renderTradeCard(detailTrade) : null}
          {!loadingDetailTrade && !detailTrade && !tradeAccessBlocked && !route.routeError && !detailTradeError ? (
            <p className="standalone-trade-state">Paste a trade link or open a public trade from the directory.</p>
          ) : null}
          {tradeActionError ? <p className="standalone-trade-error">{tradeActionError}</p> : null}
        </section>
      ) : null}

      {route.view === 'mine' ? (
        <section className="standalone-trades-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Wallet</p>
              <h2>My trades</h2>
              {walletAddress ? (
                <p className="p2p-wallet-trade-summary">
                  {receivedOpenTradeOffers.length} received offers | {myOpenTrades.length} active trades | {walletTradeHistory.length} history
                </p>
              ) : null}
            </div>
            <button type="button" className="standalone-trade-secondary-btn" onClick={() => refreshMyTrades().catch(() => {})} disabled={!walletAddress}>
              {loadingMyTrades ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          {!walletAddress ? <p className="standalone-trade-state">Connect a wallet to view your trades.</p> : null}
          {myTradesError ? <p className="standalone-trade-error">{myTradesError}</p> : null}
          {walletAddress && loadingMyTrades && myTrades.length === 0 ? <p className="standalone-trade-state">Loading your trades...</p> : null}
          {walletAddress && !loadingMyTrades ? (
            <div className="p2p-wallet-trade-groups">
              <div className="p2p-wallet-trade-switcher" role="tablist" aria-label="My trade groups">
                {myTradeGroupOptions.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className={group.id === selectedMyTradeGroup.id ? 'active' : undefined}
                    onClick={() => setMyTradeGroupView(group.id)}
                    role="tab"
                    aria-selected={group.id === selectedMyTradeGroup.id}
                  >
                    <span>{group.label}</span>
                    <strong>{group.count}</strong>
                  </button>
                ))}
              </div>
              <section className="p2p-wallet-trade-group" role="tabpanel">
                {renderTradeList(
                  selectedMyTradeGroup.trades,
                  tradeSearchInput ? selectedMyTradeGroup.emptySearchMessage : selectedMyTradeGroup.emptyMessage,
                  'p2p-wallet-trade-grid'
                )}
              </section>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="p2p-footer-links">
        <span>
          Balance: {nativeBalanceWei !== null ? `${formatCotiAmount(nativeBalanceWei)} ${TIP_NATIVE_TOKEN_SYMBOL}` : '--'} |{' '}
          {rewardTokenBalanceWei !== null ? `${formatTokenAmount(rewardTokenBalanceWei, rewardTokenDecimals, 4)} ${rewardTokenSymbol}` : `-- ${rewardTokenSymbol}`} |{' '}
          {privateRewardTokenBalanceWei !== null
            ? `${formatTokenAmount(privateRewardTokenBalanceWei, privateRewardTokenDecimals, 4)} ${privateRewardTokenSymbol}`
            : `-- ${privateRewardTokenSymbol}`}
        </span>
        <a href={`${COTI_NETWORK.blockExplorerUrl}/address/${TRADE_ESCROW_CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
          Escrow contract
        </a>
      </div>
    </main>
  );
}
