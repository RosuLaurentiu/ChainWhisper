import { beforeEach, describe, expect, it, vi } from 'vitest';

const chain = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  assertCapabilitySnapshot: vi.fn(),
  assertCapabilityScope: vi.fn(),
  createGroup: vi.fn(),
  decryptMetadata: vi.fn(),
  inviteMembers: vi.fn(),
  parseCreated: vi.fn(),
  parseMessageReceipt: vi.fn(),
  readEpochKey: vi.fn(),
  readGroup: vi.fn(),
  readHistory: vi.fn(),
  readMetadataHistory: vi.fn(),
  readMetadataVersion: vi.fn(),
  readCredit: vi.fn(),
  removeMembers: vi.fn(),
  rotateKey: vi.fn(),
  sendMessage: vi.fn(),
  signImageSession: vi.fn(),
  setMetadata: vi.fn(),
  syncEpoch: vi.fn(),
  verify: vi.fn(),
  withdrawCredit: vi.fn()
}));

vi.mock('./groupChatV2Chain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./groupChatV2Chain')>(),
  assertGroupChatV2MetaMaskCapabilitySnapshotCurrent: chain.assertCapabilitySnapshot,
  assertGroupChatV2MetaMaskCapabilityScope: chain.assertCapabilityScope,
  createGroupChatV2Group: chain.createGroup,
  decryptGroupChatV2MetadataEvent: chain.decryptMetadata,
  inviteGroupChatV2Members: chain.inviteMembers,
  parseGroupChatV2CreatedReceipt: chain.parseCreated,
  parseGroupChatV2MessageReceipt: chain.parseMessageReceipt,
  readGroupChatV2EpochKey: chain.readEpochKey,
  readGroupChatV2Group: chain.readGroup,
  readGroupChatV2MessageLogPage: chain.readHistory,
  readGroupChatV2MetadataLogPage: chain.readMetadataHistory,
  readGroupChatV2MetadataVersionAtBlock: chain.readMetadataVersion,
  readGroupChatV2NativeCredit: chain.readCredit,
  removeGroupChatV2Members: chain.removeMembers,
  rotateGroupChatV2Key: chain.rotateKey,
  sendGroupChatV2Message: chain.sendMessage,
  signGroupChatV2ImageSessionAuthorization: chain.signImageSession,
  setGroupChatV2EncryptedMetadata: chain.setMetadata,
  syncGroupChatV2EpochEnvelope: chain.syncEpoch,
  verifyGroupChatV2Deployment: chain.verify,
  withdrawGroupChatV2NativeCredit: chain.withdrawCredit
}));

import {
  assertGroupChatV2SessionController,
  createGroupChatV2Session
} from './groupChatV2Session';
import type { GroupChatV2MetaMaskCapability } from './groupChatV2Chain';

const OWNER = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x2222222222222222222222222222222222222222';
const CHAIN_ID = 7_082_400n;
const TX_HASH = `0x${'aa'.repeat(32)}`;
const REPLACEMENT_HASH = `0x${'bb'.repeat(32)}`;
const MANIFEST = {
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  deploymentBlock: 101n,
  runtimeBytecodeHash: `0x${'33'.repeat(32)}`
};
const CAPABILITY = Object.freeze({}) as GroupChatV2MetaMaskCapability;
const GROUP = Object.freeze({
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  groupId: 1n,
  admin: OWNER,
  createdAt: 1n,
  updatedAt: 1n,
  currentEpoch: 3n,
  messageCount: 4n,
  createdBlock: 101n,
  firstMessageBlock: 110n,
  lastMessageBlock: 120n,
  metadataVersion: 2n,
  membershipRevision: 5n,
  adminRevision: 2n,
  memberCount: 2n,
  archived: false
});
const KEY = Object.freeze({
  value: 123n,
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  groupId: 1n,
  epoch: 3n,
  membershipRevision: 5n
});

const receipt = (hash = TX_HASH) => ({
  status: 1,
  transactionHash: hash,
  blockHash: `0x${'44'.repeat(32)}`,
  blockNumber: 120n,
  logs: []
});
const transaction = (wait = vi.fn(async () => receipt())) => ({ txHash: TX_HASH, wait });

