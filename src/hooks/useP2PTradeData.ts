import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildTradeSnapshotKey,
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

const TRADE_DETAIL_LOAD_TIMEOUT_MS = 18_000;

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

const mergeTradeSnapshotEnrichment = (incoming: TradeSnapshot, existing?: TradeSnapshot | null): TradeSnapshot => {
  if (!existing || getSnapshotKey(existing) !== getSnapshotKey(incoming)) {
    return incoming;
  }

  const merged: TradeSnapshot = {
    ...incoming,
    walletHasFill: Boolean(incoming.walletHasFill || existing.walletHasFill),
    walletFillState: incoming.walletFillState ?? existing.walletFillState,
    makerPrivateProgress: incoming.makerPrivateProgress ?? existing.makerPrivateProgress,
    privateFillReceipts:
      hasEntries(incoming.privateFillReceipts) || !hasEntries(existing.privateFillReceipts)
        ? incoming.privateFillReceipts
        : existing.privateFillReceipts
  };

  if (incoming.recurringOrder && existing.recurringOrder) {
    const incomingPrivateInventory = incoming.recurringOrder.makerPrivateInventory;
    const existingPrivateInventory = existing.recurringOrder.makerPrivateInventory;
    merged.recurringOrder = {
      ...incoming.recurringOrder,
      makerPrivateInventory:
        incomingPrivateInventory || existingPrivateInventory
          ? {
              ...existingPrivateInventory,
              ...incomingPrivateInventory
            }
          : undefined,
      privateExecutions:
        hasEntries(incoming.recurringOrder.privateExecutions) || !hasEntries(existing.recurringOrder.privateExecutions)
          ? incoming.recurringOrder.privateExecutions
          : existing.recurringOrder.privateExecutions,
      publicExecutions:
        hasEntries(incoming.recurringOrder.publicExecutions) || !hasEntries(existing.recurringOrder.publicExecutions)
          ? incoming.recurringOrder.publicExecutions
          : existing.recurringOrder.publicExecutions
    };
  }

  return merged;
};

const mergeTradeSnapshotList = (incoming: TradeSnapshot[], existing: TradeSnapshot[]): TradeSnapshot[] => {
  const existingByKey = new Map(existing.map((trade) => [getSnapshotKey(trade), trade]));
  return incoming.map((trade) => mergeTradeSnapshotEnrichment(trade, existingByKey.get(getSnapshotKey(trade))));
};

