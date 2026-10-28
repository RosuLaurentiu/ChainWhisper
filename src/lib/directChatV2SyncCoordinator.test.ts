import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './appShared';
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
  DIRECT_CHAT_V2_UNAVAILABLE_MESSAGE_TEXT,
  DIRECT_CHAT_V2_DUAL_READ_DISABLED,
  createDirectChatV2HistoryCheckpoint,
  mapDecodedDirectChatV2HistoryEvent,
  type DirectChatV2HistoryScope
} from './directChatV2History';
import { historyEntryToChatMessage } from './directConversationSyncHelpers';
import { encodeDirectChatV2Payload } from './directChatV2Payload';
import {
  applyDirectChatV2SyncMutation,
  syncDirectChatV2HistoryPage,
  type DirectChatV2CanonicalBlock,
  type DirectChatV2SyncDependencies
} from './directChatV2SyncCoordinator';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CHAT = '0x4444444444444444444444444444444444444444';
const CHAIN_ID = 7_089n;
const EPOCH = 1n;
const CONVERSATION_ID = deriveDirectChatV2ConversationId({
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  participantA: ALICE,
  participantB: BOB
});
const SCOPE = {
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  deploymentBlock: 90n,
  conversationStartBlock: 100n
} satisfies DirectChatV2HistoryScope;
const EPOCH_KEY = {
  value: 42n,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  epoch: EPOCH
} satisfies DirectChatV2EpochKey;
const CONFIG = {
  enabled: true as const,
  confirmationDepth: 0n,
  maxBlockSpan: 11n
};

const hashFor = (value: number): string => `0x${value.toString(16).padStart(64, '0')}`;

const makeEvent = async ({
  messageId,
  blockNumber,
  blockHash,
  body = `message ${messageId}`
}: {
  messageId: bigint;
  blockNumber: bigint;
  blockHash: string;
  body?: string;
}): Promise<DirectChatV2MessageEvent> => {
  const context = {
    chainId: CHAIN_ID,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    epoch: EPOCH,
    participantA: ALICE,
    participantB: BOB,
    sender: ALICE,
    recipient: BOB,
    senderSequence: messageId,
    valueSent: 0n,
    feeTaken: 0n
  } satisfies DirectChatV2MessageContext;
  const encrypted = await encryptDirectChatV2Message(
    encodeDirectChatV2Payload({ body }),
    EPOCH_KEY,
    context
  );
  return {
    protocol: 'direct-v2',
    key: buildDirectChatV2MessageKey({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      messageId
    }),
    chainId: CHAIN_ID,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    messageId,
    epoch: EPOCH,
    senderSequence: messageId,
    sender: ALICE,
    recipient: BOB,
    nonce: encrypted.nonce,
    aadHash: encrypted.aadHash,
    ciphertext: encrypted.ciphertext,
    valueSent: 0n,
    feeTaken: 0n,
    transactionHash: hashFor(1_000 + Number(messageId)),
    blockHash,
    blockNumber,
    logIndex: Number(messageId),
    removed: false,
    context,
    encrypted
  };
};

const makeDependencies = ({
  latestBlock = 110n,
  blocks,
  events = [],
  messageCount = BigInt(events.length)
}: {
  latestBlock?: bigint;
  blocks: DirectChatV2CanonicalBlock[];
  events?: DirectChatV2MessageEvent[];
  messageCount?: bigint;
}) => {
  const blocksByNumber = new Map(blocks.map((block) => [block.number.toString(), block]));
  const dependencies = {
    getLatestBlockNumber: vi.fn(async () => latestBlock),
    readCanonicalBlock: vi.fn(async (_chainId: bigint, blockNumber: bigint) =>
      blocksByNumber.get(blockNumber.toString()) ?? null
    ),
    readMessagePage: vi.fn(async () => events),
    readConversationMessageCountAtBlock: vi.fn(async () => messageCount),
    resolveEpochKey: vi.fn(async () => EPOCH_KEY),
    clearEpochKeys: vi.fn()
  } satisfies DirectChatV2SyncDependencies;
  return dependencies;
};

const legacyMessage = (): ChatMessage => ({
  id: 'chatgc:legacy',
  direction: 'incoming',
  text: 'legacy remains',
  blockNumber: 90,
  logIndex: 1
});

