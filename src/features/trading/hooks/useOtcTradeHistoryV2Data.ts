import { useCallback, useEffect, useRef, useState } from 'react';
import type { OtcTradeHistoryV2Runtime } from '../../../lib/otcTradeHistoryV2Runtime';
import type { TradeHistoryV2ExecutionRow } from '../../../lib/tradeHistoryV2Ledger';
import type { TradeHistoryV2CanonicalLifecycleEvent } from '../../../lib/tradeHistoryV2Materialize';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

const EMPTY_ROWS: readonly TradeHistoryV2ExecutionRow[] = Object.freeze([]);
const EMPTY_LIFECYCLE_EVENTS: readonly TradeHistoryV2CanonicalLifecycleEvent[] = Object.freeze([]);

export const shouldPreserveVerifiedOtcHistoryRows = ({
  activeRuntime,
  failedRuntime
}: {
  activeRuntime: OtcTradeHistoryV2Runtime | null;
  failedRuntime: OtcTradeHistoryV2Runtime;
}): boolean => activeRuntime === failedRuntime && failedRuntime.isCurrent();

export const shouldDisplayVerifiedOtcHistoryRows = ({
  activeScopeKey,
  verifiedScopeKey
}: {
  activeScopeKey: string;
  verifiedScopeKey: string;
}): boolean => Boolean(
  activeScopeKey &&
  activeScopeKey === verifiedScopeKey
);

export const loadCompleteVerifiedOtcHistory = async ({
  runtime,
  contractAddresses,
  pauseBetweenPages = () => new Promise<void>((resolve) => window.setTimeout(resolve, 50)),
  shouldContinue = () => true
}: {
  runtime: OtcTradeHistoryV2Runtime;
  contractAddresses?: readonly string[];
  pauseBetweenPages?: () => Promise<void>;
  shouldContinue?: () => boolean;
}): Promise<Readonly<{
  rows: readonly TradeHistoryV2ExecutionRow[];
  lifecycleEvents: readonly TradeHistoryV2CanonicalLifecycleEvent[];
}>> => {
  let hasMore = true;
  while (hasMore) {
    if (!shouldContinue() || !runtime.isCurrent()) {
      throw new Error('Verified OTC history runtime changed during backfill.');
    }
    const result = await runtime.sync(contractAddresses);
    if (!shouldContinue() || !runtime.isCurrent()) {
      throw new Error('Verified OTC history runtime changed during backfill.');
    }
    hasMore = result.hasMore;
    if (hasMore) await pauseBetweenPages();
  }
  if (!shouldContinue() || !runtime.isCurrent()) {
    throw new Error('Verified OTC history runtime changed before portfolio publication.');
  }
  const requested = contractAddresses && new Set(contractAddresses.map(address => address.toLowerCase()));
  return Object.freeze({
    rows: Object.freeze(runtime.rows().filter(row => !requested || requested.has(row.order.contractAddress))),
    lifecycleEvents: Object.freeze(runtime.lifecycleEvents().filter(event => !requested || requested.has(event.contractAddress)))
  });
};

export default function useOtcTradeHistoryV2Data(
  runtime: OtcTradeHistoryV2Runtime | null | undefined,
  dataScopeKey: string,
  contractAddresses?: readonly string[]
) {
  const contractsKey = contractAddresses?.map(address => address.toLowerCase()).sort().join(',') ?? '';
  const normalizedDataScopeKey = dataScopeKey.trim() ? `${dataScopeKey.trim().toLowerCase()}:${contractsKey}` : '';
  const [rows, setRows] = useState<readonly TradeHistoryV2ExecutionRow[]>(EMPTY_ROWS);
  const [lifecycleEvents, setLifecycleEvents] = useState<readonly TradeHistoryV2CanonicalLifecycleEvent[]>(
    EMPTY_LIFECYCLE_EVENTS
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [verifiedScopeKey, setVerifiedScopeKey] = useState('');
  const activeScopeKeyRef = useRef(normalizedDataScopeKey);
  const refresh = useCallback(() => setRefreshRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const requestScopeKey = normalizedDataScopeKey;
    const scopeChanged = activeScopeKeyRef.current !== requestScopeKey;
    activeScopeKeyRef.current = requestScopeKey;
    if (!requestScopeKey) {
      setVerifiedScopeKey('');
      setRows(EMPTY_ROWS);
      setLifecycleEvents(EMPTY_LIFECYCLE_EVENTS);
      setError('');
      setLoading(false);
      return () => { cancelled = true; };
    }

    if (scopeChanged) {
      setVerifiedScopeKey('');
      setRows(EMPTY_ROWS);
      setLifecycleEvents(EMPTY_LIFECYCLE_EVENTS);
    }
    if (!runtime || !runtime.isCurrent()) {
      // Keep an already verified portfolio visible for the same immutable
      // deployment/network/wallet scope while its runtime is replaced.
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError('');
    void (async () => {
      const complete = await loadCompleteVerifiedOtcHistory({
        runtime,
        contractAddresses: contractsKey ? contractsKey.split(',') : undefined,
        shouldContinue: () => !cancelled
      });
      if (cancelled || !runtime.isCurrent()) return;
      setRows(complete.rows);
      setLifecycleEvents(complete.lifecycleEvents);
      setVerifiedScopeKey(requestScopeKey);
      setLoading(false);
    })().catch((cause) => {
      if (cancelled) return;
      if (activeScopeKeyRef.current !== requestScopeKey) {
        setVerifiedScopeKey('');
        setRows(EMPTY_ROWS);
        setLifecycleEvents(EMPTY_LIFECYCLE_EVENTS);
      }
      setLoading(false);
      setError(getProviderErrorMessage(cause, 'Verified OTC history could not be loaded.'));
    });

    return () => { cancelled = true; };
  }, [contractsKey, normalizedDataScopeKey, refreshRevision, runtime]);

  const displayVerifiedRows = shouldDisplayVerifiedOtcHistoryRows({
    activeScopeKey: normalizedDataScopeKey,
    verifiedScopeKey
  });

  return {
    otcTradeHistoryV2Rows: displayVerifiedRows ? rows : EMPTY_ROWS,
    otcTradeHistoryV2LifecycleEvents: displayVerifiedRows
      ? lifecycleEvents
      : EMPTY_LIFECYCLE_EVENTS,
    otcTradeHistoryV2Error: error,
    loadingOtcTradeHistoryV2: loading,
    refreshOtcTradeHistoryV2: refresh
  };
}
