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
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3>Import Burner Wallet</h3>
        <input
          value={burnerImportInput}
          onChange={(event) => onBurnerImportInputChange(event.target.value)}
          placeholder="Mnemonic phrase or 0x private key"
          aria-label="Import burner wallet"
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
