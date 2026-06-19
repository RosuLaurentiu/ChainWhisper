import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildTradeSnapshotKey,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  withTimeout,
  type TradeSnapshot
} from '../lib/appShared/core';
import {
  fetchRecentTradeSnapshots,
  fetchTradeAccessMetadataById,
  fetchTradeSnapshotById,
  fetchWalletTradeSnapshots,
  resolveTradeEscrowContractConfig
} from '../lib/appChain';
import type { TradePageView } from './useP2PTradeRoute';
import { getWalletTransactionFlowState } from '../lib/walletTransactionFlow';
import {
  buildWalletReadAccountsKey,
  mergeWalletAccountMatches,
  type WalletReadAccount
} from '../lib/walletAccountScope';

const TRADE_DETAIL_LOAD_TIMEOUT_MS = 18_000;
const PUBLIC_TRADE_EMPTY_RETRY_DELAY_MS = 1_200;
const PUBLIC_TRADE_EMPTY_RETRY_LIMIT = 2;
const WALLET_FLOW_LIST_REFRESH_RETRY_MS = 450;
const P2P_TRADE_DATA_WARM_CACHE_TTL_MS = 5 * 60 * 1000;

const shouldHoldTradeReadForWalletFlow = (silent: boolean, hasExistingData: boolean): boolean => {
  const flowState = getWalletTransactionFlowState();
  return flowState === 'memory-active' || (flowState === 'stored-handoff' && (silent || hasExistingData));
};

const getSnapshotKey = (snapshot: Pick<TradeSnapshot, 'tradeId' | 'escrowContract'>): string =>
  buildTradeSnapshotKey(snapshot.tradeId, snapshot.escrowContract);

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

const hasEntries = <T,>(value?: T[]): boolean => Boolean(value?.length);

const waitForPublicTradeRetry = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, PUBLIC_TRADE_EMPTY_RETRY_DELAY_MS);
  });

const isDirectEscrowSnapshot = (snapshot: Pick<TradeSnapshot, 'escrowContract'>): boolean =>
  snapshot.escrowContract?.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

const normalizeWalletKey = (walletKey?: string): string => walletKey?.trim().toLowerCase() ?? '';

const stripWalletScopedTradeSnapshot = (snapshot: TradeSnapshot): TradeSnapshot => {
  const stripped: TradeSnapshot = {
    ...snapshot,
    offer: isDirectEscrowSnapshot(snapshot) ? { ...snapshot.offer, amount: '0' } : snapshot.offer,
    request: isDirectEscrowSnapshot(snapshot) ? { ...snapshot.request, amount: '0' } : snapshot.request,
    fillState: isDirectEscrowSnapshot(snapshot) ? undefined : snapshot.fillState,
    hiddenLiquidity: isDirectEscrowSnapshot(snapshot) ? true : snapshot.hiddenLiquidity,
    makerPrivateProgress: undefined,
    privateFillReceipts: undefined,
    walletFillState: undefined,
    walletHasFill: undefined
  };

  if (snapshot.recurringOrder) {
    stripped.recurringOrder = {
      ...snapshot.recurringOrder,
      makerPrivateInventory: undefined,
      privateExecutions: undefined,
      publicExecutions: undefined
    };
  }

  return stripped;
};

