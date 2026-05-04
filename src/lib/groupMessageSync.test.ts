import { describe, expect, it } from 'vitest';
import type { ChatMessage, GroupMessageEntry } from './appShared';
import { mergeGroupMessageEntries } from './groupMessageSync';

describe('mergeGroupMessageEntries', () => {
  it('deduplicates confirmed entries and keeps chronological order', () => {
    const existing: ChatMessage[] = [
      {
        id: 'tx-2-0-group-in',
        direction: 'incoming',
        text: 'already here',
        blockNumber: 12,
        logIndex: 0,
        txHash: '0x2'
      }
    ];
    const entries: GroupMessageEntry[] = [
      {
        id: 'tx-1-0-group-in',
        groupId: 7,
        direction: 'incoming',
        text: 'first',
        senderAddress: '0x0000000000000000000000000000000000000001',
        txHash: '0x1',
        blockNumber: 11,
        logIndex: 0
      },
      {
        id: 'tx-2-0-group-in',
        groupId: 7,
        direction: 'incoming',
        text: 'duplicate',
        senderAddress: '0x0000000000000000000000000000000000000002',
        txHash: '0x2',
        blockNumber: 12,
        logIndex: 0
      }
    ];

    expect(mergeGroupMessageEntries(existing, entries).map((message) => message.text)).toEqual([
      'first',
      'already here'
    ]);
  });

  it('removes optimistic outgoing messages after the matching tx is confirmed', () => {
    const existing: ChatMessage[] = [
      {
        id: 'local-group-1',
        direction: 'outgoing',
        text: 'pending',
        txHash: '0xabc',
        deliveryState: 'pending'
      }
    ];
    const entries: GroupMessageEntry[] = [
      {
        id: '0xabc-0-group-out',
        groupId: 3,
        direction: 'outgoing',
        text: 'confirmed',
        txHash: '0xABC',
        blockNumber: 22,
        logIndex: 0
      }
    ];

    const merged = mergeGroupMessageEntries(existing, entries);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(expect.objectContaining({
      id: '0xabc-0-group-out',
      text: 'confirmed'
    }));
  });
});
