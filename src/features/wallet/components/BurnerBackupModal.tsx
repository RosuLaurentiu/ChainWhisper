import { useRef, useState } from 'react';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';

type BurnerBackupModalProps = {
  isOpen: boolean;
  mnemonic: string;
  onClose: () => void;
};

export default function BurnerBackupModal({ isOpen, mnemonic, onClose }: BurnerBackupModalProps) {
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y({ dialogRef, isOpen, onClose });

  if (!isOpen) {
    return null;
  }

  const copyMnemonic = async () => {
    if (!navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card burner-backup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="burner-backup-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="burner-backup-title">ChainWhisper Account Backup</h3>
        <p className="wallet-reminder">
          Save this recovery phrase offline. Anyone with it can recover this ChainWhisper account.
        </p>
        <p className="wallet-secret-phrase">{mnemonic}</p>
        <div className="modal-actions">
          <button type="button" className="connect-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="connect-btn wallet-primary-action"
            onClick={() => {
              copyMnemonic().catch(() => {});
            }}
          >
            {copied ? 'Copied' : 'Copy phrase'}
          </button>
        </div>
      </div>
    </div>
  );
}
