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
    readMessagePage: vi.fn(async (_input: Parameters<DirectChatV2SyncDependencies['readMessagePage']>[0]) => events),
    readConversationMessageCountAtBlock: vi.fn(async (
      _input: Parameters<DirectChatV2SyncDependencies['readConversationMessageCountAtBlock']>[0]
    ) => messageCount),
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
  it('loads a recent contiguous ID suffix, then finds leading same-block messages through the inclusive older cursor', async () => {
    const events = await Promise.all([1n, 2n, 3n].map(messageId => makeEvent({ messageId,
      blockNumber: messageId === 3n ? 10_000n : 9_999n, blockHash: hashFor(messageId === 3n ? 10_000 : 9_999) })));
    const blocks = [9_999n, 10_000n].map(number => ({ number, hash: hashFor(Number(number)) }));
    const dependencies = makeDependencies({ latestBlock: 10_000n, blocks, events: events.slice(1), messageCount: 3n });
    const paging = { direction: 'recent' as const, messageCount: 3n, lastMessageBlock: 10_000n };
    const recent = await syncDirectChatV2HistoryPage({ config: CONFIG, scope: { ...SCOPE, firstMessageBlock: 100n },
      viewerAddress: ALICE, previousMessages: {}, dependencies, paging });
    expect(recent).toMatchObject({ hasMore: false, hasOlder: true, appliedEntries: 2,
      checkpoint: { firstMessageId: '2', lastMessageId: '3', olderToBlock: '9999' } });
    expect(dependencies.readMessagePage).toHaveBeenCalledExactlyOnceWith({ scope: { ...SCOPE, firstMessageBlock: 100n }, fromBlock: 9_990n, toBlock: 10_000n });
    expect(dependencies.readConversationMessageCountAtBlock).not.toHaveBeenCalled();
    dependencies.readMessagePage.mockResolvedValueOnce(events.slice(0, 2));
    const older = await syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: recent.messagesByContact, checkpoint: recent.checkpoint, dependencies,
      paging: { ...paging, direction: 'older' } });
    expect(older).toMatchObject({ hasMore: false, hasOlder: false, appliedEntries: 1,
      checkpoint: { firstMessageId: '1', lastMessageId: '3' } });
    expect(dependencies.readMessagePage.mock.calls[1]?.[0]).toMatchObject({ fromBlock: 9_989n, toBlock: 9_999n });
    expect(older.messagesByContact[BOB.toLowerCase()]).toHaveLength(3);
  });

  it.each([{ ids: [1n, 3n] }, { ids: [2n] }, { ids: [] as bigint[] }])('rejects missing internal or terminal suffix records ($ids)', async ({ ids }) => {
    const events = await Promise.all(ids.map(messageId => makeEvent({ messageId, blockNumber: 10_000n, blockHash: hashFor(10_000) })));
    const dependencies = makeDependencies({ latestBlock: 10_000n, blocks: [{ number: 10_000n, hash: hashFor(10_000) }], events });
    await expect(syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, dependencies, paging: { direction: 'recent', messageCount: 3n, lastMessageBlock: 10_000n } }))
      .rejects.toThrow('incomplete');
    expect(dependencies.resolveEpochKey).not.toHaveBeenCalled();
    expect(dependencies.readConversationMessageCountAtBlock).not.toHaveBeenCalled();
  });

  it('waits for finality before any historical count or message-page scan', async () => {
    const dependencies = makeDependencies({ latestBlock: 10_000n, blocks: [] });
    await expect(syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, dependencies, paging: { direction: 'recent', messageCount: 3n, lastMessageBlock: 10_001n } }))
      .rejects.toThrow('waiting for the latest message to finalize');
    expect(dependencies.readConversationMessageCountAtBlock).not.toHaveBeenCalled();
    expect(dependencies.readMessagePage).not.toHaveBeenCalled();
  });

  it('moves an explicit older page across an empty gap without claiming its missing IDs complete', async () => {
    const checkpoint = { ...createDirectChatV2HistoryCheckpoint({ scope: SCOPE, blockNumber: 10_000n,
      blockHash: hashFor(10_000), lastMessageId: 3n }), firstMessageId: '3', olderToBlock: '9000' };
    const dependencies = makeDependencies({ latestBlock: 10_000n,
      blocks: [9_000n, 10_000n].map(number => ({ number, hash: hashFor(Number(number)) })) });
    const result = await syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, checkpoint, dependencies,
      paging: { direction: 'older', messageCount: 3n, lastMessageBlock: 10_000n } });
    expect(result).toMatchObject({ hasOlder: true, appliedEntries: 0,
      checkpoint: { firstMessageId: '3', lastMessageId: '3', olderToBlock: '8989' } });
    expect(dependencies.readMessagePage).toHaveBeenCalledOnce();
    expect(dependencies.readConversationMessageCountAtBlock).not.toHaveBeenCalled();
  });

  it('keeps existing older coverage when a refreshed snapshot adds messages inside a retained head block', async () => {
    const checkpoint = { ...createDirectChatV2HistoryCheckpoint({ scope: SCOPE, blockNumber: 10_000n,
      blockHash: hashFor(10_000), lastMessageId: 3n }), firstMessageId: '1', olderToBlock: '100' };
    const events = await Promise.all([2n, 3n, 4n].map(messageId => makeEvent({ messageId,
      blockNumber: 10_000n, blockHash: hashFor(10_000) })));
    const dependencies = makeDependencies({ latestBlock: 10_000n,
      blocks: [{ number: 10_000n, hash: hashFor(10_000) }], events });
    const result = await syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, checkpoint, dependencies,
      paging: { direction: 'recent', messageCount: 4n, lastMessageBlock: 10_000n } });
    expect(result).toMatchObject({ hasOlder: false, checkpoint: { firstMessageId: '1', lastMessageId: '4', olderToBlock: '100' } });
    expect(dependencies.readMessagePage).toHaveBeenCalledOnce();
  });

  it('does not advance the recent tail for newer messages while loading an older page', async () => {
    const checkpoint = { ...createDirectChatV2HistoryCheckpoint({ scope: SCOPE, blockNumber: 10_000n,
      blockHash: hashFor(10_000), lastMessageId: 3n }), firstMessageId: '2', olderToBlock: '9999' };
    const event = await makeEvent({ messageId: 1n, blockNumber: 9_999n, blockHash: hashFor(9_999) });
    const dependencies = makeDependencies({ latestBlock: 10_010n,
      blocks: [9_999n, 10_000n, 10_010n].map(number => ({ number, hash: hashFor(Number(number)) })), events: [event] });
    const result = await syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, checkpoint, dependencies,
      paging: { direction: 'older', messageCount: 5n, lastMessageBlock: 10_005n } });
    expect(result).toMatchObject({ hasOlder: false,
      checkpoint: { blockNumber: '10000', firstMessageId: '1', lastMessageId: '3' } });
  });

  it('rejects missing earlier IDs when an older page reaches the verified first-message block', async () => {
    const checkpoint = { ...createDirectChatV2HistoryCheckpoint({ scope: SCOPE, blockNumber: 110n,
      blockHash: hashFor(110), lastMessageId: 3n }), firstMessageId: '3', olderToBlock: '105' };
    const dependencies = makeDependencies({ latestBlock: 110n,
      blocks: [105n, 110n].map(number => ({ number, hash: hashFor(Number(number)) })) });
    await expect(syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, checkpoint, dependencies,
      paging: { direction: 'older', messageCount: 3n, lastMessageBlock: 110n } })).rejects.toThrow('incomplete');
  });

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
    const beforeMessages = beforeSafe.messagesByContact;
    expect(beforeSafe.safeHead).toBe(104n);
    expect(beforeSafe.appliedEntries).toBe(0);
    expect(dependencies.readMessagePage).not.toHaveBeenCalled();
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

  it('advances an old empty conversation directly to the checked safe head', async () => {
    const boundary = { number: 100_000n, hash: hashFor(100_000), timestamp: 1_004 };
    const dependencies = makeDependencies({
      latestBlock: boundary.number,
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
      status: 'up-to-date',
      checkpoint: { blockNumber: '100000', lastMessageId: '0' },
      hasMore: false,
      appliedEntries: 0
    });
    expect(dependencies.readMessagePage).not.toHaveBeenCalled();
    expect(dependencies.readCanonicalBlock).toHaveBeenCalledTimes(2);
    expect(dependencies.resolveEpochKey).not.toHaveBeenCalled();
  });

  it('starts at the first message and skips the unchanged tail after proving the finalized count', async () => {
    const messageBlock = { number: 50_000n, hash: hashFor(50_000) };
    const pageBoundary = { number: 50_010n, hash: hashFor(50_010) };
    const safeBoundary = { number: 100_000n, hash: hashFor(100_000) };
    const event = await makeEvent({ messageId: 1n, blockNumber: messageBlock.number, blockHash: messageBlock.hash });
    const dependencies = makeDependencies({ latestBlock: safeBoundary.number,
      blocks: [messageBlock, pageBoundary, safeBoundary], events: [event] });
    const scope = { ...SCOPE, firstMessageBlock: messageBlock.number };
    const first = await syncDirectChatV2HistoryPage({ config: CONFIG, scope, viewerAddress: ALICE,
      previousMessages: {}, dependencies });
    expect(first).toMatchObject({ hasMore: false, appliedEntries: 1,
      page: { fromBlock: 50_000n, toBlock: 50_010n },
      checkpoint: { blockNumber: '100000', lastMessageId: '1' } });
    expect(dependencies.readMessagePage).toHaveBeenCalledOnce();
    dependencies.getLatestBlockNumber.mockResolvedValue(100_100n);
    dependencies.readCanonicalBlock.mockImplementation(async (_chain, number) => ({ number, hash: hashFor(Number(number)) }));
    dependencies.readMessagePage.mockClear();
    const idle = await syncDirectChatV2HistoryPage({ config: CONFIG, scope, viewerAddress: ALICE,
      previousMessages: first.messagesByContact, checkpoint: first.checkpoint, dependencies });
    expect(idle).toMatchObject({ hasMore: false, checkpoint: { blockNumber: '100100', lastMessageId: '1' } });
    expect(dependencies.readMessagePage).not.toHaveBeenCalled();
    expect(dependencies.readConversationMessageCountAtBlock).toHaveBeenLastCalledWith({ scope, blockNumber: 100_100n });
    // A new finalized post must wake the same checkpoint; counts are never retained across syncs.
    const nextEvent = await makeEvent({ messageId: 2n, blockNumber: 100_101n, blockHash: hashFor(100_101) });
    dependencies.getLatestBlockNumber.mockResolvedValue(100_105n);
    dependencies.readConversationMessageCountAtBlock.mockResolvedValue(2n);
    dependencies.readMessagePage.mockResolvedValue([nextEvent]);
    const next = await syncDirectChatV2HistoryPage({ config: CONFIG, scope, viewerAddress: ALICE,
      previousMessages: idle.messagesByContact, checkpoint: idle.checkpoint, dependencies });
    expect(next).toMatchObject({ hasMore: false, appliedEntries: 1,
      page: { fromBlock: 100_101n, toBlock: 100_105n }, checkpoint: { lastMessageId: '2' } });
  });

  it.each(['safe-head', 'checkpoint', 'scope'] as const)('rejects a changed %s during an idle advance', async (change) => {
    const checkpoint = createDirectChatV2HistoryCheckpoint({ scope: SCOPE, blockNumber: 104n,
      blockHash: hashFor(104), lastMessageId: 1n });
    const dependencies = makeDependencies({ blocks: [], messageCount: 1n });
    let current = true;
    const reads = new Map<bigint, number>();
    dependencies.readCanonicalBlock.mockImplementation(async (_chain, number) => {
      const count = (reads.get(number) ?? 0) + 1;
      reads.set(number, count);
      return { number, hash: hashFor(Number(number) + (
        (change === 'safe-head' && number === 110n || change === 'checkpoint' && number === 104n) && count > 1 ? 1_000 : 0
      )) };
    });
    if (change === 'scope') dependencies.readConversationMessageCountAtBlock.mockImplementation(async () => {
      current = false;
      return 1n;
    });
    await expect(syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, checkpoint, dependencies, shouldContinue: () => current }))
      .rejects.toThrow(change === 'scope' ? 'scope changed' : change === 'safe-head' ? 'safe head changed' : 'checkpoint boundary changed');
    expect(dependencies.readMessagePage).not.toHaveBeenCalled();
    expect(dependencies.resolveEpochKey).not.toHaveBeenCalled();
    if (change === 'scope') expect(dependencies.readCanonicalBlock).toHaveBeenCalledTimes(2);
  });

  it('retains bounded paging when finalized messages remain beyond the current page', async () => {
    const block = { number: 105n, hash: hashFor(105) };
    const event = await makeEvent({ messageId: 1n, blockNumber: block.number, blockHash: block.hash });
    const scope = { ...SCOPE, firstMessageBlock: 105n };
    const dependencies = makeDependencies({ latestBlock: 100_000n, events: [event], blocks: [
      block, { number: 115n, hash: hashFor(115) }, { number: 100_000n, hash: hashFor(100_000) }
    ] });
    dependencies.readConversationMessageCountAtBlock.mockImplementation(async ({ blockNumber }) => blockNumber === 100_000n ? 2n : 1n);
    const result = await syncDirectChatV2HistoryPage({ config: CONFIG, scope, viewerAddress: ALICE,
      previousMessages: {}, dependencies });
    expect(result).toMatchObject({ hasMore: true, appliedEntries: 1,
      checkpoint: { blockNumber: '115', lastMessageId: '1' }, page: { fromBlock: 105n, toBlock: 115n } });
  });

  it('returns the scoped reorg reset when the replacement history is empty', async () => {
    const checkpoint = createDirectChatV2HistoryCheckpoint({ scope: SCOPE, blockNumber: 104n,
      blockHash: hashFor(104), lastMessageId: 1n });
    const dependencies = makeDependencies({ blocks: [
      { number: 104n, hash: hashFor(9_104) }, { number: 110n, hash: hashFor(110) }
    ], messageCount: 0n });
    const result = await syncDirectChatV2HistoryPage({ config: CONFIG, scope: SCOPE, viewerAddress: ALICE,
      previousMessages: {}, checkpoint, dependencies });
    expect(result).toMatchObject({ status: 'reorg-reset', reorged: true, hasMore: false,
      mutation: { resetConversation: true, entries: [] },
      checkpoint: { blockNumber: '110', lastMessageId: '0' } });
    expect(dependencies.clearEpochKeys).toHaveBeenCalledOnce();
    expect(dependencies.readMessagePage).not.toHaveBeenCalled();
  });

  it('does not report completion when a first-message hint contradicts the finalized count', async () => {
    const dependencies = makeDependencies({ blocks: [{ number: 110n, hash: hashFor(110) }], messageCount: 1n });
    await expect(syncDirectChatV2HistoryPage({ config: CONFIG, scope: { ...SCOPE, firstMessageBlock: 120n },
      viewerAddress: ALICE, previousMessages: {}, dependencies })).rejects.toThrow('no readable block range');
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
