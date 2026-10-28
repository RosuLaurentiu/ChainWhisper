import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AppNetworkSwitcher from './AppNetworkSwitcher';

describe('AppNetworkSwitcher', () => {
  it('shows the active COTI environment and disables coming-soon networks', () => {
    const markup = renderToStaticMarkup(
      <AppNetworkSwitcher
        activeNetworkId="coti-testnet"
        walletChainId={7082400}
        onSelectNetwork={vi.fn()}
      />
    );
    expect(markup).toContain('aria-label="Network: COTI Testnet"');
    expect(markup).toContain('COTI Mainnet');
    expect(markup).toContain('COTI Testnet');
    expect(markup).toContain('Ethereum');
    expect(markup).toContain('Avalanche');
    expect(markup.match(/coming soon/gi)).toHaveLength(2);
    expect(markup).toContain('Reveal a tiny ChainWhisper secret');
  });

  it('warns when the connected wallet is on another chain', () => {
    const markup = renderToStaticMarkup(
      <AppNetworkSwitcher
        activeNetworkId="coti-mainnet"
        walletChainId={1}
        onSelectNetwork={vi.fn()}
      />
    );
    expect(markup).toContain('app-network-status-dot mismatch');
    expect(markup).toContain('Wallet is not on COTI Mainnet');
  });

  it('locks a release candidate to its configured network', () => {
    const markup = renderToStaticMarkup(
      <AppNetworkSwitcher
        activeNetworkId="coti-testnet"
        networkSelectionLocked
        walletChainId={7082400}
        onSelectNetwork={vi.fn()}
      />
    );
    expect(markup).toContain('This test candidate is locked to COTI Testnet.');
    expect(markup).toMatch(/class="app-network-option accent-coti" disabled=""[^>]*>[\s\S]*COTI Mainnet/);
  });
});
