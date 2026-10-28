import { getAddress } from '@coti-io/coti-ethers';
import { isBrowserWalletSessionChangedError } from './appShared/core';
import {
  acceptGroupChatV2Invite,
  assertGroupChatV2MetaMaskCapabilitySnapshotCurrent,
  assertGroupChatV2MetaMaskCapabilityScope,
  createGroupChatV2JoinCode,
  createGroupChatV2Group,
  declineGroupChatV2Invite,
  decryptGroupChatV2MetadataEvent,
  disbandGroupChatV2,
  inviteGroupChatV2Members,
  joinGroupChatV2WithCode,
  leaveGroupChatV2,
  parseGroupChatV2CreatedReceipt,
  parseGroupChatV2MessageReceipt,
  readGroupChatV2CanonicalBlock,
  readGroupChatV2EpochKey,
  readGroupChatV2Group,
  readGroupChatV2Invite,
  readGroupChatV2JoinCode,
  readGroupChatV2Member,
  readGroupChatV2MembershipRanges,
  readGroupChatV2Members,
  readGroupChatV2MetadataLogPage,
  readGroupChatV2MetadataVersionAtBlock,
  readGroupChatV2MessageLogPage,
  readGroupChatV2LatestBlockNumber,
  readGroupChatV2MessageCountAtBlock,
  readGroupChatV2WalletLifecycleLogPage,
  readGroupChatV2NativeCredit,
  readGroupChatV2JoinProofDigest,
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
  type GroupChatV2EpochKey,
  type GroupChatV2CanonicalBlock,
  type GroupChatV2GroupSnapshot,
  type GroupChatV2InviteSnapshot,
  type GroupChatV2JoinCodeSnapshot,
  type GroupChatV2MemberSnapshot,
  type GroupChatV2MembershipRangeSnapshot,
  type GroupChatV2MetadataEvent,
  type GroupChatV2MessageEvent,
  type GroupChatV2MetaMaskCapability,
  type GroupChatV2NonceAttemptRetirer,
  type GroupChatV2Transaction,
  type GroupChatV2WalletLifecycleEvent,
  type VerifiedGroupChatV2Deployment
} from './groupChatV2Chain';
import { captureWalletActionIntent, readWalletActionIntent } from './walletActionIntent';
import type { GroupChatV2DeploymentManifest } from './groupChatV2Deployment';
import {
  decodeGroupChatV2Payload,
  encodeGroupChatV2Payload,
  type GroupChatV2Payload
} from './groupChatV2Payload';
import {
  decodeGroupChatV2MetadataPayload,
  encodeGroupChatV2MetadataPayload,
  type GroupChatV2MetadataPayload
} from './groupChatV2MetadataPayload';
import type { GroupChatV2ReadCursorAnchor } from './groupChatV2ReadCursor';

export type GroupChatV2OwnerCapabilityGetter = (
  requirePrivacy: boolean
) => Promise<GroupChatV2MetaMaskCapability>;
export type GroupChatV2TransactionFlow = <T>(operation: () => Promise<T>) => Promise<T>;

export type GroupChatV2SendInput = Readonly<{
  body: string;
  replyToMessageId?: bigint;
  replyToMessageAnchor?: string;
  replyPreview?: string;
}>;

export type GroupChatV2SendResult = Readonly<{
  event: GroupChatV2MessageEvent;
  payload: GroupChatV2Payload;
  submittedTransactionHash: string;
  transactionHash: string;
}>;

export type GroupChatV2CreateResult = Readonly<{
  group: GroupChatV2GroupSnapshot;
  transactionHash: string;
}>;
export type GroupChatV2ConfirmedMutation = Readonly<{ transactionHash: string }>;

