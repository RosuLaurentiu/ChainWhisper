import { useId, type ReactNode } from 'react';

type WalletHeaderPanelProps = {
  action?: ReactNode;
  menu: ReactNode;
  menuDisabled?: boolean;
  menuLabel?: string;
  menuOpen: boolean;
  modeLabel: string;
  onPrimaryAction: () => void;
  onToggleMenu: () => void;
  primaryAddon?: ReactNode;
  primaryButtonClassName: string;
  primaryButtonLabel: string;
  primaryButtonTitle?: string;
  primaryDisabled?: boolean;
  primaryMetaLabel?: string;
  statusLabel: string;
};

const resolveStatusTone = (statusLabel: string): 'ready' | 'warning' | 'locked' | 'muted' => {
  const normalized = statusLabel.toLowerCase();
  if (normalized.includes('ready')) {
    return 'ready';
  }
  if (normalized.includes('network') || normalized.includes('switch')) {
    return 'warning';
  }
  if (normalized.includes('locked') || normalized.includes('privacy')) {
    return 'locked';
  }
  return 'muted';
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
  primaryAddon,
  primaryButtonClassName,
  primaryButtonLabel,
  primaryButtonTitle,
  primaryDisabled = false,
  primaryMetaLabel,
  statusLabel
}: WalletHeaderPanelProps) {
  const statusTone = resolveStatusTone(statusLabel);
  const menuId = useId();

  return (
    <div
      className="p2p-wallet-panel wallet-header-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          onToggleMenu();
        }
      }}
    >
      <div className="p2p-wallet-status">
        <div className="p2p-wallet-identity">
          <div className={primaryAddon ? 'p2p-wallet-primary-wrap has-addon' : 'p2p-wallet-primary-wrap'}>
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={onPrimaryAction}
              disabled={primaryDisabled}
              title={primaryButtonTitle}
              aria-label={primaryButtonTitle ?? primaryButtonLabel}
            >
              <span>{primaryButtonLabel}</span>
              {primaryMetaLabel ? <small>{primaryMetaLabel}</small> : null}
            </button>
            {primaryAddon ? <div className="p2p-wallet-primary-addon">{primaryAddon}</div> : null}
          </div>
          <div className={`p2p-wallet-status-text p2p-wallet-status-${statusTone}`}>
            <span>{modeLabel}</span>
            <strong>
              <i aria-hidden="true" />
              {statusLabel}
            </strong>
          </div>
        </div>
        {action ? <div className="p2p-wallet-status-actions">{action}</div> : null}
      </div>

      <div className="p2p-wallet-menu-wrap">
        <button
          type="button"
          className={menuOpen ? 'p2p-wallet-menu-trigger active' : 'p2p-wallet-menu-trigger'}
          onClick={onToggleMenu}
          disabled={menuDisabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-label={menuOpen ? `Close ${menuLabel} menu` : `Open ${menuLabel} menu`}
        >
          <span>{menuLabel}</span>
        </button>
        {menuOpen ? (
          <div id={menuId} className="p2p-wallet-menu" role="menu">
            {menu}
          </div>
        ) : null}
      </div>
    </div>
  );
}
