import { useId, type ReactNode } from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import { resolveWalletStatusTone, type WalletStatusTone } from '../lib/walletSession';

type WalletHeaderPanelProps = {
  action?: ReactNode;
  busy?: boolean;
  menu: ReactNode;
  menuDisabled?: boolean;
  menuLabel?: string;
  menuOpen: boolean;
  modeLabel: ReactNode;
  onPrimaryAction: () => void;
  onToggleMenu: () => void;
  primaryAddon?: ReactNode;
  primaryButtonClassName: string;
  primaryButtonLabel: string;
  primaryButtonTitle?: string;
  primaryDisabled?: boolean;
  primaryMetaLabel?: string;
  statusActionDisabled?: boolean;
  statusActionLabel?: string;
  statusActionTitle?: string;
  statusLabel?: string;
  statusTone?: WalletStatusTone;
  onStatusAction?: () => void;
};

export default function WalletHeaderPanel({
  action,
  busy = false,
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
  statusActionDisabled = false,
  statusActionLabel,
  statusActionTitle,
  statusLabel,
  statusTone,
  onStatusAction
}: WalletHeaderPanelProps) {
  const resolvedStatusTone = statusTone ?? resolveWalletStatusTone(statusLabel ?? '');
  const menuId = useId();
  const hasStatusAction = Boolean(statusActionLabel && onStatusAction);
  const hasStatusText = Boolean(modeLabel || statusLabel);
  const normalizedStatusActionLabel = statusActionLabel?.toLowerCase() ?? '';
  const StatusActionIcon =
    normalizedStatusActionLabel.includes('refresh') ||
    normalizedStatusActionLabel.includes('recover') ||
    normalizedStatusActionLabel.includes('retry') ||
    normalizedStatusActionLabel.includes('set up')
      ? RefreshCw
      : LockKeyhole;
  const statusIndicatorContent = (
    <>
      <i aria-hidden="true" />
      <span className="p2p-wallet-status-label">{statusLabel}</span>
      {hasStatusAction ? (
        <span className="p2p-wallet-status-action-icon" aria-hidden="true">
          <StatusActionIcon size={12} strokeWidth={2.6} />
        </span>
      ) : null}
    </>
  );

  return (
    <div
      className={busy ? 'p2p-wallet-panel wallet-header-panel is-wallet-busy' : 'p2p-wallet-panel wallet-header-panel'}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          onToggleMenu();
        }
      }}
    >
      <div className="p2p-wallet-status">
        <div className={hasStatusText ? 'p2p-wallet-identity' : 'p2p-wallet-identity no-status'}>
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
              {primaryMetaLabel ? <small aria-live="polite">{primaryMetaLabel}</small> : null}
            </button>
            {primaryAddon ? <div className="p2p-wallet-primary-addon">{primaryAddon}</div> : null}
          </div>
          {hasStatusText ? (
            <div
              className={`p2p-wallet-status-text p2p-wallet-status-${resolvedStatusTone}${
                hasStatusAction ? ' has-status-action' : ''
              }`}
            >
              {modeLabel ? <div className="p2p-wallet-mode-label">{modeLabel}</div> : null}
              {statusLabel ? (
                <div className="p2p-wallet-status-row">
                  {hasStatusAction ? (
                    <button
                      type="button"
                      className="p2p-wallet-status-indicator p2p-wallet-status-button"
                      onClick={onStatusAction}
                      disabled={statusActionDisabled}
                      title={statusActionTitle}
                      aria-label={statusActionTitle ?? statusActionLabel ?? statusLabel}
                    >
                      {statusIndicatorContent}
                    </button>
                  ) : (
                    <strong className="p2p-wallet-status-indicator">{statusIndicatorContent}</strong>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
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
