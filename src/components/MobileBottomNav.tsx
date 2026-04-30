import type { MobileView } from '../lib/appShared';

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
      <button
        type="button"
        className={activeMobileView === 'wallets' ? 'active' : undefined}
        onClick={() => onSelectView('wallets')}
      >
        Wallet
      </button>
      {isConnected ? (
        <>
          {showContacts ? (
            <button
              type="button"
              className={activeMobileView === 'contacts' ? 'active' : undefined}
              onClick={() => onSelectView('contacts')}
            >
              Contacts
            </button>
          ) : null}
          <button
            type="button"
            className={activeMobileView === 'chat' ? 'active' : undefined}
            onClick={() => onSelectView('chat')}
          >
            {chatLabel}
          </button>
        </>
      ) : null}
    </nav>
  );
}
