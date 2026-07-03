import { useCallback, useEffect, useState } from 'react';
import { buildTradeSnapshotKey } from '../../../lib/appShared';
import {
  loadStoredPrivateTradeLiquidity,
  loadStoredTradeAccessSecrets,
  storePrivateTradeLiquidity,
  storeTradeAccessSecrets
} from '../../../lib/p2pTradeView';
import { normalizeAccessSecret } from './useP2PTradeRoute';

type UseP2PTradeAccessMemoryArgs = {
  walletKey: string;
};

export default function useP2PTradeAccessMemory({ walletKey }: UseP2PTradeAccessMemoryArgs) {
  const [knownTradeAccessSecrets, setKnownTradeAccessSecrets] = useState<Record<string, string>>(
    () => loadStoredTradeAccessSecrets()
  );
  const [knownPrivateLiquidityByTrade, setKnownPrivateLiquidityByTrade] = useState<Record<string, string>>({});

  useEffect(() => {
    setKnownPrivateLiquidityByTrade(loadStoredPrivateTradeLiquidity(walletKey));
  }, [walletKey]);

  const rememberTradeAccessSecret = useCallback((tradeId: number, accessSecret?: string, escrowContract?: string) => {
    const normalizedSecret = normalizeAccessSecret(accessSecret);
    if (!Number.isSafeInteger(tradeId) || tradeId <= 0 || !normalizedSecret) {
      return;
    }

    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    setKnownTradeAccessSecrets((previous) => {
      if (previous[key] === normalizedSecret) {
        return previous;
      }

      const next = {
        ...previous,
        [key]: normalizedSecret
      };
      storeTradeAccessSecrets(next);
      return next;
    });
  }, []);

  const forgetTradeAccessSecret = useCallback((tradeId: number, escrowContract?: string) => {
    if (!Number.isSafeInteger(tradeId) || tradeId <= 0) {
      return;
    }

    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    setKnownTradeAccessSecrets((previous) => {
      if (!previous[key]) {
        return previous;
      }

      const next = { ...previous };
      delete next[key];
      storeTradeAccessSecrets(next);
      return next;
    });
  }, []);

  const rememberPrivateTradeLiquidity = useCallback((tradeId: number, escrowContract: string | undefined, amountWei: bigint) => {
    if (!walletKey || !Number.isSafeInteger(tradeId) || tradeId <= 0 || amountWei <= 0n) {
      return;
    }

    const key = buildTradeSnapshotKey(tradeId, escrowContract);
    const amount = amountWei.toString();
    setKnownPrivateLiquidityByTrade((previous) => {
      if (previous[key] === amount) {
        return previous;
      }

      const next = {
        ...previous,
        [key]: amount
      };
      storePrivateTradeLiquidity(next, walletKey);
      return next;
    });
  }, [walletKey]);

  const resolveKnownTradeAccessSecret = useCallback(
    (tradeId: number, escrowContract?: string): string =>
      knownTradeAccessSecrets[buildTradeSnapshotKey(tradeId, escrowContract)] ?? '',
    [knownTradeAccessSecrets]
  );

  return {
    forgetTradeAccessSecret,
    knownPrivateLiquidityByTrade,
    rememberPrivateTradeLiquidity,
    rememberTradeAccessSecret,
    resolveKnownTradeAccessSecret
  };
}