const filterWalletScopedTradeSnapshot = (snapshot: TradeSnapshot, walletKey?: string): TradeSnapshot => {
  const normalizedWalletKey = normalizeWalletKey(walletKey);
  if (!normalizedWalletKey) {
    return stripWalletScopedTradeSnapshot(snapshot);
  }

  const makerKey = snapshot.maker.toLowerCase();
  const takerKey = snapshot.taker.toLowerCase();
  const isMaker = makerKey === normalizedWalletKey;
  const isDirectParticipant = isDirectEscrowSnapshot(snapshot) && (isMaker || takerKey === normalizedWalletKey);
  const privateFillReceipts = isMaker
    ? snapshot.privateFillReceipts
    : (snapshot.privateFillReceipts ?? []).filter((receipt) => receipt.filler?.toLowerCase() === normalizedWalletKey);
  const hasPrivateFillReceipts = hasEntries(privateFillReceipts);
  const walletFillState = !isMaker && snapshot.walletHasFill ? snapshot.walletFillState : undefined;
  const walletHasFill = isMaker
    ? snapshot.walletHasFill || hasPrivateFillReceipts
      ? true
      : undefined
    : snapshot.walletHasFill && (walletFillState || hasPrivateFillReceipts)
      ? true
      : undefined;

  const filtered: TradeSnapshot = {
    ...snapshot,
    offer: isDirectEscrowSnapshot(snapshot) && !isDirectParticipant ? { ...snapshot.offer, amount: '0' } : snapshot.offer,
    request: isDirectEscrowSnapshot(snapshot) && !isDirectParticipant ? { ...snapshot.request, amount: '0' } : snapshot.request,
    fillState: isDirectEscrowSnapshot(snapshot) && !isDirectParticipant ? undefined : snapshot.fillState,
    hiddenLiquidity: isDirectEscrowSnapshot(snapshot) && !isDirectParticipant ? true : snapshot.hiddenLiquidity,
    makerPrivateProgress: isMaker ? snapshot.makerPrivateProgress : undefined,
    privateFillReceipts: hasPrivateFillReceipts ? privateFillReceipts : undefined,
    walletFillState,
    walletHasFill
  };

  if (snapshot.recurringOrder) {
    const privateExecutions = isMaker
      ? snapshot.recurringOrder.privateExecutions
      : (snapshot.recurringOrder.privateExecutions ?? []).filter(
          (execution) => execution.filler?.toLowerCase() === normalizedWalletKey
        );
    const publicExecutions = isMaker
      ? snapshot.recurringOrder.publicExecutions
      : (snapshot.recurringOrder.publicExecutions ?? []).filter(
          (execution) => execution.filler?.toLowerCase() === normalizedWalletKey
        );
    filtered.recurringOrder = {
      ...snapshot.recurringOrder,
      makerPrivateInventory: isMaker ? snapshot.recurringOrder.makerPrivateInventory : undefined,
      privateExecutions: hasEntries(privateExecutions) ? privateExecutions : undefined,
      publicExecutions: hasEntries(publicExecutions) ? publicExecutions : undefined
    };
    if (!isMaker && (hasEntries(privateExecutions) || hasEntries(publicExecutions))) {
      filtered.walletHasFill = true;
    }
  }

  return filtered;
};

const mergeTradeSnapshotEnrichment = (
  incoming: TradeSnapshot,
  existing?: TradeSnapshot | null,
  walletKey?: string
): TradeSnapshot => {
  const shouldApplyWalletScope = walletKey !== undefined;
  const walletScopedIncoming = shouldApplyWalletScope ? filterWalletScopedTradeSnapshot(incoming, walletKey) : incoming;
  const walletScopedExisting =
    existing && shouldApplyWalletScope ? filterWalletScopedTradeSnapshot(existing, walletKey) : existing;

  if (!walletScopedExisting || getSnapshotKey(walletScopedExisting) !== getSnapshotKey(walletScopedIncoming)) {
    return mergeWalletAccountMatches(walletScopedExisting, walletScopedIncoming);
  }

  const merged: TradeSnapshot = {
    ...walletScopedIncoming,
    walletHasFill: Boolean(walletScopedIncoming.walletHasFill || walletScopedExisting.walletHasFill) || undefined,
    walletFillState: walletScopedIncoming.walletFillState ?? walletScopedExisting.walletFillState,
    makerPrivateProgress: walletScopedIncoming.makerPrivateProgress ?? walletScopedExisting.makerPrivateProgress,
    privateFillReceipts:
      hasEntries(walletScopedIncoming.privateFillReceipts) || !hasEntries(walletScopedExisting.privateFillReceipts)
        ? walletScopedIncoming.privateFillReceipts
        : walletScopedExisting.privateFillReceipts
  };

  if (walletScopedIncoming.recurringOrder && walletScopedExisting.recurringOrder) {
    const incomingPrivateInventory = walletScopedIncoming.recurringOrder.makerPrivateInventory;
    const existingPrivateInventory = walletScopedExisting.recurringOrder.makerPrivateInventory;
    merged.recurringOrder = {
      ...walletScopedIncoming.recurringOrder,
      makerPrivateInventory:
        incomingPrivateInventory || existingPrivateInventory
          ? {
              ...existingPrivateInventory,
              ...incomingPrivateInventory
            }
          : undefined,
      privateExecutions:
        hasEntries(walletScopedIncoming.recurringOrder.privateExecutions) ||
        !hasEntries(walletScopedExisting.recurringOrder.privateExecutions)
          ? walletScopedIncoming.recurringOrder.privateExecutions
          : walletScopedExisting.recurringOrder.privateExecutions,
      publicExecutions:
        hasEntries(walletScopedIncoming.recurringOrder.publicExecutions) ||
        !hasEntries(walletScopedExisting.recurringOrder.publicExecutions)
          ? walletScopedIncoming.recurringOrder.publicExecutions
          : walletScopedExisting.recurringOrder.publicExecutions
    };
  }

  return mergeWalletAccountMatches(walletScopedExisting, merged);
};

