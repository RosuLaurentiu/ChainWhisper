import {
  BrowserProvider,
  Contract,
  Interface,
  getAddress,
  type JsonRpcSigner,
  type TransactionReceipt,
  type TransactionResponse
} from '@coti-io/coti-ethers';
import {
  CHAT_REACTIONS_V1_ABI,
  buildChatReactionPending,
  bindChatReactionPendingTransaction,
  chatReactionStableTargetKey,
  deriveChatReactionSourceAnchor,
  getChatReactionEmojiId,
  normalizeChatReactionSource,
  parseChatReactionsV1Log,
  replaceChatReactionPendingTransaction,
  type ChatReactionObservation,
  type ChatReactionSource,
  type SubmittedChatReactionPending
} from './chatReactionsV1';
import {
  assertAttestedChatReactionsV1Deployment,
  type AttestedChatReactionsV1Deployment
} from './chatReactionsV1Chain';
import type { CotiReadProvider } from './appShared';

declare const CHAT_REACTIONS_V1_METAMASK_CAPABILITY_BRAND: unique symbol;
export type ChatReactionsV1MetaMaskCapability = Readonly<{
  readonly [CHAT_REACTIONS_V1_METAMASK_CAPABILITY_BRAND]: true;
}>;

type CapabilityBinding = Readonly<{
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent?: () => void;
  browserProvider: BrowserProvider;
  readProvider: CotiReadProvider | BrowserProvider;
  chainId: bigint;
  ownerAddress: string;
  signer: JsonRpcSigner;
}>;

const CAPABILITIES = new WeakMap<object, CapabilityBinding>();
const DEPLOYMENT_CAPABILITIES = new WeakMap<object, ChatReactionsV1MetaMaskCapability>();
const REACTIONS_INTERFACE = new Interface(CHAT_REACTIONS_V1_ABI);
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;

const address = (value: unknown, label: string): string => {
  try {
    const normalized = getAddress(String(value ?? '').trim());
    if (normalized.toLowerCase() === ZERO_ADDRESS) throw new Error('zero');
    return normalized;
  } catch {
    throw new Error(`${label} is not a valid non-zero address.`);
  }
};

const transactionHash = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!BYTES32_PATTERN.test(normalized)) throw new Error(`${label} is not canonical bytes32.`);
  return normalized;
};

const bindingOf = (capability: ChatReactionsV1MetaMaskCapability): CapabilityBinding => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) throw new Error('ChatReactionsV1 requires the exact bound owner browser-wallet capability.');
  return binding;
};

const assertBindingCurrent = async (binding: CapabilityBinding): Promise<void> => {
  await binding.assertCurrent();
};

const attestBindingScope = async (
  binding: CapabilityBinding,
  assertSnapshotCurrent?: () => void
): Promise<void> => {
  if (binding.readProvider !== binding.browserProvider && assertSnapshotCurrent) {
    assertSnapshotCurrent();
    return;
  }
  const [connectedOwner, network] = await Promise.all([
    binding.signer.getAddress(),
    binding.browserProvider.getNetwork()
  ]);
  if (assertSnapshotCurrent) assertSnapshotCurrent();
  else await assertBindingCurrent(binding);
  if (
    address(connectedOwner, 'Connected reaction owner') !== binding.ownerAddress ||
    BigInt(network.chainId) !== binding.chainId
  ) {
    throw new Error('ChatReactionsV1 owner capability account or chain changed.');
  }
};

export const bindChatReactionsV1MetaMaskCapability = async ({
  signer,
  browserProvider,
  readProvider = browserProvider,
  ownerAddress,
  chainId,
  assertCurrent,
  assertSnapshotCurrent
}: {
  signer: JsonRpcSigner;
  browserProvider: BrowserProvider;
  readProvider?: CotiReadProvider | BrowserProvider;
  ownerAddress: string;
  chainId: bigint;
  assertCurrent: () => void | Promise<void>;
  assertSnapshotCurrent?: () => void;
}): Promise<ChatReactionsV1MetaMaskCapability> => {
  const candidate = signer as JsonRpcSigner & { privateKey?: unknown };
  if (
    !(browserProvider instanceof BrowserProvider) ||
    !candidate ||
    candidate.provider !== browserProvider ||
    typeof candidate.getAddress !== 'function' ||
    typeof candidate.sendTransaction !== 'function' ||
    typeof assertCurrent !== 'function' ||
    (assertSnapshotCurrent !== undefined && typeof assertSnapshotCurrent !== 'function') ||
    typeof chainId !== 'bigint' ||
    chainId <= 0n ||
    'privateKey' in candidate
  ) {
    throw new Error('ChatReactionsV1 requires the owner signer from the exact COTI BrowserProvider session.');
  }
  const owner = address(ownerAddress, 'Expected reaction owner');
  const binding = Object.freeze({
    assertCurrent,
    assertSnapshotCurrent,
    browserProvider,
    readProvider,
    chainId,
    ownerAddress: owner,
    signer: candidate
  });
  await attestBindingScope(binding, assertSnapshotCurrent);
  const capability = Object.freeze({}) as ChatReactionsV1MetaMaskCapability;
  CAPABILITIES.set(capability, binding);
  return capability;
};

