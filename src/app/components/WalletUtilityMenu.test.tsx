import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WalletUtilityMenu from './WalletUtilityMenu';

describe('Wallet utility sound switch', () => {
  it.each([true, false])('keeps only the sound control on the track when enabled=%s', soundEnabled => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(<WalletUtilityMenu activeNetworkId="coti-testnet" networkSelectionLocked={false}
      walletChainId={7082400} networkSwitching={false} onSelectNetwork={noop} notifications={[]} unreadCount={0}
      soundEnabled={soundEnabled} onToggleSound={noop} onOpenNotification={noop} onMarkAllRead={noop}
      onClearNotifications={noop} onOpenHelp={noop} />);
    expect(markup.match(/wallet-utility-sound-track/g)).toHaveLength(1);
    expect(markup).toContain('<i aria-hidden="true"></i>Connected');
    expect(markup).toContain(`role="switch" aria-checked="${soundEnabled}"`);
    expect(noop).not.toHaveBeenCalled();
  });
  it('gives the Token approvals row an icon, like the other rows', () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(<WalletUtilityMenu activeNetworkId="coti-testnet" networkSelectionLocked={false}
      walletChainId={7082400} networkSwitching={false} onSelectNetwork={noop} notifications={[]} unreadCount={0}
      soundEnabled onToggleSound={noop} onOpenNotification={noop} onMarkAllRead={noop}
      onClearNotifications={noop} onOpenHelp={noop} onOpenApprovals={noop} />);
    const start = markup.lastIndexOf('<button', markup.indexOf('Token approvals'));
    const row = markup.slice(start, markup.indexOf('</button>', start));
    expect(row).toContain('Token approvals');
    expect(row).toMatch(/^<button type="button" class="wallet-utility-row" role="menuitem"><svg/);
    expect(row.match(/<svg/g)).toHaveLength(2);
  });
});
