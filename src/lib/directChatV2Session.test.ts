import { BrowserProvider, Interface, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chainMocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  parseConversationReceipt: vi.fn(),
  parseMessageReceipt: vi.fn(),
  readCanonicalBlock: vi.fn(),
  readConversation: vi.fn(),
  readConversationMessageCountAtBlock: vi.fn(),
  readEpochKey: vi.fn(),
  readIncomingMessageLogPage: vi.fn(),
  readLatestBlockNumber: vi.fn(),
  readMessageLogPage: vi.fn(),
  readNativeCredit: vi.fn(),
  rotateConversationKey: vi.fn(),
  sendMessage: vi.fn(),
  signImageSessionAuthorization: vi.fn(),
  verifyContract: vi.fn(),
  watchIncomingHints: vi.fn(),
  watchMessageHints: vi.fn(),
  withdrawNativeCredit: vi.fn()
}));

vi.mock('./directChatV2Chain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./directChatV2Chain')>(),
  createDirectChatV2Conversation: chainMocks.createConversation,
  parseDirectChatV2ConversationCreatedReceipt: chainMocks.parseConversationReceipt,
  parseDirectChatV2MessageReceipt: chainMocks.parseMessageReceipt,
  readDirectChatV2CanonicalBlock: chainMocks.readCanonicalBlock,
  readDirectChatV2Conversation: chainMocks.readConversation,
  readDirectChatV2ConversationMessageCountAtBlock: chainMocks.readConversationMessageCountAtBlock,
  readDirectChatV2EpochKey: chainMocks.readEpochKey,
  readDirectChatV2IncomingMessageLogPage: chainMocks.readIncomingMessageLogPage,
  readDirectChatV2LatestBlockNumber: chainMocks.readLatestBlockNumber,
  readDirectChatV2MessageLogPage: chainMocks.readMessageLogPage,
  readDirectChatV2NativeCredit: chainMocks.readNativeCredit,
  rotateDirectChatV2ConversationKey: chainMocks.rotateConversationKey,
  sendDirectChatV2Message: chainMocks.sendMessage,
  signDirectChatV2ImageSessionAuthorization: chainMocks.signImageSessionAuthorization,
  verifyDirectChatV2Contract: chainMocks.verifyContract,
  watchDirectChatV2IncomingMessageHints: chainMocks.watchIncomingHints,
  watchDirectChatV2MessageHints: chainMocks.watchMessageHints,
  withdrawDirectChatV2NativeCredit: chainMocks.withdrawNativeCredit
}));

import {
  createDirectChatV2Session,
  type DirectChatV2TransactionFlow
} from './directChatV2Session';
import {
  DIRECT_CHAT_V2_ABI,
  bindDirectChatV2MetaMaskCapability,
  type DirectChatV2ConversationLookup,
  type DirectChatV2ConversationSnapshot,
  type DirectChatV2DeploymentManifest,
  type DirectChatV2EpochKey,
  type DirectChatV2MessageEvent,
  type DirectChatV2MetaMaskCapability,
  type DirectChatV2NonceAttemptRetirer,
  type VerifiedDirectChatV2Deployment
} from './directChatV2Chain';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CHAT = '0x3333333333333333333333333333333333333333';
const CONVERSATION_ID = `0x${'44'.repeat(32)}`;
const CHAIN_ID = 7_082_400n;
const ORIGINAL_TX_HASH = `0x${'aa'.repeat(32)}`;
const REPLACEMENT_TX_HASH = `0x${'bb'.repeat(32)}`;
const WITHDRAW_TX_HASH = `0x${'dd'.repeat(32)}`;
const CHAT_INTERFACE = new Interface(DIRECT_CHAT_V2_ABI);

const MANIFEST = {
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  deploymentBlock: 99n,
  runtimeBytecodeHash: `0x${'55'.repeat(32)}`
} satisfies DirectChatV2DeploymentManifest;

const VERIFIED = Object.freeze({ ...MANIFEST }) as VerifiedDirectChatV2Deployment;

const conversation = (epoch = 1n): DirectChatV2ConversationSnapshot => ({
  exists: true,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  participantA: ALICE,
  participantB: BOB,
  currentEpoch: epoch,
  messageCount: 2n,
  createdAt: 1n,
  lastMessageAt: 2n,
  createdBlock: 99n,
  firstMessageBlock: 100n,
  lastMessageBlock: 101n
});

const missingConversation = (): DirectChatV2ConversationLookup => ({
  exists: false,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID
});

const epochKey = (epoch = 1n): DirectChatV2EpochKey => ({
  value: 7n,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  epoch
});

const ownerBrowserProvider = (chainId = CHAIN_ID): BrowserProvider => {
  const provider = new BrowserProvider({
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      if (method === 'eth_accounts') return [ALICE];
      return null;
    })
  }, {
    chainId: Number(chainId),
    name: 'Direct Chat V2 session test'
  });
  return provider;
};