/** Releases the wallet provider owned by this reactions capability. */
export const releaseChatReactionsV1MetaMaskCapability = (
  capability: ChatReactionsV1MetaMaskCapability
): boolean => {
  const binding = capability && CAPABILITIES.get(capability);
  if (!binding) return false;
  CAPABILITIES.delete(capability);
  return true;
};

export const bindChatReactionsV1OwnerDeployment = async ({
  capability,
  deployment
}: {
  capability: ChatReactionsV1MetaMaskCapability;
  deployment: AttestedChatReactionsV1Deployment;
}): Promise<void> => {
  const binding = bindingOf(capability);
  if (binding.assertSnapshotCurrent) binding.assertSnapshotCurrent();
  else await assertBindingCurrent(binding);
  const attested = assertAttestedChatReactionsV1Deployment(deployment);
  if (attested.chainId !== binding.chainId) {
    throw new Error('ChatReactionsV1 owner capability is on another chain.');
  }
  DEPLOYMENT_CAPABILITIES.set(deployment, capability);
};

const deploymentBinding = (
  capability: ChatReactionsV1MetaMaskCapability,
  deployment: AttestedChatReactionsV1Deployment
): CapabilityBinding => {
  const binding = bindingOf(capability);
  if (DEPLOYMENT_CAPABILITIES.get(deployment) !== capability) {
    throw new Error('ChatReactionsV1 deployment was not attested by this owner capability.');
  }
  return binding;
};

const transactionMatches = (
  transaction: Pick<TransactionResponse, 'data' | 'from' | 'to' | 'value'>,
  expected: Readonly<{ data: string; from: string; to: string }>
): boolean =>
  address(transaction.from, 'Reaction transaction sender') === expected.from &&
  address(transaction.to, 'Reaction transaction target') === expected.to &&
  transaction.data.toLowerCase() === expected.data &&
  BigInt(transaction.value) === 0n;

type ExpectedReactionTransaction = Readonly<{
  data: string;
  draft: ReturnType<typeof buildChatReactionPending>;
  from: string;
  to: string;
}>;

const successfulReceipt = async ({
  transaction,
  expected,
  waitForReceipt
}: {
  transaction: TransactionResponse;
  expected: ExpectedReactionTransaction;
  waitForReceipt?: (transactionHash: string) => Promise<TransactionReceipt | null>;
}): Promise<Readonly<{
  receipt: TransactionReceipt;
  pending: SubmittedChatReactionPending;
  transactionHash: string;
}>> => {
  if (!transactionMatches(transaction, expected)) {
    throw new Error('Reaction wallet returned a transaction with changed authority or calldata.');
  }
  const originalHash = transactionHash(transaction.hash, 'Reaction submitted hash');
  let pending = bindChatReactionPendingTransaction(
    expected.draft,
    originalHash
  );
  let receipt: TransactionReceipt | null;
  let effectiveHash = originalHash;
  if (waitForReceipt) {
    receipt = await waitForReceipt(originalHash);
  } else {
    try {
      receipt = await transaction.wait();
    } catch (error) {
      const replacementError = error as Record<string, unknown> | null;
      if (
        !replacementError ||
        replacementError.code !== 'TRANSACTION_REPLACED' ||
        replacementError.cancelled === true ||
        replacementError.reason === 'cancelled'
      ) {
        throw error;
      }
      const replacement = replacementError.replacement as TransactionResponse | undefined;
      if (!replacement || !transactionMatches(replacement, expected)) {
        throw new Error('Reaction replacement changed the signed operation.');
      }
      effectiveHash = transactionHash(replacement.hash, 'Reaction replacement hash');
      pending = replaceChatReactionPendingTransaction(pending, effectiveHash);
      receipt = replacementError.receipt as TransactionReceipt | null;
    }
  }
  if (!receipt || Number(receipt.status) !== 1 || transactionHash(receipt.hash, 'Reaction receipt hash') !== effectiveHash) {
    throw new Error('Reaction transaction did not confirm successfully.');
  }
  return Object.freeze({ receipt, pending, transactionHash: effectiveHash });
};

