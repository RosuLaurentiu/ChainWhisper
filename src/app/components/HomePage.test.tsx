import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from './HomePage';

describe('HomePage app launcher', () => {
  it('presents each app once in the launcher grid without the duplicated core-app list', () => {
    const markup = renderToStaticMarkup(
      <HomePage
        onLaunchChat={vi.fn()}
        onOpenSwap={vi.fn()}
        onOpenTreasury={vi.fn()}
        onOpenTrades={vi.fn()}
      />
    );

    expect(markup).not.toContain('Core apps');
    expect(markup.match(/<article/g)).toHaveLength(4);
    expect(markup).toContain('Encrypted Chat');
    expect(markup).toContain('OTC Desk');
    expect(markup).toContain('Privacy Portal');
    expect(markup).toContain('Treasury Data');
    expect(markup).not.toContain('Home stays wallet-light');
    expect(markup).not.toContain('Each page behaves like its own app');
  });

  it('adds the legal and project footer only through the Home page', () => {
    const markup = renderToStaticMarkup(
      <HomePage
        onLaunchChat={vi.fn()}
        onOpenSwap={vi.fn()}
        onOpenTreasury={vi.fn()}
        onOpenTrades={vi.fn()}
      />
    );

    expect(markup).toContain('<main class="landing-main">');
    expect(markup).toContain('<footer class="landing-footer">');
    expect(markup).toContain('aria-label="ChainWhisper legal and project links"');
    expect(markup).toContain('Privacy');
    expect(markup).toContain('Terms');
    expect(markup).toContain('href="https://github.com/RosuLaurentiu/ChainWhisper"');
    expect(markup).toContain('href="https://github.com/RosuLaurentiu/ChainWhisper#readme"');
    expect(markup).toContain('href="https://github.com/RosuLaurentiu/ChainWhisper/issues"');
    expect(markup.match(/target="_blank"/g)).toHaveLength(3);
    expect(markup.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
  });
});
