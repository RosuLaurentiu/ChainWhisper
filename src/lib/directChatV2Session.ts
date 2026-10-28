import { getAddress, Interface } from '@coti-io/coti-ethers';
import {
  DIRECT_CHAT_V2_ABI,
  assertDirectChatV2MetaMaskCapabilitySnapshotCurrent,
  assertDirectChatV2MetaMaskCapabilityScope,
  clearDirectChatV2ContactSettings,
  createDirectChatV2Conversation,
  parseDirectChatV2ConversationCreatedReceipt,
  parseDirectChatV2MessageReceipt,
  readDirectChatV2CanonicalBlock,
  readDirectChatV2ContactSettings,
  readDirectChatV2Conversation,
  readDirectChatV2ConversationMessageCountAtBlock,
  readDirectChatV2ConversationPreviewPage,
  readDirectChatV2EpochKey,
  readDirectChatV2IncomingMessageLogPage,
  readDirectChatV2LatestBlockNumber,
  readDirectChatV2MessageLogPage,
  readDirectChatV2NativeCredit,
  readDirectChatV2Nickname,
  rotateDirectChatV2ConversationKey,
  sendDirectChatV2Message,
  setDirectChatV2ContactSettings,
  setDirectChatV2Nickname,
  signDirectChatV2ImageSessionAuthorization,
  supportsDirectChatV2ProfileSync,
  verifyDirectChatV2Contract,
  watchDirectChatV2IncomingMessageHints,
  watchDirectChatV2MessageHints,
  withdrawDirectChatV2NativeCredit,
  type DirectChatV2ConversationLookup,
  type DirectChatV2ConversationPreviewPage,
  type DirectChatV2ConversationSnapshot,
  type DirectChatV2ContactSettings,
  type DirectChatV2ContactSettingsSnapshot,
  type DirectChatV2DeploymentManifest,
  type DirectChatV2EpochKey,
  type DirectChatV2MessageEvent,
  type DirectChatV2MetaMaskCapability,
  type DirectChatV2NonceAttemptRetirer,
  type DirectChatV2Transaction,
  type VerifiedDirectChatV2Deployment
} from './directChatV2Chain';
import { isEmptyDirectChatV2ContactSettings } from './directChatV2ContactSettings';
import type { DirectChatV2HistoryScope } from './directChatV2History';
import type {
  DirectChatV2IncomingDiscoveryDependencies,
  DirectChatV2IncomingDiscoveryScope
} from './directChatV2IncomingDiscovery';
import {
  decodeDirectChatV2Payload,
  encodeDirectChatV2Payload,
  type DirectChatV2Payload
} from './directChatV2Payload';
import type { DirectChatV2SyncDependencies } from './directChatV2SyncCoordinator';

export type DirectChatV2OwnerCapabilityGetter = (
  requirePrivacy: boolean
) => Promise<DirectChatV2MetaMaskCapability>;

export type DirectChatV2TransactionFlow = <T>(operation: () => Promise<T>) => Promise<T>;

export type DirectChatV2ReadyConversation = {
  created: boolean;
  conversation: DirectChatV2ConversationSnapshot;
  transactionHash?: string;
};

export type DirectChatV2SendInput = {
  body: string;
  replyToMessageId?: bigint;
  replyToMessageAnchor?: string;
  replyPreview?: string;
  tip?: bigint;
};

export type DirectChatV2SendResult = {
  event: DirectChatV2MessageEvent;
  payload: DirectChatV2Payload;
  submittedTransactionHash: string;
  transactionHash: string;
};

export type DirectChatV2RotateResult = {
  conversation: DirectChatV2ConversationSnapshot;
  previousEpoch: bigint;
  transactionHash: string;
};

export type DirectChatV2NativeCreditWithdrawal = Readonly<{
  observedCredit: bigint;
  remainingCredit: bigint;
  transactionHash: string;
}>;

export type DirectChatV2HistoryAccess = {
  conversation: DirectChatV2ConversationSnapshot;
  scope: DirectChatV2HistoryScope;
  dependencies: DirectChatV2SyncDependencies;
};

export type DirectChatV2IncomingHistoryAccess = Readonly<{
  scope: DirectChatV2IncomingDiscoveryScope;
  dependencies: DirectChatV2IncomingDiscoveryDependencies;
}>;

declare const DIRECT_CHAT_V2_SESSION_CONTROLLER_BRAND: unique symbol;

