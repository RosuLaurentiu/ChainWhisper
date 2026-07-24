import {
  preloadChatPage,
  preloadSwapPage,
  preloadTradesPage,
  preloadTreasuryPage
} from '../lazyRoutes';
import type { AppPage } from '../../shell/routing';
import { moveFocusWithin } from '../../shared/components/a11y';

const APP_NAV_ITEMS: Array<{ page: AppPage; label: string; onPrefetch?: () => void }> = [
  { page: 'chat', label: 'Chat', onPrefetch: preloadChatPage },
  { page: 'trades', label: 'OTC Desk', onPrefetch: preloadTradesPage },
  { page: 'swap', label: 'Privacy Portal', onPrefetch: preloadSwapPage },
  { page: 'treasury', label: 'Treasury', onPrefetch: preloadTreasuryPage }
];

type AppHeaderNavigationProps = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
};

export function AppHeaderNavigation({ activePage, onNavigate }: AppHeaderNavigationProps) {
  return (
    <nav
      className="app-header-nav"
      aria-label="ChainWhisper apps"
      onKeyDown={(event) => moveFocusWithin(event, { orientation: 'horizontal' })}
    >
      {APP_NAV_ITEMS.map((item, index) => (
        <button
          key={item.page}
          type="button"
          className={activePage === item.page ? 'active' : undefined}
          aria-current={activePage === item.page ? 'page' : undefined}
          tabIndex={activePage === item.page || (activePage === 'home' && index === 0) ? 0 : -1}
          onClick={() => onNavigate(item.page)}
          onFocus={item.onPrefetch}
          onMouseEnter={item.onPrefetch}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

type AppHeaderHomeButtonProps = {
  onNavigateHome: () => void;
};

export function AppHeaderHomeButton({ onNavigateHome }: AppHeaderHomeButtonProps) {
  return (
    <button
      type="button"
      className="header-icon-btn top-header-home-btn"
      onClick={onNavigateHome}
      aria-label="Back to home"
      title="Back to home"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        aria-hidden="true"
        focusable="false"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill="currentColor"
          d="M12 3.2 3.5 10v10.3h6.2v-5.8h4.6v5.8h6.2V10L12 3.2Zm0 2.6 6 4.8v7.7h-1.7v-5.8H7.7v5.8H6V10.6l6-4.8Z"
        />
      </svg>
    </button>
  );
}
