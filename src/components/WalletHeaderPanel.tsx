import type { ReactNode } from 'react';

type WalletHeaderPanelProps = {
  action?: ReactNode;
  menu: ReactNode;
  menuDisabled?: boolean;
  menuLabel?: string;
  menuOpen: boolean;
  modeLabel: string;
  onPrimaryAction: () => void;
  onToggleMenu: () => void;
  primaryButtonClassName: string;
  primaryButtonLabel: string;
  primaryButtonTitle?: string;
  primaryDisabled?: boolean;
  primaryMetaLabel?: string;
  statusLabel: string;
};

export default function WalletHeaderPanel({
  action,
  menu,
  menuDisabled = false,
  menuLabel = 'Wallet',
  menuOpen,
  modeLabel,
  onPrimaryAction,
  onToggleMenu,
  primaryButtonClassName,
  primaryButtonLabel,
  primaryButtonTitle,
  primaryDisabled = false,
  primaryMetaLabel,
  statusLabel
}: WalletHeaderPanelProps) {
  return (
    <div className="p2p-wallet-panel wallet-header-panel">
      <div className="p2p-wallet-status">
        <button
          type="button"
          className={primaryButtonClassName}
          onClick={onPrimaryAction}
          disabled={primaryDisabled}
          title={primaryButtonTitle}
        >
          <span>{primaryButtonLabel}</span>
          {primaryMetaLabel ? <small>{primaryMetaLabel}</small> : null}
        </button>
        <div className="p2p-wallet-status-text">
          <span>{modeLabel}</span>
          <strong>{statusLabel}</strong>
        </div>
        <div className="p2p-wallet-status-actions">{action}</div>
      </div>

      <div className="p2p-wallet-menu-wrap">
        <button
          type="button"
          className={menuOpen ? 'p2p-wallet-menu-trigger active' : 'p2p-wallet-menu-trigger'}
          onClick={onToggleMenu}
          disabled={menuDisabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {menuLabel}
        </button>
        {menuOpen ? <div className="p2p-wallet-menu" role="menu">{menu}</div> : null}
      </div>
    </div>
  );
}
