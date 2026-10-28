import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatPrivateTvlAmount,
  formatPrivateTvlUsd,
  type PrivateTvlSnapshot,
  type PrivateTvlTokenRow
} from '../../../lib/privateTvl';
import { loadPrivateTvlData } from '../privateTvlData';

const COTI_MAINNET_EXPLORER_URL = 'https://mainnet.cotiscan.io';
const PRIVATE_TVL_REFRESH_INTERVAL_MS = 60_000;

type PrivateTvlLoadStatus = 'loading' | 'ready' | 'refreshing' | 'error';

const groupNumber = (value: string): string => {
  const [integer, fraction] = value.split('.');
  const grouped = (integer ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
};

const shortAddress = (value: string): string => `${value.slice(0, 6)}…${value.slice(-4)}`;

const formatUsdMoney = (valueE18: string): string => {
  const value = formatPrivateTvlUsd(valueE18, 2);
  const [integer, fraction = ''] = value.split('.');
  return groupNumber(`${integer}.${fraction.padEnd(2, '0')}`);
};

const formatTimestamp = (timestamp: string): string => {
  const milliseconds = Number(timestamp) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(milliseconds));
};

const coverageLabel = (row: PrivateTvlTokenRow): string => {
  if (row.coverageStatus === 'no-liability') return 'No private liability';
  if (row.coverageBps === null) return 'Unavailable';
  const ratio = formatPrivateTvlAmount({ atomic: row.coverageBps, decimals: 2, maximumFractionDigits: 2 });
  if (row.coverageStatus === 'exact') return `${ratio}% backed`;
  return `${ratio}% · ${row.coverageStatus === 'undercollateralized' ? 'shortfall' : 'excess reserve'}`;
};

const priceLabel = (row: PrivateTvlTokenRow): string => {
  if (row.priceStatus === 'unavailable' || row.priceRateE18 === null) return 'No verified USD reference';
  const price = groupNumber(formatPrivateTvlUsd(row.priceRateE18, 4));
  return row.priceStatus === 'stale' ? `$${price} · stale` : `$${price}`;
};

const usdValueLabel = (row: PrivateTvlTokenRow): string =>
  row.usdValueE18 === null ? 'Excluded from USD total' : `$${formatUsdMoney(row.usdValueE18)}`;

const normalizePrivateTvlError = (error: unknown): string => {
  if (error instanceof Error && /^Private TVL /.test(error.message)) return error.message;
  return 'COTI Private TVL could not be verified from the reviewed bridges and Band feed.';
};

function PrivateTvlMetaCard({
  label,
  value,
  href
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );
  return href ? (
    <a className="treasury-meta-card treasury-meta-card-link" href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="treasury-meta-card">{content}</div>
  );
}

