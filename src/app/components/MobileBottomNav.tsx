import type { MobileView } from '../../lib/appShared';

type MobileBottomNavProps = {
  activeMobileView: MobileView;
  isConnected: boolean;
  showContacts?: boolean;
  chatLabel?: string;
  onSelectView: (view: MobileView) => void;
};

export default function MobileBottomNav({
  activeMobileView,
  isConnected,
  showContacts = true,
  chatLabel = 'Chat',
  onSelectView
}: MobileBottomNavProps) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile sections">
      {showContacts ? (
        <button
          type="button"
          className={activeMobileView === 'contacts' ? 'active' : undefined}
          aria-current={activeMobileView === 'contacts' ? 'page' : undefined}
          onClick={() => onSelectView('contacts')}
        >
          Contacts
        </button>
      ) : null}
      <button
        type="button"
        className={activeMobileView === 'chat' ? 'active' : undefined}
        aria-current={activeMobileView === 'chat' ? 'page' : undefined}
        data-ready={isConnected ? 'true' : 'false'}
        title={isConnected ? undefined : 'View connection status'}
        onClick={() => onSelectView('chat')}
      >
        {chatLabel}
      </button>
    </nav>
  );
}
