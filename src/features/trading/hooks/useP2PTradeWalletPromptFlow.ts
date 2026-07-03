import { useCallback, type MutableRefObject } from 'react';
import {
  COTI_NETWORK,
  normalizeChainId,
  type Eip1193Provider
} from '../../../lib/appShared';
import {
  getCurrentRouteForDiagnostics,
  logMobileWalletDiagnostic
} from '../../../lib/mobileWalletDiagnostics';
import { logMetaMaskMobileRequestMethod } from '../../../lib/metamaskConnectMobile';
import {
  isWalletBootstrapRoute,
  isWalletBootstrapStableUrl,
  resolveWalletBootstrapActiveRoute
} from '../../../lib/walletBootstrapRoute';
import {
  readWalletTransactionFlowTrace,
  recordWalletTransactionFlowStage,
  runWalletTransactionFlow,
  type WalletTransactionSessionInput
} from '../../../lib/walletTransactionFlow';
import {
  resolveTradeRouteFromParts,
  type TradeRouteState
} from './useP2PTradeRoute';

type UseP2PTradeWalletPromptFlowArgs = {
  chainId: number | null;
  connectedWithBurner: boolean;
  effectiveBrowserProvider: Eip1193Provider | null;
  flushQueuedTradeDataRefreshRef: MutableRefObject<() => void>;
  route: TradeRouteState;
  selectedWalletId: string;
  sharedBrowserWalletId?: string;
  sharedRunWalletTransactionFlow?: <T>(operation: () => Promise<T>) => Promise<T>;
  walletAddress: string;
};

export default function useP2PTradeWalletPromptFlow({
  chainId,
  connectedWithBurner,
  effectiveBrowserProvider,
  flushQueuedTradeDataRefreshRef,
  route,
  selectedWalletId,
  sharedBrowserWalletId,
  sharedRunWalletTransactionFlow,
  walletAddress
}: UseP2PTradeWalletPromptFlowArgs) {
  const getTradeWalletFlowInput = useCallback(
    (): WalletTransactionSessionInput => ({
      chainId,
      provider: connectedWithBurner ? null : effectiveBrowserProvider,
      providerKey: connectedWithBurner ? 'app-wallet' : sharedBrowserWalletId || selectedWalletId || undefined,
      walletAddress
    }),
    [
      chainId,
      connectedWithBurner,
      effectiveBrowserProvider,
      selectedWalletId,
      sharedBrowserWalletId,
      walletAddress
    ]
  );

  const assertMetaMaskMobilePromptReady = useCallback(async (): Promise<void> => {
    if (typeof window === 'undefined' || !isWalletBootstrapRoute(window.location.pathname)) {
      return;
    }

    const routeKey = `${route.view}:${route.tradeId ?? ''}:${route.escrowContract ? 'contract' : 'default'}`;
    const buildRouteIdentity = (candidate: TradeRouteState): string =>
      [
        candidate.view,
        candidate.tradeId ?? '',
        candidate.escrowContract?.toLowerCase() ?? '',
        candidate.accessSecret ?? ''
      ].join(':');
    const activeRoutePath = resolveWalletBootstrapActiveRoute();
    let activeTradeRoute: TradeRouteState | null = null;
    try {
      const activeUrl = new URL(activeRoutePath, window.location.origin);
      activeTradeRoute = resolveTradeRouteFromParts(activeUrl.pathname, activeUrl.search, activeUrl.hash);
    } catch {
      activeTradeRoute = null;
    }
    const routeReady =
      isWalletBootstrapStableUrl(window.location.pathname, window.location.search) &&
      !window.location.hash &&
      (
        activeRoutePath.toLowerCase().startsWith('/otc') ||
        activeRoutePath.toLowerCase().startsWith('/trades') ||
        activeRoutePath.toLowerCase().startsWith('/otcdesk')
      ) &&
      activeTradeRoute !== null &&
      buildRouteIdentity(activeTradeRoute) === buildRouteIdentity(route);

    if (!routeReady) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        reason: 'bootstrap-route-not-stable',
        routeKey
      });
      throw new Error('MetaMask Mobile is still preparing this trading page. Wait a moment and try again.');
    }

    if (connectedWithBurner) {
      logMobileWalletDiagnostic('prompt-readiness-pass', {
        providerSource: 'app-wallet',
        routeKey
      });
      return;
    }

    if (!effectiveBrowserProvider || !walletAddress) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        reason: 'wallet-not-connected',
        routeKey
      });
      throw new Error('Connect MetaMask Mobile before signing this trade action.');
    }

    logMetaMaskMobileRequestMethod('eth_accounts', 'injected-metamask', {
      reason: 'prompt-readiness'
    });
    const accounts = ((await effectiveBrowserProvider.request({ method: 'eth_accounts' })) as string[] | unknown) ?? [];
    const connectedWalletKey = walletAddress.trim().toLowerCase();
    const accountReady = Array.isArray(accounts) && accounts.some((account) =>
      typeof account === 'string' && account.toLowerCase() === connectedWalletKey
    );
    if (!accountReady) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        accountsCount: Array.isArray(accounts) ? accounts.length : 0,
        reason: 'account-mismatch',
        routeKey
      });
      throw new Error('MetaMask Mobile is not connected to the active ChainWhisper wallet. Reconnect MetaMask before signing.');
    }

    logMetaMaskMobileRequestMethod('eth_chainId', 'injected-metamask', {
      reason: 'prompt-readiness'
    });
    const currentChain = (await effectiveBrowserProvider.request({ method: 'eth_chainId' })) as string | number;
    const currentChainId = normalizeChainId(currentChain);
    if (currentChainId !== COTI_NETWORK.chainIdDecimal) {
      logMobileWalletDiagnostic('prompt-readiness-blocked', {
        chainId: currentChainId,
        reason: 'wrong-chain',
        routeKey
      });
      throw new Error('Switch MetaMask Mobile to COTI Mainnet before signing this trade action.');
    }

    logMobileWalletDiagnostic('prompt-readiness-pass', {
      providerSource: 'injected-metamask',
      routeKey
    });
  }, [
    connectedWithBurner,
    effectiveBrowserProvider,
    route,
    walletAddress
  ]);

  const runTradeWalletPromptFlow = useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      const routeBefore = getCurrentRouteForDiagnostics();
      try {
        if (sharedRunWalletTransactionFlow) {
          return await sharedRunWalletTransactionFlow(async () => {
            const flowInput = getTradeWalletFlowInput();
            recordWalletTransactionFlowStage(flowInput, 'trading-flow-requested');
            logMobileWalletDiagnostic('trading-flow-start', {
              routeBefore,
              trace: readWalletTransactionFlowTrace(flowInput)
            });
            await assertMetaMaskMobilePromptReady();
            return await operation();
          });
        }

        const input = getTradeWalletFlowInput();
        recordWalletTransactionFlowStage(input, 'trading-flow-requested');
        logMobileWalletDiagnostic('trading-flow-start', {
          routeBefore,
          trace: readWalletTransactionFlowTrace(input)
        });
        return await runWalletTransactionFlow(input, async () => {
          await assertMetaMaskMobilePromptReady();
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
      assertMetaMaskMobilePromptReady,
      flushQueuedTradeDataRefreshRef,
      getTradeWalletFlowInput,
      sharedRunWalletTransactionFlow
    ]
  );

  return { getTradeWalletFlowInput, runTradeWalletPromptFlow };
}
