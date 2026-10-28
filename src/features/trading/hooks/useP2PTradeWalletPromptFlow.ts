import { useCallback, type MutableRefObject } from 'react';
import { type Eip1193Provider } from '../../../lib/appShared';
import {
  getCurrentRouteForDiagnostics,
  logMobileWalletDiagnostic
} from '../../../lib/mobileWalletDiagnostics';
import {
  readWalletTransactionFlowTrace,
  recordWalletTransactionFlowStage,
  type WalletTransactionSessionInput
} from '../../../lib/walletTransactionFlow';

type UseP2PTradeWalletPromptFlowArgs = {
  chainId: number | null;
  effectiveBrowserProvider: Eip1193Provider | null;
  flushQueuedTradeDataRefreshRef: MutableRefObject<() => void>;
  selectedWalletId: string;
  sharedBrowserWalletId?: string;
  sharedRunWalletTransactionFlow?: <T>(operation: () => Promise<T>) => Promise<T>;
  walletAddress: string;
};

export default function useP2PTradeWalletPromptFlow({
  chainId,
  effectiveBrowserProvider,
  flushQueuedTradeDataRefreshRef,
  selectedWalletId,
  sharedBrowserWalletId,
  sharedRunWalletTransactionFlow,
  walletAddress
}: UseP2PTradeWalletPromptFlowArgs) {
  const walletScopeKey = walletAddress.trim().toLowerCase();
  const getTradeWalletFlowInput = useCallback(
    (): WalletTransactionSessionInput => ({
      chainId,
      provider: effectiveBrowserProvider,
      providerKey: sharedBrowserWalletId || selectedWalletId || undefined,
      walletAddress: walletScopeKey
    }),
    [
      chainId,
      effectiveBrowserProvider,
      selectedWalletId,
      sharedBrowserWalletId,
      walletScopeKey
    ]
  );

  const runTradeWalletPromptFlow = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      const routeBefore = getCurrentRouteForDiagnostics();
      try {
        if (!sharedRunWalletTransactionFlow) {
          throw new Error('Trading requires the connected ChainWhisper browser-wallet session. Reconnect the wallet and try again.');
        }
        return await sharedRunWalletTransactionFlow(async () => {
          const flowInput = getTradeWalletFlowInput();
          recordWalletTransactionFlowStage(flowInput, 'trading-flow-requested');
          logMobileWalletDiagnostic('trading-flow-start', {
            routeBefore,
            trace: readWalletTransactionFlowTrace(flowInput)
          });
          return await operation();
        });
      } finally {
        const flowInput = getTradeWalletFlowInput();
        logMobileWalletDiagnostic('trading-flow-finish', {
          routeAfter: getCurrentRouteForDiagnostics(),
          routeBefore,
          trace: readWalletTransactionFlowTrace(flowInput)
        });
        logMobileWalletDiagnostic('write-finished', {
          routeAfter: getCurrentRouteForDiagnostics(),
          routeBefore
        });
        globalThis.setTimeout(() => {
          flushQueuedTradeDataRefreshRef.current();
        }, 0);
      }
    },
    [
      flushQueuedTradeDataRefreshRef,
      getTradeWalletFlowInput,
      sharedRunWalletTransactionFlow
    ]
  );

  return { getTradeWalletFlowInput, runTradeWalletPromptFlow };
}
