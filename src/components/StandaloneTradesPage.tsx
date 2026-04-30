import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  COTI_NETWORK,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  formatMessageTimestamp,
  shortenAddress,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from '../lib/appShared';
import TradeOfferCard from './TradeOfferCard';

export type StandaloneTradeVisibility = 'public' | 'private';

type StandaloneTradesPageProps = {
  isConnected: boolean;
  onCotiNetwork: boolean;
  walletAddress: string;
  visibility: StandaloneTradeVisibility;
  onVisibilityChange: (value: StandaloneTradeVisibility) => void;
  tradeComposerContent: ReactNode;
  createdTradeId: number | null;
  createdTradeLink: string;
  publicTrades: TradeSnapshot[];
  loadingPublicTrades: boolean;
  publicTradesError: string;
  selectedTradeId: number | null;
  selectedTrade: TradeSnapshot | null;
  loadingSelectedTrade: boolean;
  selectedTradeError: string;
  selectedTradeAccessBlocked: boolean;
  processingTradeActionId: string;
  lastCopiedKey: string | null;
  error: string;
  onRefreshPublicTrades: () => void;
  onOpenTradeById: (tradeId: number) => void;
  onBackToDirectory: () => void;
  onCopyWithFeedback: (value: string, feedbackKey: string) => void;
  buildTradeShareUrl: (tradeId: number, accessSecret?: string) => string;
  activeTradeAccessSecret: string;
  onAcceptTrade: (snapshot: TradeSnapshot) => void;
  onDeclineTrade: (snapshot: TradeSnapshot) => void;
  onCancelTrade: (snapshot: TradeSnapshot) => void;
};

const buildOfferFromSnapshot = (snapshot: TradeSnapshot): TradeOfferMessagePayload => ({
  version: 2,
  tradeId: snapshot.tradeId,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker: snapshot.maker,
  taker: snapshot.taker,
  createdAt: snapshot.createdAt,
  expiresAt: snapshot.expiresAt
});

