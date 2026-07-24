import { useRef } from 'react';
import type { BurnerPinMode } from '../../../lib/appShared';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y({ closeDisabled: initializingBurner, dialogRef, isOpen, onClose });

  if (!isOpen) {
    return null;
  }

  const title = burnerPinMode === 'set' ? 'Set ChainWhisper Account PIN' : 'Unlock ChainWhisper Account';
  const placeholder =
    burnerPinMode === 'set'
      ? `Choose PIN (${pinMinLength}+ digits)`
      : 'Enter PIN';
  const submitLabel =
    initializingBurner
      ? 'Please wait...'
      : burnerPinMode === 'set'
        ? 'Save & Connect'
        : 'Unlock';

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
        aria-labelledby="burner-pin-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="burner-pin-title">{title}</h3>
        {error ? <p className="error" role="alert">{error}</p> : null}
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
          placeholder={placeholder}
          aria-label="ChainWhisper account PIN"
          type="password"
        />
        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose} disabled={initializingBurner}>
            Cancel
          </button>
          <button
            type="button"
            className="connect-btn wallet-primary-action"
            onClick={() => {
              onSubmit().catch(() => {});
            }}
            disabled={initializingBurner}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
