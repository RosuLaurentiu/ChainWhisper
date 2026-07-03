import { useId } from 'react';

export type AppWalletSwitchOption = {
  active?: boolean;
  address?: string;
  disabled?: boolean;
  id: string;
  key: string;
  label: string;
  walletId?: string;
};

type AppWalletSwitchButtonProps = {
  disabled?: boolean;
  menuOpen: boolean;
  onSelectWallet: (option: AppWalletSwitchOption) => void;
  onToggleMenu: () => void;
  menuLabel?: string;
  options: AppWalletSwitchOption[];
  title?: string;
};

export default function AppWalletSwitchButton({
  disabled = false,
  menuOpen,
  menuLabel = 'Accounts',
  onSelectWallet,
  onToggleMenu,
  options,
  title = 'Switch saved app wallet'
}: AppWalletSwitchButtonProps) {
  const menuId = useId();

  return (
    <div
      className="p2p-app-wallet-switch-menu-wrap"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          onToggleMenu();
        }
      }}
    >
      <button
        type="button"
        className={menuOpen ? 'p2p-wallet-icon-action app-wallet-switch-button active' : 'p2p-wallet-icon-action app-wallet-switch-button'}
        onClick={onToggleMenu}
        disabled={disabled}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M5 6.5h9.2l-2-2" />
          <path d="M14.2 6.5l-2 2" />
          <path d="M15 13.5H5.8l2 2" />
          <path d="M5.8 13.5l2-2" />
        </svg>
      </button>

      {menuOpen ? (
        <div id={menuId} className="p2p-app-wallet-switch-menu" role="menu" aria-label={menuLabel}>
          <span>{menuLabel}</span>
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className={option.active ? 'p2p-wallet-action active' : 'p2p-wallet-action'}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onSelectWallet(option);
              }}
              disabled={disabled || option.disabled || !option.id}
              role="menuitem"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