function PrivateTvlStatCard({
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

export function PrivateTvlSnapshotView({ snapshot }: { snapshot: PrivateTvlSnapshot }) {
  const exactCoverageCount = snapshot.tokens.filter(({ coverageStatus }) => coverageStatus === 'exact').length;
  const coverageIssueCount = snapshot.tokens.filter(({ coverageStatus }) => coverageStatus === 'undercollateralized').length;
  const totalLabel = `$${formatUsdMoney(snapshot.totalUsdValueE18)}${snapshot.hasUnpricedValue ? ' priced' : ''}`;
  return (
    <>
      <section className="treasury-panel treasury-performance-panel" aria-labelledby="private-tvl-summary-title">
        <div className="treasury-section-head treasury-section-head-compact">
          <div>
            <p className="landing-eyebrow">Current safe-head snapshot</p>
            <h2 id="private-tvl-summary-title" className="treasury-section-title">Private assets locked on COTI</h2>
          </div>
        </div>
        <div className="treasury-stat-grid">
          <PrivateTvlStatCard
            label="Official Private TVL"
            value={totalLabel}
            detail={snapshot.hasUnpricedValue ? 'Verified Band-priced reserves only' : 'All reviewed bridge reserves priced'}
            tone="treasury-stat-card-primary"
          />
          <PrivateTvlStatCard
            label="Reviewed bridges"
            value={String(snapshot.totalTokenCount)}
            detail="Official COTI bridge pairs"
            tone="treasury-stat-card-coti"
          />
          <PrivateTvlStatCard
            label="Band-priced assets"
            value={`${snapshot.pricedTokenCount}/${snapshot.totalTokenCount}`}
            detail="Fresh verified USD references"
            tone="treasury-stat-card-gcoti"
          />
          <PrivateTvlStatCard
            label="Reserve coverage"
            value={coverageIssueCount === 0 ? `${exactCoverageCount} exact` : `${coverageIssueCount} warning`}
            detail="Liabilities are reconciled, never counted twice"
          />
        </div>
        {snapshot.hasUnpricedValue ? (
          <div className="treasury-state-card" role="status">
            <strong>The USD total is incomplete</strong>
            <p>At least one bridge has a stale or unavailable Band reference. Its locked tokens remain visible below but are excluded from the USD total.</p>
          </div>
        ) : null}
        {coverageIssueCount > 0 ? (
          <div className="treasury-state-card treasury-state-card-error" role="alert">
            <strong>Bridge coverage warning</strong>
            <p>At least one reviewed bridge reserve is below its reported private liability. The discrepancy is shown without changing the locked-reserve TVL definition.</p>
          </div>
        ) : null}
      </section>

      <section className="treasury-panel" aria-labelledby="private-tvl-assets-title">
        <div className="treasury-section-head treasury-section-head-compact">
          <div>
            <p className="landing-eyebrow">Official bridge reserves</p>
            <h2 id="private-tvl-assets-title" className="treasury-section-title">TVL by token</h2>
          </div>
          <div className="treasury-chip">{snapshot.tokens.length} assets</div>
        </div>
        <p id="private-tvl-table-hint" className="treasury-table-scroll-hint">Scroll horizontally to inspect every TVL field.</p>
        <div className="treasury-table-wrap" tabIndex={0} aria-labelledby="private-tvl-assets-title" aria-describedby="private-tvl-table-hint">
          <table className="treasury-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Locked reserve</th>
                <th>Private liability</th>
                <th>Coverage</th>
                <th>Band USD</th>
                <th>USD TVL</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.tokens.map((row) => (
                <tr key={row.pairId}>
                  <td>
                    <a href={`${COTI_MAINNET_EXPLORER_URL}/address/${row.bridgeAddress}`} target="_blank" rel="noreferrer">
                      {row.publicSymbol} / {row.privateSymbol}
                    </a>
                  </td>
                  <td>{groupNumber(formatPrivateTvlAmount({ atomic: row.reserveAtomic, decimals: row.decimals }))} {row.publicSymbol}</td>
                  <td>{groupNumber(formatPrivateTvlAmount({ atomic: row.liabilityAtomic, decimals: row.decimals }))} {row.privateSymbol}</td>
                  <td>{coverageLabel(row)}</td>
                  <td>{priceLabel(row)}</td>
                  <td>{usdValueLabel(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function PrivateTvlPage({ isCompactLayout = false }: { isCompactLayout?: boolean }) {
  const [snapshot, setSnapshot] = useState<PrivateTvlSnapshot | null>(null);
  const snapshotRef = useRef<PrivateTvlSnapshot | null>(null);
  const [status, setStatus] = useState<PrivateTvlLoadStatus>('loading');
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  const refresh = useCallback(async (forceRefresh: boolean) => {
    setStatus(snapshotRef.current === null ? 'loading' : 'refreshing');
    try {
      const next = await loadPrivateTvlData({ forceRefresh });
      if (!mountedRef.current) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setError('');
      setStatus('ready');
    } catch (nextError) {
      if (!mountedRef.current) return;
      setError(normalizePrivateTvlError(nextError));
      setStatus(snapshotRef.current === null ? 'error' : 'ready');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    void loadPrivateTvlData()
      .then((next) => {
        if (!active) return;
        snapshotRef.current = next;
        setSnapshot(next);
        setStatus('ready');
      })
      .catch((nextError) => {
        if (!active) return;
        setError(normalizePrivateTvlError(nextError));
        setStatus('error');
      });
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, PRIVATE_TVL_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  return (
    <main className="treasury-shell" data-compact-layout={isCompactLayout ? 'true' : 'false'}>
      <section className="treasury-hero">
        <div className="treasury-hero-copy">
          <p className="landing-eyebrow">COTI Private TVL</p>
          <h1 className="treasury-title">Private assets backed by reviewed COTI bridges.</h1>
          <p className="treasury-description">
            Public reserves locked in official privacy bridges, reconciled against private liabilities and valued with fresh Band USD references.
          </p>
        </div>
        <div className="treasury-hero-bottom">
          <div className="treasury-meta-grid">
            <PrivateTvlMetaCard label="Network" value="COTI Mainnet" />
            <PrivateTvlMetaCard
              label="Safe-head block"
              value={snapshot?.blockNumber ?? 'Verifying'}
              href={snapshot ? `${COTI_MAINNET_EXPLORER_URL}/block/${snapshot.blockNumber}` : undefined}
            />
            <PrivateTvlMetaCard
              label="Band proxy"
              value={snapshot ? shortAddress(snapshot.bandProxyAddress) : 'Verifying'}
              href={snapshot ? `${COTI_MAINNET_EXPLORER_URL}/address/${snapshot.bandProxyAddress}` : undefined}
            />
            <PrivateTvlMetaCard
              label="Observed"
              value={snapshot ? formatTimestamp(snapshot.blockTimestamp) : 'Waiting for chain data'}
            />
          </div>
        </div>
      </section>

      {status === 'loading' && snapshot === null ? (
        <section className="treasury-panel">
          <div className="treasury-state-card" role="status" aria-live="polite">
            <strong>Verifying COTI Private TVL</strong>
            <p>Reading bridges and Band prices at one safe-head block.</p>
          </div>
        </section>
      ) : null}
      {status === 'error' && snapshot === null ? (
        <section className="treasury-panel treasury-readiness-panel" aria-labelledby="private-tvl-unavailable-title">
          <div className="treasury-readiness-copy" role="alert">
            <p className="landing-eyebrow">Live verification paused</p>
            <h2 id="private-tvl-unavailable-title" className="treasury-section-title">Private TVL is temporarily unavailable</h2>
            <p>{error}</p>
            <button className="treasury-readiness-action" type="button" onClick={() => void refresh(true)}>Retry verification</button>
          </div>
          <div className="treasury-readiness-grid" aria-label="Private TVL verification safeguards">
            <article>
              <span>Values</span>
              <strong>No estimates shown</strong>
              <p>Totals stay blank until every source passes verification.</p>
            </article>
            <article>
              <span>Consistency</span>
              <strong>One safe-head block</strong>
              <p>Bridge reserves and liabilities are reconciled at the same block.</p>
            </article>
            <article>
              <span>Pricing</span>
              <strong>Fresh Band references</strong>
              <p>USD values are excluded when the reference is stale or unavailable.</p>
            </article>
          </div>
        </section>
      ) : null}
      {snapshot ? <PrivateTvlSnapshotView snapshot={snapshot} /> : null}
      {snapshot ? (
        <section className="treasury-panel">
          <div className="treasury-section-head treasury-section-head-compact">
            <div>
              <p className="landing-eyebrow">Method</p>
              <h2 className="treasury-section-title">Locked reserve, not double-counted supply</h2>
            </div>
            <button className="treasury-pill-button" type="button" disabled={status === 'refreshing'} onClick={() => void refresh(true)}>
              {status === 'refreshing' ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="treasury-state-message">
            TVL is the public asset balance locked in each official bridge. The corresponding private liability is displayed only to verify backing. Band values are informational and excluded whenever stale or unavailable.
          </p>
          {error ? <p className="error-text" role="status">{error}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