const toTradeId = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export default function StandaloneTradesPage({
  isConnected,
  onCotiNetwork,
  walletAddress,
  visibility,
  onVisibilityChange,
  tradeComposerContent,
  createdTradeId,
  createdTradeLink,
  publicTrades,
  loadingPublicTrades,
  publicTradesError,
  selectedTradeId,
  selectedTrade,
  loadingSelectedTrade,
  selectedTradeError,
  selectedTradeAccessBlocked,
  processingTradeActionId,
  lastCopiedKey,
  error,
  onRefreshPublicTrades,
  onOpenTradeById,
  onBackToDirectory,
  onCopyWithFeedback,
  buildTradeShareUrl,
  activeTradeAccessSecret,
  onAcceptTrade,
  onDeclineTrade,
  onCancelTrade
}: StandaloneTradesPageProps) {
  const [lookupTradeIdInput, setLookupTradeIdInput] = useState('');
  const visiblePublicTrades = useMemo(
    () =>
      [...publicTrades].sort((left, right) => {
        if (left.status === 'open' && right.status !== 'open') {
          return -1;
        }
        if (left.status !== 'open' && right.status === 'open') {
          return 1;
        }
        return right.tradeId - left.tradeId;
      }),
    [publicTrades]
  );
  const openTradeCount = publicTrades.filter((trade) => trade.status === 'open').length;
  const lookupTradeId = toTradeId(lookupTradeIdInput);
  const walletKey = walletAddress.trim().toLowerCase();
  const selectedTradeParticipant =
    selectedTrade && walletKey
      ? selectedTrade.maker.toLowerCase() === walletKey || selectedTrade.taker.toLowerCase() === walletKey
      : false;
  const selectedTradeRequiresFullLink = Boolean(
    selectedTrade && selectedTrade.isPublic === false && !activeTradeAccessSecret && !selectedTradeParticipant
  );
  const selectedTradeHidden = selectedTradeAccessBlocked || selectedTradeRequiresFullLink;

  const submitLookup = (event: FormEvent) => {
    event.preventDefault();
    if (lookupTradeId !== null) {
      onOpenTradeById(lookupTradeId);
    }
  };

  const renderTradeCard = (snapshot: TradeSnapshot, options?: { collapsed?: boolean }) => {
    const shareUrl = buildTradeShareUrl(
      snapshot.tradeId,
      selectedTradeId === snapshot.tradeId && activeTradeAccessSecret ? activeTradeAccessSecret : undefined
    );
    const shareFeedbackKey = `trade-share:${snapshot.tradeId}`;

    return (
      <TradeOfferCard
        key={snapshot.tradeId}
        offer={buildOfferFromSnapshot(snapshot)}
        snapshot={snapshot}
        currentWalletAddress={walletAddress}
        actionPending={processingTradeActionId === String(snapshot.tradeId)}
        collapsed={options?.collapsed}
        shareUrl={shareUrl}
        shareCopied={lastCopiedKey === shareFeedbackKey}
        onCopyShareLink={() => onCopyWithFeedback(shareUrl, shareFeedbackKey)}
        showCounterAction={false}
        onAccept={() => onAcceptTrade(snapshot)}
        onDecline={() => onDeclineTrade(snapshot)}
        onCounter={() => {}}
        onCancel={() => onCancelTrade(snapshot)}
      />
    );
  };

  return (
    <main className="standalone-trades-shell">
      <section className="standalone-trades-hero">
        <div className="standalone-trades-title-group">
          <p className="landing-eyebrow">P2P Trades</p>
          <h1 className="standalone-trades-title">Create and settle escrow trades on chain.</h1>
        </div>
        <div className="standalone-trades-status-grid">
          <div className="standalone-trades-stat">
            <span>Wallet</span>
            <strong>{isConnected && walletAddress ? shortenAddress(walletAddress) : 'Disconnected'}</strong>
          </div>
          <div className="standalone-trades-stat">
            <span>Network</span>
            <strong>{onCotiNetwork ? 'COTI' : 'Switch needed'}</strong>
          </div>
          <div className="standalone-trades-stat">
            <span>Open</span>
            <strong>{loadingPublicTrades ? '--' : openTradeCount}</strong>
          </div>
        </div>
      </section>

      <section className="standalone-trade-create-panel">
        <div className="standalone-trades-section-head">
          <div>
            <p className="landing-eyebrow">Create</p>
            <h2>New trade</h2>
          </div>
          <div className="standalone-trade-visibility" role="group" aria-label="Trade visibility">
            <button
              type="button"
              className={visibility === 'public' ? 'active' : undefined}
              onClick={() => onVisibilityChange('public')}
              aria-pressed={visibility === 'public'}
            >
              Public
            </button>
            <button
              type="button"
              className={visibility === 'private' ? 'active' : undefined}
              onClick={() => onVisibilityChange('private')}
              aria-pressed={visibility === 'private'}
            >
              Unlisted Link
            </button>
          </div>
        </div>

        <div className="standalone-trade-access-summary">
          <span>Access</span>
          <strong>
            {visibility === 'public'
              ? 'Listed publicly while open'
              : 'Full secret link required to accept'}
          </strong>
          <p>Unlisted trades stay out of the public directory, but trade terms are still readable on chain.</p>
        </div>

        {tradeComposerContent}

        {createdTradeLink ? (
          <div className="standalone-trade-created">
            <div>
              <span>Trade #{createdTradeId}</span>
              <strong>{visibility === 'private' ? 'Unlisted link ready' : 'Share link ready'}</strong>
            </div>
            <button
              type="button"
              className={lastCopiedKey === 'standalone-trade-created-link' ? 'copied' : undefined}
              onClick={() => onCopyWithFeedback(createdTradeLink, 'standalone-trade-created-link')}
            >
              {lastCopiedKey === 'standalone-trade-created-link' ? 'Copied' : 'Copy Link'}
            </button>
          </div>
        ) : null}

        {error ? <p className="standalone-trade-error">{error}</p> : null}
      </section>

      {selectedTradeId !== null ? (
        <section className="standalone-trades-section standalone-trade-detail-section">
          <div className="standalone-trades-section-head">
            <div>
              <p className="landing-eyebrow">Shared Link</p>
              <h2>Trade #{selectedTradeId}</h2>
            </div>
            <button type="button" className="standalone-trade-secondary-btn" onClick={onBackToDirectory}>
              Open Directory
            </button>
          </div>
          {loadingSelectedTrade ? <p className="standalone-trade-state">Loading trade from escrow...</p> : null}
          {!loadingSelectedTrade && selectedTrade && !selectedTradeHidden ? renderTradeCard(selectedTrade) : null}
          {!loadingSelectedTrade && selectedTradeHidden ? (
            <p className="standalone-trade-state">
              This unlisted trade needs the full shared link. A plain trade id is not enough to accept it.
            </p>
          ) : null}
          {!loadingSelectedTrade && selectedTradeError ? (
            <p className="standalone-trade-error">{selectedTradeError}</p>
          ) : null}
        </section>
      ) : null}

      <section className="standalone-trades-section">
        <div className="standalone-trades-section-head">
          <div>
            <p className="landing-eyebrow">Directory</p>
            <h2>Open public trades</h2>
          </div>
          <div className="standalone-trades-toolbar">
            <form className="standalone-trade-lookup" onSubmit={submitLookup}>
              <input
                type="text"
                inputMode="numeric"
                value={lookupTradeIdInput}
                onChange={(event) => setLookupTradeIdInput(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="Trade ID"
              />
              <button type="submit" disabled={lookupTradeId === null}>
                Open
              </button>
            </form>
            <button type="button" className="standalone-trade-secondary-btn" onClick={onRefreshPublicTrades}>
              {loadingPublicTrades ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {publicTradesError ? <p className="standalone-trade-error">{publicTradesError}</p> : null}
        {loadingPublicTrades && visiblePublicTrades.length === 0 ? (
          <p className="standalone-trade-state">Loading public trades from escrow...</p>
        ) : null}
        {!loadingPublicTrades && visiblePublicTrades.length === 0 ? (
          <p className="standalone-trade-state">No open public trades found.</p>
        ) : null}
        {visiblePublicTrades.length > 0 ? (
          <div className="standalone-trade-list">
            {visiblePublicTrades.map((trade) => (
              <article key={trade.tradeId} className="standalone-trade-list-item">
                <button
                  type="button"
                  className="standalone-trade-list-open"
                  onClick={() => onOpenTradeById(trade.tradeId)}
                >
                  <span>#{trade.tradeId}</span>
                  <strong>{trade.status}</strong>
                  <small>{formatMessageTimestamp(trade.createdAt)}</small>
                </button>
                {renderTradeCard(trade, { collapsed: true })}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <a
        className="standalone-trade-contract-link"
        href={`${COTI_NETWORK.blockExplorerUrl}/address/${TRADE_ESCROW_CONTRACT_ADDRESS}`}
        target="_blank"
        rel="noreferrer"
      >
        Escrow contract
      </a>
    </main>
  );
}