describe('directChatV2SyncCoordinator', () => {
  it('does nothing and calls no injected dependency while dual-read is disabled', async () => {
    const previous = { [BOB.toLowerCase()]: [legacyMessage()] };
    const dependencies = makeDependencies({ blocks: [] });

    await expect(syncDirectChatV2HistoryPage({
      config: DIRECT_CHAT_V2_DUAL_READ_DISABLED,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: previous,
      dependencies
    })).resolves.toEqual({
      status: 'disabled',
      messagesByContact: previous,
      checkpoint: undefined,
      hasMore: false,
      reorged: false,
      appliedEntries: 0,
      unavailableEntries: 0
    });
    expect(dependencies.getLatestBlockNumber).not.toHaveBeenCalled();
    expect(dependencies.readMessagePage).not.toHaveBeenCalled();
  });

  it('proves, decrypts, and atomically merges one complete safe-head page', async () => {
    const block105 = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const block108 = { number: 108n, hash: hashFor(108), timestamp: 1_008 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const events = await Promise.all([
      makeEvent({ messageId: 1n, blockNumber: 105n, blockHash: block105.hash }),
      makeEvent({ messageId: 2n, blockNumber: 108n, blockHash: block108.hash })
    ]);
    const dependencies = makeDependencies({ blocks: [block105, block108, boundary], events });
    const previous = { [BOB.toLowerCase()]: [legacyMessage()] };

    const result = await syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      accountRole: 'owner',
      previousMessages: previous,
      dependencies
    });

    expect(result).toMatchObject({
      status: 'page-applied',
      checkpoint: {
        blockNumber: '110',
        blockHash: boundary.hash,
        lastMessageId: '2'
      },
      safeHead: 110n,
      hasMore: false,
      reorged: false,
      appliedEntries: 2,
      unavailableEntries: 0,
      page: {
        fromBlock: 100n,
        toBlock: 110n,
        expectedPreviousMessageId: 0n,
        lastMessageId: 2n
      }
    });
    expect(result.messagesByContact[BOB.toLowerCase()].map((message) => message.id)).toEqual([
      'chatgc:legacy',
      events[0].key,
      events[1].key
    ]);
    expect(result.messagesByContact[BOB.toLowerCase()].slice(1).map((message) => message.timestamp)).toEqual([
      1_005,
      1_008
    ]);
    expect(dependencies.resolveEpochKey).toHaveBeenCalledOnce();
    expect(dependencies.readCanonicalBlock.mock.calls.filter(([, block]) => block === 110n)).toHaveLength(2);
    expect(dependencies.readConversationMessageCountAtBlock).toHaveBeenCalledWith({
      scope: SCOPE,
      blockNumber: 110n
    });
  });

  it('promotes a receipt-confirmed row when its block becomes safe without another message', async () => {
    const block104 = { number: 104n, hash: hashFor(104), timestamp: 1_004 };
    const block105 = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const block106 = { number: 106n, hash: hashFor(106), timestamp: 1_006 };
    const body = 'receipt-confirmed image or text';
    const event = await makeEvent({
      messageId: 1n,
      blockNumber: block105.number,
      blockHash: block105.hash,
      body
    });
    const receiptMessage = {
      ...historyEntryToChatMessage(mapDecodedDirectChatV2HistoryEvent({
        event,
        payload: { version: 1, body },
        viewerAddress: ALICE,
        accountRole: 'owner',
        finality: 'confirmed',
        timestamp: block105.timestamp
      }), ALICE),
      deliveryState: 'sent' as const
    } satisfies ChatMessage;
    const previous = { [BOB.toLowerCase()]: [receiptMessage] };
    const dependencies = makeDependencies({
      latestBlock: 111n,
      blocks: [block104, block105, block106],
      events: [event]
    });
    dependencies.getLatestBlockNumber.mockResolvedValueOnce(109n);
    dependencies.readMessagePage.mockResolvedValueOnce([]);
    dependencies.readConversationMessageCountAtBlock.mockResolvedValueOnce(0n);
    const config = { ...CONFIG, confirmationDepth: 5n };

    const beforeSafe = await syncDirectChatV2HistoryPage({
      config,
      scope: SCOPE,
      viewerAddress: ALICE,
      accountRole: 'owner',
      previousMessages: previous,
      dependencies
    });
    const beforeMessages = applyDirectChatV2SyncMutation(previous, beforeSafe.mutation!);
    expect(beforeSafe.safeHead).toBe(104n);
    expect(beforeSafe.appliedEntries).toBe(0);
    expect(beforeMessages[BOB.toLowerCase()]).toEqual([receiptMessage]);
    expect(beforeMessages[BOB.toLowerCase()][0].directV2?.finality).toBe('confirmed');

    const afterSafe = await syncDirectChatV2HistoryPage({
      config,
      scope: SCOPE,
      viewerAddress: ALICE,
      accountRole: 'owner',
      previousMessages: beforeMessages,
      checkpoint: beforeSafe.checkpoint,
      dependencies
    });
    const messages = applyDirectChatV2SyncMutation(beforeMessages, afterSafe.mutation!)[BOB.toLowerCase()];
    expect(afterSafe.safeHead).toBe(106n);
    expect(afterSafe.page).toMatchObject({ fromBlock: 105n, toBlock: 106n, lastMessageId: 1n });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: receiptMessage.id,
      text: body,
      direction: 'outgoing',
      txHash: receiptMessage.txHash,
      directV2: { ...receiptMessage.directV2, finality: 'finalized' }
    });
    expect(previous[BOB.toLowerCase()][0].directV2?.finality).toBe('confirmed');
  });

  it('fails before key recovery when a provider truncates the page', async () => {
    const block105 = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const first = await makeEvent({ messageId: 1n, blockNumber: 105n, blockHash: block105.hash });
    const dependencies = makeDependencies({
      blocks: [block105, boundary],
      events: [first],
      messageCount: 2n
    });

    await expect(syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: { [BOB.toLowerCase()]: [legacyMessage()] },
      dependencies
    })).rejects.toThrow('history page is incomplete');
    expect(dependencies.resolveEpochKey).not.toHaveBeenCalled();
  });

  it('advances an empty bounded page and reports that the safe head has more work', async () => {
    const boundary = { number: 104n, hash: hashFor(104), timestamp: 1_004 };
    const dependencies = makeDependencies({
      latestBlock: 110n,
      blocks: [boundary],
      events: [],
      messageCount: 0n
    });

    const result = await syncDirectChatV2HistoryPage({
      config: { enabled: true, confirmationDepth: 0n, maxBlockSpan: 5n },
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: {},
      dependencies
    });

    expect(result).toMatchObject({
      status: 'page-applied',
      checkpoint: { blockNumber: '104', lastMessageId: '0' },
      hasMore: true,
      appliedEntries: 0,
      page: { fromBlock: 100n, toBlock: 104n }
    });
    expect(dependencies.resolveEpochKey).not.toHaveBeenCalled();
  });

  it('rejects noncontiguous message IDs even when the event count looks complete', async () => {
    const block105 = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const block108 = { number: 108n, hash: hashFor(108), timestamp: 1_008 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const events = await Promise.all([
      makeEvent({ messageId: 1n, blockNumber: 105n, blockHash: block105.hash }),
      makeEvent({ messageId: 3n, blockNumber: 108n, blockHash: block108.hash })
    ]);
    const dependencies = makeDependencies({
      blocks: [block105, block108, boundary],
      events,
      messageCount: 2n
    });

    await expect(syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: {},
      dependencies
    })).rejects.toThrow('expected message 2 but received 3');
  });

  it('clears only the reorged V2 conversation and replays it from the conversation start block', async () => {
    const checkpoint = createDirectChatV2HistoryCheckpoint({
      scope: SCOPE,
      blockNumber: 104n,
      blockHash: hashFor(9_104),
      lastMessageId: 1n
    });
    const currentCheckpointBlock = { number: 104n, hash: hashFor(104), timestamp: 1_004 };
    const messageBlock = { number: 106n, hash: hashFor(106), timestamp: 1_006 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const event = await makeEvent({
      messageId: 1n,
      blockNumber: 106n,
      blockHash: messageBlock.hash,
      body: 'canonical replacement'
    });
    const dependencies = makeDependencies({
      blocks: [currentCheckpointBlock, messageBlock, boundary],
      events: [event],
      messageCount: 1n
    });
    const staleV2 = {
      id: event.key,
      direction: 'outgoing' as const,
      text: 'orphaned message',
      directV2: {
        protocol: 'direct-v2' as const,
        contentState: 'available' as const,
        chainId: CHAIN_ID.toString(),
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        messageId: '1',
        epoch: '1',
        senderSequence: '1',
        nonce: `0x${'01'.repeat(12)}`,
        transactionHash: hashFor(7_001),
        blockNumber: '103',
        blockHash: hashFor(9_103),
        logIndex: 1,
        finality: 'finalized' as const
      }
    } satisfies ChatMessage;

    const result = await syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: { [BOB.toLowerCase()]: [legacyMessage(), staleV2] },
      checkpoint,
      dependencies
    });

    expect(result.reorged).toBe(true);
    expect(result.checkpoint).toMatchObject({ blockNumber: '110', lastMessageId: '1' });
    expect(result.messagesByContact[BOB.toLowerCase()].map((message) => message.text)).toEqual([
      'legacy remains',
      'canonical replacement'
    ]);
    expect(dependencies.clearEpochKeys).toHaveBeenCalledOnce();

    const concurrentLegacy = {
      id: 'chatgc:arrived-during-replay',
      direction: 'incoming' as const,
      text: 'concurrent legacy row'
    } satisfies ChatMessage;
    const committedTexts = applyDirectChatV2SyncMutation(
      { [BOB.toLowerCase()]: [legacyMessage(), staleV2, concurrentLegacy] },
      result.mutation!
    )[BOB.toLowerCase()].map((message) => message.text);
    expect(committedTexts).toHaveLength(3);
    expect(committedTexts).toEqual(expect.arrayContaining([
      'legacy remains',
      'concurrent legacy row',
      'canonical replacement'
    ]));
  });

  it('advances past one undecryptable event without hiding later messages', async () => {
    const block105 = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const block106 = { number: 106n, hash: hashFor(106), timestamp: 1_006 };
    const block107 = { number: 107n, hash: hashFor(107), timestamp: 1_007 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const [first, corruptSource, third] = await Promise.all([
      makeEvent({ messageId: 1n, blockNumber: 105n, blockHash: block105.hash }),
      makeEvent({ messageId: 2n, blockNumber: 106n, blockHash: block106.hash }),
      makeEvent({ messageId: 3n, blockNumber: 107n, blockHash: block107.hash })
    ]);
    const corruptCiphertext = `0x${'00'.repeat(16)}`;
    const corrupt = {
      ...corruptSource,
      ciphertext: corruptCiphertext,
      encrypted: { ...corruptSource.encrypted, ciphertext: corruptCiphertext }
    };
    const dependencies = makeDependencies({
      blocks: [block105, block106, block107, boundary],
      events: [first, corrupt, third],
      messageCount: 3n
    });

    const result = await syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: {},
      dependencies
    });

    const messages = result.messagesByContact[BOB.toLowerCase()];
    expect(messages.map((message) => message.text)).toEqual([
      'message 1',
      DIRECT_CHAT_V2_UNAVAILABLE_MESSAGE_TEXT,
      'message 3'
    ]);
    expect(messages.map((message) => message.directV2?.contentState)).toEqual([
      'available',
      'unavailable',
      'available'
    ]);
    expect(messages[1].directV2).toMatchObject({
      messageId: '2',
      transactionHash: corrupt.transactionHash,
      blockNumber: corrupt.blockNumber.toString(),
      blockHash: corrupt.blockHash,
      logIndex: corrupt.logIndex,
      finality: 'finalized'
    });
    expect(result).toMatchObject({
      appliedEntries: 3,
      unavailableEntries: 1,
      checkpoint: { lastMessageId: '3' },
      page: { lastMessageId: 3n }
    });
    expect(dependencies.resolveEpochKey).toHaveBeenCalledOnce();
  });

  it('does not checkpoint or substitute content when epoch-key resolution fails', async () => {
    const messageBlock = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const event = await makeEvent({
      messageId: 1n,
      blockNumber: 105n,
      blockHash: messageBlock.hash
    });
    const dependencies = makeDependencies({ blocks: [messageBlock, boundary], events: [event] });
    dependencies.resolveEpochKey.mockRejectedValueOnce(new Error('local COTI key unavailable'));

    await expect(syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: {},
      dependencies
    })).rejects.toThrow('local COTI key unavailable');
    expect(dependencies.clearEpochKeys).not.toHaveBeenCalled();
  });

  it('aborts when a resolved epoch key is bound to a different scope', async () => {
    const messageBlock = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const event = await makeEvent({
      messageId: 1n,
      blockNumber: 105n,
      blockHash: messageBlock.hash
    });
    const dependencies = makeDependencies({ blocks: [messageBlock, boundary], events: [event] });
    dependencies.resolveEpochKey.mockResolvedValueOnce({ ...EPOCH_KEY, epoch: EPOCH + 1n });

    await expect(syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: {},
      dependencies
    })).rejects.toThrow('epoch key does not match its requested scope');
  });

  it('does not prune an optimistic legacy row while merging finalized V2 history', async () => {
    const messageBlock = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const event = await makeEvent({
      messageId: 1n,
      blockNumber: 105n,
      blockHash: messageBlock.hash
    });
    const dependencies = makeDependencies({ blocks: [messageBlock, boundary], events: [event] });
    const optimistic = {
      id: 'local:pending-direct-message',
      direction: 'outgoing' as const,
      text: 'pending legacy write',
      txHash: event.transactionHash,
      deliveryState: 'pending' as const
    } satisfies ChatMessage;

    const result = await syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: { [BOB.toLowerCase()]: [optimistic] },
      dependencies
    });

    expect(result.messagesByContact[BOB.toLowerCase()].map((message) => message.id)).toEqual([
      optimistic.id,
      event.key
    ]);
  });

  it('fails atomically when the page boundary changes during the read', async () => {
    const messageBlock = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const replacementBoundary = { ...boundary, hash: hashFor(9_110) };
    const event = await makeEvent({
      messageId: 1n,
      blockNumber: 105n,
      blockHash: messageBlock.hash
    });
    const dependencies = makeDependencies({ blocks: [messageBlock, boundary], events: [event] });
    let boundaryReads = 0;
    dependencies.readCanonicalBlock.mockImplementation(async (_chainId, blockNumber) => {
      if (blockNumber === 105n) return messageBlock;
      if (blockNumber === 110n) {
        boundaryReads += 1;
        return boundaryReads === 1 ? boundary : replacementBoundary;
      }
      return null;
    });

    await expect(syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: {},
      dependencies
    })).rejects.toThrow('page boundary changed while the page was loading');
    expect(dependencies.clearEpochKeys).toHaveBeenCalledOnce();
  });

  it('fails atomically when a retained checkpoint boundary changes during the read', async () => {
    const checkpointBlock = { number: 104n, hash: hashFor(104), timestamp: 1_004 };
    const replacementCheckpointBlock = { ...checkpointBlock, hash: hashFor(9_104) };
    const messageBlock = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const checkpoint = createDirectChatV2HistoryCheckpoint({
      scope: SCOPE,
      blockNumber: checkpointBlock.number,
      blockHash: checkpointBlock.hash,
      lastMessageId: 1n
    });
    const event = await makeEvent({
      messageId: 2n,
      blockNumber: 105n,
      blockHash: messageBlock.hash
    });
    const dependencies = makeDependencies({
      blocks: [checkpointBlock, messageBlock, boundary],
      events: [event],
      messageCount: 2n
    });
    let checkpointReads = 0;
    dependencies.readCanonicalBlock.mockImplementation(async (_chainId, blockNumber) => {
      if (blockNumber === 104n) {
        checkpointReads += 1;
        return checkpointReads === 1 ? checkpointBlock : replacementCheckpointBlock;
      }
      if (blockNumber === 105n) return messageBlock;
      if (blockNumber === 110n) return boundary;
      return null;
    });

    await expect(syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: { [BOB.toLowerCase()]: [legacyMessage()] },
      checkpoint,
      dependencies
    })).rejects.toThrow('checkpoint boundary changed while the page was loading');
    expect(checkpointReads).toBe(2);
    expect(dependencies.clearEpochKeys).toHaveBeenCalledOnce();
  });

  it('rejects an event whose reported block is not on the canonical chain', async () => {
    const canonical = { number: 105n, hash: hashFor(105), timestamp: 1_005 };
    const boundary = { number: 110n, hash: hashFor(110), timestamp: 1_010 };
    const event = await makeEvent({
      messageId: 1n,
      blockNumber: 105n,
      blockHash: hashFor(9_105)
    });
    const dependencies = makeDependencies({ blocks: [canonical, boundary], events: [event] });

    await expect(syncDirectChatV2HistoryPage({
      config: CONFIG,
      scope: SCOPE,
      viewerAddress: ALICE,
      previousMessages: {},
      dependencies
    })).rejects.toThrow('block hash does not match');
    expect(dependencies.resolveEpochKey).not.toHaveBeenCalled();
  });
});
