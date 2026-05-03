import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  getOnchainContractAddress,
  getOnchainContractExplorerUrl,
  loadDashboardData,
  toChartPoint,
  type TreasuryChartPoint,
  type TreasurySnapshot
} from '../lib/treasuryData';

const REFRESH_INTERVAL_MS = 60_000;
const SECONDS_PER_DAY = 86_400;
const CHART_SURFACE_COLOR = '#0d1020';
const HORIZONTAL_GRID_STROKE = 'rgba(111, 112, 148, 0.26)';
const VERTICAL_GRID_STROKE = 'rgba(111, 112, 148, 0.12)';
const CURSOR_LINE_STROKE = 'rgba(203, 213, 225, 0.22)';

const TIMEFRAME_OPTIONS = [
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null }
] as const;

type TimeframeKey = (typeof TIMEFRAME_OPTIONS)[number]['key'];

const METRIC_OPTIONS = {
  activeGcoti: {
    color: '#34d399',
    label: 'Active gCOTI',
    lineStart: '#86efac',
    lineEnd: '#22c55e',
    shadowColor: 'rgba(34, 197, 94, 0.26)',
    valueFormatter: (value: number) => formatCompact(value, 1)
  },
  cotiInPool: {
    color: '#38bdf8',
    label: 'COTI in pool',
    lineStart: '#93c5fd',
    lineEnd: '#2563eb',
    shadowColor: 'rgba(56, 189, 248, 0.28)',
    valueFormatter: (value: number) => formatCompact(value, 1)
  },
  maxTotalApy: {
    color: '#c084fc',
    label: 'Total APY',
    lineStart: '#f0abfc',
    lineEnd: '#8b5cf6',
    shadowColor: 'rgba(192, 132, 252, 0.24)',
    valueFormatter: (value: number) => `${value.toFixed(2)}%`
  },
  maxApy: {
    color: '#7dd3fc',
    label: 'Base APY',
    lineStart: '#bae6fd',
    lineEnd: '#0ea5e9',
    shadowColor: 'rgba(14, 165, 233, 0.24)',
    valueFormatter: (value: number) => `${value.toFixed(2)}%`
  },
  maxBoostApy: {
    color: '#a78bfa',
    label: 'Boost APY',
    lineStart: '#ddd6fe',
    lineEnd: '#8b5cf6',
    shadowColor: 'rgba(139, 92, 246, 0.25)',
    valueFormatter: (value: number) => `${value.toFixed(2)}%`
  }
} as const;

type MetricKey = keyof typeof METRIC_OPTIONS;

type TreasuryStatus = 'loading' | 'ready' | 'error';

type TooltipPayloadEntry = {
  value: number;
  dataKey: MetricKey;
  payload: TreasuryChartPoint;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
};

type CrosshairCursorProps = {
  className?: string;
  height?: number;
  left?: number;
  payload?: TooltipPayloadEntry[];
  points?: Array<{ x: number; y: number }>;
  top?: number;
  width?: number;
  yDomain: [number, number];
};

type DotProps = {
  color?: string;
  cx?: number;
  cy?: number;
};

function formatCompact(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    notation: 'compact'
  }).format(value);
}

function formatNumber(value: number, maximumFractionDigits = 0, minimumFractionDigits = maximumFractionDigits): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    minimumFractionDigits
  }).format(value);
}

function formatDayLabel(day: number): string {
  const dayString = String(day);
  const year = Number(dayString.slice(0, 4));
  const month = Number(dayString.slice(4, 6)) - 1;
  const date = Number(dayString.slice(6, 8));
  const parsedDate = new Date(Date.UTC(year, month, date));

  return parsedDate.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  });
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  });
}

