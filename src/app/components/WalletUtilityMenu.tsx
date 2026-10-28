import { Bell, ChevronRight, CircleHelp, Globe2, Volume2 } from 'lucide-react';
import { useState } from 'react';
import {
  CHAINWHISPER_NETWORK_OPTIONS,
  getChainWhisperCotiNetwork,
  type ChainWhisperActiveNetworkId
} from '../../lib/chainWhisperNetworks';
import type { DirectTradeNotificationItem } from '../../features/notifications/directTradeNotifications';

type WalletUtilityMenuProps = {
  activeNetworkId: ChainWhisperActiveNetworkId;
  networkSelectionLocked: boolean;
  walletChainId: number | null;
  networkSwitching: boolean;
  onSelectNetwork: (networkId: ChainWhisperActiveNetworkId) => void;
  notifications: readonly DirectTradeNotificationItem[];
  unreadCount: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenNotification: (item: DirectTradeNotificationItem) => void;
  onMarkAllRead: () => void;
  onClearNotifications: () => void;
  onOpenHelp: () => void;
};

const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

export default function WalletUtilityMenu({
  activeNetworkId,
  networkSelectionLocked,
  walletChainId,
  networkSwitching,
  onSelectNetwork,
  notifications,
  unreadCount,
  soundEnabled,
  onToggleSound,
  onOpenNotification,
  onMarkAllRead,
  onClearNotifications,
  onOpenHelp
}: WalletUtilityMenuProps) {
  const [networkOpen, setNetworkOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const activeNetwork = getChainWhisperCotiNetwork(activeNetworkId);
  const walletMismatch = walletChainId !== null && walletChainId !== activeNetwork.chainIdDecimal;

  return (
    <div className="wallet-utility-menu">
      <header className="wallet-utility-heading">
        <strong>Wallet utilities</strong>
        <span><i aria-hidden="true" />Connected</span>
      </header>

      <section className="wallet-utility-section">
        <button
          type="button"
          className="wallet-utility-row"
          onClick={() => setNetworkOpen((open) => !open)}
          aria-expanded={networkOpen}
          role="menuitem"
        >
          <Globe2 size={17} aria-hidden="true" />
          <span><strong>Network</strong><small>{walletMismatch ? 'Switch required' : 'Connected'}</small></span>
          <span className={walletMismatch ? 'wallet-utility-value warning' : 'wallet-utility-value'}>
            <i aria-hidden="true" />{networkSwitching ? 'Switching…' : activeNetwork.shortName}
          </span>
          <ChevronRight className={networkOpen ? 'open' : undefined} size={16} aria-hidden="true" />
        </button>
        {networkOpen ? (
          <div className="wallet-utility-submenu" aria-label="ChainWhisper networks">
            {CHAINWHISPER_NETWORK_OPTIONS.map((option) => {
              const active = option.id === activeNetworkId;
              const available = option.status === 'available';
              return (
                <button
                  key={option.id}
                  type="button"
                  className={active ? 'active' : undefined}
                  disabled={!available || networkSwitching || active || networkSelectionLocked}
                  onClick={() => onSelectNetwork(option.id as ChainWhisperActiveNetworkId)}
                >
                  <span><strong>{option.shortName}</strong><small>{active ? 'Selected' : available ? 'Available' : 'Coming soon'}</small></span>
                  {active ? <b>Current</b> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="wallet-utility-section">
        <div className="wallet-utility-row wallet-utility-notification-row">
          <Bell size={17} aria-hidden="true" />
          <button
            type="button"
            className="wallet-utility-row-main"
            onClick={() => setNotificationsOpen((open) => !open)}
            aria-expanded={notificationsOpen}
          >
            <span><strong>Notifications</strong><small>{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</small></span>
          </button>
          <label className="wallet-utility-sound">
            <span>Sound</span>
            <button
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              aria-label={soundEnabled ? 'Turn notification sound off' : 'Turn notification sound on'}
              onClick={onToggleSound}
            >
              <i aria-hidden="true" />
            </button>
          </label>
        </div>
        {notificationsOpen ? (
          <div className="wallet-utility-notifications">
            <div className="wallet-utility-notification-actions">
              {unreadCount > 0 ? <button type="button" onClick={onMarkAllRead}>Mark read</button> : null}
              {notifications.length > 0 ? <button type="button" onClick={onClearNotifications}>Clear</button> : null}
            </div>
            {notifications.length > 0 ? notifications.slice(0, 4).map((item) => (
              <button key={item.id} type="button" className={item.read ? 'read' : 'unread'} onClick={() => onOpenNotification(item)}>
                <Volume2 size={14} aria-hidden="true" />
                <span><strong>{item.kind === 'counter' ? 'Counter-offer' : 'Direct trade'} #{item.tradeId}</strong><small>From {shortAddress(item.contactAddress)}</small></span>
              </button>
            )) : <p>No new direct trades or counters.</p>}
          </div>
        ) : null}
      </section>

      <button type="button" className="wallet-utility-row wallet-utility-help" onClick={onOpenHelp} role="menuitem">
        <CircleHelp size={17} aria-hidden="true" />
        <span><strong>Help</strong></span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