const ownerSigner = (
  browserProvider = ownerBrowserProvider(),
  ownerAddress = ALICE
): JsonRpcSigner => ({
  provider: browserProvider,
  getAddress: vi.fn(async () => ownerAddress),
  getUserOnboardInfo: vi.fn(() => ({ aesKey: 'test-aes-key' })),
  sendUncheckedTransaction: vi.fn()
}) as unknown as JsonRpcSigner;

const ownerCapability = async ({
  assertCurrent = vi.fn(async () => undefined),
  assertSnapshotCurrent,
  browserProvider = ownerBrowserProvider(),
  chainId = CHAIN_ID,
  ownerAddress = ALICE
}: {
  assertCurrent?: () => Promise<void>;
  assertSnapshotCurrent?: () => void;
  browserProvider?: BrowserProvider;
  chainId?: bigint;
  ownerAddress?: string;
} = {}): Promise<DirectChatV2MetaMaskCapability> => bindDirectChatV2MetaMaskCapability({
  signer: ownerSigner(browserProvider, ownerAddress),
  browserProvider,
  ownerAddress,
  chainId,
  assertCurrent,
  assertSnapshotCurrent
});

const transaction = (hash: string, receipt: unknown = { status: 1 }) => ({
  txHash: hash,
  wait: vi.fn(async () => receipt)
});

const replacedTransaction = ({
  data,
  value,
  cancelled = false,
  replacementHash = REPLACEMENT_TX_HASH
}: {
  data: string;
  value: bigint;
  cancelled?: boolean;
  replacementHash?: string;
}) => {
  const replacementError = Object.assign(new Error('transaction replaced'), {
    code: 'TRANSACTION_REPLACED',
    reason: cancelled ? 'cancelled' : 'repriced',
    cancelled,
    replacement: {
      hash: replacementHash,
      to: CHAT,
      from: ALICE,
      data,
      value,
      chainId: CHAIN_ID
    },
    receipt: {
      status: 1,
      hash: replacementHash,
      logs: [{}]
    }
  });
  return {
    txHash: ORIGINAL_TX_HASH,
    wait: vi.fn(async () => {
      throw replacementError;
    })
  };
};

const ownerTransactionFlow = (): DirectChatV2TransactionFlow => vi.fn(
  async (operation: () => Promise<unknown>) => operation()
) as unknown as DirectChatV2TransactionFlow;

const messageEvent = ({
  epoch = 1n,
  messageId = 1n,
  ciphertext = `0x${'ab'.repeat(16)}`
}: {
  epoch?: bigint;
  messageId?: bigint;
  ciphertext?: string;
} = {}): DirectChatV2MessageEvent => ({
  protocol: 'direct-v2',
  key: `direct-v2:${messageId}`,
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  conversationId: CONVERSATION_ID,
  messageId,
  epoch,
  senderSequence: messageId,
  sender: ALICE,
  recipient: BOB,
  nonce: '0x0102030405060708090a0b0c',
  aadHash: `0x${'66'.repeat(32)}`,
  ciphertext,
  valueSent: 3n,
  feeTaken: 1n,
  transactionHash: `0x${'77'.repeat(32)}`,
  blockHash: `0x${'88'.repeat(32)}`,
  blockNumber: 100n,
  logIndex: Number(messageId),
  removed: false,
  context: {
    chainId: CHAIN_ID,
    contractAddress: CHAT,
    conversationId: CONVERSATION_ID,
    epoch,
    participantA: ALICE,
    participantB: BOB,
    sender: ALICE,
    recipient: BOB,
    senderSequence: messageId,
    valueSent: 3n,
    feeTaken: 1n
  },
  encrypted: {
    nonce: '0x0102030405060708090a0b0c',
    aadHash: `0x${'66'.repeat(32)}`,
    ciphertext
  }
});

const makeController = ({
  getOwnerCapability = vi.fn(async () => ownerCapability()),
  invalidateOwnerCapabilities,
  manifest = MANIFEST,
  ownerAddress = ALICE,
  retireNonceAttempt = vi.fn(),
  runOwnerTransactionFlow = ownerTransactionFlow()
}: {
  getOwnerCapability?: (requirePrivacy: boolean) => Promise<DirectChatV2MetaMaskCapability>;
  invalidateOwnerCapabilities?: () => void;
  manifest?: DirectChatV2DeploymentManifest;
  ownerAddress?: string;
  retireNonceAttempt?: DirectChatV2NonceAttemptRetirer;
  runOwnerTransactionFlow?: DirectChatV2TransactionFlow;
} = {}) => ({
  controller: createDirectChatV2Session({
    getOwnerCapability,
    invalidateOwnerCapabilities,
    manifest,
    ownerAddress,
    retireNonceAttempt,
    runOwnerTransactionFlow
  }),
  getOwnerCapability,
  invalidateOwnerCapabilities,
  retireNonceAttempt,
  runOwnerTransactionFlow
});

