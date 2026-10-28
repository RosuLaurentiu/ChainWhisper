import {
  BrowserProvider,
  Interface,
  JsonRpcProvider,
  keccak256,
  toUtf8Bytes,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  loadCotiEthersModule: vi.fn()
}));

vi.mock('./appShared/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appShared/core')>(),
  loadCotiEthersModule: coreMocks.loadCotiEthersModule
}));

import {
  DIRECT_CHAT_V2_CREATE_SELECTOR,
  DIRECT_CHAT_V2_ABI,
  DIRECT_CHAT_V2_CONVERSATION_CREATED_TOPIC,
  DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN,
  DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC,
  DIRECT_CHAT_V2_PROFILE_SYNC_FEATURES,
  DIRECT_CHAT_V2_REQUIRED_FEATURES,
  DIRECT_CHAT_V2_ROTATE_SELECTOR,
  DIRECT_CHAT_V2_WITHDRAW_SELECTOR,
  buildDirectChatV2MessageKey,
  bindDirectChatV2MetaMaskCapability,
  canReactToDirectChatV2Message,
  clearDirectChatV2ContactSettings,
  createDirectChatV2Conversation,
  decryptDirectChatV2SeedEnvelope,
  parseDirectChatV2ConversationCreatedReceipt,
  parseDirectChatV2MessagePostedLog,
  parseDirectChatV2MessageReceipt,
  normalizeDirectChatV2Nickname,
  readDirectChatV2CanonicalBlock,
  readDirectChatV2ContactSettings,
  readDirectChatV2ConversationPreviewPage,
  readDirectChatV2NativeCredit,
  readDirectChatV2Nickname,
  readDirectChatV2Conversation,
  readDirectChatV2ConversationMessageCountAtBlock,
  readDirectChatV2EpochMetadata,
  readDirectChatV2EpochKey,
  readDirectChatV2IncomingMessageLogPage,
  readDirectChatV2LatestBlockNumber,
  readDirectChatV2MessageLogPage,
  releaseDirectChatV2MetaMaskCapability,
  rotateDirectChatV2ConversationKey,
  sendDirectChatV2Message,
  setDirectChatV2Nickname,
  setDirectChatV2ContactSettings,
  signDirectChatV2ImageSessionAuthorization,
  supportsDirectChatV2ProfileSync,
  assertDirectChatV2MetaMaskCapabilityCurrent,
  assertDirectChatV2MetaMaskCapabilitySnapshotCurrent,
  verifyDirectChatV2Contract,
  watchDirectChatV2IncomingMessageHints,
  watchDirectChatV2MessageHints,
  withdrawDirectChatV2NativeCredit,
  type DirectChatV2DeploymentManifest,
  type DirectChatV2EpochKey,
  type DirectChatV2MetaMaskCapability,
  type DirectChatV2NonceAttempt,
  type VerifiedDirectChatV2Deployment
} from './directChatV2Chain';
import {
  decryptDirectChatV2Message,
  deriveDirectChatV2AadHash,
  deriveDirectChatV2ConversationId
} from './directChatV2Crypto';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CHAT = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 7_089n;
const DEPLOYMENT_BLOCK = 99n;
const RUNTIME_BYTECODE = '0x6001';
const RUNTIME_BYTECODE_HASH = keccak256(RUNTIME_BYTECODE);
const MANIFEST = {
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  deploymentBlock: DEPLOYMENT_BLOCK,
  runtimeBytecodeHash: RUNTIME_BYTECODE_HASH
} satisfies DirectChatV2DeploymentManifest;
const REQUIRED_FEATURE_HASHES = new Set(
  DIRECT_CHAT_V2_REQUIRED_FEATURES.map((feature) => keccak256(toUtf8Bytes(feature)).toLowerCase())
);
const PROFILE_SYNC_FEATURE_HASHES = new Set(
  DIRECT_CHAT_V2_PROFILE_SYNC_FEATURES.map((feature) =>
    keccak256(toUtf8Bytes(feature)).toLowerCase()
  )
);
const CONVERSATION_ID = deriveDirectChatV2ConversationId({
  chainId: CHAIN_ID,
  contractAddress: CHAT,
  participantA: ALICE,
  participantB: BOB
});

const makeBrowserProvider = (chainId = CHAIN_ID): BrowserProvider => {
  const provider = new BrowserProvider({
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      if (method === 'eth_accounts') return [ALICE];
      return null;
    })
  }, {
    chainId: Number(chainId),
    name: 'Direct Chat V2 test'
  });
  provider.getCode = vi.fn(async () => RUNTIME_BYTECODE);
  provider.getLogs = vi.fn(async () => []);
  return provider;
};

const makeSigner = ({
  aesKey = 'test-aes-key',
  browserProvider = makeBrowserProvider(),
  decryptedValue,
  encryptedValue,
  ownerAddress = ALICE
}: {
  aesKey?: string | null;
  browserProvider?: BrowserProvider;
  decryptedValue?: unknown;
  encryptedValue?: unknown;
  ownerAddress?: string;
} = {}) => ({
  provider: browserProvider,
  getAddress: vi.fn(async () => ownerAddress),
  sendUncheckedTransaction: vi.fn(),
  getUserOnboardInfo: vi.fn(() => aesKey ? { aesKey } : undefined),
  encryptValue: vi.fn(async () => encryptedValue ?? {
    ciphertext: { value: [101n] },
    signature: ['0x1234']
  }),
  signMessage: vi.fn(async () => `0x${'aa'.repeat(65)}`),
  decryptValue: vi.fn(async (value: unknown) =>
    decryptedValue !== undefined ? decryptedValue : BigInt(value as bigint) - 1_000n
  )
}) as unknown as JsonRpcSigner;

const bindSigner = async (
  signer = makeSigner(),
  assertCurrent = vi.fn(async () => undefined),
  readProvider = signer.provider as BrowserProvider,
  assertSnapshotCurrent?: () => void
): Promise<DirectChatV2MetaMaskCapability> => bindDirectChatV2MetaMaskCapability({
  signer,
  browserProvider: signer.provider as BrowserProvider,
  readProvider,
  ownerAddress: ALICE,
  chainId: CHAIN_ID,
  assertCurrent,
  assertSnapshotCurrent
});