export type DirectChatV2SessionController = {
  readonly [DIRECT_CHAT_V2_SESSION_CONTROLLER_BRAND]: true;
  readonly manifest: Readonly<DirectChatV2DeploymentManifest>;
  readonly ownerAddress: string;
  ensure: (peer: string) => Promise<DirectChatV2ReadyConversation>;
  create: (peer: string) => Promise<DirectChatV2ReadyConversation>;
  inspect: (peer: string) => Promise<DirectChatV2ConversationLookup>;
  hasProfileSync: () => Promise<boolean>;
  readNickname: (account: string) => Promise<string>;
  setNickname: (nickname: string) => Promise<string>;
  readContactSettings: (contact: string) => Promise<DirectChatV2ContactSettingsSnapshot>;
  setContactSettings: (
    contact: string,
    settings: DirectChatV2ContactSettings
  ) => Promise<DirectChatV2ContactSettingsSnapshot>;
  listConversations: (beforeIndexExclusive?: bigint, limit?: bigint) => Promise<DirectChatV2ConversationPreviewPage>;
  incomingHistory: () => Promise<DirectChatV2IncomingHistoryAccess>;
  history: (peer: string) => Promise<DirectChatV2HistoryAccess | null>;
  readNativeCredit: () => Promise<bigint>;
  signImageSessionAuthorization: (message: string) => Promise<string>;
  withdrawNativeCredit: () => Promise<DirectChatV2NativeCreditWithdrawal>;
  rotate: (peer: string) => Promise<DirectChatV2RotateResult>;
  send: (peer: string, input: DirectChatV2SendInput) => Promise<DirectChatV2SendResult>;
  watch: (
    peer: string,
    onHint: () => void | Promise<void>
  ) => Promise<(() => Promise<void>) | null>;
  watchIncoming: (
    onHint: (peer: string) => void | Promise<void>
  ) => Promise<() => Promise<void>>;
  clearEpochKeys: () => void;
};

const DIRECT_CHAT_V2_SESSION_CONTROLLERS = new WeakSet<object>();

export function assertDirectChatV2SessionController(
  controller: unknown
): asserts controller is DirectChatV2SessionController {
  if (
    !controller ||
    typeof controller !== 'object' ||
    !DIRECT_CHAT_V2_SESSION_CONTROLLERS.has(controller)
  ) {
    throw new Error('Direct-chat V2 writes require a bound V2 session controller.');
  }
}

type DirectChatV2SessionControllerImplementation = Omit<
  DirectChatV2SessionController,
  typeof DIRECT_CHAT_V2_SESSION_CONTROLLER_BRAND
>;

const snapshotManifest = (
  manifest: DirectChatV2DeploymentManifest
): Readonly<DirectChatV2DeploymentManifest> => Object.freeze({
  chainId: BigInt(manifest.chainId),
  contractAddress: String(manifest.contractAddress),
  deploymentBlock: BigInt(manifest.deploymentBlock),
  runtimeBytecodeHash: String(manifest.runtimeBytecodeHash)
});

const DIRECT_CHAT_V2_INTERFACE = new Interface(DIRECT_CHAT_V2_ABI);
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRANSACTION_DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

type DirectChatV2ExpectedTransaction = {
  chainId: bigint;
  data: string;
  from: string;
  to: string;
  value: bigint;
};

type DirectChatV2ConfirmedTransaction = {
  receipt: unknown;
  transactionHash: string;
};

const canonicalTransactionHash = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!TRANSACTION_HASH_PATTERN.test(normalized)) {
    throw new Error(`${label} is not a canonical transaction hash.`);
  }
  return normalized;
};

const canonicalTransactionData = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!TRANSACTION_DATA_PATTERN.test(normalized)) {
    throw new Error(`${label} is not canonical transaction calldata.`);
  }
  return normalized;
};

