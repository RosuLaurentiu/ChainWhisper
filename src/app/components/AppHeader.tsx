import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import AppFavicon from '../../assets/favicon.png';
import { closeDetailsOnEscape } from '../../shared/components/a11y';

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
  onOpenHelp?: () => void;
  onCloseMobileLinks: () => void;
  debugControl?: ReactNode;
  links?: readonly AppHeaderLink[];
  brandActions?: ReactNode;
  homeControl?: ReactNode;
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
  onOpenHelp,
  onCloseMobileLinks,
  debugControl,
  links = [],
  brandActions,
  homeControl,
  appNavigationControl,
  navigationControl,
  walletControl,
  title = 'ChainWhisper',
  subtitle = '',
  showSoundToggle = false
}: AppHeaderProps) {
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const desktopEcosystemRef = useRef<HTMLDetailsElement | null>(null);
  const hasNavLinks = links.length > 0;
  const shouldShowSoundToggle = showSoundToggle && typeof onToggleSound === 'function' && typeof soundEnabled === 'boolean';
  const desktopAppNavigationControl = !isMobileNav ? appNavigationControl : null;
  const mobileAppNavigationControl = isMobileNav ? appNavigationControl : null;
  const desktopNavigationControl = !isMobileNav ? navigationControl : null;
  const mobileNavigationControl = isMobileNav ? navigationControl : null;
  const desktopWalletControl = !isMobileNav ? walletControl : null;
  const mobileWalletControl = isMobileNav ? walletControl : null;
  const desktopHomeControl = !isMobileNav ? homeControl : null;
  const mobileHomeControl = isMobileNav ? homeControl : null;
  const hasMobileMenuContent = Boolean(brandActions || debugControl || hasNavLinks);
  const showInlineMobileSoundToggle =
    isMobileNav && shouldShowSoundToggle && !hasMobileMenuContent;
  const mobileLinksMenuToggleControl =
    isMobileNav && hasMobileMenuContent ? (
      <button
        ref={mobileMenuButtonRef}
        type="button"
        className="header-icon-btn top-header-app-menu-toggle"
        aria-expanded={mobileLinksOpen}
        aria-controls="top-navigation-links-mobile"
        onClick={onToggleMobileLinksOpen}
        aria-label={mobileLinksOpen ? 'Close apps menu' : 'Open apps menu'}
        title={mobileLinksOpen ? 'Close apps menu' : 'Open apps menu'}
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
            d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Zm-8-8v2h2V6H6Zm10 0v2h2V6h-2ZM6 16v2h2v-2H6Zm10 0v2h2v-2h-2Z"
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
  const helpControl = onOpenHelp ? (
    <button
      type="button"
      className="header-icon-btn top-header-help-btn"
      onClick={onOpenHelp}
      aria-label="Open App Help"
      title="Open App Help"
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
          d="M12 2.75A9.25 9.25 0 1 0 21.25 12 9.26 9.26 0 0 0 12 2.75Zm0 16.5A7.25 7.25 0 1 1 19.25 12 7.26 7.26 0 0 1 12 19.25Zm0-4.05a1.15 1.15 0 1 0 1.15 1.15A1.15 1.15 0 0 0 12 15.2Zm.1-8.05a3.28 3.28 0 0 0-3.27 2.65l1.96.39a1.29 1.29 0 0 1 1.31-1.04 1.22 1.22 0 0 1 1.3 1.18c0 .65-.34.95-1.08 1.45-.85.58-1.9 1.3-1.9 3v.25h2v-.25c0-.64.34-.94 1.03-1.42.87-.61 1.95-1.36 1.95-3.03a3.2 3.2 0 0 0-3.3-3.18Z"
        />
      </svg>
    </button>
  ) : null;
  const mobileHelpControl = isMobileNav ? helpControl : null;
  const desktopHelpControl = isMobileNav ? null : helpControl;
  const desktopBrandActionContent =
    !isMobileNav && (brandActions || desktopHomeControl || soundToggleControl) ? (
      <>
        {brandActions}
        {desktopHomeControl}
        {soundToggleControl}
      </>
    ) : null;
  const desktopUtilityActions =
    desktopHelpControl || desktopWalletControl || debugControl ? (
      <>
        {desktopWalletControl}
        {debugControl}
        {desktopHelpControl}
      </>
    ) : null;
  const mobileWalletSlot = mobileWalletControl ? (
    <div className="top-header-mobile-wallet top-header-mobile-wallet-inline">{mobileWalletControl}</div>
  ) : null;
  const mobileUtilityCluster =
    mobileHomeControl || mobileLinksMenuToggleControl || showInlineMobileSoundToggle ? (
      <div className="top-header-mobile-utility-cluster">
        {mobileHomeControl ? <div className="top-header-mobile-home">{mobileHomeControl}</div> : null}
        {mobileLinksMenuToggleControl}
        {showInlineMobileSoundToggle ? soundToggleControl : null}
      </div>
    ) : null;
  const mobileTopActions =
    mobileUtilityCluster || mobileWalletSlot || mobileHelpControl ? (
      <>
        {mobileUtilityCluster}
        {mobileWalletSlot}
        {mobileHelpControl}
      </>
    ) : null;
  const showBrandActions = Boolean(desktopBrandActionContent);
  const showRightActions = isMobileNav ? Boolean(mobileTopActions) : Boolean(desktopUtilityActions);
  const headerClassName = `${hasNavLinks ? 'top-header top-header-has-links' : 'top-header top-header-no-links'}${
    desktopWalletControl ? ' top-header-has-wallet' : ''
  }${desktopAppNavigationControl ? ' top-header-has-app-navigation' : ''}${
    desktopNavigationControl ? ' top-header-has-navigation' : ''
  }${mobileWalletControl ? ' top-header-has-mobile-wallet' : ''}${
    mobileHomeControl ? ' top-header-has-mobile-home' : ''
  }`;

  useEffect(() => {
    if (!isMobileNav || !hasMobileMenuContent || !mobileLinksOpen) {
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
    window.requestAnimationFrame(() => {
      const preferredItem =
        mobileMenuPanelRef.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
        mobileMenuPanelRef.current?.querySelector<HTMLElement>('button, a[href]');
      preferredItem?.focus();
    });
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasMobileMenuContent, isMobileNav, mobileLinksOpen, onCloseMobileLinks]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = desktopEcosystemRef.current;
      if (!details?.open || details.contains(event.target as Node | null)) {
        return;
      }
      details.open = false;
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

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
          {showBrandActions ? <div className="top-header-brand-actions">{desktopBrandActionContent}</div> : null}
        </div>

        <div className="top-header-right">
          {desktopAppNavigationControl ? <div className="top-header-app-nav">{desktopAppNavigationControl}</div> : null}
          {desktopNavigationControl ? <div className="top-header-nav">{desktopNavigationControl}</div> : null}

          {!isMobileNav && hasNavLinks ? (
            <details
              ref={desktopEcosystemRef}
              className="top-header-ecosystem-menu"
              onKeyDown={closeDetailsOnEscape}
            >
              <summary>
                Ecosystem
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
                  <path fill="currentColor" d="m5.7 7.5 4.3 4.3 4.3-4.3 1.4 1.4-5.7 5.7-5.7-5.7 1.4-1.4Z" />
                </svg>
              </summary>
              <nav className="top-header-links" aria-label="COTI ecosystem navigation">
                {renderNavLinks(links, () => {
                  if (desktopEcosystemRef.current) {
                    desktopEcosystemRef.current.open = false;
                  }
                  onCloseMobileLinks();
                })}
              </nav>
            </details>
          ) : null}

          {showRightActions ? (
            <div className="top-header-actions">{isMobileNav ? mobileTopActions : desktopUtilityActions}</div>
          ) : null}
        </div>
      </div>

      {mobileAppNavigationControl ? (
        <div className="top-header-mobile-app-nav">{mobileAppNavigationControl}</div>
      ) : null}

      {isMobileNav && hasMobileMenuContent ? (
        <div
          ref={mobileMenuPanelRef}
          id="top-navigation-links-mobile"
          className={mobileLinksOpen ? 'top-header-mobile-links open' : 'top-header-mobile-links'}
          hidden={!mobileLinksOpen}
        >
          {brandActions || (!showInlineMobileSoundToggle && soundToggleControl) || debugControl ? (
            <div className="top-header-mobile-utility-row">
              {brandActions}
              {!showInlineMobileSoundToggle ? soundToggleControl : null}
              {debugControl}
            </div>
          ) : null}
          {hasNavLinks ? (
            <div className="top-header-mobile-ecosystem-section">
              <span className="top-header-mobile-menu-label">Ecosystem</span>
              <nav className="top-header-mobile-ecosystem-links" aria-label="COTI ecosystem navigation mobile">
                {renderNavLinks(links, onCloseMobileLinks)}
              </nav>
            </div>
          ) : null}
        </div>
      ) : null}

      {mobileNavigationControl ? <div className="top-header-mobile-nav">{mobileNavigationControl}</div> : null}
    </header>
  );
}
