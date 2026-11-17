import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import useChatWalletHeaderControl, { getWalletHeaderStatusError } from './useChatWalletHeaderControl';

const OWNER = '0x1000000000000000000000000000000000000001';
const provider = { request: vi.fn() };

const renderControl = ({
  connecting = false,
  configured,
  status,
  connected = true,
  ownerAesReady = true,
  statusErrorMessage,
  menuOpen = true
}: {
  connecting?: boolean;
  configured: boolean;
  status: 'disabled' | 'ready';
  connected?: boolean;
  ownerAesReady?: boolean;
  statusErrorMessage?: string;
  menuOpen?: boolean;
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
      chatWalletMenuOpen: menuOpen,
      connectingMethod: connecting ? 'metamask' : null,
      connectingWalletLabel: connecting ? 'MetaMask' : '',
      copyWithFeedback: vi.fn(),
      currentInjectedWalletOption: null,
      disconnectWallet: vi.fn(),
      injectedWalletOptions: [],
      lastCopiedKey: null,
      onToggleReadCursorCloud: vi.fn(),
      ownerAesReady,
      preferredBrowserWalletId: 'metamask',
      readCursorCloudConfigured: configured,
      readCursorCloudStatus: status,
      setChatWalletMenuOpen: vi.fn(),
      setError: vi.fn(),
      statusErrorMessage,
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

describe('useChatWalletHeaderControl unlock errors', () => {
  const message = 'COTI Snap has no AES key for this wallet on COTI Testnet on this device.';

  it('shows the header unlock error as an alert while privacy is locked', () => {
    const markup = renderControl({
      configured: false,
      status: 'disabled',
      ownerAesReady: false,
      statusErrorMessage: message,
      menuOpen: false
    });

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(message);
    expect(markup).toContain('aria-label="Dismiss wallet message"');
  });

  it('shows a connection error while the wallet is disconnected', () => {
    const markup = renderControl({
      configured: false,
      status: 'disabled',
      connected: false,
      statusErrorMessage: 'Wallet connection was not completed.',
      menuOpen: false
    });

    expect(markup).toContain('Wallet connection was not completed.');
  });

  it('does not show an old unlock error after privacy is ready', () => {
    const markup = renderControl({ configured: false, status: 'disabled', statusErrorMessage: message, menuOpen: false });

    expect(markup).not.toContain(message);
    expect(markup).not.toContain('role="alert"');
  });

  it('shows header wallet errors on every header page except Chat, which has its own error area', () => {
    expect(getWalletHeaderStatusError('dex', message)).toBe(message);
    expect(getWalletHeaderStatusError('swap', message)).toBe(message);
    expect(getWalletHeaderStatusError('trades', message)).toBe(message);
    expect(getWalletHeaderStatusError('treasury', message)).toBe(message);
    expect(getWalletHeaderStatusError('chat', message)).toBe('');
  });

  it('hides the alert while the wallet menu is open in the same place', () => {
    const markup = renderControl({ configured: false, status: 'disabled', ownerAesReady: false, statusErrorMessage: message });

    expect(markup).not.toContain('role="alert"');
  });
});
