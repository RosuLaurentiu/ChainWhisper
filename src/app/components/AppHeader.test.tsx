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
  it('keeps app navigation visible while ecosystem links are closed', () => {
    const markup = renderMobileHeader(false);

    expect(markup).toContain('id="top-app-navigation-mobile"');
    expect(markup).toContain('aria-label="ChainWhisper apps"');
    expect(markup).not.toMatch(/id="top-app-navigation-mobile"[^>]*hidden/);
    expect(markup).toMatch(/id="top-navigation-links-mobile"[^>]*hidden/);
    expect(markup).toContain('aria-label="Open ecosystem links menu"');
    expect(markup).toContain('aria-controls="top-navigation-links-mobile"');
  });

  it('opens only the ecosystem links menu', () => {
    const markup = renderMobileHeader(true);

    expect(markup).not.toMatch(/id="top-navigation-links-mobile"[^>]*hidden/);
    expect(markup).not.toMatch(/id="top-app-navigation-mobile"[^>]*hidden/);
    expect(markup).toContain('aria-label="Close ecosystem links menu"');
  });

  it('does not show an ecosystem menu button when a page has no links', () => {
    const markup = renderMobileHeader(false, false);

    expect(markup).not.toContain('ecosystem links menu');
    expect(markup).toContain('id="top-app-navigation-mobile"');
  });
});