const annotateTradeSnapshotForAccount = (snapshot: TradeSnapshot, account: WalletReadAccount): TradeSnapshot => ({
  ...snapshot,
  accountAddress: account.address,
  accountRole: account.role,
  accountMatches: [
    {
      address: account.address,
      role: account.role
    }
  ]
});

const mergeAccountScopedSnapshot = (
  incoming: TradeSnapshot,
  existing: TradeSnapshot | undefined,
  accountKey: string
): TradeSnapshot => {
  const merged = mergeTradeSnapshotEnrichment(incoming, existing, accountKey);
  if (existing?.accountRole === 'chainwhisper' && incoming.accountRole === 'owner') {
    return {
      ...merged,
      accountAddress: existing.accountAddress,
      accountRole: existing.accountRole
    };
  }
  return merged;
};

const mergeTradeSnapshotList = (
  incoming: TradeSnapshot[],
  existing: TradeSnapshot[],
  walletKey?: string
): TradeSnapshot[] => {
  const existingByKey = new Map(existing.map((trade) => [getSnapshotKey(trade), trade]));
  return incoming.map((trade) => mergeTradeSnapshotEnrichment(trade, existingByKey.get(getSnapshotKey(trade)), walletKey));
};

const mergePublicTradeRefresh = (
  incoming: TradeSnapshot[],
  existing: TradeSnapshot[],
  silent: boolean,
  walletKey?: string
): TradeSnapshot[] => {
  if (silent && existing.length > 0 && incoming.length === 0) {
    return walletKey === undefined
      ? existing
      : existing.map((trade) => filterWalletScopedTradeSnapshot(trade, walletKey));
  }

  return sortTrades(mergeTradeSnapshotList(incoming, existing, walletKey));
};

export const __mergeTradeSnapshotEnrichmentForTest = mergeTradeSnapshotEnrichment;
export const __mergePublicTradeRefreshForTest = mergePublicTradeRefresh;
export const __filterWalletScopedTradeSnapshotForTest = filterWalletScopedTradeSnapshot;
export const __stripWalletScopedTradeSnapshotForTest = stripWalletScopedTradeSnapshot;

type TokenMetadata = {
  privateRewardTokenDecimals: number;
  privateRewardTokenSymbol: string;
  rewardTokenDecimals: number;
  rewardTokenSymbol: string;
};

type TradeRefreshOptions = {
  silent?: boolean;
};

type UseP2PTradeDataArgs = TokenMetadata & {
  enrichMakerPrivateProgress: (snapshot: TradeSnapshot, forceReveal?: boolean) => Promise<TradeSnapshot>;
  resolvedRouteAccessSecret: string;
  routeError: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: TradePageView;
  syncSessionKey: string;
  walletAddress: string;
  walletKey: string;
  walletReadAccounts?: WalletReadAccount[];
};

type UseP2PTradeDataResult = {
  clearMyTrades: () => void;
  detailTrade: TradeSnapshot | null;
  detailTradeError: string;
  hasActiveListRefresh: () => boolean;
  loadingDetailTrade: boolean;
  loadingMyTrades: boolean;
  loadingPublicTrades: boolean;
  mergeTradeSnapshot: (snapshot: TradeSnapshot) => void;
  myTrades: TradeSnapshot[];
  myTradesError: string;
  publicTrades: TradeSnapshot[];
  publicTradesError: string;
  refreshMyTrades: (options?: TradeRefreshOptions) => Promise<void>;
  refreshPublicTrades: (options?: TradeRefreshOptions) => Promise<void>;
  readTradeDetail: (tradeId: number, escrowContract?: string) => Promise<TradeSnapshot | null>;
  refreshTradeDetail: (tradeId: number, escrowContract?: string, options?: TradeRefreshOptions) => Promise<TradeSnapshot | null>;
  setDetailTrade: Dispatch<SetStateAction<TradeSnapshot | null>>;
  setDetailTradeError: Dispatch<SetStateAction<string>>;
  tradeAccessBlocked: boolean;
};

type P2PTradeDataWarmCacheEntry = {
  detailTrade: TradeSnapshot | null;
  detailTradeError: string;
  myTrades: TradeSnapshot[];
  myTradesError: string;
  publicTrades: TradeSnapshot[];
  publicTradesError: string;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: TradePageView;
  tradeAccessBlocked: boolean;
  updatedAt: number;
};

const p2pTradeDataWarmCacheBySession = new Map<string, P2PTradeDataWarmCacheEntry>();