export const __mergeTradeSnapshotEnrichmentForTest = mergeTradeSnapshotEnrichment;

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
  walletKey
}: UseP2PTradeDataArgs): UseP2PTradeDataResult {
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
  const publicTradesRefreshRef = useRef<Promise<void> | null>(null);
  const myTradesRefreshRef = useRef<Promise<void> | null>(null);
  const publicTradesRefreshQueuedRef = useRef(false);
  const myTradesRefreshQueuedRef = useRef(false);
  const detailTradeRef = useRef<TradeSnapshot | null>(null);
  const publicTradesRef = useRef<TradeSnapshot[]>([]);
  const myTradesRef = useRef<TradeSnapshot[]>([]);
  const latestSyncSessionKeyRef = useRef(syncSessionKey);

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

  const enrichMakerPrivateProgressForList = useCallback(
    async (snapshots: TradeSnapshot[]): Promise<TradeSnapshot[]> =>
      Promise.all(snapshots.map((snapshot) => enrichMakerPrivateProgress(snapshot))),
    [enrichMakerPrivateProgress]
  );

  const refreshPublicTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
    const requestSessionKey = syncSessionKey;
    if (shouldHoldTradeReadForWalletFlow(silent, publicTradesRef.current.length > 0)) {
      return;
    }
    if (publicTradesRefreshRef.current) {
      publicTradesRefreshQueuedRef.current = true;
      return publicTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      do {
        publicTradesRefreshQueuedRef.current = false;
        if (!silent) {
          setLoadingPublicTrades(true);
          setPublicTradesError('');
        }
        try {
          const snapshots = await fetchRecentTradeSnapshots({
            rewardTokenSymbol,
            rewardTokenDecimals,
            privateRewardTokenSymbol,
            privateRewardTokenDecimals,
            limit: 80
          });
          if (latestSyncSessionKeyRef.current === requestSessionKey) {
            setPublicTrades((previous) => sortTrades(mergeTradeSnapshotList(snapshots, previous)));
            if (silent) {
              setPublicTradesError('');
            }
          }
        } catch {
          if (!silent) {
            setPublicTradesError('Failed to load public trades.');
          }
        } finally {
          if (!silent) {
            setLoadingPublicTrades(false);
          }
        }
      } while (publicTradesRefreshQueuedRef.current);

      publicTradesRefreshRef.current = null;
    })();

    publicTradesRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol, syncSessionKey]);

  const refreshMyTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
    const requestSessionKey = syncSessionKey;
    if (shouldHoldTradeReadForWalletFlow(silent, myTradesRef.current.length > 0)) {
      return;
    }
    if (!walletAddress) {
      setMyTrades([]);
      return;
    }
    if (myTradesRefreshRef.current) {
      myTradesRefreshQueuedRef.current = true;
      return myTradesRefreshRef.current;
    }

    const refreshRequest = (async () => {
      do {
        myTradesRefreshQueuedRef.current = false;
        if (!silent) {
          setLoadingMyTrades(true);
          setMyTradesError('');
        }
        try {
          const snapshotsRaw = await fetchWalletTradeSnapshots(walletAddress, {
            rewardTokenSymbol,
            rewardTokenDecimals,
            privateRewardTokenSymbol,
            privateRewardTokenDecimals,
            limit: 80
          });
          const snapshots = await enrichMakerPrivateProgressForList(snapshotsRaw);
          if (latestSyncSessionKeyRef.current === requestSessionKey) {
            setMyTrades((previous) => sortTrades(mergeTradeSnapshotList(snapshots, previous)));
            if (silent) {
              setMyTradesError('');
            }
          }
        } catch {
          if (!silent) {
            setMyTradesError('Failed to load your trades.');
          }
        } finally {
          if (!silent) {
            setLoadingMyTrades(false);
          }
        }
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
    walletAddress
  ]);

  const mergeTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot) => {
      const snapshotKey = getSnapshotKey(snapshot);
      const existingDetail = detailTradeRef.current;
      const mergedSnapshot = mergeTradeSnapshotEnrichment(
        snapshot,
        existingDetail && getSnapshotKey(existingDetail) === snapshotKey ? existingDetail : undefined
      );
      setDetailTrade((current) => (current && getSnapshotKey(current) === snapshotKey ? mergeTradeSnapshotEnrichment(mergedSnapshot, current) : current));
      setPublicTrades((previous) => {
        const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
        const existing = previous.find((trade) => getSnapshotKey(trade) === snapshotKey);
        const nextSnapshot = mergeTradeSnapshotEnrichment(mergedSnapshot, existing);
        if (nextSnapshot.isPublic && nextSnapshot.status === 'open') {
          return sortTrades([nextSnapshot, ...withoutCurrent]);
        }
        return sortTrades(withoutCurrent);
      });
      if (walletKey && ([mergedSnapshot.maker.toLowerCase(), mergedSnapshot.taker.toLowerCase()].includes(walletKey) || mergedSnapshot.walletHasFill)) {
        setMyTrades((previous) => {
          const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
          const existing = previous.find((trade) => getSnapshotKey(trade) === snapshotKey);
          return sortTrades([mergeTradeSnapshotEnrichment(mergedSnapshot, existing), ...withoutCurrent]);
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
    if (shouldHoldTradeReadForWalletFlow(publicTradesRef.current.length > 0, publicTradesRef.current.length > 0)) {
      return;
    }
    refreshPublicTrades({ silent: publicTradesRef.current.length > 0 }).catch(() => {});
  }, [refreshPublicTrades]);

  useEffect(() => {
    if (shouldHoldTradeReadForWalletFlow(myTradesRef.current.length > 0, myTradesRef.current.length > 0)) {
      return;
    }
    refreshMyTrades({ silent: myTradesRef.current.length > 0 }).catch(() => {});
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
          setDetailTrade((current) => mergeTradeSnapshotEnrichment(snapshot, current));
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
