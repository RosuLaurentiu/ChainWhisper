import { useRef, type ReactNode } from 'react';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';

type TradeActionConfirmModalProps = {
  confirmation: TradeActionConfirmModel | null;
  details?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function TradeActionConfirmModal({
  confirmation,
  details,
  onCancel,
  onConfirm
}: TradeActionConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const isOpen = Boolean(confirmation);
  useModalA11y({ dialogRef, isOpen, onClose: onCancel });

  if (!confirmation) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal-card trade-action-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-action-confirm-title"
        aria-describedby={confirmation.message ? 'trade-action-confirm-message' : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="trade-action-confirm-content">
          <header className="trade-action-confirm-heading">
            <h3 id="trade-action-confirm-title">{confirmation.title}</h3>
            {confirmation.message ? <p id="trade-action-confirm-message" className="modal-copy">{confirmation.message}</p> : null}
          </header>

        {confirmation.summaryRows.length > 0 ? (
          <dl className="trade-action-confirm-summary" aria-label="Trade summary">
            {confirmation.summaryRows.map((row) => (
              <div key={`${row.label}:${row.value}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {confirmation.fundingMoves.length > 0 ? (
          <div className="trade-action-confirm-funding" aria-label="Required funding moves">
            <span>Required before signing</span>
            {confirmation.fundingMoves.map((move) => (
              <div key={`${move.amountLabel}:${move.reason ?? ''}`} className="trade-action-confirm-funding-row">
                <strong>{move.amountLabel}</strong>
                <small>
                  {move.fromLabel ?? 'Owner wallet'} -&gt; {move.toLabel ?? 'ChainWhisper'}
                  {move.reason ? ` - ${move.reason}` : ''}
                </small>
              </div>
            ))}
          </div>
        ) : null}

        {confirmation.stats.length > 0 ? <div className="trade-action-confirm-stats-grid trade-action-confirm-stats" aria-label="Action details">
          {confirmation.stats.map((stat) => (
            <div key={`${stat.label}:${stat.value}`} className="trade-action-confirm-stat">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div> : null}
        {details}
        </div>

        <div className="modal-actions">
          {confirmation.secondaryLabel !== null ? (
            <button type="button" className="connect-btn" onClick={onCancel}>
              {confirmation.secondaryLabel ?? 'Cancel'}
            </button>
          ) : null}
          <button type="button" className="connect-btn wallet-primary-action" onClick={onConfirm}>
            {confirmation.primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