function shortHash(value: string | null | undefined): string {
  if (!value) {
    return 'pending';
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortAddress(value: string | null | undefined): string {
  if (!value) {
    return '--';
  }

  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatAxisDate(value: number, spanDays: number): string {
  const date = new Date(Number(value) * 1000);
  const dateOptions: Intl.DateTimeFormatOptions =
    spanDays <= 45
      ? { day: 'numeric', month: 'short', timeZone: 'UTC' }
      : spanDays <= 400
        ? { month: 'short', timeZone: 'UTC' }
        : { month: 'short', timeZone: 'UTC', year: '2-digit' };

  return date.toLocaleDateString('en-US', dateOptions);
}

function getSelectedTimeframe(timeframeKey: TimeframeKey) {
  return TIMEFRAME_OPTIONS.find((option) => option.key === timeframeKey) || TIMEFRAME_OPTIONS[0];
}

function filterGraphData(points: TreasuryChartPoint[], timeframeKey: TimeframeKey): TreasuryChartPoint[] {
  const selectedTimeframe = getSelectedTimeframe(timeframeKey);

  if (selectedTimeframe.days === null || points.length <= 2) {
    return points;
  }

  const latestPoint = points[points.length - 1];
  const latestCapturedAtUnix = Number(latestPoint?.capturedAtUnix ?? 0);
  if (!Number.isFinite(latestCapturedAtUnix)) {
    return points;
  }

  const cutoff = latestCapturedAtUnix - selectedTimeframe.days * SECONDS_PER_DAY;
  const firstVisibleIndex = points.findIndex((point) => Number(point.capturedAtUnix) >= cutoff);

  if (firstVisibleIndex <= 0) {
    return points;
  }

  return points.slice(firstVisibleIndex - 1);
}

function getXAxisDomain(
  points: TreasuryChartPoint[],
  {
    minPaddingSeconds = 21_600,
    paddingFraction = 0.05
  }: {
    minPaddingSeconds?: number;
    paddingFraction?: number;
  } = {}
): [number, number] {
  const timestamps = points.map((point) => Number(point.capturedAtUnix)).filter(Number.isFinite);

  if (timestamps.length === 0) {
    return [0, 1];
  }

  if (timestamps.length === 1) {
    return [timestamps[0] - SECONDS_PER_DAY / 2, timestamps[0] + SECONDS_PER_DAY / 2];
  }

  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const padding = Math.max(minPaddingSeconds, Math.round((maxTimestamp - minTimestamp) * paddingFraction));

  return [minTimestamp - padding, maxTimestamp + padding];
}

function getVisibleSpanDays(domain: [number, number]): number {
  const [start, end] = domain;
  return Math.max(1, Math.ceil((end - start) / SECONDS_PER_DAY));
}

function getCompactUnit(value: number): number {
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1_000_000_000) {
    return 1_000_000_000;
  }

  if (absoluteValue >= 1_000_000) {
    return 1_000_000;
  }

  if (absoluteValue >= 1_000) {
    return 1_000;
  }

  return 1;
}

function formatMetricAxisValue(value: number, metric: MetricKey, step: number): string {
  if (metric.toLowerCase().includes('apy')) {
    const precision = getStepPrecision(step);
    return `${value.toFixed(precision)}%`;
  }

  const unit = getCompactUnit(value);
  const normalizedStep = step / unit;
  const maximumFractionDigits = normalizedStep >= 1 ? 0 : normalizedStep >= 0.1 ? 1 : normalizedStep >= 0.01 ? 2 : 3;

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    notation: 'compact'
  }).format(value);
}

function getStepPrecision(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 0;
  }

  const exponent = Math.floor(Math.log10(step));
  const normalized = step / 10 ** exponent;
  const hasHalfStep = Math.abs(normalized - Math.round(normalized)) > 1e-9;

  return Math.max(0, -exponent + (hasHalfStep ? 1 : 0));
}

function getMetricAxisStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;

  if (normalized <= 1.5) {
    return magnitude;
  }

  if (normalized <= 2.25) {
    return magnitude * 2;
  }

  if (normalized <= 3.5) {
    return magnitude * 2.5;
  }

  if (normalized <= 7.5) {
    return magnitude * 5;
  }

  return magnitude * 10;
}

function getNextMetricAxisStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(step));
  const normalized = step / magnitude;
  const nextNormalized = [1, 2, 2.5, 5, 10].find((candidate) => candidate - normalized > 1e-9);

  if (nextNormalized) {
    return nextNormalized * magnitude;
  }

  return magnitude * 10;
}

function buildAxisTicks(minValue: number, maxValue: number, step: number): number[] {
  const tickCount = Math.max(1, Math.round((maxValue - minValue) / step));
  return Array.from({ length: tickCount + 1 }, (_value, index) => roundToStep(minValue + index * step, step));
}

function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(10));
}

function getMetricAxisConfig(points: TreasuryChartPoint[], metric: MetricKey) {
  const values = points.map((point) => Number(point[metric])).filter(Number.isFinite);

  if (values.length === 0) {
    return {
      domain: [0, 1] as [number, number],
      step: 1,
      ticks: [0, 1]
    };
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const isApyMetric = metric.toLowerCase().includes('apy');
  const desiredStepTickCount = isApyMetric ? 5 : 6;
  const maxVisibleTickCount = isApyMetric ? 6 : 7;
  const range = maxValue - minValue;
  const fallbackRange = isApyMetric ? 0.02 : Math.max(Math.abs(maxValue) * 0.01, 1);
  const effectiveRange = range === 0 ? fallbackRange : range;

  let step = getMetricAxisStep(effectiveRange / Math.max(desiredStepTickCount - 1, 1));
  let firstTick = roundToStep(Math.floor(minValue / step) * step, step);
  let lastTick = roundToStep(Math.ceil(maxValue / step) * step, step);
  let ticks = buildAxisTicks(firstTick, lastTick, step);

  while (ticks.length > maxVisibleTickCount) {
    step = getNextMetricAxisStep(step);
    firstTick = roundToStep(Math.floor(minValue / step) * step, step);
    lastTick = roundToStep(Math.ceil(maxValue / step) * step, step);
    ticks = buildAxisTicks(firstTick, lastTick, step);
  }

  const edgePadding =
    range === 0
      ? step * (isApyMetric ? 0.12 : 0.18)
      : Math.min(step * 0.08, Math.max(range * (isApyMetric ? 0.06 : 0.05), step * 0.02));
  const lowerBound = firstTick >= 0 ? Math.max(0, firstTick - edgePadding) : firstTick - edgePadding;
  const upperBound = lastTick + edgePadding;

  return {
    domain: [lowerBound, upperBound] as [number, number],
    step,
    ticks
  };
}

function formatTimeframeDetail(timeframeKey: TimeframeKey): string {
  const selectedTimeframe = getSelectedTimeframe(timeframeKey);
  return selectedTimeframe.days === null ? 'Full history' : `${selectedTimeframe.label} window`;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0];
  const metric = METRIC_OPTIONS[point.dataKey];
  const tooltipTitle = point.payload.isLive
    ? `Live / ${formatTimestamp(point.payload.capturedAt)}`
    : `Saved / ${formatTimestamp(point.payload.capturedAt)}`;

  return (
    <div className="treasury-chart-tooltip">
      <p>{tooltipTitle}</p>
      <strong>{metric.valueFormatter(point.value)}</strong>
    </div>
  );
}

function CrosshairCursor({ className, height = 0, left = 0, payload, points, top = 0, width = 0, yDomain }: CrosshairCursorProps) {
  const [domainMin, domainMax] = yDomain;
  const activeValue = Number(payload?.[0]?.value);
  const usableHeight = Math.max(height, 0);
  const domainSpan = domainMax - domainMin;
  const x = points?.[0]?.x;

  if (!Number.isFinite(x)) {
    return null;
  }

  let horizontalY: number | null = null;
  if (Number.isFinite(activeValue) && Number.isFinite(domainSpan) && domainSpan !== 0 && usableHeight > 0) {
    const valueRatio = (domainMax - activeValue) / domainSpan;
    horizontalY = top + Math.min(Math.max(valueRatio, 0), 1) * usableHeight;
  }

  return (
    <g className={className} pointerEvents="none">
      <line
        x1={x}
        x2={x}
        y1={top}
        y2={top + usableHeight}
        stroke={CURSOR_LINE_STROKE}
        strokeDasharray="3 8"
        strokeWidth={1}
      />
      {horizontalY != null ? (
        <line
          x1={left}
          x2={left + width}
          y1={horizontalY}
          y2={horizontalY}
          stroke={CURSOR_LINE_STROKE}
          strokeDasharray="3 8"
          strokeWidth={1}
        />
      ) : null}
    </g>
  );
}

