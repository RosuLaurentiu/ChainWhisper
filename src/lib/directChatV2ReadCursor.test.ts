import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './appShared';
import {
  DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
  advanceDirectChatV2ReadCursorToVisibleMessage,
  buildDirectChatV2ReadCursorStorageKey,
  countDirectChatV2UnreadMessages,
  createDirectChatV2ReadCursor,
  mergeDirectChatV2ReadCursors,
  parseDirectChatV2ReadCursor,
  serializeDirectChatV2ReadCursor
} from './directChatV2ReadCursor';

const CONTRACT = '0x1000000000000000000000000000000000000001';
const WALLET = '0x2000000000000000000000000000000000000002';
const OTHER_WALLET = '0x3000000000000000000000000000000000000003';
const CONVERSATION = `0x${'44'.repeat(32)}`;
const OTHER_CONVERSATION = `0x${'55'.repeat(32)}`;
const TX_HASH = `0x${'66'.repeat(32)}`;
const BLOCK_HASH = `0x${'77'.repeat(32)}`;
const NONCE = `0x${'88'.repeat(12)}`;
const SCOPE = {
  chainId: 7_082_400n,
  contractAddress: CONTRACT,
  walletAddress: WALLET,
  conversationId: CONVERSATION
};

const cursorAt = (messageId: bigint, blockHash = BLOCK_HASH) =>
  createDirectChatV2ReadCursor(SCOPE, {
    messageId,
    blockNumber: 100n + messageId,
    blockHash
  });

const message = ({
  messageId,
  direction = 'incoming',
  finality = 'finalized',
  conversationId = CONVERSATION
}: {
  messageId: bigint;
  direction?: ChatMessage['direction'];
  finality?: 'confirmed' | 'finalized';
  conversationId?: string;
}): ChatMessage => ({
  id: `direct-v2:${messageId}`,
  direction,
  text: `message ${messageId}`,
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: SCOPE.chainId.toString(),
    contractAddress: CONTRACT,
    conversationId,
    messageId: messageId.toString(),
    epoch: '1',
    senderSequence: messageId.toString(),
    nonce: NONCE,
    transactionHash: TX_HASH,
    blockNumber: (100n + messageId).toString(),
    blockHash: BLOCK_HASH,
    logIndex: 0,
    finality
  }
});