const readP2PTradeDataWarmCache = (syncSessionKey: string): P2PTradeDataWarmCacheEntry | null => {
  const cached = p2pTradeDataWarmCacheBySession.get(syncSessionKey);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > P2P_TRADE_DATA_WARM_CACHE_TTL_MS) {
    p2pTradeDataWarmCacheBySession.delete(syncSessionKey);
    return null;
  }
  return cached;
};

const cachedRouteMatches = (
  cached: P2PTradeDataWarmCacheEntry | null,
  routeView: TradePageView,
  routeTradeId: number | null,
  routeEscrowContract?: string
): boolean =>
  Boolean(
    cached &&
      cached.routeView === routeView &&
      cached.routeTradeId === routeTradeId &&
      (cached.routeEscrowContract ?? '').toLowerCase() === (routeEscrowContract ?? '').toLowerCase()
  );

export default function useP2PTradeData({
  enrichMakerPrivateProgress,
  privateRewardTokenDecimals,
  privateRewardTokenSymbol,
  resolvedRouteAccessSecret,
  rewardTokenDecimals,
  rewardTokenSymbol,
  routeError,
  routeEscrowContract,
  routeTradeId,
  routeView,
  syncSessionKey,
  walletAddress,
  walletKey,
  walletReadAccounts = []
}: UseP2PTradeDataArgs): UseP2PTradeDataResult {
  const initialWarmCache = readP2PTradeDataWarmCache(syncSessionKey);
  const initialWarmCacheRouteMatches = cachedRouteMatches(
    initialWarmCache,
    routeView,
    routeTradeId,
    routeEscrowContract
  );
  const [publicTrades, setPublicTrades] = useState<TradeSnapshot[]>(() => initialWarmCache?.publicTrades ?? []);
  const [myTrades, setMyTrades] = useState<TradeSnapshot[]>(() => initialWarmCache?.myTrades ?? []);
  const [detailTrade, setDetailTrade] = useState<TradeSnapshot | null>(() =>
    initialWarmCacheRouteMatches ? initialWarmCache?.detailTrade ?? null : null
  );
  const [loadingPublicTrades, setLoadingPublicTrades] = useState(false);
  const [loadingMyTrades, setLoadingMyTrades] = useState(false);
  const [loadingDetailTrade, setLoadingDetailTrade] = useState(false);
  const [tradeAccessBlocked, setTradeAccessBlocked] = useState(() =>
    initialWarmCacheRouteMatches ? Boolean(initialWarmCache?.tradeAccessBlocked) : false
  );
  const [publicTradesError, setPublicTradesError] = useState(() => initialWarmCache?.publicTradesError ?? '');
  const [myTradesError, setMyTradesError] = useState(() => initialWarmCache?.myTradesError ?? '');
  const [detailTradeError, setDetailTradeError] = useState(() =>
    initialWarmCacheRouteMatches ? initialWarmCache?.detailTradeError ?? '' : ''
  );
  const publicTradesRefreshRef = useRef<Promise<void> | null>(null);
  const myTradesRefreshRef = useRef<Promise<void> | null>(null);
  const publicTradesRefreshQueuedRef = useRef(false);
  const myTradesRefreshQueuedRef = useRef(false);
  const myTradesRefreshQueuedSilentRef = useRef(true);
  const detailTradeRef = useRef<TradeSnapshot | null>(null);
  const publicTradesRef = useRef<TradeSnapshot[]>([]);
  const myTradesRef = useRef<TradeSnapshot[]>([]);
  const latestSyncSessionKeyRef = useRef(syncSessionKey);
  const latestWalletKeyRef = useRef(walletKey);
  const previousWalletKeyRef = useRef(walletKey);

  useEffect(() => {
    detailTradeRef.current = detailTrade;
  }, [detailTrade]);

  useEffect(() => {
    publicTradesRef.current = publicTrades;
  }, [publicTrades]);

  useEffect(() => {
    myTradesRef.current = myTrades;
  }, [myTrades]);

  useEffect(() => {
    latestSyncSessionKeyRef.current = syncSessionKey;
  }, [syncSessionKey]);

  useEffect(() => {
    latestWalletKeyRef.current = walletKey;
  }, [walletKey]);

  useEffect(() => {
    const cached = readP2PTradeDataWarmCache(syncSessionKey);
    if (!cached) {
      return;
    }

    const routeMatches = cachedRouteMatches(cached, routeView, routeTradeId, routeEscrowContract);
    setPublicTrades(cached.publicTrades);
    setMyTrades(cached.myTrades);
    setPublicTradesError(cached.publicTradesError);
    setMyTradesError(cached.myTradesError);
    setDetailTrade(routeMatches ? cached.detailTrade : null);
    setDetailTradeError(routeMatches ? cached.detailTradeError : routeError);
    setTradeAccessBlocked(routeMatches ? cached.tradeAccessBlocked : false);
  }, [routeError, routeEscrowContract, routeTradeId, routeView, syncSessionKey]);

  useEffect(() => {
    p2pTradeDataWarmCacheBySession.set(syncSessionKey, {
      detailTrade,
      detailTradeError,
      myTrades,
      myTradesError,
      publicTrades,
      publicTradesError,
      routeEscrowContract,
      routeTradeId,
      routeView,
      tradeAccessBlocked,
      updatedAt: Date.now()
    });
  }, [
    detailTrade,
    detailTradeError,
    myTrades,
    myTradesError,
    publicTrades,
    publicTradesError,
    routeEscrowContract,
    routeTradeId,
    routeView,
    syncSessionKey,
    tradeAccessBlocked
  ]);

  useEffect(() => {
    const previousWalletKey = previousWalletKeyRef.current;
    if (previousWalletKey === walletKey) {
      return;
    }
    previousWalletKeyRef.current = walletKey;
    setPublicTrades((current) => current.map(stripWalletScopedTradeSnapshot));
    setDetailTrade((current) => (current ? stripWalletScopedTradeSnapshot(current) : current));
    setMyTrades([]);
  }, [walletKey]);

  const enrichMakerPrivateProgressForList = useCallback(
    async (snapshots: TradeSnapshot[]): Promise<TradeSnapshot[]> =>
      Promise.all(snapshots.map((snapshot) => enrichMakerPrivateProgress(snapshot))),
    [enrichMakerPrivateProgress]
  );
  const latestMyTradesRefreshArgsRef = useRef({
    enrichMakerPrivateProgressForList,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletAddress,
    walletReadAccounts
  });
  useEffect(() => {
    latestMyTradesRefreshArgsRef.current = {
      enrichMakerPrivateProgressForList,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol,
      walletAddress,
      walletReadAccounts
    };
  }, [
    enrichMakerPrivateProgressForList,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    walletAddress,
    walletReadAccounts
  ]);

  const fetchPublicTradeSnapshotBatch = useCallback(
    () =>
      fetchRecentTradeSnapshots({
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        limit: 80
      }),
    [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]
  );

  const refreshPublicTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
    if (shouldHoldTradeReadForWalletFlow(silent, publicTradesRef.current.length > 0)) {
      return;
    }
    if (publicTradesRefreshRef.current) {
      publicTradesRefreshQueuedRef.current = true;
      return publicTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      do {
        const requestSessionKey = latestSyncSessionKeyRef.current || syncSessionKey;
        const requestWalletKey = latestWalletKeyRef.current;
        publicTradesRefreshQueuedRef.current = false;
        if (!silent) {
          setLoadingPublicTrades(true);
          setPublicTradesError('');
        }
        try {
          let snapshots = await fetchPublicTradeSnapshotBatch();
          for (
            let retryIndex = 0;
            !silent && snapshots.length === 0 && retryIndex < PUBLIC_TRADE_EMPTY_RETRY_LIMIT;
            retryIndex += 1
          ) {
            await waitForPublicTradeRetry();
            snapshots = await fetchPublicTradeSnapshotBatch();
          }
          if (latestSyncSessionKeyRef.current === requestSessionKey && latestWalletKeyRef.current === requestWalletKey) {
            setPublicTrades((previous) => mergePublicTradeRefresh(snapshots, previous, silent, requestWalletKey));
            if (silent) {
              setPublicTradesError('');
            }
          } else {
            publicTradesRefreshQueuedRef.current = true;
          }
        } catch {
          if (latestSyncSessionKeyRef.current !== requestSessionKey || latestWalletKeyRef.current !== requestWalletKey) {
            publicTradesRefreshQueuedRef.current = true;
          } else if (!silent) {
            setPublicTradesError('Failed to load public trades.');
          }
        } finally {
          if (!silent && !publicTradesRefreshQueuedRef.current) {
            setLoadingPublicTrades(false);
          }
        }
      } while (publicTradesRefreshQueuedRef.current);

      publicTradesRefreshRef.current = null;
    })();

    publicTradesRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [fetchPublicTradeSnapshotBatch, syncSessionKey, walletKey]);

  const refreshMyTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
    if (shouldHoldTradeReadForWalletFlow(silent, myTradesRef.current.length > 0)) {
      return;
    }
    const initialReadAccounts =
      walletReadAccounts.length > 0
        ? walletReadAccounts
        : walletAddress
          ? [
              {
                address: walletAddress,
                canReadPrivate: true,
                isActionAccount: true,
                key: normalizeWalletKey(walletAddress),
                label: 'ChainWhisper account',
                role: 'chainwhisper' as const
              }
            ]
          : [];
    if (initialReadAccounts.length === 0) {
      setMyTrades([]);
      return;
    }
    if (myTradesRefreshRef.current) {
      myTradesRefreshQueuedRef.current = true;
      myTradesRefreshQueuedSilentRef.current = myTradesRefreshQueuedSilentRef.current && silent;
      if (!silent) {
        setLoadingMyTrades(true);
        setMyTradesError('');
      }
      return myTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      let nextSilent = silent;
      do {
        const currentSilent = nextSilent;
        myTradesRefreshQueuedRef.current = false;
        myTradesRefreshQueuedSilentRef.current = true;
        const requestSessionKey = latestSyncSessionKeyRef.current || syncSessionKey;
        const {
          enrichMakerPrivateProgressForList: enrichLatestMakerPrivateProgressForList,
          privateRewardTokenDecimals: latestPrivateRewardTokenDecimals,
          privateRewardTokenSymbol: latestPrivateRewardTokenSymbol,
          rewardTokenDecimals: latestRewardTokenDecimals,
          rewardTokenSymbol: latestRewardTokenSymbol,
          walletAddress: latestWalletAddress,
          walletReadAccounts: latestWalletReadAccounts
        } = latestMyTradesRefreshArgsRef.current;
        const readAccounts =
          latestWalletReadAccounts.length > 0
            ? latestWalletReadAccounts
            : latestWalletAddress
              ? [
                  {
                    address: latestWalletAddress,
                    canReadPrivate: true,
                    isActionAccount: true,
                    key: normalizeWalletKey(latestWalletAddress),
                    label: 'ChainWhisper account',
                    role: 'chainwhisper' as const
                  }
                ]
              : [];
        if (readAccounts.length === 0) {
          setMyTrades([]);
          setMyTradesError('');
          setLoadingMyTrades(false);
          break;
        }
        const requestWalletKey = buildWalletReadAccountsKey(readAccounts);
        if (!currentSilent) {
          setLoadingMyTrades(true);
          setMyTradesError('');
        }
        try {
          const snapshotsByAccount = await Promise.all(
            readAccounts.map(async (account) => {
              const snapshotsRaw = await fetchWalletTradeSnapshots(account.address, {
                rewardTokenSymbol: latestRewardTokenSymbol,
                rewardTokenDecimals: latestRewardTokenDecimals,
                privateRewardTokenSymbol: latestPrivateRewardTokenSymbol,
                privateRewardTokenDecimals: latestPrivateRewardTokenDecimals,
                limit: 80
              });
              const snapshots = await enrichLatestMakerPrivateProgressForList(snapshotsRaw);
              return {
                account,
                snapshots: snapshots.map((snapshot) => annotateTradeSnapshotForAccount(snapshot, account))
              };
            })
          );
          const latestReadAccountsKey =
            latestMyTradesRefreshArgsRef.current.walletReadAccounts.length > 0
              ? buildWalletReadAccountsKey(latestMyTradesRefreshArgsRef.current.walletReadAccounts)
              : buildWalletReadAccountsKey([
                  {
                    address: latestMyTradesRefreshArgsRef.current.walletAddress,
                    canReadPrivate: true,
                    isActionAccount: true,
                    key: normalizeWalletKey(latestMyTradesRefreshArgsRef.current.walletAddress),
                    label: 'ChainWhisper account',
                    role: 'chainwhisper'
                  }
                ]);
          if (latestReadAccountsKey !== requestWalletKey) {
            myTradesRefreshQueuedRef.current = true;
            continue;
          }
          if (latestSyncSessionKeyRef.current === requestSessionKey) {
            const snapshotsByKey = new Map<string, TradeSnapshot>();
            for (const { account, snapshots } of snapshotsByAccount) {
              for (const snapshot of snapshots) {
                const snapshotKey = getSnapshotKey(snapshot);
                const existing = snapshotsByKey.get(snapshotKey);
                snapshotsByKey.set(snapshotKey, mergeAccountScopedSnapshot(snapshot, existing, account.key));
              }
            }
            setMyTrades((previous) => {
              const previousByKey = new Map(previous.map((trade) => [getSnapshotKey(trade), trade]));
              const incoming = Array.from(snapshotsByKey.values()).map((snapshot) => {
                const accountKey = snapshot.accountAddress?.trim().toLowerCase() || latestWalletKeyRef.current;
                return mergeAccountScopedSnapshot(snapshot, previousByKey.get(getSnapshotKey(snapshot)), accountKey);
              });
              return sortTrades(mergeTradeSnapshotList(incoming, previous, undefined));
            });
            if (currentSilent) {
              setMyTradesError('');
            }
          } else {
            myTradesRefreshQueuedRef.current = true;
          }
        } catch {
          if (!currentSilent) {
            setMyTradesError('Failed to load your trades.');
          }
        } finally {
          if (!currentSilent) {
            setLoadingMyTrades(false);
          }
        }
        nextSilent = myTradesRefreshQueuedSilentRef.current;
      } while (myTradesRefreshQueuedRef.current);

      myTradesRefreshRef.current = null;
    })();

    myTradesRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [
    enrichMakerPrivateProgressForList,
    privateRewardTokenDecimals,
    privateRewardTokenSymbol,
    rewardTokenDecimals,
    rewardTokenSymbol,
    syncSessionKey,
    walletAddress,
    walletReadAccounts
  ]);

  const mergeTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot) => {
      const snapshotKey = getSnapshotKey(snapshot);
      const existingDetail = detailTradeRef.current;
      const mergedSnapshot = mergeTradeSnapshotEnrichment(
        snapshot,
        existingDetail && getSnapshotKey(existingDetail) === snapshotKey ? existingDetail : undefined,
        walletKey
      );
      setDetailTrade((current) =>
        current && getSnapshotKey(current) === snapshotKey
          ? mergeTradeSnapshotEnrichment(mergedSnapshot, current, walletKey)
          : current
      );
      setPublicTrades((previous) => {
        const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
        const existing = previous.find((trade) => getSnapshotKey(trade) === snapshotKey);
        const nextSnapshot = mergeTradeSnapshotEnrichment(mergedSnapshot, existing, walletKey);
        if (nextSnapshot.isPublic && nextSnapshot.status === 'open') {
          return sortTrades([nextSnapshot, ...withoutCurrent]);
        }
        return sortTrades(withoutCurrent);
      });
      if (walletKey && ([mergedSnapshot.maker.toLowerCase(), mergedSnapshot.taker.toLowerCase()].includes(walletKey) || mergedSnapshot.walletHasFill)) {
        setMyTrades((previous) => {
          const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
          const existing = previous.find((trade) => getSnapshotKey(trade) === snapshotKey);
          return sortTrades([mergeTradeSnapshotEnrichment(mergedSnapshot, existing, walletKey), ...withoutCurrent]);
        });
      }
    },
    [walletKey]
  );

  const readTradeDetail = useCallback(
    async (tradeId: number, escrowContract?: string): Promise<TradeSnapshot | null> => {
      const snapshotRaw = await fetchTradeSnapshotById(tradeId, {
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        escrowContract,
        accessSecret: resolvedRouteAccessSecret || undefined,
        callerAddress: walletAddress || undefined
      });
      return enrichMakerPrivateProgress(snapshotRaw);
    },
    [
      enrichMakerPrivateProgress,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol,
      resolvedRouteAccessSecret,
      walletAddress
    ]
  );

  const refreshTradeDetail = useCallback(
    async (tradeId: number, escrowContract?: string, options?: TradeRefreshOptions): Promise<TradeSnapshot | null> => {
      const currentDetail = detailTradeRef.current;
      const hasCurrentDetail =
        Boolean(currentDetail) &&
        currentDetail?.tradeId === tradeId &&
        (currentDetail?.escrowContract ?? '').toLowerCase() === (escrowContract ?? '').toLowerCase();
      if (shouldHoldTradeReadForWalletFlow(Boolean(options?.silent), hasCurrentDetail)) {
        return detailTradeRef.current;
      }
      const snapshot = await readTradeDetail(tradeId, escrowContract);
      if (!snapshot) {
        return null;
      }
      mergeTradeSnapshot(snapshot);
      if (options?.silent) {
        setDetailTradeError('');
      }
      return snapshot;
    },
    [
      mergeTradeSnapshot,
      readTradeDetail
    ]
  );

  const clearMyTrades = useCallback(() => {
    setMyTrades([]);
  }, []);

  const hasActiveListRefresh = useCallback(
    () => Boolean(publicTradesRefreshRef.current || myTradesRefreshRef.current),
    []
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const refreshWhenWalletFlowSettles = () => {
      if (cancelled) {
        return;
      }
      const hasExistingPublicTrades = publicTradesRef.current.length > 0;
      if (shouldHoldTradeReadForWalletFlow(hasExistingPublicTrades, hasExistingPublicTrades)) {
        retryTimer = window.setTimeout(refreshWhenWalletFlowSettles, WALLET_FLOW_LIST_REFRESH_RETRY_MS);
        return;
      }
      refreshPublicTrades({ silent: hasExistingPublicTrades }).catch(() => {});
    };

    refreshWhenWalletFlowSettles();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [refreshPublicTrades]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const refreshWhenWalletFlowSettles = () => {
      if (cancelled) {
        return;
      }
      const hasExistingMyTrades = myTradesRef.current.length > 0;
      if (shouldHoldTradeReadForWalletFlow(hasExistingMyTrades, hasExistingMyTrades)) {
        retryTimer = window.setTimeout(refreshWhenWalletFlowSettles, WALLET_FLOW_LIST_REFRESH_RETRY_MS);
        return;
      }
      refreshMyTrades({ silent: hasExistingMyTrades }).catch(() => {});
    };

    refreshWhenWalletFlowSettles();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [refreshMyTrades]);

  useEffect(() => {
    if (routeView !== 'trade' || routeTradeId === null) {
      if (getWalletTransactionFlowState() !== 'inactive' && detailTradeRef.current) {
        return;
      }
      setDetailTrade(null);
      setDetailTradeError(routeError);
      setTradeAccessBlocked(false);
      setLoadingDetailTrade(false);
      return;
    }

    let cancelled = false;
    const currentDetail = detailTradeRef.current;
    const hasCurrentDetail =
      Boolean(currentDetail) &&
      currentDetail?.tradeId === routeTradeId &&
      (currentDetail?.escrowContract ?? '').toLowerCase() === (routeEscrowContract ?? '').toLowerCase();
    if (shouldHoldTradeReadForWalletFlow(hasCurrentDetail, hasCurrentDetail)) {
      return;
    }
    setLoadingDetailTrade(!hasCurrentDetail);
    if (!hasCurrentDetail) {
      setDetailTradeError('');
      setTradeAccessBlocked(false);
    }

    const loadDetail = async () => {
      try {
        const metadata = await withTimeout(
          fetchTradeAccessMetadataById(routeTradeId, routeEscrowContract),
          TRADE_DETAIL_LOAD_TIMEOUT_MS,
          'Timed out while reading trade access.'
        ).catch(() => null);

        const snapshot = await withTimeout(
          refreshTradeDetail(routeTradeId, routeEscrowContract),
          TRADE_DETAIL_LOAD_TIMEOUT_MS,
          'Timed out while loading trade.'
        );
        if (cancelled) {
          return;
        }
        if (!snapshot) {
          setDetailTrade(null);
          return;
        }
        const isParticipant =
          Boolean(walletKey) &&
          [snapshot.maker.toLowerCase(), snapshot.taker.toLowerCase()].includes(walletKey);
        const isUnlisted = metadata?.isPublic === false || snapshot.isPublic === false;
        let directVisibleRoute = false;
        try {
          directVisibleRoute = Boolean(
            resolveTradeEscrowContractConfig(routeEscrowContract || snapshot.escrowContract).directVisible
          );
        } catch {
          directVisibleRoute = false;
        }
        const routeSecretCanAuthorize = Boolean(
          resolvedRouteAccessSecret &&
            (metadata?.hasAccessHash === true || snapshot.hasAccessHash === true || directVisibleRoute)
        );
        if (isUnlisted && !routeSecretCanAuthorize && !isParticipant) {
          setTradeAccessBlocked(true);
          setDetailTrade(null);
          return;
        }
        if (!cancelled) {
          setDetailTrade((current) => mergeTradeSnapshotEnrichment(snapshot, current, walletKey));
        }
      } catch (loadError) {
        if (!cancelled && !hasCurrentDetail) {
          setDetailTradeError(loadError instanceof Error ? loadError.message : 'Trade was not found on the escrow contract.');
        }
      } finally {
        if (!cancelled && !hasCurrentDetail) {
          setLoadingDetailTrade(false);
        }
      }
    };

    loadDetail().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshTradeDetail, resolvedRouteAccessSecret, routeError, routeEscrowContract, routeTradeId, routeView, walletKey]);

  return {
    clearMyTrades,
    detailTrade,
    detailTradeError,
    hasActiveListRefresh,
    loadingDetailTrade,
    loadingMyTrades,
    loadingPublicTrades,
    mergeTradeSnapshot,
    myTrades,
    myTradesError,
    publicTrades,
    publicTradesError,
    refreshMyTrades,
    refreshPublicTrades,
    readTradeDetail,
    refreshTradeDetail,
    setDetailTrade,
    setDetailTradeError,
    tradeAccessBlocked
  };
}