const setup = () => {
  chain.assertCapability.mockResolvedValue(undefined);
  chain.assertCapabilitySnapshot.mockReturnValue(undefined);
  chain.verify.mockResolvedValue(MANIFEST);
  chain.readGroup.mockResolvedValue(GROUP);
  chain.readEpochKey.mockResolvedValue(KEY);
  chain.parseCreated.mockReturnValue({
    groupId: 1n,
    admin: OWNER,
    membershipRevision: 5n,
    adminRevision: 2n,
    epoch: 3n
  });
  chain.parseMessageReceipt.mockReturnValue({
    protocol: 'group-v2',
    key: `group-v2:${CHAIN_ID}:${CONTRACT}:1:5`,
    groupId: 1n,
    messageId: 5n
  });
  const runOwnerTransactionFlow = async <T>(operation: () => Promise<T>): Promise<T> => operation();
  return {
    getOwnerCapability: vi.fn(async () => CAPABILITY),
    retireNonceAttempt: vi.fn(async () => undefined),
    runOwnerTransactionFlow
  };
};

describe('groupChatV2Session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mints a frozen runtime-branded controller and creates through the bound browser-wallet owner only', async () => {
    const dependencies = setup();
    chain.createGroup.mockResolvedValue(transaction());
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: OWNER });

    expect(Object.isFrozen(controller)).toBe(true);
    expect(() => assertGroupChatV2SessionController({ ...controller })).toThrow('bound browser-wallet');
    expect(() => assertGroupChatV2SessionController(controller)).not.toThrow();
    const invitees = ['0x3333333333333333333333333333333333333333'];
    const creation = controller.create(invitees);
    invitees[0] = '0x9999999999999999999999999999999999999999';
    await expect(creation)
      .resolves.toEqual({ group: GROUP, transactionHash: TX_HASH });
    expect(dependencies.getOwnerCapability).toHaveBeenCalledWith(false);
    expect(chain.createGroup).toHaveBeenCalledWith(expect.objectContaining({
      capability: CAPABILITY,
      initialInvitees: ['0x3333333333333333333333333333333333333333']
    }));
  });

  it('confirms creation for a checksummed owner and the lowercase read-adapter admin', async () => {
    const dependencies = setup();
    const owner = '0x5DFcEe20b5a3FDd3577436A32f62d4C0b39e979d';
    const group = { ...GROUP, admin: owner.toLowerCase(), currentEpoch: 1n,
      membershipRevision: 1n, adminRevision: 1n };
    chain.createGroup.mockResolvedValue(transaction());
    chain.readGroup.mockResolvedValue(group);
    chain.parseCreated.mockReturnValue({ groupId: group.groupId, admin: owner.toLowerCase(),
      epoch: 1n, membershipRevision: 1n, adminRevision: 1n });
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: owner });

    expect(controller.ownerAddress).toBe(owner);
    await expect(controller.create()).resolves.toEqual({ group, transactionHash: TX_HASH });
    expect(chain.parseCreated).toHaveBeenCalledWith(expect.objectContaining({ expectedAdmin: owner }));
  });

  it('rejects confirmed creation state with a different admin address', async () => {
    const dependencies = setup();
    chain.createGroup.mockResolvedValue(transaction());
    chain.readGroup.mockResolvedValue({ ...GROUP, admin: CONTRACT });
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: OWNER });

    await expect(controller.create()).rejects.toThrow('Created group state does not match its confirmed event.');
  });

  it('caches an epoch seed only in session memory and clears it explicitly', async () => {
    const dependencies = setup();
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: OWNER });
    await expect(controller.readEpochKey(1n)).resolves.toBe(KEY);
    await expect(controller.readEpochKey(1n)).resolves.toBe(KEY);
    expect(chain.readEpochKey).toHaveBeenCalledOnce();
    controller.clearEpochKeys();
    await controller.readEpochKey(1n);
    expect(chain.readEpochKey).toHaveBeenCalledTimes(2);
    expect(dependencies.getOwnerCapability).toHaveBeenCalledWith(true);
  });

  it('serializes private epoch-key reads across different group epochs', async () => {
    const dependencies = setup();
    let activeReads = 0;
    let maxActiveReads = 0;
    let releaseFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => { releaseFirst = resolve; });
    chain.readEpochKey.mockImplementation(async ({ epoch }: { epoch: bigint }) => {
      activeReads += 1;
      maxActiveReads = Math.max(maxActiveReads, activeReads);
      try {
        if (epoch === 1n) await firstRead;
        return Object.freeze({ ...KEY, epoch });
      } finally {
        activeReads -= 1;
      }
    });
    const controller = createGroupChatV2Session({
      ...dependencies,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    const epochOne = controller.readEpochKey(1n, 1n);
    await vi.waitFor(() => expect(chain.readEpochKey).toHaveBeenCalledTimes(1));
    const epochTwo = controller.readEpochKey(1n, 2n);
    await Promise.resolve();

    expect(chain.readEpochKey).toHaveBeenCalledTimes(1);
    expect(maxActiveReads).toBe(1);
    releaseFirst();
    await expect(Promise.all([epochOne, epochTwo])).resolves.toMatchObject([
      { epoch: 1n },
      { epoch: 2n }
    ]);
    expect(chain.readEpochKey).toHaveBeenCalledTimes(2);
    expect(maxActiveReads).toBe(1);
  });

  it('serializes an image-session signature through the bound owner capability', async () => {
    const dependencies = setup();
    const message = 'ChainWhisper Chat Image Upload Session\nversion:1';
    chain.signImageSession.mockResolvedValue(`0x${'ab'.repeat(65)}`);
    const controller = createGroupChatV2Session({
      ...dependencies,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.signImageSessionAuthorization(message))
      .resolves.toBe(`0x${'ab'.repeat(65)}`);
    expect(dependencies.getOwnerCapability).toHaveBeenCalledWith(false);
    expect(chain.signImageSession).toHaveBeenCalledWith({ capability: CAPABILITY, message });
  });

  it('keeps background credit reads on the passive capability getter', async () => {
    const dependencies = setup();
    chain.readCredit.mockResolvedValue(7n);
    const controller = createGroupChatV2Session({
      ...dependencies,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.readNativeCredit()).resolves.toBe(7n);

    expect(dependencies.getOwnerCapability).toHaveBeenCalledWith(false);
    expect(chain.assertCapability).not.toHaveBeenCalled();
  });

  it('invalidates and reacquires once when a cached mutation capability is stale', async () => {
    const dependencies = setup();
    const freshCapability = Object.freeze({ fresh: true }) as unknown as GroupChatV2MetaMaskCapability;
    dependencies.getOwnerCapability
      .mockResolvedValueOnce(CAPABILITY)
      .mockResolvedValueOnce(freshCapability);
    chain.assertCapabilitySnapshot
      .mockImplementationOnce(() => { throw new Error('stale owner session'); })
      .mockReturnValueOnce(undefined);
    const invalidateOwnerCapabilities = vi.fn();
    chain.signImageSession.mockResolvedValue(`0x${'ab'.repeat(65)}`);
    const controller = createGroupChatV2Session({
      ...dependencies,
      invalidateOwnerCapabilities,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.signImageSessionAuthorization('image-session'))
      .resolves.toBe(`0x${'ab'.repeat(65)}`);

    expect(dependencies.getOwnerCapability).toHaveBeenCalledTimes(2);
    expect(invalidateOwnerCapabilities).toHaveBeenCalledOnce();
    expect(chain.assertCapability).not.toHaveBeenCalled();
    expect(chain.signImageSession).toHaveBeenCalledWith({
      capability: freshCapability,
      message: 'image-session'
    });
  });

  it('sends one encrypted reply transaction and reconciles only its exact receipt event', async () => {
    const dependencies = setup();
    chain.sendMessage.mockImplementation(async (input: Record<string, unknown>) => {
      await (input.retireNonceAttempt as (attempt: object) => Promise<void>)({
        purpose: 'message'
      });
      return {
        encrypted: { nonce: `0x${'55'.repeat(12)}`, aadHash: `0x${'66'.repeat(32)}`, ciphertext: '0x1234' },
        context: { groupId: 1n },
        transaction: transaction()
      };
    });
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: OWNER });

    const input = {
      body: 'reply',
      replyToMessageId: 4n,
      replyPreview: 'previous'
    };
    const pending = controller.send(1n, input);
    input.body = 'mutated after confirmation started';
    input.replyPreview = 'wrong preview';
    const result = await pending;
    expect(result.payload).toEqual({
      version: 1,
      body: 'reply',
      replyToMessageId: 4n,
      replyPreview: 'previous'
    });
    expect(result.transactionHash).toBe(TX_HASH);
    expect(chain.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      plaintext: '{"v":1,"b":"reply","r":"4","p":"previous"}',
      key: KEY,
      retireNonceAttempt: dependencies.retireNonceAttempt
    }));
    expect(chain.parseMessageReceipt).toHaveBeenCalledOnce();
    expect(chain.assertCapabilitySnapshot).toHaveBeenCalledOnce();
    expect(chain.assertCapability).not.toHaveBeenCalled();
  });

  it('refreshes a stale pre-join group epoch before sending without another wallet action', async () => {
    const dependencies = setup();
    chain.readGroup
      .mockResolvedValueOnce({ ...GROUP, currentEpoch: 2n, membershipRevision: 4n })
      .mockResolvedValueOnce(GROUP);
    chain.readEpochKey
      .mockRejectedValueOnce({ data: '0xab65a305' })
      .mockResolvedValueOnce(KEY);
    chain.sendMessage.mockResolvedValue({
      encrypted: { nonce: `0x${'55'.repeat(12)}`, aadHash: `0x${'66'.repeat(32)}`, ciphertext: '0x1234' },
      context: { groupId: 1n },
      transaction: transaction()
    });
    const controller = createGroupChatV2Session({
      ...dependencies,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.send(1n, { body: 'joined group' })).resolves.toMatchObject({
      transactionHash: TX_HASH
    });

    expect(chain.readGroup).toHaveBeenCalledTimes(2);
    expect(chain.readEpochKey).toHaveBeenNthCalledWith(1, expect.objectContaining({ epoch: 2n }));
    expect(chain.readEpochKey).toHaveBeenNthCalledWith(2, expect.objectContaining({ epoch: 3n }));
    expect(chain.sendMessage).toHaveBeenCalledOnce();
  });

  it('does not retry an unchanged unauthorized group epoch', async () => {
    const dependencies = setup();
    const unauthorized = { data: '0xab65a305' };
    chain.readEpochKey.mockRejectedValueOnce(unauthorized);
    const controller = createGroupChatV2Session({
      ...dependencies,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.send(1n, { body: 'not authorized' })).rejects.toBe(unauthorized);

    expect(chain.readGroup).toHaveBeenCalledTimes(2);
    expect(chain.readEpochKey).toHaveBeenCalledOnce();
    expect(chain.sendMessage).not.toHaveBeenCalled();
  });

  it('reacquires once when the final lease guard rejects before forwarding the group transaction', async () => {
    const dependencies = setup();
    const freshCapability = Object.freeze({ fresh: true }) as unknown as GroupChatV2MetaMaskCapability;
    dependencies.getOwnerCapability
      .mockResolvedValueOnce(CAPABILITY)
      .mockResolvedValueOnce(freshCapability);
    const invalidateOwnerCapabilities = vi.fn();
    chain.sendMessage
      .mockRejectedValueOnce({
        code: 'UNKNOWN_ERROR',
        error: {
          message: 'Owner wallet session changed. Reconnect the owner wallet and try again. [lifecycle-epoch]'
        },
        message: 'could not coalesce error'
      })
      .mockResolvedValueOnce({
        encrypted: { nonce: `0x${'55'.repeat(12)}`, aadHash: `0x${'66'.repeat(32)}`, ciphertext: '0x1234' },
        context: { groupId: 1n },
        transaction: transaction()
      });
    const controller = createGroupChatV2Session({
      ...dependencies,
      invalidateOwnerCapabilities,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.send(1n, { body: 'retry exact intent' })).resolves.toMatchObject({
      transactionHash: TX_HASH
    });
    expect(invalidateOwnerCapabilities).toHaveBeenCalledOnce();
    expect(dependencies.getOwnerCapability).toHaveBeenCalledTimes(2);
    expect(chain.sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      capability: freshCapability,
      plaintext: '{"v":1,"b":"retry exact intent"}'
    }));
    expect(chain.parseMessageReceipt).toHaveBeenCalledOnce();
  });

  it('fails closed when the replacement capability cannot bind the original group owner', async () => {
    const dependencies = setup();
    dependencies.getOwnerCapability
      .mockResolvedValueOnce(CAPABILITY)
      .mockRejectedValueOnce(new Error('Replacement owner session does not match the group owner.'));
    const invalidateOwnerCapabilities = vi.fn();
    chain.sendMessage.mockRejectedValueOnce({
      error: {
        message: 'Owner wallet session changed. Reconnect the owner wallet and try again. [live-account]'
      },
      message: 'could not coalesce error'
    });
    const controller = createGroupChatV2Session({
      ...dependencies,
      invalidateOwnerCapabilities,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.send(1n, { body: 'must not cross owner' }))
      .rejects.toThrow('does not match the group owner');
    expect(invalidateOwnerCapabilities).toHaveBeenCalledOnce();
    expect(chain.sendMessage).toHaveBeenCalledOnce();
    expect(chain.parseMessageReceipt).not.toHaveBeenCalled();
  });

  it('accepts a non-cancelled speed-up for exact message receipt binding but rejects it for setup', async () => {
    const dependencies = setup();
    const replacementError = {
      code: 'TRANSACTION_REPLACED',
      cancelled: false,
      replacement: { hash: REPLACEMENT_HASH },
      receipt: receipt(REPLACEMENT_HASH)
    };
    chain.sendMessage.mockResolvedValue({
      encrypted: { nonce: `0x${'55'.repeat(12)}`, aadHash: `0x${'66'.repeat(32)}`, ciphertext: '0x1234' },
      context: { groupId: 1n },
      transaction: transaction(vi.fn(async () => { throw replacementError; }))
    });
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: OWNER });
    await expect(controller.send(1n, { body: 'speed up' }))
      .resolves.toMatchObject({ transactionHash: REPLACEMENT_HASH });
    expect(chain.parseMessageReceipt).toHaveBeenCalledWith(expect.objectContaining({
      expected: expect.objectContaining({ transactionHash: REPLACEMENT_HASH })
    }));

    chain.createGroup.mockResolvedValue(transaction(vi.fn(async () => { throw replacementError; })));
    await expect(controller.create()).rejects.toThrow('replacement was not accepted');
  });

  it('serializes wallet mutations and does not expose a legacy fallback seam', async () => {
    const dependencies = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    chain.createGroup.mockResolvedValue(transaction(vi.fn(async () => {
      await gate;
      return receipt();
    })));
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: OWNER });
    const pending = controller.create();
    await Promise.resolve();
    await expect(controller.create()).rejects.toThrow('current Group Chat V2 wallet operation');
    release();
    await pending;
    expect(JSON.stringify(Object.keys(controller))).not.toMatch(/legacy|appWallet|burner/u);
  });

  it('routes membership writes through one transaction and clears cached keys after epoch changes', async () => {
    const dependencies = setup();
    chain.inviteMembers.mockResolvedValue(transaction());
    chain.removeMembers.mockResolvedValue(transaction());
    chain.rotateKey.mockResolvedValue({ nextEpoch: 4n, transaction: transaction() });
    const controller = createGroupChatV2Session({ ...dependencies, manifest: MANIFEST, ownerAddress: OWNER });

    await controller.readEpochKey(1n);
    expect(chain.readEpochKey).toHaveBeenCalledOnce();
    await expect(controller.inviteMembers(1n, ['0x3333333333333333333333333333333333333333'], 60n))
      .resolves.toEqual({ transactionHash: TX_HASH });
    await controller.readEpochKey(1n);
    expect(chain.readEpochKey).toHaveBeenCalledOnce();

    await controller.removeMembers(1n, ['0x3333333333333333333333333333333333333333']);
    await controller.readEpochKey(1n);
    expect(chain.readEpochKey).toHaveBeenCalledTimes(2);
    await expect(controller.rotateKey(1n)).resolves.toEqual({ epoch: 4n, transactionHash: TX_HASH });
    expect(chain.inviteMembers).toHaveBeenCalledWith(expect.objectContaining({ ttl: 60n }));
    expect(chain.removeMembers).toHaveBeenCalledOnce();
    expect(chain.rotateKey).toHaveBeenCalledOnce();
  });

  it('encodes private metadata before writing and decodes only an authenticated event', async () => {
    const dependencies = setup();
    chain.setMetadata.mockResolvedValue({ transaction: transaction() });
    chain.readGroup
      .mockResolvedValueOnce(GROUP)
      .mockResolvedValueOnce({ ...GROUP, metadataVersion: 3n });
    chain.decryptMetadata.mockResolvedValue('{"v":1,"n":"Private Desk"}');
    const controller = createGroupChatV2Session({
      ...dependencies,
      manifest: MANIFEST,
      ownerAddress: OWNER
    });

    await expect(controller.setMetadata(1n, '  Private   Desk  '))
      .resolves.toMatchObject({ metadataVersion: 3n });
    expect(chain.setMetadata).toHaveBeenCalledWith(expect.objectContaining({
      plaintext: '{"v":1,"n":"Private Desk"}',
      key: KEY
    }));

    const event = { groupId: 1n, epoch: 3n } as never;
    await expect(controller.readMetadata(event))
      .resolves.toEqual({ version: 1, title: 'Private Desk' });
    expect(chain.decryptMetadata).toHaveBeenCalledWith({ event, key: KEY });
  });
});
