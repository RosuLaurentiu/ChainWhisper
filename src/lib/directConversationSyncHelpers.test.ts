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

  it('dedupes ChatGC confirmed messages against optimistic messages with transaction hashes', () => {
    const optimistic: ChatMessage = {
      id: 'local-2',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'sent',
      timestamp: 98,
      txHash: `0x${'11'.repeat(32)}`
    };

    const confirmed = entry({
      id: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:1',
      txHash: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:1',
      timestamp: 100
    });
    const next = mergeDirectHistoryEntries({ [peer]: [optimistic] }, [confirmed], wallet);

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0]).toMatchObject({
      id: confirmed.id,
      txHash: confirmed.txHash
    });
  });

  it('dedupes ChatGC optimistic messages during contact preview syncs', () => {
    const optimistic: ChatMessage = {
      id: 'local-preview',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'sent',
      timestamp: 98,
      txHash: `0x${'22'.repeat(32)}`
    };

    const confirmed = entry({
      id: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:2',
      txHash: 'chatgc:2632500:0xe5101d33986c91565d2c9f8b49aaf0b8ffee2243:2',
      timestamp: 100
    });
    const next = mergeDirectHistoryEntries(
      { [peer]: [optimistic] },
      [confirmed],
      wallet,
      { pruneOptimisticOutgoing: true }
    );

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0].id).toBe(confirmed.id);
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
