import type { ReactNode, Ref } from 'react';
import AppFavicon from '../assets/favicon.png';

type AppHeaderProps = {
  headerRef: Ref<HTMLElement>;
  mobileLinksOpen: boolean;
  isMobileNav: boolean;
  soundEnabled: boolean;
  onToggleMobileLinksOpen: () => void;
  onToggleSound: () => void;
  onCloseMobileLinks: () => void;
  debugControl?: ReactNode;
};

const NAV_LINKS = [
  { href: 'https://ciphertrade.org/', label: 'CipherTrade' },
  { href: 'https://pengodefi.app/', label: 'PengoDeFi' },
  { href: 'https://bridge.coti.io/bridge', label: 'COTI Bridge' },
  { href: 'https://coti.carbondefi.xyz/', label: 'CarbonDeFi' },
  { href: 'https://nexus.hyperlane.xyz/', label: 'Hyperlane Bridge' },
  { href: 'https://app.houdiniswap.com/', label: 'Houdini Swap' },
  { href: 'https://app.chainport.io/', label: 'ChainPort' }
] as const;

const renderNavLinks = (onLinkClick: () => void) =>
  NAV_LINKS.map((link) => (
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
  debugControl
}: AppHeaderProps) {
  return (
    <header className="top-header" ref={headerRef}>
      <div className="top-header-brand">
        <div className="top-header-section top-header-branding">
          <span className="top-header-brand-logo-shell" aria-hidden="true">
            <img className="top-header-brand-logo" src={AppFavicon} alt="" />
          </span>
          <div className="top-header-brand-copy">
            <span className="top-header-brand-title">ChainWhisper</span>
            <span className="top-header-brand-subtitle">powered by COTI</span>
          </div>
        </div>
        <button
          type="button"
          className="top-header-menu-btn"
          aria-expanded={mobileLinksOpen}
          aria-controls="top-navigation-links-mobile"
          onClick={onToggleMobileLinksOpen}
          aria-label="Open links menu"
          style={
            isMobileNav
              ? { display: 'inline-grid', position: 'fixed', top: '8px', right: '20px', zIndex: 120 }
              : { display: 'none' }
          }
        >
          {'\u2630'}
        </button>
        <button
          type="button"
          className="sound-toggle-btn"
          onClick={onToggleSound}
          title={soundEnabled ? 'Disable sound' : 'Enable sound'}
          aria-pressed={soundEnabled}
          style={
            isMobileNav
              ? { display: 'inline-grid', position: 'fixed', top: '8px', right: '64px', zIndex: 120 }
              : { marginLeft: 8 }
          }
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
        {debugControl}
      </div>

      <nav
        id="top-navigation-links-desktop"
        className="top-header-links top-header-links-desktop"
        aria-label="Top navigation"
        style={{ display: isMobileNav ? 'none' : 'flex' }}
      >
        {renderNavLinks(onCloseMobileLinks)}
      </nav>
      <nav
        id="top-navigation-links-mobile"
        className={mobileLinksOpen ? 'top-header-links top-header-links-mobile open' : 'top-header-links top-header-links-mobile'}
        aria-label="Top navigation mobile"
        style={
          isMobileNav && mobileLinksOpen
            ? {
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: '6px',
                position: 'fixed',
                top: '50px',
                right: '20px',
                width: 'min(240px, calc(100vw - 40px))',
                zIndex: 130
              }
            : { display: 'none' }
        }
      >
        {renderNavLinks(onCloseMobileLinks)}
      </nav>
    </header>
  );
}
