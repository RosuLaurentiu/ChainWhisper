import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import DirectTradeNotificationCenter from './DirectTradeNotificationCenter';
import type { DirectTradeNotificationItem } from './directTradeNotifications';

const item = (kind: 'direct' | 'counter', tradeId: string): DirectTradeNotificationItem => ({
  id: `direct-trade-v2:${kind}`,
  kind,
  contactAddress: '0x3333333333333333333333333333333333333333',
  tradeId,
  parentTradeId: kind === 'direct' ? '0' : '1',
  createdAt: Number(tradeId),
  blockNumber: tradeId,
  blockHash: `0x${'55'.repeat(32)}`,
  transactionHash: `0x${'44'.repeat(32)}`,
  read: false
});

describe('DirectTradeNotificationCenter', () => {
  it('labels only direct trades and counters and displays the unread badge', () => {
    const markup = renderToStaticMarkup(
      <DirectTradeNotificationCenter
        items={[item('direct', '1'), item('counter', '2')]}
        unreadCount={2}
        onOpen={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClear={vi.fn()}
        soundEnabled
        onToggleSound={vi.fn()}
      />
    );
    expect(markup).toContain('Trade notifications, 2 unread');
    expect(markup).toContain('Direct trade #1');
    expect(markup).toContain('Counter-offer #2');
    expect(markup).toContain('Direct trades and counters only');
    expect(markup).toContain('Notification sound');
    expect(markup).toContain('role="switch" aria-checked="true"');
    expect(markup).toContain('Turn notification sound off');
    expect(markup).not.toContain('Accepted');
    expect(markup).not.toContain('Filled');
  });

  it('renders a clear empty state without historical spam', () => {
    const markup = renderToStaticMarkup(
      <DirectTradeNotificationCenter
        items={[]}
        unreadCount={0}
        onOpen={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expect(markup).toContain('No new direct trades or counters.');
    expect(markup).not.toContain('Mark read');
  });
});
