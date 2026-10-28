import { useCallback, useEffect, useState } from 'react';
import { getProviderErrorMessage } from '../../../lib/appShared/core';
import {
  buildPrivateLiquidityDailyPriceSeries,
  type PrivateLiquidityDailyPricePoint
} from '../../../lib/privateLiquidityDailyPrice';
import {
  attestPrivateLiquidityDailyPriceDeployment,
  bindPrivateLiquidityDailyPriceReadCapability,
  readLatestPrivateLiquidityDailyPrices
} from '../../../lib/privateLiquidityDailyPriceChain';
import {
  PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_CONFIG,
  type PrivateLiquidityDailyPriceDeploymentConfig
} from '../../../lib/privateLiquidityDailyPriceDeployment';
import { createPrivateLiquidityHttpProvider } from '../../../lib/privateLiquidityRpc';

const HISTORY_DAYS = 366n;
const EMPTY_POINTS: readonly PrivateLiquidityDailyPricePoint[] = Object.freeze([]);
export const PRIVATE_LIQUIDITY_DAILY_PRICE_BACKGROUND_REFRESH_MS = 5 * 60_000;
export const PRIVATE_LIQUIDITY_DAILY_PRICE_FOCUS_REFRESH_MINIMUM_MS = 30_000;

export type PrivateLiquidityDailyPriceRefreshOptions = Readonly<{ background?: boolean }>;

export const shouldRequestPrivateLiquidityDailyPriceBackgroundRefresh = ({
  now,
  lastRequestedAt,
  visible
}: {
  now: number;
  lastRequestedAt: number;
  visible: boolean;
}): boolean => Number.isFinite(now) && Number.isFinite(lastRequestedAt) && visible &&
  now >= lastRequestedAt + PRIVATE_LIQUIDITY_DAILY_PRICE_FOCUS_REFRESH_MINIMUM_MS;

export type PrivateLiquidityDailyPriceData = Readonly<{
  status: 'inactive' | 'configuration-error' | 'loading' | 'ready' | 'error';
  points: readonly PrivateLiquidityDailyPricePoint[];
  error: string;
  refresh: (options?: PrivateLiquidityDailyPriceRefreshOptions) => void;
}>;

type PrivateLiquidityDailyPriceView = Omit<PrivateLiquidityDailyPriceData, 'refresh'>;
type ScopedPrivateLiquidityDailyPriceView = PrivateLiquidityDailyPriceView & Readonly<{
  scopeKey: string;
  requestKey: string;
}>;

export const resolveScopedPrivateLiquidityDailyPriceView = ({
  requestKey,
  scopeKey,
  settled,
  fallback,
  preserveSettled = false
}: {
  requestKey: string;
  scopeKey: string;
  settled: ScopedPrivateLiquidityDailyPriceView;
  fallback: PrivateLiquidityDailyPriceView;
  preserveSettled?: boolean;
}): PrivateLiquidityDailyPriceView => {
  if (settled.requestKey === requestKey || (
    preserveSettled && settled.scopeKey === scopeKey && settled.status === 'ready'
  )) {
    return Object.freeze({ status: settled.status, points: settled.points, error: settled.error });
  }
  return fallback;
};

