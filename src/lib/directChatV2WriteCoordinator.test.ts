import { BrowserProvider, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionChainMocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  parseConversationReceipt: vi.fn(),
  parseMessageReceipt: vi.fn(),
  readConversation: vi.fn(),
  readEpochKey: vi.fn(),
  sendMessage: vi.fn(),
  verifyContract: vi.fn()
}));

vi.mock('./directChatV2Chain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./directChatV2Chain')>(),
  createDirectChatV2Conversation: sessionChainMocks.createConversation,
  parseDirectChatV2ConversationCreatedReceipt: sessionChainMocks.parseConversationReceipt,
  parseDirectChatV2MessageReceipt: sessionChainMocks.parseMessageReceipt,
  readDirectChatV2Conversation: sessionChainMocks.readConversation,
  readDirectChatV2EpochKey: sessionChainMocks.readEpochKey,
  sendDirectChatV2Message: sessionChainMocks.sendMessage,
  verifyDirectChatV2Contract: sessionChainMocks.verifyContract
}));
import {
  buildMessageWithReplyPayload,
  buildMessageWithTradeReferencePayload,
  parseChatMessagePayload,
  type ChatMessage,
  type TradeMessageReferencePayload
} from './appShared';
import {
  bindDirectChatV2MetaMaskCapability,
  buildDirectChatV2MessageKey,
  type DirectChatV2ConversationSnapshot,
  type DirectChatV2EpochKey,
  type DirectChatV2MessageEvent,
  type VerifiedDirectChatV2Deployment
} from './directChatV2Chain';
import {
  createDirectChatV2Session,
  type DirectChatV2SendInput,
  type DirectChatV2SessionController
} from './directChatV2Session';
import { deriveDirectChatV2ConversationId } from './directChatV2Crypto';
import {
  DIRECT_CHAT_V2_WRITE_DISABLED,
  applyDirectChatV2ReceiptUpdate,
  appendDirectChatV2OptimisticMessage,
  createDirectChatV2WriteCoordinator,
  failDirectChatV2OptimisticMessage,
  type DirectChatV2PreparedWrite,
  type DirectChatV2WriteLifecycle
} from './directChatV2WriteCoordinator';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const MALLORY = '0x9999999999999999999999999999999999999999';
const CHAT = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 7_082_400n;
const CONVERSATION_ID = deriveDirectChatV2ConversationId({
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  participantA: ALICE,
  participantB: BOB
});
const REPLY_TX_HASH = `0x${'12'.repeat(32)}`;
const CREATE_TX_HASH = `0x${'34'.repeat(32)}`;
const MANIFEST = Object.freeze({
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  deploymentBlock: 99n,
  runtimeBytecodeHash: `0x${'55'.repeat(32)}`
});

const TRADE_REFERENCE = {
  version: 1,
  tradeId: 7,
  escrowContract: '0x7777777777777777777777777777777777777777',
  terminalPath: '/dex/otc?trade=7'
} satisfies TradeMessageReferencePayload;

const preparedPayload = (): DirectChatV2SendInput => ({
  body: buildMessageWithTradeReferencePayload(
    buildMessageWithReplyPayload('hello', 'previous', REPLY_TX_HASH, 90, 3, false),
    TRADE_REFERENCE
  ),
  replyToMessageId: 1n,
  replyPreview: 'previous',
  tip: 2n
});

const CANONICAL_TRADE_REFERENCE = parseChatMessagePayload(
  preparedPayload().body
).tradeReference;

const messageEvent = ({ recipient = BOB }: { recipient?: string } = {}): DirectChatV2MessageEvent => {
  const messageId = 2n;
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
    epoch: 1n,
    senderSequence: 2n,
    sender: ALICE,
    recipient,
    nonce: '0x0102030405060708090a0b0c',
    aadHash: `0x${'66'.repeat(32)}`,
    ciphertext: `0x${'ab'.repeat(16)}`,
    valueSent: 3n,
    feeTaken: 1n,
    transactionHash: `0x${'77'.repeat(32)}`,
    blockHash: `0x${'88'.repeat(32)}`,
    blockNumber: 100n,
    logIndex: 4,
    removed: false,
    context: {
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 1n,
      participantA: ALICE,
      participantB: recipient,
      sender: ALICE,
      recipient,
      senderSequence: 2n,
      valueSent: 3n,
      feeTaken: 1n
    },
    encrypted: {
      nonce: '0x0102030405060708090a0b0c',
      aadHash: `0x${'66'.repeat(32)}`,
      ciphertext: `0x${'ab'.repeat(16)}`
    }
  };
};