function HoverActiveDot({ color = METRIC_OPTIONS.cotiInPool.color, cx, cy }: DotProps) {
  if (cx == null || cy == null) {
    return null;
  }

  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={11} fill={color} opacity={0.14} />
      <circle cx={cx} cy={cy} r={6} fill={CHART_SURFACE_COLOR} stroke={color} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={2.6} fill={color} />
    </g>
  );
}

function TreasuryStatCard({
  label,
  value,
  detail,
  tone = ''
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className={`treasury-stat-card ${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function TreasuryDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="treasury-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TreasuryMetaCard({
  href,
  label,
  value,
  live = false,
}: {
  href?: string | null;
  label: string;
  value: string;
  live?: boolean;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>
        {live ? <i className="treasury-status-dot" aria-hidden="true" /> : null}
        {value}
      </strong>
    </>
  );

  if (!href) {
    return <div className={`treasury-meta-card ${live ? 'treasury-meta-card-live' : ''}`}>{content}</div>;
  }

  return (
    <a
      className={`treasury-meta-card treasury-meta-card-link ${live ? 'treasury-meta-card-live' : ''}`}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {content}
    </a>
  );
}

export default function TreasuryPage({ isCompactLayout = false }: { isCompactLayout?: boolean }) {
  const [metric, setMetric] = useState<MetricKey>('cotiInPool');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('30d');
  const [livePoint, setLivePoint] = useState<TreasurySnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<TreasurySnapshot[]>([]);
  const [status, setStatus] = useState<TreasuryStatus>('loading');
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSnapshots({ forceRefresh = false, isBackground = false } = {}) {
      try {
        if (!isBackground) {
          setStatus('loading');
          setError('');
        }

        const dashboardData = await loadDashboardData({ forceRefresh: forceRefresh || isBackground });

        if (!cancelled) {
          const hasAnyData = Boolean(dashboardData.livePoint || dashboardData.snapshots.length > 0);

          if (isBackground && !hasAnyData) {
            setError('Background refresh could not reach any treasury data source. Showing the last loaded data.');
            return;
          }

          setLivePoint(dashboardData.livePoint);
          setSnapshots(dashboardData.snapshots);
          setError(hasAnyData ? '' : 'No treasury data source returned usable data.');
          setStatus(hasAnyData ? 'ready' : 'error');
        }
      } catch (requestError) {
        if (!cancelled) {
          if (isBackground) {
            console.warn('[dashboard] background refresh failed', requestError);
            return;
          }

          setError(requestError instanceof Error ? requestError.message : String(requestError));
          setStatus('error');
        }
      }
    }

    void hydrateSnapshots({ forceRefresh: refreshNonce > 0 });
    const timerId = window.setInterval(() => {
      void hydrateSnapshots({ isBackground: true });
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [refreshNonce]);

  const chartData = useMemo(
    () => snapshots.map((snapshot) => toChartPoint(snapshot, formatDayLabel(snapshot.day))),
    [snapshots]
  );

  const liveChartPoint = useMemo(() => (livePoint ? toChartPoint(livePoint, 'Live') : null), [livePoint]);

  const graphData = useMemo(() => {
    if (!liveChartPoint) {
      return chartData;
    }

    return [...chartData, liveChartPoint].sort((left, right) => {
      const leftTime = Number(left.capturedAtUnix || 0);
      const rightTime = Number(right.capturedAtUnix || 0);
      return leftTime - rightTime;
    });
  }, [chartData, liveChartPoint]);

  const filteredGraphData = useMemo(() => filterGraphData(graphData, timeframe), [graphData, timeframe]);
  const xAxisDomain = useMemo(
    () =>
      getXAxisDomain(
        filteredGraphData,
        isCompactLayout ? { minPaddingSeconds: 3_600, paddingFraction: 0.008 } : undefined
      ),
    [filteredGraphData, isCompactLayout]
  );
  const visibleSpanDays = useMemo(() => getVisibleSpanDays(xAxisDomain), [xAxisDomain]);
  const yAxisConfig = useMemo(() => getMetricAxisConfig(filteredGraphData, metric), [filteredGraphData, metric]);
  const isApyMetric = metric.toLowerCase().includes('apy');
  const metricOption = METRIC_OPTIONS[metric];
  const chartMargin = useMemo(
    () => (isCompactLayout ? { top: 12, right: 16, bottom: 0, left: 4 } : { top: 14, right: 12, bottom: 6, left: 0 }),
    [isCompactLayout]
  );
  const yAxisWidth = isCompactLayout ? (isApyMetric ? 54 : 58) : isApyMetric ? 76 : 90;
  const selectedTimeframe = useMemo(() => getSelectedTimeframe(timeframe), [timeframe]);
  const contractAddress = useMemo(() => getOnchainContractAddress(), []);
  const contractExplorerUrl = useMemo(() => getOnchainContractExplorerUrl(), []);

  const latestSaved = chartData[chartData.length - 1];
  const currentPoint = liveChartPoint || latestSaved;
  const recentRows = [...chartData].reverse().slice(0, 8);
  const retryTreasuryData = () => {
    setRefreshNonce((previous) => previous + 1);
  };

  return (
    <main className="treasury-shell">
      <section className="treasury-hero">
        <div className="treasury-hero-copy">
          <p className="landing-eyebrow">Treasury Data</p>
          <h1 className="treasury-title">Live treasury, history, and onchain references.</h1>
          <p className="treasury-description">Current treasury visibility, saved checkpoints, and explorer-backed records in one page.</p>
        </div>

        <div className="treasury-hero-bottom">
          <div className="treasury-meta-grid">
            <TreasuryMetaCard href={contractExplorerUrl} label="Contract" value={shortAddress(contractAddress)} />
            <TreasuryMetaCard label="Network" value="COTI Mainnet" />
            <TreasuryMetaCard label="Saved snapshots" value={String(snapshots.length)} />
            <TreasuryMetaCard
              label="Feed"
              value={liveChartPoint ? 'Live feed online' : status === 'loading' ? 'Loading feed' : 'Live feed unavailable'}
              live={Boolean(liveChartPoint)}
            />
          </div>
        </div>
      </section>

      <section className="treasury-panel treasury-performance-panel">
        <div className="treasury-section-head treasury-section-head-compact">
          <h2 className="treasury-section-title">Treasury performance</h2>
        </div>

        <div className="treasury-stat-grid">
          <TreasuryStatCard
            label="Current COTI"
            value={currentPoint ? formatNumber(currentPoint.cotiInPool) : '--'}
            detail={liveChartPoint ? 'Live treasury feed' : 'Latest saved snapshot'}
            tone="treasury-stat-card-coti"
          />
          <TreasuryStatCard
            label="Current gCOTI"
            value={currentPoint ? formatNumber(currentPoint.activeGcoti) : '--'}
            detail={liveChartPoint ? 'Live treasury feed' : 'Latest saved snapshot'}
            tone="treasury-stat-card-gcoti"
          />
          <TreasuryStatCard
            label="Total APY"
            value={currentPoint ? `${currentPoint.maxTotalApy.toFixed(2)}%` : '--'}
            detail={liveChartPoint ? 'Live treasury feed' : 'Latest saved snapshot'}
          />
          <TreasuryStatCard
            label="Latest saved"
            value={latestSaved ? formatDayLabel(latestSaved.day) : '--'}
            detail={latestSaved ? formatTimestamp(latestSaved.capturedAt) : 'No saved history yet'}
          />
        </div>

        <div className="treasury-toolbar">
          <div className="treasury-toolbar-group">
            <span className="treasury-toolbar-label">Metric</span>
            <div className="treasury-pill-group">
              {Object.entries(METRIC_OPTIONS).map(([key, option]) => (
                <button
                  key={key}
                  data-metric={key}
                  className={key === metric ? 'treasury-pill-button active' : 'treasury-pill-button'}
                  onClick={() => setMetric(key as MetricKey)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="treasury-toolbar-group treasury-toolbar-group-align-end">
            <span className="treasury-toolbar-label">Window</span>
            <div className="treasury-pill-group treasury-pill-group-compact">
              {TIMEFRAME_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={option.key === timeframe ? 'treasury-pill-button active' : 'treasury-pill-button'}
                  onClick={() => setTimeframe(option.key)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="treasury-chart-surface">
          {status === 'loading' ? <p className="treasury-state-message" aria-live="polite">Loading dashboard...</p> : null}
          {status === 'error' ? (
            <div className="treasury-state-card treasury-state-card-error" role="status" aria-live="polite">
              <strong>Treasury data unavailable</strong>
              <p>{error || 'No treasury data source returned usable data.'}</p>
              <button type="button" onClick={retryTreasuryData}>
                Retry
              </button>
            </div>
          ) : null}
          {status === 'ready' && filteredGraphData.length === 0 ? (
            <div className="treasury-state-card" role="status" aria-live="polite">
              <strong>No snapshots yet</strong>
              <p>Live data may still be available above. Retry if the feed was just updated.</p>
              <button type="button" onClick={retryTreasuryData}>
                Retry
              </button>
            </div>
          ) : null}
          {status === 'ready' && filteredGraphData.length > 0 ? (
            <ResponsiveContainer width="100%" height={isCompactLayout ? 320 : 400}>
              <LineChart data={filteredGraphData} margin={chartMargin}>
                <CartesianGrid stroke={HORIZONTAL_GRID_STROKE} strokeDasharray="4 8" vertical={false} />
                <CartesianGrid stroke={VERTICAL_GRID_STROKE} strokeDasharray="3 14" horizontal={false} />
                <XAxis
                  type="number"
                  dataKey="capturedAtUnix"
                  scale="time"
                  domain={xAxisDomain}
                  stroke="#8f84b3"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => formatAxisDate(Number(value), visibleSpanDays)}
                  tickCount={isCompactLayout ? 5 : visibleSpanDays <= 45 ? 6 : 5}
                  minTickGap={isCompactLayout ? 16 : 24}
                  tickMargin={isCompactLayout ? 10 : 8}
                  tick={{ fill: '#a89ed0', fontSize: isCompactLayout ? 11 : 13 }}
                />
                <YAxis
                  stroke="#8f84b3"
                  tickLine={false}
                  axisLine={false}
                  domain={yAxisConfig.domain}
                  ticks={yAxisConfig.ticks}
                  tickFormatter={(value) => formatMetricAxisValue(Number(value), metric, yAxisConfig.step)}
                  tickMargin={isCompactLayout ? 4 : 10}
                  tick={{ fill: '#b7addd', fontSize: isCompactLayout ? 10.5 : 13, fontWeight: 600 }}
                  width={yAxisWidth}
                />
                <Tooltip content={<CustomTooltip />} cursor={<CrosshairCursor yDomain={yAxisConfig.domain} />} />
                <Line
                  type="monotone"
                  dataKey={metric}
                  dot={false}
                  activeDot={false}
                  stroke={metricOption.color}
                  strokeOpacity={0.18}
                  strokeWidth={isCompactLayout ? 7 : 8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey={metric}
                  dot={false}
                  activeDot={(props: DotProps) => <HoverActiveDot {...props} color={metricOption.color} />}
                  stroke={metricOption.color}
                  strokeWidth={isCompactLayout ? 2.4 : 2.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: `drop-shadow(0 8px 13px ${metricOption.shadowColor})` }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : null}
        </div>

        <div className="treasury-chart-footer">
          <span>{latestSaved ? `Latest saved: ${formatTimestamp(latestSaved.capturedAt)}` : 'No saved snapshots yet'}</span>
          <span>{`${formatTimeframeDetail(selectedTimeframe.key)} / Auto-scaled to visible range`}</span>
          <span>{liveChartPoint ? `Live refresh: ${formatTimestamp(liveChartPoint.capturedAt)}` : 'Live feed offline'}</span>
        </div>
      </section>

      <section className="treasury-lower-grid">
        <article className="treasury-panel">
          <div className="treasury-section-head treasury-section-head-compact">
            <div>
              <p className="landing-eyebrow">Latest Snapshot</p>
              <h2 className="treasury-section-title">{latestSaved ? formatDayLabel(latestSaved.day) : 'No saved data'}</h2>
            </div>
            <div className="treasury-chip">{latestSaved ? 'Recorded' : 'Waiting'}</div>
          </div>

          <div className="treasury-detail-grid">
            <TreasuryDetailItem label="COTI in pool" value={latestSaved ? formatNumber(latestSaved.cotiInPool) : '--'} />
            <TreasuryDetailItem label="Active gCOTI" value={latestSaved ? formatNumber(latestSaved.activeGcoti) : '--'} />
            <TreasuryDetailItem label="Base APY" value={latestSaved ? `${latestSaved.maxApy.toFixed(2)}%` : '--'} />
            <TreasuryDetailItem label="Total APY" value={latestSaved ? `${latestSaved.maxTotalApy.toFixed(2)}%` : '--'} />
          </div>

          <div className="treasury-anchor-card">
            <span>Onchain anchor</span>
            {latestSaved?.onchain?.txHash ? (
              <a className="treasury-anchor-link" href={latestSaved.onchain.explorerUrl || undefined} target="_blank" rel="noreferrer">
                {shortHash(latestSaved.onchain.txHash)}
              </a>
            ) : latestSaved?.onchain?.explorerUrl ? (
              <a className="treasury-anchor-link treasury-anchor-link-subtle" href={latestSaved.onchain.explorerUrl} target="_blank" rel="noreferrer">
                Open contract record
              </a>
            ) : latestSaved?.onchain?.alreadyExists ? (
              <p className="treasury-state-message">Already recorded onchain.</p>
            ) : (
              <p className="treasury-state-message">No transaction recorded.</p>
            )}
          </div>
        </article>

        <article className="treasury-panel">
          <div className="treasury-section-head treasury-section-head-compact">
            <div>
              <p className="landing-eyebrow">History</p>
              <h2 className="treasury-section-title">Recent snapshots</h2>
            </div>
            <div className="treasury-chip">{recentRows.length} rows</div>
          </div>

          <div className="treasury-table-wrap">
            <table className="treasury-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>COTI</th>
                  <th>gCOTI</th>
                  <th>Total APY</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No saved snapshots yet.</td>
                  </tr>
                ) : recentRows.map((row) => (
                  <tr key={row.day}>
                    <td>{row.label}</td>
                    <td>{formatNumber(row.cotiInPool)}</td>
                    <td>{formatNumber(row.activeGcoti)}</td>
                    <td>{row.maxTotalApy.toFixed(2)}%</td>
                    <td>
                      {row.onchain?.txHash ? (
                        <a href={row.onchain.explorerUrl || undefined} target="_blank" rel="noreferrer">
                          {shortHash(row.onchain.txHash)}
                        </a>
                      ) : row.onchain?.explorerUrl ? (
                        <a href={row.onchain.explorerUrl} target="_blank" rel="noreferrer">
                          onchain
                        </a>
                      ) : row.onchain?.alreadyExists ? (
                        'onchain'
                      ) : (
                        'pending'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}
