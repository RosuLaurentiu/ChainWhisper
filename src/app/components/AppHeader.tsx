import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import AppFavicon from '../../assets/favicon.png';

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
  appNavigationControl?: ReactNode;
  navigationControl?: ReactNode;
  walletControl?: ReactNode;
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
  appNavigationControl,
  navigationControl,
  walletControl,
  title = 'ChainWhisper',
  subtitle = '',
  showSoundToggle = false
}: AppHeaderProps) {
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const hasNavLinks = links.length > 0;
  const shouldShowSoundToggle = showSoundToggle && typeof onToggleSound === 'function' && typeof soundEnabled === 'boolean';
  const desktopAppNavigationControl = !isMobileNav ? appNavigationControl : null;
  const mobileAppNavigationControl = isMobileNav ? appNavigationControl : null;
  const desktopNavigationControl = !isMobileNav ? navigationControl : null;
  const mobileNavigationControl = isMobileNav ? navigationControl : null;
  const desktopWalletControl = !isMobileNav ? walletControl : null;
  const mobileWalletControl = isMobileNav ? walletControl : null;
  const mobileLinksMenuToggleControl =
    isMobileNav && hasNavLinks ? (
      <button
        ref={mobileMenuButtonRef}
        type="button"
        className="header-icon-btn top-header-app-menu-toggle"
        aria-expanded={mobileLinksOpen}
        aria-controls="top-navigation-links-mobile"
        onClick={onToggleMobileLinksOpen}
        aria-label={mobileLinksOpen ? 'Close ecosystem links menu' : 'Open ecosystem links menu'}
        title={mobileLinksOpen ? 'Close ecosystem links menu' : 'Open ecosystem links menu'}
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
            d="M4 6.5h16v2H4v-2Zm0 4.5h16v2H4v-2Zm0 4.5h16v2H4v-2Z"
          />
        </svg>
      </button>
    ) : null;
  const soundToggleControl = shouldShowSoundToggle ? (
    <button
      type="button"
      className="sound-toggle-btn"
      onClick={onToggleSound}
      title={soundEnabled ? 'Disable sound' : 'Enable sound'}
      aria-label={soundEnabled ? 'Disable notification sound' : 'Enable notification sound'}
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
  ) : null;
  const brandActionContent =
    brandActions || mobileLinksMenuToggleControl || soundToggleControl ? (
      <>
        {brandActions}
        {mobileLinksMenuToggleControl}
        {soundToggleControl}
      </>
    ) : null;
  const utilityActions =
    desktopWalletControl || debugControl ? (
      <>
        {desktopWalletControl}
        {debugControl}
      </>
    ) : null;
  const hasBrandActions = Boolean(brandActionContent);
  const hasUtilityActions = Boolean(utilityActions);
  const showBrandActions = !hasNavLinks && hasBrandActions;
  const showRightActions = hasUtilityActions || (hasNavLinks && hasBrandActions);
  const headerActions = (
    <>
      {hasNavLinks ? brandActionContent : null}
      {utilityActions}
    </>
  );
  const headerClassName = `${hasNavLinks ? 'top-header top-header-has-links' : 'top-header top-header-no-links'}${
    desktopWalletControl ? ' top-header-has-wallet' : ''
  }${desktopAppNavigationControl ? ' top-header-has-app-navigation' : ''}${
    desktopNavigationControl ? ' top-header-has-navigation' : ''
  }${mobileWalletControl ? ' top-header-has-mobile-wallet' : ''}`;

  useEffect(() => {
    if (!isMobileNav || !hasNavLinks || !mobileLinksOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      onCloseMobileLinks();
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasNavLinks, isMobileNav, mobileLinksOpen, onCloseMobileLinks]);

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
          {showBrandActions ? <div className="top-header-brand-actions">{brandActionContent}</div> : null}
        </div>

        <div className="top-header-right">
          {desktopAppNavigationControl ? <div className="top-header-app-nav">{desktopAppNavigationControl}</div> : null}
          {desktopNavigationControl ? <div className="top-header-nav">{desktopNavigationControl}</div> : null}

          {!isMobileNav && hasNavLinks ? (
            <nav className="top-header-links" aria-label="COTI ecosystem navigation">
              {renderNavLinks(links, onCloseMobileLinks)}
            </nav>
          ) : null}

          {showRightActions ? <div className="top-header-actions">{headerActions}</div> : null}

        </div>
      </div>

      {isMobileNav && hasNavLinks ? (
        <nav
          id="top-navigation-links-mobile"
          className={mobileLinksOpen ? 'top-header-mobile-links open' : 'top-header-mobile-links'}
          aria-label="COTI ecosystem navigation mobile"
          hidden={!mobileLinksOpen}
        >
          {renderNavLinks(links, onCloseMobileLinks)}
        </nav>
      ) : null}

      {mobileAppNavigationControl ? (
        <div id="top-app-navigation-mobile" className="top-header-mobile-app-nav">
          {mobileAppNavigationControl}
        </div>
      ) : null}
      {mobileWalletControl ? <div className="top-header-mobile-wallet">{mobileWalletControl}</div> : null}
      {mobileNavigationControl ? <div className="top-header-mobile-nav">{mobileNavigationControl}</div> : null}
    </header>
  );
}