/** Public analytics only: this hook never requests a wallet provider or a signature. */
export default function usePrivateLiquidityDailyPriceData({
  enabled,
  pairKey,
  baseTokenDecimals,
  quoteTokenDecimals,
  config = PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_CONFIG
}: {
  enabled: boolean;
  pairKey?: string;
  baseTokenDecimals?: number;
  quoteTokenDecimals?: number;
  config?: PrivateLiquidityDailyPriceDeploymentConfig;
}): PrivateLiquidityDailyPriceData {
  const [request, setRequest] = useState(() => ({ revision: 0, background: false }));
  const [view, setView] = useState<ScopedPrivateLiquidityDailyPriceView>(() => ({
    scopeKey: '',
    requestKey: '',
    status: 'inactive',
    points: EMPTY_POINTS,
    error: ''
  }));
  const refresh = useCallback((options?: PrivateLiquidityDailyPriceRefreshOptions) => {
    setRequest((current) => ({
      revision: current.revision + 1,
      background: options?.background === true
    }));
  }, []);
  const fingerprint = config.status === 'active' ? config.fingerprint : config.status;
  const scopeKey = [
    enabled ? 'enabled' : 'disabled',
    fingerprint,
    pairKey ?? '',
    baseTokenDecimals?.toString() ?? '',
    quoteTokenDecimals?.toString() ?? ''
  ].join(':');
  const requestKey = `${scopeKey}:${request.revision}`;
  const fallback: PrivateLiquidityDailyPriceView = !enabled || !pairKey ||
    baseTokenDecimals === undefined || quoteTokenDecimals === undefined || config.status === 'inactive'
    ? Object.freeze({ status: 'inactive', points: EMPTY_POINTS, error: '' })
    : config.status === 'invalid'
      ? Object.freeze({ status: 'configuration-error', points: EMPTY_POINTS, error: config.error })
      : Object.freeze({ status: 'loading', points: EMPTY_POINTS, error: '' });

  useEffect(() => {
    const token = { active: true };
    if (!enabled || !pairKey || baseTokenDecimals === undefined || quoteTokenDecimals === undefined) {
      setView({ scopeKey, requestKey, status: 'inactive', points: EMPTY_POINTS, error: '' });
      return () => { token.active = false; };
    }
    if (config.status === 'inactive') {
      setView({ scopeKey, requestKey, status: 'inactive', points: EMPTY_POINTS, error: '' });
      return () => { token.active = false; };
    }
    if (config.status === 'invalid') {
      setView({ scopeKey, requestKey, status: 'configuration-error', points: EMPTY_POINTS, error: config.error });
      return () => { token.active = false; };
    }

    setView((current) => request.background && current.scopeKey === scopeKey && current.status === 'ready'
      ? current
      : { scopeKey, requestKey, status: 'loading', points: EMPTY_POINTS, error: '' });
    void (async () => {
      try {
        const assertCurrent = () => {
          if (!token.active) throw new Error('Daily marginal-price request was superseded.');
        };
        const capability = await bindPrivateLiquidityDailyPriceReadCapability({
          provider: createPrivateLiquidityHttpProvider({ rpcUrl: config.rpcUrl }),
          expectedChainId: BigInt(config.manifest.chainId),
          assertCurrent
        });
        const deployment = await attestPrivateLiquidityDailyPriceDeployment({
          capability,
          manifest: config.manifest,
          finalityLagBlocks: config.finalityLagBlocks
        });
        const page = await readLatestPrivateLiquidityDailyPrices({
          deployment,
          pairKey,
          count: HISTORY_DAYS
        });
        const points = buildPrivateLiquidityDailyPriceSeries({
          snapshots: page.snapshots,
          baseTokenDecimals,
          quoteTokenDecimals
        });
        assertCurrent();
        setView({ scopeKey, requestKey, status: 'ready', points, error: '' });
      } catch (error) {
        if (!token.active) return;
        setView({
          scopeKey,
          requestKey,
          status: 'error',
          points: EMPTY_POINTS,
          error: getProviderErrorMessage(error, 'Daily marginal-price history could not be verified.')
        });
      }
    })();
    return () => { token.active = false; };
  }, [baseTokenDecimals, enabled, fingerprint, pairKey, quoteTokenDecimals, request.background, requestKey, scopeKey]);

  useEffect(() => {
    if (
      typeof window === 'undefined' || typeof document === 'undefined' ||
      !enabled || !pairKey || baseTokenDecimals === undefined || quoteTokenDecimals === undefined ||
      config.status !== 'active'
    ) {
      return;
    }
    let lastRequestedAt = Date.now();
    const requestBackgroundRefresh = () => {
      const now = Date.now();
      if (!shouldRequestPrivateLiquidityDailyPriceBackgroundRefresh({
        now,
        lastRequestedAt,
        visible: document.visibilityState !== 'hidden'
      })) return;
      lastRequestedAt = now;
      refresh({ background: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestBackgroundRefresh();
    };
    const timer = window.setInterval(() => {
      requestBackgroundRefresh();
    }, PRIVATE_LIQUIDITY_DAILY_PRICE_BACKGROUND_REFRESH_MS);
    window.addEventListener('focus', requestBackgroundRefresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', requestBackgroundRefresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [baseTokenDecimals, config.status, enabled, fingerprint, pairKey, quoteTokenDecimals, refresh]);

  return Object.freeze({
    ...resolveScopedPrivateLiquidityDailyPriceView({
      requestKey,
      scopeKey,
      settled: view,
      fallback,
      preserveSettled: request.background
    }),
    refresh
  });
}