declare const GROUP_CHAT_V2_SESSION_BRAND: unique symbol;
export type GroupChatV2SessionController = Readonly<{
  readonly [GROUP_CHAT_V2_SESSION_BRAND]: true;
  manifest: Readonly<GroupChatV2DeploymentManifest>;
  ownerAddress: string;
  create: (initialInvitees?: readonly string[]) => Promise<GroupChatV2CreateResult>;
  inspect: (groupId: bigint) => Promise<GroupChatV2GroupSnapshot>;
  inspectMember: (groupId: bigint, account: string) => Promise<GroupChatV2MemberSnapshot>;
  membershipRanges: (
    groupId: bigint,
    account?: string
  ) => Promise<readonly GroupChatV2MembershipRangeSnapshot[]>;
  inspectInvite: (groupId: bigint, account: string) => Promise<GroupChatV2InviteSnapshot>;
  inspectJoinCode: (groupId: bigint, codeHash: string) => Promise<GroupChatV2JoinCodeSnapshot>;
  members: (groupId: bigint) => Promise<readonly string[]>;
  transferAdmin: (groupId: bigint, nextAdmin: string) => Promise<GroupChatV2ConfirmedMutation>;
  inviteMembers: (
    groupId: bigint,
    accounts: readonly string[],
    ttl?: bigint
  ) => Promise<GroupChatV2ConfirmedMutation>;
  removeMembers: (
    groupId: bigint,
    accounts: readonly string[]
  ) => Promise<GroupChatV2ConfirmedMutation>;
  acceptInvite: (groupId: bigint) => Promise<GroupChatV2ConfirmedMutation>;
  declineInvite: (groupId: bigint) => Promise<GroupChatV2ConfirmedMutation>;
  revokeInvite: (groupId: bigint, account: string) => Promise<GroupChatV2ConfirmedMutation>;
  leave: (groupId: bigint) => Promise<GroupChatV2ConfirmedMutation>;
  disband: (groupId: bigint) => Promise<GroupChatV2ConfirmedMutation>;
  rotateKey: (groupId: bigint) => Promise<Readonly<{ epoch: bigint; transactionHash: string }>>;
  createJoinCode: (input: Readonly<{
    groupId: bigint;
    codeHash: string;
    proofSigner: string;
    ttl?: bigint;
    uses?: bigint;
  }>) => Promise<GroupChatV2ConfirmedMutation>;
  revokeJoinCode: (groupId: bigint, codeHash: string) => Promise<GroupChatV2ConfirmedMutation>;
  readJoinProofDigest: (input: Readonly<{
    groupId: bigint;
    codeHash: string;
    generation: bigint;
    expectedAdminRevision: bigint;
    signatureDeadline: bigint;
  }>) => Promise<string>;
  joinWithCode: (input: Readonly<{
    groupId: bigint;
    codeHash: string;
    generation: bigint;
    expectedAdminRevision: bigint;
    signatureDeadline: bigint;
    signature: string;
  }>) => Promise<GroupChatV2ConfirmedMutation>;
  readEpochKey: (groupId: bigint, epoch?: bigint) => Promise<GroupChatV2EpochKey>;
  syncEpoch: (groupId: bigint, epoch: bigint) => Promise<GroupChatV2EpochKey>;
  send: (groupId: bigint, input: GroupChatV2SendInput) => Promise<GroupChatV2SendResult>;
  setMetadata: (groupId: bigint, title: string) => Promise<GroupChatV2GroupSnapshot>;
  readMetadata: (event: GroupChatV2MetadataEvent) => Promise<GroupChatV2MetadataPayload>;
  metadataPage: (
    groupId: bigint,
    fromBlock: bigint,
    toBlock: bigint
  ) => Promise<readonly GroupChatV2MetadataEvent[]>;
  historyPage: (
    groupId: bigint,
    fromBlock: bigint,
    toBlock: bigint
  ) => Promise<readonly GroupChatV2MessageEvent[]>;
  latestBlock: () => Promise<bigint>;
  canonicalBlock: (blockNumber: bigint) => Promise<GroupChatV2CanonicalBlock>;
  messageCountAtBlock: (groupId: bigint, blockNumber: bigint) => Promise<bigint>;
  readMessageAnchor: (
    groupId: bigint,
    messageId: bigint,
    blockNumber: bigint
  ) => Promise<GroupChatV2ReadCursorAnchor | null>;
  metadataVersionAtBlock: (groupId: bigint, blockNumber: bigint) => Promise<bigint>;
  lifecyclePage: (
    fromBlock: bigint,
    toBlock: bigint
  ) => Promise<readonly GroupChatV2WalletLifecycleEvent[]>;
  readNativeCredit: () => Promise<bigint>;
  withdrawNativeCredit: () => Promise<Readonly<{ observedCredit: bigint; transactionHash: string }>>;
  signImageSessionAuthorization: (message: string) => Promise<string>;
  clearEpochKeys: () => void;
}>;

