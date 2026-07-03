import { useRef } from 'react';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';

type BurnerImportModalProps = {
  isOpen: boolean;
  initializingBurner: boolean;
  burnerImportInput: string;
  onBurnerImportInputChange: (value: string) => void;
  error: string;
  onClose: () => void;
  onImport: () => Promise<void>;
};

export default function BurnerImportModal({
  isOpen,
  initializingBurner,
  burnerImportInput,
  onBurnerImportInputChange,
  error,
  onClose,
  onImport
}: BurnerImportModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeDisabled = initializingBurner;
  useModalA11y({ closeDisabled, dialogRef, isOpen, onClose });

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!initializingBurner) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="burner-import-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="burner-import-title">Import ChainWhisper Account</h3>
        <p className="modal-copy">
          Paste the mnemonic or private key for the account used in chat and trades. If an owner wallet is connected,
          this account is saved with owner-wallet recovery.
        </p>
        <input
          value={burnerImportInput}
          onChange={(event) => onBurnerImportInputChange(event.target.value)}
          placeholder="Account mnemonic phrase or 0x private key"
          aria-label="Import ChainWhisper account"
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose} disabled={initializingBurner}>
            Cancel
          </button>
          <button type="button" className="connect-btn" onClick={onImport} disabled={initializingBurner}>
            {initializingBurner ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
