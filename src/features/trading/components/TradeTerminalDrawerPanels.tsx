import type { FormEvent, RefObject } from 'react';
import {
  formatTradeContractIdLabel
} from '../../../lib/p2pTradeView';
import {
  OPEN_TERMINAL_LABEL,
  SHARE_LABEL,
  renderP2PEmptyState
} from './P2PTradingPage.helpers';
import { AppTab, AppTabList } from '../../../shared/ui/AppTabs';

type TradeTerminalOpenPanelProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  tradeLinkInput: string;
  onTradeLinkInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenDesk: () => void;
  onCreateOffer: () => void;
  persistentOffers?: boolean;
  tradeDirection?: 'buy' | 'sell';
  tradeDirectionEnabled?: Record<'buy' | 'sell', boolean>;
  onTradeDirectionChange?: (direction: 'buy' | 'sell') => void;
};

type TradeTerminalCreatedNoticeProps = {
  createdTradeId: number;
  escrowContract: string;
  resolvedRouteAccessSecret: string;
  lastCopiedKey: string;
  createdTradeCopyKey: string;
  onCopyCreatedTradeLink: () => void;
};

type TradeCreatedLinkPanelProps = {
  createdTradeId: number | null;
  createdTradeLink: string;
  lastCopiedKey: string;
  createdTradeCopyKey: string;
  onCopyCreatedTradeLink: () => void;
};

type TradeTerminalRouteStatusProps = {
  routeView: string;
  routeError: string;
  detailTradeError: string;
  canRetryRouteTrade: boolean;
  loadingDetailTrade: boolean;
  terminalRouteDetailPending: boolean;
  onRefreshTradeDetail: () => void;
  onFocusTradeLinkInput: () => void;
  onOpenDesk: () => void;
};

export function TradeTerminalOpenPanel({
  inputRef,
  tradeLinkInput,
  onTradeLinkInputChange,
  onSubmit,
  onOpenDesk,
  onCreateOffer,
  persistentOffers = false,
  tradeDirection,
  tradeDirectionEnabled,
  onTradeDirectionChange
}: TradeTerminalOpenPanelProps) {
  return (
    <div className="p2p-terminal-open-panel">
      <div className="p2p-terminal-open-copy">
        <strong>{persistentOffers ? 'Select an offer' : 'Paste a shared offer link'}</strong>
        <p>{persistentOffers
            ? 'Choose from the list to review its terms.'
            : 'Use an offer link, code or ID.'}</p>
      </div>
      {persistentOffers && tradeDirection && tradeDirectionEnabled ? (
        <AppTabList
          className="p2p-swap-side-switch p2p-terminal-direction-switch"
          label="Trade direction"
          value={tradeDirection}
          onChange={(direction) => onTradeDirectionChange?.(direction)}
        >
          {(['buy', 'sell'] as const).map((direction) => (
            <AppTab
              key={direction}
              value={direction}
              data-trade-direction={direction}
              disabled={!tradeDirectionEnabled[direction]}
            >
              {direction === 'buy' ? 'Buy' : 'Sell'}
            </AppTab>
          ))}
        </AppTabList>
      ) : null}
      <form className="p2p-link-open-form p2p-action-open-form p2p-drawer-open-form" onSubmit={onSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={tradeLinkInput}
          onChange={(event) => onTradeLinkInputChange(event.target.value)}
          placeholder="Offer link, code or ID"
          aria-label="Trade link, compact code, or trade id"
        />
        <button type="submit">{OPEN_TERMINAL_LABEL}</button>
      </form>
      {!persistentOffers ? (
        <div className="p2p-terminal-open-actions" aria-label="Order alternatives">
          <button type="button" onClick={onOpenDesk}>Open desk</button>
          <button type="button" onClick={onCreateOffer}>Create offer</button>
        </div>
      ) : null}
    </div>
  );
}

export function TradeTerminalSafetyWarning() {
  return (
    <div className="trade-compose-warning p2p-trade-window-warning" role="note">
      <p>Review the amount and price before confirming in your wallet.</p>
    </div>
  );
}

export function TradeCreatedLinkPanel({
  createdTradeId,
  createdTradeLink,
  lastCopiedKey,
  createdTradeCopyKey,
  onCopyCreatedTradeLink
}: TradeCreatedLinkPanelProps) {
  if (!createdTradeLink) {
    return null;
  }

  return (
    <div className="standalone-trade-created">
      <div>
        <span>Trade {createdTradeId ? 'created' : 'ready'}</span>
        <strong>{createdTradeLink.replace(/^https?:\/\//, '')}</strong>
      </div>
      <button
        type="button"
        className={lastCopiedKey === createdTradeCopyKey ? 'copied' : undefined}
        onClick={onCopyCreatedTradeLink}
      >
        {lastCopiedKey === createdTradeCopyKey ? 'Shared' : SHARE_LABEL}
      </button>
    </div>
  );
}

export function TradeTerminalCreatedNotice({
  createdTradeId,
  escrowContract,
  resolvedRouteAccessSecret,
  lastCopiedKey,
  createdTradeCopyKey,
  onCopyCreatedTradeLink
}: TradeTerminalCreatedNoticeProps) {
  return (
    <div className="standalone-trade-created">
      <div>
        <span>{formatTradeContractIdLabel({ tradeId: createdTradeId, escrowContract })}</span>
        <strong>{resolvedRouteAccessSecret ? 'Unlisted link ready' : 'Share ready'}</strong>
      </div>
      <button
        type="button"
        className={lastCopiedKey === createdTradeCopyKey ? 'copied' : undefined}
        onClick={onCopyCreatedTradeLink}
      >
        {lastCopiedKey === createdTradeCopyKey ? 'Shared' : SHARE_LABEL}
      </button>
    </div>
  );
}

export function TradeTerminalRouteStatus({
  routeView,
  routeError,
  detailTradeError,
  canRetryRouteTrade,
  loadingDetailTrade,
  terminalRouteDetailPending,
  onRefreshTradeDetail,
  onFocusTradeLinkInput,
  onOpenDesk
}: TradeTerminalRouteStatusProps) {
  return (
    <>
      {routeView === 'trade' && (routeError || detailTradeError)
        ? renderP2PEmptyState(
            'Trade could not load',
            routeError || detailTradeError,
            <>
              {canRetryRouteTrade ? (
                <button type="button" onClick={onRefreshTradeDetail} disabled={loadingDetailTrade}>
                  {loadingDetailTrade ? 'Loading...' : 'Retry'}
                </button>
              ) : (
                <button type="button" onClick={onFocusTradeLinkInput}>
                  Paste Link
                </button>
              )}
              <button type="button" onClick={onOpenDesk}>
                Open Desk
              </button>
            </>,
            'error'
          )
        : null}
      {terminalRouteDetailPending
        ? renderP2PEmptyState(
            'Loading trade',
            'Reading escrow terms and access rules.',
            undefined,
            'loading'
          )
        : null}
    </>
  );
}
