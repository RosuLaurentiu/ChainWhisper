import { useEffect } from 'react';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ABI,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  getCotiWsLastHealthyAt,
  loadCotiEthersModule,
  loadCotiWsProvider,
  markCotiWsHealthyNow,
  PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS,
  RECURRING_OTC_CONTRACT_ABI,
  RECURRING_OTC_CONTRACT_ADDRESS,
  resetCotiWsProvider,
  TRADE_ESCROW_CONTRACT_ABI,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  WS_HEALTHCHECK_TTL_MS,
  WS_RETRY_COOLDOWN_MS
} from '../../../lib/appShared';
import type { P2PSyncDomain, P2PSyncReason } from '../../../lib/p2pSyncCoordinator';
import {
  isWalletTransactionFlowActive,
  recordWalletTransactionFlowStage,
  type WalletTransactionSessionInput
} from '../../../lib/walletTransactionFlow';
import { P2P_VISIBLE_SYNC_INTERVAL_MS } from '../components/P2PTradingPage.helpers';

type ScheduleP2PSyncInput = {
  domains: P2PSyncDomain[];
  escrowContract?: string;
  reason: P2PSyncReason;
  tradeId?: number;
};

type UseP2PRealtimeSyncArgs = {
  chainId: number | null;
  getTradeWalletFlowInput: () => WalletTransactionSessionInput;
  hasActiveListRefresh: () => boolean;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: string;
  scheduleP2PSync: (request: ScheduleP2PSyncInput) => void;
  walletAddress: string;
};

