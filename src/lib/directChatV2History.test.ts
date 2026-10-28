import { describe, expect, it, vi } from 'vitest';
import {
  buildMessageWithReactionPayload,
  buildMessageWithReplyPayload,
  buildMessageWithTradeReferencePayload,
  type ChatMessage
} from './appShared';
import {
  buildDirectChatV2MessageKey,
  type DirectChatV2EpochKey,
  type DirectChatV2MessageEvent
} from './directChatV2Chain';
import {
  deriveDirectChatV2ConversationId,
  encryptDirectChatV2Message,
  type DirectChatV2MessageContext
} from './directChatV2Crypto';
import {
  DIRECT_CHAT_V2_DUAL_READ_DISABLED,
  clearDirectChatV2ConversationForReplay,
  createDirectChatV2HistoryCheckpoint,
  mapDecodedDirectChatV2HistoryEvent,
  normalizeDirectChatV2HistoryEvent,
  normalizeDirectChatV2HistoryEvents,
  planDirectChatV2HistoryPage,
  type DirectChatV2HistoryScope
} from './directChatV2History';
import { decodeDirectChatV2Payload, encodeDirectChatV2Payload } from './directChatV2Payload';
import { historyEntryToChatMessage } from './directConversationSyncHelpers';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const MALLORY = '0x3333333333333333333333333333333333333333';
const CHAT = '0x4444444444444444444444444444444444444444';
const CHAIN_ID = 7_089n;
const EPOCH = 2n;
const CONVERSATION_ID = deriveDirectChatV2ConversationId({
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  participantA: ALICE,
  participantB: BOB
});
const EPOCH_KEY = {
  value: 42n,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  epoch: EPOCH
} satisfies DirectChatV2EpochKey;
const SCOPE = {
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  deploymentBlock: 90n,
  conversationStartBlock: 100n
} satisfies DirectChatV2HistoryScope;

const makeEvent = async ({
  messageId,
  senderSequence,
  sender = ALICE,
  recipient = BOB,
  blockNumber = 110n,
  logIndex = 1,
  body = `message ${messageId}`,
  replyToMessageId,
  replyPreview
}: {
  messageId: bigint;
  senderSequence: bigint;
  sender?: string;
  recipient?: string;
  blockNumber?: bigint;
  logIndex?: number;
  body?: string;
  replyToMessageId?: bigint;
  replyPreview?: string;
}): Promise<DirectChatV2MessageEvent> => {
  const participantA = BigInt(sender) < BigInt(recipient) ? sender : recipient;
  const participantB = participantA === sender ? recipient : sender;
  const context = {
    chainId: CHAIN_ID,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    epoch: EPOCH,
    participantA,
    participantB,
    sender,
    recipient,
    senderSequence,
    valueSent: 0n,
    feeTaken: 0n
  } satisfies DirectChatV2MessageContext;
  const encrypted = await encryptDirectChatV2Message(
    encodeDirectChatV2Payload({ body, replyToMessageId, replyPreview }),
    EPOCH_KEY,
    context
  );
  const key = buildDirectChatV2MessageKey({
    chainId: CHAIN_ID,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    messageId
  });
  return {
    protocol: 'direct-v2',
    key,
    chainId: CHAIN_ID,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    messageId,
    epoch: EPOCH,
    senderSequence,
    sender,
    recipient,
    nonce: encrypted.nonce,
    aadHash: encrypted.aadHash,
    ciphertext: encrypted.ciphertext,
    valueSent: 0n,
    feeTaken: 0n,
    transactionHash: `0x${messageId.toString(16).padStart(64, '0')}`,
    blockHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
    blockNumber,
    logIndex,
    removed: false,
    context,
    encrypted
  };
};