const transactionInteger = (value: unknown, label: string): bigint => {
  try {
    const parsed = BigInt(value as bigint);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} is not a non-negative integer.`);
  }
};

const assertReplacementTransaction = (
  replacement: unknown,
  expected: DirectChatV2ExpectedTransaction
): string => {
  if (!replacement || typeof replacement !== 'object') {
    throw new Error('Chat V2 replacement transaction is missing.');
  }
  const raw = replacement as Record<string, unknown>;
  const replacementHash = canonicalTransactionHash(raw.hash, 'Chat V2 replacement hash');
  const replacementTo = getAddress(String(raw.to ?? ''));
  const replacementFrom = getAddress(String(raw.from ?? ''));
  if (
    replacementTo.toLowerCase() !== expected.to.toLowerCase() ||
    replacementFrom.toLowerCase() !== expected.from.toLowerCase() ||
    canonicalTransactionData(raw.data, 'Chat V2 replacement data') !== expected.data.toLowerCase() ||
    transactionInteger(raw.value, 'Chat V2 replacement value') !== expected.value ||
    transactionInteger(raw.chainId, 'Chat V2 replacement chain ID') !== expected.chainId
  ) {
    throw new Error('Chat V2 replacement changed the submitted calldata or wallet context.');
  }
  return replacementHash;
};

const requireSuccessfulReceipt = async (
  transaction: DirectChatV2Transaction,
  operation: string,
  expected: DirectChatV2ExpectedTransaction
): Promise<DirectChatV2ConfirmedTransaction> => {
  let receipt: unknown;
  let replacementHash: string | undefined;
  try {
    receipt = await transaction.wait();
  } catch (error) {
    const replacementError = error as Record<string, unknown> | null;
    if (!replacementError || replacementError.code !== 'TRANSACTION_REPLACED') {
      throw error;
    }
    if (replacementError.cancelled === true || replacementError.reason === 'cancelled') {
      throw new Error(`${operation} transaction replacement was cancelled.`);
    }
    replacementHash = assertReplacementTransaction(replacementError.replacement, expected);
    receipt = replacementError.receipt;
  }
  if (!receipt || typeof receipt !== 'object') {
    throw new Error(`${operation} did not return a transaction receipt.`);
  }
  const receiptRecord = receipt as Record<string, unknown>;
  const status = receiptRecord.status;
  let normalizedStatus: bigint;
  try {
    normalizedStatus = BigInt(status as bigint);
  } catch {
    throw new Error(`${operation} receipt has no canonical success status.`);
  }
  if (normalizedStatus !== 1n) {
    throw new Error(`${operation} transaction did not succeed.`);
  }
  const receiptHashValue = receiptRecord.hash ?? receiptRecord.transactionHash;
  const receiptHash = receiptHashValue === undefined
    ? undefined
    : canonicalTransactionHash(receiptHashValue, `${operation} receipt hash`);
  if (replacementHash && receiptHash !== replacementHash) {
    throw new Error(`${operation} replacement receipt belongs to a different transaction.`);
  }
  if (
    !replacementHash &&
    receiptHash &&
    TRANSACTION_HASH_PATTERN.test(transaction.txHash) &&
    receiptHash !== transaction.txHash.toLowerCase()
  ) {
    throw new Error(`${operation} receipt belongs to an unexpected transaction.`);
  }
  return {
    receipt,
    transactionHash: replacementHash ?? receiptHash ?? transaction.txHash
  };
};

export const createDirectChatV2Session = ({
  getOwnerCapability,
  invalidateOwnerCapabilities = () => undefined,
  manifest,
  ownerAddress,
  retireNonceAttempt,
  runOwnerTransactionFlow,
  waitForPostConfirmationRead = (delayMs) => new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  })
}: {
  getOwnerCapability: DirectChatV2OwnerCapabilityGetter;
  invalidateOwnerCapabilities?: () => void;
  manifest: DirectChatV2DeploymentManifest;
  ownerAddress: string;
  retireNonceAttempt: DirectChatV2NonceAttemptRetirer;
  runOwnerTransactionFlow: DirectChatV2TransactionFlow;
  waitForPostConfirmationRead?: (delayMs: number) => Promise<void>;
}): DirectChatV2SessionController => {
  const capturedOwnerAddress = getAddress(ownerAddress.trim());
  const immutableManifest = snapshotManifest(manifest);
  const epochKeyPromises = new Map<string, Promise<DirectChatV2EpochKey>>();
  let epochKeyReadTail: Promise<void> = Promise.resolve();
  let verifiedDeploymentPromise: Promise<VerifiedDirectChatV2Deployment> | null = null;
  let mutationInFlight = false;

  const requireOwnerCapability = async (
    requirePrivacy: boolean
  ): Promise<DirectChatV2MetaMaskCapability> => {
    let capability = await getOwnerCapability(requirePrivacy);
    try {
      await assertDirectChatV2MetaMaskCapabilitySnapshotCurrent({
        capability,
        ownerAddress: capturedOwnerAddress,
        chainId: immutableManifest.chainId
      });
      return capability;
    } catch {
      invalidateOwnerCapabilities();
    }
    capability = await getOwnerCapability(requirePrivacy);
    try {
      await assertDirectChatV2MetaMaskCapabilitySnapshotCurrent({
        capability,
        ownerAddress: capturedOwnerAddress,
        chainId: immutableManifest.chainId
      });
      return capability;
    } catch (error) {
      invalidateOwnerCapabilities();
      throw error;
    }
  };

  const requireOwnerReadCapability = async (
    requirePrivacy: boolean
  ): Promise<DirectChatV2MetaMaskCapability> => {
    const capability = await getOwnerCapability(requirePrivacy);
    assertDirectChatV2MetaMaskCapabilityScope({
      capability,
      ownerAddress: capturedOwnerAddress,
      chainId: immutableManifest.chainId
    });
    return capability;
  };

  const assertCapabilitySnapshotCurrent = (
    capability: DirectChatV2MetaMaskCapability
  ): Promise<void> => assertDirectChatV2MetaMaskCapabilitySnapshotCurrent({
    capability,
    ownerAddress: capturedOwnerAddress,
    chainId: immutableManifest.chainId
  });

  const runCapabilityOperation = async <T>(
    capability: DirectChatV2MetaMaskCapability,
    operation: () => Promise<T>
  ): Promise<T> => {
    const result = await operation();
    await assertCapabilitySnapshotCurrent(capability);
    return result;
  };

  const runReadCapabilityOperation = async <T>(
    capability: DirectChatV2MetaMaskCapability,
    operation: () => Promise<T>
  ): Promise<T> => {
    assertDirectChatV2MetaMaskCapabilityScope({
      capability,
      ownerAddress: capturedOwnerAddress,
      chainId: immutableManifest.chainId
    });
    const result = await operation();
    assertDirectChatV2MetaMaskCapabilityScope({
      capability,
      ownerAddress: capturedOwnerAddress,
      chainId: immutableManifest.chainId
    });
    return result;
  };

  const serializeEpochKeyRead = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = epochKeyReadTail.then(operation, operation);
    epochKeyReadTail = pending.then(() => undefined, () => undefined);
    return pending;
  };

  const runWriteCapabilityOperation = async <T>(
    capability: DirectChatV2MetaMaskCapability,
    operation: () => Promise<T>
  ): Promise<T> => {
    const result = await operation();
    assertDirectChatV2MetaMaskCapabilityScope({
      capability,
      ownerAddress: capturedOwnerAddress,
      chainId: immutableManifest.chainId
    });
    return result;
  };

  const verifiedDeploymentFor = (
    capability: DirectChatV2MetaMaskCapability
  ): Promise<VerifiedDirectChatV2Deployment> => {
    if (!verifiedDeploymentPromise) {
      const pending = runReadCapabilityOperation(capability, () => verifyDirectChatV2Contract({
        capability,
        manifest: immutableManifest
      }));
      const guarded = pending.catch((error) => {
        if (verifiedDeploymentPromise === guarded) {
          verifiedDeploymentPromise = null;
        }
        throw error;
      });
      verifiedDeploymentPromise = guarded;
    }
    return verifiedDeploymentPromise;
  };

  const epochCacheKey = ({
    deployment,
    conversationId,
    epoch
  }: {
    deployment: VerifiedDirectChatV2Deployment;
    conversationId: string;
    epoch: bigint;
  }): string => [
    capturedOwnerAddress.toLowerCase(),
    deployment.chainId.toString(),
    deployment.contractAddress.toLowerCase(),
    conversationId.toLowerCase(),
    epoch.toString()
  ].join(':');

  const readEpochKey = async ({
    capability,
    conversation,
    deployment,
    peer,
    epoch = conversation.currentEpoch
  }: {
    capability: DirectChatV2MetaMaskCapability;
    conversation: DirectChatV2ConversationSnapshot;
    deployment: VerifiedDirectChatV2Deployment;
    peer: string;
    epoch?: bigint;
  }): Promise<DirectChatV2EpochKey> => {
    const cacheKey = epochCacheKey({
      deployment,
      conversationId: conversation.conversationId,
      epoch
    });
    const cached = epochKeyPromises.get(cacheKey);
    if (cached) {
      assertDirectChatV2MetaMaskCapabilityScope({
        capability,
        ownerAddress: capturedOwnerAddress,
        chainId: immutableManifest.chainId
      });
      const key = await cached;
      assertDirectChatV2MetaMaskCapabilityScope({
        capability,
        ownerAddress: capturedOwnerAddress,
        chainId: immutableManifest.chainId
      });
      return key;
    }

    const pending = serializeEpochKeyRead(() =>
      runReadCapabilityOperation(capability, () => readDirectChatV2EpochKey({
        capability,
        deployment,
        peer,
        epoch
      }))
    );
    epochKeyPromises.set(cacheKey, pending);
    try {
      return await pending;
    } catch (error) {
      if (epochKeyPromises.get(cacheKey) === pending) {
        epochKeyPromises.delete(cacheKey);
      }
      throw error;
    }
  };

  const withMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (mutationInFlight) {
      throw new Error('Finish the current Chat V2 wallet operation before starting another.');
    }
    mutationInFlight = true;
    try {
      return await runOwnerTransactionFlow(operation);
    } finally {
      mutationInFlight = false;
    }
  };

  const readCreatedConversation = async ({
    capability,
    deployment,
    peer
  }: {
    capability: DirectChatV2MetaMaskCapability;
    deployment: VerifiedDirectChatV2Deployment;
    peer: string;
  }): Promise<DirectChatV2ConversationSnapshot> => {
    const conversation = await runReadCapabilityOperation(capability, () =>
      readDirectChatV2Conversation({ capability, deployment, peer })
    );
    if (!conversation.exists) {
      throw new Error('Chat V2 conversation does not exist for this wallet pair.');
    }
    return conversation;
  };

  const readCreatedConversationForHistory = async ({
    capability,
    deployment,
    peer
  }: {
    capability: DirectChatV2MetaMaskCapability;
    deployment: VerifiedDirectChatV2Deployment;
    peer: string;
  }): Promise<DirectChatV2ConversationSnapshot> => {
    const conversation = await runReadCapabilityOperation(capability, () =>
      readDirectChatV2Conversation({ capability, deployment, peer })
    );
    if (!conversation.exists) {
      throw new Error('Chat V2 conversation does not exist for this wallet pair.');
    }
    return conversation;
  };

  const readConfirmedConversation = async ({
    capability,
    deployment,
    peer,
    confirmationBlock
  }: {
    capability: DirectChatV2MetaMaskCapability;
    deployment: VerifiedDirectChatV2Deployment;
    peer: string;
    confirmationBlock: bigint;
  }): Promise<DirectChatV2ConversationSnapshot> => {
    const retryDelays = [250, 750, 1_500, 2_500] as const;
    const first = await runReadCapabilityOperation(capability, () =>
      readDirectChatV2Conversation({
        capability,
        deployment,
        peer,
        blockTag: confirmationBlock
      })
    );
    if (first.exists) return first;
    for (const delayMs of retryDelays) {
      await waitForPostConfirmationRead(delayMs);
      const conversation = await runReadCapabilityOperation(capability, () =>
        readDirectChatV2Conversation({ capability, deployment, peer })
      );
      if (conversation.exists) return conversation;
    }
    throw new Error(
      'Chat V2 conversation was confirmed but is not yet readable from the connected COTI RPC. Reconnect or retry the message; do not create the conversation again.'
    );
  };

  const assertHistoryScope = (
    scope: DirectChatV2HistoryScope,
    conversation: DirectChatV2ConversationSnapshot,
    deployment: VerifiedDirectChatV2Deployment
  ): void => {
    if (
      scope.chainId !== deployment.chainId ||
      scope.contractAddress.toLowerCase() !== deployment.contractAddress.toLowerCase() ||
      scope.conversationId.toLowerCase() !== conversation.conversationId.toLowerCase() ||
      scope.deploymentBlock !== deployment.deploymentBlock ||
      scope.conversationStartBlock !== conversation.createdBlock
    ) {
      throw new Error('Direct-chat V2 history request belongs to a different verified scope.');
    }
  };

  const createWithCapability = async ({
    capability,
    deployment,
    peer
  }: {
    capability: DirectChatV2MetaMaskCapability;
    deployment: VerifiedDirectChatV2Deployment;
    peer: string;
  }): Promise<DirectChatV2ReadyConversation> => {
    const submitted = await runWriteCapabilityOperation(capability, () =>
      createDirectChatV2Conversation({ capability, deployment, peer })
    );
    const confirmation = await requireSuccessfulReceipt(
      submitted.transaction,
      'Chat V2 conversation creation',
      {
        chainId: deployment.chainId,
        data: DIRECT_CHAT_V2_INTERFACE.encodeFunctionData('createConversation', [getAddress(peer.trim())]),
        from: capturedOwnerAddress,
        to: deployment.contractAddress,
        value: 0n
      }
    );
    const createdEvent = parseDirectChatV2ConversationCreatedReceipt({
      deployment,
      receipt: confirmation.receipt,
      expected: {
        transactionHash: confirmation.transactionHash,
        conversationId: submitted.reference.conversationId,
        ownerAddress: capturedOwnerAddress,
        peer,
        epoch: submitted.reference.epoch
      }
    });
    const conversation = await readConfirmedConversation({
      capability,
      deployment,
      peer,
      confirmationBlock: createdEvent.blockNumber
    });
    if (conversation.currentEpoch !== submitted.reference.epoch) {
      throw new Error('Chat V2 conversation epoch changed during creation confirmation.');
    }
    await readEpochKey({ capability, deployment, peer, conversation });
    return {
      created: true,
      conversation,
      transactionHash: confirmation.transactionHash
    };
  };

  const controllerImplementation: DirectChatV2SessionControllerImplementation = {
    manifest: immutableManifest,
    ownerAddress: capturedOwnerAddress,

    ensure: (peer) => withMutation(async () => {
      const capability = await requireOwnerCapability(true);
      const deployment = await verifiedDeploymentFor(capability);
      const existing = await runReadCapabilityOperation(capability, () =>
        readDirectChatV2Conversation({ capability, deployment, peer })
      );
      if (!existing.exists) {
        return createWithCapability({ capability, deployment, peer });
      }
      await readEpochKey({ capability, deployment, peer, conversation: existing });
      return { created: false, conversation: existing };
    }),

    create: (peer) => withMutation(async () => {
      const capability = await requireOwnerCapability(true);
      const deployment = await verifiedDeploymentFor(capability);
      return createWithCapability({ capability, deployment, peer });
    }),

    inspect: async (peer) => {
      const capability = await requireOwnerCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      return runCapabilityOperation(capability, () =>
        readDirectChatV2Conversation({ capability, deployment, peer })
      );
    },

    hasProfileSync: async () => {
      const capability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      return supportsDirectChatV2ProfileSync(deployment);
    },

    readNickname: async (account) => {
      const capability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      return runReadCapabilityOperation(capability, () =>
        readDirectChatV2Nickname({ capability, deployment, account })
      );
    },

    setNickname: (nickname) => withMutation(async () => {
      const capability = await requireOwnerCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      const submitted = await runWriteCapabilityOperation(capability, () =>
        setDirectChatV2Nickname({ capability, deployment, nickname })
      );
      await requireSuccessfulReceipt(
        submitted.transaction,
        'Chat V2 public-name update',
        {
          chainId: deployment.chainId,
          data: DIRECT_CHAT_V2_INTERFACE.encodeFunctionData('setMyNickname', [submitted.nickname]),
          from: capturedOwnerAddress,
          to: deployment.contractAddress,
          value: 0n
        }
      );
      const confirmed = await runReadCapabilityOperation(capability, () =>
        readDirectChatV2Nickname({ capability, deployment, account: capturedOwnerAddress })
      );
      if (confirmed !== submitted.nickname) {
        throw new Error('Chat V2 public name was not confirmed by the contract.');
      }
      return confirmed;
    }),

    readContactSettings: async (contact) => {
      const capability = await requireOwnerReadCapability(true);
      const deployment = await verifiedDeploymentFor(capability);
      return runReadCapabilityOperation(capability, () =>
        readDirectChatV2ContactSettings({ capability, deployment, contact })
      );
    },

    setContactSettings: (contact, settings) => withMutation(async () => {
      const capability = await requireOwnerCapability(true);
      const deployment = await verifiedDeploymentFor(capability);
      const current = await runReadCapabilityOperation(capability, () =>
        readDirectChatV2ContactSettings({ capability, deployment, contact })
      );
      if (isEmptyDirectChatV2ContactSettings(settings)) {
        if (!current.exists) return current;
        const submitted = await runWriteCapabilityOperation(capability, () =>
          clearDirectChatV2ContactSettings({
            capability,
            deployment,
            contact,
            expectedRevision: current.revision
          })
        );
        await requireSuccessfulReceipt(
          submitted.transaction,
          'Chat V2 private-contact settings clear',
          {
            chainId: deployment.chainId,
            data: DIRECT_CHAT_V2_INTERFACE.encodeFunctionData('clearMyContactSettings', [
              submitted.contact,
              submitted.expectedRevision
            ]),
            from: capturedOwnerAddress,
            to: deployment.contractAddress,
            value: 0n
          }
        );
      } else {
        const submitted = await runWriteCapabilityOperation(capability, () =>
          setDirectChatV2ContactSettings({
            capability,
            deployment,
            contact,
            expectedRevision: current.revision,
            settings
          })
        );
        await requireSuccessfulReceipt(
          submitted.transaction,
          'Chat V2 private-contact settings update',
          {
            chainId: deployment.chainId,
            data: DIRECT_CHAT_V2_INTERFACE.encodeFunctionData('setMyContactSettings', [
              submitted.contact,
              submitted.expectedRevision,
              submitted.encryptedSettings
            ]),
            from: capturedOwnerAddress,
            to: deployment.contractAddress,
            value: 0n
          }
        );
      }
      const confirmed = await runReadCapabilityOperation(capability, () =>
        readDirectChatV2ContactSettings({ capability, deployment, contact })
      );
      const expectedEmpty = isEmptyDirectChatV2ContactSettings(settings);
      if (
        confirmed.exists === expectedEmpty ||
        (!expectedEmpty && (
          confirmed.settings.savedName !== settings.savedName.trim() ||
          confirmed.settings.hidden !== settings.hidden
        ))
      ) {
        throw new Error('Chat V2 private contact settings were not confirmed by the contract.');
      }
      return confirmed;
    }),

    listConversations: async (beforeIndexExclusive, limit) => {
      const capability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      return runReadCapabilityOperation(capability, () =>
        readDirectChatV2ConversationPreviewPage({
          capability,
          deployment,
          ...(beforeIndexExclusive === undefined ? {} : { beforeIndexExclusive }),
          ...(limit === undefined ? {} : { limit })
        })
      );
    },

    incomingHistory: async () => {
      const capability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      const scope: DirectChatV2IncomingDiscoveryScope = Object.freeze({
        chainId: deployment.chainId,
        contractAddress: deployment.contractAddress,
        ownerAddress: capturedOwnerAddress,
        deploymentBlock: deployment.deploymentBlock
      });
      const dependencies: DirectChatV2IncomingDiscoveryDependencies = Object.freeze({
        getLatestBlockNumber: () => runReadCapabilityOperation(capability, () =>
          readDirectChatV2LatestBlockNumber({ capability, deployment })
        ),
        readCanonicalBlock: (blockNumber) => runReadCapabilityOperation(capability, () =>
          readDirectChatV2CanonicalBlock({ capability, deployment, blockNumber })
        ),
        readIncomingPage: ({ fromBlock, toBlock }) => runReadCapabilityOperation(capability, () =>
          readDirectChatV2IncomingMessageLogPage({
            capability,
            deployment,
            fromBlock,
            toBlock
          })
        )
      });
      assertDirectChatV2MetaMaskCapabilityScope({
        capability,
        ownerAddress: capturedOwnerAddress,
        chainId: immutableManifest.chainId
      });
      return Object.freeze({ scope, dependencies });
    },

    history: async (peer) => {
      const readCapability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(readCapability);
      const lookup = await runReadCapabilityOperation(readCapability, () =>
        readDirectChatV2Conversation({ capability: readCapability, deployment, peer })
      );
      if (!lookup.exists) return null;
      const capability = await requireOwnerReadCapability(true);
      const conversation = await readCreatedConversationForHistory({ capability, deployment, peer });
      const scope = Object.freeze({
        chainId: deployment.chainId,
        contractAddress: deployment.contractAddress,
        conversationId: conversation.conversationId,
        deploymentBlock: deployment.deploymentBlock,
        conversationStartBlock: conversation.createdBlock
      });
      const dependencies: DirectChatV2SyncDependencies = Object.freeze({
        getLatestBlockNumber: async (chainId) => {
          if (chainId !== deployment.chainId) {
            throw new Error('Direct-chat V2 latest-block read requested the wrong chain.');
          }
          return runReadCapabilityOperation(capability, () =>
            readDirectChatV2LatestBlockNumber({ capability, deployment })
          );
        },
        readCanonicalBlock: async (chainId, blockNumber) => {
          if (chainId !== deployment.chainId) {
            throw new Error('Direct-chat V2 canonical-block read requested the wrong chain.');
          }
          return runReadCapabilityOperation(capability, () =>
            readDirectChatV2CanonicalBlock({ capability, deployment, blockNumber })
          );
        },
        readMessagePage: async ({ scope: requestedScope, fromBlock, toBlock }) => {
          assertHistoryScope(requestedScope, conversation, deployment);
          return runReadCapabilityOperation(capability, () =>
            readDirectChatV2MessageLogPage({
              capability,
              deployment,
              peer,
              fromBlock,
              toBlock
            })
          );
        },
        readConversationMessageCountAtBlock: async ({
          scope: requestedScope,
          blockNumber
        }) => {
          assertHistoryScope(requestedScope, conversation, deployment);
          return runReadCapabilityOperation(capability, () =>
            readDirectChatV2ConversationMessageCountAtBlock({
              capability,
              deployment,
              peer,
              blockNumber
            })
          );
        },
        resolveEpochKey: async (reference) => {
          if (
            reference.chainId !== deployment.chainId ||
            reference.contractAddress.toLowerCase() !== deployment.contractAddress.toLowerCase() ||
            reference.conversationId.toLowerCase() !== conversation.conversationId.toLowerCase()
          ) {
            throw new Error('Direct-chat V2 epoch-key request belongs to a different history scope.');
          }
          return readEpochKey({
            capability,
            conversation,
            deployment,
            peer,
            epoch: reference.epoch
          });
        },
        clearEpochKeys: () => {
          epochKeyPromises.clear();
        }
      });
      assertDirectChatV2MetaMaskCapabilityScope({
        capability,
        ownerAddress: capturedOwnerAddress,
        chainId: immutableManifest.chainId
      });
      return Object.freeze({ conversation, scope, dependencies });
    },

    readNativeCredit: async () => {
      const capability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      return runReadCapabilityOperation(capability, () =>
        readDirectChatV2NativeCredit({ capability, deployment })
      );
    },

    signImageSessionAuthorization: (message) => withMutation(async () => {
      const capability = await requireOwnerCapability(false);
      return runCapabilityOperation(capability, () =>
        signDirectChatV2ImageSessionAuthorization({ capability, message })
      );
    }),

    withdrawNativeCredit: () => withMutation(async () => {
      const capability = await requireOwnerCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      const submitted = await runWriteCapabilityOperation(capability, () =>
        withdrawDirectChatV2NativeCredit({ capability, deployment })
      );
      const confirmation = await requireSuccessfulReceipt(
        submitted.transaction,
        'Chat V2 native-credit withdrawal',
        {
          chainId: deployment.chainId,
          data: DIRECT_CHAT_V2_INTERFACE.encodeFunctionData('withdrawNativeCredit'),
          from: capturedOwnerAddress,
          to: deployment.contractAddress,
          value: 0n
        }
      );
      const remainingCredit = await runReadCapabilityOperation(capability, () =>
        readDirectChatV2NativeCredit({ capability, deployment })
      );
      return Object.freeze({
        observedCredit: submitted.observedCredit,
        remainingCredit,
        transactionHash: confirmation.transactionHash
      });
    }),

    rotate: (peer) => withMutation(async () => {
      const capability = await requireOwnerCapability(true);
      const deployment = await verifiedDeploymentFor(capability);
      const before = await readCreatedConversation({ capability, deployment, peer });
      const submitted = await runWriteCapabilityOperation(capability, () =>
        rotateDirectChatV2ConversationKey({ capability, deployment, peer })
      );
      const confirmation = await requireSuccessfulReceipt(
        submitted.transaction,
        'Chat V2 key rotation',
        {
          chainId: deployment.chainId,
          data: DIRECT_CHAT_V2_INTERFACE.encodeFunctionData('rotateConversationKey', [
            before.conversationId,
            before.currentEpoch
          ]),
          from: capturedOwnerAddress,
          to: deployment.contractAddress,
          value: 0n
        }
      );
      const conversation = await readCreatedConversation({ capability, deployment, peer });
      if (
        submitted.reference.epoch !== before.currentEpoch + 1n ||
        conversation.currentEpoch !== submitted.reference.epoch
      ) {
        throw new Error('Chat V2 rotation did not confirm the expected next epoch.');
      }
      await readEpochKey({ capability, deployment, peer, conversation });
      return {
        conversation,
        previousEpoch: before.currentEpoch,
        transactionHash: confirmation.transactionHash
      };
    }),

    send: (peer, input) => withMutation(async () => {
      const capability = await requireOwnerCapability(true);
      const deployment = await verifiedDeploymentFor(capability);
      const conversation = await readCreatedConversation({ capability, deployment, peer });
      const key = await readEpochKey({ capability, deployment, peer, conversation });
      const plaintext = encodeDirectChatV2Payload(input);
      const payload = decodeDirectChatV2Payload(plaintext);
      const submitted = await runWriteCapabilityOperation(capability, () => sendDirectChatV2Message({
        capability,
        deployment,
        peer,
        key,
        plaintext,
        retireNonceAttempt,
        tip: input.tip
      }));
      const confirmation = await requireSuccessfulReceipt(
        submitted.transaction,
        'Chat V2 message',
        {
          chainId: deployment.chainId,
          data: DIRECT_CHAT_V2_INTERFACE.encodeFunctionData('sendMessage', [
            submitted.context.conversationId,
            submitted.context.epoch,
            submitted.context.senderSequence,
            submitted.encrypted.nonce,
            submitted.encrypted.ciphertext,
            submitted.context.feeTaken
          ]),
          from: capturedOwnerAddress,
          to: deployment.contractAddress,
          value: submitted.context.valueSent
        }
      );
      const event = parseDirectChatV2MessageReceipt({
        deployment,
        receipt: confirmation.receipt,
        expected: {
          transactionHash: confirmation.transactionHash,
          context: submitted.context,
          encrypted: submitted.encrypted
        }
      });
      return {
        event,
        payload,
        submittedTransactionHash: submitted.transaction.txHash,
        transactionHash: confirmation.transactionHash
      };
    }),

    watch: async (peer, onHint) => {
      const capability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      return runReadCapabilityOperation(capability, () => watchDirectChatV2MessageHints({
        capability,
        deployment,
        peer,
        onHint
      }));
    },

    watchIncoming: async (onHint) => {
      const capability = await requireOwnerReadCapability(false);
      const deployment = await verifiedDeploymentFor(capability);
      return runReadCapabilityOperation(capability, () => watchDirectChatV2IncomingMessageHints({
        capability,
        deployment,
        onHint
      }));
    },

    clearEpochKeys: () => {
      epochKeyPromises.clear();
    }
  };
  const controller = Object.freeze(controllerImplementation) as unknown as DirectChatV2SessionController;
  DIRECT_CHAT_V2_SESSION_CONTROLLERS.add(controller);
  return controller;
};
