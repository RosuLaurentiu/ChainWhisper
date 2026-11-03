import { useCallback, useEffect, useRef, useState } from 'react';
import type { OtcTradeHistoryV2Runtime } from '../../../lib/otcTradeHistoryV2Runtime';
import type { TradeHistoryV2ExecutionRow } from '../../../lib/tradeHistoryV2Ledger';
import type { TradeHistoryV2CanonicalLifecycleEvent } from '../../../lib/tradeHistoryV2Materialize';
import { getProviderErrorMessage } from '../../../lib/appShared/core';

const EMPTY_ROWS: readonly TradeHistoryV2ExecutionRow[] = Object.freeze([]);
const EMPTY_LIFECYCLE_EVENTS: readonly TradeHistoryV2CanonicalLifecycleEvent[] = Object.freeze([]);

type VerifiedOtcHistoryPortfolio = Readonly<{
  rows: readonly TradeHistoryV2ExecutionRow[];
  lifecycleEvents: readonly TradeHistoryV2CanonicalLifecycleEvent[];
  hasMore: boolean;
}>;

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

export const loadVerifiedOtcHistoryPage = async ({
  runtime,
  contractAddresses,
  mode = 'latest',
  shouldContinue = () => true
}: {
  runtime: OtcTradeHistoryV2Runtime;
  contractAddresses?: readonly string[];
  mode?: 'latest' | 'older';
  shouldContinue?: () => boolean;
}): Promise<VerifiedOtcHistoryPortfolio> => {
  const requested = contractAddresses && new Set(contractAddresses.map(address => address.toLowerCase()));
  if (!shouldContinue() || !runtime.isCurrent()) {
    throw new Error('Verified OTC history runtime changed before the page read.');
  }
  const result = await runtime.sync(contractAddresses, mode);
  if (!shouldContinue() || !runtime.isCurrent()) {
    throw new Error('Verified OTC history runtime changed before portfolio publication.');
  }
  return Object.freeze({
    rows: Object.freeze(runtime.rows().filter(row => !requested || requested.has(row.order.contractAddress))),
    lifecycleEvents: Object.freeze(runtime.lifecycleEvents().filter(event => !requested || requested.has(event.contractAddress))),
    hasMore: result.hasMore
  });
};

