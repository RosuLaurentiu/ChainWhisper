import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AppHeader from './AppHeader';

const renderMobileHeader = (mobileLinksOpen: boolean, withLinks = true) =>
  renderToStaticMarkup(
    <AppHeader
      headerRef={{ current: null }}
      mobileLinksOpen={mobileLinksOpen}
      isMobileNav
      onToggleMobileLinksOpen={vi.fn()}
      onCloseMobileLinks={vi.fn()}
      links={withLinks ? [{ href: 'https://example.com', label: 'Example' }] : []}
      appNavigationControl={
        <nav aria-label="ChainWhisper apps">
          <button type="button">Chat</button>
          <button type="button">OTC Desk</button>
        </nav>
      }
    />
  );

describe('AppHeader mobile navigation', () => {
  it('renders app navigation in a slim strip while the ecosystem menu is closed', () => {
    const markup = renderMobileHeader(false);

    expect(markup).toContain('aria-label="ChainWhisper apps"');
    expect(markup).toMatch(
      /class="top-header-mobile-app-nav"[\s\S]*aria-label="ChainWhisper apps"/
    );
    expect(markup).toMatch(/id="top-navigation-links-mobile"[^>]*hidden/);
    expect(markup).toContain('aria-label="Open apps menu"');
    expect(markup).toContain('aria-controls="top-navigation-links-mobile"');
  });

  it('opens ecosystem destinations without duplicating app navigation', () => {
    const markup = renderMobileHeader(true);

    expect(markup).not.toMatch(/id="top-navigation-links-mobile"[^>]*hidden/);
    expect(markup.match(/aria-label="ChainWhisper apps"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="COTI ecosystem navigation mobile"');
    expect(markup).toContain('aria-label="Close apps menu"');
  });

  it('keeps the app strip visible without showing an empty menu', () => {
    const markup = renderMobileHeader(false, false);

    expect(markup).toContain('aria-label="ChainWhisper apps"');
    expect(markup).toContain('class="top-header-mobile-app-nav"');
    expect(markup).not.toContain('aria-label="Open apps menu"');
    expect(markup).not.toContain('id="top-navigation-links-mobile"');
    expect(markup).not.toContain('COTI ecosystem navigation mobile');
  });

  it('renders Home as a primary mobile header action', () => {
    const markup = renderToStaticMarkup(
      <AppHeader
        headerRef={{ current: null }}
        mobileLinksOpen={false}
        isMobileNav
        onToggleMobileLinksOpen={vi.fn()}
        onCloseMobileLinks={vi.fn()}
        homeControl={
          <button type="button" aria-label="Back to home">
            Home
          </button>
        }
      />
    );

    expect(markup).toMatch(
      /class="top-header-mobile-home"[\s\S]*aria-label="Back to home"/
    );
  });

  it('renders the shared App Help utility action on mobile', () => {
    const markup = renderToStaticMarkup(
      <AppHeader
        headerRef={{ current: null }}
        mobileLinksOpen={false}
        isMobileNav
        onToggleMobileLinksOpen={vi.fn()}
        onCloseMobileLinks={vi.fn()}
        onOpenHelp={vi.fn()}
      />
    );

    expect(markup).toContain('aria-label="Open App Help"');
    expect(markup).toContain('title="Open App Help"');
    expect(markup).toMatch(
      /class="top-header-actions"[\s\S]*class="header-icon-btn top-header-help-btn"/
    );
  });

  it('renders a sound-only mobile utility directly instead of opening an empty menu', () => {
    const markup = renderToStaticMarkup(
      <AppHeader
        headerRef={{ current: null }}
        mobileLinksOpen={false}
        isMobileNav
        soundEnabled
        onToggleMobileLinksOpen={vi.fn()}
        onToggleSound={vi.fn()}
        onCloseMobileLinks={vi.fn()}
        showSoundToggle
      />
    );

    expect(markup).toContain('aria-label="Disable notification sound"');
    expect(markup).toMatch(
      /class="top-header-actions"[\s\S]*class="top-header-mobile-utility-cluster"[\s\S]*class="sound-toggle-btn"/
    );
    expect(markup).not.toContain('aria-label="Open apps menu"');
    expect(markup).not.toContain('id="top-navigation-links-mobile"');
  });
});
