import { describe, expect, it } from 'vitest';
import type { ChatMessage, HistoryEntry } from './appShared';
import { buildDirectChatV2MessageKey } from './directChatV2Chain';
import {
  createDirectChatV2HistoryCheckpoint,
  type DirectChatV2HistoryScope
} from './directChatV2History';
import {
  buildDirectChatV2HistoryMemoryScopeKey,
  createDirectChatV2HistoryMemoryState,
  getDirectChatV2HistoryMemoryRevision,
  reduceDirectChatV2HistoryMemorySync,
  selectDirectChatV2MemoryBackedCheckpoint
} from './directChatV2HistoryMemory';
import type { DirectChatV2SyncResult } from './directChatV2SyncCoordinator';

const CHAIN_ID = 7_082_400n;
const CHAT = '0x1000000000000000000000000000000000000001';
const ALICE = '0x2000000000000000000000000000000000000002';
const BOB = '0x3000000000000000000000000000000000000003';
const CONVERSATION_ID = `0x${'44'.repeat(32)}`;
const BLOCK_HASH = `0x${'55'.repeat(32)}`;
const TX_HASH = `0x${'66'.repeat(32)}`;
const SCOPE: DirectChatV2HistoryScope = {
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  deploymentBlock: 90n,
  conversationStartBlock: 100n
};

const checkpointAt = (lastMessageId: bigint) => createDirectChatV2HistoryCheckpoint({
  scope: SCOPE,
  blockNumber: 110n,
  blockHash: BLOCK_HASH,
  lastMessageId
});

const finalizedMessage = ({
  accountAddress = ALICE,
  blockNumber = 105n,
  chainId = CHAIN_ID,
  conversationId = CONVERSATION_ID,
  finality = 'finalized',
  messageId = 3n
}: {
  accountAddress?: string;
  blockNumber?: bigint;
  chainId?: bigint;
  conversationId?: string;
  finality?: 'confirmed' | 'finalized';
  messageId?: bigint;
} = {}): ChatMessage => ({
  id: buildDirectChatV2MessageKey({
    chainId,
    contractAddress: CHAT,
    conversationId,
    messageId
  }),
  direction: 'incoming',
  text: 'memory only',
  accountAddress,
  directV2: {
    protocol: 'direct-v2',
    contentState: 'available',
    chainId: chainId.toString(),
    contractAddress: CHAT,
    conversationId,
    messageId: messageId.toString(),
    epoch: '1',
    senderSequence: messageId.toString(),
    nonce: `0x${'77'.repeat(12)}`,
    transactionHash: TX_HASH,
    blockNumber: blockNumber.toString(),
    blockHash: BLOCK_HASH,
    logIndex: 0,
    finality
  }
});

const finalizedProjection = (lastMessageId = 3n): ChatMessage[] => {
  const messages: ChatMessage[] = [];
  for (let messageId = 1n; messageId <= lastMessageId; messageId += 1n) {
    messages.push(finalizedMessage({ messageId }));
  }
  return messages;
};

const historyEntry = (message: ChatMessage = finalizedMessage()): HistoryEntry => ({
  id: message.id,
  contact: BOB,
  direction: message.direction,
  text: message.text,
  accountAddress: message.accountAddress,
  txHash: message.directV2?.transactionHash ?? TX_HASH,
  blockNumber: Number(message.directV2?.blockNumber ?? 105),
  logIndex: message.directV2?.logIndex ?? 0,
  directV2: message.directV2
});

const syncResult = ({
  checkpoint = checkpointAt(3n),
  entries = finalizedProjection().map((message) => historyEntry(message)),
  expectedPreviousMessageId = 0n,
  reorged = false,
  resetConversation = false,
  scope = SCOPE,
  viewerAddress = ALICE
}: {
  checkpoint?: ReturnType<typeof checkpointAt>;
  entries?: HistoryEntry[];
  expectedPreviousMessageId?: bigint;
  reorged?: boolean;
  resetConversation?: boolean;
  scope?: DirectChatV2HistoryScope;
  viewerAddress?: string;
} = {}): DirectChatV2SyncResult => ({
  status: entries.length > 0 ? 'page-applied' : reorged ? 'reorg-reset' : 'up-to-date',
  messagesByContact: {},
  checkpoint,
  hasMore: false,
  reorged,
  appliedEntries: entries.length,
  unavailableEntries: 0,
  mutation: {
    scope,
    viewerAddress,
    resetConversation,
    entries
  },
  page: entries.length > 0 ? {
    fromBlock: 100n,
    toBlock: 110n,
    expectedPreviousMessageId,
    lastMessageId: BigInt(checkpoint.lastMessageId)
  } : undefined
});