describe('directChatV2Session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chainMocks.verifyContract.mockResolvedValue(VERIFIED);
    chainMocks.readConversation.mockResolvedValue(conversation());
    chainMocks.parseConversationReceipt.mockReturnValue({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      participantA: ALICE,
      participantB: BOB,
      createdBy: ALICE,
      epoch: 1n,
      transactionHash: ORIGINAL_TX_HASH,
      blockHash: `0x${'12'.repeat(32)}`,
      blockNumber: 100n,
      logIndex: 0
    });
    chainMocks.readCanonicalBlock.mockResolvedValue({
      number: 100n,
      hash: `0x${'12'.repeat(32)}`,
      timestamp: 456
    });
    chainMocks.readConversationMessageCountAtBlock.mockResolvedValue(2n);
    chainMocks.readEpochKey.mockResolvedValue(epochKey());
    chainMocks.readIncomingMessageLogPage.mockResolvedValue([]);
    chainMocks.readLatestBlockNumber.mockResolvedValue(120n);
    chainMocks.readMessageLogPage.mockResolvedValue([]);
    chainMocks.readNativeCredit.mockResolvedValue(0n);
    chainMocks.signImageSessionAuthorization.mockResolvedValue(`0x${'ab'.repeat(65)}`);
    chainMocks.watchMessageHints.mockResolvedValue(null);
    chainMocks.watchIncomingHints.mockResolvedValue(vi.fn(async () => undefined));
    chainMocks.withdrawNativeCredit.mockResolvedValue({
      observedCredit: 12n,
      transaction: transaction(WITHDRAW_TX_HASH, { status: 1, hash: WITHDRAW_TX_HASH })
    });
  });

  it('rejects an unbound structural capability before deployment verification', async () => {
    const { controller } = makeController({
      getOwnerCapability: vi.fn(async () =>
        Object.freeze({}) as DirectChatV2MetaMaskCapability
      )
    });

    await expect(controller.inspect(BOB)).rejects.toThrow('session capability');
    expect(chainMocks.verifyContract).not.toHaveBeenCalled();
  });

  it('rejects expired, owner-mismatched, and chain-mismatched capabilities at operation start', async () => {
    let current = true;
    const expiringCapability = await ownerCapability({
      assertCurrent: async () => {
        if (!current) throw new Error('owner capability expired');
      }
    });
    const expiredController = makeController({
      getOwnerCapability: vi.fn(async () => expiringCapability)
    }).controller;
    current = false;
    await expect(expiredController.inspect(BOB)).rejects.toThrow('capability expired');

    const wrongOwnerCapability = await ownerCapability({ ownerAddress: BOB });
    await expect(makeController({
      getOwnerCapability: vi.fn(async () => wrongOwnerCapability)
    }).controller.inspect(BOB)).rejects.toThrow('different account or chain');

    const wrongChain = CHAIN_ID + 1n;
    const wrongChainCapability = await ownerCapability({
      browserProvider: ownerBrowserProvider(wrongChain),
      chainId: wrongChain
    });
    await expect(makeController({
      getOwnerCapability: vi.fn(async () => wrongChainCapability)
    }).controller.inspect(BOB)).rejects.toThrow('different account or chain');
    expect(chainMocks.verifyContract).not.toHaveBeenCalled();
  });

  it('rejects a wallet-session switch that occurs during a chain read', async () => {
    let current = true;
    const capability = await ownerCapability({
      assertCurrent: async () => {
        if (!current) throw new Error('owner session switched');
      }
    });
    chainMocks.readConversation.mockImplementationOnce(async () => {
      current = false;
      return conversation();
    });
    const { controller } = makeController({
      getOwnerCapability: vi.fn(async () => capability)
    });

    await expect(controller.inspect(BOB)).rejects.toThrow('session switched');
  });

  it('snapshots the manifest and verifies it once for the captured owner', async () => {
    const mutableManifest = { ...MANIFEST };
    const getOwnerCapability = vi.fn(async () => ownerCapability());
    const { controller } = makeController({ getOwnerCapability, manifest: mutableManifest });
    mutableManifest.contractAddress = BOB;

    await controller.inspect(BOB);
    await controller.inspect(BOB);

    expect(Object.isFrozen(controller.manifest)).toBe(true);
    expect(controller.manifest.contractAddress).toBe(CHAT);
    expect(chainMocks.verifyContract).toHaveBeenCalledOnce();
    expect(chainMocks.verifyContract).toHaveBeenCalledWith({
      capability: expect.any(Object),
      manifest: MANIFEST
    });
    expect(getOwnerCapability).toHaveBeenNthCalledWith(1, false);
    expect(getOwnerCapability).toHaveBeenNthCalledWith(2, false);
  });

  it('exposes scope-bound history reads without releasing its signer capability', async () => {
    const { controller } = makeController();
    const access = await controller.history(BOB);
    if (!access) throw new Error('Expected an existing V2 history scope.');

    expect(access.scope).toEqual({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      deploymentBlock: 99n,
      conversationStartBlock: 99n
    });
    await expect(access.dependencies.getLatestBlockNumber(CHAIN_ID)).resolves.toBe(120n);
    await expect(access.dependencies.readCanonicalBlock(CHAIN_ID, 100n)).resolves.toMatchObject({
      number: 100n
    });
    await expect(access.dependencies.readMessagePage({
      scope: access.scope,
      fromBlock: 99n,
      toBlock: 100n
    })).resolves.toEqual([]);
    await expect(access.dependencies.readConversationMessageCountAtBlock({
      scope: access.scope,
      blockNumber: 100n
    })).resolves.toBe(2n);
    await expect(access.dependencies.resolveEpochKey({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 1n
    })).resolves.toEqual(epochKey());

    expect(chainMocks.readMessageLogPage).toHaveBeenCalledWith({
      capability: expect.any(Object),
      deployment: VERIFIED,
      peer: BOB,
      fromBlock: 99n,
      toBlock: 100n
    });
    await expect(access.dependencies.readMessagePage({
      scope: { ...access.scope, conversationId: `0x${'99'.repeat(32)}` },
      fromBlock: 99n,
      toBlock: 100n
    })).rejects.toThrow('different verified scope');
    await expect(access.dependencies.getLatestBlockNumber(CHAIN_ID + 1n))
      .rejects.toThrow('wrong chain');
  });

  it('serializes uncached epoch-key reads so privacy unlock cannot fan out through MetaMask', async () => {
    let releaseFirstRead: (() => void) | undefined;
    let firstReadFinished = false;
    chainMocks.readEpochKey.mockImplementation(async ({ epoch }: { epoch: bigint }) => {
      if (epoch === 1n) {
        await new Promise<void>((resolve) => {
          releaseFirstRead = resolve;
        });
        firstReadFinished = true;
      } else {
        expect(firstReadFinished).toBe(true);
      }
      return epochKey(epoch);
    });
    const { controller } = makeController();
    const access = await controller.history(BOB);
    if (!access) throw new Error('Expected an existing V2 history scope.');

    const first = access.dependencies.resolveEpochKey({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 1n
    });
    await vi.waitFor(() => expect(chainMocks.readEpochKey).toHaveBeenCalledTimes(1));
    const second = access.dependencies.resolveEpochKey({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 2n
    });
    await Promise.resolve();

    expect(chainMocks.readEpochKey).toHaveBeenCalledTimes(1);
    releaseFirstRead?.();
    await expect(Promise.all([first, second])).resolves.toEqual([epochKey(1n), epochKey(2n)]);
    expect(chainMocks.readEpochKey).toHaveBeenCalledTimes(2);
  });

  it('treats a missing V2 conversation as empty history without requesting privacy', async () => {
    chainMocks.readConversation.mockResolvedValueOnce(missingConversation());
    const capability = await ownerCapability();
    const getOwnerCapability = vi.fn(async () => capability);
    const { controller } = makeController({ getOwnerCapability });

    await expect(controller.history(BOB)).resolves.toBeNull();

    expect(getOwnerCapability).toHaveBeenCalledTimes(1);
    expect(getOwnerCapability).toHaveBeenCalledWith(false);
    expect(chainMocks.readEpochKey).not.toHaveBeenCalled();
  });

  it('exposes recipient-filtered historical discovery without requesting privacy', async () => {
    const capability = await ownerCapability();
    const getOwnerCapability = vi.fn(async () => capability);
    const { controller } = makeController({ getOwnerCapability });
    const access = await controller.incomingHistory();

    expect(access.scope).toEqual({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      ownerAddress: ALICE,
      deploymentBlock: 99n
    });
    await expect(access.dependencies.getLatestBlockNumber()).resolves.toBe(120n);
    await expect(access.dependencies.readCanonicalBlock(100n)).resolves.toMatchObject({
      number: 100n
    });
    await expect(access.dependencies.readIncomingPage({
      fromBlock: 99n,
      toBlock: 100n
    })).resolves.toEqual([]);

    expect(getOwnerCapability).toHaveBeenCalledTimes(1);
    expect(getOwnerCapability).toHaveBeenCalledWith(false);
    expect(chainMocks.readIncomingMessageLogPage).toHaveBeenCalledWith({
      capability,
      deployment: VERIFIED,
      fromBlock: 99n,
      toBlock: 100n
    });
  });

  it('reads and withdraws native tip credits through the exact owner transaction flow', async () => {
    chainMocks.readNativeCredit
      .mockResolvedValueOnce(12n)
      .mockResolvedValueOnce(3n);
    const { controller, runOwnerTransactionFlow } = makeController();

    await expect(controller.readNativeCredit()).resolves.toBe(12n);
    await expect(controller.withdrawNativeCredit()).resolves.toEqual({
      observedCredit: 12n,
      remainingCredit: 3n,
      transactionHash: WITHDRAW_TX_HASH
    });

    expect(runOwnerTransactionFlow).toHaveBeenCalledOnce();
    expect(chainMocks.withdrawNativeCredit).toHaveBeenCalledWith({
      capability: expect.any(Object),
      deployment: VERIFIED
    });
  });

  it('serializes an image-session signature through the bound owner capability', async () => {
    const { controller, runOwnerTransactionFlow } = makeController();
    const message = 'ChainWhisper Chat Image Upload Session\nversion:1';

    await expect(controller.signImageSessionAuthorization(message))
      .resolves.toBe(`0x${'ab'.repeat(65)}`);

    expect(runOwnerTransactionFlow).toHaveBeenCalledOnce();
    expect(chainMocks.signImageSessionAuthorization).toHaveBeenCalledWith({
      capability: expect.any(Object),
      message
    });
  });

  it('evicts and reacquires a stale capability once before a mutation', async () => {
    let stale = false;
    const staleAssert = vi.fn(async () => {
      if (stale) throw new Error('stale owner session');
    });
    const staleCapability = await ownerCapability({ assertCurrent: staleAssert });
    stale = true;
    const freshCapability = await ownerCapability();
    const getOwnerCapability = vi.fn()
      .mockResolvedValueOnce(staleCapability)
      .mockResolvedValueOnce(freshCapability);
    const invalidateOwnerCapabilities = vi.fn();
    const { controller } = makeController({ getOwnerCapability, invalidateOwnerCapabilities });

    await expect(controller.signImageSessionAuthorization('image-session'))
      .resolves.toBe(`0x${'ab'.repeat(65)}`);

    expect(getOwnerCapability).toHaveBeenCalledTimes(2);
    expect(invalidateOwnerCapabilities).toHaveBeenCalledOnce();
  });

  it('creates a hint-only watcher without requesting the privacy key', async () => {
    const stop = vi.fn(async () => undefined);
    chainMocks.watchMessageHints.mockResolvedValueOnce(stop);
    const capability = await ownerCapability();
    const getOwnerCapability = vi.fn(async () => capability);
    const { controller } = makeController({ getOwnerCapability });
    const onHint = vi.fn();

    await expect(controller.watch(BOB, onHint)).resolves.toBe(stop);

    expect(getOwnerCapability).toHaveBeenCalledWith(false);
    expect(chainMocks.watchMessageHints).toHaveBeenCalledWith({
      capability,
      deployment: VERIFIED,
      peer: BOB,
      onHint
    });
  });

  it('creates a global incoming hint watcher without requesting the privacy key', async () => {
    const stop = vi.fn(async () => undefined);
    chainMocks.watchIncomingHints.mockResolvedValueOnce(stop);
    const capability = await ownerCapability();
    const getOwnerCapability = vi.fn(async () => capability);
    const { controller } = makeController({ getOwnerCapability });
    const onHint = vi.fn();

    await expect(controller.watchIncoming(onHint)).resolves.toBe(stop);

    expect(getOwnerCapability).toHaveBeenCalledWith(false);
    expect(chainMocks.watchIncomingHints).toHaveBeenCalledWith({
      capability,
      deployment: VERIFIED,
      onHint
    });
  });

  it('ensures a missing conversation with one owner transaction and caches its epoch key', async () => {
    const createTransaction = transaction('0xcreate');
    chainMocks.readConversation
      .mockResolvedValueOnce(missingConversation())
      .mockResolvedValue(conversation());
    chainMocks.createConversation.mockResolvedValue({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 1n
      },
      transaction: createTransaction
    });
    const { controller, getOwnerCapability, runOwnerTransactionFlow } = makeController();

    await expect(controller.ensure(BOB)).resolves.toMatchObject({
      created: true,
      transactionHash: '0xcreate',
      conversation: { currentEpoch: 1n }
    });
    await expect(controller.ensure(BOB)).resolves.toMatchObject({
      created: false,
      conversation: { currentEpoch: 1n }
    });

    expect(runOwnerTransactionFlow).toHaveBeenCalledTimes(2);
    expect(getOwnerCapability).toHaveBeenCalledWith(true);
    expect(chainMocks.createConversation).toHaveBeenCalledOnce();
    expect(createTransaction.wait).toHaveBeenCalledOnce();
    expect(chainMocks.parseConversationReceipt).toHaveBeenCalledOnce();
    expect(chainMocks.readConversation).toHaveBeenCalledWith(expect.objectContaining({
      blockTag: 100n
    }));
    expect(chainMocks.readEpochKey).toHaveBeenCalledOnce();
  });

  it('retries only the post-confirmation read when the receipt block is temporarily unavailable', async () => {
    const waitForPostConfirmationRead = vi.fn(async () => undefined);
    const createTransaction = transaction(ORIGINAL_TX_HASH, {
      status: 1,
      hash: ORIGINAL_TX_HASH
    });
    chainMocks.readConversation
      .mockResolvedValueOnce(missingConversation())
      .mockResolvedValueOnce(missingConversation())
      .mockResolvedValueOnce(missingConversation())
      .mockResolvedValueOnce(conversation());
    chainMocks.createConversation.mockResolvedValue({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 1n
      },
      transaction: createTransaction
    });
    const controller = createDirectChatV2Session({
      getOwnerCapability: vi.fn(async () => ownerCapability()),
      manifest: MANIFEST,
      ownerAddress: ALICE,
      retireNonceAttempt: vi.fn(),
      runOwnerTransactionFlow: ownerTransactionFlow(),
      waitForPostConfirmationRead
    });

    await expect(controller.ensure(BOB)).resolves.toMatchObject({ created: true });

    expect(chainMocks.createConversation).toHaveBeenCalledOnce();
    expect(createTransaction.wait).toHaveBeenCalledOnce();
    expect(waitForPostConfirmationRead).toHaveBeenNthCalledWith(1, 250);
    expect(waitForPostConfirmationRead).toHaveBeenNthCalledWith(2, 750);
  });

  it('rotates exactly one epoch and retains the result behind the owner flow', async () => {
    const rotateTransaction = transaction('0xrotate');
    chainMocks.readConversation
      .mockResolvedValueOnce(conversation(1n))
      .mockResolvedValueOnce(conversation(2n));
    chainMocks.rotateConversationKey.mockResolvedValue({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 2n
      },
      transaction: rotateTransaction
    });
    chainMocks.readEpochKey.mockResolvedValueOnce(epochKey(2n));
    const { controller, runOwnerTransactionFlow } = makeController();

    await expect(controller.rotate(BOB)).resolves.toMatchObject({
      previousEpoch: 1n,
      transactionHash: '0xrotate',
      conversation: { currentEpoch: 2n }
    });
    expect(runOwnerTransactionFlow).toHaveBeenCalledOnce();
    expect(rotateTransaction.wait).toHaveBeenCalledOnce();
    expect(chainMocks.readEpochKey).toHaveBeenCalledWith(expect.objectContaining({ epoch: 2n }));
  });

  it('uses the key for the confirmed new epoch on the next send', async () => {
    const rotateTransaction = transaction('0xrotate-new-epoch');
    const sendTransaction = transaction('0xsend-new-epoch', { status: 1, logs: [{}] });
    const event = messageEvent({ epoch: 2n, messageId: 3n });
    const oldKey = { ...epochKey(1n), value: 11n };
    const newKey = { ...epochKey(2n), value: 22n };
    chainMocks.readConversation
      .mockResolvedValueOnce(conversation(1n))
      .mockResolvedValueOnce(conversation(2n))
      .mockResolvedValue(conversation(2n));
    chainMocks.rotateConversationKey.mockResolvedValue({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 2n
      },
      transaction: rotateTransaction
    });
    chainMocks.readEpochKey.mockImplementation(async ({ epoch }: { epoch: bigint }) =>
      epoch === 2n ? newKey : oldKey
    );
    chainMocks.sendMessage.mockResolvedValue({
      encrypted: event.encrypted,
      context: event.context,
      transaction: sendTransaction
    });
    chainMocks.parseMessageReceipt.mockReturnValue(event);
    const { controller } = makeController();

    await expect(controller.rotate(BOB)).resolves.toMatchObject({
      previousEpoch: 1n,
      conversation: { currentEpoch: 2n }
    });
    await expect(controller.send(BOB, { body: 'after rotation' })).resolves.toMatchObject({
      event: { epoch: 2n }
    });

    expect(chainMocks.readEpochKey).toHaveBeenCalledTimes(1);
    expect(chainMocks.readEpochKey).toHaveBeenCalledWith(expect.objectContaining({ epoch: 2n }));
    expect(chainMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ key: newKey }));
    expect(chainMocks.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ key: oldKey }));
  });

  it('does not read or use a next-epoch key after a reverted rotation', async () => {
    const revertedRotation = transaction('0xrotate-reverted', { status: 0 });
    const sendTransaction = transaction('0xsend-current-epoch', { status: 1, logs: [{}] });
    const event = messageEvent({ epoch: 1n, messageId: 3n });
    const currentKey = { ...epochKey(1n), value: 11n };
    chainMocks.readConversation.mockResolvedValue(conversation(1n));
    chainMocks.rotateConversationKey.mockResolvedValue({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 2n
      },
      transaction: revertedRotation
    });
    chainMocks.readEpochKey.mockResolvedValue(currentKey);
    chainMocks.sendMessage.mockResolvedValue({
      encrypted: event.encrypted,
      context: event.context,
      transaction: sendTransaction
    });
    chainMocks.parseMessageReceipt.mockReturnValue(event);
    const { controller } = makeController();

    await expect(controller.rotate(BOB)).rejects.toThrow('did not succeed');
    expect(chainMocks.readEpochKey).not.toHaveBeenCalled();

    await expect(controller.send(BOB, { body: 'current epoch' })).resolves.toMatchObject({
      event: { epoch: 1n }
    });
    expect(chainMocks.readEpochKey).toHaveBeenCalledTimes(1);
    expect(chainMocks.readEpochKey).toHaveBeenCalledWith(expect.objectContaining({ epoch: 1n }));
    expect(chainMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ key: currentKey }));
  });

  it('does not cache a key when a confirmed rotation reports a mismatched current epoch', async () => {
    const rotateTransaction = transaction('0xrotate-mismatch');
    const sendTransaction = transaction('0xsend-observed-epoch', { status: 1, logs: [{}] });
    const event = messageEvent({ epoch: 3n, messageId: 3n });
    const observedKey = { ...epochKey(3n), value: 33n };
    chainMocks.readConversation
      .mockResolvedValueOnce(conversation(1n))
      .mockResolvedValueOnce(conversation(3n))
      .mockResolvedValue(conversation(3n));
    chainMocks.rotateConversationKey.mockResolvedValue({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 2n
      },
      transaction: rotateTransaction
    });
    chainMocks.readEpochKey.mockResolvedValue(observedKey);
    chainMocks.sendMessage.mockResolvedValue({
      encrypted: event.encrypted,
      context: event.context,
      transaction: sendTransaction
    });
    chainMocks.parseMessageReceipt.mockReturnValue(event);
    const { controller } = makeController();

    await expect(controller.rotate(BOB)).rejects.toThrow('expected next epoch');
    expect(chainMocks.readEpochKey).not.toHaveBeenCalled();

    await expect(controller.send(BOB, { body: 'observed epoch' })).resolves.toMatchObject({
      event: { epoch: 3n }
    });
    expect(chainMocks.readEpochKey).toHaveBeenCalledTimes(1);
    expect(chainMocks.readEpochKey).toHaveBeenCalledWith(expect.objectContaining({ epoch: 3n }));
    expect(chainMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ key: observedKey }));
  });

  it('reads an epoch key again after clearEpochKeys', async () => {
    const { controller } = makeController();
    const access = await controller.history(BOB);
    if (!access) throw new Error('Expected an existing V2 history scope.');
    const reference = {
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 1n
    };

    await expect(access.dependencies.resolveEpochKey(reference)).resolves.toEqual(epochKey(1n));
    await expect(access.dependencies.resolveEpochKey(reference)).resolves.toEqual(epochKey(1n));
    expect(chainMocks.readEpochKey).toHaveBeenCalledOnce();

    controller.clearEpochKeys();
    await expect(access.dependencies.resolveEpochKey(reference)).resolves.toEqual(epochKey(1n));
    expect(chainMocks.readEpochKey).toHaveBeenCalledTimes(2);
  });

  it('sends a versioned payload and binds the confirmed MessagePosted event to the submission', async () => {
    const sendTransaction = transaction('0xsend', { status: 1, logs: [{}] });
    const event = messageEvent({ messageId: 3n });
    chainMocks.parseMessageReceipt.mockReturnValue(event);
    chainMocks.sendMessage.mockImplementation(async ({ plaintext }) => {
      expect(JSON.parse(String(plaintext))).toEqual({
        v: 1,
        b: 'hello',
        r: '2',
        p: 'previous'
      });
      return {
        encrypted: event.encrypted,
        context: event.context,
        transaction: sendTransaction
      };
    });
    const assertCurrent = vi.fn(async () => undefined);
    const assertSnapshotCurrent = vi.fn(() => undefined);
    const capability = await ownerCapability({ assertCurrent, assertSnapshotCurrent });
    assertCurrent.mockClear();
    assertSnapshotCurrent.mockClear();
    const { controller, retireNonceAttempt, runOwnerTransactionFlow } = makeController({
      getOwnerCapability: vi.fn(async () => capability)
    });

    await expect(controller.send(BOB, {
      body: 'hello',
      replyToMessageId: 2n,
      replyPreview: 'previous',
      tip: 2n
    })).resolves.toMatchObject({
      event: { messageId: 3n },
      payload: { body: 'hello', replyToMessageId: 2n, replyPreview: 'previous' },
      submittedTransactionHash: '0xsend',
      transactionHash: '0xsend'
    });
    expect(runOwnerTransactionFlow).toHaveBeenCalledOnce();
    expect(chainMocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      key: epochKey(),
      retireNonceAttempt,
      tip: 2n
    }));
    expect(chainMocks.parseMessageReceipt).toHaveBeenCalledWith({
      deployment: VERIFIED,
      receipt: { status: 1, logs: [{}] },
      expected: {
        transactionHash: '0xsend',
        context: event.context,
        encrypted: event.encrypted
      }
    });
    expect(assertSnapshotCurrent).toHaveBeenCalledOnce();
    expect(assertCurrent).not.toHaveBeenCalled();
  });

  it('accepts exact repriced create and rotate transactions and returns their effective hashes', async () => {
    const rotateReplacementHash = `0x${'cc'.repeat(32)}`;
    const createTransaction = replacedTransaction({
      data: CHAT_INTERFACE.encodeFunctionData('createConversation', [BOB]),
      value: 0n
    });
    const rotateTransaction = replacedTransaction({
      data: CHAT_INTERFACE.encodeFunctionData('rotateConversationKey', [CONVERSATION_ID, 1n]),
      value: 0n,
      replacementHash: rotateReplacementHash
    });
    chainMocks.readConversation
      .mockResolvedValueOnce(conversation(1n))
      .mockResolvedValueOnce(conversation(1n))
      .mockResolvedValueOnce(conversation(2n));
    chainMocks.createConversation.mockResolvedValueOnce({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 1n
      },
      transaction: createTransaction
    });
    chainMocks.rotateConversationKey.mockResolvedValueOnce({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 2n
      },
      transaction: rotateTransaction
    });
    chainMocks.readEpochKey
      .mockResolvedValueOnce(epochKey(1n))
      .mockResolvedValueOnce(epochKey(2n));
    const { controller } = makeController();

    await expect(controller.create(BOB)).resolves.toMatchObject({
      created: true,
      transactionHash: REPLACEMENT_TX_HASH
    });
    await expect(controller.rotate(BOB)).resolves.toMatchObject({
      previousEpoch: 1n,
      transactionHash: rotateReplacementHash
    });
  });

  it('passes an exact repriced message hash into encrypted receipt verification', async () => {
    const event = messageEvent({ messageId: 3n });
    const replacement = replacedTransaction({
      data: CHAT_INTERFACE.encodeFunctionData('sendMessage', [
        event.context.conversationId,
        event.context.epoch,
        event.context.senderSequence,
        event.encrypted.nonce,
        event.encrypted.ciphertext,
        event.context.feeTaken
      ]),
      value: event.context.valueSent
    });
    chainMocks.sendMessage.mockResolvedValueOnce({
      encrypted: event.encrypted,
      context: event.context,
      transaction: replacement
    });
    chainMocks.parseMessageReceipt.mockReturnValueOnce({
      ...event,
      transactionHash: REPLACEMENT_TX_HASH
    });
    const { controller } = makeController();

    await expect(controller.send(BOB, { body: 'replacement-safe' })).resolves.toMatchObject({
      submittedTransactionHash: ORIGINAL_TX_HASH,
      transactionHash: REPLACEMENT_TX_HASH,
      event: { transactionHash: REPLACEMENT_TX_HASH }
    });
    expect(chainMocks.parseMessageReceipt).toHaveBeenCalledWith({
      deployment: VERIFIED,
      receipt: {
        status: 1,
        hash: REPLACEMENT_TX_HASH,
        logs: [{}]
      },
      expected: {
        transactionHash: REPLACEMENT_TX_HASH,
        context: event.context,
        encrypted: event.encrypted
      }
    });
  });

  it('rejects cancelled replacements and replacements that change message calldata', async () => {
    const event = messageEvent({ messageId: 3n });
    const correctData = CHAT_INTERFACE.encodeFunctionData('sendMessage', [
      event.context.conversationId,
      event.context.epoch,
      event.context.senderSequence,
      event.encrypted.nonce,
      event.encrypted.ciphertext,
      event.context.feeTaken
    ]);
    chainMocks.sendMessage
      .mockResolvedValueOnce({
        encrypted: event.encrypted,
        context: event.context,
        transaction: replacedTransaction({ data: '0x1234', value: event.context.valueSent })
      })
      .mockResolvedValueOnce({
        encrypted: event.encrypted,
        context: event.context,
        transaction: replacedTransaction({
          data: correctData,
          value: event.context.valueSent + 1n
        })
      })
      .mockResolvedValueOnce({
        encrypted: event.encrypted,
        context: event.context,
        transaction: replacedTransaction({
          data: correctData,
          value: event.context.valueSent,
          cancelled: true
        })
      });
    const { controller } = makeController();

    await expect(controller.send(BOB, { body: 'changed' })).rejects.toThrow('changed the submitted');
    await expect(controller.send(BOB, { body: 'wrong value' })).rejects.toThrow('wallet context');
    await expect(controller.send(BOB, { body: 'cancelled' })).rejects.toThrow('was cancelled');
    expect(chainMocks.parseMessageReceipt).not.toHaveBeenCalled();
  });
});
