import { describe, expect, it } from 'vitest';
import {
  historyEntryToChatMessage,
  mergeDirectHistoryEntries
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

  it('preserves trade references from confirmed history entries', () => {
    const tradeReference = {
      version: 1 as const,
      tradeId: 42,
      escrowContract: '0x1111111111111111111111111111111111111111',
      terminalPath: '/otcdesk/terminal/l/ViAq'
    };

    expect(historyEntryToChatMessage(entry({ tradeReference }), wallet).tradeReference).toEqual(tradeReference);
  });

  it('preserves the read account metadata for owner-wallet history', () => {
    expect(
      historyEntryToChatMessage(
        entry({
          accountAddress: wallet,
          accountRole: 'owner'
        }),
        '0xcccccccccccccccccccccccccccccccccccccccc'
      )
    ).toMatchObject({
      accountAddress: wallet,
      accountRole: 'owner',
      senderAddress: wallet
    });
  });

  it('refreshes existing confirmed messages with parsed trade references', () => {
    const tradeReference = {
      version: 1 as const,
      tradeId: 42,
      escrowContract: '0x1111111111111111111111111111111111111111',
      terminalPath: '/otcdesk/terminal/l/ViAq'
    };
    const existing: ChatMessage = {
      id: '0xtx-1-out',
      direction: 'outgoing',
      text: 'hello',
      txHash: '0xtx',
      blockNumber: 10,
      logIndex: 1,
      timestamp: 100
    };

    const next = mergeDirectHistoryEntries(
      { [peer]: [existing] },
      [entry({ tradeReference })],
      wallet
    );

    expect(next[peer]).toHaveLength(1);
    expect(next[peer][0].tradeReference).toEqual(tradeReference);
  });

  it('never prunes an optimistic outgoing attempt by content match', () => {
    const directV2Optimistic: ChatMessage = {
      id: 'local-direct-v2-exact-attempt',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'sent',
      timestamp: 98
    };
    const confirmed = entry({ id: 'confirmed-1', timestamp: 100 });

    const next = mergeDirectHistoryEntries(
      { [peer]: [directV2Optimistic] },
      [confirmed],
      wallet
    );

    expect(next[peer].map((message) => message.id)).toEqual([
      'local-direct-v2-exact-attempt',
      confirmed.id
    ]);
  });

  it('keeps existing messages when adding older history', () => {
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
      wallet
    );

    expect(next[peer].map((message) => message.id)).toEqual(['older', 'existing']);
  });

  it('replaces a submitted local copy only when history has the same outgoing transaction hash', () => {
    const submittedHash = `0x${'cd'.repeat(32)}`;
    const submitted: ChatMessage = {
      id: 'local-direct-v2-submitted',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'submitted',
      txHash: submittedHash
    };
    const otherSubmitted: ChatMessage = {
      ...submitted,
      id: 'local-direct-v2-other',
      txHash: `0x${'ef'.repeat(32)}`
    };
    const failed: ChatMessage = {
      id: 'local-direct-v2-failed',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'failed'
    };
    const previous = { [peer]: [submitted, otherSubmitted, failed] };

    const next = mergeDirectHistoryEntries(
      previous,
      [entry({ id: 'direct-v2:confirmed', txHash: submittedHash.toUpperCase().replace('0X', '0x') })],
      wallet
    );

    expect(next[peer].map(({ id }) => id)).toEqual(
      expect.arrayContaining(['direct-v2:confirmed', otherSubmitted.id, failed.id])
    );
    expect(next[peer].some(({ id }) => id === submitted.id)).toBe(false);
    expect(next[peer]).toHaveLength(3);
  });

  it('keeps a submitted local copy when the matching hash is an incoming entry', () => {
    const submittedHash = `0x${'cd'.repeat(32)}`;
    const submitted: ChatMessage = {
      id: 'local-direct-v2-submitted',
      direction: 'outgoing',
      text: 'hello',
      deliveryState: 'submitted',
      txHash: submittedHash
    };

    const next = mergeDirectHistoryEntries(
      { [peer]: [submitted] },
      [entry({ id: 'direct-v2:incoming', direction: 'incoming', txHash: submittedHash })],
      wallet
    );

    expect(next[peer].some(({ id }) => id === submitted.id)).toBe(true);
  });
});
