import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ChevronDown, LoaderCircle, LockKeyhole, LockKeyholeOpen, RefreshCw, Wallet } from 'lucide-react';
import { resolveWalletStatusTone, type WalletStatusTone } from '../../../lib/walletSession';
import { moveFocusWithin } from '../../../shared/components/a11y';

type WalletHeaderPanelProps = {
  action?: ReactNode;
  busy?: boolean;
  menu: ReactNode;
  menuDisabled?: boolean;
  menuLabel?: string;
  menuOpen: boolean;
  menuBadgeCount?: number;
  menuWarning?: boolean;
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
  menuBadgeCount = 0,
  menuWarning = false,
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hasStatusAction = Boolean(statusActionLabel && onStatusAction);
  const hasStatusText = Boolean(modeLabel || statusLabel);
  const connected = primaryButtonClassName.includes('p2p-wallet-address');
  const normalizedStatusActionLabel = statusActionLabel?.toLowerCase() ?? '';
  const StatusActionIcon =
    resolvedStatusTone === 'ready'
      ? LockKeyholeOpen
      : normalizedStatusActionLabel.includes('refresh') ||
          normalizedStatusActionLabel.includes('recover') ||
          normalizedStatusActionLabel.includes('retry') ||
          normalizedStatusActionLabel.includes('set up')
        ? RefreshCw
        : LockKeyhole;
  const directPrivacyLabel = statusActionTitle ?? statusActionLabel ?? statusLabel ?? 'Privacy status';
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

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled), button:not(:disabled), a[href]')
        ?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node | null)) {
        onToggleMenu();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen, onToggleMenu]);

  return (
    <div
      ref={panelRef}
      className={`${busy ? 'p2p-wallet-panel wallet-header-panel is-wallet-busy' : 'p2p-wallet-panel wallet-header-panel'}${
        connected ? ' wallet-header-panel-connected' : ' wallet-header-panel-disconnected'
      }`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          onToggleMenu();
          window.requestAnimationFrame(() => triggerRef.current?.focus());
          return;
        }
        if (menuOpen && menuRef.current?.contains(event.target as Node)) {
          moveFocusWithin(event, {
            orientation: 'vertical',
            selector: '[role="menuitem"]:not(:disabled), button:not(:disabled), a[href]'
          });
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
              aria-busy={busy}
            >
              {busy ? (
                <LoaderCircle
                  className="p2p-wallet-primary-spinner"
                  size={15}
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
              ) : null}
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
                  {hasStatusAction && !connected ? (
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
        {connected ? (
          <button
            type="button"
            className={`p2p-wallet-privacy-direct p2p-wallet-privacy-${resolvedStatusTone}`}
            onClick={onStatusAction}
            disabled={!hasStatusAction || statusActionDisabled}
            title={directPrivacyLabel}
            aria-label={directPrivacyLabel}
            aria-busy={busy && hasStatusAction}
          >
            <StatusActionIcon size={17} strokeWidth={2.25} aria-hidden="true" />
          </button>
        ) : null}
        {action ? <div className="p2p-wallet-status-actions">{action}</div> : null}
      </div>

      <div className="p2p-wallet-menu-wrap">
        <button
          ref={triggerRef}
          type="button"
          className={menuOpen ? 'p2p-wallet-menu-trigger active' : 'p2p-wallet-menu-trigger'}
          onClick={onToggleMenu}
          disabled={menuDisabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-label={menuOpen ? `Close ${menuLabel} menu` : `Open ${menuLabel} menu`}
        >
          {connected ? (
            <ChevronDown className="p2p-wallet-menu-icon" size={18} strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <Wallet className="p2p-wallet-menu-icon" size={18} strokeWidth={2} aria-hidden="true" />
          )}
          <span className="p2p-wallet-menu-label">{connected ? 'More' : menuLabel}</span>
          {connected && menuBadgeCount > 0 ? (
            <span className="p2p-wallet-menu-badge" aria-hidden="true">{Math.min(menuBadgeCount, 99)}</span>
          ) : null}
          {connected && menuWarning ? <span className="p2p-wallet-menu-warning" aria-hidden="true" /> : null}
        </button>
        {menuOpen ? (
          <div ref={menuRef} id={menuId} className="p2p-wallet-menu" role="menu" aria-label={menuLabel}>
            {menu}
          </div>
        ) : null}
      </div>
    </div>
  );
}
