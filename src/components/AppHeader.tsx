import type { ReactNode, Ref } from 'react';
import AppFavicon from '../assets/favicon.png';

type AppHeaderLink = {
  href: string;
  label: string;
};

type AppHeaderProps = {
  headerRef: Ref<HTMLElement>;
  mobileLinksOpen: boolean;
  isMobileNav: boolean;
  soundEnabled?: boolean;
  onToggleMobileLinksOpen: () => void;
  onToggleSound?: () => void;
  onCloseMobileLinks: () => void;
  debugControl?: ReactNode;
  links?: readonly AppHeaderLink[];
  brandActions?: ReactNode;
  title?: string;
  subtitle?: string;
  showSoundToggle?: boolean;
};

const renderNavLinks = (links: readonly AppHeaderLink[], onLinkClick: () => void) =>
  links.map((link) => (
    <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" onClick={onLinkClick}>
      {link.label}
    </a>
  ));

export default function AppHeader({
  headerRef,
  mobileLinksOpen,
  isMobileNav,
  soundEnabled,
  onToggleMobileLinksOpen,
  onToggleSound,
  onCloseMobileLinks,
  debugControl,
  links = [],
  brandActions,
  title = 'ChainWhisper',
  subtitle = '',
  showSoundToggle = false
}: AppHeaderProps) {
  const hasNavLinks = links.length > 0;
  const shouldShowSoundToggle = showSoundToggle && typeof onToggleSound === 'function' && typeof soundEnabled === 'boolean';
  const hasHeaderActions = Boolean(brandActions || shouldShowSoundToggle || debugControl);
  const showBrandActions = !hasNavLinks && hasHeaderActions;
  const showRightActions = hasNavLinks && hasHeaderActions;
  const headerActions = (
    <>
      {brandActions}
      {shouldShowSoundToggle ? (
        <button
          type="button"
          className="sound-toggle-btn"
          onClick={onToggleSound}
          title={soundEnabled ? 'Disable sound' : 'Enable sound'}
          aria-pressed={soundEnabled}
        >
          {soundEnabled ? (
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
                d="M12 2a2 2 0 0 0-2 2v1.07A6.002 6.002 0 0 0 6 11v3l-2 2v1h16v-1l-2-2v-3a6.002 6.002 0 0 0-4-5.93V4a2 2 0 0 0-2-2zM7 20a5 5 0 0 0 10 0z"
              />
            </svg>
          ) : (
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
                d="M12 2a2 2 0 0 0-2 2v1.07A6.002 6.002 0 0 0 6 11v3l-2 2v1h9.17l3.7 3.7 1.41-1.41L7.41 4 6 5.41 16.59 16H18v-1l-2-2v-3a6.002 6.002 0 0 0-4-5.93V4a2 2 0 0 0-2-2zM7 20a5 5 0 0 0 10 0z"
              />
            </svg>
          )}
        </button>
      ) : null}
      {debugControl}
    </>
  );
  const headerClassName = hasNavLinks ? 'top-header top-header-has-links' : 'top-header top-header-no-links';

  return (
    <header className={headerClassName} ref={headerRef}>
      <div className="top-header-bar">
        <div className="top-header-brand">
          <div className="top-header-brand-main">
            <span className="top-header-brand-logo-shell" aria-hidden="true">
              <img className="top-header-brand-logo" src={AppFavicon} alt="" />
            </span>
            <div className="top-header-brand-copy">
              <span className="top-header-brand-title">{title}</span>
              {subtitle ? <span className="top-header-brand-subtitle">{subtitle}</span> : null}
            </div>
          </div>
          {showBrandActions ? <div className="top-header-brand-actions">{headerActions}</div> : null}
        </div>

        <div className="top-header-right">
          {!isMobileNav && hasNavLinks ? (
            <nav className="top-header-links" aria-label="COTI ecosystem navigation">
              {renderNavLinks(links, onCloseMobileLinks)}
            </nav>
          ) : null}

          {showRightActions ? <div className="top-header-actions">{headerActions}</div> : null}

          {isMobileNav && hasNavLinks ? (
            <button
              type="button"
              className="top-header-menu-btn"
              aria-expanded={mobileLinksOpen}
              aria-controls="top-navigation-links-mobile"
              onClick={onToggleMobileLinksOpen}
              aria-label="Open ecosystem links menu"
            >
              {'\u2630'}
            </button>
          ) : null}
        </div>
      </div>

      {isMobileNav && hasNavLinks ? (
        <nav
          id="top-navigation-links-mobile"
          className={mobileLinksOpen ? 'top-header-mobile-links open' : 'top-header-mobile-links'}
          aria-label="COTI ecosystem navigation mobile"
        >
          {renderNavLinks(links, onCloseMobileLinks)}
        </nav>
      ) : null}
    </header>
  );
}
