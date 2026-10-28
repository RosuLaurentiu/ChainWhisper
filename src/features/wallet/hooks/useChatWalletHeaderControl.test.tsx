import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import useChatWalletHeaderControl from './useChatWalletHeaderControl';

const OWNER = '0x1000000000000000000000000000000000000001';
const provider = { request: vi.fn() };

const renderControl = ({
  connecting = false,
  configured,
  status,
  connected = true
}: {
  connecting?: boolean;
  configured: boolean;
  status: 'disabled' | 'ready';
  connected?: boolean;
}) => {
  const Component = () => {
    const { chatWalletHeaderControl } = useChatWalletHeaderControl({
      activateBrowserWalletSession: vi.fn(),
      browserWalletSession: connected
        ? {
            address: OWNER,
            chainId: 7_082_400,
            provider,
            source: 'injected',
            walletId: 'metamask',
            walletLabel: 'MetaMask'
          }
        : null,
      chatWalletMenuOpen: true,
      connectingMethod: connecting ? 'metamask' : null,
      connectingWalletLabel: connecting ? 'MetaMask' : '',
      copyWithFeedback: vi.fn(),
      currentInjectedWalletOption: null,
      disconnectWallet: vi.fn(),
      injectedWalletOptions: [],
      lastCopiedKey: null,
      onToggleReadCursorCloud: vi.fn(),
      ownerAesReady: true,
      preferredBrowserWalletId: 'metamask',
      readCursorCloudConfigured: configured,
      readCursorCloudStatus: status,
      setChatWalletMenuOpen: vi.fn(),
      setError: vi.fn(),
      walletAddress: connected ? OWNER : ''
    });
    return chatWalletHeaderControl;
  };
  return renderToStaticMarkup(createElement(Component));
};

describe('useChatWalletHeaderControl cross-device read status', () => {
  it('keeps address, privacy status, and wallet details as three adjacent controls', () => {
    const markup = renderControl({ configured: false, status: 'disabled' });

    expect(markup).toContain(`aria-label="Copy wallet address (${OWNER})"`);
    expect(markup).toContain('0x1000\u20260001');
    expect(markup).toContain('class="p2p-wallet-privacy-direct p2p-wallet-privacy-ready"');
    expect(markup).toContain('aria-label="Privacy ready"');
    expect(markup).toContain('aria-label="Close Wallet menu"');
    expect(markup).toContain('wallet-header-panel-connected');
  });

  it('does not repeat the disconnected state beside the connect action', () => {
    const markup = renderControl({ configured: false, status: 'disabled', connected: false });

    expect(markup).toContain('Connect wallet');
    expect(markup).not.toContain('Wallet disconnected');
  });

  it('keeps the connecting state compact and exposes the wallet name accessibly', () => {
    const markup = renderControl({ configured: false, status: 'disabled', connecting: true });

    expect(markup).toContain('Connecting');
    expect(markup).toContain('aria-label="Connecting to MetaMask"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('p2p-wallet-primary-spinner');
    expect(markup).not.toContain('Connecting MetaMask');
  });

  it('shows the explicit privacy-preserving opt-in only when configured', () => {
    const enabled = renderControl({ configured: true, status: 'disabled' });
    expect(enabled).toContain('Enable cross-device read status');
    expect(enabled).toContain('Messages and encryption keys stay out of Supabase.');
    expect(enabled).toContain('aria-pressed="false"');

    expect(renderControl({ configured: false, status: 'disabled' }))
      .not.toContain('cross-device read status');
  });

  it('renders a clear destructive opt-out for an active session', () => {
    const markup = renderControl({ configured: true, status: 'ready' });
    expect(markup).toContain('Disable and delete synced read status');
    expect(markup).toContain('Delete this wallet&#x27;s synced read cursors');
    expect(markup).toContain('aria-pressed="true"');
  });
});