const installContract = (contract: Record<string, unknown>) => {
  const Contract = vi.fn(function MockContract() {
    return contract;
  });
  coreMocks.loadCotiEthersModule.mockResolvedValue({ Contract } as never);
  return Contract;
};

const verifierSurface = () => ({
  contractVersion: vi.fn(async () => 'ChainWhisperChatV2'),
  PROTOCOL_VERSION: vi.fn(async () => 2n),
  MIN_MESSAGE_CIPHERTEXT_BYTES: vi.fn(async () => 16n),
  MAX_MESSAGE_CIPHERTEXT_BYTES: vi.fn(async () => 4_096n),
  deploymentBlock: vi.fn(async () => DEPLOYMENT_BLOCK),
  supportsFeature: vi.fn(async (feature: string) => REQUIRED_FEATURE_HASHES.has(feature.toLowerCase()))
});

const installVerifiedContract = async (
  contract: Record<string, unknown>,
  signer = makeSigner(),
  readProvider = signer.provider as BrowserProvider,
  assertCurrent = vi.fn(async () => undefined),
  assertSnapshotCurrent?: () => void
): Promise<{
  capability: DirectChatV2MetaMaskCapability;
  signer: JsonRpcSigner;
  contract: Record<string, unknown>;
  deployment: VerifiedDirectChatV2Deployment;
}> => {
  const installed = { ...verifierSurface(), ...contract };
  installContract(installed);
  const capability = await bindSigner(signer, assertCurrent, readProvider, assertSnapshotCurrent);
  const deployment = await verifyDirectChatV2Contract({ capability, manifest: MANIFEST });
  return { capability, signer, contract: installed, deployment };
};

const existingConversation = {
  exists: true,
  participantA: ALICE,
  participantB: BOB,
  currentEpoch: 3n,
  messageCount: 7n,
  createdAt: 1n,
  lastMessageAt: 2n,
  createdBlock: 3n,
  firstMessageBlock: 4n,
  lastMessageBlock: 5n
};

