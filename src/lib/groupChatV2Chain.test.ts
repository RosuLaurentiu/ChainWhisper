import {
  BrowserProvider,
  Interface,
  keccak256,
  toUtf8Bytes,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({ loadCotiEthersModule: vi.fn() }));

vi.mock('./appShared/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appShared/core')>(),
  loadCotiEthersModule: coreMocks.loadCotiEthersModule
}));

import {
  GROUP_CHAT_V2_ABI,
  GROUP_CHAT_V2_REQUIRED_FEATURES,
  GroupChatV2EpochEnvelopeSyncRequiredError,
  assertGroupChatV2MetaMaskCapabilityCurrent,
  assertGroupChatV2MetaMaskCapabilitySnapshotCurrent,
  assertGroupChatV2MetaMaskCapabilityScope,
  bindGroupChatV2MetaMaskCapability,
  acceptGroupChatV2Invite,
  createGroupChatV2Group,
  createGroupChatV2JoinCode,
  declineGroupChatV2Invite,
  decryptGroupChatV2MetadataEvent,
  decryptGroupChatV2EventMessage,
  disbandGroupChatV2,
  inviteGroupChatV2Members,
  joinGroupChatV2WithCode,
  leaveGroupChatV2,
  parseGroupChatV2MessagePostedLog,
  parseGroupChatV2MetadataUpdatedLog,
  parseGroupChatV2MessageReceipt,
  readGroupChatV2EpochKey,
  readGroupChatV2Group,
  readGroupChatV2Invite,
  readGroupChatV2JoinCode,
  readGroupChatV2JoinProofDigest,
  readGroupChatV2CanonicalBlock,
  readGroupChatV2Member,
  readGroupChatV2MembershipRanges,
  readGroupChatV2Members,
  readGroupChatV2MetadataLogPage,
  readGroupChatV2MetadataVersionAtBlock,
  readGroupChatV2MessageCountAtBlock,
  readGroupChatV2NativeCredit,
  readGroupChatV2MessageLogPage,
  readGroupChatV2WalletLifecycleLogPage,
  releaseGroupChatV2MetaMaskCapability,
  removeGroupChatV2Members,
  revokeGroupChatV2Invite,
  revokeGroupChatV2JoinCode,
  rotateGroupChatV2Key,
  sendGroupChatV2Message,
  setGroupChatV2Admin,
  setGroupChatV2EncryptedMetadata,
  signGroupChatV2ImageSessionAuthorization,
  syncGroupChatV2EpochEnvelope,
  verifyGroupChatV2Deployment,
  withdrawGroupChatV2NativeCredit,
  type GroupChatV2MetaMaskCapability
} from './groupChatV2Chain';
import {
  deriveGroupChatV2MessageAadHash,
  deriveGroupChatV2MetadataAadHash,
  encryptGroupChatV2Metadata,
  encryptGroupChatV2Message
} from './groupChatV2Crypto';
import type { GroupChatV2DeploymentManifest } from './groupChatV2Deployment';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const GROUP = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 7_082_400n;
const DEPLOYMENT_BLOCK = 101n;
const RUNTIME = '0x6002';
const MANIFEST = {
  chainId: CHAIN_ID,
  contractAddress: GROUP,
  deploymentBlock: DEPLOYMENT_BLOCK,
  runtimeBytecodeHash: keccak256(RUNTIME)
} satisfies GroupChatV2DeploymentManifest;
const REQUIRED_FEATURES = new Set(
  GROUP_CHAT_V2_REQUIRED_FEATURES.map((feature) => keccak256(toUtf8Bytes(feature)).toLowerCase())
);
const TX_HASH = `0x${'aa'.repeat(32)}`;
const BLOCK_HASH = `0x${'bb'.repeat(32)}`;
const GROUP_INTERFACE = new Interface(GROUP_CHAT_V2_ABI);
const wait = vi.fn(async () => ({ status: 1 }));
const transaction = () => ({ hash: TX_HASH, wait });

const groupSnapshot = (overrides: Record<string, unknown> = {}) => ({
  admin: ALICE,
  createdAt: 10n,
  updatedAt: 11n,
  currentEpoch: 3n,
  messageCount: 4n,
  createdBlock: 101n,
  firstMessageBlock: 110n,
  lastMessageBlock: 120n,
  metadataVersion: 2n,
  membershipRevision: 5n,
  adminRevision: 2n,
  memberCount: 2n,
  exists: true,
  archived: false,
  ...overrides
});

const epochKey = (overrides: Record<string, unknown> = {}) => ({
  value: 123n,
  chainId: CHAIN_ID,
  contractAddress: GROUP,
  groupId: 1n,
  epoch: 3n,
  membershipRevision: 5n,
  ...overrides
});

const groupMessageFixture = async (overrides: { messageId?: bigint; blockNumber?: bigint } = {}) => {
  const context = {
    chainId: CHAIN_ID,
    contractAddress: GROUP,
    groupId: 1n,
    epoch: 3n,
    membershipRevision: 5n,
    sender: ALICE,
    senderSequence: 7n,
    valueSent: 9n,
    feeTaken: 9n
  };
  const encrypted = await encryptGroupChatV2Message('canonical group message', epochKey(), context);
  const encoded = GROUP_INTERFACE.encodeEventLog(
    GROUP_INTERFACE.getEvent('GroupMessagePosted')!,
    [
      1n,
      overrides.messageId ?? 5n,
      ALICE,
      3n,
      5n,
      7n,
      encrypted.nonce,
      encrypted.aadHash,
      encrypted.ciphertext,
      9n,
      9n
    ]
  );
  return {
    context,
    encrypted,
    log: {
      address: GROUP,
      topics: encoded.topics,
      data: encoded.data,
      transactionHash: TX_HASH,
      blockHash: BLOCK_HASH,
      blockNumber: overrides.blockNumber ?? 111n,
      index: 2,
      removed: false
    }
  };
};

