import { describe, expect, it } from 'vitest';
import {
  historyEntryToChatMessage,
  mergeDirectHistoryEntries,
  resolveDirectUnreadState
} from './directConversationSyncHelpers';
import type { ChatMessage, HistoryEntry } from './appShared';

const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const peer = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: '0xtx-1-out',
  contact: peer,
  direction: 'outgoing',
  text: 'hello',
  txHash: '0xtx',
  blockNumber: 10,
  logIndex: 1,
  timestamp: 100,
  ...overrides
});

describe('directConversationSyncHelpers', () => {
  it('maps history entries to chat messages with the right sender address', () => {
    expect(historyEntryToChatMessage(entry(), wallet)).toMatchObject({
      direction: 'outgoing',
      senderAddress: wallet
    });
    expect(historyEntryToChatMessage(entry({ direction: 'incoming' }), wallet)).toMatchObject({
      direction: 'incoming',
      senderAddress: peer
    });
  });

  it('dedupes confirmed outgoing messages against optimistic local messages', () => {
    const optimistic: ChatMessage = {
      id: 'local-1',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'pending',
      timestamp: 98,
      txHash: '0xtx'
    };

    const next = mergeDirectHistoryEntries({ [peer]: [optimistic] }, [entry()], wallet);

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0]).toMatchObject({
      id: '0xtx-1-out',
      txHash: '0xtx'
    });
  });

  it('keeps existing messages when adding older history without optimistic pruning', () => {
    const existing: ChatMessage = {
      id: 'existing',
      direction: 'incoming',
      text: 'newer',
      blockNumber: 20,
      logIndex: 1
    };

    const next = mergeDirectHistoryEntries(
      { [peer]: [existing] },
      [entry({ id: 'older', direction: 'incoming', blockNumber: 5, logIndex: 1, text: 'older' })],
      wallet,
      { pruneOptimisticOutgoing: false }
    );

    expect(next[peer].map((message) => message.id)).toEqual(['older', 'existing']);
  });

  it('marks inactive contacts unread and active visible contacts read', () => {
    const latestMessageTimeByContact = new Map([
      [peer, 500],
      ['0xcccccccccccccccccccccccccccccccccccccccc', 600]
    ]);

    const activeResult = resolveDirectUnreadState({
      activeKey: peer,
      candidateAddresses: [peer],
      globalReadTs: 0,
      latestMessageTimeByContact,
      pageVisible: true,
      previousReadByContact: {},
      previousUnread: {},
      suppressedKeys: new Set(),
      walletKey: wallet
    });
    expect(activeResult.nextReadByContact[peer]).toBe(500);
    expect(activeResult.nextUnread[peer]).toBeUndefined();

    const inactiveResult = resolveDirectUnreadState({
      activeKey: peer,
      candidateAddresses: ['0xcccccccccccccccccccccccccccccccccccccccc'],
      globalReadTs: 0,
      latestMessageTimeByContact,
      pageVisible: true,
      previousReadByContact: {},
      previousUnread: {},
      suppressedKeys: new Set(),
      walletKey: wallet
    });
    expect(inactiveResult.nextUnread['0xcccccccccccccccccccccccccccccccccccccccc']).toBe(true);
  });
});
