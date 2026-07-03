import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  formatMessageTimestamp,
  formatTradeAssetDisplayText,
  type TradeAssetPayload
} from '../../../lib/appShared';
import { formatOtcSwapFillHistoryNote } from '../../../lib/otcSwapUi';
import { findOtcSwapFillNote, type OtcSwapFillNote } from '../../../lib/otcSwapIntent';
import { buildTransactionExplorerUrl } from '../../../lib/p2pTradeView';
import type { TradeLifecycleHistoryRow, TradeTransactionHistoryRow } from '../../../lib/tradeHistory';
import {
  formatCompactTradeTimestamp,
  type TerminalHistoryPanelConfig
} from './P2PTradingPage.helpers';

type TransactionLinkFeedbackOptions = {
  className?: string;
  defaultLabel?: string;
  openedLabel?: string;
  title?: string;
  openedTitle?: string;
};

type TransactionLinkFeedbackProps = {
  className: string;
  label: string;
  onClick: () => void;
  title: string;
};

export type GetTransactionLinkFeedbackProps = (
  key: string,
  options?: TransactionLinkFeedbackOptions
) => TransactionLinkFeedbackProps;

type TradeTerminalHistoryRowsProps = {
  lifecycleRows: TradeLifecycleHistoryRow[];
  transactionRows: TradeTransactionHistoryRow[];
  tradeKey?: string;
  historyLifecycleTxHashes: Record<string, string>;
  historyTransactionTxHashes: Record<string, string>;
  historyTransactionTimestamps: Record<string, number>;
  swapFillNotes: OtcSwapFillNote[];
  getTransactionLinkFeedbackProps: GetTransactionLinkFeedbackProps;
};

type TradeTerminalHistoryContentProps = {
  config: TerminalHistoryPanelConfig;
  renderActionNotice: (surface: 'history', tradeKey?: string) => ReactNode;
};

type TradeTerminalHistoryMobileControlsProps = TradeTerminalHistoryContentProps & {
  sheetKey: string;
  setSheetKey: (key: string) => void;
};

const formatHistoryDate = formatCompactTradeTimestamp;