describe('directChatV2History', () => {
  it('keeps dual-read inactive until an attested deployment is explicitly wired', () => {
    expect(DIRECT_CHAT_V2_DUAL_READ_DISABLED).toEqual({ enabled: false });
  });

  it('decrypts and maps a parsed event to a stable V2 history identity', async () => {
    const tradeReference = {
      version: 1 as const,
      tradeId: 42,
      escrowContract: '0x5555555555555555555555555555555555555555',
      terminalPath: '/otcdesk/terminal/l/ViAq'
    };
    const legacyCompatibleBody = buildMessageWithTradeReferencePayload(
      buildMessageWithReplyPayload(
        'hello from Alice',
        'legacy preview',
        `0x${'66'.repeat(32)}`,
        109,
        2
      ),
      tradeReference
    );
    const event = await makeEvent({
      messageId: 8n,
      senderSequence: 4n,
      body: legacyCompatibleBody,
      replyToMessageId: 3n,
      replyPreview: 'structured preview'
    });
    const resolveEpochKey = vi.fn(async () => EPOCH_KEY);

    const entry = await normalizeDirectChatV2HistoryEvent({
      event,
      viewerAddress: BOB,
      accountRole: 'owner',
      resolveEpochKey,
      finality: 'finalized',
      timestamp: 123
    });
    expect(entry).toMatchObject({
      id: buildDirectChatV2MessageKey({
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        messageId: 8n
      }),
      contact: ALICE,
      direction: 'incoming',
      text: 'hello from Alice',
      accountAddress: BOB,
      accountRole: 'owner',
      replyToMessageId: buildDirectChatV2MessageKey({
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        messageId: 3n
      }),
      replyToText: 'structured preview',
      replyToBlockNumber: 109,
      replyToLogIndex: 2,
      tradeReference: expect.objectContaining({ version: 1, tradeId: 42 }),
      txHash: event.transactionHash,
      blockNumber: 110,
      logIndex: 1,
      timestamp: 123,
      directV2: {
        protocol: 'direct-v2',
        contentState: 'available',
        chainId: CHAIN_ID.toString(),
        messageId: '8',
        epoch: EPOCH.toString(),
        senderSequence: '4',
        nonce: event.nonce,
        transactionHash: event.transactionHash,
        blockNumber: '110',
        blockHash: event.blockHash,
        logIndex: 1,
        finality: 'finalized'
      }
    });
    expect(JSON.parse(JSON.stringify(entry.directV2))).toEqual(entry.directV2);
    expect(historyEntryToChatMessage(entry, BOB).directV2).toEqual(entry.directV2);
    expect(resolveEpochKey).toHaveBeenCalledWith({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: EPOCH
    });
  });

  it('sorts a page and resolves one epoch key only once', async () => {
    const [later, earlier] = await Promise.all([
      makeEvent({ messageId: 2n, senderSequence: 2n, blockNumber: 112n }),
      makeEvent({ messageId: 1n, senderSequence: 1n, blockNumber: 111n })
    ]);
    const resolveEpochKey = vi.fn(async () => EPOCH_KEY);

    const normalized = await normalizeDirectChatV2HistoryEvents({
      events: [later, earlier],
      expectedPreviousMessageId: 0n,
      viewerAddress: ALICE,
      resolveEpochKey,
      finality: 'finalized',
      timestampByBlock: new Map([[111, 1_001], [112, 1_002]])
    });

    expect(normalized.entries.map((entry) => entry.directV2?.messageId)).toEqual(['1', '2']);
    expect(normalized.entries.map((entry) => entry.timestamp)).toEqual([1_001, 1_002]);
    expect(normalized.entries.every(
      (entry) => entry.direction === 'outgoing' && entry.contact === BOB
    )).toBe(true);
    expect(normalized).toMatchObject({
      previousMessageId: 0n,
      lastMessageId: 2n,
      nextMessageId: 3n
    });
    expect(resolveEpochKey).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy reaction fallback text but does not treat it as a V2 reaction', async () => {
    const event = await makeEvent({ messageId: 1n, senderSequence: 1n });
    const entry = mapDecodedDirectChatV2HistoryEvent({
      event,
      payload: {
        version: 1,
        body: buildMessageWithReactionPayload(
          `0x${'66'.repeat(32)}`,
          '\u{1F44D}',
          'visible fallback',
          109,
          2,
          true
        )
      },
      viewerAddress: BOB,
      finality: 'finalized'
    });

    expect(entry.text).toBe('visible fallback');
    expect(entry).not.toHaveProperty('reactionToTxHash');
    expect(entry).not.toHaveProperty('reactionToBlockNumber');
    expect(entry).not.toHaveProperty('reactionToLogIndex');
    expect(entry).not.toHaveProperty('reactionEmoji');
  });

  it('rejects a skipped message ID at a page boundary', async () => {
    const event = await makeEvent({ messageId: 4n, senderSequence: 1n });
    await expect(normalizeDirectChatV2HistoryEvents({
      events: [event],
      expectedPreviousMessageId: 2n,
      viewerAddress: ALICE,
      resolveEpochKey: async () => EPOCH_KEY,
      finality: 'finalized'
    })).rejects.toThrow('expected message 3 but received 4');
  });

  it('maps a session-decoded payload without resolving or decrypting its epoch again', async () => {
    const event = await makeEvent({ messageId: 5n, senderSequence: 3n, body: 'decoded once' });
    const payload = decodeDirectChatV2Payload(encodeDirectChatV2Payload({ body: 'decoded once' }));

    expect(mapDecodedDirectChatV2HistoryEvent({
      event,
      payload,
      viewerAddress: BOB,
      finality: 'finalized'
    })).toMatchObject({
      id: event.key,
      direction: 'incoming',
      contact: ALICE,
      text: 'decoded once',
      directV2: { messageId: '5', finality: 'finalized' }
    });
  });

  it('rejects foreign-wallet reads and invalidates a stale async read lease', async () => {
    const event = await makeEvent({ messageId: 1n, senderSequence: 1n });
    const resolver = vi.fn(async () => EPOCH_KEY);
    await expect(normalizeDirectChatV2HistoryEvent({
      event,
      viewerAddress: MALLORY,
      resolveEpochKey: resolver,
      finality: 'finalized'
    })).rejects.toThrow('outside the requested wallet scope');
    expect(resolver).not.toHaveBeenCalled();

    let current = true;
    await expect(normalizeDirectChatV2HistoryEvent({
      event,
      viewerAddress: ALICE,
      resolveEpochKey: async () => {
        current = false;
        return EPOCH_KEY;
      },
      finality: 'finalized',
      shouldContinue: () => current
    })).rejects.toThrow('read scope changed');
  });

  it('plans bounded safe-head pages and requires hash verification before resuming', () => {
    const first = planDirectChatV2HistoryPage({
      scope: SCOPE,
      latestBlock: 130n,
      confirmationDepth: 10n,
      maxBlockSpan: 8n
    });
    expect(first).toEqual({
      safeHead: 120n,
      fromBlock: 100n,
      toBlock: 107n,
      checkpointStatus: 'none',
      resetConversation: false,
      expectedPreviousMessageId: 0n,
      expectedNextMessageId: 1n
    });

    const checkpoint = createDirectChatV2HistoryCheckpoint({
      scope: SCOPE,
      blockNumber: 107n,
      blockHash: `0x${'aa'.repeat(32)}`,
      lastMessageId: 12n
    });
    expect(JSON.parse(JSON.stringify(checkpoint))).toEqual(checkpoint);
    expect(() => planDirectChatV2HistoryPage({
      scope: SCOPE,
      latestBlock: 130n,
      confirmationDepth: 10n,
      checkpoint
    })).toThrow('must be re-read');
    expect(planDirectChatV2HistoryPage({
      scope: SCOPE,
      latestBlock: 130n,
      confirmationDepth: 10n,
      maxBlockSpan: 8n,
      checkpoint,
      canonicalCheckpointBlockHash: checkpoint.blockHash
    })).toEqual({
      safeHead: 120n,
      fromBlock: 108n,
      toBlock: 115n,
      checkpointStatus: 'valid',
      resetConversation: false,
      expectedPreviousMessageId: 12n,
      expectedNextMessageId: 13n
    });
  });

  it('falls back to a conversation-only V2 replay on a checkpoint hash mismatch', () => {
    const checkpoint = createDirectChatV2HistoryCheckpoint({
      scope: SCOPE,
      blockNumber: 107n,
      blockHash: `0x${'aa'.repeat(32)}`,
      lastMessageId: 12n
    });
    expect(planDirectChatV2HistoryPage({
      scope: SCOPE,
      latestBlock: 130n,
      confirmationDepth: 10n,
      maxBlockSpan: 8n,
      checkpoint,
      canonicalCheckpointBlockHash: `0x${'bb'.repeat(32)}`
    })).toEqual({
      safeHead: 120n,
      fromBlock: 100n,
      toBlock: 107n,
      checkpointStatus: 'reorg',
      resetConversation: true,
      expectedPreviousMessageId: 0n,
      expectedNextMessageId: 1n
    });

    const v2Identity = {
      protocol: 'direct-v2' as const,
      contentState: 'available' as const,
      chainId: CHAIN_ID.toString(),
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      messageId: '1',
      epoch: EPOCH.toString(),
      senderSequence: '1',
      nonce: `0x${'01'.repeat(12)}`,
      transactionHash: `0x${'bb'.repeat(32)}`,
      blockNumber: '107',
      blockHash: `0x${'aa'.repeat(32)}`,
      logIndex: 1,
      finality: 'finalized' as const
    };
    const legacy = { id: 'chatgc:legacy', direction: 'incoming', text: 'keep me' } satisfies ChatMessage;
    const otherConversation = {
      id: 'direct-v2:other',
      direction: 'incoming',
      text: 'also keep me',
      directV2: { ...v2Identity, conversationId: `0x${'cc'.repeat(32)}` }
    } satisfies ChatMessage;
    const matching = {
      id: 'direct-v2:matching',
      direction: 'incoming',
      text: 'replay me',
      directV2: v2Identity
    } satisfies ChatMessage;

    const next = clearDirectChatV2ConversationForReplay(
      { [BOB.toLowerCase()]: [legacy, otherConversation, matching] },
      SCOPE
    );
    expect(next[BOB.toLowerCase()].map((message) => message.id)).toEqual([
      'chatgc:legacy',
      'direct-v2:other'
    ]);
  });

  it('replays when a formerly finalized checkpoint is above the current safe head', () => {
    const checkpoint = createDirectChatV2HistoryCheckpoint({
      scope: SCOPE,
      blockNumber: 110n,
      blockHash: `0x${'aa'.repeat(32)}`,
      lastMessageId: 12n
    });

    expect(planDirectChatV2HistoryPage({
      scope: SCOPE,
      latestBlock: 115n,
      confirmationDepth: 10n,
      maxBlockSpan: 8n,
      checkpoint,
      canonicalCheckpointBlockHash: checkpoint.blockHash
    })).toEqual({
      safeHead: 105n,
      fromBlock: 100n,
      toBlock: 105n,
      checkpointStatus: 'reorg',
      resetConversation: true,
      expectedPreviousMessageId: 0n,
      expectedNextMessageId: 1n
    });
  });
});