const groupMetadataFixture = async (overrides: { metadataVersion?: bigint; blockNumber?: bigint } = {}) => {
  const context = {
    chainId: CHAIN_ID,
    contractAddress: GROUP,
    groupId: 1n,
    epoch: 3n,
    membershipRevision: 5n,
    metadataVersion: overrides.metadataVersion ?? 3n,
    editor: ALICE
  };
  const encrypted = await encryptGroupChatV2Metadata(
    '{"v":1,"n":"Private Desk"}',
    epochKey(),
    context
  );
  const encoded = GROUP_INTERFACE.encodeEventLog(
    GROUP_INTERFACE.getEvent('EncryptedGroupMetadataUpdated')!,
    [
      1n,
      context.metadataVersion,
      ALICE,
      3n,
      5n,
      encrypted.nonce,
      encrypted.aadHash,
      encrypted.ciphertext
    ]
  );
  return {
    encrypted,
    log: {
      address: GROUP,
      topics: encoded.topics,
      data: encoded.data,
      transactionHash: TX_HASH,
      blockHash: BLOCK_HASH,
      blockNumber: overrides.blockNumber ?? 113n,
      index: 3,
      removed: false
    }
  };
};

const makeProvider = (chainId = CHAIN_ID): BrowserProvider => {
  const provider = new BrowserProvider({
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return `0x${chainId.toString(16)}`;
      if (method === 'eth_accounts') return [ALICE];
      return null;
    })
  }, { chainId: Number(chainId), name: 'Group Chat V2 test' });
  provider.getCode = vi.fn(async () => RUNTIME);
  provider.getBlock = vi.fn(async () => ({ gasLimit: 30_000_000n }) as never);
  return provider;
};

const makeSigner = ({
  provider = makeProvider(),
  aesKey = 'group-test-aes',
  owner = ALICE
}: {
  provider?: BrowserProvider;
  aesKey?: string | null;
  owner?: string;
} = {}) => ({
  provider,
  getAddress: vi.fn(async () => owner),
  sendUncheckedTransaction: vi.fn(),
  getUserOnboardInfo: vi.fn(() => aesKey ? { aesKey } : undefined),
  signMessage: vi.fn(async () => `0x${'ab'.repeat(65)}`),
  decryptValue: vi.fn(async (value: bigint) => value - 1_000n)
}) as unknown as JsonRpcSigner;

const bind = async (
  signer = makeSigner(),
  assertCurrent = vi.fn(async () => undefined),
  assertSnapshotCurrent?: () => void
): Promise<GroupChatV2MetaMaskCapability> =>
  bindGroupChatV2MetaMaskCapability({
    signer,
    browserProvider: signer.provider as BrowserProvider,
    ownerAddress: ALICE,
    chainId: CHAIN_ID,
    assertCurrent,
    assertSnapshotCurrent
  });

const verifier = () => ({
  contractVersion: vi.fn(async () => 'ChainWhisperGroupChatV2'),
  PROTOCOL_VERSION: vi.fn(async () => 2n),
  deploymentBlock: vi.fn(async () => DEPLOYMENT_BLOCK),
  MESSAGE_AAD_DOMAIN: vi.fn(async () =>
    keccak256(toUtf8Bytes('chainwhisper.group-chat.v2.aes-gcm.aad.v1'))),
  METADATA_AAD_DOMAIN: vi.fn(async () =>
    keccak256(toUtf8Bytes('chainwhisper.group-chat.v2.metadata.aad.v1'))),
  MAX_GROUP_MEMBERS: vi.fn(async () => 64n),
  MAX_INITIAL_MEMBERS: vi.fn(async () => 16n),
  MAX_MEMBERSHIP_BATCH: vi.fn(async () => 16n),
  MAX_INVITE_BATCH: vi.fn(async () => 16n),
  MAX_PAGE_SIZE: vi.fn(async () => 50n),
  MIN_CIPHERTEXT_BYTES: vi.fn(async () => 16n),
  MAX_CIPHERTEXT_BYTES: vi.fn(async () => 4_096n),
  supportsFeature: vi.fn(async (feature: string) => REQUIRED_FEATURES.has(feature.toLowerCase()))
});

const install = (contract: Record<string, unknown>) => {
  const shared = { ...verifier(), ...contract };
  for (const name of ['createGroup', 'setGroupAdmin', 'removeMembers', 'leaveGroup', 'disbandGroup',
    'inviteMembers', 'acceptInvite', 'declineInvite', 'revokeInvite', 'rotateGroupKey', 'createJoinCode',
    'revokeJoinCode', 'joinWithCode', 'syncMyEpochEnvelope', 'sendMessage', 'setEncryptedGroupMetadata', 'withdrawNativeCredit']) {
    const method = contract[name];
    if (typeof method === 'function' && !('estimateGas' in method)) {
      Object.assign(method, { estimateGas: vi.fn(async () => 100_000n) });
    }
  }
  coreMocks.loadCotiEthersModule.mockResolvedValue({
    Contract: vi.fn(function Contract() { return { ...shared, getFunction: (name: string) => shared[name as keyof typeof shared] }; })
  } as never);
  return shared;
};

