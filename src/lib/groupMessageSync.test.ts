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

  it('promotes an exact confirmed Group V2 message to finalized when safe-head sync catches up', () => {
    const identity = {
      protocol: 'group-v2' as const,
      contentState: 'available' as const,
      chainId: '7082400',
      contractAddress: '0x0000000000000000000000000000000000000003',
      groupId: '2',
      messageId: '4',
      epoch: '2',
      membershipRevision: '2',
      senderSequence: '1',
      nonce: `0x${'11'.repeat(12)}`,
      transactionHash: `0x${'22'.repeat(32)}`,
      blockNumber: '120',
      blockHash: `0x${'33'.repeat(32)}`,
      logIndex: 1,
      finality: 'confirmed' as const
    };
    const existing: ChatMessage[] = [{
      id: 'group-v2-message-4',
      direction: 'outgoing',
      text: 'sent message',
      txHash: identity.transactionHash,
      blockNumber: 120,
      logIndex: 1,
      deliveryState: 'sent',
      groupV2: identity
    }];
    const entries: GroupMessageEntry[] = [{
      id: 'group-v2-message-4',
      groupId: 2,
      direction: 'outgoing',
      text: 'sent message',
      senderAddress: '0x0000000000000000000000000000000000000001',
      txHash: identity.transactionHash,
      blockNumber: 120,
      logIndex: 1,
      groupV2: { ...identity, finality: 'finalized' }
    }];

    const merged = mergeGroupMessageEntries(existing, entries);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.groupV2?.finality).toBe('finalized');
    expect(merged[0]?.deliveryState).toBeUndefined();
  });

  it('replaces a submitted local copy when history brings the same transaction hash', () => {
    const submittedHash = `0x${'ab'.repeat(32)}`;
    const failedLocal: ChatMessage = {
      id: 'local-group-v2-failed',
      direction: 'outgoing',
      text: 'never sent',
      deliveryState: 'failed',
      timestamp: 1
    };
    const existing: ChatMessage[] = [
      failedLocal,
      {
        id: 'local-group-v2-submitted',
        direction: 'outgoing',
        text: 'hello',
        deliveryState: 'submitted',
        txHash: submittedHash.toUpperCase().replace('0X', '0x'),
        timestamp: 2
      }
    ];
    const entries: GroupMessageEntry[] = [{
      id: 'group-v2:7082400:0x2222222222222222222222222222222222222222:7:3',
      groupId: 7,
      direction: 'outgoing',
      text: 'hello',
      senderAddress: '0x0000000000000000000000000000000000000001',
      txHash: submittedHash,
      blockNumber: 20,
      logIndex: 0
    }];

    const merged = mergeGroupMessageEntries(existing, entries);

    expect(merged.map(({ id }) => id).sort()).toEqual([entries[0].id, failedLocal.id].sort());
    expect(merged.find(({ id }) => id === entries[0].id)?.deliveryState).toBeUndefined();
  });
});