describe('directChatV2Chain', () => {
  it('bounds startup getter production while retaining every verifier read', async () => {
    let pending = 0, maximumPending = 0, reads = 0;
    const surface = Object.fromEntries(Object.entries(verifierSurface()).map(([name, read]) => [name,
      async (...args: unknown[]) => {
        reads++; maximumPending = Math.max(maximumPending, ++pending);
        await Promise.resolve();
        try { return await Reflect.apply(read, undefined, args); } finally { pending--; }
      }
    ]));
    const { deployment } = await installVerifiedContract(surface);
    expect(deployment.contractAddress).toBe(CHAT.toLowerCase());
    expect(reads).toBe(17);
    expect(maximumPending).toBe(1);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('freezes the zero-private-input setup and rotation selectors', () => {
    expect(DIRECT_CHAT_V2_CREATE_SELECTOR).toBe('0xce500a55');
    expect(DIRECT_CHAT_V2_ROTATE_SELECTOR).toBe('0xb863d2e5');
    expect(DIRECT_CHAT_V2_WITHDRAW_SELECTOR).toBe('0x23d09d05');
  });

  it('revokes a retired wallet capability without destroying the shared provider', async () => {
    const browserProvider = makeBrowserProvider();
    const capability = await bindSigner(makeSigner({ browserProvider }));

    releaseDirectChatV2MetaMaskCapability(capability);

    expect(browserProvider.destroyed).toBe(false);
    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).rejects.toThrow('current owner browser-wallet session capability');
  });

  it('uses the event-backed snapshot for intermediate checks without another live wallet RPC', async () => {
    const assertCurrent = vi.fn(async () => undefined);
    const assertSnapshotCurrent = vi.fn(() => undefined);
    const capability = await bindSigner(
      makeSigner(),
      assertCurrent,
      undefined,
      assertSnapshotCurrent
    );
    assertCurrent.mockClear();
    assertSnapshotCurrent.mockClear();

    await expect(assertDirectChatV2MetaMaskCapabilitySnapshotCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).resolves.toBeUndefined();
    expect(assertSnapshotCurrent).toHaveBeenCalledOnce();
    expect(assertCurrent).not.toHaveBeenCalled();
  });

  it('signs only an exact owner-and-chain-bound image upload session authorization', async () => {
    const signer = makeSigner();
    const capability = await bindSigner(signer);
    const message = [
      'ChainWhisper Chat Image Upload Session',
      'version:1',
      'audience:https://example.supabase.co/functions/v1/chat-image-session',
      `chainId:0x${CHAIN_ID.toString(16)}`,
      `owner:${ALICE.toLowerCase()}`,
      `nonce:${'ab'.repeat(32)}`,
      'issuedAt:1700000000',
      'expiresAt:1700000900'
    ].join('\n');

    await expect(signDirectChatV2ImageSessionAuthorization({ capability, message }))
      .resolves.toBe(`0x${'aa'.repeat(65)}`);
    expect(signer.signMessage).toHaveBeenCalledWith(message);
    await expect(signDirectChatV2ImageSessionAuthorization({
      capability,
      message: message.replace(ALICE.toLowerCase(), BOB.toLowerCase())
    })).rejects.toThrow(/malformed image-session/i);
    expect(signer.signMessage).toHaveBeenCalledOnce();
  });

  it('binds latest, canonical, and historical count reads to the verified deployment', async () => {
    const browserProvider = makeBrowserProvider();
    browserProvider.getBlockNumber = vi.fn(async () => 123);
    browserProvider.getBlock = vi.fn(async (blockNumber) => ({
      number: Number(blockNumber),
      hash: `0x${'12'.repeat(32)}`,
      timestamp: 456
    }) as never);
    const getConversation = vi.fn(async () => existingConversation);
    const isParticipant = vi.fn(async () => true);
    const { capability, deployment } = await installVerifiedContract({
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant,
      getConversation
    }, makeSigner({ browserProvider }));

    await expect(readDirectChatV2LatestBlockNumber({ capability, deployment }))
      .resolves.toBe(123n);
    await expect(readDirectChatV2CanonicalBlock({
      capability,
      deployment,
      blockNumber: 100n
    })).resolves.toEqual({
      number: 100n,
      hash: `0x${'12'.repeat(32)}`,
      timestamp: 456
    });
    await expect(readDirectChatV2ConversationMessageCountAtBlock({
      capability,
      deployment,
      peer: BOB,
      blockNumber: 100n
    })).resolves.toBe(7n);
    expect(getConversation).toHaveBeenCalledWith(CONVERSATION_ID);

    isParticipant.mockResolvedValueOnce(false);
    await expect(readDirectChatV2ConversationMessageCountAtBlock({
      capability,
      deployment,
      peer: BOB,
      blockNumber: 100n
    })).resolves.toBe(0n);
    const nonce = '0x0102030405060708090a0b0c';
    const context = {
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 3n,
      participantA: ALICE,
      participantB: BOB,
      sender: ALICE,
      recipient: BOB,
      senderSequence: 3n,
      valueSent: 0n,
      feeTaken: 0n
    } as const;
    const messageEvent = new Interface(DIRECT_CHAT_V2_ABI).getEvent('MessagePosted');
    if (!messageEvent) throw new Error('MessagePosted event is unavailable.');
    const finalizedMessage = new Interface(DIRECT_CHAT_V2_ABI).encodeEventLog(messageEvent, [
      CONVERSATION_ID,
      ALICE,
      BOB,
      6n,
      3n,
      3n,
      nonce,
      deriveDirectChatV2AadHash(context, nonce),
      `0x${'ab'.repeat(16)}`,
      0n,
      0n
    ]);
    vi.mocked(browserProvider.getLogs).mockResolvedValueOnce([{
      address: CHAT,
      topics: finalizedMessage.topics,
      data: finalizedMessage.data,
      transactionHash: `0x${'44'.repeat(32)}`,
      blockHash: `0x${'55'.repeat(32)}`,
      blockNumber: 100,
      index: 2,
      removed: false
    }] as never);
    getConversation.mockResolvedValueOnce({ ...existingConversation, messageCount: 7n, lastMessageBlock: 101n });
    await expect(readDirectChatV2ConversationMessageCountAtBlock({
      capability,
      deployment,
      peer: BOB,
      blockNumber: 100n
    })).resolves.toBe(6n);
    expect(browserProvider.getLogs).toHaveBeenCalledWith({
      address: CHAT,
      fromBlock: Number(DEPLOYMENT_BLOCK),
      toBlock: 100,
      topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, CONVERSATION_ID]
    });
    await expect(readDirectChatV2ConversationMessageCountAtBlock({
      capability,
      deployment,
      peer: BOB,
      blockNumber: DEPLOYMENT_BLOCK - 1n
    })).rejects.toThrow('verified deployment history');
  });

  it('uses conversation-filtered events only as current-session replay hints', async () => {
    vi.useFakeTimers();
    const browserProvider = makeBrowserProvider();
    const readProvider = makeBrowserProvider();
    readProvider.getBlockNumber = vi.fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(101) as never;
    readProvider.getLogs = vi.fn(async () => [{
      address: CHAT,
      topics: [],
      data: '0x',
      transactionHash: `0x${'44'.repeat(32)}`,
      blockHash: `0x${'55'.repeat(32)}`,
      blockNumber: 101,
      index: 2,
      removed: false
    }]) as never;
    const { capability, deployment } = await installVerifiedContract({
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => true),
      getConversation: vi.fn(async () => existingConversation)
    }, makeSigner({ browserProvider }), readProvider);
    const onHint = vi.fn();

    const stop = await watchDirectChatV2MessageHints({
      capability,
      deployment,
      peer: BOB,
      onHint
    });

    expect(stop).not.toBeNull();
    const messageEvent = new Interface(DIRECT_CHAT_V2_ABI).getEvent('MessagePosted');
    if (!messageEvent) throw new Error('MessagePosted event is unavailable.');
    const nonce = '0x0102030405060708090a0b0c';
    const encoded = new Interface(DIRECT_CHAT_V2_ABI).encodeEventLog(messageEvent, [
      CONVERSATION_ID, BOB, ALICE, 8n, 3n, 4n, nonce,
      deriveDirectChatV2AadHash({
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 3n,
        participantA: ALICE,
        participantB: BOB,
        sender: BOB,
        recipient: ALICE,
        senderSequence: 4n,
        valueSent: 0n,
        feeTaken: 0n
      }, nonce),
      `0x${'ab'.repeat(16)}`, 0n, 0n
    ]);
    vi.mocked(readProvider.getLogs).mockResolvedValueOnce([{
      address: CHAT,
      topics: encoded.topics,
      data: encoded.data,
      transactionHash: `0x${'44'.repeat(32)}`,
      blockHash: `0x${'55'.repeat(32)}`,
      blockNumber: 101,
      index: 2,
      removed: false
    }] as never);
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() => expect(onHint).toHaveBeenCalledOnce());
    expect(readProvider.getLogs).toHaveBeenCalledWith({
      address: CHAT,
      fromBlock: 101,
      toBlock: 101,
      topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, CONVERSATION_ID]
    });
    await stop?.();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(onHint).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('discovers incoming and outgoing peers through owner-filtered hints without trusting them as history', async () => {
    vi.useFakeTimers();
    const browserProvider = makeBrowserProvider();
    browserProvider.getBlockNumber = vi.fn()
      .mockResolvedValueOnce(99)
      .mockResolvedValueOnce(100) as never;
    const { capability, deployment } = await installVerifiedContract(
      {},
      makeSigner({ browserProvider })
    );
    const nonce = '0x0102030405060708090a0b0c';
    const context = {
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 3n,
      participantA: ALICE,
      participantB: BOB,
      sender: BOB,
      recipient: ALICE,
      senderSequence: 4n,
      valueSent: 0n,
      feeTaken: 0n
    } as const;
    const aadHash = deriveDirectChatV2AadHash(context, nonce);
    const iface = new Interface(DIRECT_CHAT_V2_ABI);
    const messageEvent = iface.getEvent('MessagePosted');
    if (!messageEvent) throw new Error('MessagePosted event is unavailable.');
    const encoded = iface.encodeEventLog(messageEvent, [
      CONVERSATION_ID,
      BOB,
      ALICE,
      8n,
      3n,
      4n,
      nonce,
      aadHash,
      `0x${'ab'.repeat(16)}`,
      0n,
      0n
    ]);
    const log = {
      address: CHAT,
      topics: encoded.topics,
      data: encoded.data,
      transactionHash: `0x${'44'.repeat(32)}`,
      blockHash: `0x${'55'.repeat(32)}`,
      blockNumber: 100,
      index: 2,
      removed: false
    };
    const onHint = vi.fn();

    const stop = await watchDirectChatV2IncomingMessageHints({
      capability,
      deployment,
      onHint
    });

    const outgoing = iface.encodeEventLog(messageEvent, [
      CONVERSATION_ID,
      ALICE,
      BOB,
      9n,
      3n,
      5n,
      nonce,
      deriveDirectChatV2AadHash({
        ...context,
        sender: ALICE,
        recipient: BOB,
        senderSequence: 5n
      }, nonce),
      `0x${'cd'.repeat(16)}`,
      0n,
      0n
    ]);
    const outgoingLog = {
      ...log,
      topics: outgoing.topics,
      data: outgoing.data,
      transactionHash: `0x${'66'.repeat(32)}`,
      logIndex: 3,
      index: 3
    };
    vi.mocked(browserProvider.getLogs)
      .mockResolvedValueOnce([log] as never)
      .mockResolvedValueOnce([outgoingLog] as never);
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() => expect(onHint).toHaveBeenCalledOnce());
    expect(onHint).toHaveBeenCalledWith(BOB);
    await stop();
    vi.useRealTimers();

    vi.mocked(browserProvider.getLogs)
      .mockResolvedValueOnce([log] as never)
      .mockResolvedValueOnce([outgoingLog] as never);
    await expect(readDirectChatV2IncomingMessageLogPage({
      capability,
      deployment,
      fromBlock: DEPLOYMENT_BLOCK,
      toBlock: 100n
    })).resolves.toMatchObject([
      { sender: BOB, recipient: ALICE, messageId: 8n },
      { sender: ALICE, recipient: BOB, messageId: 9n }
    ]);
    expect(browserProvider.getLogs).toHaveBeenCalledWith({
      address: CHAT,
      fromBlock: Number(DEPLOYMENT_BLOCK),
      toBlock: 100,
      topics: [
        DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC,
        null,
        null,
        `0x${ALICE.slice(2).padStart(64, '0')}`
      ]
    });
    expect(browserProvider.getLogs).toHaveBeenCalledWith({
      address: CHAT,
      fromBlock: Number(DEPLOYMENT_BLOCK),
      toBlock: 100,
      topics: [
        DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC,
        null,
        `0x${ALICE.slice(2).padStart(64, '0')}`,
        null
      ]
    });
  });

  it('issues only an exact, live BrowserProvider session capability', async () => {
    let current = true;
    const assertCurrent = vi.fn(async () => {
      if (!current) throw new Error('owner wallet lease expired');
    });
    const browserProvider = makeBrowserProvider();
    const signer = makeSigner({ browserProvider });
    const capability = await bindDirectChatV2MetaMaskCapability({
      signer,
      browserProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent
    });

    expect(Object.isFrozen(capability)).toBe(true);
    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).resolves.toBeUndefined();
    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability: Object.freeze({ ...capability }) as DirectChatV2MetaMaskCapability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).rejects.toThrow('session capability');

    const differentProvider = makeBrowserProvider();
    await expect(bindDirectChatV2MetaMaskCapability({
      signer,
      browserProvider: differentProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent
    })).rejects.toThrow('exact COTI BrowserProvider');

    const genericProvider = new JsonRpcProvider();
    await expect(bindDirectChatV2MetaMaskCapability({
      signer: { ...signer, provider: genericProvider } as unknown as JsonRpcSigner,
      browserProvider: genericProvider as unknown as BrowserProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent
    })).rejects.toThrow('exact COTI BrowserProvider');

    await expect(bindDirectChatV2MetaMaskCapability({
      signer: { ...signer, privateKey: `0x${'99'.repeat(32)}` } as unknown as JsonRpcSigner,
      browserProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent
    })).rejects.toThrow('exact COTI BrowserProvider');
    await expect(bindDirectChatV2MetaMaskCapability({
      signer: makeSigner({ browserProvider, ownerAddress: BOB }),
      browserProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent
    })).rejects.toThrow('account or chain changed');
    await expect(bindDirectChatV2MetaMaskCapability({
      signer,
      browserProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID + 1n,
      assertCurrent
    })).rejects.toThrow('account or chain changed');

    current = false;
    await expect(assertDirectChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).rejects.toThrow('lease expired');
  });

  it('binds activation to the exact runtime hash, chain, block, and V2 feature surface', async () => {
    const capability = await bindSigner();
    const surface = verifierSurface();
    installContract(surface);

    await expect(verifyDirectChatV2Contract({
      capability: Object.freeze({}) as DirectChatV2MetaMaskCapability,
      manifest: MANIFEST
    })).rejects.toThrow('session capability');

    await expect(
      verifyDirectChatV2Contract({
        capability,
        manifest: { ...MANIFEST, runtimeBytecodeHash: `0x${'11'.repeat(32)}` }
      })
    ).rejects.toThrow('runtime bytecode');

    await expect(
      verifyDirectChatV2Contract({ capability, manifest: MANIFEST })
    ).resolves.toEqual(MANIFEST);
    expect(surface.supportsFeature).toHaveBeenCalledTimes(
      DIRECT_CHAT_V2_REQUIRED_FEATURES.length + DIRECT_CHAT_V2_PROFILE_SYNC_FEATURES.length + 1
    );
  });

  it('rejects an unverified or forged deployment handle before any chat read', async () => {
    const capability = await bindSigner();
    await expect(
      readDirectChatV2Conversation({
        capability,
        deployment: MANIFEST as VerifiedDirectChatV2Deployment,
        peer: BOB
      })
    ).rejects.toThrow('Verify the exact');
  });

  it('attests optional on-chain names and indexed conversation previews without breaking the older candidate', async () => {
    const setMyNickname = vi.fn(async () => ({
      hash: `0x${'91'.repeat(32)}`,
      wait: vi.fn(async () => ({ status: 1 }))
    }));
    const nickname = vi.fn(async () => 'Alice');
    const getParticipantConversationPage = vi.fn(async () => ({
      previews: [{
        conversationId: CONVERSATION_ID,
        peer: BOB,
        currentEpoch: 3n,
        messageCount: 7n,
        createdAt: 10n,
        lastMessageAt: 11n,
        createdBlock: 12n,
        firstMessageBlock: 13n,
        lastMessageBlock: 14n
      }],
      nextBeforeIndex: 0n
    }));
    const { capability, deployment } = await installVerifiedContract({
      supportsFeature: vi.fn(async (feature: string) =>
        REQUIRED_FEATURE_HASHES.has(feature.toLowerCase()) ||
        PROFILE_SYNC_FEATURE_HASHES.has(feature.toLowerCase())
      ),
      NICKNAME_MAX_BYTES: vi.fn(async () => 32n),
      MAX_CONVERSATION_PAGE_SIZE: vi.fn(async () => 50n),
      MAX_CONTACT_SETTINGS_CELLS: vi.fn(async () => 5n),
      nicknames: nickname,
      setMyNickname,
      getParticipantConversationPage
    });

    expect(supportsDirectChatV2ProfileSync(deployment)).toBe(true);
    expect(normalizeDirectChatV2Nickname('  Alice  ')).toBe('Alice');
    expect(() => normalizeDirectChatV2Nickname('Alice & Bob')).toThrow('unsupported');
    await expect(readDirectChatV2Nickname({ capability, deployment, account: ALICE }))
      .resolves.toBe('Alice');
    await expect(setDirectChatV2Nickname({ capability, deployment, nickname: ' Alice ' }))
      .resolves.toMatchObject({ nickname: 'Alice' });
    expect(setMyNickname).toHaveBeenCalledWith('Alice');
    await expect(readDirectChatV2ConversationPreviewPage({
      capability,
      deployment,
      limit: 10n
    })).resolves.toMatchObject({
      previews: [{ conversationId: CONVERSATION_ID, peer: BOB, messageCount: 7n }],
      nextBeforeIndex: 0n
    });
    expect(getParticipantConversationPage).toHaveBeenCalledWith(ALICE, (1n << 256n) - 1n, 10n);
  });

  it('decrypts one COTI uint128 envelope only after explicit device key recovery', async () => {
    const signer = makeSigner();
    const capability = await bindSigner(signer);
    await expect(
      decryptDirectChatV2SeedEnvelope({ capability, seedCiphertext: 1_007n })
    ).resolves.toEqual({ value: 7n });

    const lockedSigner = makeSigner({ aesKey: null });
    const lockedCapability = await bindSigner(lockedSigner);
    await expect(
      decryptDirectChatV2SeedEnvelope({ capability: lockedCapability, seedCiphertext: 1_007n })
    ).rejects.toThrow('Unlock or recover');
    expect(lockedSigner.decryptValue).not.toHaveBeenCalled();

    const oversizedSigner = makeSigner({ decryptedValue: 1n << 128n });
    const oversizedCapability = await bindSigner(oversizedSigner);
    await expect(
      decryptDirectChatV2SeedEnvelope({ capability: oversizedCapability, seedCiphertext: 1n })
    ).rejects.toThrow('uint128');
  });

  it('reads, updates, and clears one owner-private contact settings record', async () => {
    const signer = makeSigner({
      decryptedValue: '11Private Bob',
      encryptedValue: {
        ciphertext: { value: [111n, 222n] },
        signature: ['0xaa', '0xbb']
      }
    });
    const getMyContactSettings = vi.fn(async () => ({
      exists: true,
      revision: 4n,
      encryptedSettings: { value: [9n, 10n] }
    }));
    const setMyContactSettings = vi.fn(async () => ({
      hash: `0x${'92'.repeat(32)}`,
      wait: vi.fn(async () => ({ status: 1 }))
    }));
    const clearMyContactSettings = vi.fn(async () => ({
      hash: `0x${'93'.repeat(32)}`,
      wait: vi.fn(async () => ({ status: 1 }))
    }));
    const { capability, deployment } = await installVerifiedContract({
      supportsFeature: vi.fn(async (feature: string) =>
        REQUIRED_FEATURE_HASHES.has(feature.toLowerCase()) ||
        PROFILE_SYNC_FEATURE_HASHES.has(feature.toLowerCase())
      ),
      NICKNAME_MAX_BYTES: vi.fn(async () => 32n),
      MAX_CONVERSATION_PAGE_SIZE: vi.fn(async () => 50n),
      MAX_CONTACT_SETTINGS_CELLS: vi.fn(async () => 5n),
      getMyContactSettings,
      setMyContactSettings,
      clearMyContactSettings
    }, signer);

    await expect(readDirectChatV2ContactSettings({ capability, deployment, contact: BOB }))
      .resolves.toEqual({
        exists: true,
        revision: 4n,
        settings: { savedName: 'Private Bob', hidden: true }
      });
    const submitted = await setDirectChatV2ContactSettings({
      capability,
      deployment,
      contact: BOB,
      expectedRevision: 4n,
      settings: { savedName: 'Private Bob', hidden: true }
    });
    expect(submitted.encryptedSettings).toEqual([[[111n, 222n]], ['0xaa', '0xbb']]);
    expect(setMyContactSettings).toHaveBeenCalledWith(
      BOB,
      4n,
      [[[111n, 222n]], ['0xaa', '0xbb']]
    );
    await clearDirectChatV2ContactSettings({
      capability,
      deployment,
      contact: BOB,
      expectedRevision: 5n
    });
    expect(clearMyContactSettings).toHaveBeenCalledWith(BOB, 5n);
  });

  it('creates and rotates using one transaction each and no private-input signature prompts', async () => {
    const createWait = vi.fn(async () => ({ status: 1 }));
    const rotateWait = vi.fn(async () => ({ status: 1 }));
    let exists = false;
    const chat = {
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => exists),
      getConversation: vi.fn(async () => existingConversation),
      createConversation: vi.fn(async () => {
        exists = true;
        return { hash: '0xcreate', wait: createWait };
      }),
      rotateConversationKey: vi.fn(async () => ({ hash: '0xrotate', wait: rotateWait }))
    };
    const { capability, signer, deployment } = await installVerifiedContract(chat);

    const created = await createDirectChatV2Conversation({ capability, deployment, peer: BOB });
    expect(signer.encryptValue).not.toHaveBeenCalled();
    expect(chat.createConversation).toHaveBeenCalledWith(BOB);
    expect(created).toMatchObject({
      reference: {
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 1n
      },
      transaction: { txHash: '0xcreate' }
    });

    const rotated = await rotateDirectChatV2ConversationKey({ capability, deployment, peer: BOB });
    expect(signer.encryptValue).not.toHaveBeenCalled();
    expect(chat.rotateConversationKey).toHaveBeenCalledWith(CONVERSATION_ID, 3n);
    expect(rotated.reference.epoch).toBe(4n);
    expect(rotated.transaction.txHash).toBe('0xrotate');
  });

  it('pins a post-receipt conversation read to the confirmed block', async () => {
    const chat = {
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => true),
      getConversation: vi.fn(async () => existingConversation)
    };
    const { capability, deployment } = await installVerifiedContract(chat);

    await expect(readDirectChatV2Conversation({
      capability,
      deployment,
      peer: BOB,
      blockTag: 100n
    })).resolves.toMatchObject({ exists: true, conversationId: CONVERSATION_ID });

    expect(chat.conversationIdFor).toHaveBeenCalledWith(ALICE, BOB, { blockTag: 100 });
    expect(chat.isParticipant).toHaveBeenCalledWith(CONVERSATION_ID, ALICE, { blockTag: 100 });
    expect(chat.getConversation).toHaveBeenCalledWith(CONVERSATION_ID, { blockTag: 100 });
  });

  it('recovers a COTI-delivered epoch key without a chat transaction when the device key is unlocked', async () => {
    const chat = {
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => true),
      getConversation: vi.fn(async () => existingConversation),
      getMyEpochEnvelope: vi.fn(async () => 1_007n)
    };
    const { capability, signer, deployment } = await installVerifiedContract(chat);

    await expect(
      readDirectChatV2EpochKey({ capability, deployment, peer: BOB })
    ).resolves.toEqual({
      value: 7n,
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 3n
    });
    expect(chat.getMyEpochEnvelope).toHaveBeenCalledWith(
      CONVERSATION_ID,
      3n,
      { from: ALICE }
    );
    expect(signer.encryptValue).not.toHaveBeenCalled();
  });

  it('reads attested historical epoch metadata without decrypting or submitting a transaction', async () => {
    const chat = {
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => true),
      getConversation: vi.fn(async () => existingConversation),
      getEpochMetadata: vi.fn(async () => ({
        exists: true,
        rotatedBy: BOB,
        createdAt: 123n
      }))
    };
    const { capability, signer, deployment } = await installVerifiedContract(chat);

    await expect(
      readDirectChatV2EpochMetadata({ capability, deployment, peer: BOB, epoch: 2n })
    ).resolves.toEqual({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 2n,
      rotatedBy: BOB,
      createdAt: 123n
    });
    expect(chat.getEpochMetadata).toHaveBeenCalledWith(CONVERSATION_ID, 2n);
    expect(signer.decryptValue).not.toHaveBeenCalled();
  });

  it('checks the deployed reaction authorization surface with the stable message ID', async () => {
    const chat = {
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => true),
      getConversation: vi.fn(async () => existingConversation),
      canReact: vi.fn(async () => true)
    };
    const { capability, deployment } = await installVerifiedContract(chat);

    await expect(
      canReactToDirectChatV2Message({ capability, deployment, peer: BOB, messageId: 7n })
    ).resolves.toBe(true);
    expect(chat.canReact).toHaveBeenCalledWith(CONVERSATION_ID, 7n, ALICE);
  });

  it('reads and withdraws pull-based native tips without bypassing deployment verification', async () => {
    const wait = vi.fn(async () => ({ status: 1 }));
    const chat = {
      pendingNativeCredits: vi.fn(async () => 12n),
      withdrawNativeCredit: vi.fn(async () => ({ hash: '0xwithdraw', wait }))
    };
    const { capability, deployment } = await installVerifiedContract(chat);

    await expect(readDirectChatV2NativeCredit({ capability, deployment })).resolves.toBe(12n);
    await expect(withdrawDirectChatV2NativeCredit({ capability, deployment })).resolves.toMatchObject({
      observedCredit: 12n,
      transaction: { txHash: '0xwithdraw' }
    });
    expect(chat.pendingNativeCredits).toHaveBeenCalledWith(ALICE);
    expect(chat.withdrawNativeCredit).toHaveBeenCalledOnce();

    chat.pendingNativeCredits.mockResolvedValueOnce(0n);
    await expect(
      withdrawDirectChatV2NativeCredit({ capability, deployment })
    ).rejects.toThrow('no pending native');
    expect(chat.withdrawNativeCredit).toHaveBeenCalledOnce();
  });

  it('binds a confirmed ConversationCreated receipt to the exact wallet pair and block', async () => {
    const { deployment } = await installVerifiedContract({});
    const iface = new Interface(DIRECT_CHAT_V2_ABI);
    const event = iface.getEvent('ConversationCreated');
    if (!event) throw new Error('ConversationCreated event is unavailable.');
    const encoded = iface.encodeEventLog(event, [
      CONVERSATION_ID,
      ALICE,
      BOB,
      ALICE,
      1n
    ]);
    const log = {
      address: CHAT,
      topics: encoded.topics,
      data: encoded.data,
      transactionHash: `0x${'41'.repeat(32)}`,
      blockHash: `0x${'42'.repeat(32)}`,
      blockNumber: 100,
      index: 3,
      removed: false
    };
    const receipt = {
      status: 1,
      hash: log.transactionHash,
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      logs: [log]
    };
    const expected = {
      transactionHash: log.transactionHash,
      conversationId: CONVERSATION_ID,
      ownerAddress: ALICE,
      peer: BOB,
      epoch: 1n
    };

    expect(DIRECT_CHAT_V2_CONVERSATION_CREATED_TOPIC).toBe(encoded.topics[0]);
    expect(parseDirectChatV2ConversationCreatedReceipt({
      deployment,
      receipt,
      expected
    })).toMatchObject({
      conversationId: CONVERSATION_ID,
      participantA: ALICE,
      participantB: BOB,
      createdBy: ALICE,
      epoch: 1n,
      transactionHash: log.transactionHash,
      blockHash: log.blockHash,
      blockNumber: 100n,
      logIndex: 3
    });

    expect(() => parseDirectChatV2ConversationCreatedReceipt({
      deployment,
      receipt,
      expected: { ...expected, peer: '0x4444444444444444444444444444444444444444' }
    })).toThrow('wallet pair');
    expect(() => parseDirectChatV2ConversationCreatedReceipt({
      deployment,
      receipt: { ...receipt, logs: [{ ...log, removed: true }] },
      expected
    })).toThrow('invalid ConversationCreated');
    expect(() => parseDirectChatV2ConversationCreatedReceipt({
      deployment,
      receipt: { ...receipt, blockHash: `0x${'43'.repeat(32)}` },
      expected
    })).toThrow('provenance');
  });

  it('parses one receipt-derived MessagePosted identity and rejects spoofed event context', async () => {
    const { capability, signer, deployment } = await installVerifiedContract({
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => true),
      getConversation: vi.fn(async () => existingConversation)
    });
    const nonce = '0x0102030405060708090a0b0c';
    const context = {
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 3n,
      participantA: ALICE,
      participantB: BOB,
      sender: ALICE,
      recipient: BOB,
      senderSequence: 4n,
      valueSent: 5n,
      feeTaken: 3n
    } as const;
    const aadHash = deriveDirectChatV2AadHash(context, nonce);
    const ciphertext = `0x${'ab'.repeat(16)}`;
    const iface = new Interface(DIRECT_CHAT_V2_ABI);
    const event = iface.getEvent('MessagePosted');
    if (!event) throw new Error('MessagePosted event is unavailable.');
    const encoded = iface.encodeEventLog(event, [
      CONVERSATION_ID,
      ALICE,
      BOB,
      8n,
      3n,
      4n,
      nonce,
      aadHash,
      ciphertext,
      5n,
      3n
    ]);
    const log = {
      address: CHAT,
      topics: encoded.topics,
      data: encoded.data,
      transactionHash: `0x${'44'.repeat(32)}`,
      blockHash: `0x${'55'.repeat(32)}`,
      blockNumber: 100,
      index: 2,
      removed: false
    };

    expect(DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC).toBe(encoded.topics[0]);
    expect(parseDirectChatV2MessagePostedLog({ deployment, log })).toMatchObject({
      protocol: 'direct-v2',
      key: `direct-v2:${CHAIN_ID}:${CHAT}:${CONVERSATION_ID}:8`,
      conversationId: CONVERSATION_ID,
      messageId: 8n,
      epoch: 3n,
      sender: ALICE,
      recipient: BOB,
      nonce,
      aadHash,
      ciphertext,
      blockNumber: 100n,
      logIndex: 2,
      removed: false
    });
    expect(
      parseDirectChatV2MessageReceipt({
        deployment,
        receipt: {
          status: 1,
          hash: log.transactionHash,
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          logs: [log]
        },
        expected: {
          transactionHash: log.transactionHash,
          context,
          encrypted: { nonce, aadHash, ciphertext }
        }
      }).key
    ).toBe(`direct-v2:${CHAIN_ID}:${CHAT}:${CONVERSATION_ID}:8`);

    expect(() => parseDirectChatV2MessageReceipt({
      deployment,
      receipt: {
        status: 1,
        hash: `0x${'99'.repeat(32)}`,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        logs: [log]
      },
      expected: {
        transactionHash: log.transactionHash,
        context,
        encrypted: { nonce, aadHash, ciphertext }
      }
    })).toThrow('provenance');

    expect(() => parseDirectChatV2MessageReceipt({
      deployment,
      receipt: {
        hash: log.transactionHash,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        logs: [log]
      },
      expected: {
        transactionHash: log.transactionHash,
        context,
        encrypted: { nonce, aadHash, ciphertext }
      }
    })).toThrow('did not succeed');

    expect(() => parseDirectChatV2MessageReceipt({
      deployment,
      receipt: {
        status: 1,
        hash: log.transactionHash,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        logs: [{ ...log, removed: true }]
      },
      expected: {
        transactionHash: log.transactionHash,
        context,
        encrypted: { nonce, aadHash, ciphertext }
      }
    })).toThrow('removed');

    expect(() => parseDirectChatV2MessageReceipt({
      deployment,
      receipt: {
        status: 1,
        hash: log.transactionHash,
        blockHash: log.blockHash,
        blockNumber: log.blockNumber,
        logs: [log]
      },
      expected: {
        transactionHash: `0x${'99'.repeat(32)}`,
        context,
        encrypted: { nonce, aadHash, ciphertext }
      }
    })).toThrow('submitted encrypted message');

    const getLogs = vi.mocked(signer.provider!.getLogs);
    getLogs.mockResolvedValueOnce([log] as never);
    await expect(readDirectChatV2MessageLogPage({
      capability,
      deployment,
      peer: BOB,
      fromBlock: 99n,
      toBlock: 100n
    })).resolves.toMatchObject([{ messageId: 8n, blockNumber: 100n }]);
    expect(getLogs).toHaveBeenCalledWith({
      address: CHAT,
      fromBlock: 99,
      toBlock: 100,
      topics: [DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC, CONVERSATION_ID]
    });
    await expect(readDirectChatV2MessageLogPage({
      capability,
      deployment,
      peer: BOB,
      fromBlock: 99n,
      toBlock: 99n + DIRECT_CHAT_V2_MAX_LOG_BLOCK_SPAN
    })).rejects.toThrow('bounded');

    expect(() =>
      parseDirectChatV2MessagePostedLog({
        deployment,
        log: { ...log, address: BOB }
      })
    ).toThrow('unverified');

    const tampered = iface.encodeEventLog(event, [
      CONVERSATION_ID,
      ALICE,
      BOB,
      8n,
      3n,
      4n,
      nonce,
      `0x${'66'.repeat(32)}`,
      ciphertext,
      5n,
      3n
    ]);
    expect(() =>
      parseDirectChatV2MessagePostedLog({
        deployment,
        log: { ...log, topics: tampered.topics, data: tampered.data }
      })
    ).toThrow('AAD');
  });

  it('sends with a fresh nonce, no private input, and fails closed on collision or stale key', async () => {
    const wait = vi.fn(async () => ({ status: 1 }));
    const readProvider = makeBrowserProvider();
    readProvider.getTransactionReceipt = vi.fn(async () => ({ status: 1 })) as never;
    const chat = {
      conversationIdFor: vi.fn(async () => CONVERSATION_ID),
      isParticipant: vi.fn(async () => true),
      getConversation: vi.fn(async () => existingConversation),
      nextSenderSequence: vi.fn(async () => 4n),
      messageFee: vi.fn(async () => 3n),
      isMessageNonceUsed: vi.fn(async () => false),
      deriveMessageAadHash: vi.fn(async (...args: unknown[]) => deriveDirectChatV2AadHash({
        chainId: CHAIN_ID,
        contractAddress: CHAT,
        conversationId: CONVERSATION_ID,
        epoch: 3n,
        participantA: ALICE,
        participantB: BOB,
        sender: ALICE,
        recipient: BOB,
        senderSequence: 4n,
        valueSent: 5n,
        feeTaken: 3n
      }, String(args[5]))),
      sendMessage: vi.fn(async () => ({ hash: '0xsend', wait }))
    };
    const assertCurrent = vi.fn(async () => undefined);
    const assertSnapshotCurrent = vi.fn(() => undefined);
    const { capability, signer, deployment } = await installVerifiedContract(
      chat,
      makeSigner(),
      readProvider,
      assertCurrent,
      assertSnapshotCurrent
    );
    assertCurrent.mockClear();
    assertSnapshotCurrent.mockClear();
    const key = {
      value: 7n,
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 3n
    } satisfies DirectChatV2EpochKey;
    const retireNonceAttempt = vi.fn(
      async (_attempt: Readonly<DirectChatV2NonceAttempt>) => undefined
    );

    const sent = await sendDirectChatV2Message({
      capability,
      deployment,
      peer: BOB,
      key,
      plaintext: 'one normal wallet transaction',
      retireNonceAttempt,
      tip: 2n
    });

    expect(signer.encryptValue).not.toHaveBeenCalled();
    expect(chat.sendMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      3n,
      4n,
      sent.encrypted.nonce,
      sent.encrypted.ciphertext,
      3n,
      { value: 5n }
    );
    expect(chat.isMessageNonceUsed).toHaveBeenCalledWith(CONVERSATION_ID, 3n, sent.encrypted.nonce);
    expect(retireNonceAttempt).toHaveBeenCalledWith({
      chainId: CHAIN_ID,
      contractAddress: CHAT,
      conversationId: CONVERSATION_ID,
      epoch: 3n,
      nonce: sent.encrypted.nonce,
      ownerAddress: ALICE
    });
    expect(Object.isFrozen(retireNonceAttempt.mock.calls[0]?.[0])).toBe(true);
    expect(retireNonceAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      chat.isMessageNonceUsed.mock.invocationCallOrder[0]
    );
    expect(retireNonceAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      chat.sendMessage.mock.invocationCallOrder[0]
    );
    await expect(decryptDirectChatV2Message(sent.encrypted, key, sent.context)).resolves.toBe(
      'one normal wallet transaction'
    );
    expect(sent.transaction.txHash).toBe('0xsend');
    await expect(sent.transaction.wait()).resolves.toMatchObject({ status: 1 });
    expect(readProvider.getTransactionReceipt).toHaveBeenCalledWith('0xsend');
    expect(wait).not.toHaveBeenCalled();
    // Message preparation is read through the public RPC; the guarded signer
    // performs the live lease check only at the actual wallet submission edge.
    expect(assertCurrent).not.toHaveBeenCalled();
    expect(assertSnapshotCurrent).toHaveBeenCalledTimes(2);

    chat.isMessageNonceUsed.mockResolvedValueOnce(true);
    await expect(
      sendDirectChatV2Message({
        capability,
        deployment,
        peer: BOB,
        key,
        plaintext: 'must regenerate outside this failed attempt',
        retireNonceAttempt
      })
    ).rejects.toThrow('already used');
    expect(retireNonceAttempt).toHaveBeenCalledTimes(2);

    retireNonceAttempt.mockRejectedValueOnce(new Error('atomic nonce claim failed'));
    await expect(
      sendDirectChatV2Message({
        capability,
        deployment,
        peer: BOB,
        key,
        plaintext: 'must abort before nonce preflight',
        retireNonceAttempt
      })
    ).rejects.toThrow('atomic nonce claim failed');
    expect(chat.isMessageNonceUsed).toHaveBeenCalledTimes(2);
    expect(chat.deriveMessageAadHash).toHaveBeenCalledTimes(2);
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);

    await expect(
      sendDirectChatV2Message({
        capability,
        deployment,
        peer: BOB,
        key: { ...key, epoch: 2n },
        plaintext: 'must not send',
        retireNonceAttempt
      })
    ).rejects.toThrow('stale');
    expect(retireNonceAttempt).toHaveBeenCalledTimes(3);
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('builds a stable message identity without using transaction hashes', () => {
    expect(
      buildDirectChatV2MessageKey({
        chainId: CHAIN_ID,
        contractAddress: CHAT.toUpperCase().replace('0X', '0x'),
        conversationId: CONVERSATION_ID.toUpperCase().replace('0X', '0x'),
        messageId: 9n
      })
    ).toBe(`direct-v2:${CHAIN_ID}:${CHAT}:${CONVERSATION_ID}:9`);
  });
});
