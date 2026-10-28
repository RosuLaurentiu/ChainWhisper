import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, GroupMessageEntry } from './appShared';
import { mergeGroupMessageEntries, syncActiveGroupMessagesFast } from './groupMessageSync';

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
});

describe('syncActiveGroupMessagesFast failure progress', () => {
  it('stores one failure marker and advances the cursor past a rejected encrypted memo', async () => {
    type SyncArgs = Parameters<typeof syncActiveGroupMessagesFast>[0];
    const walletAddress = '0x0000000000000000000000000000000000000001';
    const senderAddress = '0x0000000000000000000000000000000000000002';
    const walletKey = walletAddress.toLowerCase();
    const incomingFilter = { kind: 'incoming' };
    const outgoingFilter = { kind: 'outgoing' };
    const queryFilter = vi.fn(async (filter: unknown) => filter === incomingFilter
      ? [{
          transactionHash: '0xdeadbeef',
          blockNumber: 100,
          index: 0,
          args: {
            from: senderAddress,
            messageForRecipient: { value: [1n] }
          }
        }]
      : []);
    const contract: SyncArgs['contract'] = {
      filters: {
        GroupMessageDelivered: () => incomingFilter,
        GroupMessageSubmitted: () => outgoingFilter,
        GroupMemberAdded: () => ({ kind: 'member-added' }),
        GroupMemberRemoved: () => ({ kind: 'member-removed' }),
        GroupMemberLeft: () => ({ kind: 'member-left' })
      },
      lastMessageBlockForGroup: vi.fn(async () => 100),
      queryFilter
    };
    const parseEncryptedChatMessagePayload = vi.fn(async () => {
      throw new Error('Encrypted memo exceeds the supported ciphertext size.');
    });
    const groupMessageLastSyncedBlockRef = { current: {} as Record<string, number> };
    const messagesByGroupRef = { current: {} as Record<string, ChatMessage[]> };
    let messagesByGroup: Record<string, ChatMessage[]> = {};
    const setMessagesByGroup: SyncArgs['setMessagesByGroup'] = (next) => {
      messagesByGroup = typeof next === 'function' ? next(messagesByGroup) : next;
      messagesByGroupRef.current = messagesByGroup;
    };
    const args: SyncArgs = {
      blockTimestampCacheRef: { current: new Map() },
      cacheKey: walletKey,
      contract,
      fastOptions: { knownLastBlock: 100 },
      groupId: 7,
      groupMemberLastSyncedBlockRef: { current: {} },
      groupMessageLastSyncedBlockRef,
      isCurrentWalletKey: () => true,
      latestBlock: 100,
      messagesByGroupRef,
      options: {},
      parseEncryptedChatMessagePayload,
      pendingForcedBottomAnchorThreadKeyRef: { current: null },
      readProvider: { getBlock: vi.fn(async () => ({ timestamp: 1234 })) },
      requestedWalletAddress: walletAddress,
      setMessagesByGroup,
      signer: {} as never,
      stickToBottomRef: { current: true },
      walletKey
    };

    await syncActiveGroupMessagesFast(args);

    expect(parseEncryptedChatMessagePayload).toHaveBeenCalledTimes(1);
    expect(messagesByGroup['7']).toEqual([
      expect.objectContaining({
        blockNumber: 100,
        text: '(Unable to decrypt message)',
        txHash: '0xdeadbeef'
      })
    ]);
    expect(groupMessageLastSyncedBlockRef.current[`${walletKey}:7`]).toBe(100);
    expect(queryFilter).toHaveBeenCalledTimes(2);

    await syncActiveGroupMessagesFast(args);

    expect(parseEncryptedChatMessagePayload).toHaveBeenCalledTimes(1);
    expect(queryFilter).toHaveBeenCalledTimes(2);
  });
});