const VERIFIED = Object.freeze({ ...MANIFEST }) as VerifiedDirectChatV2Deployment;

const conversation = (): DirectChatV2ConversationSnapshot => ({
  exists: true,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  participantA: ALICE,
  participantB: BOB,
  currentEpoch: 1n,
  messageCount: 2n,
  createdAt: 1n,
  lastMessageAt: 2n,
  createdBlock: 99n,
  firstMessageBlock: 100n,
  lastMessageBlock: 100n
});

const epochKey = (): DirectChatV2EpochKey => ({
  value: 7n,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  epoch: 1n
});

const createBoundSession = async ({
  event = messageEvent(),
  ownerAddress = ALICE
}: {
  event?: DirectChatV2MessageEvent;
  ownerAddress?: string;
} = {}): Promise<DirectChatV2SessionController> => {
  const browserProvider = new BrowserProvider({
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
      if (method === 'eth_accounts') return [ownerAddress];
      return null;
    })
  }, {
    chainId: Number(CHAIN_ID),
    name: 'Direct Chat V2 coordinator test'
  });
  const signer = {
    provider: browserProvider,
    getAddress: vi.fn(async () => ownerAddress),
    getUserOnboardInfo: vi.fn(() => ({ aesKey: 'test-aes-key' })),
    sendUncheckedTransaction: vi.fn()
  } as unknown as JsonRpcSigner;
  const capability = await bindDirectChatV2MetaMaskCapability({
    signer,
    browserProvider,
    ownerAddress,
    chainId: CHAIN_ID,
    assertCurrent: async () => undefined
  });
  sessionChainMocks.parseMessageReceipt.mockReturnValue(event);
  sessionChainMocks.sendMessage.mockResolvedValue({
    encrypted: event.encrypted,
    context: event.context,
    transaction: {
      txHash: event.transactionHash,
      wait: vi.fn(async () => ({ status: 1, logs: [{}] }))
    }
  });
  return createDirectChatV2Session({
    getOwnerCapability: async () => capability,
    manifest: MANIFEST,
    ownerAddress,
    retireNonceAttempt: async () => undefined,
    runOwnerTransactionFlow: async (operation) => operation()
  });
};

const optimisticMessage = (id = 'local-direct-v2-primary'): ChatMessage => ({
  id,
  direction: 'outgoing',
  text: 'hello',
  senderAddress: ALICE,
  accountAddress: ALICE,
  accountRole: 'owner',
  replyToMessageId: buildDirectChatV2MessageKey({
    chainId: CHAIN_ID,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    messageId: 1n
  }),
  replyToText: 'previous',
  replyToBlockNumber: 90,
  replyToLogIndex: 3,
  tradeReference: CANONICAL_TRADE_REFERENCE,
  timestamp: 123,
  deliveryState: 'pending'
});

const write = (message = optimisticMessage()): DirectChatV2PreparedWrite => ({
  peer: BOB,
  payload: preparedPayload(),
  optimisticMessage: message
});

const stateLifecycle = (initial: Record<string, ChatMessage[]> = {}) => {
  let state = initial;
  const lifecycle: DirectChatV2WriteLifecycle = {
    onOptimistic: vi.fn((update) => {
      state = appendDirectChatV2OptimisticMessage(state, update);
    }),
    onReceipt: vi.fn((update) => {
      state = applyDirectChatV2ReceiptUpdate(state, update);
    }),
    onFailure: vi.fn((update) => {
      state = failDirectChatV2OptimisticMessage(state, update);
    })
  };
  return { lifecycle, read: () => state };
};