export default function useP2PRealtimeSync({
  chainId,
  getTradeWalletFlowInput,
  hasActiveListRefresh,
  routeEscrowContract,
  routeTradeId,
  routeView,
  scheduleP2PSync,
  walletAddress
}: UseP2PRealtimeSyncArgs) {
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let visibleSyncIntervalId: number | null = null;
    let wsReconnectIntervalId: number | null = null;
    let wsReconnectInFlight = false;
    let realtimeSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;

    const dispatchRealtimeSync = (reason: P2PSyncReason = 'interval') => {
      if (cancelled || (typeof document !== 'undefined' && document.hidden)) {
        return;
      }
      if (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive()) {
        recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-realtime-dispatch-held');
        return;
      }
      lastRealtimeSyncDispatchAt = Date.now();
      scheduleP2PSync({
        domains: [
          'balances',
          'public-trades',
          ...(walletAddress ? (['wallet-trades'] as const) : []),
          ...(routeView === 'trade' && routeTradeId ? (['trade-detail'] as const) : [])
        ],
        escrowContract: routeEscrowContract,
        reason,
        tradeId: routeTradeId ?? undefined
      });
    };

    const scheduleRealtimeSync = (reason: P2PSyncReason = 'interval') => {
      if (cancelled) {
        return;
      }
      if (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive()) {
        recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-realtime-schedule-held');
        return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
        !hasActiveListRefresh() &&
        realtimeSyncTimerId === null;
      if (canDispatchImmediately) {
        dispatchRealtimeSync(reason);
        return;
      }

      if (realtimeSyncTimerId !== null) {
        return;
      }

      const nextDelay = Math.max(
        REALTIME_SYNC_DEBOUNCE_MS,
        REALTIME_SYNC_BURST_THROTTLE_MS - elapsedSinceLastDispatch
      );
      realtimeSyncTimerId = window.setTimeout(() => {
        realtimeSyncTimerId = null;
        dispatchRealtimeSync(reason);
      }, nextDelay);
    };

    const clearPollFallback = () => {
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      if (wsReconnectIntervalId !== null) {
        window.clearInterval(wsReconnectIntervalId);
        wsReconnectIntervalId = null;
      }
    };

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        return;
      }
      scheduleRealtimeSync('focus');
    };

    if (typeof window !== 'undefined') {
      visibleSyncIntervalId = window.setInterval(() => scheduleRealtimeSync('interval'), P2P_VISIBLE_SYNC_INTERVAL_MS);
      window.addEventListener('focus', handleVisibilityOrFocus);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    }

    const setupTradeRealtimeSubscription = async () => {
      try {
        if (cancelled) {
          return;
        }

        const cotiEthers = await loadCotiEthersModule();
        const wsProvider = await loadCotiWsProvider();
        if (Date.now() - getCotiWsLastHealthyAt() > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        markCotiWsHealthyNow();

        const eventSubscriptions: Array<{
          abi: readonly string[];
          address: string;
          events: string[];
        }> = [
          {
            abi: TRADE_ESCROW_CONTRACT_ABI,
            address: TRADE_ESCROW_CONTRACT_ADDRESS,
            events: [
              'TradeOpened',
              'TradeAccepted',
              'TradeCancelled',
              'TradeDeclined',
              'TradeExpired',
              'TradePartiallyFilled',
              'TradeFilled',
              'TradeReplaced',
              'CounterTradeAccepted',
              'ParentTradeClosedByDirectCounter'
            ]
          },
          {
            abi: PRIVATE_TRADE_ESCROW_CONTRACT_ABI,
            address: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
            events: [
              'PrivateOrderOpened',
              'PrivateOrderFilled',
              'TradeAccepted',
              'TradeCancelled',
              'TradeDeclined',
              'TradeExpired',
              'TradeFilled',
              'TradeReplaced',
              'ParentTradeClosedByDirectCounter'
            ]
          },
          {
            abi: DIRECT_TRADE_ESCROW_CONTRACT_ABI,
            address: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
            events: [
              'DirectTradeOpened',
              'DirectTradeAccepted',
              'DirectTradeFilled',
              'DirectTradeCancelled',
              'DirectTradeDeclined',
              'DirectTradeExpired',
              'DirectTradeReplaced',
              'CounterTradeAccepted',
              'ParentTradeClosedByCounter',
              'SiblingCounterClosed'
            ]
          },
          {
            abi: RECURRING_OTC_CONTRACT_ABI,
            address: RECURRING_OTC_CONTRACT_ADDRESS,
            events: [
              'RecurringOrderOpened',
              'RecurringOrderEdited',
              'RecurringOrderExecuted',
              'RecurringOrderPaused',
              'RecurringOrderResumed',
              'RecurringOrderCancelled',
              'RecurringOrderInventorySettled',
              'PrivateRecurringFillReceipt',
              'PrivateRecurringInventorySnapshot',
              'PrivateRecurringAccountSnapshotUpdated'
            ]
          }
        ];
        const handleTradeEvent = () => {
          scheduleRealtimeSync('chain-event');
        };
        const activeSubscriptions: Array<{
          contract: { off: (filter: never, listener: () => void) => unknown };
          filter: never;
        }> = [];
        for (const subscription of eventSubscriptions) {
          const contract = new cotiEthers.Contract(subscription.address, subscription.abi, wsProvider);
          for (const eventName of subscription.events) {
            const filterFactory = (contract.filters as Record<string, (() => unknown) | undefined>)[eventName];
            if (!filterFactory) {
              continue;
            }
            const filter = filterFactory() as never;
            contract.on(filter, handleTradeEvent);
            activeSubscriptions.push({
              contract: contract as { off: (filter: never, listener: () => void) => unknown },
              filter
            });
          }
        }

        if (cancelled) {
          for (const subscription of activeSubscriptions) {
            subscription.contract.off(subscription.filter, handleTradeEvent);
          }
          return;
        }

        unsubscribe = () => {
          for (const subscription of activeSubscriptions) {
            subscription.contract.off(subscription.filter, handleTradeEvent);
          }
        };
        clearPollFallback();
      } catch {
        await resetCotiWsProvider();
        if (cancelled) {
          return;
        }

        if (pollIntervalId === null) {
          pollIntervalId = window.setInterval(() => scheduleRealtimeSync('interval'), REALTIME_SYNC_FALLBACK_INTERVAL_MS);
        }

        if (wsReconnectIntervalId === null) {
          wsReconnectIntervalId = window.setInterval(() => {
            if (wsReconnectInFlight || cancelled) {
              return;
            }

            wsReconnectInFlight = true;
            setupTradeRealtimeSubscription()
              .catch(() => {})
              .finally(() => {
                wsReconnectInFlight = false;
              });
          }, WS_RETRY_COOLDOWN_MS);
        }
      }
    };

    setupTradeRealtimeSubscription().catch(() => {});

    return () => {
      cancelled = true;
      unsubscribe?.();
      clearPollFallback();
      if (visibleSyncIntervalId !== null) {
        window.clearInterval(visibleSyncIntervalId);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityOrFocus);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      }
      if (realtimeSyncTimerId !== null) {
        window.clearTimeout(realtimeSyncTimerId);
      }
    };
  }, [
    chainId,
    getTradeWalletFlowInput,
    hasActiveListRefresh,
    routeEscrowContract,
    routeTradeId,
    routeView,
    scheduleP2PSync,
    walletAddress
  ]);
}