describe('directChatV2HistoryMemory', () => {
  it('retains a nonzero checkpoint only when every finalized message through it is in wallet-scoped memory', () => {
    const checkpoint = checkpointAt(3n);
    const messagesByContact = { [BOB.toLowerCase()]: finalizedProjection() };

    expect(selectDirectChatV2MemoryBackedCheckpoint({
      checkpoint,
      messagesByContact,
      scope: SCOPE,
      walletAddress: ALICE
    })).toBe(checkpoint);
  });

  it('forces a conversation-start replay when memory is empty or does not contain the checkpoint message', () => {
    const checkpoint = checkpointAt(3n);

    expect(selectDirectChatV2MemoryBackedCheckpoint({
      checkpoint,
      messagesByContact: {},
      scope: SCOPE,
      walletAddress: ALICE
    })).toBeUndefined();
    expect(selectDirectChatV2MemoryBackedCheckpoint({
      checkpoint,
      messagesByContact: { [BOB.toLowerCase()]: [finalizedMessage({ messageId: 2n })] },
      scope: SCOPE,
      walletAddress: ALICE
    })).toBeUndefined();
  });

  it('forces a conversation-start replay when the in-memory projection has an interior ID hole', () => {
    const checkpoint = checkpointAt(3n);
    expect(selectDirectChatV2MemoryBackedCheckpoint({
      checkpoint,
      messagesByContact: {
        [BOB.toLowerCase()]: [
          finalizedMessage({ messageId: 1n }),
          finalizedMessage({ messageId: 3n })
        ]
      },
      scope: SCOPE,
      walletAddress: ALICE
    })).toBeUndefined();
  });

  it('rejects confirmed, future-block, foreign-wallet, and foreign-scope memory rows', () => {
    const checkpoint = checkpointAt(3n);
    const candidates = [
      finalizedMessage({ finality: 'confirmed' }),
      finalizedMessage({ blockNumber: 111n }),
      finalizedMessage({ accountAddress: BOB }),
      finalizedMessage({ chainId: 1n }),
      finalizedMessage({ conversationId: `0x${'99'.repeat(32)}` })
    ];

    for (const candidate of candidates) {
      expect(selectDirectChatV2MemoryBackedCheckpoint({
        checkpoint,
        messagesByContact: {
          [BOB.toLowerCase()]: [...finalizedProjection(2n), candidate]
        },
        scope: SCOPE,
        walletAddress: ALICE
      })).toBeUndefined();
    }
  });

  it('allows a zero-message checkpoint without persisting or inventing message backing', () => {
    const checkpoint = checkpointAt(0n);
    expect(selectDirectChatV2MemoryBackedCheckpoint({
      checkpoint,
      messagesByContact: {},
      scope: SCOPE,
      walletAddress: ALICE
    })).toBe(checkpoint);
  });

  it('fails closed to full replay for malformed or differently scoped checkpoints', () => {
    const checkpoint = checkpointAt(3n);
    expect(selectDirectChatV2MemoryBackedCheckpoint({
      checkpoint: { ...checkpoint, lastMessageId: '03' },
      messagesByContact: { [BOB.toLowerCase()]: finalizedProjection() },
      scope: SCOPE,
      walletAddress: ALICE
    })).toBeUndefined();
    expect(selectDirectChatV2MemoryBackedCheckpoint({
      checkpoint: { ...checkpoint, conversationId: `0x${'aa'.repeat(32)}` },
      messagesByContact: { [BOB.toLowerCase()]: finalizedProjection() },
      scope: SCOPE,
      walletAddress: ALICE
    })).toBeUndefined();
  });

  it('commits the message mutation and its backed checkpoint in one memory-state return', () => {
    const previous = createDirectChatV2HistoryMemoryState({
      [BOB.toLowerCase()]: [{ id: 'legacy', direction: 'incoming', text: 'legacy remains' }]
    });
    const next = reduceDirectChatV2HistoryMemorySync({
      previous,
      result: syncResult(),
      scope: SCOPE,
      walletAddress: ALICE,
      expectedRevision: getDirectChatV2HistoryMemoryRevision({
        state: previous,
        scope: SCOPE,
        walletAddress: ALICE
      })
    });
    const scopeKey = buildDirectChatV2HistoryMemoryScopeKey({ scope: SCOPE, walletAddress: ALICE });

    const committedTexts = next.messagesByContact[BOB.toLowerCase()].map((message) => message.text);
    expect(committedTexts).toHaveLength(4);
    expect(committedTexts).toEqual(expect.arrayContaining(['legacy remains', 'memory only']));
    expect(next.checkpointsByScope[scopeKey]).toEqual(checkpointAt(3n));
    expect(previous.messagesByContact[BOB.toLowerCase()]).toHaveLength(1);
    expect(previous.checkpointsByScope).toEqual({});
  });

  it('atomically clears only the reorged V2 scope and its checkpoint while retaining unrelated memory', () => {
    const otherScope = { ...SCOPE, conversationId: `0x${'aa'.repeat(32)}` };
    const targetKey = buildDirectChatV2HistoryMemoryScopeKey({ scope: SCOPE, walletAddress: ALICE });
    const otherKey = buildDirectChatV2HistoryMemoryScopeKey({ scope: otherScope, walletAddress: ALICE });
    const targetMessage = finalizedMessage();
    const otherMessage = finalizedMessage({ conversationId: otherScope.conversationId });
    const previous = {
      messagesByContact: {
        [BOB.toLowerCase()]: [
          { id: 'legacy', direction: 'incoming' as const, text: 'legacy remains' },
          targetMessage,
          otherMessage
        ]
      },
      checkpointsByScope: {
        [targetKey]: checkpointAt(3n),
        [otherKey]: createDirectChatV2HistoryCheckpoint({
          scope: otherScope,
          blockNumber: 110n,
          blockHash: BLOCK_HASH,
          lastMessageId: 3n
        })
      },
      revisionsByScope: {}
    };
    const next = reduceDirectChatV2HistoryMemorySync({
      previous,
      result: syncResult({
        checkpoint: undefined,
        entries: [],
        reorged: true,
        resetConversation: true
      }),
      scope: SCOPE,
      walletAddress: ALICE,
      expectedRevision: 0
    });

    expect(next.messagesByContact[BOB.toLowerCase()].map((message) => message.id)).toEqual([
      'legacy',
      otherMessage.id
    ]);
    expect(next.checkpointsByScope[targetKey]).toBeUndefined();
    expect(next.checkpointsByScope[otherKey]).toEqual(previous.checkpointsByScope[otherKey]);
    expect(next.revisionsByScope[targetKey]).toBe(1);
    expect(getDirectChatV2HistoryMemoryRevision({
      state: next,
      scope: SCOPE,
      walletAddress: ALICE
    })).toBe(1);
  });

  it('rejects a foreign mutation without partially changing either memory field', () => {
    const previous = createDirectChatV2HistoryMemoryState();
    expect(() => reduceDirectChatV2HistoryMemorySync({
      previous,
      result: syncResult({ viewerAddress: BOB }),
      scope: SCOPE,
      walletAddress: ALICE,
      expectedRevision: 0
    })).toThrow('different memory scope');
    expect(previous).toEqual(createDirectChatV2HistoryMemoryState());
  });

  it('rejects a reorg result that does not carry the coordinator scoped-reset mutation', () => {
    const previous = createDirectChatV2HistoryMemoryState();
    expect(() => reduceDirectChatV2HistoryMemorySync({
      previous,
      result: syncResult({ reorged: true, resetConversation: false }),
      scope: SCOPE,
      walletAddress: ALICE,
      expectedRevision: 0
    })).toThrow('must include its scoped memory reset mutation');
    expect(previous).toEqual(createDirectChatV2HistoryMemoryState());
  });

  it('rejects a delayed pre-reset page even when its message IDs become plausible again', () => {
    const targetKey = buildDirectChatV2HistoryMemoryScopeKey({ scope: SCOPE, walletAddress: ALICE });
    const beforeReset = {
      messagesByContact: { [BOB.toLowerCase()]: finalizedProjection() },
      checkpointsByScope: { [targetKey]: checkpointAt(3n) },
      revisionsByScope: {}
    };
    const afterReset = reduceDirectChatV2HistoryMemorySync({
      previous: beforeReset,
      result: syncResult({ entries: [], reorged: true, resetConversation: true }),
      scope: SCOPE,
      walletAddress: ALICE,
      expectedRevision: 0
    });
    const delayedMessage = finalizedMessage({ messageId: 4n });
    const delayedCheckpoint = checkpointAt(4n);
    const delayedPage = syncResult({
      checkpoint: delayedCheckpoint,
      entries: [historyEntry(delayedMessage)],
      expectedPreviousMessageId: 3n
    });

    expect(() => reduceDirectChatV2HistoryMemorySync({
      previous: afterReset,
      result: delayedPage,
      scope: SCOPE,
      walletAddress: ALICE,
      expectedRevision: 0
    })).toThrow('stale memory revision');
    expect(afterReset.messagesByContact[BOB.toLowerCase()]).toBeUndefined();
    expect(afterReset.checkpointsByScope[targetKey]).toBeUndefined();
    expect(afterReset.revisionsByScope[targetKey]).toBe(1);
  });
});
