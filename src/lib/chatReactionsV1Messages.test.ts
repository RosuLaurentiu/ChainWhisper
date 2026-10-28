import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './appShared';
import type { ChatReactionObservation } from './chatReactionsV1';
import {
  collectChatReactionSources,
  getChatReactionMessageKey,
  getChatReactionSourceForMessage,
  getChatReactionWriteSourceForMessage,
  retainPendingChatReactionStates,
  summarizeChatReactionsV1
} from './chatReactionsV1Messages';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const hash = (pair: string) => `0x${pair.repeat(32)}`;
const ALICE = address('11');
const BOB = address('22');
const DIRECT = address('33');
const REACTIONS = address('44');
const CONVERSATION_ID = hash('55');

const message = (finality: 'confirmed' | 'finalized' = 'finalized'): ChatMessage => ({
  id: 'direct-v2-message',
  direction: 'incoming',
  text: 'hello',
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: '7082400',
    contractAddress: DIRECT,
    conversationId: CONVERSATION_ID,
    messageId: '7',
    epoch: '1',
    senderSequence: '1',
    nonce: hash('66').slice(0, 26),
    transactionHash: hash('77'),
    blockNumber: '100',
    blockHash: hash('88'),
    logIndex: 3,
    finality
  }
});

const state = ({
  reactor,
  emoji,
  emojiId,
  active
}: {
  reactor: string;
  emoji: ChatReactionObservation['emoji'];
  emojiId: number;
  active: boolean;
}): ChatReactionObservation => ({
  kind: 'direct',
  chainId: '7082400',
  reactionsContract: REACTIONS,
  targetContract: DIRECT,
  conversationId: CONVERSATION_ID,
  messageId: '7',
  reactor,
  emojiId,
  emoji,
  active,
  messageAnchor: hash('99'),
  blockHash: hash('aa'),
  blockNumber: '110',
  transactionHash: hash('bb'),
  transactionIndex: 0,
  logIndex: emojiId,
  removed: false,
  rawIdentity: `${reactor}:${emojiId}:${active}`,
  stateKey: `${reactor}:${emojiId}`
});

describe('ChatReactionsV1 message projection', () => {
  it('keeps canonical sources finalized while exposing confirmed anchors for writes', () => {
    expect(getChatReactionSourceForMessage(message('confirmed'))).toBeNull();
    expect(getChatReactionWriteSourceForMessage(message('confirmed'))).toMatchObject({
      kind: 'direct',
      conversationId: CONVERSATION_ID,
      messageId: '7',
      blockHash: hash('88'),
      transactionHash: hash('77'),
      logIndex: 3
    });
    expect(getChatReactionMessageKey(message('confirmed'))).toContain(CONVERSATION_ID);
    expect(getChatReactionSourceForMessage(message())).toMatchObject({
      kind: 'direct',
      conversationId: CONVERSATION_ID,
      messageId: '7',
      blockHash: hash('88'),
      transactionHash: hash('77'),
      logIndex: 3
    });
    expect(getChatReactionMessageKey(message())).toContain(CONVERSATION_ID);
  });

  it('keeps a confirmed receipt visible until its source message enters finalized history', () => {
    const pending = state({ reactor: ALICE, emoji: '👍', emojiId: 1, active: true });
    const pendingStates = new Map([[pending.stateKey, pending]]);
    const confirmedOnly = retainPendingChatReactionStates({
      pendingStates,
      finalizedSources: [],
      safeHeadBlock: pending.blockNumber
    });
    expect(confirmedOnly.get(pending.stateKey)).toBe(pending);

    const finalized = retainPendingChatReactionStates({
      pendingStates: confirmedOnly,
      finalizedSources: [getChatReactionSourceForMessage(message())!],
      safeHeadBlock: pending.blockNumber
    });
    expect(finalized.size).toBe(0);
  });

  it('deduplicates identical message sources and rejects reassigned stable IDs', () => {
    expect(collectChatReactionSources([message(), { ...message(), id: 'duplicate' }])).toHaveLength(1);
    const conflicting = message();
    conflicting.directV2 = { ...conflicting.directV2!, blockHash: hash('cc') };
    expect(() => collectChatReactionSources([message(), conflicting])).toThrow('conflicting');
  });

  it('summarizes only the latest active desired states by emoji and wallet', () => {
    const sourceKey = getChatReactionMessageKey(message());
    const summaries = summarizeChatReactionsV1([
      state({ reactor: ALICE, emoji: '👍', emojiId: 1, active: true }),
      state({ reactor: BOB, emoji: '👍', emojiId: 1, active: true }),
      state({ reactor: BOB, emoji: '🔥', emojiId: 6, active: false })
    ], ALICE);
    expect(summaries.get(sourceKey!)).toEqual([{
      emoji: '👍',
      count: 2,
      reactedByMe: true
    }]);
  });
});