export default function useOtcTradeHistoryV2Data(
  runtime: OtcTradeHistoryV2Runtime | null | undefined,
  dataScopeKey: string,
  contractAddresses?: readonly string[],
  privateReadsEnabled = false,
  enabled = true
) {
  const contractsKey = contractAddresses?.map(address => address.toLowerCase()).sort().join(',') ?? '';
  const normalizedDataScopeKey = dataScopeKey.trim()
    ? `${dataScopeKey.trim().toLowerCase()}:${contractsKey}:${privateReadsEnabled ? 'private' : 'public'}` : '';
  const [rows, setRows] = useState<readonly TradeHistoryV2ExecutionRow[]>(EMPTY_ROWS);
  const [lifecycleEvents, setLifecycleEvents] = useState<readonly TradeHistoryV2CanonicalLifecycleEvent[]>(
    EMPTY_LIFECYCLE_EVENTS
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [verifiedScopeKey, setVerifiedScopeKey] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const activeScopeKeyRef = useRef(normalizedDataScopeKey);
  const liveContextRef = useRef({ runtime, scope: normalizedDataScopeKey, enabled });
  liveContextRef.current = { runtime, scope: normalizedDataScopeKey, enabled };
  const busyRef = useRef(false);
  const readingRef = useRef(false), refreshQueuedRef = useRef(false);
  const nextReadRef = useRef<{ runtime: typeof runtime; scope: string; mode: 'latest' | 'older' } | null>(null);
  const admittedReadRef = useRef<{ runtime: typeof runtime; scope: string; revision: number } | null>(null);
  // Participant priority gates new reads, not publication of an already admitted read.
  const readEnabled = enabled || (admittedReadRef.current !== null && admittedReadRef.current.runtime === runtime &&
    admittedReadRef.current.scope === normalizedDataScopeKey && admittedReadRef.current.revision === refreshRevision);
  const refresh = useCallback(() => {
    if (busyRef.current) {
      if (readingRef.current) refreshQueuedRef.current = true;
      return;
    }
    busyRef.current = true;
    nextReadRef.current = null;
    setRefreshRevision(value => value + 1);
  }, []);
  const loadOlder = useCallback(() => {
    const live = liveContextRef.current;
    if (!enabled || !runtime?.isCurrent() || !hasMore || busyRef.current ||
        live.runtime !== runtime || live.scope !== normalizedDataScopeKey || !live.enabled) return;
    busyRef.current = true;
    nextReadRef.current = { runtime, scope: normalizedDataScopeKey, mode: 'older' };
    setRefreshRevision(value => value + 1);
  }, [enabled, hasMore, normalizedDataScopeKey, runtime]);

  useEffect(() => {
    let cancelled = false;
    const observeReads = (import.meta.env.DEV || import.meta.env.MODE === 'coti-testnet-candidate') &&
      typeof document !== 'undefined';
    const reportCoverage = (state: 'unavailable' | 'deferred' | 'loading' | 'partial' | 'complete' | 'error') => {
      if (cancelled || !observeReads) return;
      try {
        document.documentElement.setAttribute('data-p2p-canonical-history', JSON.stringify({
          state,
          requestedContractAddresses: contractsKey ? contractsKey.split(',') :
            Object.values(runtime?.deployments ?? {}).map(deployment => deployment.contractAddress).sort(),
          privateReadsEnabled,
          sampledAt: Date.now()
        }));
      } catch { /* Diagnostic output must not affect history reads. */ }
    };
    const cleanup = () => {
      cancelled = true;
      admittedReadRef.current = null;
      busyRef.current = false;
      readingRef.current = false;
      refreshQueuedRef.current = false;
      if (observeReads) {
        try { document.documentElement.removeAttribute('data-p2p-canonical-history'); }
        catch { /* Same diagnostic boundary. */ }
      }
    };
    const requestScopeKey = normalizedDataScopeKey;
    const scopeChanged = activeScopeKeyRef.current !== requestScopeKey;
    activeScopeKeyRef.current = requestScopeKey;
    if (!requestScopeKey) {
      setVerifiedScopeKey('');
      setRows(EMPTY_ROWS);
      setLifecycleEvents(EMPTY_LIFECYCLE_EVENTS);
      setError('');
      setLoading(false);
      setHasMore(false);
      reportCoverage('unavailable');
      return cleanup;
    }

    if (scopeChanged) {
      setVerifiedScopeKey('');
      setRows(EMPTY_ROWS);
      setLifecycleEvents(EMPTY_LIFECYCLE_EVENTS);
      setHasMore(false);
    }
    if (!runtime || !runtime.isCurrent()) {
      // Keep an already verified portfolio visible for the same immutable
      // deployment/network/wallet scope while its runtime is replaced.
      setLoading(false);
      busyRef.current = false;
      reportCoverage('unavailable');
      return cleanup;
    }
    setLoading(true);
    setError('');
    if (!readEnabled) {
      // Keep honest pending coverage without competing with initial owner
      // discovery. The admitted runtime and prior same-scope rows stay alive.
      reportCoverage('deferred');
      busyRef.current = false;
      return cleanup;
    }
    busyRef.current = true;
    readingRef.current = true;
    admittedReadRef.current = { runtime, scope: requestScopeKey, revision: refreshRevision };
    const pendingRead = nextReadRef.current;
    nextReadRef.current = null;
    const mode = pendingRead?.runtime === runtime && pendingRead.scope === requestScopeKey ? pendingRead.mode : 'latest';
    const isCurrent = () => !cancelled && runtime.isCurrent() &&
      liveContextRef.current.runtime === runtime && liveContextRef.current.scope === requestScopeKey;
    reportCoverage('loading');
    const publish = (portfolio: VerifiedOtcHistoryPortfolio) => {
      if (!isCurrent()) return false;
      // A superseded runtime can still hold its prior private projection.
      // Locked History keeps the public execution marker, never its decrypted amounts.
      setRows(privateReadsEnabled ? portfolio.rows : Object.freeze(portfolio.rows.map(row =>
        row.source === 'participant-receipt'
          ? { ...row, source: 'private-marker' as const, amountState: 'unavailable' as const, amounts: {} }
          : row)));
      setLifecycleEvents(portfolio.lifecycleEvents);
      setVerifiedScopeKey(requestScopeKey);
      return true;
    };
    void (async () => {
      const page = await loadVerifiedOtcHistoryPage({
        runtime,
        contractAddresses: contractsKey ? contractsKey.split(',') : undefined,
        mode,
        shouldContinue: isCurrent
      });
      if (!isCurrent()) return;
      publish(page);
      setHasMore(page.hasMore);
      setLoading(false);
      busyRef.current = false;
      reportCoverage(page.hasMore ? 'partial' : 'complete');
    })().catch((cause) => {
      if (cancelled) return;
      busyRef.current = false;
      refreshQueuedRef.current = false;
      if (activeScopeKeyRef.current !== requestScopeKey) {
        setVerifiedScopeKey('');
        setRows(EMPTY_ROWS);
        setLifecycleEvents(EMPTY_LIFECYCLE_EVENTS);
      }
      setLoading(false);
      setError(getProviderErrorMessage(cause, 'Verified OTC history could not be loaded.'));
      reportCoverage('error');
    }).finally(() => {
      if (cancelled) return;
      readingRef.current = false;
      if (refreshQueuedRef.current && isCurrent()) {
        refreshQueuedRef.current = false;
        busyRef.current = true;
        nextReadRef.current = null;
        setRefreshRevision(value => value + 1);
      }
    });

    return cleanup;
  }, [contractsKey, readEnabled, normalizedDataScopeKey, privateReadsEnabled, refreshRevision, runtime]);

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
    initialOtcTradeHistoryV2Pending: enabled && loading && !displayVerifiedRows,
    hasMoreOtcTradeHistoryV2: displayVerifiedRows && Boolean(runtime?.isCurrent()) && hasMore,
    completeOtcTradeHistoryV2: displayVerifiedRows && Boolean(runtime?.isCurrent()) && !hasMore && !loading && !error,
    loadOlderOtcTradeHistoryV2: loadOlder,
    refreshOtcTradeHistoryV2: refresh
  };
}
