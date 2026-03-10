import type { BurnerPinMode } from '../lib/appShared';

type BurnerPinModalProps = {
  isOpen: boolean;
  burnerPinMode: BurnerPinMode;
  burnerPinInput: string;
  onBurnerPinInputChange: (value: string) => void;
  pinMinLength: number;
  error: string;
  initializingBurner: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
};

export default function BurnerPinModal({
  isOpen,
  burnerPinMode,
  burnerPinInput,
  onBurnerPinInputChange,
  pinMinLength,
  error,
  initializingBurner,
  onClose,
  onSubmit
}: BurnerPinModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <h3>{burnerPinMode === 'set' ? 'Set PIN' : 'Unlock Wallet'}</h3>
        {error ? <p className="error">{error}</p> : null}
        <input
          value={burnerPinInput}
          name={burnerPinMode === 'set' ? 'pin-new' : 'pin-unlock'}
          autoComplete="off"
          inputMode="numeric"
          pattern="[0-9]*"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          onChange={(event) => onBurnerPinInputChange(event.target.value)}
          placeholder={burnerPinMode === 'set' ? `Choose PIN (${pinMinLength}+ digits)` : 'Enter PIN'}
          aria-label="Wallet PIN"
          type="password"
        />
        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose} disabled={initializingBurner}>
            Cancel
          </button>
          <button
            type="button"
            className="connect-btn"
            onClick={() => {
              onSubmit().catch(() => {});
            }}
            disabled={initializingBurner}
          >
            {initializingBurner ? 'Please wait...' : burnerPinMode === 'set' ? 'Save & Connect' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}
