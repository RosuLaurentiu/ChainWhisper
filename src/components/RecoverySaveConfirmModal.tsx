import { useRef } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';
import type { AppWalletRecoveryPromptEstimate } from '../lib/appWalletRecovery';

type RecoverySaveConfirmModalProps = {
  estimate: AppWalletRecoveryPromptEstimate;
  isOpen: boolean;
  makeDefault: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  onMakeDefaultChange: (makeDefault: boolean) => void;
};

export default function RecoverySaveConfirmModal({
  estimate,
  isOpen,
  makeDefault,
  message,
  onCancel,
  onConfirm,
  onMakeDefaultChange
}: RecoverySaveConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y({ dialogRef, isOpen, onClose: onCancel });

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-save-confirm-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="recovery-save-confirm-title">Save recovery for this ChainWhisper account</h3>
        <p className="modal-copy">{message}</p>
        <div className="topup-stats-grid">
          <div className="topup-stat">
            <span>Encryption prompts</span>
            <strong>{estimate.estimatedEncryptionPrompts}</strong>
          </div>
          <div className="topup-stat">
            <span>Transaction approvals</span>
            <strong>{estimate.estimatedTransactionApprovals}</strong>
          </div>
        </div>
        <p className="modal-copy">
          The recovery stores only the active ChainWhisper account for this owner wallet. You can save more accounts
          later and switch between them from the wallet menu.
        </p>
        <label className="modal-checkbox-row">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(event) => onMakeDefaultChange(event.currentTarget.checked)}
          />
          <span>Use this as the default ChainWhisper account</span>
        </label>
        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onCancel}>
            Later
          </button>
          <button type="button" className="connect-btn wallet-primary-action" onClick={onConfirm}>
            Save recovery
          </button>
        </div>
      </div>
    </div>
  );
}