export type ChatReactionWriteResult = Readonly<{
  event: ChatReactionObservation;
  pending: SubmittedChatReactionPending;
  submittedTransactionHash: string;
  transactionHash: string;
}>;

export const setChatReactionsV1Reaction = async ({
  capability,
  deployment,
  source: inputSource,
  emoji,
  active,
  operationId,
  waitForReceipt
}: {
  capability: ChatReactionsV1MetaMaskCapability;
  deployment: AttestedChatReactionsV1Deployment;
  source: ChatReactionSource;
  emoji: string;
  active: boolean;
  operationId: string;
  waitForReceipt?: (transactionHash: string) => Promise<TransactionReceipt | null>;
}): Promise<ChatReactionWriteResult> => {
  const binding = deploymentBinding(capability, deployment);
  if (binding.assertSnapshotCurrent) binding.assertSnapshotCurrent();
  else await assertBindingCurrent(binding);
  const source = normalizeChatReactionSource(inputSource);
  const targetContract = source.kind === 'direct'
    ? deployment.directChatV2.contractAddress
    : deployment.groupChatV2.contractAddress;
  if (
    source.chainId !== deployment.chainId ||
    source.contractAddress !== targetContract
  ) {
    throw new Error('Reaction source is outside the attested chat deployment.');
  }
  const emojiId = getChatReactionEmojiId(emoji);
  const messageAnchor = deriveChatReactionSourceAnchor(source);
  const target = {
    kind: source.kind,
    chainId: source.chainId,
    reactionsContract: deployment.contractAddress,
    targetContract,
    conversationId: source.conversationId,
    groupId: source.groupId,
    messageId: source.messageId
  } as const;
  const draft = buildChatReactionPending({
    target,
    reactor: binding.ownerAddress,
    emojiId,
    active,
    messageAnchor,
    operationId
  });
  const args = source.kind === 'direct'
    ? [source.conversationId, BigInt(source.messageId), messageAnchor, emojiId, active]
    : [BigInt(source.groupId as string), BigInt(source.messageId), messageAnchor, emojiId, active];
  const functionName = source.kind === 'direct' ? 'setDirectReaction' : 'setGroupReaction';
  const data = REACTIONS_INTERFACE.encodeFunctionData(functionName, args);
  const expected = Object.freeze({
    data: data.toLowerCase(),
    from: binding.ownerAddress,
    to: deployment.contractAddress,
    draft
  });
  const contract = new Contract(deployment.contractAddress, CHAT_REACTIONS_V1_ABI, binding.signer);
  const request = await contract.getFunction(functionName).populateTransaction(...args);
  if (address(request.to, 'Populated reaction target') !== expected.to ||
      String(request.data ?? '').toLowerCase() !== expected.data ||
      BigInt(request.value ?? 0) !== 0n) {
    throw new Error('Reaction transaction population changed the expected call.');
  }
  const transaction = await binding.signer.sendTransaction({ ...request, value: 0n });
  const submittedTransactionHash = transactionHash(transaction.hash, 'Reaction submitted hash');
  const confirmed = await successfulReceipt({ transaction, expected, waitForReceipt });

  const events = confirmed.receipt.logs.flatMap((log) => {
    try {
      return [parseChatReactionsV1Log({
        deployment,
        observedChainId: binding.chainId,
        log: {
          address: log.address,
          topics: [...log.topics],
          data: log.data,
          blockHash: confirmed.receipt.blockHash,
          blockNumber: confirmed.receipt.blockNumber,
          transactionHash: confirmed.transactionHash,
          transactionIndex: confirmed.receipt.index,
          index: log.index,
          removed: false
        }
      })];
    } catch {
      return [];
    }
  }).filter((event) =>
    chatReactionStableTargetKey(event) === chatReactionStableTargetKey(target) &&
    event.reactor === binding.ownerAddress &&
    event.emojiId === emojiId &&
    event.active === active &&
    event.messageAnchor === messageAnchor
  );
  if (events.length !== 1) {
    throw new Error('Reaction receipt does not contain exactly one matching event.');
  }
  return Object.freeze({
    event: events[0],
    pending: confirmed.pending,
    submittedTransactionHash,
    transactionHash: confirmed.transactionHash
  });
};