type GroupChatV2SessionControllerImplementation = Omit<
  GroupChatV2SessionController,
  typeof GROUP_CHAT_V2_SESSION_BRAND
>;

const CONTROLLERS = new WeakSet<object>();

export function assertGroupChatV2SessionController(
  value: unknown
): asserts value is GroupChatV2SessionController {
  if (!value || typeof value !== 'object' || !CONTROLLERS.has(value)) {
    throw new Error('Group Chat V2 requires a bound browser-wallet owner session.');
  }
}

const snapshotManifest = (
  manifest: GroupChatV2DeploymentManifest
): Readonly<GroupChatV2DeploymentManifest> => Object.freeze({
  chainId: BigInt(manifest.chainId),
  contractAddress: String(manifest.contractAddress),
  deploymentBlock: BigInt(manifest.deploymentBlock),
  runtimeBytecodeHash: String(manifest.runtimeBytecodeHash)
});

const transactionHash = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^0x[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error(`${label} is not a canonical transaction hash.`);
  }
  return normalized;
};

const successfulReceipt = async ({
  transaction,
  operation,
  acceptReplacement
}: {
  transaction: GroupChatV2Transaction;
  operation: string;
  acceptReplacement: boolean;
}): Promise<Readonly<{ receipt: unknown; transactionHash: string }>> => {
  let receipt: unknown;
  let effectiveHash = transactionHash(transaction.txHash, `${operation} submitted hash`);
  try {
    receipt = await transaction.wait();
  } catch (error) {
    const replacement = error as Record<string, unknown> | null;
    if (!replacement || replacement.code !== 'TRANSACTION_REPLACED') throw error;
    if (!acceptReplacement || replacement.cancelled === true || replacement.reason === 'cancelled') {
      throw new Error(`${operation} transaction replacement was not accepted.`);
    }
    const replacementTransaction = replacement.replacement as Record<string, unknown> | null;
    effectiveHash = transactionHash(replacementTransaction?.hash, `${operation} replacement hash`);
    receipt = replacement.receipt;
  }
  if (!receipt || typeof receipt !== 'object') {
    throw new Error(`${operation} did not return a transaction receipt.`);
  }
  const record = receipt as Record<string, unknown>;
  let status: bigint;
  try {
    status = BigInt(record.status as bigint);
  } catch {
    throw new Error(`${operation} receipt has no canonical status.`);
  }
  if (status !== 1n) throw new Error(`${operation} transaction did not succeed.`);
  const receiptHash = transactionHash(
    record.hash ?? record.transactionHash,
    `${operation} receipt hash`
  );
  if (receiptHash !== effectiveHash) {
    throw new Error(`${operation} receipt belongs to another transaction.`);
  }
  return Object.freeze({ receipt, transactionHash: effectiveHash });
};

