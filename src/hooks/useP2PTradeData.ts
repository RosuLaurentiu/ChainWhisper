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
  fetchWalletTradeSnapshots
} from '../lib/appChain';
import type { TradePageView } from './useP2PTradeRoute';

const TRADE_DETAIL_LOAD_TIMEOUT_MS = 18_000;

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

  const enrichMakerPrivateProgressForList = useCallback(
    async (snapshots: TradeSnapshot[]): Promise<TradeSnapshot[]> =>
      Promise.all(snapshots.map((snapshot) => enrichMakerPrivateProgress(snapshot))),
    [enrichMakerPrivateProgress]
  );

  const refreshPublicTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
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
          setPublicTrades(sortTrades(snapshots));
          if (silent) {
            setPublicTradesError('');
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
  }, [privateRewardTokenDecimals, privateRewardTokenSymbol, rewardTokenDecimals, rewardTokenSymbol]);

  const refreshMyTrades = useCallback(async (options?: TradeRefreshOptions) => {
    const silent = Boolean(options?.silent);
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
          setMyTrades(sortTrades(snapshots));
          if (silent) {
            setMyTradesError('');
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
    walletAddress
  ]);

  const mergeTradeSnapshot = useCallback(
    (snapshot: TradeSnapshot) => {
      const snapshotKey = getSnapshotKey(snapshot);
      setDetailTrade((current) => (current && getSnapshotKey(current) === snapshotKey ? snapshot : current));
      setPublicTrades((previous) => {
        const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
        if (snapshot.isPublic && snapshot.status === 'open') {
          return sortTrades([snapshot, ...withoutCurrent]);
        }
        return sortTrades(withoutCurrent);
      });
      if (walletKey && ([snapshot.maker.toLowerCase(), snapshot.taker.toLowerCase()].includes(walletKey) || snapshot.walletHasFill)) {
        setMyTrades((previous) => {
          const withoutCurrent = previous.filter((trade) => getSnapshotKey(trade) !== snapshotKey);
          return sortTrades([snapshot, ...withoutCurrent]);
        });
      }
    },
    [walletKey]
  );

  const refreshTradeDetail = useCallback(
    async (tradeId: number, escrowContract?: string, options?: TradeRefreshOptions): Promise<TradeSnapshot | null> => {
      const snapshotRaw = await fetchTradeSnapshotById(tradeId, {
        rewardTokenSymbol,
        rewardTokenDecimals,
        privateRewardTokenSymbol,
        privateRewardTokenDecimals,
        escrowContract
      });
      const snapshot = await enrichMakerPrivateProgress(snapshotRaw);
      mergeTradeSnapshot(snapshot);
      if (options?.silent) {
        setDetailTradeError('');
      }
      return snapshot;
    },
    [
      enrichMakerPrivateProgress,
      mergeTradeSnapshot,
      privateRewardTokenDecimals,
      privateRewardTokenSymbol,
      rewardTokenDecimals,
      rewardTokenSymbol
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
    refreshPublicTrades().catch(() => {});
  }, [refreshPublicTrades]);

  useEffect(() => {
    refreshMyTrades().catch(() => {});
  }, [refreshMyTrades]);

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
    refreshTradeDetail,
    setDetailTrade,
    setDetailTradeError,
    tradeAccessBlocked
  };
}