describe('groupChatV2Chain', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bounds startup getter production while retaining every verifier read', async () => {
    let pending = 0, maximumPending = 0, reads = 0;
    const surface = Object.fromEntries(Object.entries(verifier()).map(([name, read]) => [name,
      async (...args: unknown[]) => {
        reads++; maximumPending = Math.max(maximumPending, ++pending);
        await Promise.resolve();
        try { return await Reflect.apply(read, undefined, args); } finally { pending--; }
      }
    ]));
    install(surface);
    const deployment = await verifyGroupChatV2Deployment({ capability: await bind(), manifest: MANIFEST });
    expect(deployment.contractAddress).toBe(GROUP.toLowerCase());
    expect(reads).toBe(24);
    expect(maximumPending).toBe(1);
  });

  it('binds the exact current COTI BrowserProvider owner and rejects another scope', async () => {
    const signer = makeSigner();
    const provider = signer.provider as BrowserProvider;
    const capability = await bind(signer);
    vi.mocked(signer.getAddress).mockClear();
    const getNetwork = vi.spyOn(provider, 'getNetwork');
    await expect(assertGroupChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).resolves.toBeUndefined();
    expect(signer.getAddress).not.toHaveBeenCalled();
    expect(getNetwork).not.toHaveBeenCalled();
    await expect(assertGroupChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: BOB,
      chainId: CHAIN_ID
    })).rejects.toThrow('another account or chain');
  });

  it('uses the event-backed snapshot for intermediate session checks without another live RPC', async () => {
    const assertCurrent = vi.fn(async () => undefined);
    const assertSnapshotCurrent = vi.fn(() => undefined);
    const capability = await bind(makeSigner(), assertCurrent, assertSnapshotCurrent);
    assertCurrent.mockClear();
    assertSnapshotCurrent.mockClear();

    await expect(assertGroupChatV2MetaMaskCapabilitySnapshotCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).resolves.toBeUndefined();
    expect(assertSnapshotCurrent).toHaveBeenCalledOnce();
    expect(assertCurrent).not.toHaveBeenCalled();
  });

  it('routes deployment attestation and ordinary group reads through the public provider', async () => {
    const walletProvider = makeProvider();
    const readProvider = makeProvider();
    const signer = makeSigner({ provider: walletProvider });
    install({ getGroup: vi.fn(async () => groupSnapshot()) });
    const capability = await bindGroupChatV2MetaMaskCapability({
      signer,
      browserProvider: walletProvider,
      readProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent: vi.fn(async () => undefined)
    });
    vi.clearAllMocks();

    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    await expect(readGroupChatV2Group({ deployment, capability, groupId: 1n }))
      .resolves.toMatchObject({ groupId: 1n, admin: ALICE.toLowerCase() });
    expect(readProvider.getCode).toHaveBeenCalledWith(GROUP.toLowerCase());
    expect(walletProvider.getCode).not.toHaveBeenCalled();
    expect(signer.getAddress).not.toHaveBeenCalled();
    expect(() => assertGroupChatV2MetaMaskCapabilityScope({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).not.toThrow();
  });

  it('reconciles a broadcast Group transaction through the public provider without polling MetaMask', async () => {
    const walletProvider = makeProvider();
    const readProvider = makeProvider();
    const publicReceipt = { status: 1 };
    readProvider.getTransactionReceipt = vi.fn(async () => publicReceipt as never);
    const nativeWait = vi.fn(async () => ({ status: 1 }));
    const createGroup = vi.fn(async () => ({ hash: TX_HASH, wait: nativeWait }));
    install({ createGroup });
    const signer = makeSigner({ provider: walletProvider });
    const capability = await bindGroupChatV2MetaMaskCapability({
      signer,
      browserProvider: walletProvider,
      readProvider,
      ownerAddress: ALICE,
      chainId: CHAIN_ID,
      assertCurrent: vi.fn(async () => undefined)
    });
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    const submitted = await createGroupChatV2Group({
      deployment,
      capability,
      initialInvitees: []
    });
    await expect(submitted.wait()).resolves.toBe(publicReceipt);
    expect(readProvider.getTransactionReceipt).toHaveBeenCalledWith(TX_HASH);
    expect(nativeWait).not.toHaveBeenCalled();
  });

  it('invalidates a capability without destroying the shared BrowserProvider', async () => {
    const provider = makeProvider();
    const destroy = vi.spyOn(provider, 'destroy');
    const capability = await bind(makeSigner({ provider }));

    expect(releaseGroupChatV2MetaMaskCapability(capability)).toBe(true);
    expect(releaseGroupChatV2MetaMaskCapability(capability)).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
    await expect(assertGroupChatV2MetaMaskCapabilityCurrent({
      capability,
      ownerAddress: ALICE,
      chainId: CHAIN_ID
    })).rejects.toThrow('current owner browser-wallet capability');
  });

  it('signs only the exact owner-and-chain-bound image session authorization', async () => {
    const signer = makeSigner();
    const capability = await bind(signer);
    const message = [
      'ChainWhisper Chat Image Upload Session',
      'version:1',
      'audience:https://example.supabase.co/functions/v1/chat-image-session',
      `chainId:0x${CHAIN_ID.toString(16)}`,
      `owner:${ALICE.toLowerCase()}`,
      `nonce:${'cd'.repeat(32)}`,
      'issuedAt:1700000000',
      'expiresAt:1700000900'
    ].join('\n');

    await expect(signGroupChatV2ImageSessionAuthorization({ capability, message }))
      .resolves.toBe(`0x${'ab'.repeat(65)}`);
    await expect(signGroupChatV2ImageSessionAuthorization({
      capability,
      message: message.replace(`owner:${ALICE.toLowerCase()}`, `owner:${BOB.toLowerCase()}`)
    })).rejects.toThrow(/malformed image-session/i);
    expect(signer.signMessage).toHaveBeenCalledOnce();
  });

  it('attests the runtime, full protocol surface, and forbidden app-wallet feature', async () => {
    install({});
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    expect(deployment).toEqual({
      ...MANIFEST,
      contractAddress: GROUP.toLowerCase(),
      runtimeBytecodeHash: MANIFEST.runtimeBytecodeHash.toLowerCase()
    });
    expect(Object.isFrozen(deployment)).toBe(true);
  });

  it('rejects runtime, required-feature, and manifest-chain substitutions', async () => {
    const installed = install({});
    const signer = makeSigner();
    const capability = await bind(signer);
    vi.mocked(signer.provider!.getCode).mockResolvedValueOnce('0x6003');
    await expect(verifyGroupChatV2Deployment({ manifest: MANIFEST, capability }))
      .rejects.toThrow('runtime');

    vi.mocked(signer.provider!.getCode).mockResolvedValueOnce(RUNTIME);
    vi.mocked(installed.supportsFeature as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false);
    await expect(verifyGroupChatV2Deployment({ manifest: MANIFEST, capability }))
      .rejects.toThrow('features');

    await expect(verifyGroupChatV2Deployment({
      manifest: { ...MANIFEST, chainId: CHAIN_ID + 1n },
      capability
    })).rejects.toThrow('manifest chain');
  });

  it('normalizes group, member, and effective-invite snapshots only after attestation', async () => {
    install({
      getGroup: vi.fn(async () => ({
        admin: ALICE,
        createdAt: 10n,
        updatedAt: 11n,
        currentEpoch: 3n,
        messageCount: 4n,
        createdBlock: 101n,
        firstMessageBlock: 110n,
        lastMessageBlock: 120n,
        metadataVersion: 2n,
        membershipRevision: 5n,
        adminRevision: 2n,
        memberCount: 2n,
        exists: true,
        archived: false
      })),
      getMember: vi.fn(async () => ({
        active: true,
        generation: 1n,
        joinedAt: 10n,
        leftAt: 0n,
        firstReadableMessageId: 1n
      })),
      getInvite: vi.fn(async () => ({
        invite: {
          inviter: ALICE,
          expiresAt: 999n,
          generation: 7n,
          issuerAdminRevision: 2n,
          recipientGeneration: 0n,
          pending: true
        },
        effective: true
      }))
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await expect(readGroupChatV2Group({ deployment, capability, groupId: 1n }))
      .resolves.toMatchObject({ groupId: 1n, currentEpoch: 3n, memberCount: 2n, archived: false });
    await expect(readGroupChatV2Member({ deployment, capability, groupId: 1n, account: BOB }))
      .resolves.toMatchObject({ account: BOB, active: true, generation: 1n });
    await expect(readGroupChatV2Invite({ deployment, capability, groupId: 1n, account: BOB }))
      .resolves.toMatchObject({ inviter: ALICE, generation: 7n, effective: true });
  });

  it('decrypts only the caller-authorized epoch envelope after metadata validation', async () => {
    const getMyEpochEnvelope = vi.fn(async () => 1_123n);
    install({
      getEpochMetadata: vi.fn(async () => ({
        exists: true,
        membershipRevision: 5n,
        rotatedBy: ALICE,
        createdAt: 12n,
        firstMessageId: 1n
      })),
      getMyEpochEnvelope
    });
    const signer = makeSigner();
    const capability = await bind(signer);
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await expect(readGroupChatV2EpochKey({ deployment, capability, groupId: 1n, epoch: 3n }))
      .resolves.toMatchObject({ value: 123n, groupId: 1n, epoch: 3n, membershipRevision: 5n });
    expect(getMyEpochEnvelope).toHaveBeenCalledWith(1n, 3n, { from: ALICE });
    expect(signer.decryptValue).toHaveBeenCalledWith(1_123n);
  });

  it('fails before envelope access when the COTI privacy key is not unlocked', async () => {
    const getMyEpochEnvelope = vi.fn();
    install({ getEpochMetadata: vi.fn(), getMyEpochEnvelope });
    const capability = await bind(makeSigner({ aesKey: null }));
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    await expect(readGroupChatV2EpochKey({ deployment, capability, groupId: 1n, epoch: 1n }))
      .rejects.toThrow('Unlock the COTI privacy key');
    expect(getMyEpochEnvelope).not.toHaveBeenCalled();
  });

  it('turns a missing per-wallet epoch envelope into an actionable sync request', async () => {
    install({
      getEpochMetadata: vi.fn(async () => ({
        exists: true,
        membershipRevision: 5n,
        rotatedBy: BOB,
        createdAt: 12n,
        firstMessageId: 1n
      })),
      getMyEpochEnvelope: vi.fn(async () => {
        throw { data: '0xa70f12a4' };
      })
    });
    const capability = await bind(makeSigner());
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    const failure = await readGroupChatV2EpochKey({
      deployment,
      capability,
      groupId: 1n,
      epoch: 3n
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GroupChatV2EpochEnvelopeSyncRequiredError);
    expect(failure).toMatchObject({ groupId: 1n, epoch: 3n });
  });

  it('creates a group with one owner transaction and rejects invalid invitees before submission', async () => {
    const createGroup = vi.fn(async () => transaction());
    install({ createGroup });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await expect(createGroupChatV2Group({
      deployment,
      capability,
      initialInvitees: [BOB]
    })).resolves.toMatchObject({ txHash: TX_HASH });
    expect(createGroup).toHaveBeenCalledWith([BOB], { gasLimit: 130_000n });

    await expect(createGroupChatV2Group({
      deployment,
      capability,
      initialInvitees: [BOB, BOB]
    })).rejects.toThrow('unique wallets');
    await expect(createGroupChatV2Group({
      deployment,
      capability,
      initialInvitees: Array.from({ length: 17 }, (_, index) =>
        `0x${(index + 10).toString(16).padStart(40, '0')}`)
    })).rejects.toThrow('at most 16');
    expect(createGroup).toHaveBeenCalledTimes(1);
  });

  it('estimates exact group creation once and sends with 30% ceiling headroom after fresh block and authority checks', async () => {
    const order: string[] = [];
    const createGroup = Object.assign(vi.fn(async () => { order.push('send'); return transaction(); }), {
      estimateGas: vi.fn(async () => { order.push('estimate'); return 580_593n; })
    });
    install({ createGroup });
    const provider = makeProvider();
    provider.getBlock = vi.fn(async () => { order.push('block'); return { gasLimit: 1_000_000n } as never; });
    const assertCurrent = vi.fn(async () => { order.push('authority'); return undefined; });
    const capability = await bind(makeSigner({ provider }), assertCurrent, vi.fn());
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    order.length = 0;

    await createGroupChatV2Group({ deployment, capability, initialInvitees: [BOB] });

    expect(createGroup.estimateGas).toHaveBeenCalledExactlyOnceWith([BOB]);
    expect(provider.getBlock).toHaveBeenCalledExactlyOnceWith('latest');
    expect(createGroup).toHaveBeenCalledExactlyOnceWith([BOB], { gasLimit: 754_771n });
    expect(order).toEqual(['estimate', 'block', 'authority', 'send']);
  });

  it.each(['failed estimate', 'zero estimate', 'negative estimate', 'missing block', 'over block'])(
    'sends nothing for %s during Group gas admission', async (failure) => {
      const estimateGas = vi.fn(async () => {
        if (failure === 'failed estimate') throw new Error('estimate unavailable');
        return failure === 'zero estimate' ? 0n : failure === 'negative estimate' ? -1n : 101n;
      });
      const createGroup = Object.assign(vi.fn(async () => transaction()), { estimateGas });
      install({ createGroup });
      const provider = makeProvider();
      provider.getBlock = vi.fn(async () => failure === 'missing block' ? null : { gasLimit: 131n } as never);
      const capability = await bind(makeSigner({ provider }));
      const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

      await expect(createGroupChatV2Group({ deployment, capability, initialInvitees: [BOB] })).rejects.toThrow();
      expect(estimateGas).toHaveBeenCalledExactlyOnceWith([BOB]);
      expect(createGroup).not.toHaveBeenCalled();
    });

  it('rechecks owner authority after gas admission and does not send if it changed', async () => {
    const createGroup = Object.assign(vi.fn(async () => transaction()), { estimateGas: vi.fn(async () => 101n) });
    install({ createGroup });
    const assertCurrent = vi.fn(async () => undefined);
    const capability = await bind(makeSigner(), assertCurrent, vi.fn());
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    assertCurrent.mockRejectedValue(new Error('owner session changed'));

    await expect(createGroupChatV2Group({ deployment, capability })).rejects.toThrow('owner session changed');
    expect(createGroup.estimateGas).toHaveBeenCalledOnce();
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('rounds fractional gas margin up and makes no second send after uncertainty', async () => {
    const createGroup = Object.assign(vi.fn(async () => { throw new Error('uncertain send'); }), {
      estimateGas: vi.fn(async () => 101n)
    });
    install({ createGroup });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await expect(createGroupChatV2Group({ deployment, capability })).rejects.toThrow('uncertain send');
    expect(createGroup).toHaveBeenCalledExactlyOnceWith([], { gasLimit: 132n });
    expect(createGroup.estimateGas).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('encrypts and sends with exact current membership, fee, AAD, and retired nonce', async () => {
    const order: string[] = [];
    const isMessageNonceUsed = vi.fn(async () => {
      order.push('preflight');
      return false;
    });
    const estimateMessage = vi.fn(async () => 100_000n);
    const sendMessage = Object.assign(vi.fn(async () => {
      order.push('send');
      return transaction();
    }), { estimateGas: estimateMessage });
    install({
      getGroup: vi.fn(async () => groupSnapshot()),
      getMember: vi.fn(async () => ({
        active: true,
        generation: 1n,
        joinedAt: 10n,
        leftAt: 0n,
        firstReadableMessageId: 1n
      })),
      nextSenderSequence: vi.fn(async () => 7n),
      messageFee: vi.fn(async () => 9n),
      isMessageNonceUsed,
      deriveMessageAadHash: vi.fn(async (
        groupId: bigint,
        epoch: bigint,
        membershipRevision: bigint,
        sender: string,
        senderSequence: bigint,
        nonce: string,
        valueSent: bigint,
        feeTaken: bigint
      ) => deriveGroupChatV2MessageAadHash({
        chainId: CHAIN_ID,
        contractAddress: GROUP,
        groupId,
        epoch,
        membershipRevision,
        sender,
        senderSequence,
        valueSent,
        feeTaken
      }, nonce)),
      sendMessage
    });
    const assertCurrent = vi.fn(async () => undefined);
    const assertSnapshotCurrent = vi.fn();
    const capability = await bind(makeSigner(), assertCurrent, assertSnapshotCurrent);
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    const retireNonceAttempt = vi.fn(async () => { order.push('retire'); });
    assertCurrent.mockClear();
    assertSnapshotCurrent.mockClear();

    const result = await sendGroupChatV2Message({
      deployment,
      capability,
      groupId: 1n,
      key: epochKey(),
      plaintext: 'hello group',
      retireNonceAttempt
    });

    expect(order).toEqual(['retire', 'preflight', 'send']);
    expect(result.context).toMatchObject({
      groupId: 1n,
      epoch: 3n,
      membershipRevision: 5n,
      senderSequence: 7n,
      valueSent: 9n,
      feeTaken: 9n
    });
    expect(retireNonceAttempt).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'message',
      groupId: 1n,
      epoch: 3n,
      ownerAddress: ALICE
    }));
    expect(isMessageNonceUsed).toHaveBeenCalledWith(1n, 3n, result.encrypted.nonce);
    expect(sendMessage).toHaveBeenCalledWith(
      1n,
      3n,
      7n,
      result.encrypted.nonce,
      result.encrypted.ciphertext,
      9n,
      { value: 9n, gasLimit: 130_000n }
    );
    expect(estimateMessage).toHaveBeenCalledExactlyOnceWith(
      1n, 3n, 7n, result.encrypted.nonce, result.encrypted.ciphertext, 9n, { value: 9n }
    );
    expect(assertCurrent).toHaveBeenCalledOnce();
    expect(assertSnapshotCurrent).toHaveBeenCalledTimes(2);
  });

  it('fails closed before chain preflight when nonce retirement fails or the key is stale', async () => {
    const isMessageNonceUsed = vi.fn();
    const sendMessage = vi.fn();
    install({
      getGroup: vi.fn(async () => groupSnapshot()),
      getMember: vi.fn(async () => ({
        active: true,
        generation: 1n,
        joinedAt: 10n,
        leftAt: 0n,
        firstReadableMessageId: 1n
      })),
      nextSenderSequence: vi.fn(async () => 1n),
      messageFee: vi.fn(async () => 0n),
      isMessageNonceUsed,
      deriveMessageAadHash: vi.fn(),
      sendMessage
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await expect(sendGroupChatV2Message({
      deployment,
      capability,
      groupId: 1n,
      key: epochKey({ epoch: 2n }),
      plaintext: 'stale',
      retireNonceAttempt: vi.fn()
    })).rejects.toThrow('stale or belongs to another group');

    await expect(sendGroupChatV2Message({
      deployment,
      capability,
      groupId: 1n,
      key: epochKey(),
      plaintext: 'do not submit',
      retireNonceAttempt: vi.fn(async () => { throw new Error('retirement unavailable'); })
    })).rejects.toThrow('retirement unavailable');
    expect(isMessageNonceUsed).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('updates encrypted metadata with its distinct key domain and exact revision guards', async () => {
    const setEncryptedGroupMetadata = vi.fn(async () => transaction());
    install({
      getGroup: vi.fn(async () => groupSnapshot()),
      deriveMetadataAadHash: vi.fn(async (
        groupId: bigint,
        epoch: bigint,
        membershipRevision: bigint,
        metadataVersion: bigint,
        editor: string,
        nonce: string
      ) => deriveGroupChatV2MetadataAadHash({
        chainId: CHAIN_ID,
        contractAddress: GROUP,
        groupId,
        epoch,
        membershipRevision,
        metadataVersion,
        editor
      }, nonce)),
      setEncryptedGroupMetadata
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    const retireNonceAttempt = vi.fn(async () => undefined);

    const result = await setGroupChatV2EncryptedMetadata({
      deployment,
      capability,
      groupId: 1n,
      key: epochKey(),
      plaintext: '{"name":"Team"}',
      retireNonceAttempt
    });

    expect(result.context.metadataVersion).toBe(3n);
    expect(retireNonceAttempt).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'metadata' }));
    expect(setEncryptedGroupMetadata).toHaveBeenCalledWith(
      1n,
      3n,
      2n,
      5n,
      2n,
      result.encrypted.nonce,
      result.encrypted.ciphertext,
      { gasLimit: 130_000n }
    );
  });

  it('authenticates, decrypts, and completeness-checks finalized metadata history', async () => {
    const fixture = await groupMetadataFixture();
    const provider = makeProvider();
    provider.getLogs = vi.fn(async () => [fixture.log]) as never;
    const getGroup = vi.fn(async () => groupSnapshot({ metadataVersion: 3n }));
    install({ getGroup });
    const capability = await bind(makeSigner({ provider }));
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    const event = parseGroupChatV2MetadataUpdatedLog({ deployment, log: fixture.log });

    expect(event).toMatchObject({
      groupId: 1n,
      metadataVersion: 3n,
      epoch: 3n,
      membershipRevision: 5n,
      editor: ALICE,
      blockHash: BLOCK_HASH
    });
    await expect(decryptGroupChatV2MetadataEvent({ event, key: epochKey() }))
      .resolves.toBe('{"v":1,"n":"Private Desk"}');
    await expect(readGroupChatV2MetadataLogPage({
      deployment,
      capability,
      groupId: 1n,
      fromBlock: 101n,
      toBlock: 120n
    })).resolves.toEqual([event]);
    await expect(readGroupChatV2MetadataVersionAtBlock({
      deployment,
      capability,
      groupId: 1n,
      blockNumber: 120n
    })).resolves.toBe(3n);
    expect(provider.getLogs).toHaveBeenCalledWith({
      address: GROUP,
      fromBlock: 101,
      toBlock: 120,
      topics: [expect.any(String), `0x${'1'.padStart(64, '0')}`]
    });
    expect(getGroup).toHaveBeenLastCalledWith(1n, { blockTag: 120 });
  });

  it('synchronizes authorized envelopes and exposes pull-credit withdrawal without hidden writes', async () => {
    const syncMyEpochEnvelope = vi.fn(async () => transaction());
    const withdrawNativeCredit = vi.fn(async () => transaction());
    install({
      getEpochMetadata: vi.fn(async () => ({
        exists: true,
        membershipRevision: 5n,
        rotatedBy: ALICE,
        createdAt: 12n,
        firstMessageId: 1n
      })),
      syncMyEpochEnvelope,
      pendingNativeCredits: vi.fn(async () => 17n),
      withdrawNativeCredit
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await expect(syncGroupChatV2EpochEnvelope({
      deployment,
      capability,
      groupId: 1n,
      epoch: 3n
    })).resolves.toMatchObject({ txHash: TX_HASH });
    await expect(readGroupChatV2NativeCredit({ deployment, capability })).resolves.toBe(17n);
    await expect(withdrawGroupChatV2NativeCredit({ deployment, capability }))
      .resolves.toMatchObject({ observedCredit: 17n, transaction: { txHash: TX_HASH } });
    expect(syncMyEpochEnvelope).toHaveBeenCalledWith(1n, 3n, { gasLimit: 130_000n });
    expect(withdrawNativeCredit).toHaveBeenCalledOnce();
  });

  it('parses, authenticates, decrypts, and receipt-binds canonical GroupMessagePosted logs', async () => {
    install({});
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    const fixture = await groupMessageFixture();
    const event = parseGroupChatV2MessagePostedLog({ deployment, log: fixture.log });

    expect(event).toMatchObject({
      protocol: 'group-v2',
      key: `group-v2:${CHAIN_ID}:${GROUP.toLowerCase()}:1:5`,
      groupId: 1n,
      messageId: 5n,
      epoch: 3n,
      membershipRevision: 5n,
      sender: ALICE,
      transactionHash: TX_HASH,
      blockHash: BLOCK_HASH
    });
    await expect(decryptGroupChatV2EventMessage({ event, key: epochKey() }))
      .resolves.toBe('canonical group message');

    const receipt = {
      status: 1,
      transactionHash: TX_HASH,
      blockHash: BLOCK_HASH,
      blockNumber: 111n,
      logs: [fixture.log]
    };
    expect(parseGroupChatV2MessageReceipt({
      deployment,
      receipt,
      expected: {
        transactionHash: TX_HASH,
        context: fixture.context,
        encrypted: fixture.encrypted
      }
    }).messageId).toBe(5n);

    expect(() => parseGroupChatV2MessageReceipt({
      deployment,
      receipt,
      expected: {
        transactionHash: TX_HASH,
        context: { ...fixture.context, senderSequence: 8n },
        encrypted: fixture.encrypted
      }
    })).toThrow('does not match');
  });

  it('reads only a bounded provider-owned group log page in canonical order', async () => {
    const first = await groupMessageFixture({ messageId: 5n, blockNumber: 111n });
    const secondFixture = await groupMessageFixture({ messageId: 6n, blockNumber: 112n });
    const second = {
      ...secondFixture,
      log: {
        ...secondFixture.log,
        transactionHash: `0x${'cc'.repeat(32)}`,
        blockHash: `0x${'dd'.repeat(32)}`,
        index: 1
      }
    };
    const provider = makeProvider();
    provider.getLogs = vi.fn(async () => [second.log, first.log]) as never;
    install({ getGroup: vi.fn(async () => groupSnapshot()) });
    const capability = await bind(makeSigner({ provider }));
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    const page = await readGroupChatV2MessageLogPage({
      deployment,
      capability,
      groupId: 1n,
      fromBlock: 101n,
      toBlock: 120n
    });
    expect(page.map((event) => event.messageId)).toEqual([5n, 6n]);
    expect(provider.getLogs).toHaveBeenCalledWith({
      address: GROUP,
      fromBlock: 101,
      toBlock: 120,
      topics: [expect.any(String), `0x${'1'.padStart(64, '0')}`]
    });
    await expect(readGroupChatV2MessageLogPage({
      deployment,
      capability,
      groupId: 1n,
      fromBlock: 101n,
      toBlock: 2_149n
    })).rejects.toThrow('bounded page');
  });

  it('discovers only owner-indexed lifecycle logs and reads canonical group projections', async () => {
    const provider = makeProvider();
    const lifecycle = GROUP_INTERFACE.encodeEventLog(
      GROUP_INTERFACE.getEvent('GroupMemberAdded')!,
      [1n, ALICE, 5n, 1n, 1n]
    );
    provider.getLogs = vi.fn(async () => [{
      address: GROUP,
      topics: lifecycle.topics,
      data: lifecycle.data,
      transactionHash: TX_HASH,
      blockHash: BLOCK_HASH,
      blockNumber: 111n,
      index: 2,
      removed: false
    }]) as never;
    provider.getBlock = vi.fn(async () => ({
      number: 111,
      hash: BLOCK_HASH,
      timestamp: 1_000
    })) as never;
    const getGroup = vi.fn(async (_groupId: bigint, options?: { blockTag?: number }) => ({
      ...groupSnapshot(),
      messageCount: options?.blockTag === 111 ? 4n : 5n
    }));
    const getGroupMembersPage = vi.fn()
      .mockResolvedValueOnce({ members: [ALICE, BOB], nextCursor: 2n })
      .mockResolvedValueOnce({ members: [], nextCursor: 2n });
    const getMembershipRangesPage = vi.fn(async () => ({
      ranges: [{
        firstMessageId: 5n,
        lastMessageId: 0n,
        firstEpoch: 2n,
        lastEpoch: 0n,
        joinedRevision: 2n,
        leftRevision: 0n,
        joinedAt: 900n,
        leftAt: 0n
      }],
      nextCursor: 0n
    }));
    install({ getGroup, getGroupMembersPage, getMembershipRangesPage });
    const capability = await bind(makeSigner({ provider }));
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await expect(readGroupChatV2WalletLifecycleLogPage({
      deployment,
      capability,
      walletAddress: ALICE,
      fromBlock: 101n,
      toBlock: 120n
    })).resolves.toEqual([expect.objectContaining({
      kind: 'member-added',
      groupId: 1n,
      walletAddress: ALICE,
      blockHash: BLOCK_HASH
    })]);
    await expect(readGroupChatV2Members({ deployment, capability, groupId: 1n }))
      .resolves.toEqual([ALICE, BOB]);
    await expect(readGroupChatV2MembershipRanges({
      deployment,
      capability,
      groupId: 1n,
      account: ALICE
    })).resolves.toEqual([{
      generation: 1n,
      firstMessageId: 5n,
      lastMessageId: 0n,
      firstEpoch: 2n,
      lastEpoch: 0n,
      joinedRevision: 2n,
      leftRevision: 0n,
      joinedAt: 900n,
      leftAt: 0n
    }]);
    await expect(readGroupChatV2CanonicalBlock({
      deployment,
      capability,
      blockNumber: 111n
    })).resolves.toEqual({ blockNumber: 111n, blockHash: BLOCK_HASH, timestamp: 1_000 });
    await expect(readGroupChatV2MessageCountAtBlock({
      deployment,
      capability,
      groupId: 1n,
      blockNumber: 111n
    })).resolves.toBe(4n);
    expect(getGroup).toHaveBeenLastCalledWith(1n, { blockTag: 111 });
  });

  it('binds invite and removal batches to exact member generations and group revisions', async () => {
    const inviteMembers = vi.fn(async () => transaction());
    const removeMembers = vi.fn(async () => transaction());
    const getMember = vi.fn(async (_groupId: bigint, account: string) => ({
      active: account === BOB,
      generation: account === BOB ? 4n : 2n,
      joinedAt: account === BOB ? 10n : 0n,
      leftAt: 0n,
      firstReadableMessageId: account === BOB ? 1n : 0n
    }));
    install({
      getGroup: vi.fn(async () => groupSnapshot()),
      getMember,
      inviteMembers,
      removeMembers
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });
    const invitee = '0x4444444444444444444444444444444444444444';

    await inviteGroupChatV2Members({
      deployment,
      capability,
      groupId: 1n,
      accounts: [invitee],
      ttl: 3_600n
    });
    expect(inviteMembers).toHaveBeenCalledWith(1n, [invitee], [2n], 3_600n, 2n, 5n, { gasLimit: 130_000n });

    await removeGroupChatV2Members({
      deployment,
      capability,
      groupId: 1n,
      accounts: [BOB]
    });
    expect(removeMembers).toHaveBeenCalledWith(1n, [BOB], [4n], 2n, 5n, { gasLimit: 130_000n });
  });

  it('accepts, declines, and revokes only the exact pending invite generation', async () => {
    const acceptInvite = vi.fn(async () => transaction());
    const declineInvite = vi.fn(async () => transaction());
    const revokeInvite = vi.fn(async () => transaction());
    install({
      getGroup: vi.fn(async () => groupSnapshot()),
      getMember: vi.fn(async () => ({
        active: false,
        generation: 2n,
        joinedAt: 0n,
        leftAt: 0n,
        firstReadableMessageId: 0n
      })),
      getInvite: vi.fn(async () => ({
        invite: {
          inviter: ALICE,
          expiresAt: 999n,
          generation: 7n,
          issuerAdminRevision: 2n,
          recipientGeneration: 2n,
          pending: true
        },
        effective: true
      })),
      acceptInvite,
      declineInvite,
      revokeInvite
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await acceptGroupChatV2Invite({ deployment, capability, groupId: 1n });
    expect(acceptInvite).toHaveBeenCalledWith(1n, 7n, 2n, 2n, { gasLimit: 130_000n });
    await declineGroupChatV2Invite({ deployment, capability, groupId: 1n });
    expect(declineInvite).toHaveBeenCalledWith(1n, 7n, { gasLimit: 130_000n });
    await revokeGroupChatV2Invite({ deployment, capability, groupId: 1n, account: BOB });
    expect(revokeInvite).toHaveBeenCalledWith(1n, BOB, 7n, 2n, 5n, { gasLimit: 130_000n });
  });

  it('guards admin transfer, key rotation, disband, and leave with current revisions', async () => {
    const setGroupAdmin = vi.fn(async () => transaction());
    const rotateGroupKey = vi.fn(async () => transaction());
    const disbandGroup = vi.fn(async () => transaction());
    const leaveGroup = vi.fn(async () => transaction());
    const getGroup = vi.fn(async () => groupSnapshot());
    install({
      getGroup,
      getMember: vi.fn(async (_groupId: bigint, account: string) => ({
        active: true,
        generation: account === BOB ? 4n : 1n,
        joinedAt: 10n,
        leftAt: 0n,
        firstReadableMessageId: 1n
      })),
      setGroupAdmin,
      rotateGroupKey,
      disbandGroup,
      leaveGroup
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await setGroupChatV2Admin({ deployment, capability, groupId: 1n, nextAdmin: BOB });
    expect(setGroupAdmin).toHaveBeenCalledWith(1n, BOB, 4n, 2n, 5n, { gasLimit: 130_000n });
    await expect(rotateGroupChatV2Key({ deployment, capability, groupId: 1n }))
      .resolves.toMatchObject({ nextEpoch: 4n });
    expect(rotateGroupKey).toHaveBeenCalledWith(1n, 3n, 2n, 5n, { gasLimit: 130_000n });
    await disbandGroupChatV2({ deployment, capability, groupId: 1n });
    expect(disbandGroup).toHaveBeenCalledWith(1n, 2n, 5n, { gasLimit: 130_000n });
    await expect(leaveGroupChatV2({ deployment, capability, groupId: 1n }))
      .rejects.toThrow('Transfer group administration');
    expect(leaveGroup).not.toHaveBeenCalled();
  });

  it('binds join-code creation, proof, joining, and revocation to one exact generation', async () => {
    const codeHash = `0x${'77'.repeat(32)}`;
    const digest = `0x${'88'.repeat(32)}`;
    const signature = `0x${'99'.repeat(65)}`;
    const createJoinCode = vi.fn(async () => transaction());
    const revokeJoinCode = vi.fn(async () => transaction());
    const getJoinCodeProofDigest = vi.fn(async () => digest);
    const joinWithCode = vi.fn(async () => transaction());
    install({
      getGroup: vi.fn(async () => groupSnapshot()),
      getJoinCode: vi.fn(async () => ({
        joinCode: {
          creator: ALICE,
          proofSigner: BOB,
          expiresAt: 999n,
          generation: 9n,
          issuerAdminRevision: 2n,
          usesLeft: 3n,
          active: true
        },
        effective: true
      })),
      createJoinCode,
      revokeJoinCode,
      getJoinCodeProofDigest,
      joinWithCode
    });
    const capability = await bind();
    const deployment = await verifyGroupChatV2Deployment({ manifest: MANIFEST, capability });

    await createGroupChatV2JoinCode({
      deployment,
      capability,
      groupId: 1n,
      codeHash,
      proofSigner: BOB,
      ttl: 7_200n,
      uses: 3n
    });
    expect(createJoinCode).toHaveBeenCalledWith(1n, codeHash, BOB, 7_200n, 3n, 2n, 5n, { gasLimit: 130_000n });
    await expect(readGroupChatV2JoinCode({ deployment, capability, groupId: 1n, codeHash }))
      .resolves.toMatchObject({ generation: 9n, effective: true, usesLeft: 3n });
    await expect(readGroupChatV2JoinProofDigest({
      deployment,
      capability,
      groupId: 1n,
      codeHash,
      generation: 9n,
      expectedAdminRevision: 2n,
      signatureDeadline: 1_000n
    })).resolves.toBe(digest);
    await joinGroupChatV2WithCode({
      deployment,
      capability,
      groupId: 1n,
      codeHash,
      generation: 9n,
      expectedAdminRevision: 2n,
      signatureDeadline: 1_000n,
      signature
    });
    expect(joinWithCode).toHaveBeenCalledWith(1n, codeHash, 9n, 2n, 1_000n, signature, { gasLimit: 130_000n });
    await revokeGroupChatV2JoinCode({ deployment, capability, groupId: 1n, codeHash });
    expect(revokeJoinCode).toHaveBeenCalledWith(1n, codeHash, 9n, 2n, 5n, { gasLimit: 130_000n });
  });
});
