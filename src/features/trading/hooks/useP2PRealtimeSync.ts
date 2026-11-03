import { useEffect } from 'react';
import {
  COTI_NETWORK,
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  REALTIME_SYNC_BURST_THROTTLE_MS,
  REALTIME_SYNC_DEBOUNCE_MS,
  REALTIME_SYNC_FALLBACK_INTERVAL_MS
} from '../../../lib/appShared';
import { subscribeCotiEventHints, type CotiEventHintStatus } from '../../../lib/appShared/cotiEventHints';
import { CURRENT_P2P_BINDING } from '../../../lib/currentP2PBinding';
import type { P2PSyncDomain, P2PSyncReason } from '../../../lib/p2pSyncCoordinator';
import {
  isWalletTransactionFlowActive,
  recordWalletTransactionFlowStage,
  type WalletTransactionSessionInput
} from '../../../lib/walletTransactionFlow';
type ScheduleP2PSyncInput = {
  domains: P2PSyncDomain[];
  escrowContract?: string;
  reason: P2PSyncReason;
  tradeId?: number;
};

type UseP2PRealtimeSyncArgs = {
  chainId: number | null;
  getTradeWalletFlowInput: () => WalletTransactionSessionInput;
  routeEscrowContract?: string;
  routeTradeId: number | null;
  routeView: string;
  scheduleP2PSync: (request: ScheduleP2PSyncInput) => void;
  walletAddress: string;
};

export default function useP2PRealtimeSync({
  chainId,
  getTradeWalletFlowInput,
  routeEscrowContract,
  routeTradeId,
  routeView,
  scheduleP2PSync,
  walletAddress
}: UseP2PRealtimeSyncArgs) {
  const walletConnected = Boolean(walletAddress.trim());
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollIntervalId: number | null = null;
    let hadConnected = false;


    let realtimeSyncTimerId: number | null = null;
    let lastRealtimeSyncDispatchAt = 0;

    const dispatchRealtimeSync = (reason: P2PSyncReason = 'interval') => {
      if (cancelled || (typeof document !== 'undefined' && document.hidden)) {
        return;
      }
      // The existing sync queue holds and coalesces hints while readers are busy.
      if (isWalletTransactionFlowActive(getTradeWalletFlowInput()) || isWalletTransactionFlowActive()) {
        recordWalletTransactionFlowStage(getTradeWalletFlowInput(), 'trading-realtime-dispatch-held');
        if (reason === 'interval') return;
      }
      lastRealtimeSyncDispatchAt = Date.now();
      scheduleP2PSync({
        domains: [
          'balances',
          ...(['public', 'swap'].includes(routeView) ? (['public-trades'] as const) : []),
          ...(walletConnected && routeView === 'mine' ? (['wallet-trades'] as const) : []),
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
        if (reason === 'interval') return;
      }

      const now = Date.now();
      const elapsedSinceLastDispatch = now - lastRealtimeSyncDispatchAt;
      const canDispatchImmediately =
        elapsedSinceLastDispatch >= REALTIME_SYNC_BURST_THROTTLE_MS &&
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
    };
    const startPollFallback = () => {
      if (!cancelled && pollIntervalId === null && typeof window !== 'undefined') {
        pollIntervalId = window.setInterval(() => scheduleRealtimeSync('interval'), REALTIME_SYNC_FALLBACK_INTERVAL_MS);
      }
    };
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      scheduleRealtimeSync('focus');
    };
    const onStatus = (status: CotiEventHintStatus) => {
      if (cancelled) return;
      if (status === 'connected') {
        // A hint can precede its canonical state; keep checking the selected trade.
        if (routeView !== 'trade' || !routeTradeId) clearPollFallback();
        // Reconcile the gap after socket loss through the existing canonical readers.
        if (hadConnected) scheduleRealtimeSync('chain-event');
        hadConnected = true;
      } else startPollFallback();
    };
    startPollFallback();
    if (typeof window !== 'undefined') window.addEventListener('focus', handleVisibilityOrFocus);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    const eventAddresses = chainId === Number(CURRENT_P2P_BINDING.chainId) && chainId === COTI_NETWORK.chainIdDecimal
      ? Object.values(CURRENT_P2P_BINDING.deployments).map(deployment => deployment.contractAddress)
      : chainId === 2632500 && COTI_NETWORK.chainIdDecimal === 2632500
        ? [TRADE_ESCROW_CONTRACT_ADDRESS, PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
          DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS, RECURRING_OTC_CONTRACT_ADDRESS]
        : null;
    if (eventAddresses) {
      void subscribeCotiEventHints({
        address: eventAddresses,
        onHint: () => scheduleRealtimeSync('chain-event'),
        onStatus
      }).then(stop => {
        if (cancelled) stop(); else unsubscribe = stop;
      }).catch(() => onStatus('reconnecting'));
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
      clearPollFallback();
      if (typeof window !== 'undefined') window.removeEventListener('focus', handleVisibilityOrFocus);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if (realtimeSyncTimerId !== null) window.clearTimeout(realtimeSyncTimerId);
    };
  }, [chainId, getTradeWalletFlowInput, routeEscrowContract, routeTradeId,
    routeView, scheduleP2PSync, walletConnected]);
}