describe('directChatV2WriteCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionChainMocks.verifyContract.mockResolvedValue(VERIFIED);
    sessionChainMocks.readConversation.mockResolvedValue(conversation());
    sessionChainMocks.readEpochKey.mockResolvedValue(epochKey());
  });

  it('fails closed while the write gate is disabled', async () => {
    const coordinator = createDirectChatV2WriteCoordinator(DIRECT_CHAT_V2_WRITE_DISABLED);

    expect(coordinator.enabled).toBe(false);
    await expect(coordinator.send(write())).rejects.toThrow('not activated');
  });

  it('rejects a structurally identical controller without private registry membership', () => {
    const fakeSession = {
      manifest: MANIFEST,
      ownerAddress: ALICE,
      ensure: vi.fn(),
      create: vi.fn(),
      inspect: vi.fn(),
      rotate: vi.fn(),
      send: vi.fn(),
      clearEpochKeys: vi.fn()
    } as unknown as DirectChatV2SessionController;

    expect(() => createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: ALICE,
      session: fakeSession,
      lifecycle: stateLifecycle().lifecycle
    })).toThrow('bound V2 session controller');
  });

  it('rejects a bound session for any wallet other than the configured browser-wallet owner', async () => {
    const session = await createBoundSession({ ownerAddress: MALLORY });

    expect(() => createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: ALICE,
      session,
      lifecycle: stateLifecycle().lifecycle
    })).toThrow('different owner');
  });

  it('preserves the prepared reply/trade body and replaces only its exact optimistic ID', async () => {
    const otherIdenticalMessage = optimisticMessage('local-direct-v2-other');
    const state = stateLifecycle({ [BOB.toLowerCase()]: [otherIdenticalMessage] });
    const session = await createBoundSession();
    const coordinator = createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: ALICE,
      session,
      lifecycle: state.lifecycle
    });

    const result = await coordinator.send(write());
    const messages = state.read()[BOB.toLowerCase()];

    expect(result.reconciled).toBe(true);
    expect(result.confirmedMessage).toMatchObject({
      id: result.event.key,
      text: 'hello',
      replyToMessageId: optimisticMessage().replyToMessageId,
      replyToText: 'previous',
      replyToBlockNumber: 90,
      replyToLogIndex: 3,
      tradeReference: CANONICAL_TRADE_REFERENCE,
      deliveryState: 'sent',
      directV2: { messageId: '2', finality: 'confirmed' }
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(otherIdenticalMessage.id);
    expect(messages[1].id).toBe(result.event.key);
    expect(messages.some(({ id }) => id === optimisticMessage().id)).toBe(false);
    expect(sessionChainMocks.sendMessage).toHaveBeenCalledOnce();
    expect(sessionChainMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      peer: BOB,
      tip: 2n,
      plaintext: expect.stringContaining('hello')
    }));
  });

  it('creates a missing conversation before inserting and sending the first message', async () => {
    const state = stateLifecycle();
    const createdConversation = conversation();
    sessionChainMocks.readConversation
      .mockResolvedValueOnce({
        exists: false,
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID
      })
      .mockResolvedValue(createdConversation);
    sessionChainMocks.createConversation.mockResolvedValueOnce({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 1n
      },
      transaction: {
        txHash: CREATE_TX_HASH,
        wait: vi.fn(async () => ({ status: 1, hash: CREATE_TX_HASH, logs: [{}] }))
      }
    });
    sessionChainMocks.parseConversationReceipt.mockReturnValueOnce({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      participantA: ALICE,
      participantB: BOB,
      createdBy: ALICE,
      epoch: 1n,
      transactionHash: CREATE_TX_HASH,
      blockHash: `0x${'35'.repeat(32)}`,
      blockNumber: 100n,
      logIndex: 0
    });
    const session = await createBoundSession();
    const coordinator = createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: ALICE,
      session,
      lifecycle: state.lifecycle
    });

    await expect(coordinator.send(write())).resolves.toMatchObject({ reconciled: true });

    expect(sessionChainMocks.createConversation).toHaveBeenCalledOnce();
    expect(sessionChainMocks.sendMessage).toHaveBeenCalledOnce();
    expect(sessionChainMocks.createConversation.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(state.lifecycle.onOptimistic).mock.invocationCallOrder[0]);
    expect(state.read()[BOB.toLowerCase()]).toMatchObject([
      { deliveryState: 'sent', directV2: { conversationId: CONVERSATION_ID } }
    ]);
  });

  it('keeps the branded session and lifecycle captured after caller config mutation', async () => {
    const state = stateLifecycle();
    const session = await createBoundSession();
    const fakeSend = vi.fn(async () => {
      throw new Error('unbound replacement session was used');
    });
    const fakeSession = {
      ...session,
      send: fakeSend
    } as unknown as DirectChatV2SessionController;
    const replacementLifecycle = {
      onOptimistic: vi.fn(() => {
        throw new Error('replacement lifecycle was used');
      }),
      onReceipt: vi.fn(),
      onFailure: vi.fn()
    };
    const config = {
      enabled: true as const,
      mode: 'metamask-owner' as const,
      ownerAddress: ALICE,
      session,
      lifecycle: state.lifecycle
    };
    const coordinator = createDirectChatV2WriteCoordinator(config);

    expect(Object.isFrozen(session)).toBe(true);
    config.session = fakeSession;
    config.lifecycle = replacementLifecycle;
    await expect(coordinator.send(write())).resolves.toMatchObject({ reconciled: true });

    expect(fakeSend).not.toHaveBeenCalled();
    expect(sessionChainMocks.sendMessage).toHaveBeenCalledOnce();
    expect(replacementLifecycle.onOptimistic).not.toHaveBeenCalled();
    expect(state.lifecycle.onReceipt).toHaveBeenCalledOnce();
  });

  it('captures the write scope guard before awaiting lifecycle callbacks', async () => {
    const state = stateLifecycle();
    const session = await createBoundSession();
    const pendingWrite = write();
    const initialScopeGuard = vi.fn(() => true);
    pendingWrite.shouldContinue = initialScopeGuard;
    const appendOptimistic = state.lifecycle.onOptimistic;
    state.lifecycle.onOptimistic = vi.fn(async (update) => {
      await appendOptimistic(update);
      pendingWrite.shouldContinue = () => false;
    });
    const coordinator = createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: ALICE,
      session,
      lifecycle: state.lifecycle
    });

    await expect(coordinator.send(pendingWrite)).resolves.toMatchObject({ reconciled: true });

    expect(initialScopeGuard).toHaveBeenCalled();
    expect(sessionChainMocks.sendMessage).toHaveBeenCalledOnce();
    expect(state.lifecycle.onReceipt).toHaveBeenCalledOnce();
  });

  it('marks only the exact optimistic ID failed when the receipt leaves the owner-to-peer scope', async () => {
    const state = stateLifecycle();
    const session = await createBoundSession({ event: messageEvent({ recipient: MALLORY }) });
    const coordinator = createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: ALICE,
      session,
      lifecycle: state.lifecycle
    });

    await expect(coordinator.send(write())).rejects.toThrow('owner-to-peer scope');
    expect(state.read()[BOB.toLowerCase()]).toMatchObject([
      { id: optimisticMessage().id, deliveryState: 'failed' }
    ]);
    expect(state.lifecycle.onReceipt).not.toHaveBeenCalled();
  });

  it('rejects a wrong stable V2 reply identity before optimistic insertion or wallet send', async () => {
    const state = stateLifecycle();
    const session = await createBoundSession();
    const coordinator = createDirectChatV2WriteCoordinator({
      enabled: true,
      mode: 'metamask-owner',
      ownerAddress: ALICE,
      session,
      lifecycle: state.lifecycle
    });

    await expect(coordinator.send(write({
      ...optimisticMessage(),
      replyToMessageId: 'direct-v2:wrong-domain'
    }))).rejects.toThrow('does not match the prepared payload');
    expect(state.lifecycle.onOptimistic).not.toHaveBeenCalled();
    expect(sessionChainMocks.sendMessage).not.toHaveBeenCalled();
  });

  it('removes the exact optimistic record without downgrading a finalized history race winner', () => {
    const optimistic = optimisticMessage();
    const confirmed = {
      id: messageEvent().key,
      direction: 'outgoing',
      text: 'hello',
      directV2: {
        protocol: 'direct-v2',
        contentState: 'available',
        chainId: CHAIN_ID.toString(),
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        messageId: '2',
        epoch: '1',
        senderSequence: '2',
        nonce: messageEvent().nonce,
        transactionHash: messageEvent().transactionHash,
        blockNumber: '100',
        blockHash: messageEvent().blockHash,
        logIndex: 4,
        finality: 'confirmed'
      }
    } satisfies ChatMessage;
    const finalized = {
      ...confirmed,
      directV2: { ...confirmed.directV2, finality: 'finalized' as const }
    };
    const previous = {
      [BOB.toLowerCase()]: [optimistic, finalized]
    };

    const next = applyDirectChatV2ReceiptUpdate(previous, {
      contactKey: BOB,
      optimisticId: optimistic.id,
      confirmedMessage: confirmed
    });

    expect(next[BOB.toLowerCase()]).toEqual([
      { ...confirmed, directV2: { ...confirmed.directV2, finality: 'finalized' } }
    ]);
  });
});
