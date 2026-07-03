import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  AUTO_SYNC_INTERVAL_MS,
  calculateEstimatedBurnerTopUpAmount,
  COTI_NETWORK,
  getCotiWsLastHealthyAt,
  isWalletAddress,
  loadCotiReadProvider,
  loadCotiWsProvider,
  markCotiWsHealthyNow,
  type SignerSource,
  WS_HEALTHCHECK_TTL_MS
} from '../../../lib/appShared';

type UseWalletBalanceRefreshEffectsArgs = {
  activeSignerSource: SignerSource;
  burnerAddress: string;
  chainId: number | null;
  setBurnerBalanceWei: Dispatch<SetStateAction<bigint | null>>;
  setLoadingTopUpQuote: (value: boolean) => void;
  setTipNativeBalanceWei: (value: bigint | null) => void;
  setTopUpAmountWei: (value: bigint | null) => void;
  setTopUpMetricsNonce: Dispatch<SetStateAction<number>>;
  tipComposerOpen: boolean;
  topUpMessageTarget: number;
  topUpMetricsNonce: number;
  walletAddress: string;
};

export default function useWalletBalanceRefreshEffects({
  activeSignerSource,
  burnerAddress,
  chainId,
  setBurnerBalanceWei,
  setLoadingTopUpQuote,
  setTipNativeBalanceWei,
  setTopUpAmountWei,
  setTopUpMetricsNonce,
  tipComposerOpen,
  topUpMessageTarget,
  topUpMetricsNonce,
  walletAddress
}: UseWalletBalanceRefreshEffectsArgs) {
  useEffect(() => {
    let cancelled = false;

    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      setTopUpAmountWei(null);
      setBurnerBalanceWei(null);
      setLoadingTopUpQuote(false);
      return;
    }

    const loadTopUpAmount = async () => {
      setTopUpAmountWei(calculateEstimatedBurnerTopUpAmount(topUpMessageTarget));
      setLoadingTopUpQuote(true);
      try {
        const readProvider = await loadCotiReadProvider(true);
        const burnerBalance = (await readProvider.getBalance(burnerAddress)) as bigint;
        if (!cancelled) {
          setBurnerBalanceWei(burnerBalance);
        }
      } catch {
        if (!cancelled) {
          setBurnerBalanceWei(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingTopUpQuote(false);
        }
      }
    };

    loadTopUpAmount().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [burnerAddress, setBurnerBalanceWei, setLoadingTopUpQuote, setTopUpAmountWei, topUpMessageTarget, topUpMetricsNonce]);

  useEffect(() => {
    let cancelled = false;
    const signerAddress = (activeSignerSource === 'burner' ? burnerAddress : walletAddress).trim();

    if (!signerAddress || !isWalletAddress(signerAddress) || chainId !== COTI_NETWORK.chainIdDecimal) {
      setTipNativeBalanceWei(null);
      return;
    }

    const loadTipNativeBalance = async () => {
      try {
        const readProvider = await loadCotiReadProvider(true);
        const nativeBalance = (await readProvider.getBalance(signerAddress)) as bigint;
        if (!cancelled) {
          setTipNativeBalanceWei(nativeBalance);
        }
      } catch {
        if (!cancelled) {
          setTipNativeBalanceWei(null);
        }
      }
    };

    loadTipNativeBalance().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    activeSignerSource,
    burnerAddress,
    chainId,
    setTipNativeBalanceWei,
    tipComposerOpen,
    topUpMetricsNonce,
    walletAddress
  ]);

  useEffect(() => {
    if (!burnerAddress || !isWalletAddress(burnerAddress)) {
      return;
    }

    let cancelled = false;
    let unsubscribeBlocks: (() => void) | null = null;
    let lastRefreshAt = 0;
    const bumpTopUpMetrics = () => {
      const now = Date.now();
      if (now - lastRefreshAt < AUTO_SYNC_INTERVAL_MS) {
        return;
      }

      lastRefreshAt = now;
      setTopUpMetricsNonce((previous) => previous + 1);
    };

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        bumpTopUpMetrics();
      }
    }, AUTO_SYNC_INTERVAL_MS);

    loadCotiWsProvider()
      .then(async (wsProvider) => {
        if (cancelled) {
          return;
        }

        if (Date.now() - getCotiWsLastHealthyAt() > WS_HEALTHCHECK_TTL_MS) {
          await wsProvider.getBlockNumber();
        }
        markCotiWsHealthyNow();

        const providerWithEvents = wsProvider as unknown as {
          on?: (event: string, listener: (...args: unknown[]) => void) => void;
          off?: (event: string, listener: (...args: unknown[]) => void) => void;
        };

        const handleBlock = () => {
          if (!cancelled) {
            bumpTopUpMetrics();
          }
        };

        providerWithEvents.on?.('block', handleBlock);
        unsubscribeBlocks = () => {
          providerWithEvents.off?.('block', handleBlock);
        };
      })
      .catch(() => {
        // Keep interval-only fallback.
      });

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      unsubscribeBlocks?.();
    };
  }, [burnerAddress, setTopUpMetricsNonce]);
}
