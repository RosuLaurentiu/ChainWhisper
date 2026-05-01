import { useState } from 'react';

type BurnerBackupModalProps = {
  isOpen: boolean;
  mnemonic: string;
  onClose: () => void;
};

export default function BurnerBackupModal({ isOpen, mnemonic, onClose }: BurnerBackupModalProps) {
  const [copied, setCopied] = useState(false);

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
      <div className="modal-card burner-backup-modal" onClick={(event) => event.stopPropagation()}>
        <h3>Wallet Backup</h3>
        <p className="wallet-reminder">Save this seed phrase offline. Anyone with it can recover this app wallet.</p>
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
