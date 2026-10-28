import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './appShared';
import {
  chatReplyTargetMatchesAnchor,
  getChatReplySourceAnchor,
  normalizeChatReplySourceAnchor
} from './chatReplySourceAnchor';

const hash = (byte: string): string => `0x${byte.repeat(64)}`;

const directMessage = (blockHash = hash('1')): ChatMessage => ({
  id: 'direct-v2:7082400:chat:conversation:7',
  direction: 'incoming',
  text: 'source',
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: '7082400',
    contractAddress: '0x1111111111111111111111111111111111111111',
    conversationId: hash('2'),
    messageId: '7',
    epoch: '1',
    senderSequence: '4',
    nonce: '0x0102030405060708090a0b0c',
    transactionHash: hash('3'),
    blockNumber: '100',
    blockHash,
    logIndex: 2,
    finality: 'confirmed'
  }
});

describe('chat reply source anchors', () => {
  it('derives the same exact anchor for confirmed and finalized source messages', () => {
    const confirmed = directMessage();
    const finalized = {
      ...confirmed,
      directV2: { ...confirmed.directV2!, finality: 'finalized' as const }
    };
    expect(getChatReplySourceAnchor(confirmed)).toBe(getChatReplySourceAnchor(finalized));
  });

  it('rejects a reused stable message ID when its canonical source event changed', () => {
    const original = directMessage();
    const anchor = getChatReplySourceAnchor(original)!;
    expect(chatReplyTargetMatchesAnchor({
      replyToMessageId: original.id,
      replyToMessageAnchor: anchor,
      candidate: original
    })).toBe(true);
    expect(chatReplyTargetMatchesAnchor({
      replyToMessageId: original.id,
      replyToMessageAnchor: anchor,
      candidate: directMessage(hash('4'))
    })).toBe(false);
  });

  it('keeps legacy ID-only replies compatible and rejects malformed anchors', () => {
    const candidate = directMessage();
    expect(chatReplyTargetMatchesAnchor({ replyToMessageId: candidate.id, candidate })).toBe(true);
    expect(() => normalizeChatReplySourceAnchor(hash('0'))).toThrow('non-zero bytes32');
    expect(() => normalizeChatReplySourceAnchor('0x1234')).toThrow('non-zero bytes32');
  });
});
