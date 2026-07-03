import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { REALTIME_SYNC_DEBOUNCE_MS } from '../../../lib/appShared';
import {
  mergeP2PSyncRequests,
  shouldUseSilentP2PSync,
  type P2PSyncDomain,
  type P2PSyncReason
} from '../../../lib/p2pSyncCoordinator';
import {
  isWalletTransactionFlowActive,
  recordWalletTransactionFlowStage,
  type WalletTransactionSessionInput
} from '../../../lib/walletTransactionFlow';
import type { WalletBalanceRefreshOptions } from './useP2PTradeTokenData';
import type {
  QueuedTradeDataRefresh,
  TradeSigner
} from '../components/P2PTradingPage.helpers';

type UseP2PSyncQueueArgs = {
  flushQueuedTradeDataRefreshRef: MutableRefObject<() => void>;
  getTradeWalletFlowInput: () => WalletTransactionSessionInput;
  refreshAllTradingBalances: (options?: WalletBalanceRefreshOptions) => Promise<unknown>;
  refreshMyTrades: (options?: { silent?: boolean }) => Promise<unknown>;
  refreshPublicTrades: (options?: { silent?: boolean }) => Promise<unknown>;
  refreshTradeDetail: (tradeId: number, escrowContract?: string, options?: { silent?: boolean }) => Promise<unknown>;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: string;
  walletAddress: string;
};

export type ScheduleP2PSyncInput = {
  domains: P2PSyncDomain[];
  escrowContract?: string;
  reason: P2PSyncReason;
  signer?: TradeSigner;
  tradeId?: number;
};

export default function useP2PSyncQueue({
  flushQueuedTradeDataRefreshRef,
  getTradeWalletFlowInput,
  refreshAllTradingBalances,
  refreshMyTrades,
  refreshPublicTrades,
  refreshTradeDetail,
  routeEscrowContract,
  routeTradeId,
  routeView,
  walletAddress
}: UseP2PSyncQueueArgs) {
  const queuedTradeDataRefreshRef = useRef<QueuedTradeDataRefresh | null>(null);
  const p2pSyncTimerRef = useRef<number | null>(null);

  const mergeQueuedP2PSync = useCallback((request: QueuedTradeDataRefresh) => {
    queuedTradeDataRefreshRef.current = mergeP2PSyncRequests(queuedTradeDataRefreshRef.current, request);
  }, []);

  const runP2PSyncRequest = useCallback(
    (request: QueuedTradeDataRefresh) => {
      const domains = request.domains;
      const silent = shouldUseSilentP2PSync(request.reason);
      void Promise.allSettled([
        domains.has('balances')
          ? refreshAllTradingBalances({ reason: request.reason === 'manual' ? 'manual' : 'trade-action', signer: request.signer, silent })
          : Promise.resolve(),
        domains.has('wallet-trades') && walletAddress
          ? refreshMyTrades({ silent })
          : Promise.resolve(),
        domains.has('public-trades')
          ? refreshPublicTrades({ silent })
          : Promise.resolve(),
        domains.has('trade-detail') && request.tradeId
          ? refreshTradeDetail(request.tradeId, request.escrowContract, { silent }).catch(() => null)
          : Promise.resolve(null)
      ]);
    },
    [refreshAllTradingBalances, refreshMyTrades, refreshPublicTrades, refreshTradeDetail, walletAddress]
  );

  const flushQueuedP2PSync = useCallback(() => {
    if (p2pSyncTimerRef.current !== null) {
      window.clearTimeout(p2pSyncTimerRef.current);
      p2pSyncTimerRef.current = null;
    }
    const queued = queuedTradeDataRefreshRef.current;
    if (!queued) {
      return;
    }
    if (
      queued.reason !== 'manual' &&
      (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive())
    ) {
      recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-sync-flush-held');
      return;
    }
    queuedTradeDataRefreshRef.current = null;
    runP2PSyncRequest(queued);
  }, [getTradeWalletFlowInput, runP2PSyncRequest]);

  const scheduleP2PSync = useCallback(
    (request: ScheduleP2PSyncInput) => {
      mergeQueuedP2PSync({
        domains: new Set(request.domains),
        escrowContract: request.escrowContract,
        reason: request.reason,
        signer: request.signer,
        tradeId: request.tradeId
      });
      if (
        request.reason !== 'manual' &&
        (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive())
      ) {
        recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-sync-queued');
        return;
      }
      if (request.reason === 'manual' || request.reason === 'wallet-action') {
        flushQueuedP2PSync();
        return;
      }
      if (p2pSyncTimerRef.current !== null) {
        return;
      }
      p2pSyncTimerRef.current = window.setTimeout(() => {
        p2pSyncTimerRef.current = null;
        flushQueuedP2PSync();
      }, REALTIME_SYNC_DEBOUNCE_MS);
    },
    [flushQueuedP2PSync, getTradeWalletFlowInput, mergeQueuedP2PSync]
  );

  const refreshTradeDataInBackground = useCallback(
    (tradeId?: number, escrowContract?: string, signer?: TradeSigner) => {
      const targetTradeId = tradeId ?? (routeView === 'trade' ? routeTradeId ?? undefined : undefined);
      const targetEscrow = escrowContract ?? (targetTradeId ? routeEscrowContract : undefined);
      scheduleP2PSync({
        domains: ['balances', 'wallet-trades', 'public-trades', ...(targetTradeId ? (['trade-detail'] as const) : [])],
        escrowContract: targetEscrow,
        reason: 'wallet-action',
        signer,
        tradeId: targetTradeId
      });
    },
    [routeEscrowContract, routeTradeId, routeView, scheduleP2PSync]
  );

  useEffect(() => {
    flushQueuedTradeDataRefreshRef.current = flushQueuedP2PSync;
  }, [flushQueuedP2PSync, flushQueuedTradeDataRefreshRef]);

  return {
    refreshTradeDataInBackground,
    scheduleP2PSync
  };
}