export function TradeTerminalHistoryRows({
  lifecycleRows,
  transactionRows,
  tradeKey = '',
  historyLifecycleTxHashes,
  historyTransactionTxHashes,
  historyTransactionTimestamps,
  swapFillNotes,
  getTransactionLinkFeedbackProps
}: TradeTerminalHistoryRowsProps) {
  if (!lifecycleRows.length && !transactionRows.length) {
    return null;
  }

  const formatHistoryAmount = (asset: TradeAssetPayload & { visible: boolean }) =>
    asset.visible ? formatTradeAssetDisplayText(asset) : `Private ${asset.symbol}`;
  const formatHistoryFlowAmount = (
    asset: TradeAssetPayload & { visible: boolean },
    action: TradeTransactionHistoryRow['tokenFlows'][number]['action']
  ) => {
    const amountText = formatHistoryAmount(asset);
    return asset.visible ? `${action === 'bought' ? '+' : '-'}${amountText}` : amountText;
  };

  return (
    <>
      {lifecycleRows.map((row) => {
        const txHash = row.txHash ?? historyLifecycleTxHashes[row.key];
        const txUrl = buildTransactionExplorerUrl(txHash);
        const txLinkFeedback = txUrl && txHash
          ? getTransactionLinkFeedbackProps(`history-lifecycle:${row.key}:${txHash}`, {
              title: 'Open lifecycle transaction on explorer'
            })
          : null;
        const timestamp = row.timestamp ?? historyTransactionTimestamps[row.key];
        const dateLabel = formatHistoryDate(timestamp);
        const dateTitle = timestamp ? formatMessageTimestamp(timestamp) : undefined;
        const sourceLabel = row.sourceKind === 'recurring' ? 'Order' : 'Offer';
        const actionLabel =
          row.action === 'created'
            ? 'Opened'
            : row.action === 'cancelled'
              ? 'Closed'
              : row.action === 'replaced'
                ? 'Replaced'
                : 'Edited';
        return (
          <div
            className={`p2p-terminal-history-row p2p-terminal-history-row-lifecycle p2p-terminal-history-row-${row.action}`}
            key={row.key}
          >
            <div className="p2p-terminal-history-event">
              <span>{row.label}</span>
              <strong>{row.detail}</strong>
              {dateLabel ? <small title={dateTitle}>{dateLabel}</small> : null}
            </div>
            <div className="p2p-terminal-history-amounts p2p-terminal-history-lifecycle-summary">
              <div className="p2p-terminal-history-chip p2p-terminal-history-chip-lifecycle">
                <strong>{sourceLabel}</strong>
                <span>{actionLabel}</span>
              </div>
            </div>
            {txUrl && txLinkFeedback ? (
              <div className="p2p-terminal-history-proof">
                <a
                  className={txLinkFeedback.className}
                  href={txUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={txLinkFeedback.onClick}
                  title={txLinkFeedback.title}
                >
                  {txLinkFeedback.label}
                </a>
              </div>
            ) : null}
          </div>
        );
      })}
      {transactionRows.map((row) => {
        const txHash = row.txHash ?? historyTransactionTxHashes[row.key];
        const swapFillNote = tradeKey ? findOtcSwapFillNote(swapFillNotes, tradeKey, txHash) : null;
        const swapFillNoteLabel = formatOtcSwapFillHistoryNote(swapFillNote, row);
        const txUrl = buildTransactionExplorerUrl(txHash);
        const txLinkFeedback = txUrl && txHash
          ? getTransactionLinkFeedbackProps(`history-fill:${row.key}:${txHash}`, {
              title: 'Open fill transaction on explorer'
            })
          : null;
        const timestamp = row.timestamp ?? historyTransactionTimestamps[row.key];
        const dateLabel = formatHistoryDate(timestamp);
        const dateTitle = timestamp ? formatMessageTimestamp(timestamp) : undefined;
        const sequenceLabel = row.sequence ? `Fill #${row.sequence}` : '';
        const sourceLabel =
          row.sourceKind === 'recurring'
            ? 'Recurring fill'
            : row.sourceKind === 'private'
              ? 'Private fill'
              : row.sourceKind === 'direct'
                ? 'Direct fill'
                : 'Escrow fill';
        return (
          <div className="p2p-terminal-history-row" key={row.key}>
            <div className="p2p-terminal-history-event">
              <span>{sourceLabel}</span>
              {sequenceLabel ? <strong>{sequenceLabel}</strong> : null}
              {dateLabel ? <small title={dateTitle}>{dateLabel}</small> : null}
              {swapFillNoteLabel ? <small className="p2p-terminal-history-note">{swapFillNoteLabel}</small> : null}
            </div>
            <div className="p2p-terminal-history-amounts">
              {row.tokenFlows.map((flow) => (
                <div
                  className={`p2p-terminal-history-chip p2p-terminal-history-chip-${flow.action}`}
                  key={`${flow.action}:${flow.asset.kind}:${flow.asset.tokenAddress}:${flow.asset.symbol}`}
                >
                  <strong>{formatHistoryFlowAmount(flow.asset, flow.action)}</strong>
                  <span>{flow.action === 'bought' ? 'Bought' : 'Sold'}</span>
                </div>
              ))}
            </div>
            <div className="p2p-terminal-history-proof">
              {txUrl && txLinkFeedback ? (
                <a
                  className={txLinkFeedback.className}
                  href={txUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={txLinkFeedback.onClick}
                  title={txLinkFeedback.title}
                >
                  {txLinkFeedback.label}
                </a>
              ) : (
                <strong>{row.amountVisibility === 'private-hidden' ? 'Private' : 'Indexed'}</strong>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function TradeTerminalHistoryContent({
  config,
  renderActionNotice
}: TradeTerminalHistoryContentProps) {
  const revealButton = config.revealAction ? (
    <button
      type="button"
      className="p2p-terminal-history-reveal-btn"
      onClick={config.revealAction}
      disabled={config.revealPending}
    >
      {config.revealPending ? 'Revealing...' : config.revealLabel ?? 'Reveal history'}
    </button>
  ) : null;

  return (
    <>
      <div className="p2p-terminal-history-head">
        <div>
          <span>Your history</span>
          <strong>{config.title}</strong>
        </div>
        {revealButton}
        <span>{config.count}</span>
      </div>
      {renderActionNotice('history', config.tradeKey)}
      {config.children ? (
        config.children
      ) : (
        <div className="p2p-terminal-history-empty">
          <p>{config.emptyCopy}</p>
        </div>
      )}
    </>
  );
}

export function TradeTerminalHistoryMobileControls({
  config,
  sheetKey,
  setSheetKey,
  renderActionNotice
}: TradeTerminalHistoryMobileControlsProps) {
  const historyBody = <TradeTerminalHistoryContent config={config} renderActionNotice={renderActionNotice} />;
  const historySheet = sheetKey === config.tradeKey ? (
    <div className="p2p-terminal-history-sheet" role="dialog" aria-modal="true" aria-label={`${config.title} history`}>
      <div className="p2p-terminal-history-sheet-head">
        <div>
          <span>Your history</span>
          <strong>{config.title}</strong>
        </div>
        <button type="button" onClick={() => setSheetKey('')}>
          Close
        </button>
      </div>
      <div className="p2p-terminal-history-sheet-body">{historyBody}</div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="p2p-terminal-mobile-history-trigger"
        onClick={() => setSheetKey(config.tradeKey)}
      >
        <span>History</span>
        <strong>{config.count}</strong>
      </button>
      {historySheet && typeof document !== 'undefined' ? createPortal(historySheet, document.body) : historySheet}
    </>
  );
}

export function TradeTerminalHistoryWindow({
  config,
  renderActionNotice
}: TradeTerminalHistoryContentProps) {
  return (
    <section
      className="standalone-trades-section p2p-terminal-history p2p-terminal-history-desktop p2p-terminal-history-window"
      aria-live="polite"
    >
      <TradeTerminalHistoryContent config={config} renderActionNotice={renderActionNotice} />
    </section>
  );
}
