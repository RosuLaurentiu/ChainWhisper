import { useRef } from 'react';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import type { TradeActionConfirmModel } from '../../../lib/tradeActionConfirm';

type TradeActionConfirmModalProps = {
  confirmation: TradeActionConfirmModel | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function TradeActionConfirmModal({
  confirmation,
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
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="trade-action-confirm-title">{confirmation.title}</h3>
        <p className="modal-copy">{confirmation.message}</p>

        {confirmation.summaryRows.length > 0 ? (
          <div className="trade-action-confirm-summary" aria-label="Trade summary">
            {confirmation.summaryRows.map((row) => (
              <div key={`${row.label}:${row.value}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
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

        <div className="topup-stats-grid trade-action-confirm-stats">
          {confirmation.stats.map((stat) => (
            <div key={`${stat.label}:${stat.value}`} className="topup-stat">
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="connect-btn wallet-primary-action" onClick={onConfirm}>
            {confirmation.primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