describe('directChatV2ReadCursor', () => {
  it('round-trips a JSON-safe cursor and derives a scope-isolated storage key', () => {
    const cursor = cursorAt(9n);
    const encoded = serializeDirectChatV2ReadCursor(cursor);

    expect(JSON.parse(encoded)).toEqual(cursor);
    expect(parseDirectChatV2ReadCursor(JSON.parse(encoded), SCOPE)).toEqual(cursor);
    expect(buildDirectChatV2ReadCursorStorageKey(SCOPE)).toContain(
      `${WALLET.toLowerCase()}:${CONVERSATION}`
    );
    expect(encoded).not.toContain('ciphertext');
    expect(encoded).not.toContain('key');
  });

  it('migrates a legacy cursor without a generation into generation zero', () => {
    const legacy = { ...cursorAt(3n) } as Record<string, unknown>;
    delete legacy.generation;

    expect(parseDirectChatV2ReadCursor(legacy, SCOPE)).toMatchObject({
      generation: 0,
      lastReadMessageId: '3'
    });
  });

  it('advances only to a finalized visible message in the same scope and never moves backward', () => {
    const initial = createDirectChatV2ReadCursor(SCOPE, 4, {
      messageId: 2n,
      blockNumber: 102n,
      blockHash: BLOCK_HASH
    });
    const unfinalized = advanceDirectChatV2ReadCursorToVisibleMessage({
      cursor: initial,
      scope: SCOPE,
      visibleMessage: message({ messageId: 5n, finality: 'confirmed' })
    });
    const advanced = advanceDirectChatV2ReadCursorToVisibleMessage({
      cursor: unfinalized,
      scope: SCOPE,
      visibleMessage: message({ messageId: 5n })
    });
    const unchanged = advanceDirectChatV2ReadCursorToVisibleMessage({
      cursor: advanced,
      scope: SCOPE,
      visibleMessage: message({ messageId: 3n })
    });

    expect(unfinalized.lastReadMessageId).toBe('2');
    expect(advanced.lastReadMessageId).toBe('5');
    expect(advanced.generation).toBe(4);
    expect(unchanged.lastReadMessageId).toBe('5');
  });

  it('merges only canonically anchored device cursors and resets an out-of-range cursor', async () => {
    const staleBlockHash = `0x${'99'.repeat(32)}`;
    const readCanonicalMessageAnchor = async (messageId: bigint) => ({
      messageId,
      blockNumber: 100n + messageId,
      blockHash: messageId === 12n ? staleBlockHash : BLOCK_HASH
    });
    const merged = await mergeDirectChatV2ReadCursors({
      scope: SCOPE,
      canonicalMessageCount: 20n,
      cursors: [
        cursorAt(8n),
        cursorAt(3n),
        cursorAt(12n)
      ],
      readCanonicalMessageAnchor
    });
    expect(merged.lastReadMessageId).toBe('8');

    const outOfRange = await mergeDirectChatV2ReadCursors({
      scope: SCOPE,
      canonicalMessageCount: 10n,
      cursors: [cursorAt(12n)],
      readCanonicalMessageAnchor: async () => null
    });
    expect(outOfRange.lastReadMessageId).toBe('0');

    await expect(mergeDirectChatV2ReadCursors({
      scope: SCOPE,
      canonicalMessageCount: 10n,
      cursors: [cursorAt(12n)],
      readCanonicalMessageAnchor
    })).rejects.toThrow('anchored message exceeds the message count');

    await expect(mergeDirectChatV2ReadCursors({
      scope: SCOPE,
      canonicalMessageCount: 20n,
      cursors: [
        createDirectChatV2ReadCursor(
          { ...SCOPE, walletAddress: OTHER_WALLET },
          { messageId: 13n, blockNumber: 113n, blockHash: BLOCK_HASH }
        )
      ],
      readCanonicalMessageAnchor
    })).rejects.toThrow('different wallet or conversation');
  });

  it('lets a newer empty reorg generation dominate a canonically valid stale cursor', async () => {
    const merged = await mergeDirectChatV2ReadCursors({
      scope: SCOPE,
      canonicalMessageCount: 8n,
      cursors: [
        createDirectChatV2ReadCursor(SCOPE, 1, {
          messageId: 8n,
          blockNumber: 108n,
          blockHash: BLOCK_HASH
        }),
        createDirectChatV2ReadCursor(SCOPE, 2)
      ],
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 100n + messageId,
        blockHash: BLOCK_HASH
      })
    });

    expect(merged).toMatchObject({ generation: 2, lastReadMessageId: '0' });
  });

  it('rejects a cursor whose public message ID and canonical block are valid but unrelated', async () => {
    const cursor = cursorAt(8n);
    const merged = await mergeDirectChatV2ReadCursors({
      scope: SCOPE,
      canonicalMessageCount: 8n,
      cursors: [cursor],
      readCanonicalMessageAnchor: async (messageId) => ({
        messageId,
        blockNumber: 107n,
        blockHash: BLOCK_HASH
      })
    });

    expect(merged.lastReadMessageId).toBe('0');
  });

  it('counts distinct finalized incoming V2 messages above the cursor only', () => {
    const cursor = cursorAt(2n);
    expect(countDirectChatV2UnreadMessages({
      cursor,
      scope: SCOPE,
      messages: [
        message({ messageId: 1n }),
        message({ messageId: 3n }),
        message({ messageId: 3n }),
        message({ messageId: 4n, direction: 'outgoing' }),
        message({ messageId: 5n, finality: 'confirmed' }),
        message({ messageId: 6n, conversationId: OTHER_CONVERSATION }),
        { id: 'legacy', direction: 'incoming', text: 'legacy' }
      ]
    })).toBe(1);
  });

  it('fails closed on malformed or noncanonical persisted values', () => {
    expect(() => parseDirectChatV2ReadCursor({
      schema: DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
      chainId: '07082400',
      contractAddress: CONTRACT,
      walletAddress: WALLET,
      conversationId: CONVERSATION,
      lastReadMessageId: '1',
      lastReadBlockNumber: '101',
      lastReadBlockHash: BLOCK_HASH
    })).toThrow('canonical decimal');
    expect(() => parseDirectChatV2ReadCursor({
      schema: DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
      chainId: SCOPE.chainId.toString(),
      contractAddress: CONTRACT,
      walletAddress: WALLET,
      conversationId: CONVERSATION,
      lastReadMessageId: '-1',
      lastReadBlockNumber: '101',
      lastReadBlockHash: BLOCK_HASH
    })).toThrow('canonical decimal');
    expect(() => parseDirectChatV2ReadCursor({
      schema: DIRECT_CHAT_V2_READ_CURSOR_SCHEMA,
      chainId: SCOPE.chainId.toString(),
      contractAddress: CONTRACT,
      walletAddress: WALLET,
      conversationId: CONVERSATION,
      lastReadMessageId: '1',
      lastReadBlockNumber: null,
      lastReadBlockHash: null
    })).toThrow('canonical decimal');
  });
});
