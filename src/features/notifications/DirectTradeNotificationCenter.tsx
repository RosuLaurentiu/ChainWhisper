import { useRef } from 'react';
import { closeDetailsOnEscape } from '../../shared/components/a11y';
import type { DirectTradeNotificationItem } from './directTradeNotifications';

const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

export default function DirectTradeNotificationCenter({
  items,
  unreadCount,
  onOpen,
  onMarkAllRead,
  onClear,
  soundEnabled,
  onToggleSound
}: {
  items: readonly DirectTradeNotificationItem[];
  unreadCount: number;
  onOpen: (item: DirectTradeNotificationItem) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  return (
    <details ref={detailsRef} className="direct-trade-notification-center" onKeyDown={closeDetailsOnEscape}>
      <summary
        className="header-icon-btn direct-trade-notification-toggle"
        aria-label={unreadCount > 0 ? `Trade notifications, ${unreadCount} unread` : 'Trade notifications'}
        title="Direct trade notifications"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M12 2a2 2 0 0 0-2 2v1.1A6 6 0 0 0 6 11v3l-2 2v1h16v-1l-2-2v-3a6 6 0 0 0-4-5.9V4a2 2 0 0 0-2-2Zm-3 17a3 3 0 0 0 6 0H9Z" />
        </svg>
        {unreadCount > 0 ? <span className="direct-trade-notification-badge">{Math.min(unreadCount, 99)}</span> : null}
      </summary>
      <section className="direct-trade-notification-popover" aria-label="Direct trade notifications list">
        <header>
          <div>
            <strong>Trade notifications</strong>
            <span>Direct trades and counters only</span>
          </div>
          {items.length > 0 ? (
            <div className="direct-trade-notification-actions">
              {unreadCount > 0 ? <button type="button" onClick={onMarkAllRead}>Mark read</button> : null}
              <button type="button" onClick={onClear}>Clear</button>
            </div>
          ) : null}
        </header>
        {items.length === 0 ? (
          <p className="direct-trade-notification-empty">No new direct trades or counters.</p>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.read ? 'read' : 'unread'}
                  onClick={() => {
                    onOpen(item);
                    if (detailsRef.current) detailsRef.current.open = false;
                  }}
                >
                  <span className="direct-trade-notification-kind">
                    {item.kind === 'counter' ? 'Counter-offer' : 'Direct trade'} #{item.tradeId}
                  </span>
                  <span className="direct-trade-notification-peer">From {shortAddress(item.contactAddress)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {typeof soundEnabled === 'boolean' && onToggleSound ? (
          <div className="direct-trade-notification-settings">
            <span><strong>Notification sound</strong><small>Play a sound for new activity</small></span>
            <button
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              aria-label={soundEnabled ? 'Turn notification sound off' : 'Turn notification sound on'}
              onClick={onToggleSound}
            >
              <i aria-hidden="true" />
              <span>{soundEnabled ? 'On' : 'Off'}</span>
            </button>
          </div>
        ) : null}
      </section>
    </details>
  );
}