export const createGroupChatV2Session = ({
  getOwnerCapability,
  invalidateOwnerCapabilities = () => undefined,
  manifest,
  ownerAddress,
  retireNonceAttempt,
  runOwnerTransactionFlow
}: {
  getOwnerCapability: GroupChatV2OwnerCapabilityGetter;
  invalidateOwnerCapabilities?: () => void;
  manifest: GroupChatV2DeploymentManifest;
  ownerAddress: string;
  retireNonceAttempt: GroupChatV2NonceAttemptRetirer;
  runOwnerTransactionFlow: GroupChatV2TransactionFlow;
}): GroupChatV2SessionController => {
  const owner = getAddress(ownerAddress.trim());
  const immutableManifest = snapshotManifest(manifest);
  const epochKeys = new Map<string, Promise<GroupChatV2EpochKey>>();
  let verifiedPromise: Promise<VerifiedGroupChatV2Deployment> | null = null;
  let mutationInFlight = false;
  let epochKeyReadTail: Promise<void> = Promise.resolve();

  const capability = async (requirePrivacy: boolean): Promise<GroupChatV2MetaMaskCapability> => {
    let value = await getOwnerCapability(requirePrivacy);
    try {
      await assertGroupChatV2MetaMaskCapabilitySnapshotCurrent({
        capability: value,
        ownerAddress: owner,
        chainId: immutableManifest.chainId
      });
      return value;
    } catch {
      invalidateOwnerCapabilities();
    }
    value = await getOwnerCapability(requirePrivacy);
    try {
      await assertGroupChatV2MetaMaskCapabilitySnapshotCurrent({
        capability: value,
        ownerAddress: owner,
        chainId: immutableManifest.chainId
      });
      return value;
    } catch (error) {
      invalidateOwnerCapabilities();
      throw error;
    }
  };

  const readCapability = async (requirePrivacy: boolean): Promise<GroupChatV2MetaMaskCapability> => {
    const value = await getOwnerCapability(requirePrivacy);
    assertGroupChatV2MetaMaskCapabilityScope({
      capability: value,
      ownerAddress: owner,
      chainId: immutableManifest.chainId
    });
    return value;
  };

  const deployment = (
    current: GroupChatV2MetaMaskCapability
  ): Promise<VerifiedGroupChatV2Deployment> => {
    if (!verifiedPromise) {
      const pending = verifyGroupChatV2Deployment({ manifest: immutableManifest, capability: current });
      const guarded = pending.catch((error) => {
        if (verifiedPromise === guarded) verifiedPromise = null;
        throw error;
      });
      verifiedPromise = guarded;
    }
    return verifiedPromise;
  };

  const withMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (mutationInFlight) {
      throw new Error('Finish the current Group Chat V2 wallet operation first.');
    }
    mutationInFlight = true;
    try {
      return await runOwnerTransactionFlow(async () => {
        try {
          return await operation();
        } catch (error) {
          if (!isBrowserWalletSessionChangedError(error)) throw error;
          // The lease guard emits this error before forwarding the irreversible
          // RPC to the browser wallet. Retire the stale capability and make one
          // fresh attempt against the same captured action intent. A genuine
          // account/network/provider change fails while binding the replacement
          // capability, so no transaction reaches the new authority.
          invalidateOwnerCapabilities();
          return operation();
        }
      });
    } finally {
      mutationInFlight = false;
    }
  };

  const keyCacheKey = (
    target: VerifiedGroupChatV2Deployment,
    groupId: bigint,
    epoch: bigint,
    membershipRevision: bigint
  ): string => [
    owner.toLowerCase(),
    target.chainId.toString(),
    target.contractAddress.toLowerCase(),
    groupId.toString(),
    epoch.toString(),
    membershipRevision.toString()
  ].join(':');

  const serializeEpochKeyRead = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = epochKeyReadTail.then(operation, operation);
    epochKeyReadTail = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const readEpochKeyFor = async ({
    current,
    target,
    group,
    selectedEpoch
  }: {
    current: GroupChatV2MetaMaskCapability;
    target: VerifiedGroupChatV2Deployment;
    group: GroupChatV2GroupSnapshot;
    selectedEpoch?: bigint;
  }): Promise<GroupChatV2EpochKey> => {
    const epoch = selectedEpoch ?? group.currentEpoch;
    const cacheKey = keyCacheKey(target, group.groupId, epoch, group.membershipRevision);
    const cached = epochKeys.get(cacheKey);
    if (cached) return cached;
    const pending = serializeEpochKeyRead(() => readGroupChatV2EpochKey({
      deployment: target,
      capability: current,
      groupId: group.groupId,
      epoch
    }));
    epochKeys.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      if (epochKeys.get(cacheKey) === pending) epochKeys.delete(cacheKey);
      throw error;
    }
  };

  const readEpochKey = async (groupId: bigint, selectedEpoch?: bigint): Promise<GroupChatV2EpochKey> => {
    const current = await readCapability(true);
    const target = await deployment(current);
    const group = await readGroupChatV2Group({ deployment: target, capability: current, groupId });
    return readEpochKeyFor({ current, target, group, selectedEpoch });
  };

  const readCurrentEpochKeyForSend = async ({
    current,
    target,
    groupId
  }: {
    current: GroupChatV2MetaMaskCapability;
    target: VerifiedGroupChatV2Deployment;
    groupId: bigint;
  }): Promise<GroupChatV2EpochKey> => {
    const group = await readGroupChatV2Group({
      deployment: target,
      capability: current,
      groupId
    });
    try {
      return await readEpochKeyFor({ current, target, group });
    } catch (error) {
      // A confirmed admission creates the member's epoch and envelope in the
      // same transaction. COTI testnet RPC backends can briefly disagree on
      // `latest`, so the first group read can still describe the pre-join
      // epoch while the following envelope read executes against the new
      // state. Retry only when a fresh snapshot actually advanced; unrelated
      // privacy/authorization failures remain fail-closed.
      const refreshed = await readGroupChatV2Group({
        deployment: target,
        capability: current,
        groupId
      });
      if (
        refreshed.currentEpoch <= group.currentEpoch &&
        refreshed.membershipRevision <= group.membershipRevision
      ) {
        throw error;
      }
      return readEpochKeyFor({ current, target, group: refreshed });
    }
  };

  const confirmMutation = async (
    submitted: GroupChatV2Transaction,
    operation: string,
    clearKeys = false
  ): Promise<GroupChatV2ConfirmedMutation> => {
    const confirmed = await successfulReceipt({
      transaction: submitted,
      operation,
      acceptReplacement: false
    });
    if (clearKeys) epochKeys.clear();
    return Object.freeze({ transactionHash: confirmed.transactionHash });
  };

  const implementation: GroupChatV2SessionControllerImplementation = {
    manifest: immutableManifest,
    ownerAddress: owner,
    create: (initialInvitees: readonly string[] = []) => {
      const intent = captureWalletActionIntent({ initialInvitees });
      return withMutation(async () => {
      const current = await capability(false);
      const target = await deployment(current);
      const submitted = await createGroupChatV2Group({
        deployment: target,
        capability: current,
        initialInvitees: readWalletActionIntent(intent).initialInvitees
      });
      const confirmed = await successfulReceipt({
        transaction: submitted,
        operation: 'Group creation',
        acceptReplacement: false
      });
      const created = parseGroupChatV2CreatedReceipt({
        deployment: target,
        receipt: confirmed.receipt,
        expectedTransactionHash: confirmed.transactionHash,
        expectedAdmin: owner
      });
      const group = await readGroupChatV2Group({
        deployment: target,
        capability: current,
        groupId: created.groupId
      });
      if (
        group.admin !== owner.toLowerCase() ||
        group.currentEpoch !== created.epoch ||
        group.membershipRevision !== created.membershipRevision ||
        group.adminRevision !== created.adminRevision
      ) {
        throw new Error('Created group state does not match its confirmed event.');
      }
      return Object.freeze({ group, transactionHash: confirmed.transactionHash });
      });
    },
    inspect: async (groupId: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2Group({
        deployment: await deployment(current),
        capability: current,
        groupId
      });
    },
    inspectMember: async (groupId: bigint, account: string) => {
      const current = await readCapability(false);
      return readGroupChatV2Member({
        deployment: await deployment(current),
        capability: current,
        groupId,
        account
      });
    },
    membershipRanges: async (groupId: bigint, account = owner) => {
      const current = await readCapability(false);
      return readGroupChatV2MembershipRanges({
        deployment: await deployment(current),
        capability: current,
        groupId,
        account
      });
    },
    inspectInvite: async (groupId: bigint, account: string) => {
      const current = await readCapability(false);
      return readGroupChatV2Invite({
        deployment: await deployment(current),
        capability: current,
        groupId,
        account
      });
    },
    inspectJoinCode: async (groupId: bigint, codeHash: string) => {
      const current = await readCapability(false);
      return readGroupChatV2JoinCode({
        deployment: await deployment(current),
        capability: current,
        groupId,
        codeHash
      });
    },
    members: async (groupId: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2Members({
        deployment: await deployment(current),
        capability: current,
        groupId
      });
    },
    transferAdmin: (groupId: bigint, nextAdmin: string) => withMutation(async () => {
      const current = await capability(false);
      const submitted = await setGroupChatV2Admin({
        deployment: await deployment(current),
        capability: current,
        groupId,
        nextAdmin
      });
      return confirmMutation(submitted, 'Group admin transfer');
    }),
    inviteMembers: (groupId: bigint, accounts: readonly string[], ttl = 0n) => {
      const intent = captureWalletActionIntent({ groupId, accounts, ttl });
      return withMutation(async () => {
      const current = await capability(false);
      const submitted = await inviteGroupChatV2Members({
        deployment: await deployment(current),
        capability: current,
        ...readWalletActionIntent(intent)
      });
      return confirmMutation(submitted, 'Group member invitation');
      });
    },
    removeMembers: (groupId: bigint, accounts: readonly string[]) => {
      const intent = captureWalletActionIntent({ groupId, accounts });
      return withMutation(async () => {
      const current = await capability(false);
      const submitted = await removeGroupChatV2Members({
        deployment: await deployment(current),
        capability: current,
        ...readWalletActionIntent(intent)
      });
      return confirmMutation(submitted, 'Group member removal', true);
      });
    },
    acceptInvite: (groupId: bigint) => withMutation(async () => {
      const current = await capability(false);
      const submitted = await acceptGroupChatV2Invite({
        deployment: await deployment(current),
        capability: current,
        groupId
      });
      return confirmMutation(submitted, 'Group invite acceptance', true);
    }),
    declineInvite: (groupId: bigint) => withMutation(async () => {
      const current = await capability(false);
      const submitted = await declineGroupChatV2Invite({
        deployment: await deployment(current),
        capability: current,
        groupId
      });
      return confirmMutation(submitted, 'Group invite decline');
    }),
    revokeInvite: (groupId: bigint, account: string) => withMutation(async () => {
      const current = await capability(false);
      const submitted = await revokeGroupChatV2Invite({
        deployment: await deployment(current),
        capability: current,
        groupId,
        account
      });
      return confirmMutation(submitted, 'Group invite revocation');
    }),
    leave: (groupId: bigint) => withMutation(async () => {
      const current = await capability(false);
      const submitted = await leaveGroupChatV2({
        deployment: await deployment(current),
        capability: current,
        groupId
      });
      return confirmMutation(submitted, 'Group leave', true);
    }),
    disband: (groupId: bigint) => withMutation(async () => {
      const current = await capability(false);
      const submitted = await disbandGroupChatV2({
        deployment: await deployment(current),
        capability: current,
        groupId
      });
      return confirmMutation(submitted, 'Group disband', true);
    }),
    rotateKey: (groupId: bigint) => withMutation(async () => {
      const current = await capability(false);
      const result = await rotateGroupChatV2Key({
        deployment: await deployment(current),
        capability: current,
        groupId
      });
      const confirmed = await confirmMutation(result.transaction, 'Group key rotation', true);
      return Object.freeze({ epoch: result.nextEpoch, transactionHash: confirmed.transactionHash });
    }),
    createJoinCode: (input) => {
      const intent = captureWalletActionIntent(input);
      return withMutation(async () => {
      const current = await capability(false);
      const submitted = await createGroupChatV2JoinCode({
        deployment: await deployment(current),
        capability: current,
        ...readWalletActionIntent(intent)
      });
      return confirmMutation(submitted, 'Group join-code creation');
      });
    },
    revokeJoinCode: (groupId: bigint, codeHash: string) => withMutation(async () => {
      const current = await capability(false);
      const submitted = await revokeGroupChatV2JoinCode({
        deployment: await deployment(current),
        capability: current,
        groupId,
        codeHash
      });
      return confirmMutation(submitted, 'Group join-code revocation');
    }),
    readJoinProofDigest: async (input) => {
      const current = await readCapability(false);
      return readGroupChatV2JoinProofDigest({
        deployment: await deployment(current),
        capability: current,
        ...input
      });
    },
    joinWithCode: (input) => {
      const intent = captureWalletActionIntent(input);
      return withMutation(async () => {
      const current = await capability(false);
      const submitted = await joinGroupChatV2WithCode({
        deployment: await deployment(current),
        capability: current,
        ...readWalletActionIntent(intent)
      });
      return confirmMutation(submitted, 'Group join-code admission', true);
      });
    },
    readEpochKey,
    syncEpoch: (groupId: bigint, epoch: bigint) => withMutation(async () => {
      const current = await capability(true);
      const target = await deployment(current);
      const submitted = await syncGroupChatV2EpochEnvelope({
        deployment: target,
        capability: current,
        groupId,
        epoch
      });
      await successfulReceipt({
        transaction: submitted,
        operation: 'Group envelope synchronization',
        acceptReplacement: false
      });
      for (const cacheKey of epochKeys.keys()) {
        if (cacheKey.includes(`:${groupId.toString()}:${epoch.toString()}:`)) epochKeys.delete(cacheKey);
      }
      const group = await readGroupChatV2Group({
        deployment: target,
        capability: current,
        groupId
      });
      return readEpochKeyFor({ current, target, group, selectedEpoch: epoch });
    }),
    send: (groupId: bigint, input: GroupChatV2SendInput) => {
      const intent = captureWalletActionIntent({ groupId, input });
      return withMutation(async () => {
      const current = await capability(true);
      const target = await deployment(current);
      const bound = readWalletActionIntent(intent);
      const key = await readCurrentEpochKeyForSend({
        current,
        target,
        groupId: bound.groupId
      });
      const encoded = encodeGroupChatV2Payload(bound.input);
      const submitted = await sendGroupChatV2Message({
        deployment: target,
        capability: current,
        groupId: bound.groupId,
        key,
        plaintext: encoded,
        retireNonceAttempt
      });
      const confirmed = await successfulReceipt({
        transaction: submitted.transaction,
        operation: 'Group message',
        acceptReplacement: true
      });
      const event = parseGroupChatV2MessageReceipt({
        deployment: target,
        receipt: confirmed.receipt,
        expected: {
          transactionHash: confirmed.transactionHash,
          context: submitted.context,
          encrypted: submitted.encrypted
        }
      });
      return Object.freeze({
        event,
        payload: decodeGroupChatV2Payload(encoded),
        submittedTransactionHash: submitted.transaction.txHash,
        transactionHash: confirmed.transactionHash
      });
      });
    },
    setMetadata: (groupId: bigint, title: string) => withMutation(async () => {
      const current = await capability(true);
      const target = await deployment(current);
      const before = await readGroupChatV2Group({
        deployment: target,
        capability: current,
        groupId
      });
      const key = await readEpochKeyFor({ current, target, group: before });
      const plaintext = encodeGroupChatV2MetadataPayload(title);
      const submitted = await setGroupChatV2EncryptedMetadata({
        deployment: target,
        capability: current,
        groupId,
        key,
        plaintext,
        retireNonceAttempt
      });
      await successfulReceipt({
        transaction: submitted.transaction,
        operation: 'Group metadata update',
        acceptReplacement: false
      });
      const after = await readGroupChatV2Group({
        deployment: target,
        capability: current,
        groupId
      });
      if (after.metadataVersion !== before.metadataVersion + 1n) {
        throw new Error('Group metadata version did not advance exactly once.');
      }
      return after;
    }),
    readMetadata: async (event: GroupChatV2MetadataEvent) => {
      const current = await readCapability(true);
      const target = await deployment(current);
      const group = await readGroupChatV2Group({
        deployment: target,
        capability: current,
        groupId: event.groupId
      });
      const key = await readEpochKeyFor({
        current,
        target,
        group,
        selectedEpoch: event.epoch
      });
      return decodeGroupChatV2MetadataPayload(await decryptGroupChatV2MetadataEvent({ event, key }));
    },
    metadataPage: async (groupId: bigint, fromBlock: bigint, toBlock: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2MetadataLogPage({
        deployment: await deployment(current),
        capability: current,
        groupId,
        fromBlock,
        toBlock
      });
    },
    historyPage: async (groupId: bigint, fromBlock: bigint, toBlock: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2MessageLogPage({
        deployment: await deployment(current),
        capability: current,
        groupId,
        fromBlock,
        toBlock
      });
    },
    latestBlock: async () => {
      const current = await readCapability(false);
      return readGroupChatV2LatestBlockNumber({
        deployment: await deployment(current),
        capability: current
      });
    },
    canonicalBlock: async (blockNumber: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2CanonicalBlock({
        deployment: await deployment(current),
        capability: current,
        blockNumber
      });
    },
    messageCountAtBlock: async (groupId: bigint, blockNumber: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2MessageCountAtBlock({
        deployment: await deployment(current),
        capability: current,
        groupId,
        blockNumber
      });
    },
    readMessageAnchor: async (groupId: bigint, messageId: bigint, blockNumber: bigint) => {
      const current = await readCapability(false);
      const target = await deployment(current);
      const [events, block] = await Promise.all([
        readGroupChatV2MessageLogPage({
          deployment: target,
          capability: current,
          groupId,
          fromBlock: blockNumber,
          toBlock: blockNumber
        }),
        readGroupChatV2CanonicalBlock({
          deployment: target,
          capability: current,
          blockNumber
        })
      ]);
      const matches = events.filter((event) => event.messageId === messageId);
      if (matches.length === 0) return null;
      if (matches.length !== 1 || matches[0]?.blockHash !== block.blockHash) {
        throw new Error('Canonical Group Chat V2 cursor anchor is ambiguous.');
      }
      return Object.freeze({ messageId, blockNumber, blockHash: block.blockHash });
    },
    metadataVersionAtBlock: async (groupId: bigint, blockNumber: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2MetadataVersionAtBlock({
        deployment: await deployment(current),
        capability: current,
        groupId,
        blockNumber
      });
    },
    lifecyclePage: async (fromBlock: bigint, toBlock: bigint) => {
      const current = await readCapability(false);
      return readGroupChatV2WalletLifecycleLogPage({
        deployment: await deployment(current),
        capability: current,
        walletAddress: owner,
        fromBlock,
        toBlock
      });
    },
    readNativeCredit: async () => {
      const current = await readCapability(false);
      return readGroupChatV2NativeCredit({
        deployment: await deployment(current),
        capability: current
      });
    },
    withdrawNativeCredit: () => withMutation(async () => {
      const current = await capability(false);
      const result = await withdrawGroupChatV2NativeCredit({
        deployment: await deployment(current),
        capability: current
      });
      const confirmed = await successfulReceipt({
        transaction: result.transaction,
        operation: 'Group native-credit withdrawal',
        acceptReplacement: false
      });
      return Object.freeze({
        observedCredit: result.observedCredit,
        transactionHash: confirmed.transactionHash
      });
    }),
    signImageSessionAuthorization: (message: string) => withMutation(async () => {
      const current = await capability(false);
      await deployment(current);
      return signGroupChatV2ImageSessionAuthorization({ capability: current, message });
    }),
    clearEpochKeys: () => epochKeys.clear()
  };
  const controller = Object.freeze(implementation) as unknown as GroupChatV2SessionController;
  CONTROLLERS.add(controller);
  return controller;
};
