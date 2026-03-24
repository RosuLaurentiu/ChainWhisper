import type { MobileView } from '../lib/appShared';

type MobileBottomNavProps = {
  activeMobileView: MobileView;
  isConnected: boolean;
  onSelectView: (view: MobileView) => void;
};

export default function MobileBottomNav({
  activeMobileView,
  isConnected,
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
          <button
            type="button"
            className={activeMobileView === 'contacts' ? 'active' : undefined}
            onClick={() => onSelectView('contacts')}
          >
            Contacts
          </button>
          <button
            type="button"
            className={activeMobileView === 'chat' ? 'active' : undefined}
            onClick={() => onSelectView('chat')}
          >
            Chat
          </button>
        </>
      ) : null}
    </nav>
  );
}
