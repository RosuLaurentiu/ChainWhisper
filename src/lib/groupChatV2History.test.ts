import { describe, expect, it, vi } from 'vitest';
import { buildGroupChatV2MessageKey, type GroupChatV2MessageEvent } from './groupChatV2Chain';
import { encryptGroupChatV2Message } from './groupChatV2Crypto';
import { normalizeGroupChatV2HistoryEvents } from './groupChatV2History';
import { encodeGroupChatV2Payload } from './groupChatV2Payload';

const CHAIN_ID = 7_082_400n;
const CONTRACT = '0x2222222222222222222222222222222222222222';
const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x3333333333333333333333333333333333333333';
const KEY = {
  value: 123n,
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  groupId: 1n,
  epoch: 3n,
  membershipRevision: 5n
};

const event = async ({
  messageId,
  body,
  replyToMessageId,
  sender = ALICE,
  blockNumber = 110n
}: {
  messageId: bigint;
  body: string;
  replyToMessageId?: bigint;
  sender?: string;
  blockNumber?: bigint;
}): Promise<GroupChatV2MessageEvent> => {
  const context = {
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    groupId: 1n,
    epoch: 3n,
    membershipRevision: 5n,
    sender,
    senderSequence: messageId,
    valueSent: 0n,
    feeTaken: 0n
  };
  const encrypted = await encryptGroupChatV2Message(
    encodeGroupChatV2Payload({ body, replyToMessageId, replyPreview: replyToMessageId ? 'preview' : undefined }),
    KEY,
    context
  );
  return {
    protocol: 'group-v2',
    key: buildGroupChatV2MessageKey({
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      groupId: 1n,
      messageId
    }),
    chainId: CHAIN_ID,
    contractAddress: CONTRACT,
    groupId: 1n,
    messageId,
    epoch: 3n,
    membershipRevision: 5n,
    senderSequence: messageId,
    sender,
    nonce: encrypted.nonce,
    aadHash: encrypted.aadHash,
    ciphertext: encrypted.ciphertext,
    valueSent: 0n,
    feeTaken: 0n,
    transactionHash: `0x${messageId.toString(16).padStart(64, '0')}`,
    blockHash: `0x${(messageId + 100n).toString(16).padStart(64, '0')}`,
    blockNumber,
    logIndex: Number(messageId),
    removed: false,
    context,
    encrypted
  };
};

describe('groupChatV2History', () => {
  it('normalizes contiguous encrypted messages with stable replies and parsed trade metadata', async () => {
    const first = await event({ messageId: 1n, body: 'first', sender: BOB });
    const second = await event({
      messageId: 2n,
      body: '[trade-ref:v1:{"kind":"direct","tradeId":"7"}] reply',
      replyToMessageId: 1n,
      blockNumber: 111n
    });
    const resolveEpochKey = vi.fn(async () => KEY);
    const result = await normalizeGroupChatV2HistoryEvents({
      events: [second, first],
      expectedPreviousMessageId: 0n,
      viewerAddress: ALICE,
      resolveEpochKey,
      finality: 'finalized',
      timestampByBlock: new Map([[110, 1_000], [111, 1_001]])
    });

    expect(result.lastMessageId).toBe(2n);
    expect(result.entries.map((entry) => entry.direction)).toEqual(['incoming', 'outgoing']);
    expect(result.entries[1]?.replyToMessageId).toBe(
      buildGroupChatV2MessageKey({
        chainId: CHAIN_ID,
        contractAddress: CONTRACT,
        groupId: 1n,
        messageId: 1n
      })
    );
    expect(result.entries[1]?.replyToText).toBe('preview');
    expect(result.entries[1]?.groupV2).toMatchObject({
      contentState: 'available',
      messageId: '2',
      finality: 'finalized'
    });
    expect(resolveEpochKey).toHaveBeenCalledOnce();
  });

  it('advances past one authenticated-corrupt message without hiding later history', async () => {
    const first = await event({ messageId: 1n, body: 'first' });
    const corruptBase = await event({ messageId: 2n, body: 'corrupt me' });
    const replacementByte = corruptBase.ciphertext.endsWith('00') ? '01' : '00';
    const corruptCiphertext = `${corruptBase.ciphertext.slice(0, -2)}${replacementByte}`;
    const corrupt = {
      ...corruptBase,
      ciphertext: corruptCiphertext,
      encrypted: { ...corruptBase.encrypted, ciphertext: corruptCiphertext }
    };
    const third = await event({ messageId: 3n, body: 'still visible' });
    const result = await normalizeGroupChatV2HistoryEvents({
      events: [first, corrupt, third],
      expectedPreviousMessageId: 0n,
      viewerAddress: ALICE,
      resolveEpochKey: async () => KEY,
      finality: 'confirmed'
    });
    expect(result.entries.map((entry) => entry.text)).toEqual([
      'first',
      '(Encrypted group message unavailable)',
      'still visible'
    ]);
    expect(result.entries[1]?.groupV2?.contentState).toBe('unavailable');
    expect(result.nextMessageId).toBe(4n);
  });

  it('advances across pre-join messages without requesting their epoch keys', async () => {
    const beforeJoin = await event({ messageId: 1n, body: 'not authorized', sender: BOB });
    const afterJoin = await event({ messageId: 2n, body: 'visible after joining', sender: BOB });
    const resolveEpochKey = vi.fn(async () => KEY);
    const result = await normalizeGroupChatV2HistoryEvents({
      events: [beforeJoin, afterJoin],
      expectedPreviousMessageId: 0n,
      viewerAddress: ALICE,
      resolveEpochKey,
      isEventReadable: (candidate) => candidate.messageId >= 2n,
      finality: 'finalized'
    });

    expect(result.lastMessageId).toBe(2n);
    expect(result.entries.map((entry) => entry.text)).toEqual(['visible after joining']);
    expect(resolveEpochKey).toHaveBeenCalledOnce();
  });

  it('fails closed on gaps, duplicate stable IDs, and wrong authorization keys', async () => {
    const first = await event({ messageId: 1n, body: 'first' });
    const third = await event({ messageId: 3n, body: 'third' });
    await expect(normalizeGroupChatV2HistoryEvents({
      events: [first, third],
      expectedPreviousMessageId: 0n,
      viewerAddress: ALICE,
      resolveEpochKey: async () => KEY,
      finality: 'finalized'
    })).rejects.toThrow('expected message 2');
    await expect(normalizeGroupChatV2HistoryEvents({
      events: [first, first],
      expectedPreviousMessageId: 0n,
      viewerAddress: ALICE,
      resolveEpochKey: async () => KEY,
      finality: 'finalized'
    })).rejects.toThrow('duplicate stable');
    await expect(normalizeGroupChatV2HistoryEvents({
      events: [first],
      expectedPreviousMessageId: 0n,
      viewerAddress: ALICE,
      resolveEpochKey: async () => ({ ...KEY, epoch: 2n }),
      finality: 'finalized'
    })).rejects.toThrow('another authorization scope');
  });
});
